/**
 * JMK · Photo / Video Uploads
 * ----------------------------
 * Dual-mode storage:
 *   1. 'cloudinary' — αν υπάρχει CLOUDINARY_URL ή (CLOUD_NAME + KEY + SECRET)
 *      → fast CDN, auto-resize, format conversion (best για production)
 *   2. 'local'      — fallback, αποθηκεύει στο /uploads (καλό για MVP/local dev)
 *
 * Multer-based multipart parsing. Επιστρέφει pretty URLs ή Cloudinary URLs.
 *
 * Env vars:
 *   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
 *   ή ξεχωριστά: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *
 * Limits: 10MB per file, max 10 files per request.
 */
'use strict';

const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

let multer = null;
try { multer = require('multer'); } catch { console.warn('[uploads] `multer` not installed — uploads disabled. Run `npm install multer`.'); }

let cloudinary = null;
const HAS_CLOUDINARY_ENV = !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);
if (HAS_CLOUDINARY_ENV) {
  try {
    cloudinary = require('cloudinary').v2;
    if (process.env.CLOUDINARY_URL) {
      // SDK reads CLOUDINARY_URL automatically
    } else {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key:    process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure:     true
      });
    }
  } catch {
    console.warn('[uploads] CLOUDINARY env set but `cloudinary` library missing. Run `npm install cloudinary`. Falling back to local.');
    cloudinary = null;
  }
}

const MODE = cloudinary ? 'cloudinary' : 'local';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// Δημιουργούμε τον τοπικό φάκελο αν λείπει
if (MODE === 'local') {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
}

// Multer storage — κρατάμε στη μνήμη και αποφασίζουμε εμείς πού πάει
const memoryStorage = multer ? multer.memoryStorage() : null;
const uploader = multer ? multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 10
  },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif|avif)$|^video\/(mp4|webm|quicktime)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  }
}) : null;

/**
 * Αποθηκεύει ένα multer file. Επιστρέφει object με public URL.
 * @param {{ buffer, mimetype, originalname }} file
 * @param {{ folder, public_id }} opts
 */
async function saveOne(file, opts = {}) {
  if (!file || !file.buffer) throw new Error('file required');

  if (MODE === 'cloudinary') {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        folder: opts.folder || 'jmk',
        public_id: opts.public_id,
        resource_type: file.mimetype.startsWith('video/') ? 'video' : 'image',
        transformation: file.mimetype.startsWith('image/') ? [
          { width: 1600, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' }
        ] : undefined
      }, (err, result) => {
        if (err) return reject(err);
        resolve({
          id:        result.public_id,
          url:       result.secure_url,
          thumbUrl:  cloudinary.url(result.public_id, { width: 400, crop: 'fill', quality: 'auto', fetch_format: 'auto', secure: true }),
          width:     result.width,
          height:    result.height,
          bytes:     result.bytes,
          mime:      file.mimetype,
          provider:  'cloudinary'
        });
      });
      stream.end(file.buffer);
    });
  }

  // Local mode
  const ext = path.extname(file.originalname || '') ||
              ('.' + (file.mimetype.split('/')[1] || 'bin').replace('jpeg', 'jpg'));
  const id = (opts.public_id || crypto.randomBytes(8).toString('hex')) + ext;
  const fullPath = path.join(UPLOAD_DIR, id);
  fs.writeFileSync(fullPath, file.buffer);
  return {
    id,
    url:      `/uploads/${id}`,
    thumbUrl: `/uploads/${id}`,   // δεν κάνουμε resize σε local mode
    bytes:    file.buffer.length,
    mime:     file.mimetype,
    provider: 'local'
  };
}

/**
 * Διαγράφει uploaded asset.
 */
async function deleteOne(id, opts = {}) {
  if (MODE === 'cloudinary') {
    try { await cloudinary.uploader.destroy(id, { resource_type: opts.resource_type || 'image' }); }
    catch (e) { console.warn('[uploads] cloudinary destroy failed:', e.message); }
    return { deleted: true };
  }
  const fullPath = path.join(UPLOAD_DIR, id);
  try { fs.unlinkSync(fullPath); return { deleted: true }; }
  catch (e) { return { deleted: false, error: e.message }; }
}

/**
 * Express middleware για να σερβίρει local uploads. (Στο cloudinary mode περιττό.)
 */
function staticMiddleware(express) {
  if (MODE !== 'local') return null;
  return express.static(UPLOAD_DIR, { maxAge: '7d' });
}

module.exports = {
  uploader,
  saveOne,
  deleteOne,
  staticMiddleware,
  MODE,
  UPLOAD_DIR,
  available: !!multer
};
