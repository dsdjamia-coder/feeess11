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

export const SHOWCASE_VIDEO_DIRECT_LIMIT_BYTES = 15 * 1024 * 1024;
export const SHOWCASE_VIDEO_STORAGE_MAX_BYTES = 20 * 1024 * 1024;
export const SHOWCASE_VIDEO_INPUT_MAX_BYTES = 60 * 1024 * 1024;

const ALLOWED_VIDEO_MIME_REGEX = /^video\/(mp4|webm|quicktime)$/i;

const getVideoExtensionFromMime = (mime = '', fallbackName = '') => {
  const lowerMime = String(mime || '').toLowerCase();
  if (lowerMime.includes('webm')) return 'webm';
  if (lowerMime.includes('quicktime')) return 'mov';
  if (lowerMime.includes('mp4')) return 'mp4';
  const extMatch = String(fallbackName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (extMatch && ['mp4', 'webm', 'mov'].includes(extMatch[1])) return extMatch[1];
  return 'mp4';
};

/**
 * Extracts a crisp poster thumbnail (WebP/JPEG <= 120 KB) from a local video File/Blob.
 * @param {File|Blob} videoFile
 * @returns {Promise<{ blob: Blob, contentType: string, extension: string, width: number, height: number }>}
 */
export const extractVideoPosterBlob = async (videoFile) => {
  if (!(videoFile instanceof Blob)) {
    throw new Error('Invalid video file for thumbnail extraction.');
  }

  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Timed out while reading video metadata.')), 15000);
      video.onloadeddata = () => {
        clearTimeout(timeoutId);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('Unable to decode video file in this browser.'));
      };
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const seekTarget = duration > 0.6 ? Math.min(0.5, duration * 0.15) : 0;
    if (seekTarget > 0) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2500);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        try {
          video.currentTime = seekTarget;
        } catch (_) {
          clearTimeout(timer);
          resolve();
        }
      });
    }

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const maxDim = 960;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(srcW * scale));
    canvas.height = Math.max(2, Math.round(srcH * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable for video poster generation.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await compressImageToBlob(canvas, {
      maxKb: 120,
      maxDim: 960,
      preserveAlpha: false
    });
  } finally {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (_) {}
    try { URL.revokeObjectURL(objectUrl); } catch (_) {}
  }
};

/**
 * Compresses large videos (> 15 MB, up to 60 MB) in-browser to 720p (~2.5 Mbps)
 * using Canvas + MediaRecorder while preserving sharpness.
 * @param {File|Blob} videoFile
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{ blob: Blob, contentType: string, extension: string }>}
 */
export const compressVideoTo720pBlob = async (videoFile, onProgress = null) => {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support automatic video compression. Please upload an MP4 or WebM video under 15 MB.');
  }

  const candidateTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4'
  ];
  const chosenMime = candidateTypes.find((t) => {
    try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; }
  });
  if (!chosenMime) {
    throw new Error('No supported video encoder found in this browser. Please upload an MP4/WebM clip under 15 MB.');
  }

  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = true;
  video.src = objectUrl;

  let rafId = 0;
  let audioCtx = null;

  try {
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Timed out loading video for compression.')), 20000);
      video.onloadedmetadata = () => {
        clearTimeout(timeoutId);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('Unable to read video file for compression.'));
      };
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration > 180) {
      throw new Error('Video is longer than 3 minutes. Please trim it or upload an MP4/WebM file under 15 MB.');
    }

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const maxHeight = 720;
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / srcW, maxHeight / srcH);
    // Keep even dimensions for video codec compatibility
    const targetW = Math.max(2, Math.floor((srcW * scale) / 2) * 2);
    const targetH = Math.max(2, Math.floor((srcH * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable for video compression.');

    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];

    // Preserve audio track when browser supports captureStream on video element
    try {
      const rawCapture = typeof video.captureStream === 'function'
        ? video.captureStream()
        : (typeof video.mozCaptureStream === 'function' ? video.mozCaptureStream() : null);
      if (rawCapture) {
        rawCapture.getAudioTracks().forEach((t) => tracks.push(t));
      }
    } catch (_) {}

    const combinedStream = new MediaStream(tracks);
    // Target crisp ~2.4 Mbps for 720p, or scale down dynamically if duration is longer so output fits under 19 MB
    const budgetBps = duration > 0
      ? Math.floor(((18 * 1024 * 1024 * 8) / duration) * 0.85)
      : 2400000;
    const videoBitsPerSecond = Math.max(700000, Math.min(2500000, budgetBps));

    const chunks = [];
    const recorder = new MediaRecorder(combinedStream, {
      mimeType: chosenMime,
      videoBitsPerSecond
    });

    const recordedPromise = new Promise((resolve, reject) => {
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = (ev) => {
        reject(ev?.error || new Error('Video compression failed.'));
      };
      recorder.onstop = () => {
        const baseMime = chosenMime.split(';')[0] || 'video/webm';
        resolve(new Blob(chunks, { type: baseMime }));
      };
    });

    const drawFrame = () => {
      if (video.paused || video.ended) return;
      ctx.drawImage(video, 0, 0, targetW, targetH);
      if (typeof onProgress === 'function' && duration > 0) {
        const pct = Math.min(99, Math.round((video.currentTime / duration) * 100));
        try { onProgress(pct); } catch (_) {}
      }
      rafId = requestAnimationFrame(drawFrame);
    };

    recorder.start(250);
    await video.play();
    drawFrame();

    await new Promise((resolve, reject) => {
      const safetyMs = Math.max(30000, Math.ceil((duration || 60) * 1400) + 15000);
      const timer = setTimeout(() => {
        try { video.pause(); } catch (_) {}
        reject(new Error('Video compression timed out. Please upload a clip under 15 MB.'));
      }, safetyMs);
      video.onended = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Playback error during video compression.'));
      };
    });

    if (rafId) cancelAnimationFrame(rafId);
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    const compressedBlob = await recordedPromise;
    if (typeof onProgress === 'function') {
      try { onProgress(100); } catch (_) {}
    }

    if (!compressedBlob || compressedBlob.size === 0) {
      throw new Error('Video compression produced an empty file. Please upload a clip under 15 MB.');
    }
    if (compressedBlob.size > SHOWCASE_VIDEO_STORAGE_MAX_BYTES) {
      throw new Error('Compressed video still exceeds the 20 MB storage limit. Please trim the video or export in 720p MP4.');
    }

    const baseType = compressedBlob.type || (chosenMime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm');
    return {
      blob: compressedBlob,
      contentType: baseType,
      extension: baseType.includes('mp4') ? 'mp4' : 'webm'
    };
  } finally {
    if (rafId) cancelAnimationFrame(rafId);
    if (audioCtx) {
      try { await audioCtx.close(); } catch (_) {}
    }
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (_) {}
    try { URL.revokeObjectURL(objectUrl); } catch (_) {}
  }
};

