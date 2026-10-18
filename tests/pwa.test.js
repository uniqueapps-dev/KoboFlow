// PWA tests: manifests, icons, service workers, offline use, cache isolation,
// recovery after another app wipes caches, version upgrades, and reproducible
// test-site generation. Production (/KoboFlow/), the TEST site (/koboflow-test/)
// and a PBSRx-style app (/pbsrx/) are served on ONE origin, mirroring
// uniqueapps-dev.github.io where all of them share CacheStorage.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

// Hermetic runs. context.route() does not see requests made BY a service worker unless this
// Playwright switch is on. Without it, the app's workers fetched Google Fonts from the real
// internet during the tests and cached them; whenever those downloads finished before the cache
// assertions, "test cache holds only test files" failed (the intermittent 116/117 failure).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const ROOT = path.join(__dirname, '..');
const gen = require('../scripts/build-test-file.js');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

const readJSON = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const pngSize = rel => { const b = fs.readFileSync(path.join(ROOT, rel)); assert.equal(b.toString('ascii', 1, 4), 'PNG', rel + ' is a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

/* ───────────── Static checks ───────────── */
test('production and test manifests are valid and have separate identities', () => {
  const prod = readJSON('manifest.json');
  const site = Object.fromEntries(gen.buildTestSite());
  const tm = JSON.parse(site['test-manifest.json']);
  for (const m of [prod, tm]) {
    assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.id, './');
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512') && m.icons.some(i => i.purpose === 'maskable'));
  }
  assert.equal(prod.short_name, 'KoboFlow');
  assert.equal(tm.short_name, 'KoboFlow TEST');
  assert.notEqual(prod.name, tm.name);
  assert.notEqual(prod.theme_color, tm.theme_color);
  assert.ok(prod.icons.every(i => /^\.\/icons\/icon-\d+\.png$/.test(i.src)));
  assert.ok(tm.icons.every(i => /^\.\/icons\/test-icon-\d+\.png$/.test(i.src)));
});

test('icons exist at the declared sizes and test icons differ from production', () => {
  assert.deepEqual(pngSize('icons/icon-192.png'), [192, 192]);
  assert.deepEqual(pngSize('icons/icon-512.png'), [512, 512]);
  assert.deepEqual(pngSize('icons/test-icon-192.png'), [192, 192]);
  assert.deepEqual(pngSize('icons/test-icon-512.png'), [512, 512]);
  assert.notEqual(sha256(fs.readFileSync(path.join(ROOT, 'icons/icon-512.png'))), sha256(fs.readFileSync(path.join(ROOT, 'icons/test-icon-512.png'))));
});

test('service workers use separate exact cache prefixes and one version source', () => {
  const prodSw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const testSw = Object.fromEntries(gen.buildTestSite())['test-sw.js'].toString();
  assert.match(prodSw, /var APP_PREFIX = 'koboflow-prod-';/);
  assert.match(testSw, /var APP_PREFIX = 'koboflow-test-';/);
  assert.doesNotMatch(testSw, /koboflow-prod-/);
  const v = readJSON('package.json').version;
  assert.match(prodSw, new RegExp(`var VERSION = '${v.replace(/\./g, '\\.')}';`));
  assert.match(testSw, new RegExp(`var VERSION = '${v.replace(/\./g, '\\.')}';`));
  for (const sw of [prodSw, testSw]) {
    assert.match(sw, /k\.indexOf\(APP_PREFIX\) === 0 && k !== CACHE/, 'deletes only its own older caches');
    assert.doesNotMatch(sw, /caches\.match\(/, 'never reads the origin-wide cache (could return another app\'s files)');
  }
  const prodHtml = fs.readFileSync(path.join(ROOT, 'koboflow.html'), 'utf8');
  assert.ok(prodHtml.includes(`KOBOFLOW v${v} &middot;`), 'app footer shows the same version as package.json and sw.js');
  assert.match(prodHtml, /var SW_URL='\.\/sw\.js';/);
  assert.match(prodHtml, /<link rel="manifest" href="\.\/manifest\.json"\/>/);
  const testHtml = Object.fromEntries(gen.buildTestSite())['index.html'].toString();
  assert.match(testHtml, /var SW_URL='\.\/test-sw\.js';/);
  assert.match(testHtml, /<link rel="manifest" href="\.\/test-manifest\.json"\/>/);
  assert.doesNotMatch(testHtml, /\.\/sw\.js|\.\/manifest\.json|icons\/icon-\d+\.png/, 'test page references no production PWA file');
});

test('test-site build is reproducible and traceable to its source commit', () => {
  const a = gen.buildTestSite(), b = gen.buildTestSite();
  assert.deepEqual(a.map(([p, buf]) => [p, sha256(buf)]), b.map(([p, buf]) => [p, sha256(buf)]), 'same source → same bytes');
  const files = Object.fromEntries(a);
  const src = JSON.parse(files['SOURCE.json']);
  assert.equal(src.sourceCommit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim());
  assert.equal(typeof src.sourceInputsCommitted, 'boolean');
  assert.equal(src.database, 'KoboFlowDB-test');
  assert.equal(src.cacheNamespace, 'koboflow-test-');
  assert.equal(src.version, readJSON('package.json').version);
  for (const [p, h] of Object.entries(src.files)) assert.equal(sha256(files[p]), h, 'checksum of ' + p);
  for (const [p, h] of Object.entries(src.inputs)) assert.equal(sha256(fs.readFileSync(path.join(ROOT, p))), h, 'checksum of input ' + p);
  assert.deepEqual(Object.keys(files).sort(), ['SOURCE.json', 'icons/test-icon-192.png', 'icons/test-icon-512.png', 'index.html', 'test-manifest.json', 'test-sw.js']);
  assert.equal(files['index.html'].toString(), fs.readFileSync(path.join(ROOT, 'koboflow-test.html'), 'utf8'), 'site page equals the committed single-file test build');
});

test('the site writer refuses to overwrite folders it did not create', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kf-site-'));
  fs.writeFileSync(path.join(tmp, 'precious.txt'), 'keep');
  assert.throws(() => gen.writeSite(tmp), /refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(tmp, 'precious.txt'), 'utf8'), 'keep');
  assert.throws(() => gen.writeSite(ROOT), /outside the source tree/);
});

