/**
 * JMK · Shared v2 utilities (CSS + helpers)
 * ==========================================
 * Used by jmk_partner_v2.js, jmk_hotelier_v2.js, jmk_admin_v2.js
 *
 * Provides:
 *   - Shared CSS theme injection (JV.injectStyles)
 *   - HTTP helpers (JV.fetch / JV.get / JV.post / JV.patch / JV.del)
 *   - Modal/toast/confirm dialogs
 *   - escapeHtml, formatEUR, formatDate, timeAgo, throttle
 *   - localStorage helpers
 */
(function (root) {
  'use strict';

  function api() { return root.JMK_API_URL || ''; }
  function authHeader() {
    const t = (typeof localStorage !== 'undefined') && localStorage.getItem('jmk_token');
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  function adminHeader() {
    const k = (typeof localStorage !== 'undefined') && localStorage.getItem('jmk_admin_key') || 'dev-admin-key';
    return { 'X-Admin-Key': k };
  }

  async function _fetch(method, path, body, opts = {}) {
    const headers = Object.assign({}, authHeader(), opts.admin ? adminHeader() : {});
    const init = { method, headers };
    if (body !== undefined) {
      if (body instanceof FormData) {
        init.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }
    const r = await fetch(api() + path, init);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw Object.assign(new Error((data && data.error) || r.statusText), { status: r.status, data });
    return data;
  }

  // ============================================================
  //                       SHARED CSS
  // ============================================================
  const SHARED_CSS = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body.jv-body { margin: 0; background: #F1F5F9; font-family: -apple-system, "SF Pro Display", "Segoe UI", sans-serif; min-height: 100vh; color: #0F172A; }

    .jv-shell { max-width: 920px; margin: 0 auto; padding: 16px; }
    @media (min-width: 768px) { .jv-shell { padding: 24px; } }

    .jv-header { background: linear-gradient(135deg, #0F4C5C 0%, #5F8A8B 100%); color: #fff; padding: 22px 18px; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 6px 18px rgba(15,76,92,.15); }
    .jv-header h1 { font-size: 22px; margin: 0 0 4px; font-weight: 800; letter-spacing: -.3px; }
    .jv-header .sub { font-size: 13px; opacity: .9; }
    .jv-header .meta { display: flex; gap: 16px; margin-top: 12px; font-size: 12px; opacity: .85; flex-wrap: wrap; }

    .jv-tabs { display: flex; gap: 4px; padding: 4px; background: #fff; border-radius: 12px; margin-bottom: 16px; box-shadow: 0 2px 6px rgba(0,0,0,.04); overflow-x: auto; }
    .jv-tab { padding: 10px 14px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; color: #64748B; transition: all .15s; white-space: nowrap; }
    .jv-tab.active { background: #0F4C5C; color: #fff; }

    .jv-grid { display: grid; gap: 12px; }
    .jv-grid-2 { grid-template-columns: repeat(2, 1fr); }
    .jv-grid-3 { grid-template-columns: repeat(3, 1fr); }
    .jv-grid-4 { grid-template-columns: repeat(4, 1fr); }
    @media (max-width: 600px) { .jv-grid-3, .jv-grid-4 { grid-template-columns: repeat(2, 1fr); } }

    .jv-stat { background: #fff; padding: 14px; border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.04); }
    .jv-stat .label { font-size: 11px; color: #94A3B8; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
    .jv-stat .value { font-size: 22px; font-weight: 800; color: #0F4C5C; margin-top: 4px; }
    .jv-stat .delta { font-size: 11px; margin-top: 2px; color: #64748B; }
    .jv-stat .delta.up { color: #16A34A; }
    .jv-stat .delta.down { color: #DC2626; }

    .jv-card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.05); margin-bottom: 12px; }
    .jv-card h3 { margin: 0 0 12px; font-size: 16px; font-weight: 700; color: #0F172A; }
    .jv-card .empty { text-align: center; padding: 30px 20px; color: #94A3B8; font-size: 13px; }

    .jv-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #F1F5F9; }
    .jv-row:last-child { border-bottom: 0; }
    .jv-row .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #5F8A8B, #0F4C5C); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; font-size: 14px; }
    .jv-row .info { flex: 1; min-width: 0; }
    .jv-row .info h4 { font-size: 14px; font-weight: 700; margin: 0 0 2px; }
    .jv-row .info p { font-size: 12px; color: #64748B; margin: 0; line-height: 1.4; }
    .jv-row .price { font-weight: 800; color: #0F4C5C; font-size: 14px; white-space: nowrap; }

    .jv-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .jv-pill.green { background: #DCFCE7; color: #166534; }
    .jv-pill.yellow { background: #FEF3C7; color: #92400E; }
    .jv-pill.red { background: #FEE2E2; color: #991B1B; }
    .jv-pill.blue { background: #DBEAFE; color: #1E40AF; }
    .jv-pill.gray { background: #F1F5F9; color: #475569; }
    .jv-pill.purple { background: #EDE9FE; color: #5B21B6; }
    .jv-pill.gold { background: #FEF3C7; color: #92400E; }

    .jv-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 9px; border: 0; font-weight: 700; font-size: 13px; cursor: pointer; transition: all .15s; }
    .jv-btn.primary { background: #0F4C5C; color: #fff; }
    .jv-btn.primary:hover { background: #0a3a47; }
    .jv-btn.outline { background: transparent; border: 1px solid #CBD5E1; color: #475569; }
    .jv-btn.danger { background: #DC2626; color: #fff; }
    .jv-btn.warn { background: #F59E0B; color: #fff; }
    .jv-btn.success { background: #16A34A; color: #fff; }
    .jv-btn.small { padding: 5px 10px; font-size: 11px; }
    .jv-btn:disabled { opacity: .5; cursor: not-allowed; }

    .jv-input { width: 100%; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 9px; font-size: 14px; font-family: inherit; }
    .jv-input:focus { outline: none; border-color: #0F4C5C; box-shadow: 0 0 0 3px rgba(15,76,92,.1); }
    .jv-textarea { min-height: 80px; resize: vertical; }
    .jv-label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; margin-top: 12px; }

    .jv-modal { position: fixed; inset: 0; background: rgba(15,23,42,.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(4px); }
    .jv-modal-card { background: #fff; max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto; border-radius: 16px; padding: 0; }
    .jv-modal-card .head { padding: 18px 20px 12px; border-bottom: 1px solid #F1F5F9; display: flex; justify-content: space-between; align-items: center; }
    .jv-modal-card .head h3 { margin: 0; font-size: 17px; font-weight: 800; }
    .jv-modal-card .close { width: 32px; height: 32px; border-radius: 50%; background: #F1F5F9; color: #475569; display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; border: 0; }
    .jv-modal-card .body { padding: 18px 20px; }
    .jv-modal-card .foot { padding: 14px 20px; border-top: 1px solid #F1F5F9; display: flex; gap: 8px; justify-content: flex-end; }

    .jv-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #0F172A; color: #fff; padding: 12px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; z-index: 10000; box-shadow: 0 8px 24px rgba(0,0,0,.2); animation: jvToastIn .2s ease-out; }
    .jv-toast.success { background: #16A34A; }
    .jv-toast.error { background: #DC2626; }
    @keyframes jvToastIn { from { transform: translate(-50%, -10px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }

    .jv-spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid #E2E8F0; border-top-color: #0F4C5C; border-radius: 50%; animation: jvSpin .8s linear infinite; }
    @keyframes jvSpin { to { transform: rotate(360deg); } }

    .jv-empty { text-align: center; padding: 50px 20px; color: #94A3B8; }
    .jv-empty .icon { font-size: 48px; margin-bottom: 12px; opacity: .5; }
  `;

  function injectStyles() {
    if (document.getElementById('jv-shared-styles')) return;
    const s = document.createElement('style');
    s.id = 'jv-shared-styles';
    s.textContent = SHARED_CSS;
    document.head.appendChild(s);
    document.body.classList.add('jv-body');
  }

  // ============================================================
  //                    UI HELPERS
  // ============================================================
  function showModal({ title, body, footer, onClose }) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'jv-modal';
    m.id = 'jv-modal';
    m.innerHTML = `
      <div class="jv-modal-card">
        <div class="head">
          <h3>${escapeHtml(title || '')}</h3>
          <button class="close" id="jv-modal-close">×</button>
        </div>
        <div class="body" id="jv-modal-body"></div>
        ${footer ? `<div class="foot" id="jv-modal-foot"></div>` : ''}
      </div>
    `;
    document.body.appendChild(m);
    if (typeof body === 'string') document.getElementById('jv-modal-body').innerHTML = body;
    else if (body instanceof Node) document.getElementById('jv-modal-body').appendChild(body);
    if (footer) {
      if (typeof footer === 'string') document.getElementById('jv-modal-foot').innerHTML = footer;
      else if (footer instanceof Node) document.getElementById('jv-modal-foot').appendChild(footer);
    }
    document.getElementById('jv-modal-close').addEventListener('click', () => { closeModal(); onClose && onClose(); });
    m.addEventListener('click', (e) => { if (e.target === m) { closeModal(); onClose && onClose(); } });
    return m;
  }

  function closeModal() {
    document.getElementById('jv-modal')?.remove();
  }

  function toast(msg, kind = 'info', duration = 2500) {
    const t = document.createElement('div');
    t.className = 'jv-toast ' + kind;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .2s'; }, duration);
    setTimeout(() => t.remove(), duration + 250);
  }

  function confirmDialog(message) {
    return new Promise(resolve => {
      showModal({
        title: 'Επιβεβαίωση',
        body: `<p style="margin:0;font-size:14px;line-height:1.6">${escapeHtml(message)}</p>`,
        footer: `<button class="jv-btn outline" id="jv-cancel">Ακύρωση</button><button class="jv-btn primary" id="jv-ok">Επιβεβαίωση</button>`
      });
      document.getElementById('jv-cancel').addEventListener('click', () => { closeModal(); resolve(false); });
      document.getElementById('jv-ok').addEventListener('click', () => { closeModal(); resolve(true); });
    });
  }

  function promptDialog(title, label, defaultValue = '') {
    return new Promise(resolve => {
      showModal({
        title,
        body: `<label class="jv-label">${escapeHtml(label)}</label>
               <textarea class="jv-input jv-textarea" id="jv-prompt-input">${escapeHtml(defaultValue)}</textarea>`,
        footer: `<button class="jv-btn outline" id="jv-cancel">Ακύρωση</button><button class="jv-btn primary" id="jv-ok">ΟΚ</button>`
      });
      const input = document.getElementById('jv-prompt-input');
      input.focus();
      document.getElementById('jv-cancel').addEventListener('click', () => { closeModal(); resolve(null); });
      document.getElementById('jv-ok').addEventListener('click', () => { const v = input.value; closeModal(); resolve(v); });
    });
  }

  // ============================================================
  //                     UTILS
  // ============================================================
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function truncate(s, n) { return String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''); }
  function formatEUR(n) { return '€' + (Number(n) || 0).toFixed(2); }
  function formatDate(d) {
    const x = new Date(d);
    return x.toLocaleDateString('el-GR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function formatDateTime(d) {
    const x = new Date(d);
    return x.toLocaleString('el-GR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function timeAgo(d) {
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'τώρα';
    if (diff < 3600) return Math.floor(diff / 60) + ' λεπτά πριν';
    if (diff < 86400) return Math.floor(diff / 3600) + ' ώρες πριν';
    return Math.floor(diff / 86400) + ' μέρες πριν';
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  }

  // ============================================================
  //                       EXPORT
  // ============================================================
  root.JV = {
    fetch:  _fetch,
    get:    (p, opts) => _fetch('GET', p, undefined, opts),
    post:   (p, body, opts) => _fetch('POST', p, body, opts),
    patch:  (p, body, opts) => _fetch('PATCH', p, body, opts),
    del:    (p, opts) => _fetch('DELETE', p, undefined, opts),
    api,
    injectStyles,
    showModal, closeModal, toast, confirmDialog, promptDialog,
    escapeHtml, truncate, formatEUR, formatDate, formatDateTime, timeAgo, initials
  };

  console.log('[JV] shared v2 utilities loaded');
})(typeof window !== 'undefined' ? window : globalThis);
