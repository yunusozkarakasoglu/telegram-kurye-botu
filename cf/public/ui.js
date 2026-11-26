/* ==========================================================================
   ui.js — küçük DOM/format yardımcıları (framework yok, stdlib tarayıcı)
   ========================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(tl) {
    if (tl == null) return '—';
    return tl.toLocaleString('tr-TR') + ' TL';
  }

  function km(v) {
    if (v == null) return '—';
    return (Math.round(v * 10) / 10).toLocaleString('tr-TR') + ' km';
  }

  function dt(value) {
    if (value == null || value === '') return '—';
    var d;
    if (typeof value === 'number') d = new Date(value < 1e12 ? value * 1000 : value);
    else if (/^\d+(\.\d+)?$/.test(String(value))) { var n = Number(value); d = new Date(n < 1e12 ? n * 1000 : n); }
    else d = new Date(value);
    if (!d || isNaN(d.getTime())) return '—';
    return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* Durum etiketleri tek kaynaktan gelir (Worker: views.statusOf) — istemci sadece sınıflandırır. */
  var STATUS = {
    'Havuzda bekliyor': '', 'Kabul edildi': 'ac', 'Kuryede / Yolda': 'ok',
    'Teslim edildi': 'ok', 'İptal edildi': 'er', 'Aktarım onayı bekleniyor': 'er'
  };
  function statusTag(label) {
    return '<span class="tag ' + (STATUS[label] || '') + '">' + esc(label || '—') + '</span>';
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 's';
    if (window.TG) window.TG.haptic(kind === 'error' ? 'error' : (kind === 'success' ? 'success' : 'light'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2200);
  }

  /* Alt panel (sheet) — Telegram geri tuşu ile de kapatılabilir */
  var sheetState = { open: false, onClose: null, backHandler: null };
  function openSheet(html, opts) {
    opts = opts || {};
    var ovl = document.getElementById('ovl');
    ovl.innerHTML = '<div class="ov' + (opts.full ? ' full' : '') + '" id="ov">' +
      '<div class="sh' + (opts.full ? ' full' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    document.body.classList.add('sheet-open');
    sheetState.open = true;
    sheetState.onClose = opts.onClose || null;
    ovl.onclick = function (e) { if (e.target.id === 'ov') closeSheet(); };
    var tg = window.TG && window.TG.app;
    if (tg && tg.BackButton) {
      try {
        sheetState.backHandler = function () { closeSheet(); };
        tg.BackButton.onClick(sheetState.backHandler);
        tg.BackButton.show();
      } catch (e) {}
    }
    if (opts.onMount) opts.onMount(ovl.querySelector('.sh'));
    return ovl.querySelector('.sh');
  }
  function closeSheet() {
    var ovl = document.getElementById('ovl');
    if (ovl) ovl.innerHTML = '';
    document.body.classList.remove('sheet-open');
    sheetState.open = false;
    var tg = window.TG && window.TG.app;
    if (tg && tg.BackButton && sheetState.backHandler) {
      try { tg.BackButton.offClick(sheetState.backHandler); } catch (e) {}
    }
    sheetState.backHandler = null;
    if (sheetState.onClose) { var f = sheetState.onClose; sheetState.onClose = null; f(); }
  }
  function sheetOpen() { return sheetState.open; }

  function $(id) { return document.getElementById(id); }

  window.UI = {
    esc: esc, money: money, km: km, dt: dt, clock: clock,
    statusTag: statusTag, STATUS: STATUS,
    toast: toast, openSheet: openSheet, closeSheet: closeSheet, sheetOpen: sheetOpen, $: $
  };
})();
