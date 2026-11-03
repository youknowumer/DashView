// AI response template + reporting skills + chat renderer + prompts (js/ai-response-template.js, js/ai-embed.js, js/ai-odoo-agent.js, ai-service/app/prompt.py).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(' ok  ', name); } else { fail++; console.log(' FAIL', name); } };
const T = require('../js/ai-response-template.js');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── reporting skills ── */
const skillOf = (q) => (T.detectSkill(q) || {}).id;
ok('skills: every skill has focus, watch, plan, owner and an example that routes back to itself',
  T.SKILLS.length >= 9 && T.SKILLS.every((s) => s.id && s.title && s.focus && s.watch && s.plan && s.owner && s.example && T.detectSkill(s.example) && T.detectSkill(s.example).id === s.id));
[['Sales this month vs last month, by salesperson', 'comparison'], ['Receivables aging by customer', 'receivables'], ['Unpaid vendor bills due in the next 14 days', 'purchasing'],
 ['Open positions and applicants per stage', 'people'], ['Won vs lost opportunities by salesperson this quarter', 'pipeline'], ['Late deliveries: scheduled before today and not done', 'inventory'],
 ['Top 10 customers by revenue this year', 'sales'], ['Give me a board-ready company report', 'executive'], ['Where are the mistakes in my data?', 'exceptions'],
 ['pichle mahine ki bikri kitni thi', 'sales'], ['udhaar kis kis ka baqaya hai', 'receivables']].forEach(([q, id]) => ok('skill routing: "' + q + '" -> ' + id, skillOf(q) === id));
ok('skill routing: small talk gets no skill', T.detectSkill('hello there') === null && T.detectSkill('') === null);
ok('skill prompt names the skill, its coverage, owner and the lookup escape hatch', /REPORT SKILL SELECTED: Receivables & cash/.test(T.skillPrompt(T.skillById('receivables'))) && /90\+/.test(T.skillPrompt(T.skillById('receivables'))) && /ignore this skill/.test(T.skillPrompt(T.skillById('sales'))));

