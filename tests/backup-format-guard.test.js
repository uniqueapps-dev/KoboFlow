// STAGE 0 — backup reader compatibility guard and the per-site new-financial-format switch
// (docs/personal-money-separation-design.md, sections 15.2–15.5 and stage 0 of section 23).
// Runs the Stage 0 acceptance matrix on the TEST build and the production candidate (switch OFF),
// and on in-memory builds with the switch ON where a row needs it. Evidence of "no partial write":
// every object store is snapshotted before and after each operation (every record, serialised as JSON)
// and compared; during a refused import the tests also count read-write transactions on the app
// database, calls into the storage layer (atomic, atomicIf, table put/add: the only routes from the
// app to the database) and confirmation prompts — all must be 0, so the refusal came before planning
// finished, before any prompt and before any write was attempted.
// Not covered (and not claimed): browser-process crashes, operating-system crashes or power loss, and
// browsers other than Chromium.
// Fictional data only; every browser context is a fresh, disposable profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const F = require('./load-engine')();

const ROOT = path.join(__dirname, '..');
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

/* ── Fixtures (fictional) ───────────────────────────────────── */
const tx = (id, o = {}) => ({ id, type: 'expense', amount: 1000 + id, desc: 'Fictional item ' + id, cat: 'Other', date: '2026-10-20', time: '09:00', fromAcct: 'pharma_cash', toAcct: '', state: 'Manual', ...o });
const SEED = [tx(1), tx(2, { type: 'income', fromAcct: '', toAcct: 'pharma_cash', cat: 'Pharmacy Sales' }), tx(3)];
const INCOMING = [tx(101), tx(102, { amount: 2500 }), tx(103, { type: 'income', fromAcct: '', toAcct: 'pharma_bank', cat: 'Income' })];
const FMT = (version, minReader, extra = {}) => ({ name: 'koboflow-backup', version, minReader, features: [], ...extra });
const v2 = () => ({ exported: '2026-10-01T00:00:00Z', version: '2.0', transactions: INCOMING.map(t => ({ ...t })), loans: [], accounts: [] });
const v3 = () => ({ app: 'KoboFlow', version: '3.2', exported: '2026-10-01T00:00:00Z', transactions: INCOMING.map(t => ({ ...t })) });
const v4 = () => ({ app: 'KoboFlow', version: '4.0', exported: '2026-10-28T00:00:00Z', ledgerSetup: null, transactions: INCOMING.map(t => ({ ...t })), agreements: [], instalments: [], allocations: [], agreementEvents: [], opportunities: [], bills: [] });
const f2 = (extra = {}) => ({ ...v4(), format: FMT(2, 2), ...extra });
const PLAN = (id = 'ownerPlan:2026-11:a') => ({ id, kind: 'ownerPlan', schemaVersion: 1, period: '2026-11', status: 'approved', approvedAmount: 300000 });
const F1 = FMT(1, 1);
const NO_LEGACY_ALIAS = { pharma_cash: '', pharma_bank: '', pers_cash: '', pers_bank: '', coop: '', emergency: '', fixed_dep: '' };
const SETUP_LIVE = () => ({ id: 'ledgerSetup', mode: 'live', baselineDate: '2026-10-01', aliases: { ...NO_LEGACY_ALIAS }, buckets: [],
  accounts: [{ id: 'acc_a', label: 'Fictional Opay', institution: 'Opay', kind: 'wallet', use: 'business', useConfirmedAt: '2026-10-20T09:00:00.000Z', useConfirmedValue: 'business', primary: true, opening: 500000 }] });
// Format-1 files (explicit block, and no block) that carry new-format financial data. B1: every one
// must be refused by the reader guard itself, on every build and in both switch states.
const F1_STRAY = [
  ['owner plans', d => { d.ownerPlans = [PLAN()]; }],
  ['an empty ownerPlans list', d => { d.ownerPlans = []; }],
  ['an owner plan in a meta list', d => { d.meta = [PLAN()]; }],
  ['transaction purpose and split', d => { d.transactions[0].purpose = 'personal'; d.transactions[1].purpose = 'shared'; d.transactions[1].split = { pharmacy: 1500, personal: 1000, method: 'amount' }; }],
  ['an owner-plan link', d => { d.transactions[0].ownerPlanId = 'ownerPlan:2026-11:a'; }],
  ['a safety check', d => { d.transactions[0].safetyCheck = { proposed: 1, safe: 1 }; }],
  ['an Outside entry side', d => { d.transactions[0].fromAcct = '__outside'; }],
  ['a bill purpose', d => { d.bills = [{ id: 'bill_f', name: 'Fictional rent', amount: 5000, firstDue: '2026-11-01', repeat: 'monthly', status: 'active', purpose: 'personal' }]; }],
  ['an agreement split', d => { d.agreements = [{ id: 'agr_f', name: 'Fictional loan', status: 'active', terms: {}, purpose: 'business', split: { pharmacy: 1, personal: 0, method: 'amount' } }]; }],
  ['an account opening date', d => { d.ledgerSetup = { ...SETUP_LIVE(), accounts: [{ ...SETUP_LIVE().accounts[0], openingDate: '2026-10-05' }] }; }],
  ['vehicle purposes in the setup', d => { d.ledgerSetup = { ...SETUP_LIVE(), vehiclePurposes: { kia: 'personal' } }; }],
];
const f1Stray = (explicit, mutate) => { const d = v4(); if (explicit) d.format = { ...F1 }; mutate(d); return d; };
const f2WithFields = () => { const d = f2(); d.transactions[0].purpose = 'personal'; d.transactions[1].split = { pharmacy: 1500, personal: 1000, method: 'amount' }; d.transactions[1].purpose = 'shared'; return d; };

