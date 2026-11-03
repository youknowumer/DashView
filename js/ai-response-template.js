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

  return {
    VERSION: VERSION, SKILLS: SKILLS, detectSkill: detectSkill, skillById: skillById, skillPrompt: skillPrompt, planHint: planHint, skillCatalogue: skillCatalogue,
    promptFor: promptFor, classifyHeading: classifyHeading, calloutKind: calloutKind, chipKind: chipKind,
    extract: extract, stats: stats, headings: headings, parseNumber: parseNumber, tablesOf: tablesOf, sectionsOf: sectionsOf, toReportPayload: toReportPayload
  };
});
