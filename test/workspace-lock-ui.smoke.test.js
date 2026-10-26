/* Settings → Security: the workspace lock switch is off by default and the page never requires it (dashboard.html + js/security-ui.js) */
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const inline = (rel) => '<script>\n' + fs.readFileSync(path.join(ROOT, rel), 'utf8') + '\n</script>';
['js/dv-security.js', 'js/security-ui.js'].forEach((f) => {
  assert.ok(html.includes('<script src="' + f + '"></script>'), f + ' is loaded by dashboard.html');
  html = html.replace('<script src="' + f + '"></script>', () => inline(f));
});
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async function () {
  const dom = new JSDOM(html, { url: 'https://example.org/dashboard.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom, d = window.document, $ = (id) => d.getElementById(id);
  await wait(80);
  check('switch exists and is off by default; passcode form is hidden', () => {
    assert.ok($('secLockToggle')); assert.strictEqual($('secLockToggle').checked, false);
    assert.strictEqual($('secLockBody').hidden, true);
  });
  check('status reads "Lock off"; lock button hidden; nothing locked', () => {
    assert.strictEqual($('secPassState').textContent, 'Lock off');
    assert.strictEqual($('lockBtn').hidden, true);
    assert.ok(!window.DVSec.isLocked());
    assert.ok(!d.documentElement.classList.contains('dv-locked'));
  });
  check('flipping the switch only reveals the setup form - it does not lock anything', () => {
    $('secLockToggle').checked = true; $('secLockToggle').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.strictEqual($('secLockBody').hidden, false);
    assert.strictEqual(window.DVSec.hasPasscode(), false);
    assert.strictEqual($('secSetBtn').textContent, 'Turn on workspace lock');
    $('secLockToggle').checked = false; $('secLockToggle').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.strictEqual($('secLockBody').hidden, true);
  });
  check('checkup rows for lock-only items are marked optional, not failing', () => {
    const li = Array.from(d.querySelectorAll('#secChecks li.na'));
    assert.ok(li.length >= 3, 'lock-only checks rendered as optional');
    assert.ok(!/Weak|Needs attention/.test($('secGrade').textContent) || /optional/.test($('secGrade').textContent));
  });
  check('the static checklist never marks the lock as Required', () => {
    const html = $('secMandatoryChecklist').textContent;
    assert.ok(/Workspace lock/.test(html));
    const row = Array.from(d.querySelectorAll('#secMandatoryChecklist .chk-row')).find((r) => /Workspace lock/.test(r.textContent));
    assert.ok(!row.querySelector('.chk-badge.req'), 'lock row is not Required');
  });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
