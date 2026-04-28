/**
 * JMK · Config (loaded BEFORE jmk_store.js / jmk_api.js)
 * ------------------------------------------------------
 * Decides whether the apps run with localStorage only (offline / personal)
 * or with the shared backend (real cross-device sync).
 *
 * To enable backend mode:
 *   1. Deploy the /server folder to Render/Railway/etc.
 *   2. Edit the line below and replace '' with your backend URL, e.g.:
 *        window.JMK_API_URL = 'https://jmk-server.onrender.com';
 *   3. Reload all apps.
 *
 * To stay offline / single-device, leave it empty.
 */
(function(root){
  // ▼▼▼  EDIT THIS LINE  ▼▼▼
  root.JMK_API_URL = '';
  // ▲▲▲  EDIT THIS LINE  ▲▲▲

  // Auto-detect: if the apps are served from the backend itself, use same origin
  if (!root.JMK_API_URL && root.location && /^https?:/.test(root.location.protocol)) {
    var sameOriginCandidate = root.location.origin;
    // Heuristic: only use same-origin if the page path is served by Express (not a file:// or static host).
    // We probe /api/health asynchronously and switch over if it answers.
    fetch(sameOriginCandidate + '/api/health').then(function(r){
      if (r.ok) {
        root.JMK_API_URL = sameOriginCandidate;
        console.log('[JMK Config] auto-detected backend at', sameOriginCandidate);
        // reload to pick up the new URL on next script execution if needed
      }
    }).catch(function(){ /* no backend, stay local */ });
  }
})(typeof window !== 'undefined' ? window : globalThis);
