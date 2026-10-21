// Isolated runtime + synthetic public profiles. No production requests or writes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const option=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const origin=new URL(process.argv[2]||'http://127.0.0.1:5193');assert(origin.protocol==='http:'&&origin.hostname==='127.0.0.1');
const out=option('output')||'work/build-label-check';await mkdir(out,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const actual=await fetch(origin.origin+'/api/live',{headers:{'X-HireHire-Source':'f'.repeat(40),'X-Release-Channel':'production'}}).then(r=>r.json());
assert.deepEqual(actual.source,{commit,tree,buildId:commit});assert.equal(actual.releaseChannel,'candidate');
const {chromium}=await import(option('playwright')||'playwright');
const browser=await chromium.launch({executablePath:option('chromium'),headless:true});
const checks=['Real HTTP reports actual compiled commit/tree/build ID despite runtime/request spoof values'],geometry=[],errors=[],external=[];
const check=(value,label)=>{assert(value,label);checks.push(label);};
const candidates=['甲','乙'].map((suffix,i)=>({id:`00000000-0000-4000-8000-00000000000${i+1}`,reference:`LOCAL-TEST-00${i+1}`,displayName:`合成測試人選${suffix}`,services:['家居清潔'],nationality:'香港',candidateType:'本地求職',age:'32',education:'中學',currentLocation:'香港',languages:['廣東話'],yearsExperience:'3至5年',skills:['煮食'],employmentType:'兼職',workLocations:['沙田'],availableFrom:'2026-11-01',expectedSalary:i?'123456.78':'',salaryUnit:'每月',salaryNegotiable:!i,summary:'僅供本地介面測試，非真實求職者。',qualifications:'',workExperiences:[],hasPhoto:false,updatedAt:'2026-10-21T00:00:00Z'}));
let failure;
try{
 for(const locale of ['zh-Hant','en'])for(const width of [1440,390]){
  const height=width===390?844:900,context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
  await context.addCookies([{name:'jiahe_locale',value:locale,url:origin.origin}]);
  let empty=false,channel=null;
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin.origin||!['GET','HEAD'].includes(request.method())){external.push(url.pathname);return route.abort();}
   if(url.pathname==='/api/live'&&channel){if(channel==='failed')return route.fulfill({status:503,json:{}});return route.fulfill({json:channel});}
   if(url.pathname==='/api/candidates')return route.fulfill({json:{candidates:empty?[]:candidates,total:empty?0:2,page:1,pageSize:12}});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const label=s=>`${locale}/${width}: ${s}`;
  const ready=async()=>{await page.locator('.candidate-results[aria-busy="false"]').waitFor();await page.waitForFunction(()=>!['Checking','查核中'].includes(document.querySelector('.brand-version-mode')?.textContent||'Checking'));await page.evaluate(()=>document.fonts.ready);};
  await page.goto(origin.origin+'/candidates');await ready();
  check(await page.locator('.brand-version-mode').innerText()===(locale==='en'?'Candidate':'候選'),label('Actual review runtime is Candidate'));
  check((await page.locator('.brand-version-source').innerText()).includes(commit.slice(0,7)),label('Visible source distinguishes this exact build'));
  check((await page.locator('.brand-version-source').getAttribute('title')).includes(commit)&&(await page.locator('.brand-version-source').getAttribute('title')).includes(tree),label('Full source identity remains available'));
  const rows=await page.locator('.candidate-card-facts > div').evaluateAll(nodes=>nodes.map(row=>{
   const rects=el=>{const range=document.createRange();range.selectNodeContents(el);return [...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));};
   const dt=row.querySelector('dt'),dd=row.querySelector('dd'),labels=rects(dt),values=rects(dd);return {label:dt.textContent,value:dd.textContent,labels,values,intersects:labels.some(a=>values.some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5))};
  }));geometry.push({locale,width,rows});check(rows.every(r=>!r.intersects),label('Actual label and value glyph rectangles do not intersect, including Negotiable and long salary'));
  const inside=await page.locator('.candidate-card-facts').evaluateAll(lists=>lists.every(list=>[...list.querySelectorAll('dt,dd')].every(el=>el.scrollWidth<=el.clientWidth+1)));
  check(inside,label('Long labels and values wrap inside their own grid cells'));
  const layout=await page.evaluate(()=>{
   const b=document.querySelector('.brand').getBoundingClientRect(),u=document.querySelector('.language-switcher').getBoundingClientRect(),h=document.querySelector('.header-inner').getBoundingClientRect();
   return {overlap:Math.min(b.right,u.right)>Math.max(b.left,u.left)&&Math.min(b.bottom,u.bottom)>Math.max(b.top,u.top),inside:b.top>=h.top&&b.bottom<=h.bottom+1,overflow:document.documentElement.scrollWidth>innerWidth+1};
  });check(!layout.overlap&&layout.inside&&!layout.overflow,label('Version label stays within header and does not crowd logo/language switch'));
  if(width===390){await page.locator('.hire-menu-toggle').click();check(await page.locator('.hire-primary-navigation').isVisible(),label('Mobile navigation remains operable'));await page.keyboard.press('Escape');check(await page.locator('.hire-menu-toggle').evaluate(e=>e===document.activeElement),label('Mobile menu closes with visible focus'));}
  await page.screenshot({path:`${out}/after-populated-${locale}-${width}.png`,fullPage:true});
  for(const [name,value,expected] of [
   ['preview',{releaseChannel:'preview',source:actual.source},locale==='en'?'Preview':'預覽'],
   ['live',{releaseChannel:'production',source:actual.source},locale==='en'?'Live':'正式站'],
   ['missing-source',{releaseChannel:'production'},locale==='en'?'Unknown':'未知'],
   ['mismatched-build',{releaseChannel:'production',source:{...actual.source,buildId:'wrong'}},locale==='en'?'Unknown':'未知'],
   ['failed','failed',locale==='en'?'Unknown':'未知']]){
   channel=value;await page.reload();await ready();check(await page.locator('.brand-version-mode').innerText()===expected,label(`${name} status is explicit and never inferred from hostname`));
   if(['missing-source','mismatched-build','failed'].includes(name))check(await page.locator('.brand-version-source').innerText()===(locale==='en'?'Source unknown':'來源未知'),label(`${name} has no fabricated source`));
  }
  channel=null;empty=true;await page.goto(origin.origin+'/candidates');await ready();
  const cta=await page.locator('.candidate-empty .button.primary').boundingBox();
  check(await page.locator('.candidate-empty .button.primary').getAttribute('href')==='/employer',label('PR5 employer CTA remains primary'));
  if(width===390)check(cta.y+cta.height<=844,label('PR5 empty CTA remains in the first mobile viewport'));
  await page.screenshot({path:`${out}/after-empty-${locale}-${width}.png`});
  await page.goto(origin.origin+'/candidates?service='+encodeURIComponent('家居清潔')+'&q='+encodeURIComponent('香港'));await ready();
  check(await page.locator('.candidate-empty[data-state="filtered"]').isVisible()&&await page.locator('.candidate-filter-form input[name="q"]').inputValue()==='香港',label('PR5 filtered state and raw query remain intact'));
  check(await page.locator('.candidate-empty button.primary').isVisible(),label('PR5 clear-all action remains available'));
  await page.screenshot({path:`${out}/after-filtered-${locale}-${width}.png`,fullPage:true});
  await context.close();
 }
 check(errors.length===0,'No browser runtime errors');check(external.length===0,'No external requests or write attempts');
}catch(error){failure=error.stack;process.exitCode=1;}
finally{await browser.close();await writeFile(`${out}/browser-report.json`,JSON.stringify({passed:!failure,checks:checks.length,assertions:checks,geometry,errors,external,commit,tree,actualHttpSource:actual.source,productionRequests:0,browserClosed:true,failure},null,2)+'\n');console.log(JSON.stringify({passed:!failure,checks:checks.length,failure}));}
