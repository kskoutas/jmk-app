/**
 * JMK · Shared Store
 * ------------------
 * Cross-app state via localStorage. All four apps (Guest, Partner, Hotelier, Admin)
 * read & write here. The `storage` event keeps tabs in sync.
 *
 * Usage:
 *   JMK.get('hotels')           // read collection
 *   JMK.find('hotels', 'h1')    // find by id
 *   JMK.add('bookings', obj)    // create (auto id + createdAt)
 *   JMK.update('hotels','h1',{name:'New'})
 *   JMK.remove('partners','p3')
 *   JMK.subscribe(fn)           // notified on any change
 *   JMK.reset()                 // wipe + reseed
 *   JMK.session                 // current logged-in actor (admin/hotelier/partner/guest)
 */
(function (root) {
  'use strict';

  var KEY = 'jmk_state_v1';
  var SESSION_KEY = 'jmk_session_v1';
  var listeners = [];

  // ---- Seed data ---------------------------------------------------------
  var SEED = {
    islands: [
      { id: 'isl-naxos',     name: 'Νάξος',     region: 'Κυκλάδες', status: 'active', allowedCategories: ['boat','food','tour','rental','wine','workshop','snorkel','sunset'], hotelCount: 14, partnerCount: 38 },
      { id: 'isl-paros',     name: 'Πάρος',     region: 'Κυκλάδες', status: 'active', allowedCategories: ['boat','food','tour','rental','wine','snorkel','sunset'], hotelCount: 9,  partnerCount: 22 },
      { id: 'isl-santorini', name: 'Σαντορίνη', region: 'Κυκλάδες', status: 'active', allowedCategories: ['boat','food','tour','wine','sunset','workshop'], hotelCount: 18, partnerCount: 41 },
      { id: 'isl-mykonos',   name: 'Μύκονος',   region: 'Κυκλάδες', status: 'active', allowedCategories: ['boat','food','rental','sunset','nightlife'], hotelCount: 12, partnerCount: 28 },
      { id: 'isl-milos',     name: 'Μήλος',     region: 'Κυκλάδες', status: 'active', allowedCategories: ['boat','food','rental','snorkel','sunset','tour'], hotelCount: 6,  partnerCount: 14 },
      { id: 'isl-rhodes',    name: 'Ρόδος',     region: 'Δωδεκάνησα', status: 'active', allowedCategories: ['boat','food','tour','rental','culture','wine','workshop'], hotelCount: 21, partnerCount: 47 },
      { id: 'isl-crete',     name: 'Κρήτη',     region: 'Κρήτη',      status: 'active', allowedCategories: ['boat','food','tour','rental','culture','wine','workshop','hike'], hotelCount: 32, partnerCount: 78 },
      { id: 'isl-corfu',     name: 'Κέρκυρα',   region: 'Ιόνιο',     status: 'active', allowedCategories: ['boat','food','tour','rental','culture','hike'], hotelCount: 16, partnerCount: 31 },
      { id: 'isl-zakynthos', name: 'Ζάκυνθος',  region: 'Ιόνιο',     status: 'active', allowedCategories: ['boat','food','tour','rental','snorkel'], hotelCount: 11, partnerCount: 24 },
      { id: 'isl-kefalonia', name: 'Κεφαλονιά', region: 'Ιόνιο',     status: 'pending', allowedCategories: ['boat','food','tour','hike','culture'], hotelCount: 0,  partnerCount: 0 },
      { id: 'isl-lesvos',    name: 'Λέσβος',    region: 'Β. Αιγαίο', status: 'pending', allowedCategories: ['food','tour','culture','wine'], hotelCount: 0, partnerCount: 0 },
      { id: 'isl-skiathos',  name: 'Σκιάθος',   region: 'Σποράδες',  status: 'pending', allowedCategories: ['boat','food','sunset'], hotelCount: 0, partnerCount: 0 }
    ],

    categories: [
      { id: 'boat',      name: 'Boat trips',    icon: '⛵', defaultDuration: '6 ώρες' },
      { id: 'sunset',    name: 'Sunset cruise', icon: '🌅', defaultDuration: '3 ώρες' },
      { id: 'snorkel',   name: 'Snorkeling',    icon: '🤿', defaultDuration: '3 ώρες' },
      { id: 'food',      name: 'Εστίαση',       icon: '🍴', defaultDuration: '90 λεπτά' },
      { id: 'tour',      name: 'Tours/Ξεναγήσεις', icon: '🏛', defaultDuration: '4 ώρες' },
      { id: 'culture',   name: 'Πολιτισμός',    icon: '🎨', defaultDuration: '2 ώρες' },
      { id: 'wine',      name: 'Wine tasting',  icon: '🍷', defaultDuration: '90 λεπτά' },
      { id: 'rental',   name: 'Ενοικιάσεις',   icon: '🛵', defaultDuration: '24 ώρες' },
      { id: 'hike',      name: 'Πεζοπορία',     icon: '🥾', defaultDuration: '4 ώρες' },
      { id: 'workshop',  name: 'Workshops',     icon: '🎨', defaultDuration: '3 ώρες' },
      { id: 'nightlife', name: 'Νυχτερινή ζωή', icon: '🌃', defaultDuration: '4 ώρες' },
      { id: 'delivery',  name: 'Delivery',      icon: '🍕', defaultDuration: '30 λεπτά' }
    ],

    hotels: [
      { id: 'h-naxos-1', name: 'Naxos Boutique Hotel', islandId: 'isl-naxos', rooms: 14, ownerName: 'Γιάννης Παπαδόπουλος', email: 'yiannis@naxosboutique.gr', phone: '+30 22850 12345', status: 'active', qrCode: 'jmk.app/h/x7p2k9', commissionPct: 5.0, joinedAt: '2025-11-12', totalBookings: 87, totalCommission: 1840 },
      { id: 'h-naxos-2', name: 'Galaxy Hotel',          islandId: 'isl-naxos', rooms: 22, ownerName: 'Ελένη Μαρή',     email: 'eleni@galaxynaxos.gr',     phone: '+30 22850 22310', status: 'active', qrCode: 'jmk.app/h/m4n8r2', commissionPct: 5.0, joinedAt: '2026-01-08', totalBookings: 54, totalCommission: 1120 },
      { id: 'h-paros-1', name: 'Paros Sea View',        islandId: 'isl-paros', rooms: 18, ownerName: 'Δημήτρης Νικολάου', email: 'd.nik@parosview.gr',      phone: '+30 22840 51200', status: 'active', qrCode: 'jmk.app/h/p3v9w1', commissionPct: 5.0, joinedAt: '2026-02-03', totalBookings: 38, totalCommission: 720 },
      { id: 'h-santorini-1', name: 'Caldera Suites Oia', islandId: 'isl-santorini', rooms: 12, ownerName: 'Μαρία Κουτσογιάννη', email: 'maria@calderasuites.gr', phone: '+30 22860 71902', status: 'active', qrCode: 'jmk.app/h/s9c2k7', commissionPct: 6.0, joinedAt: '2025-09-22', totalBookings: 142, totalCommission: 3580 },
      { id: 'h-rhodes-1', name: 'Rhodes Imperial',      islandId: 'isl-rhodes', rooms: 56, ownerName: 'Νίκος Σαββίδης', email: 'sales@rhodesimperial.gr', phone: '+30 22410 88200', status: 'active', qrCode: 'jmk.app/h/r5x1k3', commissionPct: 4.5, joinedAt: '2025-10-15', totalBookings: 211, totalCommission: 5240 },
      { id: 'h-crete-1', name: 'Heraklion Bay Resort', islandId: 'isl-crete',  rooms: 84, ownerName: 'Στέλιος Δασκαλάκης', email: 'st@hbresort.gr',         phone: '+30 2810 442100', status: 'active', qrCode: 'jmk.app/h/c8b4t6', commissionPct: 5.0, joinedAt: '2025-08-30', totalBookings: 318, totalCommission: 7820 },
      { id: 'h-mykonos-1', name: 'Mykonos White Bay', islandId: 'isl-mykonos', rooms: 24, ownerName: 'Άγγελος Ροσσέτης', email: 'a.ros@whitebay.gr',     phone: '+30 22890 23501', status: 'pending', qrCode: 'jmk.app/h/m1z6q8', commissionPct: 5.0, joinedAt: '2026-04-19', totalBookings: 0, totalCommission: 0 }
    ],

    partners: [
      { id: 'p-niko',  name: 'Νίκος Μαρινάκης',  businessName: 'Captain Niko Cruises', islandId: 'isl-naxos', category: 'boat',   email: 'niko@captainniko.gr', phone: '+30 694 1234567', vat: '123456789', iban: 'GR16 0110 1250 0000 0001 2345 678', status: 'approved', rating: 4.9, reviewCount: 214, joinedAt: '2025-12-01', totalEarnings: 8420 },
      { id: 'p-kalados', name: 'Οικογένεια Βαθρακοκοίλη', businessName: 'Ταβέρνα Καλάδος', islandId: 'isl-naxos', category: 'food', email: 'kalados@gmail.com', phone: '+30 22850 31200', vat: '987654321', iban: 'GR21 0110 1250 0000 0009 8765 432', status: 'approved', rating: 4.8, reviewCount: 340, joinedAt: '2025-12-15', totalEarnings: 4810 },
      { id: 'p-naxoshike', name: 'Naxos Hike',      businessName: 'Naxos Hike Tours',     islandId: 'isl-naxos', category: 'hike',   email: 'info@naxoshike.gr',   phone: '+30 22850 41200', vat: '456789123', iban: 'GR43 0110 1250 0000 0004 5678 912', status: 'pending', rating: 4.6, reviewCount: 23,  joinedAt: '2026-04-02', totalEarnings: 360 },
      { id: 'p-wine', name: 'Wine Cellar Apeiranthos', businessName: 'Wine Cellar Apeiranthos', islandId: 'isl-naxos', category: 'wine', email: 'cellar@apeiranthos.gr', phone: '+30 22850 61400', vat: '789123456', iban: 'GR54 0110 1250 0000 0007 8912 345', status: 'approved', rating: 4.7, reviewCount: 124, joinedAt: '2026-01-20', totalEarnings: 1680 },
      { id: 'p-wheels', name: 'Naxos Wheels', businessName: 'Naxos Wheels Rentals', islandId: 'isl-naxos', category: 'rental', email: 'rent@naxoswheels.gr', phone: '+30 22850 28900', vat: '321654987', iban: 'GR65 0110 1250 0000 0003 2165 498', status: 'approved', rating: 4.6, reviewCount: 412, joinedAt: '2025-11-28', totalEarnings: 6240 },
      { id: 'p-paros-boat', name: 'Captain Stavros', businessName: 'Paros Sailing', islandId: 'isl-paros', category: 'boat', email: 'stavros@parossailing.gr', phone: '+30 22840 11200', vat: '111222333', iban: 'GR76 0110 1250 0000 0001 1122 233', status: 'approved', rating: 4.8, reviewCount: 167, joinedAt: '2026-02-08', totalEarnings: 5320 },
      { id: 'p-santorini-wine', name: 'Sigalas Estate', businessName: 'Domaine Sigalas', islandId: 'isl-santorini', category: 'wine', email: 'visits@sigalas-wine.com', phone: '+30 22860 71644', vat: '444555666', iban: 'GR87 0110 1250 0000 0004 4455 566', status: 'approved', rating: 4.9, reviewCount: 521, joinedAt: '2025-08-12', totalEarnings: 12480 },
      { id: 'p-rhodes-tour', name: 'Acropolis Tours', businessName: 'Rhodes Heritage Walks', islandId: 'isl-rhodes', category: 'tour', email: 'walks@rhodesheritage.gr', phone: '+30 22410 23500', vat: '777888999', iban: 'GR98 0110 1250 0000 0007 7788 899', status: 'pending', rating: 0, reviewCount: 0, joinedAt: '2026-04-22', totalEarnings: 0 },
      { id: 'p-crete-cooking', name: 'Yiayia Despina', businessName: 'Cretan Cooking Experience', islandId: 'isl-crete', category: 'workshop', email: 'cook@yiayiadespina.gr', phone: '+30 2810 552300', vat: '222333444', iban: 'GR10 0110 1250 0000 0002 2233 344', status: 'approved', rating: 4.9, reviewCount: 67, joinedAt: '2026-03-15', totalEarnings: 1340 }
    ],

    activities: [
      { id: 'a-cruise',   partnerId: 'p-niko',  title: 'Day Cruise προς Παναγιά',     category: 'boat',     description: 'Ολοήμερη κρουαζιέρα στις νότιες παραλίες με γεύμα & snorkeling.', price: 110, duration: '6 ώρες', maxPeople: 8,  status: 'active', rating: 4.9, reviewCount: 22, weatherConditions: ['wind<30','no-rain'], coverIcon: '⛵', islandId: 'isl-naxos' },
      { id: 'a-sunset',   partnerId: 'p-niko',  title: 'Sunset Cruise',                category: 'sunset',   description: '3 ώρες με σαμπάνια και θέα ηλιοβασιλέματος.',                  price: 70,  duration: '3 ώρες', maxPeople: 6,  status: 'active', rating: 4.8, reviewCount: 14, weatherConditions: ['wind<25'],          coverIcon: '🌅', islandId: 'isl-naxos' },
      { id: 'a-snorkel',  partnerId: 'p-niko',  title: 'Half-day Snorkeling',          category: 'snorkel',  description: '3 σπηλιές, brunch on board, εξοπλισμός included.',             price: 55,  duration: '3 ώρες', maxPeople: 6,  status: 'paused', rating: 4.7, reviewCount: 2,  weatherConditions: ['wind<25','no-rain'], coverIcon: '🤿', islandId: 'isl-naxos' },
      { id: 'a-kalados',  partnerId: 'p-kalados', title: 'Δείπνο στην Ταβέρνα Καλάδος', category: 'food',    description: 'Φρέσκα ψάρια & σπιτικά μεζεδάκια με θέα στην παραλία.',         price: 28,  duration: '90 λεπτά', maxPeople: 30, status: 'active', rating: 4.8, reviewCount: 340, weatherConditions: [],                coverIcon: '🍴', islandId: 'isl-naxos' },
      { id: 'a-hike-za',  partnerId: 'p-naxoshike', title: 'Πεζοπορία στο Ζα',          category: 'hike',     description: 'Διαδρομή προς την ψηλότερη κορυφή Κυκλάδων με τοπικό ξεναγό.',  price: 45,  duration: '4 ώρες', maxPeople: 12, status: 'active', rating: 4.7, reviewCount: 89, weatherConditions: ['no-rain'],         coverIcon: '🥾', islandId: 'isl-naxos' },
      { id: 'a-wine',     partnerId: 'p-wine',  title: 'Wine Tasting Απείρανθος',     category: 'wine',     description: '5 τοπικά κρασιά με τυριά και παξιμάδια.',                       price: 55,  duration: '90 λεπτά', maxPeople: 16, status: 'active', rating: 4.7, reviewCount: 124, weatherConditions: [],                coverIcon: '🍷', islandId: 'isl-naxos' },
      { id: 'a-scooter',  partnerId: 'p-wheels', title: 'Ενοικίαση Scooter 125cc',     category: 'rental',  description: 'Παράδοση στο ξενοδοχείο. Ασφάλιση & κράνη included.',            price: 35,  duration: '24 ώρες', maxPeople: 2,  status: 'active', rating: 4.6, reviewCount: 412, weatherConditions: [],                coverIcon: '🛵', islandId: 'isl-naxos' },
      { id: 'a-paros-sail', partnerId: 'p-paros-boat', title: 'Antiparos Day Sail',  category: 'boat',     description: 'Εξερεύνηση Αντιπάρου με sailing yacht.',                        price: 95,  duration: '8 ώρες', maxPeople: 8,  status: 'active', rating: 4.8, reviewCount: 167, weatherConditions: ['wind<28','no-rain'], coverIcon: '⛵', islandId: 'isl-paros' },
      { id: 'a-sigalas',  partnerId: 'p-santorini-wine', title: 'Domaine Sigalas Tour', category: 'wine', description: 'Wine tour & 6 κρασιά σε αμπελώνα της Οίας.',                     price: 65,  duration: '2 ώρες', maxPeople: 12, status: 'active', rating: 4.9, reviewCount: 521, weatherConditions: [],                coverIcon: '🍷', islandId: 'isl-santorini' },
      { id: 'a-cooking',  partnerId: 'p-crete-cooking', title: 'Cretan Cooking με Γιαγιά Δέσποινα', category: 'workshop', description: 'Φτιάχνεις 3 παραδοσιακά πιάτα στο σπίτι της γιαγιάς.', price: 60, duration: '3 ώρες', maxPeople: 8, status: 'active', rating: 4.9, reviewCount: 67, weatherConditions: [], coverIcon: '🥖', islandId: 'isl-crete' }
    ],

    guests: [
      { id: 'g-maria',  name: 'Maria Konstantinou', email: 'maria.k@gmail.com',     hotelId: 'h-naxos-1', room: '204', checkIn: '2026-07-15', checkOut: '2026-07-21', traveler: 'couple', interests: ['beach','food','boat'], totalSpent: 620 },
      { id: 'g-sven',   name: 'Sven Lindqvist',     email: 'sven@example.se',       hotelId: 'h-naxos-1', room: '108', checkIn: '2026-07-16', checkOut: '2026-07-22', traveler: 'family', interests: ['beach','adventure','food'], totalSpent: 940 },
      { id: 'g-andrea', name: 'Andrea Giordano',    email: 'andrea@example.it',     hotelId: 'h-naxos-2', room: '305', checkIn: '2026-07-14', checkOut: '2026-07-20', traveler: 'couple', interests: ['food','wine','culture'], totalSpent: 460 },
      { id: 'g-fam-d',  name: 'Famille Dubois',     email: 'dubois@example.fr',     hotelId: 'h-paros-1', room: '12',  checkIn: '2026-07-17', checkOut: '2026-07-24', traveler: 'family', interests: ['beach','adventure'],          totalSpent: 720 },
      { id: 'g-jordan', name: 'Jordan Taylor',      email: 'jt@example.com',        hotelId: 'h-santorini-1', room: 'Sui3', checkIn: '2026-07-18', checkOut: '2026-07-22', traveler: 'couple', interests: ['wine','sunset','culture'], totalSpent: 1240 }
    ],

    bookings: [
      { id: 'b-2826', activityId: 'a-cruise',  partnerId: 'p-niko',     hotelId: 'h-naxos-1', guestId: 'g-maria',  date: '2026-07-17', time: '10:00', people: 2, totalAmount: 220, partnerAmount: 176, hotelCommission: 10, jmkCommission: 30, stripeFee: 4, status: 'confirmed', createdAt: '2026-07-17T09:51:00Z', completedAt: null, paidAt: '2026-07-17T09:51:30Z' },
      { id: 'b-2827', activityId: 'a-kalados', partnerId: 'p-kalados',  hotelId: 'h-naxos-1', guestId: 'g-maria',  date: '2026-07-17', time: '14:00', people: 2, totalAmount: 56,  partnerAmount: 47,  hotelCommission: 3, jmkCommission: 5, stripeFee: 1, status: 'confirmed', createdAt: '2026-07-16T20:11:00Z', completedAt: null, paidAt: '2026-07-16T20:11:00Z' },
      { id: 'b-2828', activityId: 'a-cruise',  partnerId: 'p-niko',     hotelId: 'h-naxos-1', guestId: 'g-sven',   date: '2026-07-18', time: '10:00', people: 4, totalAmount: 440, partnerAmount: 352, hotelCommission: 20, jmkCommission: 60, stripeFee: 8, status: 'confirmed', createdAt: '2026-07-15T11:22:00Z', completedAt: null, paidAt: '2026-07-15T11:22:00Z' },
      { id: 'b-2829', activityId: 'a-sunset',  partnerId: 'p-niko',     hotelId: 'h-naxos-2', guestId: 'g-andrea', date: '2026-07-17', time: '19:00', people: 4, totalAmount: 280, partnerAmount: 224, hotelCommission: 13, jmkCommission: 38, stripeFee: 5, status: 'completed', createdAt: '2026-07-13T15:00:00Z', completedAt: '2026-07-17T22:00:00Z', paidAt: '2026-07-13T15:01:00Z' },
      { id: 'b-2830', activityId: 'a-wine',    partnerId: 'p-wine',     hotelId: 'h-naxos-1', guestId: 'g-maria',  date: '2026-07-19', time: '17:00', people: 2, totalAmount: 110, partnerAmount: 88,  hotelCommission: 5, jmkCommission: 15, stripeFee: 2, status: 'chat',      createdAt: '2026-07-16T10:00:00Z', completedAt: null, paidAt: null },
      { id: 'b-2831', activityId: 'a-paros-sail', partnerId: 'p-paros-boat', hotelId: 'h-paros-1', guestId: 'g-fam-d', date: '2026-07-19', time: '09:00', people: 4, totalAmount: 380, partnerAmount: 304, hotelCommission: 17, jmkCommission: 52, stripeFee: 7, status: 'confirmed', createdAt: '2026-07-15T14:32:00Z', completedAt: null, paidAt: '2026-07-15T14:33:00Z' },
      { id: 'b-2832', activityId: 'a-sigalas', partnerId: 'p-santorini-wine', hotelId: 'h-santorini-1', guestId: 'g-jordan', date: '2026-07-20', time: '11:00', people: 2, totalAmount: 130, partnerAmount: 104, hotelCommission: 7, jmkCommission: 17, stripeFee: 2, status: 'completed', createdAt: '2026-07-18T16:40:00Z', completedAt: '2026-07-20T13:00:00Z', paidAt: '2026-07-18T16:41:00Z' }
    ],

    payouts: [
      { id: 'po-1', recipientType: 'partner', recipientId: 'p-niko',      amount: 1628, period: '2026-07-01..15', status: 'paid',    paidAt: '2026-07-15' },
      { id: 'po-2', recipientType: 'partner', recipientId: 'p-kalados',  amount: 940,  period: '2026-07-01..15', status: 'paid',    paidAt: '2026-07-15' },
      { id: 'po-3', recipientType: 'partner', recipientId: 'p-niko',      amount: 1840, period: '2026-07-16..21', status: 'pending', paidAt: null },
      { id: 'po-4', recipientType: 'hotel',   recipientId: 'h-naxos-1',  amount: 620,  period: '2026-06',         status: 'paid',    paidAt: '2026-07-01' },
      { id: 'po-5', recipientType: 'hotel',   recipientId: 'h-naxos-1',  amount: 842,  period: '2026-07-01..15',  status: 'paid',    paidAt: '2026-07-15' },
      { id: 'po-6', recipientType: 'hotel',   recipientId: 'h-naxos-1',  amount: 1140, period: '2026-07-16..31',  status: 'pending', paidAt: null }
    ],

    flaggedMessages: [
      { id: 'fm-1', bookingId: 'b-2826', from: 'p-niko',  text: '📵 [αριθμός κρυμμένος]', kind: 'phone', createdAt: '2026-07-17T09:45:00Z', resolved: true },
      { id: 'fm-2', bookingId: 'b-2830', from: 'g-maria', text: 'Στείλε μου στο email...', kind: 'email', createdAt: '2026-07-16T11:00:00Z', resolved: false },
      { id: 'fm-3', bookingId: 'b-2828', from: 'p-niko',  text: 'Whatsapp number...', kind: 'phone', createdAt: '2026-07-15T11:30:00Z', resolved: true }
    ],

    reviews: [
      { id: 'r-1', bookingId: 'b-2829', guestId: 'g-andrea', activityId: 'a-sunset',  partnerId: 'p-niko',           hotelId: 'h-naxos-2', rating: 5, text: 'Magico tramonto! Niko è bravissimo.', lang: 'it', createdAt: '2026-07-17T22:30:00Z' },
      { id: 'r-2', bookingId: 'b-2832', guestId: 'g-jordan', activityId: 'a-sigalas', partnerId: 'p-santorini-wine', hotelId: 'h-santorini-1', rating: 5, text: 'Best wine experience in Greece. Highly recommended.', lang: 'en', createdAt: '2026-07-20T13:30:00Z' },
      { id: 'r-3', bookingId: 'b-2826', guestId: 'g-maria',  activityId: 'a-cruise',  partnerId: 'p-niko',           hotelId: 'h-naxos-1', rating: 5, text: 'Wundervolle Tour! Captain Niko ist ein Profi.', lang: 'de', createdAt: '2026-07-17T19:00:00Z' },
      { id: 'r-4', bookingId: 'b-2827', guestId: 'g-maria',  activityId: 'a-kalados', partnerId: 'p-kalados',        hotelId: 'h-naxos-1', rating: 4, text: 'Tolles Essen, freundliches Personal. Etwas voll.', lang: 'de', createdAt: '2026-07-17T17:00:00Z' }
    ],

    partnerRequests: [
      { id: 'pr-1', partnerId: 'p-naxoshike', type: 'hotel_replacement', requestedBy:'h-naxos-1', requestedByName:'Naxos Boutique Hotel', reason: 'Αργές απαντήσεις στους πελάτες μας, παράπονα για ποιότητα οδηγού.', requestedAt: '2026-04-22T10:00:00Z', status: 'open', replacementId: null, affectedHotels: ['h-naxos-1'], notifiedHotels: ['h-naxos-1'] },
      { id: 'pr-2', partnerId: 'p-wheels',    type: 'hotel_replacement', requestedBy:'h-naxos-2', requestedByName:'Galaxy Hotel',          reason: 'Αδιέξοδα σε διαθεσιμότητα τις υψηλές βδομάδες.',                       requestedAt: '2026-07-23T14:00:00Z', status: 'in_progress', replacementId: null, affectedHotels: ['h-naxos-2'], notifiedHotels: ['h-naxos-2'] }
    ],

    notifications: [
      { id: 'n-1', toRole: 'hotelier', toId: 'h-naxos-1', type: 'replacement_acknowledged', title: 'Παραλάβαμε την αίτησή σου', body: 'Η JMK ψάχνει αντικαταστάτη για Naxos Hike. Θα σε ενημερώσουμε όταν βρεθεί.', read: false, createdAt: '2026-04-22T10:05:00Z', actionable: false, requestId: 'pr-1' },
      { id: 'n-2', toRole: 'hotelier', toId: 'h-naxos-1', type: 'new_review',               title: 'Νέα κριτική 5★',          body: 'Maria K. έδωσε 5★ στο Day Cruise Παναγιά.',                                  read: false, createdAt: '2026-07-17T19:01:00Z', actionable: false },
      { id: 'n-3', toRole: 'hotelier', toId: 'h-naxos-1', type: 'replacement_found',        title: 'Αντικαταστάτης βρέθηκε',  body: 'Mountain Goats Naxos θα καλύψει τις πεζοπορίες ενώ ψάχνουμε permanent.',     read: false, createdAt: '2026-04-23T11:00:00Z', actionable: false }
    ],

    settings: {
      jmkCommissionPct: 12.3,
      defaultHotelCommissionPct: 5.0,
      partnerCutPct: 80.0,
      stripeFeePct: 1.4,
      reservePct: 1.8,
      currency: 'EUR',
      languages: ['el','en','de','fr','it'],
      payoutSchedule: 'bimonthly',
      payoutDays: [1, 15],
      kycRequired: true,
      antiBypassEnabled: true,
      autoCancelBadWeather: true
    },

    _meta: { version: 1, seededAt: null }
  };

  // ---- Internal helpers --------------------------------------------------
  function _read() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) {
        var seeded = JSON.parse(JSON.stringify(SEED));
        seeded._meta.seededAt = new Date().toISOString();
        root.localStorage.setItem(KEY, JSON.stringify(seeded));
        return seeded;
      }
      return JSON.parse(raw);
    } catch (e) {
      console.error('JMK store read err', e);
      return JSON.parse(JSON.stringify(SEED));
    }
  }
  function _write(state) {
    state._meta = state._meta || {};
    state._meta.updatedAt = new Date().toISOString();
    root.localStorage.setItem(KEY, JSON.stringify(state));
    _emit({ type: 'change', source: 'local' });
  }
  function _emit(evt) { listeners.forEach(function (fn) { try { fn(evt); } catch (e) { console.error(e); } }); }
  function _genId(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Derived counts (kept fresh on read)
  function _refreshCounts(state) {
    state.islands.forEach(function (i) {
      i.hotelCount   = state.hotels.filter(function (h) { return h.islandId === i.id; }).length;
      i.partnerCount = state.partners.filter(function (p) { return p.islandId === i.id; }).length;
    });
    return state;
  }

  // ---- Public API --------------------------------------------------------
  var JMK = {
    KEY: KEY,
    seed: SEED,

    get: function (collection) {
      var s = _refreshCounts(_read());
      return s[collection] ? JSON.parse(JSON.stringify(s[collection])) : [];
    },

    state: function () { return _refreshCounts(_read()); },

    find: function (collection, id) {
      var s = _read();
      var arr = s[collection] || [];
      return arr.find(function (x) { return x.id === id; }) || null;
    },

    where: function (collection, predicate) {
      var s = _read();
      return (s[collection] || []).filter(predicate);
    },

    add: function (collection, obj) {
      var s = _read();
      if (!s[collection]) s[collection] = [];
      var prefix = collection.slice(0, 2);
      obj.id = obj.id || _genId(prefix);
      obj.createdAt = obj.createdAt || new Date().toISOString();
      s[collection].unshift(obj);
      _write(_refreshCounts(s));
      return obj;
    },

    update: function (collection, id, patch) {
      var s = _read();
      var arr = s[collection] || [];
      var i = arr.findIndex(function (x) { return x.id === id; });
      if (i < 0) return null;
      arr[i] = Object.assign({}, arr[i], patch, { updatedAt: new Date().toISOString() });
      _write(_refreshCounts(s));
      return arr[i];
    },

    remove: function (collection, id) {
      var s = _read();
      var arr = s[collection] || [];
      var i = arr.findIndex(function (x) { return x.id === id; });
      if (i < 0) return false;
      arr.splice(i, 1);
      _write(_refreshCounts(s));
      return true;
    },

    settings: function (patch) {
      var s = _read();
      s.settings = Object.assign({}, s.settings, patch || {});
      _write(s);
      return s.settings;
    },

    // Helpers used across apps
    islandsForActivity: function (categoryId) {
      return JMK.where('islands', function (i) { return i.allowedCategories.indexOf(categoryId) >= 0; });
    },
    activitiesByPartner: function (partnerId) {
      return JMK.where('activities', function (a) { return a.partnerId === partnerId; });
    },
    bookingsByPartner: function (partnerId) {
      return JMK.where('bookings', function (b) { return b.partnerId === partnerId; });
    },
    bookingsByHotel: function (hotelId) {
      return JMK.where('bookings', function (b) { return b.hotelId === hotelId; });
    },
    bookingsByGuest: function (guestId) {
      return JMK.where('bookings', function (b) { return b.guestId === guestId; });
    },
    reviewsByHotel: function (hotelId) {
      return JMK.where('reviews', function (r) { return r.hotelId === hotelId; });
    },
    reviewsByPartner: function (partnerId) {
      return JMK.where('reviews', function (r) { return r.partnerId === partnerId; });
    },
    notificationsFor: function (role, id) {
      return JMK.where('notifications', function (n) { return n.toRole === role && (!id || n.toId === id); });
    },
    /* Partner removal-request flow */
    requestPartnerLeave: function (partnerId, reason) {
      var partner = JMK.find('partners', partnerId);
      if (!partner) return null;
      // hotels affected = hotels on same island that have a booking with this partner
      var hotels = JMK.where('hotels', function (h) { return h.islandId === partner.islandId; }).map(function (h) { return h.id; });
      var req = JMK.add('partnerRequests', {
        partnerId: partnerId, type: 'leave', reason: reason || '',
        requestedAt: new Date().toISOString(), status: 'open',
        replacementId: null, affectedHotels: hotels, notifiedHotels: []
      });
      // notify each hotel + JMK admin
      hotels.forEach(function (hid) {
        JMK.add('notifications', {
          toRole: 'hotelier', toId: hid, type: 'partner_leave',
          title: 'Συνεργάτης ζητά αποχώρηση',
          body: (partner.businessName || partner.name) + ' ζήτησε αποχώρηση. Η JMK ψάχνει αντικαταστάτη.',
          read: false, actionable: true, requestId: req.id
        });
      });
      JMK.add('notifications', {
        toRole: 'admin', toId: null, type: 'partner_leave',
        title: 'Νέα αίτηση αποχώρησης', body: (partner.businessName || partner.name),
        read: false, actionable: true, requestId: req.id
      });
      return req;
    },
    markRequestNotified: function (requestId, hotelId) {
      var r = JMK.find('partnerRequests', requestId);
      if (!r) return;
      var arr = (r.notifiedHotels || []).slice();
      if (arr.indexOf(hotelId) < 0) arr.push(hotelId);
      JMK.update('partnerRequests', requestId, { notifiedHotels: arr });
    },

    // Compute split for a price using current settings
    computeSplit: function (totalAmount, hotelCommissionPct) {
      var s = _read().settings;
      var hPct = hotelCommissionPct != null ? hotelCommissionPct : s.defaultHotelCommissionPct;
      var hotel    = +(totalAmount * (hPct / 100)).toFixed(2);
      var stripe   = +(totalAmount * (s.stripeFeePct / 100)).toFixed(2);
      var jmk      = +(totalAmount * (s.jmkCommissionPct / 100)).toFixed(2);
      var reserve  = +(totalAmount * (s.reservePct / 100)).toFixed(2);
      var partner  = +(totalAmount - hotel - stripe - jmk - reserve).toFixed(2);
      return { partner: partner, hotel: hotel, jmk: jmk, stripe: stripe, reserve: reserve };
    },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    reset: function () {
      var seeded = JSON.parse(JSON.stringify(SEED));
      seeded._meta.seededAt = new Date().toISOString();
      root.localStorage.setItem(KEY, JSON.stringify(seeded));
      _emit({ type: 'reset' });
    },

    // Session — current logged-in actor across apps
    get session() {
      try { return JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null'); }
      catch (e) { return null; }
    },
    setSession: function (sess) {
      root.localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
      _emit({ type: 'session', session: sess });
    },
    clearSession: function () {
      root.localStorage.removeItem(SESSION_KEY);
      _emit({ type: 'session', session: null });
    }
  };

  // Listen for cross-tab changes
  if (root.addEventListener) {
    root.addEventListener('storage', function (e) {
      if (e.key === KEY)         _emit({ type: 'change', source: 'remote' });
      if (e.key === SESSION_KEY) _emit({ type: 'session', source: 'remote' });
    });
  }

  // Initialize on load (creates seed if first run)
  _read();

  root.JMK = JMK;
})(typeof window !== 'undefined' ? window : globalThis);
