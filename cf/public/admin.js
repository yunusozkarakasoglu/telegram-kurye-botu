/* ==========================================================================
   admin.js — Yönetici paneli (masaüstü web)
   Aynı /api/* sözleşmesini kullanır; sözleşme: docs/API-SOZLESME.md
   ========================================================================== */
(function () {
  'use strict';
  var $ = UI.$, esc = UI.esc, money = UI.money, kmf = UI.km, dt = UI.dt;

  var S = { tab: 'ozet', data: {}, session: null };

  var TABS = [
    ['ozet', 'Özet'], ['havuz', 'Havuz'], ['sontalepler', 'Son Talepler'],
    ['limit', 'Kurye Paket Limiti'], ['tarife', 'Ücret Tarifesi'], ['bolgeler', 'Bölgeler'],
    ['restoranlar', 'Restoranlar'], ['kuryeler', 'Kuryeler'], ['iptaller', 'İptal Siparişler'],
    ['kuryedurum', 'Kurye Durumu'], ['rapor', 'Raporlar'], ['davet', 'Davet']
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
          var sel = $("adm-body").querySelector('.at[data-p="' + id + '"]');
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

  function viewKuryeler() {
    head('Kuryeler', 'Aktif/pasif yönetimi');
    API.yonetim('kuryeler').then(function (d) {
      var all = d.couriers || [];
      var filter = 'all';
      function draw() {
        var rows = all.filter(function (c) {
          if (filter === 'online') return c.online;
          if (filter === 'offline') return !c.online;
          if (filter === 'active') return c.active;
          if (filter === 'passive') return !c.active;
          return true;
        }).map(function (c) {
          return '<tr><td>' + esc(c.name) + (c.phone ? ' <a class="tel" href="tel:' + esc(c.phone) + '" title="Ara">📞</a>' : '') +
            ' <button class="sm" data-edit="' + c.id + '">Düzenle</button></td><td>' + esc(c.phone || '') + '</td>' +
            '<td>' + (c.online ? '<span class="tag ok">Online</span>' : '<span class="tag">Offline</span>') + '</td>' +
            '<td>' + (c.active ? '<span class="tag ok">Aktif</span>' : '<span class="tag er">Pasif</span>') + '</td>' +
            '<td class="num">' + (c.active_packages || 0) + '</td>' +
            '<td><a class="btn sm" href="tel:' + esc(c.phone || '') + '">Ara</a> ' +
            '<button class="sm" data-acc="' + c.id + '" data-act="toggle">' + (c.active ? 'Pasif' : 'Aktif') + '</button> ' +
            '<button class="sm d" data-acc="' + c.id + '" data-act="delete">Sil</button></td></tr>';
        }).join('');
        panel('<div class="filters"><input id="q" placeholder="İsimle ara…"><select id="f">' +
          '<option value="all">Tümü</option><option value="online">Online</option><option value="offline">Offline</option>' +
          '<option value="active">Aktif</option><option value="passive">Pasif</option></select></div>' +
          '<table class="tbl"><thead><tr><th>Ad</th><th>Telefon</th><th>Bağlantı</th><th>Durum</th><th class="num">Aktif paket</th><th></th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="6">Kayıt yok</td></tr>') + '</tbody></table>');
        $('f').value = filter;
        $('f').onchange = function () { filter = $('f').value; draw(); };
        $('q').oninput = function () {
          var q = ($('q').value || '').toLocaleLowerCase('tr');
          Array.prototype.forEach.call($('adm-body').querySelectorAll('tbody tr'), function (tr, i) {
            tr.style.display = (!q || tr.innerText.toLocaleLowerCase('tr').indexOf(q) >= 0) ? '' : 'none';
          });
        };
        bindAccountActions(all);
      }
      draw();
    }).catch(showError);
  }

  function viewRestoranlar() {
    head('Restoranlar', 'Hesap yönetimi');
    API.yonetim('restoranlar').then(function (d) {
      var all = d.restaurants || [];
      var filter = 'all';
      function draw() {
        var rows = all.filter(function (r) {
          if (filter === 'active') return r.active;
          if (filter === 'passive') return !r.active;
          return true;
        }).map(function (r) {
          return '<tr><td>' + esc(r.name) + (r.phone ? ' <a class="tel" href="tel:' + esc(r.phone) + '" title="Ara">📞</a>' : '') +
            ' <button class="sm" data-edit="' + r.id + '">Düzenle</button></td><td>' + esc(r.contact_name || '—') + '</td><td>' + esc(r.phone || '') + '</td>' +
            '<td>' + (r.active ? '<span class="tag ok">Aktif</span>' : '<span class="tag er">Pasif</span>') + '</td>' +
            '<td><button class="sm" data-acc="' + r.id + '" data-act="toggle">' + (r.active ? 'Pasif Yap' : 'Aktif Yap') + '</button> ' +
            '<button class="sm d" data-acc="' + r.id + '" data-act="delete">Sil</button></td></tr>';
        }).join('');
        panel('<div class="filters"><button class="sm ' + (filter === 'all' ? 'p' : '') + '" data-f="all">Tümü</button>' +
          '<button class="sm ' + (filter === 'active' ? 'p' : '') + '" data-f="active">Aktif</button>' +
          '<button class="sm ' + (filter === 'passive' ? 'p' : '') + '" data-f="passive">Pasif</button></div>' +
          '<table class="tbl"><thead><tr><th>Restoran</th><th>Yetkili</th><th>Telefon</th><th>Durum</th><th></th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="5">Kayıt yok</td></tr>') + '</tbody></table>' +
          '<p class="note">Pasif yapılan hesap giriş yapamaz; raporlar korunur (soft delete).</p>');
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-f]'), function (b) {
          b.onclick = function () { filter = b.getAttribute('data-f'); draw(); };
        });
        bindAccountActions(all);
      }
      draw();
    }).catch(showError);
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
        '<div id="blist">' + (d.regions || []).map(function (r) {
          return '<span class="tag ac" style="margin:4px;padding:6px 12px">' + esc(r) + ' <b data-del="' + esc(r) + '" style="cursor:pointer">✕</b></span>';
        }).join('') + '</div>' +
        '<p class="note">Restoranın bölge seçimi bu listeden beslenir.</p>');
      $('add').onclick = function () {
        API.yonetim('bolge', { action: 'add', name: $('nr').value.trim() }).then(function () {
          UI.toast('Bölge eklendi', 'success'); render();
        }).catch(function (e) { UI.toast(e.message || 'Eklenemedi', 'error'); });
      };
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-del]'), function (b) {
        b.onclick = function () {
          API.yonetim('bolge', { action: 'del', name: b.getAttribute('data-del') }).then(function () {
            UI.toast('Bölge silindi', 'success'); render();
          }).catch(function (e) { UI.toast(e.message || 'Silinemedi', 'error'); });
        };
      });
    });
  }

  function viewTarife() {
    head('Ücret Tarifesi', 'Taban ücreti ve 8 kademe farkı');
    API.yonetim('tarife').then(function (d) {
      var tariff = d.tariff || [];
      var bounds = d.tariff_bounds || [];
      var labels = d.tariff_intervals || [];
      panel('<div class="fld" style="max-width:280px"><label>Taban ücreti (TL)</label>' +
        '<input id="t0" type="number" value="' + (tariff[0] || 0) + '"></div>' +
        '<h3 style="font-size:15px;margin:14px 0 8px">Kademe farkları</h3>' +
        tariff.slice(1).map(function (v, i) {
          return '<div class="tier-row"><span>' + esc(labels[i + 1] || ('kademe ' + (i + 1))) + ' km</span>' +
            '<input type="number" data-t="' + (i + 1) + '" value="' + v + '"></div>';
        }).join('') +
        '<button class="p" id="tsave" style="margin-top:12px">Kaydet</button>');
      $('tsave').onclick = function () {
        var values = [Number($('t0').value) || 0];
        Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-t]'), function (inp) {
          values[Number(inp.getAttribute('data-t'))] = Number(inp.value) || 0;
        });
        API.yonetim('tarifeKaydet', { tariff: values })
          .then(function () { UI.toast('Tarife kaydedildi', 'success'); })
          .catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
      };
    }).catch(showError);
  }

  function viewLimit() {
    head('Kurye Paket Limiti', 'Aynı anda taşınabilecek en fazla aktif paket');
    API.yonetim('tarife').then(function (d) {
      panel('<div class="fld" style="max-width:220px"><label>Limit (1–99)</label>' +
        '<input id="lim" type="number" min="1" max="99" value="' + (d.limit || 3) + '"></div>' +
        '<button class="p" id="lsave">Kaydet</button>');
      $('lsave').onclick = function () {
        API.yonetim('limit', { limit: Number($('lim').value) }).then(function () {
          UI.toast('Limit kaydedildi', 'success');
        }).catch(function (e) { UI.toast(e.message || 'Kaydedilemedi', 'error'); });
      };
    }).catch(showError);
  }

  function viewSonTalepler() {
    head('Son Talepler', 'Son 30 talep');
    API.yonetim('sontalepler').then(function (d) {
      var rows = (d.batches || []).map(function (b) {
        return '<tr><td>#' + b.id + '</td><td>' + esc(b.name) + '</td><td class="num">' + b.n + '</td>' +
          '<td>' + dt(b.created_at) + '</td></tr>';
      }).join('');
      panel('<table class="tbl"><thead><tr><th>Talep</th><th>Restoran</th><th class="num">Paket</th><th>Tarih</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4">Kayıt yok</td></tr>') + '</tbody></table>');
    }).catch(showError);
  }

  function viewKuryeDurum() {
    head('Kurye Durumu', 'Canlı bağlantı ve yük');
    API.yonetim('kuryeler').then(function (d) {
      var rows = (d.couriers || []).map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td>' +
          '<td>' + (c.online ? '<span class="tag ok">Online</span>' : '<span class="tag">Offline</span>') + '</td>' +
          '<td>' + (c.locked ? '<span class="tag er">Kilitli</span>' : '—') + '</td>' +
          '<td class="num">' + (c.active_packages || 0) + '</td></tr>';
      }).join('');
      panel('<table class="tbl"><thead><tr><th>Kurye</th><th>Bağlantı</th><th>Durum</th><th class="num">Aktif paket</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4">Kayıt yok</td></tr>') + '</tbody></table>');
    }).catch(showError);
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
      bolgeler: viewBolgeler, tarife: viewTarife, rapor: viewRapor, iptaller: viewIptaller, davet: viewDavet,
      limit: viewLimit, sontalepler: viewSonTalepler, kuryedurum: viewKuryeDurum
    })[S.tab]();
  }

  document.addEventListener('DOMContentLoaded', function () {
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
