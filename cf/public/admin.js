/* ==========================================================================
   admin.js — Yönetici paneli (masaüstü web)
   Aynı /api/* sözleşmesini kullanır; sözleşme: docs/API-SOZLESME.md
   ========================================================================== */
(function () {
  'use strict';
  var $ = UI.$, esc = UI.esc, money = UI.money, kmf = UI.km, dt = UI.dt;

  var S = { tab: 'ozet', data: {}, session: null };

  var TABS = [
    ['ozet', 'Özet'], ['havuz', 'Havuz'], ['kuryeler', 'Kuryeler'], ['restoranlar', 'Restoranlar'],
    ['bolgeler', 'Bölgeler'], ['tarife', 'Hesaplama'], ['rapor', 'Raporlar'],
    ['iptaller', 'İptal Siparişler'], ['davet', 'Davet']
  ];

  function head(t, s) { $('adm-title').textContent = t; $('adm-sub').textContent = s || ''; }
  function nav() {
    $('adm-nav').innerHTML = TABS.map(function (t) {
      return '<button class="' + (S.tab === t[0] ? 'on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    Array.prototype.forEach.call($('adm-nav').children, function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-t'); render(); };
    });
  }

  function panel(html) { var el = $('adm-body'); el.innerHTML = html; return el; }

  /* ---------------- ekranlar ---------------- */
  function viewOzet() {
    head('Özet', 'Sistem durumu');
    API.yonetim('ozet').then(function (d) {
      panel('<div class="kpis">' +
        kpi('Havuzda paket', d.pool_count) +
        kpi('Kuryede', d.active_count) +
        kpi('Teslim edilen', d.delivered_count) +
        kpi('Ücret toplamı', money(d.total_fee_tl)) +
        kpi('En eski bekleme', (d.oldest_wait_min || 0) + ' dk') +
        '</div>' +
        '<p class="note">Bölgeler: ' + esc((d.regions || []).join(', ')) + '</p>');
    });
  }
  function kpi(l, v) { return '<div class="kpi"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }

  function viewHavuz() {
    head('Havuz', 'Satır bazlı kurye atama');
    API.yonetim('havuz').then(function (d) {
      var rows = (d.packages || []).map(function (p) {
        var opts = (d.couriers || []).filter(function (c) { return c.status === 'active' && c.online; })
          .map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
        return '<tr><td>#' + p.req_no + '-' + p.seq + '</td><td>' + esc(p.restaurant) + '</td><td>' + esc(p.region || '—') + '</td>' +
          '<td>' + esc(p.address || '') + '</td><td>' + esc(p.payment || '') + '</td>' +
          '<td><select class="at" data-p="' + p.id + '">' + opts + '</select> ' +
          '<button class="sm p" data-ata="' + p.id + '">Ata</button> ' +
          '<button class="sm d" data-iptal="' + p.id + '">İptal</button></td></tr>';
      }).join('');
      panel('<table class="tbl"><thead><tr><th>Sipariş</th><th>Restoran</th><th>Bölge</th><th>Ödeme</th><th>İşlem</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6">Havuzda paket yok</td></tr>') + '</tbody></table>');
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-ata]'), function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-ata');
          var sel = panel.querySelector('.at[data-p="' + id + '"]');
          API.yonetim('kuryeAta', { pkgId: Number(id), courierId: Number(sel.value) }).then(function () {
            UI.toast('Kurye atandı', 'success'); render();
          }).catch(function (e) { UI.toast(e.message || 'İşlem başarısız', 'error'); });
        };
      });
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-iptal]'), function (b) {
        b.onclick = function () { UI.toast('İptal işlemi Worker API ile yapılır'); };
      });
    });
  }

  function viewKuryeler() {
    head('Kuryeler', 'Aktif/pasif yönetimi');
    API.yonetim('kuryeler').then(function (d) {
      var rows = (d.couriers || []).map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.phone || '') + '</td>' +
          '<td>' + (c.online ? '<span class="tag ok">Online</span>' : '<span class="tag">Offline</span>') + '</td>' +
          '<td>' + (c.status === 'active' ? '<span class="tag ok">Aktif</span>' : '<span class="tag er">Pasif</span>') + '</td>' +
          '<td class="num">' + (c.active_packages || 0) + '</td>' +
          '<td><a class="btn sm" href="tel:' + esc(c.phone || '') + '">Ara</a></td></tr>';
      }).join('');
      panel('<div class="filters"><input id="q" placeholder="İsimle ara…"><select id="f"><option value="all">Tümü</option>' +
        '<option value="online">Online</option><option value="offline">Offline</option></select></div>' +
        '<table class="tbl"><thead><tr><th>Ad</th><th>Telefon</th><th>Bağlantı</th><th>Durum</th><th class="num">Teslim</th><th></th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6">Kayıt yok</td></tr>') + '</tbody></table>');
      function apply() {
        var q = ($('q').value || '').toLocaleLowerCase('tr');
        var f = $('f').value;
        Array.prototype.forEach.call($('adm-body').querySelectorAll('tbody tr'), function (tr, i) {
          var c = (d.couriers || [])[i];
          if (!c) return;
          var okQ = !q || (c.name || '').toLocaleLowerCase('tr').indexOf(q) >= 0;
          var okF = f === 'all' || (f === 'online' ? c.online : !c.online);
          tr.style.display = (okQ && okF) ? '' : 'none';
        });
      }
      $('q').oninput = apply; $('f').onchange = apply;
    });
  }

  function viewRestoranlar() {
    head('Restoranlar', 'Hesap yönetimi');
    API.yonetim('restoranlar').then(function (d) {
      var rows = (d.restaurants || []).map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.auth || '') + '</td><td>' + esc(r.phone || '') + '</td>' +
          '<td>' + esc(r.contact_name || '—') + '</td>' +
          '<td>' + (r.status === 'active' ? '<span class="tag ok">Aktif</span>' : '<span class="tag er">Pasif</span>') + '</td>' +
          '<td><button class="sm" data-tgl="' + r.id + '">' + (r.status === 'active' ? 'Pasif Yap' : 'Aktif Yap') + '</button></td></tr>';
      }).join('');
      panel('<table class="tbl"><thead><tr><th>Restoran</th><th>Yetkili</th><th>Telefon</th><th>Konum</th><th>Durum</th><th></th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6">Kayıt yok</td></tr>') + '</tbody></table>' +
        '<p class="note">Pasif yapılan hesap giriş yapamaz; raporlar korunur (soft delete).</p>');
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-tgl]'), function (b) {
        b.onclick = function () { UI.toast('İşlem Worker API ile yapılır'); };
      });
    });
  }

  function viewBolgeler() {
    head('Bölgeler', 'Restoran bölge listesi');
    API.yonetim('bolgeler').then(function (d) {
      panel('<div class="filters"><input id="nr" placeholder="Yeni bölge…"><button class="p sm" id="add">Ekle</button></div>' +
        '<div id="blist">' + (d.regions || []).map(function (r) {
          return '<span class="tag ac" style="margin:4px;padding:6px 12px">' + esc(r) + ' <b data-del="' + esc(r) + '" style="cursor:pointer">✕</b></span>';
        }).join('') + '</div>' +
        '<p class="note">Restoranın bölge seçimi bu listeden beslenir.</p>');
      $('add').onclick = function () { UI.toast('Bölge ekleme Worker API ile yapılır'); };
    });
  }

  function viewTarife() {
    head('Hesaplama', 'Taban ücreti ve kademe farkları');
    API.yonetim('tarife').then(function (d) {
      var steps = d.steps || [];
      panel('<div class="fld" style="max-width:260px"><label>Taban Ücreti (kuruş)</label>' +
        '<input id="base" type="number" value="' + (d.base_kurus || 3500) + '"></div>' +
        '<h3 style="font-size:15px;margin:14px 0 8px">Kademe Farkları (ilk sayı taban, sonraki 8 kademe)</h3>' +
        '<div id="steps">' + steps.map(function (s, i) {
          return '<div class="tier-row"><span>' + (i + 1) + '. kademe · ' + (s.upto_km == null ? 'sonsuz' : s.upto_km + ' km üzeri') + '</span>' +
            '<input type="number" data-step="' + i + '" value="' + (s.add_kurus || 0) + '" placeholder="kuruş"></div>';
        }).join('') + '</div>' +
        '<p class="note">Ücret hesabı sunucuda yapılır. Buradaki değerler tüm kuryeler için geçerlidir.</p>' +
        '<button class="p" id="save" style="margin-top:12px">Kaydet</button>');
      $('save').onclick = function () {
        var st = Array.prototype.map.call($('adm-body').querySelectorAll('[data-step]'), function (inp, i) {
          var s = (d.steps || [])[i] || {};
          return { upto_km: s.upto_km == null ? null : s.upto_km, add_kurus: Number(inp.value) || 0 };
        });
        API.yonetim('tarifeKaydet', { base_kurus: Number($('base').value) || 0, steps: st }).then(function () {
          UI.toast('Tarife kaydedildi', 'success');
        }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
      };
    });
  }

  function viewRapor() {
    head('Raporlar', 'Dönem bazlı kurye performansı');
    API.yonetim('rapor').then(function (d) {
      var rows = (d.rows || []).map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="num">' + r.count + '</td>' +
          '<td class="num">' + (Math.round((r.km || 0) * 10) / 10) + ' km</td>' +
          '<td class="num">' + money(r.fee_kurus) + '</td></tr>';
      }).join('');
      panel('<table class="tbl"><thead><tr><th>Kurye</th><th class="num">Paket</th><th class="num">Mesafe</th><th class="num">Hakediş</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4">Veri yok</td></tr>') + '</tbody></table>');
    });
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

  function viewDavet() {
    head('Davet', 'Kurye / restoran daveti');
    API.yonetim('davet', { role: 'courier' }).then(function (d) {
      var link = d.url || ('https://t.me/YunusKuryePilot_4862_bot?startapp=' + (d.token || ''));
      panel('<p class="note">Davet bağlantısı tek kullanımlıktır. Kurye adı/soyadı ve telefonunu Mini App formunda girer; ' +
        'restoran ayrıca konum ister.</p>' +
        '<div class="filters"><input id="tk" value="' + esc(d.token || '') + '" style="flex:1;min-width:260px"></div>' +
        '<div class="fld" style="max-width:520px"><label>Bağlantı</label><input id="lk" value="' + esc(link) + '" readonly></div>' +
        '<button class="p" id="cp">Bağlantıyı kopyala</button>');
      $('cp').onclick = function () {
        var i = $('lk'); i.select();
        try { document.execCommand('copy'); UI.toast('Kopyalandı', 'success'); } catch (e) { UI.toast('Kopyalanamadı', 'error'); }
      };
    });
  }

  /* ---------------- çalıştır ---------------- */
  function render() {
    nav();
    ({
      ozet: viewOzet, havuz: viewHavuz, kuryeler: viewKuryeler, restoranlar: viewRestoranlar,
      bolgeler: viewBolgeler, tarife: viewTarife, rapor: viewRapor, iptaller: viewIptaller, davet: viewDavet
    })[S.tab]();
  }

  document.addEventListener('DOMContentLoaded', function () {
    API.init().then(function (s) {
      S.session = s;
      var b = document.getElementById('mode');
      if (b) b.textContent = (API.mode === 'real' ? 'CANLI' : 'MİMİK VERİ');
      render();
    }).catch(function (e) {
      panel('<div class="empty"><b>Bağlantı hatası</b>' + esc(e.message || '') + '</div>');
    });
  });
})();
