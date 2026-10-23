// Bill repeat frequencies: the existing ones unchanged, "Every 6 months", and Custom (every N days, weeks
// or months). Due dates are derived from the first due date in local calendar dates; saving a bill never
// records a payment or moves money. Engine checks run in Node (including an exact comparison with the
// previous release's engine); screen checks run on the TEST site and the production candidate.
// Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const F = require('./load-engine.js')();
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

// The engine of the release before this change, read from git (same loader as tests/load-engine.js).
const PREV_COMMIT = 'da8a683dff20aba32521adfcccb79d0b7c98a5e2';
let PREV = null;
try {
  const html = execFileSync('git', ['-C', ROOT, 'show', PREV_COMMIT + ':koboflow.html'], { maxBuffer: 1 << 26 }).toString();
  const m = /<script id="kobo-finance-engine">([\s\S]*?)<\/script>/.exec(html);
  const sb = { module: { exports: {} }, console };
  vm.createContext(sb); vm.runInContext(m[1], sb);
  PREV = sb.module.exports;
} catch (e) { /* not available */ }

const B = (o = {}) => Object.assign({ id: 'b_rent', name: 'Fictional rent', cat: 'Business Overhead', amount: 50000, firstDue: '2026-01-31', repeat: 'monthly', status: 'active', amountChanges: [], overrides: {}, history: [] }, o);
const C = (n, unit, o = {}) => B(Object.assign({ repeat: 'custom', repeatEvery: n, repeatUnit: unit }, o));
const dates = (b, until) => F.billDueDates(b, until);

test('engine: every existing frequency gives exactly the dates the previous release gave', { skip: !PREV && 'previous release not available from git' }, () => {
  const starts = [];
  for (let y = 2026; y <= 2029; y++) for (const md of ['01-01', '01-28', '01-29', '01-30', '01-31', '02-28', '02-29', '03-31', '04-30', '06-15', '08-31', '11-30', '12-25', '12-31'])
    if (F.dateKey(`${y}-${md}`) === `${y}-${md}`) starts.push(`${y}-${md}`); // real dates only (no 29 Feb in non-leap years)
  let compared = 0;
  for (const repeat of ['none', 'weekly', 'monthly', 'quarterly', 'yearly']) for (const firstDue of starts) for (const until of [null, '2027-06-30']) {
    const b = B({ repeat, firstDue, until });
    assert.deepEqual(F.billDueDates(b, '2032-12-31'), Array.from(PREV.billDueDates(b, '2032-12-31')), `${repeat} from ${firstDue}${until ? ' until ' + until : ''}`);
    compared++;
  }
  assert.ok(compared > 400);
  // Labels of the existing values are unchanged.
  for (const r of ['none', 'weekly', 'monthly', 'quarterly', 'yearly']) assert.equal(F.billRepeatLabel(B({ repeat: r })), PREV.BILL_REPEAT[r]);
});

