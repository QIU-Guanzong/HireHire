import type { Metadata } from 'next';
import './globals.css';
import '@/components/workspace.css';
import '@/components/intake-mobile.css';
import './visual-refresh.css';
import SiteNavigation from '@/components/site-navigation';
import { BrandVersion } from '@/components/brand-version';
import { LocaleProvider } from '@/components/locale-provider';
import { LanguageSwitcher } from '@/components/language-switcher';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/server-locale';
export async function generateMetadata(): Promise<Metadata> {
 const locale = await getLocale();
 return { title:{default:locale==='en'?'Jiahe Home Services | Domestic help and home care':'家合僱傭｜家傭、陪月及家居照顧',template:locale==='en'?'%s | Jiahe Home Services':'%s｜家合僱傭'}, description:t(locale,'搜尋人選、查看工作履歷，登記家傭、陪月、長者照顧及家居服務的聘用需要。'), icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'} };
}
export default async function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
 const locale = await getLocale();
 return <html lang={locale === 'en' ? 'en-HK' : 'zh-Hant-HK'}><body><LocaleProvider initialLocale={locale}>
  <noscript><style>{`
   .hire-menu-toggle,.hire-nav-disclosure,.hire-nav-subtoggle{display:none!important}
   .hire-primary-navigation{display:flex!important;flex:1;min-width:0;flex-wrap:wrap;align-items:flex-start}
   .hire-navigation-inner{flex-wrap:wrap}
   .hire-nav-group{flex:1 1 240px}
   .hire-nav-panel[hidden],.hire-nav-sublist[hidden],.hire-nav-subheading{display:block!important}
   .hire-nav-panel{position:static!important;width:auto!important;max-width:none!important;box-shadow:none!important;border:0!important;padding:0!important;margin:0!important}
   .hire-nav-top-row{height:auto}
   .hire-nav-subheading{font-weight:500}
   .hire-nav-group.is-current-section>.hire-nav-top-row::after{display:none}
   @media(max-width:700px){.hire-nav-group{flex:none}.hire-primary-navigation{width:100%}.hire-nav-register{align-self:start}}
  `}</style></noscript>
  <a className="skip-link" href="#main-content">{t(locale, '跳到主要內容')}</a>
  <header className="site-header"><div className="site-width header-inner">
   <a className="brand" href="/" aria-label={t(locale, '家合僱傭首頁')} aria-describedby="brand-version"><span className="brand-mark" aria-hidden="true">合</span><span className="brand-wordmark"><span className="brand-name">{t(locale, '家合僱傭')}</span><small>{t(locale, '家傭 · 陪月 · 家居照顧')}</small><BrandVersion/></span></a>
   <div className="header-utility"><a href="/saved">{t(locale, '已收藏人選')}</a><a href="/compare">{t(locale, '人選比較')}</a><a href="/jobseeker">{t(locale, '求職者登記')}</a><LanguageSwitcher/></div>
  </div><SiteNavigation/></header>
  {children}
  <footer className="site-footer"><div className="site-width footer-main"><div><a href="/" className="footer-brand">{t(locale, '家合僱傭')}</a><p>{t(locale, '家傭 · 陪月 · 長者照顧 · 家居服務')}</p></div><nav aria-label={t(locale, '頁尾導覽')}><a href="/candidates">{t(locale, '搜尋人選')}</a><a href="/employer">{t(locale, '僱主登記')}</a><a href="/jobseeker">{t(locale, '求職者登記')}</a><a href="/contact">{t(locale, '聯絡及查詢')}</a></nav></div><div className="site-width footer-inner"><span>© {new Date().getFullYear()} {t(locale, '家合僱傭')}</span><a href="/admin">{t(locale, '管理後台')}</a></div></footer>
 </LocaleProvider></body></html>;
}
