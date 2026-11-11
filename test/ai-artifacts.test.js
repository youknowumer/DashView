// AI Artifacts engine (js/ai-artifacts.js): parsing, versions + store, markers + model history, CSV / chart / highlight / diff, sandbox.
const A = require('../js/ai-artifacts.js');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log(' FAIL', n); } };
const mem = {}; // an in-memory localStorage so the store can be exercised in Node

/* ── parse ── */
{
  const p = A.parse('Here you go.\n<artifact id="Q3 Report" type="document" title="Q3 report">\n# Q3\n\nBody\n</artifact>\nCheck the numbers.');
  ok('parse: one document, id slugged, content trimmed, text keeps the chat lines', p.items.length === 1 && p.items[0].id === 'q3-report' && p.items[0].type === 'document' && p.items[0].content === '# Q3\n\nBody' && /^Here you go\.[\s\S]*Check the numbers\.$/.test(p.text));
  const f = A.parse('<artifact type="code" title="Fix" language="python">\n```python\nprint(1)\n```\n</artifact>');
  ok('parse: a fenced body is unwrapped and the language kept', f.items[0].content === 'print(1)' && f.items[0].lang === 'python' && f.items[0].type === 'code');
  const cut = A.parse('Start\n<artifact id="x" type="html" title="Page"><html><body>hi');
  ok('parse: a reply cut off before </artifact> is kept and flagged incomplete', cut.items.length === 1 && cut.items[0].complete === false && /hi$/.test(cut.items[0].content));
  ok('parse: self-closing history stubs and empty artifacts are ignored', A.parse('<artifact id="a" type="document" title="T" version="1" />').items.length === 0 && A.parse('<artifact id="a" type="document"></artifact>').items.length === 0);
  ok('parse: type is inferred from content when missing', A.parse('<artifact title="t">a,b\n1,2\n3,4\n5,6</artifact>').items[0].type === 'table' && A.parse('<artifact title="t"><svg viewBox="0 0 1 1"></svg></artifact>').items[0].type === 'svg' && A.parse('<artifact title="t">{"labels":["a"],"series":[{"name":"s","values":[1]}]}</artifact>').items[0].type === 'chart');
  ok('parse: aliases (report, dashboard, csv) map to the six types', A.normType('report') === 'document' && A.normType('dashboard') === 'html' && A.normType('csv') === 'table' && A.normType('sql') === 'code');
  const auto = A.parse('Here:\n```html\n<!doctype html><html><body>x</body></html>\n```\nand\n```kpi\n{"a":1}\n```');
  ok('parse: a full html page in a fence becomes an artifact, a kpi block does not', auto.items.length === 1 && auto.items[0].type === 'html' && auto.items[0].auto && /```kpi/.test(auto.text));
  ok('parse: short code stays in the chat', A.parse('```js\nconsole.log(1)\n```').items.length === 0);
  ok('parse: auto detection can be switched off', A.parse('```html\n<html></html>\n```', { auto: false }).items.length === 0);
  const big = A.parse('```python\n' + Array.from({ length: 45 }, (_, i) => 'x' + i + ' = ' + i).join('\n') + '\n```');
  ok('parse: a long code block (40+ lines) becomes a code artifact', big.items.length === 1 && big.items[0].type === 'code' && big.items[0].lang === 'python');
}

/* ── store (needs localStorage) ── */
const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const B = (function () { const src = require('fs').readFileSync(require('path').join(__dirname, '../js/ai-artifacts.js'), 'utf8'); const m = { exports: {} }; new Function('module', 'window', 'globalThis', src)(m, { localStorage: ls }, { localStorage: ls }); return m.exports; })();
{
  const r1 = B.ingest('t1', 'Done.\n<artifact id="sales" type="document" title="Sales">\n# Sales\nv1\n</artifact>', { by: 'ai', source: 'Live Odoo · 2 queries', chat: 'Sales review' });
  ok('ingest: the tag is replaced by a marker and one artifact is stored', /\[\[artifact:ar[a-z0-9]+:1\]\]/.test(r1.text) && r1.refs.length === 1 && B.count() === 1 && !/<artifact/.test(r1.text));
  const aid = r1.refs[0].aid;
  const r2 = B.ingest('t1', '<artifact id="sales" type="document" title="Sales">\n# Sales\nv2 longer\n</artifact>', {});
  ok('same id in the same chat => the next version of the same artifact', r2.refs[0].aid === aid && r2.refs[0].n === 2 && B.get(aid).versions.length === 2 && B.count() === 1);
  ok('re-sending identical content does not add a version', B.ingest('t1', '<artifact id="sales" type="document" title="Sales">\n# Sales\nv2 longer\n</artifact>', {}).refs[0].n === 2 && B.get(aid).versions.length === 2);
  ok('same id in another chat => a separate artifact', B.ingest('t2', '<artifact id="sales" type="document" title="Sales">x</artifact>', {}).refs[0].aid !== aid && B.count() === 2);
  ok('a reply with only the tag still gets a sentence', /^I made \*\*Sales\*\*/.test(B.ingest('t3', '<artifact id="only" type="document" title="Sales">z</artifact>', {}).text));
  const v = B.addVersion(aid, '# Sales\nedited by me', 'you', { note: 'tweak' });
  ok('a user edit is the next version, tagged as the user', v.n === 3 && v.by === 'you' && B.latest(B.get(aid)).note === 'tweak');
  ok('rename keeps the new title when the model re-sends the artifact', B.rename(aid, 'Q3 Sales') && B.ingest('t1', '<artifact id="sales" type="document" title="Sales">\n# again\n</artifact>', {}) && B.get(aid).title === 'Q3 Sales');
  B.pin(aid, true); ok('pin sorts first in the library', B.list()[0].id === aid);
  ok('saved to localStorage and read back after a reload', B.flush() && (function () { B._reset(); return B.count() === 3 && !!B.get(aid); })());
  /* history for the model */
  const msgs = [{ role: 'user', content: 'write a report' }, { role: 'ai', content: 'Done.\n\n' + '[[artifact:' + aid + ':1]]' }, { role: 'ai', content: 'Updated.\n\n[[artifact:' + aid + ':' + B.latest(B.get(aid)).n + ']]' }, { role: 'user', content: 'Revise “Q3 Sales”: shorter', artRef: { aid, n: B.latest(B.get(aid)).n } }];
  const h = B.historyTexts(msgs);
  ok('history: earlier turns are stubs; the artifact is sent in full once, on the Revise message', /version="1" \/>/.test(h[1]) && /\/>/.test(h[2]) && !/<\/artifact>/.test(h[1] + h[2]) && /same id/.test(h[3]) && new RegExp('<artifact id="sales"[^>]*version="' + B.latest(B.get(aid)).n + '">[\\s\\S]*</artifact>').test(h[3]));
  const h2 = B.historyTexts(msgs.slice(0, 3));
  ok('history: without a Revise message the newest version is sent in full on the message that made it', new RegExp('version="' + B.latest(B.get(aid)).n + '">[\\s\\S]*</artifact>').test(h2[2]) && !/<\/artifact>/.test(h2[1]));
  ok('plain() and expandForExport() make the marker readable', /\[Artifact: Q3 Sales — Document, v1\]/.test(B.plain('[[artifact:' + aid + ':1]]')) && /```markdown\n# Sales\nv1/.test(B.expandForExport('[[artifact:' + aid + ':1]]')));
  ok('card html escapes the title and carries the open / copy / download actions', (function () { B.rename(aid, '<img onerror=x>'); const h2 = B.cardHtml(aid, 1); return !/<img onerror/.test(h2) && /data-act="art-open"/.test(h2) && /data-act="art-copy"/.test(h2) && /data-act="art-dl"/.test(h2); })());
  ok('remove deletes it and the card says it is gone', B.remove(aid) && /no longer available/.test(B.cardHtml(aid, 1)));
  /* import / export */
  const ex = B.exportAll(); B._reset(); mem['dv-ai-artifacts-v1'] = '{}';
  ok('import: restores an export and refuses a wrong file', B.importJSON(ex) >= 1 && (function () { try { B.importJSON('{"kind":"other","items":[]}'); return false; } catch (e) { return /not a DashView/.test(e.message); } })() && (function () { try { B.importJSON('nope'); return false; } catch (e) { return /valid JSON/.test(e.message); } })());
  ok('import: rejects unsafe shapes (bad type falls back, no versions dropped)', B.importJSON(JSON.stringify({ items: [{ id: 'x', type: '__proto__', title: 't', versions: [{ content: 'a' }] }, { id: 'y', versions: [] }] })) === 1);
}

/* ── tables ── */
{
  const rows = B.csvParse('a,b\n"x, y","he said ""hi"""\n1,2\r\n3,4');
  ok('csv: quotes, commas, doubled quotes and CRLF', rows.length === 4 && rows[1][0] === 'x, y' && rows[1][1] === 'he said "hi"' && rows[3][1] === '4');
  ok('csv: semicolon and tab are detected', B.csvParse('a;b\n1;2')[1][1] === '2' && B.csvParse('a\tb\n1\t2')[1][1] === '2');
  ok('parseNum: money, thousands, percent, negatives in brackets, text', B.parseNum('$1,234.50') === 1234.5 && B.parseNum('(12)') === -12 && B.parseNum('45%') === 45 && B.parseNum('PKR 5,000') === 5000 && B.parseNum('abc') === null && B.parseNum('') === null);
  const m = B.tableModel('Name,Amount,Date\nAcme,"1,000",2026-01-02\nBeta,250,2026-02-03\nCore,75,2026-03-04');
  ok('tableModel: header, column types, row count', m.cols.map((c) => c.type).join() === 'text,num,date' && m.total === 3);
  ok('tableView: sorts numbers numerically (not as text) and filters rows', B.tableView(m, { sort: 1, dir: -1 }).join() === '0,1,2' && B.tableView(m, { sort: 1, dir: 1 }).join() === '2,1,0' && B.tableView(m, { q: 'beta' }).join() === '1');
  const st = B.columnStats(m)[1]; ok('columnStats: sum / avg / min / max', st.sum === 1325 && Math.round(st.avg) === 442 && st.min === 75 && st.max === 1000);
  ok('csvOut neutralises spreadsheet formulas but keeps negative numbers', (function () { const mm = B.tableModel('a,n\n=SUM(A1),-5\n+cmd,3'); const o = B.csvOut(mm); return /'=SUM\(A1\)/.test(o) && /,-5\r\n/.test(o) && /'\+cmd/.test(o); })());
  ok('mdTable right-aligns numeric columns', /\| --- \| ---: \| --- \|/.test(B.mdTable(m)));
}

/* ── charts ── */
{
  const good = B.chartSpec('{"type":"bar","title":"Rev","unit":"K","labels":["Jan","Feb"],"series":[{"name":"A","values":[10,20]},{"name":"B","values":[5,"x"]}]}');
  ok('chartSpec: non-numeric series are dropped, the rest kept', good.ok && good.spec.series.length === 1 && good.spec.labels.length === 2);
  ok('chartSpec: {data:[{label,value}]} shorthand and a bare array work', B.chartSpec('{"data":[{"label":"a","value":1},{"label":"b","value":2}]}').ok && B.chartSpec('[{"label":"a","value":1}]').ok);
  ok('chartSpec: invalid JSON and empty data give a readable error', !B.chartSpec('{').ok && /valid JSON/.test(B.chartSpec('{').error) && !B.chartSpec('{"labels":[],"series":[]}').ok);
  const spec = B.chartSpec('{"title":"T <b>","labels":["Alpha long label here","B","C"],"series":[{"name":"S","values":[3,-2,5]}]}').spec;
  ['bar', 'line', 'area', 'donut'].forEach((t) => { const s = B.chartSvg(spec, { type: t }); ok('chartSvg ' + t + ': valid svg, title escaped, accessible', /^<svg[^>]*viewBox="0 0 720/.test(s) && /<\/svg>$/.test(s) && !/<b>/.test(s) && /role="img"/.test(s) && !/NaN|undefined/.test(s)); });
  ok('chartSvg: standalone export embeds its own colours', /<style>/.test(B.chartSvg(spec, { standalone: true })) && !/<style>/.test(B.chartSvg(spec, {})));
  ok('chartSvg: stacked and multi-series legend render', /rect/.test(B.chartSvg({ ...spec, series: [spec.series[0], { name: 'T', values: [1, 2, 3] }], stacked: true }, {})));
  ok('chartCsv: label column then one column per series', B.chartCsv(spec).split('\r\n')[0] === 'Label,S');
}

/* ── highlight / diff / sandbox ── */
{
  const h = B.highlight('const a = "x < y"; // note\nreturn 42', 'javascript');
  ok('highlight js: keyword, string, comment, number — and everything is escaped', /aart-hl-k">const/.test(h) && /aart-hl-s">&quot;x &lt; y&quot;/.test(h) && /aart-hl-c">\/\/ note/.test(h) && /aart-hl-v">42/.test(h));
  ok('highlight: html input never produces live tags', !/<script/.test(B.highlight('<script>alert(1)</script>', 'html')) && !/<script/.test(B.highlight('<script>alert(1)</script>', 'text')));
  ok('highlight: json keys, sql keywords (case-insensitive), unknown language, huge input', /aart-hl-n">&quot;a&quot;/.test(B.highlight('{"a": 1}', 'json')) && /aart-hl-k">SELECT/.test(B.highlight('SELECT 1', 'sql')) && B.highlight('<b>', 'klingon') === '&lt;b&gt;' && B.highlight('x'.repeat(200000), 'js').length === 200000);
  const d = B.lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  ok('lineDiff: counts added / removed lines and keeps equal ones', d.added === 2 && d.removed === 1 && d.ops.filter((o) => o.t === '=').length === 3);
  ok('diffHtml: identical versions say so, big gaps are collapsed', /No changes/.test(B.diffHtml(B.lineDiff('a', 'a'))) && /unchanged lines/.test(B.diffHtml(B.lineDiff(Array.from({ length: 30 }, (_, i) => 'l' + i).join('\n'), Array.from({ length: 30 }, (_, i) => i === 15 ? 'X' : 'l' + i).join('\n')))));
  const sd = B.sandboxDoc('<!doctype html><html><body><script>1</script></body></html>');
  ok('sandboxDoc: the CSP comes first and has no network, forms or frames', /^<!doctype html><meta http-equiv="Content-Security-Policy"/.test(sd) && /connect-src 'none'/.test(sd) && /form-action 'none'/.test(sd) && /frame-src 'none'/.test(sd) && sd.indexOf('Content-Security-Policy') < sd.indexOf('<script>'));
  const fp = B.fullPageDoc('<p>"x" & y</p>', 'T');
  ok('fullPageDoc: wraps the page in a sandboxed iframe without allow-same-origin', /sandbox="allow-scripts allow-modals"/.test(fp) && !/allow-same-origin/.test(fp) && /&quot;x&quot; &amp; y/.test(fp));
}

/* ── prompt ── */
ok('promptRules: tag format, six types, same-id rule, no invented figures', /<artifact id=/.test(B.promptRules()) && /SAME id/.test(B.promptRules()) && /Never invent company figures/.test(B.promptRules()) && /report template/.test(B.promptRules({ odoo: true })));
ok('wantsArtifact: deliverable requests yes, plain questions no', ['create a report on Q3 sales', 'build me a dashboard page', 'draft an email to the team', 'make this into a table', 'generate a bar chart of revenue', 'save as artifact'].every(B.wantsArtifact) && !['how many orders today', 'who is our top customer', 'why did revenue fall'].some(B.wantsArtifact));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
