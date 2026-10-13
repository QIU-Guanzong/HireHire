import type { Metadata } from 'next';
import './globals.css';
import SiteNavigation from '@/components/site-navigation';
export const metadata: Metadata = {
 title:{default:'家合僱傭｜家傭、陪月及家居照顧',template:'%s｜家合僱傭'},
 description:'搜尋人選、查看工作履歷，登記家傭、陪月、長者照顧及家居服務的聘用需要。',
 icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'},
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
 return <html lang="zh-Hant-HK"><body>
  <noscript><style>{'.mobile-menu{display:none!important}@media(max-width:700px){.site-nav{display:grid;position:static;box-shadow:none;flex:1;padding:0;gap:0}.navigation-inner{flex-wrap:wrap}.nav-register{margin-left:0;width:100%}}'}</style></noscript>
  <a className="skip-link" href="#main-content">跳到主要內容</a>
  <header className="site-header"><div className="site-width header-inner">
   <a className="brand" href="/" aria-label="家合僱傭首頁"><span className="brand-mark" aria-hidden="true">合</span><span>家合僱傭<small>家傭 · 陪月 · 家居照顧</small></span></a>
   <div className="header-utility"><a href="/saved">已收藏人選</a><a href="/compare">人選比較</a><a href="/jobseeker">求職者登記</a></div>
  </div><SiteNavigation/></header>
  {children}
  <footer className="site-footer"><div className="site-width footer-main"><div><a href="/" className="footer-brand">家合僱傭</a><p>家傭 · 陪月 · 長者照顧 · 家居服務</p></div><nav aria-label="頁尾導覽"><a href="/candidates">搜尋人選</a><a href="/employer">僱主登記</a><a href="/jobseeker">求職者登記</a><a href="/contact">聯絡及查詢</a></nav></div><div className="site-width footer-inner"><span>© {new Date().getFullYear()} 家合僱傭</span><a href="/admin">管理後台</a></div></footer>
 </body></html>;
}