/* ── Engine unit tests ──────────────────────────────────────── */
test('engine: format detection — no format block is format 1; supported, unsupported, damaged and not-enabled formats', () => {
  const on = { supported: 2, enabled: true }, off = { supported: 2, enabled: false };
  assert.deepEqual(F.checkBackupFormat(v4(), off), { ok: true, format: 1, minReader: 1, reason: null, message: null });
  assert.equal(F.checkBackupFormat(f2(), on).ok, true);
  assert.equal(F.checkBackupFormat(f2(), off).reason, 'not_enabled');
  assert.equal(F.checkBackupFormat({ ...v4(), format: FMT(9, 9) }, on).reason, 'unsupported');
  assert.equal(F.checkBackupFormat({ ...v4(), format: FMT(3, 2) }, on).ok, true, 'additive future version readable');
  assert.equal(F.checkBackupFormat(f2(), { supported: 1, enabled: true }).reason, 'unsupported', 'an older reader refuses');
  for (const bad of [null, 'x', [], FMT(0, 0), FMT(2, 3), FMT('2', 2), FMT(2.5, 2), { ...FMT(2, 2), name: 'other' }, { ...FMT(2, 2), features: 'x' }])
    assert.equal(F.checkBackupFormat({ ...v4(), format: bad }, on).reason, 'malformed', JSON.stringify(bad));
  assert.equal(F.checkBackupFormat({ ...v4(), transactions: [{ ...tx(1), purpose: 'personal' }] }, on).reason, 'malformed', 'new fields without a format block are refused');
  assert.equal(F.checkBackupFormat([], on).reason, 'malformed');
  // B1: a format block saying version 1 is format 1 and gets the same new-data check as no block.
  for (const opts of [on, off]) {
    assert.deepEqual(F.checkBackupFormat({ ...v4(), format: F1 }, opts), { ok: true, format: 1, minReader: 1, reason: null, message: null });
    for (const [what, mutate] of F1_STRAY) {
      const ex = F.checkBackupFormat(f1Stray(true, mutate), opts), im = F.checkBackupFormat(f1Stray(false, mutate), opts);
      assert.equal(ex.ok, false, 'explicit format 1 with ' + what); assert.equal(ex.reason, 'malformed');
      assert.match(ex.message, /but is marked as format 1, so its meaning cannot be trusted\.$/, what);
      assert.equal(im.ok, false, 'no format block with ' + what); assert.match(im.message, /but no format information/, what);
    }
  }
  assert.deepEqual(F.backupNewFields(f1Stray(true, d => { d.meta = [PLAN()]; })), ['meta.ownerPlan']);
});

test('engine: new financial fields are recognised per store; existing fields are not', () => {
  assert.deepEqual(F.newFinancialFields('transactions', tx(1)), []);
  assert.deepEqual(F.newFinancialFields('transactions', { ...tx(1), purpose: 'personal', ownerPlanId: 'ownerPlan:2026-11:a', fromAcct: '__outside' }), ['purpose', 'ownerPlanId', 'fromAcct:__outside']);
  assert.deepEqual(F.newFinancialFields('agreements', { id: 'a', purpose: 'business' }), [], 'agreements already have their own purpose field');
  assert.deepEqual(F.newFinancialFields('agreements', { id: 'a', split: {} }), ['split']);
  assert.deepEqual(F.newFinancialFields('bills', { id: 'b', purpose: 'personal' }), ['purpose']);
  assert.deepEqual(F.newFinancialFields('meta', { id: 'ownerPlan:2026-11:a', kind: 'ownerPlan' }), ['ownerPlan']);
  assert.deepEqual(F.newFinancialFields('meta', { id: 'ledgerSetup', aliases: { pers_cash: '__outside' }, accounts: [{ id: 'x', use: 'personal', useConfirmedAt: 't' }] }), [], 'existing setup fields, including the Outside mapping value');
  assert.deepEqual(F.newFinancialFields('meta', { id: 'ledgerSetup', accounts: [{ id: 'x', openingDate: '2026-11-01' }] }), ['accounts.openingDate']);
});

test('engine: whole-file validation of format 2 refuses any structural problem', () => {
  assert.deepEqual(F.validateBackupV2(f2WithFields()), []);
  const bad = f2(); bad.transactions[0].split = { pharmacy: 12000, personal: 7000, method: 'amount' }; bad.transactions[0].amount = 20000;
  assert.match(F.validateBackupV2(bad).join(' '), /do not add up/);
  const p = f2(); p.transactions[0].purpose = 'other';
  assert.match(F.validateBackupV2(p).join(' '), /unknown purpose/);
  const inv = f2(); inv.transactions.push({ id: 9, amount: -1, type: 'expense', date: '2026-10-20' });
  assert.match(F.validateBackupV2(inv).join(' '), /not a valid entry/);
  const link = f2(); link.transactions[0].ownerPlanId = 'ownerPlan:2026-11:x';
  assert.match(F.validateBackupV2(link).join(' '), /owner plan that is not in the backup/);
  const twoPlans = f2({ ownerPlans: [{ id: 'ownerPlan:2026-11:a', kind: 'ownerPlan', schemaVersion: 1, period: '2026-11', status: 'approved' }, { id: 'ownerPlan:2026-11:b', kind: 'ownerPlan', schemaVersion: 1, period: '2026-11', status: 'draft' }] });
  assert.match(F.validateBackupV2(twoPlans).join(' '), /two active owner plans/);
  assert.match(F.validateBackupV2({ ...f2(), transactions: 'x' }).join(' '), /not a list/);
});

