/**
 * JMK · Guest App — Persuasive Layer (v1.4)
 * ==========================================
 * Στόχος: ο τουρίστας να μπει στην εφαρμογή και να **ΘΕΛΕΙ** να ακολουθήσει
 * το πλάνο. Όχι μια λίστα activities — ένα ταξίδι.
 *
 * Τι κάνει:
 *   1. JMKPersuasive.mount(containerId, opts)  — δημιουργεί ολόκληρο το
 *      home view με 3 tabs (Δραστηριότητες | Εστιατόρια | Delivery)
 *      και πλούσιες κάρτες με photos, ratings, social proof, trust signals.
 *
 *   2. JMKPersuasive.openActivity(activityId)  — άνοιγμα detail screen
 *      με photo carousel, calendar picker, single-button booking.
 *
 *   3. JMKPersuasive.openRestaurant(partnerId) — menu browser με cart.
 *
 *   4. JMKPersuasive.openCart()                — checkout (full prepay για
 *      delivery, 20% deposit για restaurant).
 *
 * Τι ΔΕΝ φαίνεται στον guest (επιστροφή στο backend μόνο):
 *   • cancellationPolicy (strict/moderate/flexible) — περιμένει τον επόμενο γύρο
 *   • Stripe fee
 *   • Λεπτομέρειες commission split
 *   • Anti-bypass mechanics
 */
