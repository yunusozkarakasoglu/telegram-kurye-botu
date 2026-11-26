/* ==========================================================================
   app.js — Mini App yönlendirme + ekranlar (kurye / restoran)
   ========================================================================== */
(function () {
  'use strict';
  var $ = UI.$, esc = UI.esc, money = UI.money, kmf = UI.km, dt = UI.dt;

  var DURUM_KILIT_MSG = 'Üzerinizde paket varken meşgul/offline seçimi yapılamaz. Üzerinizdeki paketleri havuza/kuryeye aktardıktan sonra durum değişimi yapılabilir.';

  var ODemeTipleri = ['Nakit', 'Kart', 'Ödendi', 'Yemek Çeki', 'Cihaz hatası (ödemesiz)'];

  var S = {
    role: 'courier',
    tab: 'havuz',
    view: 'bolge',
    sel: {},
    session: null,
    pool: null,
    damga: '',
    mine: null,
    history: null,
    earnings: null,
    reqItems: [],
    reqQty: 1,
    reqMode: 'siparis',
    restFilter: 'open',
    kmPending: false,
    mineView: (localStorage.getItem('mineView') === 'card' ? 'card' : 'list'),
    histView: (localStorage.getItem('histView') === 'card' ? 'card' : 'list'),
    histRange: 'all',
    histDate: '',
    paySel: {},
    pinEdit: false,
    kazancRange: 'today',
    kazancDate: '',
    kazancPaid: 'all',
    histTab: 'siparis',
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
    return [['talep', '＋', 'Sipariş Ekle'], ['paketlerim', '▤', 'Paketlerim'], ['rapor', '▦', 'Rapor']];
  }

  function hardReload() {
    var q = new URLSearchParams(location.search);
    q.set('r', String(Date.now()));
    location.replace(location.pathname + '?' + q.toString() + location.hash);
  }

  function updateWho() {
    var el = $('who');
    var mb = $('mod');
    if (mb) {
      var rol = (S.session && S.session.role) || '';
      var etiket = rol === 'restoran' ? 'Restoran' : rol === 'yonetici' ? 'Yönetici' : rol === 'kurye' ? 'Kurye' : '';
      mb.textContent = etiket;
      mb.hidden = !etiket;
      document.title = etiket ? 'Kurye Paket · ' + etiket : 'Kurye Paket';
    }
    if (!el) return;
    var u = S.session && S.session.user;
    if (!u || S.role === 'restoran') { el.hidden = true; return; }
    el.hidden = false;
    var st = u.busy ? 'busy' : (u.online ? 'online' : 'offline');
    el.className = 'who ' + st;
    var parts = String(u.name || '').trim().split(/\s+/);
    $('wname').textContent = parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : (parts[0] || '');
    el.title = st === 'busy' ? ('Meşgul' + (u.busy_reason ? ' · ' + u.busy_reason : '')) : st === 'online' ? 'Online' : 'Offline';
    var pkb = $('pkb');
    if (pkb) { pkb.hidden = false; $('pkn').textContent = String(S.pending || 0); }
    var sd = $('sysd');
    if (sd) { sd.className = (API.mode === 'real' && !API.lastError) ? 'ok' : 'err'; sd.title = sd.className === 'ok' ? 'Sistem çalışıyor' : 'Bağlantı sorunu'; }
  }

  function setHeader(title, sub) { $('ttl').textContent = title; $('sub').textContent = sub || ''; }

  function nav(items, counts) {
    var nv = $('nv');
    var otomatik = {
      havuz: (S.pool && S.pool.packages) ? S.pool.packages.length : 0,
      paketlerim: (S.mine && S.mine.packages) ? S.mine.packages.length : 0,
    };
    nv.innerHTML = items.map(function (x) {
      var c = (counts && counts[x[0]] != null) ? counts[x[0]] : otomatik[x[0]];
      if (!c) c = 0;
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
    S.pending = 0;
    var pool = S.pool || { packages: [] };
    var L = pool.packages.slice();
    S.pending = L.length;
    setHeader('Havuz', '');

    var main = $('mn'), ctaEl = $('cta');
    if (!L.length) {
      main.innerHTML = '<div class="empty"><b>Havuz boş</b>Yeni sipariş gelince bildirim alacaksınız.</div>';
      ctaEl.innerHTML = '';
      nav(courierTabs(), {});
      return;
    }

    var h = '<div class="seg four">' + [['tumu', 'Tümü'], ['bolge', 'Bölgeye göre'], ['restoran', 'Restorana göre'], ['gecik', 'Gecikenler']]
      .map(function (s) { return '<button data-g="' + s[0] + '" class="' + (S.view === s[0] ? 'on' : '') + '">' + s[1] + '</button>'; })
      .join('') + '</div>';

    var _perRest = {};
    L.forEach(function (p) { _perRest[p.restaurant] = 1; });
    h += '<div class="poolinfo"><span class="pill">' + Object.keys(_perRest).length + ' restoran</span>da ' +
      '<span class="pill">' + L.length + ' paket</span> beklemektedir.</div>';

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
        '<div><b>' + esc(p.restaurant) + '</b>' +
        '<small>Talep #' + p.batch + '-' + p.number + ' · ' + esc(p.region || '') + '</small></div>' +
        '<span class="rowr"><span class="tag' + (p.payment === 'Kart' ? ' ac' : '') + '">' + esc(p.payment || '') + '</span>' +
        sureEtiket(p.created_at) + '</span></label>';
    }

    if (S.view === 'tumu') {
      L.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      h += '<div class="gcard">' + groupHead('Tüm havuz', L) + L.map(row).join('') + '</div>';
    } else if (S.view === 'sira') {
      L.sort(function (a, b) { return a.id - b.id; });
      h += '<div class="card" style="margin-top:12px">' + L.map(row).join('') + '</div>';
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
      eylem('kabul', { ids: ids }).then(function (r) {
        S.sel = {};
        if (r.accepted && r.accepted.length) UI.toast(r.accepted.length + ' paket kabul edildi', 'success');
        if (r.missed && r.missed.length) {
          var bos = !(r.accepted && r.accepted.length);
          if (bos && r.message) {
            bilgiSheet('Paket alınamadı', r.message);
          } else {
            UI.toast(r.missed.length + ' paket alınamadı', 'error');
          }
        }
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
    var duzenlenebilir = opts.own && !cancelled && !delivered;
    var mapBtn = duzenlenebilir && !picked
      ? '<button class="btn" data-a="harita" data-i="' + p.id + '">Restoran Konumu</button>' : '';
    var callBtn = !delivered && !cancelled && p.restaurant_phone
      ? '<a class="btn" href="tel:' + esc(p.restaurant_phone) + '">Restoranı Ara</a>' : '';

    var actions = '';
    if (duzenlenebilir) {
      actions += picked
        ? '<button class="p w" data-a="teslim" data-i="' + p.id + '">Teslim ettim</button>'
        : '<button class="p w" data-a="km" data-i="' + p.id + '">Km gir · teslim aldım</button>';
      if (mapBtn) actions += mapBtn.replace('class="btn"', 'class="btn w"');
      if (callBtn) actions += callBtn.replace('class="btn"', 'class="btn w"');
      actions += '<button class="w" data-a="aktar" data-i="' + p.id + '">Aktar</button>' +
                 '<button class="d w" data-a="iptal" data-i="' + p.id + '">Paketi iptal et</button>';
    }
    if (opts.pay && !cancelled && delivered && p.payment_received !== true) {
      actions += '<button class="p w" data-a="odeme" data-i="' + p.id + '">Ödeme Aldım</button>';
    }
    if (opts.closable) actions += '<button class="w pkexit" data-a="kapat" data-i="' + p.id + '">Çıkış</button>';

    var warn = (S.kmPending && opts.own) ? '<div class="pk-warn">Km girişi bekleniyor. Önce km girişini tamamlayın.</div>' : '';
    var kuryeNotuSatir = duzenlenebilir
      ? '<dt>Kurye notu</dt><dd><span class="pk-edit pk-edit-note"><span>' + esc(p.courier_note || '—') + '</span>' +
        '<button class="mini-edit" data-a="not" data-i="' + p.id + '">Düzenle</button></span></dd>'
      : '<dt>Kurye notu</dt><dd>' + esc(p.courier_note || '—') + '</dd>';

    return '<div class="pk">' +
      '<div class="pk-title">SİPARİŞ KARTI</div>' +
      '<div class="pk-hd"><b>' + esc(p.restaurant) + '</b><em class="lb r">' + esc(p.region || '—') + '</em>' +
        UI.statusTag(p.status) + '</div>' +
      '<div class="pk-bd"><dl class="pk-fields">' +
        '<dt>Sipariş no</dt><dd>Talep #' + p.batch + '-' + p.number + '</dd>' +
        '<dt>Restoran</dt><dd>' + esc(p.restaurant) + '</dd>' +
        '<dt>Bölge</dt><dd>' + esc(p.region || '—') + '</dd>' +
        '<dt>Ödeme</dt><dd>' + esc(p.payment || '—') + '</dd>' +
        '<dt>Yetkili</dt><dd>' + esc(p.restaurant_contact || '—') + '</dd>' +
        '<dt>Kabul</dt><dd>' + dt(p.accepted_at) + '</dd>' +
        '<dt>Alım</dt><dd>' + dt(p.picked_up_at) + '</dd>' +
        '<dt>Teslim</dt><dd>' + dt(p.delivered_at) + '</dd>' +
        '<dt>Mesafe</dt><dd>' + (picked && duzenlenebilir
          ? '<span class="pk-edit"><span>' + (p.distance_km == null ? '—' : kmf(p.distance_km)) + '</span>' +
            '<button class="mini-edit" data-a="km" data-i="' + p.id + '">Düzenle</button></span>'
          : (p.distance_km == null ? '—' : kmf(p.distance_km))) + '</dd>' +
        '<dt>Paket ücreti</dt><dd>' + (p.fee_tl == null ? '—' : money(p.fee_tl)) + '</dd>' +
        '<dt>Ödeme (hakediş)</dt><dd>' + (p.payment_received === true ? 'Alındı' : p.payment_received === false ? 'Alınmadı' : '—') + '</dd>' +
        '<dt>Durum</dt><dd>' + esc(st.t) + '</dd>' +
        (p.cancelled_at ? '<dt>İptal eden</dt><dd>' + esc((p.cancelled_by_role === 'restoran' ? 'Restoran' : p.cancelled_by_role === 'kurye' ? 'Kurye' : 'Yönetici') + ' · ' + (p.cancelled_by_name || '—')) + '</dd>' : '') +
        '<dt>Kurye</dt><dd>' + esc(p.courier_name || '—') + '</dd>' +
        '<dt>Restoran notu</dt><dd>' + esc(p.note || '—') + '</dd>' +
        kuryeNotuSatir +
      '</dl>' +
      (p.transfer_from ? '<p class="note">Aktarma bilgisi: önceki kurye ' + esc(p.transfer_from) + '</p>' : '') + warn + '</div>' +
      (actions ? '<div class="pk-ft">' + actions + '</div>' : '') +
    '</div>';
  }

  function bindPkgActions(root, list) {
    Array.prototype.forEach.call(root.querySelectorAll('button[data-a]'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a'), id = b.getAttribute('data-i');
        var p = (list || []).filter(function (x) { return String(x.id) === String(id); })[0] || findPkg(id);
        if (a === 'kapat') { UI.closeSheet(); return; }
        if (a === 'harita') {
          if (p && p.map_url) TG.openLink(p.map_url);
          else if (p) TG.map((p.restaurant || '') + ' ' + (p.region || ''));
        } else if (a === 'not') kuryeNotSheet(p, function () { openPkg(p.id); });
        else if (a === 'km') kmSheet(findPkg(id));
        else if (a === 'teslim') deliverConfirm(p);
        else if (a === 'odeme') {
          confirmSheet('#' + p.batch + '-' + p.number + ' için ödeme alındı olarak işaretlensin mi?', function () {
            eylem('odeme', { ids: [Number(id)], all: false }).then(function () {
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
      eylem('teslim', { id: p.id, paid: paid }).then(function () {
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
          var kmTxt = p.distance_km == null ? 'Km bekliyor' : kmf(p.distance_km);
          return '<button class="prow" data-open="' + p.id + '">' +
            '<span><b>' + esc(p.region || 'Bölge yok') + ' · ' + esc(p.restaurant) + '</b>' +
            '<small>#' + p.batch + '-' + p.number + ' · ' + esc(p.payment || 'Ödeme yok') + ' · ' + kmTxt + '</small></span>' +
            '<span class="rr"><em>' + (p.fee_tl == null ? '' : money(p.fee_tl)) + '</em>' + sureEtiket(p.created_at) + '</span></button>';
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
    var sh = UI.openSheet(pkgCard(p, { own: true, closable: true }), { full: true, onClose: function () { render(); } });
    var cx = sh.querySelector('[data-close]');
    if (cx) cx.onclick = function () { UI.closeSheet(); };
    bindPkgActions(sh, [p]);
  }

  /** Havuza atıldığından beri geçen dakika — tamamen istemcide, API çağrısı yok. */
  function gecenDk(createdAt) {
    if (!createdAt) return null;
    return Math.max(0, Math.floor((Date.now() / 1000 - createdAt) / 60));
  }
  function sureEtiket(createdAt) {
    var dk = gecenDk(createdAt);
    if (dk == null) return '';
    return '<em class="ela' + (dk >= 10 ? ' late' : '') + '" data-elapsed="' + createdAt + '">' + dk + ' dk</em>';
  }
  /** Sadece metin güncelle: yeniden çizim/istek yok. */
  function tickElapsed() {
    var nodes = document.querySelectorAll('[data-elapsed]');
    for (var i = 0; i < nodes.length; i++) {
      var dk = gecenDk(Number(nodes[i].getAttribute('data-elapsed')));
      if (dk == null) continue;
      nodes[i].textContent = dk + ' dk';
      nodes[i].className = 'ela' + (dk >= 10 ? ' late' : '');
    }
  }

  function dayBounds(offset) {
    var now = new Date();
    var tr = new Date(now.getTime() + 3 * 3600 * 1000);
    var startUtc = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate() - offset) / 1000 - 3 * 3600;
    return [startUtc, startUtc + 86400];
  }

  function renderGecmis() {
    var all = (S.history && S.history.items) || [];
    var adv = S.histAdv || {};
    var bounds = null;
    if (adv.when === 'today') bounds = dayBounds(0);
    else if (adv.when === 'yesterday') bounds = dayBounds(1);
    else if (adv.when === 'date' && adv.date) {
      var t0 = Math.floor(Date.parse(adv.date + 'T00:00:00+03:00') / 1000);
      bounds = [t0, t0 + 86400];
    } else if (!adv.when) {
      if (S.histDate) {
        var h0 = Math.floor(Date.parse(S.histDate + 'T00:00:00+03:00') / 1000);
        bounds = [h0, h0 + 86400];
      } else if (S.histRange !== 'all') {
        bounds = dayBounds(S.histRange === 'today' ? 0 : 1);
      }
    }
    var items = all.filter(function (p) {
      if (!bounds) return true;
      var t = p.cancelled_at || p.delivered_at || p.created_at || 0;
      return t >= bounds[0] && t < bounds[1];
    });
    var f = S.histAdv || {};
    items = items.filter(function (p) {
      if (f.status) {
        var st = String(p.status || '');
        if (f.status === 'teslim' && st !== 'Teslim edildi') return false;
        if (f.status === 'iptal' && st !== 'İptal edildi') return false;
        if (f.status === 'yolda' && !/Yolda|Kuryede/i.test(st)) return false;
      }
      if (f.pay === 'var' && p.payment_received !== true) return false;
      if (f.pay === 'yok' && p.payment_received !== false) return false;
      return true;
    });
    var main = $('mn');
    var htab = S.histTab || 'siparis';
    var hseg = '<div class="seg two" style="margin-bottom:8px">' +
      '<button data-ht="siparis" class="' + (htab === 'siparis' ? 'on' : '') + '">Siparişler</button>' +
      '<button data-ht="kazanc" class="' + (htab === 'kazanc' ? 'on' : '') + '">Kazanç</button></div>';
    if (htab === 'kazanc') {
      setHeader('Geçmiş', 'Kazanç');
      main.innerHTML = hseg + '<div id="kz-host"></div>';
      Array.prototype.forEach.call(main.querySelectorAll('[data-ht]'), function (b) {
        b.onclick = function () { S.histTab = b.getAttribute('data-ht'); render(); };
      });
      renderKazanc($('kz-host'));
      return;
    }
    setHeader('Geçmiş', items.length + ' kayıt');
    var advCount = (f.when ? 1 : 0) + (f.status ? 1 : 0) + (f.pay ? 1 : 0) + (f.grup ? 1 : 0);
    var bar = '<div class="filterbar"><button id="hf-open">⚙ Filtre' + (advCount ? ' (' + advCount + ')' : '') + '</button>' +
      (advCount ? '<button id="hf-clear">✕ Temizle</button>' : '') + '</div>';

    function satir(p) {
      return '<button class="prow" data-hopen="' + p.id + '"><span><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) + '</b>' +
        '<small>' + esc(p.region || '') + ' · ' + esc(p.status) + ' · ' + dt(p.delivered_at || p.cancelled_at) +
        (p.payment_received === true ? ' · ödeme alındı' : p.payment_received === false ? ' · ödeme alınmadı' : '') + '</small></span>' +
        '<em>' + (p.fee_tl == null ? '' : money(p.fee_tl)) + '</em></button>';
    }

    var body;
    if (!items.length) {
      body = '<div class="empty"><b>Kayıt yok</b>Bu filtrede tamamlanan/iptal edilen iş bulunmuyor.</div>';
    } else if (!f.grup) {
      body = '<div class="card">' + items.map(satir).join('') + '</div>';
    } else {
      var key = f.grup === 'region' ? 'region' : 'restaurant';
      var groups = {};
      items.forEach(function (p) { var k = p[key] || 'Belirtilmedi'; (groups[k] = groups[k] || []).push(p); });
      body = Object.keys(groups).sort().map(function (k) {
        return '<div class="ghead"><span class="gname">' + esc(k) + '</span>' +
          '<span class="gcount">' + groups[k].length + ' kayıt</span></div>' +
          '<div class="card">' + groups[k].map(satir).join('') + '</div>';
      }).join('');
    }

    main.innerHTML = hseg + bar + body;
    Array.prototype.forEach.call(main.querySelectorAll('[data-ht]'), function (b) {
      b.onclick = function () { S.histTab = b.getAttribute('data-ht'); render(); };
    });
    var hf = $('hf-open');
    if (hf) hf.onclick = histFiltreSheet;
    var hc = $('hf-clear');
    if (hc) hc.onclick = function () { S.histAdv = null; render(); };
    Array.prototype.forEach.call(main.querySelectorAll('[data-hopen]'), function (b) {
      b.onclick = function () {
        var p = items.filter(function (x) { return String(x.id) === b.getAttribute('data-hopen'); })[0];
        if (!p) return;
        var sh = UI.openSheet(pkgCard(p, { pay: true, closable: true }), { full: true, onClose: function () { render(); } });
        var cx2 = sh.querySelector('[data-close]');
        if (cx2) cx2.onclick = function () { UI.closeSheet(); };
        bindPkgActions(sh, [p]);
      };
    });
    $('cta').innerHTML = '';
    nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0 });
  }

  function histFiltreSheet() {
    var f = S.histAdv || {};
    var bugun = new Date();
    var sec = { when: f.when || '', date: f.date || bugun.toISOString().slice(0, 10), status: f.status || '', pay: f.pay || '', grup: f.grup || '' };
    var sh = UI.openSheet(
      '<div class="sheethead"><h2>Filtrele</h2><div class="shead-acts">' +
        '<button class="sheetc" id="hf-reset" title="Filtreyi temizle">↺</button>' +
        '<button class="sheetx" id="hf-x" title="Kapat">✕</button></div></div>' +
      '<div class="fld"><label>Zaman</label><div class="seg four">' +
        [['', 'Tümü'], ['today', 'Bugün'], ['yesterday', 'Dün'], ['date', 'Tarih seç']].map(function (x) {
          return '<button data-when="' + x[0] + '" class="' + (sec.when === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<div id="hf-date" style="display:' + (sec.when === 'date' ? 'block' : 'none') + '">' +
        '<div class="fld"><label>Tarih</label><input id="hf-date-in" type="date" value="' + esc(sec.date) + '"></div>' +
      '</div>' +
      '<div class="fld"><label>Durum</label><div class="seg two">' +
        [['', 'Tümü'], ['teslim', 'Teslim edildi'], ['iptal', 'İptal edildi']].map(function (x) {
          return '<button data-st="' + x[0] + '" class="' + (sec.status === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<div class="fld"><label>Ödeme durumu</label><div class="seg four">' +
        [['', 'Tümü'], ['var', 'Ödeme alındı'], ['yok', 'Ödeme alınmadı']].map(function (x) {
          return '<button data-pay="' + x[0] + '" class="' + (sec.pay === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<div class="fld"><label>Grupla</label><div class="seg four">' +
        [['', 'Yok'], ['region', 'Bölgeye'], ['restaurant', 'Restorana']].map(function (x) {
          return '<button data-grup="' + x[0] + '" class="' + (sec.grup === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<button class="p" id="hf-apply" style="width:100%">Filtrele</button>');
    sh.querySelector('#hf-x').onclick = function () { UI.closeSheet(); };
    Array.prototype.forEach.call(sh.querySelectorAll('[data-when],[data-st],[data-pay],[data-grup]'), function (b) {
      b.onclick = function () {
        var grup = b.parentElement;
        var attr = b.hasAttribute('data-when') ? 'data-when' : b.hasAttribute('data-st') ? 'data-st'
          : b.hasAttribute('data-pay') ? 'data-pay' : 'data-grup';
        var v = b.getAttribute(attr);
        if (attr === 'data-when') {
          sec.when = v;
          sh.querySelector('#hf-date').style.display = v === 'date' ? 'block' : 'none';
        } else if (attr === 'data-st') sec.status = v;
        else if (attr === 'data-pay') sec.pay = v;
        else sec.grup = v;
        Array.prototype.forEach.call(grup.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
    });
    sh.querySelector('#hf-reset').onclick = function () { S.histAdv = null; UI.closeSheet(); render(); };
    sh.querySelector('#hf-apply').onclick = function () {
      var d = sh.querySelector('#hf-date-in');
      var tarih = d ? d.value : '';
      if (sec.when === 'date' && !tarih) { UI.toast('Tarih seçin', 'error'); return; }
      S.histAdv = { when: sec.when, date: sec.when === 'date' ? tarih : '', status: sec.status, pay: sec.pay, grup: sec.grup };
      UI.closeSheet(); render();
    };
  }

  function renderKazanc(host) {
    var e = S.earnings || { total_tl: 0, count: 0, total_km: 0 };
    var hedef = host || $('mn');
    if (!host) setHeader('Kazançlarım', e.period || '');
    if (!S.kazancAdv) {
      S.kazancAdv = {
        when: S.kazancDate ? 'date' : (S.kazancRange === 'all' ? '' : S.kazancRange),
        date: S.kazancDate || '',
        pay: S.kazancPaid === 'paid' ? 'paid' : S.kazancPaid === 'unpaid' ? 'unpaid' : 'all',
      };
    }
    var f = S.kazancAdv;
    var aktif = (f.when ? 1 : 0) + (f.pay !== 'all' ? 1 : 0);

    var kartlar = '<div class="krow">' +
      '<div class="big"><span>Toplam hakediş</span><div>' + money(e.total_tl) + '</div></div>' +
      '<div class="big"><span>Teslim paket</span><div>' + (e.count || 0) + '</div></div>' +
      '<div class="big"><span>Toplam km</span><div>' + (Math.round((e.total_km || 0) * 10) / 10) + '</div></div>' +
    '</div>';

    var bar = '<div class="filterbar" style="margin-top:10px"><button id="kf-open">⚙ Filtre' + (aktif ? ' (' + aktif + ')' : '') + '</button>' +
      (aktif ? '<button id="kf-clear">✕ Temizle</button>' : '') + '</div>';

    var items = (e.items || []).filter(function (p) {
      if (f.pay === 'paid') return p.payment_received === true;
      if (f.pay === 'unpaid') return p.payment_received !== true;
      return true;
    });
    var listHtml = items.length ? '<div class="card">' + items.map(function (p) {
      return '<button class="prow" data-kopen="' + p.id + '"><span><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) + '</b>' +
        '<small>' + esc(p.region || '') + ' · ' + dt(p.delivered_at) + ' · ' +
        (p.payment_received === true ? 'ödeme alındı' : p.payment_received === false ? 'ödeme alınmadı' : 'ödeme —') + '</small></span>' +
        '<em>' + (p.fee_tl == null ? '' : money(p.fee_tl)) + '</em></button>';
    }).join('') + '</div>' : '<div class="empty">Bu dönemde paket yok.</div>';

    hedef.innerHTML = kartlar + bar + listHtml;

    var kf = hedef.querySelector('#kf-open');
    if (kf) kf.onclick = function () { kazancFiltreSheet(host); };
    var kc = hedef.querySelector('#kf-clear');
    if (kc) kc.onclick = function () {
      S.kazancAdv = { when: '', date: '', pay: 'all' };
      S.kazancRange = 'all'; S.kazancDate = ''; S.kazancPaid = 'all';
      loadKazanc();
    };
    Array.prototype.forEach.call(hedef.querySelectorAll('[data-kopen]'), function (b) {
      b.onclick = function () {
        var p = (e.items || []).filter(function (x) { return String(x.id) === b.getAttribute('data-kopen'); })[0];
        if (!p) return;
        var kapat = function () { host ? renderGecmis() : renderKazanc(); };
        var sh = UI.openSheet(pkgCard(p, { pay: true, closable: true }), { full: true, onClose: kapat });
        var cx3 = sh.querySelector('[data-close]');
        if (cx3) cx3.onclick = function () { UI.closeSheet(); };
        bindPkgActions(sh, [p]);
      };
    });
    $('cta').innerHTML = '';
    if (!host) nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0 });
  }

  function kazancFiltreSheet(host) {
    var f = S.kazancAdv || {};
    var bugun = new Date();
    var sec = { when: f.when || '', date: f.date || bugun.toISOString().slice(0, 10), pay: f.pay || 'all' };
    var sh = UI.openSheet(
      '<div class="sheethead"><h2>Filtrele</h2><div class="shead-acts">' +
        '<button class="sheetc" id="kf-reset" title="Filtreyi temizle">↺</button>' +
        '<button class="sheetx" id="kf-x" title="Kapat">✕</button></div></div>' +
      '<div class="fld"><label>Zaman</label><div class="seg four">' +
        [['', 'Tümü'], ['today', 'Bugün'], ['yesterday', 'Dün'], ['date', 'Tarih seç']].map(function (x) {
          return '<button data-when="' + x[0] + '" class="' + (sec.when === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<div id="kf-date" style="display:' + (sec.when === 'date' ? 'block' : 'none') + '">' +
        '<div class="fld"><label>Tarih</label><input id="kf-date-in" type="date" value="' + esc(sec.date) + '"></div>' +
      '</div>' +
      '<div class="fld"><label>Ödeme durumu</label><div class="seg four">' +
        [['all', 'Tümü'], ['paid', 'Ödeme alındı'], ['unpaid', 'Ödeme alınmadı']].map(function (x) {
          return '<button data-pay="' + x[0] + '" class="' + (sec.pay === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<button class="p" id="kf-apply" style="width:100%">Filtrele</button>');

    sh.querySelector('#kf-x').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#kf-reset').onclick = function () {
      S.kazancAdv = { when: '', date: '', pay: 'all' };
      S.kazancRange = 'all'; S.kazancDate = ''; S.kazancPaid = 'all';
      UI.closeSheet(); loadKazanc();
    };
    Array.prototype.forEach.call(sh.querySelectorAll('[data-when],[data-pay]'), function (b) {
      b.onclick = function () {
        var grup = b.parentElement;
        var attr = b.hasAttribute('data-when') ? 'data-when' : 'data-pay';
        var v = b.getAttribute(attr);
        if (attr === 'data-when') {
          sec.when = v;
          sh.querySelector('#kf-date').style.display = v === 'date' ? 'block' : 'none';
        } else sec.pay = v;
        Array.prototype.forEach.call(grup.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
    });
    sh.querySelector('#kf-apply').onclick = function () {
      var d = sh.querySelector('#kf-date-in');
      var tarih = d ? d.value : '';
      if (sec.when === 'date' && !tarih) { UI.toast('Tarih seçin', 'error'); return; }
      S.kazancAdv = { when: sec.when, date: sec.when === 'date' ? tarih : '', pay: sec.pay };
      S.kazancPaid = sec.pay === 'paid' ? 'paid' : sec.pay === 'unpaid' ? 'unpaid' : 'all';
      if (sec.when === 'date') { S.kazancDate = tarih; S.kazancRange = 'today'; }
      else { S.kazancDate = ''; S.kazancRange = sec.when === '' ? 'all' : sec.when; }
      UI.closeSheet(); loadKazanc();
    };
  }

  function loadKazanc() {
    API.kazanc(S.kazancRange, S.kazancDate).then(function (r) {
      S.earnings = r;
      if (S.tab === 'gecmis' && S.histTab === 'kazanc') { renderGecmis(); return; }
      renderKazanc();
    }).catch(function () {});
  }

  /* ---------------- KM / İPTAL / AKTAR ---------------- */
  function kuryeNotSheet(p, geriDon) {
    if (!p) return;
    var sh = UI.openSheet(
      '<h2>Kurye notu · #' + p.batch + '-' + p.number + '</h2>' +
      '<p>Ambalaj, gecikme, adres gibi durumları yazın. Restoran ve yönetici görür.</p>' +
      '<div class="notebox cnote"><textarea id="cn" rows="3" placeholder="Ör. ambalaj zayıf, geç teslim olabilir…">' + esc(p.courier_note || '') + '</textarea></div>' +
      '<div class="err" id="cn-err"></div>' +
      '<button class="p" id="cn-save" style="width:100%">Kaydet</button>' +
      '<button class="d" id="cn-back" style="width:100%;margin-top:6px">Vazgeç</button>');
    sh.querySelector('#cn-back').onclick = function () {
      UI.closeSheet();
      if (geriDon) setTimeout(geriDon, 120); else render();
    };
    sh.querySelector('#cn-save').onclick = function () {
      var v = (sh.querySelector('#cn').value || '').trim();
      eylem('not', { id: p.id, note: v }).then(function () {
        var yeni = v || null;
        p.courier_note = yeni;
        [S.mine && S.mine.packages, S.pool && S.pool.packages, S.history && S.history.items].forEach(function (liste) {
          (liste || []).forEach(function (x) { if (x.id === p.id) x.courier_note = yeni; });
        });
        UI.closeSheet();
        UI.toast('Not kaydedildi', 'success');
        if (geriDon) setTimeout(geriDon, 120); else refresh(true);
      }).catch(function (e) { sh.querySelector('#cn-err').textContent = e.message || 'Kaydedilemedi'; });
    };
  }

  function kmSheet(p) {
    if (!p) return;
    S.kmPending = true;
    var base = (S.session && S.session.settings) ? S.session.settings : {};
    var tariff = base.tariff || [120, 150, 190, 240, 300, 370, 450, 540, 640];
    var duzenle = !!p.picked_up_at;
    var sh = UI.openSheet(
      '<h2>' + (duzenle ? 'Kilometreyi düzenle' : 'Teslim aldım') + ' · #' + p.batch + '-' + p.number + '</h2>' +
      '<p>Teslimat mesafesini kilometre olarak girin. Teslim edilene kadar değiştirilebilir.</p>' +
      '<input id="kmin" type="number" inputmode="decimal" step="0.1" min="0" placeholder="Örn. 3,5" value="' +
        (duzenle && p.distance_km != null ? String(p.distance_km).replace('.', ',') : '') + '">' +
      '<div class="notebox cnote" style="margin-top:10px"><small>📝 Kurye notu (opsiyonel)</small>' +
        '<textarea id="knote" rows="2" placeholder="Ör. ambalaj zayıf, geç teslim olabilir, adres tarifi…"></textarea>' +
        '<div class="note" style="margin-top:4px">Yazdığınız not restoran ve yönetici kartında da görünür.</div></div>' +
      '<div class="err" id="kerr"></div><div id="kpv"></div>' +
      '<button class="p" id="kok">' + (duzenle ? 'Güncelle' : 'Onayla') + '</button>' +
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
      var uyari = v > 10
        ? '<p class="pk-warn" style="margin:6px 0 0">10 km üzeri: bölge teslimat çapı 10 km. Ek ücret uygulanır; operasyon uygun görmezse sipariş kabul edilmeyebilir.</p>'
        : '';
      pv.innerHTML = '<p>Bu paketten alacağınız: <b>' + API.feePreview(tariff, v, base.extra_per_km) + '</b></p>' + uyari;
    }
    input.oninput = calc;
    if (duzenle) calc();
    sh.querySelector('#kback').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#kok').onclick = function () {
      var v = parseFloat(String(input.value).replace(',', '.'));
      if (!(v > 0)) { err.textContent = 'Geçerli bir kilometre girin'; return; }
      var knote = ($('knote') && $('knote').value ? $('knote').value : '').trim();
      eylem('km', { id: p.id, km: v, note: knote }).then(function (r) {
        if (r && r.queued) { UI.closeSheet(); S.kmPending = false; render(); return; }
        UI.closeSheet();
        UI.toast((duzenle ? 'Kilometre güncellendi: ' : 'Kazanç hesaplandı: ') + money(r.fee_tl), 'success');
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
        eylem('iptal', { id: p.id, reason: reason }).then(function (r) {
          UI.closeSheet();
          if (r && r.queued) { render(); return; }
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
    setHeader('Sipariş Ekle', '');
    var main = $('mn');
    var st = (S.session && S.session.settings) || {};
    var regions = st.regions || [];
    var payments = st.payments || ODemeTipleri;
    if (!S.reqDraft) S.reqDraft = { region: '', payment: '', note: '' };
    var d = S.reqDraft;
    var rows = S.reqItems.map(function (it, i) {
      var kurye = it.courier_name ? ('👤 ' + esc(it.courier_name)) : '';
      return '<button class="reqrow" data-row="' + i + '">' +
        '<span class="rq-l"><b>#' + (i + 1) + '</b>' +
          '<small>' + esc(it.region || 'Bölge yok') + ' · ' + esc(it.payment || 'Ödeme yok') + (it.note ? ' · 📝' : '') + (kurye ? ' · ' + kurye : '') + '</small></span>' +
        '<span class="rq-r">' + (it.courier ? '<em class="stg direct">Kuryeye</em>' : '<em class="stg">Havuza</em>') + '<i class="chev">›</i></span>' +
      '</button>';
    }).join('');
    main.innerHTML =
      '<div class="card addcard">' +
        '<div style="display:flex;flex-wrap:nowrap;align-items:center;gap:10px;margin-bottom:10px;width:100%"><label style="flex:0 0 84px;font-size:13px;color:#888;white-space:nowrap">Bölge</label><select id="ar" style="flex:1;min-width:0;width:auto;font:inherit;font-size:15px;padding:11px 10px;border:1px solid #ccc;border-radius:10px;background:transparent;color:inherit">' +
          '<option value="">— seçin —</option>' +
          regions.map(function (r) { return '<option' + (d.region === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') +
        '</select></div>' +
        '<div style="display:flex;flex-wrap:nowrap;align-items:center;gap:10px;margin-bottom:10px;width:100%"><label style="flex:0 0 84px;font-size:13px;color:#888;white-space:nowrap">Ödeme tipi</label><select id="ap" style="flex:1;min-width:0;width:auto;font:inherit;font-size:15px;padding:11px 10px;border:1px solid #ccc;border-radius:10px;background:transparent;color:inherit">' +
          '<option value="">— seçin —</option>' +
          payments.map(function (r) { return '<option' + (d.payment === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="fld"><label>Not (opsiyonel)</label><textarea id="an" rows="2" placeholder="Siparişe özel not (kurye görür)">' + esc(d.note || '') + '</textarea></div>' +
        '<button class="p addbtn" id="addbtn">＋ Paket Ekle</button>' +
      '</div>' +
      '<div class="reqlist">' + (rows || '<p class="note" style="margin:4px 0">Listeniz boş. Bölge ve ödeme seçip “Paket Ekle”ye basın.</p>') + '</div>' +
      '<p class="hint" style="margin:6px 0 10px">Satıra dokunun: bölge/ödeme/not düzenleyin, isterseniz kurye seçin. Kurye seçilirse paket havuza düşmez.</p>';

    main.querySelector('#ar').onchange = function (e) { S.reqDraft.region = e.target.value; };
    main.querySelector('#ap').onchange = function (e) { S.reqDraft.payment = e.target.value; };
    main.querySelector('#an').oninput = function (e) { S.reqDraft.note = e.target.value; };
    main.querySelector('#addbtn').onclick = function () {
      if (S.reqItems.length >= 10) { UI.toast('En fazla 10 paket eklenebilir', 'error'); return; }
      S.reqItems.push({ region: S.reqDraft.region, payment: S.reqDraft.payment, note: (S.reqDraft.note || '').trim(), courier: '', courier_name: '' });
      S.reqDraft = { region: '', payment: '', note: '' };
      render();
    };
    Array.prototype.forEach.call(main.querySelectorAll('[data-row]'), function (b) {
      b.onclick = function () { reqItemSheet(Number(b.getAttribute('data-row')), regions, payments); };
    });
    $('cta').innerHTML = '<button class="p" id="req-send"' + (S.reqItems.length ? '' : ' disabled') + '>Talebi Gönder' +
      (S.reqItems.length ? ' (' + S.reqItems.length + ')' : '') + '</button>';
    var cs = $('req-send');
    if (cs) cs.onclick = function () {
      if (!S.reqItems.length) { UI.toast('Önce paket ekleyin', 'error'); return; }
      cs.disabled = true;
      var havuz = S.reqItems.filter(function (it) { return !it.courier; });
      var direkt = S.reqItems.filter(function (it) { return !!it.courier; });
      var isler = [];
      if (havuz.length) isler.push(API.talepVer(havuz).then(function (r) { return r.count + ' havuza'; }));
      direkt.forEach(function (it, i) {
        isler.push(API.kuryeTalep({ courier_id: Number(it.courier), region: it.region || '', payment: it.payment || '', note: (it.note || '').trim() })
          .then(function () { return (it.courier_name || 'Kurye') + ' · #' + (i + 1); }));
      });
      Promise.all(isler).then(function (sonuc) {
        S.reqItems = [];
        S.reqDraft = { region: '', payment: '', note: '' };
        UI.toast('Gönderildi: ' + sonuc.join(' · '), 'success');
        S.tab = 'paketlerim';
        S.restFilter = 'open';
        refresh(true);
      }).catch(function (e) { cs.disabled = false; UI.toast(e.message || 'Gönderilemedi', 'error'); });
    };
    nav(restaurantTabs(), {});
  }

  /** Sipariş satırı seçenekleri: bölge · ödeme · kurye · not (popup). */
  function reqItemSheet(i, regions, payments) {
    var it = S.reqItems[i];
    if (!it) return;
    var sh = UI.openSheet(
      '<h2>Sipariş #' + (i + 1) + '</h2>' +
      '<div class="fld"><label>Bölge</label><select id="er">' +
        '<option value="">— seçin —</option>' +
        regions.map(function (r) { return '<option' + (it.region === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="fld"><label>Ödeme</label><select id="ep">' +
        '<option value="">— seçin —</option>' +
        payments.map(function (r) { return '<option' + (it.payment === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="fld"><label>Kurye</label><select id="ek"><option value="">— seçin —</option></select></div>' +
      '<div class="fld"><label>Not</label><textarea id="en" rows="2" placeholder="Siparişe özel not (kurye görür)">' + esc(it.note || '') + '</textarea></div>' +
      '<button class="p" id="esave">Kaydet</button><button class="d" id="edel">Sil</button><button class="g" id="ecancel">Vazgeç</button>');
    var sel = sh.querySelector('#ek');
    API.restoranKuryeler().then(function (r) {
      var list = (r && r.couriers) || [];
      sel.innerHTML = '<option value="">— seçin —</option>' + list.map(function (c) {
        var ek = c.online && !c.busy ? '' : (c.busy ? ' (meşgul)' : ' (çevrimdışı)');
        return '<option value="' + c.id + '"' + (String(it.courier) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + ek + '</option>';
      }).join('');
      if (sel.value && !list.some(function (c) { return String(c.id) === String(sel.value); })) sel.value = '';
    }).catch(function () { sel.innerHTML = '<option value="">— seçin —</option>'; });
    sh.querySelector('#esave').onclick = function () {
      var cid = sel.value;
      var secili = sel.options[sel.selectedIndex];
      S.reqItems[i] = {
        region: sh.querySelector('#er').value,
        payment: sh.querySelector('#ep').value,
        note: (sh.querySelector('#en').value || '').trim(),
        courier: cid,
        courier_name: cid ? (secili ? secili.textContent.replace(/\s*\(.*\)$/, '') : '') : '',
      };
      UI.closeSheet();
      render();
    };
    sh.querySelector('#edel').onclick = function () {
      S.reqItems.splice(i, 1);
      UI.closeSheet();
      render();
    };
    sh.querySelector('#ecancel').onclick = function () { UI.closeSheet(); };
  }

  function renderRestRapor() {
    setHeader('Rapor', 'Bugünün paketleri');
    var main = $('mn');
    var items = (S.restItems && S.restItems.items) || [];
    var day0 = new Date(); day0.setHours(0, 0, 0, 0);
    var day1 = new Date(day0); day1.setDate(day1.getDate() + 1);
    var t0 = Math.floor(day0.getTime() / 1000), t1 = Math.floor(day1.getTime() / 1000);
    var rows = items.filter(function (p) { return p.created_at && p.created_at >= t0 && p.created_at < t1; });
    var hm = function (sec) {
      if (sec == null || sec < 0) return '—';
      var m = Math.floor(sec / 60), h = Math.floor(m / 60);
      return h ? (h + ' sa ' + (m % 60) + ' dk') : (m + ' dk');
    };
    var delivered = rows.filter(function (p) { return !!p.delivered_at; });
    var durs = rows.filter(function (p) { return p.created_at && p.delivered_at; })
      .map(function (p) { return p.delivered_at - p.created_at; });
    var ortSure = durs.length ? Math.round(durs.reduce(function (a, b) { return a + b; }, 0) / durs.length) : null;
    var kms = rows.filter(function (p) { return p.distance_km != null; });
    var ortKm = kms.length ? (kms.reduce(function (a, p) { return a + Number(p.distance_km); }, 0) / kms.length) : null;
    var kpi = '<div class="kpis">' +
      '<div class="kpi"><b>' + rows.length + '</b><small>Bugün paket</small></div>' +
      '<div class="kpi"><b>' + (ortSure == null ? '—' : hm(ortSure)) + '</b><small>Ort. süre</small></div>' +
      '<div class="kpi"><b>' + (ortKm == null ? '—' : (ortKm.toFixed(1).replace('.', ',') + ' km')) + '</b><small>Ort. mesafe</small></div>' +
      '</div>';
    main.innerHTML = kpi + '<div class="card" style="padding:10px 12px;margin-bottom:8px"><b>' + rows.length + ' paket</b>' +
      '<small style="color:var(--t2)"> · ' + day0.toLocaleDateString('tr-TR') + (delivered.length ? ' · ' + delivered.length + ' teslim' : '') + '</small></div>' +
      (rows.length ? '<div class="tblwrap"><table class="rtbl"><thead><tr>' +
        '<th>Tarih</th><th>Talep</th><th>Kurye</th><th>Süre</th><th>Km</th><th>Tutar</th><th>Öd</th>' +
        '</tr></thead><tbody>' + rows.map(function (p) {
          var sure = p.created_at && p.delivered_at ? p.delivered_at - p.created_at : null;
          return '<tr data-rp="' + p.id + '">' +
            '<td>' + (p.created_at ? new Date(p.created_at * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—') + '</td>' +
            '<td>#' + p.batch + '-' + p.number + '</td>' +
            '<td>' + esc(p.courier_name || '—') + '</td>' +
            '<td>' + hm(sure) + '</td>' +
            '<td>' + (p.distance_km == null ? '—' : kmf(p.distance_km)) + '</td>' +
            '<td>' + (p.fee_tl == null ? '—' : money(p.fee_tl)) + '</td>' +
            '<td>' + (p.payment_received === true ? '<span class="pcheck on">✓</span>' : p.payment_received === false ? '<span class="pcheck off">✕</span>' : '—') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty"><b>Bugün paket yok</b>Bugün oluşturulan sipariş bulunmuyor.</div>');
    Array.prototype.forEach.call(main.querySelectorAll('[data-rp]'), function (tr) {
      tr.onclick = function () {
        var id = Number(tr.getAttribute('data-rp'));
        var p = rows.filter(function (x) { return x.id === id; })[0];
        if (p) restPkgSheet(p);
      };
    });
    $('cta').innerHTML = '';
    nav(restaurantTabs(), {});
  }

  function renderRestPaketlerim() {
    setHeader('Paketlerim', '');
    var filters = [['all', 'Tümü'], ['open', 'Açık'], ['closed', 'Kapalı']];
    var main = $('mn');
    var items = (S.restItems && S.restItems.items) || [];
    main.innerHTML = '<div class="seg three">' + filters.map(function (f) {
      return '<button data-f="' + f[0] + '" class="' + (S.restFilter === f[0] ? 'on' : '') + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
    (function () {
      var n = restAdvCount();
      return '<div class="filterbar"><button id="rf-open">⚙ Filtre' + (n ? ' (' + n + ')' : '') + '</button>' +
        (n ? '<button id="rf-clear-page">✕ Temizle</button>' : '') + '</div>';
    })() +
    (function () {
      var list = restApplyAdv(items);
      return list.length ? list.map(function (p) {
      var st = String(p.status || '');
      var cls = /İptal/i.test(st) ? 'cancelled' : /Teslim/i.test(st) ? 'delivered' : /Yolda/i.test(st) ? 'onway'
        : /Kabul/i.test(st) ? 'accepted' : 'waiting';
      return '<button class="rrow ' + cls + '" data-pkg="' + p.id + '">' +
        '<span class="rl"><b>Talep #' + p.batch + '-' + p.number + '</b>' +
          '<small>' + esc(p.region || 'Bölge yok') + ' · ' + esc(p.payment || 'Ödeme yok') + '</small></span>' +
        '<span class="rr"><em class="stg">' + esc(st || '—') + '</em>' + restSure(p) + '</span></button>';
      }).join('') : '<div class="empty"><b>Kayıt yok</b>Bu filtrede paket bulunmuyor.</div>';
    })();
    Array.prototype.forEach.call(main.querySelectorAll('button[data-f]'), function (b) {
      b.onclick = function () { S.restFilter = b.getAttribute('data-f'); loadRest(); };
    });
    Array.prototype.forEach.call(main.querySelectorAll('[data-pkg]'), function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-pkg'));
        var p = items.filter(function (x) { return x.id === id; })[0];
        if (p) restPkgSheet(p);
      };
    });
    var rf = main.querySelector('#rf-open');
    if (rf) rf.onclick = restFilterSheet;
    var rc = main.querySelector('#rf-clear-page');
    if (rc) rc.onclick = function () { S.restAdv = null; loadRest(); };
    $('cta').innerHTML = '';
    nav(restaurantTabs(), {});
  }

  /** Paketlerim süresi: teslim edilmişse sabit (yeşil), iptalde yok, açıkta canlı sayar. */
  function restSure(p) {
    if (!p.created_at) return '';
    if (p.delivered_at) {
      var dk = Math.max(0, Math.round((p.delivered_at - p.created_at) / 60));
      var txt = dk >= 60 ? (Math.floor(dk / 60) + ' sa ' + (dk % 60) + ' dk') : (dk + ' dk');
      return '<em class="sure done">✓ ' + txt + '</em>';
    }
    if (p.cancelled_at) return '';
    return sureEtiket(p.created_at);
  }

  function restAdvCount() {
    var f = S.restAdv || {}, n = 0;
    if (f.from || f.to) n++;
    if (f.status) n++;
    if (f.pay) n++;
    return n;
  }

  function restApplyAdv(items) {
    var f = S.restAdv || {};
    return items.filter(function (p) {
      if (f.from && p.created_at && p.created_at < f.from) return false;
      if (f.to && p.created_at && p.created_at > f.to) return false;
      if (f.status) {
        var s = String(p.status || '');
        if (f.status === 'havuz' && !/Havuzda bekliyor/i.test(s)) return false;
        if (f.status === 'kabul' && s !== 'Kabul edildi') return false;
        if (f.status === 'aktarim' && !/Aktarım onayı/i.test(s)) return false;
        if (f.status === 'yolda' && !/Yolda|Kuryede/i.test(s)) return false;
        if (f.status === 'teslim' && s !== 'Teslim edildi') return false;
        if (f.status === 'iptal' && s !== 'İptal edildi') return false;
      }
      if (f.pay === 'var' && p.payment_received !== true) return false;
      if (f.pay === 'yok' && p.payment_received !== false) return false;
      return true;
    });
  }

  function restFilterSheet() {
    var f = S.restAdv || {};
    var day = function (offset) {
      var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset);
      return d;
    };
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    var start = f.from ? new Date(f.from * 1000) : day(0);
    var end = f.to ? new Date(f.to * 1000) : day(0);
    var preset = f.preset || '';
    var sh = UI.openSheet(
      '<div class="sheethead"><h2>Filtrele</h2><div class="shead-acts">' +
        '<button class="sheetc" id="rf-clear" title="Filtreyi temizle">↺</button>' +
        '<button class="sheetx" id="rf-x" title="Kapat">✕</button></div></div>' +
      '<div class="fld"><label>Zaman</label><div class="seg four">' +
        '<button data-t="" class="' + (preset === '' ? 'on' : '') + '">Tümü</button>' +
        '<button data-t="today" class="' + (preset === 'today' ? 'on' : '') + '">Bugün</button>' +
        '<button data-t="yesterday" class="' + (preset === 'yesterday' ? 'on' : '') + '">Dün</button>' +
        '<button data-t="range" class="' + (preset === 'range' ? 'on' : '') + '">Tarih aralığı</button>' +
      '</div></div>' +
      '<div id="rf-dates" style="display:' + (preset === 'range' ? 'block' : 'none') + '">' +
        '<div class="fld"><label>Başlangıç</label><input id="rf-from" type="date" value="' + iso(start) + '"></div>' +
        '<div class="fld"><label>Bitiş</label><input id="rf-to" type="date" value="' + iso(end) + '"></div>' +
      '</div>' +
      '<div class="fld"><label>Durum</label><div class="seg two">' +
        [['havuz', 'Havuzda bekliyor'], ['kabul', 'Kabul edildi'], ['aktarim', 'Aktarım onayı bekleniyor'],
         ['yolda', 'Kuryede / Yolda'], ['teslim', 'Teslim edildi'], ['iptal', 'İptal edildi']]
          .map(function (x) { return '<button data-st="' + x[0] + '" class="' + ((f.status || '') === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="fld"><label>Ödeme durumu</label><div class="seg four">' +
        [['', 'Tümü'], ['var', 'Ödeme yapıldı'], ['yok', 'Ödeme yapılmadı']]
          .map(function (x) { return '<button data-pay="' + x[0] + '" class="' + ((f.pay || '') === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') +
      '</div></div>' +
      '<button class="p" id="rf-apply" style="width:100%">Filtrele</button>');
    var pick = { preset: preset, status: f.status || '', pay: f.pay || '' };
    Array.prototype.forEach.call(sh.querySelectorAll('[data-t],[data-st],[data-pay]'), function (b) {
      b.onclick = function () {
        if (b.hasAttribute('data-t')) pick.preset = b.getAttribute('data-t');
        else if (b.hasAttribute('data-st')) {
          var v = b.getAttribute('data-st');
          pick.status = pick.status === v ? '' : v;
        }
        else pick.pay = b.getAttribute('data-pay');
        var group = b.parentElement;
        Array.prototype.forEach.call(group.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (b.hasAttribute('data-t')) {
          if (pick.preset === 'today' || pick.preset === 'yesterday') {
            var d0 = pick.preset === 'yesterday' ? day(-1) : day(0);
            sh.querySelector('#rf-from').value = iso(d0);
            sh.querySelector('#rf-to').value = iso(d0);
          }
          sh.querySelector('#rf-dates').style.display = pick.preset === 'range' ? 'block' : 'none';
        }
      };
    });
    sh.querySelector('#rf-x').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#rf-clear').onclick = function () {
      S.restAdv = null; UI.closeSheet(); loadRest();
    };
    sh.querySelector('#rf-apply').onclick = function () {
      var fromS = sh.querySelector('#rf-from').value, toS = sh.querySelector('#rf-to').value;
      var from = pick.preset === '' ? null : (fromS ? Math.floor(new Date(fromS + 'T00:00:00').getTime() / 1000) : null);
      var to = pick.preset === '' ? null : (toS ? Math.floor(new Date(toS + 'T23:59:59').getTime() / 1000) : null);
      if (from && to && from > to) { UI.toast('Bitiş tarihi başlangıçtan önce olamaz', 'error'); return; }
      S.restAdv = { from: from, to: to, status: pick.status, pay: pick.pay, preset: pick.preset };
      UI.closeSheet(); loadRest();
    };
  }

  var CANCEL_REASONS = ['Müşteri iptal etti', 'Adres yanlış', 'Restoran kapandı', 'Gecikme', 'Paket hasarlı', 'Müşteriye ulaşılamadı', 'Diğer'];

  function restPkgSheet(p) {
    var roleName = function (r) { return r === 'restoran' ? 'Restoran' : r === 'kurye' ? 'Kurye' : 'Yönetici'; };
    var kapali = !!p.cancelled_at || !!p.delivered_at;
    var sh = UI.openSheet(
      '<div class="pk">' +
        '<div class="pk-title">SİPARİŞ KARTI</div>' +
        '<div class="pk-hd"><b>' + esc(p.restaurant || '') + '</b><em class="lb r">' + esc(p.region || '—') + '</em>' +
          UI.statusTag(p.status) + '</div>' +
        '<div class="pk-bd"><dl class="pk-fields">' +
          '<dt>Sipariş no</dt><dd>Talep #' + p.batch + '-' + p.number + '</dd>' +
          '<dt>Restoran</dt><dd>' + esc(p.restaurant || '—') + '</dd>' +
          '<dt>Bölge</dt><dd>' + esc(p.region || '—') + '</dd>' +
          '<dt>Ödeme</dt><dd>' + esc(p.payment || '—') + '</dd>' +
          '<dt>Yetkili</dt><dd>' + esc(p.restaurant_contact || '—') + '</dd>' +
          '<dt>Oluşturma</dt><dd>' + dt(p.created_at) + '</dd>' +
          '<dt>Kabul</dt><dd>' + dt(p.accepted_at) + '</dd>' +
          '<dt>Alım</dt><dd>' + dt(p.picked_up_at) + '</dd>' +
          '<dt>Teslim</dt><dd>' + dt(p.delivered_at) + '</dd>' +
          '<dt>İptal</dt><dd>' + dt(p.cancelled_at) + '</dd>' +
          '<dt>Kurye</dt><dd>' + esc(p.courier_name || '—') + '</dd>' +
          '<dt>Mesafe</dt><dd>' + (p.distance_km == null ? '—' : kmf(p.distance_km)) + '</dd>' +
          '<dt>Ücret</dt><dd>' + (p.fee_tl == null ? '—' : money(p.fee_tl)) + '</dd>' +
          '<dt>Hakediş</dt><dd>' + (p.payment_received === true ? 'Alındı' : p.payment_received === false ? 'Alınmadı' : '—') + '</dd>' +
          '<dt>Restoran notu</dt><dd>' + esc(p.note || '—') + '</dd>' +
          '<dt>Kurye notu</dt><dd>' + esc(p.courier_note || '—') + '</dd>' +
        '</dl>' +
        (p.cancelled_at ? '<p class="note">İptal: ' + esc(p.cancel_reason || '—') + ' · İptal eden: ' +
          esc(roleName(p.cancelled_by_role)) + ' · ' + esc(p.cancelled_by_name || '—') + '</p>' : '') +
        '</div>' +
        '<div class="pk-ft">' +
          (kapali ? '' : '<button class="d w" id="rp-cancel">İptal Et</button>') +
          '<button class="w pkexit" id="rp-close">Çıkış</button>' +
        '</div>' +
      '</div>',
      { full: true, onClose: function () { loadRest(); } });
    sh.querySelector('#rp-close').onclick = function () { UI.closeSheet(); };
    var cb = sh.querySelector('#rp-cancel');
    if (cb) cb.onclick = function () {
      var s2 = UI.openSheet(
        '<h2>İptal gerekçesi</h2>' +
        '<div class="fld"><label>Gerekçe</label><select id="rr">' + CANCEL_REASONS.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
        '<button class="d" id="rr-ok" style="width:100%">İptali Onayla</button>' +
        '<button class="d" id="rr-back" style="width:100%;margin-top:6px">Vazgeç</button>');
      s2.querySelector('#rr-back').onclick = function () { UI.closeSheet(); };
      s2.querySelector('#rr-ok').onclick = function () {
        eylem('iptal', { id: p.id, reason: s2.querySelector('#rr').value }).then(function () {
          UI.closeSheet(); UI.toast('Paket iptal edildi', 'success'); loadRest();
        }).catch(function (e) { UI.toast(e.message || 'İptal edilemedi', 'error'); });
      };
    };
  }


  /* ---------------- Faz B2: istemci eylem kuyruğu (offline/5xx) ---------------- */
  var KUYRUK_KEY = 'eylemKuyrugu';

  function qList() {
    try { return JSON.parse(localStorage.getItem(KUYRUK_KEY) || '[]'); } catch (e) { return []; }
  }
  function qSave(list) {
    try { localStorage.setItem(KUYRUK_KEY, JSON.stringify(list.slice(-100))); } catch (e) {}
    qBadge();
  }
  function qPush(item) {
    var list = qList().filter(function (x) { return x.id !== item.id; });
    list.push(item);
    qSave(list);
  }
  function qDel(id) {
    qSave(qList().filter(function (x) { return x.id !== id; }));
  }
  function qBadge() {
    var n = qList().length;
    var el = document.getElementById('qbadge');
    if (!el) return;
    el.textContent = n ? ('⏳ ' + n) : '';
    el.hidden = !n;
  }
  function yeniAnahtar() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'k' + Date.now() + Math.floor(Math.random() * 1e6);
  }
  function istekGonder(tur, veri, key) {
    if (tur === 'km') return API.kmGir(veri.id, veri.km, veri.note, key);
    if (tur === 'teslim') return API.teslim(veri.id, veri.paid, key);
    if (tur === 'iptal') return API.iptal(veri.id, veri.reason, key);
    if (tur === 'not') return API.notEkle(veri.id, veri.note, key);
    if (tur === 'odeme') return API.odeme(veri.ids, veri.all, key);
    if (tur === 'kabul') return API.kabul(veri.ids, key);
    return Promise.reject(new Error('Bilinmeyen işlem: ' + tur));
  }
  /** Kalıcı hata mı? (kuyrukta tutmanın anlamı yok) */
  function kaliciHata(e) {
    return !!e && !!e.status && e.status < 500 && e.status !== 408 && e.status !== 429;
  }
  /** İşlemi hemen dener; ağ/5xx ise kuyruğa alır. */
  function eylem(tur, veri) {
    var key = yeniAnahtar();
    return istekGonder(tur, veri, key).catch(function (e) {
      if (kaliciHata(e)) throw e;
      qPush({ id: key, tur: tur, veri: veri, ts: Date.now(), tries: 0 });
      UI.toast('Bağlantı sorunu — işlem kuyruğa alındı, otomatik gönderilecek', 'error');
      return { queued: true };
    });
  }
  /** Kuyruğu sırayla işler; başarılı/ kalıcı hatalı olanları çıkarır. */
  var qCalisiyor = false;
  function qRun() {
    if (qCalisiyor) return Promise.resolve();
    var list = qList();
    if (!list.length) return Promise.resolve();
    qCalisiyor = true;
    var i = 0;
    function sonraki() {
      if (i >= list.length) { qCalisiyor = false; qBadge(); return Promise.resolve(); }
      var it = list[i++];
      return istekGonder(it.tur, it.veri, it.id).then(function () {
        qDel(it.id);
      }).catch(function (e) {
        if (kaliciHata(e)) {
          qDel(it.id);
          UI.toast((e.message || 'İşlem reddedildi') + ' (kuyruktan çıkarıldı)', 'error');
        } else {
          it.tries = (it.tries || 0) + 1;
          if (it.tries >= 5) {
            qDel(it.id);
            UI.toast('İşlem 5 denemede gönderilemedi; yöneticiye bildirin', 'error');
          } else {
            qSave(list.map(function (x) { return x.id === it.id ? it : x; }));
          }
        }
      }).then(sonraki);
    }
    return sonraki().then(function () { qBadge(); });
  }

  function setKuryeDurum(st, reason) {
    if (!S.session || !S.session.user) return;
    API.durum(st, reason).then(function (r) {
      S.session.user.online = st === 'online';
      S.session.user.busy = !!r.busy;
      S.session.user.busy_reason = r.reason || null;
      UI.toast(st === 'online' ? 'Çevrimiçi oldunuz' : st === 'busy' ? 'Meşgul olarak işaretlendiniz' : 'Çevrimdışı oldunuz', 'success');
      closeDrawer();
      render();
    }).catch(function (e) {
      if (e && e.code === 'has_active') { bilgiSheet('Durum değiştirilemedi', e.message); return; }
      UI.toast(e.message || 'Durum değişmedi', 'error');
    });
  }

  function bilgiSheet(baslik, metin) {
    var sh = UI.openSheet('<h2>' + esc(baslik) + '</h2><p style="white-space:pre-wrap">' + esc(metin) + '</p>' +
      '<button class="p" id="bi-kapat" style="width:100%">Tamam</button>');
    sh.querySelector('#bi-kapat').onclick = function () { UI.closeSheet(); };
  }

  function mesgulSebepSheet() {
    var sh = UI.openSheet('<h2>Meşgul sebebi</h2>' +
      '<p>Bu süre boyunca yeni paket almazsınız.</p>' +
      '<div class="seg two">' + ['Mola', 'Arıza', 'Kaza', 'İhtiyaç'].map(function (r) {
        return '<button data-br2="' + r + '">' + r + '</button>';
      }).join('') + '</div>' +
      '<button class="d" id="br-cancel" style="width:100%;margin-top:10px">Vazgeç</button>');
    sh.querySelector('#br-cancel').onclick = function () { UI.closeSheet(); };
    Array.prototype.forEach.call(sh.querySelectorAll('[data-br2]'), function (b) {
      b.onclick = function () {
        var aktif = (S.mine && S.mine.packages) ? S.mine.packages.length : 0;
        if (aktif > 0) {
          UI.closeSheet();
          setTimeout(function () { bilgiSheet('Durum değiştirilemedi', DURUM_KILIT_MSG); }, 120);
          return;
        }
        UI.closeSheet(); setKuryeDurum('busy', b.getAttribute('data-br2'));
      };
    });
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
    var pinSection = '<div class="pinset" style="border-top:1px solid var(--ln);margin-top:12px;padding-top:10px">' +
      (S.pinEdit
        ? '<div class="fld"><label>Mevcut PIN</label><div class="pinwrap"><input id="po" type="password" inputmode="numeric" maxlength="4" value="' + esc((S.session && S.session.user && S.session.user.pin) || '') + '"><button type="button" class="eye" data-eye="po">👁</button></div></div>' +
          '<div class="fld"><label>Yeni PIN</label><div class="pinwrap"><input id="pn" type="password" inputmode="numeric" maxlength="4"><button type="button" class="eye" data-eye="pn">👁</button></div></div>' +
          '<div class="fld"><label>Yeni PIN (tekrar)</label><div class="pinwrap"><input id="pn2" type="password" inputmode="numeric" maxlength="4"><button type="button" class="eye" data-eye="pn2">👁</button></div></div>' +
          '<div class="err" id="pinerr"></div>' +
          '<div class="acts"><button class="p sm" id="pin-save">Kaydet</button><button class="sm" id="pin-cancel">İptal</button></div>'
        : '<div class="pinrow"><span>PIN: ••••</span><button class="sm" id="pin-edit">Düzenle</button></div>') +
      '</div>';
    var actionRow = '<div class="acts" style="margin-top:12px;align-items:center">' +
      (editing
        ? '<button class="p sm" id="p-save">Kaydet</button><button class="sm" id="p-cancel">İptal</button>'
        : '<button class="sm" id="p-edit">Düzenle</button>') + '</div>';
    main.innerHTML = '<div class="card oc" style="padding:12px">' + fields + pinSection + actionRow + '</div>' +
      (!isRest ? '<p class="note" style="padding:10px 4px">Kurye paket sınırı: <b>' + (((S.session || {}).settings || {}).limit || '—') +
        '</b> paket · Yönetici tarafından belirlenir.</p>' : '');

    var pe = $('pin-edit');
    if (pe) pe.onclick = function () { S.pinEdit = true; render(); };
    var pc = $('pin-cancel');
    if (pc) pc.onclick = function () { S.pinEdit = false; render(); };
    var ps = $('pin-save');
    if (ps) ps.onclick = function () {
      var po = $('po').value.trim(), pn = $('pn').value.trim(), pn2 = $('pn2').value.trim(), perr = $('pinerr');
      perr.textContent = '';
      if (!/^\d{4}$/.test(pn)) { perr.textContent = 'Yeni PIN 4 haneli olmalı'; return; }
      if (pn !== pn2) { perr.textContent = 'Yeni PIN’ler uyuşmuyor'; return; }
      API.pinDegistir(po, pn).then(function () {
        S.pinEdit = false; UI.toast('PIN güncellendi', 'success'); render();
      }).catch(function (e) { perr.textContent = e.message || 'Güncellenemedi'; });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-eye]'), function (b) {
      b.onclick = function () {
        var inp = document.getElementById(b.getAttribute('data-eye'));
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.textContent = inp.type === 'password' ? '👁' : '🙈';
      };
    });
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

  function renderKurallar() {
    setHeader('Kurallar', 'Operasyon kuralları');
    var main = $('mn');
    var data = window.KURALLAR || [];
    main.innerHTML = data.map(function (b) {
      return '<div class="card rulecard"><b>' + esc(b.baslik) + '</b><ul>' +
        b.maddeler.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>';
    }).join('') || '<div class="empty">Kural tanımlı değil.</div>';
    $('cta').innerHTML = '';
    nav(curRole() === 'restoran' ? restaurantTabs() : courierTabs(), {});
  }

  function renderSistem() {
    setHeader('Sistem', 'Fiyatlandırma · Restoranlar · Kuryeler · Bölgeler · v10');
    var main = $('mn');
    var admin = S.session && S.session.role === 'yonetici';
    var restoran = S.session && S.session.role === 'restoran';
    var sekmeler = admin
      ? [['fiyat', 'Fiyatlandırma'], ['restoran', 'Restoranlar'], ['kurye', 'Kuryeler'], ['bolge', 'Bölgeler'], ['log', 'Tanılama']]
      : [['fiyat', 'Fiyatlandırma'], ['kurallar', 'Kurallar']];
    var seg = '<div class="seg four">' + sekmeler.map(function (x) {
      return '<button data-st="' + x[0] + '" class="' + (S.sistemTab === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    function bindSeg() {
      Array.prototype.forEach.call(main.querySelectorAll('[data-st]'), function (b) {
        b.onclick = function () { S.sistemTab = b.getAttribute('data-st'); render(); };
      });
    }
    function saatlerKart(st) {
      return '<div class="card" style="padding:12px;margin-bottom:10px"><b>Çalışma saatleri</b>' +
        '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:14px"><span>Açılış</span><b>' + esc(st.open_time || '07:00') + '</b></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:14px"><span>Kapanış</span><b>' + esc(st.close_time || '22:00') + '</b></div></div>';
    }
    function kurallarHtml(st) {
      var r = st.rules || {};
      var bolum = function (baslik, metin) {
        if (!metin) return '';
        var satirlar = String(metin).split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        return '<div class="card rulecard"><b>' + esc(baslik) + '</b><ul>' +
          satirlar.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>';
      };
      var liste = bolum('Mesafeler', r.mesafeler) + bolum('Teslimat Süresi', r.teslimat) +
        bolum('İptal Durumları', r.iptal) + bolum('Cihaz (POS–Telefon)', r.cihaz) + bolum('Sabit Kurye', r.sabit);
      return saatlerKart(st) + (liste || '<div class="empty">Kural tanımlı değil.</div>');
    }
    function draw() {
      var d = S.sistem;
      if (!d) { main.innerHTML = seg + '<div class="empty">Yükleniyor…</div>'; bindSeg(); return; }
      var body = '';
      var st = d.settings || {};
      if (S.sistemTab === 'kurallar') {
        body = kurallarHtml(st);
      } else if (S.sistemTab === 'fiyat') {
        var tariff = st.tariff || [], labels = st.tariff_intervals || [];
        body = '<div class="card" style="padding:12px"><b>Mesafe ücretleri (sabit)</b>' + tariff.map(function (v, i) {
          return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--ln);font-size:13px">' +
            '<span>' + esc(labels[i] || (i === 0 ? '0–3' : i + '. aralık')) + ' km</span><b>' + money(v) + '</b></div>';
        }).join('') +
        '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>10+ km · km başı ek</span><b>' + money(st.extra_per_km != null ? st.extra_per_km : 100) + '</b></div>' +
        '<p class="note" style="margin-top:8px">10 km üzerindeki her km için bu tutar eklenir. Örnek: 12,1 km → 640 TL + 3 × ek ücret.</p></div>';
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
      sh.querySelector('#as-ok').disabled = true;
      var refs = items.map(function (n) { return n.ref; }).filter(Boolean);
      Promise.all(refs.map(function (id) { return API.atamaKarar(id, true).catch(function () {}); }))
        .then(function () {
          return markRead();
        }).then(function () {
          UI.closeSheet(); UI.toast('Paketler kabul edildi', 'success'); refresh(true);
        });
    };
    sh.querySelector('#as-rej').onclick = function () {
      sh.querySelector('#as-rej').disabled = true;
      var refs = items.map(function (n) { return n.ref; }).filter(Boolean);
      Promise.all(refs.map(function (id) {
        return API.atamaKarar(id, false).catch(function () {});
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
    var h = '<h3>Sayfalar</h3>' + pages.map(function (p) {
      return '<button data-dt="' + p[0] + '" class="' + (S.tab === p[0] ? 'on' : '') + '"><i>' + p[1] + '</i>' + p[2] + '</button>';
    }).join('');
    h += '<h3>İşlemler</h3>';
    h += '<button data-da="refresh"><i>↻</i>Yenile</button>';
    h += '<button data-dt="sistem" class="' + (S.tab === 'sistem' ? 'on' : '') + '"><i>⚙</i>Sistem</button>';
    h += '<button data-dt="profil" class="' + (S.tab === 'profil' ? 'on' : '') + '"><i>👤</i>Profil</button>';
    h += '<button data-da="logout"><i>⏻</i>Çıkış</button>';
    if (role !== 'restoran' && S.session && S.session.user) {
      var u = S.session.user;
      var cur = u.busy ? 'busy' : (u.online ? 'online' : 'offline');
      h += '<div class="drawer-status">' +
        [['online', 'Online'], ['busy', 'Meşgul'], ['offline', 'Offline']].map(function (x) {
          return '<button data-dst="' + x[0] + '" class="' + (cur === x[0] ? 'on ' + x[0] : '') + '">' + x[1] + '</button>';
        }).join('') + '</div>';
    }
    d.innerHTML = h;
    Array.prototype.forEach.call(d.querySelectorAll('[data-dt]'), function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-dt'); closeDrawer(); render(); refresh(false); };
    });
    Array.prototype.forEach.call(d.querySelectorAll('[data-dst]'), function (b) {
      b.onclick = function () {
        var st = b.getAttribute('data-dst');
        var aktif = (S.mine && S.mine.packages) ? S.mine.packages.length : 0;
        if (st !== 'online' && aktif > 0) {
          closeDrawer();
          setTimeout(function () { bilgiSheet('Durum değiştirilemedi', DURUM_KILIT_MSG); }, 120);
          return;
        }
        closeDrawer();
        if (st === 'busy') { setTimeout(function () { mesgulSebepSheet(); }, 120); return; }
        setKuryeDurum(st, null);
      };
    });
    Array.prototype.forEach.call(d.querySelectorAll('[data-da]'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-da');
        if (a === 'logout') { localStorage.removeItem('loginToken'); localStorage.removeItem('loginTokenUser'); localStorage.removeItem('pinToken'); localStorage.removeItem('pinTokenUser'); location.reload(); return; }
        closeDrawer();
        if (a === 'refresh') hardReload();
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
    updateWho();
    var ct = $('cta'); if (ct && !(curRole() === 'restoran' && S.tab === 'talep')) ct.innerHTML = '';
    var role = curRole();
    if (role === 'restoran') {
      if (S.tab === 'talep') renderTalep();
      else if (S.tab === 'rapor') renderRestRapor();
      else if (S.tab === 'sistem') renderSistem();
      else if (S.tab === 'kurallar') renderKurallar();
    else if (S.tab === 'profil') renderProfil();
      else renderRestPaketlerim();
      renderDrawer();
      return;
    }
    if (S.tab === 'loglar') renderLogs();
    else if (S.tab === 'sistem') renderSistem();
    else if (S.tab === 'kurallar') renderKurallar();
    else if (S.tab === 'profil') renderProfil();
    else if (S.tab === 'paketlerim') renderPaketlerim();
    else if (S.tab === 'gecmis') renderGecmis();
    else renderHavuz();
    renderIcons();
    renderDrawer();
  }

  function loadRest() {
    var f = S.tab === 'rapor' ? 'all' : S.restFilter;
    return API.paketlerimRestoran(f).then(function (r) { S.restItems = r; render(); });
  }

  function refresh(full) {
    var ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return Promise.resolve();
    var role = curRole();
    if (role === 'restoran') {
      if (S.tab === 'paketlerim') return loadRest().catch(function () {});
      render();
      return Promise.resolve();
    }
    // Faz C: tek uç — havuz + teklifler + bildirimler (+ gerekiyorsa kendi paketlerim)
    var kendi = !!(full || S.tab === 'paketlerim');
    var jobs = [API.durum(S.damga || '', kendi).then(function (r) {
      if (r && r.unchanged) return;
      S.damga = r.v || '';
      if (r.pool) S.pool = r.pool;
      if (r.offers) S.offers = r.offers;
      if (r.notifs) S.notifs = r.notifs;
      if (r.mine) S.mine = r.mine;
    })];
    if (full || S.tab === 'gecmis') jobs.push(API.gecmis().then(function (r) { S.history = r; }));
    if (full || S.tab === 'kazanc' || (S.tab === 'gecmis' && S.histTab === 'kazanc')) jobs.push(API.kazanc(S.kazancRange, S.kazancDate).then(function (r) { S.earnings = r; }));
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
  function startSession(s) {
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
  // Faz A2: 15 sn ± %20 jitter; sekme gizliyken istek atılmaz
  (function dongu() {
    var gecikme = (window.API && API.jitter) ? API.jitter(15000, 0.2) : 15000;
    setTimeout(function () {
      if (!document.hidden) refresh(false);
      dongu();
    }, gecikme);
  })();
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh(false);
  });
  }

  function pinGate(s) {
    API.pinDurum().then(function (d) {
      if (!d.has_pin) return renderPinCreate(s);
      var tok = localStorage.getItem('pinToken') || '';
      var tokUser = localStorage.getItem('pinTokenUser') || '';
      var exp = Number((tok.split('.')[0] || '0'));
      if (tok && String((s.user || {}).id) !== tokUser) { tok = ''; localStorage.removeItem('pinToken'); localStorage.removeItem('pinTokenUser'); }
      if (!window.__pinVerified && (!tok || exp < Math.floor(Date.now() / 1000))) return renderPinEnter(s, d.phone);
      window.__pinVerified = true;
      startSession(s);
    }).catch(function () { startSession(s); });
  }

  function renderPinCreate(s) {
    setHeader('PIN oluştur', '4 haneli güvenlik PIN’i');
    $('hdr-right').innerHTML = '';
    $('nv').innerHTML = '';
    $('mn').innerHTML = '<div class="card" style="padding:14px">' +
      '<p class="note">Uygulamayı her açtığınızda sorulacak 4 haneli PIN belirleyin.</p>' +
      '<div class="fld"><label>Yeni PIN</label><div class="pinwrap"><input id="pin1" inputmode="numeric" maxlength="4" type="password" placeholder="••••" autocomplete="new-password"><button type="button" class="eye" data-eye="pin1">👁</button></div></div>' +
      '<div class="fld"><label>PIN (tekrar)</label><div class="pinwrap"><input id="pin2" inputmode="numeric" maxlength="4" type="password" placeholder="••••" autocomplete="new-password"><button type="button" class="eye" data-eye="pin2">👁</button></div></div>' +
      '<div class="err" id="pinerr"></div>' +
      '<button class="p" id="pinsave" style="width:100%">PIN Oluştur</button></div>';
    $('pinsave').onclick = function () {
      var p1 = $('pin1').value.trim(), p2 = $('pin2').value.trim(), err = $('pinerr');
      err.textContent = '';
      if (!/^\d{4}$/.test(p1)) { err.textContent = 'PIN 4 haneli olmalı'; return; }
      if (p1 !== p2) { err.textContent = 'PIN’ler uyuşmuyor'; return; }
      API.pinOlustur(p1).then(function (r) {
        localStorage.setItem('pinToken', r.token);
        localStorage.setItem('pinTokenUser', String((s.user || {}).id));
        window.__pinVerified = true;
        UI.toast('PIN oluşturuldu', 'success');
        startSession(s);
      }).catch(function (e) { err.textContent = e.message || 'Oluşturulamadı'; });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-eye]'), function (b) {
      b.onclick = function () {
        var inp = document.getElementById(b.getAttribute('data-eye'));
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.textContent = inp.type === 'password' ? '👁' : '🙈';
      };
    });
  }

  function renderPinChange() {
    setHeader('PIN Belirle', 'İlk giriş');
    $('hdr-right').innerHTML = '';
    $('nv').innerHTML = '';
    $('mn').innerHTML = '<div class="card" style="padding:14px">' +
      '<p class="note">Güvenlik için yöneticinizin verdiği PIN\'i değiştirin.</p>' +
      '<div class="fld"><label>Mevcut PIN</label><div class="pinwrap"><input id="pc-old" inputmode="numeric" maxlength="4" type="password" value="1234"><button type="button" class="eye" data-eye="pc-old">👁</button></div></div>' +
      '<div class="fld"><label>Yeni PIN</label><div class="pinwrap"><input id="pc-new" inputmode="numeric" maxlength="4" type="password" placeholder="••••"><button type="button" class="eye" data-eye="pc-new">👁</button></div></div>' +
      '<div class="fld"><label>Yeni PIN (tekrar)</label><div class="pinwrap"><input id="pc-new2" inputmode="numeric" maxlength="4" type="password" placeholder="••••"><button type="button" class="eye" data-eye="pc-new2">👁</button></div></div>' +
      '<div class="err" id="pc-err"></div>' +
      '<button class="p" id="pc-save" style="width:100%">Kaydet ve Devam Et</button></div>';
    $('pc-save').onclick = function () {
      var o = $('pc-old').value.trim(), n = $('pc-new').value.trim(), n2 = $('pc-new2').value.trim(), e = $('pc-err');
      e.textContent = '';
      if (!/^\d{4}$/.test(n)) { e.textContent = 'Yeni PIN 4 haneli olmalı'; return; }
      if (n !== n2) { e.textContent = 'PIN\'ler uyuşmuyor'; return; }
      if (n === o) { e.textContent = 'Yeni PIN eskisinden farklı olmalı'; return; }
      API.pinDegistir(o, n).then(function () {
        UI.toast('PIN güncellendi', 'success');
        location.reload();
      }).catch(function (err) { e.textContent = err.message || 'Güncellenemedi'; });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-eye]'), function (b) {
      b.onclick = function () {
        var inp = document.getElementById(b.getAttribute('data-eye'));
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.textContent = inp.type === 'password' ? '👁' : '🙈';
      };
    });
  }

  function renderLogin() {
    setHeader('Giriş', 'Telefon ve PIN');
    $('hdr-right').innerHTML = '';
    $('nv').innerHTML = '';
    $('mn').innerHTML = '<div class="card" style="padding:14px">' +
      '<div class="fld"><label>Telefon</label><input id="lgphone" inputmode="tel" autocomplete="tel" placeholder="05xx xxx xx xx"></div>' +
      '<div class="fld"><label>4 haneli PIN</label><div class="pinwrap"><input id="lgpin" inputmode="numeric" maxlength="4" type="password" autocomplete="current-password" placeholder="••••"><button type="button" class="eye" data-eye="lgpin">👁</button></div></div>' +
      '<div class="err" id="lgerr"></div>' +
      '<button class="p" id="lgok" style="width:100%">Giriş Yap</button>' +
      '<p class="note" style="margin-top:10px">Hesabınız yoksa yöneticinizden talep edin. İlk girişte PIN değiştirmeniz istenir.</p>' +
      '<div class="testwarn">TEST GİRİŞİ · tüm PIN’ler 1234 · kaldırılacak</div>' +
      '<div id="lglistbox"><p class="note">Kullanıcılar yükleniyor…</p></div></div>';
    $('lgok').onclick = function () {
      var phone = ($('lgphone').value || '').trim(), pin = ($('lgpin').value || '').trim(), err = $('lgerr');
      err.textContent = '';
      if (phone.replace(/\D/g, '').length < 3) { err.textContent = 'Telefon numarasını tam girin'; return; }
      if (!/^\d{4}$/.test(pin)) { err.textContent = 'PIN 4 haneli olmalı'; return; }
      $('lgok').disabled = true;
      API.giris(phone, pin).then(function (r) {
        localStorage.setItem('loginToken', r.token);
        localStorage.setItem('loginTokenUser', String(r.id));
        localStorage.removeItem('pinToken');
        localStorage.removeItem('pinTokenUser');
        if (r.pin_must_change) { renderPinChange(); return; }
        if (r.role === 'yonetici') { location.replace('/admin'); return; }
        location.reload();
      }).catch(function (e) { $('lgok').disabled = false; err.textContent = e.message || 'Giriş yapılamadı'; });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-eye]'), function (b) {
      b.onclick = function () {
        var inp = document.getElementById(b.getAttribute('data-eye'));
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.textContent = inp.type === 'password' ? '👁' : '🙈';
      };
    });
    API.girisKullanicilar().then(function (r) {
      var box = $('lglistbox');
      var items = r.items || [];
      var order = function (x) { return x.role === 'restoran' ? 0 : x.role === 'kurye' ? 1 : 2; };
      items.sort(function (a, b) { return order(a) - order(b) || String(a.name).localeCompare(String(b.name)); });
      var rows = [];
      items.forEach(function (x) {
        var id = String(x.phone || x.id).replace(/\D/g, '').slice(-10);
        var label = x.role === 'yonetici' ? 'Yönetici' : x.role === 'restoran' ? 'Restoran' : 'Kurye';
        rows.push({ id: id, name: x.name, label: label });
      });
      box.innerHTML = '<div class="testlist">' + rows.map(function (x) {
        return '<button data-phone="' + esc(x.id) + '"><b>' + esc(x.name) + ' <em>' + x.label + '</em></b>' +
          '<span>' + esc(x.id) + ' · PIN ' + esc(r.pin || '1234') + '</span></button>';
      }).join('') + '</div>';
      Array.prototype.forEach.call(box.querySelectorAll('[data-phone]'), function (b) {
        b.onclick = function () {
          Array.prototype.forEach.call(box.querySelectorAll('[data-phone]'), function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          $('lgphone').value = b.getAttribute('data-phone');
          $('lgpin').value = r.pin || '1234';
          $('lgok').focus();
        };
      });
    }).catch(function (e) {
      var box = $('lglistbox');
      if (box) box.innerHTML = '<p class="err">' + esc(e.message || 'Kullanıcı listesi alınamadı') + '</p>';
    });
  }

  function renderPinEnter(s, phone) {
    setHeader('Giriş', 'PIN ile devam');
    $('hdr-right').innerHTML = '';
    $('nv').innerHTML = '';
    $('mn').innerHTML = '<div class="card" style="padding:14px">' +
      '<p class="note">Telefon: <b>' + esc(phone || '—') + '</b></p>' +
      '<div class="fld"><label>4 haneli PIN</label><input id="pin" inputmode="numeric" maxlength="4" type="password"></div>' +
      '<div class="err" id="pinerr"></div>' +
      '<button class="p" id="pinok" style="width:100%">Giriş Yap</button></div>';
    $('pinok').onclick = function () {
      var pin = $('pin').value.trim(), err = $('pinerr');
      err.textContent = '';
      if (!/^\d{4}$/.test(pin)) { err.textContent = 'PIN 4 haneli olmalı'; return; }
      API.pinDogrula(pin).then(function (r) {
        localStorage.setItem('pinToken', r.token);
        localStorage.setItem('pinTokenUser', String((s.user || {}).id));
        window.__pinVerified = true;
        startSession(s);
      }).catch(function (e) { err.textContent = e.message || 'Hatalı PIN'; });
    };
  }

  function boot() {
    sessionStorage.removeItem('actAs');
    API.init().then(function (s) {
      if (API.mode === 'real' && !localStorage.getItem('loginToken')) { renderLogin(); return; }
      if (s && s.role === 'yonetici') { location.replace('/admin' + location.hash); return; }
      if (s && s.need_login) { renderLogin(); return; }

      if (API.mode === 'real' && !localStorage.getItem('loginToken') && s && s.role !== 'yonetici') { pinGate(s); return; }
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
      // Faz A2: 15 sn ± %20 jitter (senkron dalgayı kırar), sekme gizliyken durur
      (function dongu() {
        var gecikme = (window.API && API.jitter) ? API.jitter(15000, 0.2) : 15000;
        setTimeout(function () {
          if (!document.hidden) refresh(false);
          dongu();
        }, gecikme);
      })();
      setInterval(tickElapsed, 30000);
      setInterval(tick, 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) refresh(false);
      });
    }).catch(function (e) {
      if (e && e.code === 'pin_change_required') { renderPinChange(); return; }
      if (!e || e.status === 401 || e.status === 403 || e.code === 'login_required' || e.code === 'need_login') {
        renderLogin();
        return;
      }
      $('hdr-right').innerHTML = '';
      $('nv').innerHTML = '';
      $('mn').innerHTML = '<div class="empty"><b>Bağlantı kurulamadı</b>' + esc(e.message || '') +
        '<br><br>İnternet bağlantınızı kontrol edip tekrar deneyin.</div>';
    });
  }

  window.addEventListener('online', function () { qRun(); });
  setInterval(function () { if (!document.hidden) qRun(); }, 30000);
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