/* ───────────── Browser: offline, isolation, recovery, upgrade ───────────── */
let server, base, browser, prodVersion = null;
const PBSRX_SW = `var CACHE_NAME='pbsrx-phoenix-v7.6.7-RC3.9.4A';
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE_NAME).then(function(c){return c.put('./',new Response('pbsrx'));}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(n){return Promise.all(n.filter(function(k){return k!==CACHE_NAME;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});`;

test.before(async () => {
  if (!pw) return;
  const site = Object.fromEntries(gen.buildTestSite());
  const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : p.endsWith('.png') ? 'image/png' : 'text/html';
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname), body = null;
    const send = (b, t) => { res.writeHead(200, { 'content-type': t, 'cache-control': 'no-cache' }); res.end(b); };
    if (p.startsWith('/KoboFlow/')) {
      const rel = p.slice('/KoboFlow/'.length) || 'index.html';
      if (rel === 'index.html') body = fs.readFileSync(path.join(ROOT, 'koboflow.html'));
      else if (['manifest.json', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png'].includes(rel)) {
        body = fs.readFileSync(path.join(ROOT, rel));
        if (rel === 'sw.js' && prodVersion) body = Buffer.from(body.toString().replace(/var VERSION = '[^']+';/, `var VERSION = '${prodVersion}';`));
      }
      if (body) return send(body, type(rel));
    } else if (p.startsWith('/koboflow-test/')) {
      const rel = p.slice('/koboflow-test/'.length) || 'index.html';
      if (site[rel]) return send(site[rel], type(rel));
    } else if (p === '/pbsrx/sw.js') return send(PBSRX_SW, 'text/javascript');
    else if (p === '/pbsrx/') return send('<!doctype html><title>pbsrx</title>', 'text/html');
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
// Open an app and wait until its own service worker controls the page.
async function openControlled(page, p) {
  await page.goto(base + p);
  await page.waitForSelector('body[data-kf-ready="1"]');
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForSelector('body[data-kf-ready="1"]');
  }
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), p + ' is controlled by a service worker');
}
const cacheKeys = page => page.evaluate(() => caches.keys());
// Same-origin entries as paths; anything from another origin keeps its full URL, so it can never
// pass a path check by accident and is shown in full when an assertion fails.
const cacheUrls = (page, name) => page.evaluate(n => caches.open(n).then(c => c.keys()).then(k => k.map(r => { const u = new URL(r.url); return u.origin === location.origin ? u.pathname : u.href; }).sort()), name);
const until = async (fn, what, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('timed out: ' + what); };

