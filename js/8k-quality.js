/* DashView 8K quality: render Chart.js canvases at >= 2x device pixels so charts stay
   sharp on 4K / 8K screens (and when a hi-DPI page is zoomed). Capped at 3x: a 4x canvas on a
   wide, zoomed-out page is hundreds of MB of GPU memory and made the workspace lag. */
(function () {
  var tries = 0, t, root = document.documentElement;

  /* Browser zoom-out detection. The viewport (innerWidth) grows when the person zooms out, the physical
     screen (screen.width, in CSS pixels of the screen) does not. Wider than the screen => zoomed out, so
     the ultra-HD text boost in css/8k-quality.css must stand down. */
  function flagZoom() {
    var sw = (window.screen && window.screen.width) || 0;
    var out = sw > 0 && window.innerWidth > sw * 1.08;
    if (out !== root.hasAttribute('data-zoom-out')) { if (out) root.setAttribute('data-zoom-out', ''); else root.removeAttribute('data-zoom-out'); }
  }
  flagZoom();
  var rz = 0;
  window.addEventListener('resize', function () { cancelAnimationFrame(rz); rz = requestAnimationFrame(flagZoom); });

  function apply() {
    var C = window.Chart;
    if (!C || !C.defaults) return false;
    C.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
    return true;
  }
  if (apply()) return;
  t = setInterval(function () { if (apply() || ++tries > 100) clearInterval(t); }, 100);
})();
