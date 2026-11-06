/* ==========================================================================
   DashView — Odoo Live → Executive: Module scorecard & module facts  (read-only)

   Adds one section under the executive summary in Odoo Live → Executive:

     • Company view (every lens)   "Module scorecard" — one row per installed app of the lens:
                                    status and score, headline KPI vs the previous period, 12-month trend,
                                    open alerts, records, new records this period vs previous, last activity.
                                    Plus plain-language data-freshness notes (quiet apps, stale apps).
     • One app selected            "Module facts" — records, new this period, last activity, open alerts
                                    and the app's status, so the executive page has detail even when the
                                    app has only a handful of KPIs.

   It uses the same engine as the Overview (js/exec-scorecard.js), the same period as the page and the same
   company scope, so the figures agree everywhere. Only read_group / records queries. It waits until the page
   has finished its own loading, then fills in. An app that is not installed is simply not listed.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.DVOdooClient, F = window.DVFmt, PR = window.DVOdooProfiles, SC = window.DVScorecard;
  var host = document.getElementById('odooLiveExec');
  if (!C || !F || !PR || !SC || !host) return;

  var esc = F.esc, PERIOD_KEY = 'dashview_odoo_period', STALE_DAYS = 30;
  var sec = null, seq = 0, job = null, results = [], apps = [], drills = [], lastDays = 30, poll = 0, mode = 'all';
  var FALLBACK_LENS = { company: null, commercial: ['sale', 'crm', 'point_of_sale'], finance: ['account', 'hr_expense'], operations: ['purchase', 'stock', 'mrp', 'project', 'helpdesk', 'fleet'], people: ['hr', 'hr_holidays', 'hr_expense'] };

  function $(id) { return document.getElementById(id); }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function days() {
    var p = jget(PERIOD_KEY, 30);
    if (p === -1) { var n = new Date(); return Math.max(1, Math.ceil((n - new Date(n.getFullYear(), 0, 1)) / 864e5)); }
    return p > 0 ? p : 30;
  }
  function periodText() { return lastDays === 365 ? '12 months' : lastDays + ' days'; }
  var ctx = {
    sum: function (m, d, f) { return C.sum(m, d, f); }, readGroup: function (m, o) { return C.readGroup(m, o); }, records: function (m, o) { return C.records(m, o); },
    money: function (v, c) { return F.money(v, c); }, canMoney: function () { return true; }
  };
  function dr(x) { drills.push(x); return drills.length - 1; }
  function alive(my) { return my === seq && sec && document.body.contains(sec); }

  /* ── which apps does the active lens show ────────────────────────────── */
  function lensApps(installed) {
    var b = host.querySelector('#olxLens button.active'), key = b ? b.getAttribute('data-lens') : 'company';
    var defs = window.DVExecLenses, allowed = null;
    if (defs) defs.forEach(function (l) { if (l[0] === key) allowed = l[2]; }); else allowed = FALLBACK_LENS[key] || null;
    return allowed ? installed.filter(function (a) { return allowed.indexOf(a.key) > -1; }) : installed;
  }

  /* ── time helpers ────────────────────────────────────────────────────── */
  function ageDays(s) { var t = Date.parse(String(s || '').replace(' ', 'T') + 'Z'); return isNaN(t) ? null : (Date.now() - t) / 864e5; }
  function ago(s) {
    var d = ageDays(s); if (d == null) return '\u2013';
    var m = Math.floor(d * 1440); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60); if (h < 24) return h + ' h ago';
    var dd = Math.floor(h / 24); if (dd < 60) return dd + ' day' + (dd === 1 ? '' : 's') + ' ago';
    return Math.floor(dd / 30) + ' months ago';
  }

  /* ── mount ───────────────────────────────────────────────────────────── */
  function tryMount() {
    if (host.hidden || host.querySelector('#olxMods')) return;
    var narr = host.querySelector('#olxNarr'); if (!narr || !host.querySelector('.olx-xhead')) return;
    var all = !!host.querySelector('#olxLens'), tech = $('odooLiveModuleSelect') ? $('odooLiveModuleSelect').value : '';
    if (job) job.cancel();
    var list;
    mode = all ? 'all' : 'one';
    if (all) list = null; else { list = PR.installed([{ technicalName: tech }]); if (!list.length) return; }
    sec = document.createElement('section');
    sec.id = 'olxMods'; sec.className = 'olm'; sec.setAttribute('aria-label', all ? 'Module scorecard' : 'Module facts');
    sec.innerHTML = '<div class="panel olm-panel"><div class="olx-skel"></div></div>';
    narr.insertAdjacentElement('afterend', sec);
    sec.addEventListener('click', onClick);
    var my = ++seq; results = []; drills = []; lastDays = days();
    waitForPage(my, function () {
      if (all) C.modules().then(function (mods) { if (!alive(my)) return; start(my, lensApps(PR.installed(mods))); }, function () { if (alive(my)) sec.hidden = true; });
      else start(my, list);
    });
  }
  /* wait until the executive page says "as of …" (its own queries are done), so we never slow it down */
  function waitForPage(my, go) {
    clearInterval(poll); var n = 0;
    poll = setInterval(function () {
      if (!alive(my)) { clearInterval(poll); return; }
      var t = $('olxAsOf'); n++;
      if ((t && /^as of/.test(t.textContent)) || n > 200) { clearInterval(poll); go(); }
    }, 250);
  }
  function start(my, list) {
    if (!alive(my)) return;
    apps = list;
    if (!list.length) { sec.hidden = true; return; }
    results = new Array(list.length); paint(true);
    job = SC.run(ctx, list, { days: lastDays, coverage: true, concurrency: 3, onModule: function (r, i) { if (!alive(my)) return; results[i] = r; paint(true); } });
    job.promise.then(function () { if (alive(my)) paint(false); });
  }

  /* ── clicks ──────────────────────────────────────────────────────────── */
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-sd],[data-open],[data-act]');
    if (!t || !sec.contains(t)) return;
    if (t.hasAttribute('data-sd')) {
      var d = drills[+t.getAttribute('data-sd')]; if (!d || !window.DVDrill) { if (!window.DVDrill) toast('Drill Explorer is unavailable. Reload DashView and try again.'); return; }
      var spec = d.al ? SC.drillAlert(ctx, d.res, d.al) : d.rec ? { title: d.res.title + ' \u00B7 all records', model: d.rec, domain: [], kind: 'count' } : SC.drillKpi(ctx, d.res, d.p);
      if (spec) window.DVDrill.open(spec, t);
    } else if (t.hasAttribute('data-open')) {
      var sel = $('odooLiveModuleSelect'), has = function (v) { return v && sel && Array.prototype.some.call(sel.options, function (o) { return o.value === v; }); };
      var pick = has(t.getAttribute('data-open')) ? t.getAttribute('data-open') : has(t.getAttribute('data-key')) ? t.getAttribute('data-key') : null;
      if (pick) { sel.value = pick; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (t.getAttribute('data-act') === 'copy') copyBrief(t);
    else if (t.getAttribute('data-act') === 'csv') exportCsv();
  }
  function done() { return results.filter(Boolean); }
  function copyBrief(btn) {
    if (!done().length) { toast('Nothing to copy yet \u2014 still loading.'); return; }
    var text = SC.briefText(ctx, done(), periodText()), ok = function () { toast('Executive brief copied.'); if (btn) { var o = btn.textContent; btn.textContent = 'Copied \u2713'; setTimeout(function () { btn.textContent = o; }, 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { toast('Copy is blocked in this browser.'); });
    else toast('Copy is not available in this browser.');
  }
  function exportCsv() {
    var rs = done(); if (!rs.length) { toast('Nothing to export yet \u2014 still loading.'); return; }
    var rows = [['Module', 'Status', 'Score', 'Headline KPI', 'Value', 'Change %', 'Open alerts', 'Records', 'New this period', 'New previous period', 'Last activity (UTC)']];
    rs.forEach(function (r) {
      var h = r.head, open = (r.alerts || []).reduce(function (s, a) { return s + (a.count || 0); }, 0), c = r.cov || {};
      rows.push([r.title, SC.STATUS[r.status], r.score == null ? '' : r.score, h ? h.label : '', h && h.readable ? SC.fmt(ctx, h, h.cur) : '', h && h.delta != null ? h.delta.toFixed(1) : '', open, c.total == null ? '' : c.total, c.fresh == null ? '' : c.fresh, c.freshPrev == null ? '' : c.freshPrev, c.last || '']);
    });
    rows.push([], ['Period', 'Last ' + periodText() + ' vs the previous ' + periodText()]);
    F.download('module-scorecard-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
    if (window.DVSec) window.DVSec.log('Exported executive scorecard', 'Module scorecard CSV');
  }

  /* ── render: company table ───────────────────────────────────────────── */
  function chg(a, b) {
    if (a == null) return '';
    if (b == null) return '';
    if (!b) return a ? '<i class="dvsc-d flat">new</i>' : '';
    var d = (a - b) / b * 100; if (Math.abs(d) < 1) return '<i class="dvsc-d flat">\u2248</i>';
    return '<i class="dvsc-d ' + (d > 0 ? 'good' : 'bad') + '">' + (d > 0 ? '\u25B2 ' : '\u25BC ') + (Math.abs(d) >= 1000 ? '>999' : Math.abs(d).toFixed(0)) + '%</i>';
  }
  function dchip(p) {
    if (!p || p.delta == null) return '';
    return '<i class="dvsc-d ' + (p.flat || p.good == null ? 'flat' : p.good ? 'good' : 'bad') + '">' + (p.delta >= 0 ? '\u25B2 ' : '\u25BC ') + SC.pctAbs(p.delta) + '</i>';
  }
  function alertCell(r) {
    var open = (r.alerts || []).filter(function (a) { return a.count > 0; });
    if (!(r.spec.alerts || []).length) return '<span class="olm-mute">\u2013</span>';
    if (!open.length) return '<span class="olm-ok">\u2713 none</span>';
    return open.slice(0, 2).map(function (a) {
      var id = dr({ res: r, al: a });
      return '<button type="button" class="olm-pill tone-' + (a.tone === 'bad' ? 'bad' : 'warn') + '" data-sd="' + id + '" title="' + esc(a.label + (a.hint ? ' \u2014 ' + a.hint : '')) + '"><b>' + F.num(a.count, 0) + '</b> ' + esc(a.label) + '</button>';
    }).join('') + (open.length > 2 ? '<span class="olm-mute">+' + (open.length - 2) + ' more</span>' : '');
  }
  function row(r, app) {
    var title = app.spec.title;
    if (!r) return '<tr class="is-loading"><th scope="row"><span class="olm-mod"><span class="ovm-ic tone-na">' + SC.icon(app.key) + '</span><b>' + esc(title) + '</b></span></th><td colspan="7"><div class="olx-skel olm-skel"></div></td></tr>';
    var h = r.head, hid = h && h.readable ? dr({ res: r, p: h }) : null, c = r.cov || {};
    var tone = r.status, a = ageDays(c.last), stale = a != null && a > STALE_DAYS;
    var head = h && h.readable ? '<button type="button" class="olm-head" data-sd="' + hid + '" aria-label="Open the records behind ' + esc(r.title + ' ' + h.label) + '"><span>' + esc(h.label) + '</span><b>' + esc(SC.fmt(ctx, h, h.cur)) + '</b>' + dchip(h) + '</button>' : '<span class="olm-mute">' + (r.status === 'na' ? 'Not readable' : '\u2013') + '</span>';
    var rec = c.total == null ? '<span class="olm-mute">\u2013</span>' : '<button type="button" class="olm-rec" data-sd="' + dr({ res: r, rec: c.model }) + '" title="Open all ' + esc(c.model) + ' records"><b>' + F.num(c.total, 0) + '</b><small>' + esc(c.model) + '</small></button>';
    return '<tr class="tone-' + tone + '"><th scope="row"><button type="button" class="olm-mod" data-open="' + esc(r.tech) + '" data-key="' + esc(r.key) + '" title="Open ' + esc(r.title) + ' in Odoo Live"><span class="ovm-ic tone-' + tone + '">' + SC.icon(r.key) + '</span><b>' + esc(r.title) + '</b><small>' + esc(r.tech) + '</small></button></th>' +
      '<td><span class="dvsc-chip tone-' + tone + '" title="' + (r.score == null ? 'No readable data' : 'Score ' + r.score + ' of 100') + '">' + esc(SC.STATUS[tone]) + (r.score != null ? ' \u00B7 ' + r.score : '') + '</span></td>' +
      '<td>' + head + '</td>' +
      '<td class="olm-sp">' + (r.trend && r.trend.values.some(function (v) { return v; }) ? SC.spark(r.trend.values, tone) : '<span class="olm-mute">\u2013</span>') + '</td>' +
      '<td>' + alertCell(r) + '</td><td class="olm-r">' + rec + '</td>' +
      '<td class="olm-r">' + (c.fresh == null ? '<span class="olm-mute">\u2013</span>' : '<b>' + F.num(c.fresh, 0) + '</b> ' + chg(c.fresh, c.freshPrev)) + '</td>' +
      '<td class="olm-r' + (stale ? ' is-stale' : '') + '">' + (c.last ? esc(ago(c.last)) : '<span class="olm-mute">\u2013</span>') + (stale ? '<small>quiet for over ' + STALE_DAYS + ' days</small>' : '') + '</td></tr>';
  }
  function notes(rs) {
    var quiet = rs.filter(function (r) { return r.cov && r.cov.fresh === 0 && r.cov.total > 0; }).map(function (r) { return r.title; });
    var stale = rs.filter(function (r) { var a = ageDays(r.cov && r.cov.last); return a != null && a > STALE_DAYS; }).map(function (r) { return r.title; });
    var unread = rs.filter(function (r) { return r.status === 'na'; }).map(function (r) { return r.title; });
    var out = [];
    if (quiet.length) out.push('<li><b>No new records in the last ' + esc(periodText()) + ':</b> ' + esc(quiet.join(', ')) + '. Check the app is still being used.</li>');
    if (stale.length) out.push('<li><b>No activity for over ' + STALE_DAYS + ' days:</b> ' + esc(stale.join(', ')) + '.</li>');
    if (unread.length) out.push('<li><b>Not readable by this Odoo user:</b> ' + esc(unread.join(', ')) + '. Grant read access if they should appear.</li>');
    return out.length ? '<ul class="olm-notes">' + out.join('') + '</ul>' : '';
  }
  function paintAll(loading) {
    var rs = done(), h = SC.health(rs), total = apps.length;
    var cnt = '<span class="olm-cnt is-good"><b>' + h.counts.good + '</b>Healthy</span><span class="olm-cnt is-watch"><b>' + h.counts.watch + '</b>Watch</span><span class="olm-cnt is-bad"><b>' + h.counts.bad + '</b>Action</span>';
    sec.innerHTML = '<div class="panel olm-panel"><div class="olm-head2"><div><h3>Module scorecard <small>' + (loading ? 'reading ' + rs.length + ' of ' + total + ' apps\u2026' : total + ' app' + (total === 1 ? '' : 's') + ' \u00B7 last ' + esc(periodText()) + ' vs previous \u00B7 rule-based') + '</small></h3>' +
      '<p>Business health <b class="tone-' + h.tone + '">' + (h.score == null ? '\u2013' : h.score + '/100 \u00B7 ' + esc(h.label)) + '</b></p></div>' +
      '<div class="olm-tools">' + cnt + '<button type="button" class="btn btn-outline btn-sm" data-act="copy">Copy brief</button><button type="button" class="btn btn-outline btn-sm" data-act="csv">Export CSV</button></div></div>' +
      '<div class="table-wrap olm-wrap" tabindex="0" aria-label="Module scorecard, scrolls sideways on small screens"><table class="dash-table olm-table"><thead><tr><th scope="col">Module</th><th scope="col">Status</th><th scope="col">Headline</th><th scope="col">12-month trend</th><th scope="col">Open alerts</th><th scope="col" class="olm-r">Records</th><th scope="col" class="olm-r">New this period</th><th scope="col" class="olm-r">Last activity</th></tr></thead><tbody>' +
      apps.map(function (a, i) { return row(results[i], a); }).join('') + '</tbody></table></div>' + (loading ? '' : notes(rs)) + '</div>';
  }

  /* ── render: one module's facts ──────────────────────────────────────── */
  function paintOne(loading) {
    var r = results[0], app = apps[0];
    if (!r) { sec.innerHTML = '<div class="panel olm-panel"><div class="olx-skel"></div></div>'; return; }
    var c = r.cov || {}, open = (r.alerts || []).reduce(function (s, a) { return s + (a.count || 0); }, 0), a = ageDays(c.last), stale = a != null && a > STALE_DAYS, tone = r.status;
    var tile = function (cls, label, val, note, sd) {
      return '<' + (sd != null ? 'button type="button" data-sd="' + sd + '"' : 'div') + ' class="olm-tile ' + cls + '"><span>' + label + '</span><b>' + val + '</b><em>' + note + '</em></' + (sd != null ? 'button' : 'div') + '>';
    };
    var first = (r.alerts || []).filter(function (x) { return x.count > 0; })[0];
    sec.innerHTML = '<div class="panel olm-panel"><div class="olm-head2"><div><h3>' + esc(r.title) + ' facts <small>last ' + esc(periodText()) + ' vs previous \u00B7 ' + esc(c.model || '') + '</small></h3>' +
      (r.reasons && r.reasons.length ? '<p>' + esc(r.reasons[0].text) + '</p>' : '<p>Stable \u2014 no significant movement.</p>') + '</div><div class="olm-tools"><span class="dvsc-chip tone-' + tone + '">' + esc(SC.STATUS[tone]) + (r.score != null ? ' \u00B7 ' + r.score : '') + '</span></div></div>' +
      '<div class="olm-tiles">' +
      tile('', 'Records', c.total == null ? '\u2013' : F.num(c.total, 0), esc(c.model || ''), c.model ? dr({ res: r, rec: c.model }) : null) +
      tile('', 'New this period', c.fresh == null ? '\u2013' : F.num(c.fresh, 0) + ' ' + chg(c.fresh, c.freshPrev), c.freshPrev == null ? '' : 'Previous period: ' + F.num(c.freshPrev, 0)) +
      tile(stale ? 'is-stale' : '', 'Last activity', c.last ? esc(ago(c.last)) : '\u2013', stale ? 'Quiet for over ' + STALE_DAYS + ' days' : c.last ? esc(String(c.last).slice(0, 16)) + ' UTC' : '') +
      tile(open ? 'tone-' + ((r.alerts || []).some(function (x) { return x.count > 0 && x.tone === 'bad'; }) ? 'bad' : 'warn') : 'tone-good', 'Open alerts', F.num(open, 0), first ? esc(first.label) : (r.spec.alerts || []).length ? 'Nothing needs attention' : 'No alerts defined', first ? dr({ res: r, al: first }) : null) + '</div>' + (loading ? '<p class="olm-load">Reading\u2026</p>' : '') + '</div>';
  }
  function paint(loading) { drills = []; if (!sec) return; if (mode === 'one') paintOne(loading); else paintAll(loading); }

  /* ── wiring ──────────────────────────────────────────────────────────── */
  var pending = 0;
  new MutationObserver(function () { cancelAnimationFrame(pending); pending = requestAnimationFrame(tryMount); }).observe(host, { childList: true });
  tryMount();
  document.addEventListener('dv:locked', function () { seq++; if (job) job.cancel(); clearInterval(poll); });
  window.DVExecModules = { results: function () { return done(); }, mode: function () { return mode; } };
})();
