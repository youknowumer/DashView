/* Report PDFs: text the built-in PDF fonts cannot draw must never come out as garbled symbols. */
const assert = require('assert');
const E = require('../js/report-engine.js');
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }

check('plain text is untouched', () => assert.strictEqual(E.pdfSafeText('Revenue Rs 1,200 (Q3)'), 'Revenue Rs 1,200 (Q3)'));
check('Western accents and typographic punctuation stay', () => assert.strictEqual(E.pdfSafeText('Café \u201CPremium\u201D \u2013 caf\u00E9 \u2022 \u2026'), 'Café \u201CPremium\u201D \u2013 caf\u00E9 \u2022 \u2026'));
check('rupee sign, arrows and comparison signs become readable text', () => assert.strictEqual(E.pdfSafeText('\u20A8 500 \u2192 \u2265 3'), 'Rs 500  to  >= 3'));
check('Urdu / Arabic and emoji collapse to a single ? instead of garbage', () => {
  const out = E.pdfSafeText('\u0642\u0645\u06CC\u0636 \u0633\u0648\u0679 \uD83D\uDE00 Lawn');
  assert.ok(!/[\u0600-\u06FF\uD800-\uDFFF]/.test(out)); assert.ok(out.indexOf('Lawn') >= 0); assert.ok(out.indexOf('?') >= 0);
});
check('null / numbers are safe', () => { assert.strictEqual(E.pdfSafeText(null), ''); assert.strictEqual(E.pdfSafeText(42), '42'); });
check('very large numbers use T for trillions', () => assert.strictEqual(E.fmtNumber(2.5e12), '2.5T'));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
