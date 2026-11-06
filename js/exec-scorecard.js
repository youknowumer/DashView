/* ==========================================================================
   DashView — Executive scorecard engine  (window.DVScorecard)

   One engine, two views, so the numbers on both pages always agree:
     • Overview   → "Executive scorecard · all modules"   (js/overview-modules.js)
     • Odoo Live  → "Module scorecard" table + module facts (js/exec-modules.js)

   For every installed Odoo app that has an executive spec (js/odoo-profiles.js) it reads:
     • a headline KPI and up to three secondary KPIs, period vs the previous equal period
     • a 12-month trend (gap-filled, so months without records show as zero)
     • open "needs attention" alerts (count and amount)
     • optional coverage: records, new records this period vs previous, last activity
   and turns them into a status, a 0-100 score, plain-language reasons and an executive brief.

   Rules (shown to the reader under the scorecard, never hidden):
     • Score starts at 100.  Headline KPI moving the wrong way by 5% or more:  -0.8 per % (max -30).
       Another KPI moving the wrong way by 10% or more:  -5 each (max -10).
       Each open high-priority alert:  -12 (max -30).  Each open watch alert:  -5 (max -10).
     • A module cannot score above 74 while its headline KPI is down 10% or more (or the wrong way by 10%
       for cost-type KPIs) or a high-priority alert is open, and not above 49 when the headline is down 25% or more.
     • Status:  75-100 Healthy  ·  50-74 Watch  ·  below 50 Action needed.
     • Business health is the plain average of the module scores.
   Nothing is estimated, forecast or written to Odoo: only read_group / records queries that the
   caller supplies through its context (so the company filter and drill always match the page).
   ========================================================================== */