/* ── Browser harness ────────────────────────────────────────── */
const OLD_COMMIT = '03d8dee190b000457b25e298f323af8976668389';
let server, base, browser, oldTestBuild = null, oldProdBuild = null;
const PROD_SRC = () => fs.readFileSync(path.join(ROOT, 'koboflow.html'), 'utf8');
const swOn = s => s.replace('\n  var NEW_FINANCIAL_FORMAT = false;\n', '\n  var NEW_FINANCIAL_FORMAT = true;\n');
test.before(async () => {
  if (!pw) return;
  try { oldTestBuild = execFileSync('git', ['show', `${OLD_COMMIT}:koboflow-test.html`], { cwd: ROOT, maxBuffer: 1 << 26 }); } catch (e) { oldTestBuild = null; }
  try { oldProdBuild = execFileSync('git', ['show', `${OLD_COMMIT}:koboflow.html`], { cwd: ROOT, maxBuffer: 1 << 26 }); } catch (e) { oldProdBuild = null; }
  const pages = {
    '/koboflow-test/': () => fs.readFileSync(path.join(ROOT, 'koboflow-test.html')),                 // TEST site, switch OFF (committed build)
    '/KoboFlow/': () => fs.readFileSync(path.join(ROOT, 'koboflow.html')),                            // production candidate, switch OFF
    '/test-on/': () => Buffer.from(gen.build(PROD_SRC(), { newFinancialFormat: true })),              // TEST build with its switch ON (in memory only)
    '/prod-on/': () => Buffer.from(swOn(PROD_SRC())),                                                 // production candidate with the switch ON (in memory only)
    '/reader1/': () => Buffer.from(gen.build(PROD_SRC(), { newFinancialFormat: true }).replace('SUPPORTED_BACKUP_FORMAT=2', 'SUPPORTED_BACKUP_FORMAT=1')), // a guard build that reads format 1 only
    '/old/': () => oldTestBuild,                                                                      // 03d8dee TEST build: no guard
    '/old-prod/': () => oldProdBuild,                                                                 // 03d8dee production build: no guard
  };
  server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname, f = pages[p];
    const body = f && f();
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }); res.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const SITES = {
  test: { url: '/koboflow-test/', db: 'KoboFlowDB-test', label: 'TEST build (switch off)' },
  prod: { url: '/KoboFlow/', db: 'KoboFlowDB', label: 'production candidate (switch off)' },
  testOn: { url: '/test-on/', db: 'KoboFlowDB-test', label: 'TEST build (switch on, in memory)' },
  prodOn: { url: '/prod-on/', db: 'KoboFlowDB', label: 'production candidate (switch on, in memory)' },
  reader1: { url: '/reader1/', db: 'KoboFlowDB-test', label: 'guard build reading format 1 only' },
  old: { url: '/old/', db: 'KoboFlowDB-test', label: '03d8dee TEST build (no guard)' },
  oldProd: { url: '/old-prod/', db: 'KoboFlowDB', label: '03d8dee production build (no guard)' },
};

// Instrumentation installed before the app runs. Counts read-write transactions on the app database,
// calls into the storage layer and confirmation prompts. Failure injection: fail the put of one record
// id (synchronous throw), fail every put, abort the transaction after N puts or at one record id, or
// hold the transaction open after one record id's put (a chain of reads keeps it uncommitted until
// `hold` is cleared), which makes "closed before the commit" deterministic.
function instrument(dbName) {
  window.__io = { rw: 0, puts: 0, storeCalls: 0, confirms: 0, failId: null, failAll: false, abortAfter: null, abortId: null, holdId: null, hold: false, held: false };
  const C = window.confirm;
  window.confirm = function () { window.__io.confirms++; return C.apply(window, arguments); };
  let real;
  Object.defineProperty(window, 'Dexie', { configurable: true, get() { return real; }, set(make) {
    real = function () {
      const d = make.apply(this, arguments), count = (o, k) => { const f = o[k]; o[k] = function () { window.__io.storeCalls++; return f.apply(this, arguments); }; };
      count(d, 'atomic'); count(d, 'atomicIf');
      Object.keys(d).forEach(k => { const t = d[k]; if (t && typeof t === 'object' && typeof t.put === 'function') { count(t, 'put'); count(t, 'add'); } });
      return d;
    };
  } });
  const T = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (names, mode) { if (mode === 'readwrite' && this.name === dbName) window.__io.rw++; return T.apply(this, arguments); };
  const P = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (rec) {
    const io = window.__io;
    if (this.transaction.db.name === dbName) {
      io.puts++;
      if (io.failAll || (io.failId !== null && rec && rec.id === io.failId)) throw new DOMException('simulated write failure', 'DataError');
      if (io.abortAfter !== null && io.puts > io.abortAfter) { try { this.transaction.abort(); } catch (e) { /* already */ } }
      if (io.abortId !== null && rec && rec.id === io.abortId) { const r = P.apply(this, arguments); this.transaction.abort(); return r; }
      if (io.holdId !== null && rec && rec.id === io.holdId) {
        const r = P.apply(this, arguments), st = this;
        (function spin() { const g = st.get(-1); g.onsuccess = () => { io.held = true; if (io.hold) spin(); }; })();
        return r;
      }
    }
    return P.apply(this, arguments);
  };
}

async function open(siteKey) {
  const site = SITES[siteKey];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await context.addInitScript(instrument, site.db);
  const page = await context.newPage();
  page.dialogs = []; page.errors = []; page.cancelConfirm = false;
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); (d.type() === 'confirm' && page.cancelConfirm) ? d.dismiss() : d.accept(); });
  const ready = async () => { await page.goto(base + site.url); await page.waitForSelector('body[data-kf-ready="1"]'); };
  await ready();
  // Every store, every record, in key order: the byte-for-byte evidence.
  const snapshot = () => page.evaluate(n => new Promise((res, rej) => {
    const q = indexedDB.open(n);
    q.onsuccess = () => { const d = q.result, names = [...d.objectStoreNames].sort(), out = {};
      if (!names.length) { d.close(); return res(out); }
      const t = d.transaction(names, 'readonly'); let left = names.length;
      names.forEach(s => { const g = t.objectStore(s).getAll(); g.onsuccess = () => { out[s] = g.result; if (--left === 0) { d.close(); res(out); } }; });
      t.onerror = () => rej(t.error); };
    q.onerror = () => rej(q.error);
  }), site.db);
  const seed = async recs => {
    await page.evaluate(([n, recs]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const t = q.result.transaction('transactions', 'readwrite'); recs.forEach(r => t.objectStore('transactions').put(r)); t.oncomplete = () => { q.result.close(); res(); }; }; }), [site.db, recs]);
    await ready();
  };
  const io = () => page.evaluate(() => ({ ...window.__io }));
  const setIo = o => page.evaluate(o => Object.assign(window.__io, o), o);
  return { context, page, site, ready, snapshot, seed, io, setIo };
}

