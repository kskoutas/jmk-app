/**
 * JMK · Bridge
 * ------------
 * Connects existing prototype apps (Guest, Partner, Hotelier) with the shared
 * JMK store. Adds a floating "live" status pill, syncs key user actions to
 * localStorage, and updates instantly across tabs/devices.
 *
 * Drop in: <script src="jmk_store.js"></script><script src="jmk_bridge.js"></script>
 */
(function (root) {
  'use strict';

  if (typeof JMK === 'undefined') { console.warn('[JMK Bridge] store missing'); return; }

  var APP =
    document.title.match(/Guest|Επισκέπτ/i)   ? 'guest'   :
    document.title.match(/Partner|Συνεργ/i)   ? 'partner' :
    document.title.match(/Hotelier|Ξενοδ/i)   ? 'hotelier':
    document.title.match(/Admin/i)            ? 'admin'   : 'unknown';

  /* ---------- Live status pill + app switcher ---------- */
  function injectPill(){
    if (document.getElementById('jmk-live-pill')) return;
    var css =
      '#jmk-live-pill{position:fixed;bottom:16px;right:16px;z-index:9999;'+
      'background:rgba(15,26,31,.92);color:#fff;padding:8px 14px;border-radius:99px;'+
      'font:600 11.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;'+
      'letter-spacing:.3px;box-shadow:0 6px 20px rgba(0,0,0,.25);'+
      'display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none;backdrop-filter:blur(6px)}'+
      '#jmk-live-pill .dot{width:7px;height:7px;border-radius:50%;background:#36D17B;'+
      'box-shadow:0 0 0 0 rgba(54,209,123,.7);animation:jmkpulse 1.6s infinite}'+
      '@keyframes jmkpulse{0%{box-shadow:0 0 0 0 rgba(54,209,123,.7)}70%{box-shadow:0 0 0 10px rgba(54,209,123,0)}100%{box-shadow:0 0 0 0 rgba(54,209,123,0)}}'+
      '#jmk-live-pill:hover{background:#1A2B30}'+
      '#jmk-live-pill .role{opacity:.7;text-transform:uppercase;font-size:10px;letter-spacing:.6px;margin-right:4px;border-right:1px solid rgba(255,255,255,.2);padding-right:7px}'+
      '@media (max-width:480px){#jmk-live-pill{bottom:80px;right:12px;font-size:10.5px;padding:6px 11px}}'+
      '#jmk-switcher{position:fixed;bottom:60px;right:16px;background:#fff;border-radius:14px;padding:8px;'+
      'box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:10000;display:none;min-width:220px;border:1px solid #E1E7EA}'+
      '#jmk-switcher.open{display:block}'+
      '#jmk-switcher a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;'+
      'color:#0F1A1F;text-decoration:none;font:600 13px -apple-system,sans-serif}'+
      '#jmk-switcher a:hover{background:#F4F6F8}'+
      '#jmk-switcher a.current{background:#E8F1F2;color:#0F4C5C}'+
      '#jmk-switcher .ic{font-size:18px;width:24px;text-align:center}'+
      '#jmk-switcher hr{border:0;border-top:1px solid #E1E7EA;margin:6px 4px}'+
      '#jmk-switcher .reset{color:#9A2A1B;font-weight:600}'+
      '@media (max-width:480px){#jmk-switcher{bottom:124px;right:12px;left:12px}}';
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);

    var p = document.createElement('div');
    p.id = 'jmk-live-pill';
    p.title = 'JMK Live · click για app switcher';
    p.innerHTML = '<span class="dot"></span><span class="role" id="jmk-pill-role">'+APP+'</span><span id="jmk-pill-text">…</span>';
    p.onclick = function(e){
      e.stopPropagation();
      document.getElementById('jmk-switcher').classList.toggle('open');
    };
    document.body.appendChild(p);

    var sw = document.createElement('div');
    sw.id = 'jmk-switcher';
    sw.innerHTML =
      '<a href="JMK_App.html"          class="'+(APP==='unknown'?'current':'')+'"><span class="ic">🏠</span>Demo Center</a>'+
      '<a href="JMK_Guest_App.html"    class="'+(APP==='guest'?'current':'')+'"><span class="ic">🧳</span>Guest (Maria)</a>'+
      '<a href="JMK_Hotelier_App.html" class="'+(APP==='hotelier'?'current':'')+'"><span class="ic">🏨</span>Hotelier (Naxos Boutique)</a>'+
      '<a href="JMK_Partner_App.html"  class="'+(APP==='partner'?'current':'')+'"><span class="ic">⛵</span>Partner (Captain Niko)</a>'+
      '<a href="JMK_Admin_App.html"    class="'+(APP==='admin'?'current':'')+'"><span class="ic">🛠️</span>Admin (εσύ)</a>'+
      '<hr>'+
      '<a class="reset" href="javascript:void(0)" onclick="if(confirm(\'Reset demo data;\')){JMK.reset();location.reload()}"><span class="ic">↻</span>Reset δεδομένων</a>';
    document.body.appendChild(sw);
    document.addEventListener('click', function(e){
      if (!sw.contains(e.target) && e.target !== p) sw.classList.remove('open');
    });
    refreshPill();
  }

  function refreshPill(){
    var t = document.getElementById('jmk-pill-text'); if (!t) return;
    var bks = JMK.get('bookings').length;
    var prs = JMK.get('partners').length;
    var hts = JMK.get('hotels').length;
    t.textContent = '📅 '+bks+' · 🤝 '+prs+' · 🏨 '+hts;
  }

  /* ---------- App-specific hooks ---------- */
  var sessionForApp = {
    guest:    { role:'guest',    name:'Maria Konstantinou', guestId:'g-maria',  hotelId:'h-naxos-1' },
    partner:  { role:'partner',  name:'Captain Niko',       partnerId:'p-niko' },
    hotelier: { role:'hotelier', name:'Naxos Boutique',     hotelId:'h-naxos-1' },
    admin:    { role:'admin',    name:'Konstantinos' }
  };

  function ensureSession(){
    if (JMK.session && JMK.session.role === APP) return;
    if (sessionForApp[APP]) JMK.setSession(sessionForApp[APP]);
  }

  /* GUEST: when reaching success screen, write a booking to store */
  function hookGuest(){
    if (typeof root.goto !== 'function') return;
    var orig = root.goto;
    root.goto = function(id){
      var r = orig.apply(this, arguments);
      if (id === 's-success') writeGuestBooking();
      return r;
    };
  }
  function writeGuestBooking(){
    try {
      var sess = JMK.session || sessionForApp.guest;
      var act = JMK.get('activities').filter(function(a){return a.status==='active'})[0]
             || JMK.get('activities')[0] || { id:'a-?', title:'Day Cruise', price:198, partnerId:'p-niko' };
      var code = 'JMK-' + Math.random().toString(36).slice(2,6).toUpperCase();
      var total = (act.price || 198) * 2;
      var st = JMK.settings();
      var split = JMK.computeSplit(total, st.defaultHotelCommissionPct);
      var b = JMK.add('bookings', {
        id: 'b-' + Date.now().toString(36),
        code: code,
        guestId:    sess.guestId    || 'g-maria',
        hotelId:    sess.hotelId    || 'h-naxos-1',
        partnerId:  act.partnerId   || 'p-niko',
        activityId: act.id,
        date:       new Date(Date.now()+86400000).toISOString().slice(0,10),
        time:       '10:00',
        people:     2,
        totalAmount: total,
        partnerAmount:  split.partner,
        hotelCommission: split.hotel,
        jmkCommission:  split.jmk,
        stripeFee:      split.stripe,
        status:     'confirmed',
        paidAt:     new Date().toISOString()
      });
      console.log('[JMK Bridge] booking saved', code);
      flashToast('✓ Κράτηση '+code+' αποθηκεύτηκε στο JMK store');
    } catch (e) { console.warn('[JMK Bridge]', e); }
  }

  /* PARTNER: only update bookings count badge; no self-leave button (replaced by hotel-side flow) */
  function hookPartner(){
    function refreshPartner(){
      var sess = JMK.session || sessionForApp.partner;
      var bks  = JMK.bookingsByPartner(sess.partnerId || 'p-niko');
      var elBadge = document.querySelector('[data-jmk-bookings]') || document.querySelector('.unread-count');
      if (elBadge) elBadge.textContent = bks.filter(function(b){return b.status==='paid'||b.status==='confirmed'}).length;
    }
    refreshPartner();
    var pending = null;
    JMK.subscribe(function(){
      if (pending) return;
      pending = setTimeout(function(){ pending = null; refreshPartner() }, 250);
    });
  }

  /* Bypass login screens for demo: auto-show the dashboard */
  function autoLoginHotelier(){
    try {
      if (!root.currentUser && typeof root.bootApp === 'function') {
        root.currentUser = { email:'demo@jmk.gr', name:'Γιάννης Παπαδόπουλος', hotel:'Naxos Boutique Hotel', firstName:'Γιάννης' };
        root.bootApp();
      } else if (typeof root.show === 'function') {
        root.show('page-dashboard');
      }
    } catch(e){ console.warn('[JMK Bridge] auto-login hotelier', e); }
  }
  function autoLoginPartner(){
    try {
      var screens = document.querySelectorAll('.screen');
      // try common partner home screen ids
      ['s-home','screen-home','s-listings','s-app'].forEach(function(id){
        if (document.getElementById(id) && typeof root.goto === 'function') {
          try { root.goto(id) } catch(e){}
        }
      });
    } catch(e){ console.warn('[JMK Bridge] auto-login partner', e); }
  }

  /* HOTELIER: replace mock KPIs, bookings, add notifications + guest activities + reviews */
  function hookHotelier(){
    function fmtNum(n){ return Number(n||0).toLocaleString('el-GR') }
    function fmtEur(n){ return '€' + Number(n||0).toLocaleString('el-GR',{maximumFractionDigits:0}) }
    function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]}) }
    function formatDate(d){ if(!d) return '—'; var x=new Date(d); return isNaN(x)?d:x.toLocaleDateString('el-GR',{day:'2-digit',month:'short'}) }
    function statusBadge(s){
      var map = {
        paid:        ['#E5F4E5','#1F6F3D','Πληρωμένη'],
        completed:   ['#E5F4E5','#1F6F3D','Ολοκληρώθηκε'],
        confirmed:   ['#E6EFF1','#0F4C5C','Επιβεβαιωμένη'],
        pending:     ['#F7ECDA','#7A4A18','Εκκρεμεί'],
        canceled:    ['#FCE9E5','#9A2A1B','Ακυρώθηκε'],
        cancelled:   ['#FCE9E5','#9A2A1B','Ακυρώθηκε'],
        chat:        ['#FFF3CD','#7A4A18','Σε chat'],
        chat_open:   ['#FFF3CD','#7A4A18','Σε chat']
      };
      var x = map[s] || ['#EDF1F4','#4A5A65', s||'—'];
      return '<span style="display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;background:'+x[0]+';color:'+x[1]+'">'+x[2]+'</span>';
    }
    function bookingTotal(b){ return b.totalAmount || b.total || 0 }
    function bookingHotelCut(b, hPct){
      if (typeof b.hotelCommission === 'number') return b.hotelCommission;
      return bookingTotal(b) * (hPct/100);
    }

    /* ---- Inject extra UI sections once (notifications banner, guest activities, reviews) ---- */
    function ensureExtraSections(){
      var dash = document.getElementById('page-dashboard');
      if (!dash || dash._jmkExtra) return;
      dash._jmkExtra = true;

      // CSS used by injected sections
      var css = document.createElement('style');
      css.textContent =
        '.jmk-banner{margin:0 0 16px;padding:14px 16px;border-radius:12px;background:#FFF8E6;border:1px solid #F2D472;display:flex;gap:12px;align-items:flex-start}'+
        '.jmk-banner.danger{background:#FCEEEC;border-color:#F1C7C0}'+
        '.jmk-banner .ic{font-size:22px;flex-shrink:0}'+
        '.jmk-banner b{display:block;font-size:13.5px;margin-bottom:2px}'+
        '.jmk-banner span{font-size:12.5px;color:#5A4A30;display:block}'+
        '.jmk-banner .acts{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}'+
        '.jmk-banner button{font-size:12px;font-weight:700;padding:7px 12px;border-radius:8px;border:1px solid #E1E7EA;background:#fff;cursor:pointer}'+
        '.jmk-banner button.primary{background:#0F4C5C;color:#fff;border-color:#0F4C5C}'+
        '.jmk-banner button.primary:hover{filter:brightness(1.08)}'+
        '.jmk-pop{position:fixed;top:60px;right:16px;width:340px;max-width:calc(100vw - 24px);max-height:70vh;overflow:auto;background:#fff;border:1px solid #E1E7EA;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.18);z-index:1000;display:none}'+
        '.jmk-pop.open{display:block}'+
        '.jmk-pop h4{margin:0;padding:14px 16px;border-bottom:1px solid #E1E7EA;font-size:14px}'+
        '.jmk-pop .row{padding:12px 16px;border-bottom:1px solid #F1F4F6;cursor:pointer}'+
        '.jmk-pop .row:hover{background:#FAFBFC}'+
        '.jmk-pop .row.unread{background:#FFF8E6}'+
        '.jmk-pop .row b{display:block;font-size:13px;margin-bottom:2px}'+
        '.jmk-pop .row span{font-size:12px;color:#6B7B82;display:block}'+
        '.jmk-pop .row em{font-size:11px;color:#9AA8AF;font-style:normal}'+
        '.jmk-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9px;background:#F4F6F8;border:1px solid #E1E7EA;cursor:pointer;font-size:16px}'+
        '.jmk-bell:hover{background:#E8F1F2}'+
        '.jmk-bell .badge{position:absolute;top:-4px;right:-4px;background:#C0392B;color:#fff;font-size:10px;font-weight:800;min-width:18px;height:18px;border-radius:99px;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff}'+
        '.jmk-card{background:#fff;border:1px solid #E1E7EA;border-radius:14px;padding:18px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.04)}'+
        '.jmk-card h3{margin:0 0 4px;font-size:16px;font-weight:700}'+
        '.jmk-card .sub{font-size:12px;color:#6B7B82;margin-bottom:14px}'+
        '.jmk-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}'+
        '@media(max-width:780px){.jmk-grid{grid-template-columns:1fr}}'+
        '.guest-act{padding:12px;border:1px solid #E1E7EA;border-radius:10px;margin-bottom:8px;display:flex;gap:10px;align-items:center}'+
        '.guest-act .av{width:34px;height:34px;border-radius:50%;background:#0F4C5C;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0}'+
        '.guest-act .body{flex:1;min-width:0}'+
        '.guest-act b{font-size:13px;display:block}'+
        '.guest-act small{font-size:11.5px;color:#6B7B82}'+
        '.review-card{padding:14px;border:1px solid #E1E7EA;border-radius:10px;margin-bottom:8px}'+
        '.review-card .h{display:flex;align-items:center;gap:8px;margin-bottom:6px}'+
        '.review-card .h b{font-size:13px}'+
        '.review-card .stars{color:#F1B400;font-size:13px;letter-spacing:1px}'+
        '.review-card .text{font-size:13px;line-height:1.45;color:#1A1A1A}'+
        '.review-card .meta{font-size:11px;color:#6B7B82;margin-top:6px}';
      document.head.appendChild(css);

      // Banners container right before stats-grid
      var statsGrid = dash.querySelector('.stats-grid');
      var bannersWrap = document.createElement('div');
      bannersWrap.id = 'jmk-banners';
      if (statsGrid && statsGrid.parentNode) statsGrid.parentNode.insertBefore(bannersWrap, statsGrid);

      // Guest activities + Reviews two-column section before "Πρόσφατες κρατήσεις"
      var extra = document.createElement('div');
      extra.className = 'jmk-grid';
      extra.id = 'jmk-extra';
      extra.innerHTML =
        '<div class="jmk-card"><h3>🎯 Δραστηριότητες πελατών</h3>'+
          '<div class="sub">Τι έχουν επιλέξει οι guests σου · ζωντανά</div>'+
          '<div id="jmk-guest-acts"></div>'+
        '</div>'+
        '<div class="jmk-card"><h3>⭐ Κριτικές πελατών</h3>'+
          '<div class="sub">Πρόσφατες αξιολογήσεις από guests του ξενοδοχείου σου</div>'+
          '<div id="jmk-reviews"></div>'+
        '</div>';
      // insert before the existing "Πρόσφατες κρατήσεις" card
      var allCards = dash.querySelectorAll('.card');
      var inserted = false;
      allCards.forEach(function(c){
        if (!inserted && /Πρόσφατες κρατήσεις/.test(c.textContent)) {
          c.parentNode.insertBefore(extra, c);
          inserted = true;
        }
      });
      if (!inserted) dash.appendChild(extra);

      // Notification bell + popover + replacement-request button in topbar
      var topbar = dash.querySelector('.topbar .top-actions');
      if (topbar) {
        // Request replacement button (next to bell)
        var repBtn = document.createElement('button');
        repBtn.id = 'jmk-rep-btn';
        repBtn.style.cssText = 'background:#fff;color:#9A2A1B;border:1px solid #F1C7C0;padding:8px 13px;border-radius:9px;font:600 12.5px -apple-system,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:5px';
        repBtn.innerHTML = '📩 Αίτηση αντικατάστασης συνεργάτη';
        repBtn.title = 'Ζήτησε από την JMK να αντικαταστήσει έναν συνεργάτη που δεν σε εξυπηρετεί';
        repBtn.onmouseover = function(){ this.style.background='#FCEEEC' };
        repBtn.onmouseout  = function(){ this.style.background='#fff' };
        repBtn.onclick = function(){ JMK_BRIDGE.openReplacementRequest() };
        topbar.insertBefore(repBtn, topbar.firstChild);

        var bell = document.createElement('button');
        bell.className = 'jmk-bell';
        bell.id = 'jmk-bell';
        bell.title = 'Ειδοποιήσεις';
        bell.innerHTML = '🔔<span class="badge" id="jmk-bell-count" style="display:none">0</span>';
        bell.onclick = function(e){ e.stopPropagation(); document.getElementById('jmk-pop').classList.toggle('open') };
        topbar.insertBefore(bell, topbar.firstChild);

        var pop = document.createElement('div');
        pop.className = 'jmk-pop';
        pop.id = 'jmk-pop';
        pop.innerHTML = '<h4>Ειδοποιήσεις</h4><div id="jmk-notifs"></div>';
        document.body.appendChild(pop);
        document.addEventListener('click', function(e){
          if (!pop.contains(e.target) && e.target !== bell) pop.classList.remove('open');
        });
      }
    }

    function renderHotelierBanners(hotelId){
      var wrap = document.getElementById('jmk-banners'); if (!wrap) return;
      var notifs = JMK.notificationsFor('hotelier', hotelId)
        .filter(function(n){return !n.read})
        .sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt)});
      if (!notifs.length) { wrap.innerHTML = ''; return; }
      wrap.innerHTML = notifs.slice(0,2).map(function(n){
        var icon = n.type==='replacement_found'?'✅':n.type==='new_review'?'⭐':n.type==='replacement_acknowledged'?'🔄':'🔔';
        return '<div class="jmk-banner">'+
          '<div class="ic">'+icon+'</div>'+
          '<div><b>'+escapeHtml(n.title)+'</b><span>'+escapeHtml(n.body)+'</span></div>'+
          '<div class="acts"><button class="primary" onclick="JMK_BRIDGE.markRead(\''+n.id+'\')">Κατανοητό</button></div>'+
        '</div>';
      }).join('');
    }

    function renderGuestActivities(hotelId){
      var box = document.getElementById('jmk-guest-acts'); if (!box) return;
      var bks = JMK.bookingsByHotel(hotelId).slice().sort(function(a,b){return new Date(b.date)-new Date(a.date)}).slice(0,8);
      if (!bks.length) { box.innerHTML = '<div style="padding:18px;text-align:center;color:#6B7B82;font-size:13px">Καμία δραστηριότητα ακόμη</div>'; return; }
      box.innerHTML = bks.map(function(b){
        var g = JMK.find('guests', b.guestId) || {name:'—'};
        var a = JMK.find('activities', b.activityId) || {title:'—', coverIcon:'🎯'};
        var initials = (g.name||'?').split(/\s+/).map(function(w){return w[0]||''}).slice(0,2).join('').toUpperCase();
        return '<div class="guest-act">'+
          '<div class="av">'+escapeHtml(initials)+'</div>'+
          '<div class="body"><b>'+escapeHtml(g.name)+'</b>'+(g.room?' <small>· Δωμ. '+escapeHtml(g.room)+'</small>':'')+
          '<small style="display:block">'+(a.coverIcon||'')+' '+escapeHtml(a.title)+' · '+formatDate(b.date)+(b.time?' '+escapeHtml(b.time):'')+(b.people?' · '+b.people+' άτομα':'')+'</small></div>'+
          '<div>'+statusBadge(b.status)+'</div>'+
        '</div>';
      }).join('');
    }

    function renderHotelReviews(hotelId){
      var box = document.getElementById('jmk-reviews'); if (!box) return;
      var rs = JMK.reviewsByHotel(hotelId).slice().sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt)}).slice(0,4);
      if (!rs.length) { box.innerHTML = '<div style="padding:18px;text-align:center;color:#6B7B82;font-size:13px">Καμία κριτική ακόμη</div>'; return; }
      box.innerHTML = rs.map(function(r){
        var g = JMK.find('guests', r.guestId) || {name:'Guest'};
        var a = JMK.find('activities', r.activityId) || {title:'—'};
        var p = JMK.find('partners', r.partnerId) || {name:'—', businessName:''};
        var stars = '★'.repeat(r.rating) + '☆'.repeat(5-r.rating);
        return '<div class="review-card">'+
          '<div class="h"><b>'+escapeHtml(g.name)+'</b><span class="stars">'+stars+'</span><em style="margin-left:auto;font-size:11px;color:#6B7B82">'+(r.lang||'').toUpperCase()+'</em></div>'+
          '<div class="text">"'+escapeHtml(r.text)+'"</div>'+
          '<div class="meta">'+escapeHtml(a.title)+' · '+escapeHtml(p.businessName||p.name)+' · '+formatDate(r.createdAt)+'</div>'+
        '</div>';
      }).join('');
    }

    function renderNotificationsPop(hotelId){
      var box = document.getElementById('jmk-notifs');
      var bell = document.getElementById('jmk-bell-count');
      if (!box || !bell) return;
      var notifs = JMK.notificationsFor('hotelier', hotelId).slice().sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt)});
      var unread = notifs.filter(function(n){return !n.read}).length;
      bell.textContent = unread;
      bell.style.display = unread > 0 ? 'flex' : 'none';
      box.innerHTML = notifs.slice(0,12).map(function(n){
        var icon = n.type==='partner_leave'?'⚠️':n.type==='partner_pause'?'⏸':n.type==='new_review'?'⭐':n.type==='replacement_found'?'✅':'🔔';
        return '<div class="row '+(n.read?'':'unread')+'" onclick="JMK_BRIDGE.markRead(\''+n.id+'\')">'+
          '<b>'+icon+' '+escapeHtml(n.title)+'</b>'+
          '<span>'+escapeHtml(n.body)+'</span>'+
          '<em>'+formatDate(n.createdAt)+'</em>'+
        '</div>';
      }).join('') || '<div style="padding:24px;text-align:center;color:#6B7B82;font-size:13px">Καμία ειδοποίηση</div>';
    }

    function refreshHotelierUI(){
      var sess = JMK.session || sessionForApp.hotelier;
      var hotelId = sess.hotelId || 'h-naxos-1';
      var hot = JMK.find('hotels', hotelId) || {};
      var st  = JMK.settings();
      var hotelPct = hot.commissionPct || st.defaultHotelCommissionPct;

      var allBks = JMK.bookingsByHotel(hotelId);
      var paid   = allBks.filter(function(b){return ['paid','completed','confirmed'].indexOf(b.status)>=0});
      var revenue = paid.reduce(function(a,b){ return a + bookingHotelCut(b, hotelPct) }, 0);
      var activeGuests = (JMK.get('guests')||[]).filter(function(g){return g.hotelId===hotelId}).length;

      var counters = document.querySelectorAll('[data-counter]');
      var values = [Math.round(revenue), allBks.length, activeGuests, 62];
      counters.forEach(function(el, i){ if (i < values.length) el.textContent = fmtNum(values[i]) });

      document.querySelectorAll('.tab').forEach(function(t){
        if (/^Όλες\s*\(/.test(t.textContent)) t.textContent = 'Όλες ('+allBks.length+')';
      });

      function rowHtml(b){
        var g   = JMK.find('guests',     b.guestId)    || {name:'—', room:''};
        var act = JMK.find('activities', b.activityId) || {title:'—'};
        var p   = JMK.find('partners',   b.partnerId)  || {name:'—'};
        return '<tr>'+
          '<td><b>'+escapeHtml(g.name)+'</b>'+(g.room?'<div style="font-size:11px;color:#6B7B82">Δωμ. '+escapeHtml(g.room)+'</div>':'')+'</td>'+
          '<td>'+escapeHtml(act.title)+'</td>'+
          '<td>'+escapeHtml(p.businessName||p.name)+'</td>'+
          '<td>'+formatDate(b.date)+'</td>'+
          '<td><b>'+fmtEur(bookingTotal(b))+'</b></td>'+
          '<td style="color:#1F6F3D"><b>'+fmtEur(bookingHotelCut(b, hotelPct))+'</b></td>'+
          '<td>'+statusBadge(b.status)+'</td>'+
        '</tr>';
      }
      var sorted = allBks.slice().sort(function(a,b){return new Date(b.createdAt||0)-new Date(a.createdAt||0)});
      var rec = document.getElementById('bookingsTbody');
      if (rec) rec.innerHTML = sorted.slice(0,5).map(rowHtml).join('') ||
        '<tr><td colspan="7" style="text-align:center;padding:24px;color:#6B7B82">Καμία κράτηση ακόμη</td></tr>';
      var all = document.getElementById('bookingsAllTbody');
      if (all) all.innerHTML = sorted.map(rowHtml).join('') ||
        '<tr><td colspan="7" style="text-align:center;padding:24px;color:#6B7B82">Καμία κράτηση</td></tr>';

      ensureExtraSections();
      renderHotelierBanners(hotelId);
      renderGuestActivities(hotelId);
      renderHotelReviews(hotelId);
      renderNotificationsPop(hotelId);
    }

    // debounced refresh — avoid thrashing the DOM on every store change
    var pending = null;
    function scheduleRefresh(){
      if (pending) return;
      pending = setTimeout(function(){ pending = null; refreshHotelierUI(); }, 250);
    }
    // first render after the page actually has the dashboard visible (post auto-login)
    setTimeout(refreshHotelierUI, 600);
    JMK.subscribe(scheduleRefresh);

    // expose helpers used from injected HTML
    root.JMK_BRIDGE = root.JMK_BRIDGE || {};
    root.JMK_BRIDGE.markRead = function(id){ JMK.update('notifications', id, {read:true}); };
    root.JMK_BRIDGE.acknowledgePartnerLeave = function(notifId){
      var n = JMK.find('notifications', notifId);
      JMK.update('notifications', notifId, {read:true});
      if (n && n.requestId) JMK.markRequestNotified(n.requestId, n.toId);
      flashToast('Σε ευχαριστούμε. Η JMK ψάχνει αντικαταστάτη.');
    };
    root.JMK_BRIDGE.openReplacementRequest = function(){ openReplacementModal(); };

    /* ---- Hotel-initiated replacement-request modal ---- */
    function openReplacementModal(){
      var sess = JMK.session || sessionForApp.hotelier;
      var hotelId = sess.hotelId || 'h-naxos-1';
      var hotel = JMK.find('hotels', hotelId) || {};
      // partners that the hotel has worked with (via bookings) + others on same island
      var partnerIds = {};
      JMK.bookingsByHotel(hotelId).forEach(function(b){ if (b.partnerId) partnerIds[b.partnerId] = true; });
      JMK.where('partners', function(p){ return p.islandId === hotel.islandId }).forEach(function(p){ partnerIds[p.id] = true; });
      var partners = Object.keys(partnerIds).map(function(id){ return JMK.find('partners', id) }).filter(Boolean);

      var modal = document.getElementById('jmk-replacement-modal');
      if (!modal){
        var css = document.createElement('style');
        css.textContent =
          '#jmk-replacement-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:none;align-items:center;justify-content:center;padding:20px}'+
          '#jmk-replacement-modal.show{display:flex}'+
          '#jmk-replacement-modal .box{background:#fff;border-radius:14px;width:100%;max-width:480px;padding:22px;max-height:85vh;overflow:auto}'+
          '#jmk-replacement-modal h3{margin:0 0 6px;font-size:17px}'+
          '#jmk-replacement-modal p{font-size:13px;color:#6B7B82;margin:0 0 14px;line-height:1.5}'+
          '#jmk-replacement-modal label{font-size:12px;font-weight:700;color:#6B7B82;display:block;margin:10px 0 6px;letter-spacing:.3px}'+
          '#jmk-replacement-modal select,#jmk-replacement-modal textarea{width:100%;border:1px solid #E1E7EA;border-radius:10px;padding:10px;font:inherit;outline:none}'+
          '#jmk-replacement-modal textarea{min-height:70px;resize:vertical}'+
          '#jmk-replacement-modal select:focus,#jmk-replacement-modal textarea:focus{border-color:#0F4C5C}'+
          '#jmk-replacement-modal .acts{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}'+
          '#jmk-replacement-modal button{padding:10px 16px;border-radius:9px;border:1px solid #E1E7EA;background:#fff;font:600 13px -apple-system,sans-serif;cursor:pointer}'+
          '#jmk-replacement-modal button.primary{background:#0F4C5C;color:#fff;border-color:#0F4C5C}';
        document.head.appendChild(css);

        modal = document.createElement('div');
        modal.id = 'jmk-replacement-modal';
        document.body.appendChild(modal);
      }
      modal.innerHTML =
        '<div class="box">'+
          '<h3>📩 Αίτηση αντικατάστασης συνεργάτη</h3>'+
          '<p>Επίλεξε τον συνεργάτη που ΔΕΝ θες να συνεργάζεσαι πλέον. Η ομάδα JMK θα τον αντικαταστήσει με άλλον στην ίδια κατηγορία και θα σε ενημερώσουμε.</p>'+
          '<label>Συνεργάτης</label>'+
          '<select id="jmk-rep-partner">'+ partners.map(function(p){
            var cat = JMK.find('categories', p.category) || {icon:'',name:p.category};
            return '<option value="'+p.id+'">'+cat.icon+' '+escapeHtml(p.businessName||p.name)+' · '+escapeHtml(cat.name)+'</option>';
          }).join('') + (partners.length===0 ? '<option value="">— Κανένας διαθέσιμος —</option>':'') +'</select>'+
          '<label>Λόγος (προαιρετικό)</label>'+
          '<textarea id="jmk-rep-reason" placeholder="π.χ. αργές απαντήσεις, χαμηλή ποιότητα, παράπονα πελατών..."></textarea>'+
          '<div class="acts">'+
            '<button onclick="document.getElementById(\'jmk-replacement-modal\').classList.remove(\'show\')">Άκυρο</button>'+
            '<button class="primary" onclick="JMK_BRIDGE.submitReplacementRequest()">Υποβολή αίτησης</button>'+
          '</div>'+
        '</div>';
      modal.classList.add('show');
    }
    root.JMK_BRIDGE.submitReplacementRequest = function(){
      var sess = JMK.session || sessionForApp.hotelier;
      var hotelId = sess.hotelId || 'h-naxos-1';
      var hotel = JMK.find('hotels', hotelId) || {name:'Hotel'};
      var partnerId = (document.getElementById('jmk-rep-partner')||{}).value;
      var reason = (document.getElementById('jmk-rep-reason')||{}).value || '';
      if (!partnerId) { flashToast('Διάλεξε συνεργάτη'); return; }
      var partner = JMK.find('partners', partnerId) || {};
      // create request
      var req = JMK.add('partnerRequests', {
        partnerId: partnerId,
        type: 'hotel_replacement',
        reason: reason,
        requestedBy: hotelId,
        requestedByName: hotel.name,
        requestedAt: new Date().toISOString(),
        status: 'open',
        replacementId: null,
        affectedHotels: [hotelId],
        notifiedHotels: [hotelId]
      });
      // notify admin
      JMK.add('notifications', {
        toRole:'admin', toId:null, type:'hotel_replacement',
        title:'Ξενοδοχείο ζητάει αντικατάσταση συνεργάτη',
        body: hotel.name + ' → '+(partner.businessName||partner.name)+' ('+(reason || 'χωρίς αιτιολόγηση')+')',
        read:false, actionable:true, requestId:req.id
      });
      // confirmation back to hotel
      JMK.add('notifications', {
        toRole:'hotelier', toId:hotelId, type:'replacement_acknowledged',
        title:'Παραλάβαμε την αίτησή σου',
        body:'Η JMK ψάχνει αντικαταστάτη για '+(partner.businessName||partner.name)+'. Θα σε ενημερώσουμε όταν βρεθεί.',
        read:false, actionable:false, requestId:req.id
      });
      document.getElementById('jmk-replacement-modal').classList.remove('show');
      flashToast('✓ Η αίτηση στάλθηκε στην ομάδα JMK');
    };
  }

  /* ---------- Toast ---------- */
  function flashToast(msg){
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);'+
      'background:#0F1A1F;color:#fff;padding:11px 18px;border-radius:10px;'+
      'font:600 13px -apple-system,sans-serif;z-index:99999;box-shadow:0 10px 30px rgba(0,0,0,.3);'+
      'opacity:0;transition:opacity .25s';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function(){ t.style.opacity = '1' });
    setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){t.remove()},300) }, 2400);
  }

  /* ---------- Boot ---------- */
  function boot(){
    ensureSession();
    injectPill();
    if (APP === 'guest')    hookGuest();
    if (APP === 'partner')  { hookPartner();  setTimeout(autoLoginPartner,  100); }
    if (APP === 'hotelier') { hookHotelier(); setTimeout(autoLoginHotelier, 100); }
    JMK.subscribe(refreshPill);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  root.JMK_BRIDGE = { app: APP, refresh: refreshPill, writeGuestBooking: writeGuestBooking };
})(typeof window !== 'undefined' ? window : globalThis);
