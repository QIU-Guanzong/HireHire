// A local, conservative text filter for client PDFs. It does not inspect photos
// or guarantee detection of arbitrary obfuscation, addresses or other identity data.
type Contacts = { phone?: unknown; email?: unknown };
type Span = { start: number; end: number; replacement: string };
const phoneMarker = '[電話已隱去]', emailMarker = '[電郵已隱去]';
const invisible = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
function folded(character: string) {
  if (invisible.test(character)) return '';
  let result = character.normalize('NFKC');
  result = result.replace(/[‐‑‒–—−]/gu, '-');
  // NFKC handles full-width/mathematical digits; common Arabic digit blocks
  // need an explicit conversion for detection, without rewriting other text.
  return Array.from(result, part => {
    const code = part.codePointAt(0)!;
    for (const zero of [0x0660, 0x06f0, 0x0966]) if (code >= zero && code <= zero + 9) return String(code - zero);
    return part;
  }).join('');
}
function projection(value: string) {
  let text = '', offset = 0;
  const starts: number[] = [], ends: number[] = [];
  for (const character of value) {
    const part = folded(character);
    text += part;
    for (let index = 0; index < part.length; index++) { starts.push(offset); ends.push(offset + character.length); }
    offset += character.length;
  }
  return { text, starts, ends };
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const digits = (value: string) => projection(value).text.replace(/\D/g, '');
function dateOrYearRange(value: string) {
  const text = value.trim().replace(/^\(|\)$/g, '');
  if (/^(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])$/.test(text)) return true;
  if (/^(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d{2}$/.test(text)) return true;
  if (/^(?:19|20)\d{2}(?:\s*-\s*|\s+)(?:19|20)\d{2}$/.test(text)) return true;
  if (/^(?:19|20)\d{6}$/.test(text)) {
    const date = new Date(`${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6)}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10).replace(/-/g,'') === text;
  }
  return false;
}
export function createClientTextRedactor(contacts: Contacts[]) {
  const knownPhones = new Set<string>(), knownEmails = new Set<string>();
  for (const contact of contacts) {
    if (typeof contact.phone === 'string') {
      const number = digits(contact.phone);
      if (number.length >= 7 && number.length <= 20) {
        knownPhones.add(number);
        if (number.length === 8) knownPhones.add('852' + number);
        if (number.startsWith('852') && number.length === 11) knownPhones.add(number.slice(3));
        if (number.startsWith('00852') && number.length === 13) { knownPhones.add(number.slice(2)); knownPhones.add(number.slice(5)); }
      }
    }
    if (typeof contact.email === 'string' && contact.email.includes('@')) knownEmails.add(projection(contact.email).text.replace(/\s/g,'').toLowerCase());
  }
  const knownEmailPatterns = [...knownEmails].map(email => new RegExp(`(?<![A-Za-z0-9_.+%-])${Array.from(email, escape).join('[ \\t\\r\\n]*')}(?![A-Za-z0-9_.+%-])`, 'giu'));
  const knownPhonePattern = knownPhones.size ? new RegExp(`(?<![A-Za-z0-9_])(?:\\+)?\\(?(?:${[...knownPhones].sort((a,b)=>b.length-a.length).map(number=>Array.from(number).join('[ \\t\\r\\n().-]{0,4}')).join('|')})\\)?(?![A-Za-z0-9_])`, 'gu') : null;
  return (value: string) => {
    const { text, starts, ends } = projection(value), spans: Span[] = [];
    const add = (start: number, end: number, replacement: string) => {
      if (start < end) spans.push({ start: starts[start], end: ends[end - 1], replacement });
    };
    // Common emails, including whitespace around separators and full-width forms.
    const asciiEmail = /(?<![A-Za-z0-9_.+%-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+[ \t\r\n]*@[ \t\r\n]*(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?[ \t\r\n]*\.[ \t\r\n]*)+[A-Za-z]{2,63}(?![A-Za-z0-9_-])/gu;
    const unicodeEmail = /(?<![\p{L}\p{N}_.+%-])[A-Za-z0-9][\p{L}\p{N}\p{M}.!#$%&'*+/=?^_`{|}~-]*[ \t\r\n]*@[ \t\r\n]*(?:[\p{L}\p{N}\p{M}-]+[ \t\r\n]*\.[ \t\r\n]*)+[\p{L}\p{M}]{2,63}(?=$|[\s,;!?),，。；、？！）<>"'])/gu;
    for (const pattern of text.includes('@') ? [...knownEmailPatterns, asciiEmail, unicodeEmail] : []) for (const match of text.matchAll(pattern)) add(match.index, match.index + match[0].length, emailMarker);
    const classifyPhone = (match: RegExpMatchArray) => {
      const leading = match[0].length - match[0].trimStart().length, start = match.index! + leading, whole = match[0].slice(leading), base = whole.replace(/[ \t]*(?:ext\.?|extension|x|分機|內線)[ \t]*[:.]?[ \t]*\d{1,6}$/i,''), number = base.replace(/\D/g,''), before = text.slice(Math.max(0,start-40),start), after = text.slice(start+whole.length,start+whole.length+12);
      const labelled = /(?:電話|手機|手提|聯絡號碼|聯絡電話|分機|內線|tel(?:ephone)?\.?|phone|mobile|whatsapp|call)[ \t：:.-]*$/i.test(before);
      // Protect dates, currency, decimals and explicitly labelled reference IDs.
      // A nearby phone label takes precedence over ambiguous numeric prose.
      if (!labelled && (dateOrYearRange(base) || /^\d+\.\d{1,2}$/.test(base.trim()) || /(?:HK\$|HKD|USD|\$|薪金|薪酬|薪資|預算|budget|salary|pay)[ \t：:]*$/i.test(before) || /(?:證書|證照|牌照|訂單|證件|參考)(?:編號|號碼)?[ \t：:#]*$|(?:certificate|order|reference|ref|licen[sc]e|id|code)(?:[ \t]+(?:no\.?|number))?[ \t:#]*$/i.test(before) || /(?:證書|證照|牌照|訂單|參考|certificate|order|reference|licen[sc]e|id).{0,20}[A-Za-z0-9]+[-_]$/i.test(before) || /[\d.,]$/.test(before) || /^[.,]\d/.test(after))) return;
      const known = knownPhones.has(number) || number.startsWith('00') && knownPhones.has(number.slice(2));
      const international = /^\s*\+/.test(base) && number.length >= 8 && number.length <= 15 || /^\s*00/.test(base) && number.length >= 10 && number.length <= 17;
      const local = number.length === 8 && /^[2-9]/.test(number);
      const mainlandMobile = /^1[3-9]\d{9}$/.test(number);
      const grouped = number.length >= 10 && number.length <= 11 && /[ ().-]/.test(base.trim());
      if (known || international || local || mainlandMobile || grouped || labelled && number.length >= 7 && number.length <= 15) add(start,start+whole.length,phoneMarker);
    };
    // Horizontal separators only; don't greedily join two numbers on different
    // lines. Explicitly supported split-line formats are processed separately.
    const horizontal = /(?<![A-Za-z0-9_])(?:\+|00)?[ \t]*\(?\d(?:[ \t().-]*\d){6,19}\)?(?:[ \t]*(?:ext\.?|extension|x|分機|內線)[ \t]*[:.]?[ \t]*\d{1,6})?(?![A-Za-z0-9_])/giu;
    const splitLocal = /(?<![A-Za-z0-9_])\d{4}[ \t]*\r?\n[ \t]*\d{4}(?![A-Za-z0-9_])/gu;
    const splitCountry = /(?<![A-Za-z0-9_])\+\d{1,3}[ \t]*\r?\n[ \t]*\d(?:[ \t().-]*\d){6,11}(?![A-Za-z0-9_])/gu;
    const localEight = /(?<![A-Za-z0-9_])\(?\d(?:[ \t().-]*\d){7}\)?(?![A-Za-z0-9_])/gu;
    const mainland = /(?<![A-Za-z0-9_])1[3-9]\d{9}(?![A-Za-z0-9_])/gu;
    const groupedTen = /(?<![A-Za-z0-9_])\(?\d(?:[ \t().-]*\d){9,10}\)?(?![A-Za-z0-9_])/gu;
    for (const pattern of [knownPhonePattern,localEight,mainland,groupedTen,horizontal,splitLocal,splitCountry]) if (pattern) for (const match of text.matchAll(pattern)) classifyPhone(match);
    // Merge overlaps, then replace only original contact spans. All other text,
    // including its Unicode forms and line breaks, stays byte-for-byte intact.
    spans.sort((a,b)=>a.start-b.start || b.end-a.end);
    const merged: Span[] = [];
    for (const span of spans) {
      const previous=merged.at(-1);
      if (previous && span.start < previous.end) { previous.end=Math.max(previous.end,span.end); if(span.replacement===emailMarker)previous.replacement=emailMarker; }
      else merged.push({...span});
    }
    let output='',cursor=0;
    for(const span of merged){output+=value.slice(cursor,span.start)+span.replacement;cursor=span.end;}
    return output+value.slice(cursor);
  };
}
