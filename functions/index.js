'use strict';

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2/options');
const { initializeApp, getApps, getApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

setGlobalOptions({
  region: 'asia-south1',
  maxInstances: 20
});

const app = getApps().length ? getApp() : initializeApp();
const adminAuth = getAuth(app);
// IMPORTANT: This project uses the named Firestore database ID "default"
const db = getFirestore(app, 'default');

const AUTH_CREDENTIALS_COLLECTION = 'authCredentials';
const OTP_CHALLENGES_COLLECTION = 'otpChallenges';
const OTP_RATE_LIMITS_COLLECTION = 'otpRateLimits';
const INSTITUTIONS_COLLECTION = 'institutions';
const UPGRADE_REQUESTS_COLLECTION = 'upgradeRequests';
const COMPANY_COLLECTION = 'company';
const COMPANY_CONFIG_DOC_ID = 'config';
const COMPANY_PUBLIC_CATALOG_DOC_ID = 'publicCatalog';

const RESERVED_INSTITUTION_SLUGS = new Set([
  'index', 'company', 'admin', 'attendance', 'academic-plan', 'activity',
  'evaluation', 'collection', 'official', 'result', 'student', 'worksheet',
  'platform', 'official-dashboard', 'student-fee-system', 'studentmanagement',
  'assets', 'scripts', 'styles', 'config', 'public', 'school', 'api', 'app', 'login', 'signup'
]);

const BASIC_PLAN_ALLOWED_PAGES = {
  admin: true,
  official: true,
  student: true,
  collection: true,
  result: true,
  attendance: false,
  worksheet: false,
  academicPlan: false,
  studentActivity: false,
  classroomEvaluation: false
};

const DEFAULT_BASIC_PLAN_LIMITS = {
  maxStudents: 150,
  maxStaff: 6,
  maxClasses: 12,
  maxAcademicYears: 1,
  maxFeeItems: 4,
  maxNotices: 5,
  maxGalleryPhotos: 6,
  maxExamsPerYear: 2,
  maxDirectoryEntries: 10
};

const MAX_SELF_SIGNUPS_PER_PHONE = 2;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const OTP_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_AUTH_FRESHNESS_SEC = 10 * 60; // 10 minutes max age for verified Phone ID token
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const OTP_RATE_MAX_REQUESTS = 5;
const OTP_SEND_MAX_REQUESTS = 3; // 1 initial OTP + max 2 resends per 15-minute window

// --- Helpers ---

const normalizeInstitutionSlug = (raw = '') => {
  const clean = String(raw || '').trim().toLowerCase();
  if (!clean || !/^[a-z0-9][a-z0-9-_]{0,63}$/.test(clean)) return '';
  return clean;
};

const normalizePhoneDigits = (raw = '') => String(raw || '').replace(/\D/g, '');

const normalizeCountryCode = (raw = '+91') => {
  const digits = String(raw || '+91').replace(/\D/g, '');
  if (!digits || digits.length > 4) return '+91';
  return `+${digits}`;
};

const normalizePhoneToE164 = (raw = '', defaultCountryCode = '+91') => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const cc = normalizeCountryCode(defaultCountryCode);

  if (trimmed.startsWith('+')) {
    const digits = normalizePhoneDigits(trimmed);
    if (digits.length < 8 || digits.length > 15) return '';
    return `+${digits}`;
  }

  let digits = normalizePhoneDigits(trimmed);
  if (!digits) return '';

  // Strip international 00 prefix if entered
  if (digits.startsWith('00') && digits.length >= 10 && digits.length <= 17) {
    digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
  }

  // Strip single leading 0 on local 11-digit Indian numbers (e.g., 09876543210)
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Standard 10-digit local number -> prepend country code
  if (digits.length === 10) {
    return `${cc}${digits}`;
  }

  // Already includes country code without '+' (e.g., 919876543210)
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  return '';
};

const phonesMatch = (rawA = '', rawB = '') => {
  const dA = normalizePhoneDigits(rawA);
  const dB = normalizePhoneDigits(rawB);
  if (!dA || !dB) return false;
  if (dA === dB) return true;
  if (dA.length >= 10 && dB.length >= 10) {
    return dA.slice(-10) === dB.slice(-10);
  }
  return false;
};

const maskPhoneDisplay = (e164 = '') => {
  const clean = String(e164 || '').trim();
  if (!clean) return '';
  const digits = normalizePhoneDigits(clean);
  if (digits.length < 6) return '******';
  const last4 = digits.slice(-4);
  if (clean.startsWith('+91') && digits.length === 12) {
    return `+91 ${digits.slice(2, 4)}****${last4}`;
  }
  const prefix = clean.startsWith('+') ? `+${digits.slice(0, Math.min(3, digits.length - 4))} ` : '';
  return `${prefix}******${last4}`;
};

const maskStudentName = (rawName = '') => {
  const clean = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return 'St****';
  const parts = clean.split(' ').filter(Boolean);
  const maskToken = (token, isFirst) => {
    if (token.length <= 1) return token;
    if (!isFirst) {
      return `${token[0]}.`;
    }
    if (token.length <= 3) {
      return `${token[0]}${'*'.repeat(Math.max(2, token.length - 1))}`;
    }
    return `${token.slice(0, 2)}${'*'.repeat(Math.min(5, Math.max(2, token.length - 3)))}${token.slice(-1)}`;
  };
  return parts
    .slice(0, 3)
    .map((p, idx) => maskToken(p, idx === 0))
    .join(' ');
};

const sha256Hex = (value = '') => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const validateAndNormalizeUsername = (raw = '') => {
  const displayUsername = String(raw || '').trim();
  if (!displayUsername) {
    throw new HttpsError('invalid-argument', 'Username is required.');
  }
  if (displayUsername.length < 3 || displayUsername.length > 60) {
    throw new HttpsError('invalid-argument', 'Username must be between 3 and 60 characters.');
  }
  if (/\s/.test(displayUsername)) {
    throw new HttpsError('invalid-argument', 'Spaces are not allowed in username.');
  }
  if (/[\u0000-\u001F\u007F]/.test(displayUsername)) {
    throw new HttpsError('invalid-argument', 'Username contains invalid control characters.');
  }
  const username = displayUsername.toLowerCase();
  const keyHash = sha256Hex(username);
  return { displayUsername, username, keyHash };
};

const hashPasswordScrypt = (password) => {
  const cleanPass = String(password || '');
  if (cleanPass.length < 6 || cleanPass.length > 128) {
    throw new HttpsError('invalid-argument', 'Password must be between 6 and 128 characters.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(cleanPass, salt, 64).toString('hex');
  return { passwordSalt: salt, passwordHash: derived };
};

const verifyPasswordScrypt = (password, salt, expectedHashHex) => {
  if (!password || !salt || !expectedHashHex) return false;
  try {
    const derived = crypto.scryptSync(String(password), String(salt), 64);
    const expected = Buffer.from(String(expectedHashHex), 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
};

const buildSuperAdminUid = (slug) => `sa_${slug}`;
const buildStaffUid = (slug, staffId) => `st_${slug}_${staffId}`;

const enforceOtpRateLimit = async (bucketKey = '', maxRequests = OTP_RATE_MAX_REQUESTS) => {
  const keyHash = sha256Hex(String(bucketKey || 'default').toLowerCase());
  const ref = db.collection(OTP_RATE_LIMITS_COLLECTION).doc(keyHash);
  const nowMs = Date.now();
  const limit = Number.isFinite(Number(maxRequests)) && Number(maxRequests) > 0
    ? Number(maxRequests)
    : OTP_RATE_MAX_REQUESTS;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const existingTimestamps = Array.isArray(data.timestamps)
      ? data.timestamps.map(Number).filter((ts) => Number.isFinite(ts) && (nowMs - ts) < OTP_RATE_WINDOW_MS)
      : [];

    if (existingTimestamps.length >= limit) {
      const oldest = Math.min(...existingTimestamps);
      const waitMins = Math.max(1, Math.ceil((OTP_RATE_WINDOW_MS - (nowMs - oldest)) / 60000));
      throw new HttpsError(
        'resource-exhausted',
        `OTP resend limit reached (maximum ${Math.max(0, limit - 1)} resends per 15 minutes). Please wait ${waitMins} minute${waitMins === 1 ? '' : 's'} before trying again.`
      );
    }

    existingTimestamps.push(nowMs);
    tx.set(ref, {
      timestamps: existingTimestamps,
      updatedAtMs: nowMs
    });
  });
};

const createOtpChallenge = async (payload = {}) => {
  const challengeId = crypto.randomBytes(24).toString('hex');
  const nowMs = Date.now();
  await db.collection(OTP_CHALLENGES_COLLECTION).doc(challengeId).set({
    ...payload,
    used: false,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + OTP_CHALLENGE_TTL_MS
  });
  return challengeId;
};

const verifyPhoneAuthToken = async (phoneIdToken = '', expectedPhoneE164 = '') => {
  const rawToken = String(phoneIdToken || '').trim();
  if (!rawToken) {
    throw new HttpsError('unauthenticated', 'Verified phone OTP token is required.');
  }

  let decoded = null;
  try {
    decoded = await adminAuth.verifyIdToken(rawToken);
  } catch (err) {
    console.warn('[verifyPhoneAuthToken] Token verification failed:', err?.message || err);
    throw new HttpsError('unauthenticated', 'OTP verification token is invalid or expired. Please request a new OTP.');
  }

  const provider = String(decoded?.firebase?.sign_in_provider || '').toLowerCase();
  if (provider !== 'phone') {
    throw new HttpsError('permission-denied', 'Phone SMS OTP authentication is required.');
  }

  const verifiedPhone = String(decoded.phone_number || '').trim();
  if (!verifiedPhone) {
    throw new HttpsError('unauthenticated', 'Verified phone number missing from OTP token.');
  }

  const authTimeSec = Number(decoded.auth_time || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authTimeSec) || (nowSec - authTimeSec) > OTP_AUTH_FRESHNESS_SEC) {
    throw new HttpsError('unauthenticated', 'OTP session has expired. Please verify a fresh OTP code.');
  }

  if (expectedPhoneE164 && !phonesMatch(verifiedPhone, expectedPhoneE164)) {
    throw new HttpsError('permission-denied', 'Verified phone number does not match the registered phone number for this account.');
  }

  return {
    phoneUid: String(decoded.uid || ''),
    phoneE164: verifiedPhone,
    authTimeSec
  };
};

const consumeOtpChallenge = async (challengeId = '', expectedType = 'official') => {
  const cleanId = String(challengeId || '').trim();
  if (!cleanId || cleanId.length < 16 || cleanId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid OTP verification session is required.');
  }

  const ref = db.collection(OTP_CHALLENGES_COLLECTION).doc(cleanId);
  const nowMs = Date.now();
  let challengeData = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'OTP verification session expired or not found. Please start again.');
    }
    const data = snap.data() || {};
    if (data.type !== expectedType) {
      throw new HttpsError('permission-denied', 'Invalid OTP verification challenge type.');
    }
    if (data.used === true) {
      throw new HttpsError('failed-precondition', 'This OTP verification session has already been used. Please sign in again.');
    }
    if (Number(data.expiresAtMs || 0) < nowMs) {
      tx.delete(ref);
      throw new HttpsError('deadline-exceeded', 'OTP verification session timed out. Please verify your password and request a new OTP.');
    }
    challengeData = data;
    tx.set(ref, { used: true, consumedAtMs: nowMs }, { merge: true });
  });

  return challengeData;
};

