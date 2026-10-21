// Run against an isolated local Node server. No form submissions or external requests.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = new URL(process.argv[2] || 'http://127.0.0.1:5191');
assert(origin.protocol === 'http:' && origin.hostname === '127.0.0.1', 'Only isolated loopback HTTP is allowed');
const output = option('output') || 'work/navigation-browser-check';
const { chromium } = await import(option('playwright') || 'playwright');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: option('chromium'), headless: true });
const checks = [], errors = [], failedAssets = [], external = [];
const check = (value, label) => { assert(value, label); checks.push(label); };
let failure;
try {
  for (const locale of ['zh-Hant', 'en']) {
    for (const width of [1280, 801, 800, 768, 701, 700, 360]) {
      const mobile = width <= 800;
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: mobile, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'jiahe_locale', value: locale, url: origin.origin }]);
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin.origin) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (/\.(js|css)(\?|$)/.test(response.url()) && response.status() >= 400) failedAssets.push(response.status()); });
      const label = text => `${locale}/${width}: ${text}`;
      const trigger = page.locator('[aria-controls="navigation-services"]');
      const panel = page.locator('#navigation-services');
      const subsection = page.locator('[aria-controls="navigation-service-range"]');
      const menu = page.locator('.hire-menu-toggle');
      const ready = async () => {
        await page.waitForFunction(() => /Preview|預覽/.test(document.querySelector('.brand-version-mode')?.textContent || ''));
      };
      const reveal = async () => { if (mobile && await menu.getAttribute('aria-expanded') === 'false') await menu.tap(); };
      const expanded = async value => { assert.equal(await trigger.getAttribute('aria-expanded'), String(value)); };
      await page.goto(origin.origin); await ready(); await reveal();
      await trigger.locator('span').click(); await expanded(true);
      check(page.url() === origin.href, label('Label opens without navigation'));
      await trigger.locator('svg').click(); await expanded(false);
      check(page.url() === origin.href, label('Arrow closes the same button without navigation'));
      await trigger.focus(); await page.keyboard.press('Enter'); await expanded(true);
      await page.keyboard.press('Tab');
      check(await panel.locator('a[href="/services"]').evaluate(el => el === document.activeElement), label('Enter opens and Tab reaches service overview'));
      await page.keyboard.press('Escape'); await expanded(false);
      check(await trigger.evaluate(el => el === document.activeElement), label('Escape returns focus to the full trigger'));
      await page.keyboard.press('Space'); await expanded(true);
      await subsection.click();
      check(await page.locator('#navigation-service-range').isVisible(), label('Nested service links expand'));
      check(await page.locator('#navigation-service-range a').count() === 5, label('All five service deep links remain available'));
      await page.keyboard.press('Escape');
      check(await subsection.evaluate(el => el === document.activeElement) && await subsection.getAttribute('aria-expanded') === 'false', label('First Escape closes nested links and restores section focus'));
      await page.keyboard.press('Escape'); await expanded(false);
      if (mobile) {
        await page.keyboard.press('Escape');
        check(await menu.getAttribute('aria-expanded') === 'false' && await menu.evaluate(el => el === document.activeElement), label('Third Escape closes mobile navigation and restores its trigger'));
        await reveal(); await trigger.tap(); await expanded(true); await trigger.tap(); await expanded(false);
        check(true, label('Touch repeats toggle without navigation'));
      }
      await trigger.click(); await page.locator('.home-search-caption').click(); await expanded(false);
      check(true, label('Outside pointer dismisses the navigation'));
      await reveal(); await trigger.click();
      await panel.locator('a[href="/faq"]').focus(); await page.keyboard.press('Tab'); await expanded(false);
      check(await page.locator('.hire-nav-direct').first().evaluate(el => el === document.activeElement), label('Tab exits the group without losing focus'));
      await trigger.click();
      const bounds = await panel.boundingBox(), tab = await trigger.boundingBox();
      check(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= tab.y + tab.height - 1, label('Panel stays within viewport and below its trigger'));
      const aligned = await page.locator('.hire-nav-register').boundingBox();
      check(!mobile ? aligned.x >= (await page.locator('.hire-primary-navigation').boundingBox()).x + (await page.locator('.hire-primary-navigation').boundingBox()).width - 1 : aligned.y < bounds.y, label('Navigation does not overlap employer entry'));
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label('No horizontal overflow'));
      check(await trigger.locator('svg').evaluate(el => getComputedStyle(el).transitionDuration === '0s'), label('Reduced motion removes arrow transition'));
      check(await trigger.innerText() === (locale === 'en' ? 'Services' : '僱傭服務'), label('Trigger uses current language'));
      check(await panel.locator('a[href="/services"]').innerText() === (locale === 'en' ? 'Service overview' : '服務總覽'), label('Overview uses current language'));
      if (width === 1280 || width === 360) await page.screenshot({ path: `${output}/after-${locale}-${width}.png` });
      await panel.locator('a[href="/services"]').click(); await page.waitForURL('**/services'); await ready();
      await expanded(false);
      check(await page.locator('.hire-nav-group.is-current-section').count() === 1, label('Overview navigation closes panel and marks current section'));
      await reveal(); await trigger.click(); await subsection.click();
      const deepLink = page.locator('#navigation-service-range a').first();
      const href = await deepLink.getAttribute('href'); await deepLink.click(); await page.waitForURL(origin.origin + href); await expanded(false);
      check(await page.locator(new URL(origin.origin + href).hash).isVisible(), label('Same-page service anchor remains usable and dismisses menu'));
      await reveal(); await trigger.click(); await panel.locator('a[href="/process"]').click(); await page.waitForURL('**/process'); await ready(); await expanded(false);
      check(true, label('Hiring-process link navigates and dismisses menu'));
      await page.goBack(); await ready(); await expanded(false);
      check(true, label('History navigation does not restore stale open panel'));
      await reveal(); await trigger.click(); await page.locator('.language-switcher').click();
      await page.waitForFunction(previous => document.documentElement.lang !== previous, locale === 'en' ? 'en-HK' : 'zh-Hant-HK');
      await expanded(false);
      check(true, label('Language switch dismisses menu and retains the page'));
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); await page.goto(origin.origin);
  await page.waitForFunction(() => /Preview|預覽/.test(document.querySelector('.brand-version-mode')?.textContent || ''));
  await page.locator('[aria-controls="navigation-services"]').click(); await page.locator('#navigation-services a').first().focus();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForFunction(() => document.activeElement?.classList.contains('hire-menu-toggle'));
  check(await page.locator('.hire-menu-toggle').getAttribute('aria-expanded') === 'false', 'Desktop to mobile restores focus on visible menu trigger');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.activeElement?.classList.contains('hire-nav-link'));
  check(true, 'Mobile to desktop restores focus on visible group trigger');
  const candidates = page.locator('[aria-controls="navigation-candidates"]');
  await candidates.locator('span').click();
  check(await candidates.getAttribute('aria-expanded') === 'true' && page.url() === origin.href, 'Candidate label uses the same disclosure behavior');
  check(await page.locator('#navigation-candidates a[href="/candidates"]').isVisible(), 'All-candidates destination remains explicit');
  await page.locator('[aria-controls="navigation-services"]').click();
  check(await candidates.getAttribute('aria-expanded') === 'false', 'Opening another group closes the previous group');
  await context.close();
  for (const locale of ['zh-Hant', 'en']) {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 900 } });
    await context.addCookies([{ name: 'jiahe_locale', value: locale, url: origin.origin }]);
    const page = await context.newPage(); await page.goto(origin.origin);
    check(await page.locator('#navigation-services a[href="/services"]').isVisible(), `${locale}: No-JavaScript service overview remains visible`);
    check(await page.locator('.hire-nav-fallback-heading').last().isVisible(), `${locale}: No-JavaScript group heading remains visible`);
    check(await page.locator('#navigation-service-range a').first().isVisible(), `${locale}: No-JavaScript deep links remain visible`);
    await context.close();
  }
  check(errors.length === 0, 'No browser runtime errors');
  check(failedAssets.length === 0, 'No failed script or stylesheet assets');
  check(external.length === 0, 'No external requests');
} catch (error) { failure = error.stack; process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(`${output}/browser-report.json`, JSON.stringify({ passed: !failure, checks: checks.length, assertions: checks, errors, failedAssets, external, failure, browserClosed: true, productionRequests: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: !failure, checks: checks.length, failure }));
}
