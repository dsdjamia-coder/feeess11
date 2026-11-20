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
const INSTITUTIONS_COLLECTION = 'institutions';
const COMPANY_COLLECTION = 'company';
const COMPANY_CONFIG_DOC_ID = 'config';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

// --- Helpers ---

const normalizeInstitutionSlug = (raw = '') => {
  const clean = String(raw || '').trim().toLowerCase();
  if (!clean || !/^[a-z0-9][a-z0-9-_]{0,63}$/.test(clean)) return '';
  return clean;
};

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
  const keyHash = crypto.createHash('sha256').update(username, 'utf8').digest('hex');
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

const checkInstitutionOperationalStatus = async (slug) => {
  const instSnap = await db.collection(INSTITUTIONS_COLLECTION).doc(slug).get();
  if (!instSnap.exists) {
    return { exists: false, active: true, expired: false, name: slug, pauseReason: '' };
  }
  const inst = instSnap.data() || {};
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
  return {
    exists: true,
    active: isActive,
    expired,
    name: String(inst.name || slug).trim(),
    pauseReason: String(inst.pauseReason || '').trim()
  };
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
  const keyHash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  const credSnap = await db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash).get();

  if (!credSnap.exists) {
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
      institutionName: String(cred.institutionName || credInst)
    };
  }

  const instStatus = credInst ? await checkInstitutionOperationalStatus(credInst) : { active: true, expired: false, name: '' };

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
    institutionExpired: instStatus.expired
  };
});

// =========================================================================
// 2. PUBLIC STEP-2 AUTH: loginWithCustomUsername
// =========================================================================
exports.loginWithCustomUsername = onCall({ cors: true }, async (request) => {
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
  const keyHash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
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

  // Check institution active/expiry status
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
    throw new HttpsError(
      'permission-denied',
      'Institution subscription has expired. Please renew to continue.'
    );
  }

  // Reset failed attempt counters on success
  if (Number(cred.failedAttempts || 0) > 0 || Number(cred.lockUntilMs || 0) > 0) {
    await credRef.set({
      failedAttempts: 0,
      lockUntilMs: 0,
      lastLoginAt: new Date().toISOString()
    }, { merge: true }).catch(() => {});
  } else {
    await credRef.set({ lastLoginAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  }

  const role = cred.role === 'super_admin' ? 'super_admin' : 'staff';
  const staffId = String(cred.staffId || '').trim();
  const uid = String(cred.uid || (role === 'super_admin' ? buildSuperAdminUid(credInst) : buildStaffUid(credInst, staffId)));
  const displayUsername = String(cred.displayUsername || cred.username || rawUsername);

  // Verify live institution authorization doc
  let liveAccess = null;
  let liveDisplayName = String(cred.displayName || displayUsername);
  if (role === 'super_admin') {
    const adminSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${credInst}/settings/adminAuth`).get();
    if (!adminSnap.exists || adminSnap.data()?.isActive === false) {
      throw new HttpsError('permission-denied', 'Super Admin access is not active for this institution.');
    }
    const adminData = adminSnap.data() || {};
    liveDisplayName = String(adminData.name || cred.displayName || 'Super Admin');
  } else {
    const accessSnap = await db.doc(`${INSTITUTIONS_COLLECTION}/${credInst}/staffAccess/${uid}`).get();
    if (!accessSnap.exists || accessSnap.data()?.isActive === false) {
      throw new HttpsError('permission-denied', 'Staff account is inactive or has no portal access.');
    }
    liveAccess = accessSnap.data() || {};
    liveDisplayName = String(liveAccess.name || cred.displayName || displayUsername);
  }

  const customClaims = {
    customAuth: true,
    role,
    institutionId: credInst,
    staffId,
    username: normalized,
    displayUsername
  };

  const customToken = await adminAuth.createCustomToken(uid, customClaims);

  return {
    customToken,
    profile: {
      uid,
      role,
      institutionId: credInst,
      institutionName: instStatus.name || String(cred.institutionName || credInst),
      staffId,
      username: normalized,
      displayUsername,
      displayName: liveDisplayName,
      access: liveAccess
    }
  };
});

// =========================================================================
// 3. PROTECTED (COMPANY OWNER ONLY): upsertInstitutionSuperAdminCredential
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
    keyHash
  };
});

// =========================================================================
// 4. PROTECTED (ADMIN / STAFF MANAGER / COMPANY OWNER): manageStaffCredential
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
  const displayName = String(request.data?.displayName || displayUsername).trim().slice(0, 120) || displayUsername;
  const isActive = request.data?.isActive !== false;
  const accessPayload = (request.data?.access && typeof request.data.access === 'object') ? request.data.access : null;

  if (rawPassword && (rawPassword.length < 6 || rawPassword.length > 128)) {
    throw new HttpsError('invalid-argument', 'Password must be between 6 and 128 characters.');
  }

  const instSnap = await db.collection(INSTITUTIONS_COLLECTION).doc(slug).get();
  const institutionName = String(instSnap.data()?.name || slug).trim();
  const newPasswordHashObj = rawPassword ? hashPasswordScrypt(rawPassword) : null;
  const newCredRef = db.collection(AUTH_CREDENTIALS_COLLECTION).doc(keyHash);

  await db.runTransaction(async (tx) => {
    const staffSnap = await tx.get(staffRef);
    const accessSnap = await tx.get(staffAccessRef);
    const oldKeyHash = String(
      staffSnap.data()?.credentialKeyHash || accessSnap.data()?.credentialKeyHash || ''
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
        credentialKeyHash: keyHash,
        password: FieldValue.delete(),
        updatedAt: nowIso
      }, { merge: true });
    }

    const mergedAccess = {
      ...(accessSnap.exists ? (accessSnap.data() || {}) : {}),
      ...(accessPayload || {}),
      uid,
      staffId,
      username,
      displayUsername,
      loginId: username,
      userKey: uid,
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
    keyHash
  };
});

// =========================================================================
// 5. PROTECTED (SELF-SERVICE): changeOwnPassword
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

  const keyHash = crypto.createHash('sha256').update(username, 'utf8').digest('hex');
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
// 6. PROTECTED (COMPANY OWNER ONLY): syncCompanyOwnerClaims
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

