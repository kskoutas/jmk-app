/**
 * JMK · Backend-backed Store
 * --------------------------
 * Drop-in replacement for jmk_store.js that talks to a remote REST backend.
 * Same public API (window.JMK with .get/.find/.add/.update/.remove/.subscribe/...)
 * so all existing apps keep working unchanged.
 *
 * Two-layer design:
 *   - Local cache in memory + localStorage (instant reads, offline-friendly).
 *   - Background sync writes to the backend, polls for changes via /api/changes.
 *
 * Configure the backend URL by setting window.JMK_API_URL BEFORE this script
 * loads, e.g.:
 *   <script>window.JMK_API_URL = 'https://jmk-server.onrender.com';</script>
 *   <script src="jmk_api.js"></script>
 *
 * If JMK_API_URL is empty/unset, falls back to localStorage-only behaviour
 * (same as jmk_store.js).
 */
(function (root) {
  'use strict';

  var API = (root.JMK_API_URL || '').replace(/\/+$/, '');
  var CACHE_KEY  = 'jmk_state_v2';
  var SESSION_KEY = 'jmk_session_v2';
  var TOKEN_KEY  = 'jmk_token_v1';
  var listeners  = [];
  var localState = null;
  var lastVersion = 0;

  // Empty shape — populated by initial sync from backend.
  var EMPTY = {
    islands: [], categories: [], hotels: [], partners: [], activities: [],
    guests: [], bookings: [], payouts: [], flaggedMessages: [], reviews: [],
    partnerRequests: [], notifications: [], settings: {}, _meta: {}
  };

  function readCache(){
    if (localState) return localState;
    try {
      var raw = root.localStorage.getItem(CACHE_KEY);
      localState = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(EMPTY));
    } catch (e){ localState = JSON.parse(JSON.stringify(EMPTY)); }
    return localState;
  }
  function writeCache(s){
    localState = s;
    try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch(e){}
  }
  function emit(evt){ listeners.forEach(function(fn){ try { fn(evt); } catch(e){ console.error(e); } }); }

  function token(){ return root.localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t){ if (t) root.localStorage.setItem(TOKEN_KEY, t); else root.localStorage.removeItem(TOKEN_KEY); }

  function api(path, opts){
    if (!API) return Promise.reject(new Error('JMK_API_URL not configured'));
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var t = token(); if (t) opts.headers['Authorization'] = 'Bearer ' + t;
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    return fetch(API + path, opts).then(function(r){
      if (!r.ok) return r.text().then(function(txt){ throw new Error(r.status+' '+txt) });
      return r.json();
    });
  }

  // ---- Initial full sync ------------------------------------------------
  var COLLECTIONS = ['islands','categories','hotels','partners','activities','guests','bookings','payouts','flaggedMessages','reviews','partnerRequests','notifications'];

  function fullSync(){
    if (!API) return Promise.resolve(false);
    return Promise.all(COLLECTIONS.map(function(c){
      return api('/api/collections/'+c).then(function(rows){ return [c, rows] }).catch(function(){ return [c, []] });
    })).then(function(pairs){
      var s = JSON.parse(JSON.stringify(EMPTY));
      pairs.forEach(function(p){ s[p[0]] = p[1]; });
      return api('/api/settings').then(function(st){ s.settings = st || {}; })
        .catch(function(){ s.settings = {}; })
        .then(function(){
          writeCache(s);
          emit({ type:'change', source:'remote-fullsync' });
          return true;
        });
    });
  }

  function pollChanges(){
    if (!API) return;
    api('/api/changes?since='+lastVersion).then(function(r){
      if (r && r.version && r.version > lastVersion){
        lastVersion = r.version;
        return fullSync();
      }
    }).catch(function(){
      // network blip — wait a bit before retrying
      return new Promise(function(r){ setTimeout(r, 4000) });
    }).then(pollChanges);
  }

  // ---- Public API (mirrors jmk_store.js) --------------------------------
  var JMK = {
    KEY: CACHE_KEY,
    online: !!API,
    apiUrl: API,

    get: function(collection){
      var s = readCache();
      return s[collection] ? JSON.parse(JSON.stringify(s[collection])) : [];
    },
    state: function(){ return readCache(); },
    find: function(collection, id){
      var arr = (readCache()[collection] || []);
      return arr.find(function(x){ return x.id === id; }) || null;
    },
    where: function(collection, predicate){
      return (readCache()[collection] || []).filter(predicate);
    },

    add: function(collection, obj){
      var s = readCache();
      if (!s[collection]) s[collection] = [];
      obj.id = obj.id || (collection.slice(0,2)+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
      obj.createdAt = obj.createdAt || new Date().toISOString();
      s[collection].unshift(obj);
      writeCache(s);
      emit({ type:'change', source:'local' });
      if (API) api('/api/collections/'+collection, { method:'POST', body: obj }).catch(function(e){ console.warn('[JMK API] add failed:', e.message); });
      return obj;
    },
    update: function(collection, id, patch){
      var s = readCache();
      var arr = s[collection] || [];
      var i = arr.findIndex(function(x){ return x.id === id });
      if (i < 0) return null;
      arr[i] = Object.assign({}, arr[i], patch, { updatedAt: new Date().toISOString() });
      writeCache(s);
      emit({ type:'change', source:'local' });
      if (API) api('/api/collections/'+collection+'/'+encodeURIComponent(id), { method:'PATCH', body: patch }).catch(function(e){ console.warn('[JMK API] update failed:', e.message); });
      return arr[i];
    },
    remove: function(collection, id){
      var s = readCache();
      var arr = s[collection] || [];
      var i = arr.findIndex(function(x){ return x.id === id });
      if (i < 0) return false;
      arr.splice(i, 1);
      writeCache(s);
      emit({ type:'change', source:'local' });
      if (API) api('/api/collections/'+collection+'/'+encodeURIComponent(id), { method:'DELETE' }).catch(function(e){ console.warn('[JMK API] remove failed:', e.message); });
      return true;
    },

    settings: function(patch){
      var s = readCache();
      if (patch){
        s.settings = Object.assign({}, s.settings, patch);
        writeCache(s);
        emit({ type:'change', source:'local' });
        if (API) api('/api/settings', { method:'PATCH', body: patch }).catch(function(e){ console.warn('[JMK API] settings failed:', e.message); });
      }
      return s.settings || {};
    },

    // Helpers
    islandsForActivity: function(catId){ return JMK.where('islands', function(i){ return (i.allowedCategories||[]).indexOf(catId)>=0 }); },
    activitiesByPartner: function(pid){ return JMK.where('activities', function(a){ return a.partnerId === pid }); },
    bookingsByPartner:   function(pid){ return JMK.where('bookings',   function(b){ return b.partnerId === pid }); },
    bookingsByHotel:     function(hid){ return JMK.where('bookings',   function(b){ return b.hotelId   === hid }); },
    bookingsByGuest:     function(gid){ return JMK.where('bookings',   function(b){ return b.guestId   === gid }); },
    reviewsByHotel:      function(hid){ return JMK.where('reviews',    function(r){ return r.hotelId   === hid }); },
    reviewsByPartner:    function(pid){ return JMK.where('reviews',    function(r){ return r.partnerId === pid }); },
    notificationsFor:    function(role,id){ return JMK.where('notifications', function(n){ return n.toRole === role && (!id || n.toId === id) }); },

    requestPartnerLeave: function(partnerId, reason){
      var partner = JMK.find('partners', partnerId);
      if (!partner) return null;
      var hotels = JMK.where('hotels', function(h){ return h.islandId === partner.islandId }).map(function(h){ return h.id });
      var req = JMK.add('partnerRequests', {
        partnerId: partnerId, type:'leave', reason: reason||'',
        requestedAt: new Date().toISOString(), status:'open',
        replacementId:null, affectedHotels: hotels, notifiedHotels: []
      });
      hotels.forEach(function(hid){
        JMK.add('notifications', {
          toRole:'hotelier', toId:hid, type:'partner_leave',
          title:'Συνεργάτης ζητά αποχώρηση',
          body: (partner.businessName||partner.name)+' ζήτησε αποχώρηση. Η JMK ψάχνει αντικαταστάτη.',
          read:false, actionable:true, requestId:req.id
        });
      });
      JMK.add('notifications', { toRole:'admin', toId:null, type:'partner_leave', title:'Νέα αίτηση αποχώρησης', body:(partner.businessName||partner.name), read:false, actionable:true, requestId:req.id });
      return req;
    },
    markRequestNotified: function(reqId, hotelId){
      var r = JMK.find('partnerRequests', reqId); if (!r) return;
      var arr = (r.notifiedHotels||[]).slice();
      if (arr.indexOf(hotelId) < 0) arr.push(hotelId);
      JMK.update('partnerRequests', reqId, { notifiedHotels: arr });
    },

    computeSplit: function(total, hotelPct){
      var s = readCache().settings || {};
      var hPct = hotelPct != null ? hotelPct : (s.defaultHotelCommissionPct || 5);
      var hotel   = +(total * (hPct/100)).toFixed(2);
      var stripe  = +(total * ((s.stripeFeePct||1.4)/100)).toFixed(2);
      var jmk     = +(total * ((s.jmkCommissionPct||12.3)/100)).toFixed(2);
      var reserve = +(total * ((s.reservePct||1.8)/100)).toFixed(2);
      var partner = +(total - hotel - stripe - jmk - reserve).toFixed(2);
      return { partner: partner, hotel: hotel, jmk: jmk, stripe: stripe, reserve: reserve };
    },

    subscribe: function(fn){
      listeners.push(fn);
      return function(){ var i = listeners.indexOf(fn); if (i>=0) listeners.splice(i,1); };
    },

    reset: function(){
      try { root.localStorage.removeItem(CACHE_KEY); } catch(e){}
      localState = null;
      if (API) {
        return api('/api/reset', { method:'POST' }).then(function(){
          return fullSync();
        });
      } else {
        emit({ type:'reset' });
        return Promise.resolve();
      }
    },

    // Session — kept locally only; real auth handled via login() below.
    get session(){ try { return JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null'); } catch(e){ return null; } },
    setSession: function(s){ root.localStorage.setItem(SESSION_KEY, JSON.stringify(s)); emit({ type:'session', session:s }); },
    clearSession: function(){ root.localStorage.removeItem(SESSION_KEY); setToken(''); emit({ type:'session', session:null }); },

    // Auth (real, when API is configured)
    login: function(email, password){
      if (!API) return Promise.reject(new Error('No backend configured'));
      return api('/api/auth/login', { method:'POST', body:{ email:email, password:password } })
        .then(function(r){ setToken(r.token); JMK.setSession(r.user); return r.user; });
    },
    register: function(email, password, role, name){
      if (!API) return Promise.reject(new Error('No backend configured'));
      return api('/api/auth/register', { method:'POST', body:{ email:email, password:password, role:role, name:name } })
        .then(function(r){ setToken(r.token); JMK.setSession(r.user); return r.user; });
    },

    sync: fullSync
  };

  // Cross-tab cache change propagation
  if (root.addEventListener) {
    root.addEventListener('storage', function(e){
      if (e.key === CACHE_KEY) { localState = null; emit({ type:'change', source:'remote-tab' }); }
      if (e.key === SESSION_KEY) emit({ type:'session', source:'remote-tab' });
    });
  }

  // Only take over from jmk_store.js when a backend URL is configured.
  if (API) {
    root.JMK = JMK;
    fullSync().then(function(){
      // give it 2s before starting the long-poll loop
      setTimeout(pollChanges, 2000);
    });
    console.log('[JMK API] backend mode active →', API);
  } else {
    console.log('[JMK API] no JMK_API_URL — staying offline (jmk_store.js takes precedence).');
  }
})(typeof window !== 'undefined' ? window : globalThis);