const resolveOfficialPhoneE164 = async (cred = {}, slug = '') => {
  const candidates = [cred.phoneE164, cred.phone];
  const role = cred.role === 'super_admin' ? 'super_admin' : 'staff';
  const staffId = String(cred.staffId || '').trim();
  const uid = String(cred.uid || (role === 'super_admin' ? buildSuperAdminUid(slug) : buildStaffUid(slug, staffId)));

  for (const cand of candidates) {
    const e164 = normalizePhoneToE164(cand);
    if (e164) return e164;
  }

  if (!slug) return '';

  if (role === 'super_admin') {
    const [adminSnap, instSnap, configSnap] = await Promise.all([
      db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/adminAuth`).get().catch(() => null),
      db.collection(INSTITUTIONS_COLLECTION).doc(slug).get().catch(() => null),
      db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/config`).get().catch(() => null)
    ]);
    const adminData = adminSnap?.exists ? (adminSnap.data() || {}) : {};
    const instData = instSnap?.exists ? (instSnap.data() || {}) : {};
    const configData = configSnap?.exists ? (configSnap.data() || {}) : {};

    const fallbacks = [
      adminData.phoneE164,
      adminData.phone,
      instData.adminPhoneE164,
      instData.adminPhone,
      instData.phone,
      configData.contactPhone,
      configData.phone
    ];
    for (const val of fallbacks) {
      const e164 = normalizePhoneToE164(val);
      if (e164) return e164;
    }
    return '';
  }

  const [accessSnap, staffSnap] = await Promise.all([
    uid ? db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/staffAccess/${uid}`).get().catch(() => null) : Promise.resolve(null),
    staffId ? db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/staff/${staffId}`).get().catch(() => null) : Promise.resolve(null)
  ]);
  const accessData = accessSnap?.exists ? (accessSnap.data() || {}) : {};
  const staffData = staffSnap?.exists ? (staffSnap.data() || {}) : {};

  const staffFallbacks = [
    accessData.phoneE164,
    accessData.phone,
    staffData.phoneE164,
    staffData.phone,
    staffData.mobile
  ];
  for (const val of staffFallbacks) {
    const e164 = normalizePhoneToE164(val);
    if (e164) return e164;
  }
  return '';
};

const isCompanyOwnerAuth = async (authCtx) => {
  if (!authCtx || !authCtx.token) return false;
  if (authCtx.token.firebase?.sign_in_provider === 'anonymous') return false;
  const email = String(authCtx.token.email || '').trim().toLowerCase();
  if (!email) return false;

  const snap = await db.collection(COMPANY_COLLECTION).doc(COMPANY_CONFIG_DOC_ID).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  if (String(data.email || '').trim().toLowerCase() === email) return true;
  if (data.ownersIndex && (data.ownersIndex[email] === true || data.ownersIndex[authCtx.token.email] === true)) {
    return true;
  }
  if (Array.isArray(data.owners)) {
    return data.owners.some(
      (o) => o && o.isActive !== false && String(o.email || '').trim().toLowerCase() === email
    );
  }
  return false;
};

const isInstitutionAdminOrCompanyOwner = async (authCtx, slug) => {
  if (!authCtx || !authCtx.uid || !authCtx.token) return false;
  if (await isCompanyOwnerAuth(authCtx)) return true;

  const token = authCtx.token;
  if (token.firebase?.sign_in_provider !== 'custom' || token.customAuth !== true) return false;
  if (String(token.institutionId || '').trim().toLowerCase() !== slug) return false;

  if (token.role === 'super_admin') {
    const adminSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/adminAuth`).get();
    if (!adminSnap.exists) return false;
    const adminData = adminSnap.data() || {};
    return adminData.uid === authCtx.uid && adminData.isActive !== false;
  }

  if (token.role === 'staff') {
    const accessSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/staffAccess/${authCtx.uid}`).get();
    if (!accessSnap.exists) return false;
    const access = accessSnap.data() || {};
    return access.isActive !== false && (access.canAccessAdmin === true || access.actLikeSuperAdmin === true);
  }

  return false;
};

const evaluateInstitutionDoc = (slug, inst = {}) => {
  const isActive = inst.isActive !== false && String(inst.status || 'active').toLowerCase() === 'active';
  let expired = false;
  if (inst.isLifetime !== true && inst.expiryTimestamp) {
    const expMs = typeof inst.expiryTimestamp?.toMillis === 'function'
      ? inst.expiryTimestamp.toMillis()
      : Number(inst.expiryTimestamp);
    if (Number.isFinite(expMs) && Date.now() > expMs) {
      expired = true;
    }
  }
  const studentPageAllowed = !(
    inst?.allowedPages
    && typeof inst.allowedPages === 'object'
    && inst.allowedPages.student === false
  );
  return {
    slug: normalizeInstitutionSlug(slug),
    exists: true,
    active: isActive,
    expired,
    studentPageAllowed,
    name: String(inst.name || slug).trim(),
    pauseReason: String(inst.pauseReason || '').trim()
  };
};

const checkInstitutionOperationalStatus = async (slug) => {
  const instSnap = await db.collection(INSTITUTIONS_COLLECTION).doc(slug).get();
  if (!instSnap.exists) {
    return { exists: false, active: true, expired: false, studentPageAllowed: true, name: slug, pauseReason: '' };
  }
  return evaluateInstitutionDoc(slug, instSnap.data() || {});
};

const getActiveOperationalInstitutions = async () => {
  const snap = await db.collection(INSTITUTIONS_COLLECTION).get();
  const list = [];
  snap.forEach((docSnap) => {
    const slug = normalizeInstitutionSlug(docSnap.id);
    if (!slug) return;
    const status = evaluateInstitutionDoc(slug, docSnap.data() || {});
    if (status.active && !status.expired) {
      list.push(status);
    }
  });
  return list;
};

const runInBatches = async (items = [], batchSize = 8, worker = async () => null) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkRes = await Promise.all(chunk.map((item) => worker(item)));
    results.push(...chunkRes);
  }
  return results;
};

const isStudentActiveRecord = (st = {}) => {
  if (!st || typeof st !== 'object') return false;
  if (st.isActive === false) return false;
  const statusNorm = String(st.status || '').trim().toLowerCase();
  if (statusNorm === 'inactive' || statusNorm === 'discontinued' || statusNorm === 'tc' || statusNorm === 'left') {
    return false;
  }
  return true;
};

const getCustomPhoneFieldKeysFromConfig = (configData = {}) => {
  const fields = Array.isArray(configData?.studentFields) ? configData.studentFields : [];
  return fields
    .filter((f) => f && f.system !== true && String(f.type || '').toLowerCase() === 'phone' && f.key)
    .map((f) => String(f.key).trim())
    .filter(Boolean);
};

const extractStudentPhoneCandidates = (st = {}, customPhoneKeys = []) => {
  const prof = (st.profile && typeof st.profile === 'object') ? st.profile : {};
  const customTop = (st.customFields && typeof st.customFields === 'object') ? st.customFields : {};
  const customProf = (prof.customFields && typeof prof.customFields === 'object') ? prof.customFields : {};
  const list = [
    st.mobile,
    st.phone,
    st.motherMobile,
    st.mother_mobile,
    st.fatherPhone,
    st.fatherMobile,
    st.motherPhone,
    prof.mobile,
    prof.phone,
    prof.motherMobile
  ];
  if (Array.isArray(st.phones)) list.push(...st.phones);
  if (Array.isArray(customPhoneKeys) && customPhoneKeys.length > 0) {
    customPhoneKeys.forEach((key) => {
      if (customTop[key]) list.push(customTop[key]);
      if (customProf[key]) list.push(customProf[key]);
    });
  }
  return list.filter(Boolean);
};

const findMatchingStudentsByPhone = async (slug, targetPhoneE164, institutionName = '', customPhoneKeys = null) => {
  let resolvedCustomPhoneKeys = Array.isArray(customPhoneKeys) ? customPhoneKeys : null;
  if (resolvedCustomPhoneKeys === null) {
    try {
      const cfgSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/config`).get();
      resolvedCustomPhoneKeys = cfgSnap.exists ? getCustomPhoneFieldKeysFromConfig(cfgSnap.data() || {}) : [];
    } catch (_) {
      resolvedCustomPhoneKeys = [];
    }
  }
  const studentsSnap = await db.collection(`${INSTITUTIONS_COLLECTION}/${slug}/students`).get();
  const matched = [];
  studentsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!isStudentActiveRecord(data)) return;
    const candidates = extractStudentPhoneCandidates(data, resolvedCustomPhoneKeys);
    if (candidates.some((cand) => phonesMatch(cand, targetPhoneE164))) {
      const prof = (data.profile && typeof data.profile === 'object') ? data.profile : {};
      matched.push({
        studentId: docSnap.id,
        institutionId: slug,
        institutionName: String(institutionName || slug).trim(),
        name: String(data.name || prof.name || 'Student').trim(),
        class: String(data.class || prof.class || '').trim(),
        adm: String(data.adm || data.admissionNo || prof.adm || '').trim(),
        photo: String(data.photo || prof.photo || '').trim()
      });
    }
  });
  matched.sort((a, b) => a.name.localeCompare(b.name));
  return matched;
};

const findMatchingStudentsAcrossInstitutions = async (targetPhoneE164) => {
  const activeInstitutions = (await getActiveOperationalInstitutions()).filter((inst) => inst.studentPageAllowed !== false);
  const perInstMatches = await runInBatches(activeInstitutions, 8, async (inst) => {
    try {
      const configSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${inst.slug}/settings/config`).get();
      const configData = configSnap.exists ? (configSnap.data() || {}) : {};
      if (configData?.enabledModules?.student === false) return [];
      const displayInstName = String(configData?.appName || inst.name || inst.slug).trim();
      const customPhoneKeys = getCustomPhoneFieldKeysFromConfig(configData);
      return await findMatchingStudentsByPhone(inst.slug, targetPhoneE164, displayInstName, customPhoneKeys);
    } catch (_) {
      return [];
    }
  });
  const matched = perInstMatches.flat().filter(Boolean);
  matched.sort((a, b) => a.name.localeCompare(b.name) || a.institutionName.localeCompare(b.institutionName));
  return matched;
};

const normalizeDirectoryUsernameKey = (value = '') => String(value || '').trim().toLowerCase().replace(/[\\/\s]+/g, '_');

