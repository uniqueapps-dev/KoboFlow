// Storage-failure reporting, persistent-storage handling, and test-build isolation
// (prototype-level, frame and worker routes). Served on one origin:
//   /koboflow-test/  generated TEST site      /KoboFlow/  production candidate
//   /probe           plain same-origin page with NO guard, used to inspect what really exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

/* ───────────── Static checks ───────────── */
test('storage wrapper has no silent fallbacks: failed reads reject instead of returning empty data', () => {
  const html = fs.readFileSync(path.join(ROOT, 'koboflow.html'), 'utf8');
  const shim = /\/\* KoboFlow IDB Shim v3[\s\S]*?\}\)\(window\);/.exec(html)[0];
  assert.doesNotMatch(shim, /fallback/);
  assert.match(shim, /get:\s+function\(key\)\s+\{ return run\('readonly',\s+function\(s\)\{ return s\.get\(key\); \}\); \}/);
  assert.match(shim, /toArray: function\(\)\s+\{ return run\('readonly',\s+function\(s\)\{ return s\.getAll\(\); \}\); \}/);
  assert.match(shim, /if \(!database\) \{ reject\(unavailable\(\)\); return; \}/);
});

test('test build guards IDBFactory.prototype and forbids frames, objects and foreign workers; the app creates none', () => {
  const testHtml = fs.readFileSync(path.join(ROOT, 'koboflow-test.html'), 'utf8');
  const prodHtml = fs.readFileSync(path.join(ROOT, 'koboflow.html'), 'utf8');
  assert.match(testHtml, /var F = w && w\.IDBFactory, P = F && F\.prototype;/);
  assert.match(testHtml, /<meta http-equiv="Content-Security-Policy" content="frame-src 'none'; child-src 'none'; object-src 'none'; worker-src 'self'"\/>/);
  assert.ok(testHtml.indexOf('Content-Security-Policy') < testHtml.indexOf('<script'), 'CSP is declared before any script');
  assert.ok(testHtml.indexOf('isolation guard'.replace('i', 'I')) < testHtml.indexOf('KoboFlow IDB Shim v3'), 'guard runs before the storage layer');
  assert.doesNotMatch(prodHtml, /Content-Security-Policy/, 'production unchanged by the test-only policy');
  for (const re of [/new Worker\(/, /SharedWorker/, /createElement\(['"](iframe|frame|object|embed)['"]\)/, /<(iframe|frame|object|embed)\b/i, /window\.open\(/, /importScripts/])
    assert.doesNotMatch(prodHtml, re, 'the app itself creates no frame/worker/popup route: ' + re);
});

/* ───────────── Browser harness ───────────── */
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
    // The same generated TEST page with only the guard script removed: used to check the CSP layer on its own.
    if (p === '/csp-only/') { const h = site['index.html'].toString(); const i = h.indexOf('<script>\n/* KOBOFLOW TEST BUILD'); const j = h.indexOf('</script>', i) + 9; return send(h.slice(0, i) + h.slice(j), 'text/html'); }
    if (p === '/probe') return send('<!doctype html><title>probe</title>', 'text/html');
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function ctx(init) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('CLEAR') : d.accept());
  return { context, page };
}
const openApp = async (page, p = '/koboflow-test/') => { await page.goto(base + p); await page.waitForSelector('body[data-kf-ready]'); return page.getAttribute('body', 'data-kf-ready'); };
// What actually exists, seen from an unguarded same-origin page.
async function realDatabases(context) {
  const probe = await context.newPage();
  await probe.goto(base + '/probe');
  const names = (await probe.evaluate(() => indexedDB.databases())).map(d => d.name).sort();
  await probe.close();
  return names;
}
async function seedTest(context, records) {
  const probe = await context.newPage();
  await probe.goto(base + '/probe');
  await probe.evaluate(recs => new Promise((res, rej) => { const q = indexedDB.open('KoboFlowDB-test'); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); recs.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = rej; }; q.onerror = rej; }), records);
  await probe.close();
}
async function runStorageCheck(page) {
  await page.click('#settings-nav-btn');
  await page.click('#storage-check-btn');
  await page.waitForFunction(() => !/Checking/.test(document.getElementById('storage-check-out').textContent));
  return page.textContent('#storage-check-out');
}

/* ───────────── Isolation: prototype, coercion, lock, frames, workers ───────────── */
test('guard refuses the live database through instance, prototype, coerced and re-assigned routes', { skip }, async () => {
  const { context, page } = await ctx();
  assert.equal(await openApp(page), '1');
  const r = await page.evaluate(async () => {
    const t = f => { try { f(); return 'allowed'; } catch (e) { return 'refused'; } };
    const out = {
      instanceOpen: t(() => indexedDB.open('KoboFlowDB')),
      protoOpenCall: t(() => IDBFactory.prototype.open.call(indexedDB, 'KoboFlowDB')),
      reflectApply: t(() => Reflect.apply(IDBFactory.prototype.open, indexedDB, ['KoboFlowDB', 3])),
      protoDelete: t(() => IDBFactory.prototype.deleteDatabase.call(indexedDB, 'KoboFlowDB')),
      instanceDelete: t(() => indexedDB.deleteDatabase('KoboFlowDB')),
      coercedObject: t(() => indexedDB.open({ toString() { return 'KoboFlowDB'; } })),
    };
    // A name object that changes value between reads: the guard reads it once and passes that exact string on.
    let n = 0; const flip = { toString() { return n++ === 0 ? 'kf-probe-flip' : 'KoboFlowDB'; } };
    out.flipping = await new Promise(res => { try { const q = indexedDB.open(flip); q.onsuccess = () => { const name = q.result.name; q.result.close(); res(name); }; q.onerror = () => res('error'); } catch (e) { res('refused'); } });
    // The patched methods cannot be replaced or redefined.
    const before = IDBFactory.prototype.open;
    try { IDBFactory.prototype.open = function () { return 'replaced'; }; } catch (e) { /* non-writable */ }
    out.reassignBlocked = IDBFactory.prototype.open === before;
    out.redefineBlocked = t(() => Object.defineProperty(IDBFactory.prototype, 'open', { value: () => 'x' })) === 'refused';
    out.afterReassign = t(() => indexedDB.open('KoboFlowDB'));
    out.listed = (await indexedDB.databases()).map(d => d.name);
    return out;
  });
  assert.deepEqual(r, { instanceOpen: 'refused', protoOpenCall: 'refused', reflectApply: 'refused', protoDelete: 'refused', instanceDelete: 'refused', coercedObject: 'refused',
    flipping: 'kf-probe-flip', reassignBlocked: true, redefineBlocked: true, afterReassign: 'refused', listed: ['KoboFlowDB-test', 'kf-probe-flip'].filter(x => r.listed.includes(x)) });
  assert.ok(!r.listed.includes('KoboFlowDB'));
  // The app's own operations still work under the guard.
  await page.fill('#capture-input', '2500 fuel fjr');
  await page.press('#capture-input', 'Enter');
  assert.match(await runStorageCheck(page), /Stored entries: 1 \(1 active · 0 reversed\)/);
  assert.ok(!(await realDatabases(context)).includes('KoboFlowDB'), 'live database never created');
  assert.deepEqual(page.errors, []);
  await context.close();
});

// Previously this test attached a blank iframe and checked the guard inside its realm. The final
// review showed that realm was still reachable through window.frames[n], so the TEST build now
// refuses to create frames at all; the realm checks are replaced by checks that no frame can exist.
test('frame and worker routes: the TEST page cannot create frames or workers; CSP alone also blocks framing other pages and blob/data workers', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page);
  const r = await page.evaluate(async () => {
    const t = f => { try { f(); return 'allowed'; } catch (e) { return /refused/.test(e.message) ? 'refused' : 'error: ' + e.message; } };
    return {
      createIframe: t(() => document.createElement('iframe')),
      frameMarkup: t(() => { document.body.insertAdjacentHTML('beforeend', '<iframe src="/KoboFlow/"></iframe>'); }),
      blobWorker: t(() => new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' })))),
      dataWorker: t(() => new Worker('data:text/javascript,postMessage(1)')),
      frames: window.frames.length,
    };
  });
  assert.deepEqual(r, { createIframe: 'refused', frameMarkup: 'refused', blobWorker: 'refused', dataWorker: 'refused', frames: 0 });

  // Second layer: the CSP of the generated page, without the guard script.
  const csp = await context.newPage();
  await csp.goto(base + '/csp-only/');
  const c = await csp.evaluate(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', e => violations.push(e.effectiveDirective));
    const f2 = document.createElement('iframe'); f2.src = '/KoboFlow/'; document.body.appendChild(f2);
    await new Promise(x => setTimeout(x, 1500));
    let framedLoaded; try { framedLoaded = !!(f2.contentDocument && f2.contentDocument.querySelector('#app')); } catch (e) { framedLoaded = 'cross-origin error page'; }
    f2.remove();
    const worker = await new Promise(res => { try { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }))); w.onmessage = () => res('ran'); w.onerror = () => res('blocked'); setTimeout(() => res('blocked'), 1500); } catch (e) { res('blocked'); } });
    const dataWorker = await new Promise(res => { try { const w = new Worker('data:text/javascript,postMessage(1)'); w.onmessage = () => res('ran'); w.onerror = () => res('blocked'); setTimeout(() => res('blocked'), 1500); } catch (e) { res('blocked'); } });
    return { guard: !!window.__kfTestBuild, framedLoaded, violations: [...new Set(violations)].sort(), worker, dataWorker };
  });
  assert.equal(c.guard, false, 'this copy really has no guard script');
  assert.notEqual(c.framedLoaded, true, 'production page did not load inside the page');
  assert.ok(c.violations.includes('frame-src'), 'frame blocked by CSP: ' + c.violations);
  assert.equal(c.worker, 'blocked');
  assert.equal(c.dataWorker, 'blocked');
  assert.ok(!(await realDatabases(context)).includes('KoboFlowDB'), 'live database never created (the framed production page never ran)');
  await context.close();
});

