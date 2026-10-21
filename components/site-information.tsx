'use client';
import { useEffect,useState } from 'react';
import type { SiteInfo } from '@/lib/platform-types';
import { useLocale } from './locale-provider';
import { t } from '@/lib/i18n';
export default function SiteInformation({mode}:{mode:'fees'|'contact'}) {
 const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
 const [info,setInfo]=useState<SiteInfo|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError(false);setInfo(null);fetch('/api/site-info',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json() as Promise<SiteInfo>;}).then(setInfo).catch(e=>{if(e.name!=='AbortError')setError(true);});return()=>controller.abort();},[attempt]);
 if(error)return <div className="info-state" role="alert">{tr('資料暫時未能載入。')} <button type="button" onClick={()=>setAttempt(attempt+1)}>{tr('重新載入')}</button></div>;
 if(!info)return <p className="info-state" role="status">{tr('正在載入資料…')}</p>;
 if(mode==='fees')return info.fees.length?<div className="info-table-wrap"><table className="info-table"><thead><tr><th scope="col">{tr('服務')}</th><th scope="col">{tr('收費')}</th><th scope="col">{tr('說明')}</th></tr></thead><tbody>{info.fees.map((fee,index)=><tr key={index}><th scope="row">{tr(fee.service)}</th><td>{fee.amount?`${fee.amount} ${tr(fee.unit)}`:tr('待補充')}</td><td>{fee.notes||'—'}</td></tr>)}</tbody></table></div>:<div className="fee-placeholder"><p className="pending-label">{tr('價目待補充')}</p><h2>{tr('先告訴我們你的聘用需要')}</h2><p>{tr('服務類別、工作時段及照顧安排可在僱主登記時填寫。')}</p><a className="button primary" href="/employer">{tr('填寫聘用需要')}</a></div>;
 const contacts=[['電話',info.phone],['WhatsApp',info.whatsapp],['電郵',info.email],['辦公地址',info.address],['辦公時間',info.hours]];
 return <dl className="contact-list">{contacts.map(([label,value])=><div key={label}><dt>{tr(label)}</dt><dd>{value ? label==='電話'?<a href={'tel:'+value.replace(/[^+\d]/g,'')}>{value}</a>:label==='WhatsApp'?<a href={'https://wa.me/'+(value.replace(/\D/g,'').length===8?'852':'')+value.replace(/\D/g,'')} target="_blank" rel="noreferrer">{value}</a>:label==='電郵'?<a href={'mailto:'+value}>{value}</a>:value : <span className="pending-value">{tr('待補充')}</span>}</dd></div>)}</dl>;
}