/**
 * Uploads a Platform Showcase video to Firebase Storage with hybrid quality preservation:
 * - Always extracts & uploads a crisp WebP poster thumbnail (<= 120 KB) for fast page loads.
 * - Videos <= 15 MB upload directly at 100% original HD quality.
 * - Videos > 15 MB (up to 60 MB) auto-compress in-browser to 720p (~2.5 Mbps) before upload.
 *
 * @param {File} file
 * @param {string} pathPrefix e.g. `company/showcases/${pageKey}`
 * @param {{
 *   fileNamePrefix?: string,
 *   onStageProgress?: (stage: 'poster' | 'compressing' | 'uploading', percent: number) => void
 * }} [options]
 */
export const uploadShowcaseVideoToStorage = async (file, pathPrefix, options = {}) => {
  const cleanPrefix = sanitizePathSegment(pathPrefix);
  if (!cleanPrefix) {
    throw new Error('Invalid Firebase Storage path prefix.');
  }
  if (!(file instanceof Blob)) {
    throw new Error('No video file selected.');
  }
  const rawMime = String(file.type || '').toLowerCase().trim();
  const isAllowedMime = ALLOWED_VIDEO_MIME_REGEX.test(rawMime)
    || /\.(mp4|webm|mov)$/i.test(String(file.name || ''));
  if (!isAllowedMime) {
    throw new Error(`"${file.name || 'File'}" is not a supported video format. Use MP4, WebM, or MOV.`);
  }
  if (file.size > SHOWCASE_VIDEO_INPUT_MAX_BYTES) {
    throw new Error(`"${file.name}" exceeds the 60 MB maximum video size limit.`);
  }

  const filePrefix = sanitizeFilePrefix(options.fileNamePrefix || 'video');
  const notify = typeof options.onStageProgress === 'function' ? options.onStageProgress : null;

  // Step 1: Extract & upload crisp poster thumbnail (<= 120 KB)
  let posterUrl = '';
  let posterPath = '';
  try {
    if (notify) notify('poster', 10);
    const posterCompressed = await extractVideoPosterBlob(file);
    const posterUpload = await uploadImageToStorage(posterCompressed.blob, cleanPrefix, {
      maxKb: 120,
      maxDim: 960,
      fileNamePrefix: `${filePrefix}_poster`,
      skipCompression: true
    });
    posterUrl = posterUpload.url;
    posterPath = posterUpload.path;
    if (notify) notify('poster', 100);
  } catch (posterErr) {
    console.warn('[VideoUpload] Poster extraction skipped:', posterErr?.message || posterErr);
  }

  // Step 2: Hybrid direct HD upload (<= 15 MB) or 720p compression (> 15 MB)
  let uploadBlob = file;
  let contentType = ALLOWED_VIDEO_MIME_REGEX.test(rawMime) ? rawMime : 'video/mp4';
  let extension = getVideoExtensionFromMime(contentType, file.name);
  let wasCompressed = false;

  try {
    if (file.size > SHOWCASE_VIDEO_DIRECT_LIMIT_BYTES) {
      if (notify) notify('compressing', 0);
      const compressed = await compressVideoTo720pBlob(file, (pct) => {
        if (notify) notify('compressing', pct);
      });
      uploadBlob = compressed.blob;
      contentType = compressed.contentType;
      extension = compressed.extension;
      wasCompressed = true;
    }

    if (uploadBlob.size > SHOWCASE_VIDEO_STORAGE_MAX_BYTES) {
      throw new Error('Video exceeds the 20 MB Firebase Storage limit.');
    }

    // Step 3: Upload video blob to Firebase Storage
    if (notify) notify('uploading', 0);
    const uniqueToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullPath = `${cleanPrefix}/${filePrefix}_vid_${uniqueToken}.${extension}`;
    const storageRef = ref(storage, fullPath);

    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, uploadBlob, {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable'
      });
      task.on(
        'state_changed',
        (snapshot) => {
          if (notify && snapshot.totalBytes > 0) {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            try { notify('uploading', pct); } catch (_) {}
          }
        },
        (err) => reject(err),
        () => resolve()
      );
    });

    const url = await getDownloadURL(storageRef);
    return {
      url,
      posterUrl,
      path: fullPath,
      posterPath,
      sizeBytes: uploadBlob.size,
      contentType,
      extension,
      mediaType: 'video',
      compressed: wasCompressed
    };
  } catch (err) {
    if (posterUrl) {
      deleteStorageUrlIfManaged(posterUrl);
    }
    throw err;
  }
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
