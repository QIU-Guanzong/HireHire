"use client";
import { useEffect, useState } from 'react';
import { kindLabel, type IntakeKind, type IntakeRecord } from '@/lib/fields';
import { adminRequest } from './private-admin-shell';

export function PrivateRecordPicker({ kind, value, onChange, label, disabled = false }: { kind: IntakeKind; value: string; onChange: (record: IntakeRecord | null) => void; label: string; disabled?: boolean }) {
  const [query,setQuery]=useState(''),[applied,setApplied]=useState(''),[page,setPage]=useState(1),[records,setRecords]=useState<IntakeRecord[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [chosen,setChosen]=useState<IntakeRecord|null>(null);
  useEffect(()=>{const timer=setTimeout(()=>{setApplied(query.trim());setPage(1);},250);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const params=new URLSearchParams({kind,q:applied,page:String(page)});
    adminRequest<{records:IntakeRecord[];total:number}>(`/api/admin/records?${params}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setRecords(result.records);setTotal(result.total);}}).catch(caught=>{if(!controller.signal.aborted)setError(caught instanceof Error?caught.message:'未能讀取登記資料。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[kind,applied,page,refresh]);
  useEffect(()=>{if(!value){setChosen(null);return;}const found=records.find(record=>record.id===value);if(found){setChosen(found);return;}if(chosen?.id===value)return;const controller=new AbortController();adminRequest<IntakeRecord>(`/api/admin/records/${encodeURIComponent(value)}`,{signal:controller.signal}).then(record=>{if(!controller.signal.aborted&&record.kind===kind)setChosen(record);}).catch(()=>{});return()=>controller.abort();},[value,records,kind,chosen?.id]);
  const id=`private-picker-${kind}-${label.replace(/\s/g,'')}`, pages=Math.max(1,Math.ceil(total/20));
  return <fieldset className="private-record-picker"><legend>{label}</legend><label htmlFor={`${id}-q`} className="field-hint">搜尋姓名、電話或登記編號</label><input id={`${id}-q`} type="search" maxLength={160} value={query} disabled={disabled} onChange={event=>setQuery(event.target.value)}/><label className="sr-only" htmlFor={id}>{label}</label><select id={id} value={value} disabled={disabled||loading||Boolean(error)} onChange={event=>{const record=records.find(item=>item.id===event.target.value)||chosen;setChosen(event.target.value?record:null);onChange(event.target.value?record:null);}}><option value="">請選擇{kindLabel(kind)}</option>{chosen&&chosen.id===value&&!records.some(record=>record.id===value)&&<option value={chosen.id}>{String(chosen.data.fullName||'')} · {chosen.reference}（目前已選）</option>}{records.map(record=><option value={record.id} key={record.id}>{String(record.data.fullName||'')} · {record.reference}</option>)}</select>{loading&&<p role="status" className="field-hint">正在讀取登記…</p>}{error?<p className="field-error" role="alert">{error} <button type="button" className="text-action" onClick={()=>setRefresh(current=>current+1)}>重試</button></p>:<div className="private-picker-pages"><span>{total===0?'沒有符合條件的登記':`共${total}份，第${page}／${pages}頁`}</span><button type="button" className="text-action" disabled={disabled||loading||page<=1} onClick={()=>setPage(current=>current-1)}>上一頁</button><button type="button" className="text-action" disabled={disabled||loading||page>=pages} onClick={()=>setPage(current=>current+1)}>下一頁</button></div>}</fieldset>;
}