(function (root) {
  'use strict';

  function api() { return root.JMK_API_URL || ''; }
  function authHeader() {
    const t = (typeof localStorage !== 'undefined') && localStorage.getItem('jmk_token');
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  async function _fetch(method, path, body) {
    const opts = { method, headers: Object.assign({}, authHeader()) };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(api() + path, opts);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
    return data;
  }

  // ============================================================
  //                    GLOBAL STATE
  // ============================================================
  const state = {
    guestId: 'g-maria',          // default for demo
    hotelId: 'h-naxos-1',        // απ' το QR scan
    islandId: 'isl-naxos',
    cart: [],                    // [{itemId, qty, partnerId, name, price, photo}]
    cartPartner: null,           // current partner για cart (μόνο 1 partner/cart)
    activeTab: 'activities'      // activities | restaurants | delivery
  };

  // ============================================================
  //                       STYLES
  // ============================================================
  const styles = `
    .jp-root { font-family: -apple-system, "SF Pro Display", "Segoe UI", sans-serif; color: #0F172A; }
    .jp-hero { padding: 22px 18px 18px; background: linear-gradient(135deg, #0F4C5C 0%, #5F8A8B 100%); color: #fff; border-radius: 0 0 24px 24px; box-shadow: 0 8px 28px rgba(15,76,92,.18); }
    .jp-hero h1 { font-size: 26px; margin: 0 0 6px; font-weight: 800; letter-spacing: -.4px; }
    .jp-hero .sub { font-size: 14px; opacity: .92; }
    .jp-hero .stats { display: flex; gap: 14px; margin-top: 14px; }
    .jp-hero .stat b { font-size: 20px; display: block; }
    .jp-hero .stat span { font-size: 11px; opacity: .85; }

    .jp-trust { display: flex; gap: 6px; padding: 12px 14px; background: #FFF8E7; border-radius: 14px; margin: -14px 14px 12px; box-shadow: 0 4px 14px rgba(0,0,0,.06); position: relative; z-index: 2; overflow-x: auto; }
    .jp-trust .badge { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6B5300; white-space: nowrap; padding: 6px 10px; background: #fff; border-radius: 999px; font-weight: 600; }

    .jp-tabs { display: flex; gap: 6px; padding: 6px; margin: 14px; background: #F1F5F9; border-radius: 12px; }
    .jp-tab { flex: 1; text-align: center; padding: 10px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; color: #64748B; transition: all .15s; }
    .jp-tab.active { background: #fff; color: #0F4C5C; box-shadow: 0 2px 6px rgba(0,0,0,.08); }

    .jp-section { padding: 0 14px 18px; }
    .jp-h { font-size: 19px; font-weight: 800; margin: 12px 0 4px; letter-spacing: -.2px; }
    .jp-sub { font-size: 13px; color: #64748B; margin: 0 0 14px; }

    .jp-card { background: #fff; border-radius: 18px; overflow: hidden; box-shadow: 0 4px 14px rgba(15,23,42,.06); margin-bottom: 14px; cursor: pointer; transition: transform .15s, box-shadow .15s; position: relative; }
    .jp-card:active { transform: scale(.98); }
    .jp-card .photo { position: relative; aspect-ratio: 16/10; overflow: hidden; background: #f1f5f9; }
    .jp-card .photo img { width: 100%; height: 100%; object-fit: cover; }
    .jp-card .price-tag { position: absolute; bottom: 10px; right: 10px; background: rgba(255,255,255,.95); color: #0F4C5C; padding: 4px 10px; border-radius: 999px; font-weight: 800; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .jp-card .badges { position: absolute; top: 10px; left: 10px; display: flex; gap: 4px; flex-wrap: wrap; }
    .jp-card .badge { background: rgba(0,0,0,.7); color: #fff; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; backdrop-filter: blur(8px); }
    .jp-card .badge.gold { background: linear-gradient(135deg, #C49A6C, #8B5E34); }
    .jp-card .body { padding: 14px; }
    .jp-card .ttl { font-size: 16px; font-weight: 700; margin: 0 0 4px; line-height: 1.3; }
    .jp-card .desc { font-size: 13px; color: #475569; margin: 0 0 10px; line-height: 1.5; }
    .jp-card .meta { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #64748B; }
    .jp-card .rating { display: flex; align-items: center; gap: 4px; color: #C49A6C; font-weight: 700; }
    .jp-card .social { color: #0F4C5C; font-weight: 600; }

    .jp-plan { background: linear-gradient(135deg, #fff 0%, #F8FAFC 100%); border-radius: 20px; padding: 16px; margin-bottom: 14px; border: 2px solid transparent; cursor: pointer; box-shadow: 0 4px 14px rgba(15,23,42,.06); position: relative; overflow: hidden; }
    .jp-plan.featured { border-color: #C49A6C; }
    .jp-plan .ribbon { position: absolute; top: 12px; right: -28px; background: #C49A6C; color: #fff; padding: 3px 30px; transform: rotate(35deg); font-size: 10px; font-weight: 800; letter-spacing: .5px; }
    .jp-plan .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .jp-plan .icon { font-size: 28px; }
    .jp-plan .head .ttl { font-size: 17px; font-weight: 800; margin: 0; line-height: 1.2; }
    .jp-plan .head .pitch { font-size: 12px; color: #64748B; margin-top: 2px; }
    .jp-plan .timeline { background: #fff; border-radius: 12px; padding: 10px 12px; margin: 10px 0; }
    .jp-plan .slot { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px dashed #E2E8F0; font-size: 13px; }
    .jp-plan .slot:last-child { border: none; }
    .jp-plan .slot .t { font-weight: 700; color: #0F4C5C; min-width: 50px; }
    .jp-plan .footer { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
    .jp-plan .total { font-size: 18px; font-weight: 800; color: #0F4C5C; }
    .jp-plan .cta { background: #0F4C5C; color: #fff; padding: 9px 16px; border-radius: 999px; font-weight: 700; font-size: 13px; border: 0; cursor: pointer; }

    .jp-rest { display: flex; gap: 12px; padding: 12px; background: #fff; border-radius: 16px; margin-bottom: 12px; cursor: pointer; box-shadow: 0 3px 10px rgba(15,23,42,.06); align-items: center; }
    .jp-rest .ph { width: 88px; height: 88px; border-radius: 12px; background: #F1F5F9; flex: none; overflow: hidden; }
    .jp-rest .ph img { width: 100%; height: 100%; object-fit: cover; }
    .jp-rest .info h3 { font-size: 15px; margin: 0 0 4px; font-weight: 800; }
    .jp-rest .info .meta { font-size: 12px; color: #64748B; line-height: 1.5; }
    .jp-rest .info .pills { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
    .jp-rest .info .pill { font-size: 10px; padding: 2px 7px; border-radius: 999px; background: #E7F4F4; color: #0F4C5C; font-weight: 600; }
    .jp-rest .info .pill.gold { background: #FFF8E7; color: #6B5300; }

    .jp-menu-cat { font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: #64748B; margin: 16px 0 8px; padding: 0 14px; }
    .jp-menu-item { display: flex; gap: 12px; padding: 12px 14px; align-items: center; border-bottom: 1px solid #F1F5F9; cursor: pointer; transition: background .15s; }
    .jp-menu-item:active { background: #F8FAFC; }
    .jp-menu-item .ph { width: 64px; height: 64px; border-radius: 10px; background: #F1F5F9; flex: none; overflow: hidden; }
    .jp-menu-item .ph img { width: 100%; height: 100%; object-fit: cover; }
    .jp-menu-item .info { flex: 1; min-width: 0; }
    .jp-menu-item .info h4 { font-size: 14px; margin: 0 0 2px; font-weight: 700; }
    .jp-menu-item .info p { font-size: 12px; color: #64748B; margin: 0; line-height: 1.4; }
    .jp-menu-item .price { font-weight: 800; font-size: 14px; color: #0F4C5C; margin-left: 8px; }
    .jp-menu-item .add { background: #0F4C5C; color: #fff; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex: none; cursor: pointer; user-select: none; }

    .jp-cart-bar { position: sticky; bottom: 0; background: #0F4C5C; color: #fff; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; box-shadow: 0 -4px 16px rgba(0,0,0,.18); border-radius: 16px 16px 0 0; }
    .jp-cart-bar .left { display: flex; align-items: center; gap: 10px; }
    .jp-cart-bar .badge { background: #C49A6C; color: #fff; min-width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
    .jp-cart-bar .right { font-weight: 800; font-size: 15px; }

    .jp-modal { position: fixed; inset: 0; background: rgba(15,23,42,.6); z-index: 9999; display: flex; align-items: flex-end; backdrop-filter: blur(4px); }
    .jp-modal-card { background: #fff; width: 100%; max-height: 90vh; border-radius: 24px 24px 0 0; overflow-y: auto; padding: 0; }
    .jp-modal-card .close { position: sticky; top: 8px; left: calc(100% - 44px); width: 36px; height: 36px; background: rgba(15,23,42,.85); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; z-index: 2; margin-bottom: -36px; }
    .jp-modal-card .gallery { aspect-ratio: 4/3; background: #f1f5f9; overflow: hidden; position: relative; }
    .jp-modal-card .gallery img { width: 100%; height: 100%; object-fit: cover; }
    .jp-modal-card .gallery .dots { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; }
    .jp-modal-card .gallery .dots span { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.6); }
    .jp-modal-card .gallery .dots span.a { background: #fff; }
    .jp-modal-card .content { padding: 18px; }
    .jp-modal-card h2 { margin: 0 0 6px; font-size: 22px; font-weight: 800; letter-spacing: -.3px; }
    .jp-modal-card .pitch { color: #64748B; font-size: 14px; margin-bottom: 14px; line-height: 1.5; }
    .jp-modal-card .why-section { background: #FFF8E7; padding: 14px; border-radius: 12px; margin: 14px 0; }
    .jp-modal-card .why-section h4 { margin: 0 0 6px; font-size: 13px; color: #6B5300; }
    .jp-modal-card .why-section ul { margin: 0; padding-left: 18px; font-size: 13px; color: #6B5300; }
    .jp-modal-card .why-section li { margin: 3px 0; }
    .jp-modal-card .includes { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; }
    .jp-modal-card .includes .pill { background: #E7F4F4; color: #0F4C5C; padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .jp-modal-card .book-btn { background: #0F4C5C; color: #fff; padding: 16px; border-radius: 14px; text-align: center; font-weight: 800; font-size: 16px; cursor: pointer; margin-top: 14px; box-shadow: 0 4px 14px rgba(15,76,92,.3); }
    .jp-modal-card .book-btn .small { display: block; font-size: 11px; opacity: .85; font-weight: 500; margin-top: 2px; }
  `;

  function ensureStyles() {
    if (document.getElementById('jp-styles')) return;
    const s = document.createElement('style');
    s.id = 'jp-styles';
    s.textContent = styles;
    document.head.appendChild(s);
  }

  // ============================================================
  //                  PERSUASIVE COPY HELPERS
  // ============================================================
  const PITCHES_BY_THEME = {
    Adventure: [
      'Η μέρα που θα διηγείσαι σε φίλους όταν γυρίσεις',
      'Νερά τιρκουάζ που δε χωράνε σε φωτογραφία',
      'Από τα κρυμμένα διαμάντια του νησιού'
    ],
    Relax: [
      'Επιτρέπεται να μη βιαστείς σήμερα',
      'Ηλιοβασίλεμα που δικαιολογεί όλο το ταξίδι',
      'Η Ελλάδα όπως την ονειρευόσουν'
    ],
    Foodie: [
      'Γεύσεις που δεν θα βρεις σε καμία τουριστική λίστα',
      'Αυθεντικές συνταγές 4 γενεών',
      'Tο εστιατόριο που οι ντόπιοι κρατούν μυστικό'
    ]
  };

  function pickPitch(theme) {
    const arr = PITCHES_BY_THEME[theme] || PITCHES_BY_THEME.Relax;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function socialProof(activity) {
    const r = activity.reviewCount || 0;
    if (r >= 200) return `🔥 ${r}+ guests έχουν αγαπήσει αυτό`;
    if (r >= 50)  return `✨ ${r} εξαιρετικές κριτικές`;
    if (r >= 10)  return `💫 ${r} guests φέτος`;
    return '🌟 Νέα προσφορά';
  }

  // ============================================================
  //                       CART API
  // ============================================================
  function addToCart(item) {
    if (state.cartPartner && state.cartPartner !== item.partnerId) {
      if (!confirm('Έχεις ήδη παραγγελία από άλλο μέρος. Θα διαγραφεί. Συνέχεια;')) return false;
      state.cart = [];
    }
    state.cartPartner = item.partnerId;
    const ex = state.cart.find(c => c.itemId === item.itemId);
    if (ex) ex.qty += 1;
    else state.cart.push({ itemId: item.itemId, qty: 1, partnerId: item.partnerId, name: item.name, price: item.price, photo: item.photo });
    updateCartBar();
    return true;
  }

  function cartTotal() {
    return state.cart.reduce((s, c) => s + c.price * c.qty, 0);
  }

  function cartCount() {
    return state.cart.reduce((s, c) => s + c.qty, 0);
  }

  function updateCartBar() {
    const bar = document.getElementById('jp-cart-bar');
    if (!bar) return;
    const cnt = cartCount();
    if (cnt === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    bar.querySelector('.badge').textContent = cnt;
    bar.querySelector('.total').textContent = `€${cartTotal().toFixed(2)}`;
  }

  // ============================================================
  //                    MAIN MOUNT
  // ============================================================
  async function mount(containerId, opts = {}) {
    ensureStyles();
    Object.assign(state, opts || {});
    const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return console.error('container not found');

    // Initial shell
    el.innerHTML = `
      <div class="jp-root">
        <div class="jp-hero">
          <h1>Καλημέρα ${escapeHtml(opts.guestName || 'Maria')}! 🌊</h1>
          <div class="sub" id="jp-hero-sub">Φτιάχνουμε την τέλεια μέρα σου στη Νάξο…</div>
          <div class="stats" id="jp-hero-stats"></div>
        </div>

        <div class="jp-trust">
          <div class="badge">⛅ Καιρός-έξυπνη επιλογή</div>
          <div class="badge">💳 Πληρωμή με ασφάλεια</div>
          <div class="badge">📞 24/7 υποστήριξη</div>
          <div class="badge">⭐ 4.8 μέσος όρος</div>
        </div>

        <div class="jp-tabs" id="jp-tabs">
          <div class="jp-tab active" data-tab="activities">🎯 Δραστηριότητες</div>
          <div class="jp-tab" data-tab="restaurants">🍽 Εστιατόρια</div>
          <div class="jp-tab" data-tab="delivery">🛵 Delivery</div>
        </div>

        <div class="jp-section" id="jp-content"><div style="padding:40px;text-align:center;color:#94A3B8">Φόρτωση…</div></div>

        <div id="jp-cart-bar" class="jp-cart-bar" style="display:none">
          <div class="left">🛒 <span class="badge">0</span> Καλάθι</div>
          <div class="right"><span class="total">€0.00</span> · Δες παραγγελία →</div>
        </div>
      </div>
    `;

    // Tab switching
    el.querySelectorAll('.jp-tab').forEach(t => {
      t.addEventListener('click', () => {
        el.querySelectorAll('.jp-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.activeTab = t.getAttribute('data-tab');
        renderContent();
      });
    });

    // Cart bar click
    document.getElementById('jp-cart-bar').addEventListener('click', openCart);

    // Initial load
    await renderContent();
    await loadHeroStats();
  }

  async function loadHeroStats() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const w = await _fetch('GET', `/api/weather?island=${state.islandId}&date=${today}`);
      const stats = document.getElementById('jp-hero-stats');
      if (stats) {
        stats.innerHTML = `
          <div class="stat"><b>${Math.round(w.tempMaxC || 28)}°</b><span>${w.summary || 'Καιρός'}</span></div>
          <div class="stat"><b>${Math.round(w.windKmh || 15)}</b><span>km/h άνεμος</span></div>
          <div class="stat"><b>3</b><span>έτοιμα πλάνα</span></div>
        `;
      }
      const sub = document.getElementById('jp-hero-sub');
      if (sub) {
        const goodDay = (w.precipMm || 0) < 1 && (w.windKmh || 0) < 30;
        sub.textContent = goodDay
          ? `Σήμερα ${Math.round(w.tempMaxC || 28)}° με ${w.summary?.toLowerCase() || 'ηλιοφάνεια'} — ιδανικά για θάλασσα!`
          : `Σήμερα ${w.summary || ''} — έχουμε όμορφες indoor προτάσεις.`;
      }
    } catch (e) { /* fallback hero already shown */ }
  }

  async function renderContent() {
    const c = document.getElementById('jp-content');
    if (!c) return;
    c.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8">Φόρτωση…</div>`;
    if (state.activeTab === 'activities')      return renderActivities(c);
    if (state.activeTab === 'restaurants')     return renderRestaurants(c);
    if (state.activeTab === 'delivery')        return renderDelivery(c);
  }

  // ============================================================
  //                    ACTIVITIES TAB
  // ============================================================
  async function renderActivities(c) {
    try {
      // Load activities + itinerary (3 plans for today)
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const [allActs, itin] = await Promise.all([
        _fetch('GET', `/api/collections/activities`),
        _fetch('POST', `/api/itinerary`, { hotelId: state.hotelId, dates: [today, tomorrow], guestId: state.guestId })
      ]);

      const islandActs = allActs.filter(a => a.islandId === state.islandId && a.status === 'active' && a.category !== 'restaurant' && a.category !== 'delivery');

      const todayPlans = (itin.days?.[0]?.plans || []);
      const tomorrowPlans = (itin.days?.[1]?.plans || []);

      let html = `<h2 class="jp-h">3 πλάνα για σήμερα ✨</h2>
                  <p class="jp-sub">Επιλεγμένα ειδικά για σένα — φύσημα, καιρός, ενδιαφέροντα</p>`;

      todayPlans.forEach((plan, i) => {
        const featured = i === 0;
        html += `
          <div class="jp-plan ${featured ? 'featured' : ''}" data-action="open-plan" data-plan="${i}">
            ${featured ? '<div class="ribbon">TOP PICK</div>' : ''}
            <div class="head">
              <div class="icon">${plan.icon || '✨'}</div>
              <div>
                <h3 class="ttl">${escapeHtml(plan.themeGr || plan.theme)}</h3>
                <div class="pitch">${escapeHtml(pickPitch(plan.theme))}</div>
              </div>
            </div>
            <div class="timeline">
              ${plan.slots.map(s => `
                <div class="slot">
                  <span class="t">${escapeHtml(s.time.split('–')[0])}</span>
                  <span>${s.activity.coverIcon || ''} ${escapeHtml(s.activity.title)}</span>
                </div>
              `).join('')}
            </div>
            <div class="footer">
              <div class="total">€${plan.totalPrice.toFixed(0)} <span style="font-size:11px;color:#94A3B8;font-weight:400">σύνολο</span></div>
              <button class="cta" data-action="open-plan" data-plan="${i}">Δες περισσότερα →</button>
            </div>
          </div>
        `;
      });

      html += `<h2 class="jp-h" style="margin-top:24px">Όλες οι δραστηριότητες</h2>`;
      islandActs.forEach(a => {
        const cover = (a.photos && a.photos[0]?.url) || null;
        html += `
          <div class="jp-card" data-action="open-activity" data-id="${a.id}">
            <div class="photo">
              ${cover ? `<img src="${cover}" alt="" loading="lazy">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:48px">${a.coverIcon || '✨'}</div>`}
              <div class="badges">
                ${(a.weatherConditions || []).length === 0 ? '<span class="badge gold">Με κάθε καιρό</span>' : '<span class="badge">⛅ Καιρός-έξυπνο</span>'}
              </div>
              <div class="price-tag">€${a.price}</div>
            </div>
            <div class="body">
              <h3 class="ttl">${escapeHtml(a.title)}</h3>
              <p class="desc">${escapeHtml(truncate(a.description, 90))}</p>
              <div class="meta">
                <div class="rating">★ ${a.rating || '—'} <span style="color:#94A3B8;font-weight:400">(${a.reviewCount || 0})</span></div>
                <div class="social">${escapeHtml(socialProof(a))}</div>
              </div>
            </div>
          </div>
        `;
      });

      c.innerHTML = html;

      // Wire clicks
      c.querySelectorAll('[data-action="open-activity"]').forEach(node => {
        node.addEventListener('click', () => openActivity(node.getAttribute('data-id'), allActs));
      });
      c.querySelectorAll('[data-action="open-plan"]').forEach(node => {
        node.addEventListener('click', () => openPlan(todayPlans[Number(node.getAttribute('data-plan'))]));
      });

    } catch (e) {
      c.innerHTML = `<div style="padding:30px;text-align:center;color:#ef4444">Σφάλμα: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ============================================================
  //                  RESTAURANTS TAB
  // ============================================================
  async function renderRestaurants(c) {
    try {
      const list = await _fetch('GET', `/api/restaurants?island=${state.islandId}`);
      if (list.length === 0) {
        c.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8">🍽 Δεν υπάρχουν εστιατόρια ακόμα στο νησί.</div>`;
        return;
      }
      let html = `
        <h2 class="jp-h">🍽 Κράτησε τραπέζι</h2>
        <p class="jp-sub">Τα αγαπημένα των ντόπιων — δεν χάνονται σε λίστες αναμονής</p>
      `;
      list.forEach(p => {
        html += `
          <div class="jp-rest" data-action="open-rest" data-id="${p.id}">
            <div class="ph"><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,#C49A6C,#8B5E34)">🍽</div></div>
            <div class="info">
              <h3>${escapeHtml(p.businessName || p.name)}</h3>
              <div class="meta">${escapeHtml(p.cuisine || 'Παραδοσιακή')} · ${escapeHtml(p.openHours || 'Καθημερινά')}</div>
              <div class="pills">
                <span class="pill gold">★ ${p.rating || '—'} (${p.reviewCount || 0})</span>
                <span class="pill">⚡ Άμεση κράτηση</span>
              </div>
            </div>
            <div style="font-size:24px;color:#94A3B8">›</div>
          </div>
        `;
      });
      c.innerHTML = html;
      c.querySelectorAll('[data-action="open-rest"]').forEach(node => {
        node.addEventListener('click', () => openRestaurant(node.getAttribute('data-id'), 'restaurant'));
      });
    } catch (e) {
      c.innerHTML = `<div style="padding:30px;text-align:center;color:#ef4444">Σφάλμα: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ============================================================
  //                   DELIVERY TAB
  // ============================================================
  async function renderDelivery(c) {
    try {
      const list = await _fetch('GET', `/api/delivery?island=${state.islandId}`);
      if (list.length === 0) {
        c.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8">🛵 Σύντομα και delivery στο νησί σου!</div>`;
        return;
      }
      let html = `
        <h2 class="jp-h">🛵 Παραγγελία στο δωμάτιο</h2>
        <p class="jp-sub">Πληρώνεις απ' την εφαρμογή — έρχεται χωρίς ταλαιπωρία</p>
      `;
      list.forEach(p => {
        html += `
          <div class="jp-rest" data-action="open-deliv" data-id="${p.id}">
            <div class="ph"><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,#5F8A8B,#0F4C5C)">🛵</div></div>
            <div class="info">
              <h3>${escapeHtml(p.businessName || p.name)}</h3>
              <div class="meta">${escapeHtml(p.cuisine || 'Mixed')} · ⏱ ${escapeHtml(p.eta || '30-45 min')}</div>
              <div class="pills">
                <span class="pill gold">★ ${p.rating || '—'} (${p.reviewCount || 0})</span>
                <span class="pill">€${(p.deliveryFee || 0).toFixed(2)} delivery</span>
              </div>
            </div>
            <div style="font-size:24px;color:#94A3B8">›</div>
          </div>
        `;
      });
      c.innerHTML = html;
      c.querySelectorAll('[data-action="open-deliv"]').forEach(node => {
        node.addEventListener('click', () => openRestaurant(node.getAttribute('data-id'), 'delivery'));
      });
    } catch (e) {
      c.innerHTML = `<div style="padding:30px;text-align:center;color:#ef4444">Σφάλμα: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ============================================================
  //                  MENU BROWSER (Restaurant/Delivery)
  // ============================================================
  async function openRestaurant(partnerId, type) {
    try {
      const data = await _fetch('GET', `/api/partners/${partnerId}/menu`);
      const items = data.items || [];
      const cats = [...new Set(items.map(i => i.category))];

      let body = `
        <div class="content">
          <h2>${escapeHtml(data.partner.name)}</h2>
          <div class="pitch">${escapeHtml(data.partner.cuisine || '')} · ★ ${data.partner.rating || '—'} (${data.partner.reviewCount || 0}) ${data.partner.eta ? `· ⏱ ${data.partner.eta}` : ''}</div>
        </div>
      `;
      cats.forEach(cat => {
        const catItems = items.filter(i => i.category === cat);
        body += `<div class="jp-menu-cat">${escapeHtml(catLabel(cat))}</div>`;
        catItems.forEach(i => {
          body += `
            <div class="jp-menu-item">
              <div class="ph">${i.photo ? `<img src="${i.photo}" loading="lazy">` : ''}</div>
              <div class="info">
                <h4>${escapeHtml(i.name)}</h4>
                <p>${escapeHtml(truncate(i.description || '', 80))}</p>
              </div>
              <div class="price">€${i.price.toFixed(2)}</div>
              <div class="add" data-add="${i.id}">+</div>
            </div>
          `;
        });
      });

      showModal(body);

      // Attach add-to-cart handlers
      document.querySelectorAll('[data-add]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-add');
          const item = items.find(x => x.id === id);
          if (!item) return;
          addToCart({ itemId: item.id, partnerId: item.partnerId, name: item.name, price: item.price, photo: item.photo });
          btn.textContent = '✓';
          setTimeout(() => btn.textContent = '+', 800);
        });
      });

      // Stash type for later
      state.cartType = type;
    } catch (e) { alert('Σφάλμα: ' + e.message); }
  }

  function catLabel(c) {
    const m = { starter: 'Ορεκτικά', salad: 'Σαλάτες', main: 'Κυρίως', dessert: 'Επιδόρπια', drink: 'Ποτά', gyros: 'Γύροι', pizza: 'Pizza', burger: 'Burgers', pasta: 'Ζυμαρικά', side: 'Συνοδευτικά' };
    return m[c] || c;
  }

  // ============================================================
  //                       CART / CHECKOUT
  // ============================================================
  function openCart() {
    if (state.cart.length === 0) return;
    const body = `
      <div class="content">
        <h2>Η παραγγελία σου</h2>
        <div class="pitch">Από ${escapeHtml(state.cart[0].partnerId)}</div>
        ${state.cart.map(c => `
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #F1F5F9">
            <div>
              <div style="font-weight:700">${c.qty}× ${escapeHtml(c.name)}</div>
              <div style="font-size:12px;color:#64748B">€${c.price.toFixed(2)} / τμχ</div>
            </div>
            <div style="font-weight:700">€${(c.price * c.qty).toFixed(2)}</div>
          </div>
        `).join('')}
        <div style="display:flex;justify-content:space-between;padding:14px 0;font-weight:800;font-size:18px">
          <span>Σύνολο</span><span>€${cartTotal().toFixed(2)}</span>
        </div>
        <div style="background:#FFF8E7;padding:12px;border-radius:10px;font-size:12px;color:#6B5300;margin:10px 0">
          ${state.cartType === 'delivery' ? '💳 Πληρώνεις τώρα όλο το ποσό. Δεν χρειάζεται μετρητά στον driver.' : '💳 Προπληρώνεις 20% για κράτηση τραπεζιού — το υπόλοιπο στον λογαριασμό.'}
        </div>
        <div class="book-btn" id="jp-place-order">
          ${state.cartType === 'delivery' ? `Πλήρωσε €${cartTotal().toFixed(2)} & παράγγειλε` : `Κράτηση & προπληρωμή 20%`}
          <span class="small">Επιστρέφεται 100% αν ακυρώσεις γρήγορα</span>
        </div>
      </div>
    `;
    showModal(body);
    document.getElementById('jp-place-order').addEventListener('click', placeOrder);
  }

  async function placeOrder() {
    const btn = document.getElementById('jp-place-order');
    btn.style.opacity = '.5';
    btn.innerHTML = 'Στέλνουμε την παραγγελία…';
    try {
      const order = await _fetch('POST', '/api/orders', {
        partnerId: state.cartPartner,
        hotelId: state.hotelId,
        guestId: state.guestId,
        type: state.cartType || 'delivery',
        items: state.cart.map(c => ({ itemId: c.itemId, qty: c.qty }))
      });

      // Auto-confirm payment (stub mode)
      await _fetch('POST', `/api/orders/${order.order.id}/confirm-payment`, { intentId: order.intent.id });

      state.cart = [];
      state.cartPartner = null;
      updateCartBar();
      closeModal();
      showSuccess(state.cartType === 'delivery'
        ? `✅ Παραγγελία επιβεβαιώθηκε!<br><br>Έρχεται σε ~30-45 λεπτά στο δωμάτιό σου.<br><br>Σου στείλαμε email επιβεβαίωσης.`
        : `✅ Κράτηση επιβεβαιώθηκε!<br><br>Σε περιμένουμε!<br><br>Σου στείλαμε email με την επιβεβαίωση.`);
    } catch (e) {
      btn.innerHTML = 'Σφάλμα — δοκίμασε ξανά';
      btn.style.opacity = '1';
      alert(e.message);
    }
  }

  // ============================================================
  //                     ACTIVITY DETAIL
  // ============================================================
  function openActivity(activityId, allActs) {
    const a = (allActs || []).find(x => x.id === activityId);
    if (!a) return;
    const photos = a.photos || [];
    let pIdx = 0;
    const galleryHtml = () => `
      <div class="gallery">
        ${photos[pIdx] ? `<img src="${photos[pIdx].url}" alt="">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:64px">${a.coverIcon || ''}</div>`}
        ${photos.length > 1 ? `<div class="dots">${photos.map((_, i) => `<span class="${i === pIdx ? 'a' : ''}"></span>`).join('')}</div>` : ''}
      </div>
    `;

    const body = `
      <div id="jp-gallery-wrap">${galleryHtml()}</div>
      <div class="content">
        <h2>${escapeHtml(a.title)}</h2>
        <div class="pitch">${escapeHtml(a.description)}</div>

        <div class="why-section">
          <h4>✨ Γιατί θα σου αρέσει</h4>
          <ul>
            <li>${escapeHtml(socialProof(a))}</li>
            ${(a.weatherConditions || []).length === 0 ? '<li>🌦 Δουλεύει με κάθε καιρό</li>' : '<li>⛅ Επιλεγμένο για τον σημερινό καιρό</li>'}
            <li>📞 24/7 υποστήριξη — αν συμβεί κάτι, είμαστε εδώ</li>
            <li>💳 Ασφαλής πληρωμή μέσω εφαρμογής</li>
          </ul>
        </div>

        <h4 style="margin:16px 0 6px;font-size:14px">Συμπεριλαμβάνονται</h4>
        <div class="includes">
          ${(a.includes || []).map(i => `<span class="pill">${escapeHtml(i)}</span>`).join('')}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
          <div>
            <div style="font-size:11px;color:#64748B">Συνολικά</div>
            <div style="font-size:24px;font-weight:800;color:#0F4C5C">€${a.price} <span style="font-size:12px;font-weight:500;color:#64748B">/ άτομο</span></div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:13px;color:#64748B">Άτομα:</span>
            <button data-ppl-minus style="width:28px;height:28px;border-radius:50%;border:1px solid #ccc;background:#fff;font-weight:700;cursor:pointer">−</button>
            <span id="jp-ppl" style="min-width:24px;text-align:center;font-weight:800">2</span>
            <button data-ppl-plus style="width:28px;height:28px;border-radius:50%;border:1px solid #ccc;background:#fff;font-weight:700;cursor:pointer">+</button>
          </div>
        </div>

        <div class="book-btn" id="jp-book-btn">
          Κράτηση τώρα
          <span class="small">Προπληρωμή 20% — το υπόλοιπο στο activity</span>
        </div>
      </div>
    `;
    showModal(body);

    // Wire gallery navigation (tap left/right halves)
    const gw = document.getElementById('jp-gallery-wrap');
    if (gw && photos.length > 1) {
      gw.addEventListener('click', (e) => {
        const rect = gw.getBoundingClientRect();
        const isLeft = (e.clientX - rect.left) < rect.width / 2;
        pIdx = isLeft ? (pIdx - 1 + photos.length) % photos.length : (pIdx + 1) % photos.length;
        gw.innerHTML = galleryHtml();
      });
    }

    let ppl = 2;
    document.querySelector('[data-ppl-minus]')?.addEventListener('click', () => { ppl = Math.max(1, ppl - 1); document.getElementById('jp-ppl').textContent = ppl; });
    document.querySelector('[data-ppl-plus]')?.addEventListener('click', () => { ppl = Math.min(a.maxPeople || 12, ppl + 1); document.getElementById('jp-ppl').textContent = ppl; });

    document.getElementById('jp-book-btn').addEventListener('click', () => bookActivity(a, ppl));
  }

  async function bookActivity(activity, people) {
    const btn = document.getElementById('jp-book-btn');
    btn.style.opacity = '.5';
    btn.innerHTML = 'Στέλνουμε αίτημα κράτησης…';
    try {
      // Find next available date
      const today = new Date().toISOString().slice(0, 10);
      const horizon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const cal = await _fetch('GET', `/api/activities/${activity.id}/availability?from=${today}&to=${horizon}`);
      const firstAvail = (cal.days || []).find(d => d.isOpen && d.slots.some(s => s.available >= people));
      if (!firstAvail) throw new Error('Δεν βρέθηκαν διαθέσιμες μέρες — δοκίμασε ξανά αργότερα');
      const slot = firstAvail.slots.find(s => s.available >= people);

      const booking = await _fetch('POST', '/api/bookings', {
        activityId: activity.id,
        hotelId: state.hotelId,
        guestId: state.guestId,
        date: firstAvail.date,
        time: slot.time,
        slotId: slot.slotId,
        people
      });

      // Auto-agree at the suggested price (deposit 20%)
      await _fetch('POST', `/api/bookings/${booking.id}/agree`, { agreedAmount: booking.totalAmount });
      // Auto-confirm deposit (stub)
      await _fetch('POST', `/api/bookings/${booking.id}/confirm-deposit`, {});

      closeModal();
      showSuccess(`✅ Κρατήθηκε!<br><br><b>${escapeHtml(activity.title)}</b><br>${firstAvail.date} στις ${slot.time}<br><br>Πλήρωσες <b>20% προκαταβολή</b>. Το υπόλοιπο στο activity.`);
    } catch (e) {
      btn.innerHTML = 'Σφάλμα — δοκίμασε ξανά';
      btn.style.opacity = '1';
      alert(e.message);
    }
  }

  function openPlan(plan) {
    if (!plan) return;
    const body = `
      <div class="content">
        <h2>${plan.icon || '✨'} ${escapeHtml(plan.themeGr || plan.theme)}</h2>
        <div class="pitch">${escapeHtml(pickPitch(plan.theme))}</div>

        <div class="why-section">
          <h4>Το πλάνο σου σήμερα</h4>
          <ul>
            ${plan.slots.map(s => `<li><b>${escapeHtml(s.time.split('–')[0])}</b> · ${s.activity.coverIcon || ''} ${escapeHtml(s.activity.title)}</li>`).join('')}
          </ul>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
          <div>
            <div style="font-size:11px;color:#64748B">Σύνολο πλάνου</div>
            <div style="font-size:24px;font-weight:800;color:#0F4C5C">€${plan.totalPrice.toFixed(0)}</div>
          </div>
          <div style="font-size:13px;color:#64748B">${plan.slots.length} εμπειρίες</div>
        </div>

        <div class="book-btn" data-action="book-plan">
          Κλείσε όλο το πλάνο
          <span class="small">Προπληρωμή 20% για όλες τις κρατήσεις</span>
        </div>
      </div>
    `;
    showModal(body);
    document.querySelector('[data-action="book-plan"]').addEventListener('click', () => bookPlan(plan));
  }

  async function bookPlan(plan) {
    const btn = document.querySelector('[data-action="book-plan"]');
    btn.style.opacity = '.5';
    btn.innerHTML = 'Δημιουργούμε όλες τις κρατήσεις…';
    try {
      let count = 0;
      for (const s of plan.slots) {
        try {
          await bookActivityQuiet(s.activity, 2);
          count++;
        } catch {}
      }
      closeModal();
      showSuccess(`✅ ${count}/${plan.slots.length} κρατήσεις ολοκληρώθηκαν!<br><br>Τσέκαρε το ταξίδι σου για λεπτομέρειες.`);
    } catch (e) {
      alert(e.message);
      btn.innerHTML = 'Σφάλμα';
      btn.style.opacity = '1';
    }
  }

  async function bookActivityQuiet(activity, people) {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const cal = await _fetch('GET', `/api/activities/${activity.id}/availability?from=${today}&to=${horizon}`);
    const firstAvail = (cal.days || []).find(d => d.isOpen && d.slots.some(s => s.available >= people));
    if (!firstAvail) throw new Error('no slot');
    const slot = firstAvail.slots.find(s => s.available >= people);
    const booking = await _fetch('POST', '/api/bookings', {
      activityId: activity.id, hotelId: state.hotelId, guestId: state.guestId,
      date: firstAvail.date, time: slot.time, slotId: slot.slotId, people
    });
    await _fetch('POST', `/api/bookings/${booking.id}/agree`, { agreedAmount: booking.totalAmount });
    await _fetch('POST', `/api/bookings/${booking.id}/confirm-deposit`, {});
    return booking;
  }

  // ============================================================
  //                    MODAL & SUCCESS
  // ============================================================
  function showModal(bodyHtml) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'jp-modal';
    m.id = 'jp-modal';
    m.innerHTML = `<div class="jp-modal-card"><div class="close" id="jp-modal-close">×</div>${bodyHtml}</div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    document.getElementById('jp-modal-close').addEventListener('click', closeModal);
  }
  function closeModal() {
    document.getElementById('jp-modal')?.remove();
  }
  function showSuccess(html) {
    showModal(`<div class="content" style="text-align:center;padding:40px 20px">
      <div style="font-size:64px;margin-bottom:14px">🎉</div>
      <div style="font-size:16px;line-height:1.6">${html}</div>
      <div class="book-btn" onclick="document.getElementById('jp-modal').remove()" style="margin-top:24px;cursor:pointer">Τέλεια!</div>
    </div>`);
  }

  // ============================================================
  //                       UTILS
  // ============================================================
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function truncate(s, n) { return String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''); }

  // ============================================================
  //                      EXPORT
  // ============================================================
  root.JMKPersuasive = {
    mount,
    openActivity,
    openRestaurant,
    openCart,
    state
  };

  console.log('[JMKPersuasive] v1.4 loaded — ready to inspire travelers');
})(typeof window !== 'undefined' ? window : globalThis);
