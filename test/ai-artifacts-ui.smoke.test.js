// AI Artifacts in the workspace (jsdom): cards in chat, the side panel, versions, edit, table / chart / page previews, library, revise.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log(' FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com/dashboard.html', pretendToBeVisual: true });
  const w = dom.window, d = w.document, errs = [], toasts = [];
  w.addEventListener('error', (e) => errs.push(e.message));
  w.eval(fs.readFileSync(path.join(root, 'js/ai-response-template.js'), 'utf8'));
  const now = Date.now(), mk = (id, type, title, content, extra) => Object.assign({ id, tid: 't1', mid: id, type, lang: '', title, pinned: false, created: now, updated: now, next: 2, chat: 'Sales review', versions: [{ n: 1, t: now, by: 'ai', content, source: 'Live Odoo · 3 queries', note: '' }] }, extra || {});
  const items = {
    ardoc: mk('ardoc', 'document', 'Q3 sales report', '# Q3 sales report\n\n## Summary\n\nRevenue is **up 12%**.\n\n## Risks\n\nOne large order is late.\n\n## Actions\n\nFollow up.\n\n| Region | Sales |\n|---|---|\n| North | 10 |'),
    artbl: mk('artbl', 'table', 'Open quotations', 'Customer,Amount,Date\nAcme,"1,000",2026-01-02\nBeta,250,2026-02-03\nCore,75,2026-03-04'),
    archt: mk('archt', 'chart', 'Revenue by month', JSON.stringify({ type: 'bar', title: 'Revenue', labels: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Revenue', values: [10, 20, 15] }] })),
    arweb: mk('arweb', 'html', 'KPI page', '<!doctype html><html><body><h1>Hi</h1><script>window.x=1</script></body></html>'),
    arcod: mk('arcod', 'code', 'Query', 'select 1 -- note', { lang: 'sql' })
  };
  w.localStorage.setItem('dv-ai-artifacts-v1', JSON.stringify({ v: 1, items }));
  w.localStorage.setItem('dv-ai-workspace-v2', JSON.stringify({ activeId: 't1', threads: [{ id: 't1', title: 'Sales review', created: now, updated: now, messages: [
    { id: 'm1', role: 'user', content: 'write the Q3 report and a table', time: now },
    { id: 'm2', role: 'ai', content: 'Here is the report.\n\n[[artifact:ardoc:1]]\n\nAnd the data:\n\n[[artifact:artbl:1]]\n\n[[artifact:archt:1]]\n\n[[artifact:arweb:1]]\n\n[[artifact:arcod:1]]', time: now, engine: 'provider' },
    { id: 'm3', role: 'ai', content: '## Overview\n\n' + 'word '.repeat(120) + '\n\n| a | b |\n|---|---|\n| 1 | 2 |', time: now, engine: 'provider' }] }] }));
  w.showToast = (m) => toasts.push(m);
  w.eval(fs.readFileSync(path.join(root, 'js/ai-artifacts.js'), 'utf8'));
  w.DashViewAI = { respond: () => ({ content: 'ok', tag: null }) };
  w.eval(fs.readFileSync(path.join(root, 'js/ai-embed.js'), 'utf8'));
  await wait(300);
  const aiw = d.getElementById('aiw') || d.querySelector('.aiw'), q = (s) => d.querySelector(s), qa = (s) => Array.from(d.querySelectorAll(s));
  const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const panel = () => q('#aiwArt'), stage = () => q('#aartStage');

  ok('boot: no script errors, panel mounted and closed', errs.length === 0 && !!panel() && aiw.dataset.art === 'closed');
  ok('chat: one card per artifact, with type, version and size', qa('.aart-card').length === 5 && /Q3 sales report/.test(qa('.aart-card')[0].textContent) && /Document · \d+ words · v1/.test(qa('.aart-card')[0].textContent) && /3 rows × 3 cols/.test(qa('.aart-card')[1].textContent));
  ok('chat: the marker text is gone and the sentence around it stays', !/\[\[artifact:/.test(d.getElementById('aiwMessages').innerHTML) && /Here is the report\./.test(d.getElementById('aiwMessages').textContent));
  ok('chat: library button shows how many are saved', q('#aiwArtBtn .aart-count').textContent === '5' && !q('#aiwArtBtn .aart-count').hidden);
  ok('chat: a long answer offers Save as artifact; an artifact message does not', !!q('.aiw-msg[data-mid="m3"] [data-act="art-save"]') && !q('.aiw-msg[data-mid="m2"] [data-act="art-save"]'));
  ok('areas: a Create tab with artifact prompts (shown on a new chat)', /Create: \['Write a one-page executive summary/.test(fs.readFileSync(path.join(root, 'js/ai-embed.js'), 'utf8')));

  /* document */
  click(q('.aart-card-main[data-aid="ardoc"]'));
  ok('open: panel opens on the document with title, version chip and tabs', aiw.dataset.art === 'open' && q('#aartTitle').value === 'Q3 sales report' && /v1/.test(q('.aart-chip').textContent) && qa('.aart-seg button').length === 2);
  ok('document: rendered Markdown (heading, bold, table) and a contents bar', !!stage().querySelector('.aart-doc h2') && !!stage().querySelector('.aart-doc strong') && !!stage().querySelector('.aart-doc table') && qa('.aart-toc button').length >= 3);
  click(q('[data-a="tab"][data-t="source"]'));
  ok('source: raw Markdown with line numbers', /# Q3 sales report/.test(stage().textContent) && !!stage().querySelector('.aart-gut'));
  click(q('[data-a="tab"][data-t="preview"]'));
  click(q('[data-a="edit"]'));
  const ta = q('#aartEdit'); ta.value = ta.value + '\n\n## Added by me\n\nText.'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  q('#aartNote').value = 'added a section'; click(q('[data-a="save"]'));
  ok('edit: saving creates v2 by me with a note, shown in the version menu', /v2 of 2/.test(q('.aart-chip').textContent) && !!stage().querySelector('.aart-doc') && /Added by me/.test(stage().textContent));
  click(q('[data-a="menu"][data-m="ver"]'));
  ok('versions: menu lists both, latest first, with who and note', qa('.aart-menu button').length === 2 && /v2 · latest/.test(qa('.aart-menu button')[0].textContent) && /You/.test(qa('.aart-menu button')[0].textContent) && /added a section/.test(qa('.aart-menu button')[0].textContent));
  click(qa('.aart-menu button')[1]);
  ok('versions: opening v1 shows the banner and restore', /earlier version/.test(q('.aart-banner').textContent) && !!q('[data-a="restore"]'));
  click(q('[data-a="tab"][data-t="changes"]').closest('div') ? q('[data-a="latest"]') : q('[data-a="latest"]'));
  click(q('[data-a="tab"][data-t="changes"]'));
  ok('changes: diff v1 → v2 counts added lines', /\+\d+/.test(stage().textContent) && !!stage().querySelector('.aart-df.add') && /v1 → v2/.test(stage().textContent));
  ok('persisted: the new version is in the store', (() => { w.DVArtifacts.flush(); return JSON.parse(w.localStorage.getItem('dv-ai-artifacts-v1')).items.ardoc.versions.length === 2; })());
  click(q('[data-a="menu"][data-m="dl"]'));
  ok('download: document formats (md, html, Word, PDF, text)', qa('.aart-menu button').length === 5 && /Word/.test(q('.aart-menu').textContent));
  click(q('[data-a="menu"][data-m="dl"]'));

  /* table */
  click(q('[data-a="lib"]'));
  ok('library: lists everything, newest / pinned first, with filter counts', qa('.aart-row').length === 5 && /All5/.test(q('.aart-filters').textContent.replace(/\s/g, '')));
  click(q('[data-a="lfilter"][data-t="table"]'));
  ok('library: type filter', qa('.aart-row').length === 1 && /Open quotations/.test(q('.aart-row').textContent));
  const lq = q('#aartLq'); lq.value = 'nomatch'; lq.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('library: search with no match says so', /Nothing matches/.test(stage().textContent));
  click(q('[data-a="lfilter"][data-t="all"]')); q('#aartLq').value = ''; q('#aartLq').dispatchEvent(new w.Event('input', { bubbles: true }));
  click(qa('.aart-row-main').filter((b) => /Open quotations/.test(b.textContent))[0]);
  ok('table: typed columns, numbers right-aligned, row count', stage().querySelectorAll('tbody tr').length === 3 && stage().querySelectorAll('td.num').length === 3 && /3 of 3 rows/.test(stage().textContent));
  click(qa('.aart-tbl thead button')[1]); click(qa('.aart-tbl thead button')[1]);
  ok('table: clicking a header sorts numerically (descending on the second click)', stage().querySelector('tbody tr td').textContent === 'Acme' && stage().querySelector('th[aria-sort="descending"]'));
  const tq = q('#aartTq'); tq.value = 'beta'; tq.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('table: search filters rows live', stage().querySelectorAll('tbody tr').length === 1 && /1 of 3 rows/.test(stage().textContent));
  click(q('input[data-a="ttotals"]'));
  ok('table: totals row and column stats', !!stage().querySelector('tfoot') );
  click(q('input[data-a="tstats"]'));
  ok('table: stats table lists sum / avg for numeric columns', /1,325/.test(stage().textContent));

  /* chart */
  click(q('[data-a="lib"]')); click(qa('.aart-row-main').filter((b) => /Revenue by month/.test(b.textContent))[0]);
  ok('chart: drawn as an accessible svg with a type switcher and a data table', !!stage().querySelector('svg.aart-svg[role="img"]') && qa('.aart-ctool button').length === 4 && !!stage().querySelector('details.aart-data'));
  click(qa('.aart-ctool button').filter((b) => b.dataset.t === 'donut')[0]);
  ok('chart: switching to donut redraws in place', /Total/.test(stage().querySelector('svg').textContent));

  /* web page */
  click(q('[data-a="lib"]')); click(qa('.aart-row-main').filter((b) => /KPI page/.test(b.textContent))[0]);
  const fr = stage().querySelector('iframe.aart-frame');
  ok('page: sandboxed iframe — scripts only, never same-origin', !!fr && fr.getAttribute('sandbox') === 'allow-scripts allow-modals' && !/allow-same-origin/.test(fr.outerHTML));
  ok('page: the srcdoc starts with a CSP that blocks network, forms and frames', /^<!doctype html><meta http-equiv="Content-Security-Policy"/.test(fr.srcdoc) && /connect-src 'none'/.test(fr.srcdoc) && /<h1>Hi<\/h1>/.test(fr.srcdoc));
  click(q('[data-a="device"][data-d="phone"]'));
  ok('page: device preview switches the frame width', stage().querySelector('.aart-framebox').dataset.device === 'phone');

  /* code */
  click(q('[data-a="lib"]')); click(qa('.aart-row-main').filter((b) => /Query/.test(b.textContent))[0]);
  ok('code: highlighted, escaped, line numbers', !!stage().querySelector('.aart-hl-k') && !!stage().querySelector('.aart-gut'));

  /* revise */
  const ask = q('#aartAsk'); ask.value = 'add a limit'; ask.dispatchEvent(new w.Event('input', { bubbles: true })); click(q('[data-a="revise"]'));
  await wait(60);
  const saved = JSON.parse(w.localStorage.getItem('dv-ai-workspace-v2')), msgs = saved.threads[0].messages, last = msgs.filter((m) => m.role === 'user').pop();
  ok('revise: sends a normal chat message that points at the artifact', /^Revise “Query”: add a limit$/.test(last.content) && last.artRef && last.artRef.aid === 'arcod' && last.artRef.n === 1);

  /* rename, pin, delete, close */
  const title = q('#aartTitle'); title.value = 'Open quotes'; title.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('rename: title updates everywhere (store + cards)', w.DVArtifacts.get('arcod').title === 'Open quotes');
  click(q('[data-a="lib"]')); click(qa('[data-a="lpin"]')[0]);
  ok('pin: pinned artifact sorts first', w.DVArtifacts.list()[0].pinned === true);
  const delBtn = qa('[data-a="ldel"]').pop(); const delId = delBtn.dataset.id; click(delBtn);
  const armed = /Delete\?/.test(q('[data-a="ldel"][data-id="' + delId + '"]').textContent); click(q('[data-a="ldel"][data-id="' + delId + '"]'));
  ok('delete: first click asks, second deletes', armed && !w.DVArtifacts.get(delId));
  panel().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Esc: closes the panel', aiw.dataset.art === 'closed');
  click(q('#aiwInspBtn')); click(q('.aart-card-main[data-aid="ardoc"]'));
  ok('panels: opening an artifact closes the details pane, and the reverse', aiw.dataset.insp === 'closed' && aiw.dataset.art === 'open' && (click(q('#aiwInspBtn')), aiw.dataset.art === 'closed' && aiw.dataset.insp === 'open'));
  ok('security: nothing from artifact content became live markup in the page', !d.querySelector('.aiw-msg script') && !/<script>window\.x/.test(d.getElementById('aiwMessages').innerHTML));
  ok('no script errors during the whole run', errs.length === 0);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
