/* ==========================================================================
   api.js — Mini App veri katmanı (Worker /api/* sözleşmesi)
   Sözleşme: cf/docs/API-SOZLESME.md · Worker: cf/src/api.ts
   İki mod: 'real' → /api/* , 'mock' → yerel mümik veri (?mock=1)
   Para birimi: TL (tam sayı). Mesafe: km. Durum etiketleri sunucudan gelir.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- ortak ücret hesabı (Worker'daki feeFor ile aynı) ---------------- */
  var TARIFF_BOUNDS = [3, 4, 5, 6, 7, 8, 9, 10];
  var DEFAULT_TARIFF = [120, 150, 190, 240, 300, 370, 450, 540, 640];
  function feeFor(tariff, distance, extra) {
    var band = 0;
    while (band < TARIFF_BOUNDS.length && distance > TARIFF_BOUNDS[band]) band++;
    var base = tariff[band] != null ? tariff[band] : tariff[tariff.length - 1];
    var lastBound = TARIFF_BOUNDS[TARIFF_BOUNDS.length - 1] || 10;
    if (distance > lastBound && extra > 0) {
      base = base + Math.ceil(distance - lastBound) * extra;
    }
    return base;
  }
  function feePreview(tariff, distance, extra) {
    var ex = extra;
    if (ex == null) {
      var st = (window.S && S.session && S.session.settings) || {};
      ex = st.extra_per_km;
    }
    return feeFor(tariff, distance, ex) + ' TL';
  }

  /* =======================  MİMİK DEPO  ======================= */
  function Mock() {
    var now = Date.now();
    var self = this;
    this.tariff = DEFAULT_TARIFF.slice();
    this.settings = {
      base_tl: DEFAULT_TARIFF[0],
      tariff: DEFAULT_TARIFF.slice(),
      tariff_bounds: TARIFF_BOUNDS.slice(),
      tariff_intervals: ['0–3', '>3–4', '>4–5', '>5–6', '>6–7', '>7–8', '>8–9', '>9–10', '>10'],
      limit: 3,
      regions: ['Kadıköy', 'Üsküdar', 'Ataşehir'],
      payments: ['Nakit', 'Kart', 'Ödendi'],
      reasons: ['Müşteri iptal etti', 'Adres yanlış', 'Restoran kapandı', 'Gecikme', 'Paket hasarlı', 'Müşteriye ulaşılamadı', 'Diğer'],
      max_packages: 10,
      priority_seconds: 10
    };
    this.me = { id: 101, name: 'Ahmet Yılmaz', phone: '+905550000011', role: 'kurye' };
    this.priority = null;
    this.seq = 0;
    this.couriers = [
      { id: 101, name: 'Ahmet Yılmaz', phone: '+905550000011', online: true, locked: false, active: true, deleted: false, active_packages: 0 },
      { id: 102, name: 'Mehmet Demir', phone: '+905550000012', online: true, locked: false, active: true, deleted: false, active_packages: 0 },
      { id: 103, name: 'Zeynep Kaya', phone: '+905550000013', online: false, locked: false, active: true, deleted: false, active_packages: 0 }
    ];
    this.restaurants = [
      { id: 201, name: 'Lezzet Döner', phone: '+905550000001', contact_name: 'Ahmet Usta', latitude: 41.0, longitude: 29.0, active: true, deleted: false },
      { id: 202, name: 'Pizza Durağı', phone: '+905550000002', contact_name: 'Veli Kaya', latitude: 41.01, longitude: 29.02, active: true, deleted: false },
      { id: 203, name: 'Balık Evi', phone: '+905550000003', contact_name: 'Ali Yıldız', latitude: 41.02, longitude: 29.03, active: true, deleted: false }
    ];
    this.packages = [
      self.pk(3000001, 1, 201, 'Kadıköy', 'Nakit'),
      self.pk(3000001, 2, 201, 'Kadıköy', 'Kart'),
      self.pk(3000001, 3, 201, 'Kadıköy', 'Nakit'),
      self.pk(3000002, 1, 202, 'Üsküdar', 'Kart'),
      self.pk(3000002, 2, 202, 'Üsküdar', 'Nakit'),
      self.pk(3000003, 1, 203, 'Ataşehir', 'Nakit')
    ];
  }

  Mock.prototype.pk = function (batch, number, restaurantId, region, payment) {
    this.seq += 1;
    var r = this.restaurants.filter(function (x) { return x.id === restaurantId; })[0] || {};
    var self = this;
    return {
      id: self.seq,
      batch: batch,
      number: number,
      label: 'Talep #' + batch + '-' + number,
      restaurant: r.name || 'Bilinmiyor',
      region: region || 'Belirtilmedi',
      payment: payment || 'Belirtilmedi',
      restaurant_contact: r.contact_name || null,
      restaurant_phone: r.phone || null,
      map_url: (r.latitude != null) ? 'https://www.google.com/maps/dir/?api=1&destination=' + r.latitude + ',' + r.longitude : null,
      courier_id: null,
      courier_name: null,
      courier_phone: null,
      distance_km: null,
      fee_tl: null,
      status: 'Havuzda bekliyor',
      incoming: false,
      cancel_reason: null,
      created_at: Math.floor((Date.now() - (self.seq * 7 + 3) * 60000) / 1000),
      accepted_at: null,
      picked_up_at: null,
      delivered_at: null,
      cancelled_at: null
    };
  };

  Mock.prototype.delay = function (fn) {
    return new Promise(function (res) { setTimeout(function () { res(fn()); }, 80); });
  };

  Mock.prototype.oturum = function () {
    var self = this;
    return this.delay(function () {
      return {
        role: self.me.role,
        user: { id: self.me.id, name: self.me.name, phone: self.me.phone, contact_name: null, online: true, locked: false },
        settings: self.settings
      };
    });
  };

  Mock.prototype.havuz = function () {
    var self = this;
    return this.delay(function () {
      var mine = self.packages.filter(function (p) { return p.courier_id === self.me.id && !p.delivered_at && !p.cancelled_at; });
      return {
        capacity: { limit: self.settings.limit, active: mine.length, free: Math.max(0, self.settings.limit - mine.length), locked: mine.length >= self.settings.limit },
        priority: self.priority && self.priority.until > Date.now() ? { package: self.priority.package, until: Math.floor(self.priority.until / 1000) } : null,
        packages: self.packages.filter(function (p) { return !p.courier_id && !p.delivered_at && !p.cancelled_at; })
      };
    });
  };

  Mock.prototype.kabul = function (ids) {
    var self = this;
    return this.delay(function () {
      var accepted = [], missed = [];
      var mine = self.packages.filter(function (p) { return p.courier_id === self.me.id && !p.delivered_at && !p.cancelled_at; });
      var room = Math.max(0, self.settings.limit - mine.length);
      ids.forEach(function (id) {
        var p = self.packages.filter(function (x) { return x.id === Number(id); })[0];
        if (!p || p.courier_id || room <= 0) { missed.push(Number(id)); return; }
        p.courier_id = self.me.id;
        p.courier_name = self.me.name;
        p.accepted_at = Math.floor(Date.now() / 1000);
        p.status = 'Kabul edildi';
        accepted.push(p.id);
        room -= 1;
        if (!self.priority || self.priority.until <= Date.now()) {
          self.priority = { package: p.id, until: Date.now() + 10000 };
        }
      });
      return { accepted: accepted, missed: missed, message: accepted.length + ' paket atandı.' };
    });
  };

  Mock.prototype.kmGir = function (id, kmVal) {
    var self = this;
    return this.delay(function () {
      var p = self.packages.filter(function (x) { return x.id === Number(id); })[0];
      if (!p || p.courier_id !== self.me.id) return { ok: false, error: 'Bu paket size ait değil.' };
      var v = parseFloat(String(kmVal).replace(',', '.'));
      if (!(v > 0)) return { ok: false, error: 'Geçerli bir kilometre girin. Örnek: 4,5' };
      p.distance_km = v;
      p.fee_tl = feeFor(self.tariff, v);
      p.picked_up_at = Math.floor(Date.now() / 1000);
      p.status = 'Kuryede / Yolda';
      return { ok: true, fee_tl: p.fee_tl, distance_km: v, picked_up_at: p.picked_up_at };
    });
  };

  Mock.prototype.teslim = function (id, paid) {
    var self = this;
    return this.delay(function () {
      var p = self.packages.filter(function (x) { return x.id === Number(id); })[0];
      if (!p || p.courier_id !== self.me.id) return { ok: false, error: 'Bu paket size ait değil.' };
      if (!p.picked_up_at) return { ok: false, error: 'Önce paketi restorandan aldığınızı işaretleyin.' };
      p.delivered_at = Math.floor(Date.now() / 1000);
      if (paid != null) p.payment_received = !!paid;
      p.status = 'Teslim edildi';
      return { ok: true };
    });
  };

  Mock.prototype.iptal = function (id, reason) {
    var self = this;
    return this.delay(function () {
      var p = self.packages.filter(function (x) { return x.id === Number(id); })[0];
      if (!p || p.courier_id !== self.me.id) return { ok: false, error: 'Bu paketi iptal edemezsiniz.' };
      var fee = null;
      if (p.picked_up_at && p.fee_tl != null) {
        var mins = (Date.now() / 1000 - p.picked_up_at) / 60;
        fee = mins < 10 ? self.tariff[0] : p.fee_tl;
      }
      p.cancelled_at = Math.floor(Date.now() / 1000);
      p.cancel_reason = reason;
      p.fee_tl = fee;
      p.status = 'İptal edildi';
      return { ok: true, fee_tl: fee, cancel_reason: reason };
    });
  };

  Mock.prototype.aktar = function (id) {
    var self = this;
    return this.delay(function () {
      var p = self.packages.filter(function (x) { return x.id === Number(id); })[0];
      if (!p || p.courier_id !== self.me.id) return { ok: false, error: 'Bu paket size ait değil.' };
      p.courier_id = null; p.courier_name = null; p.accepted_at = null;
      p.picked_up_at = null; p.distance_km = null; p.fee_tl = null;
      p.status = 'Havuzda bekliyor';
      return { ok: true, message: 'Paketler havuza aktarıldı.' };
    });
  };

  Mock.prototype.paketlerim = function () {
    var self = this;
    return this.delay(function () {
      var active = self.packages.filter(function (p) { return p.courier_id === self.me.id && !p.delivered_at && !p.cancelled_at; });
      var sorted = active.sort(function (a, b) { return a.batch - b.batch || a.number - b.number; });
      var ready = sorted.filter(function (r) { return r.picked_up_at; }).length;
      return {
        packages: sorted,
        summary: {
          active: sorted.length,
          waiting_km: sorted.length - ready,
          rows: sorted.map(function (row, index) {
            var km = row.distance_km != null ? String(row.distance_km).replace('.', ',') + ' km' : '—';
            var fee = row.fee_tl != null ? row.fee_tl + ' TL' : '—';
            var state = row.picked_up_at ? 'Kuryede / Yolda' : 'Kabul edildi · Km bekliyor';
            return 'Paket ' + (index + 1) + ' : Talep #' + row.batch + '-' + row.number + ' · ' + row.region + ' · ' + km + ' · ' + fee + ' · ' + state;
          })
        }
      };
    });
  };

  Mock.prototype.gecmis = function () {
    var self = this;
    return this.delay(function () {
      return { items: self.packages.filter(function (p) { return p.delivered_at || p.cancelled_at; }) };
    });
  };

  Mock.prototype.kazanc = function () {
    var self = this;
    return this.delay(function () {
      var done = self.packages.filter(function (p) { return p.status === 'Teslim edildi' && p.courier_id === self.me.id; });
      return {
        total_tl: done.reduce(function (s, p) { return s + (p.fee_tl || 0); }, 0),
        count: done.length,
        total_km: Math.round(done.reduce(function (s, p) { return s + (p.distance_km || 0); }, 0) * 10) / 10
      };
    });
  };

  Mock.prototype.profil = function (data) {
    var self = this;
    return this.delay(function () {
      self.me.name = data.name || self.me.name;
      self.me.phone = data.phone || self.me.phone;
      return { ok: true, user: { id: self.me.id, name: self.me.name, phone: self.me.phone, contact_name: data.contact_name || null } };
    });
  };

  Mock.prototype.kayit = function () { return this.delay(function () { return { ok: true }; }); };
  Mock.prototype.durum = function (online) {
    this.me.online = !!online;
    return this.delay(function () { return { ok: true, online: !!online }; });
  };
  Mock.prototype.bildirimler = function () { return this.delay(function () { return { items: [], unread: 0 }; }); };
  Mock.prototype.bildirimOkundu = function () { return this.delay(function () { return { ok: true }; }); };
  Mock.prototype.bildirimTemizle = function () { return this.delay(function () { return { ok: true }; }); };
  Mock.prototype.sistem = function () {
    var self = this;
    return this.delay(function () {
      return { settings: self.settings,
        restaurants: self.restaurants.map(function (r) { return { name: r.name, contact_name: r.contact_name, phone: r.phone }; }),
        couriers: self.couriers.map(function (c) { return { name: c.name, online: c.online, phone: null }; }) };
    });
  };
  Mock.prototype.aktarimKuryeler = function () { var self = this; return this.delay(function () { return { couriers: self.couriers.filter(function (c) { return c.id !== self.me.id; }).map(function (c) { return { id: c.id, name: c.name }; }) }; }); };
  Mock.prototype.aktarimTeklifler = function () { return this.delay(function () { return { offers: [] }; }); };
  Mock.prototype.aktarimKarar = function () { return this.delay(function () { return { ok: true }; }); };
  Mock.prototype.odeme = function () { return this.delay(function () { return { ok: true, count: 1 }; }); };

  Mock.prototype.talepVer = function (items) {
    var self = this;
    return this.delay(function () {
      var batch = 3000005 + self.packages.length;
      items.forEach(function (it, i) {
        var rest = self.restaurants[0];
        self.packages.push(self.pk(batch, i + 1, rest.id, it.region, it.payment));
      });
      return { ok: true, req_no: batch, count: items.length };
    });
  };

  Mock.prototype.paketlerimRestoran = function (filter) {
    var self = this;
    return this.delay(function () {
      var items = self.packages.filter(function (p) {
        if (filter === 'waiting') return !p.courier_id && !p.cancelled_at;
        if (filter === 'active') return p.courier_id && !p.delivered_at && !p.cancelled_at;
        if (filter === 'delivered') return !!p.delivered_at;
        return !p.cancelled_at;
      });
      return { items: items };
    });
  };

  Mock.prototype.yonetim = function (what, arg) {
    var self = this;
    return this.delay(function () {
      if (what === 'ozet') {
        var pool = self.packages.filter(function (p) { return !p.courier_id && !p.cancelled_at; });
        var active = self.packages.filter(function (p) { return p.courier_id && !p.delivered_at && !p.cancelled_at; });
        var done = self.packages.filter(function (p) { return p.delivered_at; });
        return {
          pool_count: pool.length,
          active_count: active.length,
          delivered_count: done.length,
          total_fee_tl: done.reduce(function (s, p) { return s + (p.fee_tl || 0); }, 0),
          oldest_wait_min: pool.length ? Math.round((Date.now() / 1000 - pool[0].created_at) / 60) : 0,
          regions: self.settings.regions.slice(),
          settings: self.settings
        };
      }
      if (what === 'havuz') {
        return {
          packages: self.packages.filter(function (p) { return !p.courier_id && !p.cancelled_at; }),
          couriers: self.couriers.filter(function (c) { return c.online && !c.locked && c.active; })
        };
      }
      if (what === 'kuryeler') return { couriers: self.couriers };
      if (what === 'restoranlar') return { restaurants: self.restaurants };
      if (what === 'tarife') return self.settings;
      if (what === 'davet') {
        return { ok: true, token: 'cfdb18c8720944dc8d582a3791c4ee22757cb3c6', url: 'https://t.me/YunusKuryePilot_4862_bot?startapp=cfdb18c8720944dc8d582a3791c4ee22757cb3c6' };
      }
      return {};
    });
  };

  /* =======================  GERÇEK İSTEMCİ  ======================= */
  var actAs = sessionStorage.getItem('actAs') || new URLSearchParams(location.search).get('mode') === 'courier' ? 'kurye' : '';
  if (actAs) sessionStorage.setItem('actAs', actAs);
  function headers() {
    var h = { 'Content-Type': 'application/json' };
    var tg = window.TG && window.TG.app;
    var initData = (tg && tg.initData) || '';
    if (!initData && location.hash) {
      try { initData = new URLSearchParams(location.hash.replace(/^#/, '')).get('tgWebAppData') || ''; } catch (e) {}
    }
    if (initData) h['X-Telegram-Init-Data'] = initData;
    if (actAs) h['X-Act-As'] = actAs;
    var pin = localStorage.getItem('pinToken') || sessionStorage.getItem('pinToken');
    if (pin) h['X-Pin-Token'] = pin;
    var login = localStorage.getItem('loginToken');
    if (login) h['X-Login-Token'] = login;
    var t = sessionStorage.getItem('dev_auth');
    if (t) { h['X-Dev-Auth'] = t; h['X-Dev-Tg'] = sessionStorage.getItem('dev_tg') || ''; }
    return h;
  }
  function logLine(msg) {
    try {
      window.__kuryeLogs = window.__kuryeLogs || [];
      window.__kuryeLogs.push(new Date().toISOString().slice(11, 19) + ' ' + msg);
      if (window.__kuryeLogs.length > 100) window.__kuryeLogs.shift();
    } catch (e) {}
  }
  function req(method, path, body) {
    return fetch(path, {
      method: method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    }).then(function (r) {
      if (!r.ok) logLine('HTTP ' + r.status + ' ' + method + ' ' + path);
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Hata ' + r.status)); e.status = r.status; e.code = j.code; throw e; }
        return j;
      });
    });
  }

  var real = {
    oturum: function () {
      var sp = new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
      return req('GET', '/api/oturum' + (sp ? '?tgWebAppStartParam=' + encodeURIComponent(sp) : ''));
    },
    havuz: function () { return req('GET', '/api/havuz'); },
    kabul: function (ids) { return req('POST', '/api/kabul', { ids: ids }); },
    kmGir: function (id, km) { return req('POST', '/api/paket/' + id + '/km', { km: km }); },
    teslim: function (id, paid) { return req('POST', '/api/paket/' + id + '/teslim', paid == null ? {} : { paid: !!paid }); },
    iptal: function (id, reason) { return req('POST', '/api/paket/' + id + '/iptal', { reason: reason }); },
    atamaKarar: function (id, kabul) { return req('POST', '/api/atama/' + id + (kabul ? '/kabul' : '/reddet')); },
    aktar: function (id, payload) { return req('POST', '/api/paket/' + id + '/aktar', payload || {}); },
    paketlerim: function () { return req('GET', '/api/paketlerim'); },
    gecmis: function () { return req('GET', '/api/gecmis'); },
    kazanc: function (range, date) { return req('GET', '/api/kazanc' + (date ? '?date=' + encodeURIComponent(date) : (range ? '?range=' + encodeURIComponent(range) : ''))); },
    talepVer: function (items) { return req('POST', '/api/restoran/talep', { packages: items }); },
    paketlerimRestoran: function (filter) { return req('GET', '/api/restoran/paketlerim?filter=' + encodeURIComponent(filter || 'all')); },
    profil: function (data) { return req('PATCH', '/api/profil', data); },
    durum: function (status, reason) { return req('POST', '/api/durum', { status: status, reason: reason || null }); },
    kayit: function (data) { return req('POST', '/api/kayit', data); },
    sistem: function () { return req('GET', '/api/sistem'); },
    bildirimler: function () { return req('GET', '/api/bildirimler'); },
    bildirimOkundu: function (upto) { return req('POST', '/api/bildirimler/okundu', { upto: upto }); },
    bildirimTemizle: function () { return req('POST', '/api/bildirimler/temizle'); },
    odeme: function (ids, all) { return req('POST', '/api/odeme', { ids: ids || [], all: !!all }); },
    giris: function (phone, pin) { return req('POST', '/api/giris', { phone: phone, pin: pin }); },
    girisKullanicilar: function () { return req('GET', '/api/giris/kullanicilar'); },
    pinDurum: function () { return req('GET', '/api/pin/durum'); },
    pinOlustur: function (pin) { return req('POST', '/api/pin/olustur', { pin: pin }); },
    pinDogrula: function (pin) { return req('POST', '/api/pin/dogrula', { pin: pin }); },
    pinDegistir: function (oldPin, newPin) { return req('POST', '/api/pin/degistir', { old_pin: oldPin, new_pin: newPin }); },
    aktarimKuryeler: function () { return req('GET', '/api/aktarim/kuryeler'); },
    aktarimTeklifler: function () { return req('GET', '/api/aktarim/teklifler'); },
    aktarimKarar: function (token, kabul) { return req('POST', '/api/aktarim/' + token + (kabul ? '/kabul' : '/reddet')); },
    aktarTumu: function (payload) { return req('POST', '/api/aktarim/tumu', payload || {}); },
    yonetim: function (what, arg) {
      if (what === 'davet') return req('POST', '/api/yonetim/davet', arg || { role: 'kurye' });
      if (what === 'hesap') return req('POST', '/api/yonetim/hesap', arg || {});
      if (what === 'hesapGuncelle') return req('POST', '/api/yonetim/hesap-guncelle', arg || {});
      if (what === 'limit') return req('PUT', '/api/yonetim/limit', arg || {});
      if (what === 'sistem') return req('PUT', '/api/yonetim/sistem', arg || {});
      if (what === 'tarifeKaydet') return req('PUT', '/api/yonetim/tarife', arg || {});
      if (what === 'bolge') return req('POST', '/api/yonetim/bolge', arg || {});
      if (what === 'bolgeSirala') return req('POST', '/api/yonetim/bolge-sirala', arg || {});
      if (what === 'sontalepler') return req('GET', '/api/yonetim/sontalepler');
      if (what === 'rapor') return req('GET', '/api/yonetim/rapor' + (arg && arg.date ? '?date=' + encodeURIComponent(arg.date) : ''));
      if (what === 'mesaj') return req('POST', '/api/yonetim/mesaj', arg || {});
      if (what === 'mesajlar') return req('GET', '/api/yonetim/mesajlar');
      if (what === 'kuryePaketler') return req('GET', '/api/yonetim/kurye-paketler?courier=' + encodeURIComponent(arg && arg.courier || 0));
      if (what === 'odemeler') return req('GET', '/api/yonetim/odemeler');
      if (what === 'kuryeAta') return req('POST', '/api/yonetim/ata', arg || {});
      if (what === 'bildirimTemizle') return req('POST', '/api/bildirimler/temizle');
      if (what === 'temizle') return req('POST', '/api/yonetim/temizle', arg || {});
      return req('GET', '/api/yonetim/' + what);
    }
  };

  /* =======================  SEÇİM  ======================= */
  var mock = new Mock();
  var mode = 'mock';
  var qs = new URLSearchParams(location.search);
  var forcedRole = qs.get('role');
  if (qs.get('dev_tg')) {
    sessionStorage.setItem('dev_auth', qs.get('dev_auth') || 'localdev');
    sessionStorage.setItem('dev_tg', qs.get('dev_tg'));
  }

  var Api = {
    get mode() { return mode; },
    mock: mock,
    feeFor: feeFor,
    feePreview: feePreview,
    lastError: '',
    setActAs: function (mode) { actAs = mode || ''; if (actAs) sessionStorage.setItem('actAs', actAs); else sessionStorage.removeItem('actAs'); },
    logs: function () { return (window.__kuryeLogs || []).slice(); },
    log: logLine,
    sendLogs: function (extra) { return req('POST', '/api/log', { extra: extra, logs: (window.__kuryeLogs || []) }); },
    init: function () {
      var setMockRole = function () {
        mode = 'mock';
        if (forcedRole) {
          if (forcedRole === 'restoran') { mock.me.role = 'restoran'; mock.me.name = 'Restoran Yetkilisi'; }
          if (forcedRole === 'yonetici') { mock.me.role = 'yonetici'; mock.me.name = 'Yönetici'; }
        }
        return mock.oturum();
      };
      if (qs.get('mock') === '1') return Promise.resolve(setMockRole());
      return real.oturum().then(function (s) { mode = 'real'; return s; }).catch(function (e) {
        if (e && e.status === 403) throw e;
        Api.lastError = (e && e.message) || 'kimlik doğrulanamadı';
        var mockSession = setMockRole();
        mockSession.then(function (s) { s.mock_reason = Api.lastError; });
        return mockSession;
      });
    }
  };
  ['oturum', 'havuz', 'kabul', 'atamaKarar', 'kmGir', 'teslim', 'iptal', 'aktar', 'paketlerim', 'gecmis',
    'kazanc', 'talepVer', 'paketlerimRestoran', 'profil', 'durum', 'kayit', 'sistem', 'aktarimKuryeler', 'aktarimTeklifler', 'aktarimKarar', 'aktarTumu', 'bildirimler', 'bildirimOkundu', 'bildirimTemizle', 'odeme', 'giris', 'girisKullanicilar', 'pinDurum', 'pinOlustur', 'pinDogrula', 'pinDegistir', 'yonetim'].forEach(function (m) {
      Api[m] = function () {
        var a = Array.prototype.slice.call(arguments);
        var target = mode === 'real' ? real : mock;
        return target[m].apply(target, a);
      };
    });

  window.API = Api;
})();
