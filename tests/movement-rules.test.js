// MOVEMENT RULES: "Not used" (unresolved) versus "Outside KoboFlow / untracked" (F.OUTSIDE) for the
// sides of transfers, owner withdrawals and contributions. Recorded balances apply the mapped side only
// and never invent the other; money received from an unresolved side stays in the recorded balance but is
// excluded from confirmed pharmacy cash (at most what the account holds) until reconciled. Stored entries
// are never changed. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const F = require('./load-engine')();

const ROOT = path.join(__dirname, '..');
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

/* ── Engine ──────────────────────────────────────────────────── */
const O = F.OUTSIDE;
const BASE = '2026-10-01', D = '2026-10-05';
const CONF = { useConfirmedAt: '2026-10-01T00:00:00Z' };
const OPAY = { id: 'acc_opay', label: 'Opay', kind: 'wallet', opening: 100000, use: 'business', useConfirmedValue: 'business', ...CONF };
const BANK = { id: 'acc_bank', label: 'Test Bank', kind: 'bank', opening: 50000, use: 'business', useConfirmedValue: 'business', ...CONF };
const PERS = { id: 'acc_pers', label: 'Personal Test', kind: 'bank', opening: 10000, use: 'personal', useConfirmedValue: 'personal', ...CONF };
const ACCTS = [OPAY, BANK, PERS], IDS = ACCTS.map(a => a.id);
const MAP = (over = {}) => ({ pharma_cash: 'acc_opay', pharma_bank: 'acc_bank', pers_cash: '', pers_bank: '', coop: '', emergency: '', fixed_dep: '', ...over });
const bal = (txns, aliases, baselineDate = BASE) => F.accountBalances(ACCTS, txns, { baselineDate, aliases });
const total = b => Object.values(b).reduce((s, x) => s + x, 0);
const status = (t, aliases) => [F.sideStatus(t, 'from', aliases, IDS).status, F.sideStatus(t, 'to', aliases, IDS).status];
// Confirmed pharmacy cash exactly as the app computes it: recorded balances, then held-back unresolved inflows.
function pharmacy(txns, aliases) {
  const b = bal(txns, aliases), accts = ACCTS.map(a => ({ ...a, balance: b[a.id] }));
  const held = F.unreconciledInflows(ACCTS, txns, { baselineDate: BASE, aliases });
  return { balances: b, held, pos: F.pharmacyCashPosition(accts, [], { unreconciled: held.byAccount }) };
}
const quality = (txns, aliases) => Object.fromEntries(F.dataQuality({ txns, accountIds: IDS, aliases, baselineDate: BASE, today: '2026-10-28' }).map(q => [q.key, q]));

test('a transfer mapped on both sides moves money between the accounts, keeps the total, and is neither income nor expense', () => {
  const t = { id: 1, type: 'transfer', amount: 5000, fromAcct: 'pharma_cash', toAcct: 'pharma_bank', date: D };
  assert.deepEqual(status(t, MAP()), ['mapped', 'mapped']);
  const b = bal([t], MAP());
  assert.deepEqual([b.acc_opay, b.acc_bank], [95000, 55000]);
  assert.equal(total(b), total(bal([], MAP())));
  const c = F.classifyTxn(t);
  assert.deepEqual([c.income, c.expense, c.internal], [0, 0, 5000]);
  const p = pharmacy([t], MAP());
  assert.equal(p.held.total, 0);
  assert.equal(p.pos.available, 150000, 'all of it is confirmed pharmacy cash');
});

test('mapped source, outside destination: only the source falls, nothing is invented, it is flagged outside, nothing is held', () => {
  const t = { id: 2, type: 'transfer', amount: 5000, fromAcct: 'pharma_cash', toAcct: 'pers_bank', date: D };
  const al = MAP({ pers_bank: O });
  assert.deepEqual(status(t, al), ['mapped', 'outside']);
  const b = bal([t], al);
  assert.deepEqual(b, { acc_opay: 95000, acc_bank: 50000, acc_pers: 10000 });
  const q = quality([t], al);
  assert.deepEqual(q.outside_account.ids, [2]);
  assert.equal(q.unmapped_account, undefined, 'an outside side is not reported as unmapped');
  assert.equal(pharmacy([t], al).held.total, 0);
});

