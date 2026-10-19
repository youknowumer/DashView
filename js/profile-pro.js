/* DashView — Profile settings (v2): username, photo, status, validation, live sidebar sync.
   Storage: localStorage "dashview_profile" (backwards compatible: workspaceName + displayName kept). */
(function () {
  'use strict';
  var KEY = 'dashview_profile';
  var COLORS = ['#e8a33d', '#ef6a4c', '#e0527e', '#a05cf0', '#5b7cfa', '#2f9fd8', '#18a999', '#4fa84f'];
  var RESERVED = ['admin', 'administrator', 'root', 'system', 'support', 'help', 'owner', 'dashview', 'null', 'undefined', 'api', 'www', 'me'];
  var DEF = { workspaceName: 'acme-corp', displayName: '', username: '', title: '', department: '', phone: '', location: '',
              timezone: '', language: 'en', bio: '', status: 'available', statusText: '', color: COLORS[0], photo: '', updatedAt: 0 };
  var $ = function (id) { return document.getElementById(id); };

  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function account() {
    var u = null;
    try { u = window.DVAuth && window.DVAuth.currentUser && window.DVAuth.currentUser(); } catch (e) {}
    return u && !u.guest ? u : null;
  }
  function initials(n) { return String(n || '').trim().split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase() || '?'; }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/^[._-]+|[._-]+$/g, '').slice(0, 24); }

  function load() {
    var s = Object.assign({}, DEF, read()), a = account();
    if (!s.displayName) s.displayName = (a && a.name) || '';
    if (!s.username) s.username = slug(s.displayName || (a && a.email ? a.email.split('@')[0] : ''));
    if (!s.timezone) { try { s.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { s.timezone = 'UTC'; } }
    return s;
  }

  var saved = load(), draft = Object.assign({}, saved), el = {};

  /* ── validation ── */
  function checkName(v) { v = v.trim(); if (!v) return 'Enter your full name.'; if (v.length < 2) return 'Name is too short.'; return ''; }
  function checkUser(v) {
    if (!v) return 'Choose a username.';
    if (v.length < 3) return 'At least 3 characters.';
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(v)) return 'Use lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.';
    if (/[._-]{2,}/.test(v)) return 'No repeated separators (e.g. "..").';
    if (RESERVED.indexOf(v) > -1) return '“' + v + '” is reserved. Try another.';
    return '';
  }
  function checkPhone(v) { v = v.trim(); if (!v) return ''; return /^\+?[0-9 ()\-.]{6,24}$/.test(v) && v.replace(/\D/g, '').length >= 6 ? '' : 'Enter a valid phone number.'; }

  /* ── rendering ── */
  function avatarStyle(node, p) {
    var txt = node.querySelector('span');
    if (p.photo) { node.style.backgroundImage = 'url(' + p.photo + ')'; node.classList.add('has-photo'); }
    else { node.style.backgroundImage = ''; node.classList.remove('has-photo'); node.style.background = p.color; if (txt) txt.textContent = initials(p.displayName); }
  }
  var ROLE_LABEL = function () { var a = account(); return a && window.DVAuth && window.DVAuth.ROLE_LABEL ? (window.DVAuth.ROLE_LABEL[a.role] || 'Admin') : 'Admin'; };

  function strength(p) {
    var checks = [['name', !!p.displayName.trim()], ['username', !checkUser(p.username)], ['a job title', !!p.title.trim()], ['a department', !!p.department.trim()],
      ['a phone number', !!p.phone.trim()], ['a location', !!p.location.trim()], ['a short bio', p.bio.trim().length >= 20], ['a photo', !!p.photo]];
    var done = checks.filter(function (c) { return c[1]; }).length, miss = checks.filter(function (c) { return !c[1]; });
    return { pct: Math.round(done / checks.length * 100), next: miss.length ? miss[0][0] : '' };
  }

  function render() {
    var p = draft, st = strength(p);
    avatarStyle(el.avatar, p); avatarStyle(el.prevAvatar, p);
    el.presence.setAttribute('data-s', p.status);
    el.heroName.textContent = p.displayName.trim() || 'Your name';
    el.heroUser.textContent = '@' + (p.username || 'username');
    el.heroSub.textContent = [p.title.trim(), p.department.trim()].filter(Boolean).join(' · ') + (p.statusText.trim() ? ((p.title || p.department) ? ' — ' : '') + p.statusText.trim() : '') || 'Add a job title';
    el.photoRemove.hidden = !p.photo; el.photoBtn.textContent = p.photo ? 'Change photo' : 'Upload photo';
    el.pct.textContent = st.pct + '%'; el.fill.style.width = st.pct + '%';
    el.hint.textContent = st.pct === 100 ? 'Great — your profile is complete.' : 'Next: add ' + st.next + '.';
    el.bioCount.textContent = p.bio.length + ' / 160'; el.bioCount.classList.toggle('near', p.bio.length >= 140);
    el.prevName.textContent = p.displayName.trim() || 'Your name';
    el.prevMeta.innerHTML = esc(p.workspaceName || 'workspace') + ' · ' + esc(ROLE_LABEL());
    el.wsTag.textContent = p.workspaceName || 'workspace';
    Array.prototype.forEach.call(el.status.children, function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-s') === p.status)); });
    Array.prototype.forEach.call(el.swatches.children, function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-c') === p.color)); });
    var dirty = JSON.stringify(strip(draft)) !== JSON.stringify(strip(saved));
    el.dirty.hidden = !dirty; el.save.disabled = !dirty; el.discard.disabled = !dirty;
    if (dirty) { el.tag.textContent = 'Unsaved changes'; el.tag.classList.remove('pf-saved'); }
    else if (saved.updatedAt) { el.tag.textContent = 'Saved ' + new Date(saved.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); el.tag.classList.add('pf-saved'); }
    else { el.tag.textContent = 'Not saved yet'; el.tag.classList.remove('pf-saved'); }
    tzNow();
  }
  function strip(o) { var c = Object.assign({}, o); delete c.updatedAt; return c; }

  function fieldErr(input, errEl, msg) {
    input.classList.toggle('pf-invalid', !!msg); input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; }
  }
  function validateUser(touch) {
    var v = draft.username, msg = checkUser(v);
    el.handleState.className = 'pf-handle-state' + (v ? (msg ? ' bad' : ' ok') : '');
    el.userHelp.classList.toggle('pf-err', !!(touch && msg));
    el.userHelp.textContent = touch && msg ? msg : '3–24 characters: letters, numbers, dots, dashes and underscores.';
    el.username.classList.toggle('pf-invalid', !!(touch && msg));
    return !msg;
  }

  function tzNow() {
    try { el.tzNow.textContent = 'Local time there: ' + new Date().toLocaleTimeString([], { timeZone: draft.timezone, hour: '2-digit', minute: '2-digit' }); }
    catch (e) { el.tzNow.textContent = ''; }
  }
  function fillTz() {
    var zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) {}
    if (!zones.length) zones = ['UTC', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
    if (zones.indexOf(draft.timezone) < 0) zones.unshift(draft.timezone);
    el.tz.innerHTML = zones.map(function (z) { return '<option value="' + esc(z) + '">' + esc(z.replace(/_/g, ' ')) + '</option>'; }).join('');
  }

  /* ── photo: crop to square, 256px JPEG ── */
  function onPhoto(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast('Please choose a PNG, JPG or WebP image.'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('That image is too large (max 8 MB).'); return; }
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 256;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
      URL.revokeObjectURL(url); draft.photo = c.toDataURL('image/jpeg', 0.86); render();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Could not read that image.'); };
    img.src = url;
  }

  /* ── apply to sidebar / top bar ── */
  function apply() {
    var p = Object.assign({}, DEF, read()); if (!p.displayName && !p.photo && !read().color) return;
    var a = account(); if (!a) return;
    var name = p.displayName || a.name;
    [$('dashUserAvatar'), $('dashTopUserAvatar')].forEach(function (n) {
      if (!n) return;
      if (p.photo) { n.textContent = ''; n.style.backgroundImage = 'url(' + p.photo + ')'; n.style.backgroundSize = 'cover'; n.style.backgroundPosition = 'center'; }
      else { n.style.backgroundImage = ''; n.textContent = initials(name); if (read().color) { n.style.background = p.color; n.style.color = '#fff'; } }
    });
    var nm = $('dashUserName'); if (nm) nm.textContent = name;
    var meta = $('dashUserMeta');
    if (meta && p.workspaceName && meta.firstChild && meta.firstChild.nodeType === 3) meta.firstChild.nodeValue = p.workspaceName + ' · ';
    var tip = $('dashTopUserAvatar'); if (tip) tip.title = name + (p.username ? ' (@' + p.username + ')' : '');
  }

  function persist(extra) {
    var next = Object.assign({}, draft, extra || {}, { updatedAt: Date.now() });
    next.displayName = next.displayName.trim(); next.workspaceName = (next.workspaceName || '').trim() || 'acme-corp';
    if (!write(next)) { toast('Could not save — browser storage is full or blocked.'); return false; }
    saved = Object.assign({}, next); draft = Object.assign({}, next); sync(); render(); apply();
    document.dispatchEvent(new CustomEvent('dv:profile', { detail: next }));
    return true;
  }

  function sync() {
    el.name.value = draft.displayName; el.username.value = draft.username; el.title.value = draft.title; el.dept.value = draft.department;
    el.bio.value = draft.bio; el.phone.value = draft.phone; el.location.value = draft.location; el.tz.value = draft.timezone;
    el.lang.value = draft.language; el.statusText.value = draft.statusText; el.ws.value = draft.workspaceName;
  }

  function init() {
    if (!$('pfCard')) return;
    el = { avatar: $('pfAvatar'), prevAvatar: $('pfPrevAvatar'), presence: $('pfPresence'), heroName: $('pfHeroName'), heroUser: $('pfHeroUser'), heroSub: $('pfHeroSub'),
      photoBtn: $('pfPhotoBtn'), photoRemove: $('pfPhotoRemove'), photoInput: $('pfPhotoInput'), pct: $('pfMeterPct'), fill: $('pfMeterFill'), hint: $('pfMeterHint'),
      name: $('pfName'), username: $('pfUsername'), title: $('pfTitle'), dept: $('pfDept'), bio: $('pfBio'), bioCount: $('pfBioCount'), email: $('pfEmail'), phone: $('pfPhone'),
      location: $('pfLocation'), tz: $('pfTz'), tzNow: $('pfTzNow'), lang: $('pfLang'), status: $('pfStatus'), statusText: $('pfStatusText'), swatches: $('pfSwatches'),
      prevName: $('pfPrevName'), prevMeta: $('pfPrevMeta'), dirty: $('pfDirty'), save: $('pfSave'), discard: $('pfDiscard'), tag: $('pfSavedTag'),
      handleState: $('pfHandleState'), userHelp: $('pfUserHelp'), ws: $('setWorkspaceName'), wsTag: $('pfWsTag'), wsSave: $('pfWsSave'), role: $('pfRole') };

    el.swatches.innerHTML = COLORS.map(function (c) { return '<button type="button" role="radio" data-c="' + c + '" style="--c:' + c + '" aria-label="Colour ' + c + '"></button>'; }).join('');
    fillTz();
    var a = account(); el.email.value = (a && a.email) || ''; el.role.value = ROLE_LABEL();
    sync();

    function bind(input, key, fn) { input.addEventListener('input', function () { draft[key] = fn ? fn(input.value) : input.value; render(); }); }
    bind(el.name, 'displayName'); bind(el.title, 'title'); bind(el.dept, 'department'); bind(el.bio, 'bio'); bind(el.location, 'location');
    bind(el.phone, 'phone'); bind(el.statusText, 'statusText'); bind(el.ws, 'workspaceName');
    el.tz.addEventListener('change', function () { draft.timezone = el.tz.value; render(); });
    el.lang.addEventListener('change', function () { draft.language = el.lang.value; render(); });
    el.name.addEventListener('blur', function () { fieldErr(el.name, $('pfNameErr'), checkName(draft.displayName)); });
    el.phone.addEventListener('blur', function () { fieldErr(el.phone, $('pfPhoneErr'), checkPhone(draft.phone)); });
    el.username.addEventListener('input', function () {
      var pos = el.username.selectionStart, v = el.username.value.toLowerCase().replace(/\s+/g, '.').replace(/^@/, '');
      el.username.value = v; try { el.username.setSelectionRange(pos, pos); } catch (e) {}
      draft.username = v; validateUser(true); render();
    });
    el.username.addEventListener('blur', function () { validateUser(true); });

    el.status.addEventListener('click', function (e) { var b = e.target.closest('button[data-s]'); if (b) { draft.status = b.getAttribute('data-s'); render(); } });
    el.swatches.addEventListener('click', function (e) { var b = e.target.closest('button[data-c]'); if (b) { draft.color = b.getAttribute('data-c'); render(); } });
    el.photoBtn.addEventListener('click', function () { el.photoInput.click(); });
    el.avatar.addEventListener('click', function () { el.photoInput.click(); });
    el.photoInput.addEventListener('change', function () { onPhoto(el.photoInput.files[0]); el.photoInput.value = ''; });
    el.photoRemove.addEventListener('click', function () { draft.photo = ''; render(); });

    el.discard.addEventListener('click', function () {
      draft = Object.assign({}, saved); sync(); validateUser(false);
      fieldErr(el.name, $('pfNameErr'), ''); fieldErr(el.phone, $('pfPhoneErr'), ''); render();
    });
    el.save.addEventListener('click', function () {
      var e1 = checkName(draft.displayName), e2 = checkPhone(draft.phone), ok = validateUser(true);
      fieldErr(el.name, $('pfNameErr'), e1); fieldErr(el.phone, $('pfPhoneErr'), e2);
      if (e1 || e2 || !ok) { (e1 ? el.name : !ok ? el.username : el.phone).focus(); toast('Please fix the highlighted fields.'); return; }
      if (persist()) toast('Profile saved.');
    });
    el.wsSave.addEventListener('click', function () { if (persist()) toast('Workspace saved.'); });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && $('stg-profile') && $('stg-profile').classList.contains('active') && !el.save.disabled) { e.preventDefault(); el.save.click(); }
    });
    window.addEventListener('beforeunload', function (e) { if (!el.save.disabled) { e.preventDefault(); e.returnValue = ''; } });

    render(); validateUser(false); apply();
    // account/sidebar may render after this script — re-apply once things settle
    setTimeout(function () { var a2 = account(); if (a2 && !el.email.value) { el.email.value = a2.email || ''; } if (!saved.displayName && a2) { saved.displayName = draft.displayName = a2.name || ''; saved.username = draft.username = draft.username || slug(a2.name); sync(); render(); } apply(); }, 600);
  }

  window.DVProfile = { apply: apply, get: function () { return Object.assign({}, DEF, read()); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