// Imports a file through the real Settings → Import control and waits for the outcome.
async function importFile(h, content, name = 'backup.json') {
  const { page } = h;
  page.dialogs.length = 0;
  const before = await h.io();
  await page.setInputFiles('#import-file-input', { name, mimeType: 'application/json', buffer: Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) });
  const done = () => page.dialogs.some(d => /Import failed|Nothing new to import|Could not save/.test(d)) || (page.cancelConfirm && page.dialogs.some(d => /^Import /.test(d)));
  for (let i = 0; i < 400 && !done(); i++) {
    if (await page.evaluate(() => /Import complete/.test((document.getElementById('toast') || {}).textContent || '') && document.getElementById('toast').classList.contains('show'))) break;
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(150);
  const after = await h.io();
  return { dialogs: page.dialogs.slice(), rw: after.rw - before.rw, storeCalls: after.storeCalls - before.storeCalls, confirms: after.confirms - before.confirms };
}
const plan = (h, data) => h.page.evaluate(d => { const p = window.__kfPlanImport(d); return { ops: p.ops, report: p.report }; }, data);
const keyOf = r => JSON.stringify(r.id);
// before + exactly the planned records (records keyed by id, as every store here is).
function applyPlan(before, ops) {
  const out = JSON.parse(JSON.stringify(before));
  ops.forEach(o => { const list = out[o.store] = out[o.store] || []; const i = list.findIndex(r => keyOf(r) === keyOf(o.put)); if (i >= 0) list[i] = o.put; else list.push(o.put); });
  for (const s of Object.keys(out)) out[s].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  return out;
}
const sorted = snap => { const out = JSON.parse(JSON.stringify(snap)); for (const s of Object.keys(out)) out[s].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)); return out; };
const same = (a, b) => assert.equal(JSON.stringify(sorted(a)), JSON.stringify(sorted(b)));

async function expectRefused(h, data, why, name) {
  const s0 = await h.snapshot();
  const r = await importFile(h, data, name);
  assert.ok(r.dialogs.some(d => why.test(d)), `refusal message ${why} in ${JSON.stringify(r.dialogs)}`);
  assert.ok(r.dialogs.some(d => /^Import failed: .*\nNothing was changed\.$/s.test(d)), 'refused by the reader (planImport), saying nothing was changed');
  assert.ok(!r.dialogs.some(d => /\.\./.test(d)), 'no doubled punctuation');
  assert.equal(r.confirms, 0, 'no confirmation prompt: refused before planning finished');
  assert.equal(r.storeCalls, 0, 'the storage layer was never called (no commit)');
  assert.equal(r.rw, 0, 'no read-write transaction was opened');
  const s1 = await h.snapshot();
  assert.deepEqual(Object.keys(s1).sort(), Object.keys(s0).sort(), 'same stores');
  for (const st of Object.keys(s0)) assert.equal(s1[st].length, s0[st].length, `record count in ${st}`);
  same(s1, s0);
  return r;
}
async function expectAccepted(h, data) {
  const s0 = await h.snapshot(), p = await plan(h, data);
  assert.ok(p.ops.length > 0, 'something to import');
  const r = await importFile(h, data);
  assert.ok(!r.dialogs.some(d => /Import failed|Could not save/.test(d)), JSON.stringify(r.dialogs));
  same(await h.snapshot(), applyPlan(s0, p.ops));
  return { plan: p, result: r };
}

