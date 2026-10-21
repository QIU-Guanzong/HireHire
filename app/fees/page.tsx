import type { Metadata } from 'next';
import SiteInformation from '@/components/site-information';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/server-locale';
export async function generateMetadata():Promise<Metadata>{const locale=await getLocale();return {title:t(locale,'服務收費')};}
export default async function Fees(){const locale=await getLocale(),tr=(value:string)=>t(locale,value);return <main id="main-content" className="site-width information-page"><header className="information-heading"><p className="page-kicker">{tr('聘用資料')}</p><h1>{tr('服務收費')}</h1><p>{tr('家傭、陪月、長者照顧及家居服務的收費資料。')}</p></header><SiteInformation mode="fees"/><div className="information-related"><a href="/services">{tr('查看服務類別')} →</a><a href="/process">{tr('聘用流程')} →</a></div></main>;}
