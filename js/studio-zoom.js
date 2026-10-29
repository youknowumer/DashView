/* ==========================================================================
   DashView — Data Studio workspace zoom
   --------------------------------------------------------------------------
   A zoom control for the Studio canvas (the tab panels: Overview, Data, Pivot,
   Hierarchy, Reconcile). The toolbar, tabs and filters stay at 100% so the
   controls never get tiny; only the content scales — like zooming a sheet.

     −  / +        step through 60 · 70 · 80 · 90 · 100 · 110 · 125 · 150 · 175 %
     100%          click to reset
     Fit           largest zoom at which the current tab fits the window
                   (tables: no sideways scrolling · Overview / Hierarchy: no extra scrolling)
     Alt + − / Alt + = / Alt + 0     keyboard

   The level is remembered on this device. Uses the CSS `zoom` property, so
   layout (not just pixels) reflows: the Overview grid picks the column layout
   that suits the new width, and charts re-measure themselves.
   ========================================================================== */
(function () {
  'use strict';

  var STEPS = [60, 70, 80, 90, 100, 110, 125, 150, 175];
  var MIN = 50, MAX = 175;   /* Fit may go a little below the smallest step */
  var KEY = 'dv-studio-zoom';
  var view = document.getElementById('view-studio');
  var box = document.getElementById('studioZoom');
  if (!view || !box) return;

  /* `zoom` is in every current browser (Firefox 126+); on an older one hide the control rather than fake it. */
  var supported = !!(window.CSS && CSS.supports && CSS.supports('zoom', '1'));
  if (!supported) { box.hidden = true; return; }

  var levelBtn = document.getElementById('zoomLevelBtn');
  var outBtn = document.getElementById('zoomOutBtn');
  var inBtn = document.getElementById('zoomInBtn');
  var fitBtn = document.getElementById('zoomFitBtn');
  var zoom = 100, fitted = false;

  function clamp(z) { return Math.max(MIN, Math.min(MAX, Math.round(z))); }
  function read() { try { var v = parseInt(localStorage.getItem(KEY), 10); return v >= 50 && v <= 175 ? v : 100; } catch (e) { return 100; } }
  function save() { try { if (zoom === 100) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(zoom)); } catch (e) {} }

  function resizeCharts() {
    var C = window.Chart;
    if (!C || !C.instances) return;
    Object.keys(C.instances).forEach(function (k) {
      var c = C.instances[k];
      if (c && c.canvas && view.contains(c.canvas)) { try { c.resize(); } catch (e) {} }
    });
  }

  function apply(z, opts) {
    opts = opts || {};
    zoom = clamp(z);
    fitted = !!opts.fitted;
    view.style.setProperty('--studio-zoom', String(zoom / 100));
    view.toggleAttribute('data-zoomed', zoom !== 100);
    levelBtn.textContent = zoom + '%';
    levelBtn.setAttribute('aria-label', 'Zoom ' + zoom + ' percent. Reset to 100 percent');
    box.classList.toggle('is-fitted', fitted);
    outBtn.disabled = zoom <= MIN;
    inBtn.disabled = zoom >= MAX;
    if (!opts.silent) save();
    window.dispatchEvent(new Event('dv:studio-zoom'));
    requestAnimationFrame(resizeCharts);
  }

  function step(dir) {
    var next;
    if (dir > 0) next = STEPS.filter(function (s) { return s > zoom; })[0] || STEPS[STEPS.length - 1];
    else next = STEPS.slice().reverse().filter(function (s) { return s < zoom; })[0] || MIN;
    apply(next);
  }

  /* ---- Fit ---------------------------------------------------------------- */
  function activePanel() {
    var p = view.querySelectorAll('.studio-tab-panel');
    for (var i = 0; i < p.length; i++) if (p[i].style.display !== 'none') return p[i];
    return null;
  }
  function overflowsSideways(panel) {
    var s = panel.querySelectorAll('.grid-scroll, .pivot-table-wrap, .rc-tablewrap');
    for (var i = 0; i < s.length; i++) if (s[i].offsetParent && s[i].scrollWidth > s[i].clientWidth + 1) return true;
    return false;
  }
  function fit() {
    var panel = activePanel();
    if (!panel) return;
    var wantsHeight = panel.id === 'panel-overview' || panel.id === 'panel-hierarchy';
    var floor = wantsHeight ? 70 : MIN;   /* never shrink a dashboard below readable just to avoid a scrollbar */
    var best = floor;
    for (var z = 100; z >= floor; z -= 5) {
      view.style.setProperty('--studio-zoom', String(z / 100));
      var okW = !overflowsSideways(panel);
      var top = Math.max(panel.getBoundingClientRect().top, 0);
      var okH = !wantsHeight || panel.offsetHeight * (z / 100) <= Math.max(240, window.innerHeight - top - 24);
      if (okW && okH) { best = z; break; }
    }
    apply(best, { fitted: true, silent: true });   /* not remembered: it only fits this tab */
    var msg = best === 100 ? 'Everything already fits at 100%.' : best === floor && wantsHeight ? 'Zoom set to ' + best + '% - the smallest readable size; scroll for the rest.' : 'Zoom set to ' + best + '% so this view fits.';
    if (typeof window.showToast === 'function') window.showToast(msg, 'info');
  }

  /* ---- wiring -------------------------------------------------------------- */
  outBtn.addEventListener('click', function () { step(-1); });
  inBtn.addEventListener('click', function () { step(1); });
  levelBtn.addEventListener('click', function () { apply(100); });
  fitBtn.addEventListener('click', fit);

  document.addEventListener('keydown', function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (!view.classList.contains('active') && view.offsetParent === null) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName || '') || e.target.isContentEditable) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); step(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); step(-1); }
    else if (e.key === '0') { e.preventDefault(); apply(100); }
  });

  /* A fitted zoom only fits the tab it was measured on - drop back to the chosen level on tab change. */
  var tabs = document.getElementById('studioTabs');
  if (tabs) tabs.addEventListener('click', function () { if (fitted) apply(read(), { silent: true }); });

  apply(read(), { silent: true });
})();