test('outside source, mapped destination: only the destination rises and it counts as confirmed pharmacy cash', () => {
  const t = { id: 3, type: 'transfer', amount: 7000, fromAcct: 'pers_cash', toAcct: 'pharma_bank', date: D };
  const al = MAP({ pers_cash: O });
  assert.deepEqual(status(t, al), ['outside', 'mapped']);
  const p = pharmacy([t], al);
  assert.equal(p.balances.acc_bank, 57000);
  assert.equal(p.held.total, 0);
  assert.equal(p.pos.available, 157000);
  assert.deepEqual(quality([t], al).outside_account.ids, [3]);
});

test('"Not used" source, mapped destination: the recorded balance rises, but the amount is held out of confirmed pharmacy cash', () => {
  const t = { id: 4, type: 'transfer', amount: 7000, fromAcct: 'pers_cash', toAcct: 'pharma_bank', date: D };
  const al = MAP();
  assert.deepEqual(status(t, al), ['unresolved', 'mapped']);
  const p = pharmacy([t], al);
  assert.equal(p.balances.acc_bank, 57000, 'recorded balance includes it');
  assert.deepEqual(p.held.byAccount, { acc_bank: 7000 });
  assert.equal(p.pos.available, 150000, 'confirmed pharmacy cash leaves it out');
  const w = p.pos.warnings.find(x => x.key === 'unreconciled_inflow');
  assert.equal(w.accountId, 'acc_bank'); assert.equal(w.excluded, 7000);
  const q = quality([t], al);
  assert.deepEqual(q.unreconciled_inflow.ids, [4]);
  assert.match(q.unreconciled_inflow.text, /₦7,000 in 1 entry was received from an unresolved account/);
  assert.deepEqual(q.unmapped_account.ids, [4]);
});

test('mapped source, "Not used" destination: the known outflow applies and the destination is flagged; nothing is held', () => {
  const t = { id: 5, type: 'transfer', amount: 5000, fromAcct: 'pharma_cash', toAcct: 'pers_bank', date: D };
  const al = MAP();
  assert.deepEqual(status(t, al), ['mapped', 'unresolved']);
  const p = pharmacy([t], al);
  assert.equal(p.balances.acc_opay, 95000);
  assert.equal(p.held.total, 0);
  assert.equal(p.pos.available, 145000);
  assert.deepEqual(F.movementReview(ACCTS, [t], { baselineDate: BASE, aliases: al }).unresolved.map(e => e.id), [5]);
});

test('"Not used" and Outside give the same recorded balances but different status, warnings and confirmed cash', () => {
  const txns = [{ id: 6, type: 'transfer', amount: 4000, fromAcct: 'pers_cash', toAcct: 'pharma_cash', date: D },
    { id: 7, type: 'transfer', amount: 1000, fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: D }];
  const notUsed = pharmacy(txns, MAP()), outside = pharmacy(txns, MAP({ pers_cash: O }));
  assert.deepEqual(notUsed.balances, outside.balances, 'the recorded balance rule is the same');
  assert.equal(notUsed.pos.available, 150000 + 3000 - 4000, "the 4,000 received from \"Not used\" is held"); assert.equal(outside.pos.available, 150000 + 3000);
  assert.deepEqual(F.movementReview(ACCTS, txns, { baselineDate: BASE, aliases: MAP() }).unresolved.map(e => e.id), [6, 7]);
  assert.deepEqual(F.movementReview(ACCTS, txns, { baselineDate: BASE, aliases: MAP({ pers_cash: O }) }).outside.map(e => e.id), [6, 7]);
});

