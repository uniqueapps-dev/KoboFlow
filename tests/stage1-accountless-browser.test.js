// STAGE 1 — direct browser coverage of income with no receiving account (owner decision I-2, register
// row P-D13c; docs/personal-money-separation-design.md 5.2 rules 2 and 5, section 6). Closes the evidence
// gap recorded in docs/stage-1-verification.md: these cases were covered in Node only (N-T7b, N-T7,
// N-T10, the 5.2 truth table), which remain the authority for the rules; this file checks that the page
// (TEST build and production candidate) behaves identically, through the app's own screens and state.
// Fictional data only; every test uses a fresh, disposable browser context served from 127.0.0.1 with its
// own IndexedDB, never a deployed site or the owner's data.
// Optional: KOBOFLOW_SITE_DIR=<dir> also runs the TEST-build tests against a built TEST site directory
// (scripts/build-test-file.js --site), e.g. the exact files to be deployed.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const F = require('./load-engine')();
const { stage2Texts } = require('./stage2-regions');

const ROOT = path.join(__dirname, '..');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';
const OUTSIDE = F.OUTSIDE;
const SITE_DIR = process.env.KOBOFLOW_SITE_DIR || null;

/* ── Fixture (fictional) ────────────────────────────────────── */
const CONF = '2026-10-01T09:00:00.000Z';
const acct = (id, use, o = {}) => ({ id, label: 'Fictional ' + id, kind: 'bank', opening: 0, use, useConfirmedAt: use ? CONF : null, useConfirmedValue: use || null, institution: 'Fictional', ...o });
const ACCTS = [
  acct('opay', 'business', { kind: 'wallet', opening: 400000, primary: true }),
  acct('tb', 'business', { opening: 100000 }),
  acct('pb', 'personal', { opening: 40000 }),
  acct('sh', 'shared', { opening: 300000, sharedPortion: { amount: 100000, declaredAt: '2026-10-01' } }),
];
const ALIASES = { pharma_cash: 'opay', pharma_bank: 'tb', pers_cash: OUTSIDE, pers_bank: '', coop: '', emergency: '', fixed_dep: '' };
const K = n => Math.round(n * 100);

