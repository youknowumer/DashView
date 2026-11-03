// Insight board: computed insights (js/ai-response-template.js), interactive charts + drill (js/ai-embed.js) and the agent's visuals / findings (js/ai-odoo-agent.js).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const T = require('../js/ai-response-template.js');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log(' FAIL', n); } };
const rows = (a) => a.map(([label, value], i) => ({ label, value, count: 2 + i, domain: [['partner_id', '=', i + 1]] }));
const ranked = { title: 'amount total by partner', model: 'sale.order', groupBy: ['partner_id'], measure: 'amount_total:sum', chartType: 'bar', rows: rows([['Acme', 500000], ['Globex', 300000], ['Initech', 200000], ['Umbrella', 90000], ['Hooli', 50000]]) };
const series = { title: 'amount total by month', model: 'sale.order', groupBy: ['date_order:month'], measure: 'amount_total:sum', chartType: 'line', rows: rows([['Jul', 100], ['Aug', 120], ['Sep', 150], ['Oct', 180]]) };
const overdue = { title: 'amount residual by month', model: 'account.move', groupBy: ['invoice_date:month'], measure: 'amount_residual:sum', chartType: 'line', rows: rows([['Aug', 100], ['Sep', 120], ['Oct', 160]]) };

/* ── analytics ── */
ok('fmtCompact: K / M / B, no stripped zeros', [500000, 1234567, 950, -45000, 12.5, 2e9].map(T.fmtCompact).join('|') === '500K|1.23M|950|-45K|12.5|2B');
{
  const a = T.analyzeMetric(ranked);
  ok('ranked: shares add to 100 and top row is flagged with its share', Math.abs(a.shares.reduce((x, y) => x + y, 0) - 100) < 1e-9 && /^Acme is 43\.9% of the total \(500K of 1\.14M\)$/.test(a.insights[0].text) && a.insights[0].ri === 0 && a.insights[0].tone === 'warn');
  ok('ranked: top-3 concentration insight', a.insights.some((i) => /^Top 3 = 87\.7%/.test(i.text)));
  const s = T.analyzeMetric(series);
  ok('series: latest vs previous, peak, lowest, average', s.series && s.shares[0] === null && /^Oct is \+20% vs Sep \(180 vs 150\)$/.test(s.insights[0].text) && s.insights[0].tone === 'good' && s.insights.some((i) => /Peak: Oct/.test(i.text)) && s.insights.some((i) => /Lowest: Jul/.test(i.text)));
  ok('series: rising for 3 periods', s.insights.length <= 4 && T.analyzeMetric({ ...series, rows: rows([['a', 1], ['b', 2], ['c', 3], ['d', 5]]) }).insights.some((i) => /Rising for 3/.test(i.text)));
  ok('lower-is-better metrics (overdue / residual) turn a rise into a warning', T.analyzeMetric(overdue).insights[0].tone === 'warn');
  ok('non-additive measures get no shares', T.analyzeMetric({ ...ranked, measure: 'price_unit:avg' }).shares[0] === null);
  ok('fewer than 2 numeric rows -> no analysis', T.analyzeMetric({ rows: [{ label: 'a', value: 1 }] }) === null && T.analyzeMetric({}) === null);
  ok('findingsText lists each metric with its insights', /^- amount total by partner \(5 rows, total 1\.14M\): Acme is 43\.9%/.test(T.findingsText({ metrics: [ranked, series] })) && /amount total by month \(4 rows\): Oct is \+20%/.test(T.findingsText({ metrics: [ranked, series] })));
}

