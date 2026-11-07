/* ==========================================================================
   DashView - backend link (the ONE place the Cloudflare Worker URL lives)
   ==========================================================================
   The Worker URL is no longer typed into Settings. Every page that talks to
   Odoo loads this file first, and the rest of the app reads the URL from here
   (js/dv-security.js cfg(), js/odoo-service.js, js/odoo-client.js).

   To point DashView at another Worker, change WORKER_URL below and redeploy
   the site. Nothing else needs to change. Use the plain https URL, no path and
   no trailing slash.

   Security note: this file is public (it is served to the browser). The URL of
   a Worker is not a secret; what protects it is ALLOWED_ORIGINS and
   ALLOWED_ODOO_HOSTS in wrangler.jsonc.
   ========================================================================== */
(function (g) {
  'use strict';

  var WORKER_URL = 'https://dashview.youknowumer-io.workers.dev';

  function clean(u) { return String(u || '').trim().replace(/\/+$/, ''); }
  function valid(u) {
    try { var p = new URL(u); return p.protocol === 'https:' && !!p.hostname && !p.username && !p.password; }
    catch (e) { return false; }
  }

  var url = valid(clean(WORKER_URL)) ? clean(WORKER_URL) : '';

  g.DV_BACKEND = Object.freeze({
    /* '' means "no built-in backend": the app then falls back to the saved proxyUrl, if any. */
    workerUrl: url,
    /* Returns a copy of an Odoo config with proxyUrl forced to the built-in Worker. */
    lock: function (cfg) {
      var out = Object.assign({}, cfg || {});
      if (url) out.proxyUrl = url;
      return out;
    }
  });
})(typeof window !== 'undefined' ? window : this);