const findMatchingDirectoryUserAcrossInstitutions = async (rawUsername) => {
  const cleanLower = String(rawUsername || '').trim().toLowerCase();
  const cleanKey = normalizeDirectoryUsernameKey(rawUsername);
  if (!cleanLower) return null;

  const activeInstitutions = await getActiveOperationalInstitutions();
  const perInstMatches = await runInBatches(activeInstitutions, 8, async (inst) => {
    try {
      const authConfSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${inst.slug}/settings/categoryAuthConfig`).get();
      if (!authConfSnap.exists) return null;
      const categories = authConfSnap.data()?.categories || {};
      const hasEnabledCategory = Object.values(categories).some((c) => c && c.enabled === true);
      if (!hasEnabledCategory) return null;

      const [dirSnap, accessSnap] = await Promise.all([
        db.collection(`${INSTITUTIONS_COLLECTION}/${inst.slug}/publicDirectory`).get(),
        db.doc(`${INSTITUTIONS_COLLECTION}/${inst.slug}/settings/pageAccess`).get()
      ]);
      const pageAccessData = accessSnap.exists ? (accessSnap.data() || {}) : {};
      let found = null;

      dirSnap.forEach((docSnap) => {
        if (found) return;
        const entry = { id: docSnap.id, ...(docSnap.data() || {}) };
        if (!entry.categoryId) return;
        const authConf = categories[entry.categoryId] || {};
        if (authConf.enabled !== true) return;
        if (pageAccessData?.overrides?.[entry.id]?.blocked === true) return;

        const values = (entry.values && typeof entry.values === 'object') ? entry.values : {};
        const usernameField = String(authConf.usernameField || '').trim();
        const configuredUsername = usernameField ? String(values[usernameField] || '').trim().toLowerCase() : '';
        const authUsername = String(entry.authMeta?.username || '').trim().toLowerCase();
        const candidates = [authUsername, configuredUsername].filter(Boolean);
        const isMatch = candidates.some((u) => u === cleanLower || normalizeDirectoryUsernameKey(u) === cleanKey);
        if (!isMatch) return;

        const rawPhone = values.phone || values.Phone || values.mobile || values.Mobile || values.contact || entry.phone || '';
        const phoneE164 = normalizePhoneToE164(rawPhone);
        const displayName = String(entry.name || values.name || values.Name || entry.authMeta?.usernameRaw || rawUsername).trim();
        const roleTitle = String(values.role || entry.role || 'Category User').trim();
        const resolvedUsername = authUsername || configuredUsername || cleanLower;

        found = {
          found: true,
          isActive: true,
          accountType: 'directory',
          displayName,
          displayUsername: String(entry.authMeta?.usernameRaw || rawUsername).trim(),
          username: resolvedUsername,
          role: 'directory',
          roleTitle,
          entryId: entry.id,
          categoryId: entry.categoryId,
          institutionId: inst.slug,
          institutionName: inst.name || inst.slug,
          institutionActive: true,
          institutionExpired: false,
          hasPhone: Boolean(phoneE164),
          maskedPhone: phoneE164 ? maskPhoneDisplay(phoneE164) : ''
        };
      });
      return found;
    } catch (_) {
      return null;
    }
  });

  return perInstMatches.find(Boolean) || null;
};

const mintOfficialCustomToken = async (uid, customClaims) => {
  try {
    return await adminAuth.createCustomToken(uid, customClaims);
  } catch (tokenErr) {
    console.error('[mintOfficialCustomToken] createCustomToken failed:', tokenErr);
    const errText = String(tokenErr?.message || tokenErr || '');
    if (/signBlob|iamcredentials|permission|denied|token creator/i.test(errText)) {
      throw new HttpsError(
        'failed-precondition',
        'Custom token signing permission is missing on the Cloud Functions runtime service account. Grant "Service Account Token Creator" to the Compute Engine default service account and enable the IAM Service Account Credentials API.'
      );
    }
    throw new HttpsError('internal', `Failed to generate authentication token: ${errText.slice(0, 180)}`);
  }
};

// =========================================================================
// 1. PUBLIC STEP-1 LOOKUP: verifyLoginIdentifier
// =========================================================================
exports.verifyLoginIdentifier = onCall({ cors: true }, async (request) => {
  const rawUsername = String(request.data?.username || '').trim();
  const requestedInst = normalizeInstitutionSlug(request.data?.institutionId || '');

  if (!rawUsername || /\s/.test(rawUsername) || rawUsername.length < 3 || rawUsername.length > 60) {
    return { found: false };
  }

  const normalized = rawUsername.toLowerCase();
  const keyHash = sha256Hex(normalized);
  const credSnap = await db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash).get();

  if (!credSnap.exists) {
    if (!requestedInst) {
      const dirMatch = await findMatchingDirectoryUserAcrossInstitutions(rawUsername);
      if (dirMatch) {
        return dirMatch;
      }
    }
    return { found: false };
  }

  const cred = credSnap.data() || {};
  const credInst = normalizeInstitutionSlug(cred.institutionId || '');

  // If verifying inside a specific institution portal, ensure the account belongs to that institution
  if (requestedInst && credInst && requestedInst !== credInst) {
    return { found: false };
  }

  if (cred.isActive === false) {
    return {
      found: true,
      isActive: false,
      displayName: String(cred.displayName || cred.displayUsername || 'Account'),
      displayUsername: String(cred.displayUsername || cred.username || rawUsername),
      role: String(cred.role || 'staff'),
      institutionId: credInst,
      institutionName: String(cred.institutionName || credInst),
      hasPhone: false,
      maskedPhone: ''
    };
  }

  const [instStatus, resolvedPhoneE164] = await Promise.all([
    credInst ? checkInstitutionOperationalStatus(credInst) : Promise.resolve({ active: true, expired: false, name: '' }),
    resolveOfficialPhoneE164(cred, credInst)
  ]);

  return {
    found: true,
    isActive: true,
    displayName: String(cred.displayName || cred.displayUsername || 'User'),
    displayUsername: String(cred.displayUsername || cred.username || rawUsername),
    username: String(cred.username || normalized),
    role: String(cred.role || 'staff'),
    institutionId: credInst,
    institutionName: instStatus.name || String(cred.institutionName || credInst),
    institutionActive: instStatus.active,
    institutionExpired: instStatus.expired,
    hasPhone: Boolean(resolvedPhoneE164),
    maskedPhone: resolvedPhoneE164 ? maskPhoneDisplay(resolvedPhoneE164) : ''
  };
});

// =========================================================================
// 2A. OFFICIAL 2FA STEP-2: verifyOfficialPasswordForOtp
// =========================================================================
exports.verifyOfficialPasswordForOtp = onCall({ cors: true }, async (request) => {
  const rawUsername = String(request.data?.username || '').trim();
  const rawPassword = String(request.data?.password || '');
  const requestedInst = normalizeInstitutionSlug(request.data?.institutionId || '');

  if (!rawUsername || !rawPassword) {
    throw new HttpsError('invalid-argument', 'Username and password are required.');
  }
  if (/\s/.test(rawUsername)) {
    throw new HttpsError('unauthenticated', 'Invalid username or password.');
  }

  const normalized = rawUsername.toLowerCase();
  const keyHash = sha256Hex(normalized);
  const credRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);
  const credSnap = await credRef.get();

  if (!credSnap.exists) {
    throw new HttpsError('unauthenticated', 'Invalid username or password.');
  }

  const cred = credSnap.data() || {};
  const credInst = normalizeInstitutionSlug(cred.institutionId || '');

  if (requestedInst && credInst && requestedInst !== credInst) {
    throw new HttpsError('permission-denied', 'This account does not belong to this institution.');
  }

  // Brute-force lockout guard
  const nowMs = Date.now();
  const lockUntilMs = Number(cred.lockUntilMs || 0);
  if (lockUntilMs > nowMs) {
    const minsLeft = Math.max(1, Math.ceil((lockUntilMs - nowMs) / 60000));
    throw new HttpsError(
      'resource-exhausted',
      `Too many failed login attempts. Please try again in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}.`
    );
  }

  const passwordValid = verifyPasswordScrypt(rawPassword, cred.passwordSalt, cred.passwordHash);
  if (!passwordValid) {
    const nextFailed = Number(cred.failedAttempts || 0) + 1;
    const updateData = {
      failedAttempts: nextFailed,
      lastFailedAt: new Date().toISOString()
    };
    if (nextFailed >= MAX_FAILED_ATTEMPTS) {
      updateData.lockUntilMs = nowMs + LOCKOUT_MS;
      updateData.failedAttempts = 0;
    }
    await credRef.set(updateData, { merge: true }).catch(() => {});
    throw new HttpsError('unauthenticated', 'Invalid username or password.');
  }

  if (cred.isActive === false) {
    throw new HttpsError('permission-denied', 'This account has been deactivated. Contact your administrator.');
  }

  const instStatus = credInst ? await checkInstitutionOperationalStatus(credInst) : { active: true, expired: false, name: '', pauseReason: '' };
  if (!instStatus.active) {
    throw new HttpsError(
      'permission-denied',
      instStatus.pauseReason
        ? `Institution access is paused: ${instStatus.pauseReason}`
        : 'Institution access is currently paused. Contact platform support.'
    );
  }
  if (instStatus.expired) {
    throw new HttpsError('permission-denied', 'Institution subscription has expired. Please renew to continue.');
  }

  const role = cred.role === 'super_admin' ? 'super_admin' : 'staff';
  const staffId = String(cred.staffId || '').trim();
  const uid = String(cred.uid || (role === 'super_admin' ? buildSuperAdminUid(credInst) : buildStaffUid(credInst, staffId)));
  const displayUsername = String(cred.displayUsername || cred.username || rawUsername);

  // Verify live institution authorization doc before sending OTP
  let liveDisplayName = String(cred.displayName || displayUsername);
  if (role === 'super_admin') {
    const adminSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${credInst}/settings/adminAuth`).get();
    if (!adminSnap.exists || adminSnap.data()?.isActive === false) {
      throw new HttpsError('permission-denied', 'Super Admin access is not active for this institution.');
    }
    liveDisplayName = String(adminSnap.data()?.name || cred.displayName || 'Super Admin');
  } else {
    const accessSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${credInst}/staffAccess/${uid}`).get();
    if (!accessSnap.exists || accessSnap.data()?.isActive === false) {
      throw new HttpsError('permission-denied', 'Staff account is inactive or has no portal access.');
    }
    liveDisplayName = String(accessSnap.data()?.name || cred.displayName || displayUsername);
  }

  const phoneE164 = await resolveOfficialPhoneE164(cred, credInst);
  if (!phoneE164) {
    throw new HttpsError(
      'failed-precondition',
      role === 'super_admin'
        ? 'No mobile number is registered for this Super Admin account. Please contact the Company Console administrator to add a mobile number for OTP verification.'
        : 'No mobile number is registered for this Staff account. Please contact your institution administrator to add a valid mobile number for OTP verification.'
    );
  }

  // Enforce SMS abuse protection rate limit
  await enforceOtpRateLimit(`official:${credInst}:${uid}:${phoneE164}`, OTP_SEND_MAX_REQUESTS);

  // Reset failed password attempts on verified password
  if (Number(cred.failedAttempts || 0) > 0 || Number(cred.lockUntilMs || 0) > 0) {
    await credRef.set({ failedAttempts: 0, lockUntilMs: 0 }, { merge: true }).catch(() => {});
  }

  const challengeId = await createOtpChallenge({
    type: 'official',
    keyHash,
    uid,
    role,
    staffId,
    username: normalized,
    displayUsername,
    displayName: liveDisplayName,
    institutionId: credInst,
    institutionName: instStatus.name || String(cred.institutionName || credInst),
    expectedPhoneE164: phoneE164
  });

  return {
    requiresOtp: true,
    challengeId,
    phoneE164,
    maskedPhone: maskPhoneDisplay(phoneE164),
    role,
    displayName: liveDisplayName,
    institutionId: credInst,
    institutionName: instStatus.name || String(cred.institutionName || credInst)
  };
});

// =========================================================================
// 2B. OFFICIAL 2FA STEP-3: completeOfficialOtpLogin
// =========================================================================
exports.completeOfficialOtpLogin = onCall({ cors: true }, async (request) => {
  const challengeId = String(request.data?.challengeId || '').trim();
  const phoneIdToken = String(request.data?.phoneIdToken || '').trim();

  if (!challengeId || !phoneIdToken) {
    throw new HttpsError('invalid-argument', 'OTP verification session and phone token are required.');
  }

  // Verify phone ID token first before consuming challenge (so wrong/expired token doesn't waste challenge unnecessarily)
  const challengeSnap = await db.collection(OTP_CHALLENGES_COLLECTION).doc(challengeId).get();
  if (!challengeSnap.exists) {
    throw new HttpsError('not-found', 'OTP verification session expired. Please verify your password again.');
  }
  const previewChallenge = challengeSnap.data() || {};
  await verifyPhoneAuthToken(phoneIdToken, previewChallenge.expectedPhoneE164);

  // Atomically consume one-time challenge
  const challenge = await consumeOtpChallenge(challengeId, 'official');

  const credInst = normalizeInstitutionSlug(challenge.institutionId || '');
  const role = challenge.role === 'super_admin' ? 'super_admin' : 'staff';
  const uid = String(challenge.uid || '');
  const staffId = String(challenge.staffId || '');
  const username = String(challenge.username || '');
  const displayUsername = String(challenge.displayUsername || username);

  // Re-verify live operational status and authorization
  const instStatus = credInst ? await checkInstitutionOperationalStatus(credInst) : { active: true, expired: false, name: '', pauseReason: '' };
  if (!instStatus.active) {
    throw new HttpsError('permission-denied', 'Institution access is currently paused.');
  }
  if (instStatus.expired) {
    throw new HttpsError('permission-denied', 'Institution subscription has expired.');
  }

  let liveAccess = null;
  let liveDisplayName = String(challenge.displayName || displayUsername);
  if (role === 'super_admin') {
    const adminSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${credInst}/settings/adminAuth`).get();
    if (!adminSnap.exists || adminSnap.data()?.isActive === false) {
      throw new HttpsError('permission-denied', 'Super Admin access is not active for this institution.');
    }
    liveDisplayName = String(adminSnap.data()?.name || liveDisplayName);
  } else {
    const accessSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${credInst}/staffAccess/${uid}`).get();
    if (!accessSnap.exists || accessSnap.data()?.isActive === false) {
      throw new HttpsError('permission-denied', 'Staff account is inactive or has no portal access.');
    }
    liveAccess = accessSnap.data() || {};
    liveDisplayName = String(liveAccess.name || liveDisplayName);
  }

  if (challenge.keyHash) {
    await db.collection(AUTH_CREDENTIALS_COLLECTION).doc(challenge.keyHash).set({
      lastLoginAt: new Date().toISOString(),
      lastOtpVerifiedAt: new Date().toISOString(),
      phoneE164: challenge.expectedPhoneE164
    }, { merge: true }).catch(() => {});
  }

  const customToken = await mintOfficialCustomToken(uid, {
    customAuth: true,
    role,
    institutionId: credInst,
    staffId,
    username,
    displayUsername,
    phoneVerified: true
  });

  return {
    customToken,
    profile: {
      uid,
      role,
      institutionId: credInst,
      institutionName: instStatus.name || String(challenge.institutionName || credInst),
      staffId,
      username,
      displayUsername,
      displayName: liveDisplayName,
      phone: challenge.expectedPhoneE164,
      access: liveAccess
    }
  };
});

// =========================================================================
// 2C. LEGACY ENDPOINT HARDENING: loginWithCustomUsername
// =========================================================================
exports.loginWithCustomUsername = onCall({ cors: true }, async () => {
  throw new HttpsError(
    'failed-precondition',
    'Direct password-only login has been replaced by 2-Step Phone OTP Verification. Please refresh the page and sign in with OTP.'
  );
});

// =========================================================================
// 3A. DIRECTORY / MANAGEMENT USER 2FA: verifyDirectoryPasswordForOtp
// =========================================================================
exports.verifyDirectoryPasswordForOtp = onCall({ cors: true }, async (request) => {
  const slug = normalizeInstitutionSlug(request.data?.institutionId || '');
  const rawUsername = String(request.data?.username || '').trim().toLowerCase();
  const rawPassword = String(request.data?.password || '').trim();

  if (!slug || !rawUsername || !rawPassword) {
    throw new HttpsError('invalid-argument', 'Institution, username, and password are required.');
  }

  const instStatus = await checkInstitutionOperationalStatus(slug);
  if (!instStatus.active) {
    throw new HttpsError('permission-denied', 'Institution access is currently paused.');
  }
  if (instStatus.expired) {
    throw new HttpsError('permission-denied', 'Institution subscription has expired.');
  }

  const [dirSnap, authConfSnap, accessSnap] = await Promise.all([
    db.collection(`${INSTITUTIONS_COLLECTION}/${slug}/publicDirectory`).get(),
    db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/categoryAuthConfig`).get(),
    db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/pageAccess`).get()
  ]);

  const categoryAuthConfig = authConfSnap.exists ? (authConfSnap.data()?.categories || {}) : {};
  const pageAccessData = accessSnap.exists ? (accessSnap.data() || {}) : {};
  const passwordHash = sha256Hex(rawPassword);

  let matchedEntry = null;
  let matchedAccess = null;

  dirSnap.forEach((docSnap) => {
    if (matchedEntry) return;
    const entry = { id: docSnap.id, ...(docSnap.data() || {}) };
    if (!entry.categoryId) return;
    const authConf = categoryAuthConfig[entry.categoryId] || {};
    if (authConf.enabled !== true) return;
    const authMeta = (entry.authMeta && typeof entry.authMeta === 'object') ? entry.authMeta : {};
    const values = (entry.values && typeof entry.values === 'object') ? entry.values : {};
    const usernameField = String(authConf.usernameField || '').trim();
    const configuredUsername = usernameField ? String(values[usernameField] || '').trim().toLowerCase() : '';
    const authUsername = String(authMeta.username || '').trim().toLowerCase();
    const cleanKey = normalizeDirectoryUsernameKey(rawUsername);
    const usernameMatches = [authUsername, configuredUsername]
      .filter(Boolean)
      .some((u) => u === rawUsername || normalizeDirectoryUsernameKey(u) === cleanKey);
    if (!usernameMatches) return;
    if (String(authMeta.passwordHash || '').trim() !== passwordHash) return;

    const override = pageAccessData?.overrides?.[entry.id] || {};
    if (override.blocked === true) {
      matchedEntry = { blocked: true };
      return;
    }
    const catAccess = pageAccessData?.categories?.[entry.categoryId] || {};
    matchedEntry = entry;
    matchedAccess = {
      collection: (override.collection === true) || (override.collection !== false && catAccess.collection === true),
      student: (override.student === true) || (override.student !== false && catAccess.student === true),
      worksheet: true,
      source: 'directory',
      categoryId: entry.categoryId,
      entryId: entry.id
    };
  });

  if (!matchedEntry) {
    throw new HttpsError('unauthenticated', 'Incorrect username or password.');
  }
  if (matchedEntry.blocked) {
    throw new HttpsError('permission-denied', 'Your portal access has been blocked by the administrator.');
  }

  const values = (matchedEntry.values && typeof matchedEntry.values === 'object') ? matchedEntry.values : {};
  const rawPhone = values.phone || values.mobile || values.contact || matchedEntry.phone || '';
  const phoneE164 = normalizePhoneToE164(rawPhone);
  if (!phoneE164) {
    throw new HttpsError(
      'failed-precondition',
      'No mobile number is registered for this directory account. Please ask your institution administrator to add your mobile number for OTP verification.'
    );
  }

  await enforceOtpRateLimit(`directory:${slug}:${matchedEntry.id}:${phoneE164}`, OTP_SEND_MAX_REQUESTS);

  const displayName = String(matchedEntry.name || values.name || values.Name || matchedEntry.authMeta?.usernameRaw || rawUsername).trim();
  const roleTitle = String(values.role || matchedEntry.role || 'Category User').trim();

  const challengeId = await createOtpChallenge({
    type: 'directory',
    institutionId: slug,
    entryId: matchedEntry.id,
    categoryId: matchedEntry.categoryId || '',
    username: rawUsername,
    displayName,
    roleTitle,
    access: matchedAccess,
    expectedPhoneE164: phoneE164
  });

  return {
    requiresOtp: true,
    challengeId,
    phoneE164,
    maskedPhone: maskPhoneDisplay(phoneE164),
    displayName,
    roleTitle
  };
});

// =========================================================================
// 3B. DIRECTORY / MANAGEMENT USER 2FA: completeDirectoryOtpLogin
// =========================================================================
exports.completeDirectoryOtpLogin = onCall({ cors: true }, async (request) => {
  const challengeId = String(request.data?.challengeId || '').trim();
  const phoneIdToken = String(request.data?.phoneIdToken || '').trim();

  if (!challengeId || !phoneIdToken) {
    throw new HttpsError('invalid-argument', 'OTP verification session and phone token are required.');
  }

  const challengeSnap = await db.collection(OTP_CHALLENGES_COLLECTION).doc(challengeId).get();
  if (!challengeSnap.exists) {
    throw new HttpsError('not-found', 'OTP verification session expired. Please verify your password again.');
  }
  const preview = challengeSnap.data() || {};
  await verifyPhoneAuthToken(phoneIdToken, preview.expectedPhoneE164);

  const challenge = await consumeOtpChallenge(challengeId, 'directory');

  return {
    ok: true,
    profile: {
      institutionId: challenge.institutionId,
      entryId: challenge.entryId,
      categoryId: challenge.categoryId,
      username: challenge.username,
      displayName: challenge.displayName,
      roleTitle: challenge.roleTitle,
      phone: challenge.expectedPhoneE164,
      access: challenge.access || {}
    }
  };
});

// =========================================================================
// 4A. STUDENT OTP STEP-1: lookupStudentsByPhone (Single or Cross-Institution)
// =========================================================================
exports.lookupStudentsByPhone = onCall({ cors: true }, async (request) => {
  const slug = normalizeInstitutionSlug(request.data?.institutionId || '');
  const rawPhone = String(request.data?.phone || '').trim();
  const countryCode = normalizeCountryCode(request.data?.countryCode || '+91');

  const phoneE164 = normalizePhoneToE164(rawPhone, countryCode);
  if (!phoneE164) {
    throw new HttpsError('invalid-argument', 'Please enter a valid mobile number.');
  }

  let matched = [];
  if (slug) {
    const instStatus = await checkInstitutionOperationalStatus(slug);
    if (!instStatus.active) {
      throw new HttpsError(
        'permission-denied',
        instStatus.pauseReason
          ? `Institution access is paused: ${instStatus.pauseReason}`
          : 'Institution access is currently paused.'
      );
    }
    if (instStatus.expired) {
      throw new HttpsError('permission-denied', 'Institution subscription has expired.');
    }

    await enforceOtpRateLimit(`student-lookup:${slug}:${phoneE164}`);
    matched = await findMatchingStudentsByPhone(slug, phoneE164, instStatus.name);
  } else {
    await enforceOtpRateLimit(`student-lookup:global:${phoneE164}`);
    matched = await findMatchingStudentsAcrossInstitutions(phoneE164);
  }

  if (!matched.length) {
    return {
      found: false,
      count: 0,
      phoneE164,
      maskedPhone: maskPhoneDisplay(phoneE164),
      students: []
    };
  }

  // Return full student name, class, and institution for confirmation before OTP verification
  const studentConfirmations = matched.map((st) => {
    const fullName = String(st.name || 'Student').trim() || 'Student';
    return {
      name: fullName,
      fullName,
      maskedName: fullName,
      classLabel: st.class ? `Class ${st.class}` : 'Student',
      institutionId: st.institutionId || slug || '',
      institutionName: st.institutionName || ''
    };
  });

  return {
    found: true,
    count: matched.length,
    phoneE164,
    maskedPhone: maskPhoneDisplay(phoneE164),
    students: studentConfirmations
  };
});

// =========================================================================
// 4B. STUDENT OTP STEP-3: completeStudentOtpLogin (Verified Full Profiles)
// =========================================================================
exports.completeStudentOtpLogin = onCall({ cors: true }, async (request) => {
  const slug = normalizeInstitutionSlug(request.data?.institutionId || '');
  const phoneIdToken = String(request.data?.phoneIdToken || '').trim();

  if (!phoneIdToken) {
    throw new HttpsError('invalid-argument', 'Verified OTP token is required.');
  }

  let matched = [];
  const verified = await verifyPhoneAuthToken(phoneIdToken);

  if (slug) {
    const instStatus = await checkInstitutionOperationalStatus(slug);
    if (!instStatus.active) {
      throw new HttpsError('permission-denied', 'Institution access is currently paused.');
    }
    if (instStatus.expired) {
      throw new HttpsError('permission-denied', 'Institution subscription has expired.');
    }
    matched = await findMatchingStudentsByPhone(slug, verified.phoneE164, instStatus.name);
  } else {
    matched = await findMatchingStudentsAcrossInstitutions(verified.phoneE164);
  }

  if (!matched.length) {
    throw new HttpsError(
      'not-found',
      'No active student record is linked to this verified mobile number.'
    );
  }

  const uniqueInstIds = Array.from(new Set(matched.map((s) => s.institutionId).filter(Boolean)));
  return {
    ok: true,
    institutionId: slug || (uniqueInstIds.length === 1 ? uniqueInstIds[0] : ''),
    verifiedPhoneE164: verified.phoneE164,
    maskedPhone: maskPhoneDisplay(verified.phoneE164),
    students: matched
  };
});

// =========================================================================
// 5. PROTECTED (COMPANY OWNER ONLY): upsertInstitutionSuperAdminCredential
// =========================================================================
exports.upsertInstitutionSuperAdminCredential = onCall({ cors: true }, async (request) => {
  if (!(await isCompanyOwnerAuth(request.auth))) {
    throw new HttpsError('permission-denied', 'Only verified Company Owners can manage institution Super Admin credentials.');
  }

  const slug = normalizeInstitutionSlug(request.data?.slug || '');
  if (!slug) {
    throw new HttpsError('invalid-argument', 'Valid institution slug is required.');
  }

  const { displayUsername, username, keyHash } = validateAndNormalizeUsername(request.data?.username || '');
  const rawPassword = String(request.data?.password || '');
  const rawPhone = String(request.data?.phone || '').trim();
  const normalizedPhoneE164 = rawPhone ? normalizePhoneToE164(rawPhone) : '';
  if (rawPhone && !normalizedPhoneE164) {
    throw new HttpsError('invalid-argument', 'Please enter a valid Super Admin mobile number (e.g., 10 digits or +91XXXXXXXXXX).');
  }

  const adminName = String(request.data?.adminName || 'Master Admin').trim().slice(0, 120) || 'Master Admin';
  const institutionName = String(request.data?.institutionName || slug).trim().slice(0, 140) || slug;
  const isCreate = request.data?.mode === 'create';

  if (isCreate && rawPassword.length < 6) {
    throw new HttpsError('invalid-argument', 'Super Admin password must be at least 6 characters.');
  }
  if (rawPassword && (rawPassword.length < 6 || rawPassword.length > 128)) {
    throw new HttpsError('invalid-argument', 'Super Admin password must be between 6 and 128 characters.');
  }

  const uid = buildSuperAdminUid(slug);
  const newPasswordHashObj = rawPassword ? hashPasswordScrypt(rawPassword) : null;
  const adminAuthRef = db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/adminAuth`);
  const newCredRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);

  let savedPhone = '';
  let savedPhoneE164 = '';

  await db.runTransaction(async (tx) => {
    const existingAdminSnap = await tx.get(adminAuthRef);
    const existingAdmin = existingAdminSnap.exists ? (existingAdminSnap.data() || {}) : {};
    const oldKeyHash = String(existingAdmin.credentialKeyHash || '').trim();

    let existingOldCred = null;
    if (oldKeyHash && oldKeyHash !== keyHash) {
      const oldCredSnap = await tx.get(db.collection(AUTH_CREDENTIALS_COLLECTION).doc(oldKeyHash));
      if (oldCredSnap.exists) {
        existingOldCred = oldCredSnap.data() || {};
      }
    }

    const targetCredSnap = await tx.get(newCredRef);
    if (targetCredSnap.exists) {
      const holder = targetCredSnap.data() || {};
      const sameOwner = holder.uid === uid && holder.institutionId === slug && holder.role === 'super_admin';
      if (!sameOwner) {
        throw new HttpsError(
          'already-exists',
          `Username "${displayUsername}" is already in use by another account. Please choose a globally unique username.`
        );
      }
      if (!existingOldCred) {
        existingOldCred = holder;
      }
    }

    const finalSalt = newPasswordHashObj ? newPasswordHashObj.passwordSalt : String(existingOldCred?.passwordSalt || '');
    const finalHash = newPasswordHashObj ? newPasswordHashObj.passwordHash : String(existingOldCred?.passwordHash || '');

    if (!finalSalt || !finalHash) {
      throw new HttpsError('invalid-argument', 'A password (at least 6 characters) is required for this Super Admin account.');
    }

    savedPhoneE164 = normalizedPhoneE164
      || String(existingOldCred?.phoneE164 || existingAdmin.phoneE164 || '').trim()
      || normalizePhoneToE164(existingAdmin.phone || '');
    savedPhone = rawPhone || String(existingOldCred?.phone || existingAdmin.phone || savedPhoneE164 || '').trim();

    const nowIso = new Date().toISOString();
    tx.set(newCredRef, {
      keyHash,
      username,
      displayUsername,
      passwordSalt: finalSalt,
      passwordHash: finalHash,
      uid,
      role: 'super_admin',
      institutionId: slug,
      institutionName,
      staffId: '',
      displayName: adminName,
      phone: savedPhone,
      phoneE164: savedPhoneE164,
      isActive: true,
      failedAttempts: 0,
      lockUntilMs: 0,
      updatedBy: String(request.auth.token.email || 'company').slice(0, 160),
      updatedAt: nowIso,
      createdAt: existingOldCred?.createdAt || nowIso
    });

    if (oldKeyHash && oldKeyHash !== keyHash) {
      tx.delete(db.collection(AUTH_CREDENTIALS_COLLECTION).doc(oldKeyHash));
    }

    tx.set(adminAuthRef, {
      uid,
      username,
      displayUsername,
      loginDisplay: displayUsername,
      name: adminName,
      phone: savedPhone,
      phoneE164: savedPhoneE164,
      credentialKeyHash: keyHash,
      isActive: true,
      authMode: 'custom_token',
      adminPassword: FieldValue.delete(),
      passwordHash: FieldValue.delete(),
      authVaultEmail: FieldValue.delete(),
      email: FieldValue.delete(),
      adminsIndex: FieldValue.delete(),
      admins: [
        {
          uid,
          name: adminName,
          username,
          displayUsername,
          phone: savedPhone,
          role: 'super_admin',
          isActive: true
        }
      ],
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return {
    ok: true,
    uid,
    username,
    displayUsername,
    phone: savedPhone,
    phoneE164: savedPhoneE164,
    keyHash
  };
});

// =========================================================================
// 6. PROTECTED (ADMIN / STAFF MANAGER / COMPANY OWNER): manageStaffCredential
// =========================================================================
exports.manageStaffCredential = onCall({ cors: true }, async (request) => {
  const slug = normalizeInstitutionSlug(request.data?.institutionId || '');
  const staffId = String(request.data?.staffId || '').trim();
  const action = String(request.data?.action || 'upsert').trim().toLowerCase();

  if (!slug || !staffId) {
    throw new HttpsError('invalid-argument', 'Institution ID and Staff ID are required.');
  }

  const authorized = await isInstitutionAdminOrCompanyOwner(request.auth, slug);
  if (!authorized) {
    throw new HttpsError('permission-denied', 'You do not have permission to manage staff credentials for this institution.');
  }

  const uid = buildStaffUid(slug, staffId);
  const staffRef = db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/staff/${staffId}`);
  const staffAccessRef = db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/staffAccess/${uid}`);

  if (action === 'delete') {
    await db.runTransaction(async (tx) => {
      const staffSnap = await tx.get(staffRef);
      const accessSnap = await tx.get(staffAccessRef);
      const oldKeyHash = String(
        staffSnap.data()?.credentialKeyHash || accessSnap.data()?.credentialKeyHash || ''
      ).trim();

      if (oldKeyHash) {
        const credRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(oldKeyHash);
        const credSnap = await tx.get(credRef);
        if (credSnap.exists && credSnap.data()?.uid === uid) {
          tx.delete(credRef);
        }
      }
      tx.delete(staffAccessRef);
    });
    return { ok: true, uid, deleted: true };
  }

  if (action === 'sync_status') {
    const isActive = request.data?.isActive !== false;
    const displayName = String(request.data?.displayName || '').trim().slice(0, 120);
    await db.runTransaction(async (tx) => {
      const staffSnap = await tx.get(staffRef);
      const accessSnap = await tx.get(staffAccessRef);
      const keyHash = String(
        staffSnap.data()?.credentialKeyHash || accessSnap.data()?.credentialKeyHash || ''
      ).trim();
      if (keyHash) {
        const credRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);
        const credSnap = await tx.get(credRef);
        if (credSnap.exists && credSnap.data()?.uid === uid) {
          tx.set(credRef, {
            isActive,
            ...(displayName ? { displayName } : {}),
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      }
      if (accessSnap.exists) {
        tx.set(staffAccessRef, {
          isActive,
          ...(displayName ? { name: displayName } : {}),
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    });
    return { ok: true, uid, isActive };
  }

  // Default action: 'upsert'
  const { displayUsername, username, keyHash } = validateAndNormalizeUsername(request.data?.username || '');
  const rawPassword = String(request.data?.password || '');
  const rawPhone = String(request.data?.phone || request.data?.access?.phone || '').trim();
  const normalizedPhoneE164 = rawPhone ? normalizePhoneToE164(rawPhone) : '';
  if (rawPhone && !normalizedPhoneE164) {
    throw new HttpsError('invalid-argument', 'Please enter a valid mobile number for staff OTP verification.');
  }

  const displayName = String(request.data?.displayName || displayUsername).trim().slice(0, 120) || displayUsername;
  const isActive = request.data?.isActive !== false;
  const accessPayload = (request.data?.access && typeof request.data.access === 'object') ? request.data.access : null;

  if (rawPassword && (rawPassword.length < 6 || rawPassword.length > 128)) {
    throw new HttpsError('invalid-argument', 'Password must be between 6 and 128 characters.');
  }

  const instSnap = await db.collection(INSTITUTIONS_COLLECTION).doc(slug).get();
  const instData = instSnap.exists ? (instSnap.data() || {}) : {};
  const institutionName = String(instData.name || slug).trim();

  // Enforce Basic plan maxStaff quota on new staff creation (unless caller is Company Owner)
  const isBasicTenant = String(instData.planTier || '').trim().toLowerCase() === 'basic';
  if (isBasicTenant && isActive && !isCompanyOwnerAuth(request.auth)) {
    const existingAccessPreview = await staffAccessRef.get();
    if (!existingAccessPreview.exists) {
      const configuredMaxStaff = Number(instData.planLimits?.maxStaff ?? DEFAULT_BASIC_PLAN_LIMITS.maxStaff);
      const maxStaff = Number.isFinite(configuredMaxStaff) && configuredMaxStaff > 0
        ? Math.floor(configuredMaxStaff)
        : DEFAULT_BASIC_PLAN_LIMITS.maxStaff;
      const activeAccessSnap = await db.collection(`${INSTITUTIONS_COLLECTION}/${slug}/staffAccess`).get();
      const activeCount = activeAccessSnap.docs.filter((d) => d.data()?.isActive !== false && d.id !== uid).length;
      if (activeCount >= maxStaff) {
        throw new HttpsError(
          'resource-exhausted',
          `Basic Free Plan limit reached: maximum ${maxStaff} active staff accounts allowed. Upgrade to Premium for unlimited staff.`
        );
      }
    }
  }

  const newPasswordHashObj = rawPassword ? hashPasswordScrypt(rawPassword) : null;
  const newCredRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);

  let finalPhone = '';
  let finalPhoneE164 = '';

  await db.runTransaction(async (tx) => {
    const staffSnap = await tx.get(staffRef);
    const accessSnap = await tx.get(staffAccessRef);
    const staffData = staffSnap.exists ? (staffSnap.data() || {}) : {};
    const accessData = accessSnap.exists ? (accessSnap.data() || {}) : {};
    const oldKeyHash = String(
      staffData.credentialKeyHash || accessData.credentialKeyHash || ''
    ).trim();

    let existingOldCred = null;
    if (oldKeyHash && oldKeyHash !== keyHash) {
      const oldSnap = await tx.get(db.collection(AUTH_CREDENTIALS_COLLECTION).doc(oldKeyHash));
      if (oldSnap.exists) {
        existingOldCred = oldSnap.data() || {};
      }
    }

    const targetSnap = await tx.get(newCredRef);
    if (targetSnap.exists) {
      const holder = targetSnap.data() || {};
      const sameOwner = holder.uid === uid && holder.institutionId === slug && holder.role === 'staff';
      if (!sameOwner) {
        throw new HttpsError(
          'already-exists',
          `Username "${displayUsername}" is already taken by another account. Please choose a globally unique username.`
        );
      }
      if (!existingOldCred) {
        existingOldCred = holder;
      }
    }

    const finalSalt = newPasswordHashObj ? newPasswordHashObj.passwordSalt : String(existingOldCred?.passwordSalt || '');
    const finalHash = newPasswordHashObj ? newPasswordHashObj.passwordHash : String(existingOldCred?.passwordHash || '');

    if (!finalSalt || !finalHash) {
      throw new HttpsError('invalid-argument', 'Password (at least 6 characters) is required when creating staff login.');
    }

    finalPhoneE164 = normalizedPhoneE164
      || normalizePhoneToE164(staffData.phone || accessData.phone || existingOldCred?.phoneE164 || existingOldCred?.phone || '');
    finalPhone = rawPhone || String(staffData.phone || accessData.phone || existingOldCred?.phone || finalPhoneE164 || '').trim();

    const nowIso = new Date().toISOString();
    tx.set(newCredRef, {
      keyHash,
      username,
      displayUsername,
      passwordSalt: finalSalt,
      passwordHash: finalHash,
      uid,
      role: 'staff',
      institutionId: slug,
      institutionName,
      staffId,
      displayName,
      phone: finalPhone,
      phoneE164: finalPhoneE164,
      isActive,
      failedAttempts: 0,
      lockUntilMs: 0,
      updatedBy: String(request.auth.token.username || request.auth.token.email || request.auth.uid).slice(0, 160),
      updatedAt: nowIso,
      createdAt: existingOldCred?.createdAt || nowIso
    });

    if (oldKeyHash && oldKeyHash !== keyHash) {
      tx.delete(db.collection(AUTH_CREDENTIALS_COLLECTION).doc(oldKeyHash));
    }

    if (staffSnap.exists) {
      tx.set(staffRef, {
        authUid: uid,
        username,
        displayUsername,
        loginDisplay: displayUsername,
        ...(finalPhone ? { phone: finalPhone, phoneE164: finalPhoneE164 } : {}),
        credentialKeyHash: keyHash,
        password: FieldValue.delete(),
        updatedAt: nowIso
      }, { merge: true });
    }

    const mergedAccess = {
      ...accessData,
      ...(accessPayload || {}),
      uid,
      staffId,
      username,
      displayUsername,
      loginId: username,
      userKey: uid,
      ...(finalPhone ? { phone: finalPhone, phoneE164: finalPhoneE164 } : {}),
      credentialKeyHash: keyHash,
      name: displayName,
      isActive,
      password: FieldValue.delete(),
      updatedAt: nowIso
    };
    tx.set(staffAccessRef, mergedAccess, { merge: true });
  });

  return {
    ok: true,
    uid,
    username,
    displayUsername,
    phone: finalPhone,
    phoneE164: finalPhoneE164,
    keyHash
  };
});

// =========================================================================
// 7. PROTECTED (SELF-SERVICE): changeOwnPassword
// =========================================================================
exports.changeOwnPassword = onCall({ cors: true }, async (request) => {
  const authCtx = request.auth;
  if (!authCtx || !authCtx.uid || authCtx.token?.customAuth !== true) {
    throw new HttpsError('unauthenticated', 'Please sign in with your custom username account to change password.');
  }

  const currentPassword = String(request.data?.currentPassword || '');
  const newPassword = String(request.data?.newPassword || '');
  if (!currentPassword || !newPassword) {
    throw new HttpsError('invalid-argument', 'Current password and new password are required.');
  }
  if (newPassword.length < 6 || newPassword.length > 128) {
    throw new HttpsError('invalid-argument', 'New password must be between 6 and 128 characters.');
  }

  const username = String(authCtx.token.username || '').trim().toLowerCase();
  if (!username) {
    throw new HttpsError('failed-precondition', 'Unable to resolve username for current session.');
  }

  const keyHash = sha256Hex(username);
  const credRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);
  const credSnap = await credRef.get();

  if (!credSnap.exists || credSnap.data()?.uid !== authCtx.uid) {
    throw new HttpsError('not-found', 'Account credential record not found.');
  }

  const cred = credSnap.data() || {};
  if (!verifyPasswordScrypt(currentPassword, cred.passwordSalt, cred.passwordHash)) {
    throw new HttpsError('permission-denied', 'Current password is incorrect.');
  }

  const { passwordSalt, passwordHash } = hashPasswordScrypt(newPassword);
  await credRef.set({
    passwordSalt,
    passwordHash,
    failedAttempts: 0,
    lockUntilMs: 0,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  return { ok: true };
});

// =========================================================================
// 8. PROTECTED (SELF-SERVICE SUPER ADMIN): updateOwnOtpPhone
// =========================================================================
exports.updateOwnOtpPhone = onCall({ cors: true }, async (request) => {
  const authCtx = request.auth;
  if (!authCtx || !authCtx.uid || authCtx.token?.customAuth !== true || authCtx.token?.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only signed-in Institution Super Admins can update their OTP mobile number here.');
  }

  const currentPassword = String(request.data?.currentPassword || '');
  const rawPhone = String(request.data?.phone || '').trim();
  const phoneE164 = normalizePhoneToE164(rawPhone);

  if (!currentPassword) {
    throw new HttpsError('invalid-argument', 'Current password is required to update OTP mobile number.');
  }
  if (!phoneE164) {
    throw new HttpsError('invalid-argument', 'Please enter a valid mobile number (e.g. 10 digits or +91XXXXXXXXXX).');
  }

  const slug = normalizeInstitutionSlug(authCtx.token.institutionId || '');
  const username = String(authCtx.token.username || '').trim().toLowerCase();
  if (!slug || !username) {
    throw new HttpsError('failed-precondition', 'Unable to resolve institution Super Admin identity.');
  }

  const keyHash = sha256Hex(username);
  const credRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);
  const credSnap = await credRef.get();
  if (!credSnap.exists || credSnap.data()?.uid !== authCtx.uid) {
    throw new HttpsError('not-found', 'Super Admin credential record not found.');
  }

  const cred = credSnap.data() || {};
  if (!verifyPasswordScrypt(currentPassword, cred.passwordSalt, cred.passwordHash)) {
    throw new HttpsError('permission-denied', 'Current password is incorrect.');
  }

  const nowIso = new Date().toISOString();
  await Promise.all([
    credRef.set({ phone: rawPhone, phoneE164, updatedAt: nowIso }, { merge: true }),
    db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/adminAuth`).set({
      phone: rawPhone,
      phoneE164,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }),
    db.collection(INSTITUTIONS_COLLECTION).doc(slug).set({
      adminPhone: rawPhone,
      adminPhoneE164: phoneE164,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
  ]);

  return {
    ok: true,
    phone: rawPhone,
    phoneE164,
    maskedPhone: maskPhoneDisplay(phoneE164)
  };
});

// =========================================================================
// 8C. PROTECTED (AUTHENTICATED CUSTOM-AUTH USER): verifyOwnPassword
// =========================================================================
exports.verifyOwnPassword = onCall({ cors: true }, async (request) => {
  const authCtx = request.auth;
  if (!authCtx || !authCtx.uid || authCtx.token?.customAuth !== true) {
    throw new HttpsError('unauthenticated', 'Authenticated custom account session is required.');
  }

  const currentPassword = String(request.data?.currentPassword || '');
  if (!currentPassword) {
    throw new HttpsError('invalid-argument', 'Current password is required.');
  }

  const username = String(authCtx.token.username || '').trim().toLowerCase();
  if (!username) {
    throw new HttpsError('failed-precondition', 'Unable to resolve account username from session token.');
  }

  const keyHash = sha256Hex(username);
  const credSnap = await db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash).get();
  if (!credSnap.exists || credSnap.data()?.uid !== authCtx.uid) {
    throw new HttpsError('not-found', 'Credential record not found.');
  }

  const cred = credSnap.data() || {};
  if (!verifyPasswordScrypt(currentPassword, cred.passwordSalt, cred.passwordHash)) {
    throw new HttpsError('permission-denied', 'Invalid password.');
  }

  return { ok: true };
});

// =========================================================================
// 9. PROTECTED (COMPANY OWNER ONLY): syncCompanyOwnerClaims
// =========================================================================
exports.syncCompanyOwnerClaims = onCall({ cors: true }, async (request) => {
  const authCtx = request.auth;
  if (!authCtx || !authCtx.uid || !authCtx.token) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }
  if (authCtx.token.firebase?.sign_in_provider === 'custom' || authCtx.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Company Owner email authentication is required.');
  }
  const verified = await isCompanyOwnerAuth(authCtx);
  if (!verified) {
    throw new HttpsError('permission-denied', 'Account is not authorized as a Company Owner in company/config.');
  }

  const userRecord = await adminAuth.getUser(authCtx.uid);
  const existingClaims = (userRecord.customClaims && typeof userRecord.customClaims === 'object')
    ? userRecord.customClaims
    : {};

  if (existingClaims.companyOwner !== true) {
    await adminAuth.setCustomUserClaims(authCtx.uid, {
      ...existingClaims,
      companyOwner: true
    });
  }

  return {
    ok: true,
    companyOwner: true,
    email: String(authCtx.token.email || '').trim().toLowerCase()
  };
});

// =========================================================================
// 10. COMPANY OWNER 2FA STEP-1: initiateCompanyOwnerOtp
// Requires an authenticated Company Owner email/password session.
// Reads otpPhone from company/config (or matching owner entry in owners[]).
// If no otpPhone is configured yet, returns otpRequired: false so the owner
// can safely configure their OTP mobile in Company Console without lockout.
// =========================================================================
exports.initiateCompanyOwnerOtp = onCall({ cors: true }, async (request) => {
  const authCtx = request.auth;
  if (!authCtx || !authCtx.uid || !authCtx.token) {
    throw new HttpsError('unauthenticated', 'Account authentication is required.');
  }
  const provider = String(authCtx.token.firebase?.sign_in_provider || '').toLowerCase();
  if (provider === 'custom' || provider === 'anonymous' || provider === 'phone') {
    throw new HttpsError('permission-denied', 'Standard account sign-in is required.');
  }

  const email = String(authCtx.token.email || '').trim().toLowerCase();
  if (!email) {
    throw new HttpsError('permission-denied', 'Authenticated account identifier is missing.');
  }

  const snap = await db.collection(COMPANY_COLLECTION).doc(COMPANY_CONFIG_DOC_ID).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Account configuration not found.');
  }
  const data = snap.data() || {};
  const ownersList = Array.isArray(data.owners) ? data.owners : [];
  const matchedOwner = ownersList.find(
    (o) => o && o.isActive !== false && String(o.email || '').trim().toLowerCase() === email
  );
  const ownerEmailsArr = Array.isArray(data.ownerEmails)
    ? data.ownerEmails.map((e) => String(e || '').trim().toLowerCase())
    : [];
  const isOwner = String(data.email || '').trim().toLowerCase() === email
    || data.ownersIndex?.[email] === true
    || data.ownersIndex?.[authCtx.token.email] === true
    || Boolean(matchedOwner)
    || ownerEmailsArr.includes(email);

  if (!isOwner) {
    throw new HttpsError('permission-denied', 'This account is not authorized to sign in.');
  }

  const companyName = String(data.companyName || 'Institution Manage').trim();
  const ownerName = String(matchedOwner?.name || data.name || data.ownerName || 'Administrator').trim();

  // Resolve configured OTP mobile number: owner-specific first, then company/config.otpPhone
  const phoneCandidates = [
    matchedOwner?.otpPhone,
    matchedOwner?.phone,
    data.otpPhone,
    data.ownerOtpPhone
  ];
  let phoneE164 = '';
  for (const cand of phoneCandidates) {
    const normalized = normalizePhoneToE164(cand);
    if (normalized) {
      phoneE164 = normalized;
      break;
    }
  }

  // Sync companyOwner custom claim proactively so Firestore & Storage rules work immediately
  try {
    const userRecord = await adminAuth.getUser(authCtx.uid);
    const existingClaims = (userRecord.customClaims && typeof userRecord.customClaims === 'object')
      ? userRecord.customClaims
      : {};
    if (existingClaims.companyOwner !== true) {
      await adminAuth.setCustomUserClaims(authCtx.uid, {
        ...existingClaims,
        companyOwner: true
      });
    }
  } catch (claimErr) {
    console.warn('[initiateCompanyOwnerOtp] Claim sync notice:', claimErr?.message || claimErr);
  }

  if (!phoneE164) {
    return {
      ok: true,
      otpRequired: false,
      email,
      ownerName,
      companyName
    };
  }

  await enforceOtpRateLimit(`company-owner:${authCtx.uid}:${phoneE164}`, OTP_SEND_MAX_REQUESTS);

  const challengeId = await createOtpChallenge({
    type: 'company_owner',
    uid: authCtx.uid,
    email,
    ownerName,
    companyName,
    expectedPhoneE164: phoneE164
  });

  return {
    ok: true,
    otpRequired: true,
    challengeId,
    phoneE164,
    maskedPhone: maskPhoneDisplay(phoneE164),
    email,
    ownerName,
    companyName
  };
});

// =========================================================================
// 11. COMPANY OWNER 2FA STEP-2: completeCompanyOwnerOtpLogin
// Verifies BOTH the authenticated Company Owner session AND the freshly
// verified Phone Auth ID Token from the secondary OTP verifier app.
// =========================================================================
exports.completeCompanyOwnerOtpLogin = onCall({ cors: true }, async (request) => {
  const authCtx = request.auth;
  if (!authCtx || !authCtx.uid || !authCtx.token) {
    throw new HttpsError('unauthenticated', 'Account authentication is required.');
  }
  const provider = String(authCtx.token.firebase?.sign_in_provider || '').toLowerCase();
  if (provider === 'custom' || provider === 'anonymous' || provider === 'phone') {
    throw new HttpsError('permission-denied', 'Standard account session is required.');
  }

  const challengeId = String(request.data?.challengeId || '').trim();
  const phoneIdToken = String(request.data?.phoneIdToken || '').trim();
  if (!challengeId || !phoneIdToken) {
    throw new HttpsError('invalid-argument', 'OTP challenge and verified phone token are required.');
  }

  const challengeSnap = await db.collection(OTP_CHALLENGES_COLLECTION).doc(challengeId).get();
  if (!challengeSnap.exists) {
    throw new HttpsError('not-found', 'OTP verification session expired or not found. Please sign in again.');
  }
  const preview = challengeSnap.data() || {};
  if (preview.type !== 'company_owner') {
    throw new HttpsError('permission-denied', 'Invalid OTP verification session type.');
  }
  if (preview.uid !== authCtx.uid) {
    throw new HttpsError('permission-denied', 'OTP verification session does not match the signed-in account.');
  }

  // Verify the SMS OTP phone token BEFORE consuming the challenge so typos/expired tokens can retry
  await verifyPhoneAuthToken(phoneIdToken, preview.expectedPhoneE164);

  const challenge = await consumeOtpChallenge(challengeId, 'company_owner');

  return {
    ok: true,
    email: String(challenge.email || authCtx.token.email || '').trim().toLowerCase(),
    ownerName: String(challenge.ownerName || 'Administrator').trim(),
    companyName: String(challenge.companyName || 'Institution Manage').trim()
  };
});

// =========================================================================
// 12. PUBLIC SELF-SIGNUP AVAILABILITY CHECK: checkSelfSignupAvailability
// =========================================================================
exports.checkSelfSignupAvailability = onCall({ cors: true }, async (request) => {
  const rawSlug = String(request.data?.slug || '').trim().toLowerCase();
  const rawUsername = String(request.data?.username || '').trim();

  const result = {
    ok: true,
    selfSignupEnabled: true,
    slugValid: false,
    slugAvailable: false,
    slugReason: '',
    usernameValid: false,
    usernameAvailable: false,
    usernameReason: ''
  };

  try {
    const catalogSnap = await db.collection(COMPANY_COLLECTION).doc(COMPANY_PUBLIC_CATALOG_DOC_ID).get();
    if (catalogSnap.exists && catalogSnap.data()?.selfSignupConfig?.enabled === false) {
      result.selfSignupEnabled = false;
    }
  } catch (_) {}

  if (rawSlug) {
    const cleanSlug = normalizeInstitutionSlug(rawSlug);
    if (!cleanSlug || cleanSlug.length < 3) {
      result.slugReason = 'Portal URL must be at least 3 characters (letters, numbers, hyphens).';
    } else if (RESERVED_INSTITUTION_SLUGS.has(cleanSlug)) {
      result.slugReason = 'This portal URL is reserved. Please choose another.';
    } else {
      result.slugValid = true;
      const instSnap = await db.collection(INSTITUTIONS_COLLECTION).doc(cleanSlug).get();
      if (instSnap.exists) {
        result.slugAvailable = false;
        result.slugReason = 'This portal URL is already taken.';
      } else {
        result.slugAvailable = true;
      }
    }
  }

  if (rawUsername) {
    if (rawUsername.length < 3 || rawUsername.length > 60 || /\s/.test(rawUsername) || /[\u0000-\u001F\u007F]/.test(rawUsername)) {
      result.usernameReason = 'Username must be 3–60 characters with no spaces.';
    } else {
      result.usernameValid = true;
      const keyHash = sha256Hex(rawUsername.toLowerCase());
      const credSnap = await db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash).get();
      if (credSnap.exists) {
        result.usernameAvailable = false;
        result.usernameReason = 'This username is already taken.';
      } else {
        result.usernameAvailable = true;
      }
    }
  }

  return result;
});

// =========================================================================
// 13. PUBLIC SELF-SERVICE REGISTRATION: selfRegisterInstitution
// Provisions a Basic (Free Forever) institution workspace atomically after
// verifying Firebase Phone Auth OTP token. Strictly server-authoritative.
// =========================================================================
exports.selfRegisterInstitution = onCall({ cors: true }, async (request) => {
  const institutionName = String(request.data?.institutionName || '').trim().slice(0, 120);
  const rawSlug = String(request.data?.slug || '').trim().toLowerCase();
  const place = String(request.data?.place || '').trim().slice(0, 120);
  const rawPhone = String(request.data?.phone || '').trim();
  const adminName = String(request.data?.adminName || '').trim().slice(0, 100) || 'Principal / Admin';
  const rawUsername = String(request.data?.username || '').trim();
  const rawPassword = String(request.data?.password || '');
  const phoneIdToken = String(request.data?.phoneIdToken || '').trim();

  if (!institutionName || institutionName.length < 3) {
    throw new HttpsError('invalid-argument', 'Institution name must be at least 3 characters.');
  }

  const slug = normalizeInstitutionSlug(rawSlug);
  if (!slug || slug.length < 3 || RESERVED_INSTITUTION_SLUGS.has(slug)) {
    throw new HttpsError('invalid-argument', 'Please choose a valid, non-reserved portal URL slug (at least 3 characters).');
  }

  const phoneE164 = normalizePhoneToE164(rawPhone);
  if (!phoneE164) {
    throw new HttpsError('invalid-argument', 'Please enter a valid mobile number for OTP verification.');
  }

  if (!phoneIdToken) {
    throw new HttpsError('invalid-argument', 'Mobile OTP verification is required before creating an institution account.');
  }

  const { displayUsername, username, keyHash } = validateAndNormalizeUsername(rawUsername);
  const passwordHashObj = hashPasswordScrypt(rawPassword);

  // Check if self-signup is enabled in Company Public Catalog and read default Basic limits
  const catalogSnap = await db.collection(COMPANY_COLLECTION).doc(COMPANY_PUBLIC_CATALOG_DOC_ID).get();
  const catalogData = catalogSnap.exists ? (catalogSnap.data() || {}) : {};
  const selfSignupCfg = (catalogData.selfSignupConfig && typeof catalogData.selfSignupConfig === 'object')
    ? catalogData.selfSignupConfig
    : {};
  if (selfSignupCfg.enabled === false) {
    throw new HttpsError('failed-precondition', 'Self-service institution registration is currently paused. Please contact our support team.');
  }

  // Verify Phone Auth OTP ID token matches the submitted phone number
  await verifyPhoneAuthToken(phoneIdToken, phoneE164);
  await enforceOtpRateLimit(`self-signup:${phoneE164}`, OTP_RATE_MAX_REQUESTS);

  // Anti-abuse check: cap maximum self-registered institutions per verified mobile number
  const existingByPhoneSnap = await db.collection(INSTITUTIONS_COLLECTION)
    .where('ownerPhoneE164', '==', phoneE164)
    .where('signupSource', '==', 'self_signup')
    .limit(MAX_SELF_SIGNUPS_PER_PHONE + 1)
    .get();
  if (existingByPhoneSnap.size >= MAX_SELF_SIGNUPS_PER_PHONE) {
    throw new HttpsError(
      'resource-exhausted',
      `This mobile number has already registered ${MAX_SELF_SIGNUPS_PER_PHONE} free institutions. Please contact support for additional workspaces.`
    );
  }

  const rawLimits = (selfSignupCfg.defaultBasicLimits && typeof selfSignupCfg.defaultBasicLimits === 'object')
    ? selfSignupCfg.defaultBasicLimits
    : {};
  const planLimits = {};
  Object.keys(DEFAULT_BASIC_PLAN_LIMITS).forEach((k) => {
    const val = Number(rawLimits[k]);
    planLimits[k] = Number.isFinite(val) && val > 0 ? Math.floor(val) : DEFAULT_BASIC_PLAN_LIMITS[k];
  });

  const uid = buildSuperAdminUid(slug);
  const instRef = db.collection(INSTITUTIONS_COLLECTION).doc(slug);
  const credRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);
  const adminAuthRef = db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/adminAuth`);
  const configRef = db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/config`);
  const academicYearsRef = db.doc(`${INSTITUTIONS_COLLECTION}/${slug}/settings/academicYears`);

  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const currentYear = nowDate.getFullYear();
  const defaultAcademicYear = `${currentYear}-${String(currentYear + 1).slice(-2)}`;

  await db.runTransaction(async (tx) => {
    const [instSnap, credSnap] = await Promise.all([
      tx.get(instRef),
      tx.get(credRef)
    ]);

    if (instSnap.exists) {
      throw new HttpsError('already-exists', `Portal URL "/${slug}" is already registered. Please choose a different URL.`);
    }
    if (credSnap.exists) {
      throw new HttpsError('already-exists', `Username "${displayUsername}" is already taken. Please choose another username.`);
    }

    // 1. Create institution metadata document (strictly forced Basic Free Forever)
    tx.set(instRef, {
      slug,
      name: institutionName,
      place,
      phone: rawPhone,
      ownerPhoneE164: phoneE164,
      adminName,
      adminUsername: username,
      adminDisplayUsername: displayUsername,
      status: 'active',
      isActive: true,
      planTier: 'basic',
      planName: 'Basic (Free)',
      isLifetime: true,
      expiryDate: '',
      expiryTimestamp: null,
      signupSource: 'self_signup',
      verificationStatus: 'unverified',
      allowedPages: { ...BASIC_PLAN_ALLOWED_PAGES },
      planLimits,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 2. Create server-only authCredentials entry
    tx.set(credRef, {
      keyHash,
      username,
      displayUsername,
      passwordSalt: passwordHashObj.passwordSalt,
      passwordHash: passwordHashObj.passwordHash,
      uid,
      role: 'super_admin',
      institutionId: slug,
      institutionName,
      staffId: '',
      displayName: adminName,
      phone: rawPhone,
      phoneE164,
      isActive: true,
      failedAttempts: 0,
      lockUntilMs: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastOtpVerifiedAt: nowIso
    });

    // 3. Create institution adminAuth document
    tx.set(adminAuthRef, {
      uid,
      name: adminName,
      username,
      displayUsername,
      phone: rawPhone,
      role: 'super_admin',
      isActive: true,
      credentialKeyHash: keyHash,
      admins: [
        {
          uid,
          name: adminName,
          username,
          displayUsername,
          phone: rawPhone,
          role: 'super_admin',
          isActive: true
        }
      ],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // 4. Bootstrap basic institution config for public site & portals
    tx.set(configRef, {
      appName: institutionName,
      institutionName,
      place,
      phone: rawPhone,
      activeAcademicYear: defaultAcademicYear,
      classes: [],
      feeItems: [],
      updatedAt: nowIso
    });

    // 5. Bootstrap initial single academic year record
    tx.set(academicYearsRef, {
      activeYear: defaultAcademicYear,
      years: [
        {
          id: defaultAcademicYear,
          name: defaultAcademicYear,
          isActive: true,
          createdAt: nowIso
        }
      ],
      updatedAt: nowIso
    });
  });

  // Mint custom token so the newly registered Super Admin can enter Official Hub immediately
  const customToken = await mintOfficialCustomToken(uid, {
    customAuth: true,
    role: 'super_admin',
    institutionId: slug,
    staffId: '',
    username,
    displayUsername,
    phoneVerified: true
  });

  return {
    ok: true,
    slug,
    institutionName,
    planTier: 'basic',
    planName: 'Basic (Free)',
    planLimits,
    customToken,
    profile: {
      uid,
      role: 'super_admin',
      institutionId: slug,
      institutionName,
      staffId: '',
      username,
      displayUsername,
      displayName: adminName,
      phoneE164
    }
  };
});

// =========================================================================
// 14. PROTECTED (INSTITUTION ADMIN): submitUpgradeRequest
// Allows an authenticated Institution Super Admin or Staff Manager to submit
// an in-app upgrade request visible in the Company Master Portal.
// =========================================================================
exports.submitUpgradeRequest = onCall({ cors: true }, async (request) => {
  const authCtx = request.auth;
  if (!authCtx || !authCtx.uid) {
    throw new HttpsError('unauthenticated', 'Please sign in as an Institution Administrator to request an upgrade.');
  }

  const slug = normalizeInstitutionSlug(request.data?.institutionId || authCtx.token?.institutionId || '');
  if (!slug) {
    throw new HttpsError('invalid-argument', 'Valid institution ID is required.');
  }

  const authorized = await isInstitutionAdminOrCompanyOwner(authCtx, slug);
  if (!authorized) {
    throw new HttpsError('permission-denied', 'Only institution administrators can submit plan upgrade requests.');
  }

  const instSnap = await db.collection(INSTITUTIONS_COLLECTION).doc(slug).get();
  if (!instSnap.exists) {
    throw new HttpsError('not-found', 'Institution record not found.');
  }
  const instData = instSnap.data() || {};

  const requestedPlanId = String(request.data?.requestedPlanId || 'premium_full').trim().slice(0, 80);
  const requestedPlanName = String(request.data?.requestedPlanName || 'Premium Plan').trim().slice(0, 120);
  const requestedFeature = String(request.data?.requestedFeature || '').trim().slice(0, 120);
  const contactPhone = String(request.data?.contactPhone || instData.phone || '').trim().slice(0, 30);
  const note = String(request.data?.note || '').trim().slice(0, 300);

  // Collect live usage snapshot server-side for Company Owner review
  let studentCount = 0;
  let staffCount = 0;
  try {
    const [studentsCountSnap, staffCountSnap] = await Promise.all([
      db.collection(`${INSTITUTIONS_COLLECTION}/${slug}/students`).count().get(),
      db.collection(`${INSTITUTIONS_COLLECTION}/${slug}/staff`).count().get()
    ]);
    studentCount = Number(studentsCountSnap.data()?.count || 0);
    staffCount = Number(staffCountSnap.data()?.count || 0);
  } catch (_) {}

  const requestedBy = String(
    authCtx.token?.displayUsername || authCtx.token?.username || authCtx.token?.email || authCtx.uid
  ).trim().slice(0, 120);

  const nowIso = new Date().toISOString();

  // Check if a pending request already exists for this institution -> update it instead of creating duplicates
  const existingPendingSnap = await db.collection(UPGRADE_REQUESTS_COLLECTION)
    .where('institutionId', '==', slug)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  const payload = {
    institutionId: slug,
    institutionName: String(instData.name || slug).trim(),
    institutionPlace: String(instData.place || '').trim(),
    currentPlanTier: String(instData.planTier || 'premium').trim().toLowerCase(),
    currentPlanName: String(instData.planName || 'Basic (Free)').trim(),
    requestedPlanId,
    requestedPlanName,
    requestedFeature,
    contactPhone,
    note,
    requestedBy,
    requestedByUid: authCtx.uid,
    usageSnapshot: {
      students: studentCount,
      staff: staffCount
    },
    status: 'pending',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso
  };

  if (!existingPendingSnap.empty) {
    const existingRef = existingPendingSnap.docs[0].ref;
    await existingRef.set(payload, { merge: true });
    return {
      ok: true,
      requestId: existingRef.id,
      updatedExisting: true,
      message: 'Your pending upgrade request has been updated. Our platform team will contact you shortly.'
    };
  }

  const newRef = await db.collection(UPGRADE_REQUESTS_COLLECTION).add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    createdAtIso: nowIso
  });

  return {
    ok: true,
    requestId: newRef.id,
    updatedExisting: false,
    message: 'Upgrade request submitted successfully! Our platform team will review and activate Premium shortly.'
  };
});


