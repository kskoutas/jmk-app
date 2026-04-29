/**
 * JMK · Admin App v2
 * ===================
 * Moderation + stats dashboard:
 *   - Stats (live platform numbers: bookings/day, MRR, partners, hotels)
 *   - Moderation (flagged messages με 1-click warn/suspend)
 *   - Risk dashboard (partners με υψηλό cumulative risk)
 *   - Pending approvals (νέοι partners/hotels)
 *   - Hotels (overview + commissions)
 *   - Settings (commission %, thresholds)
 */
(function (root) {
  'use strict';
  const J = root.JV;
  if (!J) { console.error('JV not loaded'); return; }

  const state = {
    activeTab: 'stats',
    flagged: [],
    partners: [],
    hotels: [],
    bookings: [],
    orders: [],
    activities: [],
    risk: []
  };

  async function mount(containerId, opts = {}) {
    J.injectStyles();
    const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return;

    // Save admin key από URL ή ζήτα
    const params = new URLSearchParams(location.search);
    if (params.get('key')) localStorage.setItem('jmk_admin_key', params.get('key'));

    const tabs = [['stats','📊 Stats'],['moderation','🚨 Moderation'],['risk','⚠ Risk'],['approvals','✅ Approvals'],['hotels','🏨 Hotels'],['partners','🤝 Partners'],['settings','⚙ Settings']];

    el.innerHTML = `
      <div class="jv-shell">
        <div class="jv-header">
          <h1>JMK Admin</h1>
          <div class="sub">Moderation + Analytics dashboard</div>
          <div class="meta"><div>🔑 ${(localStorage.getItem('jmk_admin_key') || 'dev-admin-key').slice(0, 8)}...</div></div>
        </div>
        <div class="jv-tabs">
          ${tabs.map(([id, label]) => `<div class="jv-tab ${id === state.activeTab ? 'active' : ''}" data-tab="${id}">${label}</div>`).join('')}
        </div>
        <div id="ja2-content"></div>
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
    const [partners, hotels, bookings, orders, activities, flagged, risk] = await Promise.all([
      J.get('/api/collections/partners').catch(() => []),
      J.get('/api/collections/hotels').catch(() => []),
      J.get('/api/collections/bookings').catch(() => []),
      J.get('/api/orders').catch(() => []),
      J.get('/api/collections/activities').catch(() => []),
      J.get('/api/admin/flagged?status=open', { admin: true }).catch(() => ({ items: [] })),
      J.get('/api/admin/partners/risk', { admin: true }).catch(() => [])
    ]);
    state.partners = partners;
    state.hotels = hotels;
    state.bookings = bookings;
    state.orders = Array.isArray(orders) ? orders : [];
    state.activities = activities;
    state.flagged = (flagged && flagged.items) || [];
    state.risk = Array.isArray(risk) ? risk : [];
  }

  function renderTab() {
    const c = document.getElementById('ja2-content');
    if (!c) return;
    c.innerHTML = '<div class="jv-card"><div class="empty"><div class="jv-spinner"></div></div></div>';
    switch (state.activeTab) {
      case 'stats':      return renderStats(c);
      case 'moderation': return renderModeration(c);
      case 'risk':       return renderRisk(c);
      case 'approvals':  return renderApprovals(c);
      case 'hotels':     return renderHotels(c);
      case 'partners':   return renderPartners(c);
      case 'settings':   return renderSettings(c);
    }
  }

  // ============================================================
  //                       STATS
  // ============================================================
  function renderStats(c) {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const todayB = state.bookings.filter(b => (b.createdAt || '').startsWith(today));
    const monthB = state.bookings.filter(b => (b.createdAt || '').startsWith(month));
    const monthRevenue = monthB.reduce((s, b) => s + (b.jmkCommission || 0), 0)
                       + state.orders.filter(o => (o.paidAt || '').startsWith(month)).reduce((s, o) => s + (o.jmkCommission || 0), 0);
    const totalRevenue = state.bookings.reduce((s, b) => s + (b.jmkCommission || 0), 0)
                       + state.orders.reduce((s, o) => s + (o.jmkCommission || 0), 0);

    const activePartners = state.partners.filter(p => p.status === 'approved').length;
    const pendingPartners = state.partners.filter(p => p.status === 'pending').length;
    const suspended = state.partners.filter(p => p.status === 'paused').length;

    c.innerHTML = `
      <div class="jv-grid jv-grid-4" style="margin-bottom:16px">
        <div class="jv-stat"><div class="label">JMK Revenue (μήνας)</div><div class="value">${J.formatEUR(monthRevenue)}</div><div class="delta">${month}</div></div>
        <div class="jv-stat"><div class="label">JMK Revenue (σύνολο)</div><div class="value">${J.formatEUR(totalRevenue)}</div><div class="delta">όλη η περίοδος</div></div>
        <div class="jv-stat"><div class="label">Bookings σήμερα</div><div class="value">${todayB.length}</div><div class="delta">${monthB.length} μήνας</div></div>
        <div class="jv-stat"><div class="label">Open flags</div><div class="value" style="color:${state.flagged.length > 0 ? '#DC2626' : '#16A34A'}">${state.flagged.length}</div><div class="delta">προς review</div></div>
      </div>

      <div class="jv-grid jv-grid-3" style="margin-bottom:16px">
        <div class="jv-stat"><div class="label">Active partners</div><div class="value">${activePartners}</div><div class="delta">${state.partners.length} συνολικά</div></div>
        <div class="jv-stat"><div class="label">Pending approvals</div><div class="value" style="color:${pendingPartners > 0 ? '#F59E0B' : '#94A3B8'}">${pendingPartners}</div><div class="delta">περιμένουν</div></div>
        <div class="jv-stat"><div class="label">Suspended</div><div class="value" style="color:${suspended > 0 ? '#DC2626' : '#94A3B8'}">${suspended}</div><div class="delta">από moderation</div></div>
      </div>

      <div class="jv-grid jv-grid-2">
        <div class="jv-stat"><div class="label">Hotels</div><div class="value">${state.hotels.filter(h => h.status === 'active').length}</div><div class="delta">${state.hotels.length} σύνολο</div></div>
        <div class="jv-stat"><div class="label">Activities</div><div class="value">${state.activities.filter(a => a.status === 'active').length}</div><div class="delta">${state.activities.length} σύνολο</div></div>
      </div>

      <div class="jv-card" style="margin-top:16px">
        <h3>📈 Πρόσφατες κρατήσεις</h3>
        ${state.bookings.slice(-10).reverse().map(b => {
          const act = state.activities.find(a => a.id === b.activityId);
          const partner = state.partners.find(p => p.id === b.partnerId);
          return `<div class="jv-row">
            <div class="avatar">${act?.coverIcon || '🎯'}</div>
            <div class="info"><h4>${J.escapeHtml(act?.title || b.activityId)}</h4><p>${J.escapeHtml(partner?.name || '')} · ${b.date} · <span class="jv-pill ${stateClass(b.status)}">${b.status}</span></p></div>
            <div class="price">+${J.formatEUR(b.jmkCommission || 0)}</div>
          </div>`;
        }).join('') || '<div class="empty">Δεν υπάρχουν κρατήσεις</div>'}
      </div>
    `;
  }

  function stateClass(s) {
    if (['paid','deposit_paid','confirmed','delivered','reviewed','completed','approved','active'].includes(s)) return 'green';
    if (['chat','agreed','placed','preparing','ready','pending'].includes(s)) return 'yellow';
    if (['cancelled','disputed','rejected','paused'].includes(s)) return 'red';
    return 'gray';
  }

  // ============================================================
  //                     MODERATION
  // ============================================================
  function renderModeration(c) {
    if (state.flagged.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty"><div style="font-size:48px">✓</div>Δεν υπάρχουν open flagged messages — όλα καθαρά!</div></div>';
      return;
    }
    c.innerHTML = '<div class="jv-card"><h3>🚨 Flagged messages (sorted by risk)</h3></div>';
    const wrap = c.querySelector('.jv-card');
    state.flagged.forEach(fm => {
      const partner = state.partners.find(p => p.id === fm.partnerId);
      const sev = fm.severity || 'medium';
      const sevColor = sev === 'high' ? 'red' : sev === 'medium' ? 'yellow' : 'gray';
      const row = document.createElement('div');
      row.style.cssText = 'padding:12px 0;border-bottom:1px solid #F1F5F9';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
              <span class="jv-pill ${sevColor}">${sev.toUpperCase()} (score ${fm.riskScore || 0})</span>
              <span class="jv-pill gray">${J.escapeHtml(fm.kind || 'unknown')}</span>
              <span style="font-size:11px;color:#94A3B8">${J.timeAgo(fm.createdAt)}</span>
            </div>
            <div style="font-size:13px;font-weight:600;margin-bottom:2px">
              ${J.escapeHtml(fm.fromName || '?')} ${partner ? `(<a href="JMK_Partner_v2.html?p=${fm.partnerId}" target="_blank">${J.escapeHtml(partner.businessName || partner.name)}</a>)` : ''}
            </div>
            <div style="font-size:13px;color:#475569;background:#FEF2F2;padding:8px 10px;border-radius:8px;border-left:3px solid #DC2626;font-style:italic">
              "${J.escapeHtml(fm.text)}"
            </div>
            ${fm.signals && fm.signals.length > 0 ? `<div style="margin-top:6px;font-size:11px;color:#64748B">Signals: ${fm.signals.map(s => `${s.kind}(+${s.score})`).join(', ')}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="jv-btn outline small" data-act="ignore" data-id="${fm.id}">Παράβλεψη</button>
            <button class="jv-btn warn small" data-act="warn" data-id="${fm.id}">⚠ Warn</button>
            <button class="jv-btn danger small" data-act="suspend" data-id="${fm.id}">🚫 Suspend</button>
          </div>
        </div>
      `;
      wrap.appendChild(row);
    });

    wrap.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-act');
        let reason = '';
        if (action !== 'ignore') {
          reason = await J.promptDialog(action === 'warn' ? 'Warn partner' : 'Suspend partner', 'Λόγος (στέλνεται σε notification στον partner):', '');
          if (reason === null) return;
        }
        try {
          await J.post(`/api/admin/flagged/${id}/resolve`, { action, reason }, { admin: true });
          J.toast(`Resolved as ${action}`, 'success');
          await loadAllData();
          renderTab();
        } catch (e) { J.toast(e.message, 'error'); }
      });
    });
  }

  // ============================================================
  //                       RISK
  // ============================================================
  function renderRisk(c) {
    const sorted = state.risk.slice().sort((a, b) => (b.risk7d?.totalScore || 0) - (a.risk7d?.totalScore || 0));
    c.innerHTML = `<div class="jv-card">
      <h3>⚠ Partner Risk Dashboard (7 ημέρες)</h3>
      <p style="font-size:12px;color:#64748B;margin:0 0 10px">Auto-warn όταν score ≥ 150 ή 3+ flagged. Auto-suspend όταν ≥ 300 ή 5+ flagged.</p>
      ${sorted.map(p => `
        <div class="jv-row">
          <div class="avatar" style="background:${p.risk7d?.totalScore >= 150 ? '#DC2626' : '#5F8A8B'}">${J.initials(p.name)}</div>
          <div class="info">
            <h4>${J.escapeHtml(p.businessName || p.name)}</h4>
            <p>${p.risk7d?.count || 0} flagged · score: <b>${p.risk7d?.totalScore || 0}</b> · warnings: ${p.warnings || 0} · <span class="jv-pill ${stateClass(p.status)}">${p.status}</span></p>
          </div>
          <div style="display:flex;gap:4px">
            ${p.status === 'paused'
              ? `<button class="jv-btn success small" data-react="${p.id}">↺ Reactivate</button>`
              : `<button class="jv-btn warn small" data-warn="${p.id}">⚠</button><button class="jv-btn danger small" data-suspend="${p.id}">🚫</button>`}
          </div>
        </div>
      `).join('')}
    </div>`;

    c.querySelectorAll('[data-warn]').forEach(b => b.addEventListener('click', async () => {
      const reason = await J.promptDialog('Warn partner', 'Λόγος:');
      if (reason === null) return;
      try { await J.post(`/api/admin/partners/${b.getAttribute('data-warn')}/warn`, { reason }, { admin: true }); J.toast('Warned', 'success'); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    }));
    c.querySelectorAll('[data-suspend]').forEach(b => b.addEventListener('click', async () => {
      if (!await J.confirmDialog('Suspend partner; Όλες οι δραστηριότητές του γίνονται paused.')) return;
      const reason = await J.promptDialog('Suspend partner', 'Λόγος:');
      if (reason === null) return;
      try { await J.post(`/api/admin/partners/${b.getAttribute('data-suspend')}/suspend`, { reason }, { admin: true }); J.toast('Suspended', 'success'); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    }));
    c.querySelectorAll('[data-react]').forEach(b => b.addEventListener('click', async () => {
      const reason = await J.promptDialog('Reactivate partner', 'Λόγος:', 'Manual reactivation');
      if (reason === null) return;
      try { await J.post(`/api/admin/partners/${b.getAttribute('data-react')}/reactivate`, { reason }, { admin: true }); J.toast('Reactivated', 'success'); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    }));
  }

  // ============================================================
  //                       APPROVALS
  // ============================================================
  function renderApprovals(c) {
    const pendingP = state.partners.filter(p => p.status === 'pending');
    const pendingH = state.hotels.filter(h => h.status === 'pending');
    if (pendingP.length === 0 && pendingH.length === 0) {
      c.innerHTML = '<div class="jv-card"><div class="empty"><div style="font-size:48px">✓</div>Δεν υπάρχουν pending approvals</div></div>';
      return;
    }
    c.innerHTML = `
      ${pendingP.length > 0 ? `<div class="jv-card"><h3>🤝 Νέοι partners (${pendingP.length})</h3>${pendingP.map(p => `
        <div class="jv-row">
          <div class="avatar">${J.initials(p.name)}</div>
          <div class="info"><h4>${J.escapeHtml(p.businessName || p.name)}</h4><p>${J.escapeHtml(p.category)} · ${J.escapeHtml(p.email)} · ${J.escapeHtml(p.islandId)}</p></div>
          <div style="display:flex;gap:4px"><button class="jv-btn success small" data-approve-p="${p.id}">✓</button><button class="jv-btn danger small" data-reject-p="${p.id}">✗</button></div>
        </div>`).join('')}</div>` : ''}
      ${pendingH.length > 0 ? `<div class="jv-card"><h3>🏨 Νέα ξενοδοχεία (${pendingH.length})</h3>${pendingH.map(h => `
        <div class="jv-row">
          <div class="avatar">🏨</div>
          <div class="info"><h4>${J.escapeHtml(h.name)}</h4><p>${J.escapeHtml(h.ownerName || '')} · ${J.escapeHtml(h.email)} · ${h.rooms} δωμάτια · ${J.escapeHtml(h.islandId)}</p></div>
          <div style="display:flex;gap:4px"><button class="jv-btn success small" data-approve-h="${h.id}">✓</button><button class="jv-btn danger small" data-reject-h="${h.id}">✗</button></div>
        </div>`).join('')}</div>` : ''}
    `;
    const update = async (col, id, status) => {
      try { await J.patch(`/api/collections/${col}/${id}`, { status }); J.toast(status, 'success'); await loadAllData(); renderTab(); }
      catch (e) { J.toast(e.message, 'error'); }
    };
    c.querySelectorAll('[data-approve-p]').forEach(b => b.addEventListener('click', () => update('partners', b.getAttribute('data-approve-p'), 'approved')));
    c.querySelectorAll('[data-reject-p]').forEach(b => b.addEventListener('click', () => update('partners', b.getAttribute('data-reject-p'), 'rejected')));
    c.querySelectorAll('[data-approve-h]').forEach(b => b.addEventListener('click', () => update('hotels', b.getAttribute('data-approve-h'), 'active')));
    c.querySelectorAll('[data-reject-h]').forEach(b => b.addEventListener('click', () => update('hotels', b.getAttribute('data-reject-h'), 'rejected')));
  }

  // ============================================================
  //                       HOTELS
  // ============================================================
  function renderHotels(c) {
    const sorted = state.hotels.slice().sort((a, b) => (b.totalCommission || 0) - (a.totalCommission || 0));
    c.innerHTML = `<div class="jv-card">
      <h3>🏨 Όλα τα ξενοδοχεία</h3>
      ${sorted.map(h => `
        <div class="jv-row" style="cursor:pointer" onclick="window.open('JMK_Hotelier_v2.html?h=${h.id}','_blank')">
          <div class="avatar">🏨</div>
          <div class="info"><h4>${J.escapeHtml(h.name)}</h4><p>${J.escapeHtml(h.islandId)} · ${h.rooms || 0} δωμάτια · ${h.totalBookings || 0} bookings · <span class="jv-pill ${stateClass(h.status)}">${h.status}</span></p></div>
          <div class="price">${J.formatEUR(h.totalCommission || 0)}</div>
        </div>
      `).join('')}
    </div>`;
  }

  // ============================================================
  //                       PARTNERS
  // ============================================================
  function renderPartners(c) {
    const sorted = state.partners.slice().sort((a, b) => (b.totalEarnings || 0) - (a.totalEarnings || 0));
    c.innerHTML = `<div class="jv-card">
      <h3>🤝 Όλοι οι partners</h3>
      ${sorted.map(p => `
        <div class="jv-row" style="cursor:pointer" onclick="window.open('JMK_Partner_v2.html?p=${p.id}','_blank')">
          <div class="avatar">${J.initials(p.name)}</div>
          <div class="info"><h4>${J.escapeHtml(p.businessName || p.name)}</h4><p>${J.escapeHtml(p.category)} · ${J.escapeHtml(p.islandId)} · ★ ${p.rating || '—'} · <span class="jv-pill ${stateClass(p.status)}">${p.status}</span> ${p.warnings ? `· <span class="jv-pill yellow">⚠ ${p.warnings}</span>` : ''}</p></div>
          <div class="price">${J.formatEUR(p.totalEarnings || 0)}</div>
        </div>
      `).join('')}
    </div>`;
  }

  // ============================================================
  //                       SETTINGS
  // ============================================================
  async function renderSettings(c) {
    try {
      const settings = await J.get('/api/settings');
      const thresh = await J.get('/api/admin/moderation/thresholds', { admin: true }).catch(() => ({}));
      c.innerHTML = `
        <div class="jv-card">
          <h3>⚙ Commission Settings</h3>
          <label class="jv-label">JMK commission %</label><input class="jv-input" id="jas-jmk" type="number" step="0.5" value="${settings.jmkCommissionPct || 10}">
          <label class="jv-label">Default hotel commission %</label><input class="jv-input" id="jas-hotel" type="number" step="0.5" value="${settings.defaultHotelCommissionPct || 10}">
          <label class="jv-label">Stripe fee % + flat €</label>
          <div style="display:flex;gap:6px"><input class="jv-input" id="jas-stripe-pct" type="number" step="0.1" value="${settings.stripeFeePct || 1.4}"><input class="jv-input" id="jas-stripe-flat" type="number" step="0.05" value="${settings.stripeFeeFlat || 0.25}"></div>
          <button class="jv-btn primary" id="jas-save" style="margin-top:14px">Αποθήκευση</button>
        </div>
        <div class="jv-card">
          <h3>🚨 Moderation Thresholds</h3>
          <div style="font-size:13px;line-height:2;color:#475569">
            <div><b>Auto-warn:</b> 7d score ≥ ${thresh.warnScore7d || 150} ή ≥ ${thresh.warnCount7d || 3} flagged</div>
            <div><b>Auto-suspend:</b> 7d score ≥ ${thresh.suspendScore7d || 300} ή ≥ ${thresh.suspendCount7d || 5} flagged</div>
          </div>
        </div>
        <div class="jv-card">
          <h3>🔑 Admin Key</h3>
          <p style="font-size:12px;color:#64748B">Αποθηκευμένο τοπικά. Όλες οι /api/admin/* κλήσεις χρειάζονται το key αυτό.</p>
          <input class="jv-input" id="jas-key" value="${localStorage.getItem('jmk_admin_key') || 'dev-admin-key'}">
          <button class="jv-btn outline" id="jas-savekey" style="margin-top:8px">Αποθήκευση key</button>
        </div>
      `;
      document.getElementById('jas-save').addEventListener('click', async () => {
        try {
          await J.patch('/api/settings', {
            jmkCommissionPct: Number(document.getElementById('jas-jmk').value),
            defaultHotelCommissionPct: Number(document.getElementById('jas-hotel').value),
            stripeFeePct: Number(document.getElementById('jas-stripe-pct').value),
            stripeFeeFlat: Number(document.getElementById('jas-stripe-flat').value)
          });
          J.toast('Αποθηκεύτηκε', 'success');
        } catch (e) { J.toast(e.message, 'error'); }
      });
      document.getElementById('jas-savekey').addEventListener('click', () => {
        localStorage.setItem('jmk_admin_key', document.getElementById('jas-key').value);
        J.toast('Key αποθηκεύτηκε', 'success');
      });
    } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
  }

  root.JMKAdminV2 = { mount, state };
  console.log('[JMKAdminV2] loaded');
})(typeof window !== 'undefined' ? window : globalThis);
