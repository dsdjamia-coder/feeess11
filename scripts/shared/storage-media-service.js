import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { storage, firebaseConfig } from "../../config/firebase-config.js";

/**
 * Standardized Smart WebP compression tiers across the application:
 * - Profile photos & Institution Logos: max 150 KB
 * - Gallery, Notices, Academic Plan & Showcase Screenshots: max 500 KB
 */
export const MEDIA_PRESETS = Object.freeze({
  PROFILE: Object.freeze({ maxKb: 150, maxDim: 600, preserveAlpha: false, fileNamePrefix: 'profile' }),
  LOGO: Object.freeze({ maxKb: 150, maxDim: 512, preserveAlpha: true, fileNamePrefix: 'logo' }),
  NOTICE: Object.freeze({ maxKb: 500, maxDim: 1440, preserveAlpha: false, fileNamePrefix: 'notice' }),
  GALLERY: Object.freeze({ maxKb: 500, maxDim: 1600, preserveAlpha: false, fileNamePrefix: 'gallery' }),
  SHOWCASE: Object.freeze({ maxKb: 500, maxDim: 1600, preserveAlpha: false, fileNamePrefix: 'showcase' }),
  ACADEMIC_PLAN: Object.freeze({ maxKb: 500, maxDim: 1280, preserveAlpha: false, fileNamePrefix: 'academic' })
});

let cachedWebpSupport = null;

/**
 * Checks whether the current browser canvas supports encoding WebP.
 * @returns {boolean}
 */
export const supportsWebpEncoding = () => {
  if (cachedWebpSupport !== null) return cachedWebpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const dataUrl = canvas.toDataURL('image/webp', 0.8);
    cachedWebpSupport = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/webp');
  } catch (_) {
    cachedWebpSupport = false;
  }
  return cachedWebpSupport;
};

const canvasToBlobAsync = (canvas, mimeType, quality) => {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to encode image blob.'));
          }
        },
        mimeType,
        quality
      );
    } catch (err) {
      reject(err);
    }
  });
};

const loadDrawableImage = (source) => {
  return new Promise((resolve, reject) => {
    if (!source) {
      reject(new Error('No image source provided.'));
      return;
    }
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      resolve({ element: source, width: source.width, height: source.height, cleanup: () => {} });
      return;
    }
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement && source.complete && source.naturalWidth > 0) {
      resolve({ element: source, width: source.naturalWidth, height: source.naturalHeight, cleanup: () => {} });
      return;
    }

    let objectUrl = '';
    const img = new Image();
    const cleanup = () => {
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
        objectUrl = '';
      }
    };

    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        cleanup();
        reject(new Error('Selected image has invalid dimensions.'));
        return;
      }
      resolve({ element: img, width: w, height: h, cleanup });
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Unable to decode the selected image file.'));
    };

    if (source instanceof Blob) {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    } else if (typeof source === 'string') {
      img.src = source;
    } else {
      reject(new Error('Unsupported image source type.'));
    }
  });
};

const drawScaledCanvas = (drawable, targetW, targetH, fillBackground = false) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(targetW));
  canvas.height = Math.max(1, Math.round(targetH));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (fillBackground) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  return canvas;
};

/**
 * Compresses an image (File, Blob, Canvas, HTMLImageElement, or Data URL)
 * into a Smart WebP (or JPEG fallback) Blob strictly within maxKb & maxDim.
 *
 * @param {File|Blob|HTMLCanvasElement|HTMLImageElement|string} source
 * @param {{ maxKb?: number, maxDim?: number, preserveAlpha?: boolean }} [options]
 * @returns {Promise<{ blob: Blob, contentType: string, extension: string, width: number, height: number }>}
 */
export const compressImageToBlob = async (source, options = {}) => {
  const maxKb = Number(options.maxKb) > 0 ? Number(options.maxKb) : 500;
  const maxDim = Number(options.maxDim) > 0 ? Number(options.maxDim) : 1600;
  const preserveAlpha = Boolean(options.preserveAlpha);
  const maxBytes = maxKb * 1024;

  const useWebp = supportsWebpEncoding();
  const mimeType = useWebp ? 'image/webp' : 'image/jpeg';
  const extension = useWebp ? 'webp' : 'jpg';
  const fillWhite = mimeType === 'image/jpeg' && !preserveAlpha;

  const loaded = await loadDrawableImage(source);
  try {
    let targetW = loaded.width;
    let targetH = loaded.height;
    const longest = Math.max(targetW, targetH);
    if (longest > maxDim) {
      const ratio = maxDim / longest;
      targetW = Math.max(1, Math.round(targetW * ratio));
      targetH = Math.max(1, Math.round(targetH * ratio));
    }

    let canvas = drawScaledCanvas(loaded.element, targetW, targetH, fillWhite);
    let quality = useWebp ? 0.86 : 0.85;
    let blob = await canvasToBlobAsync(canvas, mimeType, quality);

    // Step 1: reduce quality iteratively down to 0.42
    while (blob.size > maxBytes && quality > 0.42) {
      quality = Math.max(0.42, Number((quality - 0.08).toFixed(2)));
      blob = await canvasToBlobAsync(canvas, mimeType, quality);
    }

    // Step 2: if still above budget, scale down dimensions gradually
    let scale = 0.86;
    let attempts = 0;
    while (blob.size > maxBytes && attempts < 6 && Math.max(canvas.width, canvas.height) > 220) {
      const nextW = Math.max(64, Math.round(canvas.width * scale));
      const nextH = Math.max(64, Math.round(canvas.height * scale));
      canvas = drawScaledCanvas(loaded.element, nextW, nextH, fillWhite);
      blob = await canvasToBlobAsync(canvas, mimeType, Math.max(0.55, quality));
      attempts += 1;
    }

    // Step 3: final safety quality reduction if image is extraordinarily dense
    while (blob.size > maxBytes && quality > 0.25) {
      quality = Math.max(0.25, Number((quality - 0.07).toFixed(2)));
      blob = await canvasToBlobAsync(canvas, mimeType, quality);
    }

    if (blob.size > maxBytes) {
      throw new Error(`Compressed image still exceeds the ${maxKb} KB limit (${Math.ceil(blob.size / 1024)} KB). Please use a simpler or smaller image.`);
    }

    return {
      blob,
      contentType: blob.type || mimeType,
      extension,
      width: canvas.width,
      height: canvas.height
    };
  } finally {
    loaded.cleanup();
  }
};

