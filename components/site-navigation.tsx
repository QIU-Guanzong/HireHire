'use client';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
const links = [['/candidates','搜尋人選'],['/services','服務類別'],['/process','聘用流程'],['/fees','服務收費'],['/faq','常見問題'],['/contact','聯絡及查詢']];
export default function SiteNavigation() {
 const pathname = usePathname(), [open,setOpen] = useState(false);
 return <div className="navigation-shell"><div className="site-width navigation-inner">
  <button type="button" className="mobile-menu" aria-expanded={open} aria-controls="primary-navigation" onClick={()=>setOpen(!open)}>{open?<X size={19}/>:<Menu size={19}/>}選單</button>
  <nav id="primary-navigation" aria-label="主導覽" className={'site-nav'+(open?' is-open':'')}>{links.map(([href,label])=><a key={href} href={href} aria-current={pathname===href || (href==='/candidates'&&pathname.startsWith('/candidates/'))?'page':undefined} onClick={()=>setOpen(false)}>{label}</a>)}</nav>
  <a href="/employer" className="nav-register">僱主登記</a>
 </div></div>;
}