/* ── Matrix rows on both switch-off sites ───────────────────── */
for (const key of ['test', 'prod']) {
  test(`${SITES[key].label}: matrix rows 1, 2, 6, 13 — older and current-format backups restore as before; a repeat adds nothing`, { skip }, async () => {
    const h = await open(key); await h.seed(SEED);
    const r1 = await expectAccepted(h, v2());                      // row 1 (v2: ids reassigned)
    assert.ok(r1.plan.ops.every(o => o.put.id >= 4), 'v2 ids reassigned after existing ids');
    const h3 = await open(key); await h3.seed(SEED);
    await expectAccepted(h3, v3());                                // row 1 (v3: ids kept)
    const h4 = await open(key); await h4.seed(SEED);
    const r2 = await expectAccepted(h4, v4());                     // rows 2 and 6 (no format block = format 1)
    assert.deepEqual(r2.plan.ops.map(o => o.put.id).sort(), [101, 102, 103]);
    const s1 = await h4.snapshot();
    const again = await importFile(h4, v4());                      // row 13
    assert.ok(again.dialogs.some(d => /Nothing new to import/.test(d)));
    assert.equal(again.rw, 0); same(await h4.snapshot(), s1);
    for (const x of [h, h3, h4]) { assert.deepEqual(x.page.errors, []); await x.context.close(); }
  });

  test(`${SITES[key].label}: matrix rows 4a(n/a), 5, 7, 8, 9a, 10 — unsupported, damaged, missing and corrupt files are refused with zero writes`, { skip }, async () => {
    const h = await open(key); await h.seed(SEED);
    await expectRefused(h, { ...v4(), format: FMT(9, 9) }, /newer KoboFlow \(backup format 9\)/);                 // row 5
    for (const bad of [null, 'x', FMT(0, 0), FMT(2, 3), FMT('2', 2), { ...FMT(2, 2), name: 'other' }])          // row 7
      await expectRefused(h, { ...v4(), format: bad }, /format information is damaged/);
    await expectRefused(h, { ...v4(), transactions: [{ ...tx(201), purpose: 'personal' }] }, /no format information/); // row 7: new data, no format
    const noTx = v4(); delete noTx.transactions;
    await expectRefused(h, noTx, /no transactions list/);                                                         // row 8
    await expectRefused(h, { ...v4(), transactions: { a: 1 } }, /no transactions list/);                          // row 9a
    const text = JSON.stringify(v4());
    await expectRefused(h, text.slice(0, Math.floor(text.length / 2)), /Import failed/);                          // row 10: truncated
    await expectRefused(h, Buffer.from([0xff, 0xfe, 0x00, 0x13, 0x88, 0x01]), /Import failed/);                   // row 10: random bytes
    await expectRefused(h, '', /Import failed/);                                                                  // row 10: empty file
    assert.deepEqual(h.page.errors, []); await h.context.close();
  });

  test(`${SITES[key].label}: R2 — a format-2 backup and new financial fields are refused while this site's switch is off`, { skip }, async () => {
    const h = await open(key); await h.seed(SEED);
    await expectRefused(h, f2(), /new financial format, which is not enabled on this site/);                        // format 2 on a switch-off site
    await expectRefused(h, { ...v4(), format: FMT(3, 2) }, /not enabled on this site/);                             // row 5b on a switch-off site
    // Direct writes through the storage layer: refused before any transaction is opened; nothing changes.
    const s0 = await h.snapshot(), io0 = await h.io();
    const errs = await h.page.evaluate(async () => {
      const d = new Dexie(), out = [];
      const tries = [
        () => d.atomic([{ store: 'transactions', put: { id: 501, type: 'expense', amount: 5, date: '2026-10-20', purpose: 'personal' } }]),
        () => d.atomicIf([], [{ store: 'transactions', put: { id: 502, type: 'expense', amount: 5, date: '2026-10-20', fromAcct: '__outside' } }]),
        () => d.transactions.put({ id: 503, type: 'expense', amount: 5, date: '2026-10-20', ownerPlanId: 'ownerPlan:2026-11:a' }),
        () => d.meta.put({ id: 'ownerPlan:2026-11:a', kind: 'ownerPlan', schemaVersion: 1, period: '2026-11', status: 'draft' }),
        () => d.bills.put({ id: 'bill_x', name: 'X', amount: 1, firstDue: '2026-11-01', purpose: 'personal' }),
        () => d.atomic([{ store: 'transactions', put: { id: 504, type: 'expense', amount: 5, date: '2026-10-20' } }, { store: 'meta', put: { id: 'ledgerSetup', accounts: [{ id: 'a', openingDate: '2026-11-01' }] } }]),
        () => d.transactions.add({ id: 506, type: 'expense', amount: 5, date: '2026-10-20', split: { pharmacy: 5, personal: 0, method: 'amount' } }),
        () => d.bills.add({ id: 'bill_y', name: 'Y', amount: 1, firstDue: '2026-11-01', split: { pharmacy: 1, personal: 0, method: 'amount' } }),
        () => d.meta.add({ id: 'ownerPlan:2026-12:b', kind: 'ownerPlan', schemaVersion: 1, period: '2026-12', status: 'draft' }),
        async () => { const cur = await d.transactions.get(1); return d.atomicIf([{ store: 'transactions', key: 1, expect: JSON.stringify(cur) }], [{ store: 'transactions', put: { ...cur, purpose: 'personal' } }]); },
        () => d.agreements.put({ id: 'agr_x', name: 'X', split: { pharmacy: 1, personal: 0, method: 'amount' } }),
      ];
      for (const t of tries) { try { await t(); out.push('WRITTEN'); } catch (e) { out.push(e.code || e.message); } }
      return out;
    });
    assert.deepEqual(errs, Array(11).fill('new_format_disabled'), 'put, add, atomic, and both atomicIf paths are all gated');
    assert.equal((await h.io()).rw - io0.rw, 0, 'no read-write transaction opened');
    same(await h.snapshot(), s0);
    // Ordinary writes still work.
    const ok = await h.page.evaluate(async () => { await new Dexie().atomic([{ store: 'transactions', put: { id: 505, type: 'expense', amount: 5, desc: 'ok', date: '2026-10-20', time: '09:00', fromAcct: 'pharma_cash', toAcct: '', state: 'Manual' } }]); return true; });
    assert.equal(ok, true);
    // Export stays format 1: no format block, normal transactions collection, normal file name.
    await h.page.click('#settings-nav-btn');
    const [dl] = await Promise.all([h.page.waitForEvent('download'), h.page.click('#export-json-btn')]);
    assert.doesNotMatch(dl.suggestedFilename(), /_format/);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal('format' in exported, false);
    assert.equal(exported.version, '4.0');
    assert.ok(Array.isArray(exported.transactions) && exported.transactions.length >= 3);
    assert.equal(await h.page.evaluate(() => new Dexie().newFinancialFormat), false);
    assert.deepEqual(h.page.errors, []); await h.context.close();
  });

  test(`${SITES[key].label}: matrix rows 9c, 11, 12, 14, 15 — failures, interruptions and cancels leave no partial write; success is all-or-nothing`, { skip }, async () => {
    // Row 9c: format 1 with some invalid records keeps the existing behaviour (rejected, the rest imported).
    const h = await open(key); await h.seed(SEED);
    const mixed = v4(); mixed.transactions.push({ id: 150, amount: 0, type: 'expense', date: '2026-10-20' }, { id: 151, amount: 10, date: 'not a date', type: 'expense' });
    const r9 = await expectAccepted(h, mixed);
    assert.equal(r9.plan.report.rejected, 2);
    await h.context.close();
    // Row 11: the database write fails.
    const h11 = await open(key); await h11.seed(SEED);
    let s0 = await h11.snapshot(); await h11.setIo({ failAll: true });
    let r = await importFile(h11, v4());
    assert.ok(r.dialogs.some(d => /Could not save/.test(d)), JSON.stringify(r.dialogs));
    same(await h11.snapshot(), s0); await h11.context.close();
    // Row 12: the transaction is aborted part-way (after one record was put).
    const h12 = await open(key); await h12.seed(SEED);
    s0 = await h12.snapshot(); await h12.setIo({ abortAfter: (await h12.io()).puts + 1 });
    r = await importFile(h12, v4());
    assert.ok(r.dialogs.some(d => /Could not save/.test(d)), JSON.stringify(r.dialogs));
    await h12.setIo({ abortAfter: null });
    same(await h12.snapshot(), s0);
    await h12.ready(); same(await h12.snapshot(), s0); // still unchanged after reload
    const again = await expectAccepted(h12, v4());       // and the import can be repeated
    assert.equal(again.plan.ops.length, 3); await h12.context.close();
    // Row 12 (page closed before the commit), made deterministic: every record of the file has been put,
    // but the transaction is held open (uncommitted) when the page is closed. On reload nothing from the
    // file is present, and the import can be repeated. (A page close is the case tested here; a
    // browser-process crash, an OS crash or power loss is not.)
    const readAll = async (ctx, site) => { const p2 = await ctx.newPage(); await p2.goto(base + site.url); await p2.waitForSelector('body[data-kf-ready="1"]');
      const out = await p2.evaluate(n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const d = q.result, names = [...d.objectStoreNames].sort(), o = {}; const t = d.transaction(names); let left = names.length; names.forEach(s => { const g = t.objectStore(s).getAll(); g.onsuccess = () => { o[s] = g.result; if (--left === 0) { d.close(); res(o); } }; }); }; }), site.db);
      return { p2, out }; };
    const hc = await open(key); await hc.seed(SEED);
    const big = v4(); big.transactions = Array.from({ length: 300 }, (_, i) => tx(1000 + i));
    s0 = await hc.snapshot();
    const bigPlan = await plan(hc, big);
    await hc.setIo({ holdId: bigPlan.ops[bigPlan.ops.length - 1].put.id, hold: true });
    await hc.page.setInputFiles('#import-file-input', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(big)) });
    await hc.page.waitForFunction(() => window.__io.held === true);
    const heldIo = await hc.io();
    assert.ok(heldIo.puts >= bigPlan.ops.length, 'every record was put before the close');
    await hc.page.close();
    let back = await readAll(hc.context, hc.site);
    same(back.out, s0);
    assert.ok(!back.out.transactions.some(t => t.id >= 1000), 'no record from the file survived the close');
    await back.p2.close();
    // The same import, completed, then the page closed: everything is there after reload.
    const hd = await open(key); await hd.seed(SEED);
    s0 = await hd.snapshot();
    await expectAccepted(hd, big);
    await hd.page.close();
    back = await readAll(hd.context, hd.site);
    same(back.out, applyPlan(s0, bigPlan.ops));
    await hc.context.close(); await hd.context.close();
    // Row 14: the owner cancels at the confirmation prompt.
    const h14 = await open(key); await h14.seed(SEED);
    s0 = await h14.snapshot(); h14.page.cancelConfirm = true;
    r = await importFile(h14, v4());
    assert.ok(r.dialogs.some(d => /^Import /.test(d)));
    assert.equal(r.rw, 0); same(await h14.snapshot(), s0); await h14.context.close();
    // Row 15: a large valid file with a forced failure on its LAST record — nothing; then the clean run — everything.
    const h15 = await open(key); await h15.seed(SEED);
    s0 = await h15.snapshot();
    const big15 = v4(); big15.transactions = Array.from({ length: 200 }, (_, i) => tx(2000 + i));
    const planned = await plan(h15, big15);
    await h15.setIo({ failId: planned.ops[planned.ops.length - 1].put.id });
    r = await importFile(h15, big15);
    assert.ok(r.dialogs.some(d => /Could not save/.test(d)), JSON.stringify(r.dialogs));
    same(await h15.snapshot(), s0);
    await h15.setIo({ failId: null });
    await expectAccepted(h15, big15);
    assert.deepEqual(h15.page.errors, []); await h15.context.close();
  });
}