test('owner withdrawals: always an owner withdrawal (never an expense); pharmacy cash falls in every mapping state', () => {
  const ow = { id: 10, type: 'owner_withdrawal', amount: 20000, fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: D };
  const c = F.classifyTxn(ow);
  assert.deepEqual([c.ownerOut, c.expense, c.income], [20000, 0, 0]);
  const cases = [
    ['to a mapped personal account', MAP({ pers_cash: 'acc_pers' }), ow, ['mapped', 'mapped'], 10000 + 20000],
    ['to "Not used"', MAP(), ow, ['mapped', 'unresolved'], 10000],
    ['to Outside', MAP({ pers_cash: O }), ow, ['mapped', 'outside'], 10000],
    ['with no destination (outside by its meaning)', MAP(), { ...ow, toAcct: '' }, ['mapped', 'outside'], 10000],
  ];
  for (const [label, al, t, st, persBal] of cases) {
    assert.deepEqual(status(t, al), st, label);
    const p = pharmacy([t], al);
    assert.equal(p.balances.acc_opay, 80000, label);
    assert.equal(p.balances.acc_pers, persBal, label);
    assert.equal(p.held.total, 0, label);
    assert.equal(p.pos.available, 130000, `${label}: pharmacy cash is reduced`);
  }
});

test('owner contributions: increase the pharmacy account, are capital (never sales or income); an unresolved source is held', () => {
  const ci = { id: 20, type: 'capital_injection', amount: 30000, fromAcct: '', toAcct: 'pharma_bank', date: D, cat: 'Capital Injection' };
  const c = F.classifyTxn(ci);
  assert.deepEqual([c.capitalIn, c.income], [30000, 0]);
  const cases = [
    ['with no source (outside by its meaning)', MAP(), ci, ['outside', 'mapped'], 0],
    ['from Outside', MAP({ pers_cash: O }), { ...ci, fromAcct: 'pers_cash' }, ['outside', 'mapped'], 0],
    ['from "Not used"', MAP(), { ...ci, fromAcct: 'pers_cash' }, ['unresolved', 'mapped'], 30000],
    ['from a mapped personal account', MAP({ pers_cash: 'acc_pers' }), { ...ci, fromAcct: 'pers_cash' }, ['mapped', 'mapped'], 0],
  ];
  for (const [label, al, t, st, held] of cases) {
    assert.deepEqual(status(t, al), st, label);
    const p = pharmacy([t], al);
    assert.equal(p.balances.acc_bank, 80000, label);
    assert.equal(p.held.total, held, label);
    assert.equal(p.pos.available, 150000 + 30000 - held, label);
  }
});

test('no double counting: held money is never more than the account holds, and each entry is held once', () => {
  // 50,000 received from "Not used", then 140,000 spent from the same account: only what is left is held.
  const txns = [{ id: 30, type: 'transfer', amount: 50000, fromAcct: 'pers_cash', toAcct: 'pharma_cash', date: D },
    { id: 31, type: 'expense', amount: 140000, fromAcct: 'pharma_cash', toAcct: '', date: D }];
  const p = pharmacy(txns, MAP());
  assert.equal(p.balances.acc_opay, 10000);
  assert.equal(p.held.byAccount.acc_opay, 50000);
  const w = p.pos.warnings.find(x => x.key === 'unreconciled_inflow');
  assert.equal(w.excluded, 10000, 'only the 10,000 still in the account is held back');
  assert.equal(p.pos.accounts.acc_opay.balance, 0, 'confirmed cash for the account is 0, never negative from double deduction');
  assert.equal(p.pos.available, 50000);
  // A negative recorded balance is shown as it is; nothing more is subtracted.
  const neg = pharmacy([...txns, { id: 32, type: 'expense', amount: 30000, fromAcct: 'pharma_cash', date: D }], MAP());
  assert.equal(neg.pos.accounts.acc_opay.balance, -20000);
  // Two held entries into one account add once each.
  const two = pharmacy([txns[0], { ...txns[0], id: 33 }], MAP());
  assert.deepEqual([two.held.byAccount.acc_opay, two.held.entries.length], [100000, 2]);
  assert.equal(two.pos.available, 150000);
});

