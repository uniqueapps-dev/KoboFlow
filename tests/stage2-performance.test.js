// STAGE 2 — performance (plan v11 5, 6, 7): the app's start-up render (load the records, one full render pass of every
// screen) at 500, 3,000 and 10,000 fictional entries, on the Stage 2 production candidate and on the accepted Stage 1
// source (3bdacf3), in the same browser. Stage 2 computes ONE measures result per period per render pass (measuresFor,
// memoised); this records how many are computed and checks that a render stays usable. The figures are printed for the
// delivery report. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';
const STAGE1 = '3bdacf30f1ffbe257b324534ee9c1153c1e04651';
const SIZES = [500, 3000, 10000];
const BUDGET_MS = 30000; // generous ceiling for the slowest size on a shared CI machine; the report gives the measured values

const CONF = '2026-09-01T09:00:00.000Z';
const acct = (id, use, o = {}) => ({ id, label: 'Fictional ' + id, kind: 'bank', opening: 0, use, useConfirmedAt: use ? CONF : null, useConfirmedValue: use || null, institution: 'Fictional', ...o });
function seed(n) {
  const now = new Date(), iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const baseline = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 120));
  const accounts = [acct('opay', 'business', { kind: 'wallet', opening: 5000000, primary: true }), acct('tb', 'business', { opening: 2000000 }), acct('pb', 'personal', { opening: 500000 }),
    acct('sh', 'shared', { opening: 3000000, sharedPortion: { amount: 1000000, declaredAt: '2026-09-01' } })];
  const txns = [], from = ['opay', 'tb', 'pb', 'sh', ''], kinds = [{}, { purpose: 'pharmacy' }, { purpose: 'personal' }, { purpose: 'unclassified' }];
  for (let i = 0; i < n; i++) {
    const d = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (i % 110))), r = i % 10;
    const base = { id: 100000 + i, amount: 500 + (i % 97) * 10, desc: 'Fictional ' + i, cat: ['Restocking', 'Food', 'Utilities', 'Other'][i % 4], date: d, time: String(8 + (i % 12)).padStart(2, '0') + ':00', fromAcct: '', toAcct: '', state: 'Manual' };
    if (r < 4) txns.push({ ...base, type: 'expense', fromAcct: from[i % 5], ...kinds[i % 4] });
    else if (r < 7) txns.push({ ...base, type: 'income', toAcct: ['opay', 'tb', 'pb', ''][i % 4], amount: base.amount * 3 });
    else if (r === 7) txns.push({ ...base, type: 'transfer', fromAcct: 'opay', toAcct: 'tb' });
    else if (r === 8) txns.push({ ...base, type: 'owner_withdrawal', fromAcct: 'opay', toAcct: 'pb' });
    else txns.push({ ...base, type: 'loan_repayment', fromAcct: 'opay', alloc: { principal: base.amount - 100, interest: 100, fees: 0 } });
  }
  return { setup: { id: 'ledgerSetup', mode: 'live', baselineDate: baseline, aliases: {}, accounts, buckets: [], budgets: [{ cat: 'Food', amount: 500000 }] }, txns };
}

let server, base, browser, stage1 = null;
test.before(async () => {
  if (!pw) return;
  try { stage1 = execFileSync('git', ['show', `${STAGE1}:koboflow.html`], { cwd: ROOT, maxBuffer: 1 << 26 }); } catch (e) { stage1 = null; }
  server = http.createServer((req, res) => { const k = new URL(req.url, 'http://x').pathname.replace(/\//g, '');
    const b = k === 'stage2' ? fs.readFileSync(path.join(ROOT, 'koboflow.html')) : k === 'stage1' ? stage1 : null;
    if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function timeLoad(key, s) {
  const context = await browser.newContext();
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  // Count the measures computations of each render pass (Stage 2 memoises one result per period).
  await context.addInitScript(() => { window.__fm = 0; Object.defineProperty(window, 'KoboFin', { configurable: true, set(v) { const f = v.financialMeasures; v.financialMeasures = function () { window.__fm++; return f.apply(this, arguments); }; Object.defineProperty(window, 'KoboFin', { value: v, writable: true, configurable: true }); }, get() { return undefined; } }); });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/${key}/`); await page.waitForSelector('body[data-kf-ready="1"]');
  await page.evaluate(s => new Promise((res, rej) => { const q = indexedDB.open('KoboFlowDB'); q.onsuccess = () => { const tx = q.result.transaction(['meta', 'transactions'], 'readwrite'); tx.objectStore('meta').put(s.setup); s.txns.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), s);
  const t0 = Date.now();
  await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]', { timeout: 120000 });
  const ms = Date.now() - t0, fm = await page.evaluate(() => window.__fm);
  const shown = key === 'stage2' ? await page.$$eval('#cf-s2 [data-opc]', e => e.length) : null;
  await context.close();
  return { ms, fm, errors, shown };
}

test('performance: start-up render at 500, 3,000 and 10,000 entries, Stage 2 and the accepted Stage 1 build', { skip, timeout: 900000 }, async () => {
  const rows = [];
  for (const n of SIZES) {
    const s = seed(n);
    const after = await timeLoad('stage2', s), before = stage1 ? await timeLoad('stage1', s) : null;
    assert.deepEqual(after.errors, []); if (before) assert.deepEqual(before.errors, []);
    assert.equal(after.shown, 2, 'the Stage 2 Cash Flow rendered');
    assert.ok(after.ms < BUDGET_MS, `${n} entries: Stage 2 start-up ${after.ms} ms`);
    rows.push({ entries: n, stage2Ms: after.ms, stage1Ms: before ? before.ms : null, stage2MeasuresComputations: after.fm, stage1MeasuresComputations: before ? before.fm : null });
  }
  console.log('STAGE2_PERFORMANCE ' + JSON.stringify(rows));
  // One computation per period per render pass: the count does not grow with the number of entries.
  assert.equal(new Set(rows.map(r => r.stage2MeasuresComputations)).size, 1, 'the same number of measures computations at every size');
});
