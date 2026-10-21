import type { Metadata } from 'next';
import SiteInformation from '@/components/site-information';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/server-locale';
export async function generateMetadata():Promise<Metadata>{const locale=await getLocale();return {title:t(locale,'聯絡及查詢')};}
export default async function Contact(){const locale=await getLocale(),tr=(value:string)=>t(locale,value);return <main id="main-content" className="site-width information-page"><header className="information-heading"><p className="page-kicker">{tr('家合僱傭')}</p><h1>{tr('聯絡及查詢')}</h1><p>{tr('透過登記表留下聯絡資料與需要。')}</p></header><div className="contact-page-layout"><section className="contact-actions"><h2>{tr('需要聘用服務')}</h2><p>{tr('填寫服務、地區、時段及家庭需要。未選定人選也可提交。')}</p><a href="/employer" className="button primary">{tr('填寫僱主資料')}</a><hr/><h2>{tr('登記求職資料')}</h2><p>{tr('填寫工作經驗、技能、可開始日期及期望薪金。')}</p><a href="/jobseeker" className="button secondary">{tr('填寫求職資料')}</a></section><section className="contact-details"><h2>{tr('聯絡資料')}</h2><SiteInformation mode="contact"/></section></div></main>;}