/* ── template prompt ── */
const prompt = T.promptFor({ visuals: false }), promptV = T.promptFor({ visuals: true, catalogue: true });
['## Key figures', '## What changed', '## Key insights', '## Risks and watch-list', '## Recommended actions', '> **Bottom line:**', 'Assumptions:', 'Confidence:', 'LOOKUP', 'BRIEF', 'REPORT'].forEach((h) => ok('template prompt contains ' + h, prompt.indexOf(h) >= 0));
ok('template prompt: visuals off forbids kpi/chart blocks, visuals on allows them', /do not write ```kpi/.test(prompt) && /you may add up to 4 KPI cards/.test(promptV) && !/you may add up to 4 KPI cards/.test(prompt));
ok('template prompt: catalogue lists every skill', T.SKILLS.every((s) => promptV.indexOf(s.title) >= 0));
const py = fs.readFileSync(path.join(root, 'ai-service/app/prompt.py'), 'utf8');
ok('python prompt mirrors the same headings (keep in sync)', ['## Key figures', '## What changed', '## Key insights', '## Risks and watch-list', '## Recommended actions', '> **Bottom line:**', 'Assumptions:', 'Confidence:'].every((h) => py.indexOf(h) >= 0) && T.SKILLS.every((s) => py.toLowerCase().indexOf(s.title.split(' ')[0].toLowerCase()) >= 0));

/* ── parsing ── */
const sample = '> **Bottom line:** Sales PKR 1.2M, +12.4% vs last month.\n\n## Key figures\n| Metric | Value | vs previous | Note |\n|---|---|---|---|\n| Sales | PKR 1.2M | +12.4% | confirmed |\n| Orders | 340 | -3.0% | |\n\n## What changed\n| Customer | Amount | Share |\n|---|---|---|\n| Acme | 500,000 | 41% |\n| Globex | 300,000 | 25% |\n\n## Key insights\n- Acme is 41% of sales, so one late payment moves the month.\n\n## Risks and watch-list\n> **Risk:** Acme is 41% of confirmed sales.\n\n## Recommended actions\n| Priority | Action | Evidence | Impact | Effort | Owner |\n|---|---|---|---|---|---|\n| High | Agree a payment plan with Acme | 41% share | Protects cash | Low | Sales lead |\n\nAssumptions: confirmed orders, 1 Oct - 3 Nov 2026, PKR.\nConfidence: High — every figure from verified metrics.\n\n*Live Odoo · 2 queries (sale.order) · 1.2s*';
const ex = T.extract(sample);
ok('extract: confidence, assumptions and source leave the body', ex.confidence && ex.confidence.level === 'High' && /verified metrics/.test(ex.confidence.reason) && /confirmed orders/.test(ex.assumptions) && /Live Odoo/.test(ex.source) && !/Confidence:/.test(ex.body) && !/Assumptions:/.test(ex.body) && !/Live Odoo/.test(ex.body));
ok('extract: plain text without template lines is untouched', T.extract('Just two sentences. Nothing special.').body === 'Just two sentences. Nothing special.' && T.extract('x').confidence === null);
ok('extract: "Confidence: low - reason" in any case, bold or not', T.extract('**Confidence:** low - partial data').confidence.level === 'Low');
ok('classifyHeading: template, analysis and legacy headings', [['Key figures', 'figures'], ['Risks and watch-list', 'risks'], ['Risks / watch-list', 'risks'], ['Recommended actions', 'actions'], ['Key insights', 'insights'], ['Root causes / contributors', 'evidence'], ['Trade-offs', 'tradeoffs'], ['Issues found', 'risks'], ['Best approach (ranked)', 'actions'], ['Sales', '']].every(([h, k]) => T.classifyHeading(h) === k));
ok('stats: a full report is flagged, a short answer is not', T.stats(sample).isReport && T.stats(sample).sections === 5 && !T.stats('Sales were PKR 1.2M.').isReport);
ok('headings: lists the section titles in order', T.headings(sample).join('|') === 'Key figures|What changed|Key insights|Risks and watch-list|Recommended actions');
ok('parseNumber: currency, commas, suffixes and signs', T.parseNumber('PKR 1.2M') === 1200000 && T.parseNumber('1,250,000') === 1250000 && T.parseNumber('-3.0%') === -3 && T.parseNumber('41%') === 41 && T.parseNumber('abc') === null);

/* ── report payload (PDF export of a chat answer) ── */
const payload = T.toReportPayload(sample, { title: 'Sales performance - test', time: Date.UTC(2026, 10, 3) });
ok('payload: kpis from Key figures with change', payload.kpis.length === 2 && payload.kpis[0].label === 'Sales' && payload.kpis[0].change === '+12.4%');
ok('payload: numeric table becomes a metric with numeric rows', payload.metrics.length === 1 && payload.metrics[0].rows.length === 2 && payload.metrics[0].rows[0].value === 500000);
ok('payload: actions table becomes nextSteps with priority and evidence', payload.nextSteps.length === 1 && payload.nextSteps[0].priority === 'High' && /Acme/.test(payload.nextSteps[0].action) && payload.nextSteps[0].why === '41% share');
ok('payload: bottom line + insights in the narrative, assumptions as method, confidence as limitation', /Sales PKR 1.2M/.test(payload.insightsText) && /one late payment/.test(payload.insightsText) && /confirmed orders/.test(payload.methods[0]) && /Confidence: High/.test(payload.limitations[0]));
{
  const report = require('../js/report-engine.js');
  let saved = null, texts = [], tables = [];
  function Stub() { this.internal = { getNumberOfPages: () => 1 }; }
  Stub.prototype = { setFillColor() {}, setTextColor() {}, setFont() {}, setFontSize() {}, setDrawColor() {}, setLineWidth() {}, rect() {}, roundedRect() {}, line() {}, circle() {}, setPage() {}, addPage() {},
    splitTextToSize(t) { return [String(t)]; }, text(t) { texts.push(Array.isArray(t) ? t.join(' ') : String(t)); }, autoTable(o) { tables.push(o); }, save(f) { saved = f; } };
  let err = null; try { report.composeAIDashboardPdf(Stub, payload); } catch (e) { err = e; }
  ok('payload: the existing PDF composer accepts it (title, KPI, evidence table, next step, limitation)', !err && texts.some((t) => /Sales performance - test/.test(t)) && texts.some((t) => /Confidence: High/.test(t)) && tables.some((c) => c.body.some((r) => r[0] === 'Acme')));
  if (err) console.log('      ', err.message);
}
ok('payload: a plain-prose answer still exports (narrative only)', (() => { const p = T.toReportPayload('Receivables are PKR 340K, 12% overdue.', {}); return p.kpis.length === 0 && /340K/.test(p.insightsText); })());

/* ── chat renderer (js/ai-embed.js renderMarkdown) ── */
const src = fs.readFileSync(path.join(root, 'js/ai-embed.js'), 'utf8');
const a = src.indexOf('function renderChartBlock(raw)'), b = src.indexOf('/* ── provider / Odoo state');
const win = { DVAITemplate: T };
const R = new Function('esc', 'window', 'let dashboardIds = 0; const dashboardPayloads = Object.create(null);\n' + src.slice(a, b) + '\nreturn { md: renderMarkdown };')(esc, win);
const html = R.md(T.extract(sample).body);
ok('render: Bottom line becomes the headline callout', /<aside class="aiw-callout" data-k="headline"><b class="aiw-callout-l">Bottom line<\/b>/.test(html));
ok('render: Risk quote becomes a risk callout', /<aside class="aiw-callout" data-k="risk">/.test(html));
ok('render: section headings carry their section key', ['figures', 'changes', 'insights', 'risks', 'actions'].every((k) => html.indexOf('<h2 class="aiw-h" data-sec="' + k + '">') >= 0));
ok('render: numeric columns right-aligned, signed change tinted, priority and effort as chips', /<td class="num up">\+12\.4%<\/td>/.test(html) && /<td class="num down">-3\.0%<\/td>/.test(html) && /<span class="aiw-lv" data-k="high">High<\/span>/.test(html) && /<span class="aiw-lv" data-k="lvl-low">Low<\/span>/.test(html));
ok('render: tables are keyboard-scrollable regions', /class="aiw-md-table" role="region" tabindex="0"/.test(html));
{
  const lists = R.md('1. First **one**\n2. Second\n\n- bullet *a*\n- bullet b');
  ok('render: numbered list is an <ol>, bullets a <ul>, never nested or split by <br>', /<ol><li>First <strong>one<\/strong><\/li><li>Second<\/li><\/ol>/.test(lists) && /<ul><li>bullet <em>a<\/em><\/li><li>bullet b<\/li><\/ul>/.test(lists) && !/<ol><ul>/.test(lists));
  const code = R.md('```python\n# comment\n## not a heading\n- not a list\nx = **1**\n```\n\nAfter');
  ok('render: code blocks are left alone (no headings, lists or bold inside)', /<pre><code># comment\n## not a heading\n- not a list\nx = \*\*1\*\*<\/code><\/pre>/.test(code) && !/aiw-h/.test(code) && /After/.test(code));
  const evil = R.md('> **Risk:** <img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://example.com)\n\n## <script>alert(1)</script>');
  ok('render: model output is still escaped (callouts, headings, javascript: links)', !/<img|<script/.test(evil) && /&lt;img/.test(evil) && !/href="javascript/.test(evil) && /href="https:\/\/example.com"/.test(evil));
  ok('render: an ordinary quote without a known label stays a blockquote', /<blockquote>just a quote<\/blockquote>/.test(R.md('> just a quote')) && !/aiw-callout/.test(R.md('> **Random:** thing')));
  ok('render: live Odoo answers still drop model-authored kpi/chart blocks', !/ai-chart|ai-kpi/.test(R.md('```kpi\nSales: 1 | +2%\n```\n```chart\nA\nX: 5\nY: 3\n```', true)));
  win.DVAITemplate = null;
  const bare = R.md('## Heading\n> **Risk:** x\n- a');
  ok('render: without the template module it still renders (plain h2, blockquote, list)', /<h2 class="aiw-h">Heading<\/h2>/.test(bare) && /<blockquote>/.test(bare) && /<ul><li>a<\/li><\/ul>/.test(bare));
  win.DVAITemplate = T;
}

/* ── agent prompt wiring (js/ai-odoo-agent.js) ── */
(async () => {
  function makeEnv(withTemplate) {
    const calls = { llm: [] };
    const w = {
      location: { origin: 'https://me.github.io' },
      DVOdoo: { getConfig: () => ({ proxyUrl: 'https://w.workers.dev', url: 'https://x.odoo.com', db: 'x', user: 'u', apiKey: 'k' }),
        rpc: (ep) => ep === 'diagnose' ? Promise.resolve({ ok: true, stage: 'access', version: '18.0', latencyMs: 300, currency: 'PKR', company: 'Acme', areas: { Sales: { model: 'sale.order', status: 'ok', records: 12 } } })
          : Promise.resolve({ ok: true, results: { q1: { ok: true, op: 'read-group', model: 'sale.order', groups: [{ partner_id: [1, 'Acme'], __count: 3, amount_total: 9000 }] } } }) },
      DVAIConfig: { callAI: (m, s) => { calls.llm.push({ sys: s }); return Promise.resolve(calls.llm.length === 1 ? JSON.stringify({ queries: [{ id: 'q1', op: 'read-group', model: 'sale.order', domain: [], groupby: ['partner_id'], measures: ['amount_total:sum'], limit: 3 }] }) : 'Bottom line. Confidence: High — ok'); } },
      DVAICompanyContext: { build: () => Promise.resolve('') }
    };
    if (withTemplate) w.DVAITemplate = T;
    new Function('window', 'location', fs.readFileSync(path.join(root, 'js', 'ai-odoo-agent.js'), 'utf8'))(w, w.location);
    return { A: w.DVOdooAgent, calls };
  }
  {
    const { A, calls } = makeEnv(true);
    const r = await A.askDetailed('top 10 customers by revenue this year', [{ role: 'user', content: 'top 10 customers by revenue this year' }], { systemPrompt: 'BASE' });
    ok('agent: planner is told which report skill applies', /REPORT SKILL: Sales performance/.test(calls.llm[0].sys));
    ok('agent: answer prompt carries the response template and the selected skill', /RESPONSE TEMPLATE/.test(calls.llm[1].sys) && /## Recommended actions/.test(calls.llm[1].sys) && /REPORT SKILL SELECTED: Sales performance/.test(calls.llm[1].sys));
    ok('agent: the old analysis headings and rules are still present', /"Root causes \/ contributors"/.test(calls.llm[1].sys) && /never say you lack access/i.test(calls.llm[1].sys) && /Follow-ups: first question/.test(calls.llm[1].sys));
    ok('agent: result tells the chat which skill was used (plain, storable object)', r.skill && r.skill.id === 'sales' && r.skill.title === 'Sales performance' && JSON.stringify(r.skill) === '{"id":"sales","title":"Sales performance"}');
  }
  {
    const { A, calls } = makeEnv(false);
    const r = await A.askDetailed('top customers?', [{ role: 'user', content: 'top customers?' }], { systemPrompt: 'BASE' });
    ok('agent: without the template module it behaves as before (no template, no skill)', !/RESPONSE TEMPLATE/.test(calls.llm[1].sys) && !/REPORT SKILL/.test(calls.llm[0].sys) && r.skill === null);
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
