// CSV export: text from typing or from an imported backup can never become a spreadsheet
// formula, cells stay correctly quoted, and genuine numbers stay numeric.
// Runs against the generated TEST site and the production candidate, checks the downloaded
// bytes with a strict RFC 4180 parser, and — when LibreOffice is installed — opens the exact
// file in a real spreadsheet engine to confirm no cell is a formula. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';
const soffice = ['soffice', 'libreoffice'].find(c => spawnSync('which', [c]).status === 0);
const hasOpenpyxl = spawnSync('python3', ['-I', '-c', 'import openpyxl']).status === 0;
const lo = !(soffice && hasOpenpyxl) && 'LibreOffice and openpyxl not installed';

const BUILDS = [
  { label: 'TEST build', url: '/koboflow-test/', dbName: 'KoboFlowDB-test' },
  { label: 'production candidate', url: '/KoboFlow/', dbName: 'KoboFlowDB' },
];
const COLS = ['ID', 'Date', 'Time', 'Description', 'Category', 'Type', 'Amount', 'From', 'To', 'State', 'Agreement', 'Principal', 'Interest', 'Fees', 'Unsplit', 'Reversed', 'Paid to', 'Received from'];
// Formula-like values, each put into a text field that a backup can carry.
const DANGEROUS = [
  '=1+1', '+2+3', '-4+5', '@SUM(1,2)', '=HYPERLINK("http://example.invalid","click")', "=cmd|' /C calc'!A0",
  ' =5+5', '\t=6+7', '\r=8+9', '\n=10+11', ' =12+13', '​=14+15', '﻿=16+17', '＝18+19', '-', '@',
];
// Ordinary text: must come back exactly as written, without a marker.
const ORDINARY = ['Café — ₦5,000 & "quotes", commas', 'Line one\nline two', "Owner's drawings", 'Fuel - FJR', 'Opay wallet', 'Restock 50% off', 'a+b=c (not a formula)'];

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

// Strict RFC 4180 parser: returns rows of { v, quoted } and throws on malformed quoting.
function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false, inQ = false, i = 0;
  const end = () => { row.push({ v: cell, quoted }); cell = ''; quoted = false; };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { inQ = false; if (i + 1 < text.length && !/[,\r\n]/.test(text[i + 1])) throw new Error('text after closing quote at ' + i); } }
      else cell += ch;
    } else if (ch === '"') { if (cell !== '' || quoted) throw new Error('stray quote at ' + i); inQ = quoted = true; }
    else if (ch === ',') end();
    else if (ch === '\r' && text[i + 1] === '\n') { end(); rows.push(row); row = []; i++; }
    else if (ch === '\n' || ch === '\r') { end(); rows.push(row); row = []; }
    else cell += ch;
  }
  if (inQ) throw new Error('unterminated quoted field');
  if (cell !== '' || row.length) { end(); rows.push(row); }
  return rows;
}
const FORMULA_START = /^[\s\u0000-\u001f\u007f​-‍⁠﻿]*[=+\-@＝＋－＠]/;

async function ctx() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
async function exportCsv(page) {
  await page.click('#settings-nav-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv-btn')]);
  return fs.readFileSync(await dl.path());
}
async function addEntry(page, amount, desc) {
  await page.click('#add-btn'); await page.fill('#modal-amount', String(amount)); await page.fill('#modal-desc', desc);
  await page.selectOption('#modal-from', { index: 1 }); // an expense needs the account it is paid from
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
}
async function seed(context, dbName, recs) {
  const probe = await context.newPage();
  await probe.goto(base + '/probe');
  await probe.evaluate(([n, rs]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); rs.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; q.onerror = () => rej(q.error); }), [dbName, recs]);
  await probe.close();
}
// Fill a scenario: typed entries, a vehicle log, an imported backup full of formula-like text,
// and two stored records with genuine numbers (including a negative one) written directly.
async function scenario(context, page, b) {
  await openApp(page, b.url);
  await addEntry(page, 2500, '=1+1 typed in Add Entry');
  for (const [k, t] of ORDINARY.filter(t => !/\n/.test(t)).entries()) await addEntry(page, 100 + k, t); // the form cannot hold line breaks
  await page.click('.nav-btn[data-screen="vehicles"]');
  await page.click('.vehicle-panel.active .add-vlog-btn'); await page.fill('#vlog-amount', '300'); await page.fill('#vlog-desc', '@vehicle note');
  await page.click('#vlog-save-btn');
  await page.waitForFunction(() => !document.getElementById('vlog-modal-overlay').classList.contains('open'));
  const today = new Date().toISOString().slice(0, 10);
  const imported = DANGEROUS.map((v, k) => ({ id: 70000 + k, amount: 10 + k, desc: v, cat: v, type: v, state: v, time: v, fromAcct: v, toAcct: v, agreementId: undefined, date: today }));
  imported.push({ id: 70100, amount: 55, desc: 'Line one\nline two', cat: 'Food', type: 'expense', state: 'Linked', date: today, time: '09:00', fromAcct: 'pharma_bank', toAcct: '' });
  const file = path.join(os.tmpdir(), `kf-csv-${process.pid}-${b.dbName}.json`);
  fs.writeFileSync(file, JSON.stringify({ app: 'KoboFlow', version: '3.2', transactions: imported, agreements: [], instalments: [], allocations: [], agreementEvents: [], opportunities: [] }));
  await page.click('#settings-nav-btn');
  await page.setInputFiles('#import-file-input', file);
  await page.waitForFunction(() => /Line one/.test(document.getElementById('timeline-list').textContent));
  fs.unlinkSync(file);
  await seed(context, b.dbName, [
    { id: 80001, amount: -250, desc: 'Fictional refund adjustment', cat: 'Adjustment', type: 'expense', state: 'Linked', date: today, time: '10:00', fromAcct: '', toAcct: '' },
    { id: 80002, amount: 1234.5, desc: 'Fictional repayment', cat: 'Loan Repayment', type: 'loan_repayment', state: 'Linked', date: today, time: '10:01', fromAcct: '', toAcct: '', agreementId: '=agr(1)', alloc: { principal: 1000, interest: 234.5, fees: 0 } },
  ]);
  await openApp(page, b.url);
}

