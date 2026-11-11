/* ==========================================================================
   DashView — Tab bar preferences  (js/tabbar-prefs.js)
   Paired with css/tabbar-anchored.css.

   1. Reads the saved tab bar preferences (localStorage "dv-tabbar") and puts them on <html> as
      data-tb-* attributes + CSS variables. This part runs immediately (load the script in <head>)
      so the bar never flashes in the wrong style.
   2. Applies tab order / hidden tabs, auto-hide on scroll and tap haptics to the dock (.dash-nav).
   3. On the dashboard it adds a "Tab bar" card to Settings → Appearance with a live preview.

   It never changes tab logic, ids or events — only how the existing links are shown.
   ========================================================================== */
(function () {
  'use strict';
  var KEY = 'dv-tabbar';
  var root = document.documentElement;

  var DEFAULTS = {
    style: 'anchored',      // anchored | floating   (saved value "telegram" from 2.41.0 is read as anchored)
    labels: 'always',       // always | active | hidden
    indicator: 'pill',      // pill | tint | line | none
    icon: 'md',             // sm | md | lg
    position: 'bottom',     // bottom | top
    blur: 24,               // 0 – 40 px
    opacity: 78,            // 30 – 100 %
    hairline: true,
    color: 'accent',        // accent | neutral
    filled: true,
    badges: 'count',        // count | dot | off
    tags: 'off',            // dot | off   ("New" / "Live")
    settingsTabs: 'match',  // match | capsule   (Settings section tabs follow the tab bar, or keep the capsule)
    haptics: false,
    autohide: false,
    order: [],
    hidden: []
  };
  var ENUM = {
    style: ['anchored', 'floating'], labels: ['always', 'active', 'hidden'], indicator: ['pill', 'tint', 'line', 'none'],
    icon: ['sm', 'md', 'lg'], position: ['bottom', 'top'], color: ['accent', 'neutral'], badges: ['count', 'dot', 'off'], tags: ['dot', 'off'], settingsTabs: ['match', 'capsule']
  };
  var ICON_PX = { sm: 22, md: 25, lg: 29 };
  var LOCKED = { settings: 1 };      // can never be hidden, so nobody locks themselves out

  function clamp(n, lo, hi, dflt) { n = Number(n); return isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; }

  function normalise(raw) {
    var p = {}, k;
    raw = raw && typeof raw === 'object' ? raw : {};
    if (raw.style === 'telegram') raw = Object.assign({}, raw, { style: 'anchored' });   // renamed in 2.42.0; keep saved choices
    for (k in DEFAULTS) p[k] = DEFAULTS[k];
    Object.keys(ENUM).forEach(function (key) { if (ENUM[key].indexOf(raw[key]) > -1) p[key] = raw[key]; });
    p.blur = clamp(raw.blur, 0, 40, DEFAULTS.blur);
    p.opacity = clamp(raw.opacity, 30, 100, DEFAULTS.opacity);
    ['hairline', 'filled', 'haptics', 'autohide'].forEach(function (key) { if (typeof raw[key] === 'boolean') p[key] = raw[key]; });
    p.order = Array.isArray(raw.order) ? raw.order.filter(function (x) { return typeof x === 'string'; }) : [];
    p.hidden = Array.isArray(raw.hidden) ? raw.hidden.filter(function (x) { return typeof x === 'string' && !LOCKED[x]; }) : [];
    return p;
  }
  function load() {
    try { return normalise(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return normalise(null); }
  }
  var prefs = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); return true; } catch (e) { return false; }
  }

  /* ── 1. attributes + variables on <html> (safe to run before the body exists) ─────────────────── */
  function applyAttrs() {
    var s = root.style;
    root.setAttribute('data-tb-style', prefs.style);
    root.setAttribute('data-tb-labels', prefs.labels);
    root.setAttribute('data-tb-ind', prefs.indicator);
    root.setAttribute('data-tb-icon', prefs.icon);
    root.setAttribute('data-tb-pos', prefs.position);
    root.setAttribute('data-tb-color', prefs.color);
    root.setAttribute('data-tb-fill', prefs.filled ? 'on' : 'off');
    root.setAttribute('data-tb-line', prefs.hairline ? 'on' : 'off');
    root.setAttribute('data-tb-badges', prefs.badges);
    root.setAttribute('data-tb-tags', prefs.tags);
    root.setAttribute('data-tb-stg', prefs.settingsTabs);
    var icon = ICON_PX[prefs.icon];
    var itemH = icon + 14 + (prefs.labels === 'hidden' ? 0 : 17);
    s.setProperty('--tb2-icon', icon + 'px');
    s.setProperty('--tb2-item-h', itemH + 'px');
    s.setProperty('--tb2-h', (itemH + 8) + 'px');
    s.setProperty('--tb2-blur', prefs.blur + 'px');
    s.setProperty('--tb2-a', (prefs.opacity / 100).toFixed(2));
  }
  applyAttrs();

  /* ── 2. dock behaviour ──────────────────────────────────────────────────────────────────────── */
  var nav = null, defaultOrder = null, lastY = 0, awayBound = false;

  function keyOf(a) {
    var v = a.getAttribute('data-view');
    if (v) return v;
    var href = a.getAttribute('href') || '';
    var h = href.indexOf('#') > -1 ? href.split('#')[1] : '';
    if (h) return h;
    return (href.split('/').pop() || '').replace(/\.html.*$/, '') || 'tab';
  }
  function labelOf(a) {
    var sp = a.querySelector('span:not(.badge)');
    return (sp ? sp.textContent : a.textContent).replace(/\s+/g, ' ').trim();
  }
  function links() { return nav ? [].slice.call(nav.querySelectorAll('.dash-nav-link')) : []; }

  function applyTabs() {
    if (!nav) return;
    var all = links();
    if (!defaultOrder) defaultOrder = all.map(keyOf);
    var rank = function (k) {
      var i = prefs.order.indexOf(k);
      return i > -1 ? i : 1000 + defaultOrder.indexOf(k);
    };
    var sorted = all.slice().sort(function (a, b) { return rank(keyOf(a)) - rank(keyOf(b)); });
    var changed = sorted.some(function (a, i) { return a !== all[i]; });
    if (changed) sorted.forEach(function (a) { nav.appendChild(a); });
    all.forEach(function (a) {
      var k = keyOf(a);
      a.classList.toggle('tb-off', prefs.hidden.indexOf(k) > -1 && !LOCKED[k]);
      if (!a.getAttribute('title')) a.setAttribute('title', labelOf(a));
    });
    refreshLayout();
  }
  function refreshLayout() {          // js/sidebar-dock.js re-places its bead on resize
    requestAnimationFrame(function () { requestAnimationFrame(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }); });
  }

  function bindDock() {
    nav = document.querySelector('.dash-side .dash-nav');
    if (!nav || nav.__tbp) return;
    nav.__tbp = true;
    applyTabs();
    nav.addEventListener('click', function (e) {
      if (!prefs.haptics) return;
      var a = e.target.closest && e.target.closest('.dash-nav-link');
      if (a && navigator.vibrate) { try { navigator.vibrate(8); } catch (x) {} }
    }, true);
    nav.addEventListener('focusin', function () { nav.classList.remove('tb-away'); });
    if (!awayBound) {
      awayBound = true;
      lastY = window.pageYOffset || 0;
      window.addEventListener('scroll', function () {
        if (!nav) return;
        var y = window.pageYOffset || 0, dy = y - lastY;
        if (!prefs.autohide) { nav.classList.remove('tb-away'); lastY = y; return; }
        if (y < 80 || dy < -6) nav.classList.remove('tb-away');
        else if (dy > 8) nav.classList.add('tb-away');
        lastY = y;
      }, { passive: true });
    }
  }


  /* Settings section tabs (Profile, Appearance, Odoo …): full name on hover, and in a scrolling bar the open tab is brought into view */
  function bindSettingsRail() {
    var rail = document.querySelector('#view-settings .stg-rail');
    if (!rail || rail.__tbp) return;
    rail.__tbp = true;
    [].forEach.call(rail.querySelectorAll('.stg-tab'), function (t) {
      if (t.getAttribute('title')) return;
      var l = t.querySelector('span:not(.stg-tab-status)');
      if (l) t.setAttribute('title', l.textContent.replace(/\s+/g, ' ').trim());
    });
    function reveal() {
      if (prefs.style !== 'anchored' || prefs.settingsTabs !== 'match') return;
      var a = rail.querySelector('.stg-tab.active');
      if (!a || !rail.offsetParent || rail.scrollWidth <= rail.clientWidth + 1) return;
      var left = Math.max(0, a.offsetLeft - (rail.clientWidth - a.offsetWidth) / 2);
      try { rail.scrollTo({ left: left, behavior: 'smooth' }); } catch (e) { rail.scrollLeft = left; }
    }
    new MutationObserver(reveal).observe(rail, { attributes: true, subtree: true, attributeFilter: ['class'] });
    reveal();
  }

  /* ── 3. Settings → Appearance → Tab bar ─────────────────────────────────────────────────────── */
  var ui = null;     // refs to the card's pieces
  function toast(m) { if (window.showToast) window.showToast(m); }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var GRIP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  var UP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  var DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  /* a segmented row: id, title, help, options [[value, label], …], getter, setter */
  function segRow(cfg) {
    var row = el('div', 'apr-row' + (cfg.cls ? ' ' + cfg.cls : ''));
    row.innerHTML = '<div class="apr-txt"><b>' + esc(cfg.title) + '</b><span>' + esc(cfg.help) + '</span></div>';
    var seg = el('div', 'pro-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', cfg.title);
    cfg.opts.forEach(function (o) {
      var b = el('button'); b.type = 'button'; b.setAttribute('data-val', String(o[0])); b.setAttribute('role', 'radio'); b.textContent = o[1];
      b.addEventListener('click', function () { cfg.set(o[0]); commit(cfg.toast); });
      seg.appendChild(b);
    });
    row.appendChild(seg);
    row.__sync = function () {
      [].forEach.call(seg.children, function (b) {
        var on = b.getAttribute('data-val') === String(cfg.get());
        b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    };
    return row;
  }
  function toggleRow(cfg) {
    var row = el('div', 'apr-row' + (cfg.cls ? ' ' + cfg.cls : ''));
    row.innerHTML = '<div class="apr-txt"><b>' + esc(cfg.title) + '</b><span>' + esc(cfg.help) + '</span></div>';
    var sw = el('button', 'tbp-sw'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', cfg.title);
    sw.addEventListener('click', function () { cfg.set(!cfg.get()); commit(cfg.toast); });
    row.appendChild(sw);
    row.__sync = function () { sw.setAttribute('aria-checked', cfg.get() ? 'true' : 'false'); };
    return row;
  }
  function rangeRow(cfg) {
    var row = el('div', 'apr-row' + (cfg.cls ? ' ' + cfg.cls : ''));
    row.innerHTML = '<div class="apr-txt"><b>' + esc(cfg.title) + '</b><span>' + esc(cfg.help) + '</span></div>';
    var box = el('div', 'tbp-range'), inp = el('input'), out = el('output');
    inp.type = 'range'; inp.min = cfg.min; inp.max = cfg.max; inp.step = cfg.step || 1; inp.setAttribute('aria-label', cfg.title);
    inp.addEventListener('input', function () { cfg.set(Number(inp.value)); out.textContent = cfg.fmt(Number(inp.value)); applyAttrs(); renderPreview(); });
    inp.addEventListener('change', function () { commit(); });
    box.appendChild(inp); box.appendChild(out); row.appendChild(box);
    row.__sync = function () { inp.value = cfg.get(); out.textContent = cfg.fmt(cfg.get()); };
    return row;
  }

  function commit(msg) {
    prefs = normalise(prefs);
    var ok = save();
    applyAttrs(); applyTabs(); syncUI();
    if (!ok) toast('Could not save the tab bar settings in browser storage');
    else if (msg) toast(msg);
  }

  function currentOrder() {          // every tab key in the order they are shown now
    var all = links();
    return all.map(keyOf);
  }

  function buildCard(panel) {
    if (!panel || panel.querySelector('#tbpCard')) return;
    var card = el('div', 'stg-card tbp-card'); card.id = 'tbpCard';
    card.innerHTML =
      '<div class="stg-card-head"><div class="stg-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="14" width="18" height="6.5" rx="2.2"/><path d="M7.5 17.25h.01M12 17.25h.01M16.5 17.25h.01"/><path d="M5 4.5h14M5 8.5h9"/></svg></div>' +
      '<div class="stg-card-head-text"><h3>Tab bar</h3><p>Change how the navigation bar and the Settings tabs look and behave. Changes apply instantly and are saved on this device.</p></div></div>' +
      '<div class="stg-card-body" id="tbpBody"></div>';
    panel.appendChild(card);
    var body = card.querySelector('#tbpBody');

    /* preview */
    var wrap = el('div', 'tbp-prev-wrap'); wrap.setAttribute('aria-hidden', 'true');
    var page = el('div', 'tbp-prev-page', '<i></i><i></i><i></i>'); wrap.appendChild(page);
    var prev = el('div', 'tbp-prev'); wrap.appendChild(prev);
    body.appendChild(wrap);

    /* style */
    body.appendChild(el('div', 'stg-card-subhead', '<h4>Style</h4><p>Pick the overall look of the bar.</p>'));
    var styleOpts = el('div', 'surface-opts'); styleOpts.setAttribute('role', 'radiogroup'); styleOpts.setAttribute('aria-label', 'Tab bar style');
    [['anchored', 'Anchored bar', 'Full-width bar docked to the screen edge, icon over label, red count badges.'], ['floating', 'Floating capsule', 'The glass pill with a sliding bead.']].forEach(function (o) {
      var b = el('button', 'surface-opt'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-style', o[0]);
      b.innerHTML = '<div class="surface-swatch ' + (o[0] === 'anchored' ? 'flat' : 'glass') + '" aria-hidden="true"></div><b>' + o[1] + '</b><span>' + o[2] + '</span>';
      b.addEventListener('click', function () { prefs.style = o[0]; commit(o[0] === 'anchored' ? 'Anchored tab bar on' : 'Floating tab bar on'); });
      styleOpts.appendChild(b);
    });
    body.appendChild(styleOpts);

    /* Anchored-bar options */
    var an = el('div', 'tbp-an-only'); an.id = 'tbpAn';
    an.appendChild(el('div', 'stg-card-subhead', '<h4>Layout</h4><p class="tbp-sub-x">Labels, icons and where the bar sits.</p>'));
    var rows = [];
    rows.push(segRow({ title: 'Labels', help: 'Show the name under every icon, only under the open tab, or never.', opts: [['always', 'Always'], ['active', 'Active only'], ['hidden', 'Hidden']], get: function () { return prefs.labels; }, set: function (v) { prefs.labels = v; }, toast: 'Labels updated' }));
    rows.push(segRow({ title: 'Icon size', help: 'Small fits more tabs on a phone, large is easier to tap.', opts: [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']], get: function () { return prefs.icon; }, set: function (v) { prefs.icon = v; }, toast: 'Icon size updated' }));
    rows.push(segRow({ title: 'Position', help: 'Dock the bar to the bottom of the screen or under the top bar.', opts: [['bottom', 'Bottom'], ['top', 'Top']], get: function () { return prefs.position; }, set: function (v) { prefs.position = v; }, toast: 'Position updated' }));
    rows.push(segRow({ title: 'Settings tabs', help: 'The section tabs inside Settings (Profile, Appearance, Odoo …) use this same bar look, or keep the glass capsule.', opts: [['match', 'Match tab bar'], ['capsule', 'Capsule']], get: function () { return prefs.settingsTabs; }, set: function (v) { prefs.settingsTabs = v; }, toast: 'Settings tabs updated' }));
    rows.forEach(function (r) { an.appendChild(r); });

    an.appendChild(el('div', 'stg-card-subhead', '<h4>Active tab</h4><p>How the open tab is highlighted.</p>'));
    var rows2 = [];
    rows2.push(segRow({ title: 'Indicator', help: 'Capsule behind the icon, a tinted card that slides, a line on the edge, or colour only.', opts: [['pill', 'Capsule'], ['tint', 'Card'], ['line', 'Line'], ['none', 'None']], get: function () { return prefs.indicator; }, set: function (v) { prefs.indicator = v; }, toast: 'Indicator updated' }));
    rows2.push(segRow({ title: 'Highlight colour', help: 'Follow your accent colour, or use plain white / black.', opts: [['accent', 'Accent'], ['neutral', 'Neutral']], get: function () { return prefs.color; }, set: function (v) { prefs.color = v; }, toast: 'Highlight colour updated' }));
    rows2.push(toggleRow({ title: 'Filled icon', help: 'Fill the icon of the open tab instead of an outline.', get: function () { return prefs.filled; }, set: function (v) { prefs.filled = v; } }));
    rows2.forEach(function (r) { an.appendChild(r); });

    an.appendChild(el('div', 'stg-card-subhead', '<h4>Glass</h4><p>Blur and transparency behind the bar.</p>'));
    var rows3 = [];
    rows3.push(rangeRow({ title: 'Blur', help: 'Frosted-glass blur of the page behind the bar.', min: 0, max: 40, step: 2, get: function () { return prefs.blur; }, set: function (v) { prefs.blur = v; }, fmt: function (v) { return v + ' px'; } }));
    rows3.push(rangeRow({ title: 'Opacity', help: 'Lower is more see-through, 100% is a solid bar.', min: 30, max: 100, step: 2, get: function () { return prefs.opacity; }, set: function (v) { prefs.opacity = v; }, fmt: function (v) { return v + '%'; } }));
    rows3.push(toggleRow({ title: 'Separator line', help: 'A thin line between the bar and the page.', get: function () { return prefs.hairline; }, set: function (v) { prefs.hairline = v; } }));
    rows3.forEach(function (r) { an.appendChild(r); });
    body.appendChild(an);

    /* behaviour (both styles) */
    body.appendChild(el('div', 'stg-card-subhead', '<h4>Badges &amp; behaviour</h4><p>Counts, tags and scrolling.</p>'));
    var rows4 = [];
    rows4.push(segRow({ title: 'Task count badge', help: 'Open task count on Task assignments: a number, a dot, or nothing.', opts: [['count', 'Number'], ['dot', 'Dot'], ['off', 'Off']], get: function () { return prefs.badges; }, set: function (v) { prefs.badges = v; }, toast: 'Badge updated' }));
    rows4.push(segRow({ cls: 'tbp-an-only', title: '"New" and "Live" tags', help: 'Show them as a small green dot on the icon.', opts: [['dot', 'Dot'], ['off', 'Off']], get: function () { return prefs.tags; }, set: function (v) { prefs.tags = v; }, toast: 'Tags updated' }));
    rows4.push(toggleRow({ title: 'Hide while scrolling', help: 'Slide the bar away when you scroll down; it returns when you scroll up.', get: function () { return prefs.autohide; }, set: function (v) { prefs.autohide = v; } }));
    rows4.push(toggleRow({ cls: 'no-border', title: 'Tap feedback', help: 'A short vibration when you tap a tab (phones that support it).', get: function () { return prefs.haptics; }, set: function (v) { prefs.haptics = v; } }));
    rows4.forEach(function (r) { body.appendChild(r); });

    /* tabs list */
    body.appendChild(el('div', 'stg-card-subhead', '<h4>Tabs</h4><p>Drag to reorder (or use the arrows) and switch off the ones you do not need. Settings always stays.</p>'));
    var list = el('ul', 'tbp-list'); list.id = 'tbpList'; body.appendChild(list);

    var actions = el('div', 'tbp-actions');
    var reset = el('button', 'btn btn-ghost'); reset.type = 'button'; reset.textContent = 'Reset tab bar';
    reset.addEventListener('click', function () { prefs = normalise(null); commit('Tab bar reset to default'); });
    actions.appendChild(reset);
    actions.appendChild(el('span', 'tbp-note', 'Saved on this device only.'));
    body.appendChild(actions);

    ui = { card: card, prev: prev, wrap: wrap, styleOpts: styleOpts, list: list, rows: [].concat(rows, rows2, rows3, rows4) };
    syncUI();
  }

  function itemsInfo() {            // [{key,label,svg,badge}] in current order, read from the real dock
    return links().map(function (a) {
      var svg = a.querySelector('svg');
      return { key: keyOf(a), label: labelOf(a), svg: svg ? svg.innerHTML : '', badge: a.id === '' ? null : null, a: a };
    });
  }

  function renderPreview() {
    if (!ui) return;
    var p = ui.prev, floating = prefs.style === 'floating';
    var items = itemsInfo().filter(function (i) { return prefs.hidden.indexOf(i.key) < 0 || i.a.classList.contains('active'); }).slice(0, 5);
    var act = 0;
    items.forEach(function (i, n) { if (i.a.classList.contains('active')) act = n; });
    var icon = ICON_PX[prefs.icon];
    p.className = 'tbp-prev' + (floating ? ' tbp-floating' : '') + (!prefs.hairline ? ' tbp-nline' : '') + (prefs.color === 'neutral' ? ' tbp-neutral' : '') + (!floating && prefs.position === 'top' ? ' tbp-top' : '');
    ui.wrap.classList.toggle('tbp-wtop', !floating && prefs.position === 'top');
    p.setAttribute('data-lb', floating ? 'active' : prefs.labels);
    p.setAttribute('data-ind', floating ? 'tint' : prefs.indicator);
    p.setAttribute('data-bd', prefs.badges);
    p.style.setProperty('--p-icon', (floating ? 22 : icon) + 'px');
    p.style.setProperty('--p-ih', (floating ? 40 : icon + 14 + (prefs.labels === 'hidden' ? 0 : 17)) + 'px');
    p.style.setProperty('--p-a', (prefs.opacity / 100).toFixed(2));
    p.style.setProperty('--p-blur', prefs.blur + 'px');
    p.innerHTML = items.map(function (i, n) {
      var showBadge = i.key === 'task-assignments';
      return '<div class="tbp-pi' + (n === act ? ' on' : '') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + i.svg + '</svg><span>' + esc(i.label) + '</span>' + (showBadge ? '<i class="tbp-pb">3</i>' : '') + '</div>';
    }).join('');
  }

  function renderList() {
    if (!ui) return;
    var info = itemsInfo(), list = ui.list;
    list.innerHTML = '';
    info.forEach(function (it, idx) {
      var off = prefs.hidden.indexOf(it.key) > -1;
      var li = el('li', 'tbp-li' + (off ? ' off' : '')); li.setAttribute('data-key', it.key); li.draggable = true;
      var locked = !!LOCKED[it.key];
      li.innerHTML = '<span class="tbp-grip" aria-hidden="true">' + GRIP + '</span>' +
        '<svg class="tbp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + it.svg + '</svg>' +
        '<span class="tbp-nm">' + esc(it.label) + (locked ? '<small>always shown</small>' : '') + '</span>' +
        '<button type="button" class="tbp-mv" data-mv="-1" aria-label="Move ' + esc(it.label) + ' earlier"' + (idx === 0 ? ' disabled' : '') + '>' + UP + '</button>' +
        '<button type="button" class="tbp-mv" data-mv="1" aria-label="Move ' + esc(it.label) + ' later"' + (idx === info.length - 1 ? ' disabled' : '') + '>' + DOWN + '</button>' +
        '<button type="button" class="tbp-sw" role="switch" aria-checked="' + (off ? 'false' : 'true') + '" aria-label="Show ' + esc(it.label) + ' in the tab bar"' + (locked ? ' disabled' : '') + '></button>';
      list.appendChild(li);
    });
  }

  function move(key, delta) {
    var order = currentOrder(), i = order.indexOf(key), j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    order.splice(j, 0, order.splice(i, 1)[0]);
    prefs.order = order; commit();
  }
  function dropOn(fromKey, toKey, after) {
    if (fromKey === toKey) return;
    var order = currentOrder().filter(function (k) { return k !== fromKey; });
    var at = order.indexOf(toKey) + (after ? 1 : 0);
    order.splice(at, 0, fromKey);
    prefs.order = order; commit();
  }

  function bindList() {
    var list = ui.list, dragKey = null;
    list.addEventListener('click', function (e) {
      var li = e.target.closest('.tbp-li'); if (!li) return;
      var key = li.getAttribute('data-key');
      var mv = e.target.closest('.tbp-mv');
      if (mv) { move(key, Number(mv.getAttribute('data-mv'))); var again = list.querySelector('.tbp-li[data-key="' + key + '"] .tbp-mv[data-mv="' + mv.getAttribute('data-mv') + '"]'); if (again && !again.disabled) again.focus(); return; }
      var sw = e.target.closest('.tbp-sw');
      if (sw && !sw.disabled) {
        var i = prefs.hidden.indexOf(key);
        if (i > -1) prefs.hidden.splice(i, 1); else prefs.hidden.push(key);
        var visible = links().filter(function (a) { return prefs.hidden.indexOf(keyOf(a)) < 0; }).length;
        if (!visible) { prefs.hidden.pop(); return; }
        commit();
      }
    });
    list.addEventListener('dragstart', function (e) {
      var li = e.target.closest && e.target.closest('.tbp-li'); if (!li) return;
      dragKey = li.getAttribute('data-key'); li.classList.add('drag');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragKey); } catch (x) {}
    });
    list.addEventListener('dragover', function (e) {
      if (!dragKey) return;
      var li = e.target.closest && e.target.closest('.tbp-li'); if (!li) return;
      e.preventDefault();
      [].forEach.call(list.children, function (c) { c.classList.toggle('over', c === li && c.getAttribute('data-key') !== dragKey); });
    });
    list.addEventListener('drop', function (e) {
      var li = e.target.closest && e.target.closest('.tbp-li'); if (!li || !dragKey) return;
      e.preventDefault();
      var r = li.getBoundingClientRect();
      dropOn(dragKey, li.getAttribute('data-key'), e.clientY > r.top + r.height / 2);
      dragKey = null;
    });
    list.addEventListener('dragend', function () { dragKey = null; [].forEach.call(list.children, function (c) { c.classList.remove('drag', 'over'); }); });
  }

  function syncUI() {
    if (!ui) return;
    ui.rows.forEach(function (r) { if (r.__sync) r.__sync(); });
    [].forEach.call(ui.styleOpts.children, function (b) {
      var on = b.getAttribute('data-style') === prefs.style;
      b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    ui.card.classList.toggle('tbp-floating', prefs.style === 'floating');
    renderList();
    renderPreview();
  }

  function initSettings() {
    var panel = document.getElementById('stg-appearance');
    if (!panel) return;
    buildCard(panel);
    if (ui && !ui.bound) { ui.bound = true; bindList(); }
  }

  /* ── boot ───────────────────────────────────────────────────────────────────────────────────── */
  function boot() { bindDock(); bindSettingsRail(); initSettings(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', function () { bindDock(); bindSettingsRail(); if (!ui) initSettings(); else syncUI(); });
  document.addEventListener('dv:theme', function () { renderPreview(); });

  /* another tab / the other page (dashboard ↔ people) changed the settings */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    prefs = load(); applyAttrs(); applyTabs(); syncUI();
  });

  window.DashViewTabBar = {
    get: function () { return JSON.parse(JSON.stringify(prefs)); },
    set: function (patch) { prefs = normalise(Object.assign({}, prefs, patch || {})); commit(); },
    reset: function () { prefs = normalise(null); commit(); }
  };
})();
