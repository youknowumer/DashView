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

/* ── deeper analytics (v2.32): profile, prioritised findings, AI-insight prompt and safe parsing ── */
{
  const p = T.profileMetric(ranked), d = T.deepInsights(ranked);
  ok('profile: ranked metric gets total, largest, top 3, concentration and 80% tiles', ['Total', 'Largest', 'Top 3', 'Concentration', '80% comes from'].every((k) => p.kpis.some((x) => x.k === k)) && p.kpis.find((x) => x.k === 'Largest').v === 'Acme' && p.pareto.n80 >= 1 && p.hhi.value > 0);
  ok('findings: prioritised high -> note, each with a why line, numbers from the rows', d.length >= 2 && d[0].sev === 'high' && d.every((x) => x.why) && d.some((x) => /^Acme alone is 43\.9% of the total \(500K\)/.test(x.text)));
  const sp = T.profileMetric(series), sd = T.deepInsights(series);
  ok('profile: series gets latest, trend and a labelled next-period estimate', sp.kpis[0].k === 'Latest' && /^\+20% vs Sep$/.test(sp.kpis[0].sub) && sp.trend.next > 180 && sd.some((x) => /straight line/i.test(x.text) && /not a forecast/.test(x.why)));
  ok('findings: overdue-style series flag a rise as unfavourable', T.deepInsights(overdue).some((x) => x.tone === 'warn'));
  ok('profile: fewer than 2 rows -> null / no findings', T.profileMetric({ rows: [{ label: 'a', value: 1 }] }) === null && T.deepInsights({}).length === 0);
  ok('deepFindingsText prefixes the priority and stays exact', /^- amount total by partner: \[HIGH\]/.test(T.deepFindingsText({ metrics: [ranked] })));
  const pack = T.aiMessages(ranked, { currency: 'PKR', question: 'top customers' });
  ok('AI prompt: exact rows, shares, calculated findings and a strict JSON contract', /1\. Acme \| 500000 \| 2 records \| 43\.9%/.test(pack.messages[0].content) && /CALCULATED FINDINGS/.test(pack.messages[0].content) && /ONLY one JSON object/.test(pack.system) && /top customers/.test(pack.messages[0].content));
  const good = T.parseAiInsights('```json\n{"headline":"Acme is 43.9% of the total (500K of 1.14M)","confidence":"high","drivers":[{"text":"Acme at 500K leads","row":"acme"}],"risks":[{"text":"Revenue of 9.9M is at risk","row":"nobody"}],"actions":["Call Acme"],"questions":["Why is Acme so large?"]}\n```', pack.facts);
  ok('AI parse: fences stripped, confidence normalised, row matched to a real label, unknown row dropped', good && good.confidence === 'High' && good.drivers[0].row === 'Acme' && good.risks[0].row === '' && good.actions[0].text === 'Call Acme');
  ok('AI parse: figures not in the rows are marked verify, grounded ones are not', good.risks[0].check === true && good.drivers[0].check === false && good.headlineCheck === false);
  ok('AI parse: garbage -> null', T.parseAiInsights('sorry, no', pack.facts) === null && T.parseAiInsights('{"headline":"","drivers":[]}', pack.facts) === null);
  const ro = T.calcReadout(ranked);
  ok('calculated read-out works with no AI: headline, risks and actions come only from findings', ro && ro.headline && ro.risks.length >= 1 && ro.actions.length >= 1 && ro.questions.length === 0);
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

  /* ── v2.32 board: KPI tiles, findings, pareto, table, AI insights, drill breakdown ── */
  {
    const q = (sel) => d.querySelector('.aiw-msg[data-mid="m2"] ' + sel), qa = (sel) => Array.from(d.querySelectorAll('.aiw-msg[data-mid="m2"] ' + sel));
    const c0 = () => qa('.aiw-vis-card')[0], c1 = () => qa('.aiw-vis-card')[1];
    ok('v2: KPI tiles above each chart, tiles with a record are drill buttons', c0().querySelectorAll('.aiw-vk').length >= 4 && /Concentration/.test(c0().textContent) && c0().querySelector('button.aiw-vk[data-act="vis-drill"]') !== null);
    ok('v2: deeper analysis lists prioritised findings (priority chip + why)', c0().querySelectorAll('.aiw-vf').length >= 1 && c0().querySelector('.aiw-sev') !== null && c0().querySelector('.aiw-vf-t small') !== null);
    c1().querySelector('[data-t="line"]').click();
    ok('v2: series line shows the dashed trend estimate, average key and drillable points', !!c1().querySelector('.aiw-vproj') && /Trend estimate/.test(c1().textContent) && c1().querySelectorAll('circle.aiw-vdot[data-act="vis-drill"]').length === 4);
    c0().querySelector('[data-t="pareto"]').click();
    ok('v2: Pareto view - bars + cumulative line, bars drill into records', c0().querySelectorAll('rect.aiw-pbar').length === 5 && !!c0().querySelector('.aiw-pcum') && c0().querySelector('rect.aiw-pbar').getAttribute('data-act') === 'vis-drill' && /make up 80%|80%/.test(c0().querySelector('.aiw-vkey').textContent));
    c0().querySelector('[data-t="table"]').click();
    ok('v2: Table view - rank, group, value, share, cumulative, records', c0().querySelectorAll('.aiw-vtbl tbody tr').length === 5 && /Share/.test(c0().querySelector('.aiw-vtbl thead').textContent) && /Cum\./.test(c0().querySelector('.aiw-vtbl thead').textContent));
    c0().querySelector('button[data-act="vis-sort"][data-k="label"]').click();
    ok('v2: Table sorts by a column header', c0().querySelector('.aiw-vtbl tbody tr td:nth-child(2)').textContent === 'Acme' && c0().querySelector('th[aria-sort="ascending"]') !== null);
    { const inp = c0().querySelector('.aiw-vtq'); inp.value = 'glob'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); }
    ok('v2: Table filter narrows rows and updates the count', c0().querySelectorAll('.aiw-vtbl tbody tr').length === 1 && /1 of 5 rows/.test(c0().querySelector('.aiw-vtcount').textContent));
    c0().querySelector('[data-t="bar"]').click();
    ok('v2: back to bars', c0().querySelectorAll('.aiw-vbar').length === 5);
    c1().querySelector('[data-t="bar"]').click();
    ok('v2: series bars show the change vs the previous period', /\+20%/.test(c1().querySelector('.aiw-vbars').textContent));

    /* AI insights: provider path, strict JSON, row chips, verify marks, persistence */
    const prompts = [];
    w.DVAIConfig = { isConfigured: () => true, get: () => ({ provider: 'openai' }), PROVIDERS: { openai: { label: 'OpenAI' } }, activeModel: () => 'gpt', callAI: (m, sys) => { prompts.push({ m, sys }); return Promise.resolve('{"headline":"Acme is 43.9% of the total (500K of 1.14M)","confidence":"Medium","drivers":[{"text":"Acme at 500K leads","row":"Acme"}],"risks":[{"text":"Top 3 hold 87.7% of the total","row":""},{"text":"Revenue of 9.9M could slip","row":"Globex"}],"actions":[{"text":"Review the Acme contract","row":"Acme"}],"questions":["Why is Acme so large?"]}'); } };
    c0().querySelector('[data-act="vis-ai"]').click();
    ok('v2: AI insights shows a loading state first', !!c0().querySelector('.aiw-vai[data-s="busy"]'));
    await new Promise((r) => setTimeout(r, 120));
    const ai = c0().querySelector('.aiw-vai[data-s="done"]');
    ok('v2: AI insights panel - headline, confidence, drivers / risks / do next', !!ai && /Acme is 43\.9%/.test(ai.textContent) && /Confidence: Medium/.test(ai.textContent) && ai.querySelectorAll('.aiw-vai-col').length === 3 && ai.getAttribute('data-engine') === 'ai');
    ok('v2: AI was given the exact rows and calculated findings (not the whole chat)', prompts.length === 1 && /Acme \| 500000/.test(prompts[0].m[0].content) && /CALCULATED FINDINGS/.test(prompts[0].m[0].content) && /ONLY one JSON/.test(prompts[0].sys));
    ok('v2: row chips drill into the records; a made-up figure is marked verify, grounded ones are not', ai.querySelector('button.aiw-rowchip[data-act="vis-drill"]') !== null && ai.querySelectorAll('.aiw-verify').length === 1 && /9\.9M/.test(ai.querySelector('.aiw-verify').parentNode.textContent));
    ok('v2: follow-up questions are clickable', ai.querySelector('button.aiw-q[data-act="vis-q"]').getAttribute('data-q') === 'Why is Acme so large?');
    ok('v2: AI insights are saved with the chat', /"aiIns"/.test(w.localStorage.getItem('dv-ai-workspace-v2')));
    c0().querySelector('[data-act="vis-ai-x"]').click();
    ok('v2: AI insights can be dismissed', !c0().querySelector('.aiw-vai'));
    w.DVAIConfig = undefined;
    c0().querySelector('[data-act="vis-ai"]').click();
    await new Promise((r) => setTimeout(r, 40));
    ok('v2: no AI provider -> calculated read-out, clearly labelled', !!c0().querySelector('.aiw-vai[data-engine="calc"]') && /Calculated read-out/.test(c0().querySelector('.aiw-vai').textContent));
    { let n = 0; w.DVAIConfig = { isConfigured: () => true, get: () => ({ provider: 'openai' }), PROVIDERS: { openai: { label: 'OpenAI' } }, callAI: () => { n++; return Promise.reject(new Error('rate limit')); } }; c0().querySelector('[data-act="vis-ai"]').click(); await new Promise((r) => setTimeout(r, 60)); ok('v2: AI failure shows a clear error with Try again (nothing invented)', n === 1 && !!c0().querySelector('.aiw-vai[data-s="error"]') && /rate limit/.test(c0().textContent) && !!c0().querySelector('.aiw-vai [data-act="vis-ai"]')); }
    w.DVAIConfig = undefined;
    { let blob; w.navigator.clipboard = { writeText: (t) => { blob = t; return Promise.resolve(); } }; c0().querySelector('[data-act="vis-copy"]').click(); await new Promise((r) => setTimeout(r, 20)); ok('v2: Copy summary carries key figures and findings', /Total: 1\.14M/.test(blob || '') && /\[High\]/.test(blob || '')); }

    /* drill v2: records -> break down by another field -> group -> records */
    const rcalls = [];
    w.DVOdoo = { rpc: (ep, body) => { rcalls.push([ep, body]); if (ep === 'fields') return Promise.resolve({ fields: { name: ['char', 'Number'], partner_id: ['many2one', 'Customer', 'res.partner'], state: ['selection', 'Status'], amount_total: ['float', 'Total'] } }); if (ep === 'records') return Promise.resolve({ rows: [{ id: 7, name: 'SO007', partner_id: [1, 'Acme'], amount_total: 500 }], total: 2 }); if (ep === 'read-group') return Promise.resolve({ ok: true, groups: body.groupby && body.groupby.length ? [{ state: 'sale', __count: 2, 'amount_total:sum': 800, __domain: [['partner_id', '=', 1], ['state', '=', 'sale']] }, { state: 'draft', __count: 1, 'amount_total:sum': 100, __domain: [['partner_id', '=', 1], ['state', '=', 'draft']] }] : [{ __count: 3, 'amount_total:sum': 900 }] }); return Promise.reject(new Error('unexpected ' + ep)); } };
    d.querySelector('.aiw-pop [data-act="pop-close"]') && d.querySelector('.aiw-pop [data-act="pop-close"]').click();
    await new Promise((r) => setTimeout(r, 260));
    c0().querySelector('.aiw-vbar[data-act="vis-drill"]').click();
    await new Promise((r) => setTimeout(r, 120));
    ok('drill v2: records open with the metric total next to the count', !d.querySelector('.aiw-pop').hidden && /amount total/.test(d.getElementById('aiwPopBody').textContent) && rcalls.some((c) => c[0] === 'read-group' && c[1].groupby.length === 0 && c[1].fields[0] === 'amount_total:sum'));
    const chips = Array.from(d.querySelectorAll('#aiwGby [data-act="pop-by"]'));
    ok('drill v2: "Break down by" offers the model\'s groupable fields', chips.length >= 2 && chips.some((c) => /Customer/.test(c.textContent)) && chips.some((c) => /Status/.test(c.textContent)));
    chips.find((c) => /Status/.test(c.textContent)).click();
    await new Promise((r) => setTimeout(r, 120));
    ok('drill v2: breakdown lists groups with value, share and records (read-only read-group)', d.querySelectorAll('.aiw-groups-pro .aiw-grow').length === 2 && /800/.test(d.getElementById('aiwPopBody').textContent) && /88\.9%/.test(d.getElementById('aiwPopBody').textContent) && rcalls.some((c) => c[0] === 'read-group' && c[1].groupby[0] === 'state' && c[1].domain.length === 1));
    ok('drill v2: Records / measure switch is offered and the trail shows the path', !!d.querySelector('[data-act="pop-gm"]') && /By Status/.test(d.getElementById('aiwPopCrumbs').textContent));
    d.querySelector('.aiw-grow[data-act="pop-grow"]').click();
    await new Promise((r) => setTimeout(r, 120));
    ok('drill v2: a group opens its records and the drill continues (title keeps the path)', /›/.test(d.getElementById('aiwPopTitle').textContent) && d.querySelectorAll('#aiwGby [data-act="pop-by"]').length >= 2 && rcalls.filter((c) => c[0] === 'records').some((c) => JSON.stringify(c[1].domain).indexOf('"sale"') > -1));
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