// The exact bypass found in the final review: a blank iframe (no fetch, so the CSP allows it)
// reached through window.frames[n], which no property getter can intercept.
test('review bypass: a blank iframe reached through window.frames[n] cannot open or delete the live database', { skip }, async () => {
  const { context, page } = await ctx();
  assert.equal(await openApp(page), '1');
  const r = await page.evaluate(async () => {
    const res = {};
    try {
      document.body.appendChild(document.createElement('iframe'));
      const w = window.frames[window.frames.length - 1];
      res.open = await new Promise(ok => { const q = w.indexedDB.open('KoboFlowDB'); q.onsuccess = () => { q.result.close(); ok('OPENED'); }; q.onerror = () => ok('error'); });
      w.indexedDB.deleteDatabase('KoboFlowDB'); res.del = 'DELETE ISSUED';
    } catch (e) { res.refused = e.message; }
    res.frames = window.frames.length;
    return res;
  });
  assert.deepEqual(r, { refused: 'KoboFlow TEST build: refused to create a frame (frames are not allowed in the test build)', frames: 0 });
  assert.ok(!(await realDatabases(context)).includes('KoboFlowDB'), 'live database never created');
  await context.close();
});

test('every frame, popup and worker route is refused, the guard cannot be replaced, and KoboFlowDB-test still works', { skip }, async () => {
  const { context, page } = await ctx();
  assert.equal(await openApp(page), '1');
  const r = await page.evaluate(async () => {
    const out = {};
    const t = async (k, f) => { try { await f(); out[k] = 'ALLOWED, frames=' + window.frames.length; } catch (e) { out[k] = /^KoboFlow TEST build: refused/.test(e.message) ? 'refused' : 'other error: ' + e.message; } };
    const div = () => document.body.appendChild(document.createElement('div'));
    await t('innerHTML', () => { div().innerHTML = '<IFRAME></IFRAME>'; });
    await t('outerHTML', () => { div().outerHTML = '<iframe></iframe>'; });
    await t('insertAdjacentHTML', () => document.body.insertAdjacentHTML('beforeend', '<iframe>'));
    await t('createElementNS', () => document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe'));
    await t('object', () => document.createElement('object'));
    await t('embed', () => document.createElement('EMBED'));
    await t('frameset', () => document.createElement('frameset'));
    await t('DOMParser', () => new DOMParser().parseFromString('<iframe></iframe>', 'text/html'));
    await t('createContextualFragment', () => document.createRange().createContextualFragment('<iframe></iframe>'));
    await t('template', () => { document.createElement('template').innerHTML = '<iframe></iframe>'; });
    await t('closed shadow root', () => { div().attachShadow({ mode: 'closed' }).innerHTML = '<iframe></iframe>'; });
    await t('setHTMLUnsafe', () => div().setHTMLUnsafe('<div><template shadowrootmode="open"><iframe></iframe></template></div>'));
    await t('document.write', () => document.write('<iframe></iframe>'));
    await t('execCommand insertHTML', () => { const d = div(); d.contentEditable = 'true'; d.focus(); document.execCommand('insertHTML', false, '<iframe></iframe>'); });
    await t('customized built-in', () => { class X extends HTMLIFrameElement {} customElements.define('x-kf-frame', X, { extends: 'iframe' }); });
    await t('window.open', () => window.open(''));
    await t('document.open(url,name,features)', () => document.open('', 'x', ''));
    await t('Worker', () => new Worker('./test-sw.js'));
    await t('SharedWorker', () => new SharedWorker('./test-sw.js'));
    await t('foreign service worker', () => navigator.serviceWorker.register('/KoboFlow/sw.js'));
    // A document parsed by XMLHttpRequest can contain a frame; inserting it is refused.
    const doc = new Document(); const html = doc.appendChild(doc.createElementNS('http://www.w3.org/1999/xhtml', 'html'));
    out.foreignDocCanHoldFrame = (() => { try { html.appendChild(doc.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')); return 'yes'; } catch (e) { return 'no'; } })();
    // Tampering: the guards are locked.
    out.reassign = (() => { try { Document.prototype.createElement = function () { return 1; }; } catch (e) { /* non-writable */ } try { document.createElement('iframe'); return 'iframe created'; } catch (e) { return 'still refused'; } })();
    out.redefine = (() => { try { Object.defineProperty(Element.prototype, 'innerHTML', { set() {} }); return 'redefined'; } catch (e) { return 'locked'; } })();
    out.frames = window.frames.length;
    out.testDb = await new Promise(ok => { const q = indexedDB.open('KoboFlowDB-test'); q.onsuccess = () => { q.result.close(); ok('opens'); }; q.onerror = () => ok('error'); });
    return out;
  });
  const refused = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createElementNS', 'object', 'embed', 'frameset', 'DOMParser', 'createContextualFragment', 'template', 'closed shadow root', 'setHTMLUnsafe', 'document.write', 'execCommand insertHTML', 'customized built-in', 'window.open', 'document.open(url,name,features)', 'Worker', 'SharedWorker', 'foreign service worker'];
  for (const k of refused) assert.equal(r[k], 'refused', k);
  assert.equal(r.reassign, 'still refused');
  assert.equal(r.redefine, 'locked');
  assert.equal(r.frames, 0);
  assert.equal(r.testDb, 'opens');
  // Normal app behaviour is unaffected: a quick entry saves to KoboFlowDB-test.
  await page.fill('#capture-input', '2500 fuel fjr');
  await page.press('#capture-input', 'Enter');
  await page.waitForFunction(() => document.getElementById('capture-input').value === '');
  assert.match(await runStorageCheck(page), /Database: KoboFlowDB-test \(v3\)[\s\S]*Stored entries: 1 /);
  assert.deepEqual(page.errors, []);
  assert.ok(!(await realDatabases(context)).includes('KoboFlowDB'), 'live database never created');
  await context.close();
});

test('a document parsed by XMLHttpRequest that contains a frame cannot be inserted into the TEST page', { skip }, async () => {
  const { context, page } = await ctx();
  await page.route('**/has-iframe.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body><p>x</p><iframe></iframe></body>' }));
  await openApp(page);
  const r = await page.evaluate(async () => {
    const doc = await new Promise(res => { const x = new XMLHttpRequest(); x.open('GET', '/has-iframe.html'); x.responseType = 'document'; x.onload = () => res(x.response); x.send(); });
    const t = f => { try { f(); return 'ALLOWED, frames=' + window.frames.length; } catch (e) { return /refused/.test(e.message) ? 'refused' : e.message; } };
    return { parsedHasFrame: !!doc.querySelector('iframe'), append: t(() => document.body.appendChild(document.importNode(doc.body, true))), bodySetter: t(() => { document.body = document.importNode(doc.body, true); }), frames: window.frames.length };
  });
  assert.deepEqual(r, { parsedHasFrame: true, append: 'refused', bodySetter: 'refused', frames: 0 });
  assert.ok(!(await realDatabases(context)).includes('KoboFlowDB'));
  await context.close();
});

/* ───────────── Storage failures are reported, never shown as empty ───────────── */
test('database cannot be opened (synchronous failure): startup not ready, warning shown, Storage Check says NOT available', { skip }, async () => {
  const { context, page } = await ctx(() => { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (n) { if (String(n) === 'KoboFlowDB-test') throw new DOMException('simulated: storage blocked', 'SecurityError'); return o.apply(this, arguments); }; });
  assert.equal(await openApp(page), 'error');
  assert.match(await page.textContent('#dialog-warning'), /Storage unavailable: KoboFlow could not open or read its database \(KoboFlowDB-test\): simulated: storage blocked/);
  const sc = await runStorageCheck(page);
  assert.match(sc, /Storage NOT available: could not open database KoboFlowDB-test \(simulated: storage blocked\)/);
  assert.doesNotMatch(sc, /Stored entries|Account setup saved/, 'no false "empty" figures');
  await context.close();
});

test('database cannot be opened (version error during open): same failure reporting', { skip }, async () => {
  const { context, page } = await ctx();
  const probe = await context.newPage();
  await probe.goto(base + '/probe');
  await probe.evaluate(() => new Promise(res => { const q = indexedDB.open('KoboFlowDB-test', 9); q.onsuccess = () => { q.result.close(); res(); }; }));
  await probe.close();
  assert.equal(await openApp(page), 'error');
  const sc = await runStorageCheck(page);
  assert.match(sc, /Storage NOT available: could not open database KoboFlowDB-test/);
  assert.doesNotMatch(sc, /Stored entries/);
  await context.close();
});

test('database opens but reading fails: startup not ready, Storage Check says QUERY FAILED, not empty', { skip }, async () => {
  const { context, page } = await ctx(() => { const g = IDBObjectStore.prototype.getAll; IDBObjectStore.prototype.getAll = function () { if (this.name === 'transactions') throw new DOMException('simulated: read failure', 'UnknownError'); return g.apply(this, arguments); }; });
  assert.equal(await openApp(page), 'error');
  assert.match(await page.textContent('#dialog-warning'), /could not open or read its database/);
  const sc = await runStorageCheck(page);
  assert.match(sc, /Storage QUERY FAILED: database KoboFlowDB-test opened, but reading it failed \(simulated: read failure\)\. Entries cannot be counted\. Do not assume the database is empty\./);
  assert.doesNotMatch(sc, /Stored entries/);
  await context.close();
});

test('a genuinely empty database is reported as available and empty, with ready state set', { skip }, async () => {
  const { context, page } = await ctx();
  assert.equal(await openApp(page), '1');
  assert.equal(await page.isVisible('#dialog-warning'), false);
  const sc = await runStorageCheck(page);
  assert.match(sc, /Storage: available/);
  assert.match(sc, /Database: KoboFlowDB-test \(v3\)/);
  assert.match(sc, /Stored entries: 0 \(0 active · 0 reversed\) · agreements: 0/);
  await context.close();
});

test('Storage Check shows the opened database and separates active from reversed entries', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page); // creates KoboFlowDB-test v3
  await seedTest(context, [
    { id: 1, amount: 100, type: 'expense', date: '2026-10-01', time: '09:00', desc: 'a' },
    { id: 2, amount: 200, type: 'income', date: '2026-10-01', time: '09:01', desc: 'b' },
    { id: 3, amount: 50, type: 'loan_repayment', date: '2026-10-01', time: '09:02', desc: 'c', voided: true },
  ]);
  await openApp(page);
  assert.match(await runStorageCheck(page), /Stored entries: 3 \(2 active · 1 reversed\)/);
  await context.close();
});

test('Clear All Data reports a storage failure instead of pretending it worked', { skip }, async () => {
  const { context, page } = await ctx(() => { IDBObjectStore.prototype.clear = function () { throw new DOMException('simulated: clear failure', 'UnknownError'); }; });
  await openApp(page);
  await page.fill('#capture-input', '2500 fuel fjr');
  await page.press('#capture-input', 'Enter');
  await page.click('#settings-nav-btn');
  await page.click('#clear-data-btn');
  await page.waitForSelector('#dialog-warning', { state: 'visible' });
  assert.match(await page.textContent('#dialog-warning'), /Clear All Data FAILED: simulated: clear failure/);
  assert.match(await runStorageCheck(page), /Stored entries: 1 /, 'data still there and reported');
  await context.close();
});

test('production candidate also refuses to claim readiness when its database cannot open', { skip }, async () => {
  const { context, page } = await ctx(() => { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (n) { if (String(n) === 'KoboFlowDB') throw new DOMException('simulated', 'SecurityError'); return o.apply(this, arguments); }; });
  assert.equal(await openApp(page, '/KoboFlow/'), 'error');
  assert.match(await runStorageCheck(page), /Storage NOT available: could not open database KoboFlowDB/);
  await context.close();
});

/* ───────────── Persistent storage: requested, never assumed ───────────── */
// Installs a fake navigator.storage before the app runs. mode: granted | denied | reject | unsupported | persistedThrows | already
const fakeStorage = mode => {
  window.__persistCalls = 0;
  if (mode === 'unsupported') { Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true }); return; }
  let granted = mode === 'already';
  const st = {
    persisted() { if (mode === 'persistedThrows') return Promise.reject(new Error('persisted unavailable')); return Promise.resolve(granted); },
    persist() { window.__persistCalls++; if (mode === 'reject') return Promise.reject(new Error('quota policy error')); if (mode === 'granted' || window.__grantNext) granted = true; return Promise.resolve(granted); },
  };
  Object.defineProperty(navigator, 'storage', { value: st, configurable: true });
};
const cases = [
  ['granted', 'startup request granted', /Persistent storage: granted\. The browser should not clear this data automatically/, /Last request \(startup\): granted\./, 1],
  ['denied', 'startup request denied', /Persistent storage: not granted\. Data is best-effort/, /Last request \(startup\): denied by the browser\./, 1],
  ['reject', 'request rejects with an error', /Persistent storage: not granted\./, /Last request \(startup\): failed \(quota policy error\)\./, 1],
  ['unsupported', 'API not supported', /Persistent storage: not supported by this browser\./, /Last request \(startup\): not supported by this browser\./, 0],
  ['persistedThrows', 'state cannot be read', /Persistent storage: unknown: the browser could not report it \(persisted unavailable\)\./, /Last request \(startup\): denied by the browser\./, 1],
  ['already', 'already granted earlier', /Persistent storage: granted\./, /Last request \(startup\): already granted\./, 0],
];
for (const [mode, label, statusRe, lastRe, calls] of cases) {
  test(`persistent storage — ${label}: app works and shows the real state`, { skip }, async () => {
    const { context, page } = await ctx(fakeStorage.toString().replace(/^mode =>/, '(mode =>') + `)(${JSON.stringify(mode)})`);
    assert.equal(await openApp(page), '1', 'persistence outcome never breaks startup');
    await page.waitForFunction(() => /Last request/.test(document.getElementById('persist-out').textContent));
    const sc = await runStorageCheck(page);
    assert.match(sc, statusRe);
    assert.match(sc, lastRe);
    assert.equal(await page.evaluate(() => window.__persistCalls), calls, 'persist() call count');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('persistent storage — the Request button asks again and shows the new result', { skip }, async () => {
  const { context, page } = await ctx(fakeStorage.toString().replace(/^mode =>/, '(mode =>') + `)("denied")`);
  await openApp(page);
  await page.click('#settings-nav-btn');
  await page.waitForFunction(() => /Last request \(startup\): denied/.test(document.getElementById('persist-out').textContent));
  await page.evaluate(() => { window.__grantNext = true; });
  await page.click('#persist-request-btn');
  await page.waitForFunction(() => /Last request \(manual\): granted/.test(document.getElementById('storage-check-out').textContent));
  assert.match(await page.textContent('#storage-check-out'), /Persistent storage: granted\./);
  assert.match(await page.textContent('#persist-out'), /Status: granted\./);
  assert.equal(await page.evaluate(() => window.__persistCalls), 2);
  await context.close();
});
