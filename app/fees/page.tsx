import type { Metadata } from 'next';
import SiteInformation from '@/components/site-information';
export const metadata:Metadata={title:'服務收費'};
export default function Fees(){return <main id="main-content" className="site-width information-page"><header className="information-heading"><p className="page-kicker">聘用資料</p><h1>服務收費</h1><p>家傭、陪月、長者照顧及家居服務的收費資料。</p></header><SiteInformation mode="fees"/><div className="information-related"><a href="/services">查看服務類別 →</a><a href="/process">聘用流程 →</a></div></main>;}
