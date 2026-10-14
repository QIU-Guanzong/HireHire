import { ArrowRight, Baby, Blocks, HandHeart, House, Search, Sparkles } from 'lucide-react';
import { allFields, services } from '@/lib/fields';
import { candidateTypes } from '@/lib/platform-types';
import { serviceContent } from '@/lib/service-content';
import { HomeWindow } from '@/components/home-window';

const serviceIcons = [House, Baby, HandHeart, Sparkles, Blocks];

export default function Home() {
 return <main id="main-content" className="home-page">
  <section className="home-search-band"><div className="site-width home-search-layout"><div className="home-search-main">
   <p className="page-kicker"><span aria-hidden="true"/>家傭 · 陪月 · 家居照顧</p>
   <h1>屋企的大小事，<br/><span>找個合適幫手。</span></h1>
   <p className="home-lead">照顧家人、打理家務，先從你的需要開始。<br className="home-lead-break"/>查看人選履歷，再安排下一步。</p>
   <div className="home-search-links"><a href="/candidates">瀏覽所有人選 <ArrowRight size={16}/></a><a href="/employer">直接填寫聘用需要 <ArrowRight size={16}/></a></div>
  </div><HomeWindow />
  <div className="home-search-box"><div className="home-search-caption"><Search size={18} aria-hidden="true"/><h2>你想找哪一種幫手？</h2></div>
   <form action="/candidates" method="get" className="home-search-form home-search-form--extended">
    <label>服務類別<select name="service" defaultValue=""><option value="">所有服務</option>{services.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>人選類型<select name="candidateType" defaultValue=""><option value="">所有類型</option>{candidateTypes.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>工作技能<select name="skill" defaultValue=""><option value="">不限技能</option>{allFields('jobseeker').find(field=>field.name==='skills')?.options?.map(skill=><option key={skill}>{skill}</option>)}</select></label>
    <button className="button primary" type="submit"><Search size={18} aria-hidden="true"/>搜尋人選</button>
   </form>
  </div></div></section>
  <div className="site-width"><aside className="home-job-entry"><div><h2>想找一份家居服務工作？</h2><p>登記經驗、技能及可開始日期，讓我們了解你的工作期望。</p></div><a href="/jobseeker">求職者登記 <ArrowRight size={17} aria-hidden="true"/></a></aside></div>
  <div className="site-width home-content"><section className="home-services"><div className="section-heading"><div><p className="page-kicker">按家庭需要選擇</p><h2>服務類別</h2></div><a href="/services">服務詳情 <ArrowRight size={15}/></a></div>
   <div className="service-directory">{serviceContent.map((s,i)=>{const Icon=serviceIcons[i];return <a href={'/services#'+s.id} key={s.id}><span className="service-icon" aria-hidden="true"><Icon size={24} strokeWidth={1.6}/></span><h3>{s.name}</h3><p>{s.lead}</p><ArrowRight size={18} aria-hidden="true"/></a>;})}</div>
  </section>
  <section className="home-process"><div className="section-heading"><div><p className="page-kicker">由選人到跟進</p><h2>聘用怎樣開始</h2></div><a href="/process">流程及準備資料 <ArrowRight size={15}/></a></div><ol className="process-strip"><li><span>01</span><h3>找人選</h3><p>篩選服務、經驗及工作安排。</p></li><li><span>02</span><h3>查看及比較</h3><p>核對履歷，保存合適人選。</p></li><li><span>03</span><h3>填寫需求</h3><p>提交家庭資料和聘用要求。</p></li><li><span>04</span><h3>跟進配對</h3><p>確認人選、面試及工作安排。</p></li></ol></section>
  <div className="home-bottom-row"><div><h2>還未選定人選？</h2><p>可先登記服務需要，列明地區、時段和預算。</p></div><a href="/employer" className="button primary">僱主登記 <ArrowRight size={16}/></a><a href="/faq" className="text-link">常見問題</a></div>
  </div>
 </main>;
}
