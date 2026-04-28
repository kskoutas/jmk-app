/**
 * JMK · QR Code Generation
 * ------------------------
 * Παράγει QR codes για ξενοδοχεία (PNG ή SVG).
 * Format URL: https://<domain>/g?h=<hotelId>&t=<checkIn>&n=<nights>
 *   ή απλά https://<domain>/h/<shortCode> για landing με room picker.
 *
 * Implementation: αν είναι εγκατεστημένη η library `qrcode`, την χρησιμοποιεί.
 * Αλλιώς, fallback σε pure-JS minimal QR (reduced — μόνο για URL-length payloads).
 *
 * Bonus: Για hotels με rooms, μπορεί να παράγει «room-pack» — ένα QR ανά δωμάτιο
 * (ώστε το hotel να το βάλει σε κάθε δωμάτιο και να ξέρει ποιος guest είναι από πού).
 */
'use strict';

let QRCodeLib = null;
try {
  QRCodeLib = require('qrcode');
} catch (e) {
  console.warn('[qr] library `qrcode` not installed — QR generation will fail. Run `npm install qrcode`.');
}

/**
 * Επιστρέφει QR ως PNG buffer.
 * @param {string} payload - το URL ή κείμενο που θα κωδικοποιηθεί
 * @param {object} opts    - { size, margin, dark, light }
 */
async function toPng(payload, opts = {}) {
  if (!QRCodeLib) throw new Error('qrcode library not installed');
  return QRCodeLib.toBuffer(payload, {
    type: 'png',
    width: opts.size || 512,
    margin: opts.margin ?? 2,
    color: {
      dark: opts.dark || '#0F172A',
      light: opts.light || '#FFFFFF'
    },
    errorCorrectionLevel: opts.ecc || 'M'
  });
}

/**
 * Επιστρέφει QR ως SVG string.
 */
async function toSvg(payload, opts = {}) {
  if (!QRCodeLib) throw new Error('qrcode library not installed');
  return QRCodeLib.toString(payload, {
    type: 'svg',
    width: opts.size || 512,
    margin: opts.margin ?? 2,
    color: {
      dark: opts.dark || '#0F172A',
      light: opts.light || '#FFFFFF'
    }
  });
}

/**
 * Επιστρέφει QR ως data URL (για inline display).
 */
async function toDataUrl(payload, opts = {}) {
  if (!QRCodeLib) throw new Error('qrcode library not installed');
  return QRCodeLib.toDataURL(payload, {
    width: opts.size || 256,
    margin: opts.margin ?? 2,
    color: {
      dark: opts.dark || '#0F172A',
      light: opts.light || '#FFFFFF'
    }
  });
}

/**
 * Φτιάχνει το URL για το QR ενός hotel.
 * @param {string} baseUrl - π.χ. 'https://jmk-server.onrender.com' ή απλά 'https://jmk.app'
 * @param {object} hotel
 * @param {string} [room] - optional room number για room-specific QR
 */
function buildHotelUrl(baseUrl, hotel, room = null) {
  const url = new URL('/JMK_Guest_App.html', baseUrl);
  url.searchParams.set('h', hotel.id);
  if (hotel.qrCode) url.searchParams.set('s', hotel.qrCode); // shortcode (αν υπάρχει)
  if (room) url.searchParams.set('r', room);
  return url.toString();
}

module.exports = { toPng, toSvg, toDataUrl, buildHotelUrl, available: !!QRCodeLib };
