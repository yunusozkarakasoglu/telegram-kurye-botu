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
    tick: null
  };

  /* ---------------- yardımcılar ---------------- */
  function curRole() { return S.session && S.session.role ? S.session.role : 'courier'; }

  function courierTabs() {
    return [['havuz', '▤', 'Havuz'], ['paketlerim', '✓', 'Açık Paketler'], ['gecmis', '◷', 'Geçmiş'], ['kazanc', '₺', 'Kazanç']];
  }
  function restaurantTabs() {
    return [['talep', '＋', 'Talep Ver'], ['paketlerim', '▤', 'Paketlerim'], ['profil', '☺', 'Profil']];
  }

  function setHeader(title, sub) { $('ttl').textContent = title; $('sub').textContent = sub || ''; }

  function nav(items, counts) {
    var nv = $('nv');
    nv.innerHTML = items.map(function (x) {
      var c = counts && counts[x[0]];
      return '<button class="' + (S.tab === x[0] ? 'on' : '') + '" data-p="' + x[0] + '"><i>' + x[1] + '</i>' + x[2] +
        (c ? '<em>' + c + '</em>' : '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(nv.children, function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-p'); UI.closeSheet(); render(); };
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

    var h = '<div class="seg">' + [['bolge', 'Bölgeye göre'], ['talep', 'Talebe göre'], ['sira', 'Sıraya göre']]
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
        h += '<div class="grp b">Talep #' + k + '</div><div class="card"><div class="rest">' +
          '<em class="lb r">' + esc(arr[0].restaurant) + '</em><span>' + arr.length + ' paket</span></div>' +
          arr.map(row).join('') + '</div>';
      });
    } else {
      var k1 = 'region', k2 = 'restaurant', g = {};
      L.forEach(function (p) { (g[p[k1]] = g[p[k1]] || {}); (g[p[k1]][p[k2]] = g[p[k1]][p[k2]] || []).push(p); });
      Object.keys(g).forEach(function (a) {
        h += '<div class="grp b">' + esc(a) + '</div>';
        Object.keys(g[a]).forEach(function (b) {
          var A = g[a][b];
          h += '<div class="card"><div class="rest"><em class="lb r">' + esc(b) + '</em><span>' + A.length + ' paket</span></div>' +
            A.map(row).join('') + '</div>';
        });
      });
    }

    main.innerHTML = h;
    Array.prototype.forEach.call(main.querySelectorAll('button[data-g]'), function (b) {
      b.onclick = function () { S.view = b.getAttribute('data-g'); render(); };
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
        '<dt>Durum</dt><dd>' + esc(st.t) + '</dd>' +
        '<dt>Kurye</dt><dd>' + esc(p.courier_name || '—') + '</dd>' +
      '</dl>' + (p.transfer_from ? '<p class="note">Aktarma bilgisi: önceki kurye ' + esc(p.transfer_from) + '</p>' : '') + warn + '</div>' +
      (actions ? '<div class="pk-ft">' + actions + '</div>' : '') +
    '</div>';
  }

  function bindPkgActions(root) {
    Array.prototype.forEach.call(root.querySelectorAll('button[data-a]'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a'), id = b.getAttribute('data-i');
        if (a === 'harita') {
          var p = findPkg(id);
          if (p && p.map_url) TG.openLink(p.map_url);
          else if (p) TG.map((p.restaurant || '') + ' ' + (p.region || ''));
        } else if (a === 'km') kmSheet(findPkg(id));
        else if (a === 'teslim') {
          API.teslim(id).then(function () { UI.toast('Teslim edildi', 'success'); refresh(true); })
            .catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
        } else if (a === 'aktar') transferSheet(findPkg(id));
        else if (a === 'iptal') cancelSheet(findPkg(id));
      };
    });
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
      main.innerHTML = '<div class="empty"><b>Açık paketiniz yok</b>Havuzdan paket alabilirsiniz.</div>';
    } else {
      main.innerHTML = '<div class="big"><span>Aktif paket</span><div>' + (mine.summary.active || 0) + '</div></div>' +
        '<div class="big"><span>Km bekleyen</span><div>' + (mine.summary.waiting_km || 0) + '</div></div>' +
        '<div class="card" style="padding:12px">' + (mine.summary.rows || []).map(function (r) {
          return '<div style="font-size:13px;padding:3px 0">' + esc(r) + '</div>';
        }).join('') + '</div>' +
        L.map(function (p) { return pkgCard(p, { own: true }); }).join('');
      bindPkgActions(main);
    }
    $('cta').innerHTML = '';
    nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0, paketlerim: L.length });
  }

  function renderGecmis() {
    var items = (S.history && S.history.items) || [];
    setHeader('Geçmiş', items.length + ' kayıt');
    var main = $('mn');
    main.innerHTML = items.length ? items.map(function (p) { return pkgCard(p, {}); }).join('')
      : '<div class="empty"><b>Henüz kayıt yok</b>Tamamlanan ve iptal edilen işler burada listelenir.</div>';
    bindPkgActions(main);
    $('cta').innerHTML = '';
    nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0 });
  }

  function renderKazanc() {
    var e = S.earnings || { total_tl: 0, count: 0, total_km: 0 };
    setHeader('Kazançlarım', e.period || 'Bugün');
    $('mn').innerHTML =
      '<div class="big"><span>Toplam hakediş</span><div>' + money(e.total_tl) + '</div></div>' +
      '<div class="big"><span>Teslim edilen paket</span><div>' + (e.count || 0) + '</div></div>' +
      '<div class="big"><span>Toplam mesafe</span><div>' + (Math.round((e.total_km || 0) * 10) / 10) + ' km</div></div>' +
      '<p style="color:var(--t2);font-size:13px;padding:0 4px">Ücret hesabı sunucuda yapılır; uygulama sonucu gösterir.</p>';
    $('cta').innerHTML = '';
    nav(courierTabs(), { havuz: S.pool ? S.pool.packages.length : 0 });
  }

  /* ---------------- KM / İPTAL / AKTAR ---------------- */
  function kmSheet(p) {
    if (!p) return;
    S.kmPending = true;
    var base = (S.session && S.session.settings) ? S.session.settings : {};
    var tariff = base.tariff || [120, 30, 40, 50, 60, 70, 80, 90, 100];
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

  function transferSheet(p) {
    if (!p) return;
    var sh = UI.openSheet(
      '<h2>Aktar · #' + p.batch + '-' + p.number + '</h2>' +
      '<p>Bu paketi havuza geri verirsiniz. Alan, mesafe ve ücret bilgisi korunur; ' +
      'başka bir kurye alabilir.</p>' +
      '<button class="p" id="tr-ok">Havuza geri ver</button>' +
      '<button class="d" id="tr-no">Vazgeç</button>',
      { onClose: function () { render(); } }
    );
    sh.querySelector('#tr-no').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#tr-ok').onclick = function () {
      API.aktar(p.id).then(function () {
        UI.closeSheet();
        UI.toast('Paket havuza geri verildi', 'success');
        refresh(true);
      }).catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
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
        refresh(true);
      }).catch(function (e) { UI.toast(e.message || 'Gönderilemedi', 'error'); });
    };
    $('cta').innerHTML = '';
    nav(restaurantTabs(), {});
  }

  function renderRestPaketlerim() {
    setHeader('Paketlerim', '');
    var filters = [['all', 'Tümü'], ['waiting', 'Bekleyen'], ['active', 'Yolda (Aktif)'], ['delivered', 'Teslim Edilen']];
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
    setHeader('Profil', '');
    $('mn').innerHTML = '<div class="card oc"><dl class="pk-fields">' +
      '<dt>Yetkili</dt><dd>' + esc(u.name || '—') + '</dd>' +
      '<dt>Telefon</dt><dd>' + esc(u.phone || '—') + '</dd>' +
      '<dt>Bölge</dt><dd>' + esc((S.session && S.session.profile && S.session.profile.region) || '—') + '</dd>' +
      '</dl>' +
      '<div class="act"><button class="btn" id="prof-loc">Mevcut konum</button>' +
      '<button class="btn" id="prof-map">Haritada Aç</button></div>' +
      '<p class="note">Konum, kuryeye gönderilen pakette <b>Yetkili</b> bilgisi olarak görünür.</p>' +
      '</div>';
    $('mn').querySelector('#prof-loc').onclick = function () {
      TG.location(function (loc) {
        if (!loc) { UI.toast('Konum alınamadı', 'error'); return; }
        UI.toast('Konum: ' + loc.lat.toFixed(5) + ', ' + loc.lon.toFixed(5), 'success');
      });
    };
    $('mn').querySelector('#prof-map').onclick = function () { TG.map('Lezzet Döner Merkez'); };
    $('cta').innerHTML = '';
    nav(restaurantTabs(), {});
  }

  /* ---------------- yönlendirme ---------------- */
  function render() {
    var role = curRole();
    if (role === 'restoran') {
      if (S.tab === 'talep') renderTalep();
      else if (S.tab === 'profil') renderProfil();
      else renderRestPaketlerim();
      return;
    }
    if (S.tab === 'paketlerim') renderPaketlerim();
    else if (S.tab === 'gecmis') renderGecmis();
    else if (S.tab === 'kazanc') renderKazanc();
    else renderHavuz();
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
    if (full || S.tab === 'paketlerim') jobs.push(API.paketlerim().then(function (r) { S.mine = r; }));
    if (full || S.tab === 'gecmis') jobs.push(API.gecmis().then(function (r) { S.history = r; }));
    if (full || S.tab === 'kazanc') jobs.push(API.kazanc().then(function (r) { S.earnings = r; }));
    return Promise.all(jobs).then(function () { render(); }).catch(function () {});
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
  function boot() {
    API.init().then(function (s) {
      S.session = s;
      S.role = s.role || 'courier';
      S.tab = S.role === 'restoran' ? 'talep' : 'havuz';
      var badge = document.getElementById('mode');
      if (badge) badge.textContent = (API.mode === 'real' ? 'CANLI' : 'MİMİK VERİ');
      refresh(true);
      setInterval(function () { refresh(false); }, 5000);
      setInterval(tick, 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) refresh(false);
      });
    }).catch(function (e) {
      $('mn').innerHTML = '<div class="empty"><b>Bağlantı hatası</b>' + esc(e.message || '') + '</div>';
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