test('production and TEST install separate workers and caches, both work offline, other apps\' caches are untouched', { skip }, async () => {
  const { context, page } = await ctx();
  // Another app's caches already exist on the shared origin.
  await page.goto(base + '/pbsrx/');
  await page.evaluate(() => Promise.all([caches.open('pbsrx-phoenix-v7.6.7-RC3.9.4A').then(c => c.put('/pbsrx/', new Response('x'))), caches.open('some-other-app-v1')]));

  await openControlled(page, '/KoboFlow/');
  const prodReg = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => ({ scope: r.scope, script: r.active.scriptURL })));
  assert.equal(prodReg.scope, base + '/KoboFlow/');
  assert.equal(prodReg.script, base + '/KoboFlow/sw.js');

  await openControlled(page, '/koboflow-test/');
  assert.equal(await page.isVisible('#db-banner'), true);
  const testReg = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => ({ scope: r.scope, script: r.active.scriptURL })));
  assert.equal(testReg.scope, base + '/koboflow-test/');
  assert.equal(testReg.script, base + '/koboflow-test/test-sw.js');

  await until(async () => (await cacheKeys(page)).includes('koboflow-prod-3.2.0') && (await cacheKeys(page)).includes('koboflow-test-3.2.0'), 'both shells cached');
  const keys = await cacheKeys(page);
  assert.ok(keys.includes('pbsrx-phoenix-v7.6.7-RC3.9.4A') && keys.includes('some-other-app-v1'), 'unrelated caches preserved: ' + keys);
  const prodUrls = await cacheUrls(page, 'koboflow-prod-3.2.0');
  assert.ok(['/KoboFlow/', '/KoboFlow/index.html', '/KoboFlow/manifest.json', '/KoboFlow/icons/icon-192.png', '/KoboFlow/icons/icon-512.png'].every(u => prodUrls.includes(u)), 'production shell cached: ' + prodUrls);
  assert.ok(prodUrls.every(u => u.startsWith('/KoboFlow/')), 'production cache holds only production files: ' + prodUrls);
  const testUrls = await cacheUrls(page, 'koboflow-test-3.2.0');
  assert.ok(testUrls.every(u => u.startsWith('/koboflow-test/')), 'test cache holds only test files: ' + testUrls);
  assert.ok(['/koboflow-test/index.html', '/koboflow-test/test-manifest.json', '/koboflow-test/icons/test-icon-512.png'].every(u => testUrls.includes(u)));

  // Offline: both apps still open from their own caches.
  await context.setOffline(true);
  for (const p of ['/KoboFlow/', '/koboflow-test/']) {
    await page.goto(base + p);
    await page.waitForSelector('body[data-kf-ready="1"]');
  }
  assert.equal(await page.isVisible('#db-banner'), true, 'offline TEST still shows its banner');
  await page.goto(base + '/KoboFlow/');
  await page.waitForSelector('body[data-kf-ready="1"]');
  assert.equal(await page.title(), 'KoboFlow — Track Every Kobo', 'production page served offline from the production cache');
  await context.setOffline(false);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST data stays in KoboFlowDB-test; production data stays in KoboFlowDB', { skip }, async () => {
  const { context, page } = await ctx();
  await openControlled(page, '/koboflow-test/');
  await page.fill('#capture-input', '2500 fuel fjr');
  await page.press('#capture-input', 'Enter');
  await page.waitForFunction(() => new Promise(r => { const q = indexedDB.open('KoboFlowDB-test'); q.onsuccess = () => { const c = q.result.transaction('transactions').objectStore('transactions').count(); c.onsuccess = () => { q.result.close(); r(c.result === 1); }; }; }));
  const blocked = await page.evaluate(() => { try { indexedDB.open('KoboFlowDB'); return 'allowed'; } catch (e) { return 'refused'; } });
  assert.equal(blocked, 'refused');
  await openControlled(page, '/KoboFlow/');
  const names = (await page.evaluate(() => indexedDB.databases())).map(d => d.name).sort();
  assert.deepEqual(names, ['KoboFlowDB', 'KoboFlowDB-test']);
  const prodCount = await page.evaluate(() => new Promise(r => { const q = indexedDB.open('KoboFlowDB'); q.onsuccess = () => { const c = q.result.transaction('transactions').objectStore('transactions').count(); c.onsuccess = () => { q.result.close(); r(c.result); }; }; }));
  assert.equal(prodCount, 0, 'nothing entered in TEST appears in production');
  await context.close();
});