for (const b of BUILDS) {
  test(`${b.label}: CSV export neutralizes formula-like text, keeps quoting correct and numbers numeric`, { skip }, async () => {
    const { context, page } = await ctx();
    await scenario(context, page, b);
    const bytes = await exportCsv(page);
    const text = bytes.toString('utf8');
    assert.equal(text.charCodeAt(0), 0xfeff, 'UTF-8 byte-order mark for Excel');
    const rows = parseCSV(text.slice(1));
    assert.deepEqual(rows[0].map(c => c.v), COLS);
    assert.ok(rows.every(r => r.length === COLS.length), 'every row has exactly ' + COLS.length + ' cells: ' + rows.map(r => r.length).join(','));
    const col = n => COLS.indexOf(n);
    const byId = Object.fromEntries(rows.slice(1).map(r => [r[0].v, r]));

    // 1. Every formula-like value, in every text column, comes back as ' + the original value.
    for (const [k, v] of DANGEROUS.entries()) {
      const r = byId[String(70000 + k)];
      assert.ok(r, 'imported row ' + JSON.stringify(v));
      for (const c of ['Description', 'Category', 'Type', 'State', 'Time', 'From', 'To']) {
        assert.equal(r[col(c)].v, "'" + v, `${c} of ${JSON.stringify(v)}`);
        assert.equal(r[col(c)].quoted, true);
      }
    }
    // 2. Typed and vehicle-log text too.
    const descs = rows.slice(1).map(r => r[col('Description')].v);
    assert.ok(descs.includes("'=1+1 typed in Add Entry"));
    assert.ok(descs.some(d => d.startsWith("'@vehicle note")), 'vehicle log description neutralized');
    // 3. Ordinary text is unchanged: commas, quotes, Unicode, apostrophes, embedded line breaks.
    for (const t of ORDINARY) assert.ok(descs.includes(t), 'unchanged: ' + JSON.stringify(t));
    // 4. Global invariant: no text cell anywhere could start a formula.
    for (const r of rows) for (const c of r) if (c.quoted) assert.ok(!FORMULA_START.test(c.v), 'formula-like cell: ' + JSON.stringify(c.v));
    // 5. Numbers stay bare numbers, negative included; the agreement id is text.
    assert.equal(byId['80001'][col('Amount')].v, '-250'); assert.equal(byId['80001'][col('Amount')].quoted, false);
    assert.equal(byId['80002'][col('Amount')].v, '1234.5'); assert.equal(byId['80002'][col('Amount')].quoted, false);
    assert.deepEqual([col('Principal'), col('Interest'), col('Fees')].map(i => byId['80002'][i].v), ['1000', '234.5', ''], 'zero fee stays blank, as before');
    assert.equal(byId['80002'][col('Agreement')].v, "'=agr(1)");
    assert.ok(rows.slice(1).every(r => r[col('Amount')].quoted === false && /^-?\d+(\.\d+)?$/.test(r[col('Amount')].v)), 'every amount is a bare number');
    assert.ok(rows.slice(1).every(r => r[col('ID')].quoted === false && /^\d+$/.test(r[col('ID')].v)), 'every id is a bare number');
    // 6. JSON backup is unaffected: values are exported exactly as stored, without markers.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json-btn')]);
    const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(backup.transactions.find(t => t.id === 70000).desc, '=1+1');
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: the exported CSV opened in LibreOffice has no formula cells and keeps amounts numeric`, { skip: skip || lo }, async () => {
    const { context, page } = await ctx();
    await scenario(context, page, b);
    const bytes = await exportCsv(page);
    await context.close();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-csv-lo-'));
    fs.writeFileSync(path.join(dir, 'export.csv'), bytes);
    // Comma-separated, double-quoted, UTF-8; LibreOffice's defaults otherwise (formulas evaluated).
    const conv = spawnSync(soffice, ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--infilter=CSV:44,34,76,1', '--convert-to', 'xlsx', '--outdir', dir, path.join(dir, 'export.csv')], { timeout: 120000 });
    assert.equal(conv.status, 0, 'conversion ran: ' + conv.stderr);
    const py = `import sys, json, openpyxl
ws = openpyxl.load_workbook(sys.argv[1]).active
head = [c.value for c in ws[1]]
cells = [[(c.value, c.data_type) for c in r] for r in ws.iter_rows(min_row=2)]
print(json.dumps({"head": head, "formulas": [v for r in cells for (v, t) in r if t == "f"], "amountTypes": sorted(set(r[head.index("Amount")][1] for r in cells)), "desc": [r[head.index("Description")][0] for r in cells]}))`;
    const out = spawnSync('python3', ['-I', '-c', py, path.join(dir, 'export.xlsx')], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(out.status, 0, out.stderr);
    const r = JSON.parse(out.stdout);
    assert.deepEqual(r.head, COLS);
    assert.deepEqual(r.formulas, [], 'no cell became a formula');
    assert.deepEqual(r.amountTypes, ['n'], 'every amount is a number cell');
    assert.ok(r.desc.includes("'=1+1"), 'the formula-like description is plain text');
    assert.ok(r.desc.includes('Café — ₦5,000 & "quotes", commas'), 'Unicode and punctuation intact');
  });
}
