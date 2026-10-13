"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight } from 'lucide-react';
import { allFields, isFieldVisible, kindLabel, parseWorkExperiences, sections, services, type Field, type IntakeData, type IntakeKind } from '@/lib/fields';
import { formatWorkExperience, type CandidatePublic, type WorkExperience } from '@/lib/platform-types';
import './workspace.css';

type Attempt = { key: string; fingerprint: string };
type PhotoAttachment = { id: string; token: string };
type Draft = { data: IntakeData; step: number; savedAt: string; reviewReached?: boolean; attempt?: Attempt; pending?: boolean; photo?: PhotoAttachment; candidateIds?: string[] };
type ApiResult = { reference?: string; error?: string; fields?: Record<string, string> };
const draftKey = (kind: IntakeKind) => `jiahe.intake.${kind}.v1`;
const attemptKey = (kind: IntakeKind) => `jiahe.attempt.${kind}.v1`;
const valueText = (value: IntakeData[string] | undefined) => Array.isArray(value) ? value.join('、') : typeof value === 'string' ? value : '';
function queryPrefill(kind: IntakeKind, search: string): IntakeData {
  const params = new URLSearchParams(search), initial: IntakeData = {};
  const service = params.get('service');
  if (service && services.includes(service)) initial.services = [service];
  if (kind === 'employer') for (const name of ['district', 'employmentType']) {
    const value = params.get(name), field = allFields(kind).find(item => item.name === name);
    if (value && field?.options?.includes(value)) initial[name] = value;
  }
  return initial;
}

