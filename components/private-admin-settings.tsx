'use client';
import { useEffect,useState } from 'react';
import { PrivateAdminShell, adminRequest, AdminApiError } from './private-admin-shell';
import { services } from '@/lib/fields';
import type { SiteInfo } from '@/lib/platform-types';
import './private-settings.css';
type Fee=SiteInfo['fees'][number];
const empty:SiteInfo={phone:'',whatsapp:'',email:'',address:'',hours:'',fees:[],updatedAt:''};
function SettingsEditor(){
 const [info,setInfo]=useState<SiteInfo>(empty),[original,setOriginal]=useState<SiteInfo|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[latest,setLatest]=useState<SiteInfo|null>(null);
 const dirty=original!==null&&JSON.stringify(info)!==JSON.stringify(original);
 async function load(){setLoading(true);setError('');try{const result=await adminRequest<SiteInfo>('/api/admin/settings');setInfo(result);setOriginal(result);setLatest(null);}catch(e){setError(e instanceof Error?e.message:'未能載入設定。');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 const change=(key:keyof SiteInfo,value:string)=>{setInfo(v=>({...v,[key]:value}));setMessage('');setError('');};
 const feeChange=(index:number,key:keyof Fee,value:string)=>{setInfo(v=>({...v,fees:v.fees.map((fee,i)=>i===index?{...fee,[key]:value}:fee)}));setMessage('');setError('');};
 async function save(){setSaving(true);setError('');setMessage('');try{const saved=await adminRequest<SiteInfo>('/api/admin/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({...info,expectedUpdatedAt:latest?.updatedAt??info.updatedAt})});setInfo(saved);setOriginal(saved);setLatest(null);setMessage('設定已儲存，公開頁面已更新。');}catch(e){if(e instanceof AdminApiError&&e.status===409){setError('設定已有其他更新。你的修改仍保留，請核對最新內容。');try{setLatest(await adminRequest<SiteInfo>('/api/admin/settings'));}catch{setError('設定已有其他更新；未能讀取最新內容，請稍後再試。');}}else setError(e instanceof Error?e.message:'未能儲存設定。');}finally{setSaving(false);}}
 if(loading)return <p role="status" className="private-message">正在載入設定…</p>;
 if(!original)return <div className="private-message error" role="alert">{error}<br/><button type="button" className="work-button secondary" onClick={()=>void load()}>重新載入</button></div>;
 return <form onSubmit={e=>{e.preventDefault();void save();}} className="settings-editor">
  <section className="private-editor"><h2>公開聯絡資料</h2><p>未填寫的項目會顯示「待補充」。</p><div className="private-fields settings-contact-fields">{([['phone','電話','tel',30],['whatsapp','WhatsApp','tel',30],['email','電郵','email',160],['hours','辦公時間','text',300]] as const).map(([key,label,type,max])=><label key={key}>{label}<input type={type} value={info[key]} maxLength={max} placeholder={key==='whatsapp'?'包括國家／地區號碼，例如 +852…':undefined} onChange={e=>change(key,e.target.value)} disabled={saving}/></label>)}<label className="private-wide">辦公地址<textarea value={info.address} maxLength={500} rows={3} onChange={e=>change('address',e.target.value)} disabled={saving}/></label></div></section>
  <datalist id="settings-service-options">{services.map(s=><option key={s} value={s}/>)}</datalist><section className="private-editor"><div className="settings-section-title"><div><h2>服務收費</h2><p>只填寫已確定的價目及包含項目。</p></div><button type="button" className="work-button secondary" disabled={saving||info.fees.length>=20} onClick={()=>{setInfo(v=>({...v,fees:[...v.fees,{service:'家傭',amount:'',unit:'',notes:''}]}));setMessage('');}}>新增價目</button></div>
  {!info.fees.length&&<p className="private-empty">未設定價目。公開收費頁會顯示「價目待補充」。</p>}
  {info.fees.map((fee,i)=><fieldset className="settings-fee" key={i}><legend>價目 {i+1}</legend><div className="private-fields"><label>服務項目<input list="settings-service-options" value={fee.service} maxLength={80} onChange={e=>feeChange(i,'service',e.target.value)} disabled={saving}/></label><label>收費顯示<input value={fee.amount} maxLength={80} onChange={e=>feeChange(i,'amount',e.target.value)} placeholder="例如 HK$… 起" disabled={saving}/></label><label>計算方式<input value={fee.unit} maxLength={80} onChange={e=>feeChange(i,'unit',e.target.value)} placeholder="每月／每日／每次" disabled={saving}/></label><label className="private-wide">包含項目及說明<textarea value={fee.notes} maxLength={1000} rows={3} onChange={e=>feeChange(i,'notes',e.target.value)} disabled={saving}/></label></div><button type="button" className="settings-remove" disabled={saving} onClick={()=>{setInfo(v=>({...v,fees:v.fees.filter((_,j)=>j!==i)}));setMessage('');}}>移除此價目</button></fieldset>)}
  </section>
  {message&&<p role="status" className="private-message">{message}</p>}{error&&<p role="alert" className="private-message error">{error}</p>}
  {latest&&<section className="private-comparison"><h2>目前公開設定</h2><dl>{(['phone','whatsapp','email','address','hours'] as const).map((key,i)=><div key={key}><dt>{['電話','WhatsApp','電郵','地址','辦公時間'][i]}</dt><dd>{latest[key]||'未填寫'}</dd></div>)}<div><dt>服務收費</dt><dd>{latest.fees.length?latest.fees.map(f=>[f.service,f.amount,f.unit,f.notes].filter(Boolean).join(' · ')).join('\n'):'未設定價目'}</dd></div></dl><div className="private-actions"><button type="button" className="work-button secondary" onClick={()=>{setInfo(latest);setOriginal(latest);setLatest(null);setError('');}}>採用最新設定</button></div></section>}
  <div className="private-actions"><span>{dirty?'有未儲存的修改':'設定已儲存'}</span><a href="/contact" target="_blank" rel="noreferrer" className="text-link">查看聯絡頁</a><a href="/fees" target="_blank" rel="noreferrer" className="text-link">查看收費頁</a><button className="work-button primary" type="submit" disabled={saving||!dirty}>{saving?'正在儲存…':latest?'以我的修改更新最新設定':'儲存設定'}</button></div>
 </form>;
}
export default function PrivateAdminSettings(){return <PrivateAdminShell active="/admin/settings" title="聯絡與收費設定" description="設定公開聯絡方法及服務收費。"><SettingsEditor/></PrivateAdminShell>;}
