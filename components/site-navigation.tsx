'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { serviceContent } from '@/lib/service-content';
import './site-navigation.css';

type GroupId = 'candidates' | 'services';
type SectionId = 'candidate-services' | 'service-range';
type NavigationLink = { label: string; href: string };
type NavigationSection = { label: string; id: SectionId; links: NavigationLink[] };
type NavigationGroup = {
  id: GroupId;
  label: string;
  href: string;
  paths: string[];
  items: (NavigationLink | NavigationSection)[];
};

const groups: NavigationGroup[] = [
  {
    id: 'candidates', label: '搜尋人選', href: '/candidates', paths: ['/candidates', '/saved', '/compare'],
    items: [
      { label: '全部人選', href: '/candidates' },
      { label: '按服務搜尋', id: 'candidate-services', links: serviceContent.map(service => ({ label: service.name, href: '/candidates?service=' + encodeURIComponent(service.name) })) },
      { label: '已收藏人選', href: '/saved' },
      { label: '人選比較', href: '/compare' },
    ],
  },
  {
    id: 'services', label: '僱傭服務', href: '/services', paths: ['/services', '/process', '/fees', '/faq'],
    items: [
      { label: '服務範圍', id: 'service-range', links: serviceContent.map(service => ({ label: service.name, href: '/services#' + service.id })) },
      { label: '聘用流程', href: '/process' },
      { label: '服務收費', href: '/fees' },
      { label: '常見問題', href: '/faq' },
    ],
  },
];

const directLinks: NavigationLink[] = [
  { label: '聯絡及查詢', href: '/contact' },
  { label: '求職者登記', href: '/jobseeker' },
];