/* ── Rows needing a switch-on build (in memory only; never deployed) ── */
for (const key of ['testOn', 'prodOn']) {
  test(`${SITES[key].label}: matrix rows 3, 5b, 9b — compatible reader restores format 2 intact; validation refuses a bad file whole`, { skip }, async () => {
    const h = await open(key); await h.seed(SEED);
    const r3 = await expectAccepted(h, f2WithFields());                                     // row 3
    const stored = (await h.snapshot()).transactions.find(t => t.id === 102);
    assert.deepEqual(stored.split, { pharmacy: 1500, personal: 1000, method: 'amount' }, 'new fields intact');
    assert.equal((await h.snapshot()).transactions.find(t => t.id === 101).purpose, 'personal');
    assert.equal(r3.plan.ops.length, 3);
    const h5 = await open(key); await h5.seed(SEED);
    await expectAccepted(h5, { ...v4(), format: FMT(3, 2) });                                // row 5b: additive version
    const h9 = await open(key); await h9.seed(SEED);
    const bad = f2WithFields(); bad.transactions[1].split.personal = 1;                      // row 9b: one bad split
    await expectRefused(h9, bad, /failed validation, so none of it was restored: entry 102: split parts/);
    await expectRefused(h9, f2({ ownerPlans: [{ id: 'ownerPlan:2026-11:a', kind: 'ownerPlan', schemaVersion: 1, period: '2026-11', status: 'approved' }] }), /owner plans, which this version/);
    // Row 16 (switch-on side): export writes format 2 with the normal transactions collection.
    await h.page.click('#settings-nav-btn');
    const [dl] = await Promise.all([h.page.waitForEvent('download'), h.page.click('#export-json-btn')]);
    assert.match(dl.suggestedFilename(), /_format2\.json$/);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.deepEqual(exported.format, { name: 'koboflow-backup', version: 2, minReader: 2, features: [] });
    assert.ok(Array.isArray(exported.transactions) && exported.transactions.some(t => t.purpose === 'personal'));
    for (const x of [h, h5, h9]) { assert.deepEqual(x.page.errors, []); await x.context.close(); }
  });
}

test('matrix row 4a — a guard build that reads format 1 only refuses a format-2 backup with zero writes', { skip }, async () => {
  const h = await open('reader1'); await h.seed(SEED);
  await expectRefused(h, f2(), /needs a newer version to restore/);
  assert.deepEqual(h.page.errors, []); await h.context.close();
});

test('matrix row 4b — documented limitation: the 03d8dee build (no guard) accepts a format-2 backup', { skip }, async (t) => {
  if (!oldTestBuild) { t.skip('03d8dee is not in this checkout\'s history'); return; }
  const h = await open('old'); await h.seed(SEED);
  const p = await plan(h, f2WithFields());
  assert.equal(p.ops.length, 3, 'the old build plans the import instead of refusing it (the risk accepted under R2)');
  // Row 2 cross-check: the same format-1 file plans identically on the old build and the new TEST build.
  const pOld = await plan(h, v4());
  const n = await open('test'); await n.seed(SEED);
  assert.deepEqual((await plan(n, v4())).ops, pOld.ops);
  await h.context.close(); await n.context.close();
});

