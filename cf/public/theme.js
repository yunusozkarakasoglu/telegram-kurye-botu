/* ==========================================================================
   theme.js — Telegram Mini App teması eşlemesi + SDK yardımcıları
   Telegram, uygulamanın kendi renklerini themeParams ile bildirir; biz bunları
   CSS token'larına yazarız. Böylece uygulama Telegram temasıyla birebir aynı
   görünür. Renk karıştırma (mix) yardımcıları marka renklerini açık/koyu
   temaya göre uyarlar.
   ========================================================================== */
(function () {
  'use strict';
  var tg = (window.Telegram && window.Telegram.WebApp) || null;

  /* ---------- renk yardımcıları ---------- */
  function hex2rgb(h) {
    if (!h) return null;
    h = String(h).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgb2hex(r) {
    return '#' + r.map(function (v) {
      var s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }
  function mix(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b);
    if (!A || !B) return a;
    return rgb2hex(A.map(function (v, i) { return v + (B[i] - v) * t; }));
  }
  function lum(h) {
    var c = hex2rgb(h);
    if (!c) return 1;
    var r = c.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
  }

  /* ---------- tema eşlemesi ---------- */
  function applyTheme() {
    var p = (tg && tg.themeParams) || {};
    var root = document.documentElement;
    if (!p.bg_color) return;                 // Telegram dışı (tarayıcı) → CSS varsayılanı

    var bg = p.bg_color;
    var card = p.secondary_bg_color || p.bg_color;
    var tx = p.text_color || '#14181f';
    var dark = lum(bg) < 0.45;

    var okBase = dark ? '#5fd3a6' : '#12805c';
    var erBase = dark ? '#ff8f85' : '#b42318';
    var wrBase = dark ? '#f3c969' : '#8a5a00';

    var set = function (k, v) { if (v) root.style.setProperty(k, v); };
    set('--bg', bg);
    set('--card', card);
    set('--tx', tx);
    set('--t2', p.subtitle_text_color || p.hint_color || mix(tx, card, 0.45));
    set('--ln', p.section_bg_color && p.section_bg_color !== card ? p.section_bg_color : mix(card, tx, 0.12));
    set('--ac', p.link_color || (dark ? '#5aaaf0' : '#2481cc'));
    set('--on', p.button_text_color || (dark ? '#0b1520' : '#fff'));
    set('--ok', mix(card, okBase, dark ? 0.92 : 0.98));
    set('--okb', mix(card, okBase, dark ? 0.20 : 0.16));
    set('--er', mix(card, erBase, dark ? 0.92 : 0.98));
    set('--erb', mix(card, erBase, dark ? 0.20 : 0.16));
    set('--wr', mix(card, wrBase, dark ? 0.92 : 0.98));
    set('--wrb', mix(card, wrBase, dark ? 0.22 : 0.18));

    var meta = document.getElementById('mcolor');
    if (meta) meta.setAttribute('content', bg);
    try { if (tg && tg.setBackgroundColor) tg.setBackgroundColor(bg); } catch (e) {}
    try { if (tg && tg.setHeaderColor) tg.setHeaderColor(p.header_bg_color || 'secondary_bg_color'); } catch (e) {}
  }

  /* ---------- güvenli alan (çentik / alt çubuk) ---------- */
  function applySafeArea() {
    var tgsa = tg && tg.safeAreaInset;
    var root = document.documentElement;
    if (tgsa) {
      root.style.setProperty('--sat', (tgsa.top || 0) + 'px');
      root.style.setProperty('--sab', (tgsa.bottom || 0) + 'px');
    }
  }

  /* ---------- SDK yardımcıları ---------- */
  var TG = {
    app: tg,
    isTelegram: !!(tg && tg.initData && String(tg.initData).length),
    atLeast: function (v) {
      try { return !!(tg && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast(v)); } catch (e) { return false; }
    },
    haptic: function (kind) {
      if (!tg) return;
      try {
        if (kind === 'success' || kind === 'error' || kind === 'warning') tg.HapticFeedback.notificationOccurred(kind);
        else tg.HapticFeedback.impactOccurred(kind || 'light');
      } catch (e) {}
    },
    ready: function () { try { tg && tg.ready(); } catch (e) {} },
    expand: function () { try { tg && tg.expand(); } catch (e) {} },
    noSwipes: function () { try { if (tg && tg.disableVerticalSwipes && TG.atLeast('7.7')) tg.disableVerticalSwipes(); } catch (e) {} },
    openLink: function (url) {
      try { if (tg && tg.openLink) tg.openLink(url, { try_instant_view: false }); else window.open(url, '_blank', 'noopener'); }
      catch (e) { window.open(url, '_blank', 'noopener'); }
    },
    call: function (tel) { TG.openLink('tel:' + String(tel).replace(/[^\d+]/g, '')); },
    map: function (query) {
      TG.openLink('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query));
    },
    /** Bot API 8.0+: LocationManager ile cihaz konumu. */
    location: function (done) {
      if (!tg || !tg.LocationManager) {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(function (p) { done({ lat: p.coords.latitude, lon: p.coords.longitude }); },
            function () { done(null); }, { enableHighAccuracy: true, timeout: 10000 });
        } else done(null);
        return;
      }
      try {
        tg.LocationManager.init();
        if (tg.LocationManager.isAccessGranted && tg.LocationManager.isAccessGranted) {
          tg.LocationManager.getLocation(function (loc) { done(loc ? { lat: loc.latitude, lon: loc.longitude } : null); });
        } else {
          tg.LocationManager.getLocation(function (loc) { done(loc ? { lat: loc.latitude, lon: loc.longitude } : null); });
        }
      } catch (e) { done(null); }
    },
    /** Derin linkten gelen davet token'ı (SDK bunu parse etmez — elle okunur). */
    startParam: function () {
      try {
        var sp = new URLSearchParams(location.search).get('tgWebAppStartParam');
        if (sp) return sp;
        var h = new URLSearchParams((location.hash || '').replace(/^#/, '')).get('tgWebAppStartParam');
        return h || '';
      } catch (e) { return ''; }
    },
    user: function () {
      var u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      if (!u) return null;
      return { id: u.id, name: ((u.first_name || '') + ' ' + (u.last_name || '')).trim(), username: u.username || '', lang: u.language_code || '' };
    },
    close: function () { try { tg && tg.close(); } catch (e) {} }
  };

  window.TG = TG;

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme();
    applySafeArea();
    TG.ready();
    TG.expand();
    TG.noSwipes();
    if (tg && tg.onEvent) {
      try { tg.onEvent('themeChanged', function () { applyTheme(); applySafeArea(); }); } catch (e) {}
      try { tg.onEvent('viewportChanged', applySafeArea); } catch (e) {}
    }
    if (window.matchMedia) {
      try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { applyTheme(); }); } catch (e) {}
    }
  });
})();
