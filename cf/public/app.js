/* ==========================================================================
   app.js — Mini App yönlendirme + ekranlar (kurye / restoran)
   ========================================================================== */
(function () {
  'use strict';
  var $ = UI.$, esc = UI.esc, money = UI.money, kmf = UI.km, dt = UI.dt;

  var S = {
    role: 'courier',
    tab: 'havuz',
    view: 'bolge',
    sel: {},
    session: null,
    pool: null,
    mine: null,
    history: null,
    earnings: null,
    reqItems: [],
    restFilter: 'all',
    kmPending: false,
    mineView: (localStorage.getItem('mineView') === 'card' ? 'card' : 'list'),
    histView: (localStorage.getItem('histView') === 'card' ? 'card' : 'list'),
    histRange: 'today',
    histDate: '',
    histPay: false,
    paySel: {},
    kazancRange: 'today',
    kazancDate: '',
    kazancPaid: 'all',
    sistemTab: 'fiyat',
    lateGroup: '',
    notifs: { items: [], unread: 0 },
    offers: null,
    tick: null
  };

  /* ---------------- yardımcılar ---------------- */
  function curRole() { return S.session && S.session.role ? S.session.role : 'courier'; }

  function courierTabs() {
    return [['havuz', '▤', 'Havuz'], ['paketlerim', '✓', 'Açık Paketler'], ['gecmis', '◷', 'Geçmiş']];
  }
  function restaurantTabs() {
    return [['talep', '＋', 'Talep Ver'], ['paketlerim', '▤', 'Paketlerim']];
  }

  function hardReload() {
    var q = new URLSearchParams(location.search);
    q.set('r', String(Date.now()));
    location.replace(location.pathname + '?' + q.toString() + location.hash);
  }

  function setHeader(title, sub) { $('ttl').textContent = title; $('sub').textContent = sub || ''; }

  function nav(items, counts) {
    var nv = $('nv');
    nv.innerHTML = items.map(function (x) {
      var c = counts && counts[x[0]];
      return '<button class="' + (S.tab === x[0] ? 'on' : '') + '" data-p="' + x[0] + '"><i>' + x[1] + '</i>' + x[2] +
        (c ? '<em>' + c + '</em>' : '') + '</button>';
    }).join('') + '<button class="nv-menu" id="nv-menu"><i>☰</i>Menü</button>';
    Array.prototype.forEach.call(nv.children, function (b) {
      if (b.id === 'nv-menu') {
        b.onclick = function () { var d = $('drawer'), sc = $('dscrim'); if (d) d.hidden = false; if (sc) sc.hidden = false; };
        return;
      }
      b.onclick = function () { S.tab = b.getAttribute('data-p'); UI.closeSheet(); render(); refresh(false); };
    });
  }

  /* ---------------- KURYE: HAVUZ ---------------- */
  function renderHavuz() {
    var pool = S.pool || { packages: [] };
    var L = pool.packages.slice();
    setHeader('Havuz', L.length + ' paket bekliyor');

    var main = $('mn'), ctaEl = $('cta');
    if (!L.length) {
      main.innerHTML = '<div class="empty"><b>Havuz boş</b>Yeni sipariş gelince bildirim alacaksınız.</div>';
      ctaEl.innerHTML = '';
      nav(courierTabs(), {});
      return;
    }

    var h = '<div class="seg four">' + [['bolge', 'Bölgeye göre'], ['restoran', 'Restorana göre'], ['talep', 'Talebe göre'], ['gecik', 'Gecikenler']]
      .map(function (s) { return '<button data-g="' + s[0] + '" class="' + (S.view === s[0] ? 'on' : '') + '">' + s[1] + '</button>'; })
      .join('') + '</div>';

    if (pool.priority) {
      var left = Math.ceil((pool.priority.until - Date.now()) / 1000);
      if (left > 0) {
        h += '<div class="cnt live" id="pr" style="margin:10px 4px 0">⏱ Bu pakette seçim önceliğiniz: <b id="prt">' + UI.clock(left) + '</b></div>';
      }
    }
    if (pool.capacity && pool.capacity.locked) {
      h += '<div class="pk-warn" style="margin:10px 4px 0">Paket limitiniz doldu (' + pool.capacity.limit +
        '). Aktif paketleriniz teslim edilene kadar yeni iş alamazsınız.</div>';
    }

    function groupHead(title, packages) {
      var ids = packages.map(function (p) { return p.id; });
      var all = ids.every(function (id) { return S.sel[id]; });
      return '<div class="ghead"><span class="gname">' + esc(title) + '</span>' +
        '<span class="gcount">' + packages.length + ' paket</span>' +
        '<button class="gsel' + (all ? ' on' : '') + '" data-gsel="' + ids.join(',') + '" title="Tümünü seç">✓</button></div>';
    }

    function row(p) {
      var checked = S.sel[p.id] ? ' checked' : '';
      return '<label class="row"><input type="checkbox" data-i="' + p.id + '"' + checked + '>' +
        '<div><b>Paket ' + p.number + ' · ' + esc(p.restaurant) + '</b>' +
        '<small>Talep #' + p.batch + '-' + p.number + ' · ' + esc(p.region || '') + '</small></div>' +
        '<span class="tag' + (p.payment === 'Kart' ? ' ac' : '') + '">' + esc(p.payment || '') + '</span></label>';
    }

    if (S.view === 'sira') {
      L.sort(function (a, b) { return a.id - b.id; });
      h += '<div class="card" style="margin-top:12px">' + L.map(row).join('') + '</div>';
    } else if (S.view === 'talep') {
      var gT = {};
      L.forEach(function (p) { (gT[p.batch] = gT[p.batch] || []).push(p); });
      Object.keys(gT).sort(function (a, b) { return Number(b) - Number(a); }).forEach(function (k) {
        var arr = gT[k];
        h += '<div class="gcard">' + groupHead('Talep #' + k, arr) + arr.map(row).join('') + '</div>';
      });
    } else if (S.view === 'restoran') {
      var gR = {};
      L.forEach(function (p) { (gR[p.restaurant] = gR[p.restaurant] || []).push(p); });
      Object.keys(gR).sort().forEach(function (name) {
        var A = gR[name];
        h += '<div class="gcard">' + groupHead(name, A) + A.map(row).join('') + '</div>';
      });
    } else if (S.view === 'gecik') {
      var nowSec = Date.now() / 1000;
      var late = L.filter(function (p) { return p.created_at && nowSec - p.created_at >= 600; })
        .sort(function (a, b) { return a.created_at - b.created_at; });
      var rset = {};
      late.forEach(function (p) { rset[p.restaurant] = 1; });
      h += '<div class="card" style="padding:10px;margin-top:10px;font-size:13px"><b>' +
        Object.keys(rset).length + ' restorandan ' + late.length +
        ' paket 10 dakikayı aşan süredir teslim alınmadı.</b></div>' +
        '<div class="filters" style="margin-top:8px">' +
        '<button class="sm ' + (S.lateGroup === 'region' ? 'p' : '') + '" data-lg="region">Bölgeye göre</button>' +
        '<button class="sm ' + (S.lateGroup === 'restaurant' ? 'p' : '') + '" data-lg="restaurant">Restorana göre</button></div>';
      if (!late.length) {
        h += '<div class="empty">10 dakikayı geçen paket yok.</div>';
      } else if (!S.lateGroup) {
        h += '<div class="gcard">' + late.map(row).join('') + '</div>';
      } else {
        var gl = {};
        late.forEach(function (p) { var k = p[S.lateGroup] || 'Belirtilmedi'; (gl[k] = gl[k] || []).push(p); });
        Object.keys(gl).sort().forEach(function (k) {
          h += '<div class="gcard">' + groupHead(k, gl[k]) + gl[k].map(row).join('') + '</div>';
        });
      }
    } else {
      var k1 = 'region', g = {};
      L.forEach(function (p) { (g[p[k1]] = g[p[k1]] || []).push(p); });
      Object.keys(g).forEach(function (a) {
        var A = g[a];
        h += '<div class="gcard">' + groupHead(a, A) + A.map(row).join('') + '</div>';
      });
    }
    var perRest = {};
    L.forEach(function (p) { perRest[p.restaurant] = (perRest[p.restaurant] || 0) + 1; });
    var cap = pool.capacity ? pool.capacity.limit : 0;
    h += '<div class="card" style="padding:12px;margin-top:12px">' +
      '<b>Toplam havuzda ' + Object.keys(perRest).length + ' restorandan ' + L.length + ' paket beklemektedir.</b>' +
      Object.keys(perRest).sort().map(function (name) {
        return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--ln)">' +
          '<span>' + esc(name) + '</span><b>' + perRest[name] + ' paket</b></div>';
      }).join('') +
      '<p class="hint" style="margin:8px 0 0">Seçim yapmak için sipariş kartlarından seçin. En fazla ' + cap + ' paket alınabilir.</p>' +
      '</div>';

    main.innerHTML = h;
    Array.prototype.forEach.call(main.querySelectorAll('button[data-g]'), function (b) {
      b.onclick = function () { S.view = b.getAttribute('data-g'); render(); };
    });
    Array.prototype.forEach.call(main.querySelectorAll('button[data-lg]'), function (b) {
      b.onclick = function () {
        var g = b.getAttribute('data-lg');
        S.lateGroup = S.lateGroup === g ? '' : g;
        render();
      };
    });
    Array.prototype.forEach.call(main.querySelectorAll('button[data-gsel]'), function (b) {
      b.onclick = function () {
        var ids = b.getAttribute('data-gsel').split(',').map(Number);
        var all = ids.every(function (id) { return S.sel[id]; });
        ids.forEach(function (id) { if (all) delete S.sel[id]; else S.sel[id] = 1; });
        render();
      };
    });
    Array.prototype.forEach.call(main.querySelectorAll('input[data-i]'), function (i) {
      i.onchange = function () {
        if (i.checked) S.sel[i.getAttribute('data-i')] = 1; else delete S.sel[i.getAttribute('data-i')];
        cta();
      };
    });
    cta();
    nav(courierTabs(), { havuz: L.length, paketlerim: (S.mine && S.mine.packages ? S.mine.packages.length : 0) });
  }

  function cta() {
    var c = $('cta');
    var n = Object.keys(S.sel).length;
    if (!n) { c.innerHTML = ''; return; }
    c.innerHTML = '<div class="cta"><button class="p" id="kb">' + n + ' paketi kabul et</button></div>';
    $('kb').onclick = function () {
      var ids = Object.keys(S.sel).map(Number);
      API.kabul(ids).then(function (r) {
        S.sel = {};
        if (r.accepted && r.accepted.length) UI.toast(r.accepted.length + ' paket kabul edildi', 'success');
        if (r.missed && r.missed.length) UI.toast(r.missed.length + ' paket başka kuryeye alındı', 'error');
        TG.haptic('success');
        S.tab = 'paketlerim';
        S.mineView = 'list';
        refresh(true);
      }).catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
    };
  }

  /* ---------------- KURYE: AÇIK PAKETLER ---------------- */
  function pkgCard(p, opts) {
    opts = opts || {};
    var st = { t: p.status };
    // Eylemler durum etiketine değil kayıt alanlarına göre belirlenir (etiket sunucudan gelir).
    var cancelled = !!p.cancelled_at, delivered = !!p.delivered_at, picked = !!p.picked_up_at;
    var mapBtn = !cancelled && !delivered && !picked
      ? '<button class="btn" data-a="harita" data-i="' + p.id + '">Haritada Aç</button>' : '';
    var callBtn = !delivered && !cancelled && p.restaurant_phone
      ? '<a class="btn" href="tel:' + esc(p.restaurant_phone) + '">Restoranı Ara</a>' : '';
    var actions = '';
    if (opts.own && !cancelled && !delivered) {
      if (!picked) {
        actions = mapBtn + callBtn + '<button class="p w" data-a="km" data-i="' + p.id + '">Km gir · teslim aldım</button>';
      } else {
        actions = callBtn + '<button class="p w" data-a="teslim" data-i="' + p.id + '">Teslim ettim</button>';
      }
      actions += '<button class="w" data-a="aktar" data-i="' + p.id + '">Aktar</button>' +
                 '<button class="d w" data-a="iptal" data-i="' + p.id + '">İptal et</button>';
    }
    if (opts.pay && !cancelled && delivered && p.payment_received !== true) {
      actions += '<button class="p w" data-a="odeme" data-i="' + p.id + '">Ödeme Aldım</button>';
    }
    var warn = (S.kmPending && opts.own) ? '<div class="pk-warn">Km girişi bekleniyor. Önce km girişini tamamlayın.</div>' : '';
    return '<div class="pk">' +
      '<div class="pk-hd"><b>' + esc(p.restaurant) + '</b><em class="lb r">' + esc(p.region || '—') + '</em>' +
        UI.statusTag(p.status) + '</div>' +
      '<div class="pk-bd"><dl class="pk-fields">' +
        '<dt>Sipariş no</dt><dd>Talep #' + p.batch + '-' + p.number + '</dd>' +
        '<dt>Restoran</dt><dd>' + esc(p.restaurant) + '</dd>' +
        '<dt>Bölge</dt><dd>' + esc(p.region || '—') + '</dd>' +
        '<dt>Ödeme</dt><dd>' + esc(p.payment || '—') + '</dd>' +
        '<dt>Yetkili</dt><dd>' + esc(p.restaurant_contact || '—') + '</dd>' +
        '<dt>Kabul</dt><dd>' + dt(p.accepted_at) + '</dd>' +
        '<dt>Alım</dt><dd>' + dt(p.picked_at) + '</dd>' +
        '<dt>Teslim</dt><dd>' + dt(p.delivered_at) + '</dd>' +
        '<dt>Mesafe</dt><dd>' + (p.distance_km == null ? '—' : kmf(p.distance_km)) + '</dd>' +
        '<dt>Paket ücreti</dt><dd>' + (p.fee_tl == null ? '—' : money(p.fee_tl)) + '</dd>' +
        '<dt>Ödeme (hakediş)</dt><dd>' + (p.payment_received === true ? 'Alındı' : p.payment_received === false ? 'Alınmadı' : '—') + '</dd>' +
        '<dt>Durum</dt><dd>' + esc(st.t) + '</dd>' +
        '<dt>Kurye</dt><dd>' + esc(p.courier_name || '—') + '</dd>' +
      '</dl>' + (p.transfer_from ? '<p class="note">Aktarma bilgisi: önceki kurye ' + esc(p.transfer_from) + '</p>' : '') + warn + '</div>' +
      (actions ? '<div class="pk-ft">' + actions + '</div>' : '') +
    '</div>';
  }

  function bindPkgActions(root, list) {
    Array.prototype.forEach.call(root.querySelectorAll('button[data-a]'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a'), id = b.getAttribute('data-i');
        var p = (list || []).filter(function (x) { return String(x.id) === String(id); })[0] || findPkg(id);
        if (a === 'harita') {
          if (p && p.map_url) TG.openLink(p.map_url);
          else if (p) TG.map((p.restaurant || '') + ' ' + (p.region || ''));
        } else if (a === 'km') kmSheet(findPkg(id));
        else if (a === 'teslim') deliverConfirm(p);
        else if (a === 'odeme') {
          confirmSheet('#' + p.batch + '-' + p.number + ' için ödeme alındı olarak işaretlensin mi?', function () {
            API.odeme([Number(id)], false).then(function () {
              UI.closeSheet(); UI.toast('Ödeme alındı olarak kaydedildi', 'success'); refresh(true);
            }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
          });
        }
 else if (a === 'aktar') transferSheet(findPkg(id));
        else if (a === 'iptal') cancelSheet(findPkg(id));
      };
    });
  }
  function deliverConfirm(p) {
    if (!p) { UI.toast('Paket bulunamadı, listeyi yenileyin', 'error'); return; }
    var sh = UI.openSheet(
      '<h2>Teslim onayı</h2>' +
      '<p><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) + '</b><br>' +
      (p.fee_tl == null ? '' : 'Kurye ücreti: <b>' + money(p.fee_tl) + '</b><br>') +
      'Paketi teslim ettiniz. <b>Ödemeyi aldınız mı?</b></p>' +
      '<button class="p" id="dv-paid">Evet, ödemeyi aldım</button>' +
      '<button class="p" id="dv-unpaid" style="margin-top:6px;background:var(--t2)">Hayır, ödeme almadım</button>' +
      '<button class="d" id="dv-no" style="margin-top:6px">Vazgeç</button>');
    sh.querySelector('#dv-no').onclick = function () { UI.closeSheet(); };
    function send(paid) {
      sh.querySelector('#dv-paid').disabled = true;
      sh.querySelector('#dv-unpaid').disabled = true;
      API.teslim(p.id, paid).then(function () {
        UI.closeSheet();
        TG.haptic('success');
        UI.toast(paid ? 'Teslim edildi · ödeme alındı' : 'Teslim edildi · ödeme alınmadı', 'success');
        refresh(true);
      }).catch(function (e) {
        sh.querySelector('#dv-paid').disabled = false;
        sh.querySelector('#dv-unpaid').disabled = false;
        UI.toast(e.message || 'İşlem başarısız', 'error');
      });
    }
    sh.querySelector('#dv-paid').onclick = function () { send(true); };
    sh.querySelector('#dv-unpaid').onclick = function () { send(false); };
  }

  function findPkg(id) {
    var all = (S.pool ? S.pool.packages : []).concat(S.mine ? S.mine.packages : [], S.history ? S.history.items : []);
    return all.filter(function (p) { return String(p.id) === String(id); })[0];
  }

  function renderPaketlerim() {
    var mine = S.mine || { packages: [], summary: { active: 0, waiting_km: 0, rows: [] } };
    var L = mine.packages || [];
    setHeader('Açık Paketler', L.length + ' aktif iş');
    var main = $('mn');
    if (!L.length) {
      main.innerHTML = offersBanner() + '<div class="empty"><b>Açık paketiniz yok</b>Havuzdan paket alabilirsiniz.</div>';
    } else {
      main.innerHTML = offersBanner() +
        '<div class="card" style="padding:12px;margin-top:10px">' +
          '<div style="font-size:13px;color:var(--t2)">Aktif ' + (mine.summary.active || 0) +
          ' · Km bekleyen ' + (mine.summary.waiting_km || 0) + '</div></div>' +
        '<div class="card" style="margin-top:10px">' + L.map(function (p) {
          var state = p.picked_up_at ? 'Yolda' : 'Km bekliyor';
          return '<button class="prow" data-open="' + p.id + '">' +
            '<span><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) + '</b>' +
            '<small>' + esc(p.region || '') + ' · ' + esc(p.payment || '') + ' · ' + state + '</small></span>' +
            '<em>' + (p.fee_tl == null ? '' : money(p.fee_tl)) + '</em></button>';
        }).join('') + '</div>';
    }
    Array.prototype.forEach.call(main.querySelectorAll('button[data-ofs]'), function (b) { b.onclick = offersSheet; });
    Array.prototype.forEach.call(main.querySelectorAll('button[data-open]'), function (b) {
      b.onclick = function () { openPkg(Number(b.getAttribute('data-open'))); };
    });
    $('cta').innerHTML = '';
    nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0, paketlerim: L.length });
  }

  function openPkg(id) {
    var p = findPkg(id);
    if (!p) return;
    var sh = UI.openSheet(pkgCard(p, { own: true }), { onClose: function () { render(); } });
    bindPkgActions(sh, [p]);
  }

  function dayBounds(offset) {
    var now = new Date();
    var tr = new Date(now.getTime() + 3 * 3600 * 1000);
    var startUtc = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate() - offset) / 1000 - 3 * 3600;
    return [startUtc, startUtc + 86400];
  }

  function renderGecmis() {
    var items = (S.history && S.history.items) || [];
    var bounds = null;
    if (S.histDate) {
      bounds = [Math.floor(Date.parse(S.histDate + 'T00:00:00+03:00') / 1000), Math.floor(Date.parse(S.histDate + 'T00:00:00+03:00') / 1000) + 86400];
    } else if (S.histRange !== 'all') {
      bounds = dayBounds(S.histRange === 'today' ? 0 : 1);
    }
    if (bounds) {
      items = items.filter(function (p) {
        var t = p.cancelled_at || p.delivered_at || p.created_at || 0;
        return t >= bounds[0] && t < bounds[1];
      });
    }
    setHeader('Geçmiş', items.length + ' kayıt');
    var main = $('mn');
    var rseg = '<div class="seg two">' +
      '<button data-hmode="list" class="' + (!S.histPay ? 'on' : '') + '">Paketler</button>' +
      '<button data-hmode="pay" class="' + (S.histPay ? 'on' : '') + '">Ödeme</button></div>' +
      '<div class="seg three" style="margin-top:6px">' + [['today', 'Bugün'], ['yesterday', 'Dün'], ['all', 'Tümü']].map(function (r) {
      return '<button data-r="' + r[0] + '" class="' + (!S.histDate && S.histRange === r[0] ? 'on' : '') + '">' + r[1] + '</button>';
    }).join('') + '</div>' +
      '<div class="filters" style="margin-top:8px"><input type="date" id="hdate" value="' + esc(S.histDate) + '"></div>';
    if (S.histPay) {
      items = items.filter(function (p) { return p.delivered_at && !p.cancelled_at && p.payment_received !== true; });
    }
    var unpaid = items.filter(function (p) { return p.delivered_at && !p.cancelled_at && p.payment_received !== true; });
    var payBar = (S.histPay && unpaid.length) ? '<div class="filters" style="margin-top:6px">' +
      '<button class="p sm" id="pay-sel">Seçilenleri Ödeme Alındı</button>' +
      '<button class="sm" id="pay-all">Tümünü Ödeme Alındı (' + unpaid.length + ')</button></div>' : '';
    var body = items.length ? '<div class="card">' + items.map(function (p) {
      var isUnpaid = S.histPay && p.delivered_at && !p.cancelled_at && p.payment_received !== true;
      return '<div class="hrow">' + (isUnpaid ? '<input type="checkbox" data-pay="' + p.id + '">' : '<span class="hgap"></span>') +
        '<button class="prow" data-hopen="' + p.id + '"><span><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) + '</b>' +
        '<small>' + esc(p.region || '') + ' · ' + esc(p.status) + ' · ' + dt(p.delivered_at || p.cancelled_at) +
        (p.payment_received === true ? ' · ödeme alındı' : p.payment_received === false ? ' · ödeme alınmadı' : '') + '</small></span>' +
        '<em>' + (p.fee_tl == null ? '' : money(p.fee_tl)) + '</em></button></div>';
    }).join('') + '</div>' : '<div class="empty"><b>Kayıt yok</b>Bu aralıkta tamamlanan/iptal edilen iş bulunmuyor.</div>';
    main.innerHTML = rseg + payBar + body;
    Array.prototype.forEach.call(main.querySelectorAll('[data-hmode]'), function (b) {
      b.onclick = function () { S.histPay = b.getAttribute('data-hmode') === 'pay'; S.paySel = {}; render(); };
    });
    function selCount() { return Object.keys(S.paySel).filter(function (k) { return S.paySel[k]; }).length; }
    Array.prototype.forEach.call(main.querySelectorAll('[data-pay]'), function (c) {
      c.checked = !!S.paySel[c.getAttribute('data-pay')];
      c.onchange = function () {
        var id = c.getAttribute('data-pay');
        if (c.checked) S.paySel[id] = 1; else delete S.paySel[id];
        var btn = main.querySelector('#pay-sel');
        if (btn) btn.textContent = 'Seçilenleri Ödeme Alındı (' + selCount() + ')';
      };
    });
    var paySelBtn = main.querySelector('#pay-sel');
    if (paySelBtn) paySelBtn.onclick = function () {
      var ids = Object.keys(S.paySel).filter(function (k) { return S.paySel[k]; }).map(Number);
      if (!ids.length) { UI.toast('Paket seçin', 'error'); return; }
      confirmSheet(ids.length + ' paket için ödeme alındı olarak işaretlensin mi?', function () {
        API.odeme(ids, false).then(function (r) {
          S.paySel = {}; UI.closeSheet(); UI.toast((r.count || 0) + ' paket ödeme alındı', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
      });
    };
    var payAllBtn = main.querySelector('#pay-all');
    if (payAllBtn) payAllBtn.onclick = function () {
      confirmSheet(unpaid.length + ' paketin tamamı ödeme alındı olarak işaretlensin mi?', function () {
        API.odeme([], true).then(function (r) {
          S.paySel = {}; UI.closeSheet(); UI.toast((r.count || 0) + ' paket ödeme alındı', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
      });
    };
    Array.prototype.forEach.call(main.querySelectorAll('[data-r]'), function (b) {
      b.onclick = function () { S.histRange = b.getAttribute('data-r'); S.histDate = ''; render(); };
    });
    $('hdate').onchange = function () { S.histDate = $('hdate').value; render(); };
    Array.prototype.forEach.call(main.querySelectorAll('[data-hopen]'), function (b) {
      b.onclick = function () {
        var p = items.filter(function (x) { return String(x.id) === b.getAttribute('data-hopen'); })[0];
        if (!p) return;
        var sh = UI.openSheet(pkgCard(p, { pay: true }), { onClose: function () { render(); } });
        bindPkgActions(sh, [p]);
      };
    });
    $('cta').innerHTML = '';
    nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0 });
  }

  function renderKazanc() {
    var e = S.earnings || { total_tl: 0, count: 0, total_km: 0 };
    setHeader('Kazançlarım', e.period || '');
    var seg = '<div class="seg three">' + [['today', 'Bugün'], ['yesterday', 'Dün'], ['all', 'Tümü']].map(function (r) {
      return '<button data-kr="' + r[0] + '" class="' + (!S.kazancDate && S.kazancRange === r[0] ? 'on' : '') + '">' + r[1] + '</button>';
    }).join('') + '</div>' +
      '<div class="filters" style="margin-top:8px"><input type="date" id="kdate" value="' + esc(S.kazancDate) + '"></div>';
    var items = (e.items || []);
    var paidSeg = '<div class="seg three" style="margin-top:6px">' + [['all', 'Tümü'], ['paid', 'Ödeme alındı'], ['unpaid', 'Ödeme alınmadı']].map(function (v) {
      return '<button data-kp="' + v[0] + '" class="' + (S.kazancPaid === v[0] ? 'on' : '') + '">' + v[1] + '</button>';
    }).join('') + '</div>';
    var shown = items.filter(function (p) {
      if (S.kazancPaid === 'paid') return p.payment_received === true;
      if (S.kazancPaid === 'unpaid') return p.payment_received !== true;
      return true;
    });
    var listHtml = shown.length ? '<div class="card" style="margin-top:10px">' + shown.map(function (p) {
      return '<button class="prow" data-kopen="' + p.id + '"><span><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) + '</b>' +
        '<small>' + esc(p.region || '') + ' · ' + dt(p.delivered_at) + ' · ' +
        (p.payment_received === true ? 'ödeme alındı' : p.payment_received === false ? 'ödeme alınmadı' : 'ödeme —') + '</small></span>' +
        '<em>' + (p.fee_tl == null ? '' : money(p.fee_tl)) + '</em></button>';
    }).join('') + '</div>' : '<div class="empty">Bu dönemde paket yok.</div>';
    $('mn').innerHTML = seg + paidSeg +
      '<div class="krow">' +
        '<div class="big"><span>Toplam hakediş</span><div>' + money(e.total_tl) + '</div></div>' +
        '<div class="big"><span>Teslim paket</span><div>' + (e.count || 0) + '</div></div>' +
        '<div class="big"><span>Toplam km</span><div>' + (Math.round((e.total_km || 0) * 10) / 10) + '</div></div>' +
      '</div>';
    $('mn').innerHTML += listHtml;
    Array.prototype.forEach.call($('mn').querySelectorAll('[data-kr]'), function (b) {
      b.onclick = function () { S.kazancRange = b.getAttribute('data-kr'); S.kazancDate = ''; loadKazanc(); };
    });
    Array.prototype.forEach.call($('mn').querySelectorAll('[data-kp]'), function (b) {
      b.onclick = function () { S.kazancPaid = b.getAttribute('data-kp'); renderKazanc(); };
    });
    Array.prototype.forEach.call($('mn').querySelectorAll('[data-kopen]'), function (b) {
      b.onclick = function () {
        var p = items.filter(function (x) { return String(x.id) === b.getAttribute('data-kopen'); })[0];
        if (!p) return;
        var sh = UI.openSheet(pkgCard(p, { pay: true }), { onClose: function () { renderKazanc(); } });
        bindPkgActions(sh, [p]);
      };
    });
    $('kdate').onchange = function () { S.kazancDate = $('kdate').value; loadKazanc(); };
    $('cta').innerHTML = '';
    nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0 });
  }

  function loadKazanc() {
    API.kazanc(S.kazancRange, S.kazancDate).then(function (r) { S.earnings = r; renderKazanc(); }).catch(function () {});
  }

  /* ---------------- KM / İPTAL / AKTAR ---------------- */
  function kmSheet(p) {
    if (!p) return;
    S.kmPending = true;
    var base = (S.session && S.session.settings) ? S.session.settings : {};
    var tariff = base.tariff || [120, 150, 190, 240, 300, 370, 450, 540, 640];
    var sh = UI.openSheet(
      '<h2>Teslim aldım · #' + p.batch + '-' + p.number + '</h2>' +
      '<p>Teslimat mesafesini kilometre olarak girin.</p>' +
      '<input id="kmin" type="number" inputmode="decimal" step="0.1" min="0" placeholder="Örn. 3,5">' +
      '<div class="err" id="kerr"></div><div id="kpv"></div>' +
      '<button class="p" id="kok">Onayla</button>' +
      '<button class="d" id="kback">Vazgeç</button>',
      { onClose: function () { S.kmPending = false; render(); } }
    );
    var input = sh.querySelector('#kmin');
    var err = sh.querySelector('#kerr');
    var pv = sh.querySelector('#kpv');
    function calc() {
      err.textContent = '';
      var v = parseFloat(String(input.value).replace(',', '.'));
      if (!(v > 0)) { pv.innerHTML = ''; return; }
      pv.innerHTML = '<p>Bu paketten alacağınız: <b>' + API.feePreview(tariff, v) + '</b></p>';
    }
    input.oninput = calc;
    sh.querySelector('#kback').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#kok').onclick = function () {
      var v = parseFloat(String(input.value).replace(',', '.'));
      if (!(v > 0)) { err.textContent = 'Geçerli bir kilometre girin'; return; }
      API.kmGir(p.id, v).then(function (r) {
        UI.closeSheet();
        UI.toast('Kazanç hesaplandı: ' + money(r.fee_tl), 'success');
        refresh(true);
      }).catch(function (e) { err.textContent = e.message || 'Kaydedilemedi'; });
    };
    setTimeout(function () { input.focus(); }, 60);
  }

  function cancelSheet(p) {
    if (!p) return;
    var reasons = (S.session && S.session.settings && S.session.settings.reasons) ||
      ['Müşteri iptal etti', 'Adres yanlış', 'Restoran kapandı', 'Gecikme', 'Paket hasarlı', 'Müşteriye ulaşılamadı', 'Diğer'];
    var sh = UI.openSheet(
      '<h2>İptal gerekçesi · #' + p.batch + '-' + p.number + '</h2>' +
      '<p>Bir gerekçe seçin. İptal kuralı sunucuda uygulanır.</p>' +
      reasons.map(function (r, i) { return '<button class="opt" data-n="' + i + '">' + esc(r) + '</button>'; }).join(''),
      { onClose: function () { render(); } }
    );
    Array.prototype.forEach.call(sh.querySelectorAll('button[data-n]'), function (b) {
      b.onclick = function () {
        var reason = reasons[Number(b.getAttribute('data-n'))];
        API.iptal(p.id, reason).then(function (r) {
          UI.closeSheet();
          UI.toast(r.fee_tl ? 'İptal edildi · ücret: ' + money(r.fee_tl) : 'Sipariş iptal edildi', 'success');
          refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
      };
    });
  }

  function confirmSheet(text, onYes) {
    var sh = UI.openSheet('<h2>Onay</h2><p>' + text + '</p>' +
      '<button class="p" id="cf-ok">Evet, onaylıyorum</button>' +
      '<button class="d" id="cf-no">Vazgeç</button>');
    sh.querySelector('#cf-no').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#cf-ok').onclick = function () { sh.querySelector('#cf-ok').disabled = true; onYes(); };
    return sh;
  }

  function transferSheet(p) {
    if (!p) return;
    var count = (S.mine && S.mine.packages) ? S.mine.packages.length : 1;
    var sh = UI.openSheet(
      '<h2>Aktar · #' + p.batch + '-' + p.number + '</h2>' +
      '<p>Paketi havuza bırakabilir veya uygun bir kuryeye teklif edebilirsiniz.</p>' +
      '<button class="p" id="tr-pool">Bu paketi havuza ver</button>' +
      '<button class="p" id="tr-cour" style="margin-top:8px">Bu paketi kuryeye aktar</button>' +
      (count > 1 ? '<button class="p" id="tr-allpool" style="margin-top:8px">Tümünü havuza aktar (' + count + ')</button>' +
        '<button class="p" id="tr-allcour" style="margin-top:8px">Tümünü kuryeye aktar (' + count + ')</button>' : '') +
      '<button class="d" id="tr-no">Vazgeç</button>',
      { onClose: function () { render(); } }
    );
    sh.querySelector('#tr-no').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#tr-pool').onclick = function () {
      confirmSheet('#' + p.batch + '-' + p.number + ' paketi havuza geri verilsin mi?', function () {
        API.aktar(p.id, { hedef: 'havuz' }).then(function () {
          UI.closeSheet(); UI.toast('Paket havuza geri verildi', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
      });
    };
    var allPool = sh.querySelector('#tr-allpool'); if (allPool) allPool.onclick = function () {
      confirmSheet('Üzerinizdeki ' + count + ' paketin tamamı havuza verilsin mi?', function () {
        API.aktarTumu({ hedef: 'havuz' }).then(function (r) {
          UI.closeSheet(); UI.toast(r.message || 'Havuza aktarıldı', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'Aktarılamadı', 'error'); });
      });
    };
    var allCour = sh.querySelector('#tr-allcour'); if (allCour) allCour.onclick = function () {
      API.aktarimKuryeler().then(function (r) {
        var list = r.couriers || [];
        if (!list.length) { UI.toast('Aktarım için uygun kurye yok', 'error'); return; }
        UI.closeSheet();
        var sh3 = UI.openSheet('<h2>Tümünü aktar · kurye seç</h2>' + list.map(function (c) {
          return '<button class="opt" data-ac="' + c.id + '">' + esc(c.name) + '</button>';
        }).join(''), { onClose: function () { render(); } });
        Array.prototype.forEach.call(sh3.querySelectorAll('[data-ac]'), function (b) {
          b.onclick = function () {
            var cname = b.innerText;
            confirmSheet('Üzerinizdeki ' + count + ' paketin tamamı <b>' + esc(cname) + '</b> kuryesine aktarılsın mı?', function () {
              API.aktarTumu({ hedef: 'kurye', courier_id: Number(b.getAttribute('data-ac')) }).then(function (r) {
                UI.closeSheet(); UI.toast(r.message || 'Teklif gönderildi', 'success'); refresh(true);
              }).catch(function (e) { UI.toast(e.message || 'Aktarılamadı', 'error'); });
            });
          };
        });
      }).catch(function (e) { UI.toast(e.message || 'Kurye listesi alınamadı', 'error'); });
    };
    sh.querySelector('#tr-cour').onclick = function () {
      API.aktarimKuryeler().then(function (r) {
        var list = r.couriers || [];
        if (!list.length) { UI.toast('Aktarım için uygun kurye yok', 'error'); return; }
        UI.closeSheet();
        var sh2 = UI.openSheet('<h2>Kurye seç · #' + p.batch + '-' + p.number + '</h2>' +
          list.map(function (c) { return '<button class="opt" data-c="' + c.id + '">' + esc(c.name) + '</button>'; }).join(''),
          { onClose: function () { render(); } });
        Array.prototype.forEach.call(sh2.querySelectorAll('[data-c]'), function (b) {
          b.onclick = function () {
            var cname = b.innerText;
            confirmSheet('#' + p.batch + '-' + p.number + ' paketi <b>' + esc(cname) + '</b> kuryesine aktarılsın mı?', function () {
              API.aktar(p.id, { hedef: 'kurye', courier_id: Number(b.getAttribute('data-c')) }).then(function (r) {
                UI.closeSheet(); UI.toast(r.message || 'Teklif gönderildi', 'success'); refresh(true);
              }).catch(function (e) { UI.toast(e.message || 'Aktarılamadı', 'error'); });
            });
          };
        });
      }).catch(function (e) { UI.toast(e.message || 'Kurye listesi alınamadı', 'error'); });
    };
  }

  /* ---------------- RESTORAN ---------------- */
  function renderTalep() {
    setHeader('Talep Ver', '1–10 paket');
    var main = $('mn');
    if (!S.reqItems.length) S.reqItems = [{ region: '', payment: '' }];
    var regions = (S.session && S.session.settings && S.session.settings.regions) || [];
    main.innerHTML =
      '<div class="fld"><label>Paket sayısı</label><div class="stepper">' +
        '<button id="minus">−</button><span id="qty">' + S.reqItems.length + '</span><button id="plus">＋</button>' +
      '</div></div>' +
      S.reqItems.map(function (it, i) {
        var done = !!(it.region || it.payment);
        return '<div class="pkg-row' + (done ? ' done' : (i === 0 ? ' cur' : '')) + '">' +
          '<div class="hd"><b>' + (done ? '✓' : (i === 0 ? '▶' : '○')) + ' Paket ' + (i + 1) + '</b>' +
            '<span class="tag ac">#' + (i + 1) + '/' + S.reqItems.length + '</span></div>' +
          '<div class="fld"><label>Bölge (opsiyonel)</label>' +
            '<input data-region="' + i + '" value="' + esc(it.region || '') + '" placeholder="Bölge adı"></div>' +
          '<div class="fld"><label>Ödeme (opsiyonel)</label><select data-payment="' + i + '">' +
              '<option value="">— seçin —</option>' +
              (S.session && S.session.settings && S.session.settings.payments || ['Nakit', 'Kart', 'Ödendi'])
                .map(function (r) { return '<option' + (it.payment === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') +
            '</select></div>' +
            (regions.length ? '<div class="hint">Bölge listesi: ' + esc(regions.join(', ')) + '</div>' : '') +
          '</div></div>';
      }).join('') +
      '<p class="hint">Sıradaki paket ▶ ile işaretlenir, tamamlanan satır ✓ olur.</p>' +
      '<button class="p" id="req-send" style="width:100%;margin-top:6px">Talebi havuza at</button>';

    main.querySelector('#minus').onclick = function () {
      if (S.reqItems.length > 1) { S.reqItems.pop(); render(); }
    };
    main.querySelector('#plus').onclick = function () {
      if (S.reqItems.length < 10) { S.reqItems.push({ region: '', payment: '' }); render(); }
    };
    Array.prototype.forEach.call(main.querySelectorAll('[data-region]'), function (inp) {
      inp.oninput = function () { S.reqItems[Number(inp.getAttribute('data-region'))].region = inp.value; };
      inp.onchange = function () { render(); };
    });
    Array.prototype.forEach.call(main.querySelectorAll('[data-payment]'), function (inp) {
      inp.onchange = function () { S.reqItems[Number(inp.getAttribute('data-payment'))].payment = inp.value; };
    });
    main.querySelector('#req-send').onclick = function () {
      API.talepVer(S.reqItems).then(function (r) {
        S.reqItems = [{ region: '', payment: '' }];
        UI.toast('Talep #' + r.req_no + ' · ' + r.count + ' paket havuza atıldı', 'success');
        S.tab = 'paketlerim';
        S.mineView = 'list';
        refresh(true);
      }).catch(function (e) { UI.toast(e.message || 'Gönderilemedi', 'error'); });
    };
    $('cta').innerHTML = '';
    nav(restaurantTabs(), {});
  }

  function renderRestPaketlerim() {
    setHeader('Paketlerim', '');
    var filters = [['all', 'Tümü'], ['waiting', 'Bekleyen'], ['active', 'Yolda (Aktif)'], ['delivered', 'Teslim Edilen'], ['unpaid', 'Ödeme Alınmadı']];
    var main = $('mn');
    var items = (S.restItems && S.restItems.items) || [];
    main.innerHTML = '<div class="seg four">' + filters.map(function (f) {
      return '<button data-f="' + f[0] + '" class="' + (S.restFilter === f[0] ? 'on' : '') + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
    (items.length ? items.map(function (p) {
      var callBtn = p.courier_name && p.courier_phone
        ? '<a class="btn" href="tel:' + esc(p.courier_phone) + '">Kuryeyi Ara</a>' : '';
      return '<div class="pk"><div class="pk-hd"><b>' + esc(p.restaurant) + '</b>' + UI.statusTag(p.status) + '</div>' +
        '<div class="pk-bd"><dl class="pk-fields">' +
        '<dt>Sipariş no</dt><dd>Talep #' + p.batch + '-' + p.number + '</dd>' +
        '<dt>Yetkili</dt><dd>' + esc(p.restaurant_contact || '—') + '</dd>' +
        '<dt>Bölge</dt><dd>' + esc(p.region || '—') + '</dd>' +
        '<dt>Ödeme</dt><dd>' + esc(p.payment || '—') + '</dd>' +
        '<dt>Kurye</dt><dd>' + esc(p.courier_name || '—') + '</dd>' +
        '<dt>Mesafe</dt><dd>' + (p.distance_km == null ? '—' : kmf(p.distance_km)) + '</dd>' +
        '<dt>Ücret</dt><dd>' + (p.fee_tl == null ? '—' : money(p.fee_tl)) + '</dd>' +
        '<dt>Ödeme (hakediş)</dt><dd>' + (p.payment_received === true ? 'Alındı' : p.payment_received === false ? 'Alınmadı' : '—') + '</dd>' +
        '</dl></div>' + (callBtn ? '<div class="pk-ft">' + callBtn + '</div>' : '') + '</div>';
    }).join('') : '<div class="empty"><b>Kayıt yok</b>Bu filtrede paket bulunmuyor.</div>');
    Array.prototype.forEach.call(main.querySelectorAll('button[data-f]'), function (b) {
      b.onclick = function () { S.restFilter = b.getAttribute('data-f'); loadRest(); };
    });
    $('cta').innerHTML = '';
    nav(restaurantTabs(), {});
  }

  function renderProfil() {
    var u = (S.session && S.session.user) || {};
    var isRest = curRole() === 'restoran';
    var editing = !!S.profEdit;
    setHeader('Profil', isRest ? 'Restoran bilgileri' : 'Kurye bilgileri');
    var main = $('mn');
    var fields = editing
      ? '<div class="fld"><label>' + (isRest ? 'Restoran adı' : 'Ad Soyad') + '</label><input id="p-name" value="' + esc(u.name || '') + '"></div>' +
        (isRest ? '<div class="fld"><label>Yetkili adı</label><input id="p-contact" value="' + esc(u.contact_name || '') + '"></div>' : '') +
        '<div class="fld"><label>Telefon</label><input id="p-phone" inputmode="tel" value="' + esc(u.phone || '') + '" placeholder="0546 208 99 00"></div>' +
        '<div class="err" id="p-err"></div>'
      : '<dl class="pk-fields">' +
        '<dt>' + (isRest ? 'Restoran' : 'Ad Soyad') + '</dt><dd>' + esc(u.name || '—') + '</dd>' +
        (isRest ? '<dt>Yetkili</dt><dd>' + esc(u.contact_name || '—') + '</dd>' : '') +
        '<dt>Telefon</dt><dd>' + esc(u.phone || '—') + '</dd>' +
        '</dl>';
    var sw = (!isRest ? '<label class="hdr-sw" style="margin-right:auto"><input type="checkbox" id="p-online"' + (u.online ? ' checked' : '') + '><span>' + (u.online ? 'Açık' : 'Kapalı') + '</span></label>' : '');
    var actionRow = '<div class="acts" style="margin-top:12px;align-items:center">' + sw +
      (editing
        ? '<button class="p sm" id="p-save">Kaydet</button><button class="sm" id="p-cancel">İptal</button>'
        : '<button class="sm" id="p-edit">Düzenle</button>') + '</div>';
    main.innerHTML = '<div class="card oc" style="padding:12px">' + fields + actionRow + '</div>' +
      (!isRest ? '<p class="note" style="padding:10px 4px">Kurye paket sınırı: <b>' + (((S.session || {}).settings || {}).limit || '—') +
        '</b> paket · Yönetici tarafından belirlenir.</p>' : '');

    if (editing) {
      $('p-save').onclick = function () {
        var body = { name: $('p-name').value.trim(), phone: $('p-phone').value.trim() };
        if (isRest) body.contact_name = $('p-contact').value.trim();
        API.profil(body).then(function (r) {
          S.session.user = r.user;
          S.profEdit = false;
          UI.toast('Bilgiler kaydedildi', 'success');
          render();
        }).catch(function (e) { $('p-err').textContent = e.message || 'Kaydedilemedi'; });
      };
      $('p-cancel').onclick = function () { S.profEdit = false; render(); };
    } else {
      $('p-edit').onclick = function () { S.profEdit = true; render(); };
    }
    if (!isRest) {
      $('p-online').onchange = function () {
        var on = $('p-online').checked;
        API.durum(on).then(function () {
          S.session.user.online = on;
          UI.toast(on ? 'Çevrimiçi oldunuz' : 'Çevrimdışı oldunuz', 'success');
          refresh(true);
        }).catch(function (e) { $('p-online').checked = !on; UI.toast(e.message || 'Durum değişmedi', 'error'); });
      };
    }
    $('cta').innerHTML = '';
    nav(isRest ? restaurantTabs() : courierTabs(), {});
  }

  function offersBanner() {
    var offers = (S.offers || []);
    if (!offers.length) return '';
    return '<div class="card" style="padding:12px;margin-top:10px;border-color:var(--ac)">' +
      '<b>🔔 ' + offers.length + ' aktarım teklifi</b>' +
      '<button class="p" data-ofs style="width:100%;margin-top:8px">Teklifleri gör</button></div>';
  }

  function offersPopup() {
    var offers = S.offers || [];
    if (!offers.length) return;
    var html = '<div class="offerbox"><h2>🔔 ' + offers.length + ' paket aktarıldı</h2>' +
      '<p>Lütfen açık iş ilanlarını inceleyiniz.</p>' +
      offers.map(function (o) {
        return '<div class="offeritem"><b>#' + o.batch + '-' + o.number + ' · ' + esc(o.restaurant) + '</b>' +
          '<small>' + esc(o.region || '') + ' · Gönderen: ' + esc(o.from_name) + '</small>' +
          '<div class="act"><button class="sm p" data-oacc="' + o.token + '">Kabul</button>' +
          '<button class="sm d" data-orej="' + o.token + '">Reddet</button></div></div>';
      }).join('') + '</div>';
    var sh = UI.openSheet(html, { onClose: function () { render(); } });
    var ovl = document.getElementById('ovl');
    if (ovl) ovl.onclick = null;
    Array.prototype.forEach.call(sh.querySelectorAll('[data-oacc]'), function (b) {
      b.onclick = function () {
        API.aktarimKarar(b.getAttribute('data-oacc'), true).then(function () {
          UI.closeSheet(); UI.toast('Aktarım kabul edildi', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'Kabul edilemedi', 'error'); });
      };
    });
    Array.prototype.forEach.call(sh.querySelectorAll('[data-orej]'), function (b) {
      b.onclick = function () {
        API.aktarimKarar(b.getAttribute('data-orej'), false).then(function () {
          UI.closeSheet(); UI.toast('Teklif reddedildi', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'Reddedilemedi', 'error'); });
      };
    });
  }

  function offersSheet() {
    var offers = S.offers || [];
    if (!offers.length) return;
    var sh = UI.openSheet('<h2>Aktarım teklifleri</h2>' + offers.map(function (o) {
      return '<div class="card" style="margin:8px 0;padding:10px"><b>#' + o.batch + '-' + o.number + ' · ' + esc(o.restaurant) + '</b>' +
        '<small style="display:block;color:var(--t2)">Gönderen: ' + esc(o.from_name) + ' · ' + esc(o.region || '') + '</small>' +
        '<div class="act" style="margin-top:6px"><button class="sm p" data-acc="' + o.token + '">Kabul</button>' +
        '<button class="sm d" data-rej="' + o.token + '">Reddet</button></div></div>';
    }).join(''), { onClose: function () { render(); } });
    Array.prototype.forEach.call(sh.querySelectorAll('[data-acc]'), function (b) {
      b.onclick = function () {
        API.aktarimKarar(b.getAttribute('data-acc'), true).then(function () {
          UI.closeSheet(); UI.toast('Aktarım kabul edildi', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'Kabul edilemedi', 'error'); });
      };
    });
    Array.prototype.forEach.call(sh.querySelectorAll('[data-rej]'), function (b) {
      b.onclick = function () {
        API.aktarimKarar(b.getAttribute('data-rej'), false).then(function () {
          UI.closeSheet(); UI.toast('Teklif reddedildi', 'success'); refresh(true);
        }).catch(function (e) { UI.toast(e.message || 'Reddedilemedi', 'error'); });
      };
    });
  }

  function renderSistem() {
    setHeader('Sistem', 'Fiyatlandırma · Restoranlar · Kuryeler · Bölgeler · v10');
    var main = $('mn');
    var admin = S.session && S.session.role === 'yonetici';
    var seg = '<div class="seg four">' + [['fiyat', 'Fiyatlandırma'], ['restoran', 'Restoranlar'], ['kurye', 'Kuryeler'], ['bolge', 'Bölgeler'], ['log', 'Tanılama']].map(function (x) {
      return '<button data-st="' + x[0] + '" class="' + (S.sistemTab === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    function bindSeg() {
      Array.prototype.forEach.call(main.querySelectorAll('[data-st]'), function (b) {
        b.onclick = function () { S.sistemTab = b.getAttribute('data-st'); render(); };
      });
    }
    function draw() {
      var d = S.sistem;
      if (!d) { main.innerHTML = seg + '<div class="empty">Yükleniyor…</div>'; bindSeg(); return; }
      var body = '';
      if (S.sistemTab === 'fiyat') {
        var st = d.settings || {}, tariff = st.tariff || [], labels = st.tariff_intervals || [];
        body = '<div class="card" style="padding:12px"><b>Mesafe ücretleri (sabit)</b>' + tariff.map(function (v, i) {
          return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--ln);font-size:13px">' +
            '<span>' + esc(labels[i] || (i === 0 ? '0–3' : i + '. aralık')) + ' km</span><b>' + money(v) + '</b></div>';
        }).join('') + '</div>';
      } else if (S.sistemTab === 'log') {
        var logs = (API.logs ? API.logs() : []).slice(-60);
        body = '<div class="card" style="padding:12px;font-size:12px">' +
          '<div><b>Mod:</b> ' + (API.mode === 'real' ? 'CANLI' : 'MİMİK') + ' · <b>initData:</b> ' +
          (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? 'var' : 'YOK') + '</div>' +
          '<div><b>Son hata:</b> ' + esc(API.lastError || '—') + '</div></div>' +
          '<div class="card" style="padding:12px;font-size:12px;white-space:pre-wrap">' + (logs.length ? logs.map(esc).join('\n') : 'Kayıt yok.') + '</div>' +
          '<button class="p" id="log-send" style="width:100%;margin-top:8px">Sunucuya Gönder</button>';
      } else if (S.sistemTab === 'bolge') {
        body = '<div class="card">' + ((d.settings && d.settings.regions) || []).map(function (r, i) {
          return '<div class="row" style="cursor:default"><div><b>' + (i + 1) + '. ' + esc(r) + '</b></div></div>';
        }).join('') + '</div>';
      } else if (S.sistemTab === 'restoran') {
        body = '<div class="card">' + ((d.restaurants || []).length ? d.restaurants.map(function (r) {
          return '<div class="row" style="cursor:default"><div><b>' + esc(r.name) + '</b><small>' + esc(r.contact_name || '—') +
            (r.phone ? ' · ' + esc(r.phone) : '') + '</small></div><span class="acts">' +
            (r.phone ? '<a class="tel" href="tel:' + esc(r.phone) + '">📞</a>' : '') +
            (admin ? '<button class="sm" data-editr="' + r.id + '">Düzenle</button>' : '') + '</span></div>';
        }).join('') : '<div class="empty">Restoran yok</div>') + '</div>';
      } else {
        body = '<div class="card">' + ((d.couriers || []).length ? d.couriers.map(function (c) {
          return '<div class="row" style="cursor:default"><div><b>' + esc(c.name) + '</b><small>' +
            (c.online ? 'Online' : 'Offline') + (c.phone ? ' · ' + esc(c.phone) : '') + '</small></div><span class="acts">' +
            (c.phone ? '<a class="tel" href="tel:' + esc(c.phone) + '">📞</a>' : '') +
            (admin ? '<button class="sm" data-editc="' + c.id + '">Düzenle</button>' : '') + '</span></div>';
        }).join('') : '<div class="empty">Kurye yok</div>') + '</div>';
      }
      main.innerHTML = seg + body;
      bindSeg();
      function editSheet(row, role) {
        var sh = UI.openSheet('<h2>' + (role === 'restoran' ? 'Restoran' : 'Kurye') + ' düzenle</h2>' +
          '<div class="fld"><label>Ad</label><input id="se-name" value="' + esc(row.name || '') + '"></div>' +
          (role === 'restoran' ? '<div class="fld"><label>Yetkili</label><input id="se-contact" value="' + esc(row.contact_name || '') + '"></div>' : '') +
          '<div class="fld"><label>Telefon</label><input id="se-phone" inputmode="tel" value="' + esc(row.phone || '') + '"></div>' +
          '<div class="err" id="se-err"></div><button class="p" id="se-save">Kaydet</button>');
        sh.querySelector('#se-save').onclick = function () {
          var payload = { id: row.id, name: sh.querySelector('#se-name').value.trim(), phone: sh.querySelector('#se-phone').value.trim() };
          if (role === 'restoran') payload.contact_name = sh.querySelector('#se-contact').value.trim();
          API.yonetim('hesapGuncelle', payload).then(function () {
            UI.closeSheet(); UI.toast('Kaydedildi', 'success'); S.sistem = null; renderSistem();
          }).catch(function (e) { sh.querySelector('#se-err').textContent = e.message || 'Kaydedilemedi'; });
        };
      }
      var logSend = main.querySelector('#log-send');
      if (logSend) logSend.onclick = function () {
        API.sendLogs({ mode: API.mode, lastError: API.lastError, ua: navigator.userAgent }).then(function () {
          UI.toast('Log gönderildi', 'success');
        }).catch(function (e) { UI.toast(e.message || 'Gönderilemedi', 'error'); });
      };
      Array.prototype.forEach.call(main.querySelectorAll('[data-editc]'), function (b) {
        b.onclick = function () {
          var id = Number(b.getAttribute('data-editc'));
          editSheet((d.couriers || []).filter(function (x) { return x.id === id; })[0] || {}, 'kurye');
        };
      });
      Array.prototype.forEach.call(main.querySelectorAll('[data-editr]'), function (b) {
        b.onclick = function () {
          var id = Number(b.getAttribute('data-editr'));
          editSheet((d.restaurants || []).filter(function (x) { return x.id === id; })[0] || {}, 'restoran');
        };
      });
    }
    draw();
    if (!S.sistem) API.sistem().then(function (d) { S.sistem = d; draw(); }).catch(function (e) {
      main.innerHTML = seg + '<div class="empty">Yüklenemedi: ' + esc(e.message || '') + '</div>'; bindSeg();
    });
  }

  function renderLogs() {
    setHeader('Loglar', 'Tanılama');
    var logs = (API.logs ? API.logs() : []).slice(-60);
    var main = $('mn');
    main.innerHTML = '<div class="card" style="padding:12px;font-size:12px">' +
      '<div><b>Sürüm:</b> v10 · <b>Mod:</b> ' + (API.mode === 'real' ? 'CANLI' : 'MİMİK') + '</div>' +
      '<div><b>initData:</b> ' + (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? 'var (' + Telegram.WebApp.initData.length + ' bayt)' : 'YOK') + '</div>' +
      '<div><b>Son hata:</b> ' + esc(API.lastError || '—') + '</div>' +
      '<div style="margin-top:6px;color:var(--t2)">' + esc(navigator.userAgent.slice(0, 120)) + '</div></div>' +
      '<div class="card" style="padding:12px;font-size:12px;white-space:pre-wrap">' +
      (logs.length ? logs.map(esc).join('\n') : 'Kayıt yok.') + '</div>' +
      '<button class="p" id="log-send" style="width:100%;margin-top:8px">Sunucuya Gönder</button>' +
      '<button class="d" id="log-clear" style="width:100%;margin-top:6px">Temizle</button>';
    $('log-send').onclick = function () {
      API.sendLogs({ mode: API.mode, lastError: API.lastError, ua: navigator.userAgent }).then(function () {
        UI.toast('Log gönderildi', 'success');
      }).catch(function (e) { UI.toast(e.message || 'Gönderilemedi', 'error'); });
    };
    $('log-clear').onclick = function () { window.__kuryeLogs = []; render(); };
    $('cta').innerHTML = '';
    nav(curRole() === 'restoran' ? restaurantTabs() : courierTabs(), {});
  }

  /* ---------------- yönlendirme ---------------- */
  function renderIcons() {
    var hr = $('hdr-right');
    if (!hr) return;
    var role = curRole();
    if (role === 'yonetici') { hr.innerHTML = ''; return; }
    var unread = (S.notifs && S.notifs.unread) || 0;
    hr.innerHTML = '<span class="hicons">' +
      '<button class="ico" id="hdr-bell" title="Bildirimler">🔔' + (unread ? '<em>' + unread + '</em>' : '') + '</button></span>';
    $('hdr-bell').onclick = notifSheet;
    renderDrawer();
  }

  function assignmentPopup(items) {
    var sh = UI.openSheet('<div class="offerbox"><h2>📦 PAKET ATANDI</h2>' +
      '<p>Yönetici size paket atadı. Lütfen inceleyiniz.</p>' +
      items.map(function (n) { return '<div class="offeritem"><b>' + esc(n.text) + '</b></div>'; }).join('') +
      '<div class="act" style="margin-top:10px"><button class="sm d" id="as-rej">Reddet</button>' +
      '<button class="sm p" id="as-ok">Kabul Et</button></div></div>');
    var ovl = document.getElementById('ovl');
    if (ovl) ovl.onclick = null;
    function markRead() {
      var maxId = items.reduce(function (m, n) { return Math.max(m, n.id); }, 0);
      return API.bildirimOkundu(maxId).then(function () { S.notifs.unread = Math.max(0, (S.notifs.unread || 0) - items.length); }).catch(function () {});
    }
    sh.querySelector('#as-ok').onclick = function () {
      markRead().then(function () { UI.closeSheet(); UI.toast('Paketler kabul edildi', 'success'); refresh(true); });
    };
    sh.querySelector('#as-rej').onclick = function () {
      sh.querySelector('#as-rej').disabled = true;
      var refs = items.map(function (n) { return n.ref; }).filter(Boolean);
      Promise.all(refs.map(function (id) {
        return API.aktar(id, { hedef: 'havuz' }).catch(function () {});
      })).then(function () {
        return markRead();
      }).then(function () {
        UI.closeSheet(); UI.toast('Paketler reddedildi, havuza döndü', 'success'); refresh(true);
      });
    };
  }

  function notifSheet() {
    var items = (S.notifs && S.notifs.items) || [];
    var sh = UI.openSheet('<h2>Bildirimler</h2>' + (items.length ? items.map(function (n) {
      return '<div class="notif"><small>' + dt(new Date(n.created_at * 1000).toISOString()) + '</small><div>' + esc(n.text) + '</div></div>';
    }).join('') : '<div class="empty">Bildirim yok.</div>') +
      '<button class="d" id="nf-clear" style="width:100%;margin-top:8px">Tümünü Temizle</button>' +
      '<button class="d" id="nf-close" style="width:100%;margin-top:6px">Kapat</button>', { onClose: function () { render(); } });
    sh.querySelector('#nf-close').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#nf-clear').onclick = function () {
      var c = UI.openSheet('<h2>Tümünü temizle</h2><p>Tüm bildirimler silinsin mi?</p>' +
        '<button class="p" id="nc-yes">Evet, temizle</button><button class="d" id="nc-no">Hayır</button>');
      c.querySelector('#nc-no').onclick = function () { UI.closeSheet(); };
      c.querySelector('#nc-yes').onclick = function () {
        API.bildirimTemizle().then(function () {
          S.notifs = { items: [], unread: 0 };
          UI.closeSheet(); UI.toast('Bildirimler temizlendi', 'success'); renderIcons();
        }).catch(function (e) { UI.toast(e.message || 'Temizlenemedi', 'error'); });
      };
    };
    var maxId = items.reduce(function (m, n) { return Math.max(m, n.id); }, 0);
    if (maxId) {
      API.bildirimOkundu(maxId).then(function () {
        S.notifs.unread = 0;
        renderIcons();
      }).catch(function () {});
    }
  }

  function renderDrawer() {
    var d = $('drawer-nav');
    if (!d) return;
    var role = curRole();
    var pages = role === 'restoran' ? restaurantTabs() : courierTabs();
    if (role !== 'restoran') pages = pages.concat([['kazanc', '₺', 'Kazanç']]);
    var h = '<h3>Sayfalar</h3>' + pages.map(function (p) {
      return '<button data-dt="' + p[0] + '" class="' + (S.tab === p[0] ? 'on' : '') + '"><i>' + p[1] + '</i>' + p[2] + '</button>';
    }).join('');
    h += '<h3>İşlemler</h3>';
    h += '<button data-da="refresh"><i>↻</i>Yenile</button>';
    h += '<button data-dt="sistem" class="' + (S.tab === 'sistem' ? 'on' : '') + '"><i>⚙</i>Sistem</button>';
    h += '<button data-dt="profil" class="' + (S.tab === 'profil' ? 'on' : '') + '"><i>👤</i>Profil</button>';
    if (S.session && S.session.can_admin) h += '<button data-da="admin"><i>🛠</i>Yönetici Paneli</button>';
    d.innerHTML = h;
    Array.prototype.forEach.call(d.querySelectorAll('[data-dt]'), function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-dt'); closeDrawer(); render(); refresh(false); };
    });
    Array.prototype.forEach.call(d.querySelectorAll('[data-da]'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-da');
        closeDrawer();
        if (a === 'refresh') hardReload();
        else if (a === 'admin') { API.setActAs(''); location.replace('/admin' + location.hash); }
      };
    });
  }
  function closeDrawer() {
    var d = $('drawer'), sc = $('dscrim');
    if (d) d.hidden = true;
    if (sc) sc.hidden = true;
  }
  function bindDrawer() {
    var sc = $('dscrim');
    if (sc) sc.onclick = closeDrawer;
  }

  function render() {
    var role = curRole();
    if (role === 'restoran') {
      if (S.tab === 'talep') renderTalep();
      else if (S.tab === 'profil') renderProfil();
      else renderRestPaketlerim();
      return;
    }
    if (S.tab === 'loglar') renderLogs();
    else if (S.tab === 'sistem') renderSistem();
    else if (S.tab === 'profil') renderProfil();
    else if (S.tab === 'paketlerim') renderPaketlerim();
    else if (S.tab === 'gecmis') renderGecmis();
    else if (S.tab === 'kazanc') renderKazanc();
    else renderHavuz();
    renderIcons();
    renderDrawer();
  }

  function loadRest() {
    return API.paketlerimRestoran(S.restFilter).then(function (r) { S.restItems = r; render(); });
  }

  function refresh(full) {
    var role = curRole();
    if (role === 'restoran') {
      if (S.tab === 'paketlerim') return loadRest().catch(function () {});
      render();
      return Promise.resolve();
    }
    var jobs = [API.havuz().then(function (r) { S.pool = r; })];
    jobs.push(API.aktarimTeklifler().then(function (r) { S.offers = r.offers || []; }).catch(function () {}));
    jobs.push(API.bildirimler().then(function (r) { S.notifs = r; }).catch(function () {}));
    if (full || S.tab === 'paketlerim') jobs.push(API.paketlerim().then(function (r) { S.mine = r; }));
    if (full || S.tab === 'gecmis') jobs.push(API.gecmis().then(function (r) { S.history = r; }));
    if (full || S.tab === 'kazanc') jobs.push(API.kazanc(S.kazancRange, S.kazancDate).then(function (r) { S.earnings = r; }));
    return Promise.all(jobs).then(function () {
      render();
      if (curRole() === 'kurye' && (S.offers || []).length && !UI.sheetOpen()) offersPopup();
      var assigns = ((S.notifs && S.notifs.items) || []).filter(function (n) { return n.kind === 'assign' && n.id > ((S.notifs && S.notifs.last_read) || 0); });
      if (curRole() === 'kurye' && assigns.length && !UI.sheetOpen()) assignmentPopup(assigns);
    }).catch(function () {});
  }

  /* geri sayım (öncelik penceresi) */
  function tick() {
    var el = document.getElementById('prt');
    if (!el || !S.pool || !S.pool.priority) return;
    var left = Math.ceil((S.pool.priority.until - Date.now()) / 1000);
    if (left <= 0) { refresh(); return; }
    el.textContent = UI.clock(left);
  }

  /* ---------------- başlat ---------------- */
  function renderRegister(s) {
    var inv = s.invite || {};
    var isRest = inv.role === 'restoran';
    setHeader('Kayıt', isRest ? 'Restoran kaydı' : 'Kurye kaydı');
    $('hdr-right').innerHTML = '';
    $('nv').innerHTML = '';
    $('mn').innerHTML = '<div class="card" style="padding:12px">' +
      '<p class="note">Davet bağlantısıyla kayıt. Bilgilerinizi girin.</p>' +
      '<div class="fld"><label>' + (isRest ? 'Restoran adı' : 'Ad Soyad') + '</label><input id="rg-name" value="' + esc(inv.name || (s.user && s.user.name) || '') + '"></div>' +
      (isRest ? '<div class="fld"><label>Yetkili adı</label><input id="rg-contact" value="' + esc(inv.contact_name || '') + '"></div>' : '') +
      (inv.code ? '' : '<div class="fld"><label>Davet kodu</label><input id="rg-code" placeholder="Davet kodunu yapıştırın"></div>') +
      '<div class="fld"><label>Telefon</label><input id="rg-phone" inputmode="tel" value="' + esc(inv.phone || '') + '" placeholder="0546 208 99 00"></div>' +
      '<div class="err" id="rg-err"></div>' +
      '<button class="p" id="rg-save" style="width:100%">Kayıt Ol</button></div>';
    $('rg-save').onclick = function () {
      var body = { code: inv.code || ($('rg-code') ? $('rg-code').value.trim() : ''), name: $('rg-name').value.trim(), phone: $('rg-phone').value.trim() };
      if (isRest) body.contact_name = $('rg-contact').value.trim();
      API.kayit(body).then(function () {
        UI.toast('Kayıt tamamlandı', 'success');
        hardReload();
      }).catch(function (e) { $('rg-err').textContent = e.message || 'Kayıt başarısız'; });
    };
  }

  function renderIncomplete(s) {
    var u = s.user || {};
    var isRest = s.role === 'restoran';
    setHeader('Bilgilerinizi tamamlayın', isRest ? 'Restoran bilgileri' : 'Kurye bilgileri');
    $('hdr-right').innerHTML = '';
    $('nv').innerHTML = '';
    $('mn').innerHTML = '<div class="card" style="padding:12px">' +
      '<p class="note">Devam etmek için ad soyad ve telefon zorunludur.</p>' +
      '<div class="fld"><label>' + (isRest ? 'Restoran adı' : 'Ad Soyad') + '</label><input id="ci-name" value="' + esc(u.name && /^[A-Za-zÇĞİÖŞÜçğıöşü]+\s+[A-Za-zÇĞİÖŞÜçğıöşü]+/.test(u.name) ? u.name : '') + '"></div>' +
      (isRest ? '<div class="fld"><label>Yetkili adı</label><input id="ci-contact" value="' + esc(u.contact_name || '') + '"></div>' : '') +
      '<div class="fld"><label>Telefon</label><input id="ci-phone" inputmode="tel" value="' + esc(u.phone || '') + '" placeholder="0546 208 99 00"></div>' +
      '<div class="err" id="ci-err"></div>' +
      '<button class="p" id="ci-save" style="width:100%">Kaydet ve Devam</button></div>';
    $('ci-save').onclick = function () {
      var body = { name: $('ci-name').value.trim(), phone: $('ci-phone').value.trim() };
      if (isRest) body.contact_name = $('ci-contact').value.trim();
      API.profil(body).then(function () { hardReload(); })
        .catch(function (e) { $('ci-err').textContent = e.message || 'Kaydedilemedi'; });
    };
  }

  function boot() {
    API.init().then(function (s) {
      if (s && s.role === 'yonetici') { location.replace('/admin' + location.hash); return; }
      if (s && s.can_admin) {
        // yönetici hesabı kurye modunda: geri dönüş düğmesi
        var hr0 = $('hdr-right');
      }
      if (s && s.need_register) { renderRegister(s); return; }
      if (s && s.incomplete) { renderIncomplete(s); return; }
      S.session = s;
      S.role = s.role || 'courier';
      if (S.role === 'yonetici') { location.replace('/admin' + location.hash); return; }
      S.tab = S.role === 'restoran' ? 'talep' : 'havuz';
      var badge = document.getElementById('mode');
      if (badge) badge.textContent = (API.mode === 'real' ? 'CANLI' : 'MİMİK VERİ');
      if (API.mode !== 'real' && API.lastError) {
        var w = document.getElementById('authwarn');
        if (w) { w.hidden = false; w.textContent = 'Telegram kimliği alınamadı: ' + API.lastError + ' — Loglar sekmesinden ayrıntıya bakın.'; }
        if (/süresi doldu/i.test(API.lastError) && !sessionStorage.getItem('authReloaded')) {
          sessionStorage.setItem('authReloaded', '1');
          setTimeout(hardReload, 400);
          return;
        }
      }
      refresh(true);
      setInterval(function () { refresh(false); }, 5000);
      setInterval(tick, 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) refresh(false);
      });
    }).catch(function (e) {
      $('hdr-right').innerHTML = '';
      $('nv').innerHTML = '';
      $('mn').innerHTML = '<div class="empty"><b>Giriş yapılamadı</b>' + esc(e.message || '') +
        '<br><br>Yöneticiden yeni bir davet bağlantısı isteyin.</div>';
    });
  }

  window.addEventListener('error', function (e) { if (window.API && API.log) API.log('JS hata: ' + (e.message || e.error)); });
  window.addEventListener('unhandledrejection', function (e) { if (window.API && API.log) API.log('Promise hata: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
  function bindPullToRefresh() {
    var ptr = { start: null, dist: 0 };
    var el = function () { return document.getElementById('ptr'); };
    function reset() { ptr.start = null; ptr.dist = 0; var e = el(); if (e) e.hidden = true; }
    document.addEventListener('touchstart', function (e) {
      if (UI.sheetOpen() || window.scrollY > 0 || e.touches.length !== 1) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      ptr.start = e.touches[0].clientY; ptr.dist = 0;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (ptr.start == null || e.touches.length !== 1) return;
      var d = e.touches[0].clientY - ptr.start;
      if (d <= 0) { var e0 = el(); if (e0) e0.hidden = true; return; }
      ptr.dist = d;
      var ind = el();
      if (ind && d > 20) {
        ind.hidden = false;
        ind.textContent = d > 80 ? 'Bırakın, yenileniyor…' : '↓ Yenilemek için çekin';
      }
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (ptr.start == null) return;
      var d = ptr.dist; reset();
      if (d > 80) { refresh(true); UI.toast('Yenilendi', 'success'); }
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', function () { bindPullToRefresh(); bindDrawer(); boot(); });
})();