test('engine: every existing frequency still works (spot checks)', () => {
  assert.deepEqual(dates(B({ repeat: 'none', firstDue: '2026-10-20' }), '2030-01-01'), ['2026-10-20']);
  assert.deepEqual(dates(B({ repeat: 'weekly', firstDue: '2026-10-01' }), '2026-10-22'), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
  assert.deepEqual(dates(B({ repeat: 'monthly', firstDue: '2026-10-15' }), '2027-01-15'), ['2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15']);
  assert.deepEqual(dates(B({ repeat: 'quarterly', firstDue: '2026-11-30' }), '2027-06-30'), ['2026-11-30', '2027-02-28', '2027-05-30']);
  assert.deepEqual(dates(B({ repeat: 'yearly', firstDue: '2028-02-29' }), '2030-12-31'), ['2028-02-29', '2029-02-28', '2030-02-28']);
});

test('engine: Every 6 months advances six calendar months, keeping the day (month ends, leap years)', () => {
  assert.equal(F.billRepeatLabel(B({ repeat: 'semiannual' })), 'Every 6 months');
  assert.deepEqual(dates(B({ repeat: 'semiannual', firstDue: '2026-11-01' }), '2028-05-01'), ['2026-11-01', '2027-05-01', '2027-11-01', '2028-05-01']);
  // 31 Aug -> 28 Feb (2027) -> 31 Aug -> 29 Feb (2028, leap) -> 31 Aug: no drift after the short month.
  assert.deepEqual(dates(B({ repeat: 'semiannual', firstDue: '2026-08-31' }), '2028-08-31'), ['2026-08-31', '2027-02-28', '2027-08-31', '2028-02-29', '2028-08-31']);
  assert.deepEqual(dates(C(6, 'months', { firstDue: '2026-08-31' }), '2028-08-31'), dates(B({ repeat: 'semiannual', firstDue: '2026-08-31' }), '2028-08-31'), 'custom 6 months = Every 6 months');
});

test('engine: Custom every 2 and 18 months, and every 1 month equals Monthly', () => {
  assert.equal(F.billRepeatLabel(C(2, 'months')), 'Every 2 months');
  assert.equal(F.billRepeatLabel(C(1, 'months')), 'Every month');
  assert.deepEqual(dates(C(2, 'months', { firstDue: '2026-12-31' }), '2027-08-31'), ['2026-12-31', '2027-02-28', '2027-04-30', '2027-06-30', '2027-08-31']);
  assert.deepEqual(dates(C(18, 'months', { firstDue: '2026-01-15' }), '2030-12-31'), ['2026-01-15', '2027-07-15', '2029-01-15', '2030-07-15']);
  assert.deepEqual(dates(C(1, 'months'), '2026-12-31'), dates(B({ repeat: 'monthly' }), '2026-12-31'));
  assert.deepEqual(dates(C(12, 'months', { firstDue: '2028-02-29' }), '2032-03-01'), ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'], 'the 29th comes back in leap years');
});

test('engine: Custom every 10 days and every 2 weeks use calendar days, across month, leap-day and year boundaries', () => {
  assert.equal(F.billRepeatLabel(C(10, 'days')), 'Every 10 days');
  assert.equal(F.billRepeatLabel(C(2, 'weeks')), 'Every 2 weeks');
  assert.equal(F.billRepeatLabel(C(1, 'days')), 'Every day');
  assert.deepEqual(dates(C(10, 'days', { firstDue: '2026-12-15' }), '2027-01-15'), ['2026-12-15', '2026-12-25', '2027-01-04', '2027-01-14']);
  assert.deepEqual(dates(C(10, 'days', { firstDue: '2028-02-20' }), '2028-03-12'), ['2028-02-20', '2028-03-01', '2028-03-11'], '29 Feb 2028 counts as a day');
  assert.deepEqual(dates(C(2, 'weeks', { firstDue: '2026-12-21' }), '2027-01-31'), ['2026-12-21', '2027-01-04', '2027-01-18']);
  assert.deepEqual(dates(C(2, 'weeks'), '2027-12-31'), dates(C(14, 'days'), '2027-12-31'));
  assert.deepEqual(dates(C(1, 'weeks', { firstDue: '2026-10-01' }), '2027-03-01'), dates(B({ repeat: 'weekly', firstDue: '2026-10-01' }), '2027-03-01'), 'every 1 week = Weekly');
  // A long daily schedule is not cut short (the old 600-date stop).
  const daily = dates(C(1, 'days', { firstDue: '2026-01-01' }), '2029-12-31');
  assert.equal(daily.length, 1461); assert.equal(daily.at(-1), '2029-12-31');
});

test('engine: month ends from 31 January and 30 November, monthly and custom', () => {
  assert.deepEqual(dates(B({ firstDue: '2027-01-31' }), '2027-05-31'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  assert.deepEqual(dates(B({ firstDue: '2028-01-31' }), '2028-03-31'), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.deepEqual(dates(C(3, 'months', { firstDue: '2026-11-30' }), '2027-06-30'), ['2026-11-30', '2027-02-28', '2027-05-30']);
});

test('engine: Ends On stops later dates, for standard and custom repeats', () => {
  assert.deepEqual(dates(B({ repeat: 'semiannual', firstDue: '2026-11-01', until: '2027-11-01' }), '2030-01-01'), ['2026-11-01', '2027-05-01', '2027-11-01'], 'the end date itself is included');
  assert.deepEqual(dates(C(10, 'days', { firstDue: '2026-11-01', until: '2026-11-30' }), '2030-01-01'), ['2026-11-01', '2026-11-11', '2026-11-21']);
  assert.deepEqual(dates(C(2, 'months', { firstDue: '2026-11-01', until: '2027-02-28' }), '2030-01-01'), ['2026-11-01', '2027-01-01']);
});

test('engine: invalid custom intervals are refused with a clear reason; valid limits are accepted', () => {
  const err = b => F.validateBill(b).errors.join(' ');
  for (const [n, unit] of [[0, 'days'], [-2, 'weeks'], [2.5, 'months'], ['2', 'months'], ['', 'days'], [NaN, 'days'], [Infinity, 'days'], [null, 'weeks'], [undefined, 'months'], [3, 'years'], [3, ''], [3, undefined], [366, 'days'], [105, 'weeks'], [121, 'months']])
    assert.match(err(C(n, unit)), /For a custom repeat, enter a whole number and a unit: 1 to 365 days, 1 to 104 weeks, or 1 to 120 months\./, `${String(n)} ${unit}`);
  for (const [n, unit] of [[1, 'days'], [365, 'days'], [104, 'weeks'], [120, 'months']]) assert.deepEqual(F.validateBill(C(n, unit)).errors, [], `${n} ${unit}`);
  assert.deepEqual(F.validateBill(B({ repeat: 'semiannual' })).errors, []);
  // An invalid custom bill (never savable) gives only its first date: nothing is guessed.
  assert.deepEqual(dates(C(0, 'days', { firstDue: '2026-11-01' }), '2027-01-01'), ['2026-11-01']);
  assert.equal(F.billRepeatLabel(C(0, 'days')), 'Custom (not set)');
});

test('engine: older bills without custom fields validate and schedule as before; a paid bill keeps its custom interval', () => {
  const old = { id: 'b_old', name: 'Fictional old rent', cat: 'Business Overhead', amount: 50000, firstDue: '2026-10-20', repeat: 'monthly', status: 'active' }; // no amountChanges, overrides, history or custom fields
  assert.deepEqual(F.validateBill(old).errors, []);
  assert.deepEqual(F.billDueDates(old, '2026-12-31'), ['2026-10-20', '2026-11-20', '2026-12-20']);
  const prev = C(10, 'days', { firstDue: '2026-11-01' });
  assert.match(F.validateBill(C(14, 'days', { firstDue: '2026-11-01' }), { previous: prev, hasPayments: true }).errors.join(' '), /already has payments, so its first due date and repeat cannot change/);
  assert.match(F.validateBill(C(10, 'weeks', { firstDue: '2026-11-01' }), { previous: prev, hasPayments: true }).errors.join(' '), /cannot change/);
  assert.deepEqual(F.validateBill(C(10, 'days', { firstDue: '2026-11-01', name: 'Renamed' }), { previous: prev, hasPayments: true }).errors, []);
});

test('engine: payments are matched only to dates that exist; nothing is unmatched by a long schedule', () => {
  const b = C(1, 'days', { id: 'b_d', firstDue: '2026-01-01' });
  const pay = (id, occ) => ({ id, type: 'obligation', amount: 100, billId: 'b_d', billOcc: 'b_d@' + occ, date: occ, fromAcct: 'opay' });
  // A payment 3 years in (beyond the old 600-date stop) still matches its date; one on a non-date does not.
  assert.deepEqual(F.billUnmatchedPayments([b], [pay(1, '2029-01-01'), pay(2, '2026-03-05')], { today: '2029-01-02' }), []);
  const half = C(2, 'days', { id: 'b_d', firstDue: '2026-01-01' });
  assert.deepEqual(F.billUnmatchedPayments([half], [pay(3, '2026-01-02')], { today: '2026-01-05' }).map(t => t.id), [3]);
});

// ── Screens ─────────────────────────────────────────────────────────────────────────────────────

const BUILDS = [
  { label: 'TEST build', url: '/koboflow-test/', dbName: 'KoboFlowDB-test' },
  { label: 'production candidate', url: '/KoboFlow/', dbName: 'KoboFlowDB' },
];
const TEST = BUILDS[0];
const ALIASES = ['pharma_cash', 'pharma_bank', 'pers_cash', 'pers_bank', 'coop', 'emergency', 'fixed_dep'];

let server, base, browser;
test.before(async () => {
  if (!pw) return;
  const site = Object.fromEntries(gen.buildTestSite());
  const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : p.endsWith('.png') ? 'image/png' : 'text/html';
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (b, t) => { res.writeHead(200, { 'content-type': t, 'cache-control': 'no-cache' }); res.end(b); };
    if (p.startsWith('/koboflow-test/')) { const rel = p.slice(15) || 'index.html'; if (site[rel]) return send(site[rel], type(rel)); }
    if (p.startsWith('/KoboFlow/')) {
      const rel = p.slice(10) || 'index.html';
      const file = rel === 'index.html' ? 'koboflow.html' : rel;
      if (['koboflow.html', 'manifest.json', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png'].includes(file)) return send(fs.readFileSync(path.join(ROOT, file)), type(file === 'koboflow.html' ? 'x.html' : file));
    }
    if (p === '/probe') return send('<!doctype html><title>probe</title>', 'text/html');
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function ctx() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);
const text = (page, sel) => page.textContent(sel);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const appDay = (page, n) => page.evaluate(n => KoboFin.addDays(KoboFin.today(), n), n);
const appMonths = (page, iso, n) => page.evaluate(([d, n]) => KoboFin.addMonths(d, n), [iso, n]);
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
const stored = (context, n, s) => probe(context, ([n, s]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), [n, s]);
const acctBal = async (page, label) => { await nav(page, 'home'); return page.$$eval('.acct-card', (cs, l) => { const c = cs.find(x => x.querySelector('.acct-name').textContent.trim().endsWith(l)); return c ? Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9]/g, '')) : null; }, label); };
const dirRow = async (page, k) => { await nav(page, 'director'); return (await text(page, `#director-body [data-dir-row="${k}"] .autopilot-val`)).trim(); };
const fmtD = (page, iso) => page.evaluate(iso => KoboFin.parseDate(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }), iso);

async function liveSetup(page) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', daysAgo(60));
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=opening]').fill('100000');
  await page.click('#setup-add-acct');
  await row(1).locator('[data-f=label]').fill('Fictional Bank'); await row(1).locator('[data-f=kind]').selectOption('bank'); await row(1).locator('[data-f=opening]').fill('500000');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
// Fills the bill form as a person would. every/unit only when Custom is chosen.
async function fillBill(page, { name, amount, first, repeat, every, unit, until, cat = 'Business Overhead' }) {
  if (name !== undefined) await page.fill('#bill-name', name);
  await page.selectOption('#bill-cat', cat);
  if (amount !== undefined) await page.fill('#bill-amount', String(amount));
  if (first !== undefined) await page.fill('#bill-first', first);
  if (repeat !== undefined) await page.selectOption('#bill-repeat', repeat);
  if (every !== undefined) await page.fill('#bill-every', String(every));
  if (unit !== undefined) await page.selectOption('#bill-unit', unit);
  if (until !== undefined) await page.fill('#bill-until', until);
}
const formClosed = page => page.waitForFunction(() => !document.getElementById('bill-modal').classList.contains('open'));
async function addBill(page, fields) {
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await fillBill(page, fields); await page.click('#bill-save-btn'); await formClosed(page);
}
const billCard = (page, name) => page.$$eval('#bills-list [data-bill]', (cs, n) => { const c = cs.find(x => x.querySelector('b').textContent === n); return c ? c.textContent.replace(/\s+/g, ' ') : null; }, name);

for (const b of BUILDS) {
  test(`${b.label}: "Every 6 months" and Custom are selectable; saving schedules the bill everywhere and moves no money`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    const cash0 = await dirRow(page, 'cash');
    await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
    const options = await page.$$eval('#bill-repeat option', os => os.map(o => [o.value, o.textContent]));
    assert.deepEqual(options, [['none', 'One-time'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Every 3 months'], ['semiannual', 'Every 6 months'], ['yearly', 'Yearly'], ['custom', 'Custom']]);
    assert.equal(await page.isVisible('#bill-every'), false, 'custom controls hidden for a standard repeat');
    await page.selectOption('#bill-repeat', 'semiannual');
    assert.equal(await page.isVisible('#bill-every'), false, 'Every 6 months needs no custom controls');
    await page.selectOption('#bill-repeat', 'custom');
    assert.equal(await page.isVisible('#bill-every'), true); assert.equal(await page.isVisible('#bill-unit'), true);
    await page.selectOption('#bill-repeat', 'monthly');
    assert.equal(await page.isVisible('#bill-every'), false);
    await page.click('[data-close="bill-modal"]'); await formClosed(page);

    const rentFirst = await appDay(page, 2), feeFirst = await appDay(page, 3);
    await addBill(page, { name: 'Fictional shop rent', amount: 300000, first: rentFirst, repeat: 'semiannual' });
    await addBill(page, { name: 'Fictional cleaning', amount: 4000, first: feeFirst, repeat: 'custom', every: 10, unit: 'days' });
    const bills = await stored(context, b.dbName, 'bills');
    const rent = bills.find(x => x.name === 'Fictional shop rent'), clean = bills.find(x => x.name === 'Fictional cleaning');
    assert.equal(rent.repeat, 'semiannual'); assert.equal(rent.firstDue, rentFirst);
    assert.equal('repeatEvery' in rent || 'repeatUnit' in rent, false, 'a standard repeat stores no custom fields');
    assert.equal(clean.repeat, 'custom'); assert.equal(clean.repeatEvery, 10); assert.equal(clean.repeatUnit, 'days');

    // Saving bills recorded no payment and moved no money.
    assert.deepEqual(await stored(context, b.dbName, 'transactions'), []);
    assert.equal(await acctBal(page, 'Opay'), 100000);
    assert.equal(await dirRow(page, 'cash'), cash0);

    // Bills list: label and next date.
    await nav(page, 'bills');
    assert.match(await billCard(page, 'Fictional shop rent'), new RegExp(`Every 6 months[\\s\\S]*next: ${await fmtD(page, rentFirst)}`));
    assert.match(await billCard(page, 'Fictional cleaning'), new RegExp(`Every 10 days[\\s\\S]*next: ${await fmtD(page, feeFirst)}`));
    // Upcoming Obligations on the Brief (14 days): rent in 2 days; cleaning in 3 and 13 days, not 23.
    await nav(page, 'home');
    const ob = (await text(page, '#ob-list')).replace(/\s+/g, ' ');
    assert.match(ob, /Fictional shop rent\s*In 2 days/);
    assert.match(ob, /Fictional cleaning\s*In 3 days/); assert.match(ob, /Fictional cleaning\s*In 13 days/);
    assert.doesNotMatch(ob, /In 23 days/);
    assert.equal((ob.match(/Fictional shop rent/g) || []).length, 1, 'the next rent is six months away');
    // The Director counts each due date once: 300,000 + 4,000 + 4,000 + 4,000 (days 3, 13, 23) within 30 days.
    assert.equal(await dirRow(page, 'uncovered'), '₦312,000');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: invalid custom intervals are refused with a message and nothing is saved; valid limits save', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await fillBill(page, { name: 'Fictional custom', amount: 1000, first: await appDay(page, 5), repeat: 'custom' });
  for (const [every, unit] of [['', 'days'], ['0', 'days'], ['-2', 'weeks'], ['2.5', 'months'], ['366', 'days'], ['105', 'weeks'], ['121', 'months']]) {
    await page.fill('#bill-every', every); await page.selectOption('#bill-unit', unit);
    await page.click('#bill-save-btn');
    await page.waitForSelector('#bill-form-msg .form-err');
    assert.match(await text(page, '#bill-form-msg'), /Not saved yet: For a custom repeat, enter a whole number and a unit: 1 to 365 days, 1 to 104 weeks, or 1 to 120 months\./, `${every} ${unit}`);
    assert.equal(await page.inputValue('#bill-every'), every, 'the typed value is kept, not changed');
    assert.equal(await page.isVisible('#bill-modal.open'), true);
  }
  assert.deepEqual(await stored(context, TEST.dbName, 'bills'), [], 'nothing saved');
  await page.fill('#bill-every', '120'); await page.selectOption('#bill-unit', 'months');
  await page.click('#bill-save-btn'); await formClosed(page);
  const [saved] = await stored(context, TEST.dbName, 'bills');
  assert.equal(saved.repeatEvery, 120); assert.equal(saved.repeatUnit, 'months');
  // A number left in the hidden field is not stored for a standard repeat.
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await fillBill(page, { name: 'Fictional quarterly', amount: 2000, first: await appDay(page, 5), repeat: 'custom', every: 7, unit: 'weeks' });
  await page.selectOption('#bill-repeat', 'quarterly');
  await page.click('#bill-save-btn'); await formClosed(page);
  const q = (await stored(context, TEST.dbName, 'bills')).find(x => x.name === 'Fictional quarterly');
  assert.equal(q.repeat, 'quarterly'); assert.equal('repeatEvery' in q || 'repeatUnit' in q, false);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: editing loads the frequency, keeps other fields, and a paid bill keeps its interval; paying a custom date works once', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const first = await appDay(page, 4), until = await appMonths(page, first, 12);
  await addBill(page, { name: 'Fictional cleaning', amount: 4000, first, repeat: 'custom', every: 10, unit: 'days', until, cat: 'Household' });
  const [b0] = await stored(context, TEST.dbName, 'bills');
  const openEdit = async () => { await nav(page, 'bills'); await page.click(`[data-bill-edit="${b0.id}"]`); await page.waitForSelector('#bill-modal.open'); };

  // Edit: the custom interval is shown as saved; changing only the name keeps everything else.
  await openEdit();
  assert.equal(await page.inputValue('#bill-repeat'), 'custom');
  assert.equal(await page.isVisible('#bill-every'), true);
  assert.equal(await page.inputValue('#bill-every'), '10'); assert.equal(await page.inputValue('#bill-unit'), 'days');
  await page.fill('#bill-name', 'Fictional office cleaning');
  await page.click('#bill-save-btn'); await formClosed(page);
  let [b1] = await stored(context, TEST.dbName, 'bills');
  for (const k of ['id', 'repeat', 'repeatEvery', 'repeatUnit', 'firstDue', 'until', 'cat', 'amount', 'status', 'createdAt']) assert.deepEqual(b1[k], b0[k], `${k} kept`);
  assert.equal(b1.name, 'Fictional office cleaning');

  // Change only the frequency: every 2 weeks. Other fields are kept; the change is in the history.
  await openEdit();
  await page.fill('#bill-every', '2'); await page.selectOption('#bill-unit', 'weeks');
  await page.click('#bill-save-btn'); await formClosed(page);
  [b1] = await stored(context, TEST.dbName, 'bills');
  assert.equal(b1.repeatEvery, 2); assert.equal(b1.repeatUnit, 'weeks');
  for (const k of ['id', 'firstDue', 'until', 'cat', 'amount', 'name', 'status']) assert.ok(k === 'name' ? b1.name === 'Fictional office cleaning' : JSON.stringify(b1[k]) === JSON.stringify(b0[k]), `${k} kept`);
  assert.deepEqual(b1.history.at(-1).changes, [{ field: 'repeatEvery', from: 10, to: 2 }, { field: 'repeatUnit', from: 'days', to: 'weeks' }]);
  await nav(page, 'bills');
  assert.match(await billCard(page, 'Fictional office cleaning'), /Every 2 weeks/);

  // Pay the first date (findOcc finds a custom date); one payment, the balance moves once.
  const occ = await page.getAttribute('#bills-due [data-bill-occ]', 'data-bill-occ');
  assert.equal(occ, `${b0.id}@${first}`);
  await page.click(`[data-bill-pay="${occ}"]`); await page.waitForSelector('#bill-pay-modal.open');
  await page.dblclick('#bill-pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
  await page.waitForTimeout(300);
  const txs = await stored(context, TEST.dbName, 'transactions');
  assert.equal(txs.length, 1); assert.equal(txs[0].billOcc, occ); assert.equal(txs[0].amount, 4000);
  assert.equal(await acctBal(page, 'Opay'), 96000);
  // The bill's next date is now 2 weeks later.
  await nav(page, 'bills');
  assert.match(await billCard(page, 'Fictional office cleaning'), new RegExp(`next: ${await fmtD(page, await appDay(page, 18))}`));

  // With a payment, first date and frequency are fixed (all four controls); editing other fields keeps them.
  await openEdit();
  for (const id of ['bill-first', 'bill-repeat', 'bill-every', 'bill-unit']) assert.equal(await page.isDisabled('#' + id), true, id);
  await page.fill('#bill-name', 'Fictional cleaning (paid)');
  await page.click('#bill-save-btn'); await formClosed(page);
  const [b2] = await stored(context, TEST.dbName, 'bills');
  assert.equal(b2.repeat, 'custom'); assert.equal(b2.repeatEvery, 2); assert.equal(b2.repeatUnit, 'weeks'); assert.equal(b2.firstDue, first);
  assert.equal((await stored(context, TEST.dbName, 'transactions')).length, 1, 'editing created no payment');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: older backups without custom fields import and schedule as before; custom bills import; invalid ones are rejected', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const first = await appDay(page, 5);
  const oldBill = { id: 'bill_old1', name: 'Fictional old water', cat: 'Utilities', amount: 3000, firstDue: first, repeat: 'monthly', status: 'active', amountChanges: [], overrides: {}, history: [] };
  const custom = { id: 'bill_c1', name: 'Fictional fumigation', cat: 'Business Overhead', amount: 15000, firstDue: first, repeat: 'custom', repeatEvery: 6, repeatUnit: 'weeks', status: 'active', amountChanges: [], overrides: {}, history: [] };
  const bad = Object.assign({}, custom, { id: 'bill_bad', name: 'Fictional bad', repeatEvery: 0 });
  const rep = await page.evaluate(d => __kfPlanImport(d).report, { version: '4.0', transactions: [], bills: [oldBill, custom, bad] });
  assert.equal(rep.added.bills, 2); assert.equal(rep.rejected, 1);
  await page.click('#settings-nav-btn');
  await page.setInputFiles('#import-file-input', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: '4.0', transactions: [], bills: [oldBill, custom, bad] })) });
  await page.waitForFunction(() => /Import complete/.test(document.getElementById('toast').textContent || ''));
  const bills = await stored(context, TEST.dbName, 'bills');
  assert.deepEqual(bills.map(x => x.id).sort(), ['bill_c1', 'bill_old1']);
  assert.deepEqual(bills.find(x => x.id === 'bill_old1'), oldBill, 'stored exactly as in the backup');
  assert.deepEqual(bills.find(x => x.id === 'bill_c1'), custom);
  await nav(page, 'bills');
  assert.match(await billCard(page, 'Fictional old water'), new RegExp(`Monthly[\\s\\S]*next: ${await fmtD(page, first)}`));
  assert.match(await billCard(page, 'Fictional fumigation'), /Every 6 weeks/);
  assert.deepEqual(await stored(context, TEST.dbName, 'transactions'), [], 'importing bills recorded no payment');
  assert.equal(await acctBal(page, 'Opay'), 100000);
  assert.deepEqual(page.errors, []);
  await context.close();
});
