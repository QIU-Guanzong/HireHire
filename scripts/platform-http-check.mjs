import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const base=process.argv[2]||'http://127.0.0.1:5177',origin=new URL(base).origin;
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'HTTP checks only run on loopback.');
const run=promisify(execFile),marker=`API驗證-${randomUUID().slice(0,8)}`,ids=[],fixtureIp='198.51.100.251',startedHour=Math.floor(Date.now()/3600000);let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
const authHeaders={Cookie:'__sites_local_auth=1'};
async function request(path,{body,method='GET',auth=false}={}){return fetch(`${origin}${path}`,{method,headers:{...(auth?authHeaders:{}),'cf-connecting-ip':fixtureIp,...(body!==undefined?{'Content-Type':'application/json',Origin:origin}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
async function bodyOf(response,status,message){check(response.status===status,`${message}: ${response.status}`);return response.json();}
const seeker={fullName:`${marker}私密姓名`,phone:'+852 61234567',email:'private@example.test',nationality:'香港',currentLocation:'香港',services:['家傭'],languages:['廣東話'],yearsExperience:'3–5年',skills:['煮食'],workHistory:'私密履歷不得公開。',employmentType:'全職非住家',workLocations:['全香港'],availableFrom:'2026-11-01',salaryNegotiable:true,publicProfileConsent:true,publicName:'測試阿May',publicIntroduction:'熟悉煮食及日常家務。',consent:true};
const employer={fullName:`${marker}僱主`,phone:'+852 67891234',district:'沙田',householdAdults:'2',services:['家傭'],employmentType:'全職非住家',duties:['煮食'],startDate:'2026-11-01',schedule:'星期一至五',budgetNegotiable:true,consent:true};
try{
  const session=await bodyOf(await request('/api/admin/session',{auth:true}),200,'Local administrator session');assert(session.authorized,'Local auth not configured.');
  check((await request('/api/admin/candidates')).status===401,'Anonymous publication list denied.');
  check((await request('/api/admin/matches')).status===401,'Anonymous matching list denied.');
  check((await request('/api/admin/settings',{method:'PATCH',body:{expectedUpdatedAt:''}})).status===401,'Anonymous settings write denied.');
  const receipt=await bodyOf(await request('/api/intake',{method:'POST',body:{kind:'jobseeker',data:seeker,idempotencyKey:randomUUID()}}),201,'Negotiable seeker saved');
  let records=await bodyOf(await request(`/api/admin/records?q=${encodeURIComponent(marker)}`,{auth:true}),200,'Local record readback');ids.push(...records.records.map(record=>record.id));
  let record=records.records.find(record=>record.reference===receipt.reference);assert(record);
  let publication=await bodyOf(await request('/api/admin/candidates',{method:'POST',body:{intakeId:record.id},auth:true}),201,'Draft publication');
  check(publication.summary===seeker.publicIntroduction&&publication.workExperiences.length===0,'Draft excludes private history.');
  check((await request(`/api/candidates/${publication.id}`)).status===404,'Draft direct access denied.');
  publication=await bodyOf(await request(`/api/admin/candidates/${publication.id}`,{method:'PATCH',body:{state:'published',expectedUpdatedAt:publication.updatedAt},auth:true}),200,'Approved publication');
  const published=await bodyOf(await request(`/api/candidates/${publication.id}`),200,'Public profile readback');
  const encoded=JSON.stringify(published);check(!encoded.includes(marker)&&!encoded.includes('61234567')&&!encoded.includes('private@example.test')&&!encoded.includes('私密履歷')&&!encoded.includes('intakeId'),'Live public projection excludes private source fields.');
  const result=await bodyOf(await request(`/api/candidates?ids=${publication.id}&district=${encodeURIComponent('沙田')}`),200,'Public filtered catalog');check(result.total===1&&result.candidates[0].id===publication.id,'District treats whole Hong Kong as matching.');
  const employerReceipt=await bodyOf(await request('/api/intake',{method:'POST',body:{kind:'employer',data:employer,candidateIds:[publication.id],idempotencyKey:randomUUID()}}),201,'Selected candidate inquiry');
  records=await bodyOf(await request(`/api/admin/records?q=${encodeURIComponent(marker)}`,{auth:true}),200,'Inquiry readback');ids.push(...records.records.map(item=>item.id));
  const employerRecord=records.records.find(item=>item.reference===employerReceipt.reference);check(employerRecord.requestedCandidateIds[0]===publication.id,'Selected reference saved.');
  const matches=await bodyOf(await request(`/api/admin/matches?employerId=${employerRecord.id}`,{auth:true}),200,'Automatic matching readback');check(matches.total===1&&matches.matches[0].jobseekerId===record.id,'Inquiry creates one backend match.');
  const match=matches.matches[0];await bodyOf(await request(`/api/admin/matches/${match.id}`,{method:'PATCH',body:{stage:'安排面試',interviewAt:'2026-11-01T15:00',expectedUpdatedAt:match.updatedAt},auth:true}),200,'Match update');
  check((await request(`/api/admin/matches/${match.id}`,{method:'PATCH',body:{stage:'已完成',expectedUpdatedAt:match.updatedAt},auth:true})).status===409,'Stale live match rejected.');
  const edited=await bodyOf(await request(`/api/admin/records/${record.id}`,{method:'PATCH',body:{data:{...record.data,fullName:`${marker}更正後`},nextFollowUp:'2026-11-03',expectedUpdatedAt:record.updatedAt},auth:true}),200,'Record correction');
  check(edited.nextFollowUp==='2026-11-03'&&edited.data.fullName.endsWith('更正後'),'Corrected data persisted.');
  check((await request(`/api/admin/records/${record.id}`,{method:'PATCH',body:{notes:'過期',expectedUpdatedAt:record.updatedAt},auth:true})).status===409,'Stale record correction rejected.');record=edited;
  const pdf=await request(`/api/candidates/${publication.id}/pdf`);check(pdf.status===200&&pdf.headers.get('content-type')==='application/pdf','Live public PDF downloadable.');await pdf.arrayBuffer();
  await bodyOf(await request(`/api/admin/records/${record.id}`,{method:'PATCH',body:{data:{...record.data,publicProfileConsent:false},expectedUpdatedAt:record.updatedAt},auth:true}),200,'Consent withdrawal');
  for(const suffix of ['', '/photo','/pdf'])check((await request(`/api/candidates/${publication.id}${suffix}`)).status===404,'Withdrawal removes live profile/photo/PDF.');
  const after=await bodyOf(await request(`/api/candidates?ids=${publication.id}`),200,'Withdrawal catalog readback');check(after.total===0,'Withdrawn profile absent from catalog.');
  console.log(JSON.stringify({passed:true,checks,loopbackOnly:true,marker}));
}finally{
  const remaining=await request(`/api/admin/records?q=${encodeURIComponent(marker)}`,{auth:true}).catch(()=>null);if(remaining?.ok)ids.push(...(await remaining.json()).records.map(item=>item.id));
  const exactIds=[...new Set(ids)];if(exactIds.length){assert(exactIds.every(id=>/^[a-f\d-]{36}$/.test(id)));const inIds=exactIds.map(id=>`'${id}'`).join(',');
    let salt=process.env.RATE_LIMIT_SALT||new URL(base).hostname;try{const vars=await readFile('.dev.vars','utf8'),value=vars.match(/^RATE_LIMIT_SALT\s*=\s*(.*)$/m)?.[1];if(value)salt=value.trim().replace(/^["']|["']$/g,'');}catch{}
    const hashes=[...new Set([startedHour,Math.floor(Date.now()/3600000)])].map(hour=>createHash('sha256').update(`${salt}:${hour}:${fixtureIp}`).digest('hex'));
    const sql=`DELETE FROM record_matches WHERE employer_id IN (${inIds}) OR jobseeker_id IN (${inIds});\nDELETE FROM candidate_publications WHERE intake_id IN (${inIds});\nDELETE FROM intake_records WHERE id IN (${inIds});\nDELETE FROM intake_rate_limits WHERE key IN (${hashes.map(hash=>`'${hash}'`).join(',')});`;
    await mkdir('work/platform-check',{recursive:true});const path='work/platform-check/http-cleanup.sql';await writeFile(path,sql);await run(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file',path]);await rm(path,{force:true});
    const clean=await(await request(`/api/admin/records?q=${encodeURIComponent(marker)}`,{auth:true})).json();assert.equal(clean.total,0,'Exact live fixture cleanup verified.');
  }
}
