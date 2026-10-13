import { env } from 'cloudflare:workers';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { isFieldVisible, kindLabel, parseWorkExperiences, sections, type Field, type IntakeRecord } from './fields';
import { formatWorkExperience, type CandidatePublic, type MatchRecord } from './platform-types';
import { ApiError, db } from './server';
import { imageDimensions } from './platform-server';
import { createClientTextRedactor } from './pdf-contact-redaction';

type PdfGroup = { title: string; rows: [string, string][] };
type PdfEntry = { reference: string; title: string; dateLabel: string; photoId?: string; groups: PdfGroup[] };
type PortraitMetadata = { id: string; object_key: string; content_type: string; byte_length: number };
const photoBudgetMessage = '照片較多，請選較少資料或減少每份PDF的份數。';
export const pdfPhotoByteBudget = 12 * 1024 * 1024;
const pdfDecodedPhotoBudget = 64 * 1024 * 1024;
let cachedFont: Promise<Uint8Array> | undefined;
async function fontBytes(request: Request) {
  if (!cachedFont) cachedFont = (async () => {
    const url = new URL('/fonts/jiahe-cjk-regular.ttf', request.url);
    let response = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : null;
    if (!response?.ok) response = await fetch(url);
    if (!response.ok) throw new ApiError(503, '暫時未能製作PDF，請稍後再試。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 1000 || !((bytes[0] === 0 && bytes[1] === 1) || String.fromCharCode(...bytes.slice(0, 4)) === 'OTTO')) throw new ApiError(503, '暫時未能製作PDF，請稍後再試。');
    return bytes;
  })().catch(error => { cachedFont = undefined; throw error; });
  return cachedFont;
}
function dateLabel(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(value => value.type === name)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}
const valueText = (value: unknown) => Array.isArray(value) ? value.join('、') : typeof value === 'boolean' ? value ? '是' : '否' : String(value || '');

export async function createRecordsPdf(records: IntakeRecord[], mode: 'full' | 'client', request: Request, matches: MatchRecord[] = []) {
  const redact = mode === 'client' ? createClientTextRedactor(records.map(record => ({ phone: record.data.phone, email: record.data.email }))) : (value: string) => value;
  const fieldText = (field: Field, record: IntakeRecord) => {
    if (field.type === 'experience') {
      const original = parseWorkExperiences(record.data[field.name]);
      if (mode === 'full') return formatWorkExperience(original);
      const rows = original.map(row => ({ ...row, country: redact(row.country || ''), household: redact(row.household || ''), duties: redact(row.duties || ''), leavingReason: redact(row.leavingReason || '') }));
      return formatWorkExperience(rows);
    }
    const text = valueText(record.data[field.name]);
    return !field.type || field.type === 'text' || field.type === 'textarea' ? redact(text) : text;
  };
  const entries: PdfEntry[] = records.map((record, index) => {
    const groups: PdfGroup[] = sections[record.kind].map(group => ({ title: group.title, rows: group.fields.filter(field => isFieldVisible(field, record.data) && !(mode === 'client' && ['phone', 'email', 'publicProfileConsent'].includes(field.name))).map(field => [field.label, fieldText(field, record)]) }));
    if (index === 0 && matches.length) groups.push({ title: '配對安排', rows: matches.flatMap(match => [
      ['人選', `${redact(match.jobseekerName)}（${match.jobseekerReference}）`], ['配對階段', match.stage], ['面試時間', match.interviewAt || '尚未安排'], ...(mode === 'full' ? [['配對備註', match.notes || '未填寫']] : []),
    ] as [string, string][]) });
    if (mode === 'full') groups.push({ title: '登記與跟進', rows: [
      ['資料使用同意', record.data.consent === true ? '已同意資料用於聯絡及服務配對' : '未同意'], ['跟進狀態', record.status], ['下次跟進', record.nextFollowUp || '未安排'], ['內部備註', record.notes], ['提交時間', `${dateLabel(record.createdAt)}（香港時間）\n${record.createdAt}`], ['更新時間', `${dateLabel(record.updatedAt)}（香港時間）\n${record.updatedAt}`],
    ] });
    return { reference: record.reference, title: `${kindLabel(record.kind)}${record.kind === 'jobseeker' ? '資料' : '服務需求'}`, dateLabel: `登記日期 ${dateLabel(record.createdAt)}`, photoId: record.photoId, groups };
  });
  return renderPdf(entries, mode === 'full' ? '完整登記資料' : '客戶配對資料', request);
}
export async function createCandidatesPdf(candidates: CandidatePublic[], request: Request) {
  const entries: PdfEntry[] = [];
  for (const candidate of candidates) {
    const photo = candidate.hasPhoto ? await db().prepare("SELECT i.photo_id FROM candidate_publications p JOIN intake_records i ON i.id = p.intake_id WHERE p.id = ? AND p.state = 'published' AND json_extract(i.data_json, '$.publicProfileConsent') = 1").bind(candidate.id).first<{ photo_id: string }>() : null;
    entries.push({ reference: candidate.reference, title: `人選資料 · ${candidate.displayName}`, dateLabel: `更新日期 ${dateLabel(candidate.updatedAt)}`, photoId: photo?.photo_id, groups: [
      { title: '基本資料', rows: [['顯示名稱', candidate.displayName], ['國籍／地區', candidate.nationality], ['求職情況', candidate.candidateType], ['年齡', candidate.age], ['所在地', candidate.currentLocation], ['教育程度', candidate.education]] },
      { title: '服務與經驗', rows: [['提供服務', candidate.services.join('、')], ['語言', candidate.languages.join('、')], ['工作年資', candidate.yearsExperience], ['技能', candidate.skills.join('、')], ['培訓及資格', candidate.qualifications], ['工作經歷', formatWorkExperience(candidate.workExperiences)]] },
      { title: '工作安排', rows: [['工作形式', candidate.employmentType], ['工作地區', candidate.workLocations.join('、')], ['可開始日期', candidate.availableFrom], ['期望薪金', candidate.salaryNegotiable ? '可商議' : candidate.expectedSalary ? `HK$ ${candidate.expectedSalary}／${candidate.salaryUnit}` : '尚未填寫'], ['自我介紹', candidate.summary]] },
    ] });
  }
  return renderPdf(entries, '人選資料', request);
}
export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(bytes as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' } });
}
async function renderPdf(entries: PdfEntry[], label: string, request: Request) {
  const textVolume = entries.reduce((total, entry) => total + entry.groups.reduce((sum, group) => sum + group.rows.reduce((valueSum, row) => valueSum + row[1].length, 0), 0), 0);
  if (textVolume > 240000) throw new ApiError(413, '所選資料內容較多，請減少份數後分批下載。');
  const ids = [...new Set(entries.flatMap(entry => entry.photoId ? [entry.photoId] : []))];
  const portraitMetadata = new Map<string, PortraitMetadata>();
  if (ids.length && env.BUCKET) {
    const rows = await db().prepare(`SELECT id, object_key, content_type, byte_length FROM intake_photos WHERE id IN (${ids.map(() => '?').join(',')}) AND attached_record_id IS NOT NULL`).bind(...ids).all<PortraitMetadata>();
    if (rows.results.reduce((total, row) => total + row.byte_length, 0) > pdfPhotoByteBudget) throw new ApiError(400, photoBudgetMessage);
    rows.results.forEach(row => portraitMetadata.set(row.id, row));
  }
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  // Keep the complete static font: dynamic CJK subsetting may omit outlines.
  const font = await document.embedFont(await fontBytes(request), { subset: false, features: { ccmp: false, liga: false, clig: false, calt: false, locl: false, frac: false, numr: false, dnom: false, kern: false, rclt: false, rlig: false, rvrn: false } });
  document.setTitle(`家合僱傭 | ${label}`); document.setAuthor('家合僱傭'); document.setCreator('家合僱傭'); document.setProducer('家合僱傭');
  const colors = { ink: rgb(.12,.2,.18), muted: rgb(.4,.44,.41), rule: rgb(.82,.85,.81), accent: rgb(.2,.37,.29), paper: rgb(.96,.96,.92) };
  const supported = new Set(font.getCharacterSet()); let hasEncodedCharacters = false;
  function printable(text: string) { return Array.from(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')).map(character => {
    if (character === '\n' || character === '\t') return character === '\t' ? '    ' : character;
    if (supported.has(character.codePointAt(0)!)) return character;
    hasEncodedCharacters = true; return `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`;
  }).join(''); }
  function wrap(value: string, availableWidth: number, size: number, activeFont: PDFFont = font) {
    const result: string[] = [];
    for (const paragraph of printable(value).replace(/\r\n?/g, '\n').split('\n')) {
      let line = ''; for (const character of paragraph) { const next = line + character; if (line && activeFont.widthOfTextAtSize(next, size) > availableWidth) { result.push(line); line = character; } else line = next; } result.push(line || ' ');
    } return result;
  }
  function headerTitle(value: string) {
    const text = printable(value), maximumWidth = width - margin * 2;
    if (font.widthOfTextAtSize(text, 12) <= maximumWidth) return text;
    const ending = printable('…'), characters = Array.from(text);
    while (characters.length && font.widthOfTextAtSize(characters.join('') + ending, 12) > maximumWidth) characters.pop();
    return characters.join('') + ending;
  }
  const width = 595.28, height = 841.89, margin = 46, valueX = 194, valueWidth = width - margin - valueX;
  let page!: PDFPage, y = 0, activeEntry: PdfEntry, portraitBytes = 0, decodedPhotoBytes = 0;
  function newPage(continued = false) {
    if (document.getPageCount() >= 500) throw new ApiError(413, '所選資料頁數較多，請減少份數後分批下載。');
    page = document.addPage([width,height]); page.drawRectangle({ x: 0, y: height - 105, width, height: 105, color: colors.paper });
    page.drawText('家合僱傭', { x: margin, y: height - 43, font, size: 19, color: colors.accent });
    page.drawText(headerTitle(`${activeEntry.title}${continued ? '（續）' : ''}`), { x: margin, y: height - 76, font, size: 12, color: colors.ink });
    page.drawText(activeEntry.reference, { x: width - margin - font.widthOfTextAtSize(activeEntry.reference,9), y: height - 43, font, size: 9, color: colors.muted });
    page.drawText(activeEntry.dateLabel, { x: margin, y: height - 123, font, size: 9, color: colors.muted }); y = height - 152;
  }
  function ensure(space: number) { if (y - space < 72) newPage(true); }
  function section(title: string) { ensure(65); page.drawText(title,{ x: margin,y,font,size:12,color:colors.accent }); page.drawLine({ start:{x:margin,y:y-10},end:{x:width-margin,y:y-10},thickness:.6,color:colors.rule }); y -= 32; }
  function row(title: string, value: string) {
    const lines = wrap(value || '未填寫',valueWidth,10), labels = wrap(title,valueX-margin-15,9);
    ensure(Math.max(labels.length,Math.min(lines.length,2))*16+10); const start=y; let continued=false;
    labels.forEach((line,index) => page.drawText(line,{x:margin,y:start-index*15,font,size:9,color:colors.muted}));
    for (const line of lines) { if(y<83) {continued=true;newPage(true);page.drawText(`${title}（續）`,{x:margin,y,font,size:9,color:colors.muted});} page.drawText(line,{x:valueX,y,font,size:10,color:colors.ink});y-=16; }
    if(!continued)y=Math.min(y,start-labels.length*15);y-=10;
  }
  for (const entry of entries) {
    activeEntry=entry;newPage();
    if(entry.photoId && env.BUCKET) {
      const stored=portraitMetadata.get(entry.photoId);
      if(stored) {
        const object=await env.BUCKET.get(stored.object_key);
        if(object) {
          try {
            const bytes=await object.arrayBuffer(); portraitBytes+=bytes.byteLength; if(portraitBytes>pdfPhotoByteBudget)throw new ApiError(400,photoBudgetMessage);
            const dimensions=imageDimensions(new Uint8Array(bytes),stored.content_type);decodedPhotoBytes+=dimensions.width*dimensions.height*4;if(decodedPhotoBytes>pdfDecodedPhotoBudget)throw new ApiError(400,photoBudgetMessage);
            const portrait=stored.content_type==='image/png'?await document.embedPng(bytes):await document.embedJpg(bytes);const box=portrait.scaleToFit(90,106);page.drawImage(portrait,{x:width-margin-box.width,y:y-box.height,width:box.width,height:box.height});page.drawText('登記照片',{x:margin,y:y-18,font,size:9,color:colors.muted});y-=Math.max(116,box.height+14);
          } catch(error) {
            if(error instanceof ApiError && error.message===photoBudgetMessage)throw error;
            // A corrupt optional attachment must not prevent downloading the
            // saved contact, service and matching records.
            row('登記照片','照片暫未能顯示。');
          }
        }
      }
    }
    for(const group of entry.groups) {section(group.title);for(const [title,value] of group.rows)row(title,value);}
  }
  const pages=document.getPages();pages.forEach((sheet,index)=>{
    sheet.drawLine({start:{x:margin,y:52},end:{x:width-margin,y:52},thickness:.6,color:colors.rule});sheet.drawText(label,{x:margin,y:34,font,size:8,color:colors.muted});const pageNumber=`${index+1} / ${pages.length}`;sheet.drawText(pageNumber,{x:width-margin-font.widthOfTextAtSize(pageNumber,8),y:34,font,size:8,color:colors.muted});if(hasEncodedCharacters)sheet.drawText('未支援字元以 Unicode 編碼顯示。',{x:margin+116,y:34,font,size:7,color:colors.muted});
  }); return document.save();
}
