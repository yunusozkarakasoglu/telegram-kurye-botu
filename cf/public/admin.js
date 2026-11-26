/* ==========================================================================
   admin.js — Yönetici paneli (masaüstü web)
   Aynı /api/* sözleşmesini kullanır; sözleşme: docs/API-SOZLESME.md
   ========================================================================== */
(function () {
  'use strict';
  var $ = UI.$, esc = UI.esc, money = UI.money, kmf = UI.km, dt = UI.dt;

  var S = { tab: 'anasayfa', homeTab: 'ozet', kuryeTab: 'list', restTab: 'list', data: {}, session: null, ozetGroup: '' };

  var TABS = [
    ['ozet', 'Canlı Saha'], ['havuz', 'Havuz'], ['sontalepler', 'Son Talepler'], ['iptaller', 'İptal Siparişler'],
    ['bolgeler', 'Bölgeler'], ['restoranlar', 'Restoranlar'], ['kuryeler', 'Kuryeler'],
    ['kuryedurum', 'Kurye Durumu'], ['rapor', 'Raporlar'], ['odemeler', 'Ödemeler'], ['mesaj', 'Mesaj'],
    ['profil', 'Profil'], ['ayarlar', 'Ayarlar']
  ];

  function head(t, s) { $('adm-title').textContent = t; $('adm-sub').textContent = s || ''; }
  // Anasayfa tek görünüm: Canlı Saha. İç sekmeler kaldırıldı.
  function renderTabs() {
    var el = $('adm-tabs');
    if (!el) return;
    el.innerHTML = '';
    el.hidden = true;
  }

  function nav() {
    var KENAR = ['profil', 'ayarlar'];
    // Canlı Saha tek sayfa: iç sekmeler (havuz/son talepler/iptaller) kaldırıldı.
    var GIZLI = ['ozet', 'havuz', 'sontalepler', 'iptaller'];
    var items = TABS.filter(function (t) { return KENAR.indexOf(t[0]) < 0 && GIZLI.indexOf(t[0]) < 0; });
    $('adm-nav').innerHTML =
      '<button class="' + (S.tab === 'anasayfa' ? 'on' : '') + '" data-t="anasayfa">Anasayfa</button>' +
      items.map(function (t) {
        return '<button class="' + (S.tab === t[0] ? 'on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>';
      }).join('') +
      '<button class="nav-wide' + (S.tab === 'profil' ? ' on' : '') + '" data-t="profil" style="grid-column:1/-1">👤 Profil</button>' +
      '<div class="nav-foot">' +
        '<button class="' + (S.tab === 'ayarlar' ? 'on' : '') + '" data-t="ayarlar">⚙ Sistem</button>' +
        '<button id="adm-logout">⏻ Çıkış</button>' +
      '</div>';
    Array.prototype.forEach.call($('adm-nav').querySelectorAll('[data-t]'), function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-t'); render(); };
    });
    var lo = document.getElementById('adm-logout');
    if (lo) lo.onclick = function () {
      localStorage.removeItem('loginToken'); localStorage.removeItem('loginTokenUser');
      localStorage.removeItem('pinToken'); localStorage.removeItem('pinTokenUser');
      location.replace('/');
    };
  }

  function panel(html) { var el = $('adm-body'); el.innerHTML = html; return el; }
  /** Ayarlar sekmeleri: içerik #ay-body'ye yazılır, sekme çubuğu korunur. */
  function panelAy(html) {
    var el = document.getElementById('ay-body') || document.getElementById('adm-body');
    el.innerHTML = html;
    return el;
  }

  /* ---------------- ekranlar ---------------- */
  function ozetFiltreSheet() {
    var f = S.ozetFilter || {};
    var gun = function (off) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    var bas = f.from ? new Date(f.from * 1000) : gun(0);
    var bit = f.to ? new Date((f.to - 1) * 1000) : gun(0);
    var sec = { preset: f.preset || 'today', status: f.status || '', pay: f.pay || '', grup: f.grup || '' };
    var sh = UI.openSheet(
      '<div class="sheethead"><h2>Filtrele</h2><div class="shead-acts">' +
        '<button class="sheetc" id="of-clear" title="Filtreyi temizle">↺</button>' +
        '<button class="sheetx" id="of-x" title="Kapat">✕</button></div></div>' +
      '<div class="fld"><label>Zaman</label><div class="seg four">' +
        [['today', 'Bugün'], ['yesterday', 'Dün'], ['range', 'Tarih aralığı'], ['all', 'Tümü']].map(function (x) {
          return '<button data-t="' + x[0] + '" class="' + (sec.preset === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<div id="of-dates" style="display:' + (sec.preset === 'range' ? 'block' : 'none') + '">' +
        '<div class="fld"><label>Başlangıç</label><input id="of-from" type="date" value="' + iso(bas) + '"></div>' +
        '<div class="fld"><label>Bitiş</label><input id="of-to" type="date" value="' + iso(bit) + '"></div>' +
      '</div>' +
      '<div class="fld"><label>Durum</label><div class="seg two">' +
        [['', 'Tümü'], ['havuz', 'Havuzda bekliyor'], ['kabul', 'Kabul edildi'], ['aktarim', 'Aktarım onayı'],
         ['yolda', 'Kuryede / Yolda'], ['teslim', 'Teslim edildi'], ['iptal', 'İptal edildi'], ['late', 'Gecikenler']]
          .map(function (x) { return '<button data-st="' + x[0] + '" class="' + (sec.status === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="fld"><label>Ödeme durumu</label><div class="seg four">' +
        [['', 'Tümü'], ['var', 'Ödeme alındı'], ['yok', 'Ödeme alınmadı']].map(function (x) {
          return '<button data-pay="' + x[0] + '" class="' + (sec.pay === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<div class="fld"><label>Grupla</label><div class="seg four">' +
        [['', 'Yok'], ['region', 'Bölgeye'], ['restaurant', 'Restorana']].map(function (x) {
          return '<button data-grup="' + x[0] + '" class="' + (sec.grup === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
        }).join('') + '</div></div>' +
      '<button class="p" id="of-apply" style="width:100%">Filtrele</button>');

    Array.prototype.forEach.call(sh.querySelectorAll('[data-t],[data-st],[data-pay],[data-grup]'), function (b) {
      b.onclick = function () {
        var grup = b.parentElement;
        var attr = b.hasAttribute('data-t') ? 'data-t' : b.hasAttribute('data-st') ? 'data-st'
          : b.hasAttribute('data-pay') ? 'data-pay' : 'data-grup';
        var v = b.getAttribute(attr);
        if (attr === 'data-t') sec.preset = v;
        else if (attr === 'data-st') sec.status = v;
        else if (attr === 'data-pay') sec.pay = v;
        else sec.grup = v;
        Array.prototype.forEach.call(grup.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (attr === 'data-t') {
          if (v === 'today' || v === 'yesterday') {
            var d0 = v === 'yesterday' ? gun(-1) : gun(0);
            sh.querySelector('#of-from').value = iso(d0);
            sh.querySelector('#of-to').value = iso(d0);
          }
          sh.querySelector('#of-dates').style.display = v === 'range' ? 'block' : 'none';
        }
      };
    });
    sh.querySelector('#of-x').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#of-clear').onclick = function () {
      S.ozetFilter = { preset: 'today', from: null, to: null, status: '', pay: '', grup: '' };
      UI.closeSheet(); viewOzet();
    };
    sh.querySelector('#of-apply').onclick = function () {
      var from = null, to = null;
      if (sec.preset === 'all') { from = null; to = null; }
      else if (sec.preset === 'today' || sec.preset === 'yesterday') {
        var d0 = sec.preset === 'yesterday' ? gun(-1) : gun(0);
        from = Math.floor(d0.getTime() / 1000); to = from + 86400;
      } else {
        var fs = sh.querySelector('#of-from').value, ts = sh.querySelector('#of-to').value;
        if (!fs || !ts) { UI.toast('Başlangıç ve bitiş seçin', 'error'); return; }
        from = Math.floor(new Date(fs + 'T00:00:00').getTime() / 1000);
        to = Math.floor(new Date(ts + 'T23:59:59').getTime() / 1000);
        if (from > to) { UI.toast('Bitiş, başlangıçtan önce olamaz', 'error'); return; }
      }
      S.ozetFilter = { preset: sec.preset, from: from, to: to, status: sec.status, pay: sec.pay, grup: sec.grup };
      UI.closeSheet(); viewOzet();
    };
  }

  function viewOzet() {
    head('Canlı Saha', 'Sistem durumu');
    if (!S.ozetFilter) S.ozetFilter = { preset: 'today', from: null, to: null, status: '', pay: '', grup: '' };

    function yukle(refresh) {
      API.yonetim('siparisler', { from: S.ozetFilter.from, to: S.ozetFilter.to }).then(function (d) {
        var f = S.ozetFilter;
        var all = d.items || [];
        var kpi = d.kpi || {};
        var list = all.filter(function (p) {
          if (f.status) {
            var s = String(p.status || '');
            if (f.status === 'havuz' && !/Havuzda bekliyor/i.test(s)) return false;
            if (f.status === 'kabul' && s !== 'Kabul edildi') return false;
            if (f.status === 'aktarim' && !/Aktarım onayı/i.test(s)) return false;
            if (f.status === 'yolda' && !/Yolda|Kuryede/i.test(s)) return false;
            if (f.status === 'teslim' && s !== 'Teslim edildi') return false;
            if (f.status === 'iptal' && s !== 'İptal edildi') return false;
            if (f.status === 'late' && !p.late) return false;
          }
          if (f.pay === 'var' && p.payment_received !== true) return false;
          if (f.pay === 'yok' && p.payment_received !== false) return false;
          return true;
        });

        function satir(p) {
          var cls = p.cancelled_at ? 'cancelled' : p.delivered_at ? 'delivered'
            : /Yolda/i.test(p.status) ? 'onway' : /Kabul/i.test(p.status) ? 'accepted' : 'waiting';
          var dk = p.minutes == null ? '—' : p.minutes + ' dk';
          return '<div class="srow ' + cls + '">' +
            '<div class="srow-l"><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) +
              (p.region ? ' · ' + esc(p.region) : '') + '</b>' +
              '<small>' + esc(p.courier_name ? 'Kurye: ' + p.courier_name : 'Kurye bekliyor') +
              (p.payment ? ' · ' + esc(p.payment) : '') +
              (p.courier_note ? ' · 📝 ' + esc(p.courier_note) : '') + '</small></div>' +
            '<div class="srow-r"><span class="stg">' + esc(p.status || '—') + '</span>' +
              '<em class="' + (p.late ? 'late' : '') + '">' + dk + '</em></div>' +
          '</div>';
        }

        var govde;
        if (!list.length) govde = '<div class="empty">Bu filtrede sipariş yok.</div>';
        else if (!f.grup) govde = list.map(satir).join('');
        else {
          var key = f.grup === 'region' ? 'region' : 'restaurant';
          var groups = {};
          list.forEach(function (p) { var k = p[key] || 'Belirtilmedi'; (groups[k] = groups[k] || []).push(p); });
          govde = Object.keys(groups).sort().map(function (k) {
            return '<div class="ghead"><span class="gname">' + esc(k) + '</span>' +
              '<span class="gcount">' + groups[k].length + ' paket</span></div>' + groups[k].map(satir).join('');
          }).join('');
        }

        var odemeler = [['', 'Tümü'], ['var', 'Ödeme alındı'], ['yok', 'Ödeme alınmadı']];
        var aktifFiltre = (f.preset && f.preset !== 'today' ? 1 : 0) + (f.status ? 1 : 0) + (f.grup ? 1 : 0) + (f.pay ? 1 : 0);
        var fbtn = (aktifFiltre ? '<button class="fclear" id="oz-clear" title="Filtreleri temizle">✕</button>' : '') +
          '<button class="fbtn" id="oz-filter">⚙ Filtre' + (aktifFiltre ? ' (' + aktifFiltre + ')' : '') + '</button>';

        panel(
          '<div class="ph-row"><div><span id="oz-ref" class="ph-ref" title="Yenile">↻</span></div></div>' +
          '<div class="kpis">' +
            kpiKart(kpi.restaurants, 'Aktif restoran') +
            kpiKart(kpi.couriers, 'Aktif kurye') +
            kpiKart(kpi.packages, 'Toplam paket (bugün)') +
            kpiKart(kpi.cancelled, 'İptal') +
          '</div>' +
          '<div class="sh-title"><h3>SİPARİŞLER <span>(' + (f.preset === 'today' ? 'bugün' : f.preset === 'yesterday' ? 'dün' : f.preset === 'range' ? 'tarih aralığı' : 'tümü') + ')</span></h3><div class="acts">' + fbtn + '</div></div>' +
          '<div class="slist">' + govde + '</div>'
        );

        if (refresh) UI.toast('Güncellendi', 'success');
        $('oz-ref').onclick = function () { viewOzet(); };
        $('oz-filter').onclick = function () { ozetFiltreSheet(); };
        var fc = $('oz-clear');
        if (fc) fc.onclick = function () {
          S.ozetFilter = { preset: 'today', from: null, to: null, status: '', pay: '', grup: '' };
          viewOzet();
        };

        Array.prototype.forEach.call($('adm-body').querySelectorAll('.srow'), function (row, i) {
          row.onclick = function () {
            var p = list[i];
            if (p) { S.pkgSheet = p; siparisSheet(p); }
          };
        });
      }).catch(showError);
    }

    function kpiKart(deger, etiket) {
      return '<div class="kpi"><b>' + (deger == null ? '—' : deger) + '</b><small>' + etiket + '</small></div>';
    }

    yukle(false);
  }

  function kpi(l, v) { return '<div class="kpi"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }

  function siparisSheet(p) {
    var kapali = !!p.cancelled_at || !!p.delivered_at;
    var ts = function (v) { return v ? new Date(v * 1000).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };
    var rol = function (r) { return r === 'restoran' ? 'Restoran' : r === 'kurye' ? 'Kurye' : 'Yönetici'; };
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
          '<dt>Oluşturma</dt><dd>' + ts(p.created_at) + '</dd>' +
          '<dt>Kabul</dt><dd>' + ts(p.accepted_at) + '</dd>' +
          '<dt>Alım</dt><dd>' + ts(p.picked_up_at) + '</dd>' +
          '<dt>Teslim</dt><dd>' + ts(p.delivered_at) + '</dd>' +
          '<dt>Kurye</dt><dd>' + esc(p.courier_name || '—') + '</dd>' +
          '<dt>Mesafe</dt><dd>' + (p.distance_km == null ? '—' : kmf(p.distance_km)) + '</dd>' +
          '<dt>Paket ücreti</dt><dd>' + (p.fee_tl == null ? '—' : money(p.fee_tl)) + '</dd>' +
          '<dt>Ödeme (hakediş)</dt><dd>' + (p.payment_received === true ? 'Alındı' : p.payment_received === false ? 'Alınmadı' : '—') + '</dd>' +
          '<dt>Restoran notu</dt><dd>' + esc(p.note || '—') + '</dd>' +
          '<dt>Kurye notu</dt><dd>' + esc(p.courier_note || '—') + '</dd>' +
          (p.cancelled_at ? '<dt>İptal</dt><dd>' + ts(p.cancelled_at) + '</dd>' +
            '<dt>İptal eden</dt><dd>' + esc(rol(p.cancelled_by_role) + ' · ' + (p.cancelled_by_name || '—')) + '</dd>' : '') +
        '</dl></div>' +
        '<div class="pk-ft">' +
          (kapali ? '' : '<button class="p w" id="sp-ata">Kuryeye Ata</button>') +
          '<button class="w pkexit" id="sp-close">Çıkış</button>' +
        '</div>' +
      '</div>',
      { full: true });
    sh.querySelector('#sp-close').onclick = function () { UI.closeSheet(); };
    var ata = sh.querySelector('#sp-ata');
    if (!ata) return;
    ata.onclick = function () {
      API.yonetim('kuryeler').then(function (d) {
        var free = (d.couriers || []).filter(function (c) { return c.online && c.active && !c.locked && (c.active_packages || 0) === 0; });
        if (!free.length) { UI.toast('Boşta kurye yok', 'error'); return; }
        var s2 = UI.openSheet('<h2>Kuryeye Ata</h2>' +
          '<div class="fld"><label>Boştaki kurye</label><select id="sp-sel">' +
            '<option value="">Kurye seçin…</option>' + free.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<button class="p" id="sp-ok" style="width:100%">Ata</button>' +
          '<button class="d" id="sp-vaz" style="width:100%;margin-top:6px">Vazgeç</button>');
        s2.querySelector('#sp-vaz').onclick = function () { UI.closeSheet(); };
        s2.querySelector('#sp-ok').onclick = function () {
          var cid = s2.querySelector('#sp-sel').value;
          if (!cid) { UI.toast('Kurye seçin', 'error'); return; }
          API.yonetim('kuryeAta', { pkgId: p.id, courierId: Number(cid) }).then(function () {
            UI.closeSheet(); UI.toast('Kurye atandı', 'success'); viewOzet();
          }).catch(function (e) { UI.toast(e.message || 'Atanamadı', 'error'); });
        };
      }).catch(function (e) { UI.toast(e.message || 'Kurye listesi alınamadı', 'error'); });
    };
  }

  function waitingSheet(id, waiting) {
    var w = waiting.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    API.yonetim('kuryeler').then(function (d) {
      var free = (d.couriers || []).filter(function (c) { return c.online && c.active && !c.locked && (c.active_packages || 0) === 0; });
      var opts = '<option value="">Kurye seçin…</option>' + free.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
      var sh = UI.openSheet('<h2>' + esc(w.label) + '</h2>' +
        '<p><b>' + esc(w.restaurant) + '</b>' + (w.region ? ' · ' + esc(w.region) : '') + '<br>' +
        'Bekleme: <b class="late">' + w.minutes + ' dk</b></p>' +
        (opts ? '<div class="fld"><label>Boştaki kurye</label><select id="wsel" class="at">' + opts + '</select></div>' +
          '<button class="p" id="wata" style="width:100%">Kuryeye Ata</button>'
        : '<p class="note">Boşta (üzerinde paket olmayan, online) kurye yok.</p>') +
        '<button class="d" id="wclose" style="width:100%;margin-top:6px">Kapat</button>');
      sh.querySelector('#wclose').onclick = function () { UI.closeSheet(); };
      var ata = sh.querySelector('#wata');
      if (ata) ata.onclick = function () {
        var cid = sh.querySelector('#wsel').value;
        if (!cid) { UI.toast('Kurye seçin', 'error'); return; }
        API.yonetim('kuryeAta', { pkgId: w.id, courierId: Number(cid) }).then(function () {
          UI.closeSheet(); UI.toast('Kurye atandı', 'success'); render();
        }).catch(function (e) { UI.toast(e.message || 'Atanamadı', 'error'); });
      };
    }).catch(function (e) { UI.toast(e.message || 'Kurye listesi alınamadı', 'error'); });
  }

  function viewHavuz() {
    head('Havuz', 'Satır bazlı kurye atama');
    function load(refresh) {
    API.yonetim('havuz').then(function (d) {
      var all = d.packages || [];
      var q = '';
      function draw() {
        var rows = all.filter(function (p) {
          if (!q) return true;
          return (p.restaurant || '').toLocaleLowerCase('tr').indexOf(q) >= 0 ||
            (p.region || '').toLocaleLowerCase('tr').indexOf(q) >= 0 ||
            p.label.toLocaleLowerCase('tr').indexOf(q) >= 0;
        }).map(function (p) {
          var opts = '<option value="">Kurye seçin…</option>' + (d.couriers || []).map(function (c) {
            return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
          }).join('');
          return '<div class="acard"><div class="ahd"><b>' + esc(p.label) + '</b><span class="tag">' + esc(p.payment || '') + '</span></div>' +
            '<div class="ameta"><b>' + esc(p.restaurant) + '</b></div>' +
            '<div class="ameta">' + esc(p.region || '—') + ' · ' + dt(p.created_at) + '</div>' +
            '<div class="acts"><select class="at" data-p="' + p.id + '">' + (opts || '<option value="">Kurye yok</option>') + '</select>' +
            '<button class="sm p" data-ata="' + p.id + '">Ata</button>' +
            '<button class="sm d" data-iptal="' + p.id + '">İptal</button></div></div>';
        }).join('');
        panel('<div class="filters"><input id="hq" placeholder="Restoran / bölge / sipariş ara…"><button class="p" id="hv-ref" style="padding:10px 18px;font-size:15px">↻ Yenile</button></div>' +
          '<div class="acards">' + (rows || '<div class="empty">Havuzda paket yok</div>') + '</div>');
        $('hq').value = q;
        $('hq').oninput = function () { q = ($('hq').value || '').toLocaleLowerCase('tr'); draw(); };
        $('hv-ref').onclick = function () { this.disabled = true; this.textContent = 'Yükleniyor…'; load(true); };
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-ata]'), function (b) {
          b.onclick = function () {
            var id = b.getAttribute('data-ata');
            var sel = $('adm-body').querySelector('.at[data-p="' + id + '"]');
            if (!sel || !sel.value) { UI.toast('Kurye seçin', 'error'); return; }
            API.yonetim('kuryeAta', { pkgId: Number(id), courierId: Number(sel.value) }).then(function () {
              UI.toast('Kurye atandı', 'success'); render();
            }).catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
          };
        });
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-iptal]'), function (b) {
          b.onclick = function () { UI.toast('İptal işlemi Worker API ile yapılır'); };
        });
      }
      draw();
      if (refresh) UI.toast('Güncellendi', 'success');
    }).catch(showError);
    }
    load(false);
  }

  function viewKuryeler() {
    head('Kuryeler', 'Aktif/pasif yönetimi');
    var kseg = '<div class="seg two"><button data-kt="list" class="' + (S.kuryeTab === 'list' ? 'on' : '') + '">Kuryeler</button>' +
      '<button data-kt="davet" class="' + (S.kuryeTab === 'davet' ? 'on' : '') + '">＋ Kurye Ekle</button></div>';
    if (S.kuryeTab === 'davet') {
      panel(kseg);
      var kh = document.createElement('div'); kh.id = 'invite-host'; $('adm-body').appendChild(kh);
      kullaniciEklePane(kh, 'kurye');
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-kt]'), function (bb) {
        bb.onclick = function () { S.kuryeTab = bb.getAttribute('data-kt'); render(); };
      });
      return;
    }
    API.yonetim('kuryeler').then(function (d) {
      var all = d.couriers || [];
      var filter = 'all', q = '';
      function draw() {
        var rows = all.filter(function (c) {
          if (filter === 'online' && !c.online) return false;
          if (filter === 'offline' && c.online) return false;
          if (filter === 'active' && !c.active) return false;
          if (filter === 'passive' && c.active) return false;
          if (q && (c.name || '').toLocaleLowerCase('tr').indexOf(q) < 0 && (c.phone || '').indexOf(q) < 0) return false;
          return true;
        }).map(function (c) {
          return '<div class="acard"><div class="ahd"><b>' + esc(c.name) + '</b>' +
            (c.active ? '<span class="tag ok">Aktif</span>' : '<span class="tag er">Pasif</span>') + '</div>' +
            '<div class="ameta">' + (c.busy ? '🟡 Meşgul' + (c.busy_reason ? ' · ' + esc(c.busy_reason) : '') : (c.online ? '🟢 Online' : '⚪ Offline')) + ' · Aktif paket: ' + (c.active_packages || 0) + '</div>' +
            '<div class="ameta">' + (c.phone ? '☎ ' + esc(c.phone) : 'Telefon yok') + '</div>' +
            '<div class="acts"><button class="sm" data-edit="' + c.id + '">Düzenle</button>' +
            '<button class="sm" data-acc="' + c.id + '" data-act="toggle">' + (c.active ? 'Pasif Yap' : 'Aktif Yap') + '</button>' +
            '<button class="sm" data-pk="' + c.id + '">Paketler</button>' +
            '<button class="sm d" data-acc="' + c.id + '" data-act="delete">Sil</button>' +
            (c.phone ? '<a class="tel big" href="tel:' + esc(c.phone) + '" title="Ara">📞</a>' : '') + '</div></div>';
        }).join('');
        panel(kseg + '<div class="filters"><input id="q" placeholder="İsim veya telefon ara…"><select id="f">' +
          '<option value="all">Tümü</option><option value="online">Online</option><option value="offline">Offline</option>' +
          '<option value="active">Aktif</option><option value="passive">Pasif</option></select></div>' +
          '<div class="acards">' + (rows || '<div class="empty">Kayıt yok</div>') + '</div>');
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-kt]'), function (bb) {
          bb.onclick = function () { S.kuryeTab = bb.getAttribute('data-kt'); render(); };
        });
        $('f').value = filter; $('q').value = q;
        $('f').onchange = function () { filter = $('f').value; draw(); };
        $('q').oninput = function () { q = ($('q').value || '').toLocaleLowerCase('tr'); draw(); };
        bindAccountActions(all);
      }
      draw();
    }).catch(showError);
  }

  function viewRestoranlar() {
    head('Restoranlar', 'Hesap yönetimi');
    var rseg = '<div class="seg two"><button data-rt2="list" class="' + (S.restTab === 'list' ? 'on' : '') + '">Restoranlar</button>' +
      '<button data-rt2="davet" class="' + (S.restTab === 'davet' ? 'on' : '') + '">＋ Restoran Ekle</button></div>';
    if (S.restTab === 'davet') {
      panel(rseg);
      var rh = document.createElement('div'); rh.id = 'invite-host'; $('adm-body').appendChild(rh);
      kullaniciEklePane(rh, 'restoran');
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-rt2]'), function (bb) {
        bb.onclick = function () { S.restTab = bb.getAttribute('data-rt2'); render(); };
      });
      return;
    }
    API.yonetim('restoranlar').then(function (d) {
      var all = d.restaurants || [];
      var filter = 'all', q = '';
      function draw() {
        var rows = all.filter(function (r) {
          if (filter === 'active' && !r.active) return false;
          if (filter === 'passive' && r.active) return false;
          if (q && (r.name || '').toLocaleLowerCase('tr').indexOf(q) < 0 &&
              (r.contact_name || '').toLocaleLowerCase('tr').indexOf(q) < 0 && (r.phone || '').indexOf(q) < 0) return false;
          return true;
        }).map(function (r) {
          return '<div class="acard"><div class="ahd"><b>' + esc(r.name) + '</b>' +
            (r.active ? '<span class="tag ok">Aktif</span>' : '<span class="tag er">Pasif</span>') + '</div>' +
            '<div class="ameta">Yetkili: ' + esc(r.contact_name || '—') + '</div>' +
            '<div class="ameta">' + (r.phone ? '☎ ' + esc(r.phone) + ' <a class="tel" href="tel:' + esc(r.phone) + '">📞</a>' : 'Telefon yok') + '</div>' +
            '<div class="acts"><button class="sm" data-edit="' + r.id + '">Düzenle</button>' +
            '<button class="sm" data-acc="' + r.id + '" data-act="toggle">' + (r.active ? 'Pasif Yap' : 'Aktif Yap') + '</button>' +
            '<button class="sm d" data-acc="' + r.id + '" data-act="delete">Sil</button></div></div>';
        }).join('');
        panel(rseg + '<div class="filters"><input id="rq" placeholder="Restoran / yetkili / telefon ara…">' +
          '<button class="sm ' + (filter === 'all' ? 'p' : '') + '" data-f="all">Tümü</button>' +
          '<button class="sm ' + (filter === 'active' ? 'p' : '') + '" data-f="active">Aktif</button>' +
          '<button class="sm ' + (filter === 'passive' ? 'p' : '') + '" data-f="passive">Pasif</button></div>' +
          '<div class="acards">' + (rows || '<div class="empty">Kayıt yok</div>') + '</div>' +
          '<p class="note">Pasif yapılan hesap giriş yapamaz; raporlar korunur (soft delete).</p>');
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-rt2]'), function (bb) {
          bb.onclick = function () { S.restTab = bb.getAttribute('data-rt2'); render(); };
        });
        $('rq').value = q;
        $('rq').oninput = function () { q = ($('rq').value || '').toLocaleLowerCase('tr'); draw(); };
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-f]'), function (b) {
          b.onclick = function () { filter = b.getAttribute('data-f'); draw(); };
        });
        bindAccountActions(all);
      }
      draw();
    }).catch(showError);
  }

  function accountEdit(id, role, name, phone, contact) {
    var sh = UI.openSheet(
      '<h2>Düzenle · ' + esc(name) + '</h2>' +
      '<div class="fld"><label>Ad</label><input id="e-name" value="' + esc(name) + '"></div>' +
      (role === 'restoran' ? '<div class="fld"><label>Yetkili adı</label><input id="e-contact" value="' + esc(contact || '') + '"></div>' : '') +
      '<div class="fld"><label>Telefon</label><input id="e-phone" inputmode="tel" value="' + esc(phone || '') + '"></div>' +
      '<div class="err" id="e-err"></div>' +
      '<button class="p" id="e-save">Kaydet</button>' +
      '<button class="d" id="e-cancel">Vazgeç</button>');
    sh.querySelector('#e-cancel').onclick = function () { UI.closeSheet(); };
    sh.querySelector('#e-save').onclick = function () {
      var body = { id: id, name: sh.querySelector('#e-name').value.trim(), phone: sh.querySelector('#e-phone').value.trim() };
      if (role === 'restoran') body.contact_name = sh.querySelector('#e-contact').value.trim();
      API.yonetim('hesapGuncelle', body).then(function () {
        UI.closeSheet(); UI.toast('Kaydedildi', 'success'); render();
      }).catch(function (e) { sh.querySelector('#e-err').textContent = e.message || 'Kaydedilemedi'; });
    };
  }

  function bindAccountActions(all) {
    Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-acc]'), function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-act');
        var id = Number(b.getAttribute('data-acc'));
        if (act === 'delete' && !confirm('Hesap silinsin mi? (soft delete)')) return;
        API.yonetim('hesap', { id: id, action: act }).then(function () {
          UI.toast('Kaydedildi', 'success'); render();
        }).catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
      };
    });
    Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-pk]'), function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-pk'));
        API.yonetim('kuryePaketler', { courier: id }).then(function (r) {
          var items = r.packages || [];
          UI.openSheet('<h2>Aktif paketler</h2>' + (items.length ? items.map(function (p) {
            return '<div class="offeritem"><b>#' + p.batch + '-' + p.number + ' · ' + esc(p.restaurant) + '</b>' +
              '<small>' + esc(p.region || '') + ' · ' + esc(p.status) + (p.cancelled_by_name ? ' · İptal: ' + esc((p.cancelled_by_role === 'restoran' ? 'Restoran' : p.cancelled_by_role === 'kurye' ? 'Kurye' : 'Yönetici') + ' ' + p.cancelled_by_name) : '') + ' · ' +
              (p.distance_km == null ? 'km yok' : esc(String(p.distance_km)) + ' km') + ' · ' +
              (p.fee_tl == null ? 'ücret yok' : money(p.fee_tl)) + '</small></div>';
          }).join('') : '<div class="empty">Aktif paket yok.</div>') +
            '<button class="d" id="pk-close" style="width:100%;margin-top:8px">Kapat</button>');
          $('pk-close').onclick = function () { UI.closeSheet(); };
        }).catch(function (e) { UI.toast(e.message || 'Alınamadı', 'error'); });
      };
    });
    Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-edit]'), function (b) {
      b.onclick = function () {
        var id = Number(b.getAttribute('data-edit'));
        var row = all.filter(function (x) { return x.id === id; })[0] || {};
        accountEdit(id, row.latitude !== undefined || row.contact_name !== undefined ? 'restoran' : 'kurye',
          row.name || '', row.phone || '', row.contact_name || '');
      };
    });
  }

  function showError(e) {
    panel('<div class="empty"><b>Bağlantı hatası</b>' + esc(e.message || 'İstek başarısız') + '</div>');
  }

  function viewBolgeler() {
    head('Bölgeler', 'Restoran bölge listesi');
    API.yonetim('bolgeler').then(function (d) {
      panel('<div class="filters"><input id="nr" placeholder="Yeni bölge…"><button class="p sm" id="add">Ekle</button></div>' +
        '<div id="blist">' + (d.regions || []).map(function (r, i) {
          return '<div class="brow" data-name="' + esc(r) + '">' +
            '<span class="bname"><b>' + (i + 1) + '.</b> ' + esc(r) + '</span>' +
            '<span class="bactions">' +
              '<button class="sm" data-up="' + esc(r) + '" title="Yukarı taşı">▲</button>' +
              '<button class="sm" data-down="' + esc(r) + '" title="Aşağı taşı">▼</button>' +
              '<button class="sm d" data-del="' + esc(r) + '" title="Sil">✕</button>' +
            '</span></div>';
        }).join('') + '</div>' +
        '<p class="note">Restoranın bölge seçimi bu listeden beslenir.</p>');
      $('add').onclick = function () {
        API.yonetim('bolge', { action: 'add', name: $('nr').value.trim() }).then(function () {
          UI.toast('Bölge eklendi', 'success'); render();
        }).catch(function (e) { UI.toast(e.message || 'Eklenemedi', 'error'); });
      };
      bindRegionMove();
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-del]'), function (b) {
        b.onclick = function () {
          API.yonetim('bolge', { action: 'del', name: b.getAttribute('data-del') }).then(function () {
            UI.toast('Bölge silindi', 'success'); render();
          }).catch(function (e) { UI.toast(e.message || 'Silinemedi', 'error'); });
        };
      });
    }).catch(showError);
  }

  function bindRegionMove() {
    var list = $('blist');
    if (!list) return;
    function renumber() {
      Array.prototype.forEach.call(list.querySelectorAll('.brow'), function (row, i) {
        row.querySelector('.bname b').textContent = (i + 1) + '.';
      });
    }
    function save() {
      var order = Array.prototype.map.call(list.querySelectorAll('.brow'), function (r) { return r.getAttribute('data-name'); });
      API.yonetim('bolgeSirala', { regions: order }).then(function () {
        UI.toast('Sıralama kaydedildi', 'success');
      }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
    }
    function move(row, dir) {
      if (!row) return;
      if (dir < 0 && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      if (dir > 0 && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
      renumber();
      save();
    }
    Array.prototype.forEach.call(list.querySelectorAll('[data-up]'), function (b) {
      b.onclick = function () { move(b.closest('.brow'), -1); };
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-down]'), function (b) {
      b.onclick = function () { move(b.closest('.brow'), 1); };
    });
  }

  function viewProfil() {
    head('Profil', 'Yönetici bilgileri ve PIN');
    var u = (S.session && S.session.user) || {};
    var kilit = UI.esc(u.pin || '');
    panel('<div class="card" style="padding:14px;max-width:420px">' +
      '<div class="fld"><label>Adı Soyadı</label><input id="pf-name" value="' + esc(u.name || '') + '"></div>' +
      '<div class="fld"><label>Telefon</label><input id="pf-phone" inputmode="tel" value="' + esc(u.phone || '') + '" placeholder="0546 208 99 00"></div>' +
      '<div class="err" id="pf-err"></div>' +
      '<button class="p" id="pf-save">Bilgileri Kaydet</button>' +
    '</div>' +
    '<div class="card" style="padding:14px;max-width:420px;margin-top:12px">' +
      '<b style="display:block;margin-bottom:8px">PIN değiştir</b>' +
      '<div class="fld"><label>Mevcut PIN</label><div class="pinwrap"><input id="pf-old" type="password" inputmode="numeric" maxlength="4" value="' + kilit + '">' +
        '<button type="button" class="eye" data-eye="pf-old">👁</button></div></div>' +
      '<div class="fld"><label>Yeni PIN</label><div class="pinwrap"><input id="pf-new" type="password" inputmode="numeric" maxlength="4" placeholder="••••">' +
        '<button type="button" class="eye" data-eye="pf-new">👁</button></div></div>' +
      '<div class="fld"><label>Yeni PIN (tekrar)</label><div class="pinwrap"><input id="pf-new2" type="password" inputmode="numeric" maxlength="4" placeholder="••••">' +
        '<button type="button" class="eye" data-eye="pf-new2">👁</button></div></div>' +
      '<div class="err" id="pf-pinerr"></div>' +
      '<button class="p" id="pf-pinsave">PIN\'i Güncelle</button>' +
    '</div>');

    $('pf-save').onclick = function () {
      var err = $('pf-err'); err.textContent = '';
      API.profil({ name: $('pf-name').value.trim(), phone: $('pf-phone').value.trim() }).then(function (r) {
        S.session.user = r.user;
        UI.toast('Bilgiler kaydedildi', 'success');
        viewProfil();
      }).catch(function (e) { err.textContent = e.message || 'Kaydedilemedi'; });
    };
    $('pf-pinsave').onclick = function () {
      var err = $('pf-pinerr'); err.textContent = '';
      var o = $('pf-old').value.trim(), n = $('pf-new').value.trim(), n2 = $('pf-new2').value.trim();
      if (!/^\d{4}$/.test(n)) { err.textContent = 'Yeni PIN 4 haneli olmalı'; return; }
      if (n !== n2) { err.textContent = 'Yeni PIN\'ler uyuşmuyor'; return; }
      if (n === o) { err.textContent = 'Yeni PIN eskisinden farklı olmalı'; return; }
      API.pinDegistir(o, n).then(function () {
        UI.toast('PIN güncellendi', 'success');
        viewProfil();
      }).catch(function (e) { err.textContent = e.message || 'Güncellenemedi'; });
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

  var AYARLAR = [['fiyat', 'Fiyatlandırma'], ['kurallar', 'Kurallar'], ['tanilama', 'Tanılama'], ['logs', 'Logs']];

  function viewAyarlar() {
    if (!S.ayarTab) S.ayarTab = 'fiyat';
    head('Sistem', 'Fiyatlandırma · Kurallar · Tanılama · Logs');
    panel('<div class="seg four ayar-seg" id="ay-seg">' + AYARLAR.map(function (a) {
      return '<button data-ay="' + a[0] + '" class="' + (S.ayarTab === a[0] ? 'on' : '') + '">' + a[1] + '</button>';
    }).join('') + '</div><div id="ay-body"></div>');
    Array.prototype.forEach.call($('ay-seg').children, function (b) {
      b.onclick = function () { S.ayarTab = b.getAttribute('data-ay'); viewAyarlar(); };
    });
    if (S.ayarTab === 'kurallar') drawKurallar();
    else if (S.ayarTab === 'tanilama') drawTanilama();
    else if (S.ayarTab === 'logs') drawLogs();
    else drawTarife();
  }

  function drawTarife(altBolum) {
    var hedef = altBolum ? document.getElementById('ay-tarife') : null;
    API.yonetim('tarife').then(function (d) {
      var tariff = d.tariff || [];
      var bounds = d.tariff_bounds || [];
      var labels = d.tariff_intervals || [];
      var html = '<h3 style="font-size:15px;margin:0 0 8px">Ücret tarifesi</h3>' +
        '<div class="fld" style="max-width:280px"><label>0–3 km sabit ücret (TL)</label>' +
        '<input id="t0" type="number" value="' + (tariff[0] || 0) + '"></div>' +
        '<h3 style="font-size:15px;margin:14px 0 8px">Sabit ücretler</h3>' +
        tariff.slice(1).map(function (v, i) {
          return '<div class="tier-row"><span>' + esc(labels[i + 1] || ((i + 1) + ' km')) + ' km</span>' +
            '<input type="number" data-t="' + (i + 1) + '" value="' + v + '"></div>';
        }).join('') +
        '<div class="fld" style="max-width:280px;margin-top:14px"><label>10+ km sonrası km başı ek ücret (TL)</label>' +
        '<input id="textra" type="number" min="0" value="' + (d.extra_per_km != null ? d.extra_per_km : 100) + '"></div>' +
        '<p class="sub" style="max-width:420px">Not: 10 km üzerindeki her tam/km dilimi için bu tutar taban ücrete eklenir. ' +
        'Örnek: 12,1 km → 640 TL + 3 × ek ücret.</p>' +
        '<button class="p" id="tsave" style="margin-top:12px">Kaydet</button>';
      if (hedef) hedef.innerHTML = html; else panelAy(html);
      $('tsave').onclick = function () {
        var values = [Number($('t0').value) || 0];
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-t]'), function (inp) {
          values[Number(inp.getAttribute('data-t'))] = Number(inp.value) || 0;
        });
        API.yonetim('tarifeKaydet', { tariff: values, extra_per_km: Number($('textra').value) || 0 })
          .then(function () { UI.toast('Tarife kaydedildi', 'success'); })
          .catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
      };
    }).catch(showError);
  }

  function drawKurallar() {
    API.yonetim('tarife').then(function (d) {
      var st = d.settings || d || {};
      var r = st.rules || {};
      var alan = function (id, baslik, deger) {
        return '<div class="fld"><label>' + baslik + '</label><textarea id="' + id + '" rows="4">' + esc(deger || '') + '</textarea></div>';
      };
      panelAy('<h3 style="font-size:15px;margin:0 0 8px">Kurye paket limiti</h3>' +
        '<div class="fld" style="max-width:220px"><label>Aynı anda taşınabilecek paket (1–99)</label>' +
        '<input id="lim" type="number" min="1" max="99" value="' + (st.limit || 3) + '"></div>' +
        '<h3 style="font-size:15px;margin:0 0 8px">Çalışma saatleri</h3>' +
        '<div class="acts" style="gap:8px;max-width:420px">' +
          '<div class="fld" style="flex:1;margin:0"><label>Açılış</label><input id="open" type="time" value="' + esc(st.open_time || '07:00') + '"></div>' +
          '<div class="fld" style="flex:1;margin:0"><label>Kapanış</label><input id="close" type="time" value="' + esc(st.close_time || '22:00') + '"></div>' +
        '</div>' +
        '<h3 style="font-size:15px;margin:16px 0 8px">Metinler</h3>' +
        alan('r-mesafeler', 'Mesafeler', r.mesafeler) +
        alan('r-teslimat', 'Teslimat süresi', r.teslimat) +
        alan('r-iptal', 'İptal durumları', r.iptal) +
        alan('r-cihaz', 'Cihaz (POS–Telefon)', r.cihaz) +
        alan('r-sabit', 'Sabit kurye', r.sabit) +
        '<button class="p" id="ksave" style="margin-top:6px">Kaydet</button>');
      var limZaman = null, limSon = Number($('lim').value) || 0;
      $('lim').oninput = function () {
        clearTimeout(limZaman);
        limZaman = setTimeout(function () {
          var v = Number($('lim').value);
          if (!v || v === limSon) return;
          API.yonetim('limit', { limit: v }).then(function () {
            limSon = v;
            UI.toast('Limit kaydedildi: ' + v, 'success');
          }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
        }, 600);
      };
      $('ksave').onclick = function () {
        var body = {
          open_time: $('open').value, close_time: $('close').value,
          rules: {
            mesafeler: $('r-mesafeler').value, teslimat: $('r-teslimat').value, iptal: $('r-iptal').value,
            cihaz: $('r-cihaz').value, sabit: $('r-sabit').value,
          },
        };
        API.yonetim('sistem', body).then(function () {
          UI.toast('Kurallar ve saatler kaydedildi', 'success');
        }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
      };
    }).catch(showError);
  }

  function drawTanilama() {
    var logs = (API.logs ? API.logs() : []).slice(-60);
    panelAy('<div class="card" style="padding:12px;font-size:12px">' +
        '<div><b>Mod:</b> ' + (API.mode === 'real' ? 'CANLI' : 'MİMİK') + ' · <b>initData:</b> ' +
        (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? 'var' : 'YOK') + '</div>' +
        '<div><b>Son hata:</b> ' + esc(API.lastError || '—') + '</div></div>' +
      '<div class="card" style="padding:12px;font-size:12px;white-space:pre-wrap">' +
        (logs.length ? logs.map(esc).join('\n') : 'Kayıt yok.') + '</div>' +
      '<div id="kq" class="card" style="padding:12px;font-size:12px;margin-top:8px">Bildirim kuyruğu yükleniyor…</div>' +
      '<button class="p" id="log-send" style="width:100%;margin-top:8px">Sunucuya Gönder</button>');
    $('log-send').onclick = function () {
      API.sendLogs('tanılama').then(function () { UI.toast('Gönderildi', 'success'); })
        .catch(function (e) { UI.toast(e.message || 'Gönderilemedi', 'error'); });
    };
    // Faz D: bildirim kuyruğu durumu
    API.yonetim('kuyruk').then(function (d) {
      var c = d.counts || {};
      var olu = (d.dead || []).length;
      $('kq').innerHTML = '<div><b>Bildirim kuyruğu:</b> bekleyen ' + (c.yeni || 0) + ' · ölü ' + (c.olu || 0) + ' · toplam ' + (c.toplam || 0) + '</div>' +
        (olu ? '<div style="margin-top:6px;color:#b00">8 denemede ulaşmayan ' + olu + ' bildirim var.</div>' +
          '<button class="p sm" id="kq-tekrar" style="margin-top:8px">Ölüleri tekrar dene</button>' : '');
      var b = $('kq-tekrar');
      if (b) b.onclick = function () {
        API.yonetim('kuyrukTekrar', {}).then(function (r) {
          UI.toast('Tekrar denendi · gönderilen ' + (r.gonderilen || 0), 'success'); drawTanilama();
        }).catch(function (e) { UI.toast(e.message || 'Hata', 'error'); });
      };
    }).catch(function () { var el = $('kq'); if (el) el.textContent = 'Kuyruk bilgisi alınamadı.'; });
  }

  function drawLogs() {
    if (!S.logKaynak) S.logKaynak = '';
    panelAy('<div class="filters" style="margin-bottom:10px">' +
        '<select id="lg-kaynak">' +
          [['', 'Tümü'], ['sistem', 'Sistem'], ['kurye', 'Kurye'], ['restoran', 'Restoran'], ['yonetici', 'Yönetici'], ['istemci', 'İstemci']].map(function (x) {
            return '<option value="' + x[0] + '"' + (S.logKaynak === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
          }).join('') +
        '</select>' +
        '<button class="p sm" id="lg-yenile">↻ Yenile</button>' +
        '<button class="d sm" id="lg-temizle">Temizle</button>' +
      '</div><div id="lg-liste"><div class="empty">Yükleniyor…</div></div>');
    function yukle() {
      API.yonetim('loglar', { kaynak: S.logKaynak }).then(function (d) {
        var items = d.items || [];
        document.getElementById('lg-liste').innerHTML =
          '<div class="note" style="margin-bottom:6px">Toplam ' + (d.total || 0) + ' kayıt · son ' + items.length + '</div>' +
          (items.length ? '<div class="card" style="padding:6px 10px">' + items.map(function (l) {
            return '<div class="logrow"><span class="lt">' + dt(new Date(l.at * 1000).toISOString()) + '</span>' +
              '<span class="lk ' + esc(l.source) + '">' + esc(l.source) + '</span>' +
              '<span class="lm">' + esc(l.message) + '</span></div>';
          }).join('') + '</div>' : '<div class="empty">Kayıt yok.</div>');
      }).catch(showError);
    }
    yukle();
    $('lg-kaynak').onchange = function () { S.logKaynak = $('lg-kaynak').value; yukle(); };
    $('lg-yenile').onclick = yukle;
    $('lg-temizle').onclick = function () {
      UI.openSheet('<h2>Logları temizle</h2><p>' + (S.logKaynak ? 'Seçili kaynağın' : 'Tüm') + ' kayıtları silinsin mi?</p>' +
        '<button class="d" id="lg-ok" style="width:100%">Sil</button>' +
        '<button class="d" id="lg-vaz" style="width:100%;margin-top:6px">Vazgeç</button>');
      document.getElementById('lg-vaz').onclick = function () { UI.closeSheet(); };
      document.getElementById('lg-ok').onclick = function () {
        API.yonetim('loglarTemizle', { kaynak: S.logKaynak }).then(function (r) {
          UI.closeSheet(); UI.toast((r.deleted || 0) + ' kayıt silindi', 'success'); yukle();
        }).catch(function (e) { UI.toast(e.message || 'Silinemedi', 'error'); });
      };
    };
  }

  function viewSonTalepler() {
    head('Son Talepler', 'Son 30 talep');
    function load(refresh) {
    API.yonetim('sontalepler').then(function (d) {
      var rows = (d.batches || []).map(function (b) {
        return '<tr><td>#' + b.id + '</td><td>' + esc(b.name) + '</td><td class="num">' + b.n + '</td>' +
          '<td>' + dt(b.created_at) + '</td></tr>';
      }).join('');
      panel('<div class="filters" style="margin-bottom:8px"><button class="p" id="st-ref" style="padding:10px 18px;font-size:15px">↻ Yenile</button></div>' +
        '<table class="tbl"><thead><tr><th>Talep</th><th>Restoran</th><th class="num">Paket</th><th>Tarih</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4">Kayıt yok</td></tr>') + '</tbody></table>');
      if (refresh) UI.toast('Güncellendi', 'success');
      $('st-ref').onclick = function () { this.disabled = true; this.textContent = 'Yükleniyor…'; load(true); };
    }).catch(showError);
    }
    load(false);
  }

  function viewKuryeDurum() {
    head('Kurye Durumu', 'Canlı bağlantı ve yük');
    API.yonetim('kuryeler').then(function (d) {
      var all = d.couriers || [], filter = 'all';
      function draw() {
        var rows = all.filter(function (c) {
          if (filter === 'online') return c.online;
          if (filter === 'offline') return !c.online;
          if (filter === 'locked') return !!c.locked;
          if (filter === 'active') return (c.active_packages || 0) > 0;
          return true;
        }).map(function (c) {
          return '<tr><td>' + esc(c.name) + '</td>' +
            '<td>' + (c.online ? '<span class="tag ok">Online</span>' : '<span class="tag">Offline</span>') + '</td>' +
            '<td>' + (c.locked ? '<span class="tag er">Kilitli</span>' : '—') + '</td>' +
            '<td class="num">' + (c.active_packages || 0) + '</td></tr>';
        }).join('');
        panel('<div class="filters">' + [['all', 'Tümü'], ['online', 'Online'], ['offline', 'Offline'], ['locked', 'Kilitli'], ['active', 'Paketli']].map(function (f) {
          return '<button class="sm ' + (filter === f[0] ? 'p' : '') + '" data-kf="' + f[0] + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
          '<table class="tbl"><thead><tr><th>Kurye</th><th>Bağlantı</th><th>Durum</th><th class="num">Aktif paket</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="4">Kayıt yok</td></tr>') + '</tbody></table>');
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-kf]'), function (b) {
          b.onclick = function () { filter = b.getAttribute('data-kf'); draw(); };
        });
      }
      draw();
    }).catch(showError);
  }

  function viewRapor() {
    head('Raporlar', 'Genel · Kurye · Restoran');
    var tab = S.raporTab || 'genel';
    var date = S.raporDate || '';
    function seg() {
      return '<div class="seg three">' + [['genel', 'Genel'], ['kurye', 'Kurye'], ['restoran', 'Restoran']].map(function (t) {
        return '<button data-rt="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
        '<div class="filters" style="margin-top:8px"><label class="note">Tarih</label><input type="date" id="rdate" value="' + esc(date) + '"></div>';
    }
    API.yonetim('rapor', { date: date }).then(function (d) {
      date = d.date || date;
      var body = '';
      if (tab === 'genel') {
        body = '<div class="kpis k3">' +
          kpi('Aktif restoran', d.genel.active_restaurants) +
          kpi('Çalışan kurye', d.genel.working_couriers) +
          kpi('Paket', d.genel.packages) + '</div>';
      } else if (tab === 'kurye') {
        var rows = (d.couriers || []).map(function (c) {
          return '<tr><td>' + esc(c.name) + '</td><td>' + (c.giris ? dt(new Date(c.giris * 1000).toISOString()) : '—') +
            '</td><td>' + (c.cikis ? dt(new Date(c.cikis * 1000).toISOString()) : '—') +
            '</td><td class="num">' + (c.delivered || 0) + '</td></tr>';
        }).join('');
        body = '<table class="tbl"><thead><tr><th>Kurye</th><th>Giriş</th><th>Çıkış</th><th class="num">Atılan paket</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="4">Kayıt yok</td></tr>') + '</tbody></table>';
      } else {
        var rws = (d.restaurants || []).map(function (r) {
          return '<tr><td>' + esc(r.name) + '</td><td class="num">' + (r.packages || 0) + '</td>' +
            '<td class="num">' + money(r.fee_tl || 0) + '</td></tr>';
        }).join('');
        body = '<table class="tbl"><thead><tr><th>Restoran</th><th class="num">Atılan paket</th><th class="num">Ödeme tutarı</th></tr></thead>' +
          '<tbody>' + (rws || '<tr><td colspan="3">Kayıt yok</td></tr>') + '</tbody></table>';
      }
      panel(seg() + body);
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-rt]'), function (b) {
        b.onclick = function () { S.raporTab = b.getAttribute('data-rt'); viewRapor(); };
      });
      $('rdate').onchange = function () { S.raporDate = $('rdate').value; viewRapor(); };
    }).catch(showError);
  }

  function viewIptaller() {
    head('İptal Siparişler', 'Tümü / Bugün');
    API.yonetim('iptaller').then(function (d) {
      var rows = (d.items || []).map(function (p) {
        return '<tr><td>#' + p.req_no + '-' + p.seq + '</td><td>' + esc(p.restaurant) + '</td>' +
          '<td>' + esc(p.cancel_reason || '—') + '</td><td class="num">' + (p.fee_kurus ? money(p.fee_kurus) : '—') + '</td>' +
          '<td>' + dt(p.cancelled_at) + '</td></tr>';
      }).join('');
      panel('<table class="tbl"><thead><tr><th>Sipariş</th><th>Restoran</th><th>Gerekçe</th><th class="num">Ücret</th><th>Tarih</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="5">Kayıt yok</td></tr>') + '</tbody></table>');
    });
  }

  function viewOdemeler() {
    head('Ödemeler', 'Tahsil edilmemiş siparişler');
    function load(refresh) {
      API.yonetim('odemeler').then(function (d) {
        var all = d.items || [], q = '', group = '';
        function draw() {
          var rows = all.filter(function (x) {
            if (!q) return true;
            return (x.restaurant || '').toLocaleLowerCase('tr').indexOf(q) >= 0 ||
              (x.courier_name || '').toLocaleLowerCase('tr').indexOf(q) >= 0;
          });
          var sum = rows.reduce(function (t, x) { return t + (x.courier_fee || 0); }, 0);
          function rowHtml(x) {
            return '<tr><td>' + dt(new Date(x.delivered_at * 1000).toISOString()) + '</td>' +
              '<td>' + esc(x.restaurant) + '</td><td>' + esc(x.courier_name || '—') + '</td>' +
              '<td class="num">' + money(x.courier_fee || 0) + '</td></tr>';
          }
          var table;
          if (!group) {
            table = '<table class="tbl"><thead><tr><th>Tarih</th><th>Restoran</th><th>Kurye</th><th class="num">Ödeme tutarı</th></tr></thead><tbody>' +
              (rows.map(rowHtml).join('') || '<tr><td colspan="4">Ödenmemiş sipariş yok</td></tr>') + '</tbody></table>';
          } else {
            var key = group === 'restaurant' ? 'restaurant' : 'courier_name';
            var g = {};
            rows.forEach(function (x) { var k = x[key] || '—'; (g[k] = g[k] || []).push(x); });
            table = Object.keys(g).sort().map(function (k) {
              var arr = g[k];
              var t = arr.reduce(function (s2, x) { return s2 + (x.courier_fee || 0); }, 0);
              return '<h3 style="font-size:14px;margin:14px 0 6px">' + esc(k) + ' · ' + arr.length + ' paket · ' + money(t) + '</h3>' +
                '<table class="tbl"><thead><tr><th>Tarih</th><th>Restoran</th><th>Kurye</th><th class="num">Ödeme tutarı</th></tr></thead><tbody>' +
                arr.map(rowHtml).join('') + '</tbody></table>';
            }).join('') || '<div class="empty">Ödenmemiş sipariş yok</div>';
          }
          panel('<div class="filters" style="margin-bottom:8px"><input id="oq" placeholder="Restoran veya kurye ara…">' +
            '<button class="sm ' + (group === 'restaurant' ? 'p' : '') + '" data-og2="restaurant">Restorana göre</button>' +
            '<button class="sm ' + (group === 'courier' ? 'p' : '') + '" data-og2="courier">Kuryeye göre</button>' +
            '<button class="p" id="od-ref" style="padding:10px 16px">↻ Yenile</button></div>' +
            '<p class="note">Toplam tahsil edilmemiş: <b>' + money(sum) + '</b> · ' + rows.length + ' paket</p>' + table);
          $('oq').value = q;
          $('oq').oninput = function () { q = ($('oq').value || '').toLocaleLowerCase('tr'); draw(); };
          $('od-ref').onclick = function () { this.disabled = true; this.textContent = 'Yükleniyor…'; load(true); };
          Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-og2]'), function (b) {
            b.onclick = function () {
              var gk = b.getAttribute('data-og2');
              group = group === gk ? '' : gk;
              draw();
            };
          });
        }
        draw();
        if (refresh) UI.toast('Güncellendi', 'success');
      }).catch(showError);
    }
    load(false);
  }

  function viewMesaj() {
    head('Mesaj', 'Kurye ve restoranlara toplu bildirim');
    panel('<div class="fld"><label>Kime</label><select id="m-role"><option value="kurye">Kuryeler</option><option value="restoran">Restoranlar</option></select></div>' +
      '<div class="fld" id="m-aud-wrap"><label>Kurye filtresi</label><select id="m-aud">' +
      '<option value="all">Tümü</option><option value="online">Sadece online</option><option value="offline">Sadece offline</option></select></div>' +
      '<div class="fld"><label>Mesaj</label><textarea id="m-text" rows="5" style="width:100%" placeholder="Bildirim metni…"></textarea></div>' +
      '<button class="p" id="m-send">Gönder</button>' +
      '<p class="note">Mesaj hem Telegram sohbetine hem Mini App bildirimlerine (🔔) düşer.</p>' +
      '<button class="d" id="m-clear" style="margin-top:10px">Bildirimleri Temizle</button>' +
      '<h3 style="font-size:15px;margin:18px 0 6px">Gönderilen mesajlar</h3><div id="m-hist">Yükleniyor…</div>');
    $('m-role').onchange = function () {
      $('m-aud-wrap').style.display = $('m-role').value === 'kurye' ? '' : 'none';
    };
    function loadHistory() {
      API.yonetim('mesajlar').then(function (d) {
        var rows = (d.items || []).map(function (n) {
          return '<tr><td>#' + n.id + '</td><td>' + esc(n.text.slice(0, 60)) + (n.text.length > 60 ? '…' : '') + '</td>' +
            '<td>' + esc(n.role || '') + (n.audience && n.audience !== 'all' ? '/' + esc(n.audience) : '') + '</td>' +
            '<td class="num">' + (n.targets || 0) + '</td><td>' + dt(new Date(n.created_at * 1000).toISOString()) + '</td></tr>';
        }).join('');
        $('m-hist').innerHTML = '<table class="tbl"><thead><tr><th>#</th><th>Mesaj</th><th>Kime</th><th class="num">Kişi</th><th>Tarih</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="5">Henüz mesaj gönderilmedi</td></tr>') + '</tbody></table>';
      }).catch(function (e) { $('m-hist').textContent = 'Yüklenemedi'; });
    }
    loadHistory();
    $('m-clear').onclick = function () {
      if (!confirm('Tüm bildirimler silinsin mi?')) return;
      API.yonetim('bildirimTemizle').then(function () { UI.toast('Bildirimler temizlendi', 'success'); })
        .catch(function (e) { UI.toast(e.message || 'Temizlenemedi', 'error'); });
    };
    $('m-send').onclick = function () {
      var text = $('m-text').value.trim();
      if (text.length < 2) { UI.toast('Mesaj yazın', 'error'); return; }
      $('m-send').disabled = true;
      API.yonetim('mesaj', { role: $('m-role').value, audience: $('m-aud').value, text: text }).then(function (r) {
        UI.toast(r.count + ' kişiye gönderildi (Telegram: ' + (r.delivered || 0) + ')', 'success');
        $('m-text').value = '';
        loadHistory();
      }).catch(function (e) { UI.toast(e.message || 'Gönderilemedi', 'error'); })
        .then(function () { $('m-send').disabled = false; });
    };
  }

  function kullaniciEklePane(host, role) {
    var isRest = role === 'restoran';
    host.innerHTML =
      '<div class="fld"><label>' + (isRest ? 'Restoran adı' : 'Ad Soyad') + '</label>' +
        '<input id="ku-name" placeholder="' + (isRest ? 'Lezzet Döner' : 'Ahmet Yılmaz') + '"></div>' +
      (isRest ? '<div class="fld"><label>Yetkili adı soyadı</label><input id="ku-contact" placeholder="Ali Usta"></div>' : '') +
      '<div class="fld"><label>Telefon</label><input id="ku-phone" inputmode="tel" placeholder="0546 208 99 00"></div>' +
      '<div class="fld"><label>PIN (varsayılan 1234)</label><input id="ku-pin" inputmode="numeric" maxlength="4" value="1234"></div>' +
      (isRest ? '<div class="acts" style="gap:8px;margin-bottom:8px">' +
        '<div class="fld" style="flex:1;margin:0"><label>Enlem</label><input id="ku-lat" inputmode="decimal" placeholder="40.9901"></div>' +
        '<div class="fld" style="flex:1;margin:0"><label>Boylam</label><input id="ku-lng" inputmode="decimal" placeholder="29.0270"></div>' +
      '</div>' +
      '<p class="note" style="margin:-4px 0 8px">Konum girilirse haritada aç / yol tarifi çalışır.</p>' : '') +
      '<button class="p" id="ku-save">' + (isRest ? 'Restoranı Kaydet' : 'Kuryeyi Kaydet') + '</button>' +
      '<div id="ku-out" style="margin-top:14px"></div>' +
      '<p class="note">Hesap yönetici tarafından açılır. Kişiye giriş bağlantısını gönderin; ilk girişte PIN değiştirmesi istenir.</p>';

    host.querySelector('#ku-save').onclick = function () {
      var body = {
        role: role,
        name: host.querySelector('#ku-name').value.trim(),
        phone: host.querySelector('#ku-phone').value.trim(),
        pin: host.querySelector('#ku-pin').value.trim() || '1234',
        contact_name: isRest ? host.querySelector('#ku-contact').value.trim() : '',
      };
      if (isRest) {
        body.latitude = host.querySelector('#ku-lat').value.trim();
        body.longitude = host.querySelector('#ku-lng').value.trim();
      }
      var btn = host.querySelector('#ku-save');
      btn.disabled = true;
      API.yonetim('kullanici', body).then(function (d) {
        var link = d.login_url || '';
        var mesaj = (isRest ? 'Restoran' : 'Kurye') + ' giriş bilgileri\n' +
          'Ad: ' + d.name + '\nTelefon: ' + d.phone + '\nPIN: ' + d.pin + '\n\n' +
          'Uygulama: ' + link + '\n\nİlk girişte PIN değiştirmeniz istenir.';
        host.querySelector('#ku-out').innerHTML =
          '<div class="card" style="padding:12px"><b>' + esc(d.name) + '</b>' +
          '<div style="font-size:12px;color:var(--t2);margin:4px 0 8px">ID: ' + d.id + ' · ' + esc(d.phone) + ' · PIN ' + esc(d.pin) + '</div>' +
          '<div class="fld"><label>Giriş bağlantısı</label><input id="ku-link" readonly value="' + esc(link) + '"></div>' +
          '<div class="acts" style="gap:8px;flex-wrap:nowrap">' +
            '<button class="p" id="ku-copy" style="flex:1">Bağlantıyı Kopyala</button>' +
            '<button class="p" id="ku-msg" style="flex:1">Bilgileri Kopyala</button></div></div>';
        host.querySelector('#ku-copy').onclick = function () { kopyala(link); };
        host.querySelector('#ku-msg').onclick = function () { kopyala(mesaj); };
        host.querySelector('#ku-name').value = '';
        host.querySelector('#ku-phone').value = '';
        host.querySelector('#ku-pin').value = '1234';
        UI.toast((isRest ? 'Restoran' : 'Kurye') + ' eklendi', 'success');
      }).catch(function (e) {
        UI.toast(e.message || 'Kaydedilemedi', 'error');
      }).then(function () { btn.disabled = false; });
    };
  }

  function kopyala(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { UI.toast('Kopyalandı', 'success'); })
        .catch(function () { UI.toast('Kopyalanamadı', 'error'); });
    } else {
      UI.toast('Kopyalanamadı', 'error');
    }
  }

  function render() {
    renderTabs();
    nav();
    var view = S.tab === 'anasayfa' ? 'ozet' : S.tab;
    ({
      ozet: viewOzet, havuz: viewHavuz, kuryeler: viewKuryeler, restoranlar: viewRestoranlar,
      bolgeler: viewBolgeler, rapor: viewRapor, iptaller: viewIptaller, ayarlar: viewAyarlar, profil: viewProfil,
      sontalepler: viewSonTalepler, kuryedurum: viewKuryeDurum, mesaj: viewMesaj, odemeler: viewOdemeler
    })[view]();
  }

  function bindBurger() {
    var btn = document.getElementById('adm-burger');
    var scrim = document.getElementById('adm-scrim');
    var nav = document.getElementById('adm-nav');
    if (!btn || !nav) return;
    function close() { document.body.classList.remove('nav-open'); }
    btn.onclick = function () { document.body.classList.toggle('nav-open'); };
    if (scrim) scrim.onclick = close;
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
      b.addEventListener('click', close);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (API.setActAs) API.setActAs('');
    bindBurger();
    API.init().then(function (s) {
      S.session = s;
      if (s.role !== 'yonetici') {
        panel('<div class="empty"><b>Yetkiniz yok</b>Bu panel yalnız yönetici hesabıyla açılır.</div>');
        return;
      }
      var b = document.getElementById('mode');
      if (b) b.textContent = (API.mode === 'real' ? 'CANLI' : 'MİMİK VERİ');
      render();
    }).catch(function (e) {
      panel('<div class="empty"><b>Bağlantı hatası</b>' + esc(e.message || '') + '</div>');
    });
  });
})();
