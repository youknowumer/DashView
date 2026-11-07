/* Built-in backend link: the Worker URL lives in js/backend-config.js, is not a Settings field, and always wins over
   whatever an old browser has saved. Real js files, fake Worker (fetch), no network. */
const fs = require('fs'), path = require('path');
const { webcrypto } = require('crypto');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const WORKER = 'https://dashview.youknowumer-io.workers.dev';
const STALE = 'https://old-proxy.example.workers.dev';
const SAVED = { url: 'https://acme.odoo.com', db: 'acme', username: 'a@acme.com', apiKey: 'KEY-123', proxyUrl: STALE };

function boot(opts) {
  opts = opts || {};
  const requests = [];
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://youknowumer.github.io/DashView/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); } catch (e) {}
  if (opts.saved) w.localStorage.setItem('dashview_odoo_config', JSON.stringify(opts.saved));
  w.fetch = (url, init) => {
    requests.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify({ ok: true, uid: 7, rows: [], total: 0, latencyMs: 5 })) });
  };
  (opts.files || []).forEach((f) => w.eval(read(f)));
  return { w, requests };
}

(async () => {
  /* 1. the config file itself */
  const a = boot({ files: ['js/backend-config.js'] });
  const B = a.w.DV_BACKEND;
  ok('js/backend-config.js exposes the Worker URL', B && B.workerUrl === WORKER);
  ok('the URL is plain https with no path and no trailing slash', /^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(B.workerUrl));
  let changed = false; try { B.workerUrl = 'https://evil.example'; changed = B.workerUrl !== WORKER; } catch (e) {}
  ok('DV_BACKEND is frozen - the URL cannot be swapped from the console', !changed && Object.isFrozen(B));
  ok('lock() forces proxyUrl and keeps every other field', (() => { const c = B.lock({ url: 'u', proxyUrl: STALE }); return c.proxyUrl === WORKER && c.url === 'u'; })());

  /* 2. DVSec: a stale saved proxyUrl never wins, and what gets saved carries the built-in URL */
  const s = boot({ files: ['js/backend-config.js', 'js/dv-security.js'], saved: SAVED });
  ok('DVSec.cfg() returns the built-in Worker even when the browser saved another one', s.w.DVSec.cfg().proxyUrl === WORKER);
  await s.w.DVSec.saveCfg({ url: 'https://acme.odoo.com', db: 'acme', username: 'a@acme.com', apiKey: 'KEY-123', proxyUrl: STALE });
  ok('saveCfg stores the built-in URL, not the typed / stale one', JSON.parse(s.w.localStorage.getItem('dashview_odoo_config')).proxyUrl === WORKER);
  ok('the Odoo API key still saves normally', s.w.DVSec.cfg().apiKey === 'KEY-123');

  /* 3. odoo-service: connect / test go to the built-in Worker with no Worker URL supplied */
  const o = boot({ files: ['js/backend-config.js', 'js/dv-security.js', 'js/odoo-service.js'], saved: { url: 'https://acme.odoo.com', db: 'acme', username: 'a@acme.com', apiKey: 'KEY-123', proxyUrl: STALE } });
  const cr = await o.w.DVOdoo.connect({ url: 'https://acme.odoo.com', db: 'acme', user: 'a@acme.com', apiKey: 'KEY-123' });
  ok('connect() works without any proxyUrl field', cr && cr.ok === true);
  ok('connect() posts to the built-in Worker', o.requests.length > 0 && o.requests.every((r) => r.url === WORKER));
  o.requests.length = 0;
  const cr2 = await o.w.DVOdoo.connect({ url: 'https://acme.odoo.com', db: 'acme', user: 'a@acme.com', apiKey: 'KEY-123', proxyUrl: 'https://typed.example.workers.dev' });
  ok('a typed Worker URL is ignored', cr2.ok === true && o.requests.every((r) => r.url === WORKER));
  o.requests.length = 0;
  const tr = await o.w.DVOdoo.testConnection({ url: 'https://acme.odoo.com', db: 'acme', user: 'a@acme.com', apiKey: 'KEY-123', proxyUrl: STALE });
  ok('testConnection() also uses the built-in Worker', tr.ok === true && o.requests.length === 1 && o.requests[0].url === WORKER);
  ok('getConfig().proxyUrl is the built-in Worker', o.w.DVOdoo.getConfig().proxyUrl === WORKER);

  /* 4. odoo-client: state is decided by the Odoo credentials only; the link is always there */
  const c1 = boot({ files: ['js/backend-config.js', 'js/dv-security.js', 'js/odoo-client.js'], saved: { url: 'https://acme.odoo.com', db: 'acme', username: 'a@acme.com', apiKey: 'KEY-123' } });
  ok('odoo-client is ready ("ok") with credentials and no saved Worker URL', c1.w.DVOdooClient.state() === 'ok' && c1.w.DVOdooClient.cfg().proxyUrl === WORKER);
  const c2 = boot({ files: ['js/backend-config.js', 'js/dv-security.js', 'js/odoo-client.js'] });
  ok('with no credentials odoo-client says "none", not "noproxy"', c2.w.DVOdooClient.state() === 'none');
  const c3 = boot({ files: ['js/backend-config.js', 'js/dv-security.js', 'js/odoo-client.js'], saved: { url: 'https://acme.odoo.com', db: 'acme', username: 'a@acme.com', apiKey: 'KEY-123', proxyUrl: STALE } });
  c3.w.DVOdooClient._tune && c3.w.DVOdooClient._tune({ timeout: 500, retryBase: 5 });
  await wait(50); c3.requests.length = 0; c3.w.DVOdooClient.reset();
  await c3.w.DVOdooClient.records('res.partner', { fresh: true, limit: 3 });
  ok('odoo-client sends every read to the built-in Worker, not the stale one', c3.requests.length > 0 && c3.requests.every((r) => r.url === WORKER));

  /* 5. the old behaviour is untouched when the config file is not loaded */
  const n = boot({ files: ['js/dv-security.js', 'js/odoo-client.js'], saved: SAVED });
  ok('without backend-config.js a saved proxyUrl still works', n.w.DVOdooClient.cfg().proxyUrl === STALE && n.w.DVOdooClient.state() === 'ok');

  /* 6. the markup: no Worker URL box, no Worker deploy step, the file is loaded first everywhere */
  const dash = read('dashboard.html');
  ok('Settings has no Worker URL input any more', !/id="odooProxyUrl"/.test(dash) && !/Read-only Worker URL/.test(dash));
  ok('the setup card no longer asks to deploy a Worker', !/Deploy the Cloudflare Worker/.test(dash) && /2-step setup/.test(dash));
  [['dashboard.html', 'js/dv-security.js'], ['ai.html', 'js/dv-security.js'], ['people.html', 'js/dv-security.js'], ['login.html', 'js/dv-security.js'], ['share.html', 'js/odoo-service.js']].forEach(([page, later]) => {
    const h = read(page), i = h.indexOf('js/backend-config.js'), j = h.indexOf(later);
    ok(page + ' loads js/backend-config.js before ' + later, i > -1 && j > -1 && i < j);
  });
  ok('the visible UI text never names the Worker URL as something to fill in', !/paste (your|the) Worker URL/i.test(dash + read('index.html') + read('ai.html')));

  /* 7. offline cache + Worker deploy name */
  ok('the service worker pre-caches js/backend-config.js', /"js\/backend-config\.js"/.test(read('sw.js')));
  ok('wrangler.jsonc deploys the Worker named "dashview"', /"name":\s*"dashview"/.test(read('wrangler.jsonc')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
