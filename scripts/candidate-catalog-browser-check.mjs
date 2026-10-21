// Local synthetic catalogue states and mocked employer submission; never target production.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = new URL(process.argv[2] || 'http://127.0.0.1:5192');
assert(origin.protocol === 'http:' && origin.hostname === '127.0.0.1', 'Only isolated loopback is allowed');
const output = option('output') || 'work/candidate-catalog-check';
const { chromium } = await import(option('playwright') || 'playwright');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: option('chromium'), headless: true });
const checks = [], errors = [], unexpectedRequests = [], submitted = [], contrast = [];
const check = (value, label) => { assert(value, label); checks.push(label); };
const candidates = ['甲', '乙'].map((suffix, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`, reference: `LOCAL-TEST-00${index + 1}`, displayName: `合成測試人選${suffix}`,
  services: ['家居清潔'], nationality: '香港', candidateType: '本地求職', age: '32', education: '中學', currentLocation: '香港', languages: ['廣東話'], yearsExperience: '3至5年',
  skills: ['煮食'], employmentType: '兼職', workLocations: ['沙田'], availableFrom: '2026-11-01', expectedSalary: '', salaryUnit: '每月', salaryNegotiable: true,
  summary: '僅供本地介面測試，非真實求職者。', qualifications: '', workExperiences: [], hasPhoto: false, updatedAt: '2026-10-21T00:00:00Z',
}));
let failure;
try {
  for (const locale of ['zh-Hant', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'jiahe_locale', value: locale, url: origin.origin }]);
    let mode = 'empty', submitCount = 0;
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin.origin) { unexpectedRequests.push(url.origin); return route.abort(); }
      if (url.pathname === '/api/candidates') {
        if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'INTERNAL_SENTINEL_DO_NOT_DISPLAY' } });
        if (mode === 'malformed') return route.fulfill({ status: 200, contentType: 'application/json', body: 'INTERNAL_SENTINEL_DO_NOT_DISPLAY' });
        const filtered = ['q', 'service', 'district'].some(key => url.searchParams.has(key));
        const rows = mode === 'populated' || mode === 'filtered' && !filtered ? candidates : [];
        return route.fulfill({ json: { candidates: rows, total: rows.length, page: 1, pageSize: 12 } });
      }
      if (url.pathname === '/api/intake' && request.method() === 'POST') {
        submitted.push(request.postDataJSON()); submitCount++;
        return route.fulfill(submitCount === 1 ? { status: 503, json: { error: 'INTERNAL_SENTINEL_DO_NOT_DISPLAY' } } : { status: 200, json: { reference: 'LOCAL-MOCK-RECEIPT-001' } });
      }
      if (!['GET', 'HEAD'].includes(request.method())) { unexpectedRequests.push(`${request.method()} ${url.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const label = text => `${locale}/${width}: ${text}`;
    const ready = async () => { await page.locator('.candidate-results[aria-busy="false"]').waitFor(); };
    const go = async path => { await page.goto(origin.origin + path); await ready(); };
    const noOverflow = async () => check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label('No horizontal overflow'));
    await go('/candidates');
    check(await page.locator('.candidate-empty[data-state="empty"]').isVisible(), label('Successful unfiltered zero result has its own state'));
    check(await page.locator('.candidate-empty .button.primary').getAttribute('href') === '/employer', label('Employer needs is the primary empty-state action'));
    check(await page.locator('.candidate-empty a[href="/jobseeker"]').isVisible(), label('Jobseeker task remains available separately'));
    check(await page.locator('.candidate-result-toolbar select').count() === 0 && await page.locator('.candidate-card').count() === 0, label('Empty catalogue shows neither pointless sorting nor invented candidates'));
    check(await page.locator('.candidate-utility a').first().evaluate(el => getComputedStyle(el).borderTopColor === 'rgba(0, 0, 0, 0)'), label('Saved and comparison links have lower visual emphasis'));
    const primary = page.locator('.candidate-empty .button.primary');
    check((await primary.boundingBox()).height >= 44, label('Primary empty action meets the 44 CSS px project target'));
    if (width === 390) check((await primary.boundingBox()).y + (await primary.boundingBox()).height <= 844, label('Employer action fits in the initial mobile viewport'));
    await noOverflow();
    const measureContrast = async state => {
    const colours = await page.locator('.candidate-results').evaluate(root => {
      const luminance = values => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const rgb = colour => (colour.match(/[\d.]+/g) || []).map(Number);
      return [...root.querySelectorAll('h2,h3,p,a,button,dt,dd,small')].filter(el => el.getClientRects().length && el.textContent.trim()).map(el => {
        const style = getComputedStyle(el), fg = rgb(style.color); let node = el, bg;
        while (node) { const value = rgb(getComputedStyle(node).backgroundColor); if (value.length === 3 || value[3] === 1) { bg = value; break; } node = node.parentElement; }
        const lights = [luminance(fg.slice(0, 3)), luminance((bg || [255, 255, 255]).slice(0, 3))].sort((a,b) => b-a);
        return { tag: el.tagName, ratio: (lights[0] + .05) / (lights[1] + .05), minimum: parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700 ? 3 : 4.5 };
      });
    });
    contrast.push({ locale, width, state, colours }); check(colours.every(item => item.ratio >= item.minimum), label(`${state} result text meets measured contrast targets`));
    };
    await measureContrast('empty');
    mode = 'filtered';
    const query = new URLSearchParams({ q: '香港', service: '家居清潔', district: '沙田' });
    await go('/candidates?' + query);
    check(await page.locator('.candidate-empty[data-state="filtered"]').isVisible(), label('Filtered zero results stay distinct from the empty public catalogue'));
    await measureContrast('filtered');
    check(await page.locator('.candidate-filter-form input[name="q"]').inputValue() === '香港', label('Free-text query remains verbatim'));
    const target = new URL(await page.locator('.candidate-empty a[href^="/employer"]').getAttribute('href'), origin);
    check(target.searchParams.get('service') === '家居清潔' && target.searchParams.get('district') === '沙田' && !target.searchParams.has('q'), label('Employer CTA carries only supported service/district prefills'));
    const serviceChip = page.locator('.candidate-applied-filters button').filter({ hasText: locale === 'en' ? 'Service type' : '服務類別' });
    await serviceChip.focus(); await page.keyboard.press('Enter'); await ready();
    check(!new URL(page.url()).searchParams.has('service') && new URL(page.url()).searchParams.get('q') === '香港', label('Keyboard removal clears only the chosen condition'));
    check(await page.locator('#candidate-result-heading').evaluate(el => el === document.activeElement), label('Filter removal returns focus to results'));
    check(await page.locator('.candidate-filter-form select[name="district"]').inputValue() === '沙田', label('Other filter values remain intact'));
    if (locale === 'en') check(!(await page.locator('.candidate-applied-filters').innerText()).includes('已套用') && !(await page.locator('.candidate-applied-filters').innerText()).includes('關鍵字'), label('Fixed filter-chip copy is English without translating the query'));
    await page.locator('.candidate-empty button.primary').focus(); await page.keyboard.press('Space'); await ready();
    check(new URL(page.url()).search === '' && await page.locator('.candidate-card').count() === 2, label('Clear-all restores the unfiltered populated state'));
    check(await page.locator('.candidate-result-toolbar select').isVisible(), label('Sorting returns when candidates are present'));
    await page.goBack(); await ready();
    check(await page.locator('.candidate-empty[data-state="filtered"]').isVisible() && await page.locator('.candidate-filter-form input[name="q"]').inputValue() === '香港', label('Browser Back restores applied query and no-match state'));
    mode = 'populated'; await go('/candidates');
    check(await page.locator('.candidate-card h2').first().innerText() === '合成測試人選甲', label('Candidate display names remain untranslated'));
    const card = page.locator('.candidate-card').first(); await card.locator('button').first().click();
    check(await card.locator('button').first().getAttribute('aria-pressed') === 'true', label('Saving a synthetic candidate still works'));
    await card.locator('button').nth(1).click(); check(await page.locator('.candidate-selection-bar').isVisible(), label('Comparison selection still works'));
    check((await card.locator('.candidate-card-main').getAttribute('href')).includes('returnTo='), label('Profile links preserve the search return path'));
    await measureContrast('populated');
    await noOverflow();
    mode = 'error'; await go('/candidates?q=香港');
    check(await page.locator('.candidate-error').isVisible() && await page.locator('.candidate-empty').count() === 0, label('Request failure is not misreported as zero candidates'));
    check(!(await page.locator('.candidate-error').innerText()).includes('INTERNAL_SENTINEL'), label('Internal API error is not exposed'));
    mode = 'malformed';
    const malformedReply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/candidates' && response.status() === 200);
    await page.locator('.candidate-error button').click(); await malformedReply; await ready();
    check(!(await page.locator('.candidate-error').innerText()).includes('INTERNAL_SENTINEL'), label('Malformed-response details are not exposed'));
    mode = 'filtered'; await page.locator('.candidate-error button').click(); await page.locator('.candidate-empty[data-state="filtered"]').waitFor(); await ready();
    check(await page.locator('.candidate-filter-form input[name="q"]').inputValue() === '香港' && await page.locator('.candidate-empty[data-state="filtered"]').isVisible(), label('Retry preserves filter inputs and restores results'));
    // Exercise the actual form controls; intercept every submission locally.
    await page.goto(origin.origin + '/employer');
    const next = () => page.locator('.form-actions button[type="submit"]');
    await page.locator('#field-fullName').fill('合成驗證 香港'); await page.locator('#field-email').fill('not-an-email');
    await next().click(); await page.locator('.error-summary').waitFor();
    check(await page.locator('#field-fullName').inputValue() === '合成驗證 香港' && await page.locator('#field-email').inputValue() === 'not-an-email', label('Client validation preserves the entered name and email'));
    check(await page.locator('#field-phone').getAttribute('aria-required') === 'true' && await page.locator('#field-email').getAttribute('aria-required') === 'false', label('Required phone and optional email remain explicit'));
    check(await page.locator('#field-email').getAttribute('aria-describedby') === 'field-email-error' && await page.locator('#field-email-error').isVisible(), label('Email error stays adjacent and associated with its field'));
    check(submitCount === 0, label('Invalid form never submits'));
    await page.locator('#field-phone').fill('+852 00000005'); await page.locator('#field-email').fill(''); await page.locator('#field-district').selectOption('沙田'); await page.locator('#field-householdAdults').fill('2'); await next().click();
    await page.locator('input[name="services"][value="家居清潔"]').check(); await page.locator('#field-employmentType').selectOption('兼職'); await page.locator('input[name="duties"][value="煮食"]').check(); await next().click();
    await page.locator('#field-startDate').fill('2026-11-01'); await page.locator('#field-schedule').fill('合成測試 星期一上午'); await page.locator('#field-budgetNegotiable').check(); await next().click();
    check(await page.locator('.review-sections').innerText().then(text => text.includes('合成驗證 香港') && text.includes('合成測試 星期一上午')), label('Optional details may be left blank and review retains entered text'));
    await page.locator('#field-consent').check(); await next().click(); await page.locator('.error-summary').waitFor();
    check(await page.locator('.review-sections').innerText().then(text => text.includes('合成驗證 香港') && text.includes('合成測試 星期一上午')), label('Mock submission failure preserves review inputs'));
    check(!(await page.locator('.error-summary').innerText()).includes('INTERNAL_SENTINEL'), label('Mock server failure uses safe user-facing copy'));
    await next().click(); await page.locator('.intake-success').waitFor();
    check(await page.locator('.reference-slip strong').innerText() === 'LOCAL-MOCK-RECEIPT-001', label('Mock success displays its explicit synthetic receipt'));
    check((await page.locator('.intake-success').innerText()).includes(locale === 'en' ? 'We will contact you using the phone number or email you provided.' : '我們會透過你提供的電話或電郵聯絡。'), label('Success explains the next contact step'));
    check(JSON.stringify(submitted.at(-1)) === JSON.stringify(submitted.at(-2)), label('Uncertain retry retains the exact payload and idempotency key'));
    await context.close();
  }
  check(errors.length === 0, 'No browser runtime errors'); check(unexpectedRequests.length === 0, 'No external or unmocked write requests');
} catch (error) { failure = error.stack; process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(`${output}/browser-report.json`, JSON.stringify({ passed: !failure, checks: checks.length, assertions: checks, contrast, errors, unexpectedRequests, mockSubmissions: submitted.length, productionRequests: 0, browserClosed: true, failure }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: !failure, checks: checks.length, failure }));
}
