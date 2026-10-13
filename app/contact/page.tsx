import type { Metadata } from 'next';
import SiteInformation from '@/components/site-information';
export const metadata:Metadata={title:'聯絡及查詢'};
export default function Contact(){return <main id="main-content" className="site-width information-page"><header className="information-heading"><p className="page-kicker">家合僱傭</p><h1>聯絡及查詢</h1><p>透過登記表留下聯絡資料與需要。</p></header><div className="contact-page-layout"><section className="contact-actions"><h2>需要聘用服務</h2><p>填寫服務、地區、時段及家庭需要。未選定人選也可提交。</p><a href="/employer" className="button primary">填寫僱主資料</a><hr/><h2>登記求職資料</h2><p>填寫工作經驗、技能、可開始日期及期望薪金。</p><a href="/jobseeker" className="button secondary">填寫求職資料</a></section><section className="contact-details"><h2>聯絡資料</h2><SiteInformation mode="contact"/></section></div></main>;}