/* ── agent: visuals + computed findings in the answer prompt ── */
const agentSrc = fs.readFileSync(path.join(root, 'js/ai-odoo-agent.js'), 'utf8');
async function runAgent(withTemplate) {
  const calls = { llm: [] };
  const w = { location: { origin: 'https://me.github.io' },
    DVOdoo: { getConfig: () => ({ proxyUrl: 'https://w.workers.dev', url: 'https://x.odoo.com', db: 'x', user: 'u', apiKey: 'k' }),
      rpc: (ep) => ep === 'diagnose' ? Promise.resolve({ ok: true, stage: 'access', version: '18.0', latencyMs: 300, currency: 'PKR', company: 'Acme', areas: { Sales: { model: 'sale.order', status: 'ok', records: 12 } } })
        : Promise.resolve({ ok: true, results: { q1: { ok: true, op: 'read-group', model: 'sale.order', groups: [
          { partner_id: [1, 'Acme'], __count: 3, amount_total: 9000, __domain: [['partner_id', '=', 1]] }, { partner_id: [2, 'Globex'], __count: 1, amount_total: 500, __domain: [['partner_id', '=', 2]] }] } } }) },
    DVAIConfig: { callAI: (m, s) => { calls.llm.push({ sys: s }); return Promise.resolve(calls.llm.length === 1 ? JSON.stringify({ queries: [{ id: 'q1', op: 'read-group', model: 'sale.order', domain: [], groupby: ['partner_id'], measures: ['amount_total:sum'], fields: ['amount_total:sum'], limit: 5 }] }) : 'ok'); } },
    DVAICompanyContext: { build: () => Promise.resolve('') } };
  if (withTemplate) w.DVAITemplate = T;
  new Function('window', 'location', agentSrc)(w, w.location);
  const r = await w.DVOdooAgent.askDetailed('top customers by revenue', [{ role: 'user', content: 'top customers by revenue' }], { systemPrompt: 'BASE' });
  return { r, calls };
}
(async () => {
  {
    const { r, calls } = await runAgent(true);
    ok('agent: data answers carry a storable visuals payload with Odoo domains', r.visuals && r.visuals.metrics.length === 1 && r.visuals.metrics[0].rows.length === 2 && Array.isArray(r.visuals.metrics[0].rows[0].domain) && r.dashboard === null);
    ok('agent: answer prompt has the computed findings block', /COMPUTED FINDINGS/.test(calls.llm[1].sys) && /Acme is 94\.7% of the total/.test(calls.llm[1].sys));
    JSON.stringify(r.visuals);
  }
  { const { r, calls } = await runAgent(false); ok('agent: without the template module nothing changes (visuals still built, no findings)', !/COMPUTED FINDINGS/.test(calls.llm[1].sys) && r.visuals && r.visuals.metrics.length === 1); }

  /* ── chat view (jsdom) ── */
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com/dashboard.html', pretendToBeVisual: true });
  const w = dom.window, errs = [], toasts = [];
  w.addEventListener('error', (e) => errs.push(e.message));
  w.eval(fs.readFileSync(path.join(root, 'js/ai-response-template.js'), 'utf8'));
  const now = Date.now();
  w.localStorage.setItem('dv-ai-workspace-v2', JSON.stringify({ activeId: 't1', threads: [{ id: 't1', title: 'x', created: now, updated: now, messages: [
    { id: 'm1', role: 'user', content: 'top customers', time: now },
    { id: 'm2', role: 'ai', content: '> **Bottom line:** ok', time: now, engine: 'odoo', liveOdoo: true, visuals: { version: 1, source: 'Live Odoo', currency: 'PKR', metrics: [ranked, series, { title: 'bad', rows: [{ label: '<img src=x onerror=alert(1)>', value: 1 }] }] } },
    { id: 'm3', role: 'ai', content: '```chart\nSales\nAcme: 5\nGlobex: 3\n```', time: now, engine: 'provider' }] }] }));
  w.showToast = (m) => toasts.push(m);
  w.eval(fs.readFileSync(path.join(root, 'js/ai-embed.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 300));
  const d = w.document, cards = d.querySelectorAll('.aiw-vis-card');
  ok('view: no script errors', errs.length === 0);
  ok('view: one card per metric with 2+ rows (bad one dropped), insights as chips', cards.length === 2 && cards[0].querySelectorAll('.aiw-vin').length >= 2);
  ok('view: ranked metric defaults to bars with share, series to a line', cards[0].querySelectorAll('.aiw-vbar').length === 5 && /43\.9%/.test(cards[0].textContent) && !!cards[1].querySelector('svg.aiw-vline') && cards[1].querySelectorAll('circle[data-act="vis-drill"]').length === 4);
  ok('view: tooltips carry label, value, share and records', /Acme · PKR 500K · 43\.9% of total · 2 records — click to open the records/.test(cards[0].querySelector('.aiw-vbar').getAttribute('title')));
  ok('view: chart type switch (Bars/Share, Line/Bars) works in place', (() => { cards[0].querySelector('[data-t="donut"]').click(); const a = !!cards[0].querySelector('.aiw-vdonut') && cards[0].querySelectorAll('.aiw-vleg').length === 5 && cards[0].querySelector('[data-t="donut"]').getAttribute('aria-pressed') === 'true'; cards[1].querySelector('[data-t="bar"]').click(); return a && cards[1].querySelectorAll('.aiw-vbar').length === 4 && !cards[1].querySelector('svg'); })());
  cards[0].querySelector('.aiw-vleg[data-act]').click();
  await new Promise((r) => setTimeout(r, 300));
  ok('view: clicking a slice opens the drill popup for that group', !d.querySelector('.aiw-pop').hidden && /amount total by partner · Acme/.test(d.getElementById('aiwPopTitle').textContent));
  ok('view: insight chip with a record opens the drill too', cards[0].querySelector('button.aiw-vin[data-act="vis-drill"]') !== null);
  { let blob = null; w.URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; w.URL.revokeObjectURL = () => {}; cards[0].querySelector('[data-act="vis-csv"]').click(); ok('view: CSV of the chart rows downloads', blob && blob.size > 100 && /CSV downloaded/.test(toasts.join())); }
  ok('view: Export PDF is offered for a message with a board', !!d.querySelector('.aiw-msg[data-mid="m2"] [data-act="rexport"]'));
  ok('view: board escapes labels (no injected markup)', !/<img src=x/.test(d.getElementById('aiwMessages').innerHTML));
  ok('view: model-authored chart rows are click-to-ask', d.querySelectorAll('.ai-chart-row[data-act="chart-ask"]').length === 2 && d.querySelector('.ai-chart-row').getAttribute('data-label') === 'Acme' && d.querySelector('.ai-chart-row').getAttribute('data-title') === 'Sales');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