const sanitizePathSegment = (raw = '') => {
  return String(raw || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '_')
    .replace(/\/{2,}/g, '/');
};

const sanitizeFilePrefix = (raw = 'img') => {
  const cleaned = String(raw || 'img')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return cleaned || 'img';
};

/**
 * Compresses (unless skipCompression is true and Blob is already within limit)
 * and uploads an image to Firebase Storage, returning its public download URL.
 *
 * @param {File|Blob|HTMLCanvasElement|HTMLImageElement|string} source
 * @param {string} pathPrefix e.g. `institutions/${slug}/public/gallery`
 * @param {{
 *   maxKb?: number,
 *   maxDim?: number,
 *   preserveAlpha?: boolean,
 *   fileNamePrefix?: string,
 *   skipCompression?: boolean,
 *   onProgress?: (percent: number) => void
 * }} [options]
 * @returns {Promise<{ url: string, path: string, sizeBytes: number, contentType: string, extension: string }>}
 */
export const uploadImageToStorage = async (source, pathPrefix, options = {}) => {
  const cleanPrefix = sanitizePathSegment(pathPrefix);
  if (!cleanPrefix) {
    throw new Error('Invalid Firebase Storage path prefix.');
  }

  const maxKb = Number(options.maxKb) > 0 ? Number(options.maxKb) : 500;
  const maxDim = Number(options.maxDim) > 0 ? Number(options.maxDim) : 1600;
  const preserveAlpha = Boolean(options.preserveAlpha);
  const filePrefix = sanitizeFilePrefix(options.fileNamePrefix || 'img');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  let uploadBlob;
  let contentType;
  let extension;

  const isPreCompressedBlob = Boolean(options.skipCompression)
    && source instanceof Blob
    && /^image\/(webp|jpeg|jpg|png)$/i.test(source.type || '')
    && source.size > 0
    && source.size <= maxKb * 1024;

  if (isPreCompressedBlob) {
    uploadBlob = source;
    contentType = source.type.toLowerCase();
    extension = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
  } else {
    const compressed = await compressImageToBlob(source, { maxKb, maxDim, preserveAlpha });
    uploadBlob = compressed.blob;
    contentType = compressed.contentType;
    extension = compressed.extension;
  }

  const uniqueToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullPath = `${cleanPrefix}/${filePrefix}_${uniqueToken}.${extension}`;
  const storageRef = ref(storage, fullPath);

  const metadata = {
    contentType,
    cacheControl: 'public, max-age=31536000, immutable'
  };

  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, uploadBlob, metadata);
    task.on(
      'state_changed',
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          try { onProgress(pct); } catch (_) {}
        }
      },
      (err) => reject(err),
      () => resolve()
    );
  });

  const url = await getDownloadURL(storageRef);
  return {
    url,
    path: fullPath,
    sizeBytes: uploadBlob.size,
    contentType,
    extension
  };
};

/**
 * Checks whether a URL belongs to this app's configured Firebase Storage bucket.
 * Safely returns false for legacy Base64 `data:image/...` strings and external URLs.
 *
 * @param {string} url
 * @returns {boolean}
 */
export const isManagedStorageUrl = (url) => {
  return Boolean(extractStoragePathFromUrl(url));
};

/**
 * Extracts the decoded Firebase Storage object path from a download URL
 * belonging to this project's storageBucket, or returns null if not managed.
 *
 * @param {string} url
 * @returns {string|null}
 */
export const extractStoragePathFromUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('data:')) return null;
  const bucket = String(firebaseConfig?.storageBucket || '').trim();
  if (!bucket) return null;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();

    if (host === 'firebasestorage.googleapis.com') {
      const marker = `/v0/b/${bucket}/o/`;
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) return null;
      const encoded = parsed.pathname.slice(idx + marker.length);
      if (!encoded) return null;
      return decodeURIComponent(encoded);
    }

    if (host === 'storage.googleapis.com') {
      const prefix = `/${bucket}/`;
      if (!parsed.pathname.startsWith(prefix)) return null;
      const encoded = parsed.pathname.slice(prefix.length);
      if (!encoded) return null;
      return decodeURIComponent(encoded);
    }
  } catch (_) {
    return null;
  }
  return null;
};

/**
 * Deletes an old Firebase Storage file if (and only if) the URL is a managed
 * Firebase Storage URL from this project's bucket.
 * Never throws; safely skips Base64 strings, external links, or already-deleted files.
 *
 * @param {string} url
 * @returns {Promise<boolean>} true if deletion succeeded, false if skipped or ignored
 */
export const deleteStorageUrlIfManaged = async (url) => {
  const objectPath = extractStoragePathFromUrl(url);
  if (!objectPath) return false;
  try {
    await deleteObject(ref(storage, objectPath));
    return true;
  } catch (err) {
    const code = String(err?.code || '');
    if (code !== 'storage/object-not-found') {
      console.warn('[StorageCleanup] Skipped deleting managed file:', objectPath, code || err?.message || err);
    }
    return false;
  }
};