test('ambiguous empty sides: a transfer or investment with an empty side is unresolved; an expense with no account is missing_account only', () => {
  const txns = [{ id: 40, type: 'transfer', amount: 100, fromAcct: 'pharma_cash', toAcct: '', date: D },
    { id: 41, type: 'investment', amount: 200, fromAcct: 'pharma_cash', toAcct: '', date: D },
    { id: 42, type: 'expense', amount: 300, fromAcct: '', date: D }];
  assert.deepEqual(status(txns[0], MAP()), ['mapped', 'unresolved']);
  assert.deepEqual(status(txns[1], MAP()), ['mapped', 'unresolved']);
  const q = quality(txns, MAP());
  assert.deepEqual(q.unresolved_side.ids, [40, 41]);
  assert.deepEqual(q.missing_account.ids, [42]);
  assert.deepEqual(bal(txns, MAP()), { acc_opay: 99700, acc_bank: 50000, acc_pers: 10000 }, 'recorded balances are unchanged by the rule');
});

test('entries before the baseline are never held or listed', () => {
  const t = { id: 50, type: 'transfer', amount: 9000, fromAcct: 'pers_cash', toAcct: 'pharma_cash', date: '2026-09-30' };
  assert.equal(pharmacy([t], MAP()).held.total, 0);
  assert.deepEqual(F.movementReview(ACCTS, [t], { baselineDate: BASE, aliases: MAP() }), { unresolved: [], outside: [] });
});

test('mapping-impact preview equals the calculated changes, with Outside included, and Not used → Outside is not "half-mapped"', () => {
  const txns = [{ id: 60, type: 'owner_withdrawal', amount: 7000, fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: D },
    { id: 61, type: 'transfer', amount: 5000, fromAcct: 'pers_cash', toAcct: 'pers_bank', date: D },
    { id: 62, type: 'transfer', amount: 2500, fromAcct: 'pers_cash', toAcct: 'pharma_bank', date: D },
    { id: 63, type: 'expense', amount: 3000, fromAcct: 'pers_cash', date: D }];
  const stored = JSON.stringify(txns);
  const targets = ['', O, 'acc_opay', 'acc_pers'], maps = [];
  for (const a of targets) for (const b of targets) maps.push(MAP({ pers_cash: a, pers_bank: b }));
  for (const from of maps) for (const to of maps) {
    const im = F.mappingImpact(ACCTS, txns, { baselineDate: BASE, fromAliases: from, toAliases: to }), x = bal(txns, from), y = bal(txns, to);
    for (const k of IDS) assert.equal(im.perAccount[k] || 0, y[k] - x[k]);
    assert.equal(im.total, total(y) - total(x));
  }
  // Pharmacy Cash → Opay, Personal Cash from Not used to Outside: balances do not change; nothing is half-mapped.
  const im = F.mappingImpact(ACCTS, txns, { baselineDate: BASE, fromAliases: MAP(), toAliases: MAP({ pers_cash: O }) });
  assert.deepEqual(im, { entries: [], perAccount: {}, total: 0 });
  // Personal Cash from Outside to an account: the withdrawal is now fully mapped, the transfer to Test Bank is not held.
  const im2 = F.mappingImpact(ACCTS, txns, { baselineDate: BASE, fromAliases: MAP({ pers_cash: O }), toAliases: MAP({ pers_cash: 'acc_pers' }) });
  assert.equal(im2.entries.find(e => e.id === 60).halfMapped, false);
  assert.equal(im2.entries.find(e => e.id === 61).halfMapped, true, 'pers_bank is still "Not used"');
  assert.deepEqual([F.unreconciledInflows(ACCTS, txns, { baselineDate: BASE, aliases: MAP() }).total,
    F.unreconciledInflows(ACCTS, txns, { baselineDate: BASE, aliases: MAP({ pers_cash: O }) }).total], [2500, 0]);
  assert.equal(JSON.stringify(txns), stored, 'stored entries unchanged');
});