test('regression: a write that fails part-way leaves nothing behind (the old build kept the earlier records)', { skip }, async (t) => {
  const recs = [tx(701), tx(702), { id: 703, type: 'expense', amount: 5, date: '2026-10-20', bad: () => 1 }];
  const run = async key => {
    const h = await open(key); await h.seed(SEED);
    const s0 = await h.snapshot();
    const err = await h.page.evaluate(async recs => { recs[2].bad = () => 1; try { await new Dexie().atomic(recs.map(r => ({ store: 'transactions', put: r }))); return null; } catch (e) { return e.name || e.message; } }, recs.map(r => ({ ...r, bad: undefined })));
    const after = await h.snapshot(); await h.context.close();
    return { err, s0, after };
  };
  const now = await run('test');
  assert.ok(now.err, 'the write is refused');
  same(now.after, now.s0);
  if (oldTestBuild) {
    const before = await run('old');
    assert.ok(before.after.transactions.length > before.s0.transactions.length, 'demonstrates the fixed defect: the old build committed the records put before the failure');
  }
});

test('matrix row 16 — the TEST site and production set their switches independently; both are OFF', () => {
  const prodBefore = fs.readFileSync(path.join(ROOT, 'koboflow.html'));
  const off = gen.build(PROD_SRC()), on = gen.build(PROD_SRC(), { newFinancialFormat: true });
  assert.match(off, /\n  var NEW_FINANCIAL_FORMAT = false; \/\/ TEST site setting/);
  assert.match(on, /\n  var NEW_FINANCIAL_FORMAT = true; \/\/ TEST site setting/);
  const diff = off.split('\n').filter((l, i) => l !== on.split('\n')[i]);
  assert.equal(diff.length, 1, 'only the switch line differs between the two TEST builds');
  assert.equal(gen.build(swOn(PROD_SRC())).includes('var NEW_FINANCIAL_FORMAT = false; // TEST site setting'), true, 'TEST never inherits production\'s value');
  assert.ok(fs.readFileSync(path.join(ROOT, 'koboflow.html')).equals(prodBefore), 'building TEST never changes the production file');
  assert.match(PROD_SRC(), /\n  var NEW_FINANCIAL_FORMAT = false;\n/, 'production candidate switch is OFF');
  assert.match(fs.readFileSync(path.join(ROOT, 'koboflow-test.html'), 'utf8'), /\n  var NEW_FINANCIAL_FORMAT = false; \/\/ TEST site setting/, 'committed TEST build switch is OFF');
  const site = Object.fromEntries(gen.buildTestSite());
  assert.equal(JSON.parse(site['SOURCE.json']).newFinancialFormat, false, 'the site record states the switch');
  assert.equal(F.SUPPORTED_BACKUP_FORMAT, 2);
});

/* ── B1 regression (independent review): format 1 with new-format data, explicit or implicit ── */
for (const key of ['test', 'prod', 'testOn', 'prodOn']) {
  test(`${SITES[key].label}: B1 — a format-1 file (format block saying 1, or none) carrying new financial data or owner plans is refused by the reader before planning, prompts or writes`, { skip }, async () => {
    const h = await open(key); await h.seed(SEED);
    for (const [what, mutate] of F1_STRAY) {
      const ex = await expectRefused(h, f1Stray(true, mutate), /but is marked as format 1, so its meaning cannot be trusted\.\nNothing was changed\.$/);
      assert.ok(ex.dialogs.every(d => !/Could not save/.test(d)), `${what}: refused by the reader, not left to the write gate`);
      await expectRefused(h, f1Stray(false, mutate), /but no format information, so its meaning cannot be trusted\.\nNothing was changed\.$/);
    }
    // The planner itself refuses too (the guard is its first step).
    const thrown = await h.page.evaluate(d => { try { window.__kfPlanImport(d); return null; } catch (e) { return e.message; } }, f1Stray(true, F1_STRAY[0][1]));
    assert.match(thrown, /owner plans|ownerPlans/);
    // A clean file with an explicit format-1 block restores exactly like one without a block.
    const h2 = await open(key); await h2.seed(SEED);
    const pNone = await plan(h2, v4()), pOne = await plan(h2, { ...v4(), format: { ...F1 } });
    assert.deepEqual(pOne.ops, pNone.ops);
    await expectAccepted(h2, { ...v4(), format: { ...F1 } });
    for (const x of [h, h2]) { assert.deepEqual(x.page.errors, []); await x.context.close(); }
  });
}

