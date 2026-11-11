// Anchored tab bar (renamed from the 2.41.0 "Telegram" style) + the Settings section tabs that follow it.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log(' FAIL', n); } };
const src = fs.readFileSync(path.join(root, 'js/tabbar-prefs.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
function boot(saved) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com/dashboard.html', pretendToBeVisual: true });
  if (saved) dom.window.localStorage.setItem('dv-tabbar', JSON.stringify(saved));
  dom.window.eval(src);
  return dom.window;
}
const css = fs.readFileSync(path.join(root, 'css/tabbar-anchored.css'), 'utf8');
(async () => {
  let w = boot(null), h = w.document.documentElement;
  ok('default: anchored style, Settings tabs follow the bar', h.getAttribute('data-tb-style') === 'anchored' && h.getAttribute('data-tb-stg') === 'match');
  ok('default: the bar floats (rounded, with a margin), Settings tabs too', h.getAttribute('data-tb-float') === 'on' && /data-tb-float="on"\] \.dash-side \.dash-nav \{[^}]*border-radius: 26px/.test(css) && /data-tb-float="on"\]\[data-tb-stg="match"\] #view-settings \.stg-rail/.test(css));
  w = boot({ style: 'anchored', float: 'off' });
  ok('Bar shape: Docked turns the float off, an invalid value falls back to floating', w.document.documentElement.getAttribute('data-tb-float') === 'off' && boot({ float: 'x' }).document.documentElement.getAttribute('data-tb-float') === 'on' && boot({ style: 'floating' }).document.documentElement.getAttribute('data-tb-float') === 'off');
  w = boot({ style: 'telegram', labels: 'active', settingsTabs: 'capsule' }); h = w.document.documentElement;
  ok('a style saved by 2.41.0 ("telegram") is read as anchored and keeps the other choices', h.getAttribute('data-tb-style') === 'anchored' && h.getAttribute('data-tb-labels') === 'active' && h.getAttribute('data-tb-stg') === 'capsule');
  w = boot({ style: 'floating', settingsTabs: 'nonsense' }); h = w.document.documentElement;
  ok('floating keeps the capsule; an invalid Settings-tabs value falls back to match', h.getAttribute('data-tb-style') === 'floating' && h.getAttribute('data-tb-stg') === 'match');
  ok('the old name survives only in the migration of saved settings', !/telegram/i.test(css + html) && (src.match(/telegram/gi) || []).length === 2 && !fs.existsSync(path.join(root, 'css/tabbar-telegram.css')) && !/telegram/i.test(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')));
  ok('css: Settings tabs get the same bar (icon over label, hairline, indicator, status dot)', /\[data-tb-stg="match"\] #view-settings \.stg-rail/.test(css) && /#view-settings \.stg-rail \.stg-tab \.stg-tab-status/.test(css) && /flex-direction: column/.test(css.slice(css.indexOf('Settings section tabs'))));
  ok('css: the capsule bead is hidden only in match mode', /data-tb-stg="match"\] #view-settings \.stg-rail > \.dv-pill/.test(css));
  ok('tab bar card offers the Settings tabs and Bar shape choices', /Settings tabs/.test(src) && /Match tab bar/.test(src) && /Bar shape/.test(src) && /Floating/.test(src));
  ok('the open Settings tab is scrolled into view in a scrolling bar', /bindSettingsRail/.test(src) && /scrollTo/.test(src));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
