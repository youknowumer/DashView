/* DashView — bottom glass dock for the dashboard navigation (js/sidebar-dock.js)
   Pure presentation, same idea as js/index-tabbar.js on the landing page:
   · a glass bead slides to the active tab (.dash-nav-link.active, set by the existing shell code)
   · the logo moves into the top bar now that the sidebar is gone
   · the dock scrolls sideways on narrow screens and keeps the active tab in view
   It never changes tab logic, ids or events.

   iOS-style motion (css/sidebar-itb.css):
   · the final geometry of every tab is measured ONCE with invisible probes (label width -> --lw,
     bead x / width), so the bead, the tab padding and the label width all animate on one curve and
     stay in lock-step - no frame-by-frame chasing of a growing tab
   · the bead stretches a little while it travels (longer trip, bigger stretch)
   · a move can be interrupted at any time and retargets smoothly */
(function () {
  'use strict';
  var d = document, nav, bead, mo, links = [], geom = [], lastLeft = null, lastSquish = -1e9, centerTimer = 0, rz = 0;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function list() {
    return [].slice.call(nav.querySelectorAll('.dash-nav-link')).filter(function (a) { return a.offsetParent; });
  }
  function activeIndex() {
    for (var i = 0; i < links.length; i++) if (links[i].classList.contains('active')) return i;
    return -1;
  }

  /* ── geometry ──────────────────────────────────────────────────────────── */
  function fw(el) {                       /* fractional border-box width (offsetWidth rounds) */
    var cs = getComputedStyle(el), w = parseFloat(cs.width) || 0;
    if (cs.boxSizing === 'content-box') {
      w += (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) +
           (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    }
    return w;
  }
  function probe(link, on) {
    var p = link.cloneNode(true);
    p.removeAttribute('href'); p.removeAttribute('id'); p.removeAttribute('data-view'); p.removeAttribute('aria-current'); p.tabIndex = -1;
    [].forEach.call(p.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    p.classList.remove('active');
    if (on) p.classList.add('active');
    p.setAttribute('aria-hidden', 'true');
    p.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;';
    var lab = p.querySelector(':scope > span:not(.badge)');
    if (lab) lab.style.width = 'auto';
    return p;
  }
  function measure() {
    links = list();
    var cs = getComputedStyle(nav), gap = parseFloat(cs.columnGap) || 0, pad = parseFloat(cs.paddingLeft) || 0;
    var small = [], big = [];
    links.forEach(function (a) { var s = probe(a, false), b = probe(a, true); small.push(s); big.push(b); nav.appendChild(s); nav.appendChild(b); });
    var cw = small.map(fw), aw = big.map(fw);
    var lw = big.map(function (b) {
      var l = b.querySelector(':scope > span:not(.badge)');
      return l ? (parseFloat(getComputedStyle(l).width) || 0) : 0;       /* content width of the label */
    });
    small.concat(big).forEach(function (p) { nav.removeChild(p); });
    var x = pad;
    geom = links.map(function (a, i) {
      var g = { x: x, w: aw[i] + .5 };                       /* +.5px: never clip the last glyph */
      x += cw[i] + gap;
      a.style.setProperty('--lw', (lw[i] + .5).toFixed(2) + 'px');
      return g;
    });
  }

  /* a short liquid squish while the bead travels */
  function squish(dist) {
    if (reduce || !bead.animate) return;
    var now = performance.now();
    if (now - lastSquish < 90) return;
    lastSquish = now;
    var k = Math.min(1, dist / 180);
    try {
      bead.animate(
        [{ scale: '1 1' }, { scale: (1 + .11 * k) + ' ' + (1 - .08 * k), offset: .38 }, { scale: '1 1' }],
        { duration: 580, easing: 'cubic-bezier(.3,.6,.3,1)' }
      );
    } catch (e) {}
  }
  function place(snap) {
    var i = activeIndex();
    if (i < 0) { bead.style.width = '0px'; lastLeft = null; return; }
    if (!geom[i]) return;
    var g = geom[i];
    if (!snap && lastLeft !== null && Math.abs(g.x - lastLeft) > 2) squish(Math.abs(g.x - lastLeft));
    bead.style.width = g.w + 'px';
    bead.style.transform = 'translate3d(' + g.x + 'px,0,0)';
    lastLeft = g.x;
  }
  /* re-measure without animating the correction (load, resize, theme / web-font swap) */
  function refresh() {
    if (!nav.getClientRects().length) return;
    nav.classList.add('sdock-quiet');
    measure();
    place(true);
    void nav.offsetWidth;                 /* flush so the corrections apply instantly */
    nav.classList.remove('sdock-quiet');
    if (mo) mo.takeRecords();
  }
  function center() {
    var i = activeIndex(), a = links[i];
    if (!a || nav.scrollWidth <= nav.clientWidth + 1) return;
    var left = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
    try { nav.scrollTo({ left: left, behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { nav.scrollLeft = left; }
  }
  function settle() {
    if (!nav.classList.contains('sdock-ready')) requestAnimationFrame(function () { nav.classList.add('sdock-ready'); });
  }

  /* the existing shell code flips .active on a link: bead + tabs now animate together */
  function onClass(muts) {
    var hit = muts.some(function (m) { return m.target && m.target.classList && m.target.classList.contains('dash-nav-link'); });
    if (!hit) return;
    if (list().length !== geom.length) refresh(); else place();
    clearTimeout(centerTimer);
    centerTimer = setTimeout(center, 600);
  }

  function init() {
    nav = d.querySelector('.dash-side .dash-nav');
    if (!nav || nav.__sdock) return;
    nav.__sdock = true;
    bead = d.createElement('span');
    bead.className = 'sdock-bead';
    bead.setAttribute('aria-hidden', 'true');
    nav.insertBefore(bead, nav.firstChild);

    /* logo + name live in the top bar now */
    var brand = d.querySelector('.dash-side .dash-side-brand'), top = d.querySelector('.dash-topbar');
    if (brand && top) top.insertBefore(brand, top.firstChild);

    mo = new MutationObserver(onClass);
    mo.observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { refresh(); center(); }, 100); });
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { refresh(); settle(); });
    window.addEventListener('load', function () { refresh(); settle(); });
    d.addEventListener('dv:theme', function () { refresh(); });
    refresh();
    settle();
    setTimeout(function () { refresh(); settle(); center(); }, 400);
    setTimeout(function () { nav.classList.add('sdock-live'); }, 900);   /* icon pop only after first paint */
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();