/* ── Storage-layer atomicity: atomic, atomicIf without checks, atomicIf with checks ── */
const ATOMIC_OPS = ids => ids.map(i => ({ store: 'transactions', put: tx(i) }));
async function storageWrite(h, fn, ids) {
  return h.page.evaluate(async ([fn, ops]) => {
    const d = new Dexie(); let checks = [];
    if (fn === 'atomicIf (checked)') { const cur = await d.transactions.get(1); checks = [{ store: 'transactions', key: 1, expect: JSON.stringify(cur) }]; }
    try { await (fn === 'atomic' ? d.atomic(ops) : d.atomicIf(checks, ops)); return 'resolved'; } catch (e) { return 'rejected: ' + (e && (e.name || e.message)); }
  }, [fn, ATOMIC_OPS(ids)]);
}
const FNS = ['atomic', 'atomicIf (unchecked)', 'atomicIf (checked)'];
for (const key of ['test', 'prod']) {
  test(`${SITES[key].label}: a failure on the first, middle or last record — thrown or aborted — leaves nothing from the write, on every write path`, { skip }, async () => {
    const ids = [801, 802, 803, 804, 805], at = { first: 801, middle: 803, last: 805 };
    const h = await open(key); await h.seed(SEED);
    for (const fn of FNS) for (const [where, id] of Object.entries(at)) for (const kind of ['throw', 'abort']) {
      const s0 = await h.snapshot();
      await h.setIo(kind === 'throw' ? { failId: id } : { abortId: id });
      const res = await storageWrite(h, fn, ids);
      await h.setIo({ failId: null, abortId: null });
      assert.match(res, /^rejected/, `${fn}, ${kind} at ${where}`);
      same(await h.snapshot(), s0);
    }
    // Positive control: each path writes all five records when nothing fails.
    for (const [i, fn] of FNS.entries()) {
      const s0 = await h.snapshot(), more = ids.map(x => x + 100 * (i + 1));
      assert.equal(await storageWrite(h, fn, more), 'resolved', fn);
      same(await h.snapshot(), applyPlan(s0, ATOMIC_OPS(more)));
    }
    // A stale check (the record changed after it was read) writes nothing, with code 'changed'.
    const s0 = await h.snapshot();
    const stale = await h.page.evaluate(async ops => { const d = new Dexie(); try { await d.atomicIf([{ store: 'transactions', key: 1, expect: '{"not":"current"}' }], ops); return 'resolved'; } catch (e) { return e.code; } }, ATOMIC_OPS([901, 902]));
    assert.equal(stale, 'changed'); same(await h.snapshot(), s0);
    assert.deepEqual(h.page.errors, []); await h.context.close();
  });

  test(`${SITES[key].label}: an import whose write fails on its first, middle or last record saves nothing; the clean run saves everything`, { skip }, async () => {
    const big = v4(); big.transactions = Array.from({ length: 60 }, (_, i) => tx(4000 + i));
    for (const where of ['first', 'middle', 'last']) for (const kind of ['throw', 'abort']) {
      const h = await open(key); await h.seed(SEED);
      const s0 = await h.snapshot(), p = await plan(h, big), ids = p.ops.map(o => o.put.id);
      const id = where === 'first' ? ids[0] : where === 'middle' ? ids[Math.floor(ids.length / 2)] : ids[ids.length - 1];
      await h.setIo(kind === 'throw' ? { failId: id } : { abortId: id });
      const r = await importFile(h, big);
      const fail = r.dialogs.find(d => /Could not save/.test(d));
      assert.ok(fail, `${kind} at ${where}: ${JSON.stringify(r.dialogs)}`);
      assert.match(fail, /Nothing was changed\.$/); assert.doesNotMatch(fail, /\.\./);
      same(await h.snapshot(), s0);
      await h.setIo({ failId: null, abortId: null });
      await expectAccepted(h, big);
      assert.deepEqual(h.page.errors, []); await h.context.close();
    }
  });
}

test('the fixed defect, shown on 03d8dee: there, a synchronous failure part-way through atomic or unchecked atomicIf kept the earlier records', { skip }, async (t) => {
  if (!oldTestBuild) { t.skip('03d8dee is not in this checkout\'s history'); return; }
  const h = await open('old'); await h.seed(SEED);
  const kept = {};
  for (const fn of FNS) {
    const s0 = await h.snapshot();
    await h.setIo({ failId: 803 });
    assert.match(await storageWrite(h, fn, [801, 802, 803, 804, 805]), /^rejected/);
    await h.setIo({ failId: null });
    const after = await h.snapshot();
    kept[fn] = after.transactions.length - s0.transactions.length;
    if (kept[fn]) { const extra = [801, 802].map(tx); await h.page.evaluate(ids => new Promise(res => { const q = indexedDB.open('KoboFlowDB-test'); q.onsuccess = () => { const t2 = q.result.transaction('transactions', 'readwrite'); ids.forEach(i => t2.objectStore('transactions').delete(i)); t2.oncomplete = () => { q.result.close(); res(); }; }; }), extra.map(x => x.id)); }
  }
  assert.deepEqual(kept, { 'atomic': 2, 'atomicIf (unchecked)': 2, 'atomicIf (checked)': 0 }, 'old: two records kept by atomic and unchecked atomicIf; the checked path was already safe');
  await h.context.close();
});

/* ── Compatibility with the old baseline (03d8dee): the same format-1 files restore identically ── */
const COMPAT = [
  ['v2 backup with an invalid record', () => { const d = v2(); d.transactions.push({ id: 160, amount: 0, type: 'expense', date: '2026-10-20' }); return d; }],
  ['v3 backup with an invalid record', () => { const d = v3(); d.transactions.push({ id: 161, amount: 10, type: 'expense', date: 'not a date' }); return d; }],
  ['v4 backup with a live account setup', () => { const d = v4(); d.ledgerSetup = SETUP_LIVE(); d.transactions.push(tx(104, { fromAcct: 'acc_a' })); return d; }],
  ['v4 backup with an explicit format-1 block', () => ({ ...v4(), format: { ...F1 } })],
];
for (const [oldKey, newKey] of [['old', 'test'], ['oldProd', 'prod']]) {
  test(`compatibility: ${SITES[oldKey].label} and ${SITES[newKey].label} restore the same format-1 files to identical databases`, { skip }, async (t) => {
    if (!(oldKey === 'old' ? oldTestBuild : oldProdBuild)) { t.skip('03d8dee is not in this checkout\'s history'); return; }
    for (const [what, make] of COMPAT) {
      const result = {};
      for (const k of [oldKey, newKey]) {
        const h = await open(k); await h.seed(SEED);
        const p = await plan(h, make());
        const r = await importFile(h, make());
        assert.ok(!r.dialogs.some(d => /Import failed|Could not save/.test(d)), `${what} on ${k}: ${JSON.stringify(r.dialogs)}`);
        result[k] = { report: p.report, snap: sorted(await h.snapshot()) };
        assert.deepEqual(h.page.errors, []); await h.context.close();
      }
      assert.deepEqual(result[newKey].report, result[oldKey].report, `${what}: same import report (added, skipped, rejected, notes)`);
      assert.equal(JSON.stringify(result[newKey].snap), JSON.stringify(result[oldKey].snap), `${what}: identical database after restore`);
    }
  });
}
