// Loads the pure finance engine straight out of koboflow.html so tests always
// exercise the code that ships (no copy to drift out of sync).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'koboflow.html');

module.exports = function loadEngine() {
  const html = fs.readFileSync(HTML, 'utf8');
  const m = /<script id="kobo-finance-engine">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('kobo-finance-engine script block not found in koboflow.html');
  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { filename: 'kobo-finance-engine' });
  // Values built inside the vm context carry that context's Array/Object
  // prototypes; copy results into this realm so deepStrictEqual compares data only.
  const plain = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const api = {};
  for (const [k, v] of Object.entries(sandbox.module.exports)) {
    api[k] = typeof v === 'function' ? (...args) => plain(v(...args)) : plain(v);
  }
  return api;
};
