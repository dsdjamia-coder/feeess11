import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { functions } from "../../config/firebase-config.js";

/**
 * Validate a custom username:
 * - 3 to 60 characters
 * - Letters, numbers, and symbols allowed
 * - NO spaces / whitespace and NO control characters
 */
export const validateCustomUsername = (raw = '') => {
  const displayUsername = String(raw || '').trim();
  if (!displayUsername) {
    return { valid: false, error: 'Username is required.' };
  }
  if (displayUsername.length < 3 || displayUsername.length > 60) {
    return { valid: false, error: 'Username must be between 3 and 60 characters.' };
  }
  if (/\s/.test(displayUsername)) {
    return { valid: false, error: 'Spaces are not allowed in username.' };
  }
  if (/[\u0000-\u001F\u007F]/.test(displayUsername)) {
    return { valid: false, error: 'Username contains invalid characters.' };
  }
  return {
    valid: true,
    displayUsername,
    username: displayUsername.toLowerCase(),
    error: ''
  };
};

export const normalizeCustomUsername = (raw = '') => String(raw || '').trim().toLowerCase();

export const buildSuperAdminUid = (slug = '') => `sa_${String(slug || '').trim().toLowerCase()}`;

export const buildStaffUid = (slug = '', staffId = '') =>
  `st_${String(slug || '').trim().toLowerCase()}_${String(staffId || '').trim()}`;

const extractCallableErrorMessage = (err, fallback = 'Authentication service request failed.') => {
  const code = String(err?.code || '').trim();
  const rawMsg = String(err?.message || '').replace(/^Firebase:\s*/i, '').trim();
  if (code === 'functions/not-found') {
    return 'Authentication Cloud Function is not deployed yet. Deploy functions via "firebase deploy --only functions".';
  }
  if (code === 'functions/unavailable') {
    return 'Authentication service is temporarily unavailable. Check your network connection and try again.';
  }
  if (code === 'functions/internal' && (!rawMsg || rawMsg.toLowerCase() === 'internal')) {
    return 'Authentication server internal error while issuing session token. Ensure the Cloud Functions runtime service account has the "Service Account Token Creator" IAM role and the IAM Service Account Credentials API is enabled.';
  }
  return rawMsg || fallback;
};

const verifyLoginIdentifierCallable = httpsCallable(functions, 'verifyLoginIdentifier');
const loginWithCustomUsernameCallable = httpsCallable(functions, 'loginWithCustomUsername');
const upsertSuperAdminCallable = httpsCallable(functions, 'upsertInstitutionSuperAdminCredential');
const manageStaffCredentialCallable = httpsCallable(functions, 'manageStaffCredential');
const changeOwnPasswordCallable = httpsCallable(functions, 'changeOwnPassword');

export const verifyLoginIdentifier = async ({ username, institutionId = '' }) => {
  try {
    const res = await verifyLoginIdentifierCallable({
      username: String(username || '').trim(),
      institutionId: String(institutionId || '').trim().toLowerCase()
    });
    return res?.data || { found: false };
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Unable to verify username.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/error';
    throw wrapped;
  }
};

export const loginWithCustomUsername = async ({ username, password, institutionId = '' }) => {
  try {
    const res = await loginWithCustomUsernameCallable({
      username: String(username || '').trim(),
      password: String(password || ''),
      institutionId: String(institutionId || '').trim().toLowerCase()
    });
    return res?.data || null;
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Invalid username or password.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/unauthenticated';
    throw wrapped;
  }
};

export const signInWithCustomUsernameAndPassword = async (authInstance, { username, password, institutionId = '' }) => {
  const loginRes = await loginWithCustomUsername({ username, password, institutionId });
  if (!loginRes?.customToken) {
    throw new Error('Authentication server did not return a valid session token.');
  }
  const userCred = await signInWithCustomToken(authInstance, loginRes.customToken);
  if (userCred?.user) {
    try {
      await userCred.user.getIdToken(true);
    } catch (_) {}
  }
  return {
    userCred,
    profile: loginRes.profile || {}
  };
};

export const upsertInstitutionSuperAdminCredential = async ({
  mode = 'create',
  slug,
  institutionName = '',
  adminName = 'Master Admin',
  username,
  password = ''
}) => {
  try {
    const res = await upsertSuperAdminCallable({
      mode,
      slug: String(slug || '').trim().toLowerCase(),
      institutionName: String(institutionName || '').trim(),
      adminName: String(adminName || 'Master Admin').trim(),
      username: String(username || '').trim(),
      password: String(password || '')
    });
    return res?.data || null;
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Failed to save Super Admin credentials.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/error';
    throw wrapped;
  }
};

export const manageStaffCredential = async ({
  action = 'upsert',
  institutionId,
  staffId,
  username = '',
  password = '',
  displayName = '',
  isActive = true,
  access = null
}) => {
  try {
    const res = await manageStaffCredentialCallable({
      action,
      institutionId: String(institutionId || '').trim().toLowerCase(),
      staffId: String(staffId || '').trim(),
      username: String(username || '').trim(),
      password: String(password || ''),
      displayName: String(displayName || '').trim(),
      isActive: isActive !== false,
      ...(access ? { access } : {})
    });
    return res?.data || null;
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Failed to manage staff login credentials.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/error';
    throw wrapped;
  }
};

export const changeOwnPassword = async ({ currentPassword, newPassword }) => {
  try {
    const res = await changeOwnPasswordCallable({
      currentPassword: String(currentPassword || ''),
      newPassword: String(newPassword || '')
    });
    return res?.data || { ok: true };
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Failed to update password.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/error';
    throw wrapped;
  }
};

export const getAuthClaims = async (user, forceRefresh = false) => {
  if (!user) {
    return {
      uid: '',
      email: '',
      customAuth: false,
      role: '',
      institutionId: '',
      staffId: '',
      username: '',
      displayUsername: ''
    };
  }
  try {
    const tokenRes = await user.getIdTokenResult(forceRefresh);
    const claims = tokenRes?.claims || {};
    return {
      uid: String(user.uid || ''),
      email: String(user.email || claims.email || '').trim().toLowerCase(),
      customAuth: claims.customAuth === true,
      role: String(claims.role || '').trim().toLowerCase(),
      institutionId: String(claims.institutionId || '').trim().toLowerCase(),
      staffId: String(claims.staffId || '').trim(),
      username: String(claims.username || '').trim().toLowerCase(),
      displayUsername: String(claims.displayUsername || claims.username || user.email || '').trim()
    };
  } catch (_) {
    return {
      uid: String(user.uid || ''),
      email: String(user.email || '').trim().toLowerCase(),
      customAuth: false,
      role: '',
      institutionId: '',
      staffId: '',
      username: '',
      displayUsername: String(user.email || '').trim()
    };
  }
};