export default function SiteNavigation() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<GroupId | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);
  const mobileBreakpoint = useRef<boolean | null>(null);
  const groupTriggers = useRef<Partial<Record<GroupId, HTMLButtonElement | null>>>({});
  const sectionTriggers = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});

  const closeNavigation = useCallback(() => {
    setMobileOpen(false);
    setActiveGroup(null);
    setActiveSection(null);
  }, []);

  const resetAfterNavigation = useCallback(() => {
    lastFocusedElement.current = null;
    closeNavigation();
  }, [closeNavigation]);

  const resetAtBreakpoint = useCallback(() => {
    const isMobile = window.matchMedia('(max-width: 700px)').matches;
    const activeElement = document.activeElement;
    // A newly hidden element can lose focus before the media-query event runs.
    const previousFocus = activeElement instanceof HTMLElement && shell.current?.contains(activeElement)
      ? activeElement : activeElement === document.body ? lastFocusedElement.current : null;
    mobileBreakpoint.current = isMobile;
    closeNavigation();
    if (isMobile && previousFocus && navigation.current?.contains(previousFocus)) mobileTrigger.current?.focus();
    else if (!isMobile && previousFocus === mobileTrigger.current) navigation.current?.querySelector<HTMLAnchorElement>('.hire-nav-link')?.focus();
    else if (!isMobile && previousFocus && navigation.current?.contains(previousFocus) && previousFocus.closest('.hire-nav-panel')) {
      previousFocus.closest('.hire-nav-group')?.querySelector<HTMLButtonElement>('.hire-nav-disclosure')?.focus();
    }
  }, [closeNavigation]);

  useEffect(() => { resetAfterNavigation(); }, [pathname, resetAfterNavigation]);

  useEffect(() => {
    const outsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !shell.current?.contains(event.target)) resetAfterNavigation();
    };
    const breakpoint = window.matchMedia('(max-width: 700px)');
    mobileBreakpoint.current = breakpoint.matches;
    document.addEventListener('pointerdown', outsidePointer);
    window.addEventListener('popstate', resetAfterNavigation);
    window.addEventListener('pageshow', resetAfterNavigation);
    breakpoint.addEventListener('change', resetAtBreakpoint);
    return () => {
      document.removeEventListener('pointerdown', outsidePointer);
      window.removeEventListener('popstate', resetAfterNavigation);
      window.removeEventListener('pageshow', resetAfterNavigation);
      breakpoint.removeEventListener('change', resetAtBreakpoint);
    };
  }, [resetAfterNavigation, resetAtBreakpoint]);

  const handleEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    if (activeSection) {
      setActiveSection(null);
      sectionTriggers.current[activeSection]?.focus();
    } else if (activeGroup) {
      setActiveGroup(null);
      groupTriggers.current[activeGroup]?.focus();
    } else if (mobileOpen) {
      setMobileOpen(false);
      mobileTrigger.current?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const currentPage = (href: string) => !href.includes('?') && !href.includes('#') && pathname === href;
  const renderLink = (link: NavigationLink) => <a href={link.href} aria-current={currentPage(link.href) ? 'page' : undefined} onClick={resetAfterNavigation}>{link.label}</a>;

  return <div className="navigation-shell" ref={shell} onKeyDown={handleEscape} onFocusCapture={event => {
    if (event.target instanceof HTMLElement) lastFocusedElement.current = event.target;
  }} onBlur={event => {
    if (!event.relatedTarget && mobileBreakpoint.current !== null && window.matchMedia('(max-width: 700px)').matches !== mobileBreakpoint.current) {
      resetAtBreakpoint();
    } else if (!(event.relatedTarget instanceof Node) || !shell.current?.contains(event.relatedTarget)) resetAfterNavigation();
  }}>
    <div className="site-width hire-navigation-inner">
      <button ref={mobileTrigger} type="button" className="hire-menu-toggle" aria-label={mobileOpen ? '關閉主導覽' : '開啟主導覽'} aria-expanded={mobileOpen} aria-controls="primary-navigation" onClick={() => {
        if (mobileOpen) closeNavigation();
        else { setMobileOpen(true); setActiveGroup(null); setActiveSection(null); }
      }}>{mobileOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}選單</button>

      <nav ref={navigation} id="primary-navigation" aria-label="主導覽" className={'hire-primary-navigation' + (mobileOpen ? ' is-open' : '')}>
        {groups.map(group => <div key={group.id} className={'hire-nav-group' + (group.paths.some(path => pathname === path || pathname.startsWith(path + '/')) ? ' is-current-section' : '')} onBlur={event => {
          if (activeGroup === group.id && (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))) {
            setActiveGroup(null);
            setActiveSection(null);
          }
        }}>
          <div className="hire-nav-top-row">
            <a href={group.href} className="hire-nav-link" aria-current={currentPage(group.href) || (group.id === 'candidates' && pathname.startsWith('/candidates/')) ? 'page' : undefined} onClick={resetAfterNavigation}>{group.label}</a>
            <button ref={element => { groupTriggers.current[group.id] = element; }} type="button" className="hire-nav-disclosure" aria-label={group.label + '選單'} aria-expanded={activeGroup === group.id} aria-controls={'navigation-' + group.id} onClick={() => {
              setActiveGroup(activeGroup === group.id ? null : group.id);
              setActiveSection(null);
            }}><ChevronDown size={16} aria-hidden="true" /></button>
          </div>
          <ul id={'navigation-' + group.id} className="hire-nav-panel" hidden={activeGroup !== group.id}>
            {group.items.map(item => 'href' in item ? <li key={item.href}>{renderLink(item)}</li> : <li key={item.id} className="hire-nav-section">
              <button ref={element => { sectionTriggers.current[item.id] = element; }} type="button" className="hire-nav-subtoggle" aria-expanded={activeSection === item.id} aria-controls={'navigation-' + item.id} onClick={() => setActiveSection(activeSection === item.id ? null : item.id)}>{item.label}<ChevronDown size={15} aria-hidden="true" /></button>
              <span className="hire-nav-subheading">{item.label}</span>
              <ul id={'navigation-' + item.id} className="hire-nav-sublist" hidden={activeSection !== item.id}>{item.links.map(link => <li key={link.href}>{renderLink(link)}</li>)}</ul>
            </li>)}
          </ul>
        </div>)}
        {directLinks.map(link => <a key={link.href} href={link.href} className="hire-nav-link hire-nav-direct" aria-current={currentPage(link.href) ? 'page' : undefined} onClick={resetAfterNavigation}>{link.label}</a>)}
      </nav>
      <a href="/employer" className="hire-nav-register" aria-current={currentPage('/employer') ? 'page' : undefined} onClick={resetAfterNavigation}>僱主登記</a>
    </div>
  </div>;
}
