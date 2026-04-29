/**
 * JMK · Hotelier App v2
 * ======================
 * Dashboard για ξενοδόχο:
 *   - Σήμερα (κρατήσεις σήμερα μέσω QR, έσοδα, top activities)
 *   - QR Codes (download για print, ένα ανά δωμάτιο)
 *   - Κρατήσεις (live feed, ανά partner, ανά μέρα)
 *   - Έσοδα (μηνιαίο statement, payouts)
 *   - Συνεργάτες (partners πoυ έβγαλαν έσοδα στο νησί μου)
 *   - Καλεσμένοι (current guests στο ξενοδοχείο)
 */
(function (root) {
  'use strict';
  const J = root.JV;
  if (!J) { console.error('JV not loaded'); return; }

  const state = {
    hotelId: null,
    hotel: null,
    activeTab: 'today',
    bookings: [],
    orders: [],
    partners: [],
    activities: [],
    guests: []
  };

  async function mount(containerId, opts = {}) {
    J.injectStyles();
    state.hotelId = opts.hotelId || (new URLSearchParams(location.search).get('h')) || 'h-naxos-1';
    const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return;

    try { state.hotel = await J.get(`/api/collections/hotels/${state.hotelId}`); }
    catch (e) {
      el.innerHTML = `<div class="jv-shell"><div class="jv-empty"><div class="icon">⚠</div>Δεν βρέθηκε ξενοδοχείο: ${state.hotelId}</div></div>`;
      return;
    }

    const tabs = [['today','Σήμερα'],['qr','QR Codes'],['bookings','Κρατήσεις'],['earnings','Έσοδα'],['partners','Συνεργάτες'],['guests','Καλεσμένοι']];

    el.innerHTML = `
      <div class="jv-shell">
        <div class="jv-header">
          <h1>${J.escapeHtml(state.hotel.name)}</h1>
          <div class="sub">${J.escapeHtml(state.hotel.ownerName || '')} · ${state.hotel.rooms || 0} δωμάτια · ${J.escapeHtml(state.hotel.islandId || '')}</div>
          <div class="meta">
            <div>📊 ${state.hotel.totalBookings || 0} κρατήσεις συνολικά</div>
            <div>💰 ${J.formatEUR(state.hotel.totalCommission || 0)} commission συνολικά</div>
            <div>⚙️ Commission: ${state.hotel.commissionPct || 10}%</div>
          </div>
        </div>
        <div class="jv-tabs">
          ${tabs.map(([id, label]) => `<div class="jv-tab ${id === state.activeTab ? 'active' : ''}" data-tab="${id}">${label}</div>`).join('')}
        </div>
        <div id="jh2-content"></div>
      </div>
    `;

    el.querySelectorAll('.jv-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.jv-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      state.activeTab = t.getAttribute('data-tab');
      renderTab();
    }));

    await loadAllData();
    renderTab();
  }

  async function loadAllData() {
    const [bookings, orders, partners, activities, guests] = await Promise.all([
      J.get('/api/collections/bookings').catch(() => []),
      J.get('/api/orders?hotelId=' + state.hotelId).catch(() => []),
      J.get('/api/collections/partners').catch(() => []),
      J.get('/api/collections/activities').catch(() => []),
      J.get('/api/collections/guests').catch(() => [])
    ]);
    state.bookings = bookings.filter(b => b.hotelId === state.hotelId);
    state.orders = Array.isArray(orders) ? orders : [];
    state.partners = partners;
    state.activities = activities;
    state.guests = guests.filter(g => g.hotelId === state.hotelId);
  }

  function renderTab() {
    const c = document.getElementById('jh2-content');
    if (!c) return;
    c.innerHTML = '<div class="jv-card"><div class="empty"><div class="jv-spinner"></div></div></div>';
    switch (state.activeTab) {
      case 'today':    return renderToday(c);
      case 'qr':       return renderQR(c);
      case 'bookings': return renderBookings(c);
      case 'earnings': return renderEarnings(c);
      case 'partners': return renderPartners(c);
      case 'guests':   return renderGuests(c);
    }
  }

  // ============================================================
  //                      TODAY
  // ============================================================
  function renderToday(c) {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const todayB = state.bookings.filter(b => b.date === today);
    const monthB = state.bookings.filter(b => b.date && b.date.startsWith(month));
    const todayCommission = todayB.reduce((s, b) => s + (b.hotelCommission || 0), 0);
    const monthCommission = monthB.reduce((s, b) => s + (b.hotelCommission || 0), 0)
                          + state.orders.filter(o => (o.paidAt || '').startsWith(month)).reduce((s, o) => s + (o.hotelCommission || 0), 0);

    const topActs = {};
    state.bookings.forEach(b => { topActs[b.activityId] = (topActs[b.activityId] || 0) + 1; });
    const topList = Object.entries(topActs).sort((a, b) => b[1] - a[1]).slice(0, 5);

    c.innerHTML = `
      <div class="jv-grid jv-grid-3" style="margin-bottom:16px">
        <div class="jv-stat"><div class="label">Σήμερα</div><div class="value">${todayB.length}</div><div class="delta">κρατήσεις</div></div>
        <div class="jv-stat"><div class="label">Commission σήμερα</div><div class="value">${J.formatEUR(todayCommission)}</div><div class="delta">10% του ποσού</div></div>
        <div class="jv-stat"><div class="label">Commission μήνα</div><div class="value">${J.formatEUR(monthCommission)}</div><div class="delta">${month}</div></div>
      </div>

      <div class="jv-card">
        <h3>📅 Κρατήσεις σήμερα</h3>
        ${todayB.length === 0
          ? '<div class="empty">Καμία κράτηση μέσω του QR σου σήμερα</div>'
          : todayB.map(b => {
              const act = state.activities.find(a => a.id === b.activityId);
              const guest = state.guests.find(g => g.id === b.guestId);
              return `<div class="jv-row">
                <div class="avatar">${act?.coverIcon || '🎯'}</div>
                <div class="info">
                  <h4>${J.escapeHtml(act?.title || b.activityId)}</h4>
                  <p>${J.escapeHtml(guest?.name || '')} · ${b.time} · ${b.people} άτομα</p>
                </div>
                <div class="price">+${J.formatEUR(b.hotelCommission || 0)}</div>
              </div>`;
            }).join('')}
      </div>

      <div class="jv-card">
        <h3>🏆 Top δραστηριότητες</h3>
        ${topList.length === 0
          ? '<div class="empty">Δεν υπάρχουν δεδομένα</div>'
          : topList.map(([actId, count], i) => {
              const act = state.activities.find(a => a.id === actId);
              return `<div class="jv-row">
                <div class="avatar" style="background:linear-gradient(135deg,#C49A6C,#8B5E34)">${i + 1}</div>
                <div class="info"><h4>${J.escapeHtml(act?.title || actId)}</h4><p>${count} κρατήσεις</p></div>
                <div class="price">${J.formatEUR(state.bookings.filter(b => b.activityId === actId).reduce((s, b) => s + (b.hotelCommission || 0), 0))}</div>
              </div>`;
            }).join('')}
      </div>
    `;
  }

  // ============================================================
  //                       QR CODES
  // ============================================================
  function renderQR(c) {
    c.innerHTML = `
      <div class="jv-card">
        <h3>📱 QR Code του ξενοδοχείου</h3>
        <p style="font-size:13px;color:#64748B;margin:0 0 12px">Εκτύπωσε αυτό το QR και βάλ' το στη ρεσεψιόν, ή κάθε δωμάτιο ξεχωριστά παρακάτω.</p>

        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
          <div style="background:#fff;padding:14px;border-radius:12px;border:1px solid #E2E8F0">
            <img src="${J.api()}/api/qr/hotel/${state.hotelId}?format=png" alt="QR" style="width:240px;height:240px;display:block">
            <div style="text-align:center;margin-top:8px;font-size:12px;color:#64748B">Σκάναρε με κινητό</div>
          </div>

          <div style="flex:1;min-width:240px">
            <h4 style="margin:0 0 8px;font-size:14px">📥 Κατέβασε για print</h4>
            <div style="display:flex;flex-direction:column;gap:6px">
              <a class="jv-btn primary" href="${J.api()}/api/qr/hotel/${state.hotelId}?format=png" download="JMK_QR_${state.hotelId}.png">⬇ PNG (high-res)</a>
              <a class="jv-btn outline" href="${J.api()}/api/qr/hotel/${state.hotelId}?format=svg" download="JMK_QR_${state.hotelId}.svg">⬇ SVG (vector)</a>
              <button class="jv-btn outline" id="jh-print-all">🖨 Εκτύπωση σε A4 (όλα τα δωμάτια)</button>
            </div>

            <h4 style="margin:18px 0 8px;font-size:14px">🚪 QR ανά δωμάτιο</h4>
            <p style="font-size:11px;color:#64748B;margin:0 0 8px">Κάθε QR ξεχωριστό για να ξέρεις από ποιο δωμάτιο κάνει κράτηση ο guest.</p>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${[1,2,3,4,5].map(n => `<a class="jv-btn outline small" href="${J.api()}/api/qr/hotel/${state.hotelId}?format=png&room=${n}" download="JMK_QR_${state.hotelId}_room_${n}.png">Δωμ. ${n}</a>`).join('')}
              <button class="jv-btn outline small" id="jh-room-custom">+ άλλο δωμάτιο</button>
            </div>
          </div>
        </div>
      </div>

      <div class="jv-card">
        <h3>💡 Tips για τα QR</h3>
        <ul style="font-size:13px;line-height:1.8;color:#475569;margin:0;padding-left:20px">
          <li>Βάλε το QR στο desk της ρεσεψιόν με μήνυμα: <i>«Σκάνε για να δεις τι θα κάνεις σήμερα»</i></li>
          <li>Σε κάθε δωμάτιο βάλε ξεχωριστό QR ώστε να ξέρεις ποιος guest από ποιο δωμάτιο</li>
          <li>Στο welcome book βάλε ένα μεγαλύτερο QR με σύντομο tagline</li>
          <li>Στείλε το URL με email στους guests μέρες πριν την άφιξη — να ετοιμαστούν!</li>
        </ul>
      </div>
    `;

    document.getElementById('jh-room-custom').addEventListener('click', async () => {
      const num = await J.promptDialog('Νέο QR δωματίου', 'Αριθμός δωματίου:');
      if (num) window.open(`${J.api()}/api/qr/hotel/${state.hotelId}?format=png&room=${encodeURIComponent(num)}`, '_blank');
    });

    document.getElementById('jh-print-all').addEventListener('click', () => {
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>JMK QR — ${state.hotel.name}</title>
        <style>body{margin:0;font-family:sans-serif} .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:14px} .qr{text-align:center;page-break-inside:avoid;border:1px dashed #ccc;padding:14px;border-radius:8px} .qr img{width:280px;height:280px} .qr h2{margin:6px 0 2px;font-size:16px} .qr p{margin:0;font-size:11px;color:#666} @media print{.qr{border:0}}</style>
        </head><body>
        <div class="grid">
        ${Array.from({length: Math.min(state.hotel.rooms || 8, 12)}, (_, i) => i + 1).map(n => `
          <div class="qr">
            <img src="${J.api()}/api/qr/hotel/${state.hotelId}?format=png&room=${n}">
            <h2>${J.escapeHtml(state.hotel.name)}</h2>
            <p>Δωμάτιο ${n} · Σκάναρε για JMK</p>
          </div>
        `).join('')}
        </div>
        <script>window.print()<\\/script>
        </body></html>`);
      w.document.close();
    });
  }

  // ============================================================
  //                     BOOKINGS feed
  // ============================================================
  function renderBookings(c) {
    const sorted = state.bookings.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (sorted.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty">Καμία κράτηση μέσω του QR σου ακόμα</div></div>';
      return;
    }
    c.innerHTML = '<div class="jv-card">' + sorted.map(b => {
      const act = state.activities.find(a => a.id === b.activityId);
      const guest = state.guests.find(g => g.id === b.guestId);
      return `<div class="jv-row">
        <div class="avatar">${act?.coverIcon || '🎯'}</div>
        <div class="info">
          <h4>${J.escapeHtml(act?.title || b.activityId)}</h4>
          <p>${J.escapeHtml(guest?.name || '')} · ${b.date} ${b.time} · ${b.people} άτομα · <span class="jv-pill ${b.status === 'paid' || b.status === 'completed' ? 'green' : 'yellow'}">${b.status}</span></p>
        </div>
        <div class="price">+${J.formatEUR(b.hotelCommission || 0)}</div>
      </div>`;
    }).join('') + '</div>';
  }

  // ============================================================
  //                       EARNINGS
  // ============================================================
  function renderEarnings(c) {
    const months = {};
    state.bookings.forEach(b => {
      if (!b.paidAt) return;
      const m = b.paidAt.slice(0, 7);
      months[m] = (months[m] || 0) + (b.hotelCommission || 0);
    });
    state.orders.forEach(o => {
      if (!o.paidAt) return;
      const m = o.paidAt.slice(0, 7);
      months[m] = (months[m] || 0) + (o.hotelCommission || 0);
    });
    const sortedMonths = Object.entries(months).sort().reverse();
    const total = sortedMonths.reduce((s, [, v]) => s + v, 0);

    c.innerHTML = `
      <div class="jv-stat" style="margin-bottom:14px">
        <div class="label">Συνολικά έσοδα</div>
        <div class="value" style="font-size:28px">${J.formatEUR(total)}</div>
        <div class="delta">από όλα τα bookings/orders μέσω JMK</div>
      </div>
      <div class="jv-card">
        <h3>📊 Μηνιαίο breakdown</h3>
        ${sortedMonths.length === 0 ? '<div class="empty">Δεν υπάρχουν δεδομένα</div>' :
          sortedMonths.map(([m, v]) => `<div class="jv-row"><div class="info"><h4>${m}</h4><p>${state.bookings.filter(b => (b.paidAt || '').startsWith(m)).length + state.orders.filter(o => (o.paidAt || '').startsWith(m)).length} συναλλαγές</p></div><div class="price">${J.formatEUR(v)}</div></div>`).join('')}
      </div>
      <div class="jv-card">
        <h3>📅 Επόμενο payout</h3>
        <div style="padding:14px;background:#FEF3C7;border-radius:10px;font-size:13px;color:#92400E">
          Τα έσοδα συγκεντρώνονται και πληρώνονται 1η & 15η του μήνα. Ποσό για επόμενο payout: <b>${J.formatEUR(months[new Date().toISOString().slice(0,7)] || 0)}</b>
        </div>
      </div>
    `;
  }

  // ============================================================
  //                       PARTNERS
  // ============================================================
  function renderPartners(c) {
    const partnersUsed = {};
    state.bookings.forEach(b => { partnersUsed[b.partnerId] = (partnersUsed[b.partnerId] || 0) + 1; });
    state.orders.forEach(o => { partnersUsed[o.partnerId] = (partnersUsed[o.partnerId] || 0) + 1; });

    const list = Object.entries(partnersUsed)
      .sort((a, b) => b[1] - a[1])
      .map(([pid, cnt]) => ({ partner: state.partners.find(p => p.id === pid), count: cnt }))
      .filter(x => x.partner);

    c.innerHTML = `<div class="jv-card">
      <h3>🤝 Συνεργάτες (από κρατήσεις/παραγγελίες των guests μου)</h3>
      ${list.length === 0 ? '<div class="empty">Καμία κράτηση/παραγγελία ακόμα</div>' :
        list.map(({ partner: p, count }) => `<div class="jv-row">
          <div class="avatar">${J.initials(p.name)}</div>
          <div class="info"><h4>${J.escapeHtml(p.businessName || p.name)}</h4><p>${J.escapeHtml(p.category)} · ★ ${p.rating || '—'}</p></div>
          <div class="price">${count}× </div>
          <span class="jv-pill ${p.status === 'approved' ? 'green' : p.status === 'paused' ? 'red' : 'yellow'}">${p.status}</span>
        </div>`).join('')}
    </div>`;
  }

  // ============================================================
  //                       GUESTS
  // ============================================================
  function renderGuests(c) {
    const today = new Date().toISOString().slice(0, 10);
    const current = state.guests.filter(g => g.checkIn <= today && g.checkOut >= today);
    const upcoming = state.guests.filter(g => g.checkIn > today);
    const past = state.guests.filter(g => g.checkOut < today);

    c.innerHTML = `
      <div class="jv-card">
        <h3>🛏 Καλεσμένοι σήμερα (${current.length})</h3>
        ${current.length === 0 ? '<div class="empty">Κανένας guest σήμερα</div>' :
          current.map(g => guestRow(g)).join('')}
      </div>
      <div class="jv-card">
        <h3>📅 Επόμενοι ${upcoming.length}</h3>
        ${upcoming.length === 0 ? '<div class="empty">Καμία επόμενη κράτηση</div>' :
          upcoming.map(g => guestRow(g)).join('')}
      </div>
      ${past.length > 0 ? `<div class="jv-card"><h3>📜 Προηγούμενοι (${past.length})</h3>${past.slice(-5).map(g => guestRow(g)).join('')}</div>` : ''}
    `;
  }

  function guestRow(g) {
    const myBookings = state.bookings.filter(b => b.guestId === g.id);
    const totalSpent = myBookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const myComm = myBookings.reduce((s, b) => s + (b.hotelCommission || 0), 0);
    return `<div class="jv-row">
      <div class="avatar">${J.initials(g.name)}</div>
      <div class="info">
        <h4>${J.escapeHtml(g.name)} · Δωμ. ${J.escapeHtml(g.room)}</h4>
        <p>${g.checkIn} → ${g.checkOut} · ${myBookings.length} κρατήσεις · ${(g.interests || []).join(', ')}</p>
      </div>
      <div class="price">+${J.formatEUR(myComm)}</div>
    </div>`;
  }

  root.JMKHotelierV2 = { mount, state };
  console.log('[JMKHotelierV2] loaded');
})(typeof window !== 'undefined' ? window : globalThis);
