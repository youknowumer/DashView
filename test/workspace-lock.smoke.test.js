/* Workspace lock is OPTIONAL and OFF by default — behaviour tests for js/dv-security.js.
   Off  : nothing is locked, the Odoo API key saves/reads normally, the checkup ignores lock-only checks.
   On   : passcode, encrypted key, lock/unlock.   Off again: the key comes back to normal storage, nothing is lost. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'dv-security.js'), 'utf8');
function store(seed) {
  const d = Object.assign({}, seed || {});
  return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; }, clear: () => { Object.keys(d).forEach((k) => delete d[k]); } };
}
function boot(seedLocal) {
  const local = store(seedLocal), session = store();
  const events = [];
  const doc = {
    body: null, readyState: 'complete', documentElement: { classList: { toggle() {} } },
    addEventListener() {}, querySelector: () => ({}), getElementById: () => null, dispatchEvent: (e) => { events.push(e.type); return true; }
  };
  const win = {
    localStorage: local, sessionStorage: session, crypto: webcrypto, document: doc,
    location: { protocol: 'https:', hostname: 'example.org', origin: 'https://example.org' },
    addEventListener() {}, navigator: { userAgent: 'Chrome Linux' }, console
  };
  win.window = win;
  const ctx = Object.assign(win, { document: doc, navigator: win.navigator, location: win.location, localStorage: local, sessionStorage: session,
    TextEncoder, TextDecoder, Uint8Array, Date, JSON, Math, Promise, Object, Array, String, Number, Error, btoa, atob, CustomEvent: class { constructor(t) { this.type = t; } },
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout });
  vm.runInNewContext(SRC, ctx);
  return { Sec: win.DVSec, local, session, events };
}
const CFG = 'dashview_odoo_config';
const cfgIn = { url: 'https://acme.odoo.com', db: 'acme', username: 'a@acme.com', apiKey: 'KEY-123', proxyUrl: 'https://w.workers.dev' };
const stored = (local) => JSON.parse(local.getItem(CFG));
let passed = 0, failed = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { failed++; console.error(' FAIL', name, '\n      ', e.message); } }

(async function main() {
  await ok('lock is off by default: nothing locked, no passcode', async () => {
    const { Sec } = boot();
    assert.strictEqual(Sec.hasPasscode(), false);
    assert.strictEqual(Sec.isLocked(), false);
    Sec.lock('shortcut');                                   /* Ctrl+Shift+L must be a harmless no-op */
    assert.strictEqual(Sec.isLocked(), false);
  });
  await ok('with the lock off the Odoo API key saves, reads back and survives a reload', async () => {
    const a = boot();
    await a.Sec.saveCfg(cfgIn);
    assert.strictEqual(a.Sec.cfg().apiKey, 'KEY-123');
    const b = boot(a.local.d);                              /* "reload": a new page reads the same storage */
    assert.strictEqual(b.Sec.cfg().apiKey, 'KEY-123');
    assert.strictEqual(stored(b.local).apiKey, 'KEY-123', 'a working key is not stripped on load when the lock is off');
    assert.strictEqual(b.Sec.isLocked(), false);
  });
  await ok('saving again with a blank key field keeps the saved key', async () => {
    const a = boot();
    await a.Sec.saveCfg(cfgIn);
    await a.Sec.saveCfg(Object.assign({}, cfgIn, { apiKey: '', db: 'acme2' }));
    assert.strictEqual(a.Sec.cfg().apiKey, 'KEY-123');
    assert.strictEqual(a.Sec.cfg().db, 'acme2');
  });
  await ok('checkup: lock-only checks are optional and never lower the score', async () => {
    const { Sec } = boot();
    const r = Sec.checkup(), by = {}; r.items.forEach((i) => { by[i.id] = i; });
    ['pin', 'vault', 'auto', 'brute'].forEach((id) => { assert.ok(by[id].na, id + ' is optional while the lock is off'); assert.ok(by[id].ok, id + ' is not reported as failing'); });
    assert.strictEqual(r.lock, false);
    const counted = r.items.filter((i) => !i.na), total = counted.reduce((s, i) => s + i.weight, 0), got = counted.reduce((s, i) => s + (i.ok ? i.weight : 0), 0);
    assert.strictEqual(r.score, Math.round(got / total * 100));
    assert.strictEqual(r.failed, counted.filter((i) => !i.ok).length);
    assert.ok(r.items.every((i) => i.id !== 'pin' || /optional/i.test(i.label)));
  });
  await ok('turning the lock ON encrypts the key and clears the plaintext copy', async () => {
    const a = boot();
    await a.Sec.saveCfg(cfgIn);
    await a.Sec.setPasscode('correct horse battery staple');
    assert.strictEqual(a.Sec.hasPasscode(), true);
    const s = stored(a.local);
    assert.strictEqual(s.apiKey, '');
    assert.ok(s.apiKeyEnc && s.apiKeyEnc.ct, 'ciphertext stored');
    assert.ok(!a.local.getItem(CFG).includes('KEY-123'), 'plaintext key is gone from storage');
    assert.strictEqual(a.Sec.cfg().apiKey, 'KEY-123', 'still readable in memory while unlocked');
    const r = a.Sec.checkup(); assert.strictEqual(r.lock, true); assert.ok(r.items.every((i) => !i.na));
  });
  await ok('with the lock ON a reload starts locked and the key stays hidden until unlock', async () => {
    const a = boot();
    await a.Sec.saveCfg(cfgIn); await a.Sec.setPasscode('correct horse battery staple');
    const b = boot({ [CFG]: a.local.getItem(CFG), dv_sec: a.local.getItem('dv_sec') });
    assert.strictEqual(b.Sec.isLocked(), true);
    assert.strictEqual(b.Sec.cfg().apiKey, '');
    await assert.rejects(() => b.Sec.unlock('wrong passcode value'), /Incorrect/);
    await b.Sec.unlock('correct horse battery staple');
    assert.strictEqual(b.Sec.cfg().apiKey, 'KEY-123');
  });
  await ok('turning the lock OFF needs the passcode and restores the key to normal storage (connection kept)', async () => {
    const a = boot();
    await a.Sec.saveCfg(cfgIn); await a.Sec.setPasscode('correct horse battery staple');
    await assert.rejects(() => a.Sec.removePasscode('nope nope nope nope'), /Incorrect/);
    assert.strictEqual(a.Sec.hasPasscode(), true, 'a wrong passcode cannot disable the lock');
    await a.Sec.removePasscode('correct horse battery staple');
    assert.strictEqual(a.Sec.hasPasscode(), false);
    const s = stored(a.local);
    assert.strictEqual(s.apiKey, 'KEY-123'); assert.ok(!s.apiKeyEnc);
    assert.strictEqual(a.Sec.cfg().apiKey, 'KEY-123');
    const b = boot(a.local.d);
    assert.strictEqual(b.Sec.isLocked(), false);
    assert.strictEqual(b.Sec.cfg().apiKey, 'KEY-123', 'after a reload everything still works with the lock off');
    assert.ok(b.Sec.getLog().some((e) => /lock turned off/i.test(e.a)));
  });
  await ok('lock off → on → off never loses the key and never needs it re-entered', async () => {
    const a = boot();
    await a.Sec.saveCfg(cfgIn);
    for (let i = 0; i < 2; i++) { await a.Sec.setPasscode('correct horse battery staple'); await a.Sec.removePasscode('correct horse battery staple'); }
    assert.strictEqual(a.Sec.cfg().apiKey, 'KEY-123');
  });
  await ok('backups still never contain secrets', async () => {
    const a = boot();
    await a.Sec.saveCfg(cfgIn);
    const dump = a.Sec.redactBackup({ [CFG]: a.local.getItem(CFG), dashview_theme: '"dark"' });
    assert.ok(!JSON.stringify(dump).includes('KEY-123'));
  });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