function seedFor(kind) {
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const today = `${y}-${String(mo + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, monthStart = today.slice(0, 8) + '01';
  const baseline = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10);
  const setup = { id: 'ledgerSetup', mode: 'live', baselineDate: baseline, buckets: [], aliases: { ...ALIASES }, accounts: ACCTS.map(a => ({ ...a })) };
  let i = 9500; const t = (o) => ({ id: i++, type: 'income', amount: 1000, desc: 'Fictional', cat: 'Other', date: today, time: '09:00', fromAcct: '', toAcct: '', state: 'Manual', ...o });
  const base = [t({ amount: 50000, toAcct: 'opay', desc: 'Sales' }), t({ amount: 20000, toAcct: 'pb', desc: 'Personal receipt' }),
    t({ type: 'expense', amount: 10000, fromAcct: 'opay', desc: 'Stock' })];
  // The six approved P-D13c cases (plan section 1.1), each with no receiving account.
  const accountless = [
    t({ amount: 1000, split: { pharmacy: 600, personal: 400, method: 'amount' }, desc: 'C1 valid split, no account' }),
    t({ amount: 3500, purpose: 'pharmacy', desc: 'C2 pharmacy purpose, no account' }),
    t({ amount: 1500, purpose: 'personal', desc: 'C3 personal purpose, no account' }),
    t({ amount: 700, desc: 'C4 no split or purpose, no account' }),
    t({ amount: 1000, split: { pharmacy: 600, personal: 300, method: 'amount' }, desc: 'C5 split does not reconcile, no account' }),
    t({ amount: 800, purpose: 'shared', desc: 'C6 shared purpose, no split, no account' }),
  ];
  const second = t({ amount: 3500, toAcct: 'opay', purpose: 'pharmacy', desc: 'C2 again, recorded separately into Opay' });
  const txns = kind === 'base' ? base : kind === 'dup' ? base.concat(accountless, [second]) : base.concat(accountless);
  return { setup, txns, agreements: [], today, monthStart };
}
const opts = s => ({ aliases: s.setup.aliases, agreements: s.agreements, baselineDate: s.setup.baselineDate, from: s.monthStart, to: s.today, today: s.today });

/* ── Server and browser ─────────────────────────────────────── */
const STAGE0 = '3359ae0c8efdd0f15574f375c6a0c4205d1ec649';
let server, base, browser, stage0 = {};
const pageFor = { test: () => fs.readFileSync(path.join(ROOT, 'koboflow-test.html')), prod: () => fs.readFileSync(path.join(ROOT, 'koboflow.html')),
  test0: () => stage0.test, prod0: () => stage0.prod, site: () => SITE_DIR && fs.readFileSync(path.join(SITE_DIR, 'index.html')) };
const DBN = { test: 'KoboFlowDB-test', test0: 'KoboFlowDB-test', site: 'KoboFlowDB-test', prod: 'KoboFlowDB', prod0: 'KoboFlowDB' };
test.before(async () => {
  if (!pw) return;
  for (const [k, f] of [['test', 'koboflow-test.html'], ['prod', 'koboflow.html']]) { try { stage0[k] = execFileSync('git', ['show', `${STAGE0}:${f}`], { cwd: ROOT, maxBuffer: 1 << 26 }); } catch (err) { stage0[k] = null; } }
  server = http.createServer((req, res) => { const k = new URL(req.url, 'http://x').pathname.replace(/\//g, ''), f = pageFor[k], b = f && f();
    if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }); res.end(b); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function openSeeded(key, seed) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort()); // nothing leaves this machine
  await context.addInitScript(n => { window.__rw = 0; const T = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (s, m) { if (m === 'readwrite' && this.name === n) window.__rw++; return T.apply(this, arguments); }; }, DBN[key]);
  const page = await context.newPage(); page.errors = [];
  page.on('pageerror', er => page.errors.push(er.message)); page.on('dialog', d => d.accept());
  await page.goto(`${base}/${key}/`); await page.waitForSelector('body[data-kf-ready="1"]');
  await page.evaluate(([n, s]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction(['meta', 'transactions', 'agreements'], 'readwrite'); tx.objectStore('meta').put(s.setup); s.txns.forEach(r => tx.objectStore('transactions').put(r)); s.agreements.forEach(r => tx.objectStore('agreements').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), [DBN[key], seed]);
  await page.goto(`${base}/${key}/`); await page.waitForSelector('body[data-kf-ready="1"]');
  return { context, page };
}
const snapAll = (page, n) => page.evaluate(n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const d = q.result, names = [...d.objectStoreNames].sort(), o = {}; const t = d.transaction(names); let l = names.length; names.forEach(s => { const g = t.objectStore(s).getAll(); g.onsuccess = () => { o[s] = g.result; if (--l === 0) { d.close(); res(JSON.stringify(o)); } }; }); }; }), n);
// The app's state, read without writing: (a) what the app displays — the Director's Cash Now row, the
// Brief runway figures and the Director's "Missing or uncertain" missing_account line; (b) the in-page
// engine (KoboFin, the code the page runs) applied to the records the app has stored in IndexedDB.
const appState = (page, s, dbName) => page.evaluate(([o, n]) => new Promise((res, rej) => {
  const q = indexedDB.open(n); q.onerror = () => rej(q.error);
  q.onsuccess = () => { const d = q.result, t = d.transaction(['meta', 'transactions', 'agreements']), out = {};
    const g1 = t.objectStore('meta').get('ledgerSetup'), g2 = t.objectStore('transactions').getAll(), g3 = t.objectStore('agreements').getAll();
    t.oncomplete = () => { d.close();
      const setup = g1.result, txns = g2.result, agr = g3.result, F = KoboFin;
      const m = F.financialMeasures(setup.accounts, txns, { aliases: setup.aliases, agreements: agr, baselineDate: setup.baselineDate, from: o.from, to: o.to, today: o.today });
      const dq = F.dataQuality({ txns, accountIds: setup.accounts.map(a => a.id), aliases: setup.aliases, baselineDate: setup.baselineDate, today: o.today }).find(f => f.key === 'missing_account') || { ids: [], severity: null };
      const txt = sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
      res({ m, balances: m.balances, available: m.confirmedPharmacyCash.available, total: m.confirmedPharmacyCash.total, held: m.confirmedPharmacyCash.heldUnresolvedInflows,
        missingAccount: { ids: dq.ids.map(String), severity: dq.severity }, txns,
        ui: { cashNow: txt('[data-dir-row="cash"] .autopilot-val'), runwayDays: txt('#runway-days'), runwayMeta: txt('#runway-meta'), missingLine: txt('[data-dir-quality="missing_account"]') } });
    };
  };
}), [opts(s), dbName]);
const cardOf = page => page.evaluate(() => ({
  totals: Object.fromEntries([...document.querySelectorAll('#scope-totals [data-scope]')].map(x => [x.getAttribute('data-scope'), x.textContent])),
  rows: [...document.querySelectorAll('[data-scope-entry]')].map(x => ({ id: Number(x.getAttribute('data-scope-entry')), kind: x.getAttribute('data-kind'),
    pharmacy: Number(x.getAttribute('data-pharmacy')), personal: Number(x.getAttribute('data-personal')), unclassified: Number(x.getAttribute('data-unclassified')), text: x.textContent.replace(/\s+/g, ' ') })),
}));
const naira = v => '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2 });
const screensText = page => page.evaluate(() => { const c = document.getElementById('scope-summary-card'); if (c) c.remove();
  return [...document.querySelectorAll('.screen')].map(s => s.id + ': ' + s.textContent.replace(/\s+/g, ' ').trim()); });

const KEYS = ['test', 'prod'].concat(SITE_DIR ? ['site'] : []);
const LABEL = { test: 'TEST build', prod: 'production candidate', site: 'built TEST site (' + (SITE_DIR || '') + ')' };

for (const key of KEYS) {
  test(`${LABEL[key]}: income with no receiving account (P-D13c) — the six cases classified as approved, warnings kept, no account or confirmed cash, "of which" figures; card and in-page engine equal the Node engine; rendering writes nothing`, { skip }, async () => {
    const sb = seedFor('base'), sw = seedFor('with');
    const B = await openSeeded(key, sb), W = await openSeeded(key, sw);
    // Expected, from the Node engine (the authority, with N-T7b).
    const mw = F.financialMeasures(ACCTS, sw.txns, opts(sw)), mb = F.financialMeasures(ACCTS, sb.txns, opts(sb));
    const byDesc = Object.fromEntries(mw.entries.map(x => [x.desc, x]));
    const want = {
      'C1 valid split, no account': ['shared', { pharmacy: 600, personal: 400, unclassified: 0 }, ['missing_source']],
      'C2 pharmacy purpose, no account': ['pharmacy', { pharmacy: 3500, personal: 0, unclassified: 0 }, ['missing_source']],
      'C3 personal purpose, no account': ['personal', { pharmacy: 0, personal: 1500, unclassified: 0 }, ['missing_source']],
      'C4 no split or purpose, no account': ['unclassified', { pharmacy: 0, personal: 0, unclassified: 700 }, ['missing_source']],
      'C5 split does not reconcile, no account': ['unclassified', { pharmacy: 0, personal: 0, unclassified: 1000 }, ['split_does_not_reconcile', 'missing_source']],
      'C6 shared purpose, no split, no account': ['unclassified', { pharmacy: 0, personal: 0, unclassified: 800 }, ['shared_needs_purpose', 'missing_source']],
    };
    for (const [d, [kind, parts, flags]] of Object.entries(want)) {
      assert.equal(byDesc[d].kind, kind, d); assert.deepEqual(byDesc[d].parts, parts, d);
      for (const f of flags) assert.ok(byDesc[d].flags.includes(f), `${d}: ${f}`);
    }
    assert.deepEqual([mw.pharmacyReceipts, mw.pharmacyReceiptsNoReceivingAccount, mw.personalIncome, mw.personalIncomeNoReceivingAccount, mw.unresolvedIncome],
      [50000 + 600 + 3500, 600 + 3500, 20000 + 400 + 1500, 400 + 1500, 700 + 1000 + 800]);

    // The page: rendering the INTEL card writes nothing; snapshot unchanged.
    const s0 = await snapAll(W.page, DBN[key]), rw0 = await W.page.evaluate(() => window.__rw);
    await W.page.click('.nav-btn[data-screen="analytics"]');
    await W.page.waitForSelector('#scope-summary-card:not([style*="display: none"])');
    const card = await cardOf(W.page);
    await W.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await W.page.evaluate(() => window.__rw) - rw0, 0, 'rendering: no read-write transaction');
    assert.equal(await snapAll(W.page, DBN[key]), s0, 'every store unchanged by rendering');

    // Card equals the Node engine: every row (kind and parts) and the three totals.
    assert.deepEqual(card.rows.map(r => ({ id: r.id, kind: r.kind, pharmacy: r.pharmacy, personal: r.personal, unclassified: r.unclassified })),
      mw.entries.map(x => ({ id: x.id, kind: x.kind, ...x.parts })));
    assert.deepEqual(card.totals, { pharmacy: naira(mw.scope.pharmacy), personal: naira(mw.scope.personal), unclassified: naira(mw.scope.unclassified) });
    for (const d of Object.keys(want)) assert.ok(card.rows.find(r => r.id === byDesc[d].id).text.includes('missing source'), d + ': the card shows the missing-source warning');

    // In-page engine on the app's own records equals the Node engine (whole measures object).
    const aw = await appState(W.page, sw, DBN[key]), ab = await appState(B.page, sb, DBN[key]);
    assert.equal(JSON.stringify(aw.m), JSON.stringify(mw), 'in-page measures = Node measures');
    assert.equal(JSON.stringify(ab.m), JSON.stringify(mb));

    // Warnings: the app's missing_account finding (high) lists every account-less entry.
    assert.equal(aw.missingAccount.severity, 'high');
    for (const d of Object.keys(want)) assert.ok(aw.missingAccount.ids.includes(String(byDesc[d].id)), d + ': missing_account');
    assert.deepEqual(ab.missingAccount.ids, [], 'base fixture has no account-less entry');

    // No account assigned: balances, confirmed pharmacy cash, held inflows and runway cash are identical
    // with and without the account-less income, as the app itself computes them.
    assert.deepEqual(aw.balances, ab.balances);
    assert.deepEqual([aw.available, aw.total, aw.held], [ab.available, ab.total, ab.held]);
    // ... and as the app displays them: Cash Now and the runway figures are identical; the warning shows.
    assert.ok(aw.ui.cashNow && aw.ui.runwayDays !== null, 'the Director cash row and the runway are rendered');
    assert.deepEqual([aw.ui.cashNow, aw.ui.runwayDays, aw.ui.runwayMeta], [ab.ui.cashNow, ab.ui.runwayDays, ab.ui.runwayMeta]);
    assert.ok(aw.ui.missingLine && /6 entries/.test(aw.ui.missingLine), 'the Director shows the missing-account warning: ' + aw.ui.missingLine);
    assert.equal(ab.ui.missingLine, null);
    // "Of which" figures are subdivisions: parents rise by exactly the classified amounts, once.
    assert.equal(aw.m.pharmacyReceipts - ab.m.pharmacyReceipts, aw.m.pharmacyReceiptsNoReceivingAccount);
    assert.equal(aw.m.personalIncome - ab.m.personalIncome, aw.m.personalIncomeNoReceivingAccount);
    assert.equal(K(aw.m.scope.total) - K(ab.m.scope.total), K(1000 + 3500 + 1500 + 700 + 1000 + 800));

    assert.deepEqual(W.page.errors, []); assert.deepEqual(B.page.errors, []);
    await W.context.close(); await B.context.close();
  });

  test(`${LABEL[key]}: reconciling account-less income on the same entry keeps its id and counts it once; the Stage 0 gate refuses to save a purpose while the switch is off; a separate second entry is counted again (documented stage 3 limit)`, { skip }, async () => {
    const sw = seedFor('with');
    const { context, page } = await openSeeded(key, sw);
    const c2 = sw.txns.find(t => t.desc === 'C2 pharmacy purpose, no account'), c4 = sw.txns.find(t => t.desc === 'C4 no split or purpose, no account');
    const openEdit = async id => { await page.click('.nav-btn[data-screen="timeline"]'); await page.click(`#timeline-list button[data-edit-txn="${id}"]`); await page.waitForSelector('#edit-modal.open[data-form-ready="1"]'); };
    const reviewAndConfirm = async () => { await page.click('#edit-save-btn'); await page.waitForSelector('#edit-review', { state: 'visible' }); await page.waitForSelector('#edit-confirm-btn[data-ready="1"]'); await page.click('#edit-confirm-btn'); };

    // (a) Stage 0 safeguard: with NEW_FINANCIAL_FORMAT off, the app's Edit form refuses to save an entry that
    // carries a purpose (a new-format field). The stored entry is unchanged and nothing is written. So on a
    // switch-off site a purpose-bearing account-less entry cannot be reconciled through the form; that path
    // is covered by the Node tests (N-T7b) and by (c) below.
    const s0 = await snapAll(page, DBN[key]);
    await openEdit(c2.id); await page.selectOption('#edit-to', 'opay'); await reviewAndConfirm();
    await page.waitForSelector('#edit-msg .form-err');
    assert.match((await page.textContent('#edit-msg')).replace(/\s+/g, ' '), /Changes NOT saved\. This site does not store KoboFlow.s new financial format yet \(purpose\)/);
    assert.equal(await snapAll(page, DBN[key]), s0, 'refused edit: every store unchanged');
    await page.evaluate(() => document.getElementById('edit-modal').classList.remove('open'));
    await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');

    // (b) The real Edit form on an account-less entry without new-format fields (C4): History → EDIT → To = Opay.
    const before = await appState(page, sw, DBN[key]), n0 = before.txns.length;
    await openEdit(c4.id); await page.selectOption('#edit-to', 'opay'); await reviewAndConfirm();
    await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
    const after = await appState(page, sw, DBN[key]);
    assert.equal(after.txns.length, n0, 'no new entry: the same record was edited');
    const e4 = after.txns.find(t => t.id === c4.id);
    assert.ok(e4, 'the entry keeps its id'); assert.equal(e4.toAcct, 'opay'); assert.equal(e4.amount, 700);
    assert.equal(after.m.unresolvedIncome, before.m.unresolvedIncome - 700, 'it leaves unresolved income');
    assert.equal(after.m.pharmacyReceipts, before.m.pharmacyReceipts + 700, 'and is a pharmacy receipt (confirmed Business account), once');
    assert.equal(after.m.allRecordedIncome, before.m.allRecordedIncome, 'recorded income unchanged: counted once');
    assert.equal(K(after.m.scope.total), K(before.m.scope.total));
    assert.equal(after.balances.opay - before.balances.opay, 700, 'the account now moves, once');
    assert.equal(after.available - before.available, 700, 'confirmed pharmacy cash rises by the amount, once');
    assert.ok(!after.missingAccount.ids.includes(String(c4.id)));
    assert.ok(/5 entries/.test(after.ui.missingLine || ''), 'the Director warning now counts 5 entries: ' + after.ui.missingLine);
    assert.notEqual(after.ui.cashNow, before.ui.cashNow, 'the displayed Cash Now reflects the reconciled income');
    assert.equal(JSON.stringify(after.m), JSON.stringify(F.financialMeasures(ACCTS, after.txns, opts(sw))), 'page = Node engine on the stored records');

    // (c) The purpose-bearing entry (C2) reconciled on the SAME record (same id) by a direct record update —
    // a deliberate test interaction standing in for the stage 3 capture path, not the UI. Counted once.
    await page.evaluate(([n, id]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const t = q.result.transaction('transactions', 'readwrite'), st = t.objectStore('transactions'); const g = st.get(id); g.onsuccess = () => { const r = g.result; r.toAcct = 'opay'; st.put(r); }; t.oncomplete = () => { q.result.close(); res(); }; }; }), [DBN[key], c2.id]);
    await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
    const after2 = await appState(page, sw, DBN[key]);
    assert.equal(after2.txns.length, n0); assert.equal(after2.txns.find(t => t.id === c2.id).purpose, 'pharmacy');
    assert.equal(after2.m.pharmacyReceipts, after.m.pharmacyReceipts, 'parent unchanged: already counted, once');
    assert.equal(after2.m.pharmacyReceiptsNoReceivingAccount, after.m.pharmacyReceiptsNoReceivingAccount - 3500, 'it leaves the "of which" part');
    assert.equal(after2.m.allRecordedIncome, after.m.allRecordedIncome);
    assert.equal(after2.balances.opay - after.balances.opay, 3500); assert.equal(after2.available - after.available, 3500);
    assert.ok(/4 entries/.test(after2.ui.missingLine || ''), after2.ui.missingLine);
    assert.deepEqual(page.errors, []); await context.close();

    // (d) Known Stage 1 limit (P-D13c; detection deferred to stage 3): a separate second entry for the same
    // money is counted in addition. Asserted so the limit stays visible, not to endorse it.
    const sb = seedFor('with'), Bw = await openSeeded(key, sb), aw = await appState(Bw.page, sb, DBN[key]); await Bw.context.close();
    const sd = seedFor('dup'), D = await openSeeded(key, sd), ad = await appState(D.page, sd, DBN[key]);
    assert.equal(ad.m.pharmacyReceipts - aw.m.pharmacyReceipts, 3500, 'the second entry adds the income again');
    assert.equal(ad.m.allRecordedIncome - aw.m.allRecordedIncome, 3500);
    assert.deepEqual(D.page.errors, []); await D.context.close();
  });

  if (key !== 'site') test(`${LABEL[key]}: with account-less income present, every other screen's text is identical to the accepted Stage 0 build`, { skip }, async (t) => {
    if (!stage0[key]) { t.skip('Stage 0 commit not in this checkout'); return; }
    const sw = seedFor('with');
    const a = await openSeeded(key, sw), b = await openSeeded(key + '0', sw);
    // Stage 2 (plan v11 6.3): the regions Stage 2 renders from the measures are removed from both pages (closed
    // allow-list, tests/stage2-regions.js); every other text must still be identical to the Stage 0 build.
    const ra = await stage2Texts(a.page, true), rb = await stage2Texts(b.page, true);
    assert.deepEqual(ra.outside, [], 'every Stage 2 element is inside an allow-listed region');
    const ta = ra.texts, tb = rb.texts;
    assert.equal(ta.length, tb.length);
    for (let i = 0; i < ta.length; i++) assert.equal(ta[i], tb[i], `screen ${tb[i].split(':')[0]}`);
    assert.deepEqual(a.page.errors, []); assert.deepEqual(b.page.errors, []);
    await a.context.close(); await b.context.close();
  });
}