test('caches wiped by another app on the same origin refill on the next online open', { skip }, async () => {
  const { context, page } = await ctx();
  await openControlled(page, '/KoboFlow/');
  await openControlled(page, '/koboflow-test/');
  await until(async () => (await cacheKeys(page)).length >= 2, 'caches populated');
  // PBSRx-style worker deletes every cache that is not its own.
  await page.goto(base + '/pbsrx/');
  await page.evaluate(() => navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready));
  await until(async () => !(await cacheKeys(page)).some(k => k.startsWith('koboflow-')), 'external wipe');
  // One online open of each app restores its own cache.
  for (const [p, cache] of [['/KoboFlow/', 'koboflow-prod-3.2.0'], ['/koboflow-test/', 'koboflow-test-3.2.0']]) {
    await page.goto(base + p);
    await page.waitForSelector('body[data-kf-ready="1"]');
    await until(async () => (await cacheKeys(page)).includes(cache) && (await cacheUrls(page, cache)).includes(p + 'index.html'), 'refill ' + cache);
  }
  await context.setOffline(true);
  for (const p of ['/KoboFlow/', '/koboflow-test/']) { await page.goto(base + p); await page.waitForSelector('body[data-kf-ready="1"]'); }
  await context.setOffline(false);
  assert.ok((await cacheKeys(page)).includes('pbsrx-phoenix-v7.6.7-RC3.9.4A'), 'KoboFlow never deleted the other app\'s cache');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('a new production version replaces only the old production cache', { skip }, async () => {
  const { context, page } = await ctx();
  await page.goto(base + '/pbsrx/');
  await page.evaluate(() => caches.open('pbsrx-phoenix-v7.6.7-RC3.9.4A'));
  await openControlled(page, '/KoboFlow/');
  await openControlled(page, '/koboflow-test/');
  await until(async () => { const k = await cacheKeys(page); return k.includes('koboflow-prod-3.2.0') && k.includes('koboflow-test-3.2.0'); }, 'v3.2.0 caches');
  prodVersion = '3.2.1';
  try {
    await page.goto(base + '/KoboFlow/');
    await page.waitForSelector('body[data-kf-ready="1"]');
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await until(async () => { const k = await cacheKeys(page); return k.includes('koboflow-prod-3.2.1') && !k.includes('koboflow-prod-3.2.0'); }, 'production upgraded to 3.2.1');
    const keys = await cacheKeys(page);
    assert.ok(keys.includes('koboflow-test-3.2.0'), 'TEST cache untouched by the production upgrade');
    assert.ok(keys.includes('pbsrx-phoenix-v7.6.7-RC3.9.4A'), 'other app untouched by the production upgrade');
    await context.setOffline(true);
    await page.goto(base + '/KoboFlow/');
    await page.waitForSelector('body[data-kf-ready="1"]');
    await context.setOffline(false);
  } finally { prodVersion = null; }
  assert.deepEqual(page.errors, []);
  await context.close();
});

// Regression test for the intermittent failure: no request may leave the test machine, including
// requests made by the service workers themselves, so cache contents cannot depend on network timing.
test('service-worker traffic is routed too: nothing reaches the internet and caches hold no foreign entries', { skip }, async () => {
  const { context, page } = await ctx();
  const external = [];
  context.on('request', r => { if (!r.url().startsWith(base) && /^https?:/.test(r.url())) external.push((r.serviceWorker() ? 'worker ' : 'page ') + new URL(r.url()).host); });
  for (const p of ['/KoboFlow/', '/koboflow-test/']) await openControlled(page, p);
  const via = await page.evaluate(() => fetch('https://fonts.gstatic.com/s/kf-probe.woff2', { mode: 'no-cors' }).then(() => 'reached', () => 'blocked'));
  assert.equal(via, 'blocked', 'a fetch handled by the TEST service worker cannot reach the internet');
  await new Promise(r => setTimeout(r, 2000)); // give any stray download time to land
  for (const name of ['koboflow-prod-3.2.0', 'koboflow-test-3.2.0']) {
    const urls = await cacheUrls(page, name);
    assert.ok(urls.length > 0 && urls.every(u => u.startsWith('/')), name + ' holds only same-origin entries: ' + urls);
  }
  assert.ok(external.some(e => e.startsWith('worker ')), 'worker requests are visible to the router (the switch is active): ' + external);
  await context.close();
});
