import { ArrowRight, Search } from 'lucide-react';
import { allFields, services } from '@/lib/fields';
import { candidateTypes } from '@/lib/platform-types';
import { serviceContent } from '@/lib/service-content';
export default function Home() {
 return <main id="main-content">
  <section className="home-search-band"><div className="site-width home-search-layout"><div className="home-search-main">
   <p className="page-kicker">家合僱傭</p><h1>家傭、陪月及家居照顧</h1><p className="home-lead">按工作需要找人選，查看履歷後提交聘用要求。</p>
   <form action="/candidates" method="get" className="home-search-form home-search-form--extended">
    <label>服務類別<select name="service" defaultValue=""><option value="">所有服務</option>{services.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>人選類型<select name="candidateType" defaultValue=""><option value="">所有類型</option>{candidateTypes.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>工作技能<select name="skill" defaultValue=""><option value="">不限技能</option>{allFields('jobseeker').find(field=>field.name==='skills')?.options?.map(skill=><option key={skill}>{skill}</option>)}</select></label>
    <button className="button primary" type="submit"><Search size={17}/>搜尋人選</button>
   </form>
   <div className="home-search-links"><a href="/candidates">瀏覽所有人選 <ArrowRight size={14}/></a><a href="/employer">直接填寫聘用需要 <ArrowRight size={14}/></a></div>
  </div><aside className="home-job-entry"><h2>正在找工作？</h2><p>登記你的工作經驗、技能及可開始日期。</p><a href="/jobseeker">求職者登記 <ArrowRight size={16}/></a><span>提交後可保留登記編號</span></aside></div></section>
  <div className="site-width home-content"><section className="home-services"><div className="section-heading"><div><p className="page-kicker">按家庭需要選擇</p><h2>服務類別</h2></div><a href="/services">服務詳情 <ArrowRight size={15}/></a></div>
   <div className="service-directory">{serviceContent.map((s,i)=><a href={'/services#'+s.id} key={s.id}><span className="service-number">0{i+1}</span><h3>{s.name}</h3><p>{s.lead}</p><ArrowRight size={18}/></a>)}</div>
  </section>
  <section className="home-process"><div className="section-heading"><div><p className="page-kicker">由選人到跟進</p><h2>聘用怎樣開始</h2></div><a href="/process">流程及準備資料 <ArrowRight size={15}/></a></div><ol className="process-strip"><li><span>01</span><h3>找人選</h3><p>篩選服務、經驗及工作安排。</p></li><li><span>02</span><h3>查看及比較</h3><p>核對履歷，保存合適人選。</p></li><li><span>03</span><h3>填寫需求</h3><p>提交家庭資料和聘用要求。</p></li><li><span>04</span><h3>跟進配對</h3><p>確認人選、面試及工作安排。</p></li></ol></section>
  <div className="home-bottom-row"><div><h2>還未選定人選？</h2><p>可先登記服務需要，列明地區、時段和預算。</p></div><a href="/employer" className="button primary">僱主登記 <ArrowRight size={16}/></a><a href="/faq" className="text-link">常見問題</a></div>
  </div>
 </main>;
}
