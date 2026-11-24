/* ==========================================================================
   admin.js — Yönetici paneli (masaüstü web)
   Aynı /api/* sözleşmesini kullanır; sözleşme: docs/API-SOZLESME.md
   ========================================================================== */
(function () {
  'use strict';
  var $ = UI.$, esc = UI.esc, money = UI.money, kmf = UI.km, dt = UI.dt;

  var S = { tab: 'anasayfa', homeTab: 'ozet', kuryeTab: 'list', restTab: 'list', data: {}, session: null, ozetGroup: '' };

  var TABS = [
    ['ozet', 'Özet'], ['havuz', 'Havuz'], ['sontalepler', 'Son Talepler'],
    ['limit', 'Kurye Paket Limiti'], ['tarife', 'Ücret Tarifesi'], ['bolgeler', 'Bölgeler'],
    ['restoranlar', 'Restoranlar'], ['kuryeler', 'Kuryeler'], ['iptaller', 'İptal Siparişler'],
    ['kuryedurum', 'Kurye Durumu'], ['rapor', 'Raporlar'], ['odemeler', 'Ödemeler'], ['mesaj', 'Mesaj']
  ];

  function head(t, s) { $('adm-title').textContent = t; $('adm-sub').textContent = s || ''; }
  var MAIN = ['ozet', 'havuz', 'sontalepler'];
  function renderTabs() {
    if (S.tab !== 'anasayfa') { $('adm-tabs').innerHTML = ''; return; }
    $('adm-tabs').innerHTML = MAIN.map(function (key) {
      var t = TABS.filter(function (x) { return x[0] === key; })[0];
      return '<button class="' + (S.homeTab === key ? 'on' : '') + '" data-mt="' + key + '">' + t[1] + '</button>';
    }).join('');
    Array.prototype.forEach.call($('adm-tabs').children, function (b) {
      b.onclick = function () { S.homeTab = b.getAttribute('data-mt'); render(); };
    });
  }
  function nav() {
    var items = TABS.filter(function (t) { return MAIN.indexOf(t[0]) < 0; });
    $('adm-nav').innerHTML = '<button class="' + (S.tab === 'anasayfa' ? 'on' : '') + '" data-t="anasayfa">Anasayfa</button>' +
      items.map(function (t) {
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
    function load(refresh) {
    API.yonetim('ozet').then(function (d) {
      var waiting = d.waiting || [];
      function wrow(w) {
        return '<button class="brow wrow" data-w="' + w.id + '"><span><b>' + esc(w.label) + '</b> · ' + esc(w.restaurant) +
          (w.region ? ' · ' + esc(w.region) : '') + (w.courier ? ' · Kuryede' : ' · Havuzda') + '</span>' +
          '<b class="late">' + w.minutes + ' dk</b></button>';
      }
      var list;
      if (!waiting.length) {
        list = '<div class="empty">10 dakikayı geçen paket yok.</div>';
      } else if (!S.ozetGroup) {
        list = waiting.map(wrow).join('');
      } else {
        var key = S.ozetGroup === 'region' ? 'region' : 'restaurant';
        var groups = {};
        waiting.forEach(function (w) { var k = w[key] || 'Belirtilmedi'; (groups[k] = groups[k] || []).push(w); });
        list = Object.keys(groups).sort().map(function (k) {
          var arr = groups[k].slice().sort(function (a, b) { return b.minutes - a.minutes; });
          return '<div class="ghead" style="margin-top:6px"><span class="gname">' + esc(k) + '</span>' +
            '<span class="gcount">' + arr.length + ' paket</span></div>' + arr.map(wrow).join('');
        }).join('');
      }
      var groupBtns = '<div class="filters" style="margin-bottom:8px">' +
        '<button class="sm ' + (S.ozetGroup === 'region' ? 'p' : '') + '" data-og="region">Bölgeye göre</button>' +
        '<button class="sm ' + (S.ozetGroup === 'restaurant' ? 'p' : '') + '" data-og="restaurant">Restorana göre</button>' +
        '</div>';
      panel('<div class="filters" style="margin-bottom:8px"><button class="p" id="oz-ref" style="padding:10px 18px;font-size:15px">↻ Yenile</button></div>' +
        '<div class="kpis k3">' +
        kpi('Aktif restoran', d.active_restaurants) +
        kpi('Aktif kurye', d.active_couriers) +
        kpi('Toplam paket (bugün)', d.today_packages) +
        '</div>' +
        '<h3 style="font-size:15px;margin:16px 0 6px">Geciken Siparişler - ' + waiting.length + ' Adet</h3>' +
        groupBtns +
        '<div class="card" style="padding:6px 10px">' + list + '</div>' +
        '<p class="note">Bölgeler: ' + esc((d.regions || []).join(', ')) + '</p>');
      if (refresh) UI.toast('Güncellendi', 'success');
      $('oz-ref').onclick = function () { this.disabled = true; this.textContent = 'Yükleniyor…'; load(true); };
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-w]'), function (b) {
        b.onclick = function () { waitingSheet(Number(b.getAttribute('data-w')), waiting); };
      });
      Array.prototype.forEach.call($('adm-body').querySelectorAll('[data-og]'), function (b) {
        b.onclick = function () {
          var g = b.getAttribute('data-og');
          S.ozetGroup = S.ozetGroup === g ? '' : g;
          viewOzet();
        };
      });
    });
    }
    load(false);
  }
  function kpi(l, v) { return '<div class="kpi"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }

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
      '<button data-kt="davet" class="' + (S.kuryeTab === 'davet' ? 'on' : '') + '">Kurye Daveti</button></div>';
    if (S.kuryeTab === 'davet') {
      panel(kseg);
      var kh = document.createElement('div'); kh.id = 'invite-host'; $('adm-body').appendChild(kh);
      invitePane(kh, 'kurye');
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
            '<div class="ameta">' + (c.online ? '🟢 Online' : '⚪ Offline') + ' · Aktif paket: ' + (c.active_packages || 0) + '</div>' +
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
      '<button data-rt2="davet" class="' + (S.restTab === 'davet' ? 'on' : '') + '">Restoran Daveti</button></div>';
    if (S.restTab === 'davet') {
      panel(rseg);
      var rh = document.createElement('div'); rh.id = 'invite-host'; $('adm-body').appendChild(rh);
      invitePane(rh, 'restoran');
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
              '<small>' + esc(p.region || '') + ' · ' + esc(p.status) + ' · ' +
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

  function viewTarife() {
    head('Ücret Tarifesi', 'Km aralığı başına sabit ücret');
    API.yonetim('tarife').then(function (d) {
      var tariff = d.tariff || [];
      var bounds = d.tariff_bounds || [];
      var labels = d.tariff_intervals || [];
      panel('<div class="fld" style="max-width:280px"><label>0–3 km sabit ücret (TL)</label>' +
        '<input id="t0" type="number" value="' + (tariff[0] || 0) + '"></div>' +
        '<h3 style="font-size:15px;margin:14px 0 8px">Sabit ücretler</h3>' +
        tariff.slice(1).map(function (v, i) {
          return '<div class="tier-row"><span>' + esc(labels[i + 1] || ((i + 1) + ' km')) + ' km</span>' +
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

  function invitePane(host, role) {
    var isRest = role === 'restoran';
    host.innerHTML = '<div class="fld"><label>' + (isRest ? 'Restoran adı' : 'Ad Soyad') + '</label>' +
      '<input id="iv-name" placeholder="' + (isRest ? 'Lezzet Döner' : 'Ahmet Yılmaz') + '"></div>' +
      (isRest ? '<div class="fld"><label>Yetkili adı</label><input id="iv-contact" placeholder="Ali Usta"></div>' : '') +
      '<div class="fld"><label>Telefon</label><input id="iv-phone" inputmode="tel" placeholder="0546 208 99 00"></div>' +
      '<button class="p" id="iv-create">' + (isRest ? 'Restoran Daveti Oluştur' : 'Kurye Daveti Oluştur') + '</button>' +
      '<div id="iv-out" style="margin-top:14px"></div>' +
      '<p class="note">Ad ve telefon girilirse davet linkine tıklayan doğrudan kaydolur; boş bırakılırsa kendi girer.</p>';
    host.querySelector('#iv-create').onclick = function () {
      API.yonetim('davet', { role: role, name: host.querySelector('#iv-name').value.trim(),
        phone: host.querySelector('#iv-phone').value.trim(),
        contact_name: isRest ? host.querySelector('#iv-contact').value.trim() : '' }).then(function (d) {
        var link = d.url || ('https://t.me/YunusKuryePilot_4862_bot?startapp=' + (d.token || ''));
        host.querySelector('#iv-out').innerHTML = '<div class="fld"><label>Davet bağlantısı</label><input id="iv-link" readonly value="' + esc(link) + '"></div>' +
          '<div class="fld"><label>Davet kodu</label><input id="iv-code" readonly value="' + esc(d.token || '') + '"></div>' +
          '<div class="acts" style="gap:8px;flex-wrap:nowrap"><button class="p" id="iv-share" style="flex:1">Bağlantıyı Paylaş</button>' +
          '<button class="p" id="iv-copy" style="flex:1">Kopyala</button></div>';
        host.querySelector('#iv-share').onclick = function () {
          var text = 'Kurye Paket Bot daveti: ' + link;
          if (navigator.share) { navigator.share({ title: 'Kurye Paket daveti', text: text, url: link }).catch(function () {}); return; }
          var u = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('Kurye Paket daveti');
          if (window.TG && TG.openLink) TG.openLink(u); else window.open(u, '_blank');
        };
        host.querySelector('#iv-copy').onclick = function () {
          var msg = 'Kurye Paket Bot sistemine kayıt olmak için verilen linkteki bağlantıdan ulaşabilirsiniz.\n' +
            'Bağlantı Linki : ' + link + '\n\n' +
            'Sistem sizden ilk kayıt için ad soyad ve telefon bilgileri isteyecektir.';
          if (navigator.clipboard) navigator.clipboard.writeText(msg).then(function () { UI.toast('Kopyalandı', 'success'); }).catch(function () { UI.toast('Kopyalanamadı', 'error'); });
          else UI.toast('Kopyalanamadı', 'error');
        };
      }).catch(function (e) { UI.toast(e.message || 'Oluşturulamadı', 'error'); });
    };
  }

  /* ---------------- çalıştır ---------------- */
  function render() {
    renderTabs();
    nav();
    var view = S.tab === 'anasayfa' ? S.homeTab : S.tab;
    if (S.tab === 'anasayfa' && renderTabs) { /* tabs already rendered */ }
    ({
      ozet: viewOzet, havuz: viewHavuz, kuryeler: viewKuryeler, restoranlar: viewRestoranlar,
      bolgeler: viewBolgeler, tarife: viewTarife, rapor: viewRapor, iptaller: viewIptaller,
      limit: viewLimit, sontalepler: viewSonTalepler, kuryedurum: viewKuryeDurum, mesaj: viewMesaj, odemeler: viewOdemeler
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
