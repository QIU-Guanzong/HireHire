// Synthetic receiver only: real browser fetch/stream aborts; never sends intake to the app.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const upstream = new URL(process.argv[2] || 'http://127.0.0.1:18438');
assert(upstream.protocol === 'http:' && upstream.hostname === '127.0.0.1' && upstream.port, 'Isolated loopback only');
const baseline = process.argv.includes('--expect-stuck');
const output = option('output') || 'work/intake-timeout';
await mkdir(output, { recursive: true });
const { chromium } = await import(option('playwright') || 'playwright');
const checks = [], unexpected = [], errors = [];
const check = (value, label) => { assert(value, label); checks.push(label); };
let scenario, failure;
const sockets = new Set();
const receiver = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname === '/api/intake') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks).toString(); const body = JSON.parse(bytes);
    scenario.requests.push(bytes);
    if (!scenario.receipts.has(body.idempotencyKey)) scenario.receipts.set(body.idempotencyKey, 'LOCAL-TIMEOUT-ONLY-001');
    if (scenario.requests.length === 1 && scenario.mode !== 'success') {
      scenario.response = res;
      if (scenario.mode.startsWith('body')) { res.writeHead(scenario.mode === 'body400' ? 400 : 200, { 'Content-Type': 'application/json' }); res.write('{"reference":'); }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reference: scenario.receipts.get(body.idempotencyKey) })); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { unexpected.push(req.method + ' ' + url.pathname); res.writeHead(405); res.end(); return; }
  const forwarded = http.request(new URL(req.url, upstream), { method: req.method, headers: { ...req.headers, host: upstream.host } }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
  forwarded.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(forwarded);
});
receiver.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${receiver.address().port}`;
const browser = await chromium.launch({ executablePath: option('chromium'), headless: true, chromiumSandbox: true });
const poll = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Bounded test condition not reached'); };
try {
  for (const kind of ['employer', 'jobseeker']) for (const [mode, locale, width] of [['headers', 'zh-Hant', 360], ['body200', 'en', 1440], ['body400', 'zh-Hant', 1440], ...(baseline ? [] : [['success', 'en', 360]])]) {
    scenario = { mode, requests: [], receipts: new Map() };
    const label = text => `${kind}/${mode}/${locale}/${width}: ${text}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'jiahe_locale', value: locale, url: origin }]);
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { unexpected.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const data = { fullName: '合成超時測試 原文 ONLY', phone: '+852 00000005', services: ['家居清潔'], employmentType: '兼職', consent: true,
      ...(kind === 'employer' ? { district: '沙田', householdAdults: '2', duties: ['煮食'], startDate: '2026-11-01', schedule: '合成時間 unchanged', budgetNegotiable: true } : { nationality: '香港', currentLocation: '香港', languages: ['廣東話'], yearsExperience: '少於1年', workHistory: '首次求職', workLocations: ['沙田'], availableFrom: '2026-11-01', salaryNegotiable: true }) };
    const draftKey = `jiahe.intake.${kind}.v1`, attemptKey = `jiahe.attempt.${kind}.v1`;
    await page.goto(origin + '/' + kind);
    await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify({ data, step: 3, reviewReached: true, savedAt: new Date().toISOString() })), { key: draftKey, data });
    await page.reload(); await page.locator('.draft-actions .primary').click(); await page.locator('.review-sections').waitFor();
    await page.clock.install();
    const button = page.locator('.form-actions button[type="submit"]');
    // Three synchronous submit events also exercise the ref guard before React rerenders.
    await button.evaluate(el => { for (let i = 0; i < 3; i++) el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await poll(() => scenario.requests.length > 0);
    check(scenario.requests.length === 1, label('Rapid repeated submit sends one request'));
    const first = JSON.parse(scenario.requests[0]); check(JSON.stringify(first.data) === JSON.stringify(data), label('Original user data preserved verbatim'));
    if (mode === 'success') {
      await page.locator('.intake-success').waitFor(); await page.clock.fastForward(61000);
      check(await page.locator('.intake-success').isVisible() && await page.locator('.error-summary').count() === 0, label('Completed response stays successful after timeout deadline'));
    } else {
      await page.clock.fastForward(31000);
      if (baseline) {
        check(await button.isDisabled(), label('BUG reproduced: still submitting after 31 seconds'));
        check(await page.locator('.form-actions button.secondary').isDisabled(), label('BUG reproduced: back remains locked'));
      } else {
        await poll(async () => !(await button.isDisabled()));
        check((await button.innerText()).includes(locale === 'en' ? 'Retry confirmation' : '重試確認'), label('Timeout offers confirmation retry'));
        check(await page.locator('.form-actions button.secondary').isDisabled(), label('Unknown outcome keeps original envelope locked'));
        const stored = await page.evaluate(({ draftKey, attemptKey }) => ({ draft: JSON.parse(localStorage.getItem(draftKey)), attempt: JSON.parse(sessionStorage.getItem(attemptKey)) }), { draftKey, attemptKey });
        check(stored.draft.pending === true && stored.draft.attempt.key === first.idempotencyKey && stored.attempt.key === first.idempotencyKey, label('Pending draft and idempotency key survive timeout'));
        check(JSON.stringify(stored.draft.data) === JSON.stringify(data), label('Saved draft retains original text'));
        check((await page.locator('.error-summary').innerText()).includes(locale === 'en' ? 'could not be confirmed' : '未能確認提交結果'), label('Localized error does not claim rejection'));
        if (mode === 'headers') {
          await page.screenshot({ path: `${output}/${kind}-timeout-mobile.png`, fullPage: true });
          await page.reload(); await page.locator('.draft-actions .primary').click(); await page.locator('.review-sections').waitFor();
          check((await button.innerText()).includes('重試確認'), label('Reload restores uncertain submission for confirmation'));
        }
        await button.click(); await page.locator('.intake-success').waitFor();
        check(scenario.requests.length === 2 && scenario.requests[0] === scenario.requests[1], label('Confirmation retry uses byte-identical envelope and original key'));
      }
    }
    if (!baseline) {
      check(scenario.receipts.size === 1, label('Exactly one synthetic receipt despite retries'));
      check(await page.locator('.reference-slip strong').innerText() === 'LOCAL-TIMEOUT-ONLY-001', label('Same receipt shown once'));
      check(await page.locator('.reference-slip').count() === 1, label('No duplicate success receipt'));
      check(await page.evaluate(({ draftKey, attemptKey }) => localStorage.getItem(draftKey) === null && sessionStorage.getItem(attemptKey) === null, { draftKey, attemptKey }), label('Draft cleared only after confirmed success'));
    }
    scenario.response?.destroy(); await context.close();
  }
  check(unexpected.length === 0, 'No requests outside isolated proxy; no other writes');
  check(errors.length === 0, 'No uncaught browser errors');
} catch (error) { failure = error; }
finally { await browser.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => receiver.close(resolve)); }
const report = { passed: !failure, baselineBugReproduced: baseline && !failure, checks: checks.length, assertions: checks, syntheticOnly: true, productionWrites: 0, errors, failure: failure?.message };
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (failure) throw failure;