const safeText = (text: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
const numericRules = (name: string) => ({ integer: ['householdAdults','homeSize','age','serviceDays'].includes(name), min: name === 'age' ? 18 : ['householdAdults','homeSize','serviceDays'].includes(name) ? 1 : .01, max: name === 'householdAdults' ? 30 : name === 'homeSize' ? 100000 : name === 'age' ? 100 : name === 'serviceDays' ? 365 : 1000000 });
const experienceKeys = ['country','from','to','household','duties','leavingReason'] as const;
const emptyExperience = (): WorkExperience => ({ country:'',from:'',to:'',household:'',duties:'',leavingReason:'' });
function safeExperienceRows(value: unknown): WorkExperience[] { return parseWorkExperiences(value).map(row => Object.fromEntries(experienceKeys.map(key => [key, typeof row?.[key] === 'string' ? row[key] : ''])) as WorkExperience); }
export function intakeFieldValue(field: Field, value: IntakeData[string] | undefined) {
  if (field.type === 'boolean') return field.name === 'publicProfileConsent' ? value === true ? '同意公開' : '不公開' : value === true ? '是' : '否';
  if (field.type === 'experience') return formatWorkExperience(safeExperienceRows(value)) || '未填寫';
  return valueText(value) || '未填寫';
}
function validateField(field: Field, value: IntakeData[string] | undefined) {
  if (field.type === 'boolean') return value !== undefined && typeof value !== 'boolean' ? `請選擇有效的${field.label}。` : '';
  if (field.type === 'experience') {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string' || value.length > (field.max || 18000)) return '工作經歷內容過長。';
    try {
      const rows: unknown = JSON.parse(value);
      if (!Array.isArray(rows) || rows.length > 8) return '最多填寫8份工作經歷。';
      for (const [index,row] of rows.entries()) {
        if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !(experienceKeys as readonly string[]).includes(key))) return '工作經歷格式不正確。';
        for (const key of experienceKeys) { const text = row[key] ?? ''; if (typeof text !== 'string' || !safeText(text) || text.length > (key === 'duties' ? 1500 : key === 'country' ? 80 : 600)) return `請檢查第${index+1}份工作經歷。`; }
        if (!String(row.country || '').trim() || !String(row.duties || '').trim()) return `第${index+1}份工作經歷須填寫地區及主要工作。`;
        if (['from','to'].some(key => row[key] && !/^\d{4}-(0[1-9]|1[0-2])$/.test(row[key]))) return `請檢查第${index+1}份工作的年月。`;
        if (row.from && row.to && row.from > row.to) return `第${index+1}份工作的結束月份不可早於開始月份。`;
      }
    } catch { return '請檢查工作經歷。'; }
    return '';
  }
  if (field.type === 'checkboxes') {
    if (value === undefined && !field.required) return '';
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !field.options?.includes(item)) || new Set(value).size !== value.length) return `請選擇有效的${field.label}。`;
    return field.required && value.length === 0 ? `請選擇${field.label}。` : '';
  }
  if (value === undefined && !field.required) return '';
  if (typeof value !== 'string') return `請填寫${field.label}。`;
  const text = value.trim().normalize('NFC'), max = field.max ?? (field.type === 'number' ? 20 : 200);
  if (!safeText(text) || text.length > max) return `${field.label}最多可填寫${max}個字。`;
  if (field.required && !text) return `請填寫${field.label}。`;
  if (!text) return '';
  if (field.type === 'select' && !field.options?.includes(text)) return `請選擇有效的${field.label}。`;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return '請填寫有效的電郵地址。';
  if (field.type === 'tel' && (!/^[+\d\s().-]+$/.test(text) || text.replace(/\D/g, '').length < 8 || text.replace(/\D/g, '').length > 20)) return '請填寫有效的聯絡電話（8至20位數字）。';
  if (field.type === 'number') { const number = Number(text), rule = numericRules(field.name); if (!/^\d+(\.\d{1,2})?$/.test(text) || !Number.isFinite(number) || number < rule.min || number > rule.max || (rule.integer && !Number.isInteger(number))) return `請填寫有效的${field.label}（${rule.min}至${rule.max}）。`; }
  if (field.type === 'date') { const date = new Date(`${text}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text || text < '2000-01-01' || text > '2100-12-31') return '請填寫有效日期。'; }
  return '';
}
export function validateIntakeFields(kind: IntakeKind, data: IntakeData, fields = allFields(kind), includeConsent = false) {
  const errors: Record<string,string> = {};
  fields.filter(field => isFieldVisible(field,data)).forEach(field => { const error = validateField(field,data[field.name]); if (error) errors[field.name] = error; });
  if (kind === 'jobseeker' && fields.some(field => field.name === 'workHistory') && !String(data.workHistory || '').trim() && safeExperienceRows(data.workExperienceJson).length === 0) errors.workHistory = '請填寫工作經歷或補充經驗；首次求職可填寫「首次求職」。';
  if (includeConsent && data.consent !== true) errors.consent = '請確認資料使用安排';
  return errors;
}
export function IntakeDataFields({ fields, data, errors = {}, disabled = false, onChange, idPrefix = '', restrictPublicConsent = false }: { fields: Field[]; data: IntakeData; errors?: Record<string,string>; disabled?: boolean; onChange: (name: string,value: IntakeData[string])=>void; idPrefix?: string; restrictPublicConsent?: boolean }) {
  return <div className="field-grid">{fields.filter(field => isFieldVisible(field,data)).map(field => {
    const id = `${idPrefix}field-${field.name}`, error = errors[field.name], rows = field.type === 'experience' ? safeExperienceRows(data[field.name]) : [];
    const hint = field.hint;
    const description = `${hint ? `${id}-hint ` : ''}${error ? `${id}-error` : ''}`.trim() || undefined;
    const shared = { id, name: field.name, 'aria-invalid': Boolean(error), 'aria-required': Boolean(field.required), 'aria-describedby': description, disabled };
    const optional = (field.type === 'experience' || field.name === 'workHistory') && fields.some(item=>item.name==='workHistory') ? '至少填寫一項' : field.required ? '必填' : '選填';
    const updateRow = (index: number,key: keyof WorkExperience,value: string) => onChange(field.name,JSON.stringify(rows.map((row,i)=>i===index ? { ...row,[key]:value } : row)));
    return <div className={`intake-field ${['textarea','checkboxes','experience','boolean'].includes(field.type || '') ? 'field-wide' : ''}`} key={field.name}>
      {field.type === 'boolean' ? <><label className="boolean-label"><input {...shared} type="checkbox" checked={data[field.name]===true} disabled={disabled || (restrictPublicConsent && field.name==='publicProfileConsent' && data[field.name]!==true)} onChange={event=>onChange(field.name,event.target.checked)}/><span>{field.label}<span className="field-optional">選填</span></span></label>{hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}{restrictPublicConsent && field.name==='publicProfileConsent' && data[field.name]!==true && <p className="field-hint">公開同意須由求職者本人提供，後台只可撤回同意。</p>}</> : field.type === 'experience' ? <fieldset id={id} tabIndex={-1} aria-describedby={description}>
        <legend>{field.label}<span className="field-optional">{optional}</span></legend>{hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
        {rows.map((row,index)=><fieldset className="experience-entry" key={index}><legend>工作經歷 {index+1}</legend><button type="button" className="text-action experience-remove" disabled={disabled} onClick={()=>onChange(field.name,JSON.stringify(rows.filter((_,i)=>i!==index)))}>移除此工作</button><div className="experience-fields">{experienceKeys.map(key=><label key={key} className={['household','duties','leavingReason'].includes(key) ? 'field-wide' : ''} htmlFor={`${id}-${index}-${key}`}>{({country:'工作地區',from:'開始年月',to:'結束年月（仍在職可留空）',household:'家庭情況',duties:'主要工作',leavingReason:'離職原因'} as Record<string,string>)[key]}<span className="field-optional">{['country','duties'].includes(key) ? '必填' : '選填'}</span>{['household','duties','leavingReason'].includes(key) ? <textarea id={`${id}-${index}-${key}`} rows={2} disabled={disabled} maxLength={key==='duties'?1500:600} value={row[key]} onChange={event=>updateRow(index,key,event.target.value)}/> : <input id={`${id}-${index}-${key}`} type={key==='from'||key==='to'?'month':'text'} disabled={disabled} maxLength={key==='country'?80:600} value={row[key]} onChange={event=>updateRow(index,key,event.target.value)}/>}</label>)}</div></fieldset>)}
        <button type="button" className="work-button secondary" disabled={disabled || rows.length>=8} onClick={()=>onChange(field.name,JSON.stringify([...rows,emptyExperience()]))}>新增工作經歷</button><p className="field-hint experience-count">最多8份，目前 {rows.length} 份。</p>
      </fieldset> : field.type === 'checkboxes' ? <fieldset aria-describedby={description}><legend>{field.label}<span className="field-optional">{optional}</span></legend>{hint&&<p id={`${id}-hint`} className="field-hint">{hint}</p>}<div className={`choice-grid ${field.name==='workLocations'?'choice-grid-districts':''}`}>{field.options?.map((option,index)=><label className="choice-label" key={option}><input type="checkbox" id={index===0?id:`${id}-${index}`} name={field.name} value={option} disabled={disabled} checked={Array.isArray(data[field.name])&&(data[field.name] as string[]).includes(option)} aria-invalid={Boolean(error)} onChange={event=>{const current=Array.isArray(data[field.name])?data[field.name] as string[]:[];onChange(field.name,event.target.checked?[...current,option]:current.filter(item=>item!==option));}}/><span>{option}</span></label>)}</div></fieldset> : <><label htmlFor={id}>{field.label}<span className="field-optional">{optional}</span></label>{hint&&<p id={`${id}-hint`} className="field-hint">{hint}</p>}{field.type==='select'?<select {...shared} value={valueText(data[field.name])} onChange={event=>onChange(field.name,event.target.value)}><option value="">請選擇</option>{field.options?.map(option=><option key={option}>{option}</option>)}</select>:field.type==='textarea'?<textarea {...shared} rows={field.name==='workHistory'?4:3} maxLength={field.max??200} value={valueText(data[field.name])} onChange={event=>onChange(field.name,event.target.value)}/>:<input {...shared} type={field.type||'text'} autoComplete={field.name==='fullName'?'name':field.name==='phone'?'tel':field.name==='email'?'email':'off'} inputMode={field.type==='number'?'decimal':field.type==='tel'?'tel':undefined} min={field.type==='date'?'2000-01-01':field.type==='number'?numericRules(field.name).min:undefined} max={field.type==='date'?'2100-12-31':field.type==='number'?numericRules(field.name).max:undefined} step={field.type==='number'?numericRules(field.name).integer?1:.01:undefined} maxLength={field.max??(field.type==='number'?20:200)} value={valueText(data[field.name])} onChange={event=>onChange(field.name,event.target.value)}/>}</>}
      {error&&<p id={`${id}-error`} className="field-error">{error}</p>}
    </div>;
  })}</div>;
}

const queryCandidateIds = (search: string) => [...new Set((new URLSearchParams(search).get('candidates') || '').split(',').map(id=>id.trim().toLowerCase()).filter(id=>/^[a-f\d-]{36}$/.test(id)))];
async function resizePhoto(file: File): Promise<Blob> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8*1024*1024) throw new Error('請選擇8MB以內的 JPG、PNG 或 WebP 照片。');
  const sourceUrl = URL.createObjectURL(file), picture = new Image();
  try {
    picture.src = sourceUrl; await picture.decode();
    if (!picture.naturalWidth || !picture.naturalHeight) throw new Error('未能讀取照片。');
    const ratio = Math.min(1,800/Math.max(picture.naturalWidth,picture.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(picture.naturalWidth*ratio)); canvas.height = Math.max(1,Math.round(picture.naturalHeight*ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('此瀏覽器未能處理照片，請更換瀏覽器後重試。');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(picture,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('未能處理照片，請重試。')),'image/jpeg',.85));
  } finally { URL.revokeObjectURL(sourceUrl); }
}

export default function IntakeForm({ kind }: { kind: IntakeKind }) {
  const formSections = sections[kind];
  const progressLabels = kind === 'jobseeker' ? ['基本資料', '經驗技能', '工作期望', '確認提交'] : ['聯絡資料', '服務需要', '工作安排', '確認提交'];
  const sectionDescriptions = kind === 'jobseeker' ? ['填寫個人資料及聯絡方法。', '選擇服務種類，填寫技能及工作經驗。', '填寫工作地區、開始日期及期望薪金。'] : ['填寫聯絡方法、服務地區及家庭人數。', '選擇服務種類、工作職責及溝通語言。', '填寫開始日期、工作時間及薪金預算。'];
  const [data, setData] = useState<IntakeData>({});
  const [step, setStep] = useState(0);
  const [reviewReached, setReviewReached] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [saveDraft, setSaveDraft] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [pendingSubmission, setPendingSubmission] = useState(false);
  const [reference, setReference] = useState('');
  const [photo,setPhoto] = useState<PhotoAttachment|null>(null), [photoPreview,setPhotoPreview] = useState(''), [photoUploading,setPhotoUploading] = useState(false), [photoError,setPhotoError] = useState('');
  const [candidateIds,setCandidateIds] = useState<string[]>([]), [candidates,setCandidates] = useState<CandidatePublic[]>([]), [candidateLoading,setCandidateLoading] = useState(false), [candidateError,setCandidateError] = useState(''), [candidateReload,setCandidateReload] = useState(0);
  const photoPreviewRef = useRef(''), photoAbortRef = useRef<AbortController|null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const locked = submitting || pendingSubmission || Boolean(pendingDraft?.pending);

  useEffect(() => {
    setData(queryPrefill(kind, window.location.search));
    if (kind==='employer') setCandidateIds(queryCandidateIds(window.location.search));
    try {
      const raw = localStorage.getItem(draftKey(kind));
      if (!raw) return;
      const parsed = JSON.parse(raw) as Draft;
      if (parsed && typeof parsed.data === 'object' && parsed.data !== null && typeof parsed.step === 'number') setPendingDraft(parsed);
    } catch { /* The form remains usable when browser storage is unavailable. */ }
  }, [kind]);

  useEffect(() => {
    if (!saveDraft || reference) return;
    try {
      localStorage.setItem(draftKey(kind), JSON.stringify({ data, step, reviewReached, savedAt: new Date().toISOString(), ...(attemptRef.current ? { attempt: attemptRef.current } : {}), pending: pendingSubmission, ...(photo ? { photo } : {}), candidateIds }));
      setDraftNote('草稿已儲存在此瀏覽器');
    } catch { setDraftNote('此瀏覽器無法儲存草稿，請完成後提交。'); }
  }, [data, step, reviewReached, kind, saveDraft, reference, pendingSubmission, photo, candidateIds]);

  useEffect(() => {
    if (kind !== 'employer' || candidateIds.length===0) { setCandidates([]);setCandidateLoading(false);setCandidateError('');return; }
    if (candidateIds.length>3) { setCandidates([]);setCandidateLoading(false);setCandidateError('最多選擇3位人選，請移除多餘人選。');return; }
    const controller=new AbortController();setCandidateLoading(true);setCandidateError('');
    const params=new URLSearchParams({ids:candidateIds.join(',')});
    fetch(`/api/candidates?${params}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok) throw new Error('未能讀取已選人選，請重試。');return response.json() as Promise<{candidates:CandidatePublic[]}>;}).then(result=>{if(!controller.signal.aborted){setCandidates(result.candidates);if(candidateIds.some(id=>!result.candidates.some(person=>person.id===id)))setCandidateError('部分人選目前未能選擇，請移除或重新選擇。');}}).catch(caught=>{if(!controller.signal.aborted){setCandidates([]);setCandidateError(caught instanceof Error?caught.message:'未能讀取人選。');}}).finally(()=>{if(!controller.signal.aborted)setCandidateLoading(false);});
    return ()=>controller.abort();
  },[kind,candidateIds,candidateReload]);
  useEffect(()=>()=>{photoAbortRef.current?.abort();if(photoPreviewRef.current)URL.revokeObjectURL(photoPreviewRef.current);},[]);
  const replacePhotoPreview=(url:string)=>{if(photoPreviewRef.current)URL.revokeObjectURL(photoPreviewRef.current);photoPreviewRef.current=url;setPhotoPreview(url);};
  const clearPhoto=()=>{setPhoto(null);replacePhotoPreview('');setPhotoError('');setErrors(current=>{const next={...current};delete next.photo;return next;});};
  const uploadPhoto=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file||locked||photoUploading)return;
    const controller=new AbortController();photoAbortRef.current?.abort();photoAbortRef.current=controller;setPhotoUploading(true);setPhotoError('');
    try {const blob=await resizePhoto(file);if(controller.signal.aborted)return;const response=await fetch('/api/intake-photo',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob,signal:controller.signal});const body=await response.json().catch(()=>({})) as Partial<PhotoAttachment>&{error?:string};if(!response.ok||!body.id||!body.token)throw new Error(body.error||'照片上載未完成，請重試。');setPhoto({id:body.id,token:body.token});replacePhotoPreview(URL.createObjectURL(blob));setErrors(current=>{const next={...current};delete next.photo;return next;});}
    catch(caught){if(!controller.signal.aborted)setPhotoError(caught instanceof Error?caught.message:'未能上載照片，請重試。');}
    finally{if(!controller.signal.aborted)setPhotoUploading(false);}
  };

  const change = (name: string, value: IntakeData[string]) => {
    if (pendingSubmission || submitting || pendingDraft?.pending) return;
    setData(current => ({ ...current, [name]: value }));
    setErrors(current => { const next = { ...current }; delete next[name]; allFields(kind).forEach(field=>{if(!isFieldVisible(field,{...data,[name]:value}))delete next[field.name];}); if(name==='workHistory'||name==='workExperienceJson'){delete next.workHistory;delete next.workExperienceJson;} return next; });
    setSubmitError('');
  };

  const goTo = (nextStep: number, fieldName?: string) => {
    if (nextStep === formSections.length) setReviewReached(true);
    setStep(nextStep);
    setSubmitError('');
    requestAnimationFrame(() => {
      const target = fieldName ? document.getElementById(`field-${fieldName}`) : titleRef.current;
      target?.focus();
      titleRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
  };

  const validate = (fields: Field[], includeConsent = false) => {
    const next = validateIntakeFields(kind,data,fields,includeConsent);
    if(includeConsent&&kind==='employer'&&candidateIds.length&&(candidateIds.length>3||candidateLoading||candidateIds.some(id=>!candidates.some(person=>person.id===id))))next.candidateIds='請移除未能選擇的人選，或重新讀取後再提交。';
    if(includeConsent&&photoUploading)next.photo='請等候照片上載完成。';
    setErrors(next);
    if (Object.keys(next).length) requestAnimationFrame(() => errorRef.current?.focus());
    return Object.keys(next).length === 0;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || pendingDraft?.pending || photoUploading) return;
    if (step < formSections.length) {
      if (validate(formSections[step].fields)) goTo(reviewReached ? formSections.length : step + 1);
      return;
    }
    // An uncertain attempt must reach the receipt lookup with its original key.
    if (!pendingSubmission && !validate(allFields(kind), true)) return;
    busyRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    let requestStarted = false, confirmedFailure = false;
    try {
      const envelope={kind,data,...(photo?{photo:{id:photo.id,token:photo.token}}:{}),...(candidateIds.length?{candidateIds}: {})};
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(envelope)));
      const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      if (attemptRef.current?.fingerprint !== fingerprint && !(pendingSubmission&&attemptRef.current)) {
        let saved: Attempt | null = null;
        try { saved = JSON.parse(sessionStorage.getItem(attemptKey(kind)) || 'null') as Attempt | null; } catch { /* Memory fallback. */ }
        attemptRef.current = saved?.fingerprint === fingerprint && /^[A-Za-z0-9_-]{16,100}$/.test(saved.key) ? saved : { key: crypto.randomUUID(), fingerprint };
      }
      try { sessionStorage.setItem(attemptKey(kind), JSON.stringify(attemptRef.current)); } catch { /* Memory fallback. */ }
      // Save the original attempt before sending it: the response may never
      // reach this tab even after the server has accepted the registration.
      if (saveDraft) {
        try {
          localStorage.setItem(draftKey(kind), JSON.stringify({
            data, step: formSections.length, reviewReached: true,
            savedAt: new Date().toISOString(), attempt: attemptRef.current,
            pending: true, ...(photo ? { photo } : {}), candidateIds,
          }));
          setDraftNote('草稿已儲存在此瀏覽器');
        } catch { setDraftNote('此瀏覽器無法儲存草稿，請留在此頁確認提交結果。'); }
      }
      setPendingSubmission(true);
      requestStarted = true;
      const response = await fetch('/api/intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...envelope, idempotencyKey: attemptRef.current!.key, website: websiteRef.current?.value ?? '' }),
      });
      const result = await response.json().catch(() => ({})) as ApiResult;
      if (!response.ok || !result.reference) {
        confirmedFailure = response.status >= 400 && response.status < 500 && ![408,425].includes(response.status);
        if (result.fields) setErrors(result.fields);
        throw new Error(result.error || '未能確認提交結果。資料仍在此頁，請重試。');
      }
      setReference(result.reference);
      try { localStorage.removeItem(draftKey(kind)); } catch { /* Optional storage. */ }
      try { sessionStorage.removeItem(attemptKey(kind)); } catch { /* Optional storage. */ }
      attemptRef.current = null; setPendingSubmission(false);
      setSaveDraft(false);clearPhoto();setCandidateIds([]);
      requestAnimationFrame(() => titleRef.current?.focus());
    } catch (error) {
      if (requestStarted) setPendingSubmission(!confirmedFailure);
      setSubmitError(error instanceof Error ? error.message : '暫時無法提交，請重試。');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { busyRef.current = false; setSubmitting(false); }
  };


  const selectedCandidatesPanel=kind==='employer'&&candidateIds.length>0?<section className="selected-candidates" id="field-candidateIds" tabIndex={-1} aria-labelledby="selected-candidates-title"><h3 id="selected-candidates-title">已選人選（{candidateIds.length}／3）</h3>{candidateLoading&&<p role="status">正在讀取人選資料…</p>}{candidateIds.map((id,index)=>{const person=candidates.find(candidate=>candidate.id===id);return <div className="selected-candidate-row" key={id}><div><strong>{person?.displayName||`人選${index+1}`}</strong><p>{person?`${person.reference} · ${person.services.join('、')}`:'此人選目前未能選擇'}</p>{person&&<a href={`/candidates/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">查看簡介</a>}</div><button type="button" className="text-action" disabled={locked} onClick={()=>{setCandidateIds(current=>current.filter(value=>value!==id));setErrors(current=>{const next={...current};delete next.candidateIds;return next;});}}>移除<span className="sr-only">{person?.displayName||`人選${index+1}`}</span></button></div>;})}{(candidateError||errors.candidateIds)&&<p className="field-error">{errors.candidateIds||candidateError}</p>}{candidateError&&candidateIds.length<=3&&<button type="button" className="work-button secondary" disabled={candidateLoading||locked} onClick={()=>setCandidateReload(current=>current+1)}>重新讀取人選</button>}</section>:null;
  const photoPicker=kind==='jobseeker'&&step===0?<section className="intake-photo"><h3>個人照片<span className="field-optional">選填</span></h3><p className="field-hint">JPG、PNG 或 WebP，最多8MB。照片會隨登記交到後台；同意公開簡介並經審核發佈後，亦會顯示照片。</p>{photo&&<div className="photo-selected">{photoPreview?<img src={photoPreview} alt="已選照片預覽"/>:<span>已有待提交照片。暫存到期可重新上載。</span>}<button type="button" className="text-action" disabled={locked||photoUploading} onClick={clearPhoto}>移除照片</button></div>}<label htmlFor="field-photo">{photo?'更換照片':'選擇照片'}</label><input id="field-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={locked||photoUploading} aria-describedby="photo-storage-note" aria-invalid={Boolean(photoError||errors.photo)} onChange={event=>void uploadPhoto(event)}/>{photoUploading&&<p role="status">正在處理及上載照片…</p>}{(photoError||errors.photo)&&<p className="field-error" role="alert">{photoError||errors.photo}</p>}<p id="photo-storage-note" className="field-hint">未提交照片最多暫存24小時。勾選儲存草稿時，會保留待提交照片；不會把照片原檔另存到瀏覽器。</p></section>:null;

  if (reference) return <main id="main-content" className="site-width intake-success">
    <div className="success-mark"><CheckCircle2 size={34} strokeWidth={1.5} aria-hidden="true" /></div>
    <p className="workspace-eyebrow">{kindLabel(kind)}登記</p>
    <h1 tabIndex={-1} ref={titleRef}>登記已提交</h1>
    <p>我們會透過你提供的電話或電郵聯絡。</p>
    <div className="reference-slip"><span>登記編號</span><strong>{reference}</strong><p>請保留此編號，方便日後查詢。</p></div>
    <a href="/" className="work-button primary">返回首頁<ArrowRight size={17} aria-hidden="true" /></a>
  </main>;

  const activeSection = formSections[step];
  return <main id="main-content" className="site-width intake-page">
    <div className="workspace-breadcrumb"><a href="/">首頁</a><ChevronRight size={14} aria-hidden="true"/><span>{kindLabel(kind)}登記</span></div>
    <div className="intake-intro"><p className="workspace-eyebrow">{kind === 'jobseeker' ? '求職資料' : '服務需求資料'}</p><h1>{kindLabel(kind)}登記</h1><p>{kind === 'jobseeker' ? '填寫聯絡資料、工作經驗及求職要求。' : '填寫聯絡資料、服務需要及工作安排。'}</p></div>
    <noscript><style>{'.intake-panel .form-actions{display:none}'}</style><p className="form-message">請開啟瀏覽器的 JavaScript 以完成登記及提交資料。</p></noscript>
    {pendingDraft && <div className="draft-banner"><div><strong>{pendingDraft.pending ? '有一份登記的提交結果尚未確認' : '此瀏覽器有一份未完成的登記'}</strong><p>{pendingDraft.pending ? '請繼續草稿，重試以確認上次的提交結果。' : '可繼續填寫，或開始一份新登記。'}</p></div><div className="draft-actions"><button type="button" className="work-button secondary" disabled={Boolean(pendingDraft.pending)} onClick={() => { try { localStorage.removeItem(draftKey(kind)); } catch {} setData(queryPrefill(kind, window.location.search));clearPhoto();setCandidateIds(kind==='employer'?queryCandidateIds(window.location.search):[]); setStep(0); setReviewReached(false); setErrors({}); setPendingDraft(null); }}>重新開始</button><button type="button" className="work-button primary" onClick={() => { setData(pendingDraft.data); setPhoto(kind==='jobseeker'?pendingDraft.photo||null:null);replacePhotoPreview('');setCandidateIds(kind==='employer'?pendingDraft.candidateIds||[]:[]); goTo(pendingDraft.pending ? formSections.length : Math.min(Math.max(pendingDraft.step, 0), formSections.length)); setReviewReached(pendingDraft.reviewReached === true || pendingDraft.step >= formSections.length || Boolean(pendingDraft.pending)); attemptRef.current = pendingDraft.attempt || null; setPendingSubmission(Boolean(pendingDraft.pending)); setSaveDraft(true); setPendingDraft(null); }}>繼續草稿<ArrowRight size={16} aria-hidden="true"/></button></div></div>}
    <div className="intake-layout">
      <aside className="intake-side" aria-label="填寫進度"><ol className="form-progress">
        {progressLabels.map((title, index) => <li key={title} className={step === index ? 'current' : step > index ? 'finished' : ''} aria-current={step === index ? 'step' : undefined}>
          <span className="step-number">{step > index ? <Check size={15} aria-hidden="true"/> : `0${index + 1}`}</span>{index < step ? <button type="button" disabled={locked} onClick={() => goTo(index)}>{title}</button> : <span>{title}</span>}
        </li>)}
      </ol><div className="intake-side-note"><p>提交前可檢查及修改資料。</p><span>「選填」欄位可留空。</span></div></aside>
      <form className="intake-panel" method="post" action="/api/intake" noValidate onSubmit={submit}>
        <div className="form-section-heading"><span>第 {step + 1} 步，共 4 步</span><h2 ref={titleRef} tabIndex={-1}>{activeSection?.title || '確認資料'}</h2><p>{sectionDescriptions[step] || '檢查資料後提交。如需修改，按對應欄位的「修改」。'}</p></div>
        {(Object.keys(errors).length > 0 || submitError) && <div className="error-summary" ref={errorRef} tabIndex={-1} role="alert"><strong>{submitError || '請先完成以下資料'}</strong>{pendingSubmission && <p>提交結果尚未確認。請重試以確認結果，避免重複登記。</p>}{Object.keys(errors).length > 0 && <ul>{Object.entries(errors).map(([name, message]) => <li key={name}><a href={`#field-${name}`} onClick={event => { event.preventDefault(); const index = name==='photo'||name==='candidateIds'?0:formSections.findIndex(section => section.fields.some(field => field.name === name)); if (index >= 0 && step !== index) { setStep(index); requestAnimationFrame(() => document.getElementById(`field-${name}`)?.focus()); } else document.getElementById(`field-${name}`)?.focus(); }}>{message}</a></li>)}</ul>}</div>}
        {selectedCandidatesPanel}
        {pendingSubmission && !submitError && <p className="form-message" role="status">上次的提交結果尚未確認。請按「重試確認」，我們會確認同一份登記的結果。</p>}{activeSection ? <><IntakeDataFields fields={activeSection.fields} data={data} errors={errors} disabled={locked} onChange={change}/>{photoPicker}</> : <>
          <div className="review-sections">{formSections.map((section, index) => <section key={section.title}><div className="review-heading"><h3>{section.title}</h3><button type="button" className="text-action" disabled={locked} onClick={() => goTo(index)}>修改<span className="sr-only">{section.title}</span></button></div><dl>{section.fields.filter(field=>isFieldVisible(field,data)).map(field => <div key={field.name}><dt>{field.label}</dt><dd>{intakeFieldValue(field,data[field.name])}</dd></div>)}</dl></section>)}</div>
          {kind==='jobseeker'&&photo&&<div className="photo-review">{photoPreview&&<img src={photoPreview} alt="已選照片預覽"/>}<span>已附個人照片</span><button type="button" className="text-action" disabled={locked} onClick={()=>goTo(0)}>修改照片</button></div>}
          <label className={`consent-label ${errors.consent ? 'consent-error' : ''}`}><input id="field-consent" type="checkbox" checked={data.consent === true} disabled={locked} onChange={event => change('consent', event.target.checked)} aria-invalid={Boolean(errors.consent)}/><span>我同意家合僱傭使用以上資料聯絡及安排配對，並向相關僱主或求職者提供配對所需資料。</span></label>{errors.consent && <p className="field-error">{errors.consent}</p>}
        </>}
        <div className="honeypot" aria-hidden="true"><label htmlFor="intake-website">網站</label><input ref={websiteRef} id="intake-website" name="website" autoComplete="off" tabIndex={-1}/></div>
        <div className="form-actions"><button type="button" className="work-button secondary" disabled={step === 0 || locked} onClick={() => goTo(step - 1)}><ArrowLeft size={16} aria-hidden="true"/>上一步</button><button type="submit" className="work-button primary" disabled={submitting || photoUploading || Boolean(pendingDraft?.pending)}>{submitting ? '正在提交…' : step === formSections.length ? pendingSubmission ? '重試確認' : submitError ? '重試提交' : '確認並提交' : reviewReached ? '返回確認資料' : '下一步'}{!submitting && <ArrowRight size={16} aria-hidden="true"/>}</button></div>
        <div className="draft-control"><label><input type="checkbox" checked={saveDraft} disabled={locked} onChange={event => { setSaveDraft(event.target.checked); if (!event.target.checked) { try { localStorage.removeItem(draftKey(kind)); } catch {} setDraftNote(''); } }}/><span>在此瀏覽器儲存草稿</span></label><p aria-live="polite">{pendingSubmission && saveDraft ? '提交結果尚未確認，草稿會保留至確認完成。' : draftNote || '共用裝置請勿勾選。提交成功後會移除草稿及待提交照片資料。'}</p></div>
      </form>
    </div>
  </main>;
}
