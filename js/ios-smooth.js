/* DashView — iOS-style smoothness (js/ios-smooth.js · v2.26). Loaded on every page, after the page's own scripts.
   1. device flags on <html>:  ios · ios-touch · ios-lite (low-power) · ios-landing
   2. EVERY page: eased mouse-wheel scrolling (desktop mouse only — trackpads, touch and keyboard stay native). It scrolls the
      scroll area under the pointer (page, dashboard panel, table, drawer), hands over to the next one at the end like iOS, and
      backs off for dialogs, reduced motion and anything the browser should handle itself.
   3. landing page: stops effects that cannot be seen (hero scrolled away, tab hidden)
   Opt out:  <html data-smooth-scroll="off">  (or the OS "reduce motion" setting).
   Pure enhancement: if anything here is missing or throws, the page behaves exactly as before. */
(function () {
  'use strict';
  var d = document, de = d.documentElement, w = window;
  var mm = function (q) { try { return w.matchMedia && w.matchMedia(q).matches; } catch (e) { return false; } };
  var reduce = mm('(prefers-reduced-motion: reduce)') || de.hasAttribute('data-reduce-motion');
  var ua = navigator.userAgent || '';
  var isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var touch = mm('(hover: none)') || mm('(pointer: coarse)');
  var lite = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    (navigator.connection && navigator.connection.saveData);

  /* 1 ─ flags (CSS uses them to switch off the expensive layers) */
  if (isIOS) de.classList.add('ios');
  if (touch) de.classList.add('ios-touch');
  if (lite && !isIOS) de.classList.add('ios-lite');
  var hero = d.querySelector('.ig-hero');
  var landing = !!(hero && d.getElementById('nav'));
  if (landing) de.classList.add('ios-landing');

  /* 2 ─ eased wheel scrolling for notched mouse wheels, on every page */
  var canWheel = !reduce && !touch && !isIOS && de.getAttribute('data-smooth-scroll') !== 'off';
  if (canWheel) {
    de.classList.add('ios-wheel');
    var states = new WeakMap(), live = [];                 // one animation state per scroll area
    var root = function () { return d.scrollingElement || de; };
    var isRoot = function (el) { return el === root() || el === d.body || el === de; };
    var maxOf = function (el) { return isRoot(el) ? Math.max(0, root().scrollHeight - w.innerHeight) : Math.max(0, el.scrollHeight - el.clientHeight); };
    var posOf = function (el) { return isRoot(el) ? (w.pageYOffset || root().scrollTop || 0) : el.scrollTop; };
    var setPos = function (el, y) { if (isRoot(el)) w.scrollTo(0, y); else el.scrollTop = y; };
    var stateOf = function (el) { var s = states.get(el); if (!s) { s = { cur: 0, target: 0, raf: 0, last: 0 }; states.set(el, s); } return s; };
    var calm = function (el, s) {                           // let the browser's own smooth-scroll step aside while we animate
      var tgt = isRoot(el) ? de : el; if (tgt.style.scrollBehavior !== 'auto') { s.sb = tgt.style.scrollBehavior; tgt.style.scrollBehavior = 'auto'; }
    };
    var restore = function (el, s) { var tgt = isRoot(el) ? de : el; if (s.sb !== undefined) { tgt.style.scrollBehavior = s.sb; s.sb = undefined; } };
    var halt = function (el) { var s = states.get(el); if (!s) return; if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; } s.last = 0; restore(el, s); };
    var haltAll = function () { live.forEach(halt); live = []; };
    var step = function (el, t) {
      var s = stateOf(el), dt = Math.min(48, t - (s.last || t - 16)); s.last = t;
      /* something else moved this area (keyboard, scrollbar, anchor link, a script): stop fighting it */
      if (Math.abs(posOf(el) - s.cur) > 3) { s.cur = s.target = posOf(el); s.raf = 0; s.last = 0; restore(el, s); return; }
      var k = 1 - Math.pow(1 - 0.11, dt / 16.67);          // same feel at 60 / 120 / 144 Hz
      s.cur += (s.target - s.cur) * k;
      if (Math.abs(s.target - s.cur) < 0.4) { s.cur = s.target; setPos(el, s.cur); s.raf = 0; s.last = 0; restore(el, s); return; }
      setPos(el, s.cur);
      s.raf = requestAnimationFrame(function (tt) { step(el, tt); });
    };
    /* the scroll area under the pointer that can still move in this direction (page last) */
    var areaFor = function (el, dy) {
      for (; el && el.nodeType === 1 && el !== d.body && el !== de; el = el.parentElement) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
          var can = dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
          if (can) return el;
          if (getComputedStyle(el).overscrollBehaviorY !== 'auto') return null;   // contained panel: do not chain into the page
        }
      }
      var r = root(), hidden = getComputedStyle(de).overflowY === 'hidden' || getComputedStyle(d.body).overflowY === 'hidden';
      if (hidden || maxOf(r) <= 0) return null;
      return (dy < 0 ? posOf(r) > 0 : posOf(r) < maxOf(r) - 1) ? r : null;
    };
    /* a notched mouse wheel reports whole multiples of 120 (legacy wheelDelta) or big whole numbers; trackpads and
       smooth-scroll mice report small / fractional ones and keep their own (already smooth) behaviour */
    var notched = function (e, dy) {
      if (e.deltaMode !== 0) return true;
      if (e.wheelDeltaY && Math.abs(e.wheelDeltaY) % 120 === 0 && Math.abs(e.wheelDeltaY) >= 120) return true;
      return Math.abs(dy) >= 50 && dy % 1 === 0;
    };
    w.addEventListener('wheel', function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.deltaX && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      var dy = e.deltaY;
      if (!dy) return;
      if (e.deltaMode === 1) dy *= 40; else if (e.deltaMode === 2) dy *= w.innerHeight;
      if (!notched(e, e.deltaMode === 0 ? e.deltaY : dy)) return;
      if (d.body.classList.contains('modal-open') || d.querySelector('.modal-overlay.open, .dvu:not(.is-out), #dvLock:not([hidden])')) return;
      var el = areaFor(e.target, dy);
      if (!el) return;
      e.preventDefault();
      var s = stateOf(el);
      if (!s.raf) { s.cur = s.target = posOf(el); s.last = 0; }
      calm(el, s); if (live.indexOf(el) < 0) live.push(el);
      s.target = Math.max(0, Math.min(maxOf(el), s.target + Math.max(-240, Math.min(240, dy)) * 1.15));
      if (!s.raf) s.raf = requestAnimationFrame(function (t) { step(el, t); });
    }, { passive: false });
    ['touchstart', 'keydown', 'mousedown', 'pointerdown'].forEach(function (ev) {
      w.addEventListener(ev, haltAll, { passive: true, capture: true });
    });
  }

  if (!landing) return;

  /* 3 ─ hero effects pause once the hero is off screen (index-plus already pauses some; this covers the rest) */
  if ('IntersectionObserver' in w) {
    var bg = d.querySelector('.ig-bg');
    if (bg) {
      new IntersectionObserver(function (en) {
        var on = en[0].isIntersecting;
        de.classList.toggle('ios-hero-off', !on);
      }, { threshold: 0 }).observe(hero);
    }
  }
})();
