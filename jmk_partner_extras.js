/**
 * JMK · Partner App Extras (v1.2)
 * --------------------------------
 * Real implementations για photo upload, calendar/availability, pricing.
 *
 * Φορτώνεται μετά από jmk_api.js.
 *
 * Public API (global window.JMKPartner):
 *   uploadPhotos(activityId, fileList)      → ανεβάζει πολλαπλές φωτογραφίες
 *   deletePhoto(photoId, activityId)        → διαγραφή
 *   reorderPhotos(activityId, idArray)      → reorder
 *   getCalendar(activityId, from, to)       → ημερολόγιο διαθεσιμότητας
 *   blockDates(activityId, dates[])         → block συγκεκριμένες ημερομηνίες
 *   unblockDates(activityId, dates[])       → unblock
 *   setSchedule(activityId, scheduleObj)    → set weekly + slots + season
 *   setPricing(activityId, pricingObj)      → set base + multipliers
 *   pricePreview(activityId, date, time, p) → υπολογισμός τιμής
 *   renderCalendar(elementId, activityId)   → δημιουργεί calendar widget σε container
 *   renderPhotoGrid(elementId, activityId)  → δημιουργεί photo grid σε container
 */
(function (root) {
  'use strict';

  function apiBase() { return root.JMK_API_URL || ''; }

  function authHeader() {
    const t = localStorage.getItem('jmk_token');
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  async function _json(method, path, body, isMultipart) {
    const url = (apiBase() || '') + path;
    const opts = { method, headers: Object.assign({}, authHeader()) };
    if (body !== undefined) {
      if (isMultipart) {
        opts.body = body; // FormData — let browser set Content-Type
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const r = await fetch(url, opts);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
    return data;
  }

  // ============================================================
  //                       PHOTOS
  // ============================================================

  async function uploadPhotos(activityId, fileList) {
    if (!activityId) throw new Error('activityId required');
    const fd = new FormData();
    if (activityId) fd.append('activityId', activityId);
    const files = Array.from(fileList || []);
    if (files.length === 0) throw new Error('no files');
    if (files.length > 10) throw new Error('max 10 files per upload');
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) throw new Error(`File too big (>10MB): ${f.name}`);
      fd.append('files', f);
    }
    return _json('POST', '/api/uploads', fd, true);
  }

  async function deletePhoto(photoId, activityId) {
    const q = activityId ? `?activityId=${encodeURIComponent(activityId)}` : '';
    return _json('DELETE', `/api/uploads/${encodeURIComponent(photoId)}${q}`);
  }

  async function reorderPhotos(activityId, orderedIds) {
    return _json('PATCH', `/api/activities/${activityId}/photos`, { order: orderedIds });
  }

  // ============================================================
  //                     AVAILABILITY
  // ============================================================

  function getCalendar(activityId, from, to) {
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return _json('GET', `/api/activities/${activityId}/availability${q}`);
  }

  function blockDates(activityId, dates) {
    return _json('POST', `/api/activities/${activityId}/block-dates`, { dates });
  }

  function unblockDates(activityId, dates) {
    return _json('POST', `/api/activities/${activityId}/unblock-dates`, { dates });
  }

  function setSchedule(activityId, scheduleObj) {
    return _json('PATCH', `/api/activities/${activityId}/schedule`, scheduleObj);
  }

  // ============================================================
  //                       PRICING
  // ============================================================

  function setPricing(activityId, pricingObj) {
    return _json('PATCH', `/api/activities/${activityId}/pricing`, pricingObj);
  }

  function pricePreview(activityId, date, time, people) {
    const q = `?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time || '10:00')}&people=${people || 1}`;
    return _json('GET', `/api/activities/${activityId}/price-preview${q}`);
  }

  // ============================================================
  //                       DETAILS
  // ============================================================

  function setDetails(activityId, fields) {
    return _json('PATCH', `/api/activities/${activityId}/details`, fields);
  }

  // ============================================================
  //                  UI WIDGETS (vanilla JS, no deps)
  // ============================================================

  /**
   * Δημιουργεί ένα calendar grid σε container element.
   * Ο partner κάνει click μέρα → block/unblock.
   */
  async function renderCalendar(containerId, activityId, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const today = new Date();
    const from = opts.from || today.toISOString().slice(0, 10);
    const to   = opts.to   || new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);

    el.innerHTML = '<div style="padding:12px;text-align:center;color:#888">Φόρτωση…</div>';
    let calendar;
    try { calendar = await getCalendar(activityId, from, to); }
    catch (e) { el.innerHTML = `<div style="padding:12px;color:#c33">Σφάλμα: ${e.message}</div>`; return; }

    const css = `
      .jmk-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-family:-apple-system,sans-serif}
      .jmk-cal .h{font-size:11px;color:#888;text-align:center;padding:6px 0;font-weight:600}
      .jmk-cal .d{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-size:13px;background:#f5f5f7;border:1px solid transparent;transition:all .15s}
      .jmk-cal .d:hover{border-color:#5F8A8B}
      .jmk-cal .d.open{background:#E7F4F4;color:#0F4C5C}
      .jmk-cal .d.blocked{background:#fee;color:#c33;text-decoration:line-through}
      .jmk-cal .d.closed{background:#f5f5f7;color:#bbb}
      .jmk-cal .d.past{opacity:.3;cursor:not-allowed}
      .jmk-cal .d .cap{font-size:9px;margin-top:2px;color:inherit;opacity:.7}
      .jmk-cal-month{grid-column:1/-1;font-weight:700;font-size:14px;padding:8px 4px;color:#0F4C5C}
    `;
    if (!document.getElementById('jmk-cal-css')) {
      const s = document.createElement('style'); s.id = 'jmk-cal-css'; s.textContent = css;
      document.head.appendChild(s);
    }

    const dayHeaders = ['Δ','Τ','Τ','Π','Π','Σ','Κ'];
    const grid = ['<div class="jmk-cal">'];
    dayHeaders.forEach(h => grid.push(`<div class="h">${h}</div>`));

    let lastMonth = null;
    // Pad start to align Monday
    const firstDay = new Date(calendar.days[0].date);
    const firstDow = (firstDay.getDay() + 6) % 7;
    for (let i = 0; i < firstDow; i++) grid.push('<div></div>');

    for (const day of calendar.days) {
      const d = new Date(day.date);
      const monthLabel = d.toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });
      if (monthLabel !== lastMonth) {
        if (lastMonth !== null) {
          // close & re-open grid for new month
          grid.push('</div><div class="jmk-cal">');
          dayHeaders.forEach(h => grid.push(`<div class="h">${h}</div>`));
          const dowFirst = (d.getDay() + 6) % 7;
          for (let i = 0; i < dowFirst; i++) grid.push('<div></div>');
        }
        grid.push(`<div class="jmk-cal-month">${monthLabel}</div>`);
        lastMonth = monthLabel;
      }
      const dayNum = d.getDate();
      const klass = day.isOpen ? 'open'
                  : day.reason === 'blocked' ? 'blocked'
                  : day.reason === 'past' ? 'past'
                  : 'closed';
      const totalCap = day.slots.reduce((s, x) => s + x.available, 0);
      const capText = day.isOpen ? `<span class="cap">${totalCap} θέσ.</span>` : '';
      grid.push(`<div class="d ${klass}" data-date="${day.date}">${dayNum}${capText}</div>`);
    }
    grid.push('</div>');
    el.innerHTML = grid.join('');

    // Click handler για block/unblock
    el.querySelectorAll('.d[data-date]').forEach(node => {
      node.addEventListener('click', async () => {
        const date = node.getAttribute('data-date');
        const isBlocked = node.classList.contains('blocked');
        const isPast = node.classList.contains('past');
        if (isPast) return;
        try {
          if (isBlocked) {
            await unblockDates(activityId, [date]);
            node.classList.remove('blocked'); node.classList.add('open');
          } else if (node.classList.contains('open')) {
            await blockDates(activityId, [date]);
            node.classList.remove('open'); node.classList.add('blocked');
          }
        } catch (e) { alert('Σφάλμα: ' + e.message); }
      });
    });
  }

  /**
   * Δημιουργεί photo grid με drag-drop upload.
   */
  async function renderPhotoGrid(containerId, activityId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const css = `
      .jmk-pg{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
      .jmk-pg .ph{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#f5f5f7}
      .jmk-pg .ph img{width:100%;height:100%;object-fit:cover}
      .jmk-pg .ph .x{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;line-height:1}
      .jmk-pg .ph .cover{position:absolute;top:4px;left:4px;background:#0F4C5C;color:#fff;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
      .jmk-pg .add{aspect-ratio:1;border:2px dashed #ccc;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:32px;color:#999;background:#fafafa;transition:all .15s}
      .jmk-pg .add:hover{border-color:#5F8A8B;color:#5F8A8B;background:#E7F4F4}
      .jmk-pg .add.drag{border-color:#5F8A8B;background:#E7F4F4}
    `;
    if (!document.getElementById('jmk-pg-css')) {
      const s = document.createElement('style'); s.id = 'jmk-pg-css'; s.textContent = css;
      document.head.appendChild(s);
    }

    async function refresh() {
      try {
        const activity = await _json('GET', `/api/collections/activities/${activityId}`);
        const photos = activity.photos || [];
        const tiles = photos.map(p => `
          <div class="ph" data-id="${p.id}">
            <img src="${p.thumbUrl || p.url}" alt="" loading="lazy">
            ${p.isCover ? '<span class="cover">Cover</span>' : ''}
            <span class="x" data-del="${p.id}">×</span>
          </div>
        `).join('');
        el.innerHTML = `<div class="jmk-pg">${tiles}<div class="add" id="jmk-pg-add">+</div></div>`;

        // Hidden file input
        const fi = document.createElement('input');
        fi.type = 'file'; fi.multiple = true; fi.accept = 'image/*'; fi.style.display = 'none';
        el.appendChild(fi);

        const addBtn = el.querySelector('#jmk-pg-add');
        addBtn.addEventListener('click', () => fi.click());
        ['dragover','dragenter'].forEach(ev => addBtn.addEventListener(ev, e => { e.preventDefault(); addBtn.classList.add('drag'); }));
        ['dragleave','drop'].forEach(ev => addBtn.addEventListener(ev, e => { e.preventDefault(); addBtn.classList.remove('drag'); }));
        addBtn.addEventListener('drop', e => doUpload(e.dataTransfer.files));
        fi.addEventListener('change', () => doUpload(fi.files));

        async function doUpload(files) {
          if (!files || files.length === 0) return;
          addBtn.textContent = '⏳';
          try {
            await uploadPhotos(activityId, files);
            await refresh();
          } catch (e) { alert('Upload error: ' + e.message); addBtn.textContent = '+'; }
        }

        // Delete handlers
        el.querySelectorAll('[data-del]').forEach(x => {
          x.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (!confirm('Διαγραφή φωτογραφίας;')) return;
            try { await deletePhoto(x.getAttribute('data-del'), activityId); await refresh(); }
            catch (e) { alert('Σφάλμα: ' + e.message); }
          });
        });
      } catch (e) {
        el.innerHTML = `<div style="padding:12px;color:#c33">Σφάλμα φόρτωσης φωτογραφιών: ${e.message}</div>`;
      }
    }
    await refresh();
  }

  // ============================================================
  //                        EXPORT
  // ============================================================
  root.JMKPartner = {
    uploadPhotos, deletePhoto, reorderPhotos,
    getCalendar, blockDates, unblockDates, setSchedule,
    setPricing, pricePreview, setDetails,
    renderCalendar, renderPhotoGrid
  };

  console.log('[JMKPartner] v1.2 loaded — uploads, calendar, pricing ready');
})(typeof window !== 'undefined' ? window : globalThis);
