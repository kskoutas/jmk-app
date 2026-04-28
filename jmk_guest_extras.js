/**
 * JMK · Guest App Extras (v1.2)
 * ------------------------------
 * Photo carousel + calendar picker + slot selector + dynamic price.
 *
 * Public API (global window.JMKGuest):
 *   renderPhotoCarousel(elementId, activity)        → carousel με photos
 *   renderDatePicker(elementId, activityId, onPick) → calendar για να διαλέξει διαθέσιμη μέρα
 *   renderSlotPicker(elementId, activityId, date, onPick)
 *   showPrice(elementId, activityId, date, time, people)
 *   bookActivity(activityId, hotelId, guestId, date, time, slotId, people)
 */
(function (root) {
  'use strict';

  function apiBase() { return root.JMK_API_URL || ''; }
  function authHeader() {
    const t = localStorage.getItem('jmk_token');
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  async function _json(method, path, body) {
    const opts = { method, headers: Object.assign({}, authHeader()) };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch((apiBase() || '') + path, opts);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
    return data;
  }

  // CSS injection (once)
  function injectCSS() {
    if (document.getElementById('jmk-guest-css')) return;
    const css = `
      .jmk-carousel{position:relative;border-radius:14px;overflow:hidden;background:#f5f5f7;aspect-ratio:4/3}
      .jmk-carousel img{width:100%;height:100%;object-fit:cover;display:block}
      .jmk-carousel .nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;font-weight:700;color:#0F4C5C;user-select:none}
      .jmk-carousel .nav.l{left:8px} .jmk-carousel .nav.r{right:8px}
      .jmk-carousel .dots{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:5px}
      .jmk-carousel .dots span{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.5)}
      .jmk-carousel .dots span.a{background:#fff}

      .jmk-dpick{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-family:-apple-system,sans-serif}
      .jmk-dpick .h{font-size:11px;color:#888;text-align:center;padding:6px 0;font-weight:600}
      .jmk-dpick .d{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-size:13px;background:#f5f5f7;border:1px solid transparent;transition:all .15s}
      .jmk-dpick .d.avail{background:#E7F4F4;color:#0F4C5C;font-weight:600}
      .jmk-dpick .d.avail:hover{background:#5F8A8B;color:#fff}
      .jmk-dpick .d.selected{background:#0F4C5C;color:#fff}
      .jmk-dpick .d.unavail{background:#fafafa;color:#ccc;cursor:not-allowed}
      .jmk-dpick .month{grid-column:1/-1;font-weight:700;font-size:14px;padding:8px 4px;color:#0F4C5C}

      .jmk-slots{display:flex;flex-direction:column;gap:8px;margin-top:12px}
      .jmk-slot{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#f5f5f7;border-radius:10px;border:2px solid transparent;cursor:pointer}
      .jmk-slot:hover{border-color:#5F8A8B}
      .jmk-slot.selected{border-color:#0F4C5C;background:#E7F4F4}
      .jmk-slot.full{opacity:.5;cursor:not-allowed;background:#fee}
      .jmk-slot .time{font-weight:700;font-size:15px}
      .jmk-slot .meta{font-size:12px;color:#666;margin-top:2px}
      .jmk-slot .price{font-weight:700;color:#0F4C5C}

      .jmk-pricebox{margin-top:14px;padding:14px;background:#0F4C5C;color:#fff;border-radius:12px}
      .jmk-pricebox .row{display:flex;justify-content:space-between;font-size:13px;opacity:.9;margin:4px 0}
      .jmk-pricebox .total{font-size:22px;font-weight:800;display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.25)}
    `;
    const s = document.createElement('style'); s.id = 'jmk-guest-css'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------- Carousel ----------
  function renderPhotoCarousel(elId, activity) {
    injectCSS();
    const el = document.getElementById(elId);
    if (!el) return;
    const photos = (activity && activity.photos) || [];
    if (photos.length === 0) {
      el.innerHTML = `<div class="jmk-carousel" style="display:flex;align-items:center;justify-content:center;font-size:48px">${activity?.coverIcon || '📷'}</div>`;
      return;
    }
    let idx = 0;
    function render() {
      el.innerHTML = `
        <div class="jmk-carousel">
          <img src="${photos[idx].url}" alt="">
          ${photos.length > 1 ? `
            <div class="nav l">‹</div>
            <div class="nav r">›</div>
            <div class="dots">${photos.map((_, i) => `<span class="${i === idx ? 'a' : ''}"></span>`).join('')}</div>
          ` : ''}
        </div>
      `;
      const root = el.querySelector('.jmk-carousel');
      const l = root.querySelector('.nav.l');
      const r = root.querySelector('.nav.r');
      if (l) l.addEventListener('click', () => { idx = (idx - 1 + photos.length) % photos.length; render(); });
      if (r) r.addEventListener('click', () => { idx = (idx + 1) % photos.length; render(); });
    }
    render();
  }

  // ---------- Date picker ----------
  async function renderDatePicker(elId, activityId, onPick, opts = {}) {
    injectCSS();
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#888">Φόρτωση ημερολογίου…</div>';
    const today = new Date();
    const from = opts.from || today.toISOString().slice(0, 10);
    const to   = opts.to   || new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);

    let cal;
    try { cal = await _json('GET', `/api/activities/${activityId}/availability?from=${from}&to=${to}`); }
    catch (e) { el.innerHTML = `<div style="padding:12px;color:#c33">${e.message}</div>`; return; }

    let selected = null;
    function build() {
      const headers = ['Δ','Τ','Τ','Π','Π','Σ','Κ'];
      const grid = ['<div class="jmk-dpick">'];
      headers.forEach(h => grid.push(`<div class="h">${h}</div>`));
      const firstDay = new Date(cal.days[0].date);
      const firstDow = (firstDay.getDay() + 6) % 7;
      for (let i = 0; i < firstDow; i++) grid.push('<div></div>');

      let lastMonth = null;
      for (const day of cal.days) {
        const d = new Date(day.date);
        const monthLabel = d.toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });
        if (monthLabel !== lastMonth) {
          if (lastMonth !== null) {
            grid.push('</div><div class="jmk-dpick">');
            headers.forEach(h => grid.push(`<div class="h">${h}</div>`));
            const dowFirst = (d.getDay() + 6) % 7;
            for (let i = 0; i < dowFirst; i++) grid.push('<div></div>');
          }
          grid.push(`<div class="month">${monthLabel}</div>`);
          lastMonth = monthLabel;
        }
        const totalCap = day.slots.reduce((s, x) => s + x.available, 0);
        const klass = day.isOpen && totalCap > 0
          ? (selected === day.date ? 'avail selected' : 'avail')
          : 'unavail';
        grid.push(`<div class="d ${klass}" data-date="${day.date}">${d.getDate()}</div>`);
      }
      grid.push('</div>');
      el.innerHTML = grid.join('');
      el.querySelectorAll('.d.avail').forEach(node => {
        node.addEventListener('click', () => {
          selected = node.getAttribute('data-date');
          build();
          if (onPick) onPick(selected);
        });
      });
    }
    build();
  }

  // ---------- Slot picker ----------
  async function renderSlotPicker(elId, activityId, date, onPick, people = 1) {
    injectCSS();
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '<div style="padding:8px;color:#888">Φόρτωση ωρών…</div>';
    let cal, prices = {};
    try {
      cal = await _json('GET', `/api/activities/${activityId}/availability?from=${date}&to=${date}`);
      const day = cal.days[0];
      if (!day || !day.isOpen) { el.innerHTML = '<div style="color:#c33">Δεν υπάρχουν ώρες αυτή τη μέρα.</div>'; return; }

      // Fetch price για κάθε slot
      for (const slot of day.slots) {
        try {
          const p = await _json('GET', `/api/activities/${activityId}/price-preview?date=${date}&time=${slot.time}&people=${people}`);
          prices[slot.slotId] = p.total;
        } catch {}
      }

      let selected = null;
      function build() {
        const html = ['<div class="jmk-slots">'];
        for (const slot of day.slots) {
          const k = slot.soldOut ? 'full' : (selected === slot.slotId ? 'selected' : '');
          html.push(`
            <div class="jmk-slot ${k}" data-slot="${slot.slotId}">
              <div>
                <div class="time">${slot.time} ${slot.label ? '· ' + slot.label : ''}</div>
                <div class="meta">${slot.soldOut ? 'Sold out' : slot.available + ' θέσεις διαθέσιμες'}</div>
              </div>
              <div class="price">${prices[slot.slotId] ? prices[slot.slotId] + '€' : ''}</div>
            </div>
          `);
        }
        html.push('</div>');
        el.innerHTML = html.join('');
        el.querySelectorAll('.jmk-slot:not(.full)').forEach(node => {
          node.addEventListener('click', () => {
            selected = node.getAttribute('data-slot');
            const slot = day.slots.find(s => s.slotId === selected);
            build();
            if (onPick) onPick({ slotId: selected, time: slot.time, capacity: slot.capacity, available: slot.available, price: prices[selected] });
          });
        });
      }
      build();
    } catch (e) { el.innerHTML = `<div style="color:#c33">${e.message}</div>`; }
  }

  // ---------- Price box ----------
  async function showPrice(elId, activityId, date, time, people) {
    injectCSS();
    const el = document.getElementById(elId);
    if (!el) return;
    try {
      const p = await _json('GET', `/api/activities/${activityId}/price-preview?date=${date}&time=${time}&people=${people}`);
      const rows = [];
      rows.push(`<div class="row"><span>Βάση (${p.unit === 'group' ? 'group' : 'άτομο'}):</span><span>${p.base}€</span></div>`);
      for (const r of (p.breakdown || [])) {
        const name = r.rule === 'high_season' ? 'High season' :
                     r.rule === 'weekend'     ? 'Weekend' :
                     r.rule === 'last_minute' ? 'Last minute discount' :
                     r.rule === 'early_bird'  ? 'Early bird' :
                     r.rule === 'group_discount' ? 'Group discount' : r.rule;
        rows.push(`<div class="row"><span>${name}:</span><span>×${r.multiplier}</span></div>`);
      }
      if (p.unit === 'person') rows.push(`<div class="row"><span>Άτομα:</span><span>×${p.people}</span></div>`);
      rows.push(`<div class="total"><span>Σύνολο</span><span>${p.total} ${p.currency}</span></div>`);
      el.innerHTML = `<div class="jmk-pricebox">${rows.join('')}</div>`;
    } catch (e) {
      el.innerHTML = `<div style="color:#c33">${e.message}</div>`;
    }
  }

  // ---------- Booking ----------
  async function bookActivity(opts) {
    return _json('POST', '/api/bookings', opts);
  }

  root.JMKGuest = {
    renderPhotoCarousel,
    renderDatePicker,
    renderSlotPicker,
    showPrice,
    bookActivity
  };

  console.log('[JMKGuest] v1.2 loaded — carousel, calendar, slots, pricing ready');
})(typeof window !== 'undefined' ? window : globalThis);
