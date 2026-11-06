/* ==========================================================================
   DashView — Overview: Executive scorecard · all modules  (live from Odoo, read-only)
   Sits under the KPI cards on the Overview page and answers "how is every part of the business doing?":

     • Business health   0-100 ring, the average of the module scores, with healthy / watch / action counts
     • Executive brief   going well · watch closely · do next (open alerts, one click to the records)
     • Module cards      one per installed app (Sales, CRM, POS, Finance, Expenses, Purchase, Inventory,
                         Manufacturing, Projects, Helpdesk, Fleet, People, Time Off): headline KPI vs the
                         previous period, 12-month trend, three secondary KPIs, open alerts, status
     • Tools             copy a plain-text brief (WhatsApp / e-mail), export CSV, open the module in Odoo Live

   It uses the Overview's own company filter, currency, period and drill (window.DVOverview) and the shared
   engine (js/exec-scorecard.js), so the numbers agree with Odoo Live. Every figure is read from Odoo with
   read_group / records queries; the status is a rule over those figures (rules are printed under the board).
   An app that is not installed is simply not shown. Nothing is written to Odoo.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('view-overview'), O = window.DVOverview, F = window.DVFmt, SC = window.DVScorecard, PR = window.DVOdooProfiles, C = window.DVOdooClient;
  if (!root || !O || !F || !SC || !PR || !C || !document.getElementById('ovKpis')) return;

  var esc = F.esc, PERIOD_KEY = 'dashview_odoo_period', REFRESH_MS = 5 * 60 * 1000;
  var sec = null, seq = 0, job = null, apps = [], results = [], drills = [], last = null, forceNext = false, painting = 0, loading = false, fallbackMode = false;

  function $(id) { return document.getElementById(id); }
  function toast(m) { if (window.showToast) window.showToast(m); }
  var ctx = {
    sum: function (m, d, f) { return O.sum(m, d, f); },
    readGroup: function (m, o) { return O.readGroup(m, o); },
    records: function (m, o) { return O.records(m, o); },
    money: function (v, c) { return O.money(v, c); },
    canMoney: function () { return !!O.currency(); }
  };
  function days() { return O.range(); }
  function periodText() { return SC.periodLabel(days()); }
  function dr(x) { drills.push(x); return drills.length - 1; }

  /* ── mount ───────────────────────────────────────────────────────────── */
  function mount() {
    if (sec) return;
    sec = document.createElement('section');
    sec.id = 'ovMods'; sec.className = 'ovm'; sec.hidden = true; sec.setAttribute('aria-label', 'Executive scorecard for all modules');
    $('ovKpis').insertAdjacentElement('afterend', sec);
    sec.addEventListener('click', onClick);
  }

  /* ── clicks: drill, jump to a card, copy, export, open in Odoo Live ──── */
  function openDrill(spec, from) {
    if (!spec) return;
    if (C.state() !== 'ok') { toast('Connect Odoo first \u2014 there is nothing to drill into yet.'); return; }
    if (!window.DVDrill) { toast('Drill Explorer is unavailable. Reload DashView and try again.'); return; }
    if (spec.date) { try { localStorage.setItem(PERIOD_KEY, JSON.stringify(days())); } catch (e) { /* period memory is optional */ } }
    spec.domain = O.scoped(spec.model, spec.domain || []);
    spec.companyIds = O.companyIds();
    window.DVDrill.open(spec, from);
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-sd],[data-focus],[data-act],[data-live]');
    if (!t || !sec.contains(t)) return;
    if (t.hasAttribute('data-sd')) {
      var d = drills[+t.getAttribute('data-sd')]; if (!d) return;
      openDrill(d.al ? SC.drillAlert(ctx, d.res, d.al) : SC.drillKpi(ctx, d.res, d.p), t);
    } else if (t.hasAttribute('data-focus')) {
      var card = sec.querySelector('.ovm-card[data-app="' + t.getAttribute('data-focus') + '"]');
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('is-ping'); setTimeout(function () { card.classList.remove('is-ping'); }, 1600); }
    } else if (t.hasAttribute('data-live')) {
      SC.openInLive(t.getAttribute('data-live'), t.getAttribute('data-key'));
    } else if (t.getAttribute('data-act') === 'copy') copyBrief(t);
    else if (t.getAttribute('data-act') === 'csv') exportCsv();
    else if (t.getAttribute('data-act') === 'live') SC.openInLive('__all__');
  }
  function ready() { return results.filter(Boolean).length > 0; }
  function copyBrief(btn) {
    if (!ready()) { toast('Nothing to copy yet \u2014 the scorecard is still loading.'); return; }
    var text = SC.briefText(ctx, results.filter(Boolean), periodText());
    var done = function () { toast('Executive brief copied.'); if (btn) { var o = btn.textContent; btn.textContent = 'Copied \u2713'; setTimeout(function () { btn.textContent = o; }, 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); }); }
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy is blocked in this browser.'); }
    ta.remove();
  }
  function exportCsv() {
    if (!ready()) { toast('Nothing to export yet \u2014 the scorecard is still loading.'); return false; }
    F.download('executive-scorecard-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(SC.csvRows(ctx, results.filter(Boolean), periodText())));
    if (window.DVSec) window.DVSec.log('Exported overview', 'Module scorecard CSV');
    return true;
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  function deltaChip(p) {
    if (p.delta != null) {
      var tn = p.flat || p.good == null ? 'flat' : p.good ? 'good' : 'bad';
      return '<i class="ovm-d ' + tn + '">' + (p.delta >= 0 ? '\u25B2 ' : '\u25BC ') + SC.pctAbs(p.delta) + '</i>';
    }
    return '';
  }
  function deltaNote(p) {
    if (p.delta != null) return 'vs previous ' + esc(periodText());
    if (p.k.date) return p.prev === 0 && p.cur > 0 ? 'New \u2014 nothing in the previous period' : 'No earlier data to compare';
    return esc(p.sub || 'Current snapshot');
  }
  function headBlock(r) {
    var h = r.head;
    if (!h || !h.readable) return '<div class="ovm-main is-empty"><span class="ovm-l">' + esc(h ? h.label : 'Headline') + '</span><b class="ovm-v">\u2013</b><span class="ovm-n">Not readable by this Odoo user</span></div>';
    var id = dr({ res: r, p: h });
    return '<button type="button" class="ovm-main" data-sd="' + id + '" aria-label="Open the records behind ' + esc(r.title + ' ' + h.label) + '">' +
      '<span class="ovm-l">' + esc(h.label) + (h.asCount ? ' \u00B7 count' : '') + '</span><b class="ovm-v">' + esc(SC.fmt(ctx, h, h.cur)) + '</b>' +
      '<span class="ovm-n">' + deltaChip(h) + ' ' + deltaNote(h) + '</span></button>';
  }
  function subList(r) {
    var rows = (r.subs || []).filter(function (p) { return p.readable; });
    if (!rows.length) return '';
    return '<ul class="ovm-subs">' + rows.map(function (p) {
      var id = dr({ res: r, p: p });
      return '<li><button type="button" class="ovm-sub" data-sd="' + id + '" title="' + esc(p.sub || p.label) + '"><span>' + esc(p.label) + '</span><b>' + esc(SC.fmt(ctx, p, p.cur)) + '</b>' + deltaChip(p) + '</button></li>';
    }).join('') + '</ul>';
  }
  function alertRow(r) {
    var al = r.alerts || [];
    if (!(r.spec.alerts || []).length) return '';
    var open = al.filter(function (a) { return a.count > 0; });
    if (!open.length) return '<div class="ovm-al"><span class="ovm-clear">\u2713 No open alerts</span></div>';
    return '<div class="ovm-al">' + open.slice(0, 3).map(function (a) {
      var id = dr({ res: r, al: a });
      return '<button type="button" class="ovm-pill tone-' + (a.tone === 'bad' ? 'bad' : 'warn') + '" data-sd="' + id + '" title="' + esc(a.hint || a.label) + '"><b>' + F.num(a.count, 0) + '</b> ' + esc(a.label) + (a.sum != null ? ' <em>' + esc(SC.amount(ctx, a.sum)) + '</em>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function card(r, app) {
    var title = app.spec.title;
    if (!r) return '<article class="ovm-card is-loading tone-na" data-app="' + esc(app.key) + '" aria-busy="true"><header class="ovm-ch"><span class="ovm-ic">' + SC.icon(app.key) + '</span><h3>' + esc(title) + '</h3></header><div class="olx-skel"></div></article>';
    var tone = r.status, why = (r.reasons && r.reasons[0]) ? r.reasons.filter(function (x) { return x.tone !== 'good'; })[0] || r.reasons[0] : null;
    var head = '<header class="ovm-ch"><span class="ovm-ic">' + SC.icon(r.key) + '</span><h3>' + esc(r.title) + '</h3><span class="ovm-chip tone-' + tone + '" title="' + (r.score == null ? 'No readable data' : 'Score ' + r.score + ' of 100') + '">' + esc(SC.STATUS[tone]) + (r.score != null ? ' \u00B7 ' + r.score : '') + '</span></header>';
    var foot = '<footer class="ovm-cf"><span class="ovm-why' + (why ? ' tone-' + (why.tone === 'good' ? 'good' : why.tone === 'bad' ? 'bad' : 'warn') : '') + '">' + esc(why ? why.text : (r.status === 'na' ? 'Installed, but this Odoo user cannot read its data' : 'Stable \u2014 no significant movement')) + '</span><button type="button" class="ovm-link" data-live="' + esc(r.tech) + '" data-key="' + esc(r.key) + '">Open in Odoo Live \u203A</button></footer>';
    if (r.status === 'na') return '<article class="ovm-card tone-na" data-app="' + esc(r.key) + '">' + head + foot + '</article>';
    var sp = r.trend && r.trend.values.some(function (v) { return v; }) ? '<div class="ovm-sp" title="' + esc(r.spec.trend.title) + '">' + SC.spark(r.trend.values, tone) + '<small>' + esc(r.spec.trend.title.replace(/\s*[\u2014-]\s*last 12 months/i, '')) + ' \u00B7 12 months</small></div>' : '';
    return '<article class="ovm-card tone-' + tone + '" data-app="' + esc(r.key) + '">' + head + '<div class="ovm-top2">' + headBlock(r) + sp + '</div>' + subList(r) + alertRow(r) + foot + '</article>';
  }
  function ring(h) {
    var C2 = 2 * Math.PI * 34, v = h.score == null ? 0 : h.score;
    return '<div class="ovm-ring tone-' + h.tone + '" role="img" aria-label="Business health ' + (h.score == null ? 'not available' : h.score + ' out of 100, ' + esc(h.label)) + '"><svg viewBox="0 0 80 80"><circle class="t" cx="40" cy="40" r="34"/><circle class="v" cx="40" cy="40" r="34" stroke-dasharray="' + (v / 100 * C2).toFixed(1) + ' ' + C2.toFixed(1) + '" transform="rotate(-90 40 40)"/></svg><div><b>' + (h.score == null ? '\u2013' : h.score) + '</b><span>' + (h.score == null ? 'waiting' : 'of 100') + '</span></div></div>';
  }
  function briefCols(rs) {
    var b = SC.brief(rs);
    var li = function (x) { return '<li><button type="button" class="ovm-bi" data-focus="' + esc(x.key) + '"><em>' + esc(x.app) + '</em> ' + esc(x.text) + '</button></li>'; };
    var col = function (cls, title, items, empty) { return '<div class="ovm-bc ' + cls + '"><h4>' + title + '</h4><ul>' + (items.length ? items.join('') : '<li class="ovm-none">' + empty + '</li>') + '</ul></div>'; };
    var acts = b.actions.slice(0, 4).map(function (x) {
      var id = dr({ res: rs.filter(function (r) { return r.key === x.key; })[0], al: { a: x.a, label: x.label } });
      return '<li><button type="button" class="ovm-bi is-act tone-' + (x.tone === 'bad' ? 'bad' : 'warn') + '" data-sd="' + id + '"><em>' + esc(x.app) + '</em> <b>' + F.num(x.count, 0) + '</b> ' + esc(x.label.toLowerCase()) + (x.sum != null ? ' (' + esc(SC.amount(ctx, x.sum)) + ')' : '') + (x.hint ? '<small>' + esc(x.hint) + '</small>' : '') + '</button></li>';
    });
    return col('is-good', 'Going well', b.strengths.slice(0, 3).map(li), 'No significant favourable movement') +
      col('is-watch', 'Watch closely', b.risks.filter(function (x) { return !x.alert; }).slice(0, 4).map(li), 'No unfavourable movement') +
      col('is-act', 'Do next', acts, 'No open alerts \u2014 nothing to chase');
  }
  function basis() {
    return '<details class="ovm-basis"><summary>How the status is scored</summary><ul>' +
      '<li><b>Period</b> ' + esc(periodText()) + ' compared with the previous equal period. A change under 1% counts as stable.</li>' +
      '<li><b>Score</b> starts at 100. Each module\u2019s headline KPI moving the wrong way by 5% or more takes up to 30 points; another KPI moving the wrong way by 10% or more takes 5; each open high-priority alert takes 12; each open watch alert takes 5. A module cannot be Healthy while its headline is down 10% or more or a high-priority alert is open, and is Action needed when the headline is down 25% or more.</li>' +
      '<li><b>Status</b> 75\u2013100 Healthy \u00B7 50\u201374 Watch \u00B7 below 50 Action needed. Business health is the plain average of the module scores.</li>' +
      '<li><b>Colour logic</b> Cost-type metrics (spend, bills, receivable, expenses, tickets) are coloured inversely: lower is better.</li>' +
      '<li><b>Source</b> Live Odoo read-only queries for the selected company. Nothing is estimated, forecast or back-filled; an app you cannot read is shown as No data and left out of the health score.</li>' +
      (ctx.canMoney() ? '' : '<li><b>Currencies</b> The selected companies use different or unknown currencies, so amounts are not combined: money KPIs show record counts. Select one company for amounts.</li>') +
      '</ul></details>';
  }
  function paint() {
    painting = 0;
    if (!sec || !apps.length) { if (sec) sec.hidden = true; return; }
    drills = [];
    var rs = results.filter(Boolean), h = SC.health(rs), n = rs.length, total = apps.length;
    var sub = (loading ? 'Reading ' + n + ' of ' + total + ' modules\u2026' : total + ' module' + (total === 1 ? '' : 's')) + ' \u00B7 last ' + esc(periodText()) + ' vs the previous ' + esc(periodText()) + ' \u00B7 live from Odoo \u00B7 rule-based, no estimates';
    var counts = '<div class="ovm-counts"><span class="is-good"><b>' + h.counts.good + '</b>Healthy</span><span class="is-watch"><b>' + h.counts.watch + '</b>Watch</span><span class="is-bad"><b>' + h.counts.bad + '</b>Action</span>' + (h.counts.na ? '<span class="is-na"><b>' + h.counts.na + '</b>No data</span>' : '') + '</div>';
    sec.hidden = false;
    sec.setAttribute('aria-busy', loading ? 'true' : 'false');
    sec.innerHTML =
      '<div class="ovm-head"><div class="ovm-title"><span class="ovm-kicker">Executive scorecard</span><h2>Every module at a glance</h2><p>' + sub + '</p></div>' +
      '<div class="ovm-actions"><button type="button" class="btn btn-outline btn-sm" data-act="copy">Copy brief</button><button type="button" class="btn btn-outline btn-sm" data-act="csv">Export CSV</button><button type="button" class="btn btn-primary btn-sm" data-act="live">Open Odoo Live \u203A</button></div></div>' +
      '<div class="panel ovm-sum">' + ring(h) + '<div class="ovm-sumtx"><h3>Business health<span class="tone-' + h.tone + '">' + esc(h.label) + '</span></h3>' + counts + '</div>' + '<div class="ovm-brief">' + (n ? briefCols(rs) : '<div class="olx-skel"></div>') + '</div></div>' +
      '<div class="ovm-grid">' + apps.map(function (a, i) { return card(results[i], a); }).join('') + '</div>' + basis();
  }
  function schedule() { if (painting) return; painting = 1; (window.requestAnimationFrame || setTimeout)(paint); }

  /* ── load ────────────────────────────────────────────────────────────── */
  function pickApps(mods) {
    fallbackMode = false;
    var list = PR.installed(mods);
    return list;
  }
  function load(my) {
    var days0 = days();
    function start(list) {
      if (my !== seq) return;
      apps = list; results = new Array(list.length); loading = true;
      if (!list.length) { sec.hidden = true; loading = false; return; }
      schedule();
      job = SC.run(ctx, list, { days: days0, onModule: function (r, i) { if (my !== seq) return; results[i] = r; schedule(); } });
      job.promise.then(function () {
        if (my !== seq) return;
        loading = false;
        if (fallbackMode) { /* apps could not be listed: hide the ones that returned nothing */
          var keep = []; apps.forEach(function (a, i) { if (results[i] && results[i].status !== 'na') keep.push(i); });
          apps = keep.map(function (i) { return apps[i]; }); results = keep.map(function (i) { return results[i]; });
        }
        last = { at: Date.now(), days: days0, scope: scopeKey() };
        schedule();
        document.dispatchEvent(new CustomEvent('dv:overview-modules', { detail: { modules: results.length } }));
      });
    }
    C.modules().then(function (mods) { start(pickApps(mods)); }, function () {
      fallbackMode = true;
      start(PR.order.map(function (k) { return { key: k, spec: PR.exec(k), tech: k }; }));
    });
  }
  function scopeKey() { return O.companyIds().join(',') + '|' + (O.currency() || ''); }
  function refresh(force) {
    mount();
    if (C.state() !== 'ok') { sec.hidden = true; return; }
    if (!force && last && last.days === days() && last.scope === scopeKey() && Date.now() - last.at < REFRESH_MS) return;
    if (job) job.cancel();
    var my = ++seq; last = null; load(my);
  }

  /* ── hooks: sync from the Overview, manual refresh, lock, export ─────── */
  document.addEventListener('dv:overview-synced', function () { var f = forceNext; forceNext = false; refresh(f); });
  var rb = $('ovRefresh'); if (rb) rb.addEventListener('click', function () { forceNext = true; });
  ['dv:odoo-config-saved', 'dv:unlocked'].forEach(function (ev) { document.addEventListener(ev, function () { forceNext = true; }); });
  document.addEventListener('dv:locked', function () { seq++; if (job) job.cancel(); last = null; results = []; apps = []; if (sec) { sec.hidden = true; sec.innerHTML = ''; } });
  mount();

  /* Read-only bridge for the Overview exports (CSV rows, PDF KPI list, AI narrative data). */
  window.DVOverviewExtras = {
    ready: function () { return ready() && !loading; },
    csvRows: function () { return ready() ? [[], ['Executive scorecard \u2014 last ' + periodText()]].concat(SC.csvRows(ctx, results.filter(Boolean), periodText())) : []; },
    kpis: function () {
      if (!ready()) return [];
      var h = SC.health(results.filter(Boolean));
      return [{ label: 'Business health (0-100)', value: h.score == null ? 'n/a' : h.score + ' \u00B7 ' + h.label }].concat(results.filter(function (r) { return r && r.head && r.head.readable; }).map(function (r) {
        return { label: r.title + ' \u00B7 ' + r.head.label, value: SC.fmt(ctx, r.head, r.head.cur) + (r.head.delta != null ? '  (' + SC.pctText(r.head.delta) + ')' : '') + '  \u00B7 ' + SC.STATUS[r.status] };
      }));
    },
    summary: function () {
      if (!ready()) return null;
      var rs = results.filter(Boolean), h = SC.health(rs);
      return { health_score: h.score, health_label: h.label, modules: rs.map(function (r) {
        return { module: r.title, status: SC.STATUS[r.status], score: r.score, headline: r.head && r.head.readable ? { kpi: r.head.label, value: r.head.cur, change_percent: r.head.delta == null ? null : Math.round(r.head.delta * 10) / 10 } : null,
          open_alerts: (r.alerts || []).filter(function (a) { return a.count > 0; }).map(function (a) { return { alert: a.label, count: a.count, amount: a.sum }; }) };
      }) };
    }
  };
})();