test('setup validation accepts Outside, still rejects an unknown account, and explains each choice', () => {
  const s = { baselineDate: BASE, accounts: [{ ...OPAY, primary: true }, BANK], buckets: [], aliases: MAP({ pers_cash: O }) };
  const txns = [{ id: 70, type: 'owner_withdrawal', amount: 1, fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: D },
    { id: 71, type: 'transfer', amount: 1, fromAcct: 'pers_bank', toAcct: 'pharma_bank', date: D }];
  const v = F.validateSetup(s, txns, '2026-10-28');
  assert.equal(v.ok, true, v.errors.join(' '));
  assert.ok(v.info.some(x => /"Personal Cash", set to Outside KoboFlow: that side is not tracked/.test(x)));
  assert.ok(v.warnings.some(x => /"Personal Bank" but it is set to "Not used": that side moves no balance and stays unresolved/.test(x)));
  assert.match(F.validateSetup({ ...s, aliases: MAP({ pers_cash: '__unknown' }) }, [], '2026-10-28').errors.join(' '), /"Personal Cash" is mapped to an account that no longer exists/);
});

/* ── Browser: both builds; capture, setup preview, Net Worth, imports and restores ── */
const BUILDS = [
  { label: 'TEST build', url: '/koboflow-test/', dbName: 'KoboFlowDB-test' },
  { label: 'production candidate', url: '/KoboFlow/', dbName: 'KoboFlowDB' },
];
const ALIASES = Object.keys(MAP());
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
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function freshPage(b) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-28T09:00:00') });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  const ready = async () => { await page.goto(base + b.url); await page.waitForSelector('body[data-kf-ready="1"]'); };
  const idb = (store, key) => page.evaluate(([n, store, key]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const s = q.result.transaction(store).objectStore(store); const g = key ? s.get(key) : s.getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), [b.dbName, store, key]);
  const put = recs => page.evaluate(([n, recs]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'), s = tx.objectStore('transactions'); recs.forEach(r => s.put(r)); tx.oncomplete = () => { q.result.close(); res(); }; }; }), [b.dbName, recs]);
  const balances = async () => { await page.click('.nav-btn[data-screen="home"]'); return Object.fromEntries(await page.$$eval('.acct-card', cs => cs.map(c => [c.querySelector('.acct-name').textContent.replace(/[^A-Za-z ]/g, '').trim(), Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9-]/g, ''))]))); };
  const confirmed = async () => { await page.click('.nav-btn[data-screen="networth"]'); return page.$eval('#nw-assets-list', el => ({ value: Number(el.querySelector('.nw-row .nw-row-val').textContent.replace(/[^0-9-]/g, '')), held: [...el.querySelectorAll('[data-held-note]')].map(n => n.textContent) })); };
  return { context, page, errors, ready, txns: () => idb('transactions'), setupRec: () => idb('meta', 'ledgerSetup'), put, balances, confirmed };
}
// Live setup: Opay (Business, 100,000) and Personal Test (Personal, 10,000). Pharmacy Cash → Opay; others as given.
async function liveSetup(page, aliases) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', BASE);
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=use]').selectOption('business'); await row(0).locator('[data-f=opening]').fill('100000');
  await page.click('#setup-add-acct'); await row(1).locator('[data-f=label]').fill('Personal Test'); await row(1).locator('[data-f=kind]').selectOption('bank');
  await row(1).locator('[data-f=use]').selectOption('personal'); await row(1).locator('[data-f=opening]').fill('10000');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, aliases[k] !== undefined ? aliases[k] : (k === 'pharma_cash' ? 'acc_opay' : ''));
  await page.click('#setup-save-btn'); await page.waitForSelector('#setup-confirm-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}

for (const b of BUILDS) {
  test(`${b.label}: Quick Capture keeps the raw legacy id when its mapping is "Not used"; Outside and back move nothing and keep entries unchanged`, { skip }, async () => {
    const { context, page, errors, ready, txns, setupRec, balances, confirmed } = await freshPage(b);
    await ready();
    await liveSetup(page, {});
    await page.fill('#capture-input', '5000 owner withdrawal'); await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    const ow = (await txns()).find(t => !t.demo && t.type === 'owner_withdrawal');
    assert.equal(ow.fromAcct, 'acc_opay', 'the mapped side resolves');
    assert.equal(ow.toAcct, 'pers_cash', 'the "Not used" side keeps its legacy id instead of becoming empty');
    assert.equal(ow.state, 'Needs Review', 'an unresolved side is marked for review, as before');
    await page.click('.nav-btn[data-screen="timeline"]');
    assert.match(await page.textContent('#screen-timeline'), /Opay > Personal Cash \(not mapped\)/);
    assert.deepEqual(await balances(), { Opay: 95000, 'Personal Test': 10000 });
    assert.equal((await confirmed()).value, 95000, 'the known pharmacy outflow applies');
    const stored = JSON.stringify(await txns());
    // Map Personal Cash to Outside: preview shows the entry is no longer unresolved; balances do not move.
    await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
    assert.equal(await page.getAttribute('#setup-preview [data-unresolved-movements]', 'data-unresolved-movements'), '1');
    await page.selectOption('#setup-aliases [data-alias="pers_cash"]', F.OUTSIDE);
    assert.equal(await page.$('#setup-preview [data-unresolved-movements]'), null, 'nothing unresolved after the change');
    assert.equal(await page.$('#setup-preview [data-mapping-impact]'), null, 'no balance moves');
    await page.click('#setup-save-btn'); await page.waitForSelector('#setup-confirm-btn');
    assert.match(await page.textContent('#setup-confirm'), /Quick-capture "Personal Cash": Not used → Outside KoboFlow/);
    await page.click('#setup-confirm-btn'); await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    assert.equal((await setupRec()).aliases.pers_cash, F.OUTSIDE);
    await ready();
    assert.deepEqual(await balances(), { Opay: 95000, 'Personal Test': 10000 });
    await page.click('.nav-btn[data-screen="timeline"]');
    assert.match(await page.textContent('#screen-timeline'), /Opay > Personal Cash \(outside KoboFlow\)/);
    assert.equal(JSON.stringify(await txns()), stored, 'stored entries unchanged');
    await page.click('.nav-btn[data-screen="home"]');
    await page.fill('#capture-input', '3000 owner withdrawal'); await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    const ow2 = (await txns()).find(t => !t.demo && t.type === 'owner_withdrawal' && t.amount === 3000);
    assert.deepEqual([ow2.fromAcct, ow2.toAcct, ow2.state], ['acc_opay', 'pers_cash', 'AI Categorized'], 'Outside is a deliberate choice: not marked for review');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test(`${b.label}: an unresolved inflow is in the recorded balance but held out of confirmed pharmacy cash; the preview shows it before saving`, { skip }, async () => {
    const { context, page, errors, ready, txns, put, balances, confirmed } = await freshPage(b);
    await ready();
    await liveSetup(page, {});
    await put([{ id: 800, type: 'transfer', amount: 5000, desc: 'Fictional top-up', cat: 'Savings', fromAcct: 'pers_cash', toAcct: 'acc_opay', date: '2026-10-05', time: '09:00', state: 'Manual' }]);
    await ready();
    const stored = JSON.stringify(await txns());
    assert.deepEqual(await balances(), { Opay: 105000, 'Personal Test': 10000 }, 'recorded balance includes it');
    const c = await confirmed();
    assert.equal(c.value, 100000, 'confirmed pharmacy cash leaves it out');
    assert.match(c.held.join(' '), /₦5,000 received into "Opay" came from an account that is not resolved/);
    // Preview of mapping Personal Cash to Personal Test: held 5,000 → 0, and the balances that move.
    await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
    const persId = (await page.evaluate(n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('ledgerSetup'); g.onsuccess = () => { q.result.close(); res(g.result.accounts.find(a => a.label === 'Personal Test').id); }; }; }), b.dbName));
    await page.selectOption('#setup-aliases [data-alias="pers_cash"]', persId);
    await page.click('#setup-save-btn'); await page.waitForSelector('#setup-confirm-btn');
    const card = await page.$('#setup-confirm [data-held-after]');
    assert.deepEqual([await card.getAttribute('data-held-before'), await card.getAttribute('data-held-after')], ['5000', '0']);
    assert.match(await page.textContent('#setup-confirm [data-mapping-impact]'), /Personal Test -₦5,000/);
    await page.click('#setup-confirm-btn'); await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    await ready();
    assert.deepEqual(await balances(), { Opay: 105000, 'Personal Test': 5000 });
    const c2 = await confirmed();
    assert.deepEqual([c2.value, c2.held], [105000, []], 'reconciled by mapping: confirmed again');
    assert.equal(JSON.stringify(await txns()), stored, 'stored entries unchanged');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('TEST build: imports with legacy ids are kept as recorded and explained; a backup with an Outside mapping restores; an unknown mapping is refused', { skip }, async () => {
  const b = BUILDS[0];
  // Restore into an empty database: a setup that uses Outside is accepted and keeps its meaning.
  {
    const { context, page, errors, ready } = await freshPage(b);
    await ready();
    const setup = { id: 'ledgerSetup', mode: 'live', baselineDate: BASE, accounts: [{ id: 'acc_opay', label: 'Opay', kind: 'wallet', use: 'business', primary: true, opening: 100000 }], buckets: [],
      aliases: { ...MAP(), pharma_bank: 'acc_opay', pers_cash: F.OUTSIDE }, history: [] };
    const ok = await page.evaluate(d => __kfPlanImport(d), { version: '4.0', transactions: [], ledgerSetup: setup });
    const restored = ok.ops.find(o => o.store === 'meta');
    assert.ok(restored, ok.report.notes.join(' '));
    assert.equal(restored.put.aliases.pers_cash, F.OUTSIDE, 'Outside is kept, never turned into "Not used"');
    const bad = await page.evaluate(d => __kfPlanImport(d).report, { version: '4.0', transactions: [], ledgerSetup: { ...setup, aliases: { ...setup.aliases, pers_cash: '__from_a_newer_version' } } });
    assert.equal(bad.rejected, 1, 'a mapping this build does not understand is refused, not reinterpreted');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Import into a live setup: entries keep their legacy ids and the report says how they will be read.
  {
    const { context, page, errors, ready, txns } = await freshPage(b);
    await ready();
    await liveSetup(page, {});
    const before = JSON.stringify((await txns()).filter(t => !t.demo));
    const incoming = [
      { id: 900, type: 'transfer', amount: 6000, desc: 'Old top-up', cat: 'Savings', fromAcct: 'pers_cash', toAcct: 'pharma_cash', date: '2026-10-06', time: '09:00', state: 'Manual' },
      { id: 901, type: 'owner_withdrawal', amount: 2000, desc: 'Old withdrawal', cat: 'Owner Withdrawal', fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: '2026-10-07', time: '09:00', state: 'Manual' },
    ];
    const plan = await page.evaluate(d => __kfPlanImport(d), { version: '4.0', transactions: incoming });
    assert.deepEqual(plan.ops.filter(o => o.store === 'transactions').map(o => [o.put.fromAcct, o.put.toAcct]), [['pers_cash', 'pharma_cash'], ['pharma_cash', 'pers_cash']], 'kept as recorded');
    const notes = plan.report.notes.join(' ');
    assert.match(notes, /2 imported entries use quick-capture account names/);
    assert.match(notes, /2 imported entries have an unresolved account side/);
    assert.match(notes, /₦6,000 received from unresolved accounts will not count as confirmed pharmacy cash/);
    assert.equal(JSON.stringify((await txns()).filter(t => !t.demo)), before, 'planning an import changes nothing');
    assert.deepEqual(errors, []);
    await context.close();
  }
});
