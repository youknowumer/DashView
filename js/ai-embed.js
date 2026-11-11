/* ==========================================================================
   DashView — AI Assistant workspace (#view-ai in dashboard.html)  ·  v2.13
   --------------------------------------------------------------------------
   One AI tab inside the dashboard menu. Three panes:
     chats      saved in this browser, searchable, migrated from the old ai.html
     conversation   local engine for general help, hosted provider when set up,
                guarded read-only Odoo agent for company-data questions, and
                instant reports for attached files (CSV / Excel / JSON / TXT)
     details    Path (how an answer was produced → drill into groups → records
                → a record, with Open in Odoo links), Connection (live Odoo
                and provider health) and Files (report, reconcile with Odoo)

   Routes (all inside dashboard.html):
     #ai                         last chat
     #ai/c/<chat>                a chat
     #ai/c/<chat>/m/<answer>     a chat with one answer's path selected
     #ai/t/connection | files    open the details pane on that tab
   ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var root = document.getElementById('aiw');
    if (!root) return; // view-ai isn't on this page

    function $(id) { return document.getElementById(id); }
    var el = {
      route: $('aiwRoute'), odooChip: $('aiwOdooChip'), provChip: $('aiwProvChip'), threads: $('aiwThreads'), search: $('aiwSearch'),
      messages: $('aiwMessages'), tray: $('aiwTray'), input: $('aiwInput'), send: $('aiwSend'), file: $('aiwFile'), drop: $('aiwDrop'),
      main: $('aiwMain'), insp: $('aiwInsp'), inspBody: $('aiwInspBody'), inspTabs: $('aiwInspTabs'), inspBtn: $('aiwInspBtn'), artBtn: $('aiwArtBtn'),
      scrim: $('aiwScrim'), view: $('view-ai'), title: root.querySelector('.aiw-title'), railNote: $('aiwRailNote')
    };
    var STORE_KEY = 'dv-ai-workspace-v2', LEGACY_KEY = 'al_convos', MIGRATED_KEY = 'dv-ai-workspace-migrated';

    var S = {
      threads: [], activeId: null, draft: null, selMsg: null, tab: 'path', stack: [], filter: '',
      files: Object.create(null),      // fileId -> { file, report }   (kept for this page session only)
      pending: [],                      // attachments waiting in the composer
      health: null, healthAt: 0, healthBusy: false, provider: { outcome: 'untested', ms: null, at: 0, error: '' },
      busy: false, thinking: null, openQ: Object.create(null), uid: 0, fieldCache: Object.create(null)
    };
    var dashboardPayloads = Object.create(null), dashboardIds = 0, agentLoading = null;

    /* ── tiny utilities ─────────────────────────────────────────────────── */
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function uid(p) { return (p || 'x') + Date.now().toString(36) + (++S.uid).toString(36) + Math.random().toString(36).slice(2, 5); }
    function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function toast(m) { if (window.showToast) window.showToast(m); }
    function fmtTime(ts) { return new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    function relTime(ts) {
      var d = Date.now() - ts;
      if (d < 60000) return 'just now';
      if (d < 3600000) return Math.round(d / 60000) + 'm ago';
      if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
      return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
    }
    function fmtMs(ms) { return ms == null ? '' : ms < 950 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'; }
    function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
    function fmtVal(v) {
      if (typeof v !== 'number' || !isFinite(v)) return esc(v == null ? '' : v);
      var a = Math.abs(v);
      return (a >= 1000 || Number.isInteger(v)) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100);
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { toast('Copied.'); }, function () { toast('Copy was blocked by the browser.'); });
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied.'); } catch (e) { toast('Copy was blocked by the browser.'); }
      document.body.removeChild(ta); return Promise.resolve();
    }
    function download(name, text, mime) {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
    var ICON = {
      spark: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M7 13l3-5 2 3 2-4 3 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      db: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
      board: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>',
      file: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
      link: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.8"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.8"/></svg>',
      pulse: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>'
    };

    // Turns one ```chart fenced block into a horizontal bar chart. Expected
    // shape (see js/ai-company-context.js's reporting instructions):
    //   ```chart
    //   Optional title
    //   Label one: 12345
    //   Label two: 9876
    //   ```
    // Returns an HTML string, or null if fewer than 2 lines parse as
    // "label <: or |> number", in which case the caller leaves the block
    // untouched so it still renders as plain code instead of vanishing.
    // NOTE: this runs on text esc() has already escaped once (see below) —
    // do not esc() the label/value again here, or entities double-escape.
    function renderChartBlock(raw) {
      var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var rowRe = /^(.+?)\s*[:|]\s*[$€£₹]?\s*([+-]?[\d,]*\.?\d+)\s*%?$/;
      var PALETTE = (typeof window !== 'undefined' && window.DVFmt && window.DVFmt.PALETTE && window.DVFmt.PALETTE.length >= 8) ? window.DVFmt.PALETTE : ['#ff9f0a', '#0a84ff', '#bf5af2', '#63e6e2', '#ffd60a', '#7d7aff', '#40c8e0', '#ac8e68', '#64d2ff', '#98989d'];
    
      // Optional first line "type: bar | line | donut" (default bar).
      var kind = 'bar';
      if (lines.length && /^type\s*:\s*(bar|line|donut)$/i.test(lines[0])) {
        kind = lines.shift().split(':')[1].trim().toLowerCase();
      }
      var title = '';
      if (lines.length && !rowRe.test(lines[0])) title = lines.shift();
    
      var rows = lines.map(function (l) {
        var m = l.match(rowRe);
        if (!m) return null;
        return { label: m[1].trim(), value: parseFloat(m[2].replace(/,/g, '')) };
      }).filter(function (r) { return r && isFinite(r.value); }).slice(0, kind === 'line' ? 24 : 8);
    
      if (rows.length < 2) return null;
    
      function fmt(v) {
        var rounded = Math.round(v);
        return (Math.abs(v - rounded) < 0.005 ? rounded : v).toLocaleString();
      }
      var titleHtml = title ? '<div class="ai-chart-title">' + (title) + '</div>' : '';
      var vals = rows.map(function (r) { return r.value; });
    
      if (kind === 'line') {
        var W = 560, H = 190, L = 10, R = 14, T = 22, B = 26;
        var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
        var span = (mx - mn) || 1;
        var n = rows.length;
        var pts = rows.map(function (r, i) {
          return { x: L + i * (W - L - R) / (n - 1), y: T + (1 - (r.value - mn) / span) * (H - T - B) };
        });
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
        var area = d + ' L' + pts[n - 1].x.toFixed(1) + ' ' + (H - B) + ' L' + pts[0].x.toFixed(1) + ' ' + (H - B) + ' Z';
        var step = Math.ceil(n / 6);
        var xl = rows.map(function (r, i) {
          if (i % step && i !== n - 1) return '';
          return '<text x="' + pts[i].x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle')) + '">' + (r.label) + '</text>';
        }).join('');
        var iMax = vals.indexOf(mx), iLast = n - 1;
        var tags = [iMax].concat(iLast !== iMax ? [iLast] : []).map(function (i) {
          return '<text class="ai-chart-pt" x="' + Math.min(Math.max(pts[i].x, 30), W - 30).toFixed(1) + '" y="' + (pts[i].y - 8).toFixed(1) + '" text-anchor="middle">' + (fmt(rows[i].value)) + '</text>';
        }).join('');
        var dots = pts.map(function (p) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"/>'; }).join('');
        return '<div class="ai-chart">' + titleHtml +
          '<svg class="ai-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + (title || 'Line chart') + '">' +
          '<line class="ai-chart-axis" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/>' +
          '<path class="ai-chart-area" d="' + area + '"/><path class="ai-chart-line" d="' + d + '"/>' + dots + xl + tags + '</svg></div>';
      }
    
      if (kind === 'donut') {
        var total = vals.reduce(function (a, v) { return a + Math.abs(v); }, 0) || 1;
        var acc = 0;
        var stops = rows.map(function (r, i) {
          var from = acc / total * 100; acc += Math.abs(r.value); var to = acc / total * 100;
          return PALETTE[i % PALETTE.length] + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%';
        }).join(', ');
        var legend = rows.map(function (r, i) {
          return '<div class="ai-donut-item" role="button" tabindex="0" data-act="chart-ask" data-label="' + r.label + '" data-title="' + title + '" title="Click to dig into this slice"><span class="ai-donut-dot" style="background:' + PALETTE[i % PALETTE.length] + '"></span>' +
            '<span class="ai-donut-label">' + (r.label) + '</span>' +
            '<span class="ai-chart-value">' + (fmt(r.value)) + ' · ' + (Math.abs(r.value) / total * 100).toFixed(1) + '%</span></div>';
        }).join('');
        return '<div class="ai-chart">' + titleHtml + '<div class="ai-donut-wrap"><div class="ai-donut" style="background:conic-gradient(' + stops + ')"><span></span></div>' +
          '<div class="ai-donut-legend">' + legend + '</div></div></div>';
      }
    
      var max = Math.max.apply(null, vals.map(Math.abs)) || 1;
      var barsHtml = rows.map(function (r) {
        var pct = Math.max((Math.abs(r.value) / max) * 100, 3);
        return '<div class="ai-chart-row" role="button" tabindex="0" data-act="chart-ask" data-label="' + r.label + '" data-title="' + title + '" title="Click to dig into this row">' +
          '<span class="ai-chart-label">' + (r.label) + '</span>' +
          '<span class="ai-chart-bar-track"><span class="ai-chart-bar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
          '<span class="ai-chart-value">' + (fmt(r.value)) + '</span></div>';
      }).join('');
      return '<div class="ai-chart">' + titleHtml + barsHtml + '</div>';
    }
    
    // ```kpi block: one card per line, "Label: value | change" (change optional, e.g. "+12.4% vs last month").
    function renderKpiBlock(raw) {
      var cards = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 6).map(function (l) {
        var i = l.indexOf(':');
        if (i < 1) return null;
        var parts = l.slice(i + 1).split('|').map(function (s) { return s.trim(); });
        if (!parts[0]) return null;
        var delta = parts[1] || '';
        var cls = /^[+▲↑]/.test(delta) ? ' up' : (/^[-−▼↓]/.test(delta) ? ' down' : '');
        return '<div class="ai-kpi"><div class="ai-kpi-label">' + (l.slice(0, i).trim()) + '</div>' +
          '<div class="ai-kpi-value">' + (parts[0]) + '</div>' +
          (delta ? '<div class="ai-kpi-delta' + cls + '">' + (delta) + '</div>' : '') + '</div>';
      }).filter(Boolean);
      return cards.length ? '<div class="ai-kpi-grid">' + cards.join('') + '</div>' : null;
    }
    

    // Dashboard artifact (Odoo query results). Rows that carry Odoo's own group domain — or a file drill — get a
    // Drill button, so any number can be traced to the records behind it.
    function renderDashboard(payload, narrative) {
      if (!payload || payload.version !== 1 || !Array.isArray(payload.metrics) || !payload.metrics.length) return null;
      var id = 'embed-dashboard-' + (++dashboardIds);
      var insightsText = String(narrative || '').replace(/\n\n\*Live Odoo ·[^*]*\*/g, '').replace(/```[\s\S]*?```/g, '').replace(/^\s*#{1,6}\s*/gm, '').replace(/[*_`]/g, '').replace(/\|/g, ' · ').replace(/\n{3,}/g, '\n\n').slice(0, 12000).trim();
      dashboardPayloads[id] = Object.assign({}, payload, { insightsText: insightsText });
      var known = Object.keys(dashboardPayloads);
      if (known.length > 20) delete dashboardPayloads[known[0]];
      var date = new Date(payload.generatedAt);
      var generated = isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
      var metrics = payload.metrics.map(function (metric, mi) {
        var rows = (metric.rows || []).filter(function (r) { return r && isFinite(Number(r.value)); }).slice(0, 24);
        if (!rows.length) return '';
        var drillable = rows.some(function (r) { return Array.isArray(r.domain) && metric.model; });
        var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(Number(r.value)); })) || 1;
        var bars = rows.map(function (r, ri) {
          var can = Array.isArray(r.domain) && metric.model;
          return '<div class="ai-dashboard-bar-row' + (can ? ' is-drill' : '') + '"' + (can ? ' data-act="dash-drill" data-dash="' + id + '" data-mi="' + mi + '" data-ri="' + ri + '" role="button" tabindex="0" title="Drill into these records"' : '') + '><span class="ai-dashboard-bar-label">' + esc(r.label || '') + '</span><span class="ai-dashboard-bar-track"><span class="ai-dashboard-bar-fill" style="width:' + Math.max(3, Math.abs(Number(r.value)) / max * 100).toFixed(1) + '%"></span></span><strong>' + esc(r.value) + '</strong></div>';
        }).join('');
        var tableRows = rows.map(function (r, ri) {
          var can = Array.isArray(r.domain) && metric.model;
          return '<tr><th scope="row">' + esc(r.label || '') + '</th><td>' + esc(r.value) + '</td><td>' + (r.count == null ? '—' : esc(r.count)) + '</td>' +
            (drillable ? '<td>' + (can ? '<button type="button" class="ai-drill-btn" data-act="dash-drill" data-dash="' + id + '" data-mi="' + mi + '" data-ri="' + ri + '">Drill ›</button>' : '') + '</td>' : '') + '</tr>';
        }).join('');
        var visual = '<div class="ai-dashboard-bars" role="img" aria-label="' + esc(metric.title || 'Metric') + ' bar chart; exact values are listed in the table below">' + bars + '</div>';
        if (metric.chartType === 'line' && rows.length > 1) {
          var low = Math.min.apply(null, rows.map(function (r) { return Number(r.value); }));
          var high = Math.max.apply(null, rows.map(function (r) { return Number(r.value); }));
          var span = high - low || 1;
          var points = rows.map(function (r, i) { return { x: 28 + i * 504 / (rows.length - 1), y: 104 - (Number(r.value) - low) / span * 66 }; });
          var path = points.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
          var step = Math.ceil(rows.length / 6), maxIndex = rows.reduce(function (best, r, i, all) { return Number(r.value) > Number(all[best].value) ? i : best; }, 0);
          var marks = points.map(function (p, i) {
            return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"/>' +
              (i % step === 0 || i === rows.length - 1 ? '<text x="' + p.x.toFixed(1) + '" y="128" text-anchor="middle">' + esc(String(rows[i].label).slice(0, 14)) + '</text>' : '') +
              (i === maxIndex || i === rows.length - 1 ? '<text x="' + p.x.toFixed(1) + '" y="' + Math.max(16, p.y - 8).toFixed(1) + '" text-anchor="middle">' + esc(String(rows[i].value)) + '</text>' : '');
          }).join('');
          visual = '<svg class="ai-dashboard-line" viewBox="0 0 560 140" role="img" aria-label="' + esc(metric.title || 'Metric') + ' line chart; exact values are listed in the table below"><line x1="20" y1="110" x2="540" y2="110"/><path d="' + path + '"/>' + marks + '</svg>';
        }
        return '<section class="ai-dashboard-metric"><h3>' + esc(metric.title || metric.model || 'Odoo metric') + '</h3>' +
          visual +
          '<table class="ai-dashboard-table"><caption>' + esc(metric.title || 'Metric') + ' — exact returned Odoo values</caption><thead><tr><th scope="col">Group</th><th scope="col">' + esc(metric.measure || 'Value') + '</th><th scope="col">Records</th>' + (drillable ? '<th scope="col">Drill</th>' : '') + '</tr></thead><tbody>' + tableRows + '</tbody></table></section>';
      }).join('');
      var kpis = (payload.kpis || []).filter(function (k) { return k && isFinite(Number(k.value)); }).map(function (k) {
        return '<div class="ai-kpi"><div class="ai-kpi-label">' + esc(k.label || '') + '</div><div class="ai-kpi-value">' + esc(k.value) + '</div><div class="ai-kpi-delta">' + esc(k.queryId || 'Odoo result') + '</div></div>';
      }).join('');
      var methods = (payload.methods || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      var limits = (payload.limitations || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      return '<section class="ai-dashboard-artifact" aria-label="Odoo data dashboard" data-ai-dashboard-id="' + id + '">' +
        '<header class="ai-dashboard-head"><div><h2>' + esc(payload.title || 'Odoo dashboard') + '</h2><div class="ai-dashboard-meta">Generated ' + esc(generated) + ' · ' + esc(payload.source || 'Live Odoo query results') + (payload.currency ? ' · Currency: ' + esc(payload.currency) : '') + '</div></div>' +
        '<div class="ai-dashboard-actions"><button type="button" data-ai-dashboard-export>Export board-ready PDF</button><button type="button" data-ai-dashboard-xlsx>Export Excel workbook</button><button type="button" data-ai-dashboard-print>Print / Save as PDF</button></div></header>' +
        (kpis ? '<div class="ai-kpi-grid">' + kpis + '</div>' : '') + metrics +
        '<div class="ai-dashboard-notes">' + (insightsText ? '<h3>Executive read-out</h3><div class="ai-dashboard-readout">' + esc(insightsText) + '</div>' : '') + '<h3>Method and sources</h3><ul>' + (methods || '<li>Read-only Odoo query results</li>') + '</ul><h3>Limitations</h3><ul>' + (limits || '<li>Only returned data is represented; no missing values are estimated.</li>') + '</ul></div></section>';
    }

    function renderMarkdown(text, liveOdoo) {
      text = String(text == null ? '' : text).replace(/\u0000/g, '');
      if (liveOdoo) text = text.replace(/```(?:kpi|chart|dashboard)\s*\r?\n[\s\S]*?```/gi, '');
      var stash = [];   // code blocks are set aside so headings / lists / bold are never applied inside them
      var T = (typeof window !== 'undefined' && window.DVAITemplate) || null;
      // Table cells: numbers right-aligned, signed changes coloured (only in "vs / change" columns), High/Medium/Low as chips.
      var NUMRE = /^(?:[A-Za-z]{2,4}\.?\s?|[$€£₹]\s?)?[+\-−]?\d[\d,]*(?:\.\d+)?\s?[KMBT]?\s?%?(?:\s?(?:pts?|days?|d))?$/;
      function level(c) { var v = String(c).trim().toLowerCase(); return v === 'high' || v === 'critical' ? 'high' : (v === 'medium' || v === 'med' ? 'mid' : (v === 'low' ? 'low' : '')); }
      function td(c, kind, tag) {
        var v = String(c).trim(), cls = '', inner = c;
        if (kind === 'sem' && T && T.chipKind && T.chipKind(v)) inner = '<span class="aiw-lv" data-k="' + T.chipKind(v) + '">' + c + '</span>';
        else if (kind === 'lvl' && level(v)) inner = '<span class="aiw-lv" data-k="lvl-' + level(v) + '">' + c + '</span>';
        else if (NUMRE.test(v)) { cls = 'num'; if (kind === 'delta' && /^[+\-−]/.test(v)) cls += /^\+/.test(v) ? ' up' : ' down'; }
        return '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>' + inner + '</' + tag + '>';
      }
      return esc(text)
        .replace(/```kpi\n?([\s\S]*?)```/g, function (match, body) { return renderKpiBlock(body) || match; })
        .replace(/```chart\n?([\s\S]*?)```/g, function (match, body) { return renderChartBlock(body) || match; })
        .replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) { stash.push('<pre><code>' + code.trim() + '</code></pre>'); return '\u0000' + (stash.length - 1) + '\u0000'; })
        .replace(/((?:^\|.*\|[ \t]*(?:\n|$)){2,})/gm, function (block) {
          var lines = block.trim().split('\n').filter(Boolean);
          if (lines.length < 2 || !/^\|[\s:|-]+\|$/.test(lines[1].trim())) return block;
          var cells = function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
          var head = cells(lines[0]), body = lines.slice(2).map(cells);
          var kinds = head.map(function (h) { return /priority|status|read|risk|severity|level/i.test(h) ? 'sem' : (/effort|impact/i.test(h) ? 'lvl' : (/\bvs\b|change|growth|delta|Δ/i.test(h) ? 'delta' : '')); });
          var numCols = head.map(function (h, i) { return body.length && body.filter(function (r) { return NUMRE.test(String(r[i] || '').trim()); }).length >= Math.ceil(body.length / 2) ? ' class="num"' : ''; });
          return '<div class="aiw-md-table" role="region" tabindex="0" aria-label="Table"><table><thead><tr>' + head.map(function (c, i) { return '<th' + numCols[i] + '>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
            body.map(function (r) { return '<tr>' + r.map(function (c, i) { return td(c, kinds[i], 'td'); }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        })
        .replace(/^[ \t]*\d+[.)] (.+)$/gm, '<li data-o>$1</li>')
        .replace(/(<li data-o>.*<\/li>\n?)+/g, function (m) { return '<ol>' + m.replace(/ data-o/g, '').replace(/\n/g, '') + '</ol>'; })
        .replace(/^[ \t]*[\-\*•] (.+)$/gm, '<li data-b>$1</li>')
        .replace(/(<li data-b>.*<\/li>\n?)+/g, function (m) { return '<ul>' + m.replace(/ data-b/g, '').replace(/\n/g, '') + '</ul>'; })
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^#{1,2} (.+)$/gm, function (_, t) { var k = T && T.classifyHeading ? T.classifyHeading(t.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '')) : ''; return '<h2 class="aiw-h"' + (k ? ' data-sec="' + k + '"' : '') + '>' + t + '</h2>'; })
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/<blockquote><strong>([^<]{2,28}?):?<\/strong>:?\s*([\s\S]*?)<\/blockquote>/g, function (m, label, body) {
          var k = T && T.calloutKind ? T.calloutKind(label) : '';
          return k ? '<aside class="aiw-callout" data-k="' + k + '"><b class="aiw-callout-l">' + label + '</b><span>' + body + '</span></aside>' : m;
        })
        .replace(/^---$/gm, '<hr/>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br/>')
        .replace(/\u0000(\d+)\u0000/g, function (_, i) { return stash[+i] || ''; })
        .replace(/(<\/(?:h2|h3|ul|ol|aside|blockquote|pre|div)>|<hr\/>)(?:<br\/>)+/g, '$1')
        .replace(/(?:<br\/>)+(<(?:h2|h3|ul|ol|aside|div|pre)\b)/g, '$1')
        .replace(/<\/p><p>(?=<(?:h2|h3|ul|ol|aside|div|pre|hr)\b)/g, '')
        .replace(/(<\/(?:h2|h3|ul|ol|aside|div|pre)>|<hr\/>)<\/p>/g, '$1')
        .replace(/<p>(?=<(?:h2|h3|ul|ol|aside|div|pre|hr)\b)/g, '');
    }

    /* ── provider / Odoo state ──────────────────────────────────────────── */
    function providerInfo() {
      var C = window.DVAIConfig, cfg = C && C.get ? C.get() : {}, configured = !!(C && C.isConfigured && C.isConfigured());
      var meta = (C && C.PROVIDERS && C.PROVIDERS[cfg.provider]) || {};
      return {
        configured: configured, provider: cfg.provider || 'offline', label: configured ? (meta.label || cfg.provider) : 'Local engine',
        model: configured && C.activeModel ? (C.activeModel() || '') : '', hosted: configured && cfg.provider !== 'dashview',
        includeCtx: cfg.includeCompanyContext !== false, systemPrompt: cfg.systemPrompt || ''
      };
    }
    function odooInfo() {
      var O = window.DVOdoo, connected = !!(O && O.isConnected && O.isConnected()), cfg = {};
      try { cfg = (O && O.getConfig && O.getConfig()) || {}; } catch (e) {}
      return { connected: connected, url: cfg.url ? String(cfg.url).replace(/\/+$/, '') : '', db: cfg.db || '' };
    }
    function recordLink(model, id) {
      var u = odooInfo().url;
      return /^https?:\/\//i.test(u) ? u + '/web#id=' + encodeURIComponent(id) + '&model=' + encodeURIComponent(model) + '&view_type=form' : '';
    }
    function loadOdooAgent() {
      if (window.DVOdooAgent) return Promise.resolve(window.DVOdooAgent);
      if (agentLoading) return agentLoading;
      agentLoading = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'js/ai-odoo-agent.js';
        script.onload = function () { window.DVOdooAgent ? resolve(window.DVOdooAgent) : reject(new Error('Odoo query agent did not initialize.')); };
        script.onerror = function () { agentLoading = null; reject(new Error('Could not load the Odoo query agent.')); };
        document.head.appendChild(script);
      });
      return agentLoading;
    }

    function updateChips() {
      var o = odooInfo(), p = providerInfo(), oc = el.odooChip, pc = el.provChip;
      if (!o.connected) { oc.dataset.state = 'warn'; oc.querySelector('span').textContent = 'Odoo · not connected'; }
      else if (S.healthBusy && !S.health) { oc.dataset.state = 'busy'; oc.querySelector('span').textContent = 'Odoo · checking…'; }
      else if (S.health && S.health.ok) { oc.dataset.state = 'ok'; oc.querySelector('span').textContent = 'Odoo · live' + (S.health.latencyMs ? ' · ' + fmtMs(S.health.latencyMs) : ''); }
      else if (S.health) { oc.dataset.state = 'bad'; oc.querySelector('span').textContent = 'Odoo · ' + (S.health.stage || 'error'); }
      else { oc.dataset.state = 'unknown'; oc.querySelector('span').textContent = 'Odoo · connected'; }
      if (!p.configured) { pc.dataset.state = 'local'; pc.querySelector('span').textContent = 'Local engine'; }
      else if (S.provider.outcome === 'ok') { pc.dataset.state = 'ok'; pc.querySelector('span').textContent = p.label + ' · connected'; }
      else if (S.provider.outcome === 'error') { pc.dataset.state = 'bad'; pc.querySelector('span').textContent = p.label + ' · error'; }
      else { pc.dataset.state = 'unknown'; pc.querySelector('span').textContent = p.label + ' · not tested'; }
    }

    function checkHealth(force) {
      if (!odooInfo().connected) { S.health = null; updateChips(); return Promise.resolve(null); }
      if (S.healthBusy) return Promise.resolve(S.health);
      S.healthBusy = true; updateChips(); if (S.tab === 'connection' && isInspOpen()) renderInsp();
      return loadOdooAgent().then(function (a) { return a.health(!!force); }).then(function (h) { S.health = h; S.healthAt = Date.now(); return h; })
        .catch(function (e) { S.health = { ok: false, stage: 'agent', error: e.message, fix: 'Reload the page.', areas: [], checkedAt: Date.now() }; return S.health; })
        .then(function (h) { S.healthBusy = false; updateChips(); if (S.tab === 'connection' && isInspOpen()) renderInsp(); renderHeroStatusOnly(); return h; });
    }

    /* ── chat store ─────────────────────────────────────────────────────── */
    function slimMessage(m) {
      var c = Object.assign({}, m);
      if (c.report) { c.report = Object.assign({}, c.report); delete c.report.tables; c.report.tablesDropped = true; }
      if (c.trace && c.trace.queries) {
        c.trace = Object.assign({}, c.trace);
        c.trace.queries = c.trace.queries.map(function (q) { var x = Object.assign({}, q); if (x.rows) x.rows = x.rows.slice(0, 8); return x; });
      }
      return c;
    }
    function persist() {
      var payload = { activeId: S.activeId, threads: S.threads.slice(0, 40).map(function (t) { return { id: t.id, title: t.title, created: t.created, updated: t.updated, messages: t.messages.slice(-80).map(slimMessage) }; }) };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); }
      catch (e) {
        try { payload.threads = payload.threads.slice(0, 10); localStorage.setItem(STORE_KEY, JSON.stringify(payload)); toast('Browser storage is nearly full — only your 10 newest chats were kept.'); }
        catch (e2) { /* storage unavailable: chats stay for this page session */ }
      }
    }
    function loadStore() {
      try {
        var d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (d && Array.isArray(d.threads)) { S.threads = d.threads.filter(function (t) { return t && t.id && Array.isArray(t.messages); }); S.activeId = d.activeId; }
      } catch (e) { S.threads = []; }
      /* One-time import of chats from the old full-page assistant (ai.html) so nothing is lost. */
      try {
        if (!localStorage.getItem(MIGRATED_KEY)) {
          var old = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}'), n = 0;
          Object.keys(old).forEach(function (id) {
            var c = old[id]; if (!c || !Array.isArray(c.messages) || !c.messages.length) return;
            S.threads.push({
              id: 'legacy_' + id, title: c.title || clip(c.messages[0].content, 48) || 'Imported chat', created: c.updatedAt || Date.now(), updated: c.updatedAt || Date.now(),
              messages: c.messages.map(function (m, i) { return { id: uid('m'), role: m.role === 'user' ? 'user' : 'ai', content: String(m.content || ''), tag: m.tag || null, liveOdoo: !!m.liveOdoo, dashboard: m.dashboard || null, time: (c.updatedAt || Date.now()) - (c.messages.length - i) * 1000 }; })
            }); n++;
          });
          localStorage.setItem(MIGRATED_KEY, '1');
          if (n) { S.threads.sort(function (a, b) { return b.updated - a.updated; }); persist(); }
        }
      } catch (e) { /* ignore */ }
      S.threads.sort(function (a, b) { return b.updated - a.updated; });
    }
    function activeThread() {
      if (S.draft && S.draft.id === S.activeId) return S.draft;
      return S.threads.filter(function (t) { return t.id === S.activeId; })[0] || null;
    }
    function newDraft() { S.draft = { id: uid('c'), title: '', created: Date.now(), updated: Date.now(), messages: [] }; S.activeId = S.draft.id; return S.draft; }
    function ensureThread() {
      var t = activeThread() || newDraft();
      if (S.draft && S.draft.id === t.id) { S.threads.unshift(t); S.draft = null; }
      return t;
    }
    function findMsg(mid) {
      var t = activeThread(); if (!t) return null;
      for (var i = 0; i < t.messages.length; i++) if (t.messages[i].id === mid) return { m: t.messages[i], i: i, t: t };
      return null;
    }
    function pushMsg(role, content, extra) {
      var t = ensureThread();
      var m = Object.assign({ id: uid('m'), role: role, content: content, time: Date.now() }, extra || {});
      t.messages.push(m); t.updated = Date.now();
      if (!t.title && role === 'user') t.title = clip(String(content || (extra && extra.files && extra.files[0] ? extra.files[0].name : 'New chat')).replace(/\s+/g, ' ').trim(), 48);
      persist(); renderThreads(); renderRoute(); writeRoute();
      return m;
    }

    /* ── routing (#ai/c/<chat>/m/<answer>/t/<tab>) ──────────────────────── */
    function isAiView() { return el.view && el.view.classList.contains('active'); }
    function isInspOpen() { return root.dataset.insp === 'open'; }
    var lastWritten = '';
    function writeRoute() {
      if (!isAiView() || !history.replaceState) return;
      var parts = ['ai'], t = activeThread();
      if (t && t.messages.length) { parts.push('c', t.id); if (S.selMsg && isInspOpen()) parts.push('m', S.selMsg); }
      if (isInspOpen() && S.tab !== 'path') parts.push('t', S.tab);
      var h = '#' + parts.join('/');
      lastWritten = h;
      if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
    }
    function applyRoute() {
      var p = location.hash.slice(1).split('/');
      if (p[0] !== 'ai') return;
      if ('#' + p.join('/') === lastWritten) return;
      var kv = {}; for (var i = 1; i + 1 < p.length; i += 2) kv[p[i]] = decodeURIComponent(p[i + 1]);
      if (kv.c && kv.c !== S.activeId && S.threads.some(function (t) { return t.id === kv.c; })) { S.activeId = kv.c; S.draft = null; S.stack = []; renderAll(); }
      if (kv.m && findMsg(kv.m)) S.selMsg = kv.m;
      if (kv.t === 'connection' || kv.t === 'files') openInsp(kv.t, true);
      else if (kv.m) openInsp('path', true);
    }

    /* ── topic classification (chats + prompts are grouped by business area) ── */
    var CAT = {
      Sales:     { c: 'var(--ios-blue, #007AFF)', re: /sale|quotation|quote|customer|revenue|salesperson|order/i, ic: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>' },
      Finance:   { c: 'var(--ios-green, #34C759)', re: /invoice|receivable|payable|bill|cash|payment|overdue|aging|vendor|expense|profit|budget/i, ic: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>' },
      Inventory: { c: 'var(--ios-orange, #FF9500)', re: /stock|inventory|product|warehouse|delivery|deliveries|purchase|reorder|location/i, ic: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>' },
      Create:    { c: 'var(--ios-indigo, #5856D6)', re: /\bartifacts?\b/i, ic: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 11v6M9 14h6"/>' },
      CRM:       { c: 'var(--ios-purple, #AF52DE)', re: /pipeline|lead|opportunit|crm|won|lost|stage/i, ic: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>' },
      People:    { c: 'var(--ios-pink, #FF2D55)', re: /employee|headcount|leave|time off|applicant|position|hr\b|department|payroll|attendance/i, ic: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c2 .6 3 2.3 3 5.2"/>' },
      Files:     { c: 'var(--ios-teal, #30B0C7)', re: null, ic: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>' },
      Reports:   { c: 'var(--ios-indigo, #5E5CE6)', re: null, ic: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>' },
      General:   { c: 'var(--ios-gray, #8E8E93)', re: null, ic: '<path d="M21 12a8 8 0 0 1-11.7 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/>' }
    };
    function catIcon(k, sz) { return '<svg width="' + (sz || 14) + '" height="' + (sz || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + CAT[k].ic + '</svg>'; }
    function topicOf(t) {
      if (t.messages.some(function (m) { return (m.files && m.files.length) || m.report; })) return 'Files';
      var first = '';
      for (var i = 0; i < t.messages.length; i++) if (t.messages[i].role === 'user') { first = String(t.messages[i].content || ''); break; }
      var txt = (t.title || '') + ' ' + first;
      var best = 'General', top = 0;
      for (var k in CAT) {
        if (!CAT[k].re) continue;
        var hits = txt.match(new RegExp(CAT[k].re.source, 'gi'));
        if (hits && hits.length > top) { top = hits.length; best = k; }
      }
      return best;
    }

    /* ── thread list ────────────────────────────────────────────────────── */
    function renderThreads() {
      var q = S.filter.toLowerCase(), all = S.threads, counts = {};
      all.forEach(function (t) { var k = topicOf(t); counts[k] = (counts[k] || 0) + 1; });
      if (S.cat && S.cat !== 'All' && !counts[S.cat]) S.cat = 'All';
      var catsEl = $('aiwCats');
      if (catsEl) {
        var keys = Object.keys(CAT).filter(function (k) { return counts[k]; });
        catsEl.hidden = keys.length < 2;
        catsEl.innerHTML = ['All'].concat(keys).map(function (k) {
          var on = (S.cat || 'All') === k, col = k === 'All' ? 'var(--signal)' : CAT[k].c;
          return '<button type="button" class="aiw-cat' + (on ? ' active' : '') + '" data-act="cat" data-k="' + k + '" style="--c:' + col + '"><i></i>' + k + '<em>' + (k === 'All' ? all.length : counts[k]) + '</em></button>';
        }).join('');
      }
      var list = all.filter(function (t) {
        if (S.cat && S.cat !== 'All' && topicOf(t) !== S.cat) return false;
        return !q || (t.title || '').toLowerCase().indexOf(q) > -1 || t.messages.some(function (m) { return String(m.content || '').toLowerCase().indexOf(q) > -1; });
      });
      if (!list.length) { el.threads.innerHTML = '<div class="aiw-empty-note">' + (q ? 'No chats match “' + esc(S.filter) + '”.' : S.cat && S.cat !== 'All' ? 'No ' + esc(S.cat) + ' chats yet.' : 'No chats yet.<br/>Ask something to start one.') + '</div>'; return; }
      var today = new Date(); today.setHours(0, 0, 0, 0); var html = '', last = '', gc = {};
      list.forEach(function (t) { var age = today.getTime() - t.updated, g = age < 0 ? 'Today' : age < 86400000 ? 'Yesterday' : age < 7 * 86400000 ? 'Previous 7 days' : 'Older'; gc[g] = (gc[g] || 0) + 1; });
      list.forEach(function (t) {
        var age = today.getTime() - t.updated, g = age < 0 ? 'Today' : age < 86400000 ? 'Yesterday' : age < 7 * 86400000 ? 'Previous 7 days' : 'Older';
        if (g !== last) { html += '<div class="aiw-group">' + g + '<span>' + gc[g] + '</span></div>'; last = g; }
        var odoo = t.messages.some(function (m) { return m.liveOdoo || m.report; }), k = topicOf(t);
        html += '<button type="button" class="aiw-thread' + (t.id === S.activeId ? ' active' : '') + '" data-act="thread" data-id="' + esc(t.id) + '" style="--c:' + CAT[k].c + '">' +
          '<span class="aiw-thread-ic">' + catIcon(k, 14) + '</span><span class="aiw-thread-txt"><b>' + esc(t.title || 'New chat') + '</b><small><span class="aiw-thread-k">' + k + '</span><span>' + relTime(t.updated) + '</span><span>' + t.messages.length + ' msg</span>' + (odoo ? '<span class="aiw-live">● data</span>' : '') + '</small></span>' +
          '<span class="aiw-thread-tools"><span data-act="thread-rename" data-id="' + esc(t.id) + '" title="Rename" role="button">✎</span><span data-act="thread-del" data-id="' + esc(t.id) + '" title="Delete" role="button">🗑</span></span></button>';
      });
      el.threads.innerHTML = html;
    }
        function renderRoute() {
      var t = activeThread(), crumbs = [{ label: 'AI Assistant', act: 'route-home' }];
      if (t && t.messages.length) crumbs.push({ label: t.title || 'New chat', act: 'route-chat' });
      if (isInspOpen() && S.tab === 'path' && S.selMsg) crumbs.push({ label: 'Answer path', act: 'route-path' });
      else if (isInspOpen() && S.tab !== 'path') crumbs.push({ label: S.tab === 'connection' ? 'Odoo connection' : 'Files', act: 'route-path' });
      S.stack.forEach(function (f, i) { crumbs.push({ label: clip(f.label || f.title || 'Drill', 28), act: 'route-stack', i: i }); });
      el.route.innerHTML = crumbs.map(function (c, i) {
        var last = i === crumbs.length - 1;
        return (i ? '<i>›</i>' : '') + (last ? '<span class="here">' + esc(c.label) + '</span>' : '<button type="button" data-act="' + c.act + '"' + (c.i != null ? ' data-i="' + c.i + '"' : '') + '>' + esc(c.label) + '</button>');
      }).join('');
      if (el.title) el.title.textContent = t && t.messages.length ? (t.title || 'AI Assistant') : 'AI Assistant';
    }

    /* ── messages ───────────────────────────────────────────────────────── */
    var AREAS = {
      Sales: ['Sales this month vs last month, by salesperson', 'Top 10 customers by revenue this year with share of total', 'Open quotations and how old they are', 'Build a board-ready sales dashboard for this quarter'],
      Finance: ['Receivables aging by customer: not due, 1-30, 31-60, 61-90, 90+ days', 'Unpaid vendor bills due in the next 14 days', 'Cash in vs cash out by month this year', 'Invoices overdue by more than 60 days'],
      Inventory: ['Products that are low on stock and need reordering', 'Late deliveries: scheduled before today and not done', 'Stock quantity by internal location', 'Purchase orders waiting for approval'],
      CRM: ['Pipeline by stage with expected revenue', 'Opportunities with a deadline this month', 'Won vs lost opportunities by salesperson this quarter', 'New leads per week for the last 8 weeks'],
      Create: ['Write a one-page executive summary of this month’s sales as a document', 'Build an interactive HTML dashboard of open quotations by salesperson', 'Create a receivables aging table I can download as CSV', 'Draw a bar chart of revenue by month this year', 'Draft a weekly management update for the leadership team'],
      People: ['Headcount by department', 'Who is on time off this week?', 'Open positions and applicants per stage', 'Leave requests awaiting approval'],
      Reports: (window.DVAITemplate && window.DVAITemplate.SKILLS ? window.DVAITemplate.SKILLS.map(function (k) { return k.example; }) :
        ['Give me a board-ready company report for this month', 'Sales this month vs last month, by salesperson', 'Receivables aging by customer with the top 5 debtors', 'Where are the mistakes or stuck items in my Odoo data?'])
    };
    var areaOpen = 'Sales';

    function statusPillsHtml() {
      var o = odooInfo(), p = providerInfo(), pills = [];
      pills.push(!o.connected ? '<span class="aiw-pill" data-t="warn">Odoo not connected</span>' : S.health ? (S.health.ok ? '<span class="aiw-pill" data-t="good">Odoo live · ' + (S.health.readable || 0) + ' areas readable</span>' : '<span class="aiw-pill" data-t="bad">Odoo: ' + esc(S.health.stage || 'error') + '</span>') : '<span class="aiw-pill">Odoo connected · checking…</span>');
      pills.push(p.configured ? '<span class="aiw-pill">' + esc(p.label) + (p.model ? ' · ' + esc(p.model) : '') + '</span>' : '<span class="aiw-pill" data-t="warn">No AI provider · local engine</span>');
      pills.push('<span class="aiw-pill">Files are read in your browser</span>');
      return pills.join('');
    }
    function renderHeroStatusOnly() { var n = $('aiwHeroStatus'); if (n) n.innerHTML = statusPillsHtml(); }

    function heroHtml() {
      var caps = [
        ['db', 'Ask your Odoo', 'Live, read-only answers with the exact queries shown.', 'cap-ask'],
        ['board', 'Board dashboard', 'KPIs, charts and a PDF, built only from returned rows.', 'cap-board'],
        ['file', 'Report on a file', 'Drop CSV / Excel / JSON — instant profile, charts, data checks.', 'cap-file'],
        ['link', 'Reconcile with Odoo', 'Match a file against products, customers, invoices…', 'cap-recon'],
        ['pulse', 'Check connection', 'Odoo reach, login, per-app access and speed.', 'cap-status'],
        ['spark', 'Learn DashView', 'How Data Studio, drills and filters work.', 'cap-help']
      ];
      return '<div class="aiw-col aiw-welcome"><div class="aiw-hero"><div class="aiw-hero-mark">' + ICON.spark.replace('width="15" height="15"', 'width="26" height="26"') + '</div><h2>What can I help you with?</h2>' +
        '<p>Ask about company data, attach a file for a report, or reconcile it against Odoo — every answer shows its path.</p><div class="aiw-status-row" id="aiwHeroStatus">' + statusPillsHtml() + '</div></div>' +
        '<section class="aiw-sec"><header class="aiw-sec-head"><h3>Quick actions</h3><span>Pick what you want to do</span></header>' +
        '<div class="aiw-cap-grid">' + caps.map(function (c) { return '<button type="button" class="aiw-cap" data-act="' + c[3] + '"><span class="aiw-cap-ic">' + ICON[c[0]] + '</span><b>' + c[1] + '</b><span>' + c[2] + '</span></button>'; }).join('') + '</div></section>' +
        '<section class="aiw-sec aiw-areas"><header class="aiw-sec-head"><h3>Ask by area</h3><span>Ready-made questions, grouped by business area</span></header>' +
        '<div class="aiw-areas-tabs" role="tablist">' + Object.keys(AREAS).map(function (a) { return '<button type="button" role="tab" aria-selected="' + (a === areaOpen) + '" data-act="area" data-a="' + a + '" class="' + (a === areaOpen ? 'active' : '') + '" style="--c:' + CAT[a].c + '"><span class="aiw-area-ic">' + catIcon(a, 16) + '</span><b>' + a + '</b><em>' + AREAS[a].length + '</em></button>'; }).join('') + '</div>' +
        '<div class="aiw-prompts" id="aiwPrompts" style="--c:' + CAT[areaOpen].c + '">' + promptsHtml() + '</div></section></div>';
    }
    function promptsHtml() { return AREAS[areaOpen].map(function (q) { return '<button type="button" data-act="prompt" data-q="' + esc(q) + '"><span class="aiw-prompt-ic">' + catIcon(areaOpen, 14) + '</span><span class="aiw-prompt-t">' + esc(q) + '</span><span class="aiw-prompt-go" aria-hidden="true">↗</span></button>'; }).join(''); }

    function pathStripHtml(m) {
      var t = m.trace;
      if (!t || (t.kind !== 'odoo' && t.kind !== 'status' && t.kind !== 'fallback')) return '';
      var steps = (t.steps || []).map(function (s) { return '<span class="aiw-step' + (t.failed && s.key === 'fetch' ? ' bad' : '') + '">' + esc(s.label.replace(/^Reading \d+ quer(y|ies) from Odoo$/, 'Read Odoo').replace(/^Planning read-only Odoo queries$/, 'Plan').replace(/^Checking the Odoo connection$/, 'Connect').replace(/^Writing the answer from the returned rows$/, 'Answer')) + (s.ms != null ? ' <em>' + fmtMs(s.ms) + '</em>' : '') + '</span>'; }).join('<i>›</i>');
      var src = (t.queries || []).filter(function (q) { return q.op !== 'fields'; }).map(function (q) {
        var n = q.ok ? (q.op === 'count' ? q.count : q.op === 'records' ? (q.total != null ? q.total : (q.rows || []).length) : (q.groups || []).length) : '!';
        return '<button type="button" class="aiw-src' + (q.ok ? '' : ' bad') + '" data-act="src" data-mid="' + m.id + '" data-q="' + esc(q.id) + '" title="Open this query">' + esc(q.model) + ' · ' + esc(q.op) + ' <b>' + esc(n) + '</b></button>';
      }).join('');
      return '<div class="aiw-path"><div class="aiw-path-steps">' + steps + '</div>' + (src ? '<div class="aiw-sources">' + src + '</div>' : '') + '</div>';
    }

    function tagHtml(m) {
      var tags = [];
      if (m.role !== 'ai') return '';
      var T = window.DVAITemplate, st = T && !m.report && m.content ? T.stats(m.content) : null;
      if (m.report) tags.push('<span class="aiw-tag" data-t="info">' + (m.report.kind === 'reconcile' ? 'File ⇄ Odoo' : 'File report') + '</span>');
      else if (m.tag) tags.push('<span class="aiw-tag"' + (/unavailable|setup/i.test(m.tag) ? ' data-t="bad"' : /Live Odoo|dashboard|status/i.test(m.tag) ? ' data-t="good"' : '') + '>' + esc(m.tag) + '</span>');
      else if (m.liveOdoo) tags.push('<span class="aiw-tag" data-t="good">Live Odoo</span>');
      else if (m.engine === 'provider') tags.push('<span class="aiw-tag" data-t="info">' + esc(m.providerLabel || 'AI provider') + '</span>');
      else if (m.engine === 'local') tags.push('<span class="aiw-tag">Local</span>');
      if (m.skill && m.skill.title) tags.push('<span class="aiw-tag" data-t="skill" title="Reporting skill used for this answer">' + esc(m.skill.title) + '</span>');
      if (st && st.isReport) tags.push('<span class="aiw-tag" data-t="report" title="Structured report">Report · ' + st.sections + ' sections</span>');
      return tags.join('');
    }

    /* ══════════ interactive insight board v2: KPIs, prioritised findings, chart views (bars / pareto / share / line / table), AI insights and drill - built only from the rows Odoo returned ══════════ */
    var visPayloads = Object.create(null), visTypes = Object.create(null), visState = Object.create(null), visAiBusy = Object.create(null), visAiErr = Object.create(null);
    var VIS_PAL = (window.DVFmt && window.DVFmt.PALETTE && window.DVFmt.PALETTE.length >= 8) ? window.DVFmt.PALETTE : ['#ff9f0a', '#0a84ff', '#bf5af2', '#63e6e2', '#ffd60a', '#7d7aff', '#40c8e0', '#ac8e68', '#64d2ff', '#98989d'];
    function visMetrics(v) { return (v && Array.isArray(v.metrics) ? v.metrics : []).filter(function (m) { return m && Array.isArray(m.rows) && m.rows.filter(function (r) { return r && isFinite(Number(r.value)); }).length >= 2; }).slice(0, 3); }
    function visCur(pl, me) { var T = window.DVAITemplate; return pl && pl.currency && T && T.isMoney(me) ? pl.currency : ''; }
    function visTip(me, r, share, cur) {
      var T = window.DVAITemplate;
      return String(r.label || '') + ' · ' + (cur ? cur + ' ' : '') + T.fmtCompact(r.value) + (share != null ? ' · ' + (Math.round(share * 10) / 10) + '% of total' : '') + (r.count != null ? ' · ' + r.count + ' record' + (r.count === 1 ? '' : 's') : '') + (Array.isArray(r.domain) && me.model ? ' — click to open the records' : '');
    }
    function visAttrs(mid, mi, ri, me, tip) {
      var can = Array.isArray(me.rows[ri].domain) && me.model;
      return (can ? ' data-act="vis-drill" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-ri="' + ri + '" role="button" tabindex="0"' : '') + ' title="' + esc(tip) + '"';
    }
    function vst(mid, mi) { var k = mid + ':' + mi; return visState[k] || (visState[k] = { k: '', dir: 0, q: '', more: false }); }
    function visCanDrill(me, ri) { return !!(me && me.model && me.rows[ri] && Array.isArray(me.rows[ri].domain)); }
    function visTypesFor(me, an) {
      var n = me.rows.length;
      if (an.series) return n >= 3 ? ['line', 'bar', 'table'] : ['bar', 'table'];
      return an.additive && an.shares[0] != null ? (n >= 4 ? ['bar', 'pareto', 'donut', 'table'] : ['bar', 'donut', 'table']) : ['bar', 'table'];
    }
    var VIS_TYPE_LABEL = { bar: 'Bars', line: 'Line', donut: 'Share', pareto: 'Pareto', table: 'Table' };
    function visItems(me) { return me.rows.map(function (r, i) { return { r: r, i: i, v: Number(r.value) }; }).filter(function (x) { return isFinite(x.v); }); }
    function visChg(items, k) { var a = items[k - 1], b = items[k]; return a && a.v !== 0 ? (b.v - a.v) / Math.abs(a.v) * 100 : null; }
    function visPct(x) { return (x > 0 ? '+' : x < 0 ? '-' : '') + (Math.round(Math.abs(x) * 10) / 10) + '%'; }

    function visChartHtml(mid, mi, type) {
      var pl = visPayloads[mid], me = pl && pl.metrics[mi], T = window.DVAITemplate; if (!me || !T) return '';
      var an = T.analyzeMetric(me); if (!an) return '';
      var cur = visCur(pl, me), items = visItems(me), total = an.total, shareOf = function (x) { return an.shares[0] != null && total > 0 ? x.v / total * 100 : null; };
      var prof = T.profileMetric ? T.profileMetric(me) : null;
      if (type === 'table') return visTableHtml(mid, mi);
      if (type === 'line') {
        var W = 620, H = 214, L = 48, R = 20, TP = 28, B = 30, n = items.length, vals = items.map(function (x) { return x.v; }), nxt = prof && prof.trend && prof.trend.next != null ? prof.trend.next : null;
        var all = nxt != null ? vals.concat([nxt]) : vals, mn0 = Math.min.apply(null, all), mx0 = Math.max.apply(null, all), padv = ((mx0 - mn0) || Math.abs(mx0) || 1) * 0.1, mn = mn0 - padv, mx = mx0 + padv, span = (mx - mn) || 1;
        var slots = n + (nxt != null ? 1 : 0), sx = function (k) { return L + k * (W - L - R) / (slots - 1); }, sy = function (v) { return TP + (1 - (v - mn) / span) * (H - TP - B); };
        var pts = items.map(function (x, k) { return { x: sx(k), y: sy(x.v) }; });
        var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' '), avg = total / n, step = Math.ceil(slots / 7);
        var iMax = vals.indexOf(Math.max.apply(null, vals)), iMin = vals.indexOf(Math.min.apply(null, vals)), iLast = n - 1;
        var grid = [0, 1, 2, 3].map(function (g) { var v = mn + span * g / 3, y = sy(v); return '<line class="aiw-vgrid" x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '"/><text class="aiw-vgl" x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + esc(T.fmtCompact(v)) + '</text>'; }).join('');
        var dots = pts.map(function (p, k) { var x = items[k]; return '<circle class="aiw-vdot' + (k === iLast ? ' last' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (k === iLast ? 5 : 3.6) + '"' + visAttrs(mid, mi, x.i, me, visTip(me, x.r, null, cur) + (k ? ' · ' + visPct(visChg(items, k) == null ? 0 : visChg(items, k)) + ' vs ' + items[k - 1].r.label : '')) + '><title>' + esc(visTip(me, x.r, null, cur)) + '</title></circle>'; }).join('');
        var xl = items.map(function (x, k) { return k % step && k !== iLast ? '' : '<text x="' + pts[k].x.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="' + (k === 0 ? 'start' : k === iLast && nxt == null ? 'end' : 'middle') + '">' + esc(String(x.r.label).slice(0, 14)) + '</text>'; }).join('');
        var tagIdx = [iMax].concat(iLast !== iMax ? [iLast] : []).concat(iMin !== iMax && iMin !== iLast && n >= 5 ? [iMin] : []);
        var tags = tagIdx.map(function (k) { return '<text class="aiw-vpt" x="' + Math.min(Math.max(pts[k].x, L + 12), W - 28).toFixed(1) + '" y="' + (k === iMin && k !== iMax ? pts[k].y + 17 : Math.max(12, pts[k].y - 10)).toFixed(1) + '" text-anchor="middle">' + esc(T.fmtCompact(items[k].v)) + '</text>'; }).join('');
        var ma = '';
        if (prof && prof.ma && n >= 5) { var mdp = [], started = false; prof.ma.forEach(function (v, k) { if (v == null) return; mdp.push((started ? 'L' : 'M') + sx(k).toFixed(1) + ' ' + sy(v).toFixed(1)); started = true; }); ma = '<path class="aiw-vma" d="' + mdp.join(' ') + '"><title>3-period moving average</title></path>'; }
        var proj = '';
        if (nxt != null) { var px = sx(n), py = sy(nxt); proj = '<path class="aiw-vproj" d="M' + pts[iLast].x.toFixed(1) + ' ' + pts[iLast].y.toFixed(1) + ' L' + px.toFixed(1) + ' ' + py.toFixed(1) + '"/><path class="aiw-vprojdot" d="M' + px.toFixed(1) + ' ' + (py - 5.5).toFixed(1) + ' l5.5 5.5 l-5.5 5.5 l-5.5 -5.5 z"><title>Straight-line estimate for the next period: ' + esc(T.fmtCompact(nxt)) + ' (not a forecast)</title></path><text class="aiw-vpt aiw-vptp" x="' + Math.min(px, W - 24).toFixed(1) + '" y="' + Math.max(12, py - 12).toFixed(1) + '" text-anchor="middle">≈ ' + esc(T.fmtCompact(nxt)) + '</text><text x="' + Math.min(px, W - 4).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="end">next</text>'; }
        return '<svg class="aiw-vline" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((me.title || 'Line chart') + (nxt != null ? ', with a dashed straight-line estimate for the next period' : '')) + '">' + grid +
          (n >= 4 ? '<line class="aiw-vavg" x1="' + L + '" y1="' + sy(avg).toFixed(1) + '" x2="' + (W - R) + '" y2="' + sy(avg).toFixed(1) + '"><title>Average ' + esc(T.fmtCompact(avg)) + '</title></line>' : '') +
          '<path class="aiw-varea" d="' + d + ' L' + pts[n - 1].x.toFixed(1) + ' ' + (H - B) + ' L' + pts[0].x.toFixed(1) + ' ' + (H - B) + ' Z"/>' + ma + '<path class="aiw-vpath" d="' + d + '"/>' + proj + dots + xl + tags + '</svg>' +
          '<div class="aiw-vkey"><span><i class="k-line"></i>' + esc(me.measure ? String(me.measure).split(':')[0].replace(/_/g, ' ') : 'Value') + '</span>' + (n >= 4 ? '<span><i class="k-avg"></i>Average ' + esc(T.fmtCompact(avg)) + '</span>' : '') + (ma ? '<span><i class="k-ma"></i>3-period average</span>' : '') + (proj ? '<span><i class="k-proj"></i>Trend estimate</span>' : '') + '</div>';
      }
      if (type === 'pareto' && prof && prof.sorted) {
        var srt = prof.sorted.slice(0, 12), W2 = 620, H2 = 226, L2 = 44, R2 = 40, T2 = 22, B2 = 52, bw = (W2 - L2 - R2) / srt.length, bh = H2 - T2 - B2, mxv = srt[0].v || 1, n80 = prof.pareto ? prof.pareto.n80 : 0, cp = [];
        var bars2 = srt.map(function (x, k) {
          var h = Math.max(2, x.v / mxv * bh), bx = L2 + k * bw + bw * 0.14, by = T2 + bh - h, cy = T2 + (1 - prof.cum[k] / 100) * bh; cp.push({ x: bx + bw * 0.36, y: cy, k: k });
          return '<rect class="aiw-pbar' + (k < n80 ? ' vital' : '') + '" x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + (bw * 0.72).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"' + visAttrs(mid, mi, x.i, me, visTip(me, me.rows[x.i], x.v / total * 100, cur) + ' · cumulative ' + (Math.round(prof.cum[k] * 10) / 10) + '%') + '><title>' + esc(visTip(me, me.rows[x.i], x.v / total * 100, cur) + ' · cumulative ' + (Math.round(prof.cum[k] * 10) / 10) + '%') + '</title></rect><text class="aiw-pxl" transform="translate(' + (bx + bw * 0.36).toFixed(1) + ' ' + (H2 - B2 + 14) + ') rotate(-28)" text-anchor="end">' + esc(String(x.label).slice(0, 11)) + '</text>';
        }).join('');
        var cl = cp.map(function (p, k) { return (k ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' '), cdots = cp.map(function (p) { return '<circle class="aiw-pcdot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"/>'; }).join('');
        var y80 = T2 + 0.2 * bh, ax = [0, 50, 100].map(function (g) { var y = T2 + (1 - g / 100) * bh; return '<text class="aiw-vgl" x="' + (W2 - R2 + 6) + '" y="' + (y + 3.5).toFixed(1) + '">' + g + '%</text>'; }).join('');
        return '<svg class="aiw-vline aiw-vpareto" viewBox="0 0 ' + W2 + ' ' + H2 + '" role="img" aria-label="' + esc((me.title || 'Pareto chart') + ': ' + n80 + ' of ' + items.length + ' groups make up 80% of the total') + '"><line class="aiw-vaxis" x1="' + L2 + '" y1="' + (T2 + bh) + '" x2="' + (W2 - R2) + '" y2="' + (T2 + bh) + '"/><line class="aiw-p80" x1="' + L2 + '" y1="' + y80.toFixed(1) + '" x2="' + (W2 - R2) + '" y2="' + y80.toFixed(1) + '"/><text class="aiw-vgl" x="' + (L2 - 6) + '" y="' + (T2 + 4) + '" text-anchor="end">' + esc(T.fmtCompact(mxv)) + '</text>' + bars2 + '<path class="aiw-pcum" d="' + cl + '"/>' + cdots + ax + '</svg>' +
          '<div class="aiw-vkey"><span><i class="k-vital"></i>Groups that make up 80% (' + n80 + ' of ' + items.length + ')</span><span><i class="k-rest"></i>The rest</span><span><i class="k-proj"></i>Cumulative share</span></div>';
      }
      if (type === 'donut') {
        var sorted = items.slice().sort(function (a, b) { return b.v - a.v; }), top = sorted.slice(0, 6), rest = sorted.slice(6), other = rest.reduce(function (a, x) { return a + x.v; }, 0);
        var segs = top.map(function (x) { return { x: x, label: x.r.label, v: x.v }; }); if (rest.length) segs.push({ x: null, label: 'Other (' + rest.length + ' more)', v: other });
        var acc = 0, stops = segs.map(function (g, k) { var a = acc / total * 100; acc += g.v; return VIS_PAL[k % VIS_PAL.length] + ' ' + a.toFixed(2) + '% ' + (acc / total * 100).toFixed(2) + '%'; }).join(', ');
        var legend = segs.map(function (g, k) {
          var tip = g.x ? visTip(me, g.x.r, shareOf(g.x), cur) : g.label + ' · ' + T.fmtCompact(g.v) + ' · ' + (Math.round(g.v / total * 1000) / 10) + '% of total';
          return '<div class="aiw-vleg"' + (g.x ? visAttrs(mid, mi, g.x.i, me, tip) : ' title="' + esc(tip) + '"') + '><i style="background:' + VIS_PAL[k % VIS_PAL.length] + '"></i><span class="aiw-vleg-l">' + esc(g.label) + '</span><b>' + esc(T.fmtCompact(g.v)) + '</b><em>' + (Math.round(g.v / total * 1000) / 10) + '%</em></div>';
        }).join('');
        return '<div class="aiw-vdonut-wrap"><div class="aiw-vdonut" style="background:conic-gradient(' + stops + ')" role="img" aria-label="' + esc(me.title || 'Donut chart') + '"><span><b>' + esc((cur ? cur + ' ' : '') + T.fmtCompact(total)) + '</b><small>total</small></span></div><div class="aiw-vlegend">' + legend + '</div></div>';
      }
      var list = items, otherRow = null;
      if (!an.series) { list = items.slice().sort(function (a, b) { return b.v - a.v; }); if (list.length > 10) { var tail = list.slice(10); list = list.slice(0, 10); otherRow = { label: 'Other (' + tail.length + ' more)', v: tail.reduce(function (a, x) { return a + x.v; }, 0) }; } }
      var max = Math.max.apply(null, list.map(function (x) { return Math.abs(x.v); }).concat(otherRow ? [Math.abs(otherRow.v)] : [])) || 1;
      var bars = list.map(function (x, k) {
        var sh = shareOf(x), ch = an.series ? visChg(items, items.indexOf(x)) : null, last = (sh != null ? (Math.round(sh * 10) / 10) + '%' : ch != null ? visPct(ch) : '');
        return '<div class="aiw-vbar' + (x.v < 0 ? ' neg' : '') + (Array.isArray(x.r.domain) && me.model ? ' is-drill' : '') + '"' + visAttrs(mid, mi, x.i, me, visTip(me, x.r, sh, cur)) + '><span class="aiw-vbar-l">' + esc(x.r.label) + '</span><span class="aiw-vbar-t"><span class="aiw-vbar-f" style="width:' + Math.max(2, Math.abs(x.v) / max * 100).toFixed(1) + '%' + (an.series ? '' : ';background:' + VIS_PAL[k % VIS_PAL.length]) + '"></span></span><span class="aiw-vbar-v">' + esc(T.fmtCompact(x.v)) + '</span><span class="aiw-vbar-s' + (ch != null ? (ch > 0 ? ' up' : ch < 0 ? ' down' : '') : '') + '">' + last + '</span></div>';
      }).join('');
      if (otherRow) bars += '<div class="aiw-vbar other" title="' + esc(otherRow.label + ' · ' + T.fmtCompact(otherRow.v)) + '"><span class="aiw-vbar-l">' + esc(otherRow.label) + '</span><span class="aiw-vbar-t"><span class="aiw-vbar-f" style="width:' + Math.max(2, otherRow.v / max * 100).toFixed(1) + '%"></span></span><span class="aiw-vbar-v">' + esc(T.fmtCompact(otherRow.v)) + '</span><span class="aiw-vbar-s">' + (Math.round(otherRow.v / total * 1000) / 10) + '%</span></div>';
      return '<div class="aiw-vbars" role="img" aria-label="' + esc(me.title || 'Bar chart') + '">' + bars + '</div>';
    }

    /* sortable, filterable table of the exact rows (drill on any row) */
    function visTableData(mid, mi) {
      var pl = visPayloads[mid], me = pl.metrics[mi], T = window.DVAITemplate, an = T.analyzeMetric(me), items = visItems(me), st = vst(mid, mi);
      var ranked = items.slice().sort(function (a, b) { return b.v - a.v; }), acc = 0, cum = Object.create(null);
      if (an.shares[0] != null && an.total > 0) ranked.forEach(function (x) { acc += x.v; cum[x.i] = acc / an.total * 100; });
      var rows = items.map(function (x, k) { return { i: x.i, label: String(x.r.label), v: x.v, sh: an.shares[0] != null && an.total > 0 ? x.v / an.total * 100 : null, cum: cum[x.i] == null ? null : cum[x.i], chg: an.series ? visChg(items, k) : null, count: x.r.count == null ? null : Number(x.r.count), rank: ranked.indexOf(x) + 1 }; });
      var key = st.k || (an.series ? 'i' : 'v'), dir = st.dir || (an.series ? 1 : -1), q = (st.q || '').toLowerCase();
      if (q) rows = rows.filter(function (r) { return r.label.toLowerCase().indexOf(q) > -1; });
      rows.sort(function (a, b) { var x = a[key], y = b[key]; if (key === 'label') return dir * String(x).localeCompare(String(y)); x = x == null ? -Infinity : x; y = y == null ? -Infinity : y; return dir * (x - y); });
      return { rows: rows, series: an.series, me: me, key: key, dir: dir, total: an.total, ranked: an.shares[0] != null };
    }
    function visTableBody(mid, mi) {
      var D = visTableData(mid, mi), T = window.DVAITemplate, pl = visPayloads[mid], cur = visCur(pl, D.me);
      if (!D.rows.length) return '<tr><td colspan="7">No rows match.</td></tr>';
      return D.rows.map(function (r) {
        var can = visCanDrill(D.me, r.i);
        return '<tr' + (can ? ' class="is-drill" data-act="vis-drill" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-ri="' + r.i + '" role="button" tabindex="0" title="Open the records behind this row"' : '') + '>' +
          (D.series ? '' : '<td class="num dim">' + r.rank + '</td>') + '<td title="' + esc(r.label) + '">' + esc(r.label) + '</td><td class="num">' + esc((cur ? cur + ' ' : '') + T.fmtCompact(r.v)) + '</td>' +
          (D.series ? '<td class="num ' + (r.chg == null ? '' : r.chg > 0 ? 'up' : r.chg < 0 ? 'down' : '') + '">' + (r.chg == null ? '' : visPct(r.chg)) + '</td>' : D.ranked ? '<td class="num">' + (r.sh == null ? '' : '<span class="aiw-mbar"><i style="width:' + Math.min(100, r.sh).toFixed(1) + '%"></i></span>' + (Math.round(r.sh * 10) / 10) + '%') + '</td><td class="num dim">' + (r.cum == null ? '' : (Math.round(r.cum * 10) / 10) + '%') + '</td>' : '') +
          '<td class="num dim">' + (r.count == null ? '' : r.count.toLocaleString()) + '</td><td class="go">' + (can ? '›' : '') + '</td></tr>';
      }).join('');
    }
    function visTableHtml(mid, mi) {
      var D = visTableData(mid, mi), st = vst(mid, mi);
      function th(k, label, num) { var on = D.key === k; return '<th scope="col" class="' + (num ? 'num' : '') + '" aria-sort="' + (on ? (D.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-act="vis-sort" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-k="' + k + '">' + esc(label) + (on ? (D.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>'; }
      var head = (D.series ? '' : th('rank', '#', true)) + th('label', D.series ? 'Period' : 'Group') + th('v', 'Value', true) + (D.series ? th('chg', 'Change', true) : D.ranked ? th('sh', 'Share', true) + th('cum', 'Cum.', true) : '') + th('count', 'Records', true) + '<th aria-hidden="true"></th>';
      return '<div class="aiw-vtools"><input type="search" class="aiw-vtq" data-mid="' + esc(mid) + '" data-mi="' + mi + '" placeholder="Filter rows" aria-label="Filter rows" value="' + esc(st.q || '') + '"/><span class="aiw-vtcount">' + D.rows.length + ' of ' + D.me.rows.length + ' rows</span></div>' +
        '<div class="aiw-tbl-wrap aiw-vtbl-wrap"><table class="aiw-tbl aiw-vtbl"><thead><tr>' + head + '</tr></thead><tbody>' + visTableBody(mid, mi) + '</tbody></table></div>';
    }

    /* KPI tiles + prioritised findings */
    function visKpisHtml(mid, mi, me, prof) {
      if (!prof || !prof.kpis.length) return '';
      return '<div class="aiw-vkpis" aria-label="Key figures">' + prof.kpis.slice(0, 6).map(function (x) {
        var can = x.ri != null && visCanDrill(me, x.ri), inner = '<small>' + esc(x.k) + '</small><b>' + esc(x.v) + '</b><em>' + esc(x.sub) + '</em>';
        return can ? '<button type="button" class="aiw-vk" data-tone="' + x.tone + '" data-act="vis-drill" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-ri="' + x.ri + '" title="Open the records behind this">' + inner + '</button>' : '<div class="aiw-vk" data-tone="' + x.tone + '">' + inner + '</div>';
      }).join('') + '</div>';
    }
    var SEV_LABEL = { high: 'High', med: 'Medium', low: 'Note' };
    function visFindHtml(mid, mi, me, deep) {
      if (!deep.length) return '';
      var st = vst(mid, mi), shown = st.more ? deep : deep.slice(0, 3);
      return '<div class="aiw-vfind" aria-label="Deeper analysis"><h5>Deeper analysis</h5><ul>' + shown.map(function (x) {
        var can = x.ri != null && visCanDrill(me, x.ri), body = '<span class="aiw-sev" data-sev="' + x.sev + '">' + SEV_LABEL[x.sev] + '</span><span class="aiw-vf-t"><b>' + esc(x.title) + '</b><span>' + esc(x.text) + '</span>' + (x.why ? '<small>' + esc(x.why) + '</small>' : '') + '</span>' + (can ? '<i aria-hidden="true">›</i>' : '');
        return '<li class="aiw-vf" data-tone="' + x.tone + '">' + (can ? '<button type="button" data-act="vis-drill" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-ri="' + x.ri + '" title="Open the records behind this">' + body + '</button>' : '<div>' + body + '</div>') + '</li>';
      }).join('') + '</ul>' + (deep.length > 3 ? '<button type="button" class="aiw-linkbtn aiw-vmore" data-act="vis-more" data-mid="' + esc(mid) + '" data-mi="' + mi + '">' + (st.more ? 'Show fewer' : 'Show all ' + deep.length + ' findings') + '</button>' : '') + '</div>';
    }

    /* AI insights panel */
    function visRowIndex(me, label) { for (var i = 0; i < me.rows.length; i++) if (String(me.rows[i].label).trim().toLowerCase() === String(label).trim().toLowerCase()) return i; return -1; }
    function visAiItem(mid, mi, me, it) {
      var ri = it.row ? visRowIndex(me, it.row) : -1, chip = '';
      if (ri > -1) chip = visCanDrill(me, ri) ? '<button type="button" class="aiw-rowchip" data-act="vis-drill" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-ri="' + ri + '" title="Open the records for ' + esc(it.row) + '">' + esc(clip(it.row, 28)) + ' ›</button>' : '<span class="aiw-rowchip">' + esc(clip(it.row, 28)) + '</span>';
      return '<li><span>' + esc(it.text) + '</span>' + chip + (it.check ? '<em class="aiw-verify" title="This figure is not in the rows or the calculated findings. Check it before you share it.">verify</em>' : '') + '</li>';
    }
    function visAiHtml(mid, mi) {
      var f = findMsg(mid), pl = visPayloads[mid], me = pl && pl.metrics[mi], key = mid + ':' + mi, r = f && f.m.aiIns && f.m.aiIns[mi];
      if (visAiBusy[key]) return '<section class="aiw-vai" data-s="busy" aria-live="polite"><header><b><span class="aiw-vai-ic">✦</span> AI insights</b><span class="aiw-vai-sub">Reading ' + me.rows.length + ' rows…</span></header><div class="aiw-skel-line"></div><div class="aiw-skel-line short"></div><div class="aiw-skel-line"></div></section>';
      if (visAiErr[key]) return '<section class="aiw-vai" data-s="error"><header><b><span class="aiw-vai-ic">✦</span> AI insights</b></header><p class="aiw-vai-err">' + esc(visAiErr[key]) + '</p><div class="aiw-vai-act"><button type="button" class="aiw-tool" data-act="vis-ai" data-mid="' + esc(mid) + '" data-mi="' + mi + '">Try again</button><button type="button" class="aiw-tool" data-act="vis-ai-x" data-mid="' + esc(mid) + '" data-mi="' + mi + '">Dismiss</button></div></section>';
      if (!r) return '';
      var cols = [['Drivers', 'drivers'], ['Risks to watch', 'risks'], ['Do next', 'actions']].map(function (c) {
        return r[c[1]] && r[c[1]].length ? '<div class="aiw-vai-col" data-k="' + c[1] + '"><h6>' + c[0] + '</h6><ul>' + r[c[1]].map(function (it) { return visAiItem(mid, mi, me, it); }).join('') + '</ul></div>' : '';
      }).join('');
      var qs = (r.questions || []).map(function (q) { return '<button type="button" class="aiw-q" data-act="vis-q" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('');
      var src = r.engine === 'ai' ? 'AI · ' + esc(r.label || 'provider') : 'Calculated read-out';
      return '<section class="aiw-vai" data-s="done" data-engine="' + esc(r.engine) + '"><header><b><span class="aiw-vai-ic">✦</span> AI insights</b><span class="aiw-vai-src">' + src + '</span>' + (r.confidence ? '<span class="aiw-conf" data-l="' + r.confidence.toLowerCase() + '"><i aria-hidden="true"></i>Confidence: ' + esc(r.confidence) + '</span>' : '') + '<div class="aiw-vai-act"><button type="button" class="aiw-tool" data-act="vis-ai" data-mid="' + esc(mid) + '" data-mi="' + mi + '" title="Write the insights again">Regenerate</button><button type="button" class="aiw-tool" data-act="vis-ai-copy" data-mid="' + esc(mid) + '" data-mi="' + mi + '">Copy</button><button type="button" class="aiw-tool" data-act="vis-ai-x" data-mid="' + esc(mid) + '" data-mi="' + mi + '" aria-label="Hide AI insights">✕</button></div></header>' +
        (r.headline ? '<p class="aiw-vai-head">' + esc(r.headline) + (r.headlineCheck ? ' <em class="aiw-verify" title="This figure is not in the rows or the calculated findings. Check it before you share it.">verify</em>' : '') + '</p>' : '') +
        (cols ? '<div class="aiw-vai-cols">' + cols + '</div>' : '') + (qs ? '<div class="aiw-vai-q"><small>Ask next</small>' + qs + '</div>' : '') +
        '<footer>' + (r.engine === 'ai' ? 'Written by the AI from the rows above; figures not found in the rows are marked verify.' : (r.note || 'Built from the calculated findings only. Connect an AI provider in Settings for written analysis.')) + '</footer></section>';
    }
    function visRepaint(mid, mi) {
      var host = root.querySelector('.aiw-msg[data-mid="' + mid + '"] .aiw-vis-card[data-mi="' + mi + '"]'); if (!host) return;
      var wrap = document.createElement('div'); wrap.innerHTML = visCardHtml(mid, mi); var nu = wrap.firstChild; if (nu) host.replaceWith(nu);
    }
    function visAiRun(mid, mi) {
      var f = findMsg(mid), pl = visPayloads[mid], me = pl && pl.metrics[mi], T = window.DVAITemplate, key = mid + ':' + mi;
      if (!f || !me || !T || !T.aiMessages || visAiBusy[key]) return Promise.resolve();
      var p = providerInfo(), pack = T.aiMessages(me, { currency: visCur(pl, me), question: precedingQuestion(f.i, f.t) }); if (!pack) return Promise.resolve();
      f.m.aiIns = f.m.aiIns || {}; delete visAiErr[key];
      if (!p.configured || !window.DVAIConfig || !window.DVAIConfig.callAI) {
        var c = T.calcReadout(me); if (!c) return Promise.resolve();
        c.engine = 'calc'; c.at = Date.now(); f.m.aiIns[mi] = c; persist(); visRepaint(mid, mi); toast('No AI provider is set up, so this read-out comes from the calculated findings.'); return Promise.resolve();
      }
      visAiBusy[key] = true; visRepaint(mid, mi); var t0 = Date.now();
      return window.DVAIConfig.callAI(pack.messages, pack.system).then(function (reply) {
        var r = T.parseAiInsights(reply, pack.facts);
        if (r) { r.engine = 'ai'; r.label = p.label; r.ms = Date.now() - t0; }
        else { r = T.calcReadout(me) || { headline: '', drivers: [], risks: [], actions: [], questions: [] }; r.engine = 'calc'; r.note = 'The AI reply could not be read, so this is the calculated read-out. Try again.'; }
        r.at = Date.now(); f.m.aiIns[mi] = r; persist();
      }).catch(function (e) { visAiErr[key] = 'The AI could not write these insights (' + String(e && e.message || e || 'unknown error') + '). Check Settings → AI Assistant, then try again.'; })
        .then(function () { delete visAiBusy[key]; visRepaint(mid, mi); });
    }
    function visAiText(mid, mi) {
      var f = findMsg(mid), pl = visPayloads[mid], me = pl && pl.metrics[mi], r = f && f.m.aiIns && f.m.aiIns[mi]; if (!r || !me) return '';
      function sec(t, a) { return a && a.length ? '\n' + t + '\n' + a.map(function (x) { return '- ' + x.text; }).join('\n') : ''; }
      return (me.title || 'Insights') + '\n' + (r.headline || '') + sec('Drivers', r.drivers) + sec('Risks to watch', r.risks) + sec('Do next', r.actions);
    }
    function visSummaryText(mid, mi) {
      var pl = visPayloads[mid], me = pl && pl.metrics[mi], T = window.DVAITemplate; if (!me || !T) return '';
      var prof = T.profileMetric(me), deep = T.deepInsights(me, prof), cur = visCur(pl, me);
      return (me.title || 'Chart') + (cur ? ' (' + cur + ')' : '') + '\n' + prof.kpis.map(function (x) { return x.k + ': ' + x.v + (x.sub ? ' (' + x.sub + ')' : ''); }).join('; ') + (deep.length ? '\n' + deep.map(function (x) { return '- [' + SEV_LABEL[x.sev] + '] ' + x.text; }).join('\n') : '') + (visAiText(mid, mi) ? '\n\n' + visAiText(mid, mi) : '');
    }

    function visCardHtml(mid, mi) {
      var pl = visPayloads[mid], me = pl.metrics[mi], T = window.DVAITemplate, an = T.analyzeMetric(me); if (!an) return '';
      var prof = T.profileMetric ? T.profileMetric(me) : null, deep = prof && T.deepInsights ? T.deepInsights(me, prof) : [];
      var types = visTypesFor(me, an), type = visTypes[mid + ':' + mi]; if (types.indexOf(type) < 0) type = types[0];
      var cur = visCur(pl, me), drillable = me.model && me.rows.some(function (r) { return Array.isArray(r.domain); });
      var seg = types.length > 1 ? '<div class="aiw-seg" role="group" aria-label="Chart type">' + types.map(function (t) { return '<button type="button" data-act="vis-type" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-t="' + t + '" aria-pressed="' + (t === type) + '">' + VIS_TYPE_LABEL[t] + '</button>'; }).join('') + '</div>' : '';
      var ins = an.insights.map(function (x) {
        var can = x.ri != null && me.model && Array.isArray(me.rows[x.ri] && me.rows[x.ri].domain);
        return can ? '<button type="button" class="aiw-vin" data-tone="' + x.tone + '" data-act="vis-drill" data-mid="' + esc(mid) + '" data-mi="' + mi + '" data-ri="' + x.ri + '" title="Open the records behind this">' + esc(x.text) + '</button>' : '<span class="aiw-vin" data-tone="' + x.tone + '">' + esc(x.text) + '</span>';
      }).join('');
      var attn = deep.filter(function (x) { return x.sev === 'high' || (x.sev === 'med' && x.tone === 'warn'); }).length;
      return '<article class="aiw-vis-card" data-mi="' + mi + '"><header class="aiw-vis-top"><div><h4>' + esc(me.title || me.model || 'Metric') + (attn ? '<span class="aiw-attn" title="Findings that need a look">' + attn + ' to review</span>' : '') + '</h4><small>' + esc(me.rows.length + ' rows' + (me.measure ? ' · ' + me.measure : '') + (cur ? ' · ' + cur : '')) + '</small></div>' + seg + '</header>' +
        visKpisHtml(mid, mi, me, prof) +
        (ins ? '<div class="aiw-vins" aria-label="Calculated insights">' + ins + '</div>' : '') +
        '<div class="aiw-vis-chart">' + visChartHtml(mid, mi, type) + '</div>' +
        visFindHtml(mid, mi, me, deep) + visAiHtml(mid, mi) +
        '<footer class="aiw-vis-foot"><span>' + (drillable ? 'Click a bar, slice, point, tile or finding to open the records behind it' : 'Exact values from the returned rows') + '</span><div><button type="button" class="aiw-tool aiw-tool-ai" data-act="vis-ai" data-mid="' + esc(mid) + '" data-mi="' + mi + '">✦ AI insights</button><button type="button" class="aiw-tool" data-act="vis-art" data-mid="' + esc(mid) + '" data-mi="' + mi + '" title="Keep this chart and its data as an artifact">Artifact</button><button type="button" class="aiw-tool" data-act="vis-copy" data-mid="' + esc(mid) + '" data-mi="' + mi + '">Copy summary</button><button type="button" class="aiw-tool" data-act="vis-csv" data-mid="' + esc(mid) + '" data-mi="' + mi + '">CSV</button><button type="button" class="aiw-tool" data-act="vis-ask" data-mid="' + esc(mid) + '" data-mi="' + mi + '">Ask why</button></div></footer></article>';
    }
    function visBoardHtml(m) {
      var T = window.DVAITemplate; if (!T || !T.analyzeMetric) return '';
      var ms = visMetrics(m.visuals); if (!ms.length) return '';
      visPayloads[m.id] = Object.assign({}, m.visuals, { metrics: ms });
      var cards = ms.map(function (x, mi) { return visCardHtml(m.id, mi); }).join('');
      var rowsN = ms.reduce(function (a, x) { return a + x.rows.length; }, 0), attn = ms.reduce(function (a, x) { var d = T.deepInsights ? T.deepInsights(x) : []; return a + d.filter(function (y) { return y.sev === 'high' || (y.sev === 'med' && y.tone === 'warn'); }).length; }, 0);
      return cards ? '<section class="aiw-vis" aria-label="Insight board"><header class="aiw-vis-head"><div class="aiw-vis-title"><b>Insight board</b><span>' + ms.length + ' chart' + (ms.length === 1 ? '' : 's') + ' · ' + rowsN + ' rows' + (attn ? ' · <em>' + attn + ' finding' + (attn === 1 ? '' : 's') + ' to review</em>' : '') + ' · all figures calculated from the rows Odoo returned</span></div><button type="button" class="aiw-tool aiw-tool-ai" data-act="vis-ai-all" data-mid="' + esc(m.id) + '">✦ AI insights for all</button></header>' + cards + '</section>' : '';
    }
    function visRowsCsv(pl, me) {
      var T = window.DVAITemplate, an = T.analyzeMetric(me), rows = me.rows.filter(function (r) { return isFinite(Number(r.value)); });
      return csvOf(['Group', me.measure || 'Value', 'Share of total %', 'Records'], rows.map(function (r, i) { return [r.label, r.value, an && an.shares[i] != null ? Math.round(an.shares[i] * 100) / 100 : '', r.count == null ? '' : r.count]; }));
    }

    // Structured footer of an answer: confidence, assumptions and (when there is no query path strip) the data source.
    function answerFootHtml(parts, m) {
      var rows = [];
      if (parts.confidence) {
        var lv = parts.confidence.level.toLowerCase();
        rows.push('<div class="aiw-foot-row"><span class="aiw-conf" data-l="' + lv + '" title="How much of this answer is backed by complete, verified data"><i aria-hidden="true"></i>Confidence: ' + esc(parts.confidence.level) + '</span>' + (parts.confidence.reason ? '<span class="aiw-foot-t">' + esc(parts.confidence.reason) + '</span>' : '') + '</div>');
      }
      if (parts.assumptions) rows.push('<div class="aiw-foot-row"><span class="aiw-foot-k">Assumptions</span><span class="aiw-foot-t">' + esc(parts.assumptions) + '</span></div>');
      if (parts.source && !m.trace) rows.push('<div class="aiw-foot-row"><span class="aiw-foot-k">Source</span><span class="aiw-foot-t">' + esc(parts.source) + '</span></div>');
      return rows.length ? '<div class="aiw-foot">' + rows.join('') + '</div>' : '';
    }
    // "In this report" chips for long structured answers (4+ sections).
    function tocHtml(body, mid) {
      var T = window.DVAITemplate; if (!T || !T.stats || !T.headings) return '';
      if (T.stats(body).sections < 4) return '';
      return '<nav class="aiw-toc" aria-label="Sections in this report">' + T.headings(body).slice(0, 8).map(function (h, i) { return '<button type="button" data-act="jump" data-mid="' + mid + '" data-i="' + i + '">' + esc(h) + '</button>'; }).join('') + '</nav>';
    }
    function reportTitle(question, m) {
      var q = String(question || '').replace(/\s+/g, ' ').trim();
      return ((m && m.skill && m.skill.title) || 'DashView report') + (q ? ' - ' + (q.length > 70 ? q.slice(0, 67) + '...' : q) : '');
    }

    function msgHtml(m, isLast) {
      var sel = m.id === S.selMsg && isInspOpen() && S.tab === 'path';
      if (m.role === 'user') {
        var files = (m.files || []).map(function (f) { return '<span class="aiw-file-chip"><span class="aiw-file-ic">' + esc((f.name.split('.').pop() || 'F').slice(0, 4).toUpperCase()) + '</span><b>' + esc(f.name) + '</b><small>' + fmtSize(f.size) + '</small></span>'; }).join('');
        return '<div class="aiw-msg user" data-mid="' + m.id + '"><div class="aiw-av">You</div><div class="aiw-bubble"><div class="aiw-card">' + (files ? '<div class="aiw-attach-line">' + files + '</div>' : '') + (m.content ? '<div class="ai-embed-content"><p>' + esc(m.content).replace(/\n/g, '<br/>') + '</p></div>' : '') + '</div></div></div>';
      }
      var body, parts = null, foot = '', toc = '', T = window.DVAITemplate;
      if (m.report) body = reportHtml(m.report, m.id);
      else {
        var dash = m.dashboard ? renderDashboard(m.dashboard, m.content) : null;
        parts = T && T.extract ? T.extract(m.content) : null;
        if (parts) { foot = answerFootHtml(parts, m); toc = tocHtml(parts.body, m.id); }
        body = '<div class="ai-embed-content"><p>' + renderMarkdown(parts ? parts.body : m.content, m.liveOdoo) + '</p>' + (dash || '') + (m.visuals ? visBoardHtml(m) : '') + '</div>';
        body = body.replace(/<p><\/p>/g, '').replace(/<p>(?=<(?:h2|h3|ul|ol|aside|div|pre|hr)\b)/g, '').replace(/(<\/(?:h2|h3|ul|ol|aside|div|pre)>|<hr\/>)<\/p>/g, '$1').replace(/<p><\/p>/g, '');
        if (window.DVArtifacts) body = window.DVArtifacts.inject(body);
      }
      var st = T && !m.report && m.content ? T.stats(m.content) : null, canExport = !!(st && !m.dashboard && (st.isReport || m.visuals || (st.tables >= 1 && st.words > 60)));
      var hasPath = !!(m.trace || m.report);
      var canArt = !!(window.DVArtifacts && !m.report && !m.dashboard && m.content && !/\[\[artifact:/.test(m.content) && st && (st.isReport || st.tables >= 1 || st.words > 90));
      var tools = '<button type="button" class="aiw-tool" data-act="copy" data-mid="' + m.id + '">Copy</button>' +
        (hasPath ? '<button type="button" class="aiw-tool" data-act="path" data-mid="' + m.id + '">Path &amp; drill ›</button>' : '') +
        (canExport ? '<button type="button" class="aiw-tool" data-act="rexport" data-mid="' + m.id + '" title="Download this answer as a PDF report">Export PDF</button>' : '') +
        (canArt ? '<button type="button" class="aiw-tool" data-act="art-save" data-mid="' + m.id + '" title="Keep this answer as an artifact you can edit, version and download">' + (m.savedArt ? 'Open artifact' : 'Save as artifact') + '</button>' : '') +
        (isLast && m.retry ? '<button type="button" class="aiw-tool" data-act="retry" data-mid="' + m.id + '">Retry</button>' : '') +
        (m.liveOdoo || m.trace && m.trace.kind === 'odoo' ? '<button type="button" class="aiw-tool" data-act="why" data-mid="' + m.id + '">How was this calculated?</button>' : '');
      var fups = isLast && m.followups && m.followups.length ? '<div class="aiw-followups" aria-label="Suggested next steps">' + m.followups.map(function (f, i) { return '<button type="button" data-act="fup" data-mid="' + m.id + '" data-i="' + i + '">' + esc(typeof f === 'string' ? f : f.label) + '</button>'; }).join('') + '</div>' : '';
      return '<div class="aiw-msg ai" data-mid="' + m.id + '"><div class="aiw-av">' + ICON.spark + '</div><div class="aiw-bubble"><div class="aiw-card' + (sel ? ' selected' : '') + '">' +
        '<div class="aiw-meta"><span class="aiw-who">DashView Assistant</span>' + tagHtml(m) + '<span class="aiw-time">' + fmtTime(m.time) + '</span></div>' + toc + body + foot + (m.report ? '' : pathStripHtml(m)) +
        (m.setup ? '<div class="aiw-btns" style="margin-top:10px"><button type="button" class="aiw-btn primary" data-act="open-conn">Open connection details</button><button type="button" class="aiw-btn" data-act="settings-ai">AI settings</button><button type="button" class="aiw-btn" data-act="settings-odoo">Odoo settings</button></div>' : '') +
        '<div class="aiw-msg-tools">' + tools + '</div></div>' + fups + '</div></div>';
    }

    function renderMessages(keepScroll) {
      var t = activeThread(), top = el.messages.scrollTop;
      if (!t || !t.messages.length) { el.messages.innerHTML = heroHtml(); return; }
      var last = t.messages.length - 1;
      el.messages.innerHTML = '<div class="aiw-col">' + t.messages.map(function (m, i) { return msgHtml(m, i === last); }).join('') + (S.thinking ? S.thinking.html : '') + '</div>';
      if (keepScroll) el.messages.scrollTop = top; else scrollDown();
    }
    function scrollDown() { requestAnimationFrame(function () { el.messages.scrollTop = el.messages.scrollHeight; }); }
    function renderAll() { renderThreads(); renderRoute(); renderMessages(); renderTray(); if (isInspOpen()) renderInsp(); updateSend(); }

    /* live thinking panel - reasoning stages, step timeline and a running clock (css/ai-redesign.css) */
    var THINK_STAGES = [
      { k: 'connect', t: 'Connect', h: 'Connecting to your workspace' },
      { k: 'plan',    t: 'Plan',    h: 'Planning read-only queries' },
      { k: 'fetch',   t: 'Read',    h: 'Reading live data' },
      { k: 'answer',  t: 'Write',   h: 'Writing the answer' }
    ];
    function thinkStageOf(key, label) {
      var i, l = String(label || '').toLowerCase();
      if (key) for (i = 0; i < THINK_STAGES.length; i++) if (THINK_STAGES[i].k === key) return i;
      if (/connect|status/.test(l)) return 0;
      if (/plan|repair|understand|think/.test(l)) return 1;
      if (/read|fetch|quer|file/.test(l)) return 2;
      return 3;
    }
    function thinkSecs(ms) { return ms < 1000 ? '<1s' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'; }
    function thinkingStart() {
      thinkingStop();
      S.thinking = { rows: [], html: '', t0: Date.now(), stage: 0, odoo: false, timer: 0 };
      thinkingDraw();
      S.thinking.timer = setInterval(thinkingTick, 250);
    }
    function thinkingStep(label, key) {
      var th = S.thinking; if (!th) return;
      var now = Date.now(), lastRow = th.rows[th.rows.length - 1];
      if (lastRow && !lastRow.done && lastRow.label === label) return;   /* the agent repeats the first step */
      th.rows.forEach(function (r) { if (!r.done) { r.done = true; r.ms = now - r.at; } });
      var st = thinkStageOf(key, label);
      if (key === 'connect' || key === 'plan' || key === 'fetch') th.odoo = true;
      th.stage = Math.max(th.stage, st);
      th.rows.push({ label: label, done: false, at: now, stage: st });
      thinkingDraw();
    }
    function thinkingTick() {
      var th = S.thinking, n = $('aiwThinkClock'); if (!th) return;
      if (n) n.textContent = thinkSecs(Date.now() - th.t0);
      var cur = th.rows[th.rows.length - 1], c = $('aiwThinkNow');
      if (cur && !cur.done && c) c.textContent = thinkSecs(Date.now() - cur.at);
    }
    function thinkingTitle(th) { return th.rows.length ? THINK_STAGES[th.stage].h : 'Understanding your question'; }
    function thinkingBody(th) {
      var rows = th.rows.length ? th.rows : [{ label: 'Understanding your question', done: false, at: th.t0 }];
      return rows.map(function (r, i) {
        var last = i === rows.length - 1;
        return '<li class="aiw-tp-row ' + (r.done ? 'done' : 'now') + '"><span class="aiw-tp-dot" aria-hidden="true"></span><span class="aiw-tp-lbl">' + esc(r.label) + '</span>' +
          '<span class="aiw-tp-ms"' + (!r.done && last ? ' id="aiwThinkNow"' : '') + '>' + (r.done ? thinkSecs(r.ms || 0) : thinkSecs(Date.now() - r.at)) + '</span></li>';
      }).join('');
    }
    function thinkingRail(th) {
      return THINK_STAGES.map(function (s, i) {
        return '<li class="aiw-tp-seg ' + (i < th.stage ? 'done' : i === th.stage ? 'now' : '') + '"><i></i><span>' + s.t + '</span></li>';
      }).join('');
    }
    function thinkingHtml(th) {
      var n = th.rows.length;
      return '<div class="aiw-msg ai" id="aiwThinking"><div class="aiw-av">' + ICON.spark + '</div><div class="aiw-bubble"><div class="aiw-tp" role="status" aria-live="polite" aria-label="The assistant is working">' +
        '<div class="aiw-tp-head"><span class="aiw-tp-orb" aria-hidden="true"><i></i><b></b></span>' +
        '<div class="aiw-tp-ttl"><strong id="aiwThinkTitle">' + esc(thinkingTitle(th)) + '</strong><small>Reasoning on your question</small></div>' +
        '<span class="aiw-tp-clock" id="aiwThinkClock">' + thinkSecs(Date.now() - th.t0) + '</span></div>' +
        '<ol class="aiw-tp-rail" id="aiwThinkRail" aria-hidden="true"' + (th.odoo ? '' : ' hidden') + '>' + thinkingRail(th) + '</ol>' +
        '<details class="aiw-tp-steps" open><summary><span>Steps</span><em id="aiwThinkCount">' + Math.max(n, 1) + '</em></summary><ol id="aiwThinkSteps">' + thinkingBody(th) + '</ol></details>' +
        (th.odoo ? '<div class="aiw-tp-foot"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Read-only. The answer uses only the rows Odoo returns.</div>' : '') +
        '</div></div></div>';
    }
    function thinkingDraw() {
      var th = S.thinking; if (!th) return;
      th.html = thinkingHtml(th);
      var old = $('aiwThinking'), col = el.messages.querySelector('.aiw-col');
      if (old) {
        /* patch in place so the orb and the open / closed state of the steps never restart */
        var t = $('aiwThinkTitle'), rl = $('aiwThinkRail'), ls = $('aiwThinkSteps'), ct = $('aiwThinkCount'), ft = old.querySelector('.aiw-tp-foot');
        if (t) t.textContent = thinkingTitle(th);
        if (rl) { rl.innerHTML = thinkingRail(th); rl.hidden = !th.odoo; }
        if (ls) ls.innerHTML = thinkingBody(th);
        if (ct) ct.textContent = Math.max(th.rows.length, 1);
        if (th.odoo && !ft) { var tmp = document.createElement('div'); tmp.innerHTML = th.html; var nf = tmp.querySelector('.aiw-tp-foot'); if (nf) old.querySelector('.aiw-tp').appendChild(nf); }
      } else if (col) col.insertAdjacentHTML('beforeend', th.html); else renderMessages();
      scrollDown();
    }
    function thinkingStop() { if (S.thinking && S.thinking.timer) clearInterval(S.thinking.timer); S.thinking = null; var n = $('aiwThinking'); if (n) n.remove(); }

    /* ── fast Odoo reads: shared cache, in-flight de-duplication, hover prefetch ── */
    var rpcCache = Object.create(null), RPC_TTL = 30000;
    function rpc(endpoint, body, fresh) {
      var O = window.DVOdoo;
      if (!O || !O.rpc) return Promise.reject(new Error('The Odoo module is not available on this page.'));
      var key = endpoint + '|' + JSON.stringify(body || {}), hit = rpcCache[key];
      if (!fresh && hit && Date.now() - hit.at < RPC_TTL) return hit.p;
      var p = O.rpc(endpoint, body || {});
      rpcCache[key] = { at: Date.now(), p: p };
      p.catch(function () { if (rpcCache[key] && rpcCache[key].p === p) delete rpcCache[key]; });
      var keys = Object.keys(rpcCache); if (keys.length > 120) delete rpcCache[keys[0]];
      return p;
    }
    var SKIP_TYPES = /^(binary|html|one2many|many2many|properties|json|serialized|reference)$/;
    function getFields(model) {
      if (S.fieldCache[model]) return S.fieldCache[model];
      var p = rpc('fields', { model: model }).then(function (r) { return r.fields || {}; }).catch(function (e) { delete S.fieldCache[model]; throw e; });
      S.fieldCache[model] = p; return p;
    }
    function fieldMeta(f) { return Array.isArray(f) ? { type: f[0], label: f[1], relation: f[2] || '' } : { type: f && f.type, label: f && (f.string || f.label), relation: f && f.relation || '' }; }
    var PREFERRED = ['name', 'display_name', 'partner_id', 'state', 'stage_id', 'date_order', 'invoice_date', 'invoice_date_due', 'scheduled_date', 'date', 'create_date', 'amount_total', 'amount_residual', 'amount_untaxed', 'expected_revenue', 'product_id', 'quantity', 'product_uom_qty', 'qty_available', 'list_price', 'default_code', 'email', 'user_id', 'department_id', 'job_id'];
    function pickColumns(fields, max) {
      var out = [];
      PREFERRED.forEach(function (n) { if (out.length < (max || 7) && fields[n] && !SKIP_TYPES.test(fieldMeta(fields[n]).type)) out.push(n); });
      if (out.length < 4) Object.keys(fields).forEach(function (n) { var t = fieldMeta(fields[n]).type; if (out.length < (max || 7) && out.indexOf(n) < 0 && !SKIP_TYPES.test(t) && !/^(id|__last_update|write_uid|create_uid|write_date)$/.test(n)) out.push(n); });
      return out;
    }
    function cellText(v, meta) {
      if (v === false || v == null) return meta && meta.type === 'boolean' ? 'No' : '';
      if (v === true) return 'Yes';
      if (Array.isArray(v)) return v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' ? v[1] : v.length + ' item(s)';
      if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
      return String(v);
    }
    function recordsFor(frame) {
      return getFields(frame.model).then(function (fields) {
        var cols = pickColumns(fields);
        return rpc('records', { model: frame.model, domain: frame.domain || [], fields: cols.length ? cols : undefined, limit: 25, offset: frame.offset || 0, order: 'id desc' })
          .then(function (r) { return { fields: fields, cols: cols, rows: r.rows || [], total: r.total || 0 }; });
      });
    }

    /* ── plain-language filters ─────────────────────────────────────────── */
    var OPS = { '=': 'is', '!=': 'is not', '>': '>', '>=': '≥', '<': '<', '<=': '≤', 'in': 'is one of', 'not in': 'is not one of', 'like': 'matches', 'ilike': 'contains', 'not ilike': 'does not contain', '=like': 'matches', '=ilike': 'matches', 'child_of': 'is under' };
    function domVal(v) { return Array.isArray(v) ? v.slice(0, 6).join(', ') + (v.length > 6 ? ' …' : '') : v === false ? 'empty' : v === true ? 'yes' : String(v); }
    function humanDomain(d) {
      var out = [], pend = '';
      (d || []).forEach(function (t) {
        if (typeof t === 'string') { pend = t === '|' ? 'either ' : t === '!' ? 'not ' : ''; return; }
        out.push(pend + '<code>' + esc(t[0]) + '</code> ' + esc(OPS[t[1]] || t[1]) + ' <code>' + esc(domVal(t[2])) + '</code>'); pend = '';
      });
      return out;
    }

    /* ── data table helper ──────────────────────────────────────────────── */
    function tableHtml(columns, rows, opt) {
      opt = opt || {};
      var head = columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
      var body = rows.map(function (r, ri) {
        return '<tr' + (opt.rowAttr ? ' ' + opt.rowAttr(ri) : '') + '>' + r.map(function (v, ci) {
          var num = typeof v === 'number' || (/^-?[\d,]+(\.\d+)?$/.test(String(v)) && String(v).length < 16);
          return '<td' + (num ? ' class="num"' : '') + ' title="' + esc(v == null ? '' : v) + '">' + esc(v == null ? '' : (typeof v === 'number' ? fmtVal(v) : v)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="aiw-tbl-wrap"><table class="aiw-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + (body || '<tr><td colspan="' + columns.length + '">No rows.</td></tr>') + '</tbody></table></div>';
    }

    /* ══════════ drill popup: opens instantly with a skeleton, fills from cache or Odoo ══════════ */
    var pop = { el: null, seq: 0 };
    function ensurePop() {
      if (pop.el) return pop.el;
      var d = document.createElement('div');
      d.className = 'aiw-pop'; d.hidden = true; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Drill details');
      d.innerHTML = '<div class="aiw-pop-back" data-act="pop-close"></div><div class="aiw-pop-card"><header class="aiw-pop-head"><div class="aiw-pop-titlebox"><small id="aiwPopKind">Drill</small><h3 id="aiwPopTitle"></h3></div><button type="button" class="aiw-iconbtn" data-act="pop-close" aria-label="Close">✕</button></header><div class="aiw-pop-crumbs aiw-crumbs" id="aiwPopCrumbs"></div><div class="aiw-pop-body" id="aiwPopBody"></div><footer class="aiw-pop-foot" id="aiwPopFoot"></footer></div>';
      root.appendChild(d); pop.el = d; return d;
    }
    function popOpen() { return pop.el && !pop.el.hidden; }
    function openPopup(frame) {
      var d = ensurePop();
      S.stack.push(frame);
      if (d.hidden) { d.hidden = false; void d.offsetWidth; d.classList.add('in'); }
      paintPop(); renderRoute();
    }
    function popTo(i) {                 // keep frames 0..i
      S.stack = S.stack.slice(0, i + 1);
      if (!S.stack.length) return closePopup();
      paintPop(); renderRoute();
    }
    function closePopup() {
      S.stack = []; pop.seq++;
      if (pop.el && !pop.el.hidden) { pop.el.classList.remove('in'); var d = pop.el; setTimeout(function () { if (!S.stack.length) d.hidden = true; }, 180); }
      renderRoute();
    }
    function paintPop() {
      var f = S.stack[S.stack.length - 1]; if (!f) return;
      var my = ++pop.seq, kindLabel = { records: 'Records', record: 'Record', table: 'Rows', message: 'Details', groups: 'Breakdown' }[f.kind] || 'Drill';
      $('aiwPopKind').textContent = kindLabel + (f.model ? ' · ' + f.model : '');
      $('aiwPopTitle').textContent = f.title || f.label || 'Details';
      $('aiwPopCrumbs').innerHTML = S.stack.map(function (x, i) { return (i ? '<i>›</i>' : '') + (i === S.stack.length - 1 ? '<b>' + esc(x.label || x.title) + '</b>' : '<button type="button" data-act="pop-to" data-i="' + i + '">' + esc(x.label || x.title) + '</button>'); }).join('');
      var body = $('aiwPopBody'), foot = $('aiwPopFoot');
      if (f.kind === 'message') { body.innerHTML = '<div class="aiw-empty"><b>' + esc(f.title) + '</b>' + esc(f.text) + '</div>'; foot.innerHTML = '<button type="button" class="aiw-btn" data-act="pop-close">Close</button>'; return; }
      if (f.kind === 'table') { paintTable(f, body, foot); return; }
      if (f.kind === 'groups') { paintGroups(f, body, foot, my); return; }
      body.innerHTML = '<div class="aiw-skel"></div><div class="aiw-skel" style="margin-top:8px;height:200px"></div>'; foot.innerHTML = '';
      if (f.kind === 'records') {
        recordsFor(f).then(function (r) { if (my !== pop.seq) return; paintRecords(f, r, body, foot); })
          .catch(function (e) { if (my !== pop.seq) return; body.innerHTML = '<div class="aiw-box bad"><h5>Could not read these records</h5><p>' + esc(e.message || e) + '</p></div>'; foot.innerHTML = '<button type="button" class="aiw-btn" data-act="pop-retry">Try again</button>'; });
      } else if (f.kind === 'record') {
        getFields(f.model).then(function (fields) {
          var names = Object.keys(fields).filter(function (n) { return !SKIP_TYPES.test(fieldMeta(fields[n]).type) && !/^(__last_update|write_uid|create_uid)$/.test(n) && !/(password|token|secret|api_key)/i.test(n); }).slice(0, 70);
          return rpc('records', { model: f.model, domain: [['id', '=', f.id]], fields: names, limit: 1 }).then(function (r) { return { fields: fields, row: (r.rows || [])[0] }; });
        }).then(function (r) { if (my !== pop.seq) return; paintRecord(f, r, body, foot); })
          .catch(function (e) { if (my !== pop.seq) return; body.innerHTML = '<div class="aiw-box bad"><h5>Could not read this record</h5><p>' + esc(e.message || e) + '</p></div>'; foot.innerHTML = ''; });
      }
    }
    function paintRecords(f, r, body, foot) {
      var off = f.offset || 0, from = r.total ? off + 1 : 0, to = off + r.rows.length;
      var colsMeta = r.cols.map(function (c) { return fieldMeta(r.fields[c]); });
      var rows = r.rows.map(function (row) { return r.cols.map(function (c, i) { return cellText(row[c], colsMeta[i]); }); });
      var domainLines = humanDomain(f.domain);
      body.innerHTML = (domainLines.length ? '<div class="aiw-popfilter"><small>Filter</small><ul class="aiw-filter">' + domainLines.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' : '') +
        '<div class="aiw-pop-kpi"><b>' + r.total.toLocaleString() + '</b><span>matching record' + (r.total === 1 ? '' : 's') + '</span><span class="aiw-pop-meas" id="aiwPopMeas"></span></div>' +
        '<div class="aiw-gby" id="aiwGby" aria-label="Break these records down by"></div>' +
        tableHtml(r.cols.map(function (c, i) { return colsMeta[i].label || c; }), rows, { rowAttr: function (i) { return 'data-act="pop-rec" data-model="' + esc(f.model) + '" data-id="' + esc(r.rows[i].id) + '" title="Open this record"'; } });
      foot.innerHTML = '<span class="aiw-pager-info">' + (r.total ? from + '–' + to + ' of ' + r.total.toLocaleString() : 'No records') + '</span><div class="aiw-btns">' +
        '<button type="button" class="aiw-btn" data-act="pop-page" data-d="-1"' + (off ? '' : ' disabled') + '>‹ Prev</button><button type="button" class="aiw-btn" data-act="pop-page" data-d="1"' + (to < r.total ? '' : ' disabled') + '>Next ›</button>' +
        (window.DVDrill ? '<button type="button" class="aiw-btn" data-act="pop-explorer">Open in Drill explorer</button>' : '') + '<button type="button" class="aiw-btn" data-act="pop-csv">CSV (this page)</button></div>';
      pop.last = { cols: r.cols.map(function (c, i) { return colsMeta[i].label || c; }), rows: rows, name: f.model };
      fillGby(f, r.fields, null); fillMeasure(f);
    }
    function paintRecord(f, r, body, foot) {
      var row = r.row;
      if (!row) { body.innerHTML = '<div class="aiw-empty"><b>Record not found</b>It may have been deleted or you may not have access.</div>'; return; }
      var names = Object.keys(row).filter(function (n) { return n !== 'id' && row[n] !== false && row[n] !== null && row[n] !== '' && !(Array.isArray(row[n]) && !row[n].length); });
      var items = names.map(function (n) {
        var meta = fieldMeta(r.fields[n] || []), v = row[n], label = meta.label || n, txt = cellText(v, meta);
        var linkable = Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && meta.relation && !/^(res\.users|ir\.|res\.company)/.test(meta.relation);
        return '<dt>' + esc(label) + '</dt><dd>' + (linkable ? '<button type="button" class="aiw-linkbtn" data-act="pop-rec" data-model="' + esc(meta.relation) + '" data-id="' + esc(v[0]) + '" title="Open ' + esc(meta.relation) + '">' + esc(txt) + ' ›</button>' : esc(txt)) + '</dd>';
      }).join('');
      body.innerHTML = '<dl class="aiw-kv aiw-kv-wide">' + items + '</dl>';
      var link = recordLink(f.model, f.id);
      foot.innerHTML = '<span class="aiw-pager-info">ID ' + esc(f.id) + '</span><div class="aiw-btns">' + (link ? '<a class="aiw-btn primary" target="_blank" rel="noopener noreferrer" href="' + esc(link) + '">Open in Odoo ↗</a>' : '') + '<button type="button" class="aiw-btn" data-act="pop-back">‹ Back</button></div>';
    }
    function paintTable(f, body, foot) {
      var q = (f.q || '').toLowerCase(), rows = f.rows;
      if (q) rows = rows.filter(function (r) { return r.some(function (v) { return String(v == null ? '' : v).toLowerCase().indexOf(q) > -1; }); });
      var page = f.page || 0, per = 25, slice = rows.slice(page * per, page * per + per);
      body.innerHTML = '<div class="aiw-tools"><input type="search" id="aiwPopSearch" placeholder="Filter these rows" value="' + esc(f.q || '') + '" aria-label="Filter rows"/></div>' +
        '<div class="aiw-pop-kpi"><b>' + (f.total != null ? f.total : f.rows.length).toLocaleString() + '</b><span>row' + ((f.total != null ? f.total : f.rows.length) === 1 ? '' : 's') + (q ? ' · ' + rows.length + ' shown' : '') + (f.total > f.rows.length ? ' (first ' + f.rows.length + ' loaded)' : '') + '</span></div>' + tableHtml(f.columns, slice);
      foot.innerHTML = '<span class="aiw-pager-info">' + (rows.length ? page * per + 1 + '–' + (page * per + slice.length) + ' of ' + rows.length : 'No rows') + '</span><div class="aiw-btns">' +
        '<button type="button" class="aiw-btn" data-act="pop-tpage" data-d="-1"' + (page ? '' : ' disabled') + '>‹ Prev</button><button type="button" class="aiw-btn" data-act="pop-tpage" data-d="1"' + ((page + 1) * per < rows.length ? '' : ' disabled') + '>Next ›</button><button type="button" class="aiw-btn" data-act="pop-csv">CSV</button></div>';
      pop.last = { cols: f.columns, rows: rows, name: f.title };
      var inp = $('aiwPopSearch');
      if (inp) inp.addEventListener('input', function () { f.q = inp.value; f.page = 0; var pos = inp.selectionStart; paintTable(f, body, foot); var n = $('aiwPopSearch'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } });
    }


    /* ── drill v2: break any set of records down by another field (read-only read-group), then keep drilling ── */
    function measureOf(m) { m = String(m || ''); if (!m || /^(count|record count|__count)$/i.test(m)) return ''; return m.indexOf(':') < 0 ? m + ':sum' : m; }
    function measureLabel(m) { return String(m || '').split(':')[0].replace(/_/g, ' '); }
    var BY_PREF = ['partner_id', 'user_id', 'state', 'stage_id', 'product_id', 'team_id', 'categ_id', 'department_id', 'payment_state', 'company_id', 'warehouse_id', 'journal_id', 'invoice_date:month', 'date_order:month', 'date:month', 'create_date:month'];
    function groupChoices(fields) {
      var out = [], seen = Object.create(null);
      function add(by, label) { if (out.length < 10 && !seen[by]) { seen[by] = 1; out.push({ by: by, label: label }); } }
      BY_PREF.forEach(function (b) { var base = b.split(':')[0], f = fields[base]; if (!f) return; var mt = fieldMeta(f); if (b.indexOf(':') > 0 ? /date/.test(mt.type) : /many2one|selection|boolean/.test(mt.type)) add(b, (mt.label || base) + (b.indexOf(':') > 0 ? ' · month' : '')); });
      Object.keys(fields).forEach(function (n) { var mt = fieldMeta(fields[n]); if (/many2one|selection/.test(mt.type) && !/^(write_uid|create_uid|currency_id|message_|activity_|access_|website_)/.test(n) && !/(password|token|secret|api_key)/i.test(n)) add(n, mt.label || n); });
      return out;
    }
    function fillGby(f, fields, current) {
      var host = $('aiwGby'); if (!host) return;
      var go = function (flds) {
        var cs = groupChoices(flds); if (!cs.length) { host.hidden = true; return; }
        host.innerHTML = '<small>Break down by</small><div class="aiw-gby-chips">' + cs.map(function (c) { return '<button type="button" class="aiw-gchip' + (c.by === current ? ' on' : '') + '" data-act="pop-by" data-by="' + esc(c.by) + '" data-bl="' + esc(c.label) + '">' + esc(c.label) + '</button>'; }).join('') + '</div>';
      };
      if (fields) go(fields); else getFields(f.model).then(function (flds) { if (S.stack[S.stack.length - 1] === f) go(flds); }).catch(function () { host.hidden = true; });
    }
    function fillMeasure(f) {
      var meas = f.measure; if (!meas) return;
      var key = f.model + '|' + meas;
      rpc('read-group', { model: f.model, domain: f.domain || [], fields: [meas], groupby: [] }).then(function (r) {
        var g = (r.groups || [])[0], v = g && (g[meas] != null ? g[meas] : g[meas.split(':')[0]]), n = $('aiwPopMeas');
        if (n && S.stack[S.stack.length - 1] === f && typeof v === 'number') n.textContent = '· ' + measureLabel(meas) + ' ' + window.DVAITemplate.fmtCompact(v) + (/:sum$/.test(meas) ? '' : ' (' + meas.split(':')[1] + ')');
      }).catch(function () { void key; });
    }
    function groupLabel(v) { if (v === false || v == null) return '(none)'; if (Array.isArray(v)) return v.length === 2 && typeof v[1] === 'string' ? v[1] : String(v[0]); return String(v); }
    function groupsFor(f) {
      var meas = f.useMeasure !== false ? f.measure : '';
      return rpc('read-group', { model: f.model, domain: f.domain || [], fields: meas ? [meas] : [], groupby: [f.by], limit: 80 }).then(function (r) {
        var isDate = f.by.indexOf(':') > 0, base = f.by.split(':')[0];
        var rows = (r.groups || []).map(function (g) {
          var val = meas ? (g[meas] != null ? g[meas] : g[meas.split(':')[0]]) : (g.__count != null ? g.__count : g.count);
          return { label: groupLabel(g[f.by] != null ? g[f.by] : g[base]), value: typeof val === 'number' ? val : 0, count: g.__count != null ? g.__count : g.count, domain: Array.isArray(g.__domain) ? g.__domain : null };
        });
        if (!isDate) rows.sort(function (a, b) { return b.value - a.value; });
        return rows;
      });
    }
    function paintGroups(f, body, foot, my) {
      var T = window.DVAITemplate;
      body.innerHTML = '<div class="aiw-skel"></div><div class="aiw-skel" style="margin-top:8px;height:160px"></div>'; foot.innerHTML = '';
      Promise.all([getFields(f.model), groupsFor(f)]).then(function (res) {
        if (my !== pop.seq) return;
        var fields = res[0], rows = res[1], meas = f.useMeasure !== false ? f.measure : '', total = rows.reduce(function (a, x) { return a + x.value; }, 0), max = rows.reduce(function (a, x) { return Math.max(a, Math.abs(x.value)); }, 0) || 1, recs = rows.reduce(function (a, x) { return a + (x.count || 0); }, 0);
        var lines = humanDomain(f.domain), isAdd = !meas || /:sum$/.test(meas);
        f.groups = rows;
        body.innerHTML = (lines.length ? '<div class="aiw-popfilter"><small>Filter</small><ul class="aiw-filter">' + lines.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' : '') +
          '<div class="aiw-pop-kpi"><b>' + esc(T.fmtCompact(total)) + '</b><span>' + (meas ? esc(measureLabel(meas)) : 'records') + ' across ' + rows.length + ' group' + (rows.length === 1 ? '' : 's') + (meas ? ' · ' + recs.toLocaleString() + ' records' : '') + '</span></div>' +
          '<div class="aiw-gby" id="aiwGby"></div>' +
          (f.measure ? '<div class="aiw-gby aiw-gm"><small>Measure</small><div class="aiw-gby-chips"><button type="button" class="aiw-gchip' + (meas ? '' : ' on') + '" data-act="pop-gm" data-m="count">Records</button><button type="button" class="aiw-gchip' + (meas ? ' on' : '') + '" data-act="pop-gm" data-m="measure">' + esc(measureLabel(f.measure)) + '</button></div></div>' : '') +
          (rows.length ? '<div class="aiw-groups aiw-groups-pro">' + rows.map(function (x, gi) { var sh = isAdd && total > 0 && x.value >= 0 ? Math.round(x.value / total * 1000) / 10 + '%' : ''; return '<button type="button" class="aiw-grow" ' + (x.domain ? 'data-act="pop-grow" data-gi="' + gi + '"' : 'disabled') + ' style="--w:' + Math.max(2, Math.abs(x.value) / max * 100).toFixed(1) + '%"><span>' + esc(x.label) + '</span><b>' + esc(T.fmtCompact(x.value)) + '</b><em>' + (sh ? sh + ' · ' : '') + (x.count != null ? x.count.toLocaleString() + ' rec' : '') + (x.domain ? ' ›' : '') + '</em></button>'; }).join('') + '</div>' : '<div class="aiw-empty"><b>No groups</b>Nothing matched, or this field cannot be grouped.</div>');
        fillGby(f, fields, f.by);
        foot.innerHTML = '<span class="aiw-pager-info">' + rows.length + ' group' + (rows.length === 1 ? '' : 's') + (rows.length >= 80 ? ' (first 80)' : '') + '</span><div class="aiw-btns"><button type="button" class="aiw-btn" data-act="pop-back">‹ Back</button>' + (window.DVDrill ? '<button type="button" class="aiw-btn" data-act="pop-explorer">Open in Drill explorer</button>' : '') + '<button type="button" class="aiw-btn" data-act="pop-csv">CSV</button></div>';
        pop.last = { cols: ['Group', meas ? measureLabel(meas) : 'Records', 'Records'], rows: rows.map(function (x) { return [x.label, x.value, x.count == null ? '' : x.count]; }), name: f.model + '-by-' + f.by.split(':')[0] };
      }).catch(function (e) { if (my !== pop.seq) return; body.innerHTML = '<div class="aiw-box bad"><h5>Could not break these records down</h5><p>' + esc(e.message || e) + '</p></div>'; foot.innerHTML = '<button type="button" class="aiw-btn" data-act="pop-back">‹ Back</button>'; });
    }

    /* Resolve “what would opening this open?” from a button's data attributes (used by click and by hover prefetch). */
    function frameFromEl(t) {
      var act = t.getAttribute('data-act');
      if (act === 'vis-drill') {
        var vp = visPayloads[t.getAttribute('data-mid')], vm = vp && vp.metrics[+t.getAttribute('data-mi')], vr = vm && vm.rows[+t.getAttribute('data-ri')];
        if (vm && vr && Array.isArray(vr.domain)) return { kind: 'records', model: vm.model, domain: vr.domain, title: vm.title + ' · ' + vr.label, label: vr.label, offset: 0, measure: measureOf(vm.measure) };
      }
      if (act === 'dash-drill') {
        var pl = dashboardPayloads[t.getAttribute('data-dash')], me = pl && pl.metrics[+t.getAttribute('data-mi')], row = me && me.rows[+t.getAttribute('data-ri')];
        if (me && row && Array.isArray(row.domain)) return { kind: 'records', model: me.model, domain: row.domain, title: me.title + ' · ' + row.label, label: row.label, offset: 0 };
      }
      if (act === 'q-group' || act === 'q-records') {
        var f = findMsg(t.getAttribute('data-mid')), q = f && f.m.trace && f.m.trace.queries.filter(function (x) { return x.id === t.getAttribute('data-q'); })[0];
        if (q) {
          if (act === 'q-records') return { kind: 'records', model: q.model, domain: q.domain || [], title: q.model + ' · matching records', label: 'Records', offset: 0 };
          var g = (q.groups || [])[+t.getAttribute('data-gi')];
          if (g && Array.isArray(g.domain)) return { kind: 'records', model: q.model, domain: g.domain, title: g.label + ' · ' + q.model, label: g.label, offset: 0 };
        }
      }
      return null;
    }
    var hoverTimer = 0;
    root.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('[data-act="dash-drill"],[data-act="vis-drill"],[data-act="q-group"],[data-act="q-records"]');
      if (!t) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () { var f = frameFromEl(t); if (f) recordsFor(f).catch(function () {}); }, 140);   // warm the cache so the click is instant
    });
    root.addEventListener('mouseout', function () { clearTimeout(hoverTimer); });

    /* ══════════ reports (file + reconcile) ══════════ */
    function lineChartHtml(m, mid, mi) {
      var rows = m.rows, W = 560, H = 150, L = 12, R = 12, T = 18, B = 26, vals = rows.map(function (r) { return r.value; });
      var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = (mx - mn) || 1, n = rows.length;
      var pts = rows.map(function (r, i) { return { x: L + i * (W - L - R) / (n - 1), y: T + (1 - (r.value - mn) / span) * (H - T - B) }; });
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
      var area = d + ' L' + pts[n - 1].x.toFixed(1) + ' ' + (H - B) + ' L' + pts[0].x.toFixed(1) + ' ' + (H - B) + ' Z';
      var step = Math.ceil(n / 7);
      var dots = pts.map(function (p, i) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5"' + (rows[i].drill ? ' data-act="rdrill" data-mid="' + mid + '" data-mi="' + mi + '" data-ri="' + i + '"' : '') + '><title>' + esc(rows[i].label + ': ' + fmtVal(rows[i].value)) + '</title></circle>'; }).join('');
      var labels = rows.map(function (r, i) { return i % step && i !== n - 1 ? '' : '<text x="' + pts[i].x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + esc(r.label) + '</text>'; }).join('');
      var hi = vals.indexOf(mx);
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m.title) + '"><line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="currentColor" opacity=".2"/><path class="ar" d="' + area + '"/><path class="ln" d="' + d + '"/>' + dots + labels +
        '<text x="' + Math.min(Math.max(pts[hi].x, 28), W - 28).toFixed(1) + '" y="' + (pts[hi].y - 8).toFixed(1) + '" text-anchor="middle" style="opacity:1;font-weight:700">' + esc(fmtVal(mx)) + '</text></svg>';
    }
    function reportHtml(r, mid) {
      var F = window.DVAIFiles, kpis = (r.kpis || []).map(function (k) { return '<div class="aiw-kpi"' + (k.tone ? ' data-t="' + k.tone + '"' : '') + '><small>' + esc(k.label) + '</small><b' + (String(k.value).length > 14 ? ' style="font-size:14px;line-height:1.35"' : '') + '>' + esc(k.value) + '</b>' + (k.hint ? '<span>' + esc(k.hint) + '</span>' : '') + '</div>'; }).join('');
      var charts = (r.metrics || []).map(function (m, mi) {
        var rows = (m.rows || []).filter(function (x) { return isFinite(x.value); });
        if (!rows.length) return '';
        var inner;
        if (m.chartType === 'line' && rows.length > 1) inner = lineChartHtml({ title: m.title, rows: rows }, mid, mi);
        else {
          var max = Math.max.apply(null, rows.map(function (x) { return Math.abs(x.value); })) || 1;
          inner = rows.map(function (x, ri) {
            var can = !!x.drill;
            return '<' + (can ? 'button type="button" data-act="rdrill" data-mid="' + mid + '" data-mi="' + mi + '" data-ri="' + ri + '" title="Show these rows"' : 'div') + ' class="aiw-drow"><span class="l">' + esc(x.label) + '</span><span class="tr"><i style="--w:' + Math.max(2, Math.abs(x.value) / max * 100).toFixed(1) + '%"></i></span><b>' + esc(fmtVal(x.value)) + (can ? '<span class="go">›</span>' : '') + '</b></' + (can ? 'button' : 'div') + '>';
          }).join('');
        }
        return '<div class="aiw-chart"><h4>' + esc(m.title) + '</h4>' + inner + '</div>';
      }).join('');
      var finds = (r.quality || []).map(function (q) {
        var icon = q.level === 'error' ? '✕' : q.level === 'warn' ? '!' : q.level === 'good' ? '✓' : 'i';
        return '<div class="aiw-find" data-l="' + q.level + '"><span class="ic">' + icon + '</span><div><b>' + esc(q.title) + '</b><p>' + esc(q.detail || '') + '</p></div>' + (q.table ? '<button type="button" class="aiw-btn" data-act="rtable" data-mid="' + mid + '" data-key="' + esc(q.table) + '">View ' + (q.records ? Math.min(q.records, 500) + ' ' : '') + 'rows ›</button>' : '') + '</div>';
      }).join('');
      var ins = (r.insights || []).length ? '<ul class="aiw-insights">' + r.insights.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '';
      var isRec = r.kind === 'reconcile', fileOk = !!S.files[r.fileId];
      var actions = '<div class="aiw-btns"><button type="button" class="aiw-btn primary" data-act="rpdf" data-mid="' + mid + '">PDF report</button><button type="button" class="aiw-btn" data-act="rxlsx" data-mid="' + mid + '">Excel</button>' +
        (isRec ? '<button type="button" class="aiw-btn" data-act="rerecon" data-mid="' + mid + '">Run again</button>' : '<button type="button" class="aiw-btn" data-act="file-recon" data-id="' + esc(r.fileId) + '">Reconcile with Odoo</button><button type="button" class="aiw-btn" data-act="file-ask" data-id="' + esc(r.fileId) + '">Ask AI about this file</button>') + '</div>';
      return '<div class="aiw-report"><div class="aiw-report-head"><div><h3>' + esc(r.title) + '</h3><p>' + esc(r.file.name) + (r.file.sheet && r.file.sheet !== r.file.name ? ' · sheet “' + esc(r.file.sheet) + '”' : '') + ' · ' + r.file.rows.toLocaleString() + ' rows × ' + r.file.columns + ' cols' +
        (isRec ? ' · ' + esc(r.target.model) + '.' + esc(r.target.field) : '') + '</p></div>' + actions + '</div>' +
        '<div class="aiw-kpis">' + kpis + '</div>' + (ins ? ins : '') + charts + '<div class="aiw-finds">' + finds + '</div>' +
        (r.method ? '<p class="aiw-note">' + esc(r.method.join(' · ')) + '</p>' : '<p class="aiw-note">Computed in your browser from the rows in the file. Nothing was uploaded' + (fileOk ? '.' : '; the rows are no longer in memory — attach the file again to drill into them.') + '</p>') + '</div>';
    }
    function reportFrame(mid, kind, a, b) {
      var found = findMsg(mid), r = found && found.m.report; if (!r) return null;
      var F = window.DVAIFiles, fileEntry = S.files[r.fileId];
      if (kind === 'metric') {
        var m = r.metrics[a], row = m && m.rows[b]; if (!row || !row.drill) return null;
        if (row.drill.table) return reportFrame(mid, 'table', row.drill.table);
        if (!fileEntry) return { kind: 'message', title: 'File not in memory', label: 'Rows', text: 'Reports are saved without the file\'s rows. Attach “' + r.file.name + '” again to drill into the rows behind this number.' };
        var res = F.rowsWhere(fileEntry.file, row.drill);
        return { kind: 'table', title: m.title + ' · ' + row.label, label: row.label, columns: res.columns, rows: res.rows, total: res.total };
      }
      if (kind === 'table') {
        var tb = r.tables && r.tables[a];
        if (!tb) return { kind: 'message', title: 'Rows not stored', label: 'Rows', text: 'The rows behind this finding were not saved with the chat. Run the report again (attach the file) to see them.' };
        return { kind: 'table', title: tb.title, label: tb.title, columns: tb.columns, rows: tb.rows, total: tb.rows.length };
      }
      return null;
    }
    function reportExcel(r) {
      var rows = [];
      (r.kpis || []).forEach(function (k) { rows.push({ Section: 'Summary', Item: k.label, Value: String(k.value), Detail: k.hint || '' }); });
      (r.insights || []).forEach(function (x) { rows.push({ Section: 'Insight', Item: '', Value: '', Detail: x }); });
      (r.metrics || []).forEach(function (m) { m.rows.forEach(function (x) { rows.push({ Section: m.title, Item: x.label, Value: String(x.value), Detail: x.count != null ? x.count + ' records' : '' }); }); });
      (r.quality || []).forEach(function (q) { rows.push({ Section: 'Finding · ' + q.level, Item: q.title, Value: q.records != null ? String(q.records) : '', Detail: q.detail || '' }); });
      Object.keys(r.tables || {}).forEach(function (k) { var tb = r.tables[k]; tb.rows.slice(0, 200).forEach(function (row) { rows.push({ Section: 'Rows · ' + tb.title, Item: String(row[0] == null ? '' : row[0]), Value: String(row[1] == null ? '' : row[1]), Detail: row.slice(2).map(function (v) { return v == null ? '' : v; }).join(' | ') }); }); });
      return { title: r.title, workbookName: r.title, generatedAt: r.generatedAt, sourceFileName: r.file.name, fields: [{ name: 'Section', type: 'text' }, { name: 'Item', type: 'text' }, { name: 'Value', type: 'text' }, { name: 'Detail', type: 'text' }], rows: rows };
    }

    /* ══════════ details pane: Path · Connection · Files ══════════ */
    function openInsp(tab, silent) {
      if (window.DVArtifacts && window.DVArtifacts.isPanelOpen && window.DVArtifacts.isPanelOpen()) window.DVArtifacts.closePanel();
      S.tab = tab || S.tab || 'path';
      root.dataset.insp = 'open'; el.inspBtn.setAttribute('aria-pressed', 'true');
      if (S.tab === 'path' && !S.selMsg) {
        var t = activeThread(), arr = t ? t.messages.filter(function (m) { return m.role === 'ai' && (m.trace || m.report); }) : [];
        if (arr.length) S.selMsg = arr[arr.length - 1].id;
      }
      Array.prototype.forEach.call(el.inspTabs.querySelectorAll('button'), function (b) { var on = b.getAttribute('data-tab') === S.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
      renderInsp(); markSelected(); renderRoute(); syncScrim();
      if (S.tab === 'connection') checkHealth(false);
      if (!silent) writeRoute();
    }
    function closeInsp() { root.dataset.insp = 'closed'; el.inspBtn.setAttribute('aria-pressed', 'false'); markSelected(); renderRoute(); syncScrim(); writeRoute(); }
    function markSelected() {
      Array.prototype.forEach.call(el.messages.querySelectorAll('.aiw-msg.ai .aiw-card'), function (c) {
        var mid = c.closest('.aiw-msg').getAttribute('data-mid');
        c.classList.toggle('selected', isInspOpen() && S.tab === 'path' && mid === S.selMsg);
      });
    }
    function syncScrim() {
      var narrow = window.innerWidth <= 900, mid = window.innerWidth <= 1240;
      el.scrim.hidden = !((narrow && root.dataset.rail === 'open') || (mid && isInspOpen()));
    }
    function selectMsg(mid, tab) { S.selMsg = mid; S.stack = []; if (popOpen()) closePopup(); openInsp(tab || 'path'); }

    function renderInsp() {
      if (!isInspOpen()) return;
      var keep = el.inspBody.scrollTop;
      el.inspBody.innerHTML = S.tab === 'connection' ? connHtml() : S.tab === 'files' ? filesHtml() : pathHtml();
      el.inspBody.scrollTop = keep;
    }

    /* — Path tab — */
    function precedingQuestion(i, t) { for (var k = i - 1; k >= 0; k--) if (t.messages[k].role === 'user') return t.messages[k].content; return ''; }
    function timelineHtml(steps) {
      if (!steps || !steps.length) return '';
      return '<ol class="aiw-timeline">' + steps.map(function (s) { return '<li><b>' + esc(s.label) + '</b>' + (s.ms != null ? '<small>' + fmtMs(s.ms) + '</small>' : '') + '</li>'; }).join('') + '</ol>';
    }
    function queryHtml(m, q) {
      var key = m.id + ':' + q.id, open = !!S.openQ[key];
      var sub = q.op === 'read-group' ? ((q.groupby || []).join(' / ') || 'total') + (q.measure ? ' · ' + q.measure : '') : q.op === 'records' ? (q.fields || []).slice(0, 4).join(', ') : q.op === 'count' ? 'count' : 'field catalogue';
      var res = '';
      if (!q.ok) res = '<div class="aiw-box bad"><h5>This query failed</h5><p>' + esc(q.error || 'No result') + '</p></div>';
      else if (q.op === 'count') res = '<div class="aiw-box"><h5>' + Number(q.count).toLocaleString() + ' matching records</h5></div>';
      else if (q.op === 'fields') res = '<div class="aiw-box"><h5>' + (q.fieldCount || 0) + ' fields read</h5><p>Used to choose valid field names; no business data.</p></div>';
      else if (q.op === 'read-group') {
        var gs = q.groups || [], max = Math.max.apply(null, gs.map(function (g) { return Math.abs(g.value || 0); }).concat([1]));
        res = gs.length ? '<div class="aiw-groups">' + gs.map(function (g, gi) {
          var can = Array.isArray(g.domain);
          return '<button type="button" class="aiw-grow" style="--w:' + (Math.abs(g.value || 0) / max * 100).toFixed(1) + '%"' + (can ? ' data-act="q-group" data-mid="' + m.id + '" data-q="' + esc(q.id) + '" data-gi="' + gi + '" title="Show the records behind this number"' : ' disabled') + '><span>' + esc(g.label) + '</span><b>' + esc(fmtVal(g.value)) + '</b><em>' + (g.count != null ? g.count + ' rec' : '') + (can ? ' ›' : '') + '</em></button>';
        }).join('') + '</div>' : '<div class="aiw-box"><p>No groups returned.</p></div>';
      } else if (q.op === 'records') {
        var rows = q.rows || [], cols = []; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== 'id' && cols.indexOf(k) < 0 && cols.length < 6) cols.push(k); }); });
        res = '<p class="aiw-note">' + (q.total != null ? Number(q.total).toLocaleString() + ' matching · showing ' + rows.length : rows.length + ' rows') + '</p>' +
          tableHtml(cols, rows.map(function (r) { return cols.map(function (c) { return r[c]; }); }), { rowAttr: function (i) { return 'data-act="q-rec" data-model="' + esc(q.model) + '" data-id="' + esc(rows[i].id) + '" title="Open this record"'; } });
      }
      var dom = humanDomain(q.domain);
      return '<div class="aiw-q' + (open ? ' open' : '') + (q.ok ? '' : ' bad') + '"><button type="button" class="aiw-q-head" data-act="q-toggle" data-key="' + esc(key) + '"><span class="aiw-q-op">' + esc(q.op) + '</span><span class="aiw-q-main"><b>' + esc(q.model) + '</b><small>' + esc(sub) + '</small></span><span class="aiw-q-chev">›</span></button>' +
        '<div class="aiw-q-body"><div><h4 class="aiw-mini">Filter in plain words</h4>' + (dom.length ? '<ul class="aiw-filter">' + dom.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '<p class="aiw-note">No filter — all records of this type.</p>') + '</div>' +
        '<dl class="aiw-kv"><dt>Operation</dt><dd>' + esc(q.op) + ' (read-only)</dd>' + (q.groupby && q.groupby.length ? '<dt>Grouped by</dt><dd>' + esc(q.groupby.join(', ')) + '</dd>' : '') + (q.fields && q.fields.length && q.op !== 'fields' ? '<dt>Fields</dt><dd>' + esc(q.fields.join(', ')) + '</dd>' : '') + (q.order ? '<dt>Order</dt><dd>' + esc(q.order) + '</dd>' : '') + (q.limit ? '<dt>Limit</dt><dd>' + esc(q.limit) + '</dd>' : '') + '</dl>' +
        res + '<div class="aiw-btns">' + (q.ok && q.op !== 'fields' ? '<button type="button" class="aiw-btn primary" data-act="q-records" data-mid="' + m.id + '" data-q="' + esc(q.id) + '">Records ›</button>' : '') +
        (q.ok && q.op !== 'fields' && window.DVDrill ? '<button type="button" class="aiw-btn" data-act="q-explorer" data-mid="' + m.id + '" data-q="' + esc(q.id) + '">Drill explorer</button>' : '') +
        '<button type="button" class="aiw-btn" data-act="q-copy" data-mid="' + m.id + '" data-q="' + esc(q.id) + '">Copy query</button></div></div></div>';
    }
    function pathHtml() {
      var f = S.selMsg && findMsg(S.selMsg);
      if (!f || f.m.role !== 'ai') return '<div class="aiw-empty"><b>Pick an answer</b>Choose <em>Path &amp; drill</em> under any answer to see how it was produced — the steps, the exact read-only Odoo queries, and the records behind every number.</div>';
      var m = f.m, qtext = precedingQuestion(f.i, f.t), out = '';
      out += '<div class="aiw-sec"><h4>Question</h4><div class="aiw-box"><p style="color:var(--ink)">' + esc(clip(qtext || '(attached file)', 320)) + '</p></div></div>';
      if (m.trace && (m.trace.kind === 'odoo' || m.trace.kind === 'status' || m.trace.kind === 'fallback')) {
        var t = m.trace, qs = (t.queries || []);
        out += '<div class="aiw-sec"><h4>Route taken</h4>' + timelineHtml(t.steps) + '</div>';
        var st = t.status || {};
        out += '<div class="aiw-sec"><h4>Summary</h4><div class="aiw-health"><div class="aiw-stat"><small>Queries</small><b>' + qs.filter(function (q) { return q.op !== 'fields'; }).length + (t.failed ? ' · ' + t.failed + ' failed' : '') + '</b></div><div class="aiw-stat"><small>Total time</small><b>' + fmtMs(t.ms) + '</b></div>' +
          (st.company ? '<div class="aiw-stat"><small>Company</small><b>' + esc(st.company) + '</b></div>' : '') + (st.version ? '<div class="aiw-stat"><small>Odoo</small><b>' + esc(st.version) + (st.latencyMs ? ' · ' + fmtMs(st.latencyMs) : '') + '</b></div>' : '') + '</div></div>';
        if (qs.length) out += '<div class="aiw-sec"><h4>Read-only queries (' + qs.length + ')</h4>' + qs.map(function (q) { return queryHtml(m, q); }).join('') + '</div>';
        if (t.kind === 'fallback') out += '<div class="aiw-box"><h5>Fixed snapshot used</h5><p>The query planner did not return a usable plan, so this answer used the standard company snapshot instead of targeted queries. Numbers may be less specific.</p></div>';
        if (t.kind === 'status') out += '<div class="aiw-box"><h5>Connection check</h5><p>This answer is a live health check of the Odoo connection; no business records were read.</p></div>';
        out += '<div class="aiw-box good"><h5>Read-only guarantee</h5><p>Only record, group, count and field-list reads are ever sent. Security models and secret-looking fields are blocked here and in the Worker.</p></div>';
      } else if (m.report) {
        var r = m.report, steps = r.kind === 'reconcile' ? [['Read the file in your browser', r.file.rows.toLocaleString() + ' rows'], ['Collected distinct ' + (r.target ? r.target.column : 'key') + ' values', ''], ['Looked them up in Odoo (' + (r.target ? r.target.model : '') + ', read-only)', ''], ['Compared and listed differences', '']] : [['Read the file in your browser', r.file.rows.toLocaleString() + ' rows × ' + r.file.columns + ' columns'], ['Profiled every column (type, empties, unique, range)', ''], ['Computed totals, breakdowns and data checks', ''], ['Nothing was uploaded', 'local only']];
        out += '<div class="aiw-sec"><h4>Route taken</h4><ol class="aiw-timeline">' + steps.map(function (s) { return '<li><b>' + esc(s[0]) + '</b>' + (s[1] ? '<small>' + esc(s[1]) + '</small>' : '') + '</li>'; }).join('') + '</ol></div>';
        var rows = (r.metrics || []).map(function (mt, mi) { return mt.rows.filter(function (x) { return x.drill; }).length ? '<div class="aiw-sec"><h4>' + esc(mt.title) + '</h4><div class="aiw-groups">' + mt.rows.map(function (x, ri) { return '<button type="button" class="aiw-grow" ' + (x.drill ? 'data-act="rdrill" data-mid="' + m.id + '" data-mi="' + mi + '" data-ri="' + ri + '"' : 'disabled') + ' style="--w:0%"><span>' + esc(x.label) + '</span><b>' + esc(fmtVal(x.value)) + '</b><em>' + (x.drill ? '›' : '') + '</em></button>'; }).join('') + '</div></div>' : ''; }).join('');
        out += rows;
        var tabs = Object.keys(r.tables || {});
        if (tabs.length) out += '<div class="aiw-sec"><h4>Row lists</h4><div class="aiw-btns">' + tabs.map(function (k) { return '<button type="button" class="aiw-btn" data-act="rtable" data-mid="' + m.id + '" data-key="' + esc(k) + '">' + esc(clip(r.tables[k].title, 38)) + ' (' + r.tables[k].rows.length + ')</button>'; }).join('') + '</div></div>';
        if (r.tablesDropped) out += '<div class="aiw-box"><p>Row lists are not stored with saved chats. Attach the file again to rebuild them.</p></div>';
      } else {
        var eng = m.engine === 'provider' ? 'Answered by ' + (m.providerLabel || 'your AI provider') : m.engine === 'local' ? 'Answered by the local engine' : 'General answer';
        out += '<div class="aiw-sec"><h4>Route taken</h4><div class="aiw-box"><h5>' + esc(eng) + '</h5><p>' + (m.engine === 'local' ? 'Rule-based, runs entirely in this tab. No data left your device and no Odoo records were read.' : m.engine === 'provider' ? 'Your messages were sent to the provider you configured. No Odoo records were read for this answer, because it was not a company-data question.' : 'No Odoo queries were needed for this answer.') + '</p></div></div>';
      }
      out += '<div class="aiw-btns"><button type="button" class="aiw-btn" data-act="retry" data-mid="' + m.id + '">Ask again</button><button type="button" class="aiw-btn" data-act="path-json" data-mid="' + m.id + '">Copy path (JSON)</button></div>';
      return out;
    }

    /* — Connection tab — */
    function connHtml() {
      var o = odooInfo(), p = providerInfo(), h = S.health, out = '';
      out += '<div class="aiw-sec"><h4>Odoo</h4>';
      if (!o.connected) out += '<div class="aiw-box bad"><h5>Not connected</h5><p>Add your Odoo URL, database, username and an API key in Settings to read live company data. Until then I will never invent business numbers.</p></div><div class="aiw-btns"><button type="button" class="aiw-btn primary" data-act="settings-odoo">Open Odoo settings</button></div>';
      else if (S.healthBusy && !h) out += '<div class="aiw-skel"></div><div class="aiw-skel" style="margin-top:8px"></div>';
      else if (h) {
        out += '<div class="aiw-health"><div class="aiw-stat"><small>Status</small><b style="color:var(' + (h.ok ? '--aiw-good' : '--aiw-bad') + ')">' + (h.ok ? 'Live' : 'Not working') + '</b></div><div class="aiw-stat"><small>Response</small><b>' + (h.latencyMs ? fmtMs(h.latencyMs) : '—') + '</b></div>' +
          '<div class="aiw-stat"><small>Odoo version</small><b>' + esc(h.version || '—') + '</b></div><div class="aiw-stat"><small>Company · currency</small><b>' + esc(h.company || '—') + (h.currency ? ' · ' + esc(h.currency) : '') + '</b></div></div>';
        if (!h.ok) out += '<div class="aiw-box bad"><h5>Stopped at: ' + esc(h.stage || 'unknown') + '</h5><p>' + esc(h.error || '') + '</p>' + (h.fix ? '<p style="margin-top:6px;color:var(--ink)"><b>Fix:</b> ' + esc(h.fix) + '</p>' : '') + '</p></div>';
        var order = ['config', 'proxy', 'reach', 'login', 'access'], at = h.ok ? 5 : Math.max(0, order.indexOf(h.stage));
        out += '<ul class="aiw-checks">' + [['Credentials saved in Settings', 0], ['Worker (proxy) answers', 1], ['Odoo server reachable', 2], ['Login with the API key works', 3], ['Apps readable: ' + (h.readable != null ? h.readable + ' of ' + (h.areas || []).length : '—'), 4]].map(function (c) {
          var cls = h.ok ? (c[1] === 4 && h.readable < (h.areas || []).length ? 'warn' : 'ok') : (c[1] < at ? 'ok' : c[1] === at ? 'bad' : '');
          return '<li class="' + cls + '">' + esc(c[0]) + '</li>';
        }).join('') + '</ul>';
        if ((h.areas || []).length) out += '<div class="aiw-areas-list">' + h.areas.map(function (a) {
          var cls = a.status === 'ok' ? 'ok' : a.status === 'no_access' ? 'no' : 'err', txt = a.status === 'ok' ? 'readable · ' + (a.records != null ? Number(a.records).toLocaleString() : '?') + ' records' : a.status === 'no_access' ? 'no access rights' : 'not installed';
          return '<div class="aiw-area"><span>' + esc(a.name) + ' <small style="color:var(--ink-30)">' + esc(a.model || '') + '</small></span><em class="' + cls + '">' + txt + '</em></div>';
        }).join('') + '</div>';
        if (h.limited) out += '<div class="aiw-box"><p>Your Worker is an older version, so the per-app access check is unavailable. Redeploy <code>cloudflare-worker.js</code> to enable it.</p></div>';
        if (h.checkedAt) out += '<p class="aiw-note">Checked ' + relTime(h.checkedAt) + '.</p>';
      }
      if (o.connected) out += '<div class="aiw-btns"><button type="button" class="aiw-btn primary" data-act="recheck"' + (S.healthBusy ? ' disabled' : '') + '>' + (S.healthBusy ? 'Checking…' : 'Re-check now') + '</button><button type="button" class="aiw-btn" data-act="conn-chat">Full report in chat</button><button type="button" class="aiw-btn" data-act="diag">Copy diagnostics</button><button type="button" class="aiw-btn" data-act="settings-odoo">Odoo settings</button></div>';
      out += '</div>';

      var po = S.provider;
      out += '<div class="aiw-sec"><h4>AI provider</h4><div class="aiw-health"><div class="aiw-stat"><small>Provider</small><b>' + esc(p.label) + '</b></div><div class="aiw-stat"><small>Model</small><b>' + esc(p.model || '—') + '</b></div>' +
        '<div class="aiw-stat"><small>Last test</small><b style="color:var(' + (po.outcome === 'ok' ? '--aiw-good' : po.outcome === 'error' ? '--aiw-bad' : '--ink-50') + ')">' + (po.outcome === 'ok' ? 'OK · ' + fmtMs(po.ms) : po.outcome === 'error' ? 'Failed' : p.configured ? 'Not tested' : 'No provider') + '</b></div><div class="aiw-stat"><small>Odoo context</small><b>' + (p.includeCtx ? 'Allowed' : 'Off') + '</b></div></div>' +
        (po.outcome === 'error' ? '<div class="aiw-box bad"><p>' + esc(po.error) + '</p></div>' : '') +
        (!p.configured ? '<div class="aiw-box"><p>No hosted provider is set up, so general chat uses the local rule-based engine and company-data questions cannot be answered. Add Claude, Grok or Groq in AI settings.</p></div>' : '') +
        '<div class="aiw-btns">' + (p.configured ? '<button type="button" class="aiw-btn primary" data-act="test-ai"' + (po.outcome === 'busy' ? ' disabled' : '') + '>' + (po.outcome === 'busy' ? 'Testing…' : 'Test provider') + '</button>' : '') + '<button type="button" class="aiw-btn" data-act="settings-ai">AI settings</button></div></div>';

      out += '<div class="aiw-sec" id="aiwSharing"><h4>What is sent where</h4><div class="aiw-box"><p><b style="color:var(--ink)">Stays in this browser:</b> your chats, attached files and the reports built from them, and every local-engine reply.</p><p style="margin-top:6px"><b style="color:var(--ink)">Sent to your AI provider:</b> your messages, and — only when you ask a company-data question — the rows Odoo returned for it. Attached-file content is sent only when you ask the AI about that file.</p><p style="margin-top:6px"><b style="color:var(--ink)">Never sent anywhere:</b> your Odoo API key (it goes only to your Worker), and the whole-file contents of reports you only view or export.</p></div></div>';
      return out;
    }

    /* — Files tab — */
    function rfState(entry) {
      if (S.rf && S.rf.fileId === entry.file.id) return S.rf;
      var sug = window.DVAIFiles.suggestReconcile(entry.file, entry.report.sheet || 0), t = entry.file.tables[entry.report.sheet || 0];
      S.rf = { fileId: entry.file.id, sheet: entry.report.sheet || 0, column: sug ? sug.column : t.columns[0], targetId: sug ? sug.target.id : 'product', field: sug ? sug.field : 'default_code', cmpCol: '', cmpField: '', busy: false, p: 0, suggested: !!sug };
      return S.rf;
    }
    function opts(list, sel, none) { return (none ? '<option value="">' + esc(none) + '</option>' : '') + list.map(function (x) { var v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }
    function reconFormHtml(entry) {
      var F = window.DVAIFiles, rf = rfState(entry), file = entry.file, t = file.tables[rf.sheet], tg = F.TARGETS.filter(function (x) { return x.id === rf.targetId; })[0] || F.TARGETS[0];
      if (tg.keys.map(function (k) { return k[0]; }).indexOf(rf.field) < 0) rf.field = tg.keys[0][0];
      if (rf.cmpField && tg.compare.map(function (k) { return k[0]; }).indexOf(rf.cmpField) < 0) rf.cmpField = '';
      var o = odooInfo();
      return '<div class="aiw-box"><h5>Reconcile “' + esc(clip(file.name, 30)) + '” with Odoo</h5><p>' + (rf.suggested ? 'I matched the column and record type below from the column names — change them if needed.' : 'Choose the column to look up and what it refers to in Odoo.') + ' Read-only lookups; the file is not uploaded.</p></div>' +
        '<div class="aiw-form">' + (file.tables.length > 1 ? '<label>Sheet<select data-rf="sheet">' + opts(file.tables.map(function (x, i) { return [i, x.name]; }), rf.sheet) + '</select></label>' : '') +
        '<label>File column to look up<select data-rf="column">' + opts(t.columns, rf.column) + '</select></label>' +
        '<label>It refers to (Odoo)<select data-rf="targetId">' + opts(F.TARGETS.map(function (x) { return [x.id, x.label]; }), rf.targetId) + '</select></label>' +
        '<label>Match on Odoo field<select data-rf="field">' + opts(tg.keys, rf.field) + '</select></label>' +
        (tg.compare.length ? '<label>Also compare values (optional)<select data-rf="cmpCol">' + opts(t.columns, rf.cmpCol, 'Do not compare values') + '</select></label>' + (rf.cmpCol ? '<label>…with Odoo field<select data-rf="cmpField">' + opts(tg.compare, rf.cmpField || tg.compare[0][0]) + '</select></label>' : '') : '') + '</div>' +
        (rf.busy ? '<div class="aiw-progress"><i style="--p:' + rf.p + '%"></i></div><p class="aiw-note">Looking up in Odoo… ' + Math.round(rf.p) + '%</p>' : '<div class="aiw-btns"><button type="button" class="aiw-btn primary" data-act="run-recon"' + (o.connected ? '' : ' disabled') + '>Run reconciliation</button><button type="button" class="aiw-btn" data-act="recon-cancel">Cancel</button></div>' + (o.connected ? '' : '<p class="aiw-note">Odoo is not connected — connect it in Settings first.</p>'));
    }
    function filesHtml() {
      var ids = Object.keys(S.files), out = '';
      if (S.rf && S.rf.open && S.files[S.rf.fileId]) out += '<div class="aiw-sec"><h4>Reconcile with Odoo</h4>' + reconFormHtml(S.files[S.rf.fileId]) + '</div>';
      out += '<div class="aiw-sec"><h4>Files in this session (' + ids.length + ')</h4>';
      if (!ids.length) out += '<div class="aiw-dropzone" data-act="file-pick">Drop a CSV, Excel, JSON or TXT file here<br/><small>or click to choose · read in your browser · up to 15 MB</small></div>';
      else {
        out += ids.map(function (id) {
          var e = S.files[id], r = e.report;
          return '<div class="aiw-file-card"><div class="aiw-file-card-top"><span class="aiw-file-ic">' + esc((e.file.ext || 'file').slice(0, 4).toUpperCase()) + '</span><div><b title="' + esc(e.file.name) + '">' + esc(e.file.name) + '</b><small>' + fmtSize(e.file.size) + ' · ' + r.file.rows.toLocaleString() + ' rows × ' + r.file.columns + ' cols' + (e.file.tables.length > 1 ? ' · ' + e.file.tables.length + ' sheets' : '') + '</small></div></div>' +
            '<div class="aiw-btns"><button type="button" class="aiw-btn primary" data-act="file-recon" data-id="' + esc(id) + '">Reconcile with Odoo</button><button type="button" class="aiw-btn" data-act="file-ask" data-id="' + esc(id) + '">Ask AI</button><button type="button" class="aiw-btn" data-act="file-report" data-id="' + esc(id) + '">Report again</button><button type="button" class="aiw-btn" data-act="file-remove" data-id="' + esc(id) + '">Remove</button></div></div>';
        }).join('') + '<div class="aiw-dropzone" data-act="file-pick">Add another file</div>';
      }
      out += '</div><div class="aiw-box"><p>Reports are computed from the rows in your file. Reconciliation reads Odoo with read-only lookups and lists what is missing, duplicated or different — nothing is changed in Odoo.</p></div>';
      return out;
    }

    /* ══════════ attachments ══════════ */
    function renderTray() {
      if (!S.pending.length) { el.tray.hidden = true; el.tray.innerHTML = ''; return; }
      el.tray.hidden = false;
      el.tray.innerHTML = S.pending.map(function (p, i) {
        return '<span class="aiw-file-chip" data-st="' + p.st + '"><span class="aiw-file-ic">' + esc((p.name.split('.').pop() || 'F').slice(0, 4).toUpperCase()) + '</span><b>' + esc(p.name) + '</b><small>' + (p.st === 'bad' ? esc(p.error || 'cannot read') : fmtSize(p.size)) + '</small><button type="button" data-act="pending-remove" data-i="' + i + '" aria-label="Remove ' + esc(p.name) + '">✕</button></span>';
      }).join('');
    }
    function addFiles(list) {
      var F = window.DVAIFiles;
      if (!F) { toast('File analysis is not available on this page.'); return; }
      Array.prototype.slice.call(list || []).slice(0, 5).forEach(function (f) {
        if (S.pending.some(function (p) { return p.name === f.name && p.size === f.size; })) return;
        var entry = { name: f.name, size: f.size, st: 'busy' };
        S.pending.push(entry); renderTray(); updateSend();
        F.parse(f).then(function (fo) { entry.file = fo; entry.st = 'ok'; }, function (e) { entry.st = 'bad'; entry.error = e.message; toast(e.message); })
          .then(function () { renderTray(); updateSend(); if (entry.st === 'ok' && !el.input.value.trim() && S.autoSend !== false) { /* wait for the user: they can add a question or just press Send */ } });
      });
      el.input.focus();
    }
    function postReport(fileObj) {
      var F = window.DVAIFiles;
      try {
        var report = F.analyze(fileObj);
        S.files[fileObj.id] = { file: fileObj, report: report };
        var content = report.title + '\n' + report.kpis.map(function (k) { return k.label + ': ' + k.value; }).join('; ') + '\n' + report.insights.join(' ') + '\nFindings: ' + report.quality.map(function (q) { return q.title; }).join('; ');
        pushMsg('ai', content, { report: report, engine: 'local', followups: [
          { label: 'Reconcile with Odoo', act: 'file-recon', id: fileObj.id },
          { label: 'Summarize the key findings', text: 'Summarize the key findings in "' + fileObj.name + '" and what I should check first.' },
          { label: 'What should I fix first?', text: 'Which data problems in "' + fileObj.name + '" should I fix first, and why?' }
        ] });
      } catch (e) {
        pushMsg('ai', 'I could not analyse “' + fileObj.name + '”: ' + (e && e.message ? e.message : 'unknown error') + '. Try saving it as CSV and attaching that.', { tag: 'File error', retry: false });
      }
    }
    function fileContextFor(t) {
      var ids = [];
      (t ? t.messages : []).forEach(function (m) { (m.files || []).forEach(function (f) { if (ids.indexOf(f.id) < 0) ids.push(f.id); }); });
      return ids.slice(-2).filter(function (id) { return S.files[id]; }).map(function (id) { return window.DVAIFiles.contextFor(S.files[id].file, S.files[id].report); }).join('\n\n---\n\n');
    }

    /* ══════════ sending ══════════ */
    var BUSINESS_RE = /\b(odoo|sales?|revenue|invoices?|orders?|customers?|clients?|vendors?|suppliers?|purchases?|stock|inventory|leads?|pipeline|employees?|expenses?|tasks?|receivables?|payables?|profit|bikri|udhaar|khareed|maal|quotations?|deliver(?:y|ies)|headcount|payments?|bills?|salesperson|aging|overdue)\b/i;
    var STATUS_RE = /^\s*(odoo\s+)?(status|connection|connectivity|health(check)?|diagnos\w*)\s*[?.!]*\s*$/i;
    function isBusinessQ(text) { return BUSINESS_RE.test(text) || (/\b(dashboards?|board report)\b/i.test(text) && /\b(focused|board-ready|executive|company|business|data|metric|analytics|odoo|sales?|revenue)\b/i.test(text)); }
    function historyFor(t, upto) {
      var src = t.messages.slice(0, upto == null ? t.messages.length : upto), A = window.DVArtifacts, texts = A ? A.historyTexts(src) : null, extra = 0;
      var msgs = src.map(function (m, i) {
        var c = String(texts ? texts[i] : (m.content || ''));
        if (texts) extra += Math.max(0, c.length - String(m.content || '').length);
        return { role: m.role === 'ai' ? 'assistant' : 'user', content: c };
      }).filter(function (m) { return m.content; });
      var selected = [], remaining = 24000 + Math.min(40000, extra);     // an artifact being revised travels in full, so it gets its own room
      for (var i = msgs.length - 1; i >= 0 && selected.length < 24 && remaining > 0; i--) {
        var c = msgs[i].content; if (c.length > remaining) c = c.slice(0, Math.max(0, remaining - 1)) + '…';
        selected.push({ role: msgs[i].role, content: c }); remaining -= Math.min(c.length, remaining);
      }
      return selected.reverse();
    }
    function localFileAnswer(text, ctxIds) {
      var id = ctxIds[ctxIds.length - 1], e = S.files[id], r = e.report, q = text.toLowerCase(), lines = [];
      if (/duplic/.test(q)) lines = r.quality.filter(function (x) { return /duplic|repeated/i.test(x.title); }).map(function (x) { return '- **' + x.title + '** — ' + x.detail; });
      else if (/missing|empty|blank|null/.test(q)) lines = r.quality.filter(function (x) { return /empty|missing/i.test(x.title); }).map(function (x) { return '- **' + x.title + '** — ' + x.detail; });
      else if (/total|sum|how much|average|avg/.test(q)) lines = r.kpis.map(function (k) { return '- **' + k.label + ':** ' + k.value + (k.hint ? ' (' + k.hint + ')' : ''); });
      else if (/top|best|largest|biggest|highest/.test(q)) lines = r.metrics.slice(0, 1).map(function (m) { return '**' + m.title + '**\n' + m.rows.slice(0, 5).map(function (x) { return '- ' + x.label + ': ' + fmtVal(x.value); }).join('\n'); });
      if (!lines.length) lines = r.insights.map(function (x) { return '- ' + x; });
      return '**From the report on ' + e.file.name + ' (computed locally):**\n\n' + (lines.join('\n') || 'No matching finding.') + '\n\n*Free-form questions about a file need an AI provider — add one in Settings → AI Assistant. Everything above is exact and comes straight from your rows.*';
    }

    function finishAnswer(content, extra) {
      thinkingStop(); S.busy = false;
      var A = window.DVArtifacts, made = null;
      if (A && extra && (extra.engine === 'provider' || extra.engine === 'odoo') && /<artifact\b|```/.test(String(content || ''))) {
        var th = activeThread(), nq = extra.trace && extra.trace.queries ? extra.trace.queries.filter(function (q) { return q.op !== 'fields'; }).length : 0;
        made = A.ingest(th ? th.id : '', String(content || ''), { by: 'ai', chat: th && th.title || '', source: extra.liveOdoo ? 'Live Odoo' + (nq ? ' · ' + nq + ' queries' : '') : (extra.providerLabel || '') });
        if (made.refs.length) { content = made.text; extra = Object.assign({}, extra, { artifacts: made.refs }); }
      }
      var m = pushMsg('ai', content, Object.assign({ retry: true }, extra || {}));
      renderMessages(); updateSend();
      if (made && made.refs.length && A.autoOpen()) { var lastRef = made.refs[made.refs.length - 1]; A.openArt(lastRef.aid, lastRef.n); }
      if (isInspOpen() && S.tab === 'path' && (m.trace || m.report)) { S.selMsg = m.id; renderInsp(); markSelected(); }
      return m;
    }
    function fail(e, who) {
      var msg = String(e && e.message || e || 'unknown error');
      if (who === 'provider') { S.provider.outcome = 'error'; S.provider.error = msg; }
      updateChips();
      finishAnswer('I could not get an answer (' + msg + '). ' + (who === 'provider' ? 'Check your key, model and plan in Settings → AI Assistant.' : 'Type **status** to see exactly where the Odoo connection breaks.'), { tag: 'Error' });
    }

    function answer(text) {
      var t = activeThread(), p = providerInfo(), o = odooInfo();
      S.busy = true; updateSend(); thinkingStart();
      var fileCtx = fileContextFor(t), hasFiles = !!fileCtx, fileIds = [];
      t.messages.forEach(function (m) { (m.files || []).forEach(function (f) { if (S.files[f.id] && fileIds.indexOf(f.id) < 0) fileIds.push(f.id); }); });
      var hist = historyFor(t);

      if (STATUS_RE.test(text) || /\b(odoo|connection|connectivity)\b.*\b(kaisa|kaisi|check|status|working|connected|theek|sahi)\b/i.test(text)) {
        thinkingStep('Checking the Odoo connection', 'connect');
        return loadOdooAgent().then(function (a) { return a.askDetailed(text, hist, { onStep: function (k, l) { thinkingStep(l, k); } }); })
          .then(function (r) { checkHealth(true); finishAnswer(r.content, { tag: 'Odoo status', trace: r.trace, engine: 'odoo' }); }).catch(function (e) { fail(e); });
      }
      if (fileIds.length && /reconcil|\bmatch\b|compare with|verify|exist(s)? in odoo|missing in odoo|vs\.? odoo|against odoo|cross.?check|odoo (mein|me) (hai|hain)/i.test(text)) {
        var id = fileIds[fileIds.length - 1]; S.rf = null; S.rf = { fileId: id, open: true }; rfState(S.files[id]); S.rf.open = true;
        thinkingStop(); S.busy = false;
        pushMsg('ai', 'Let’s reconcile **' + S.files[id].file.name + '** with Odoo. I opened the Files panel with the column and record type I think match — check them and press **Run reconciliation**.', { tag: 'File ⇄ Odoo', engine: 'local' });
        renderMessages(); updateSend(); openInsp('files'); return;
      }
      if (isBusinessQ(text) && !(hasFiles && !o.connected && !/odoo/i.test(text))) {
        if (!o.connected || !p.hosted || !p.includeCtx) {
          var why = !o.connected ? 'Odoo is not connected in this workspace.' : !p.configured ? 'No hosted AI provider is configured for the live Odoo query path.' : !p.hosted ? 'The selected provider cannot run the guarded read-only Odoo query workflow.' : 'Odoo company context is turned off in AI settings.';
          return finishAnswer('**Live company data is unavailable.** ' + why + ' I will not invent business metrics. Open the connection details to fix it, then ask again.', { tag: 'Live Odoo unavailable', setup: true, retry: false, engine: 'local' });
        }
        thinkingStep('Checking the Odoo connection', 'connect');
        return loadOdooAgent().then(function (a) { return a.askDetailed(text, hist, { systemPrompt: p.systemPrompt, fileContext: fileCtx, onStep: function (k, l) { thinkingStep(l, k); } }); })
          .then(function (r) {
            S.provider.outcome = r.liveOdoo || (r.trace && r.trace.kind !== 'fallback') ? 'ok' : S.provider.outcome; updateChips();
            if (r.trace && r.trace.status) { S.health = Object.assign({}, S.health || {}, { ok: true, latencyMs: r.trace.status.latencyMs, version: r.trace.status.version, company: r.trace.status.company, currency: r.trace.status.currency, areas: (S.health && S.health.areas) || [], readable: S.health ? S.health.readable : 0, checkedAt: Date.now() }); updateChips(); }
            var tag = r.dashboard ? 'Odoo dashboard' : (/\*\*Live company data is unavailable\./.test(r.content) ? 'Live Odoo unavailable' : /Odoo connection: ❌/.test(r.content) ? 'Odoo status' : 'Live Odoo');
            finishAnswer(r.content, { tag: tag, dashboard: r.dashboard || null, liveOdoo: !!r.liveOdoo, followups: r.followups || [], trace: r.trace || null, engine: 'odoo', skill: r.skill || null, visuals: r.visuals || null });
          }).catch(function (e) { fail(e, /provider|api key|rate limit|model/i.test(String(e && e.message)) ? 'provider' : null); });
      }
      if (p.configured) {
        thinkingStep('Asking ' + p.label, 'answer');
        var sys = [p.systemPrompt, hasFiles ? 'ATTACHED FILE DATA (user-supplied, unverified; answer only from it and say so):\n' + fileCtx : '', !o.connected ? 'Odoo is NOT connected in this workspace. If the user asks for company data, say plainly that it is not connected and to open Settings → Odoo.' : '', window.DVArtifacts ? window.DVArtifacts.promptRules() : ''].filter(Boolean).join('\n\n');
        var t0 = Date.now();
        return window.DVAIConfig.callAI(hist, sys).then(function (reply) {
          S.provider = { outcome: 'ok', ms: Date.now() - t0, at: Date.now(), error: '' }; updateChips();
          finishAnswer(String(reply || ''), { engine: 'provider', providerLabel: p.label, followups: hasFiles ? [{ label: 'Reconcile with Odoo', act: 'file-recon', id: fileIds[fileIds.length - 1] }] : [] });
        }).catch(function (e) { fail(e, 'provider'); });
      }
      if (hasFiles) { thinkingStep('Reading the file report', 'file'); return setTimeout(function () { finishAnswer(localFileAnswer(text, fileIds), { engine: 'local', tag: 'File report' }); }, 200); }
      setTimeout(function () {
        var res;
        try { res = window.DashViewAI.respond(text, { seed: t.id }); } catch (e) { res = { content: 'Something went wrong reading that — try rephrasing?', tag: null }; }
        finishAnswer(res.content, { tag: res.tag || null, engine: 'local' });
      }, 260 + Math.min(500, text.length * 3));
    }

    function autosize() { el.input.style.height = 'auto'; el.input.style.height = Math.min(180, el.input.scrollHeight) + 'px'; }
    function updateSend() {
      var ready = S.pending.some(function (p) { return p.st === 'ok'; }), busyFile = S.pending.some(function (p) { return p.st === 'busy'; });
      el.send.disabled = S.busy || busyFile || !(el.input.value.trim() || ready);
    }
    function send(text, opt) {
      text = String(text == null ? el.input.value : text).trim();
      var ready = S.pending.filter(function (p) { return p.st === 'ok'; });
      if (S.busy || (!text && !ready.length)) return;
      if (S.pending.some(function (p) { return p.st === 'busy'; })) { toast('Still reading your file…'); return; }
      if (!window.DashViewAI && !ready.length) { toast('The assistant engine did not load. Reload the page.'); return; }
      var uf = ready.map(function (p) { return { id: p.file.id, name: p.file.name, size: p.file.size }; });
      if (popOpen()) closePopup();
      pushMsg('user', text, Object.assign({}, uf.length ? { files: uf } : null, opt && opt.artRef ? { artRef: opt.artRef } : null));
      el.input.value = ''; autosize(); S.pending = []; renderTray();
      ready.forEach(function (p) { postReport(p.file); });
      renderMessages(); updateSend();
      if (S.afterAttach === 'recon' && ready.length) { S.afterAttach = null; var f0 = ready[ready.length - 1].file.id; S.rf = null; rfState(S.files[f0]); S.rf.open = true; openInsp('files'); }
      if (text) answer(text);
    }

    function newChat() {
      if (popOpen()) closePopup();
      var t = activeThread();
      if (!(t && !t.messages.length)) newDraft();
      S.selMsg = null; S.stack = []; closeInsp(); renderAll(); el.input.focus();
      if (window.innerWidth <= 900) { root.dataset.rail = 'closed'; syncScrim(); }
    }
    function exportChat() {
      var t = activeThread();
      if (!t || !t.messages.length) { toast('Nothing to export yet.'); return; }
      var md = '# ' + (t.title || 'DashView AI chat') + '\n\n_Exported ' + new Date().toLocaleString() + '_\n\n' + t.messages.map(function (m) {
        var src = m.trace && m.trace.queries ? '\n\n> Sources: ' + m.trace.queries.filter(function (q) { return q.op !== 'fields'; }).map(function (q) { return q.model + ' ' + q.op; }).join(', ') : '';
        return '**' + (m.role === 'user' ? 'You' : 'DashView AI') + '** · ' + new Date(m.time || Date.now()).toLocaleString() + '\n\n' + (window.DVArtifacts ? window.DVArtifacts.expandForExport(m.content || '') : (m.content || '')) + src;
      }).join('\n\n---\n\n');
      download('dashview-ai-chat.md', md, 'text/markdown;charset=utf-8'); toast('Chat exported.');
    }
    function goSettings(tab) {
      if (window.dashviewShowView) window.dashviewShowView('settings');
      setTimeout(function () { var b = document.querySelector('.stg-tab[data-stg="' + tab + '"]'); if (b) b.click(); }, 80);
    }
    function printDashboard() {
      document.body.classList.add('ai-dashboard-printing');
      var timer, cleanup = function () { document.body.classList.remove('ai-dashboard-printing'); if (timer) clearTimeout(timer); };
      window.addEventListener('afterprint', cleanup, { once: true }); timer = setTimeout(cleanup, 30000); window.print();
    }
    function testProvider() {
      var p = providerInfo(); if (!p.configured) return;
      S.provider.outcome = 'busy'; renderInsp(); var t0 = Date.now();
      window.DVAIConfig.callAI([{ role: 'user', content: 'Reply with the single word OK.' }], 'You are a connectivity probe. Reply with exactly: OK').then(function () {
        S.provider = { outcome: 'ok', ms: Date.now() - t0, at: Date.now(), error: '' };
      }).catch(function (e) { S.provider = { outcome: 'error', ms: null, at: Date.now(), error: String(e && e.message || e) }; })
        .then(function () { updateChips(); renderInsp(); });
    }
    function diagnostics() {
      var h = S.health || {}, p = providerInfo(), o = odooInfo();
      return JSON.stringify({ at: new Date().toISOString(), page: location.origin, odoo: { connected: o.connected, url: o.url, db: o.db, ok: h.ok, stage: h.stage, error: h.error, version: h.version, latencyMs: h.latencyMs, company: h.company, currency: h.currency, areas: (h.areas || []).map(function (a) { return a.name + ':' + a.status + (a.records != null ? '(' + a.records + ')' : ''); }) }, provider: { provider: p.provider, model: p.model, configured: p.configured, lastTest: S.provider.outcome, ms: S.provider.ms, error: S.provider.error } }, null, 2);
    }
    function csvOf(cols, rows) {
      var cell = function (v) { var s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      return '\ufeff' + [cols].concat(rows).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    }
    function runRecon() {
      var rf = S.rf, entry = rf && S.files[rf.fileId]; if (!entry || rf.busy) return;
      rf.busy = true; rf.p = 3; renderInsp();
      var cmp = rf.cmpCol ? { compareFileColumn: rf.cmpCol, compareField: rf.cmpField || (window.DVAIFiles.TARGETS.filter(function (x) { return x.id === rf.targetId; })[0].compare[0] || [''])[0] } : {};
      window.DVAIFiles.reconcile(entry.file, Object.assign({ sheet: rf.sheet, column: rf.column, targetId: rf.targetId, field: rf.field, onProgress: function (d, n) { rf.p = Math.max(3, d / n * 100); renderInsp(); } }, cmp)).then(function (report) {
        S.files[entry.file.id].lastRecon = report; rf.busy = false; rf.open = false;
        var m = pushMsg('ai', report.title + '\n' + report.kpis.map(function (k) { return k.label + ': ' + k.value; }).join('; ') + '\n' + report.insights.join(' '), { report: report, engine: 'odoo', followups: [{ label: 'Explain the differences', text: 'Explain the reconciliation result for "' + entry.file.name + '" and what to do next.' }] });
        S.selMsg = m.id; renderMessages(); openInsp('path'); toast('Reconciliation finished.');
      }).catch(function (e) { rf.busy = false; renderInsp(); toast(e.message || 'Reconciliation failed.'); });
    }

    /* ══════════ events ══════════ */
    var ACT = {
      'route-home': function () { closePopup(); closeInsp(); el.messages.scrollTop = 0; },
      'route-chat': function () { closePopup(); closeInsp(); },
      'route-path': function () { closePopup(); openInsp(S.tab === 'path' ? 'path' : S.tab); },
      'route-stack': function (t) { popTo(+t.getAttribute('data-i')); },
      'new': function () { newChat(); }, 'export': function () { exportChat(); },
      'thread': function (t) { var id = t.getAttribute('data-id'); if (popOpen()) closePopup(); S.activeId = id; S.draft = null; S.selMsg = null; closeInsp(); persist(); renderAll(); writeRoute(); if (window.innerWidth <= 900) { root.dataset.rail = 'closed'; syncScrim(); } },
      'thread-rename': function (t) { var th = S.threads.filter(function (x) { return x.id === t.getAttribute('data-id'); })[0]; if (!th) return; var n = window.prompt('Rename chat', th.title || ''); if (n != null && n.trim()) { th.title = clip(n.trim(), 60); persist(); renderThreads(); renderRoute(); } },
      'thread-del': function (t) { var id = t.getAttribute('data-id'), th = S.threads.filter(function (x) { return x.id === id; })[0]; if (!th || !window.confirm('Delete “' + (th.title || 'this chat') + '”? This cannot be undone.')) return; S.threads = S.threads.filter(function (x) { return x.id !== id; }); if (S.activeId === id) { S.activeId = S.threads[0] ? S.threads[0].id : null; if (!S.activeId) newDraft(); } persist(); renderAll(); writeRoute(); },
      'cap-ask': function () { el.input.focus(); toast('Type a question or pick one of the prompts below.'); },
      'cap-board': function () { send('Build a board-ready sales dashboard for this quarter'); },
      'cap-file': function () { el.file.click(); },
      'cap-recon': function () { if (Object.keys(S.files).length) openInsp('files'); else { S.afterAttach = 'recon'; toast('Choose the file to reconcile with Odoo.'); el.file.click(); } },
      'cap-status': function () { send('status'); },
      'cap-help': function () { send('How does the auto-suggest engine in Data Studio decide which charts and KPIs to recommend?'); },
      'area': function (t) { areaOpen = t.getAttribute('data-a'); var n = $('aiwPrompts'); if (n) { n.style.setProperty('--c', CAT[areaOpen].c); n.innerHTML = promptsHtml(); } Array.prototype.forEach.call(root.querySelectorAll('.aiw-areas-tabs button'), function (b) { var on = b.getAttribute('data-a') === areaOpen; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); }); },
      'cat': function (t) { S.cat = t.getAttribute('data-k'); renderThreads(); },
      'prompt': function (t) { send(t.getAttribute('data-q')); },
      'art-open': function (t) { if (window.DVArtifacts) window.DVArtifacts.openArt(t.getAttribute('data-aid'), +t.getAttribute('data-n')); },
      'art-copy': function (t) { if (window.DVArtifacts) window.DVArtifacts.copyArt(t.getAttribute('data-aid'), +t.getAttribute('data-n')); },
      'art-dl': function (t) { if (window.DVArtifacts) window.DVArtifacts.downloadArt(t.getAttribute('data-aid'), +t.getAttribute('data-n')); },
      'art-save': function (t) {
        var f = findMsg(t.getAttribute('data-mid')), A = window.DVArtifacts; if (!f || !A) return;
        if (f.m.savedArt && A.get(f.m.savedArt.aid)) { A.openArt(f.m.savedArt.aid); return; }
        var T = window.DVAITemplate, parts = T && T.extract ? T.extract(f.m.content) : null, body = String(parts ? parts.body : f.m.content || '').trim();
        if (!body) return toast('Nothing to save.');
        var head = /^#{1,3}\s+(.{3,90})$/m.exec(body), title = (head ? head[1] : (f.t.title ? clip(f.t.title, 70) : 'Assistant answer')).replace(/[*_`]/g, '');
        var r = A.create({ tid: f.t.id, type: 'document', title: title, content: body }, { by: 'ai', chat: f.t.title, source: f.m.liveOdoo ? 'Live Odoo' : '' });
        f.m.savedArt = { aid: r.aid }; persist(); renderMessages(); A.openArt(r.aid, r.n);
      },
      'vis-art': function (t) {
        var A = window.DVArtifacts, mid = t.getAttribute('data-mid'), mi = +t.getAttribute('data-mi'), pl = visPayloads[mid], f = findMsg(mid); if (!A || !pl || !f) return;
        var me = pl.metrics[mi], rows = me.rows.filter(function (r) { return isFinite(Number(r.value)); }).slice(0, 40); if (!rows.length) return toast('No numeric rows to chart.');
        var spec = { type: me.chartType === 'line' || me.chartType === 'area' ? me.chartType : 'bar', title: me.title || me.model || 'Metric', unit: '', labels: rows.map(function (r) { return String(r.label); }), series: [{ name: me.measure || 'Value', values: rows.map(function (r) { return Number(r.value); }) }] };
        var r2 = A.upsert(f.t.id, { id: 'chart-' + String(mid).slice(-6) + '-' + mi, type: 'chart', title: spec.title, content: JSON.stringify(spec, null, 2) }, { by: 'ai', chat: f.t.title, source: 'Live Odoo' });
        A.openArt(r2.aid, r2.n);
      },
      'copy': function (t) { var f = findMsg(t.getAttribute('data-mid')); if (f) copyText(window.DVArtifacts ? window.DVArtifacts.plain(f.m.content || '') : (f.m.content || '')); },
      'rexport': function (t) {
        var f = findMsg(t.getAttribute('data-mid')); if (!f) return;
        var T = window.DVAITemplate, E = window.DVReportEngine;
        if (!T || !E || typeof E.generateAIDashboardPdf !== 'function') return toast('PDF export is not available on this page.');
        var payload;
        try {
          payload = T.toReportPayload(f.m.content, { title: reportTitle(precedingQuestion(f.i, f.t), f.m), time: f.m.time });
          if (f.m.visuals) {   // the board's exact rows + calculated insights go into the PDF too
            var vm = visMetrics(f.m.visuals), found = T.findingsText({ metrics: vm });
            payload.metrics = vm.concat(payload.metrics).slice(0, 6);
            if (found) payload.insightsText = (payload.insightsText ? payload.insightsText + '\n\n' : '') + 'Calculated findings\n' + found;
            var aiTxt = vm.map(function (x, mi) { return visAiText(f.m.id, mi); }).filter(Boolean).join('\n\n'); if (aiTxt) payload.insightsText = (payload.insightsText ? payload.insightsText + '\n\n' : '') + 'AI insights\n' + aiTxt;
            if (f.m.visuals.source) payload.source = f.m.visuals.source; if (f.m.visuals.currency) payload.currency = f.m.visuals.currency;
          }
        } catch (e) { return toast('This answer could not be turned into a report.'); }
        toast('Building the PDF report…');
        E.generateAIDashboardPdf(payload).then(function () { toast('Report PDF exported.'); }).catch(function () { toast('The PDF library could not load (offline?). Copy the answer instead.'); });
      },
      'jump': function (t) {
        var card = t.closest('.aiw-card'), hs = card ? card.querySelectorAll('h2.aiw-h') : [], h = hs[+t.getAttribute('data-i')];
        if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      'path': function (t) { selectMsg(t.getAttribute('data-mid'), 'path'); },
      'why': function (t) { var mid = t.getAttribute('data-mid'), f = findMsg(mid); if (f && f.m.trace && f.m.trace.queries[0]) S.openQ[mid + ':' + f.m.trace.queries[0].id] = true; selectMsg(mid, 'path'); },
      'retry': function (t) {
        if (S.busy) return; var f = findMsg(t.getAttribute('data-mid')); if (!f) return;
        var q = precedingQuestion(f.i, f.t); if (!q) return;
        f.t.messages.splice(f.i, f.t.messages.length - f.i); persist(); S.selMsg = null; renderMessages(); answer(q);
      },
      'fup': function (t) {
        var f = findMsg(t.getAttribute('data-mid')), it = f && f.m.followups && f.m.followups[+t.getAttribute('data-i')]; if (!it) return;
        if (typeof it === 'string') return send(it);
        if (it.act === 'file-recon') return ACT['file-recon']({ getAttribute: function () { return it.id; } });
        if (it.text) send(it.text);
      },
      'src': function (t) { var mid = t.getAttribute('data-mid'); S.openQ[mid + ':' + t.getAttribute('data-q')] = true; selectMsg(mid, 'path'); },
      'q-toggle': function (t) { var k = t.getAttribute('data-key'); S.openQ[k] = !S.openQ[k]; renderInsp(); },
      'q-group': function (t) { var fr = frameFromEl(t); if (fr) openPopup(fr); },
      'q-records': function (t) { var fr = frameFromEl(t); if (fr) openPopup(fr); },
      'dash-drill': function (t) { var fr = frameFromEl(t); if (fr) openPopup(fr); },
      'vis-drill': function (t) { var fr = frameFromEl(t); if (fr) openPopup(fr); },
      'vis-sort': function (t) {
        var mid = t.getAttribute('data-mid'), mi = +t.getAttribute('data-mi'), st = vst(mid, mi), k = t.getAttribute('data-k'), card = t.closest('.aiw-vis-card'); if (!card) return;
        if (st.k === k) st.dir = -st.dir || -1; else { st.k = k; st.dir = k === 'label' ? 1 : (k === 'rank' || k === 'i' ? 1 : -1); }
        card.querySelector('.aiw-vis-chart').innerHTML = visTableHtml(mid, mi);
      },
      'vis-more': function (t) { var mid = t.getAttribute('data-mid'), mi = +t.getAttribute('data-mi'), st = vst(mid, mi); st.more = !st.more; visRepaint(mid, mi); },
      'vis-ai': function (t) { visAiRun(t.getAttribute('data-mid'), +t.getAttribute('data-mi')); },
      'vis-ai-all': function (t) {
        var mid = t.getAttribute('data-mid'), pl = visPayloads[mid]; if (!pl) return;
        pl.metrics.reduce(function (p, x, mi) { return p.then(function () { return visAiRun(mid, mi); }); }, Promise.resolve());
      },
      'vis-ai-x': function (t) { var mid = t.getAttribute('data-mid'), mi = +t.getAttribute('data-mi'), f = findMsg(mid); if (f && f.m.aiIns) { delete f.m.aiIns[mi]; persist(); } delete visAiErr[mid + ':' + mi]; visRepaint(mid, mi); },
      'vis-ai-copy': function (t) { var txt = visAiText(t.getAttribute('data-mid'), +t.getAttribute('data-mi')); if (txt) copyText(txt); },
      'vis-copy': function (t) { var txt = visSummaryText(t.getAttribute('data-mid'), +t.getAttribute('data-mi')); if (txt) copyText(txt); },
      'vis-q': function (t) { if (S.busy) return; var q = t.getAttribute('data-q'); if (q) send(q); },
      'pop-by': function (t) {
        var f = S.stack[S.stack.length - 1]; if (!f || !f.model) return;
        var by = t.getAttribute('data-by'), bl = t.getAttribute('data-bl') || by;
        openPopup({ kind: 'groups', model: f.model, domain: f.domain || [], by: by, measure: f.measure || '', useMeasure: !!f.measure, title: (f.label && f.kind === 'records' ? f.label + ' · ' : '') + 'by ' + bl, label: 'By ' + bl });
      },
      'pop-gm': function (t) { var f = S.stack[S.stack.length - 1]; if (!f || f.kind !== 'groups') return; f.useMeasure = t.getAttribute('data-m') === 'measure'; paintPop(); },
      'pop-grow': function (t) {
        var f = S.stack[S.stack.length - 1], g = f && f.groups && f.groups[+t.getAttribute('data-gi')]; if (!g || !g.domain) return;
        openPopup({ kind: 'records', model: f.model, domain: g.domain, title: f.title + ' › ' + g.label, label: g.label, offset: 0, measure: f.measure || '' });
      },
      'vis-type': function (t) {
        var mid = t.getAttribute('data-mid'), mi = +t.getAttribute('data-mi'), card = t.closest('.aiw-vis-card'); if (!card) return;
        visTypes[mid + ':' + mi] = t.getAttribute('data-t');
        card.querySelector('.aiw-vis-chart').innerHTML = visChartHtml(mid, mi, t.getAttribute('data-t'));
        Array.prototype.forEach.call(card.querySelectorAll('.aiw-seg button'), function (b) { b.setAttribute('aria-pressed', String(b === t)); });
      },
      'vis-csv': function (t) {
        var pl = visPayloads[t.getAttribute('data-mid')], me = pl && pl.metrics[+t.getAttribute('data-mi')]; if (!me) return;
        download(String(me.title || 'chart').replace(/[^\w.-]+/g, '-').slice(0, 60) + '.csv', visRowsCsv(pl, me), 'text/csv;charset=utf-8'); toast('CSV downloaded.');
      },
      'vis-ask': function (t) {
        var pl = visPayloads[t.getAttribute('data-mid')], me = pl && pl.metrics[+t.getAttribute('data-mi')], T = window.DVAITemplate; if (!me || !T || S.busy) return;
        var an = T.analyzeMetric(me), top = me.rows.reduce(function (b, r) { return Number(r.value) > Number(b.value) ? r : b; }, me.rows[0]);
        send(an && an.series ? 'Explain what drove the change in "' + me.title + '" over the last periods, with the records behind the biggest movers.' : 'Why is "' + top.label + '" the largest in "' + me.title + '"? Break it down further and tell me what to do about it.');
      },
      'chart-ask': function (t) {
        if (S.busy) return; var l = t.getAttribute('data-label'), ti = t.getAttribute('data-title');
        send('Break down "' + l + '"' + (ti ? ' from "' + ti + '"' : '') + ': show the details and the records behind it.');
      },
      'q-rec': function (t) { openPopup({ kind: 'record', model: t.getAttribute('data-model'), id: +t.getAttribute('data-id'), title: t.getAttribute('data-model') + ' #' + t.getAttribute('data-id'), label: '#' + t.getAttribute('data-id') }); },
      'q-explorer': function (t) {
        var f = findMsg(t.getAttribute('data-mid')), q = f && f.m.trace.queries.filter(function (x) { return x.id === t.getAttribute('data-q'); })[0]; if (!q || !window.DVDrill) return;
        var meas = (q.measure || '').split(':')[0];
        window.DVDrill.open({ title: q.model + ' · from AI answer', model: q.model, domain: q.domain || [], measure: meas && meas !== '__count' ? meas : null, date: null, kind: /amount|total|price|revenue|balance|residual|cost|expected/.test(meas) ? 'money' : 'count' }, t);
      },
      'q-copy': function (t) { var f = findMsg(t.getAttribute('data-mid')), q = f && f.m.trace.queries.filter(function (x) { return x.id === t.getAttribute('data-q'); })[0]; if (q) copyText(JSON.stringify({ op: q.op, model: q.model, domain: q.domain, groupby: q.groupby, fields: q.fields, order: q.order, limit: q.limit }, null, 2)); },
      'path-json': function (t) { var f = findMsg(t.getAttribute('data-mid')); if (f) copyText(JSON.stringify(f.m.trace || f.m.report || {}, function (k, v) { return k === 'tables' ? undefined : v; }, 2)); },
      'rdrill': function (t) { var fr = reportFrame(t.getAttribute('data-mid'), 'metric', +t.getAttribute('data-mi'), +t.getAttribute('data-ri')); if (fr) openPopup(fr); },
      'rtable': function (t) { var fr = reportFrame(t.getAttribute('data-mid'), 'table', t.getAttribute('data-key')); if (fr) openPopup(fr); },
      'rpdf': function (t) {
        var f = findMsg(t.getAttribute('data-mid')); if (!f || !window.DVReportEngine || !window.DVReportEngine.generateAIDashboardPdf) return toast('PDF export is not available on this page.');
        window.DVReportEngine.generateAIDashboardPdf(window.DVAIFiles.toPdfPayload(f.m.report)).then(function () { toast('Report PDF exported.'); }).catch(function () { toast('The PDF library could not load (offline?). Try Excel instead.'); });
      },
      'rxlsx': function (t) {
        var f = findMsg(t.getAttribute('data-mid')), E = window.DVReportEngine; if (!f || !E || (!E.generateAIReportExcel && !E.generateExcelReport)) return toast('Excel export is not available on this page.');
        /* structured workbook (one typed sheet per chart / finding / table); the flat export remains as a fallback for older engines */
        var run = E.generateAIReportExcel && window.DVAIFiles && window.DVAIFiles.toExcelPayload ? E.generateAIReportExcel(window.DVAIFiles.toExcelPayload(f.m.report)) : E.generateExcelReport(reportExcel(f.m.report));
        run.then(function () { toast('Excel report exported.'); }).catch(function (e) { toast((e && e.message) || 'The Excel library could not load (offline?).'); });
      },
      'rerecon': function (t) { var f = findMsg(t.getAttribute('data-mid')); if (!f || !f.m.report.target || !S.files[f.m.report.fileId]) return toast('Attach the file again to re-run this reconciliation.'); var r = f.m.report; S.rf = { fileId: r.fileId, sheet: r.sheet || 0, column: r.target.column, targetId: window.DVAIFiles.TARGETS.filter(function (x) { return x.model === r.target.model; })[0].id, field: r.target.field, cmpCol: r.target.compareFileColumn, cmpField: r.target.compareField, busy: false, p: 0, open: true }; openInsp('files'); },
      'file-recon': function (t) { var id = t.getAttribute('data-id'); if (!S.files[id]) return toast('Attach the file again to reconcile it.'); S.rf = null; rfState(S.files[id]); S.rf.open = true; openInsp('files'); },
      'recon-cancel': function () { if (S.rf) S.rf.open = false; renderInsp(); },
      'run-recon': function () { runRecon(); },
      'file-ask': function (t) { var e = S.files[t.getAttribute('data-id')]; if (!e) return toast('Attach the file again first.'); el.input.value = 'Summarize the key findings in "' + e.file.name + '" and what I should check first.'; autosize(); updateSend(); el.input.focus(); },
      'file-report': function (t) { var e = S.files[t.getAttribute('data-id')]; if (e) { postReport(e.file); renderMessages(); } },
      'file-remove': function (t) { delete S.files[t.getAttribute('data-id')]; if (S.rf && S.rf.fileId === t.getAttribute('data-id')) S.rf = null; renderInsp(); toast('File removed from memory.'); },
      'file-pick': function () { el.file.click(); },
      'pending-remove': function (t) { S.pending.splice(+t.getAttribute('data-i'), 1); renderTray(); updateSend(); },
      'pop-close': function () { closePopup(); },
      'pop-to': function (t) { popTo(+t.getAttribute('data-i')); },
      'pop-back': function () { popTo(S.stack.length - 2); },
      'pop-rec': function (t) { openPopup({ kind: 'record', model: t.getAttribute('data-model'), id: +t.getAttribute('data-id'), title: t.getAttribute('data-model') + ' #' + t.getAttribute('data-id'), label: '#' + t.getAttribute('data-id') }); },
      'pop-page': function (t) { var f = S.stack[S.stack.length - 1]; f.offset = Math.max(0, (f.offset || 0) + 25 * (+t.getAttribute('data-d'))); paintPop(); },
      'pop-tpage': function (t) { var f = S.stack[S.stack.length - 1]; f.page = Math.max(0, (f.page || 0) + (+t.getAttribute('data-d'))); paintPop(); },
      'pop-retry': function () { paintPop(); },
      'pop-explorer': function (t) { var f = S.stack[S.stack.length - 1]; if (!f || !window.DVDrill) return; closePopup(); window.DVDrill.open({ title: f.title, model: f.model, domain: f.domain || [], measure: null, date: null, kind: 'count' }, t); },
      'pop-csv': function () { if (!pop.last) return; download((pop.last.name || 'rows').replace(/[^\w.-]+/g, '-') + '.csv', csvOf(pop.last.cols, pop.last.rows), 'text/csv;charset=utf-8'); toast('CSV downloaded.'); },
      'open-conn': function () { openInsp('connection'); }, 'settings-ai': function () { goSettings('ai'); }, 'settings-odoo': function () { goSettings('odoo'); },
      'recheck': function () { S.health = null; checkHealth(true); }, 'conn-chat': function () { send('status'); }, 'diag': function () { copyText(diagnostics()); },
      'test-ai': function () { testProvider(); }
    };
    root.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-act]');
      if (!t || !root.contains(t)) return;
      var fn = ACT[t.getAttribute('data-act')];
      if (fn) { e.preventDefault(); e.stopPropagation(); fn(t, e); }
    });
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.ai-dashboard-bar-row[role="button"], tr[data-act], .aiw-vbar[role="button"], .aiw-vleg[role="button"], circle[role="button"], rect[role="button"], .ai-chart-row[role="button"], .ai-donut-item[role="button"]')) { e.preventDefault(); e.target.click(); }
    });
    root.addEventListener('input', function (e) {
      var t = e.target; if (!t || !t.classList || !t.classList.contains('aiw-vtq')) return;
      var mid = t.getAttribute('data-mid'), mi = +t.getAttribute('data-mi'), st = vst(mid, mi), card = t.closest('.aiw-vis-card'); if (!card) return;
      st.q = t.value; var tb = card.querySelector('.aiw-vtbl tbody'), ct = card.querySelector('.aiw-vtcount'); if (tb) tb.innerHTML = visTableBody(mid, mi);
      if (ct) ct.textContent = visTableData(mid, mi).rows.length + ' of ' + visPayloads[mid].metrics[mi].rows.length + ' rows';
    });
    root.addEventListener('change', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-rf'); if (!k || !S.rf) return;
      var v = e.target.value; S.rf[k] = k === 'sheet' ? +v : v;
      if (k === 'sheet') { var t = S.files[S.rf.fileId].file.tables[S.rf.sheet]; S.rf.column = t.columns[0]; S.rf.cmpCol = ''; }
      if (k === 'targetId') { S.rf.field = ''; S.rf.cmpField = ''; }
      renderInsp();
    });
    el.inspTabs.addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) openInsp(b.getAttribute('data-tab')); });
    $('aiwNewBtn').addEventListener('click', newChat);
    $('aiwExportBtn').addEventListener('click', exportChat);
    $('aiwInspClose').addEventListener('click', closeInsp);
    $('aiwPrivacyBtn').addEventListener('click', function () { openInsp('connection'); setTimeout(function () { var n = $('aiwSharing'); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); });
    el.inspBtn.addEventListener('click', function () { isInspOpen() ? closeInsp() : openInsp(S.tab); });
    el.odooChip.addEventListener('click', function () { openInsp('connection'); });
    el.provChip.addEventListener('click', function () { openInsp('connection'); });
    $('aiwRailBtn').addEventListener('click', function () { root.dataset.rail = root.dataset.rail === 'open' ? 'closed' : 'open'; syncScrim(); });
    el.scrim.addEventListener('click', function () { root.dataset.rail = 'closed'; if (window.innerWidth <= 1240) closeInsp(); syncScrim(); });
    (function () { var top = el.search && el.search.closest('.aiw-rail-top'); if (top && !$('aiwCats')) { var c = document.createElement('div'); c.id = 'aiwCats'; c.className = 'aiw-cats'; c.hidden = true; c.setAttribute('aria-label', 'Filter chats by area'); top.appendChild(c); } })();
    el.search.addEventListener('input', function () { S.filter = el.search.value.trim(); renderThreads(); });
    el.input.addEventListener('input', function () { autosize(); updateSend(); });
    el.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!el.send.disabled) send(); } });
    el.input.addEventListener('paste', function (e) { var fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); addFiles(fs); } });
    el.send.addEventListener('click', function () { send(); });
    $('aiwAttach').addEventListener('click', function () { el.file.click(); });
    el.file.setAttribute('accept', (window.DVAIFiles && window.DVAIFiles.ACCEPT) || '.csv,.tsv,.txt,.json,.xlsx,.xls');
    el.file.addEventListener('change', function () { addFiles(el.file.files); el.file.value = ''; });
    var dragDepth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') > -1; }
    root.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; el.drop.hidden = false; });
    root.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    root.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.drop.hidden = true; });
    root.addEventListener('drop', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; el.drop.hidden = true; addFiles(e.dataTransfer.files); });
    document.addEventListener('keydown', function (e) {
      if (!isAiView()) return;
      if (e.key === 'Escape') { if (popOpen()) { e.preventDefault(); S.stack.length > 1 ? popTo(S.stack.length - 2) : closePopup(); } else if (window.innerWidth <= 1240 && isInspOpen()) closeInsp(); else if (window.innerWidth <= 900 && root.dataset.rail === 'open') { root.dataset.rail = 'closed'; syncScrim(); } }
      else if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); el.input.focus(); }
    });
    window.addEventListener('resize', syncScrim);

    /* PDF / print of the Odoo dashboard artifact (unchanged behaviour) */
    document.addEventListener('click', function (event) {
      var exportBtn = event.target.closest && event.target.closest('[data-ai-dashboard-export]'), printBtn = event.target.closest && event.target.closest('[data-ai-dashboard-print]'), xlsxBtn = event.target.closest && event.target.closest('[data-ai-dashboard-xlsx]');
      if (!exportBtn && !printBtn && !xlsxBtn) return;
      var section = event.target.closest('.ai-dashboard-artifact'); if (!section) return;
      if (xlsxBtn) {
        var xp = dashboardPayloads[section.getAttribute('data-ai-dashboard-id')];
        if (xp && window.DVReportEngine && typeof window.DVReportEngine.generateAIReportExcel === 'function') {
          window.DVReportEngine.generateAIReportExcel(xp).then(function () { toast('Excel workbook exported.'); }).catch(function () { toast('The Excel library could not load (offline?). Try the PDF export instead.'); });
        } else { toast('Excel export is unavailable on this page.'); }
        return;
      }
      if (printBtn) { toast('In the print dialog, choose “Save as PDF”.'); printDashboard(); return; }
      var payload = dashboardPayloads[section.getAttribute('data-ai-dashboard-id')];
      if (payload && window.DVReportEngine && typeof window.DVReportEngine.generateAIDashboardPdf === 'function') {
        window.DVReportEngine.generateAIDashboardPdf(payload).then(function () { toast('Board-ready dashboard PDF exported.'); }).catch(function () { toast('PDF library unavailable; opening print dialog. Choose “Save as PDF”.'); printDashboard(); });
      } else { toast('PDF export tooling unavailable; opening print dialog. Choose “Save as PDF”.'); printDashboard(); }
    });

    /* ══════════ start ══════════ */
    loadStore();
    var handoff = null;
    try { var qp = new URLSearchParams(location.search); handoff = qp.get('q'); if (handoff) { qp.delete('q'); history.replaceState(null, '', location.pathname + (qp.toString() ? '?' + qp.toString() : '') + location.hash); } } catch (e) {}
    if (!S.activeId || !S.threads.some(function (t) { return t.id === S.activeId; })) { if (S.threads[0]) S.activeId = S.threads[0].id; else newDraft(); }
    root.dataset.rail = window.innerWidth <= 900 ? 'closed' : 'open';
    root.dataset.insp = 'closed';
    if (window.DVArtifacts) {
      window.DVArtifacts.mount({ root: root, body: root.querySelector('.aiw-body'), btn: el.artBtn, renderMarkdown: renderMarkdown, toast: toast, copy: copyText, isBusy: function () { return S.busy; }, send: function (t, x) { send(t, x); }, onOpen: function () { if (isInspOpen()) closeInsp(); } });
    }
    var startParts = location.hash.slice(1).split('/');
    if (startParts[0] === 'ai' && startParts.length > 1) { try { applyRoute(); } catch (e) {} }
    if (handoff) { newDraft(); }
    renderAll(); updateChips();
    document.addEventListener('dv:view', function (e) {
      if (!e.detail || e.detail.view !== 'ai') return;
      applyRoute(); renderThreads(); renderHeroStatusOnly(); updateChips();
      if (odooInfo().connected && (!S.health || Date.now() - S.healthAt > 300000)) checkHealth(false);
      if (window.innerWidth > 900) setTimeout(function () { el.input.focus({ preventScroll: true }); }, 60);
    });
    window.addEventListener('hashchange', applyRoute);
    ['dv:odoo-config-saved', 'dv:odoo-disconnected', 'dv:odoo-connected', 'dv:ai-config-saved'].forEach(function (n) { document.addEventListener(n, function () { S.health = null; S.provider = { outcome: 'untested', ms: null, at: 0, error: '' }; for (var k in rpcCache) delete rpcCache[k]; updateChips(); renderHeroStatusOnly(); if (isInspOpen() && S.tab === 'connection') renderInsp(); if (odooInfo().connected && isAiView()) checkHealth(true); }); });
    window.addEventListener('storage', function (e) { if (/odoo|ai_settings|dashview-config|al_ai/i.test(e.key || '')) { updateChips(); renderHeroStatusOnly(); } });
    if (odooInfo().connected && isAiView()) setTimeout(function () { checkHealth(false); }, 250);
    if (handoff && isAiView()) setTimeout(function () { send(handoff); }, 250);
    else if (handoff) { var once = function (e) { if (e.detail && e.detail.view === 'ai') { document.removeEventListener('dv:view', once); setTimeout(function () { send(handoff); }, 250); } }; document.addEventListener('dv:view', once); }
  });
})();
