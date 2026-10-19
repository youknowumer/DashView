/* DashView — landing page glass tab bar (js/index-tabbar.js)
   · click a tab → smooth scroll so the section HEADING sits just under the top bar
   · scroll-spy keeps the active tab in sync; the glass bead slides to it
   · iOS-style motion: geometry is measured once up front, bead and tabs animate on one curve,
     the bead stretches while it travels, the icon pops, the label slides in (css/index-tabbar.css) */
(function () {
  'use strict';
  var d = document, bar = d.getElementById('itb');
  if (!bar) return;
  var tabs = [].slice.call(bar.querySelectorAll('.itb-tab'));
  var bead = bar.querySelector('.itb-bead');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var current = null, lockUntil = 0, anim = 0;

  function target(id) {
    var sec = d.getElementById(id);
    if (!sec) return null;
    if (id === 'top') return null;
    return sec.querySelector('.ig-head, h2, h1') || sec;
  }
  function headerOffset() {
    var n = d.getElementById('nav');
    return (n ? n.offsetHeight : 64) + 24;
  }

  /* ── geometry ──────────────────────────────────────────────────────────────
     The bead has to end exactly under the active tab once its label has opened. Instead of
     chasing the growing tab every frame (layout read + lag), the final geometry of every tab is
     measured ONCE with invisible probes, written to CSS (--lw = label width) and to the bead.
     Bead, tab padding and label width then all animate on the same curve and stay in lock-step. */
  var geom = [], lastLeft = null, lastSquish = -1e9;

  function fw(el) {                       /* fractional border-box width (offsetWidth rounds) */
    var cs = getComputedStyle(el), w = parseFloat(cs.width) || 0;
    if (cs.boxSizing === 'content-box') {
      w += (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) +
           (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    }
    return w;
  }
  function probe(tab, on) {
    var p = tab.cloneNode(true);
    p.removeAttribute('id'); p.removeAttribute('href'); p.removeAttribute('aria-current'); p.tabIndex = -1;
    [].forEach.call(p.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    p.classList.toggle('on', on);
    p.setAttribute('aria-hidden', 'true');
    p.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;';
    var lab = p.querySelector('.itb-lab');
    if (lab) lab.style.width = 'auto';
    return p;
  }
  function measure() {
    var cs = getComputedStyle(bar), gap = parseFloat(cs.columnGap) || 0, pad = parseFloat(cs.paddingLeft) || 0;
    var small = [], big = [];
    tabs.forEach(function (t) { var a = probe(t, false), b = probe(t, true); small.push(a); big.push(b); bar.appendChild(a); bar.appendChild(b); });
    var cw = small.map(fw), aw = big.map(fw);
    var lw = big.map(function (b) { var l = b.querySelector('.itb-lab'); return l ? fw(l) : 0; });
    small.concat(big).forEach(function (p) { bar.removeChild(p); });
    var x = pad;
    geom = tabs.map(function (t, i) {
      var g = { x: x, w: aw[i] + .5 };                       /* +.5px: never clip the last glyph */
      x += cw[i] + gap;
      t.style.setProperty('--lw', (lw[i] + .5).toFixed(2) + 'px');
      return g;
    });
  }
  function activeIndex() {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].classList.contains('on')) return i;
    return -1;
  }
  /* a short liquid squish while the bead travels - longer trip, bigger stretch */
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
    if (i < 0 || !geom[i] || !bead) return;
    var g = geom[i];
    if (!snap && lastLeft !== null && Math.abs(g.x - lastLeft) > 2) squish(Math.abs(g.x - lastLeft));
    bead.style.width = g.w + 'px';
    bead.style.transform = 'translate3d(' + g.x + 'px,0,0)';
    lastLeft = g.x;
  }
  /* re-measure without animating the correction (load, resize, web-font swap) */
  function refresh() {
    if (!bar.getClientRects().length) return;
    bar.classList.add('quiet');
    measure();
    place(true);
    void bar.offsetWidth;                /* flush so the corrections apply instantly */
    bar.classList.remove('quiet');
  }
  function settle() {
    if (!bar.classList.contains('ready')) requestAnimationFrame(function () { bar.classList.add('ready'); });
  }
  function setActive(id) {
    if (id === current) return;
    current = id;
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-id') === id;
      t.classList.toggle('on', on);
      if (on) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
    });
    place();                             /* bead + tabs now animate together on the same curve */
  }

  function ease(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function scrollToId(id) {
    var el = target(id);
    var root = d.documentElement;
    function layoutTop(n) { /* offsetTop chain: ignores reveal transforms, so the landing spot is exact */
      var y = 0;
      while (n) { y += n.offsetTop; n = n.offsetParent; }
      return y;
    }
    function goal() {
      var y = el ? layoutTop(el) - headerOffset() : 0;
      return Math.max(0, Math.min(y, root.scrollHeight - innerHeight));
    }
    cancelAnimationFrame(anim);
    var from = window.pageYOffset || root.scrollTop, dist = goal() - from;
    lockUntil = performance.now() + 1500;
    if (reduce || Math.abs(dist) < 2) { window.scrollTo(0, goal()); return; }
    var dur = Math.min(1100, 420 + Math.abs(dist) * .3), t0 = null;
    (function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min((t - t0) / dur, 1), g = goal();
      window.scrollTo(0, from + (g - from) * ease(p));
      lockUntil = performance.now() + 300;
      if (p < 1) anim = requestAnimationFrame(step);
    })(performance.now());
  }
  ['wheel', 'touchstart', 'keydown'].forEach(function (ev) {
    addEventListener(ev, function () { cancelAnimationFrame(anim); lockUntil = 0; }, { passive: true });
  });

  bar.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.itb-tab');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();           /* keep the page-wide anchor handler out of it */
    var id = a.getAttribute('data-id');
    setActive(id);
    scrollToId(id);
    try { history.replaceState(null, '', id === 'top' ? location.pathname + location.search : '#' + id); } catch (x) {}
  });

  /* scroll-spy: the last section whose heading has passed the reading line */
  var order = tabs.map(function (t) { return t.getAttribute('data-id'); });
  function spy() {
    if (performance.now() < lockUntil) return;
    var line = headerOffset() + innerHeight * .18, found = 'top', best = -Infinity;
    var atEnd = innerHeight + (window.pageYOffset || 0) >= d.documentElement.scrollHeight - 4;
    order.forEach(function (id) {
      if (id === 'top') return;
      var el = d.getElementById(id);
      if (!el) return;
      var top = el.getBoundingClientRect().top;
      if (top <= line && top > best) { best = top; found = id; }
    });
    if (atEnd) found = order[order.length - 1];
    setActive(found);
  }
  var tick = false;
  addEventListener('scroll', function () {
    if (tick) return; tick = true;
    requestAnimationFrame(function () { tick = false; spy(); });
  }, { passive: true });
  var rz = 0;
  addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(refresh, 100); });
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(refresh);

  /* initial state: honour a #hash, otherwise wherever the page is */
  var h = (location.hash || '').slice(1);
  spy();
  if (h && order.indexOf(h) > -1 && d.getElementById(h)) {
    setActive(h);
    setTimeout(function () { scrollToId(h); }, 350);
  }
  refresh();
  settle();
  setTimeout(function () { refresh(); settle(); }, 400);
  setTimeout(function () { bar.classList.add('live'); }, 900);   /* icon pop only after first paint */
})();
