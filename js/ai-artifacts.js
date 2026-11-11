/* ==========================================================================
   DashView — AI Artifacts  (js/ai-artifacts.js)  ·  v1
   --------------------------------------------------------------------------
   An artifact is a finished, self-contained deliverable the assistant makes for you — a report, a page, a
   table, a chart, a piece of code — shown in its own side panel next to the chat instead of being buried in
   the conversation. You can open it, edit it, keep every version, compare versions, download it in the
   right format, print it, or ask the assistant to revise it.

   Types       document (Markdown report / memo / plan)  ·  html (sandboxed web page, dashboard, mini-app)
               svg (image)  ·  table (CSV)  ·  chart (JSON spec)  ·  code (any language)

   How a model makes one   <artifact id="q3-report" type="document" title="Q3 report">…</artifact>
                           (js/ai-artifacts.js → promptRules() is added to the prompts of the chat and of the
                           Odoo agent). Re-using an id creates the next version of the same artifact.
   How the chat refers     the tag is replaced in the saved message by a marker  [[artifact:<id>:<version>]]
                           and drawn as a card; the content lives in this module's own store
                           (localStorage "dv-ai-artifacts-v1", capped, evicts the oldest un-pinned first).

   Security   document / table / chart / code / svg are drawn by escaping (SVG as an <img>, so scripts never
              run). HTML runs only in a sandboxed iframe (no same-origin, a CSP with no network, forms or
              frames), and "Open full page" wraps it in the same sandbox.

   The parsing, store, CSV, chart, highlight and diff code is plain JS and is unit-tested in Node
   (test/ai-artifacts.test.js); the panel needs the dashboard DOM (css/ai-artifacts.css).
   ========================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.DVArtifacts = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var STORE_KEY = 'dv-ai-artifacts-v1', PREF_KEY = 'dv-ai-artifacts-prefs', WIDTH_KEY = 'dv-ai-artifacts-width';
  var MAX_CONTENT = 600000;      // characters kept per version
  var MAX_VERSIONS = 15;         // versions kept per artifact (the newest ones)
  var MAX_TOTAL = 2000000;       // characters kept in total before the oldest un-pinned artifacts are dropped
  var MARK = /\[\[artifact:([A-Za-z0-9_-]+):(\d+)\]\]/g;
  var PH = '\u241F';             // placeholder fence used while a message is being rewritten

  /* ── small helpers ─────────────────────────────────────────────────────────────────────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }
  function rid() { return 'ar' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function words(t) { var m = String(t || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu); return m ? m.length : 0; }
  function lines(t) { return String(t || '').split('\n').length; }
  function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function fmtNum(v) { if (typeof v !== 'number' || !isFinite(v)) return String(v == null ? '' : v); var a = Math.abs(v); return (a >= 1000 || Number.isInteger(v)) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100); }
  function compact(v) {
    if (typeof v !== 'number' || !isFinite(v)) return String(v == null ? '' : v);
    var a = Math.abs(v), u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < u.length; i++) if (a >= u[i][0]) { var x = v / u[i][0], t = (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)); return (t.indexOf('.') > -1 ? t.replace(/0+$/, '').replace(/\.$/, '') : t) + u[i][1]; }
    return String(Math.round(v * 100) / 100);
  }
  function relTime(ts) {
    var d = Date.now() - ts;
    if (d < 45000) return 'just now'; if (d < 3600000) return Math.round(d / 60000) + ' min ago';
    if (d < 86400000) return Math.round(d / 3600000) + ' h ago';
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /* ── types ─────────────────────────────────────────────────────────────────────────────────────── */
  var TYPES = {
    document: { label: 'Document', plural: 'Documents', ext: 'md', mime: 'text/markdown;charset=utf-8' },
    html: { label: 'Web page', plural: 'Web pages', ext: 'html', mime: 'text/html;charset=utf-8' },
    svg: { label: 'Image', plural: 'Images', ext: 'svg', mime: 'image/svg+xml;charset=utf-8' },
    table: { label: 'Table', plural: 'Tables', ext: 'csv', mime: 'text/csv;charset=utf-8' },
    chart: { label: 'Chart', plural: 'Charts', ext: 'json', mime: 'application/json;charset=utf-8' },
    code: { label: 'Code', plural: 'Code', ext: 'txt', mime: 'text/plain;charset=utf-8' }
  };
  var ALIAS = {
    markdown: 'document', md: 'document', doc: 'document', report: 'document', text: 'document', memo: 'document', article: 'document',
    webpage: 'html', page: 'html', dashboard: 'html', app: 'html', website: 'html', 'text/html': 'html',
    image: 'svg', 'image/svg+xml': 'svg', csv: 'table', spreadsheet: 'table', data: 'table', graph: 'chart', diagram: 'chart',
    script: 'code', program: 'code', sql: 'code', source: 'code'
  };
  var EXT = { javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', python: 'py', py: 'py', sql: 'sql', json: 'json', html: 'html', css: 'css', scss: 'scss', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', cs: 'cs', go: 'go', golang: 'go', rust: 'rs', php: 'php', ruby: 'rb', yaml: 'yml', yml: 'yml', xml: 'xml', markdown: 'md', kotlin: 'kt', swift: 'swift', r: 'r', powershell: 'ps1', dockerfile: 'Dockerfile', toml: 'toml', ini: 'ini', text: 'txt', txt: 'txt', plaintext: 'txt' };

  function normType(t, lang, content) {
    t = String(t || '').toLowerCase().trim();
    if (ALIAS[t]) t = ALIAS[t];
    if (TYPES[t]) return t;
    var c = String(content || '').trim();
    if (/^<!doctype html|^<html[\s>]/i.test(c)) return 'html';
    if (/^<svg[\s>]/i.test(c)) return 'svg';
    if (/^[{[]/.test(c) && chartSpec(c).ok) return 'chart';
    if (looksCsv(c)) return 'table';
    if (lang && lang !== 'markdown' && lang !== 'md' && lang !== 'text') return 'code';
    return 'document';
  }
  function looksCsv(c) {
    var ls = String(c).split('\n').filter(function (l) { return l.trim(); });
    if (ls.length < 3) return false;
    var d = detectDelim(ls.slice(0, 5).join('\n')), n = (ls[0].match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
    if (n < 1) return false;
    var same = 0; for (var i = 1; i < Math.min(ls.length, 8); i++) if ((ls[i].match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length === n) same++;
    return same >= Math.min(ls.length - 1, 7) * 0.8;
  }
  function fileExt(item, v) {
    var t = item.type;
    if (t === 'code') return EXT[String(item.lang || '').toLowerCase()] || 'txt';
    return TYPES[t].ext;
  }
  function fileName(item, ext) {
    var base = String(item.title || 'artifact').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'artifact';
    return base.replace(/\s/g, '-') + '.' + (ext || fileExt(item));
  }

  /* ── 1. Parsing the model's reply ──────────────────────────────────────────────────────────────── */
  function parseAttrs(s) {
    var out = {}, re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(s || ''))) out[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3];
    return out;
  }
  function stripFence(content) {
    var m = /^\s*```([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(content);
    return m ? { content: m[2], lang: m[1] } : { content: content, lang: '' };
  }
  function trimBlock(s) { return String(s).replace(/^\s*\n/, '').replace(/\s+$/, ''); }

  function autoTitle(type, lang, content) {
    var c = String(content || ''), m;
    if (type === 'html' && (m = /<title[^>]*>([^<]{2,80})<\/title>/i.exec(c))) return m[1].trim();
    if (type === 'html' && (m = /<h1[^>]*>([^<]{2,80})<\/h1>/i.exec(c))) return m[1].trim();
    if (type === 'document' && (m = /^#{1,3}\s+(.{2,90})$/m.exec(c))) return m[1].replace(/[*_`]/g, '').trim();
    if (type === 'svg' && (m = /<title[^>]*>([^<]{2,80})<\/title>/i.exec(c))) return m[1].trim();
    if (type === 'chart') { var sp = chartSpec(c); if (sp.ok && sp.spec.title) return sp.spec.title; }
    if (type === 'code' && (m = /^\s*(?:\/\/|#|--|\/\*+)\s*(.{3,70}?)\s*(?:\*\/)?$/m.exec(c))) return m[1];
    return type === 'code' && lang ? lang.charAt(0).toUpperCase() + lang.slice(1) + ' code' : TYPES[type].label;
  }

  /* Reply text -> { text with placeholders, items }. Handles <artifact …>…</artifact>, a reply that was cut off
     before the closing tag, and (auto) big fenced html / svg / csv / code blocks the model forgot to wrap. */
  function parse(text, opts) {
    opts = opts || {};
    var src = String(text == null ? '' : text), items = [], out = '', last = 0, m;
    var re = /<artifact\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/artifact>|$)/gi;
    while ((m = re.exec(src))) {
      if (m[2] === '/' && !m[3]) continue;                       // self-closing stub (history markers), ignore
      var attrs = parseAttrs(m[1]), complete = /<\/artifact>\s*$/i.test(m[0]);
      var fenced = stripFence(trimBlock(m[3])), content = fenced.content;
      var lang = String(attrs.language || attrs.lang || fenced.lang || '').toLowerCase();
      var type = normType(attrs.type, lang, content);
      if (type === 'code' && !lang && /^(py|js|ts|sql|sh|css|json)$/.test(String(attrs.type || '').toLowerCase())) lang = String(attrs.type).toLowerCase();
      if (!content.trim()) { out += src.slice(last, m.index); last = m.index + m[0].length; continue; }
      items.push({ id: slug(attrs.id) || '', type: type, lang: lang, title: clip(attrs.title || autoTitle(type, lang, content), 90), content: content, complete: complete, auto: false });
      out += src.slice(last, m.index) + '\n\n' + PH + 'A' + (items.length - 1) + PH + '\n\n';
      last = m.index + m[0].length;
      if (items.length >= 6) break;
    }
    out += src.slice(last);
    if (!items.length && opts.auto !== false) {
      var fence = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g, o2 = '', l2 = 0, f;
      while ((f = fence.exec(out)) && items.length < 3) {
        var lg = String(f[1] || '').toLowerCase(), body = trimBlock(f[2]), n = lines(body), t = null;
        if (/^(kpi|chart|dashboard|mermaid)$/.test(lg)) continue;
        if (lg === 'html' || /^<!doctype html|^<html[\s>]/i.test(body)) { if (/<html|<!doctype/i.test(body) || n >= 25) t = 'html'; }
        else if (lg === 'svg' || /^<svg[\s>]/i.test(body)) { if (/^<svg[\s>]/i.test(body)) t = 'svg'; }
        else if ((lg === 'csv' || lg === 'tsv') && n >= 6) t = 'table';
        else if (n >= 40 && lg !== 'text' && lg !== 'markdown' && lg !== 'md') t = 'code';
        if (!t) continue;
        items.push({ id: '', type: t, lang: t === 'code' ? lg : (t === 'html' ? 'html' : ''), title: clip(autoTitle(t, lg, body), 90), content: body, complete: true, auto: true });
        o2 += out.slice(l2, f.index) + '\n\n' + PH + 'A' + (items.length - 1) + PH + '\n\n';
        l2 = f.index + f[0].length;
      }
      if (items.length) out = o2 + out.slice(l2);
    }
    return { text: out.replace(/\n{3,}/g, '\n\n').trim(), items: items };
  }

  /* ── 2. Store ──────────────────────────────────────────────────────────────────────────────────── */
  var DB = null, listeners = [], saveTimer = 0, volatile = false;
  function storage() { try { return root && root.localStorage ? root.localStorage : null; } catch (e) { return null; } }
  function load() {
    if (DB) return DB;
    DB = { v: 1, items: {} };
    var ls = storage();
    try {
      var d = ls && JSON.parse(ls.getItem(STORE_KEY) || 'null');
      if (d && d.items && typeof d.items === 'object') Object.keys(d.items).forEach(function (k) { var it = sanitizeItem(d.items[k], k); if (it) DB.items[it.id] = it; });
    } catch (e) { /* unreadable store: start empty, never throw into the chat */ }
    return DB;
  }
  function sanitizeItem(it, key) {
    if (!it || typeof it !== 'object' || !Array.isArray(it.versions) || !it.versions.length) return null;
    var id = String(it.id || key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); if (!id) return null;
    var type = TYPES[it.type] ? it.type : 'document';
    var vs = it.versions.map(function (v, i) {
      if (!v || typeof v.content !== 'string') return null;
      return { n: Number(v.n) > 0 ? Math.floor(Number(v.n)) : i + 1, t: Number(v.t) || Date.now(), by: v.by === 'you' ? 'you' : 'ai', content: v.content.slice(0, MAX_CONTENT), source: clip(v.source || '', 160), note: clip(v.note || '', 140), cut: !!v.cut };
    }).filter(Boolean);
    if (!vs.length) return null;
    return { id: id, tid: String(it.tid || ''), mid: slug(it.mid) || id, type: type, lang: String(it.lang || '').toLowerCase().slice(0, 20), title: clip(it.title || TYPES[type].label, 90), pinned: !!it.pinned, created: Number(it.created) || vs[0].t, updated: Number(it.updated) || vs[vs.length - 1].t, next: Math.max(Number(it.next) || 0, vs[vs.length - 1].n + 1), versions: vs.slice(-MAX_VERSIONS), chat: clip(it.chat || '', 80) };
  }
  function size() { var n = 0; Object.keys(DB.items).forEach(function (k) { DB.items[k].versions.forEach(function (v) { n += v.content.length; }); }); return n; }
  function evict() {
    var tot = size();
    if (tot <= MAX_TOTAL) return;
    var cands = Object.keys(DB.items).map(function (k) { return DB.items[k]; }).filter(function (i) { return !i.pinned; }).sort(function (a, b) { return a.updated - b.updated; });
    for (var pass = 0; pass < 2 && tot > MAX_TOTAL; pass++) {            // pass 1: drop old versions (keep the newest); pass 2: whole artifacts, oldest first
      for (var i = 0; i < cands.length && tot > MAX_TOTAL; i++) {
        var it = cands[i];
        if (pass === 0) { while (it.versions.length > 1 && tot > MAX_TOTAL) tot -= it.versions.shift().content.length; }
        else if (DB.items[it.id]) { it.versions.forEach(function (v) { tot -= v.content.length; }); delete DB.items[it.id]; }
      }
    }
  }
  function flush() {
    saveTimer = 0; var ls = storage(); if (!ls) { volatile = true; return false; }
    evict();
    for (var tries = 0; tries < 4; tries++) {
      try { ls.setItem(STORE_KEY, JSON.stringify(DB)); volatile = false; return true; }
      catch (e) { volatile = true; var oldest = Object.keys(DB.items).map(function (k) { return DB.items[k]; }).filter(function (i) { return !i.pinned; }).sort(function (a, b) { return a.updated - b.updated; })[0]; if (!oldest) break; delete DB.items[oldest.id]; }
    }
    return false;
  }
  function changed() { if (!saveTimer) saveTimer = setTimeout(flush, 250); listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }
  function get(aid) { return load().items[aid] || null; }
  function latest(it) { return it.versions[it.versions.length - 1]; }
  function version(it, n) { if (!it) return null; if (n == null) return latest(it); for (var i = 0; i < it.versions.length; i++) if (it.versions[i].n === Number(n)) return it.versions[i]; return null; }
  function list() { return Object.keys(load().items).map(function (k) { return DB.items[k]; }).sort(function (a, b) { return (b.pinned - a.pinned) || (b.updated - a.updated); }); }
  function count() { return Object.keys(load().items).length; }

  function pushVersion(it, content, by, meta) {
    meta = meta || {};
    var cut = content.length > MAX_CONTENT; if (cut) content = content.slice(0, MAX_CONTENT);
    var cur = latest(it);
    if (cur && cur.content === content) return cur;
    var v = { n: it.next++, t: Date.now(), by: by === 'you' ? 'you' : 'ai', content: content, source: clip(meta.source || '', 160), note: clip(meta.note || '', 140), cut: cut };
    it.versions.push(v); if (it.versions.length > MAX_VERSIONS) it.versions.splice(0, it.versions.length - MAX_VERSIONS);
    it.updated = v.t; return v;
  }
  /* A model-made (or user-made) artifact: same thread + same id => next version, otherwise a new artifact. */
  function upsert(tid, p, meta) {
    load(); meta = meta || {};
    var mid = slug(p.id) || slug(p.title) || 'artifact', it = null;
    Object.keys(DB.items).forEach(function (k) { var x = DB.items[k]; if (!it && p.id && x.tid === tid && x.mid === mid) it = x; });
    if (it) {
      it.type = p.type; if (p.lang) it.lang = p.lang; if (p.title && (!it.renamed)) it.title = p.title;
      var v = pushVersion(it, p.content, meta.by || 'ai', meta); changed(); return { aid: it.id, n: v.n, created: false };
    }
    var id = rid(), now = Date.now();
    it = { id: id, tid: String(tid || ''), mid: mid, type: p.type, lang: p.lang || '', title: clip(p.title || TYPES[p.type].label, 90), pinned: false, created: now, updated: now, next: 1, versions: [], chat: clip(meta.chat || '', 80) };
    DB.items[id] = it; var v1 = pushVersion(it, p.content, meta.by || 'ai', meta); changed();
    return { aid: id, n: v1.n, created: true };
  }
  function addVersion(aid, content, by, meta) { var it = get(aid); if (!it) return null; var v = pushVersion(it, String(content), by || 'you', meta); changed(); return v; }
  function rename(aid, title) { var it = get(aid); title = clip(String(title || '').replace(/\s+/g, ' ').trim(), 90); if (!it || !title) return false; it.title = title; it.renamed = true; it.updated = Date.now(); changed(); return true; }
  function pin(aid, on) { var it = get(aid); if (!it) return false; it.pinned = on == null ? !it.pinned : !!on; changed(); return it.pinned; }
  function remove(aid) { load(); if (!DB.items[aid]) return false; delete DB.items[aid]; changed(); return true; }
  function create(p, meta) { return upsert(p.tid || 'manual', { id: '', type: p.type, lang: p.lang || '', title: p.title, content: p.content }, meta); }

  function exportAll() { load(); return JSON.stringify({ app: 'DashView', kind: 'ai-artifacts', v: 1, exported: new Date().toISOString(), items: list() }, null, 2); }
  function importJSON(text) {
    var d; try { d = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { throw new Error('This file is not valid JSON.'); }
    var arr = d && Array.isArray(d.items) ? d.items : Array.isArray(d) ? d : null;
    if (!arr || (d.kind && d.kind !== 'ai-artifacts')) throw new Error('This is not a DashView artifacts export.');
    load(); var n = 0;
    arr.slice(0, 500).forEach(function (raw) {
      var it = sanitizeItem(raw, ''); if (!it) return;
      if (DB.items[it.id]) it.id = rid();
      it.tid = 'import'; DB.items[it.id] = it; n++;
    });
    if (n) changed(); return n;
  }

  /* ── 3. Markers in saved messages ──────────────────────────────────────────────────────────────── */
  function marker(aid, n) { return '[[artifact:' + aid + ':' + n + ']]'; }
  /* The model's reply -> the text to save (tags replaced by markers) + the artifacts that were stored. */
  function ingest(tid, text, meta) {
    meta = meta || {};
    var p = parse(text, { auto: meta.auto !== false }); if (!p.items.length) return { text: String(text == null ? '' : text), refs: [] };
    var refs = [], out = p.text;
    p.items.forEach(function (it, i) {
      var r = upsert(tid, it, meta); r.title = get(r.aid).title; r.complete = it.complete; refs.push(r);
      out = out.replace(PH + 'A' + i + PH, marker(r.aid, r.n) + (it.complete ? '' : '\n\n*The reply was cut off before this was finished. Ask me to continue it.*'));
    });
    if (!out.replace(MARK, '').trim()) out = 'I made **' + refs[0].title + '**.\n\n' + out;
    return { text: out, refs: refs };
  }
  function markersIn(text) { var out = [], m, re = new RegExp(MARK.source, 'g'); while ((m = re.exec(String(text || '')))) out.push({ aid: m[1], n: +m[2] }); return out; }
  function plain(text) {   // for copy / simple exports: the marker becomes a readable line
    return String(text || '').replace(new RegExp(MARK.source, 'g'), function (_, aid, n) { var it = get(aid); return it ? '[Artifact: ' + it.title + ' — ' + TYPES[it.type].label + ', v' + n + ']' : '[Artifact]'; });
  }
  function fenceFor(it, v) {
    var lang = it.type === 'code' ? (it.lang || '') : it.type === 'html' ? 'html' : it.type === 'svg' ? 'svg' : it.type === 'table' ? 'csv' : it.type === 'chart' ? 'json' : 'markdown';
    return '```' + lang + '\n' + v.content + '\n```';
  }
  function expandForExport(text) {   // Markdown chat export: the real content goes in
    return String(text || '').replace(new RegExp(MARK.source, 'g'), function (_, aid, n) {
      var it = get(aid), v = it && version(it, +n); if (!it || !v) return '[Artifact no longer available]';
      return '**Artifact: ' + it.title + '** (' + TYPES[it.type].label + ', v' + n + ')\n\n' + fenceFor(it, v);
    });
  }
  /* What the model sees for earlier turns: the newest version of the artifacts in play in full (so "make it shorter"
     works), every other one as a small stub. Returns one string per message. */
  function historyTexts(messages) {
    load();
    var latestMsg = {}, order = [], MAXFULL = 40000;
    messages.forEach(function (m, i) {
      markersIn(m.content).forEach(function (r) { var it = get(r.aid); if (!it) return; if (r.n === latest(it).n) { if (!(r.aid in latestMsg)) order.push(r.aid); latestMsg[r.aid] = i; } });
      if (m.artRef && m.artRef.aid && get(m.artRef.aid)) { var a = m.artRef.aid; if (!(a in latestMsg)) { order.push(a); } latestMsg[a] = Math.max(latestMsg[a] == null ? -1 : latestMsg[a], i); }
    });
    var full = {}; order.slice(-2).forEach(function (a) { full[a] = true; });
    return messages.map(function (m, i) {
      var t = String(m.content || '');
      t = t.replace(new RegExp(MARK.source, 'g'), function (_, aid, n) {
        var it = get(aid), v = it && version(it, +n); if (!it || !v) return '';
        var head = '<artifact id="' + it.mid + '" type="' + it.type + '"' + (it.lang ? ' language="' + esc(it.lang) + '"' : '') + ' title="' + esc(it.title) + '" version="' + n + '"';
        if (full[aid] && latestMsg[aid] === i && v.content.length <= MAXFULL) return head + '>\n' + v.content + '\n</artifact>';
        return head + ' />' + (full[aid] && v.content.length > MAXFULL ? ' (too large to include here — ask which part to change)' : '');
      });
      if (m.artRef && m.artRef.aid) {
        var it = get(m.artRef.aid), v = it && latest(it);
        if (it && v && latestMsg[m.artRef.aid] === i && full[m.artRef.aid] && v.content.length <= MAXFULL) {
          t += '\n\n[The artifact to change — reply with the full updated artifact using the same id]\n<artifact id="' + it.mid + '" type="' + it.type + '"' + (it.lang ? ' language="' + esc(it.lang) + '"' : '') + ' title="' + esc(it.title) + '" version="' + v.n + '">\n' + v.content + '\n</artifact>';
        }
      }
      return t;
    });
  }

  /* ── 4. What the model is told ─────────────────────────────────────────────────────────────────── */
  function promptRules(opts) {
    opts = opts || {};
    return 'ARTIFACTS: when the user asks you to create something substantial and self-contained that they will keep, edit, download or reuse — a report, memo, plan, SOP, long email, a web page or dashboard, an SVG, a CSV table, a chart, a script — put it in ONE artifact tag and keep the chat reply short:\n' +
      '<artifact id="short-kebab-id" type="document|html|svg|table|chart|code" title="Short title" language="python">…the complete content…</artifact>\n' +
      '- Outside the tag write 1-3 lines about what you made and what to check. Never repeat the content outside the tag, and never wrap the content in a code fence inside the tag.\n' +
      '- To change an artifact that exists, send the SAME id with the COMPLETE new content (not a diff). A new id makes a new artifact.\n' +
      '- document: Markdown with # headings, tables and lists' + (opts.odoo ? '; follow the report template (Bottom line, Key figures, What changed, Key insights, Risks, Recommended actions, Assumptions, Confidence) and use only figures from the returned rows' : '') + '. html: ONE self-contained file with inline CSS and JS, responsive, no external requests, images or fonts (they are blocked), no forms that submit anywhere. svg: a complete <svg> with a viewBox. table: CSV with a header row, comma separated, quote cells that contain commas. chart: JSON {"type":"bar|line|donut","title":"","unit":"","labels":["A","B"],"series":[{"name":"Revenue","values":[1,2]}],"stacked":false}. code: set language="…".\n' +
      '- Do NOT use an artifact for a short answer, a lookup, a list of a few lines or ordinary conversation. Never invent company figures: use only data you were given or queried, and say what is missing.';
  }
  var ASK_RE = /\b(create|build|make|generate|draft|write|prepare|produce|design|export|give me|turn (?:this|that|it) into)\b[^.?!\n]{0,60}\b(report|document|doc|memo|plan|summary|brief|proposal|policy|sop|email|letter|page|dashboard|html|web ?page|website|mini[- ]?app|calculator|svg|image|diagram|table|spreadsheet|csv|chart|graph|script|code|query|template|checklist|presentation|artifact)\b/i;
  function wantsArtifact(q) { q = String(q || ''); return /\bartifacts?\b/i.test(q) || ASK_RE.test(q); }

  /* ── 5. Tables (CSV) ───────────────────────────────────────────────────────────────────────────── */
  function detectDelim(text) {
    var first = String(text).split('\n').slice(0, 5), best = ',', top = 0;
    [',', ';', '\t', '|'].forEach(function (d) {
      var n = 0; first.forEach(function (l) { var q = false; for (var i = 0; i < l.length; i++) { var c = l.charAt(i); if (c === '"') q = !q; else if (c === d && !q) n++; } });
      if (n > top) { top = n; best = d; }
    });
    return best;
  }
  function csvParse(text, delim) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    delim = delim || detectDelim(text);
    var rows = [], row = [], cell = '', q = false, n = text.length;
    for (var i = 0; i < n; i++) {
      var c = text.charAt(i);
      if (q) { if (c === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && cell === '') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = []; if (rows.length >= 20001) break;
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
    return rows;
  }
  function parseNum(s) {
    if (typeof s === 'number') return isFinite(s) ? s : null;
    var t = String(s == null ? '' : s).trim(); if (!t) return null;
    var neg = /^\(.*\)$/.test(t); t = t.replace(/^\((.*)\)$/, '$1').replace(/^[A-Za-z]{2,3}\.?\s?(?=\d)/, '').replace(/[$€£₹¥\s]/g, '').replace(/,/g, '');
    var pct = /%$/.test(t); t = t.replace(/%$/, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
    var v = parseFloat(t); if (!isFinite(v)) return null; return neg ? -v : v;
  }
  function tableModel(content) {
    var rows = csvParse(content); if (!rows.length) return { cols: [], rows: [], total: 0, capped: false };
    var head = rows[0], w = Math.min(60, Math.max.apply(null, rows.map(function (r) { return r.length; })));
    var cols = []; for (var i = 0; i < w; i++) cols.push({ name: String(head[i] || '').trim() || 'Column ' + (i + 1), type: 'text', num: 0, filled: 0 });
    var data = rows.slice(1, 20001).map(function (r) { var o = []; for (var i = 0; i < w; i++) o.push(r[i] == null ? '' : String(r[i])); return o; });
    cols.forEach(function (c, i) {
      var filled = 0, nums = 0, dates = 0;
      data.forEach(function (r) { var v = r[i]; if (v.trim() === '') return; filled++; if (parseNum(v) != null) nums++; else if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v)) dates++; });
      c.filled = filled; c.type = filled && nums / filled >= 0.8 ? 'num' : (filled && dates / filled >= 0.8 ? 'date' : 'text');
    });
    return { cols: cols, rows: data, total: data.length, capped: rows.length > 20001 };
  }
  function columnStats(model) {
    return model.cols.map(function (c, i) {
      var vals = model.rows.map(function (r) { return r[i]; }).filter(function (v) { return v.trim() !== ''; }), uniq = {}, k = 0;
      vals.forEach(function (v) { if (!uniq[v]) { uniq[v] = 1; k++; } });
      var out = { name: c.name, type: c.type, filled: vals.length, empty: model.rows.length - vals.length, unique: k };
      if (c.type === 'num') {
        var ns = vals.map(parseNum).filter(function (x) { return x != null; }), sum = ns.reduce(function (a, b) { return a + b; }, 0);
        out.sum = sum; out.avg = ns.length ? sum / ns.length : null; out.min = ns.length ? Math.min.apply(null, ns) : null; out.max = ns.length ? Math.max.apply(null, ns) : null;
      }
      return out;
    });
  }
  /* Filter + sort a table model without touching it: state { q, sort: colIndex|-1, dir: 1|-1 } -> row indexes */
  function tableView(model, st) {
    st = st || {}; var q = String(st.q || '').trim().toLowerCase(), idx = [], i;
    for (i = 0; i < model.rows.length; i++) { if (!q || model.rows[i].some(function (c) { return c.toLowerCase().indexOf(q) > -1; })) idx.push(i); }
    if (st.sort != null && st.sort > -1 && model.cols[st.sort]) {
      var col = model.cols[st.sort], dir = st.dir === -1 ? -1 : 1;
      idx.sort(function (a, b) {
        var x = model.rows[a][st.sort], y = model.rows[b][st.sort], r;
        if (col.type === 'num') { var nx = parseNum(x), ny = parseNum(y); r = (nx == null ? (ny == null ? 0 : 1) : ny == null ? -1 : nx - ny); if (nx == null || ny == null) return r; }
        else r = String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
        return r * dir || a - b;
      });
    }
    return idx;
  }
  function csvCell(v, numeric) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !(numeric && parseNum(s) != null)) s = "'" + s;       // spreadsheet formulas are neutralised
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvOut(model, idx) {
    var head = model.cols.map(function (c) { return csvCell(c.name, false); }).join(',');
    var body = (idx || model.rows.map(function (_, i) { return i; })).map(function (i) { return model.rows[i].map(function (v, j) { return csvCell(v, model.cols[j].type === 'num'); }).join(','); });
    return [head].concat(body).join('\r\n') + '\r\n';
  }
  function mdTable(model, idx) {
    var cell = function (s) { return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' '); };
    var rows = (idx || model.rows.map(function (_, i) { return i; })).map(function (i) { return '| ' + model.rows[i].map(cell).join(' | ') + ' |'; });
    return ['| ' + model.cols.map(function (c) { return cell(c.name); }).join(' | ') + ' |', '| ' + model.cols.map(function (c) { return c.type === 'num' ? '---:' : '---'; }).join(' | ') + ' |'].concat(rows).join('\n');
  }
  function tableHtml(model, st, limit) {
    var idx = tableView(model, st), shown = idx.slice(0, limit || 300), dir = st && st.dir === -1 ? -1 : 1;
    var th = model.cols.map(function (c, i) {
      var on = st && st.sort === i;
      return '<th scope="col" class="' + (c.type === 'num' ? 'num' : '') + '" aria-sort="' + (on ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-a="tsort" data-i="' + i + '">' + esc(c.name) + '<i aria-hidden="true">' + (on ? (dir > 0 ? '▲' : '▼') : '') + '</i></button></th>';
    }).join('');
    var tr = shown.map(function (ri) { return '<tr>' + model.rows[ri].map(function (v, j) { return '<td' + (model.cols[j].type === 'num' ? ' class="num"' : '') + '>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('');
    var foot = '';
    if (st && st.totals && model.cols.some(function (c) { return c.type === 'num'; })) {
      foot = '<tfoot><tr>' + model.cols.map(function (c, j) {
        if (c.type !== 'num') return '<td>' + (j === 0 ? 'Total' : '') + '</td>';
        var sum = 0; idx.forEach(function (ri) { var n = parseNum(model.rows[ri][j]); if (n != null) sum += n; });
        return '<td class="num">' + esc(fmtNum(sum)) + '</td>';
      }).join('') + '</tr></tfoot>';
    }
    return { html: '<table class="aart-tbl"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody>' + foot + '</table>', total: idx.length, shown: shown.length };
  }

  /* ── 6. Charts ─────────────────────────────────────────────────────────────────────────────────── */
  var FALLBACK_PAL = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a', '#64d2ff', '#ffd60a', '#5e5ce6', '#ac8e68', '#40c8e0', '#ff6482', '#8e8e93'];
  function palette() { var p = root && root.DVFmt && root.DVFmt.PALETTE; return p && p.length >= 8 ? p : FALLBACK_PAL; }
  /* Accepts {type,title,unit,labels,series:[{name,values}],stacked} or {type,title,data:[{label,value}]} or [{label,value}] */
  function chartSpec(text) {
    var d; try { d = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, error: 'The chart data is not valid JSON.' }; }
    if (Array.isArray(d)) d = { data: d };
    if (!d || typeof d !== 'object') return { ok: false, error: 'The chart data is empty.' };
    var labels = [], series = [];
    if (Array.isArray(d.data) && d.data.length && !d.series) {
      labels = d.data.map(function (r) { return String(r && (r.label != null ? r.label : r.name != null ? r.name : r.x != null ? r.x : '')); });
      series = [{ name: String(d.seriesName || d.name || d.unit || 'Value'), values: d.data.map(function (r) { return Number(r && (r.value != null ? r.value : r.y)); }) }];
    } else if (Array.isArray(d.labels) && Array.isArray(d.series)) {
      labels = d.labels.map(String);
      series = d.series.map(function (s, i) { return { name: String(s && s.name != null ? s.name : 'Series ' + (i + 1)), values: (s && Array.isArray(s.values) ? s.values : []).map(Number) }; });
    } else return { ok: false, error: 'Use {"labels":[…],"series":[{"name":"…","values":[…]}]}.' };
    labels = labels.slice(0, 60); series = series.slice(0, 12).map(function (s) { return { name: s.name, values: s.values.slice(0, labels.length) }; })
      .filter(function (s) { return s.values.length && s.values.every(function (v) { return isFinite(v); }); });
    if (labels.length < 1 || !series.length) return { ok: false, error: 'The chart needs at least one label and one series of numbers.' };
    series.forEach(function (s) { while (s.values.length < labels.length) s.values.push(0); });
    var type = String(d.type || 'bar').toLowerCase(); if (!/^(bar|line|donut|pie|area)$/.test(type)) type = 'bar'; if (type === 'pie') type = 'donut';
    return { ok: true, spec: { type: type, title: String(d.title || '').slice(0, 120), unit: String(d.unit || '').slice(0, 12), labels: labels, series: series, stacked: !!d.stacked } };
  }
  function niceScale(min, max, ticks) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; } if (min === max) { if (max === 0) max = 1; else if (max > 0) min = 0; else max = 0; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / ticks))), err = ticks / span * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    return { lo: Math.floor(min / step + 1e-9) * step, hi: Math.ceil(max / step - 1e-9) * step, step: step };
  }
  var EXPORT_CSS = '.aart-bg{fill:#fff}.aart-t{fill:#1c1c1e}.aart-m{fill:#6e6e73}.aart-g{stroke:#e5e5ea}.aart-ax{stroke:#c7c7cc}text{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",Roboto,sans-serif}';
  /* opts: { type override, standalone: embed colours so the SVG works as a file / PNG, hidden: [series indexes] } */
  function chartSvg(spec, opts) {
    opts = opts || {};
    var type = opts.type || spec.type, W = 720, H = type === 'donut' ? 380 : 400, pal = opts.colors || palette(), L = spec.labels, S = spec.series, n = L.length;
    var hidden = opts.hidden || [], vis = S.map(function (s, i) { return i; }).filter(function (i) { return hidden.indexOf(i) < 0; }); if (!vis.length) vis = [0];
    var fmt = function (v) { return compact(v) + (spec.unit && spec.unit.length <= 3 ? spec.unit : ''); };
    var o = [], title = spec.title ? '<text class="aart-t" x="' + (W / 2) + '" y="24" text-anchor="middle" font-size="15" font-weight="600">' + esc(clip(spec.title, 70)) + '</text>' : '';
    var top = spec.title ? 44 : 20, legendH = (S.length > 1 || type === 'donut') ? 30 : 0;
    var desc = (type === 'donut' ? 'Donut' : type === 'line' || type === 'area' ? 'Line' : 'Bar') + ' chart with ' + n + ' categor' + (n === 1 ? 'y' : 'ies') + ' and ' + S.length + ' series.';
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="aart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(spec.title || 'Chart') + '">');
    if (opts.standalone) o.push('<style>' + EXPORT_CSS + '</style><rect class="aart-bg" width="' + W + '" height="' + H + '"/>');
    o.push('<title>' + esc(spec.title || 'Chart') + '</title><desc>' + esc(desc) + '</desc>', title);
    if (type === 'donut') {
      var vals = S[vis[0]].values.map(function (v) { return Math.max(0, v); }), tot = vals.reduce(function (a, b) { return a + b; }, 0) || 1;
      var cx = 230, cy = top + (H - top - 20) / 2, R = Math.min(150, (H - top - 30) / 2), r = R * 0.62, a0 = -Math.PI / 2;
      vals.forEach(function (v, i) {
        if (v <= 0) return; var a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, full = v / tot > 0.9999;
        var x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0), x1 = cx + R * Math.cos(a1 - (full ? 0.0001 : 0)), y1 = cy + R * Math.sin(a1 - (full ? 0.0001 : 0));
        var x2 = cx + r * Math.cos(a1 - (full ? 0.0001 : 0)), y2 = cy + r * Math.sin(a1 - (full ? 0.0001 : 0)), x3 = cx + r * Math.cos(a0), y3 = cy + r * Math.sin(a0);
        o.push('<path d="M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' A' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 ' + big + ' 0 ' + x3.toFixed(1) + ' ' + y3.toFixed(1) + 'Z" fill="' + pal[i % pal.length] + '" stroke="' + (opts.standalone ? '#fff' : 'var(--aart-surface, #fff)') + '" stroke-width="2"><title>' + esc(L[i]) + ': ' + esc(fmtNum(v)) + ' (' + (v / tot * 100).toFixed(1) + '%)</title></path>');
        a0 = a1;
      });
      o.push('<text class="aart-t" x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="22" font-weight="700">' + esc(fmt(tot)) + '</text><text class="aart-m" x="' + cx + '" y="' + (cy + 18) + '" text-anchor="middle" font-size="11">Total</text>');
      var ly = top + 6; vals.slice(0, 12).forEach(function (v, i) {
        o.push('<rect x="430" y="' + (ly + i * 24 - 9) + '" width="12" height="12" rx="3" fill="' + pal[i % pal.length] + '"/><text class="aart-t" x="450" y="' + (ly + i * 24 + 1) + '" font-size="12">' + esc(clip(L[i], 22)) + '</text><text class="aart-m" x="' + (W - 20) + '" y="' + (ly + i * 24 + 1) + '" text-anchor="end" font-size="12">' + (v / tot * 100).toFixed(1) + '%</text>');
      });
      o.push('</svg>'); return o.join('');
    }
    var horizontal = type === 'bar' && S.length === 1 && n <= 15 && L.some(function (l) { return l.length > 12; });
    var stacked = type === 'bar' && spec.stacked && vis.length > 1, area = type === 'area' || (type === 'line' && S.length === 1 && opts.area);
    var minV = 0, maxV = -Infinity, minAll = Infinity;
    for (var i = 0; i < n; i++) {
      if (stacked) { var pos = 0, neg = 0; vis.forEach(function (si) { var v = S[si].values[i]; if (v >= 0) pos += v; else neg += v; }); maxV = Math.max(maxV, pos); minAll = Math.min(minAll, neg); }
      else vis.forEach(function (si) { var v = S[si].values[i]; maxV = Math.max(maxV, v); minAll = Math.min(minAll, v); });
    }
    if (type === 'line' || type === 'area') minV = Math.min(0, minAll) === 0 && minAll > 0 && minAll > maxV * 0.5 ? minAll - (maxV - minAll) * 0.2 : Math.min(0, minAll); else minV = Math.min(0, minAll);
    var sc = niceScale(minV, maxV, 5), padL = horizontal ? 130 : 58, padR = 20, padB = (horizontal ? 24 : (n > 8 ? 74 : 40)) + legendH, padT = top;
    var pw = W - padL - padR, ph = H - padT - padB;
    function yOf(v) { return padT + ph - (v - sc.lo) / (sc.hi - sc.lo || 1) * ph; }
    function xOfVal(v) { return padL + (v - sc.lo) / (sc.hi - sc.lo || 1) * pw; }
    for (var t = sc.lo; t <= sc.hi + sc.step / 2; t += sc.step) {
      var v = Math.round(t / sc.step) * sc.step;
      if (horizontal) { var x = xOfVal(v); o.push('<line class="aart-g" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + padT + '" y2="' + (padT + ph) + '" stroke-width="1"/><text class="aart-m" x="' + x.toFixed(1) + '" y="' + (padT + ph + 16) + '" text-anchor="middle" font-size="11">' + esc(fmt(v)) + '</text>'); }
      else { var y = yOf(v); o.push('<line class="' + (v === 0 ? 'aart-ax' : 'aart-g') + '" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke-width="1"/><text class="aart-m" x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11">' + esc(fmt(v)) + '</text>'); }
    }
    var showVals = n * vis.length <= 14;
    if (horizontal) {
      var bh = ph / n, th = Math.min(26, bh * 0.66), zero = xOfVal(Math.max(sc.lo, 0));
      for (var k = 0; k < n; k++) {
        var val = S[vis[0]].values[k], bx = xOfVal(Math.min(0, val) < sc.lo ? sc.lo : Math.min(0, val)), ex = xOfVal(Math.max(0, val)), cy2 = padT + bh * k + bh / 2;
        o.push('<text class="aart-t" x="' + (padL - 8) + '" y="' + (cy2 + 4).toFixed(1) + '" text-anchor="end" font-size="11.5">' + esc(clip(L[k], 20)) + '</text>');
        o.push('<rect x="' + Math.min(bx, ex).toFixed(1) + '" y="' + (cy2 - th / 2).toFixed(1) + '" width="' + Math.max(1, Math.abs(ex - bx)).toFixed(1) + '" height="' + th.toFixed(1) + '" rx="4" fill="' + pal[vis[0] % pal.length] + '"><title>' + esc(L[k]) + ': ' + esc(fmtNum(val)) + '</title></rect>');
        o.push('<text class="aart-m" x="' + (Math.max(bx, ex) + 6).toFixed(1) + '" y="' + (cy2 + 4).toFixed(1) + '" font-size="11">' + esc(fmt(val)) + '</text>');
      }
      void zero;
    } else {
      var band = pw / n, rot = n > 8;
      for (var j = 0; j < n; j++) {
        var cx2 = padL + band * j + band / 2, lab = clip(L[j], rot ? 14 : 12);
        o.push('<text class="aart-m" x="' + cx2.toFixed(1) + '" y="' + (padT + ph + 18) + '" font-size="11" text-anchor="' + (rot ? 'end' : 'middle') + '"' + (rot ? ' transform="rotate(-35 ' + cx2.toFixed(1) + ' ' + (padT + ph + 18) + ')"' : '') + '>' + esc(lab) + '</text>');
      }
      if (type === 'bar') {
        var group = stacked ? 1 : vis.length, bw = Math.min(46, band * 0.74 / group);
        for (var b = 0; b < n; b++) {
          var gx = padL + band * b + band / 2 - (bw * group) / 2, accP = 0, accN = 0;
          vis.forEach(function (si, gi) {
            var vv = S[si].values[b], x0 = gx + (stacked ? 0 : gi * bw), y0, y1;
            if (stacked) { if (vv >= 0) { y0 = yOf(accP + vv); y1 = yOf(accP); accP += vv; } else { y0 = yOf(accN); y1 = yOf(accN + vv); accN += vv; } }
            else { y0 = yOf(Math.max(0, vv)); y1 = yOf(Math.min(0, vv)); }
            o.push('<rect x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + (bw - (group > 1 && !stacked ? 2 : 0)).toFixed(1) + '" height="' + Math.max(1, y1 - y0).toFixed(1) + '" rx="' + (bw > 10 ? 4 : 2) + '" fill="' + pal[si % pal.length] + '"><title>' + esc(L[b]) + ' · ' + esc(S[si].name) + ': ' + esc(fmtNum(vv)) + '</title></rect>');
            if (showVals && !stacked) o.push('<text class="aart-t" x="' + (x0 + (bw - 2) / 2).toFixed(1) + '" y="' + (y0 - 5).toFixed(1) + '" text-anchor="middle" font-size="10.5">' + esc(fmt(vv)) + '</text>');
          });
        }
      } else {
        vis.forEach(function (si) {
          var pts = S[si].values.map(function (vv, q) { return [padL + band * q + band / 2, yOf(vv)]; }), col = pal[si % pal.length], dpath = pts.map(function (p, q) { return (q ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
          if (area || (type === 'area')) o.push('<path d="' + dpath + 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + yOf(Math.max(0, sc.lo)).toFixed(1) + 'L' + pts[0][0].toFixed(1) + ' ' + yOf(Math.max(0, sc.lo)).toFixed(1) + 'Z" fill="' + col + '" fill-opacity=".14"/>');
          o.push('<path d="' + dpath + '" fill="none" stroke="' + col + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>');
          pts.forEach(function (p, q) {
            o.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.6" fill="' + col + '" stroke="' + (opts.standalone ? '#fff' : 'var(--aart-surface, #fff)') + '" stroke-width="1.5"><title>' + esc(L[q]) + ' · ' + esc(S[si].name) + ': ' + esc(fmtNum(S[si].values[q])) + '</title></circle>');
            if (showVals) o.push('<text class="aart-t" x="' + p[0].toFixed(1) + '" y="' + (p[1] - 9).toFixed(1) + '" text-anchor="middle" font-size="10.5">' + esc(fmt(S[si].values[q])) + '</text>');
          });
        });
      }
    }
    if (legendH) {
      var lx = padL, ly2 = H - 14;
      S.forEach(function (s, si) {
        var w = 28 + Math.min(120, s.name.length * 6.4);
        if (lx + w > W - 10) return;
        o.push('<g opacity="' + (vis.indexOf(si) > -1 ? 1 : 0.35) + '"><rect x="' + lx + '" y="' + (ly2 - 10) + '" width="12" height="12" rx="3" fill="' + pal[si % pal.length] + '"/><text class="aart-t" x="' + (lx + 18) + '" y="' + ly2 + '" font-size="12">' + esc(clip(s.name, 20)) + '</text></g>');
        lx += w + 10;
      });
    }
    o.push('</svg>'); return o.join('');
  }
  function chartCsv(spec) {
    var head = ['Label'].concat(spec.series.map(function (s) { return s.name; })).map(function (c) { return csvCell(c, false); }).join(',');
    return [head].concat(spec.labels.map(function (l, i) { return [csvCell(l, false)].concat(spec.series.map(function (s) { return String(s.values[i]); })).join(','); })).join('\r\n') + '\r\n';
  }

  /* ── 7. Code highlighting (small, safe, linear-time) ───────────────────────────────────────────── */
  var KW = {
    js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined',
    py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self print',
    sql: 'select from where group by order having limit offset join left right inner outer full cross on as and or not in is null like ilike between exists union all distinct insert into values update set delete create table alter drop index view case when then else end asc desc with count sum avg min max over partition coalesce cast',
    sh: 'if then else elif fi for while do done case esac function in echo export local return exit cd ls grep sed awk cat curl git npm pip sudo',
    cl: 'abstract bool boolean break case catch char class const continue default do double else enum extends final finally float for func if implements import in int interface let long namespace new nil null package private protected public return short static string struct super switch this throw throws try type typeof using var void while fn pub mut match impl use mod self true false',
    css: '', yaml: 'true false null yes no', json: 'true false null'
  };
  function family(lang) {
    lang = String(lang || '').toLowerCase();
    if (/^(js|jsx|javascript|node|ts|tsx|typescript|mjs)$/.test(lang)) return 'js';
    if (/^(py|python)$/.test(lang)) return 'py'; if (/^(sql|postgres|postgresql|mysql|plsql|sqlite)$/.test(lang)) return 'sql';
    if (/^(sh|bash|shell|zsh|powershell|ps1|dockerfile)$/.test(lang)) return 'sh'; if (lang === 'json') return 'json';
    if (/^(css|scss|less)$/.test(lang)) return 'css'; if (/^(html|xml|svg|htm)$/.test(lang)) return 'markup'; if (/^(yaml|yml|toml|ini)$/.test(lang)) return 'yaml';
    if (/^(java|c|cpp|c\+\+|csharp|c#|cs|go|golang|rust|rs|php|kotlin|swift|ruby|rb|r)$/.test(lang)) return 'cl';
    return 'text';
  }
  var HL = {};
  function hlRe(fam) {
    if (HL[fam]) return HL[fam];
    var str = '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'', num = '\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b', kw = KW[fam] ? '\\b(?:' + KW[fam].split(' ').join('|') + ')\\b' : null, src;
    if (fam === 'markup') src = '(<!--[\\s\\S]*?-->)|(' + str + ')|(<\\/?[A-Za-z][\\w:-]*|\\/?>)|([\\w:-]+(?=\\s*=))|((?!))';
    else if (fam === 'json') src = '((?!))|("(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:))|(' + str + ')|(' + num + ')|(\\b(?:true|false|null)\\b)';
    else {
      var cm = fam === 'py' || fam === 'sh' || fam === 'yaml' ? '#[^\\n]*' : fam === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' : fam === 'css' ? '\\/\\*[\\s\\S]*?\\*\\/' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
      var strs = (fam === 'js' ? '`(?:\\\\.|[^`\\\\])*`|' : '') + (fam === 'py' ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|' : '') + str;
      src = '(' + cm + ')|(' + strs + ')|(' + num + ')|(' + (kw || '(?!)') + ')|((?!))';
    }
    return (HL[fam] = new RegExp(src, fam === 'sql' ? 'gi' : 'g'));
  }
  function highlight(code, lang) {
    code = String(code == null ? '' : code); var fam = family(lang);
    if (fam === 'text' || code.length > 150000) return esc(code);
    var re = new RegExp(hlRe(fam).source, hlRe(fam).flags), out = '', last = 0, m, cls;
    while ((m = re.exec(code))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (fam === 'markup') cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : m[4] ? 'n' : '';
      else if (fam === 'json') cls = m[2] ? 'n' : m[3] ? 's' : m[4] ? 'v' : m[5] ? 'k' : '';
      else cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'v' : m[4] ? 'k' : '';
      if (!cls) continue;
      out += esc(code.slice(last, m.index)) + '<span class="aart-hl-' + cls + '">' + esc(m[0]) + '</span>'; last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }

  /* ── 8. Version diff ───────────────────────────────────────────────────────────────────────────── */
  function lineDiff(a, b) {
    var A = String(a).split('\n'), B = String(b).split('\n'), s = 0;
    while (s < A.length && s < B.length && A[s] === B[s]) s++;
    var ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    var a2 = A.slice(s, ea), b2 = B.slice(s, eb), n = a2.length, m = b2.length, ops = [], i, j;
    for (i = 0; i < s; i++) ops.push({ t: '=', s: A[i] });
    if (n * m > 3000000) { a2.forEach(function (x) { ops.push({ t: '-', s: x }); }); b2.forEach(function (x) { ops.push({ t: '+', s: x }); }); }
    else {
      var W = m + 1, T = new Int32Array((n + 1) * W);
      for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) T[i * W + j] = a2[i] === b2[j] ? T[(i + 1) * W + j + 1] + 1 : Math.max(T[(i + 1) * W + j], T[i * W + j + 1]);
      i = 0; j = 0;
      while (i < n && j < m) { if (a2[i] === b2[j]) { ops.push({ t: '=', s: a2[i] }); i++; j++; } else if (T[(i + 1) * W + j] >= T[i * W + j + 1]) { ops.push({ t: '-', s: a2[i++] }); } else { ops.push({ t: '+', s: b2[j++] }); } }
      while (i < n) ops.push({ t: '-', s: a2[i++] }); while (j < m) ops.push({ t: '+', s: b2[j++] });
    }
    for (i = ea; i < A.length; i++) ops.push({ t: '=', s: A[i] });
    var add = 0, del = 0; ops.forEach(function (o) { if (o.t === '+') add++; else if (o.t === '-') del++; });
    return { ops: ops, added: add, removed: del };
  }
  function diffHtml(d) {
    if (!d.added && !d.removed) return '<div class="aart-empty"><b>No changes</b>These two versions are identical.</div>';
    var out = [], ops = d.ops, ctx = 3, keep = new Array(ops.length), i, k;
    for (i = 0; i < ops.length; i++) if (ops[i].t !== '=') for (k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true;
    var ln = 0, rn = 0, skipped = 0;
    ops.forEach(function (o, idx) {
      if (o.t !== '+') ln++; if (o.t !== '-') rn++;
      if (!keep[idx]) { skipped++; return; }
      if (skipped) { out.push('<div class="aart-df gap"><span class="g"></span><span class="g"></span><code>… ' + skipped + ' unchanged line' + (skipped === 1 ? '' : 's') + '</code></div>'); skipped = 0; }
      out.push('<div class="aart-df ' + (o.t === '+' ? 'add' : o.t === '-' ? 'del' : 'eq') + '"><span class="g">' + (o.t === '+' ? '' : ln) + '</span><span class="g">' + (o.t === '-' ? '' : rn) + '</span><code>' + (o.t === '+' ? '+ ' : o.t === '-' ? '− ' : '  ') + esc(o.s || ' ') + '</code></div>');
    });
    if (skipped) out.push('<div class="aart-df gap"><span class="g"></span><span class="g"></span><code>… ' + skipped + ' unchanged line' + (skipped === 1 ? '' : 's') + '</code></div>');
    return '<div class="aart-diff" role="region" aria-label="Changes" tabindex="0">' + out.join('') + '</div>';
  }

  /* ── 9. Sandboxed web pages, exports ───────────────────────────────────────────────────────────── */
  var SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
  function sandboxDoc(html) {
    html = String(html || '').replace(/^\uFEFF/, '').replace(/<!doctype[^>]*>/i, '');
    return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + SANDBOX_CSP + '"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + html;
  }
  function fullPageDoc(html, title) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title || 'Artifact') + '</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe sandbox="allow-scripts allow-modals" referrerpolicy="no-referrer" srcdoc="' + String(sandboxDoc(html)).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></iframe></body></html>';
  }
  var DOC_CSS = 'body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",Roboto,sans-serif;color:#1c1c1e;max-width:780px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.25;margin:1.6em 0 .5em}h1{font-size:28px}h2{font-size:21px;border-bottom:1px solid #e5e5ea;padding-bottom:.25em}h3{font-size:17px}table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px}th,td{border:1px solid #d1d1d6;padding:7px 10px;text-align:left}th{background:#f2f2f7}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f2f2f7;border-radius:6px}code{padding:1px 5px}pre{padding:12px 14px;overflow:auto}pre code{padding:0;background:none}blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid #c7c7cc;color:#48484a}a{color:#0a63d6}';
  function docHtmlFile(title, bodyHtml) { return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' + DOC_CSS + '</style></head><body>' + bodyHtml + '</body></html>'; }
  function wordFile(title, bodyHtml) { return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + esc(title) + '</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]--><style>' + DOC_CSS.replace('max-width:780px;margin:40px auto;', '') + '</style></head><body>' + bodyHtml + '</body></html>'; }
  function cleanMd(html) {
    return String(html).replace(/<p><\/p>/g, '').replace(/<p>(?=<(?:h2|h3|ul|ol|aside|div|pre|hr)\b)/g, '').replace(/(<\/(?:h2|h3|ul|ol|aside|div|pre)>|<hr\/>)<\/p>/g, '$1').replace(/<p><\/p>/g, '');
  }
  function metaOf(it, v) {
    v = v || latest(it); var c = v.content, t = it.type, bits = [TYPES[t].label];
    if (t === 'document') bits.push(words(c).toLocaleString('en-US') + ' words');
    else if (t === 'table') { var m = tableModel(c); bits.push(m.total.toLocaleString('en-US') + ' rows × ' + m.cols.length + ' cols'); }
    else if (t === 'chart') { var cs = chartSpec(c); bits.push(cs.ok ? cs.spec.type + ' · ' + cs.spec.labels.length + ' points' : 'needs fixing'); }
    else if (t === 'code') bits.push((it.lang ? it.lang + ' · ' : '') + lines(c) + ' lines');
    else bits.push(fmtBytes(c.length));
    return bits;
  }
  var DOC_ICON = '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h4"/>';
  var ICONS = {
    document: DOC_ICON, html: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>', svg: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m21 16-5-5-8 8"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>', chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="8" y="11" width="3" height="6" rx=".8"/><rect x="13" y="7" width="3" height="10" rx=".8"/>', code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'
  };
  function icon(type, size) { return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[type] || DOC_ICON) + '</svg>'; }

  /* ── 10. The panel ─────────────────────────────────────────────────────────────────────────────── */
  var CTX = null, UI = null, prefs = { autoOpen: true };
  try { var sp = storage() && JSON.parse(storage().getItem(PREF_KEY) || 'null'); if (sp && typeof sp === 'object') prefs.autoOpen = sp.autoOpen !== false; } catch (e) {}
  function savePrefs() { try { storage() && storage().setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function toast(m) { if (CTX && CTX.toast) CTX.toast(m); else if (root.showToast) root.showToast(m); }
  function saveBlob(name, blob) {
    var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2500);
  }
  function saveText(name, text, mime) { saveBlob(name, new Blob([text], { type: mime || 'text/plain;charset=utf-8' })); }
  function copyText(text) {
    if (CTX && CTX.copy) return CTX.copy(text);
    if (root.navigator && navigator.clipboard) return navigator.clipboard.writeText(text).then(function () { toast('Copied.'); }, function () { toast('Copy was blocked by the browser.'); });
  }
  function svgSize(svg) { var m = /viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg), w = /\swidth="([\d.]+)(?:px)?"/.exec(svg), h = /\sheight="([\d.]+)(?:px)?"/.exec(svg); return { w: m ? +m[1] : (w ? +w[1] : 800), h: m ? +m[2] : (h ? +h[1] : 600) }; }
  function svgToPng(svg, scale) {
    return new Promise(function (res, rej) {
      var sz = svgSize(svg), img = new Image(), k = scale || 2;
      if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      img.onload = function () { var c = document.createElement('canvas'); c.width = Math.round(sz.w * k); c.height = Math.round(sz.h * k); var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); c.toBlob(function (b) { b ? res(b) : rej(new Error('PNG export failed')); }, 'image/png'); };
      img.onerror = function () { rej(new Error('The image could not be drawn.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  function printHtml(title, body, css) {
    var f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    var links = [].map.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) { return '<link rel="stylesheet" href="' + esc(l.href) + '">'; }).join('');
    f.srcdoc = '<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' + links + '<style>' + DOC_CSS + (css || '') + '@media print{body{margin:0;max-width:none}}</style></head><body>' + body + '</body></html>';
    f.onload = function () { setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Printing is not available here.'); } setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 2000); }, 300); };
    document.body.appendChild(f);
  }

  function cardHtml(aid, n) {
    var it = get(aid); if (!it) return '<div class="aart-card gone"><span class="aart-ic" data-t="document">' + icon('document') + '</span><span class="aart-tx"><b>Artifact no longer available</b><small>It was deleted from the library.</small></span></div>';
    var v = version(it, n) || latest(it), meta = metaOf(it, v), isLatest = v.n === latest(it).n;
    return '<div class="aart-card" data-t="' + it.type + '"><button type="button" class="aart-card-main" data-act="art-open" data-aid="' + it.id + '" data-n="' + v.n + '" aria-label="Open ' + esc(it.title) + '">' +
      '<span class="aart-ic" data-t="' + it.type + '">' + icon(it.type, 20) + '</span><span class="aart-tx"><b>' + esc(it.title) + '</b><small>' + esc(meta.join(' · ')) + ' · v' + v.n + (isLatest ? '' : ' (earlier)') + (v.by === 'you' ? ' · edited by you' : '') + '</small></span><span class="aart-go">Open</span></button>' +
      '<span class="aart-card-tools"><button type="button" data-act="art-copy" data-aid="' + it.id + '" data-n="' + v.n + '" title="Copy content">Copy</button><button type="button" data-act="art-dl" data-aid="' + it.id + '" data-n="' + v.n + '" title="Download">Download</button></span></div>';
  }
  function inject(html) {
    return String(html).replace(/(?:<p>)?\s*\[\[artifact:([A-Za-z0-9_-]+):(\d+)\]\]\s*(?:<\/p>)?/g, function (_, aid, n) { return cardHtml(aid, +n); });
  }

  function mount(ctx) {
    if (UI) return UI; CTX = ctx;
    var host = ctx.root, S = { open: false, mode: 'view', aid: null, n: null, tab: 'preview', edit: false, draft: '', note: '', q: '', filter: 'all', tq: '', tsort: -1, tdir: 1, totals: false, stats: false, limit: 300, device: 'desktop', ctype: null, hid: [], zoom: 'fit', wrap: false, menu: null, ask: '', del: null, fs: false, railWas: null };
    var panel = document.createElement('aside'); panel.className = 'aiw-art'; panel.id = 'aiwArt'; panel.setAttribute('aria-label', 'Artifact');
    panel.innerHTML = '<div class="aart-resize" id="aartResize" role="separator" aria-orientation="vertical" aria-label="Resize artifact panel" tabindex="0"></div><div class="aart-in" id="aartIn"></div>';
    ctx.body.appendChild(panel); host.dataset.art = 'closed';
    try { var w = parseInt(storage() && storage().getItem(WIDTH_KEY), 10); if (w >= 380 && w <= 1100) host.style.setProperty('--aiw-art', w + 'px'); } catch (e) {}
    var IN = panel.querySelector('#aartIn');

    function cur() { var it = get(S.aid); if (!it) return null; var v = version(it, S.n) || latest(it); return { it: it, v: v, last: v.n === latest(it).n, idx: it.versions.indexOf(v) }; }
    function iconBtn(a, label, svg, extra) { return '<button type="button" class="aart-ib' + (extra && extra.on ? ' on' : '') + '" data-a="' + a + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"' + (extra && extra.on != null ? ' aria-pressed="' + (extra.on ? 'true' : 'false') + '"' : '') + '>' + svg + '</button>'; }
    var I = {
      close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      lib: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/></svg>',
      fs: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
      pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
      caret: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
    };

    /* ── stage renderers ── */
    function codeBlock(text, lang, wrap) {
      var n = lines(text), gut = ''; if (!wrap) { for (var i = 1; i <= n; i++) gut += i + '\n'; }
      return '<div class="aart-codewrap' + (wrap ? ' wrap' : '') + '">' + (wrap ? '' : '<div class="aart-gut" aria-hidden="true">' + gut + '</div>') + '<pre class="aart-code" tabindex="0"><code>' + highlight(text, lang) + '</code></pre></div>';
    }
    function docBody(c) { var md = ctx.renderMarkdown; return '<div class="ai-embed-content aart-doc"><p>' + cleanMd(md ? md(c.v.content, false) : esc(c.v.content)) + '</p></div>'; }
    function stageHtml(c) {
      var t = c.it.type, v = c.v;
      if (S.edit) return '<div class="aart-edit"><textarea id="aartEdit" spellcheck="false" aria-label="Edit ' + esc(c.it.title) + '">' + esc(S.draft) + '</textarea><div class="aart-edit-bar"><input id="aartNote" type="text" maxlength="120" placeholder="What did you change? (optional)" value="' + esc(S.note) + '"/><button type="button" class="aart-btn" data-a="cancel">Cancel</button><button type="button" class="aart-btn primary" data-a="save">Save as v' + c.it.next + '</button></div></div>';
      if (S.tab === 'changes') {
        var prev = c.idx > 0 ? c.it.versions[c.idx - 1] : null;
        if (!prev) return '<div class="aart-empty"><b>This is the first version</b>Later versions can be compared here.</div>';
        var d = lineDiff(prev.content, v.content);
        return '<div class="aart-diffhead"><b>v' + prev.n + ' → v' + v.n + '</b><span class="add">+' + d.added + '</span><span class="del">−' + d.removed + '</span> lines</div>' + diffHtml(d);
      }
      if (S.tab === 'source' && t !== 'code') return codeBlock(v.content, t === 'document' ? 'md' : t === 'html' ? 'html' : t === 'svg' ? 'svg' : t === 'chart' ? 'json' : 'text', S.wrap);
      if (t === 'document') return docBody(c);
      if (t === 'code') return codeBlock(v.content, c.it.lang, S.wrap);
      if (t === 'html') return '<div class="aart-note"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg> Sandboxed preview — no network, no access to your DashView data.</div><div class="aart-devs" role="group" aria-label="Preview size">' + [['phone', 'Phone'], ['tablet', 'Tablet'], ['desktop', 'Desktop']].map(function (d) { return '<button type="button" data-a="device" data-d="' + d[0] + '" class="' + (S.device === d[0] ? 'on' : '') + '">' + d[1] + '</button>'; }).join('') + '<button type="button" data-a="reload" class="rl">Reload</button></div><div class="aart-framebox" data-device="' + S.device + '"><iframe class="aart-frame" title="' + esc(c.it.title) + '" sandbox="allow-scripts allow-modals" referrerpolicy="no-referrer"></iframe></div>';
      if (t === 'svg') return '<div class="aart-zoom" role="group" aria-label="Zoom">' + [['fit', 'Fit'], ['1', '100%'], ['2', '200%']].map(function (z) { return '<button type="button" data-a="zoom" data-z="' + z[0] + '" class="' + (S.zoom === z[0] ? 'on' : '') + '">' + z[1] + '</button>'; }).join('') + '</div><div class="aart-imgbox z' + S.zoom + '"><img alt="' + esc(c.it.title) + '" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(v.content.replace(/<script[\s\S]*?<\/script>/gi, '')) + '"/></div>';
      if (t === 'table') {
        var m = tableModel(v.content); if (!m.cols.length) return '<div class="aart-empty"><b>This table is empty</b>Ask the assistant to fill it in.</div>';
        var tv = tableHtml(m, { q: S.tq, sort: S.tsort, dir: S.tdir, totals: S.totals }, S.limit);
        var st = S.stats ? statsHtml(m) : '';
        return '<div class="aart-ttool"><input type="search" id="aartTq" placeholder="Search rows" value="' + esc(S.tq) + '" aria-label="Search rows"/><label class="aart-chk"><input type="checkbox" data-a="ttotals"' + (S.totals ? ' checked' : '') + '/> Totals</label><label class="aart-chk"><input type="checkbox" data-a="tstats"' + (S.stats ? ' checked' : '') + '/> Column stats</label><span class="aart-tcount" id="aartTc">' + tv.total.toLocaleString('en-US') + ' of ' + m.total.toLocaleString('en-US') + ' rows' + (m.capped ? ' (first 20,000)' : '') + '</span></div>' + st + '<div class="aart-tblwrap" id="aartTbl" role="region" tabindex="0" aria-label="Table">' + tv.html + '</div>' + (tv.shown < tv.total ? '<button type="button" class="aart-more" data-a="tmore">Show ' + Math.min(500, tv.total - tv.shown) + ' more rows</button>' : '');
      }
      if (t === 'chart') {
        var cs = chartSpec(v.content); if (!cs.ok) return '<div class="aart-empty err"><b>This chart can’t be drawn</b>' + esc(cs.error) + ' Use Edit to fix the data, or ask the assistant to correct it.</div>';
        var type = S.ctype || cs.spec.type, spec = cs.spec;
        return '<div class="aart-ctool" role="group" aria-label="Chart type">' + [['bar', 'Bars'], ['line', 'Line'], ['area', 'Area'], ['donut', 'Donut']].map(function (k) { return '<button type="button" data-a="ctype" data-t="' + k[0] + '" class="' + (type === k[0] ? 'on' : '') + '">' + k[1] + '</button>'; }).join('') + '</div><div class="aart-chart">' + chartSvg(spec, { type: type, hidden: S.hid }) + '</div>' + (spec.series.length > 1 && type !== 'donut' ? '<div class="aart-legend">' + spec.series.map(function (s, i) { return '<button type="button" data-a="cleg" data-i="' + i + '" class="' + (S.hid.indexOf(i) > -1 ? 'off' : '') + '"><i style="background:' + palette()[i % palette().length] + '"></i>' + esc(s.name) + '</button>'; }).join('') + '</div>' : '') +
          '<details class="aart-data"><summary>Data (' + spec.labels.length + ' rows)</summary><div class="aart-tblwrap">' + (function () { var mm = tableModel(chartCsv(spec)); return tableHtml(mm, {}, 200).html; })() + '</div></details>';
      }
      return '';
    }
    function statsHtml(m) {
      var rows = columnStats(m).map(function (s) { return '<tr><th scope="row">' + esc(s.name) + '</th><td>' + s.type + '</td><td class="num">' + s.filled + '</td><td class="num">' + s.empty + '</td><td class="num">' + s.unique + '</td>' + (s.type === 'num' ? '<td class="num">' + esc(fmtNum(s.sum)) + '</td><td class="num">' + esc(fmtNum(s.avg)) + '</td><td class="num">' + esc(fmtNum(s.min)) + '</td><td class="num">' + esc(fmtNum(s.max)) + '</td>' : '<td colspan="4"></td>') + '</tr>'; }).join('');
      return '<div class="aart-tblwrap aart-stats"><table class="aart-tbl"><thead><tr><th>Column</th><th>Type</th><th class="num">Filled</th><th class="num">Empty</th><th class="num">Unique</th><th class="num">Sum</th><th class="num">Average</th><th class="num">Min</th><th class="num">Max</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    function menuHtml(c) {
      if (S.menu === 'dl') return '<div class="aart-menu" role="menu">' + dlFormats(c.it).map(function (f) { return '<button type="button" role="menuitem" data-a="dl" data-f="' + f[0] + '"><b>' + f[1] + '</b><small>' + f[2] + '</small></button>'; }).join('') + '</div>';
      if (S.menu === 'ver') return '<div class="aart-menu ver" role="menu">' + c.it.versions.slice().reverse().map(function (v) { return '<button type="button" role="menuitem" data-a="verpick" data-n="' + v.n + '" class="' + (v.n === c.v.n ? 'on' : '') + '"><b>v' + v.n + (v.n === latest(c.it).n ? ' · latest' : '') + '</b><small>' + (v.by === 'you' ? 'You' : 'Assistant') + ' · ' + relTime(v.t) + (v.note ? ' · ' + esc(v.note) : v.source ? ' · ' + esc(v.source) : '') + '</small></button>'; }).join('') + '</div>';
      return '';
    }
    function dlFormats(it) {
      var t = it.type;
      if (t === 'document') return [['md', 'Markdown (.md)', 'Plain text with formatting'], ['html', 'Web page (.html)', 'Opens in any browser'], ['doc', 'Word (.doc)', 'Opens in Word and Google Docs'], ['pdf', 'PDF', 'Use Save as PDF in the print window'], ['txt', 'Text (.txt)', 'No formatting']];
      if (t === 'html') return [['html', 'Web page (.html)', 'Single self-contained file']];
      if (t === 'svg') return [['svg', 'SVG (.svg)', 'Scalable vector image'], ['png', 'PNG (.png)', '2× resolution']];
      if (t === 'table') return [['csv', 'CSV (.csv)', 'Formulas are neutralised'], ['xlsx', 'Excel (.xlsx)', 'Numbers stay numbers'], ['json', 'JSON (.json)', 'One object per row'], ['md', 'Markdown table', 'Copy into notes or docs']];
      if (t === 'chart') return [['png', 'PNG (.png)', '2× resolution'], ['svg', 'SVG (.svg)', 'Scalable vector image'], ['csv', 'Data (.csv)', 'Labels and series'], ['json', 'Chart spec (.json)', 'Re-importable']];
      return [['native', 'Source file (.' + fileExt(it) + ')', it.lang || 'Plain text'], ['txt', 'Text (.txt)', 'Plain text']];
    }

    /* ── paint ── */
    function paint() {
      if (S.mode === 'lib') return paintLib();
      var c = cur(); if (!c) { S.mode = 'lib'; return paintLib(); }
      var it = c.it, multi = it.versions.length > 1, canTabs = it.type !== 'code', t = it.type;
      var head = '<header class="aart-head"><span class="aart-ic" data-t="' + t + '">' + icon(t, 18) + '</span><div class="aart-titlebox"><input class="aart-title" id="aartTitle" value="' + esc(it.title) + '" maxlength="90" aria-label="Artifact title" spellcheck="false"/><div class="aart-meta">' + esc(metaOf(it, c.v).join(' · ')) + (it.chat ? ' · from “' + esc(clip(it.chat, 28)) + '”' : '') + '</div></div>' +
        '<div class="aart-head-r"><span class="aart-menuwrap"><button type="button" class="aart-chip" data-a="menu" data-m="ver" aria-haspopup="menu" aria-expanded="' + (S.menu === 'ver') + '">v' + c.v.n + (multi ? ' of ' + latest(it).n : '') + I.caret + '</button>' + (S.menu === 'ver' ? menuHtml(c) : '') + '</span>' +
        iconBtn('pin', it.pinned ? 'Unpin from the top of the library' : 'Pin to the top of the library', I.pin, { on: it.pinned }) + iconBtn('lib', 'Artifacts library', I.lib) + iconBtn('fs', S.fs ? 'Exit full screen' : 'Full screen', I.fs, { on: S.fs }) + iconBtn('close', 'Close', I.close) + '</div></header>';
      var tabs = canTabs ? '<div class="aart-seg" role="tablist">' + [['preview', 'Preview'], ['source', 'Source']].concat(multi ? [['changes', 'Changes']] : []).map(function (x) { return '<button type="button" role="tab" data-a="tab" data-t="' + x[0] + '" aria-selected="' + (S.tab === x[0] && !S.edit) + '" class="' + (S.tab === x[0] && !S.edit ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' : '<div class="aart-seg" role="tablist">' + [['preview', 'Code']].concat(multi ? [['changes', 'Changes']] : []).map(function (x) { return '<button type="button" role="tab" data-a="tab" data-t="' + x[0] + '" aria-selected="' + (S.tab === x[0] && !S.edit) + '" class="' + (S.tab === x[0] && !S.edit ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
      var bar = '<div class="aart-bar">' + tabs + '<div class="aart-actions"><button type="button" class="aart-btn" data-a="copy">Copy</button><span class="aart-menuwrap"><button type="button" class="aart-btn" data-a="menu" data-m="dl" aria-haspopup="menu" aria-expanded="' + (S.menu === 'dl') + '">Download' + I.caret + '</button>' + (S.menu === 'dl' ? menuHtml(c) : '') + '</span>' +
        (t === 'html' ? '<button type="button" class="aart-btn" data-a="fullpage">Open page</button>' : '') + (t !== 'code' || true ? '<button type="button" class="aart-btn" data-a="print">Print</button>' : '') +
        (t === 'code' || t === 'document' || t === 'html' || t === 'table' || t === 'chart' || t === 'svg' ? '<button type="button" class="aart-btn" data-a="wrap"' + (S.tab === 'source' || t === 'code' ? '' : ' hidden') + '>' + (S.wrap ? 'No wrap' : 'Wrap') + '</button>' : '') +
        '<button type="button" class="aart-btn" data-a="' + (S.edit ? 'cancel' : 'edit') + '">' + (S.edit ? 'Cancel edit' : 'Edit') + '</button></div></div>';
      var banner = !c.last ? '<div class="aart-banner">Viewing <b>v' + c.v.n + '</b> — an earlier version. <button type="button" data-a="restore">Restore as new version</button><button type="button" data-a="latest">Go to latest</button></div>' : (c.v.cut ? '<div class="aart-banner warn">This version was too large and was shortened when saved.</div>' : '');
      var chips = t === 'document' ? ['Make it shorter', 'Add an executive summary', 'Improve the structure'] : t === 'html' ? ['Improve the design', 'Make it responsive', 'Add a chart'] : t === 'table' ? ['Add a totals row', 'Sort by the largest value', 'Add a column'] : t === 'chart' ? ['Use a different chart type', 'Add a title and unit', 'Sort the values'] : ['Add comments', 'Find and fix bugs', 'Make it simpler'];
      var foot = '<footer class="aart-foot"><div class="aart-chips">' + chips.map(function (x) { return '<button type="button" data-a="chip" data-q="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div><div class="aart-ask"><textarea id="aartAsk" rows="1" placeholder="Ask the assistant to change this…" aria-label="Ask for changes">' + esc(S.ask) + '</textarea><button type="button" class="aart-btn primary" data-a="revise">Revise</button></div></footer>';
      IN.innerHTML = head + bar + banner + '<div class="aart-stage" id="aartStage" tabindex="-1">' + stageHtml(c) + '</div>' + foot;
      afterStage(c);
    }
    function afterStage(c) {
      var st = IN.querySelector('#aartStage'); if (!st) return;
      var fr = st.querySelector('.aart-frame'); if (fr) fr.srcdoc = sandboxDoc(c.v.content);
      var ed = st.querySelector('#aartEdit'); if (ed) { ed.focus(); }
      if (c.it.type === 'document' && !S.edit && S.tab === 'preview') {
        var hs = st.querySelectorAll('.aart-doc h2, .aart-doc h3');
        if (hs.length >= 3) {
          var nav = document.createElement('nav'); nav.className = 'aart-toc'; nav.setAttribute('aria-label', 'Contents');
          [].forEach.call(hs, function (h, i) { h.id = 'aart-h' + i; var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-a', 'jump'); b.setAttribute('data-h', h.id); b.textContent = clip(h.textContent, 32); nav.appendChild(b); });
          st.insertBefore(nav, st.firstChild);
        }
      }
    }
    function paintStage() { var c = cur(), st = IN.querySelector('#aartStage'); if (!c || !st) return paint(); st.innerHTML = stageHtml(c); afterStage(c); }

    function paintLib() {
      var all = list(), q = S.q.toLowerCase(), types = ['all'].concat(Object.keys(TYPES));
      var shown = all.filter(function (it) { return (S.filter === 'all' || it.type === S.filter) && (!q || (it.title + ' ' + it.chat + ' ' + TYPES[it.type].label).toLowerCase().indexOf(q) > -1); });
      var counts = {}; all.forEach(function (it) { counts[it.type] = (counts[it.type] || 0) + 1; });
      var rows = shown.map(function (it) {
        var v = latest(it), arm = S.del === it.id;
        return '<div class="aart-row" data-t="' + it.type + '"><button type="button" class="aart-row-main" data-a="open" data-id="' + it.id + '"><span class="aart-ic" data-t="' + it.type + '">' + icon(it.type, 18) + '</span><span class="aart-tx"><b>' + (it.pinned ? '<i class="pin" aria-label="Pinned">★</i> ' : '') + esc(it.title) + '</b><small>' + esc(metaOf(it, v).join(' · ')) + ' · v' + v.n + ' · ' + relTime(it.updated) + (it.chat ? ' · ' + esc(clip(it.chat, 26)) : '') + '</small></span></button>' +
          '<span class="aart-row-tools"><button type="button" data-a="lpin" data-id="' + it.id + '" title="' + (it.pinned ? 'Unpin' : 'Pin') + '" aria-label="' + (it.pinned ? 'Unpin' : 'Pin') + '">' + I.pin + '</button><button type="button" data-a="ldl" data-id="' + it.id + '" title="Download" aria-label="Download">↓</button><button type="button" class="' + (arm ? 'danger' : '') + '" data-a="ldel" data-id="' + it.id + '" title="Delete" aria-label="Delete">' + (arm ? 'Delete?' : '✕') + '</button></span></div>';
      }).join('');
      var empty = !all.length ? '<div class="aart-empty"><b>No artifacts yet</b>Ask the assistant to make something you can keep — it opens here, with every version saved.<div class="aart-try">' + ['Write a one-page summary of this month’s sales as a document', 'Build an interactive HTML dashboard of open quotations', 'Create a receivables aging table I can download as CSV', 'Draw a bar chart of revenue by month this year'].map(function (x) { return '<button type="button" data-a="try" data-q="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div></div>' : (!shown.length ? '<div class="aart-empty"><b>Nothing matches</b>Try another word or type.</div>' : '');
      IN.innerHTML = '<header class="aart-head"><span class="aart-ic" data-t="document">' + I.lib + '</span><div class="aart-titlebox"><div class="aart-title static">Artifacts</div><div class="aart-meta">' + all.length + ' saved · kept in this browser' + (volatile ? ' · <b class="warn">storage full — not saved</b>' : '') + '</div></div><div class="aart-head-r">' + iconBtn('fs', S.fs ? 'Exit full screen' : 'Full screen', I.fs, { on: S.fs }) + iconBtn('close', 'Close', I.close) + '</div></header>' +
        '<div class="aart-bar lib"><input type="search" id="aartLq" placeholder="Search artifacts" value="' + esc(S.q) + '" aria-label="Search artifacts"/></div><div class="aart-filters" role="group" aria-label="Filter by type">' + types.map(function (k) { return '<button type="button" data-a="lfilter" data-t="' + k + '" class="' + (S.filter === k ? 'on' : '') + '">' + (k === 'all' ? 'All' : TYPES[k].plural) + '<em>' + (k === 'all' ? all.length : (counts[k] || 0)) + '</em></button>'; }).join('') + '</div>' +
        '<div class="aart-stage lib" id="aartStage">' + empty + '<div class="aart-rows">' + rows + '</div></div>' +
        '<footer class="aart-foot lib"><label class="aart-chk"><input type="checkbox" data-a="auto"' + (prefs.autoOpen ? ' checked' : '') + '/> Open new artifacts automatically</label><span class="sp"></span><button type="button" class="aart-btn" data-a="lexport">Export all</button><button type="button" class="aart-btn" data-a="limport">Import</button><input type="file" id="aartImp" accept="application/json,.json" hidden/></footer>';
    }

    /* ── actions ── */
    function setOpen(on) {
      S.open = on; host.dataset.art = on ? 'open' : 'closed';
      if (on) { if (ctx.onOpen) ctx.onOpen(); if (window.innerWidth < 1480 && host.dataset.rail === 'open') { S.railWas = 'open'; host.dataset.rail = 'closed'; } }
      else { S.fs = false; panel.classList.remove('aart-fs'); if (S.railWas && window.innerWidth >= 900) host.dataset.rail = 'open'; S.railWas = null; S.menu = null; S.edit = false; }
      if (ctx.onToggle) ctx.onToggle(on);
    }
    function openArt(aid, n) { var it = get(aid); if (!it) { toast('That artifact is no longer in the library.'); return; } S.mode = 'view'; S.aid = aid; S.n = n == null ? latest(it).n : +n; S.tab = 'preview'; S.edit = false; S.menu = null; S.ctype = null; S.hid = []; S.tq = ''; S.tsort = -1; S.limit = 300; S.totals = false; S.stats = false; S.zoom = 'fit'; setOpen(true); paint(); }
    function openLib() { S.mode = 'lib'; S.menu = null; S.edit = false; setOpen(true); paint(); }
    function download(it, v, fmt) {
      var t = it.type, name = function (e) { return fileName(it, e); }, c = v.content;
      try {
        if (t === 'document') {
          if (fmt === 'md') return saveText(name('md'), c, TYPES.document.mime);
          if (fmt === 'txt') return saveText(name('txt'), c.replace(/[*_`#>]/g, ''));
          var body = cleanMd(ctx.renderMarkdown ? '<p>' + ctx.renderMarkdown(c, false) + '</p>' : esc(c));
          if (fmt === 'html') return saveText(name('html'), docHtmlFile(it.title, body), TYPES.html.mime);
          if (fmt === 'doc') return saveText(name('doc'), wordFile(it.title, body), 'application/msword');
          if (fmt === 'pdf') return printHtml(it.title, '<div class="ai-embed-content aart-doc">' + body + '</div>');
        }
        if (t === 'html') return saveText(name('html'), c, TYPES.html.mime);
        if (t === 'svg') { if (fmt === 'png') return svgToPng(c, 2).then(function (b) { saveBlob(name('png'), b); }, function (e) { toast(e.message); }); return saveText(name('svg'), c, TYPES.svg.mime); }
        if (t === 'table') {
          var m = tableModel(c);
          if (fmt === 'csv') return saveText(name('csv'), '\uFEFF' + csvOut(m), TYPES.table.mime);
          if (fmt === 'md') return copyText(mdTable(m));
          if (fmt === 'json') return saveText(name('json'), JSON.stringify(m.rows.map(function (r) { var o = {}; m.cols.forEach(function (col, i) { o[col.name] = col.type === 'num' && parseNum(r[i]) != null ? parseNum(r[i]) : r[i]; }); return o; }), null, 2), TYPES.chart.mime);
          if (fmt === 'xlsx') {
            var X = root.XLSX; if (!X || !X.utils) return toast('The Excel library did not load (offline?). Use CSV instead.');
            var aoa = [m.cols.map(function (x) { return x.name; })].concat(m.rows.map(function (r) { return r.map(function (v2, i) { var n = m.cols[i].type === 'num' ? parseNum(v2) : null; return n != null ? n : (/^[=+\-@]/.test(v2) ? "'" + v2 : v2); }); }));
            var wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), clip(it.title.replace(/[\\/?*[\]:]/g, ' '), 30) || 'Sheet1'); return X.writeFile(wb, name('xlsx'));
          }
        }
        if (t === 'chart') {
          var cs = chartSpec(c); if (!cs.ok) return toast(cs.error);
          if (fmt === 'json') return saveText(name('json'), c, TYPES.chart.mime);
          if (fmt === 'csv') return saveText(name('csv'), '\uFEFF' + chartCsv(cs.spec), TYPES.table.mime);
          var svg = chartSvg(cs.spec, { type: S.ctype || cs.spec.type, hidden: S.hid, standalone: true, colors: palette() });
          if (fmt === 'svg') return saveText(name('svg'), svg, TYPES.svg.mime);
          if (fmt === 'png') return svgToPng(svg, 2).then(function (b) { saveBlob(name('png'), b); }, function (e) { toast(e.message); });
        }
        if (t === 'code') return saveText(name(fmt === 'txt' ? 'txt' : fileExt(it)), c);
      } catch (e) { toast('Download failed: ' + (e && e.message || e)); }
    }
    function printCur(c) {
      var it = c.it, t = it.type, v = c.v;
      if (t === 'html') { var fr = IN.querySelector('.aart-frame'); if (fr && fr.contentWindow) { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast('Printing is not available here.'); } } else toast('Open the preview first.'); return; }
      if (t === 'document') return printHtml(it.title, cleanMd('<div class="ai-embed-content aart-doc"><p>' + (ctx.renderMarkdown ? ctx.renderMarkdown(v.content, false) : esc(v.content)) + '</p></div>'));
      if (t === 'table') { var m = tableModel(v.content); return printHtml(it.title, '<h2>' + esc(it.title) + '</h2>' + tableHtml(m, { q: S.tq, sort: S.tsort, dir: S.tdir, totals: S.totals }, 20000).html, 'body{max-width:none}'); }
      if (t === 'chart') { var cs = chartSpec(v.content); if (!cs.ok) return toast(cs.error); return printHtml(it.title, chartSvg(cs.spec, { type: S.ctype || cs.spec.type, hidden: S.hid, standalone: true, colors: palette() })); }
      if (t === 'svg') return printHtml(it.title, '<img style="max-width:100%" alt="" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(v.content.replace(/<script[\s\S]*?<\/script>/gi, '')) + '"/>');
      return printHtml(it.title, '<pre style="white-space:pre-wrap">' + highlight(v.content, it.lang) + '</pre>');
    }
    function submitRevise(text) {
      var c = cur(); text = String(text || '').trim(); if (!c || !text) return;
      if (ctx.isBusy && ctx.isBusy()) return toast('Wait for the current answer to finish.');
      S.ask = ''; ctx.send('Revise “' + c.it.title + '”: ' + text, { artRef: { aid: c.it.id, n: c.v.n } }); paint();
    }
    function saveEdit() {
      var c = cur(); if (!c) return; var ed = IN.querySelector('#aartEdit'); if (ed) S.draft = ed.value; var nt = IN.querySelector('#aartNote'); if (nt) S.note = nt.value;
      if (S.draft === c.v.content) { toast('Nothing changed.'); S.edit = false; return paint(); }
      var v = addVersion(c.it.id, S.draft, 'you', { note: S.note }); S.edit = false; S.note = ''; S.n = v.n; S.tab = 'preview'; paint(); toast('Saved as v' + v.n + '.');
    }
    function importFile(file) {
      var r = new FileReader(); r.onload = function () { try { var n = importJSON(String(r.result)); toast(n ? n + ' artifact' + (n === 1 ? '' : 's') + ' imported.' : 'No artifacts found in that file.'); } catch (e) { toast(e.message); } paintLib(); }; r.onerror = function () { toast('The file could not be read.'); }; r.readAsText(file);
    }

    panel.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-a]'); if (!b || !panel.contains(b)) { if (S.menu) { S.menu = null; paint(); } return; }
      var a = b.getAttribute('data-a'), c = cur();
      if (a === 'menu') { var m = b.getAttribute('data-m'); S.menu = S.menu === m ? null : m; paint(); e.stopPropagation(); return; }
      if (S.menu && !/^(dl|verpick)$/.test(a)) S.menu = null;
      switch (a) {
        case 'close': setOpen(false); break;
        case 'lib': openLib(); break;
        case 'fs': S.fs = !S.fs; panel.classList.toggle('aart-fs', S.fs); paint(); break;
        case 'pin': if (c) { pin(c.it.id); paint(); } break;
        case 'tab': S.tab = b.getAttribute('data-t'); S.edit = false; paint(); break;
        case 'copy': if (c) copyText(c.v.content); break;
        case 'dl': if (c) { S.menu = null; paint(); download(c.it, c.v, b.getAttribute('data-f')); } break;
        case 'print': if (c) printCur(c); break;
        case 'edit': if (c) { S.edit = true; S.draft = c.v.content; S.note = ''; paint(); } break;
        case 'cancel': S.edit = false; paint(); break;
        case 'save': saveEdit(); break;
        case 'verpick': S.n = +b.getAttribute('data-n'); S.menu = null; S.edit = false; paint(); break;
        case 'restore': if (c) { var v = addVersion(c.it.id, c.v.content, 'you', { note: 'Restored v' + c.v.n }); S.n = v.n; paint(); toast('Restored as v' + v.n + '.'); } break;
        case 'latest': if (c) { S.n = latest(c.it).n; paint(); } break;
        case 'wrap': S.wrap = !S.wrap; paintStage(); b.textContent = S.wrap ? 'No wrap' : 'Wrap'; break;
        case 'device': S.device = b.getAttribute('data-d'); paintStage(); break;
        case 'reload': paintStage(); break;
        case 'zoom': S.zoom = b.getAttribute('data-z'); paintStage(); break;
        case 'fullpage': if (c) { var blob = new Blob([fullPageDoc(c.v.content, c.it.title)], { type: 'text/html' }), url = URL.createObjectURL(blob), w = window.open(url, '_blank', 'noopener'); if (!w) toast('Your browser blocked the new tab. Allow pop-ups for this site.'); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); } break;
        case 'tsort': { var i = +b.getAttribute('data-i'); if (S.tsort === i) S.tdir = -S.tdir; else { S.tsort = i; S.tdir = 1; } paintStage(); break; }
        case 'ttotals': S.totals = b.checked; paintStage(); break;
        case 'tstats': S.stats = b.checked; paintStage(); break;
        case 'tmore': S.limit += 500; paintStage(); break;
        case 'ctype': S.ctype = b.getAttribute('data-t'); paintStage(); break;
        case 'cleg': { var k = +b.getAttribute('data-i'), p = S.hid.indexOf(k); if (p > -1) S.hid.splice(p, 1); else if (c && S.hid.length < chartSpec(c.v.content).spec.series.length - 1) S.hid.push(k); paintStage(); break; }
        case 'jump': { var h = IN.querySelector('#' + b.getAttribute('data-h')); if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
        case 'chip': { var ta = IN.querySelector('#aartAsk'); if (ta) { ta.value = b.getAttribute('data-q'); ta.focus(); S.ask = ta.value; } break; }
        case 'revise': { var ta2 = IN.querySelector('#aartAsk'); submitRevise(ta2 && ta2.value); break; }
        case 'open': openArt(b.getAttribute('data-id')); break;
        case 'lpin': pin(b.getAttribute('data-id')); paintLib(); break;
        case 'ldl': { var it = get(b.getAttribute('data-id')); if (it) download(it, latest(it), dlFormats(it)[0][0] === 'pdf' ? 'md' : dlFormats(it)[0][0]); break; }
        case 'ldel': { var id = b.getAttribute('data-id'); if (S.del === id) { remove(id); S.del = null; if (S.aid === id) S.aid = null; paintLib(); } else { S.del = id; paintLib(); setTimeout(function () { if (S.del === id) { S.del = null; if (S.mode === 'lib') paintLib(); } }, 3500); } break; }
        case 'lfilter': S.filter = b.getAttribute('data-t'); paintLib(); break;
        case 'auto': prefs.autoOpen = b.checked; savePrefs(); break;
        case 'lexport': saveText('dashview-artifacts-' + new Date().toISOString().slice(0, 10) + '.json', exportAll(), 'application/json'); break;
        case 'limport': { var f = IN.querySelector('#aartImp'); if (f) f.click(); break; }
        case 'try': if (ctx.send && !(ctx.isBusy && ctx.isBusy())) { ctx.send(b.getAttribute('data-q')); } break;
      }
    });
    panel.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'aartTq') { S.tq = t.value; var c = cur(); if (c) { var m = tableModel(c.v.content), tv = tableHtml(m, { q: S.tq, sort: S.tsort, dir: S.tdir, totals: S.totals }, S.limit), w = IN.querySelector('#aartTbl'), tc = IN.querySelector('#aartTc'); if (w) w.innerHTML = tv.html; if (tc) tc.textContent = tv.total.toLocaleString('en-US') + ' of ' + m.total.toLocaleString('en-US') + ' rows'; } }
      else if (t.id === 'aartLq') { S.q = t.value; var pos = t.selectionStart; paintLib(); var n = IN.querySelector('#aartLq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }
      else if (t.id === 'aartAsk') { S.ask = t.value; t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }
      else if (t.id === 'aartEdit') S.draft = t.value;
    });
    panel.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'aartTitle') { var c = cur(); if (c && !rename(c.it.id, t.value)) t.value = c.it.title; else paint(); }
      else if (t.id === 'aartImp' && t.files && t.files[0]) { importFile(t.files[0]); t.value = ''; }
    });
    panel.addEventListener('keydown', function (e) {
      var t = e.target;
      if (e.key === 'Escape') { e.stopPropagation(); if (S.menu) { S.menu = null; paint(); } else if (S.fs) { S.fs = false; panel.classList.remove('aart-fs'); paint(); } else if (S.edit) { S.edit = false; paint(); } else setOpen(false); return; }
      if (t.id === 'aartAsk' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitRevise(t.value); }
      if (t.id === 'aartEdit' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveEdit(); }
      if (t.id === 'aartTitle' && e.key === 'Enter') { e.preventDefault(); t.blur(); }
    });
    document.addEventListener('click', function (e) { if (S.menu && S.open && !panel.contains(e.target)) { S.menu = null; paint(); } });
    /* drag to resize */
    var rz = panel.querySelector('#aartResize'), drag = null;
    function setW(w) { w = Math.max(380, Math.min(1100, Math.round(w))); host.style.setProperty('--aiw-art', w + 'px'); try { storage() && storage().setItem(WIDTH_KEY, String(w)); } catch (e) {} }
    rz.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, w: panel.getBoundingClientRect().width }; try { rz.setPointerCapture(e.pointerId); } catch (x) {} host.classList.add('aart-dragging'); e.preventDefault(); });
    rz.addEventListener('pointermove', function (e) { if (drag) setW(drag.w + (drag.x - e.clientX)); });
    function endDrag() { drag = null; host.classList.remove('aart-dragging'); }
    rz.addEventListener('pointerup', endDrag); rz.addEventListener('pointercancel', endDrag);
    rz.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setW(panel.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 24 : -24)); } });

    function badge() { if (ctx.btn) { var n = count(); ctx.btn.setAttribute('data-n', n ? String(n) : ''); var em = ctx.btn.querySelector('.aart-count'); if (em) { em.textContent = n ? String(n) : ''; em.hidden = !n; } } if (S.open && S.mode === 'lib' && !S.edit) { /* keep typing intact */ } }
    onChange(function () { badge(); });
    if (ctx.btn) ctx.btn.addEventListener('click', function () { if (S.open && S.mode === 'lib') setOpen(false); else openLib(); });
    badge();
    UI = { open: openArt, openLib: openLib, close: function () { setOpen(false); }, isOpen: function () { return S.open; }, current: function () { return S.aid; }, repaint: function () { if (S.open) paint(); }, download: function (aid, n, fmt) { var it = get(aid), v = it && version(it, n); if (it && v) download(it, v, fmt || dlFormats(it)[0][0] === 'pdf' ? 'md' : (fmt || dlFormats(it)[0][0])); } };
    return UI;
  }

  /* chat-side helpers (the cards in messages call these) */
  function openArt(aid, n) { if (UI) UI.open(aid, n); }
  function copyArt(aid, n) { var it = get(aid), v = it && version(it, n); if (v) copyText(v.content); }
  function downloadArt(aid, n) { if (UI) UI.download(aid, n); }
  function autoOpen() { return prefs.autoOpen; }
  function saveText2(tid, p, meta) { var r = upsert(tid, { id: '', type: p.type, lang: p.lang || '', title: p.title, content: p.content }, meta || {}); return r; }

  return {
    TYPES: TYPES, MARK: MARK, parse: parse, ingest: ingest, markersIn: markersIn, plain: plain, expandForExport: expandForExport, historyTexts: historyTexts,
    promptRules: promptRules, wantsArtifact: wantsArtifact, normType: normType,
    get: get, list: list, count: count, latest: latest, version: version, upsert: upsert, create: create, addVersion: addVersion, rename: rename, pin: pin, remove: remove, exportAll: exportAll, importJSON: importJSON,
    onChange: onChange, flush: flush, isVolatile: function () { return volatile; }, _reset: function () { DB = null; listeners = []; },
    csvParse: csvParse, parseNum: parseNum, tableModel: tableModel, columnStats: columnStats, tableView: tableView, csvOut: csvOut, mdTable: mdTable,
    chartSpec: chartSpec, chartSvg: chartSvg, chartCsv: chartCsv, highlight: highlight, lineDiff: lineDiff, diffHtml: diffHtml, sandboxDoc: sandboxDoc, fullPageDoc: fullPageDoc,
    metaOf: metaOf, cardHtml: cardHtml, inject: inject, fileName: fileName, fileExt: fileExt, words: words,
    mount: mount, isPanelOpen: function () { return !!(UI && UI.isOpen()); }, closePanel: function () { if (UI) UI.close(); }, openArt: openArt, copyArt: copyArt, downloadArt: downloadArt, autoOpen: autoOpen, openLibrary: function () { if (UI) UI.openLib(); },
    fromContent: saveText2, SANDBOX_CSP: SANDBOX_CSP
  };
});
