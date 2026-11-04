/* DashView AI — response template + reporting skills (single source of truth).
 *
 * Used by:
 *   js/ai-odoo-agent.js        answer prompt (live Odoo answers) + planner hint
 *   js/ai-company-context.js   answer instructions (context-only answers)
 *   js/ai-embed.js             chat view: callouts, section headings, confidence / assumptions footer, PDF export
 *   ai-service/app/prompt.py   mirrors the same template for the Python service (keep wording in sync)
 *
 * Nothing here touches the network or the DOM, so it is unit tested in Node (test/ai-template.smoke.test.js).
 * The template is plain Markdown on purpose: a page that does not know this module still renders it sensibly.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DVAITemplate = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var VERSION = 1;

  /* ── 1. Reporting skills ─────────────────────────────────────────────────
     A skill = what a good report on one business area must contain. The first matching skill (in this order)
     is added to the answer prompt and shown as a tag on the message. */
  var SKILLS = [
    { id: 'exceptions', title: 'Exceptions & data quality',
      match: /\b(errors?|mistakes?|issues?|problems?|glitch(es)?|what'?s wrong|anomal(y|ies)|data quality|duplicates?|inconsisten\w*|galat|ghalat|ghaltiyan|masla|masail)\b/i,
      focus: 'every flagged item with real record names and counts, written as Issue / Why it matters / Fix, and which areas were checked and came back clean',
      watch: 'posted invoices without a partner, negative or impossible stock, orders stuck in draft for weeks, deliveries past their date, duplicate partners or SKUs, zero-price products',
      plan: 'stuck or very old documents (draft, not done), deliveries scheduled before today, negative stock, duplicates; count each one',
      owner: 'the person who owns that document type (sales rep, warehouse, accounts)',
      example: 'Where are the mistakes or stuck items in my Odoo data?' },
    { id: 'executive', title: 'Executive / board summary',
      match: /\b(board|executive|ceo|cfo|full (company )?report|company report|how is (the )?(business|company)|business (kaisa|kesa|kaisi)|overall|summar(y|ise|ize) (of )?everything|poori report|pura report|saari report)\b/i,
      focus: 'one headline per area (sales, receivables, pipeline, stock, purchasing, people) with its change vs the previous comparable period, then the three biggest risks and the three highest-value actions',
      watch: 'customer or product concentration, receivables ageing, pipeline that is stuck, stock-outs, overdue vendor bills',
      plan: 'revenue trend by month, top customers, open pipeline and quotations, overdue receivables, purchases, stock, and what is stuck',
      owner: 'a named role (CEO, finance lead, sales lead, warehouse lead)',
      example: 'Give me a board-ready company report for this month' },
    { id: 'comparison', title: 'Period comparison & trend',
      match: /\b(compare[ds]?|comparison|growth|trend|forecast|projection|momentum|farq|barh[ai]|ghat[ai]|izafa|agay|next (month|quarter|year)|versus|vs\.?\s+(last|previous|prior|pichle|pehle)|compared (to|with))\b/i,
      focus: 'current value vs the like-for-like previous period (absolute and % change), the biggest movers with their share of the change, the direction over recent months, and any projection clearly labelled as an estimate',
      watch: 'to-date periods compared on the same elapsed days, one-off spikes, mixed currencies, periods with no data',
      plan: 'the metric for the current and the previous comparable period, grouped by the dimension asked, plus a monthly trend',
      owner: 'the owner of the metric that moved',
      example: 'Sales this month vs last month, by salesperson' },
    { id: 'people', title: 'People & workforce',
      match: /\b(headcount|employees?|staff|attendance|leaves?|time off|applicants?|recruit\w*|hiring|payroll|expenses?|interviews?|cvs?|job positions?)\b/i,
      focus: 'headcount by department, joiners and leavers in the period, leave and time-off load, open positions and applicants per stage, expenses waiting for approval',
      watch: 'many people off at the same time in one department, applicants stuck at one stage, expenses pending more than 14 days',
      plan: 'employees by department, leaves in the period, applicants by stage, expenses by state',
      owner: 'the HR lead or the department manager',
      example: 'Headcount by department and who is on time off this week' },
    { id: 'purchasing', title: 'Purchasing & payables',
      match: /\b(purchas(e|es|ing)|vendors?|suppliers?|payables?|vendor bills?|bills?|khareed|rfqs?)\b/i,
      focus: 'spend by vendor with share of total, orders by stage, bills due in the next 14 days vs already overdue, and receipts that are still waiting',
      watch: 'vendor concentration, overdue bills, orders waiting for approval, receipts late against the planned date',
      plan: 'purchase orders by vendor and stage for the period, unpaid vendor bills by due date, pending receipts',
      owner: 'purchasing lead or accounts payable',
      example: 'Top vendors by spend this quarter and bills due in 14 days' },
    { id: 'receivables', title: 'Receivables & cash',
      match: /\b(receivables?|overdue|ag(e)?ing|collections?|outstanding|unpaid|dues?|cash (flow|in|out)|udhaar|wasooli|baqaya|baqiya)\b/i,
      focus: 'total open and overdue, overdue as a share of open, ageing buckets (not due, 1-30, 31-60, 61-90, 90+ days), top debtors with their share, and the oldest unpaid items',
      watch: 'top-debtor concentration, items older than 90 days, partial payments, mixed currencies',
      plan: 'open and overdue customer invoices grouped by customer, ageing by due date, payments received in the period',
      owner: 'accounts receivable or the account manager of that customer',
      example: 'Receivables aging by customer with the top 5 debtors' },
    { id: 'pipeline', title: 'CRM pipeline',
      match: /\b(pipeline|leads?|opportunit(y|ies)|crm|won|lost|conversion|win rate|funnel|stages?)\b/i,
      focus: 'open value and count by stage, expected revenue, won vs lost for the period, deals whose deadline has passed, and the oldest deal per stage',
      watch: 'deals stuck in one stage, passed deadlines, value concentrated in a few deals, leads without an owner',
      plan: 'opportunities by stage with expected revenue, won and lost in the period, deadlines before today',
      owner: 'the salesperson who owns the deal, or the sales lead',
      example: 'Pipeline by stage with expected revenue and stuck deals' },
    { id: 'inventory', title: 'Inventory & supply',
      match: /\b(stock|inventory|reorder\w*|warehouses?|locations?|deliver(y|ies)|shipments?|transfers?|maal|godown|backorders?)\b/i,
      focus: 'stock on hand by product and location, items below reorder level or negative, late or waiting transfers (scheduled before today and not done) and what blocks them',
      watch: 'negative stock, late deliveries, dead stock, purchase orders waiting for receipt',
      plan: 'stock quantity by product and location, transfers not done with a past scheduled date, products below minimum',
      owner: 'the warehouse lead or purchasing',
      example: 'Low stock products and late deliveries' },
    { id: 'sales', title: 'Sales performance',
      match: /\b(sales?|revenue|bikri|orders?|quotations?|customers?|salesperson|products? sold|invoiced|billed|turnover)\b/i,
      focus: 'total for the period with its change vs the previous period, top customers and products with share of total, the split by salesperson, open quotations and their age, and invoiced vs confirmed if they differ',
      watch: 'top-customer concentration, quotations older than 30 days, heavy discounts, confirmed vs invoiced definitions',
      plan: 'confirmed sales by month, by customer, by product and by salesperson, plus open quotations',
      owner: 'the salesperson or sales lead',
      example: 'Top 10 customers by revenue this year with share of total' }
  ];

  function detectSkill(text) {
    var t = String(text == null ? '' : text);
    if (!t.trim()) return null;
    for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].match.test(t)) return SKILLS[i];
    return null;
  }
  function skillById(id) { for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].id === id) return SKILLS[i]; return null; }
  function skillPrompt(skill) {
    if (!skill) return '';
    return 'REPORT SKILL SELECTED: ' + skill.title + '\n' +
      '- A complete answer covers: ' + skill.focus + '.\n' +
      '- Look for (and name, with numbers, if present): ' + skill.watch + '.\n' +
      '- Recommended actions must name a real customer / product / stage / document and a suggested owner, e.g. ' + skill.owner + '.\n' +
      '- If the user only asked for one number or a plain list, answer that briefly and ignore this skill.';
  }
  function planHint(skill) { return skill ? 'REPORT SKILL: ' + skill.title + ' - for a report-style question also read: ' + skill.plan + '.' : ''; }
  function skillCatalogue() {
    return SKILLS.map(function (s) { return '- ' + s.title + ': ' + s.focus + '.'; }).join('\n');
  }

  /* ── 2. The response template (the prompt) ───────────────────────────────── */
  var DEPTH_AND_TEMPLATE =
    'RESPONSE TEMPLATE (the DashView standard - every answer follows it)\n' +
    'Pick the depth from the question, never from how much data you have:\n' +
    '- LOOKUP (one number, yes/no, a plain list): 1-3 sentences, or one table for a list. No headings, no confidence line.\n' +
    '- BRIEF (a comparison, a breakdown, "how is X"): the Bottom line, one table, 2-3 insight bullets and one next step.\n' +
    '- REPORT ("report", "analysis", "board", "detail mein", "full picture", "strategy"): the full template below.\n\n' +
    'FULL TEMPLATE - use these exact English headings in this order and skip a section only when no data backs it (write the text under them in the user\'s language):\n' +
    '> **Bottom line:** one sentence that answers the question with the number, the exact period and the change vs the previous comparable period.\n' +
    '## Key figures\n' +
    'A table: Metric | Value | vs previous period | Note.\n' +
    '## What changed\n' +
    'The movers, each with amount, share of the total and direction. Facts only.\n' +
    '## Key insights\n' +
    '3-5 bullets. Each = the finding + the number that proves it + why it matters. Start a bullet with "Inferred:" when it is your reading and not a returned number.\n' +
    '## Risks and watch-list\n' +
    'Concentration (share of the largest customer or product), ageing / overdue days, stuck stages, negative stock, data gaps. Only items that exist in the data.\n' +
    '## Recommended actions\n' +
    'A table: Priority | Action | Evidence | Impact | Effort | Owner. Priority is High / Medium / Low, ranked; Effort is Low / Medium / High; every action names a customer, product, stage or document.\n' +
    'Assumptions: one line - metric definition used, exact period (from to), currency, and what was inferred.\n' +
    'Confidence: High|Medium|Low - one-line reason (High = every figure from verified metrics or complete query results; Medium = some ad-hoc or sampled; Low = partial data or permission gaps).\n\n' +
    'CALLOUTS: for something the reader must not miss, use a one-line quote with a bold label - "> **Risk:** ...", "> **Action:** ...", "> **Insight:** ...", "> **Note:** ...". At most 3 per answer; never repeat the same point in a callout and in a bullet.\n\n' +
    'STYLE\n' +
    '- Numbers: thousands separators (1,250,000); currency written once as a code (PKR 1.2M); changes with a sign and one decimal (+12.4%, -3.0%); dates like 12 Oct 2026 and ranges like 1 Oct - 31 Oct 2026.\n' +
    '- Tables: at most 7 columns, units in the header, largest first, and "showing N of total" whenever rows are cut. Never pad a table with empty or invented rows.\n' +
    '- Separate FACTS (returned data) from INFERENCE (your reading) and label inference "Inferred:". A number without a comparison is not an insight.\n' +
    '- No filler ("Great question", "I hope this helps"), no emojis, no repeating the question, no restating a point already made in another section. Merge sections that would only repeat each other.\n' +
    '- Length: BRIEF under ~200 words outside tables; REPORT under ~450 words outside tables.';

  var VISUALS_ON =
    '\nVISUALS: you may add up to 4 KPI cards (a ```kpi block, one "Label: value | change" line per card, change starts with + or -) after the Bottom line, and one ```chart block per key view (plain numbers only, 2-8 rows, "type: line" for a trend, "type: donut" for a share of total). Only real figures from the data.';
  var VISUALS_OFF =
    '\nVISUALS: do not write ```kpi, ```chart or dashboard JSON - the interface builds the visuals from the returned rows. Put the headline numbers in the Key figures table.';

  function promptFor(opts) {
    opts = opts || {};
    return DEPTH_AND_TEMPLATE + (opts.visuals ? VISUALS_ON : VISUALS_OFF) +
      (opts.catalogue ? '\n\nREPORTING SKILLS (what a complete report covers per area):\n' + skillCatalogue() : '');
  }

  /* ── 3. Rendering helpers (used by the chat view) ─────────────────────────── */
  var HEADING_RULES = [
    ['figures', /^(((key )?(figures|numbers|kpis?|headline numbers))|data|summary)$/i],
    ['changes', /^(what changed|movers|changes|trend|comparison|progress|what(?:'s| is) in progress)$/i],
    ['insights', /^(key )?(insights?|findings|observations|read-?out)$/i],
    ['evidence', /^(evidence|root causes?\b.*|contributors)$/i],
    ['tradeoffs', /^trade-?offs?$/i],
    ['risks', /^(risks?\b.*|watch-?list|exceptions|.*issues found)$/i],
    ['actions', /^(recommended\b.*|best approach\b.*|next steps?|improvement opportunities|actions?)$/i],
    ['method', /^(assumptions?\b.*|method\b.*|confidence\b.*|limitations|definitions)$/i]
  ];
  function classifyHeading(title) {
    var t = String(title == null ? '' : title).replace(/[*_`]/g, '').replace(/^[\s\d.)(a-z]{1,3}[.)]\s+(?=[A-Z])/, '').trim();
    for (var i = 0; i < HEADING_RULES.length; i++) if (HEADING_RULES[i][1].test(t)) return HEADING_RULES[i][0];
    return '';
  }

  var CALLOUT_KINDS = {
    'bottom line': 'headline', 'headline': 'headline', 'answer': 'headline', 'summary': 'headline',
    'insight': 'insight', 'key insight': 'insight', 'finding': 'insight',
    'risk': 'risk', 'warning': 'risk', 'watch': 'risk', 'watch-list': 'risk', 'alert': 'risk',
    'action': 'action', 'next step': 'action', 'recommendation': 'action', 'recommended action': 'action',
    'note': 'note', 'assumption': 'note', 'inferred': 'note', 'caveat': 'note'
  };
  function calloutKind(label) { return CALLOUT_KINDS[String(label || '').toLowerCase().replace(/[\s:]+$/, '')] || ''; }

  var CHIPS = {
    high: 'high', critical: 'high', 'at risk': 'high', blocked: 'high', overdue: 'high',
    medium: 'mid', slowing: 'mid', watch: 'mid', partial: 'mid',
    low: 'low', healthy: 'low', 'on track': 'low', done: 'low', paid: 'low'
  };
  function chipKind(cell) { return CHIPS[String(cell || '').trim().toLowerCase()] || ''; }

  /* "Confidence:", "Assumptions:" and the agent's "*Live Odoo · ...*" footer become a structured footer instead of body text. */
  function extract(text) {
    var body = String(text == null ? '' : text), out = { body: body, confidence: null, assumptions: '', source: '' };
    body = body.replace(/\n*\*Live Odoo [^\n*]*\*[ \t]*$/i, function (m) { out.source = m.replace(/[*\n]/g, '').trim(); return ''; });
    body = body.replace(/^[ \t]*[*_]{0,2}Confidence[*_]{0,2}[ \t]*:[*_]{0,2}[ \t]*(High|Medium|Low)\b[ \t]*[-\u2014\u2013:]?[ \t]*(.*)$/gim, function (_, level, reason) {
      if (!out.confidence) out.confidence = { level: level.charAt(0).toUpperCase() + level.slice(1).toLowerCase(), reason: String(reason || '').replace(/[*_]+$/, '').trim() };
      return '';
    });
    body = body.replace(/^[ \t]*[*_]{0,2}Assumptions?[*_]{0,2}[ \t]*:[*_]{0,2}[ \t]*(\S.*)$/gim, function (_, line) {
      out.assumptions = out.assumptions ? out.assumptions + ' ' + line.trim() : line.trim();
      return '';
    });
    out.body = body.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
    return out;
  }

  function stats(text) {
    var t = String(text == null ? '' : text), h = t.match(/^##\s+\S/gm) || [];
    return { sections: h.length, words: (t.match(/\S+/g) || []).length, tables: (t.match(/^\|[\s:|-]+\|[ \t]*$/gm) || []).length, isReport: h.length >= 3 };
  }
  function headings(text) {
    var out = [], re = /^##\s+(.+?)\s*$/gm, m;
    while ((m = re.exec(String(text == null ? '' : text)))) out.push(m[1].replace(/[*_`]/g, '').trim());
    return out;
  }

  /* ── 4. Chat answer -> report payload (PDF export of any answer) ───────────── */
  function parseNumber(s) {
    var t = String(s == null ? '' : s).replace(/[\u2212\u2013]/g, '-').trim();
    var m = t.match(/^(?:[A-Za-z]{2,4}\.?\s*|[$\u20ac\u00a3\u20b9]\s*)?([+-]?\d[\d,]*\.?\d*)\s*([KMBT])?\s*%?$/i);
    if (!m) return null;
    var n = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(n)) return null;
    var mul = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1;
    return n * mul;
  }
  function tablesOf(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/), out = [], i = 0;
    function cells(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.replace(/[*_`]/g, '').trim(); }); }
    while (i < lines.length) {
      if (/^\s*\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
        var head = cells(lines[i]), rows = []; i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push({ head: head, rows: rows });
      } else i++;
    }
    return out;
  }
  function sectionsOf(text) {
    var parts = String(text == null ? '' : text).split(/^##\s+/m), out = [];
    if (parts[0].trim()) out.push({ title: '', key: '', body: parts[0] });
    for (var i = 1; i < parts.length; i++) {
      var nl = parts[i].indexOf('\n'), title = (nl < 0 ? parts[i] : parts[i].slice(0, nl)).replace(/[*_`]/g, '').trim();
      out.push({ title: title, key: classifyHeading(title), body: nl < 0 ? '' : parts[i].slice(nl + 1) });
    }
    return out;
  }
  function plainText(md) {
    return String(md || '').replace(/^\s*\|.*\|\s*$/gm, '').replace(/```[\s\S]*?```/g, '').replace(/^>\s?/gm, '').replace(/^#{1,6}\s*/gm, '')
      .replace(/^[\-*]\s+/gm, '\u2022 ').replace(/[*_`]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function toReportPayload(content, opts) {
    opts = opts || {};
    var parts = extract(content), secs = sectionsOf(parts.body), kpis = [], metrics = [], nextSteps = [], insights = [];
    var head = (parts.body.match(/^>\s*\*\*(?:Bottom line|Headline|Answer)[:\s]*\*\*\s*:?\s*(.+)$/im) || [])[1] || '';
    if (head) insights.push(plainText(head));
    secs.forEach(function (s) {
      var tbs = tablesOf(s.body);
      if (s.key === 'figures' && tbs[0]) {
        tbs[0].rows.slice(0, 6).forEach(function (r) {
          if (r[0] && r[1]) kpis.push({ label: r[0], value: r[1], change: /^[+\-\u2212\u25b2\u25bc]/.test(r[2] || '') ? r[2] : '', hint: r[3] || (r[2] && !/^[+\-\u2212\u25b2\u25bc]/.test(r[2]) ? r[2] : '') });
        });
      } else if (s.key === 'actions') {
        var t = tbs[0];
        if (t) {
          var ia = Math.max(0, t.head.findIndex(function (h) { return /action/i.test(h); })), ip = t.head.findIndex(function (h) { return /priority/i.test(h); }), iw = t.head.findIndex(function (h) { return /evidence|why|impact/i.test(h); });
          t.rows.slice(0, 10).forEach(function (r) { if (r[ia]) nextSteps.push({ action: r[ia], priority: ip >= 0 ? r[ip] : '', why: iw >= 0 ? r[iw] : '' }); });
        } else plainText(s.body).split('\n').forEach(function (l) { l = l.replace(/^\u2022\s*/, '').trim(); if (l && nextSteps.length < 10) nextSteps.push({ action: l }); });
      } else {
        tbs.forEach(function (tb) {
          if (metrics.length >= 3) return;
          var col = -1, c, rows;
          for (c = 1; c < tb.head.length && col < 0; c++) { var ok = tb.rows.filter(function (r) { return parseNumber(r[c]) != null; }).length; if (ok >= 2 && ok >= tb.rows.length / 2) col = c; }
          if (col < 0) return;
          rows = tb.rows.filter(function (r) { return r[0] && parseNumber(r[col]) != null; }).slice(0, 24).map(function (r) { return { label: r[0], value: parseNumber(r[col]) }; });
          if (rows.length >= 2) metrics.push({ title: s.title || tb.head[col], measure: tb.head[col], chartType: /month|week|date|day|quarter|year|trend/i.test(tb.head[0] + ' ' + s.title) ? 'line' : 'bar', rows: rows });
        });
        if (s.key === 'insights' || s.key === 'changes' || s.key === 'risks' || s.key === 'evidence' || s.key === 'tradeoffs') {
          var txt = plainText(s.body); if (txt) insights.push((s.title ? s.title + '\n' : '') + txt);
        }
      }
    });
    if (!insights.length) { var all = plainText(parts.body); if (all) insights.push(all.slice(0, 3000)); }
    var limits = [];
    if (parts.confidence) limits.push('Confidence: ' + parts.confidence.level + (parts.confidence.reason ? ' - ' + parts.confidence.reason : ''));
    limits.push('Figures are taken from the assistant\'s written answer; open "Path & drill" on the message for the exact records behind them.');
    return {
      version: 1,
      title: String(opts.title || 'DashView report').slice(0, 120),
      generatedAt: opts.time ? new Date(opts.time) : new Date(),
      source: opts.source || parts.source || 'DashView AI assistant answer',
      kpis: kpis, metrics: metrics, nextSteps: nextSteps,
      insightsText: insights.join('\n\n').slice(0, 6000),
      methods: parts.assumptions ? [parts.assumptions] : [], limitations: limits, quality: []
    };
  }


  /* ── 5. Computed insights for charts (exact, calculated by code from returned rows) ──────────────── */
  function fmtCompact(v) {
    v = Number(v); if (!isFinite(v)) return '';
    var a = Math.abs(v), sign = v < 0 ? '-' : '', u = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e4 ? [1e3, 'K'] : null;
    function trim(t) { return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/\.$/, '') : t; }
    if (u) { var x = a / u[0]; return sign + trim(x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + u[1]; }
    return sign + (Math.abs(a - Math.round(a)) < 0.005 ? Math.round(a).toLocaleString('en-US') : trim(a.toFixed(2)));
  }
  function pct1(x) { return (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%'; }
  function isSeries(m) { return !!m && (m.chartType === 'line' || /(^|\W)(date|month|week|day|quarter|year)/i.test((m.groupBy || []).join(' '))); }
  function isMoney(m) { return /amount|total|revenue|price|cost|balance|residual|untaxed|expected|subtotal/i.test(String((m && m.measure) || '')); }
  function lowerIsBetter(m) { return /overdue|residual|unpaid|late|cancel|refund|due|backlog|lost/i.test(String((m && (m.title + ' ' + m.measure)) || '')); }

  /* Returns { series, additive, total, shares[], insights[{tone,text,ri?}] } or null (fewer than 2 numeric rows). */
  function analyzeMetric(m) {
    var rows = ((m && m.rows) || []).map(function (r, i) { return { i: i, label: String(r.label == null ? '' : r.label), v: Number(r.value) }; }).filter(function (r) { return isFinite(r.v); });
    if (rows.length < 2) return null;
    var series = isSeries(m), additive = !/:(avg|min|max)\b|average|percent|rate|ratio/i.test(String((m && m.measure) || '')), allPos = rows.every(function (r) { return r.v >= 0; });
    var total = rows.reduce(function (a, r) { return a + r.v; }, 0), canShare = additive && allPos && total > 0 && !series;
    var out = { series: series, additive: additive, total: total, shares: rows.map(function (r) { return canShare ? r.v / total * 100 : null; }), insights: [] }, ins = out.insights, n = rows.length;
    if (series && n >= 3) {
      var last = rows[n - 1], prev = rows[n - 2], good = lowerIsBetter(m) ? -1 : 1;
      if (prev.v !== 0) { var ch = (last.v - prev.v) / Math.abs(prev.v) * 100; if (Math.abs(ch) >= 0.05) ins.push({ tone: ch * good > 0 ? 'good' : 'warn', ri: last.i, text: last.label + ' is ' + (ch > 0 ? '+' : '-') + pct1(Math.abs(ch)) + ' vs ' + prev.label + ' (' + fmtCompact(last.v) + ' vs ' + fmtCompact(prev.v) + ')' }); }
      var a3 = rows.slice(-3).map(function (r) { return r.v; });
      if (n >= 4 && a3[0] < a3[1] && a3[1] < a3[2]) ins.push({ tone: good > 0 ? 'good' : 'warn', text: 'Rising for 3 periods in a row' });
      else if (n >= 4 && a3[0] > a3[1] && a3[1] > a3[2]) ins.push({ tone: good > 0 ? 'warn' : 'good', text: 'Falling for 3 periods in a row' });
      var hi = rows.reduce(function (b, r) { return r.v > b.v ? r : b; }, rows[0]), lo = rows.reduce(function (b, r) { return r.v < b.v ? r : b; }, rows[0]);
      if (hi.v !== lo.v) { ins.push({ tone: 'neutral', ri: hi.i, text: 'Peak: ' + hi.label + ' (' + fmtCompact(hi.v) + ')' }); ins.push({ tone: 'neutral', ri: lo.i, text: 'Lowest: ' + lo.label + ' (' + fmtCompact(lo.v) + ')' }); }
      var avg = total / n; if (avg !== 0 && n >= 4) { var da = (last.v - avg) / Math.abs(avg) * 100; if (Math.abs(da) >= 5) ins.push({ tone: da * good > 0 ? 'good' : 'warn', text: 'Latest is ' + pct1(Math.abs(da)) + (da > 0 ? ' above' : ' below') + ' the period average (' + fmtCompact(avg) + ')' }); }
    } else if (canShare) {
      var sorted = rows.slice().sort(function (a, b) { return b.v - a.v; }), t1 = sorted[0], s1 = t1.v / total * 100;
      ins.push({ tone: s1 >= 40 ? 'warn' : 'neutral', ri: t1.i, text: t1.label + ' is ' + pct1(s1) + ' of the total (' + fmtCompact(t1.v) + ' of ' + fmtCompact(total) + ')' });
      if (n >= 4) { var s3 = (sorted[0].v + sorted[1].v + sorted[2].v) / total * 100; ins.push({ tone: s3 >= 80 ? 'warn' : 'neutral', text: 'Top 3 = ' + pct1(s3) + ' of the total' }); }
      var med = sorted[Math.floor(n / 2)].v;
      if (n >= 5 && med > 0 && t1.v >= 3 * med) ins.push({ tone: 'warn', ri: t1.i, text: t1.label + ' is ' + (Math.round(t1.v / med * 10) / 10) + 'x the median row' });
      if (n >= 8) { var tail = sorted.slice(Math.ceil(n / 2)).reduce(function (a, r) { return a + r.v; }, 0) / total * 100; ins.push({ tone: 'neutral', text: 'The smaller half (' + Math.floor(n / 2) + ' rows) adds only ' + pct1(tail) }); }
    } else {
      var mx = rows.reduce(function (b, r) { return r.v > b.v ? r : b; }, rows[0]), mn = rows.reduce(function (b, r) { return r.v < b.v ? r : b; }, rows[0]);
      if (mx.v !== mn.v) { ins.push({ tone: 'neutral', ri: mx.i, text: 'Highest: ' + mx.label + ' (' + fmtCompact(mx.v) + ')' }); ins.push({ tone: 'neutral', ri: mn.i, text: 'Lowest: ' + mn.label + ' (' + fmtCompact(mn.v) + ')' }); }
    }
    out.insights = ins.slice(0, 4);
    return out;
  }
  /* A block for the answer prompt: the same findings the chart shows, so the written insights quote exact code-calculated numbers. */
  function findingsText(payload) {
    var lines = [];
    ((payload && payload.metrics) || []).slice(0, 5).forEach(function (m) {
      var a = analyzeMetric(m); if (a && a.insights.length) lines.push('- ' + (m.title || 'metric') + ' (' + (m.rows || []).length + ' rows' + (a.additive && !a.series ? ', total ' + fmtCompact(a.total) : '') + '): ' + a.insights.map(function (x) { return x.text; }).join('; '));
    });
    return lines.join('\n');
  }

  /* ── 6. Deeper analytics: profile (KPIs, Pareto, concentration, trend), prioritised findings, AI-insight prompt + safe parsing ── */
  function numRows(m) {
    return ((m && m.rows) || []).map(function (r, i) { return { i: i, label: String(r && r.label != null ? r.label : ''), v: Number(r && r.value), count: r && r.count }; }).filter(function (r) { return isFinite(r.v); });
  }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }
  function regress(ys) {
    var n = ys.length, sx = 0, sy = 0, sxy = 0, sxx = 0, i;
    for (i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
    var den = n * sxx - sx * sx, slope = den ? (n * sxy - sx * sy) / den : 0, icpt = (sy - slope * sx) / n, my = sy / n, ssT = 0, ssR = 0;
    for (i = 0; i < n; i++) { ssT += Math.pow(ys[i] - my, 2); ssR += Math.pow(ys[i] - (icpt + slope * i), 2); }
    return { slope: slope, intercept: icpt, r2: ssT ? Math.max(0, 1 - ssR / ssT) : 0 };
  }
  function clipTxt(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function signedPct(x) { return (x > 0 ? '+' : x < 0 ? '-' : '') + pct1(Math.abs(x)); }
  function hhiLevel(h) { return h >= 2500 ? 'High' : h >= 1500 ? 'Moderate' : 'Low'; }

  /* Everything the board needs to show a metric at a glance. Pure maths on the returned rows - nothing is estimated except the clearly-labelled straight-line next value. */
  function profileMetric(m) {
    var rows = numRows(m); if (rows.length < 2) return null;
    var base = analyzeMetric(m), n = rows.length, vals = rows.map(function (r) { return r.v; });
    var total = vals.reduce(function (a, b) { return a + b; }, 0), mean = total / n, med = median(vals);
    var sd = Math.sqrt(vals.reduce(function (a, v) { return a + Math.pow(v - mean, 2); }, 0) / n), cv = mean ? sd / Math.abs(mean) : 0;
    var series = base.series, additive = base.additive, good = lowerIsBetter(m) ? -1 : 1;
    var hi = rows.reduce(function (b, r) { return r.v > b.v ? r : b; }, rows[0]), lo = rows.reduce(function (b, r) { return r.v < b.v ? r : b; }, rows[0]);
    var p = { n: n, series: series, additive: additive, total: total, mean: mean, median: med, sd: sd, cv: cv, hi: hi, lo: lo, rows: rows, kpis: [], pareto: null, hhi: null, trend: null, movers: [], ma: null, sorted: null, cum: null, base: base };
    function k(label, value, sub, tone, ri) { p.kpis.push({ k: label, v: value, sub: sub || '', tone: tone || 'neutral', ri: ri == null ? null : ri }); }
    if (series) {
      var last = rows[n - 1], prev = rows[n - 2], reg = regress(vals), ch = prev.v !== 0 ? (last.v - prev.v) / Math.abs(prev.v) * 100 : null;
      var steps = []; for (var i = 1; i < n; i++) if (rows[i - 1].v !== 0) steps.push({ i: rows[i].i, label: rows[i].label, prev: rows[i - 1].label, delta: rows[i].v - rows[i - 1].v, pct: (rows[i].v - rows[i - 1].v) / Math.abs(rows[i - 1].v) * 100 });
      var recent = steps.slice(-6), avgG = recent.length ? recent.reduce(function (a, s) { return a + s.pct; }, 0) / recent.length : null;
      p.movers = steps.slice().sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 3);
      p.ma = vals.map(function (v, j) { return j < 2 ? null : (vals[j] + vals[j - 1] + vals[j - 2]) / 3; });
      p.trend = { slope: reg.slope, intercept: reg.intercept, r2: reg.r2, avgGrowth: avgG, steps: steps, next: n >= 4 && reg.r2 >= 0.5 ? reg.intercept + reg.slope * n : null, good: good };
      k('Latest', fmtCompact(last.v), ch == null ? last.label : signedPct(ch) + ' vs ' + prev.label, ch == null ? 'neutral' : ch * good > 0 ? 'good' : 'warn', last.i);
      k('Average', fmtCompact(mean), n + ' periods');
      k('Peak', fmtCompact(hi.v), hi.label, 'neutral', hi.i);
      if (avgG != null) k('Trend', signedPct(avgG), 'avg per period, last ' + recent.length, avgG * good > 0 ? 'good' : Math.abs(avgG) < 0.5 ? 'neutral' : 'warn');
      k('Volatility', cv >= 0.4 ? 'High' : cv >= 0.15 ? 'Moderate' : 'Low', 'CV ' + (Math.round(cv * 100) / 100), cv >= 0.4 ? 'warn' : 'neutral');
      if (p.trend.next != null) k('Next (trend)', fmtCompact(p.trend.next), 'estimate, R\u00b2 ' + (Math.round(reg.r2 * 100) / 100), 'neutral');
    } else if (additive && vals.every(function (v) { return v >= 0; }) && total > 0) {
      var sorted = rows.slice().sort(function (a, b) { return b.v - a.v; }), acc = 0, n80 = 0, cum = sorted.map(function (r) { acc += r.v; return acc / total * 100; });
      for (var j = 0; j < cum.length; j++) { if (cum[j] >= 80 - 1e-9) { n80 = j + 1; break; } }
      var hh = sorted.reduce(function (a, r) { return a + Math.pow(r.v / total * 100, 2); }, 0);
      p.sorted = sorted; p.cum = cum; p.pareto = { n80: n80 || n, share: cum[(n80 || n) - 1] }; p.hhi = { value: hh, level: hhiLevel(hh) };
      var s1 = sorted[0].v / total * 100, s3 = n >= 3 ? (sorted[0].v + sorted[1].v + sorted[2].v) / total * 100 : 100;
      k('Total', fmtCompact(total), n + ' groups');
      k('Largest', clipTxt(sorted[0].label, 18), pct1(s1) + ' \u00b7 ' + fmtCompact(sorted[0].v), s1 >= 50 ? 'warn' : 'neutral', sorted[0].i);
      if (n >= 3) k('Top 3', pct1(s3), 'of the total', s3 >= 80 ? 'warn' : 'neutral');
      k('Concentration', p.hhi.level, 'HHI ' + Math.round(hh).toLocaleString('en-US'), p.hhi.level === 'High' ? 'warn' : p.hhi.level === 'Low' ? 'good' : 'neutral');
      if (n >= 4) k('80% comes from', p.pareto.n80 + ' of ' + n, pct1(p.pareto.n80 / n * 100) + ' of groups', p.pareto.n80 / n <= 0.25 ? 'warn' : 'neutral');
    } else {
      k('Average', fmtCompact(mean), n + ' rows');
      k('Highest', fmtCompact(hi.v), clipTxt(hi.label, 18), 'neutral', hi.i);
      k('Lowest', fmtCompact(lo.v), clipTxt(lo.label, 18), 'neutral', lo.i);
      k('Spread', lo.v > 0 ? (Math.round(hi.v / lo.v * 10) / 10) + 'x' : fmtCompact(hi.v - lo.v), lo.v > 0 ? 'highest / lowest' : 'highest - lowest');
    }
    return p;
  }

  var SEV_RANK = { high: 0, med: 1, low: 2 };
  /* Prioritised, plain-language findings with a one-line "why it matters". Every number comes straight from the rows. */
  function deepInsights(m, prof) {
    var p = prof || profileMetric(m); if (!p) return [];
    var out = [], n = p.n, good = lowerIsBetter(m) ? -1 : 1;
    function add(sev, tone, ri, title, text, why) { out.push({ sev: sev, tone: tone, ri: ri == null ? null : ri, title: title, text: text, why: why || '' }); }
    if (p.series) {
      var t = p.trend, rows = p.rows, last = rows[n - 1];
      if (t.avgGrowth != null && Math.abs(t.avgGrowth) >= 1) {
        var ups = t.steps.slice(-6).filter(function (s) { return s.delta > 0; }).length, tot = t.steps.slice(-6).length;
        add(Math.abs(t.avgGrowth) >= 10 ? 'high' : 'med', t.avgGrowth * good > 0 ? 'good' : 'warn', null, 'Momentum', 'Average change is ' + signedPct(t.avgGrowth) + ' per period over the last ' + tot + ' periods (' + ups + ' up, ' + (tot - ups) + ' down).', t.avgGrowth * good > 0 ? 'The direction is favourable; check it is not a one-off spike.' : 'The direction is unfavourable; find which records are driving it.');
      }
      if (t.steps.length >= 6) {
        var half = Math.floor(t.steps.length / 2), a = t.steps.slice(0, half), b = t.steps.slice(half), ga = a.reduce(function (x, s) { return x + s.pct; }, 0) / a.length, gb = b.reduce(function (x, s) { return x + s.pct; }, 0) / b.length;
        if (Math.abs(gb - ga) >= 3) add('med', (gb - ga) * good > 0 ? 'good' : 'warn', null, gb > ga ? 'Accelerating' : 'Slowing', 'Average change moved from ' + signedPct(ga) + ' per period (earlier half) to ' + signedPct(gb) + ' (recent half).', 'A change in pace often shows up before the total does.');
      }
      var mv = p.movers[0];
      if (mv && Math.abs(mv.pct) >= 5) add(Math.abs(mv.pct) >= 30 ? 'high' : 'med', mv.pct * good > 0 ? 'good' : 'warn', mv.i, 'Biggest swing', mv.label + ' moved ' + signedPct(mv.pct) + ' vs ' + mv.prev + ' (' + (mv.delta > 0 ? '+' : '-') + fmtCompact(Math.abs(mv.delta)) + ').', 'Open the records behind that period to see what changed.');
      if (p.cv >= 0.4) add('med', 'warn', null, 'Volatile', 'Periods swing a lot around the average of ' + fmtCompact(p.mean) + ' (variation ' + (Math.round(p.cv * 100) / 100) + ').', 'Plan on a range, not a single number.');
      else if (p.cv < 0.1 && n >= 4) add('low', 'good', null, 'Stable', 'Periods stay close to the average of ' + fmtCompact(p.mean) + '.', 'A steady base makes small changes easier to spot.');
      if (n >= 4 && p.hi.v > 0 && last.v < p.hi.v * 0.8 && p.hi.i !== last.i) add('med', good > 0 ? 'warn' : 'good', p.hi.i, 'Below the peak', 'Latest (' + fmtCompact(last.v) + ') is ' + pct1((1 - last.v / p.hi.v) * 100) + ' below the peak in ' + p.hi.label + ' (' + fmtCompact(p.hi.v) + ').', 'Shows how much room there is to recover \u2014 or to return to normal for overdue-type measures.');
      var bad = p.rows.filter(function (r) { return r.v <= 0; }).length;
      if (bad) add('med', 'warn', null, 'Zero or negative', bad + ' of ' + n + ' periods are zero or negative.', 'May be credits, reversals or periods with no activity.');
      if (t.next != null) add('low', 'neutral', null, 'Where the trend points', 'A straight line through these ' + n + ' periods reaches about ' + fmtCompact(t.next) + ' next period (fit R\u00b2 ' + (Math.round(t.r2 * 100) / 100) + ').', 'An estimate from these rows only \u2014 not a forecast.');
    } else if (p.pareto) {
      var s = p.sorted, tt = p.total, s1 = s[0].v / tt * 100;
      add(p.hhi.level === 'High' ? 'high' : p.hhi.level === 'Moderate' ? 'med' : 'low', p.hhi.level === 'High' ? 'warn' : p.hhi.level === 'Low' ? 'good' : 'neutral', null, 'Concentration ' + p.hhi.level.toLowerCase(), p.hhi.level === 'Low' ? 'The total is spread across many groups (HHI ' + Math.round(p.hhi.value).toLocaleString('en-US') + ').' : 'A few groups carry most of the total (HHI ' + Math.round(p.hhi.value).toLocaleString('en-US') + ').', p.hhi.level === 'Low' ? 'Losing any single group would hurt little.' : 'Losing or delaying one of the big groups would move the total.');
      if (n >= 4) add(p.pareto.n80 / n <= 0.25 ? 'med' : 'low', 'neutral', null, '80% rule', p.pareto.n80 + ' of ' + n + ' groups (' + pct1(p.pareto.n80 / n * 100) + ') make up ' + pct1(p.pareto.share) + ' of the total.', 'These are the groups worth managing one by one.');
      if (s1 >= 35) add(s1 >= 50 ? 'high' : 'med', 'warn', s[0].i, 'Depends on one group', s[0].label + ' alone is ' + pct1(s1) + ' of the total (' + fmtCompact(s[0].v) + ').', 'A single-group dependency is the first thing to de-risk.');
      if (n >= 2 && s[1].v > 0 && s[0].v / s[1].v >= 2) add('med', 'neutral', s[0].i, 'Clear leader', s[0].label + ' is ' + (Math.round(s[0].v / s[1].v * 10) / 10) + 'x the next group (' + s[1].label + ').', 'Look at what the leader does differently.');
      var tiny = s.filter(function (r) { return r.v / tt * 100 < 1; });
      if (n >= 8 && tiny.length >= 3) add('low', 'neutral', null, 'Long tail', tiny.length + ' groups are each under 1% and add only ' + pct1(tiny.reduce(function (a, r) { return a + r.v; }, 0) / tt * 100) + ' together.', 'Candidates to group, ignore or review.');
    } else if (p.additive && p.rows.some(function (r) { return r.v < 0; })) {
      var neg = p.rows.filter(function (r) { return r.v < 0; });
      add('med', 'warn', neg[0].i, 'Negative rows', neg.length + ' row' + (neg.length === 1 ? ' is' : 's are') + ' negative (' + fmtCompact(neg.reduce(function (a, r) { return a + r.v; }, 0)) + ' together), so shares are not shown.', 'Often credit notes, refunds or reversals.');
    } else {
      if (p.lo.v > 0 && p.hi.v / p.lo.v >= 2) add('med', 'neutral', p.hi.i, 'Wide spread', 'Highest (' + p.hi.label + ', ' + fmtCompact(p.hi.v) + ') is ' + (Math.round(p.hi.v / p.lo.v * 10) / 10) + 'x the lowest (' + p.lo.label + ', ' + fmtCompact(p.lo.v) + ').', 'Averages hide this \u2014 check what differs.');
      if (p.sd > 0) { var z = p.rows.filter(function (r) { return Math.abs(r.v - p.mean) / p.sd >= 2; }); if (z.length && n >= 5) add('low', 'neutral', z[0].i, 'Outlier', z[0].label + ' is ' + (Math.round(Math.abs(z[0].v - p.mean) / p.sd * 10) / 10) + ' standard deviations from the average (' + fmtCompact(p.mean) + ').', 'Confirm it is real and not a data issue.'); }
    }
    if (n >= 24) add('low', 'neutral', null, 'May be truncated', 'This chart holds ' + n + ' groups, the most it draws.', 'Ask for a narrower period or a filter to see the rest.');
    return out.sort(function (a, b) { return SEV_RANK[a.sev] - SEV_RANK[b.sev]; }).slice(0, 7);
  }
  function deepFindingsText(payload) {
    var lines = [];
    ((payload && payload.metrics) || []).slice(0, 5).forEach(function (m) {
      var p = profileMetric(m); if (!p) return;
      var d = deepInsights(m, p).slice(0, 5); if (!d.length) return;
      lines.push('- ' + (m.title || 'metric') + ': ' + d.map(function (x) { return '[' + x.sev.toUpperCase() + '] ' + x.text; }).join(' '));
    });
    return lines.join('\n');
  }

  /* ── AI insights for one chart: the model gets the exact rows + the code-calculated findings and must answer in strict JSON ── */
  function aiFacts(m, ctx) {
    var p = profileMetric(m); if (!p) return null;
    var tot = p.additive && !p.series ? p.total : null, an = p.base, rows = p.rows.slice(0, 30);
    var lines = rows.map(function (r, i) { var sh = an.shares[r.i]; return (i + 1) + '. ' + r.label + ' | ' + r.v + (r.count != null ? ' | ' + r.count + ' records' : '') + (sh != null ? ' | ' + (Math.round(sh * 10) / 10) + '%' : ''); }).join('\n');
    var kp = p.kpis.map(function (x) { return x.k + ': ' + x.v + (x.sub ? ' (' + x.sub + ')' : ''); }).join('; ');
    var find = deepInsights(m, p).map(function (x) { return '[' + x.sev.toUpperCase() + '] ' + x.text; }).join('\n');
    var text = 'CHART: ' + (m.title || 'metric') + '\nSOURCE: ' + (m.model || 'Odoo') + (m.groupBy && m.groupBy.length ? ' grouped by ' + m.groupBy.join(', ') : '') + '\nMEASURE: ' + (m.measure || 'value') + (ctx && ctx.currency ? ' (' + ctx.currency + ')' : '') + '\nKIND: ' + (p.series ? 'time series (rows are in time order)' : p.additive ? 'ranked groups, additive' : 'ranked groups, NOT additive (averages / rates)') +
      '\nROWS (label | value | records | share):\n' + lines + (tot != null ? '\nTOTAL: ' + tot : '') + '\nKEY FIGURES: ' + kp + '\nCALCULATED FINDINGS (exact):\n' + find + (ctx && ctx.question ? '\nTHE USER ASKED: ' + clipTxt(ctx.question, 300) : '');
    return { text: text, profile: p, labels: rows.map(function (r) { return r.label; }) };
  }
  var AI_SYSTEM = 'You are a senior business analyst writing for a CEO. You are given the exact rows of one chart built from live Odoo data, plus findings calculated by code. ' +
    'Use ONLY these figures. Never invent a number, a cause or a period. Quote figures exactly as given. If the data cannot show why something happened, say so and name the Odoo records that would. ' +
    'Reply with ONLY one JSON object (no markdown, no prose around it) shaped exactly like: ' +
    '{"headline":"one sentence, the single most important takeaway","confidence":"High|Medium|Low","drivers":[{"text":"what is driving the result","row":"exact row label or empty"}],"risks":[{"text":"what could go wrong or needs watching","row":"exact row label or empty"}],"actions":[{"text":"a concrete next step an owner can do this week","row":"exact row label or empty"}],"questions":["a follow-up question the user could ask next"]}. ' +
    'Rules: 2-3 items in drivers, 1-3 in risks, 2-3 in actions, 2-3 questions; each text under 220 characters; "row" must be copied exactly from the ROWS list or left empty; use the currency and units shown.';
  function aiMessages(m, ctx) {
    var f = aiFacts(m, ctx); if (!f) return null;
    return { system: AI_SYSTEM, messages: [{ role: 'user', content: f.text }], facts: f };
  }
  function numbersIn(text) {
    var out = [], re = /(-?\d[\d,]*(?:\.\d+)?)\s*([KMBT]\b|%)?/g, mm;
    while ((mm = re.exec(String(text || '')))) {
      var raw = mm[1].replace(/,/g, ''), v = parseFloat(raw); if (!isFinite(v)) continue;
      var u = mm[2] || ''; if (u === 'K') v *= 1e3; else if (u === 'M') v *= 1e6; else if (u === 'B') v *= 1e9; else if (u === 'T') v *= 1e12;
      out.push({ v: v, unit: u, raw: raw });
    }
    return out;
  }
  /* true when every meaningful number in `text` is one the code gave the model (rows, totals, shares, findings) - the rest get a "verify" mark */
  function groundCheck(text, factsText) {
    var known = numbersIn(factsText).map(function (x) { return x.v; });
    return numbersIn(text).every(function (x) {
      if (!x.unit && Math.abs(x.v) <= 12) return true;
      if (!x.unit && Number.isInteger(x.v) && x.v >= 1990 && x.v <= 2100) return true;
      return known.some(function (kv) { var tol = Math.max(Math.abs(kv) * 0.02, x.unit === '%' ? 0.06 : 0.51); return Math.abs(kv - x.v) <= tol || Math.abs(Math.abs(kv) - Math.abs(x.v)) <= tol; });
    });
  }
  function parseAiInsights(text, facts) {
    var s = String(text == null ? '' : text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) return null;
    var o; try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    var labels = (facts && facts.labels) || [], factText = (facts && facts.text) || '';
    function item(x) {
      var t = typeof x === 'string' ? x : x && x.text; t = clipTxt(String(t == null ? '' : t).replace(/\s+/g, ' ').trim(), 260); if (!t) return null;
      var row = x && typeof x === 'object' && x.row ? String(x.row).trim().toLowerCase() : '', hit = '';
      if (row) for (var i = 0; i < labels.length; i++) if (String(labels[i]).trim().toLowerCase() === row) { hit = labels[i]; break; }
      return { text: t, row: hit, check: !groundCheck(t, factText) };
    }
    function list(v, max) { return (Array.isArray(v) ? v : []).map(item).filter(Boolean).slice(0, max); }
    var head = item(o.headline); var conf = /^(high|medium|low)$/i.test(String(o.confidence || '')) ? String(o.confidence)[0].toUpperCase() + String(o.confidence).slice(1).toLowerCase() : '';
    var res = { headline: head ? head.text : '', headlineCheck: head ? head.check : false, confidence: conf, drivers: list(o.drivers, 3), risks: list(o.risks, 3), actions: list(o.actions, 3), questions: (Array.isArray(o.questions) ? o.questions : []).map(function (q) { return clipTxt(String(q || '').replace(/\s+/g, ' ').trim(), 160); }).filter(Boolean).slice(0, 3) };
    return res.headline || res.drivers.length || res.risks.length || res.actions.length ? res : null;
  }
  /* No AI provider? Still give a structured read-out, built only from the calculated findings. */
  function calcReadout(m) {
    var p = profileMetric(m); if (!p) return null;
    var d = deepInsights(m, p), lead = d[0], rows = p.rows;
    function pick(pred, max) { return d.filter(pred).slice(0, max).map(function (x) { return { text: x.text, row: x.ri != null && rows[x.ri] ? rows[x.ri].label : '', check: false }; }); }
    var res = {
      headline: lead ? lead.text : 'No standout finding in these rows.', headlineCheck: false, confidence: '',
      drivers: pick(function (x) { return x.tone !== 'warn' && x.sev !== 'high'; }, 3), risks: pick(function (x) { return x.tone === 'warn'; }, 3),
      actions: d.filter(function (x) { return x.why; }).slice(0, 3).map(function (x) { return { text: x.why, row: x.ri != null && rows[x.ri] ? rows[x.ri].label : '', check: false }; }), questions: []
    };
    if (!res.drivers.length && d[1]) res.drivers = [{ text: d[1].text, row: '', check: false }];
    return res;
  }

  return {
    VERSION: VERSION, SKILLS: SKILLS, detectSkill: detectSkill, skillById: skillById, skillPrompt: skillPrompt, planHint: planHint, skillCatalogue: skillCatalogue,
    promptFor: promptFor, classifyHeading: classifyHeading, calloutKind: calloutKind, chipKind: chipKind,
    extract: extract, stats: stats, headings: headings, parseNumber: parseNumber, tablesOf: tablesOf, sectionsOf: sectionsOf, toReportPayload: toReportPayload,
    fmtCompact: fmtCompact, isSeries: isSeries, isMoney: isMoney, analyzeMetric: analyzeMetric, findingsText: findingsText,
    profileMetric: profileMetric, deepInsights: deepInsights, deepFindingsText: deepFindingsText, aiMessages: aiMessages, parseAiInsights: parseAiInsights, calcReadout: calcReadout, groundCheck: groundCheck
  };
});
