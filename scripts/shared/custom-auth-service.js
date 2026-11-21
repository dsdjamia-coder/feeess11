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

export const normalizePhoneToE164Client = (raw = '', defaultCountryCode = '+91') => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const ccDigits = String(defaultCountryCode || '+91').replace(/\D/g, '') || '91';
  const cc = `+${ccDigits}`;
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
  }
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00') && digits.length >= 10 && digits.length <= 17) {
    digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return `${cc}${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  return '';
};

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
const verifyOfficialPasswordForOtpCallable = httpsCallable(functions, 'verifyOfficialPasswordForOtp');
const completeOfficialOtpLoginCallable = httpsCallable(functions, 'completeOfficialOtpLogin');
const verifyDirectoryPasswordForOtpCallable = httpsCallable(functions, 'verifyDirectoryPasswordForOtp');
const completeDirectoryOtpLoginCallable = httpsCallable(functions, 'completeDirectoryOtpLogin');
const lookupStudentsByPhoneCallable = httpsCallable(functions, 'lookupStudentsByPhone');
const completeStudentOtpLoginCallable = httpsCallable(functions, 'completeStudentOtpLogin');
const upsertSuperAdminCallable = httpsCallable(functions, 'upsertInstitutionSuperAdminCredential');
const manageStaffCredentialCallable = httpsCallable(functions, 'manageStaffCredential');
const changeOwnPasswordCallable = httpsCallable(functions, 'changeOwnPassword');
const updateOwnOtpPhoneCallable = httpsCallable(functions, 'updateOwnOtpPhone');
const verifyOwnPasswordCallable = httpsCallable(functions, 'verifyOwnPassword');

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

export const verifyOfficialPasswordForOtp = async ({ username, password, institutionId = '' }) => {
  try {
    const res = await verifyOfficialPasswordForOtpCallable({
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

export const completeOfficialOtpLoginAndSignIn = async (authInstance, { challengeId, phoneIdToken }) => {
  try {
    const res = await completeOfficialOtpLoginCallable({
      challengeId: String(challengeId || '').trim(),
      phoneIdToken: String(phoneIdToken || '').trim()
    });
    const loginRes = res?.data || null;
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
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'OTP verification failed. Please try again.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/unauthenticated';
    throw wrapped;
  }
};

export const verifyDirectoryPasswordForOtp = async ({ institutionId, username, password }) => {
  try {
    const res = await verifyDirectoryPasswordForOtpCallable({
      institutionId: String(institutionId || '').trim().toLowerCase(),
      username: String(username || '').trim(),
      password: String(password || '')
    });
    return res?.data || null;
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Incorrect username or password.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/unauthenticated';
    throw wrapped;
  }
};

export const completeDirectoryOtpLogin = async ({ challengeId, phoneIdToken }) => {
  try {
    const res = await completeDirectoryOtpLoginCallable({
      challengeId: String(challengeId || '').trim(),
      phoneIdToken: String(phoneIdToken || '').trim()
    });
    return res?.data || null;
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'OTP verification failed.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/unauthenticated';
    throw wrapped;
  }
};

export const lookupStudentsByPhone = async ({ institutionId, phone, countryCode = '+91' }) => {
  try {
    const res = await lookupStudentsByPhoneCallable({
      institutionId: String(institutionId || '').trim().toLowerCase(),
      phone: String(phone || '').trim(),
      countryCode: String(countryCode || '+91').trim()
    });
    return res?.data || { found: false, count: 0, students: [] };
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Unable to verify mobile number.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/error';
    throw wrapped;
  }
};

export const completeStudentOtpLogin = async ({ institutionId, phoneIdToken }) => {
  try {
    const res = await completeStudentOtpLoginCallable({
      institutionId: String(institutionId || '').trim().toLowerCase(),
      phoneIdToken: String(phoneIdToken || '').trim()
    });
    return res?.data || null;
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Unable to verify student OTP session.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/unauthenticated';
    throw wrapped;
  }
};

export const upsertInstitutionSuperAdminCredential = async ({
  mode = 'create',
  slug,
  institutionName = '',
  adminName = 'Master Admin',
  username,
  password = '',
  phone = ''
}) => {
  try {
    const res = await upsertSuperAdminCallable({
      mode,
      slug: String(slug || '').trim().toLowerCase(),
      institutionName: String(institutionName || '').trim(),
      adminName: String(adminName || 'Master Admin').trim(),
      username: String(username || '').trim(),
      password: String(password || ''),
      phone: String(phone || '').trim()
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
  phone = '',
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
      phone: String(phone || '').trim(),
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

export const updateOwnOtpPhone = async ({ currentPassword, phone }) => {
  try {
    const res = await updateOwnOtpPhoneCallable({
      currentPassword: String(currentPassword || ''),
      phone: String(phone || '').trim()
    });
    return res?.data || { ok: true };
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Failed to update OTP mobile number.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/error';
    throw wrapped;
  }
};

export const verifyOwnPassword = async ({ currentPassword }) => {
  try {
    const res = await verifyOwnPasswordCallable({
      currentPassword: String(currentPassword || '')
    });
    return res?.data || { ok: true };
  } catch (err) {
    const msg = extractCallableErrorMessage(err, 'Invalid password.');
    const wrapped = new Error(msg);
    wrapped.code = err?.code || 'functions/permission-denied';
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
