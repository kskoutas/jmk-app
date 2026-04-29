/**
 * JMK · Partner App v2 (host dashboard)
 * ======================================
 * Airbnb-style dashboard για συνεργάτες:
 *   - Σήμερα overview (σημερινές κρατήσεις/παραγγελίες, εισπραχθέντα)
 *   - Δραστηριότητες/Menu (manage activities ή menu items)
 *   - Calendar (block/unblock dates, δες κρατήσεις)
 *   - Παραγγελίες (real-time list, transitions)
 *   - Chat (live με guests)
 *   - Έσοδα (μηνιαίο breakdown, payouts)
 *   - Προφίλ (στοιχεία, KYC status)
 */
(function (root) {
  'use strict';
  const J = root.JV;
  if (!J) { console.error('JV shared utils not loaded'); return; }

  const state = {
    partnerId: null,
    partner: null,
    activeTab: 'today',
    activities: [],
    menuItems: [],
    bookings: [],
    orders: []
  };

  async function mount(containerId, opts = {}) {
    J.injectStyles();
    state.partnerId = opts.partnerId || (new URLSearchParams(location.search).get('p')) || 'p-niko';
    const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return;

    try {
      state.partner = await J.get(`/api/collections/partners/${state.partnerId}`);
    } catch (e) {
      el.innerHTML = `<div class="jv-shell"><div class="jv-empty"><div class="icon">⚠</div>Δεν βρέθηκε partner: ${state.partnerId}</div></div>`;
      return;
    }

    const isFood = state.partner.type === 'restaurant' || state.partner.type === 'delivery' || state.partner.category === 'restaurant' || state.partner.category === 'delivery';
    const tabs = isFood
      ? [['today','Σήμερα'],['menu','Menu'],['orders','Παραγγελίες'],['chat','Συνομιλίες'],['earnings','Έσοδα'],['profile','Προφίλ']]
      : [['today','Σήμερα'],['activities','Δραστηριότητες'],['calendar','Ημερολόγιο'],['bookings','Κρατήσεις'],['chat','Συνομιλίες'],['earnings','Έσοδα'],['profile','Προφίλ']];

    el.innerHTML = `
      <div class="jv-shell">
        <div class="jv-header">
          <h1>${J.escapeHtml(state.partner.businessName || state.partner.name)}</h1>
          <div class="sub">${state.partner.status === 'approved' ? '✓ Εγκεκριμένος συνεργάτης' : '⏳ ' + state.partner.status} · ${J.escapeHtml(state.partner.cuisine || state.partner.category || '')}</div>
          <div class="meta">
            <div>★ ${state.partner.rating || '—'} (${state.partner.reviewCount || 0} κριτικές)</div>
            <div>📍 ${J.escapeHtml(state.partner.islandId || '')}</div>
            <div>💰 ${J.formatEUR(state.partner.totalEarnings || 0)} συνολικά</div>
          </div>
        </div>

        <div class="jv-tabs" id="jp2-tabs">
          ${tabs.map(([id, label]) => `<div class="jv-tab ${id === state.activeTab ? 'active' : ''}" data-tab="${id}">${label}</div>`).join('')}
        </div>

        <div id="jp2-content"></div>
      </div>
    `;

    el.querySelectorAll('.jv-tab').forEach(t => {
      t.addEventListener('click', () => {
        el.querySelectorAll('.jv-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.activeTab = t.getAttribute('data-tab');
        renderTab();
      });
    });

    await loadAllData();
    renderTab();
  }

  async function loadAllData() {
    try {
      const [acts, menu, bookings, orders] = await Promise.all([
        J.get('/api/collections/activities').catch(() => []),
        J.get('/api/collections/menuItems').catch(() => []),
        J.get('/api/collections/bookings').catch(() => []),
        J.get('/api/orders?partnerId=' + state.partnerId).catch(() => [])
      ]);
      state.activities = acts.filter(a => a.partnerId === state.partnerId);
      state.menuItems = menu.filter(m => m.partnerId === state.partnerId);
      state.bookings = bookings.filter(b => b.partnerId === state.partnerId);
      state.orders = Array.isArray(orders) ? orders : [];
    } catch (e) { console.warn(e); }
  }

  function renderTab() {
    const c = document.getElementById('jp2-content');
    if (!c) return;
    c.innerHTML = '<div class="jv-card"><div class="empty"><div class="jv-spinner"></div></div></div>';
    switch (state.activeTab) {
      case 'today':      return renderToday(c);
      case 'activities': return renderActivities(c);
      case 'menu':       return renderMenu(c);
      case 'calendar':   return renderCalendar(c);
      case 'bookings':   return renderBookings(c);
      case 'orders':     return renderOrders(c);
      case 'chat':       return renderChat(c);
      case 'earnings':   return renderEarnings(c);
      case 'profile':    return renderProfile(c);
    }
  }

  // ============================================================
  //                       TODAY
  // ============================================================
  function renderToday(c) {
    const today = new Date().toISOString().slice(0, 10);
    const todayBookings = state.bookings.filter(b => b.date === today);
    const todayOrders = state.orders.filter(o => o.createdAt && o.createdAt.startsWith(today));
    const upcomingBookings = state.bookings.filter(b => b.date > today && b.status !== 'cancelled').slice(0, 5);
    const incomeToday = todayBookings.reduce((s, b) => s + (b.partnerAmount || 0), 0)
                      + todayOrders.reduce((s, o) => s + (o.partnerAmount || 0), 0);

    c.innerHTML = `
      <div class="jv-grid jv-grid-3" style="margin-bottom:16px">
        <div class="jv-stat"><div class="label">Σήμερα</div><div class="value">${todayBookings.length + todayOrders.length}</div><div class="delta">κρατήσεις/παραγγελίες</div></div>
        <div class="jv-stat"><div class="label">Έσοδα ημέρας</div><div class="value">${J.formatEUR(incomeToday)}</div><div class="delta">από JMK πελάτες</div></div>
        <div class="jv-stat"><div class="label">Επόμενες</div><div class="value">${upcomingBookings.length}</div><div class="delta">τις επόμενες μέρες</div></div>
      </div>

      <div class="jv-card">
        <h3>📅 Σήμερα · ${J.formatDate(today)}</h3>
        ${todayBookings.length === 0 && todayOrders.length === 0
          ? '<div class="empty">Καμία κράτηση/παραγγελία σήμερα</div>'
          : todayBookings.map(b => bookingRowHtml(b)).join('') + todayOrders.map(o => orderRowHtml(o)).join('')}
      </div>

      <div class="jv-card">
        <h3>⏭ Επόμενες κρατήσεις</h3>
        ${upcomingBookings.length === 0
          ? '<div class="empty">Καμία επερχόμενη κράτηση</div>'
          : upcomingBookings.map(b => bookingRowHtml(b)).join('')}
      </div>
    `;
    wireRowClicks(c);
  }

  function bookingRowHtml(b) {
    const act = state.activities.find(a => a.id === b.activityId) || {};
    const statusPill = stateClass(b.status);
    return `
      <div class="jv-row" data-booking="${b.id}">
        <div class="avatar">${act.coverIcon || '🎯'}</div>
        <div class="info">
          <h4>${J.escapeHtml(act.title || b.activityId)}</h4>
          <p>${J.escapeHtml(b.date)} ${J.escapeHtml(b.time)} · ${b.people} άτομα · <span class="jv-pill ${statusPill}">${b.status}</span></p>
        </div>
        <div class="price">${J.formatEUR(b.partnerAmount || 0)}</div>
      </div>
    `;
  }

  function orderRowHtml(o) {
    const isDeliv = o.type === 'delivery';
    return `
      <div class="jv-row" data-order="${o.id}">
        <div class="avatar">${isDeliv ? '🛵' : '🍽'}</div>
        <div class="info">
          <h4>${o.items.length} είδη · ${o.type === 'delivery' ? 'Delivery' : 'Εστιατόριο'}</h4>
          <p>${J.timeAgo(o.createdAt)} · <span class="jv-pill ${stateClass(o.status)}">${o.status}</span></p>
        </div>
        <div class="price">${J.formatEUR(o.partnerAmount || 0)}</div>
      </div>
    `;
  }

  function stateClass(s) {
    if (['paid','deposit_paid','confirmed','delivered','reviewed','completed'].includes(s)) return 'green';
    if (['chat','agreed','placed','preparing','ready'].includes(s)) return 'yellow';
    if (['cancelled','disputed'].includes(s)) return 'red';
    return 'gray';
  }

  function wireRowClicks(c) {
    c.querySelectorAll('[data-booking]').forEach(n => n.addEventListener('click', () => openBooking(n.getAttribute('data-booking'))));
    c.querySelectorAll('[data-order]').forEach(n => n.addEventListener('click', () => openOrder(n.getAttribute('data-order'))));
  }

  // ============================================================
  //                    ACTIVITIES
  // ============================================================
  function renderActivities(c) {
    if (state.activities.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty">Δεν έχεις προσθέσει δραστηριότητες ακόμα. <button class="jv-btn primary small" id="jp2-add-act" style="margin-top:10px">+ Νέα δραστηριότητα</button></div></div>';
      document.getElementById('jp2-add-act')?.addEventListener('click', () => J.toast('Add activity wizard — επόμενη φάση', 'info'));
      return;
    }
    c.innerHTML = '<div id="jp2-acts-list"></div><div style="margin-top:12px"><button class="jv-btn primary" id="jp2-add-act">+ Νέα δραστηριότητα</button></div>';
    const list = document.getElementById('jp2-acts-list');
    list.innerHTML = state.activities.map(a => `
      <div class="jv-card" data-act="${a.id}" style="cursor:pointer">
        <div style="display:flex;gap:14px;align-items:center">
          <div style="width:80px;height:80px;border-radius:10px;overflow:hidden;background:#F1F5F9;flex:none">
            ${a.photos && a.photos[0] ? `<img src="${a.photos[0].thumbUrl || a.photos[0].url}" style="width:100%;height:100%;object-fit:cover">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:36px">${a.coverIcon || '✨'}</div>`}
          </div>
          <div style="flex:1;min-width:0">
            <h3 style="margin:0 0 4px;font-size:15px;font-weight:700">${J.escapeHtml(a.title)}</h3>
            <p style="margin:0;font-size:12px;color:#64748B">${J.escapeHtml(J.truncate(a.description, 80))}</p>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              <span class="jv-pill ${a.status === 'active' ? 'green' : 'gray'}">${a.status}</span>
              <span class="jv-pill blue">★ ${a.rating || '—'} (${a.reviewCount || 0})</span>
              <span class="jv-pill gold">${a.photos?.length || 0} φωτο</span>
              <span class="jv-pill purple">${J.formatEUR(a.price)} βάση</span>
            </div>
          </div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-act]').forEach(n => n.addEventListener('click', () => openActivityEditor(n.getAttribute('data-act'))));
    document.getElementById('jp2-add-act')?.addEventListener('click', () => J.toast('Add activity wizard — επόμενη φάση', 'info'));
  }

  async function openActivityEditor(activityId) {
    const a = state.activities.find(x => x.id === activityId);
    if (!a) return;
    const body = `
      <label class="jv-label">Τίτλος</label>
      <input class="jv-input" id="ja-title" value="${J.escapeHtml(a.title)}">
      <label class="jv-label">Περιγραφή</label>
      <textarea class="jv-input jv-textarea" id="ja-desc">${J.escapeHtml(a.description || '')}</textarea>
      <label class="jv-label">Τιμή ανά άτομο (€)</label>
      <input class="jv-input" id="ja-price" type="number" value="${a.price}">
      <label class="jv-label">Φωτογραφίες</label>
      <div id="ja-photos"></div>
    `;
    J.showModal({
      title: 'Επεξεργασία: ' + (a.title),
      body,
      footer: `<button class="jv-btn outline" id="ja-cancel">Ακύρωση</button><button class="jv-btn primary" id="ja-save">Αποθήκευση</button>`
    });
    renderPhotoGrid('ja-photos', activityId);
    document.getElementById('ja-cancel').addEventListener('click', J.closeModal);
    document.getElementById('ja-save').addEventListener('click', async () => {
      try {
        await J.patch(`/api/activities/${activityId}/details`, {
          title: document.getElementById('ja-title').value,
          description: document.getElementById('ja-desc').value
        });
        await J.patch(`/api/activities/${activityId}/pricing`, {
          base: Number(document.getElementById('ja-price').value)
        });
        J.toast('Αποθηκεύτηκε', 'success');
        await loadAllData();
        J.closeModal();
        renderTab();
      } catch (e) { J.toast(e.message, 'error'); }
    });
  }

  // Reusable photo grid με drag-drop upload
  async function renderPhotoGrid(elId, activityId) {
    const el = document.getElementById(elId);
    if (!el) return;
    async function refresh() {
      const a = await J.get(`/api/collections/activities/${activityId}`);
      const photos = a.photos || [];
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;margin-bottom:8px">
          ${photos.map(p => `
            <div style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden" data-pid="${p.id}">
              <img src="${p.thumbUrl || p.url}" style="width:100%;height:100%;object-fit:cover">
              ${p.isCover ? '<span style="position:absolute;top:3px;left:3px;background:#0F4C5C;color:#fff;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:700">COVER</span>' : ''}
              <span style="position:absolute;top:3px;right:3px;width:18px;height:18px;background:rgba(0,0,0,.7);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;cursor:pointer" data-del="${p.id}">×</span>
            </div>
          `).join('')}
          <div id="jp-add" style="aspect-ratio:1;border:2px dashed #CBD5E1;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:24px;color:#94A3B8;background:#F8FAFC">+</div>
        </div>
      `;
      const fi = document.createElement('input');
      fi.type = 'file'; fi.multiple = true; fi.accept = 'image/*'; fi.style.display = 'none';
      el.appendChild(fi);
      const addBtn = document.getElementById('jp-add');
      addBtn.addEventListener('click', () => fi.click());
      ['dragover', 'dragenter'].forEach(ev => addBtn.addEventListener(ev, e => { e.preventDefault(); addBtn.style.background = '#E7F4F4'; }));
      ['dragleave', 'drop'].forEach(ev => addBtn.addEventListener(ev, e => { e.preventDefault(); addBtn.style.background = '#F8FAFC'; }));
      addBtn.addEventListener('drop', e => upload(e.dataTransfer.files));
      fi.addEventListener('change', () => upload(fi.files));
      async function upload(files) {
        if (!files || files.length === 0) return;
        addBtn.innerHTML = '<div class="jv-spinner"></div>';
        try {
          const fd = new FormData();
          fd.append('activityId', activityId);
          for (const f of files) fd.append('files', f);
          await J.post('/api/uploads', fd);
          await refresh();
        } catch (err) { J.toast(err.message, 'error'); addBtn.textContent = '+'; }
      }
      el.querySelectorAll('[data-del]').forEach(x => {
        x.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!await J.confirmDialog('Διαγραφή φωτογραφίας;')) return;
          try { await J.del(`/api/uploads/${encodeURIComponent(x.getAttribute('data-del'))}?activityId=${activityId}`); await refresh(); }
          catch (err) { J.toast(err.message, 'error'); }
        });
      });
    }
    await refresh();
  }

  // ============================================================
  //                       MENU (restaurants/delivery)
  // ============================================================
  function renderMenu(c) {
    if (state.menuItems.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty">Δεν έχεις menu items ακόμα.<br><button class="jv-btn primary small" id="jp2-add-mi" style="margin-top:10px">+ Νέο πιάτο</button></div></div>';
    } else {
      const cats = [...new Set(state.menuItems.map(i => i.category))];
      c.innerHTML = '<div style="margin-bottom:12px"><button class="jv-btn primary" id="jp2-add-mi">+ Νέο πιάτο</button></div>' +
        cats.map(cat => `
          <div class="jv-card">
            <h3>${J.escapeHtml(cat)}</h3>
            ${state.menuItems.filter(i => i.category === cat).map(i => `
              <div class="jv-row" data-mi="${i.id}" style="cursor:pointer">
                <div style="width:50px;height:50px;border-radius:8px;overflow:hidden;background:#F1F5F9;flex:none">
                  ${i.photo ? `<img src="${i.photo}" style="width:100%;height:100%;object-fit:cover">` : ''}
                </div>
                <div class="info">
                  <h4>${J.escapeHtml(i.name)}</h4>
                  <p>${J.escapeHtml(J.truncate(i.description || '', 60))}</p>
                </div>
                <div class="price">${J.formatEUR(i.price)}</div>
                <span class="jv-pill ${i.available !== false ? 'green' : 'red'}">${i.available !== false ? 'Διαθέσιμο' : 'Μη διαθέσιμο'}</span>
              </div>
            `).join('')}
          </div>
        `).join('');
    }
    document.getElementById('jp2-add-mi')?.addEventListener('click', openNewMenuItem);
    c.querySelectorAll('[data-mi]').forEach(n => n.addEventListener('click', () => openMenuItemEditor(n.getAttribute('data-mi'))));
  }

  function openNewMenuItem() {
    const body = `
      <label class="jv-label">Όνομα πιάτου</label><input class="jv-input" id="mi-name">
      <label class="jv-label">Περιγραφή</label><textarea class="jv-input jv-textarea" id="mi-desc"></textarea>
      <label class="jv-label">Κατηγορία</label>
      <select class="jv-input" id="mi-cat">
        <option value="starter">Ορεκτικά</option><option value="salad">Σαλάτες</option><option value="main">Κυρίως</option>
        <option value="dessert">Επιδόρπια</option><option value="drink">Ποτά</option>
        <option value="gyros">Γύροι</option><option value="pizza">Pizza</option><option value="burger">Burger</option>
        <option value="pasta">Ζυμαρικά</option><option value="side">Συνοδευτικά</option>
      </select>
      <label class="jv-label">Τιμή (€)</label><input class="jv-input" id="mi-price" type="number" step="0.10" value="0">
      <label class="jv-label">URL φωτογραφίας (optional)</label><input class="jv-input" id="mi-photo" placeholder="https://...">
    `;
    J.showModal({
      title: 'Νέο πιάτο',
      body,
      footer: `<button class="jv-btn outline" id="mi-cancel">Ακύρωση</button><button class="jv-btn primary" id="mi-save">Δημιουργία</button>`
    });
    document.getElementById('mi-cancel').addEventListener('click', J.closeModal);
    document.getElementById('mi-save').addEventListener('click', async () => {
      try {
        await J.post(`/api/partners/${state.partnerId}/menu`, {
          name: document.getElementById('mi-name').value,
          description: document.getElementById('mi-desc').value,
          category: document.getElementById('mi-cat').value,
          price: Number(document.getElementById('mi-price').value),
          photo: document.getElementById('mi-photo').value || null,
          available: true
        });
        J.toast('Προστέθηκε', 'success');
        await loadAllData();
        J.closeModal();
        renderTab();
      } catch (e) { J.toast(e.message, 'error'); }
    });
  }

  function openMenuItemEditor(itemId) {
    const i = state.menuItems.find(x => x.id === itemId);
    if (!i) return;
    const body = `
      <label class="jv-label">Όνομα</label><input class="jv-input" id="mi-name" value="${J.escapeHtml(i.name)}">
      <label class="jv-label">Περιγραφή</label><textarea class="jv-input jv-textarea" id="mi-desc">${J.escapeHtml(i.description || '')}</textarea>
      <label class="jv-label">Τιμή (€)</label><input class="jv-input" id="mi-price" type="number" step="0.10" value="${i.price}">
      <label class="jv-label">Διαθέσιμο</label>
      <select class="jv-input" id="mi-avail"><option value="true" ${i.available !== false ? 'selected' : ''}>Ναι</option><option value="false" ${i.available === false ? 'selected' : ''}>Όχι (sold out)</option></select>
    `;
    J.showModal({
      title: 'Επεξεργασία: ' + i.name,
      body,
      footer: `<button class="jv-btn danger" id="mi-del" style="margin-right:auto">Διαγραφή</button><button class="jv-btn outline" id="mi-cancel">Ακύρωση</button><button class="jv-btn primary" id="mi-save">Αποθήκευση</button>`
    });
    document.getElementById('mi-cancel').addEventListener('click', J.closeModal);
    document.getElementById('mi-save').addEventListener('click', async () => {
      try {
        await J.patch(`/api/menu-items/${itemId}`, {
          name: document.getElementById('mi-name').value,
          description: document.getElementById('mi-desc').value,
          price: Number(document.getElementById('mi-price').value),
          available: document.getElementById('mi-avail').value === 'true'
        });
        J.toast('Αποθηκεύτηκε', 'success');
        await loadAllData();
        J.closeModal();
        renderTab();
      } catch (e) { J.toast(e.message, 'error'); }
    });
    document.getElementById('mi-del').addEventListener('click', async () => {
      if (!await J.confirmDialog('Διαγραφή πιάτου;')) return;
      try {
        await J.del(`/api/menu-items/${itemId}`);
        J.toast('Διαγράφηκε', 'success');
        await loadAllData();
        J.closeModal();
        renderTab();
      } catch (e) { J.toast(e.message, 'error'); }
    });
  }

  // ============================================================
  //                       CALENDAR
  // ============================================================
  async function renderCalendar(c) {
    if (state.activities.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty">Πρόσθεσε δραστηριότητες πρώτα</div></div>';
      return;
    }
    c.innerHTML = `
      <div class="jv-card">
        <h3>📅 Διαθεσιμότητα</h3>
        <label class="jv-label">Δραστηριότητα</label>
        <select class="jv-input" id="jp2-cal-act" style="margin-bottom:12px">
          ${state.activities.map(a => `<option value="${a.id}">${J.escapeHtml(a.title)}</option>`).join('')}
        </select>
        <p style="font-size:12px;color:#64748B;margin:0 0 8px">Πάτα μέρα για να την κλείσεις/ξανανοίξεις. Πράσινο = ανοιχτή · Κόκκινο = κλειστή.</p>
        <div id="jp2-cal-grid"></div>
      </div>
    `;
    document.getElementById('jp2-cal-act').addEventListener('change', () => loadCalendar());
    loadCalendar();
  }

  async function loadCalendar() {
    const actId = document.getElementById('jp2-cal-act').value;
    const grid = document.getElementById('jp2-cal-grid');
    grid.innerHTML = '<div style="text-align:center;padding:20px"><div class="jv-spinner"></div></div>';
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    try {
      const cal = await J.get(`/api/activities/${actId}/availability?from=${today}&to=${horizon}`);
      const headers = ['Δ','Τ','Τ','Π','Π','Σ','Κ'];
      let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
      headers.forEach(h => html += `<div style="text-align:center;font-size:11px;color:#64748B;font-weight:700;padding:4px">${h}</div>`);
      const firstDay = new Date(cal.days[0].date);
      const firstDow = (firstDay.getDay() + 6) % 7;
      for (let i = 0; i < firstDow; i++) html += '<div></div>';
      for (const day of cal.days) {
        const d = new Date(day.date);
        const isOpen = day.isOpen;
        const blocked = day.reason === 'blocked';
        const past = day.reason === 'past';
        const cap = day.slots.reduce((s, x) => s + (x.available || 0), 0);
        const bg = past ? '#F1F5F9' : isOpen ? '#DCFCE7' : blocked ? '#FEE2E2' : '#F1F5F9';
        const color = past ? '#94A3B8' : isOpen ? '#166534' : blocked ? '#991B1B' : '#94A3B8';
        const cursor = past ? 'not-allowed' : 'pointer';
        html += `<div data-date="${day.date}" data-open="${isOpen}" style="aspect-ratio:1;background:${bg};color:${color};border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:${cursor};font-size:12px;font-weight:700">${d.getDate()}<span style="font-size:9px;font-weight:500;opacity:.7">${isOpen ? cap + ' θέσ.' : ''}</span></div>`;
      }
      html += '</div>';
      grid.innerHTML = html;
      grid.querySelectorAll('[data-date]').forEach(node => {
        node.addEventListener('click', async () => {
          const date = node.getAttribute('data-date');
          const wasOpen = node.getAttribute('data-open') === 'true';
          if (node.style.cursor === 'not-allowed') return;
          try {
            if (wasOpen) {
              await J.post(`/api/activities/${actId}/block-dates`, { dates: [date] });
              node.style.background = '#FEE2E2';
              node.style.color = '#991B1B';
              node.setAttribute('data-open', 'false');
              J.toast(`${date} κλείστηκε`, 'success', 1500);
            } else {
              await J.post(`/api/activities/${actId}/unblock-dates`, { dates: [date] });
              node.style.background = '#DCFCE7';
              node.style.color = '#166534';
              node.setAttribute('data-open', 'true');
              J.toast(`${date} άνοιξε`, 'success', 1500);
            }
          } catch (e) { J.toast(e.message, 'error'); }
        });
      });
    } catch (e) { grid.innerHTML = `<div class="empty" style="color:#DC2626">${e.message}</div>`; }
  }

  // ============================================================
  //                       BOOKINGS
  // ============================================================
  function renderBookings(c) {
    const sorted = state.bookings.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (sorted.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty">Δεν έχεις κρατήσεις ακόμα</div></div>';
      return;
    }
    c.innerHTML = '<div class="jv-card">' + sorted.map(b => bookingRowHtml(b)).join('') + '</div>';
    wireRowClicks(c);
  }

  async function openBooking(bookingId) {
    const b = state.bookings.find(x => x.id === bookingId);
    if (!b) return;
    const act = state.activities.find(a => a.id === b.activityId);
    const body = `
      <div class="jv-row">
        <div class="avatar">${act?.coverIcon || '🎯'}</div>
        <div class="info"><h4>${J.escapeHtml(act?.title || '')}</h4><p>${b.date} ${b.time} · ${b.people} άτομα</p></div>
      </div>
      <div style="margin-top:12px"><span class="jv-pill ${stateClass(b.status)}">${b.status}</span></div>
      <div style="margin-top:12px;font-size:13px">
        <div>Σύνολο: <b>${J.formatEUR(b.totalAmount)}</b></div>
        <div>Δικό σου: <b>${J.formatEUR(b.partnerAmount)}</b></div>
        ${b.deposit?.status ? `<div>Deposit: ${b.deposit.status === 'paid' ? '✓ Καταβλήθηκε' : '⏳ Pending'} (${J.formatEUR(b.deposit.amount)})</div>` : ''}
      </div>
      <div id="jp2-book-actions" style="margin-top:14px"></div>
      <hr style="margin:14px 0;border:0;border-top:1px solid #F1F5F9">
      <h4 style="font-size:14px;margin:0 0 8px">💬 Συνομιλία</h4>
      <div id="jp2-book-chat" style="max-height:200px;overflow-y:auto;background:#F8FAFC;border-radius:8px;padding:8px;font-size:12px"></div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <input class="jv-input" id="jp2-msg-input" placeholder="Γράψε μήνυμα στον πελάτη...">
        <button class="jv-btn primary" id="jp2-msg-send">Στείλε</button>
      </div>
    `;
    J.showModal({ title: 'Κράτηση #' + b.id, body });

    // Load chat history
    const chatEl = document.getElementById('jp2-book-chat');
    try {
      const msgs = await J.get(`/api/bookings/${bookingId}/messages`);
      chatEl.innerHTML = msgs.map(m => `
        <div style="margin:4px 0;padding:6px 10px;border-radius:8px;background:${m.fromRole === 'partner' ? '#0F4C5C' : '#fff'};color:${m.fromRole === 'partner' ? '#fff' : '#0F172A'};max-width:80%;${m.fromRole === 'partner' ? 'margin-left:auto' : ''}">
          <div style="font-size:9px;opacity:.7">${J.escapeHtml(m.fromName)} · ${J.timeAgo(m.createdAt)}</div>
          ${J.escapeHtml(m.text)}
        </div>
      `).join('') || '<div style="text-align:center;color:#94A3B8;padding:20px">Δεν υπάρχουν μηνύματα ακόμα</div>';
      chatEl.scrollTop = chatEl.scrollHeight;
    } catch {}

    document.getElementById('jp2-msg-send').addEventListener('click', async () => {
      const input = document.getElementById('jp2-msg-input');
      const text = input.value.trim();
      if (!text) return;
      try {
        const r = await J.post(`/api/bookings/${bookingId}/messages`, { text, fromId: state.partnerId, fromName: state.partner.name, fromRole: 'partner' });
        if (r.message?.flagged) J.toast('⚠ Το μήνυμα φιλτραρίστηκε από το anti-bypass', 'error', 4000);
        input.value = '';
        // Re-render chat
        const msgs = await J.get(`/api/bookings/${bookingId}/messages`);
        chatEl.innerHTML = msgs.map(m => `
          <div style="margin:4px 0;padding:6px 10px;border-radius:8px;background:${m.fromRole === 'partner' ? '#0F4C5C' : '#fff'};color:${m.fromRole === 'partner' ? '#fff' : '#0F172A'};max-width:80%;${m.fromRole === 'partner' ? 'margin-left:auto' : ''}">
            <div style="font-size:9px;opacity:.7">${J.escapeHtml(m.fromName)} · ${J.timeAgo(m.createdAt)}</div>
            ${J.escapeHtml(m.text)}
          </div>
        `).join('');
        chatEl.scrollTop = chatEl.scrollHeight;
      } catch (e) { J.toast(e.message, 'error'); }
    });

    // State transition buttons
    const actEl = document.getElementById('jp2-book-actions');
    const transitions = { chat: 'agreed', agreed: 'paid', deposit_paid: 'completed', paid: 'completed', completed: 'reviewed' };
    const next = transitions[b.status];
    actEl.innerHTML = (next ? `<button class="jv-btn primary small" data-act="next">→ ${next}</button>` : '') +
                      (b.status !== 'cancelled' && b.status !== 'completed' ? ' <button class="jv-btn danger small" data-act="cancel">Ακύρωση</button>' : '');
    actEl.querySelector('[data-act="next"]')?.addEventListener('click', async () => {
      try { await J.post(`/api/bookings/${bookingId}/transition`, { to: next }); J.toast('✓ Νέο status: ' + next, 'success'); J.closeModal(); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    });
    actEl.querySelector('[data-act="cancel"]')?.addEventListener('click', async () => {
      if (!await J.confirmDialog('Ακύρωση κράτησης;')) return;
      try { await J.post(`/api/bookings/${bookingId}/transition`, { to: 'cancelled' }); J.toast('Ακυρώθηκε', 'success'); J.closeModal(); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    });
  }

  // ============================================================
  //                       ORDERS (restaurant/delivery)
  // ============================================================
  function renderOrders(c) {
    const sorted = state.orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (sorted.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty">Δεν υπάρχουν παραγγελίες</div></div>';
      return;
    }
    c.innerHTML = '<div class="jv-card">' + sorted.map(o => orderRowHtml(o)).join('') + '</div>';
    wireRowClicks(c);
  }

  function openOrder(orderId) {
    const o = state.orders.find(x => x.id === orderId);
    if (!o) return;
    const next = { placed: 'confirmed', confirmed: 'preparing', preparing: 'ready', ready: 'delivered' }[o.status];
    const body = `
      <div><span class="jv-pill ${stateClass(o.status)}">${o.status}</span> · ${o.type === 'delivery' ? '🛵 Delivery' : '🍽 Εστιατόριο'}</div>
      <h4 style="margin:12px 0 6px;font-size:14px">Είδη</h4>
      ${o.items.map(it => `<div class="jv-row"><div class="info"><h4>${it.qty}× ${J.escapeHtml(it.name)}</h4>${it.notes ? `<p>${J.escapeHtml(it.notes)}</p>` : ''}</div><div class="price">${J.formatEUR(it.lineTotal)}</div></div>`).join('')}
      <hr style="margin:12px 0;border:0;border-top:1px solid #F1F5F9">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0"><span>Subtotal:</span><b>${J.formatEUR(o.subtotal)}</b></div>
      ${o.deliveryFee ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0"><span>Delivery:</span><b>${J.formatEUR(o.deliveryFee)}</b></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:14px;margin:8px 0;font-weight:800;color:#0F4C5C"><span>Σύνολο:</span><span>${J.formatEUR(o.totalAmount)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0;color:#16A34A"><span>Δικό σου:</span><b>${J.formatEUR(o.partnerAmount)}</b></div>
      <div style="margin-top:8px;font-size:11px;color:#64748B">${o.deliveryAddress ? '📍 ' + J.escapeHtml(o.deliveryAddress) : ''}${o.instructions ? '<br>📝 ' + J.escapeHtml(o.instructions) : ''}</div>
      <div style="margin-top:14px">
        ${next ? `<button class="jv-btn primary" id="jo-next">→ ${next}</button>` : '<span class="jv-pill green">Ολοκληρωμένη</span>'}
        ${o.status !== 'cancelled' && o.status !== 'delivered' && o.status !== 'reviewed' ? '<button class="jv-btn danger small" id="jo-cancel" style="margin-left:6px">Ακύρωση</button>' : ''}
      </div>
    `;
    J.showModal({ title: 'Παραγγελία #' + o.id, body });
    document.getElementById('jo-next')?.addEventListener('click', async () => {
      try { await J.post(`/api/orders/${o.id}/transition`, { to: next }); J.toast('✓ ' + next, 'success'); J.closeModal(); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    });
    document.getElementById('jo-cancel')?.addEventListener('click', async () => {
      if (!await J.confirmDialog('Ακύρωση παραγγελίας;')) return;
      try { await J.post(`/api/orders/${o.id}/transition`, { to: 'cancelled' }); J.toast('Ακυρώθηκε', 'success'); J.closeModal(); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    });
  }

  // ============================================================
  //                        CHAT (όλα τα bookings)
  // ============================================================
  function renderChat(c) {
    const active = state.bookings.filter(b => b.status !== 'cancelled' && b.status !== 'reviewed');
    if (active.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty">Δεν υπάρχουν ενεργές συνομιλίες</div></div>';
      return;
    }
    c.innerHTML = '<div class="jv-card"><h3>💬 Ενεργές συνομιλίες</h3>' +
      active.map(b => {
        const act = state.activities.find(a => a.id === b.activityId);
        return `<div class="jv-row" data-booking="${b.id}" style="cursor:pointer"><div class="avatar">${act?.coverIcon || '🎯'}</div><div class="info"><h4>${J.escapeHtml(act?.title || '')}</h4><p>${b.date} · <span class="jv-pill ${stateClass(b.status)}">${b.status}</span></p></div><div style="font-size:18px">›</div></div>`;
      }).join('') + '</div>';
    wireRowClicks(c);
  }

  // ============================================================
  //                       EARNINGS
  // ============================================================
  function renderEarnings(c) {
    const allBookings = state.bookings.filter(b => ['paid','deposit_paid','completed','reviewed'].includes(b.status));
    const allOrders = state.orders.filter(o => ['confirmed','preparing','ready','delivered','reviewed'].includes(o.status));
    const total = allBookings.reduce((s, b) => s + (b.partnerAmount || 0), 0)
                + allOrders.reduce((s, o) => s + (o.partnerAmount || 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    const monthIncome = allBookings.filter(b => (b.paidAt || '').startsWith(month)).reduce((s, b) => s + (b.partnerAmount || 0), 0)
                      + allOrders.filter(o => (o.paidAt || '').startsWith(month)).reduce((s, o) => s + (o.partnerAmount || 0), 0);

    c.innerHTML = `
      <div class="jv-grid jv-grid-2" style="margin-bottom:16px">
        <div class="jv-stat"><div class="label">Σύνολο εισπράξεων</div><div class="value">${J.formatEUR(total)}</div><div class="delta">όλες οι περίοδοι</div></div>
        <div class="jv-stat"><div class="label">Αυτόν τον μήνα</div><div class="value">${J.formatEUR(monthIncome)}</div><div class="delta">${month}</div></div>
      </div>
      <div class="jv-card">
        <h3>💰 Πληρωμές</h3>
        ${allBookings.concat(allOrders).slice(-10).reverse().map(item => {
          const isOrder = !!item.items;
          return `<div class="jv-row"><div class="avatar">${isOrder ? '🛵' : '🎯'}</div><div class="info"><h4>${isOrder ? item.items.length + ' είδη' : (state.activities.find(a => a.id === item.activityId)?.title || item.activityId)}</h4><p>${J.formatDate(item.paidAt || item.createdAt)} · ${item.status}</p></div><div class="price">${J.formatEUR(item.partnerAmount || 0)}</div></div>`;
        }).join('')}
      </div>
      <div class="jv-card">
        <h3>📅 Επόμενο payout</h3>
        <div style="padding:14px;background:#FEF3C7;border-radius:10px;font-size:13px;color:#92400E">
          Τα έσοδα συγκεντρώνονται στις 1η και 15η του μήνα. Επόμενο payout υπολογιστικά: ${getNextPayoutDate()}
        </div>
      </div>
    `;
  }

  function getNextPayoutDate() {
    const d = new Date();
    if (d.getDate() < 15) d.setDate(15);
    else { d.setMonth(d.getMonth() + 1); d.setDate(1); }
    return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ============================================================
  //                      PROFILE
  // ============================================================
  function renderProfile(c) {
    const p = state.partner;
    c.innerHTML = `
      <div class="jv-card">
        <h3>👤 Στοιχεία</h3>
        <div style="font-size:13px;line-height:2">
          <div><b>Όνομα:</b> ${J.escapeHtml(p.name)}</div>
          <div><b>Επωνυμία:</b> ${J.escapeHtml(p.businessName || '—')}</div>
          <div><b>Email:</b> ${J.escapeHtml(p.email)}</div>
          <div><b>Τηλέφωνο:</b> ${J.escapeHtml(p.phone)}</div>
          <div><b>ΑΦΜ:</b> ${J.escapeHtml(p.vat || '—')}</div>
          <div><b>IBAN:</b> ${J.escapeHtml(p.iban || '—')}</div>
          <div><b>Νησί:</b> ${J.escapeHtml(p.islandId)}</div>
          <div><b>Status:</b> <span class="jv-pill ${p.status === 'approved' ? 'green' : 'yellow'}">${p.status}</span></div>
          ${p.warnings ? `<div><b>Προειδοποιήσεις:</b> <span class="jv-pill yellow">${p.warnings}</span></div>` : ''}
        </div>
      </div>
    `;
  }

  root.JMKPartnerV2 = { mount, state };
  console.log('[JMKPartnerV2] loaded');
})(typeof window !== 'undefined' ? window : globalThis);