(function () {
  'use strict';
  var F = window.DVFmt, PR = window.DVOdooProfiles;
  if (!F || !PR) return;

  var esc = F.esc, DERIVED = { ratio: 1, diff: 1, pct: 1 };
  var STATUS = { good: 'Healthy', watch: 'Watch', bad: 'Action needed', na: 'No data' };

  /* ── icons (24x24, stroke) ───────────────────────────────────────────── */
  var ICON = {
    sale: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    crm: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    point_of_sale: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0"/>',
    account: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    hr_expense: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
    purchase: '<path d="M6 7h15l-1.5 9H8z"/><path d="M6 7L5 3H2"/><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>',
    stock: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    mrp: '<path d="M4 20V10l5 3V9l5 3V6l6 3v11z"/><path d="M8 20v-3M12 20v-3M16 20v-3"/>',
    project: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
    helpdesk: '<path d="M4 13v-1a8 8 0 0116 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2-5 2"/>',
    fleet: '<path d="M3 16V9a2 2 0 012-2h9l5 5v4"/><path d="M3 16h18"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>',
    hr: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14c2 .7 3.5 2.6 3.5 6"/>',
    hr_holidays: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M9 15h6"/>'
  };
  function icon(key) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[key] || ICON.project) + '</svg>';
  }

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function cancelled() { var e = new Error('cancelled'); e.cancelled = true; return e; }
  function makeQueue(limit) {
    var q = [], active = 0, dead = false;
    function pump() {
      while (!dead && active < limit && q.length) {
        var t = q.shift(); active++;
        Promise.resolve().then(t.fn).then(t.res, t.rej).then(function () { active--; pump(); });
      }
    }
    return {
      add: function (fn) { return new Promise(function (res, rej) { if (dead) { rej(cancelled()); return; } q.push({ fn: fn, res: res, rej: rej }); pump(); }); },
      cancel: function () { dead = true; var pending = q; q = []; pending.forEach(function (t) { t.rej(cancelled()); }); },
      dead: function () { return dead; }
    };
  }

  /* "2026-06-30 19:00:00" (a month that starts at 00:00 in UTC+5) and "2026-07-01" both mean July. */
  function monthKey(str) {
    var s = String(str || ''), t = Date.parse(s.length <= 10 ? s + 'T00:00:00Z' : s.replace(' ', 'T') + 'Z');
    if (isNaN(t)) return null;
    var d = new Date(t + 12 * 36e5);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }
  /* Last 12 calendar months ending now, gap-filled with zero. groups come from read_group(date:month). */
  function monthSeries(groups, field, measure, now) {
    var base = field.split(':')[0], map = {}, ordered = [], bad = false;
    (groups || []).forEach(function (g) {
      var key = null, d = g.__domain || [];
      for (var i = 0; i < d.length; i++) if (Array.isArray(d[i]) && d[i][0] === base && d[i][1] === '>=') { key = monthKey(d[i][2]); break; }
      var v = measure ? (Number(g[measure]) || 0) : (g.__count || 0);
      if (!key) bad = true; else map[key] = (map[key] || 0) + v;
      ordered.push(v);
    });
    if (bad) { var tail = ordered.slice(-12); return { labels: tail.map(function (_, i) { return String(i + 1); }), values: tail, keys: [] }; }
    var n = now || new Date(), labels = [], values = [], keys = [];
    for (var m = 11; m >= 0; m--) {
      var dt = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - m, 1)), k = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1);
      keys.push(k); values.push(map[k] || 0);
      labels.push(dt.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }));
    }
    return { labels: labels, values: values, keys: keys };
  }

  /* ── derived KPIs and formatting ─────────────────────────────────────── */
  function derive(k, a) {
    var x = a[0], y = a[1];
    if (x == null || y == null) return null;
    if (k.kind === 'ratio') return y ? x / y : 0;
    if (k.kind === 'pct') return y ? x / y * 100 : 0;
    return x - y;
  }
  function fmt(ctx, p, v) {
    if (v == null || isNaN(v)) return '\u2013';
    var k = p.k;
    if (k.kind === 'pct') return v.toFixed(1) + '%';
    if ((k.kind === 'money' || (k.money && DERIVED[k.kind])) && !p.asCount) return ctx.money(v, Math.abs(v) >= 1e5);
    return F.num(v, Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 1);
  }
  function amount(ctx, v) { return ctx.canMoney() ? ctx.money(v, Math.abs(v) >= 1e5) : ''; }
  function pctAbs(d) { var a = Math.abs(d); return a >= 1000 ? '>999%' : a.toFixed(1) + '%'; }
  function pctText(d) { return (d >= 0 ? '+' : '\u2212') + pctAbs(d); }

  /* ── one KPI over a window: [days ago .. to days ago) ────────────────── */
  function val(ctx, k, measure, from, to) {
    var d = PR.tokens(k.domain);
    if (k.date) d = d.concat([[k.date, '>=', PR.ago(from)]], to ? [[k.date, '<', PR.ago(to)]] : []);
    return ctx.sum(k.model, d, measure).then(function (r) { return measure ? r.sum : r.count; });
  }

  /* ── read one module ─────────────────────────────────────────────────── */
  function readModule(ctx, app, o, queue) {
    var X = app.spec, days = o.days, sc = X.sc || { head: 0, subs: [] };
    var res = { key: app.key, tech: app.tech, title: X.title, spec: X, days: days, head: null, subs: [], trend: null, alerts: [], cov: null, status: 'na', score: null, reasons: [], readable: false };
    var need = {}, vals = {}, jobs = [];
    function want(i) { var k = X.kpis[i]; if (!k || need[i]) return; need[i] = true; if (DERIVED[k.kind]) (k.of || []).forEach(want); }
    want(sc.head); (sc.subs || []).forEach(want);

    Object.keys(need).forEach(function (si) {
      var i = +si, k = X.kpis[i];
      if (DERIVED[k.kind]) return;
      var asCount = k.kind === 'money' && !ctx.canMoney(), m = asCount ? null : (k.measure || null);
      var v = vals[i] = { cur: null, prev: null, asCount: asCount };
      jobs.push(queue.add(function () { return val(ctx, k, m, days, 0); }).then(function (r) { v.cur = r; }, function () {}));
      if (k.date) jobs.push(queue.add(function () { return val(ctx, k, m, days * 2, days); }).then(function (r) { v.prev = r; }, function () {}));
    });

    if (X.trend) {
      var t = X.trend, asCnt = !!t.measure && X.kpis.some(function (k) { return k.kind === 'money' && k.model === t.model; }) && !ctx.canMoney();
      jobs.push(queue.add(function () {
        return ctx.readGroup(t.model, { domain: PR.tokens(t.domain), fields: t.measure && !asCnt ? [t.measure + ':sum'] : [], groupby: [t.groupby] });
      }).then(function (g) { res.trend = monthSeries(g, t.groupby, t.measure && !asCnt ? t.measure : null, new Date()); }, function () {}));
    }

    (X.alerts || []).forEach(function (a) {
      jobs.push(queue.add(function () { return ctx.sum(a.model, PR.tokens(a.domain), a.measure && ctx.canMoney() ? a.measure : null); })
        .then(function (r) { res.alerts.push({ a: a, label: a.label, hint: a.hint || '', tone: a.tone || 'warn', count: r.count || 0, sum: a.measure && ctx.canMoney() ? r.sum : null }); }, function () {}));
    });

    if (o.coverage) {
      var cm = X.cov || (X.kpis[0] && X.kpis[0].model), cov = res.cov = { model: cm, total: null, last: null, fresh: null, freshPrev: null };
      jobs.push(queue.add(function () { return ctx.records(cm, { fields: ['create_date'], limit: 1, order: 'create_date desc' }); })
        .then(function (r) { cov.total = r.total || 0; cov.last = (r.rows && r.rows[0] && r.rows[0].create_date) || null; }, function () {}));
      jobs.push(queue.add(function () { return ctx.sum(cm, [['create_date', '>=', PR.ago(days)]], null); }).then(function (r) { cov.fresh = r.count || 0; }, function () {}));
      jobs.push(queue.add(function () { return ctx.sum(cm, [['create_date', '>=', PR.ago(days * 2)], ['create_date', '<', PR.ago(days)]], null); }).then(function (r) { cov.freshPrev = r.count || 0; }, function () {}));
    }

    return Promise.all(jobs).then(function () {
      if (queue.dead()) throw cancelled();
      function resolve(i) {
        var k = X.kpis[i];
        if (!DERIVED[k.kind]) return vals[i] || { cur: null, prev: null };
        if (k.money && !ctx.canMoney()) return { cur: null, prev: null };
        var parts = (k.of || []).map(resolve);
        return { cur: derive(k, parts.map(function (p) { return p.cur; })), prev: derive(k, parts.map(function (p) { return p.prev; })), asCount: false };
      }
      function point(i) {
        var k = X.kpis[i]; if (!k) return null;
        var r = resolve(i), p = { idx: i, k: k, label: k.label, sub: k.sub || '', cur: r.cur, prev: r.prev, asCount: !!r.asCount, delta: null, flat: false, good: null };
        if (r.cur != null) {
          p.readable = true;
          if (r.prev != null && r.prev !== 0 && (k.date || DERIVED[k.kind])) {
            p.delta = (r.cur - r.prev) / Math.abs(r.prev) * 100;
            p.flat = Math.abs(p.delta) < 1;
            p.good = p.flat ? null : (k.inverse ? p.delta < 0 : p.delta > 0);
          }
        }
        return p;
      }
      res.head = point(sc.head);
      res.subs = (sc.subs || []).map(point).filter(Boolean);
      res.alerts.sort(function (a, b) { return (b.tone === 'bad') - (a.tone === 'bad') || b.count - a.count; });
      return evaluate(ctx, res);
    });
  }

  /* ── status, score, reasons ──────────────────────────────────────────── */
  function evaluate(ctx, res) {
    var pts = [res.head].concat(res.subs).filter(Boolean), score = 100, reasons = [];
    res.readable = pts.some(function (p) { return p.readable; });   /* alerts alone never make an unreadable app look healthy */
    if (!res.readable) { res.status = 'na'; res.score = null; return res; }

    var h = res.head;
    if (h && h.delta != null && Math.abs(h.delta) >= 5) {
      if (h.good === false) {
        score -= Math.min(30, Math.round(Math.abs(h.delta) * 0.8));
        reasons.push({ tone: Math.abs(h.delta) >= 15 ? 'bad' : 'warn', mag: Math.abs(h.delta), text: h.label + ' ' + (h.delta > 0 ? 'up ' : 'down ') + pctAbs(h.delta) + ' vs the previous period (' + fmt(ctx, h, h.cur) + ')' });
      } else if (h.good === true) {
        reasons.push({ tone: 'good', mag: Math.abs(h.delta), text: h.label + ' ' + (h.delta > 0 ? 'up ' : 'down ') + pctAbs(h.delta) + ' vs the previous period (' + fmt(ctx, h, h.cur) + ')' });
      }
    }
    var subHit = 0;
    res.subs.forEach(function (p) {
      if (p.delta == null || Math.abs(p.delta) < 10) return;
      if (p.good === false && subHit < 2) { score -= 5; subHit++; reasons.push({ tone: 'warn', mag: Math.abs(p.delta), text: p.label + ' ' + (p.delta > 0 ? 'up ' : 'down ') + pctAbs(p.delta) + ' (' + fmt(ctx, p, p.cur) + ')' }); }
      else if (p.good === true) reasons.push({ tone: 'good', mag: Math.abs(p.delta), text: p.label + ' ' + (p.delta > 0 ? 'up ' : 'down ') + pctAbs(p.delta) + ' (' + fmt(ctx, p, p.cur) + ')' });
    });
    var badPen = 0, warnPen = 0;
    res.alerts.forEach(function (al) {
      if (!al.count) return;
      var txt = F.num(al.count, 0) + ' ' + al.label.toLowerCase() + (al.sum != null ? ' (' + amount(ctx, al.sum) + ')' : '');
      if (al.tone === 'bad') { badPen = Math.min(30, badPen + 12); reasons.push({ tone: 'bad', mag: 1000 + al.count, text: txt, alert: true }); }
      else { warnPen = Math.min(10, warnPen + 5); reasons.push({ tone: 'warn', mag: al.count, text: txt, alert: true }); }
    });
    score = Math.max(0, Math.min(100, score - badPen - warnPen));
    /* A module cannot be called Healthy while its headline is clearly falling or a high-priority alert is open. */
    var headDrop = h && h.good === false && h.delta != null ? Math.abs(h.delta) : 0;
    var hasBad = res.alerts.some(function (al) { return al.tone === 'bad' && al.count > 0; });
    if (headDrop >= 25) score = Math.min(score, 49); else if (headDrop >= 10 || hasBad) score = Math.min(score, 74);
    res.score = score;
    res.status = score >= 75 ? 'good' : score >= 50 ? 'watch' : 'bad';
    res.reasons = reasons;
    return res;
  }

  /* ── run all modules (progressive: onModule fires as each one lands) ─── */
  function run(ctx, apps, o) {
    o = o || {};
    var queue = makeQueue(o.concurrency || 4), results = new Array(apps.length), done = 0;
    var p = Promise.all(apps.map(function (app, i) {
      return readModule(ctx, app, o, queue).then(function (r) {
        results[i] = r; done++;
        if (o.onModule) { try { o.onModule(r, i, done, apps.length); } catch (e) { /* a view error must not stop the other modules */ } }
      }, function (e) { if (!(e && e.cancelled)) { results[i] = { key: app.key, tech: app.tech, title: app.spec.title, spec: app.spec, status: 'na', score: null, readable: false, alerts: [], subs: [], reasons: [] }; done++; if (o.onModule) { try { o.onModule(results[i], i, done, apps.length); } catch (x) { /* ignore */ } } } });
    })).then(function () { return results; });
    return { promise: p, cancel: function () { queue.cancel(); } };
  }

  /* ── roll-ups ────────────────────────────────────────────────────────── */
  function health(results) {
    var rated = (results || []).filter(function (r) { return r && r.status !== 'na' && r.score != null; });
    var counts = { good: 0, watch: 0, bad: 0, na: (results || []).length - rated.length };
    rated.forEach(function (r) { counts[r.status]++; });
    if (!rated.length) return { score: null, tone: 'na', label: 'Waiting for data', counts: counts, modules: (results || []).length };
    var score = Math.round(rated.reduce(function (s, r) { return s + r.score; }, 0) / rated.length);
    return { score: score, tone: score >= 75 ? 'good' : score >= 50 ? 'watch' : 'bad', label: score >= 75 ? 'Healthy' : score >= 50 ? 'Needs attention' : 'At risk', counts: counts, modules: rated.length };
  }
  function brief(results) {
    var strengths = [], risks = [], actions = [];
    (results || []).forEach(function (r) {
      if (!r || r.status === 'na') return;
      (r.reasons || []).forEach(function (x) {
        var item = { app: r.title, key: r.key, text: x.text, tone: x.tone, mag: x.mag, alert: !!x.alert };
        if (x.tone === 'good') strengths.push(item); else if (!x.alert) risks.push(item);   /* open alerts are listed under actions, not twice */
      });
      (r.alerts || []).forEach(function (a) { if (a.count > 0) actions.push({ app: r.title, key: r.key, label: a.label, hint: a.hint, tone: a.tone, count: a.count, sum: a.sum, a: a.a }); });
    });
    strengths.sort(function (a, b) { return b.mag - a.mag; });
    risks.sort(function (a, b) { return (b.tone === 'bad') - (a.tone === 'bad') || b.mag - a.mag; });
    actions.sort(function (a, b) { return (b.tone === 'bad') - (a.tone === 'bad') || b.count - a.count; });
    return { strengths: strengths.slice(0, 5), risks: risks.slice(0, 6), actions: actions.slice(0, 8) };
  }
  function briefText(ctx, results, periodLabel) {
    var h = health(results), b = brief(results), L = [];
    L.push('Executive scorecard \u2014 ' + periodLabel + ' vs the previous period');
    L.push(h.score == null ? 'Business health: waiting for data' : 'Business health: ' + h.score + '/100 (' + h.label + ') \u00B7 ' + h.counts.good + ' healthy, ' + h.counts.watch + ' watch, ' + h.counts.bad + ' need action');
    L.push('');
    (results || []).forEach(function (r) {
      if (!r || r.status === 'na') return;
      var hd = r.head && r.head.readable ? r.head.label + ' ' + fmt(ctx, r.head, r.head.cur) + (r.head.delta != null ? ' (' + pctText(r.head.delta) + ')' : '') : '';
      L.push('- ' + r.title + ': ' + STATUS[r.status] + ' (' + r.score + ')' + (hd ? ' \u00B7 ' + hd : ''));
    });
    if (b.strengths.length) { L.push('', 'Going well'); b.strengths.slice(0, 3).forEach(function (x) { L.push('- ' + x.app + ': ' + x.text); }); }
    if (b.risks.length) { L.push('', 'Watch closely'); b.risks.slice(0, 4).forEach(function (x) { L.push('- ' + x.app + ': ' + x.text); }); }
    if (b.actions.length) { L.push('', 'Do next'); b.actions.slice(0, 5).forEach(function (x) { L.push('- ' + x.app + ': ' + F.num(x.count, 0) + ' ' + x.label.toLowerCase() + (x.sum != null ? ' (' + amount(ctx, x.sum) + ')' : '') + (x.hint ? ' \u2014 ' + x.hint : '')); }); }
    return L.join('\n');
  }
  function csvRows(ctx, results, periodLabel) {
    var rows = [['Module', 'Status', 'Score', 'Headline KPI', 'Value', 'Previous period', 'Change %', 'Other KPIs', 'Open alerts']];
    (results || []).forEach(function (r) {
      if (!r) return;
      var h = r.head;
      rows.push([r.title, STATUS[r.status], r.score == null ? '' : r.score,
        h ? h.label : '', h && h.readable ? fmt(ctx, h, h.cur) : '', h && h.prev != null ? fmt(ctx, h, h.prev) : '', h && h.delta != null ? h.delta.toFixed(1) : '',
        (r.subs || []).filter(function (p) { return p.readable; }).map(function (p) { return p.label + ': ' + fmt(ctx, p, p.cur) + (p.delta != null ? ' (' + pctText(p.delta) + ')' : ''); }).join('; '),
        (r.alerts || []).filter(function (a) { return a.count > 0; }).map(function (a) { return a.label + ': ' + a.count + (a.sum != null ? ' (' + amount(ctx, a.sum) + ')' : ''); }).join('; ')]);
    });
    rows.push([], ['Period', periodLabel]);
    return rows;
  }

  /* ── sparkline (inline SVG, follows the card tone through CSS) ───────── */
  function spark(values, tone) {
    var n = values ? values.length : 0; if (n < 2) return '';
    var w = 120, h = 34, pd = 3, mn = Math.min.apply(null, values), mx = Math.max.apply(null, values);
    if (mx === mn) { mx = mn + 1; }
    var pts = values.map(function (v, i) { return [pd + i * (w - 2 * pd) / (n - 1), h - pd - (v - mn) / (mx - mn) * (h - 2 * pd)]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''), last = pts[n - 1];
    var area = line + 'L' + last[0].toFixed(1) + ' ' + (h - pd) + 'L' + pts[0][0].toFixed(1) + ' ' + (h - pd) + 'Z';
    return '<svg class="dvsc-spark tone-' + (tone || 'na') + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="12-month trend"><path class="a" d="' + area + '"/><path class="l" d="' + line + '"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6"/></svg>';
  }

  /* ── drill specs (the view adds company scope and opens DVDrill) ─────── */
  function drillKpi(ctx, res, p) {
    var k = p && p.k; if (!k) return null;
    if (DERIVED[k.kind]) { var src = res.spec.kpis[(k.of || [])[0]]; if (!src) return null; k = src; }
    if (!k.model) return null;
    var money = k.kind === 'money' && !(p && p.asCount) && ctx.canMoney();
    return { title: res.title + ' \u00B7 ' + k.label, model: k.model, domain: PR.tokens(k.domain), date: k.date || null, measure: k.measure && (money || k.kind === 'num') ? k.measure : null, kind: money ? 'money' : 'count', inverse: !!k.inverse };
  }
  function drillAlert(ctx, res, al) {
    var a = al.a, money = !!(a.measure && ctx.canMoney());
    return { title: res.title + ' \u00B7 ' + al.label, model: a.model, domain: PR.tokens(a.domain), measure: money ? a.measure : null, kind: money ? 'money' : 'count', inverse: true };
  }

  /* Jump to Odoo Live and pick one module (waits for the module list to load). */
  function openInLive(tech, key) {
    if (window.dashviewShowView) window.dashviewShowView('odoo-live');
    var tries = 0;
    (function go() {
      var sel = document.getElementById('odooLiveModuleSelect');
      if (sel && !sel.disabled) {
        var has = function (v) { return v && Array.prototype.some.call(sel.options, function (o) { return o.value === v; }); };
        var pick = has(tech) ? tech : has(key) ? key : null;   /* e.g. account_accountant, else the app's own name */
        if (pick) { sel.value = pick; sel.dispatchEvent(new Event('change', { bubbles: true })); return; }
      }
      if (++tries < 40) setTimeout(go, 150);
    })();
  }
  function periodLabel(days) { return days === 365 ? '12 months' : days + ' days'; }

  window.DVScorecard = {
    openInLive: openInLive, periodLabel: periodLabel,
    run: run, health: health, brief: brief, briefText: briefText, csvRows: csvRows, spark: spark, icon: icon, fmt: fmt, amount: amount, pctText: pctText, pctAbs: pctAbs,
    drillKpi: drillKpi, drillAlert: drillAlert, evaluate: evaluate, monthSeries: monthSeries, monthKey: monthKey, STATUS: STATUS
  };
})();
