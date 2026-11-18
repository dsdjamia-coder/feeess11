import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { auth, db, firebaseConfig } from '../../config/firebase-config.js';
import {
  COMPANY_COLLECTION,
  COMPANY_CONFIG_DOC_ID,
  DEFAULT_COMPANY_ALLOWED_PAGES,
  GLOBAL_USERS_COLLECTION,
  INSTITUTIONS_COLLECTION,
  RESERVED_INSTITUTION_SLUGS,
  buildInternalStaffEmail,
  extractInternalUsername,
  isInternalStaffEmail,
  normalizeGlobalUserKey
} from '../../config/app-config.js';
import {
  escapeHtml,
  formatDateDisplay,
  openConfirmDialog,
  registerServiceWorker
} from '../shared/app-common.js';

registerServiceWorker();

const hashCredentialValue = async (rawValue = '') => {
  const value = String(rawValue || '');
  if (!value) return '';
  if (!window.crypto?.subtle) return value;
  const encoded = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const parseSuperAdminLoginInput = (rawInput = '', slug = '') => {
  const clean = String(rawInput || '').trim().toLowerCase();
  if (!clean) {
    return { valid: false, error: 'Super Admin Username or Email is required.' };
  }
  if (clean.includes('@')) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(clean)) {
      return { valid: false, error: 'Please enter a valid Super Admin email address.' };
    }
    if (isInternalStaffEmail(clean)) {
      const uname = extractInternalUsername(clean);
      return {
        valid: true,
        email: clean,
        username: uname,
        loginDisplay: uname || clean
      };
    }
    return {
      valid: true,
      email: clean,
      username: clean.split('@')[0] || clean,
      loginDisplay: clean
    };
  }
  const usernameRegex = /^[a-z0-9._-]{3,60}$/;
  if (!usernameRegex.test(clean)) {
    return {
      valid: false,
      error: 'Super Admin Username must be 3-60 characters using only letters, numbers, dots, hyphens, or underscores (no spaces).'
    };
  }
  return {
    valid: true,
    email: buildInternalStaffEmail(clean, slug),
    username: clean,
    loginDisplay: clean
  };
};

const getGlobalKeysForAdmin = ({ email = '', username = '', loginDisplay = '' } = {}) => {
  const keys = new Set();
  [email, username, loginDisplay].forEach((val) => {
    const k = normalizeGlobalUserKey(val);
    if (k) keys.add(k);
  });
  return Array.from(keys);
};

const assertGlobalLoginAvailable = async ({ email, username, loginDisplay, slug }) => {
  const candidateKeys = getGlobalKeysForAdmin({ email, username, loginDisplay });

  for (const other of allInstitutions) {
    const otherSlug = String(other.slug || other.id || '').trim().toLowerCase();
    if (!otherSlug || otherSlug === slug) continue;
    const otherKeys = new Set(getGlobalKeysForAdmin({
      email: other.adminEmail || '',
      username: other.adminUsername || '',
      loginDisplay: other.adminLoginDisplay || ''
    }));
    const conflict = candidateKeys.find((k) => otherKeys.has(k));
    if (conflict) {
      throw new Error(`Username / Email "${loginDisplay}" is already used by institution "${other.name || otherSlug}". Every username must be globally unique.`);
    }
  }

  for (const key of candidateKeys) {
    const snap = await getDoc(doc(db, GLOBAL_USERS_COLLECTION, key));
    if (!snap.exists()) continue;
    const data = snap.data() || {};
    const ownerInst = String(data.institutionId || '').trim().toLowerCase();
    const ownerRole = String(data.role || '').trim().toLowerCase();
    if ((ownerInst && ownerInst !== slug) || (ownerInst === slug && ownerRole && ownerRole !== 'super_admin')) {
      const targetDesc = ownerInst && ownerInst !== slug
        ? `institution "${data.institutionName || ownerInst}"`
        : `a staff/user account in "/${slug}"`;
      throw new Error(`Username / Email "${key}" is already taken by ${targetDesc}. Please choose a different unique username or email.`);
    }
  }
};

const syncSuperAdminGlobalUser = async ({
  slug,
  instName,
  adminName,
  email,
  username,
  loginDisplay,
  authVaultEmail = '',
  passwordHash = '',
  previousEmail = '',
  previousUsername = '',
  previousLoginDisplay = ''
}) => {
  const nextKeys = new Set(getGlobalKeysForAdmin({ email, username, loginDisplay }));
  const prevKeys = getGlobalKeysForAdmin({
    email: previousEmail,
    username: previousUsername,
    loginDisplay: previousLoginDisplay
  });

  for (const oldKey of prevKeys) {
    if (!nextKeys.has(oldKey)) {
      try {
        const oldSnap = await getDoc(doc(db, GLOBAL_USERS_COLLECTION, oldKey));
        if (oldSnap.exists() && oldSnap.data()?.institutionId === slug && oldSnap.data()?.role === 'super_admin') {
          await deleteDoc(doc(db, GLOBAL_USERS_COLLECTION, oldKey));
        }
      } catch (_) {}
    }
  }

  const basePayload = {
    email,
    username,
    loginDisplay,
    ...(authVaultEmail ? { authVaultEmail } : {}),
    ...(passwordHash ? { passwordHash } : {}),
    institutionId: slug,
    institutionName: instName || slug,
    role: 'super_admin',
    entityId: 'super_admin',
    displayName: adminName || 'Super Admin',
    isActive: true,
    updatedAt: new Date().toISOString()
  };

  for (const key of nextKeys) {
    await setDoc(doc(db, GLOBAL_USERS_COLLECTION, key), {
      ...basePayload,
      loginKey: key
    }, { merge: true });
  }
};

const PAGE_DEFINITIONS = [
  { key: 'admin', label: 'Admin Dashboard', desc: 'Full institution configuration, students & staff setup', core: true },
  { key: 'official', label: 'Official Hub', desc: 'Central portal home for admin and staff members', core: true },
  { key: 'student', label: 'Student Portal', desc: 'Student & parent self-service dashboard and fee receipts', core: true },
  { key: 'collection', label: 'Fee Collection', desc: 'Fee billing, receipts, dues, and financial reports', core: false },
  { key: 'result', label: 'Result Management', desc: 'Exam schemas, mark entry, marklists, and promotions', core: false },
  { key: 'attendance', label: 'Attendance Register', desc: 'Daily roll call, session attendance, and reports', core: false },
  { key: 'worksheet', label: 'Worksheets & Certificates', desc: 'Custom registers, ID cards, and export sheets', core: false },
  { key: 'academicPlan', label: 'Academic Planning', desc: 'Timetables, year plan, and daily syllabus logs', core: false },
  { key: 'studentActivity', label: 'Activity & Rewards', desc: 'Ibadah tracker, student tasks, and reward badges', core: false },
  { key: 'classroomEvaluation', label: 'Classroom Evaluation', desc: 'Behaviour tracking, evaluations, and impositions', core: false }
];

const CORE_PAGE_KEYS = new Set(PAGE_DEFINITIONS.filter((p) => p.core).map((p) => p.key));

let allInstitutions = [];
let pendingPauseTarget = null;
let verifiedCompanyOwnerEmail = '';

const showToast = (message, tone = 'success') => {
  const el = document.getElementById('company-toast');
  if (!el) return;
  const tones = {
    success: 'bg-emerald-900 text-emerald-50 border-emerald-700',
    error: 'bg-rose-900 text-rose-50 border-rose-700',
    info: 'bg-slate-900 text-slate-50 border-slate-700'
  };
  el.className = `fixed bottom-5 right-5 z-[11000] max-w-sm rounded-2xl px-4 py-3 shadow-2xl border text-xs font-bold flex items-center gap-2.5 ${tones[tone] || tones.info}`;
  el.innerHTML = `<i class="fas ${tone === 'error' ? 'fa-circle-exclamation' : tone === 'info' ? 'fa-circle-info' : 'fa-circle-check'}"></i><span>${escapeHtml(message)}</span>`;
  el.classList.remove('hidden');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.add('hidden'), 4200);
};

const toIsoDateInput = (date = new Date()) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addMonthsToDateStr = (startDateStr = '', months = 12) => {
  const base = startDateStr ? new Date(`${startDateStr}T00:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return toIsoDateInput();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + Number(months || 0), base.getUTCDate()));
  return toIsoDateInput(target);
};

const toExpiryTimestamp = (dateStr = '') => {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T23:59:59Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Timestamp.fromDate(parsed);
};

const getExpiryTimestampMs = (inst = {}) => {
  if (inst.isLifetime === true || String(inst.planName || '').toLowerCase() === 'lifetime') return Number.POSITIVE_INFINITY;
  if (inst.expiryTimestamp && typeof inst.expiryTimestamp.toMillis === 'function') {
    return inst.expiryTimestamp.toMillis();
  }
  if (inst.expiryTimestamp && typeof inst.expiryTimestamp.seconds === 'number') {
    return inst.expiryTimestamp.seconds * 1000;
  }
  if (inst.expiryDate) {
    const ms = Date.parse(`${String(inst.expiryDate).trim()}T23:59:59Z`);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
};

const classifyInstitutionState = (inst = {}) => {
  const status = String(inst.status || 'active').toLowerCase();
  if (status === 'paused' || status === 'suspended' || inst.isActive === false) {
    return { code: 'paused', label: 'Paused', daysLeft: null };
  }
  const expiryMs = getExpiryTimestampMs(inst);
  if (expiryMs === Number.POSITIVE_INFINITY) {
    return { code: 'active', label: 'Active • Lifetime', daysLeft: Infinity };
  }
  if (!expiryMs) {
    return { code: 'active', label: 'Active', daysLeft: null };
  }
  const diffDays = Math.ceil((expiryMs - Date.now()) / 86400000);
  if (diffDays < 0) {
    return { code: 'expired', label: `Expired (${Math.abs(diffDays)}d ago)`, daysLeft: diffDays };
  }
  if (diffDays <= 15) {
    return { code: 'expiring', label: `Expiring in ${diffDays}d`, daysLeft: diffDays };
  }
  return { code: 'active', label: `Active • ${diffDays}d left`, daysLeft: diffDays };
};

const sanitizeSlugInput = (raw = '') => String(raw || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-_]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

const updateSlugPreview = () => {
  const slugInput = document.getElementById('inst-slug');
  const preview = document.getElementById('inst-slug-preview');
  if (!slugInput || !preview) return;
  const clean = sanitizeSlugInput(slugInput.value);
  const origin = window.location.origin || '';
  if (!clean) {
    preview.textContent = `URL: ${origin}/<slug>`;
    preview.className = 'text-[11px] font-semibold text-slate-500 mt-1 truncate';
    return;
  }
  if (RESERVED_INSTITUTION_SLUGS.has(clean)) {
    preview.textContent = `"${clean}" is a reserved system route. Choose another slug.`;
    preview.className = 'text-[11px] font-bold text-rose-600 mt-1 truncate';
    return;
  }
  preview.textContent = `URL: ${origin}/${clean}`;
  preview.className = 'text-[11px] font-bold text-indigo-600 mt-1 truncate';
};

const renderAllowedPagesCheckboxes = (selectedMap = DEFAULT_COMPANY_ALLOWED_PAGES) => {
  const container = document.getElementById('inst-allowed-pages-grid');
  if (!container) return;
  container.innerHTML = PAGE_DEFINITIONS.map((item) => {
    const isChecked = selectedMap?.[item.key] !== false;
    return `
      <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50/50 hover:border-indigo-200 cursor-pointer transition">
        <input type="checkbox" class="mt-0.5 rounded border-slate-300 text-indigo-600 inst-page-checkbox" data-page-key="${escapeHtml(item.key)}" ${isChecked ? 'checked' : ''}>
        <div class="min-w-0">
          <div class="text-xs font-extrabold text-slate-800">${escapeHtml(item.label)}</div>
          <div class="text-[11px] text-slate-500 leading-snug">${escapeHtml(item.desc)}</div>
        </div>
      </label>
    `;
  }).join('');
};

const readAllowedPagesCheckboxes = () => {
  const result = { ...DEFAULT_COMPANY_ALLOWED_PAGES };
  document.querySelectorAll('.inst-page-checkbox').forEach((cb) => {
    const key = cb.dataset.pageKey;
    if (key) result[key] = cb.checked;
  });
  return result;
};

const syncLifetimeInputs = () => {
  const isLifetime = document.getElementById('inst-is-lifetime')?.checked === true;
  const durEl = document.getElementById('inst-duration-months');
  const startEl = document.getElementById('inst-start-date');
  const expEl = document.getElementById('inst-expiry-date');
  if (durEl) durEl.disabled = isLifetime;
  if (expEl) {
    expEl.disabled = isLifetime;
    if (isLifetime) expEl.value = '';
    else if (!expEl.value && startEl?.value && durEl && Number(durEl.value) > 0) {
      expEl.value = addMonthsToDateStr(startEl.value, Number(durEl.value));
    }
  }
};

const renderKpis = () => {
  let total = allInstitutions.length;
  let active = 0;
  let paused = 0;
  let expired = 0;

  allInstitutions.forEach((inst) => {
    const state = classifyInstitutionState(inst);
    if (state.code === 'paused') paused += 1;
    else if (state.code === 'expired' || state.code === 'expiring') {
      if (state.code === 'expired') expired += 1;
      else {
        active += 1;
        expired += 1;
      }
    } else active += 1;
  });

  document.getElementById('kpi-total').textContent = String(total);
  document.getElementById('kpi-active').textContent = String(active);
  document.getElementById('kpi-paused').textContent = String(paused);
  document.getElementById('kpi-expired').textContent = String(expired);
};

const renderInstitutionsGrid = () => {
  const grid = document.getElementById('institutions-grid');
  if (!grid) return;

  const queryText = String(document.getElementById('inst-search-input')?.value || '').trim().toLowerCase();
  const statusFilter = String(document.getElementById('inst-status-filter')?.value || 'all').toLowerCase();

  const filtered = allInstitutions.filter((inst) => {
    const state = classifyInstitutionState(inst);
    if (statusFilter === 'active' && state.code !== 'active' && state.code !== 'expiring') return false;
    if (statusFilter === 'paused' && state.code !== 'paused') return false;
    if (statusFilter === 'expired' && state.code !== 'expired') return false;
    if (statusFilter === 'expiring' && state.code !== 'expiring' && state.code !== 'expired') return false;

    if (queryText) {
      const haystack = `${inst.name || ''} ${inst.slug || ''} ${inst.place || ''} ${inst.adminEmail || ''} ${inst.adminLoginDisplay || ''}`.toLowerCase();
      if (!haystack.includes(queryText)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="col-span-full bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center">
        <div class="w-12 h-12 mx-auto mb-3 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-xl">
          <i class="fas fa-school"></i>
        </div>
        <h3 class="text-base font-extrabold text-slate-800">No Institutions Found</h3>
        <p class="text-xs text-slate-500 mt-1 mb-4">Create your first institution portal or adjust your search filter.</p>
        <button type="button" id="btn-empty-add-inst" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer inline-flex items-center gap-2">
          <i class="fas fa-plus"></i><span>Add First Institution</span>
        </button>
      </div>
    `;
    document.getElementById('btn-empty-add-inst')?.addEventListener('click', () => openInstitutionModal('create'));
    return;
  }

  const origin = window.location.origin || '';
  grid.innerHTML = filtered.map((inst) => {
    const slug = String(inst.slug || inst.id || '').trim().toLowerCase();
    const state = classifyInstitutionState(inst);
    const cleanUrl = `${origin}/${slug}`;
    const pages = { ...DEFAULT_COMPANY_ALLOWED_PAGES, ...(inst.allowedPages || {}) };
    const enabledCount = PAGE_DEFINITIONS.filter((p) => pages[p.key] !== false).length;
    const isPaused = state.code === 'paused';

    const badgeClasses = isPaused
      ? 'bg-amber-100 text-amber-800 border-amber-200'
      : state.code === 'expired'
        ? 'bg-rose-100 text-rose-800 border-rose-200'
        : state.code === 'expiring'
          ? 'bg-orange-100 text-orange-800 border-orange-200'
          : 'bg-emerald-100 text-emerald-800 border-emerald-200';

    const expiryLabel = inst.isLifetime
      ? 'Lifetime Validity'
      : (inst.expiryDate ? `Expires: ${formatDateDisplay(inst.expiryDate)}` : 'No Expiry Date');

    const loginDisplay = inst.adminLoginDisplay
      || (isInternalStaffEmail(inst.adminEmail || '') ? extractInternalUsername(inst.adminEmail || '') : (inst.adminEmail || '--'));
    const storedPass = String(inst.adminPassword || '');

    return `
      <article class="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs hover:shadow-md transition flex flex-col justify-between gap-4">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-base font-extrabold text-slate-900 truncate">${escapeHtml(inst.name || slug)}</h3>
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${badgeClasses}">${escapeHtml(state.label)}</span>
              </div>
              <div class="text-xs font-mono font-bold text-indigo-600 mt-1 truncate">/${escapeHtml(slug)}</div>
              <div class="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                ${inst.place ? `<span><i class="fas fa-location-dot mr-1 text-slate-400"></i>${escapeHtml(inst.place)}</span>` : ''}
                ${inst.phone ? `<span><i class="fas fa-phone mr-1 text-slate-400"></i>${escapeHtml(inst.phone)}</span>` : ''}
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 text-[11px] font-extrabold shrink-0">
              ${escapeHtml(inst.planName || 'Standard')}
            </span>
          </div>

          <!-- Super Admin Credentials Bar -->
          <div class="rounded-xl bg-slate-50 border border-slate-200/90 p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <i class="fas fa-user-shield mr-1 text-indigo-600"></i>Super Admin: ${escapeHtml(inst.adminName || 'Master Admin')}
              </span>
              <button type="button" class="btn-edit-inst text-[11px] font-extrabold text-indigo-600 hover:text-indigo-800 cursor-pointer inline-flex items-center gap-1" data-slug="${escapeHtml(slug)}">
                <i class="fas fa-pen-to-square"></i><span>Change Credentials</span>
              </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div class="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 min-w-0">
                <div class="min-w-0 truncate">
                  <span class="text-[10px] font-bold text-slate-400 block leading-none">Username / Email</span>
                  <span class="font-mono font-bold text-slate-800 text-xs truncate block mt-0.5">${escapeHtml(loginDisplay)}</span>
                </div>
                <button type="button" class="btn-copy-admin-login w-7 h-7 rounded-md hover:bg-slate-100 text-slate-500 hover:text-indigo-600 shrink-0 flex items-center justify-center cursor-pointer" data-val="${escapeHtml(loginDisplay)}" title="Copy Username / Email">
                  <i class="fas fa-copy text-[11px]"></i>
                </button>
              </div>
              <div class="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 min-w-0">
                <div class="min-w-0 truncate">
                  <span class="text-[10px] font-bold text-slate-400 block leading-none">Password</span>
                  ${storedPass
                    ? `<span class="card-pass-display font-mono font-bold text-slate-800 text-xs truncate block mt-0.5" data-pass="${escapeHtml(storedPass)}" data-visible="false">••••••••</span>`
                    : `<span class="text-[11px] font-semibold text-amber-700 truncate block mt-0.5">Click Edit to set/view</span>`}
                </div>
                ${storedPass ? `
                  <div class="flex items-center gap-0.5 shrink-0">
                    <button type="button" class="btn-toggle-card-pass w-7 h-7 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center cursor-pointer" title="Show / Hide Password">
                      <i class="fas fa-eye text-[11px]"></i>
                    </button>
                    <button type="button" class="btn-copy-admin-pass w-7 h-7 rounded-md hover:bg-slate-100 text-slate-500 hover:text-indigo-600 flex items-center justify-center cursor-pointer" data-val="${escapeHtml(storedPass)}" title="Copy Password">
                      <i class="fas fa-copy text-[11px]"></i>
                    </button>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>

          ${isPaused && inst.pauseReason ? `
            <div class="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
              <i class="fas fa-info-circle mr-1"></i>Pause Reason: ${escapeHtml(inst.pauseReason)}
            </div>
          ` : ''}

          <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
            <span><i class="fas fa-calendar-days mr-1.5 text-slate-400"></i>${escapeHtml(expiryLabel)}</span>
            <span><i class="fas fa-layer-group mr-1.5 text-indigo-500"></i>${enabledCount}/${PAGE_DEFINITIONS.length} Pages Enabled</span>
          </div>

          <div class="flex flex-wrap gap-1.5">
            ${PAGE_DEFINITIONS.map((p) => {
              const on = pages[p.key] !== false;
              return `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${on ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-slate-100 text-slate-400 line-through'}">${escapeHtml(p.label)}</span>`;
            }).join('')}
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <button type="button" class="btn-copy-url px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer" data-url="${escapeHtml(cleanUrl)}">
              <i class="fas fa-copy mr-1"></i>Copy URL
            </button>
            <a href="/${escapeHtml(slug)}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold inline-flex items-center gap-1">
              <i class="fas fa-arrow-up-right-from-square"></i><span>Open</span>
            </a>
            <button type="button" class="btn-edit-inst px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer" data-slug="${escapeHtml(slug)}">
              <i class="fas fa-sliders mr-1"></i>Edit & Pages
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            ${!inst.isLifetime ? `
              <button type="button" class="btn-extend-inst px-2 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold cursor-pointer" data-slug="${escapeHtml(slug)}" data-months="1">+1M</button>
              <button type="button" class="btn-extend-inst px-2 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold cursor-pointer" data-slug="${escapeHtml(slug)}" data-months="3">+3M</button>
              <button type="button" class="btn-extend-inst px-2 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold cursor-pointer" data-slug="${escapeHtml(slug)}" data-months="12">+1Y</button>
            ` : ''}
            ${isPaused
              ? `<button type="button" class="btn-resume-inst px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold cursor-pointer" data-slug="${escapeHtml(slug)}"><i class="fas fa-play mr-1"></i>Continue</button>`
              : `<button type="button" class="btn-pause-inst px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-extrabold cursor-pointer" data-slug="${escapeHtml(slug)}"><i class="fas fa-pause mr-1"></i>Pause</button>`}
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.btn-copy-url').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetUrl = btn.dataset.url || '';
      try {
        await navigator.clipboard.writeText(targetUrl);
        showToast(`Copied: ${targetUrl}`);
      } catch (_) {
        showToast(`Portal URL: ${targetUrl}`, 'info');
      }
    });
  });

  grid.querySelectorAll('.btn-copy-admin-login').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const val = btn.dataset.val || '';
      if (!val) return;
      try {
        await navigator.clipboard.writeText(val);
        showToast(`Copied Username/Email: ${val}`);
      } catch (_) {
        showToast(`Username/Email: ${val}`, 'info');
      }
    });
  });

  grid.querySelectorAll('.btn-copy-admin-pass').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const val = btn.dataset.val || '';
      if (!val) return;
      try {
        await navigator.clipboard.writeText(val);
        showToast('Copied Super Admin Password');
      } catch (_) {
        showToast(`Password: ${val}`, 'info');
      }
    });
  });

  grid.querySelectorAll('.btn-toggle-card-pass').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('article');
      const display = card?.querySelector('.card-pass-display');
      const icon = btn.querySelector('i');
      if (!display) return;
      const isVisible = display.dataset.visible === 'true';
      if (isVisible) {
        display.textContent = '••••••••';
        display.dataset.visible = 'false';
        if (icon) icon.className = 'fas fa-eye text-[11px]';
      } else {
        display.textContent = display.dataset.pass || '';
        display.dataset.visible = 'true';
        if (icon) icon.className = 'fas fa-eye-slash text-[11px]';
      }
    });
  });

  grid.querySelectorAll('.btn-edit-inst').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inst = allInstitutions.find((i) => (i.slug || i.id) === btn.dataset.slug);
      if (inst) openInstitutionModal('edit', inst);
    });
  });

  grid.querySelectorAll('.btn-extend-inst').forEach((btn) => {
    btn.addEventListener('click', () => handleExtendInstitution(btn.dataset.slug, Number(btn.dataset.months || 1)));
  });

  grid.querySelectorAll('.btn-pause-inst').forEach((btn) => {
    btn.addEventListener('click', () => openPauseModal(btn.dataset.slug));
  });

  grid.querySelectorAll('.btn-resume-inst').forEach((btn) => {
    btn.addEventListener('click', () => handleResumeInstitution(btn.dataset.slug));
  });
};

const loadInstitutions = async () => {
  try {
    const snap = await getDocs(query(collection(db, INSTITUTIONS_COLLECTION), orderBy('name')));
    allInstitutions = snap.docs.map((d) => ({ id: d.id, slug: d.id, ...d.data() }));
  } catch (err) {
    try {
      const snap = await getDocs(collection(db, INSTITUTIONS_COLLECTION));
      allInstitutions = snap.docs
        .map((d) => ({ id: d.id, slug: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
    } catch (innerErr) {
      showToast(`Failed to load institutions: ${innerErr.message}`, 'error');
      allInstitutions = [];
    }
  }

  // Load Super Admin credentials (adminAuth) for each institution and backfill globalUsers
  await Promise.all(
    allInstitutions.map(async (inst) => {
      const slug = String(inst.slug || inst.id || '').trim().toLowerCase();
      if (!slug) return;
      try {
        const authSnap = await getDoc(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'adminAuth'));
        if (authSnap.exists()) {
          const authData = authSnap.data() || {};
          if (authData.email && !inst.adminEmail) inst.adminEmail = authData.email;
          if (authData.username) inst.adminUsername = authData.username;
          if (authData.loginDisplay) inst.adminLoginDisplay = authData.loginDisplay;
          if (authData.adminPassword) inst.adminPassword = authData.adminPassword;
          if (authData.authVaultEmail) inst.authVaultEmail = authData.authVaultEmail;
          if (authData.passwordHash) inst.passwordHash = authData.passwordHash;
        }
        const parsed = parseSuperAdminLoginInput(inst.adminLoginDisplay || inst.adminEmail || '', slug);
        if (parsed.valid) {
          inst.adminEmail = parsed.email;
          inst.adminUsername = parsed.username;
          inst.adminLoginDisplay = parsed.loginDisplay;
          await syncSuperAdminGlobalUser({
            slug,
            instName: inst.name || slug,
            adminName: inst.adminName || 'Master Admin',
            email: parsed.email,
            username: parsed.username,
            loginDisplay: parsed.loginDisplay,
            authVaultEmail: inst.authVaultEmail || '',
            passwordHash: inst.passwordHash || ''
          });
        }
      } catch (e) {
        console.warn(`AdminAuth sync notice for /${slug}:`, e);
      }
    })
  );

  renderKpis();
  renderInstitutionsGrid();
};

const resetModalPasswordVisibility = () => {
  const pwdEl = document.getElementById('inst-admin-password');
  const eyeEl = document.getElementById('inst-admin-pass-eye');
  if (pwdEl) pwdEl.type = 'password';
  if (eyeEl) eyeEl.className = 'fas fa-eye text-xs';
};

const openInstitutionModal = (mode = 'create', inst = null) => {
  const modal = document.getElementById('inst-form-modal');
  const form = document.getElementById('inst-form');
  const errorBox = document.getElementById('inst-form-error');
  if (!modal || !form) return;

  form.reset();
  resetModalPasswordVisibility();
  if (errorBox) {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  document.getElementById('inst-form-mode').value = mode;
  const slugEl = document.getElementById('inst-slug');
  const passWrap = document.getElementById('inst-admin-password-wrap');
  const passInput = document.getElementById('inst-admin-password');
  const passLabel = document.getElementById('inst-admin-password-label');
  const passHint = document.getElementById('inst-admin-password-hint');
  const linkExistingWrap = document.getElementById('inst-link-existing-auth-wrap');
  const resetBtn = document.getElementById('btn-send-admin-reset');
  const editStatusWrap = document.getElementById('inst-edit-status-wrap');

  passWrap?.classList.remove('hidden');

  if (mode === 'edit' && inst) {
    document.getElementById('inst-modal-title').textContent = `Edit Institution: ${inst.name || inst.slug}`;
    document.getElementById('inst-modal-subtitle').textContent = 'Update details, allowed modules, Super Admin username/email, password, or subscription validity.';
    document.getElementById('inst-name').value = inst.name || '';
    slugEl.value = inst.slug || inst.id || '';
    slugEl.readOnly = true;
    slugEl.classList.add('bg-slate-100', 'text-slate-500');
    document.getElementById('inst-place').value = inst.place || '';
    document.getElementById('inst-phone').value = inst.phone || '';
    document.getElementById('inst-admin-name').value = inst.adminName || 'Master Admin';

    const displayLogin = inst.adminLoginDisplay
      || (isInternalStaffEmail(inst.adminEmail || '') ? extractInternalUsername(inst.adminEmail || '') : (inst.adminEmail || ''));
    document.getElementById('inst-admin-email').value = displayLogin;

    if (passInput) {
      passInput.disabled = false;
      passInput.required = false;
      passInput.value = inst.adminPassword || '';
      passInput.placeholder = inst.adminPassword ? 'Current password loaded (edit to change)' : 'Enter new password (min 6 characters)';
    }
    if (passLabel) {
      passLabel.innerHTML = 'Super Admin Password <span class="text-slate-400 font-normal">(View or edit to change)</span>';
    }
    if (passHint) {
      passHint.textContent = 'Click the eye icon to view the current password, or type a new password here to change it immediately.';
    }
    linkExistingWrap?.classList.add('hidden');
    const hasRealEmail = Boolean(inst.adminEmail && inst.adminEmail.includes('@') && !isInternalStaffEmail(inst.adminEmail));
    resetBtn?.classList.toggle('hidden', !hasRealEmail);

    editStatusWrap?.classList.remove('hidden');
    document.getElementById('inst-status-select').value = String(inst.status || 'active').toLowerCase() === 'paused' ? 'paused' : 'active';
    document.getElementById('inst-pause-reason').value = inst.pauseReason || '';

    document.getElementById('inst-plan-name').value = inst.planName || 'Standard';
    document.getElementById('inst-is-lifetime').checked = inst.isLifetime === true;
    document.getElementById('inst-duration-months').value = String(inst.durationMonths ?? 0);
    document.getElementById('inst-start-date').value = inst.startDate || toIsoDateInput();
    document.getElementById('inst-expiry-date').value = inst.expiryDate || '';
    renderAllowedPagesCheckboxes({ ...DEFAULT_COMPANY_ALLOWED_PAGES, ...(inst.allowedPages || {}) });
  } else {
    document.getElementById('inst-modal-title').textContent = 'Add New Institution';
    document.getElementById('inst-modal-subtitle').textContent = 'Provisions institution workspace, unique Super Admin credentials, and subscription rules.';
    slugEl.readOnly = false;
    slugEl.value = '';
    slugEl.classList.remove('bg-slate-100', 'text-slate-500');
    const todayStr = toIsoDateInput();
    document.getElementById('inst-start-date').value = todayStr;
    document.getElementById('inst-duration-months').value = '12';
    document.getElementById('inst-expiry-date').value = addMonthsToDateStr(todayStr, 12);
    document.getElementById('inst-is-lifetime').checked = false;
    document.getElementById('inst-link-existing-auth').checked = false;
    linkExistingWrap?.classList.remove('hidden');
    if (passInput) {
      passInput.disabled = false;
      passInput.required = true;
      passInput.value = '';
      passInput.placeholder = 'Minimum 6 characters';
    }
    if (passLabel) {
      passLabel.innerHTML = 'Super Admin Password <span class="text-rose-500">*</span>';
    }
    if (passHint) {
      passHint.textContent = 'You can view or change the Super Admin password at any time from this console.';
    }
    resetBtn?.classList.add('hidden');
    editStatusWrap?.classList.add('hidden');
    renderAllowedPagesCheckboxes(DEFAULT_COMPANY_ALLOWED_PAGES);
  }

  syncLifetimeInputs();
  updateSlugPreview();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

const closeInstitutionModal = () => {
  const modal = document.getElementById('inst-form-modal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');
};

const showFormError = (msg) => {
  const box = document.getElementById('inst-form-error');
  if (!box) return;
  box.textContent = msg;
  box.classList.remove('hidden');
};

const provisionOrUpdateAdminAuthUser = async ({
  slug,
  targetEmail,
  targetPassword,
  previousEmail = '',
  previousPassword = '',
  existingAuthVaultEmail = '',
  linkExistingAuth = false
}) => {
  if (!targetPassword) {
    return { authVaultEmail: existingAuthVaultEmail || targetEmail };
  }
  const appName = `SecondaryProvisioner_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);
  let resolvedVaultEmail = existingAuthVaultEmail || targetEmail;

  try {
    // 1. Try creating the targetEmail directly in Firebase Auth
    try {
      await createUserWithEmailAndPassword(secondaryAuth, targetEmail, targetPassword);
      resolvedVaultEmail = targetEmail;
      try { await firebaseSignOut(secondaryAuth); } catch (_) {}
      return { authVaultEmail: resolvedVaultEmail };
    } catch (createErr) {
      if (createErr?.code !== 'auth/email-already-in-use') {
        throw createErr;
      }
    }

    // 2. If targetEmail already exists in Firebase Auth, try signing in to update its password
    const candidatePasswords = Array.from(new Set([previousPassword, targetPassword].filter(Boolean)));
    let updatedDirect = false;
    for (const candidatePass of candidatePasswords) {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, targetEmail, candidatePass);
        if (cred?.user) {
          if (candidatePass !== targetPassword) {
            await updatePassword(cred.user, targetPassword);
          }
          resolvedVaultEmail = targetEmail;
          updatedDirect = true;
          try { await firebaseSignOut(secondaryAuth); } catch (_) {}
          break;
        }
      } catch (_) {}
    }

    if (updatedDirect) {
      return { authVaultEmail: resolvedVaultEmail };
    }

    // 3. If previous password in Firebase Auth differed or wasn't stored yet, provision a deterministic vault identity
    // so the new password set by the Company Owner works immediately with full Firebase Auth + Firestore Rules access
    const passDigest = await hashCredentialValue(`${slug}:${targetEmail}:${targetPassword}`);
    const vaultAliasEmail = `vault_${passDigest.slice(0, 12)}@${slug}.internal`;
    try {
      await createUserWithEmailAndPassword(secondaryAuth, vaultAliasEmail, targetPassword);
      resolvedVaultEmail = vaultAliasEmail;
    } catch (vaultErr) {
      if (vaultErr?.code === 'auth/email-already-in-use') {
        resolvedVaultEmail = vaultAliasEmail;
      } else if (!linkExistingAuth) {
        throw vaultErr;
      }
    }
    try { await firebaseSignOut(secondaryAuth); } catch (_) {}
    return { authVaultEmail: resolvedVaultEmail };
  } finally {
    try { await deleteApp(secondaryApp); } catch (_) {}
  }
};

const handleInstitutionSubmit = async (e) => {
  e.preventDefault();
  const mode = document.getElementById('inst-form-mode').value;
  const name = String(document.getElementById('inst-name').value || '').trim();
  const slug = sanitizeSlugInput(document.getElementById('inst-slug').value);
  const place = String(document.getElementById('inst-place').value || '').trim();
  const phone = String(document.getElementById('inst-phone').value || '').trim();
  const adminName = String(document.getElementById('inst-admin-name').value || '').trim() || 'Master Admin';
  const rawAdminLogin = String(document.getElementById('inst-admin-email').value || '').trim();
  const adminPassword = String(document.getElementById('inst-admin-password').value || '').trim();
  const linkExistingAuth = document.getElementById('inst-link-existing-auth')?.checked === true;
  const planName = String(document.getElementById('inst-plan-name').value || 'Standard').trim();
  const isLifetime = document.getElementById('inst-is-lifetime')?.checked === true;
  const durationMonths = Number(document.getElementById('inst-duration-months').value || 0);
  const startDate = String(document.getElementById('inst-start-date').value || toIsoDateInput()).trim();
  const expiryDate = isLifetime ? '' : String(document.getElementById('inst-expiry-date').value || '').trim();
  const allowedPages = readAllowedPagesCheckboxes();

  const errorBox = document.getElementById('inst-form-error');
  if (errorBox) errorBox.classList.add('hidden');

  if (!name) return showFormError('Institution Name is required.');
  if (!slug) return showFormError('Valid Portal URL Slug is required (letters, numbers, hyphen).');
  if (RESERVED_INSTITUTION_SLUGS.has(slug)) return showFormError(`"${slug}" is reserved by the system. Please choose another slug.`);

  const parsedLogin = parseSuperAdminLoginInput(rawAdminLogin, slug);
  if (!parsedLogin.valid) {
    return showFormError(parsedLogin.error);
  }
  const { email: adminEmail, username: adminUsername, loginDisplay: adminLoginDisplay } = parsedLogin;

  if (!isLifetime && !expiryDate) return showFormError('Please select an Expiry Date or enable Lifetime Access.');

  const existingInst = allInstitutions.find((i) => (i.slug || i.id) === slug) || null;
  if (mode === 'create' && !linkExistingAuth && (!adminPassword || adminPassword.length < 6)) {
    return showFormError('Super Admin Password must be at least 6 characters.');
  }
  if (mode === 'edit' && adminPassword && adminPassword.length < 6) {
    return showFormError('Super Admin Password must be at least 6 characters.');
  }

  const saveBtn = document.getElementById('btn-save-inst');
  const originalHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';

  try {
    const expiryTimestamp = isLifetime ? null : toExpiryTimestamp(expiryDate);

    // 1. Verify global username/email uniqueness across all institutions & staff
    await assertGlobalLoginAvailable({
      email: adminEmail,
      username: adminUsername,
      loginDisplay: adminLoginDisplay,
      slug
    });

    const effectivePassword = adminPassword || existingInst?.adminPassword || '';
    const passwordHash = effectivePassword ? await hashCredentialValue(effectivePassword) : (existingInst?.passwordHash || '');

    if (mode === 'create') {
      const existingSnap = await getDoc(doc(db, INSTITUTIONS_COLLECTION, slug));
      if (existingSnap.exists()) {
        throw new Error(`Portal URL Slug "/${slug}" is already taken by another institution.`);
      }

      const authRes = await provisionOrUpdateAdminAuthUser({
        slug,
        targetEmail: adminEmail,
        targetPassword: effectivePassword,
        linkExistingAuth
      });
      const authVaultEmail = authRes.authVaultEmail || adminEmail;

      const adminsIndex = { [adminEmail]: true };
      if (authVaultEmail) adminsIndex[authVaultEmail] = true;

      const batch = writeBatch(db);
      batch.set(doc(db, INSTITUTIONS_COLLECTION, slug), {
        slug,
        name,
        place,
        phone,
        adminName,
        adminEmail,
        adminUsername,
        adminLoginDisplay,
        status: 'active',
        isActive: true,
        pauseReason: '',
        planName: isLifetime ? 'Lifetime' : planName,
        durationMonths,
        isLifetime,
        startDate,
        expiryDate,
        expiryTimestamp,
        allowedPages,
        createdBy: verifiedCompanyOwnerEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      batch.set(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'adminAuth'), {
        email: adminEmail,
        username: adminUsername,
        loginDisplay: adminLoginDisplay,
        adminPassword: effectivePassword,
        passwordHash,
        authVaultEmail,
        adminsIndex,
        admins: [
          {
            name: adminName,
            email: adminEmail,
            username: adminUsername,
            role: 'super_admin',
            isActive: true
          }
        ],
        updatedAt: serverTimestamp()
      });

      batch.set(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'config'), {
        appName: name,
        appSubtitle: 'Excellence in Education',
        place,
        contactPhone: phone,
        contactEmail: adminEmail,
        enabledModules: { ...allowedPages },
        adminProfile: {
          name: adminName,
          email: adminEmail,
          username: adminUsername
        },
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      await syncSuperAdminGlobalUser({
        slug,
        instName: name,
        adminName,
        email: adminEmail,
        username: adminUsername,
        loginDisplay: adminLoginDisplay,
        authVaultEmail,
        passwordHash
      });

      showToast(`Created /${slug} successfully!`);
    } else {
      const status = document.getElementById('inst-status-select').value === 'paused' ? 'paused' : 'active';
      const pauseReason = status === 'paused' ? String(document.getElementById('inst-pause-reason').value || '').trim() : '';

      let authVaultEmail = existingInst?.authVaultEmail || adminEmail;
      const emailChanged = existingInst?.adminEmail && existingInst.adminEmail !== adminEmail;
      const passwordChanged = Boolean(adminPassword && adminPassword !== (existingInst?.adminPassword || ''));

      if (emailChanged || passwordChanged || (effectivePassword && !existingInst?.authVaultEmail)) {
        const authRes = await provisionOrUpdateAdminAuthUser({
          slug,
          targetEmail: adminEmail,
          targetPassword: effectivePassword,
          previousEmail: existingInst?.adminEmail || '',
          previousPassword: existingInst?.adminPassword || '',
          existingAuthVaultEmail: existingInst?.authVaultEmail || '',
          linkExistingAuth: true
        });
        authVaultEmail = authRes.authVaultEmail || adminEmail;
      }

      const adminsIndex = { [adminEmail]: true };
      if (authVaultEmail) adminsIndex[authVaultEmail] = true;

      const batch = writeBatch(db);
      batch.update(doc(db, INSTITUTIONS_COLLECTION, slug), {
        name,
        place,
        phone,
        adminName,
        adminEmail,
        adminUsername,
        adminLoginDisplay,
        status,
        isActive: status === 'active',
        pauseReason,
        planName: isLifetime ? 'Lifetime' : planName,
        durationMonths,
        isLifetime,
        startDate,
        expiryDate,
        expiryTimestamp,
        allowedPages,
        updatedAt: serverTimestamp()
      });

      batch.set(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'adminAuth'), {
        email: adminEmail,
        username: adminUsername,
        loginDisplay: adminLoginDisplay,
        adminPassword: effectivePassword,
        passwordHash,
        authVaultEmail,
        adminsIndex,
        admins: [
          {
            name: adminName,
            email: adminEmail,
            username: adminUsername,
            role: 'super_admin',
            isActive: true
          }
        ],
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'config'), {
        appName: name,
        place,
        contactPhone: phone,
        contactEmail: adminEmail,
        enabledModules: { ...allowedPages },
        adminProfile: {
          name: adminName,
          email: adminEmail,
          username: adminUsername
        },
        updatedAt: serverTimestamp()
      }, { merge: true });

      await batch.commit();

      await syncSuperAdminGlobalUser({
        slug,
        instName: name,
        adminName,
        email: adminEmail,
        username: adminUsername,
        loginDisplay: adminLoginDisplay,
        authVaultEmail,
        passwordHash,
        previousEmail: existingInst?.adminEmail || '',
        previousUsername: existingInst?.adminUsername || '',
        previousLoginDisplay: existingInst?.adminLoginDisplay || ''
      });

      showToast(`Updated /${slug} successfully!`);
    }

    closeInstitutionModal();
    await loadInstitutions();
  } catch (err) {
    console.error('Save institution error:', err);
    showFormError(err.message || 'Failed to save institution.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalHtml;
  }
};

const handleExtendInstitution = async (slug, months = 1) => {
  const inst = allInstitutions.find((i) => (i.slug || i.id) === slug);
  if (!inst) return;
  const todayStr = toIsoDateInput();
  const baseDate = inst.expiryDate && Date.parse(`${inst.expiryDate}T23:59:59Z`) > Date.now()
    ? inst.expiryDate
    : todayStr;
  const nextExpiryDate = addMonthsToDateStr(baseDate, months);
  const ok = await openConfirmDialog({
    title: 'Extend Subscription',
    message: `Extend ${inst.name || slug} by ${months} month(s)? New expiry date will be ${formatDateDisplay(nextExpiryDate)}.`,
    okLabel: `Extend +${months}M`
  });
  if (!ok) return;

  try {
    await updateDoc(doc(db, INSTITUTIONS_COLLECTION, slug), {
      expiryDate: nextExpiryDate,
      expiryTimestamp: toExpiryTimestamp(nextExpiryDate),
      isLifetime: false,
      status: 'active',
      isActive: true,
      pauseReason: '',
      updatedAt: serverTimestamp()
    });
    showToast(`Extended /${slug} until ${formatDateDisplay(nextExpiryDate)}`);
    await loadInstitutions();
  } catch (err) {
    showToast(`Extend failed: ${err.message}`, 'error');
  }
};

const openPauseModal = (slug) => {
  const inst = allInstitutions.find((i) => (i.slug || i.id) === slug);
  if (!inst) return;
  pendingPauseTarget = inst;
  document.getElementById('pause-inst-target-label').textContent = `${inst.name || slug} (/${slug})`;
  document.getElementById('pause-reason-input').value = inst.pauseReason || '';
  const modal = document.getElementById('pause-inst-modal');
  modal?.classList.remove('hidden');
  modal?.classList.add('flex');
};

const closePauseModal = () => {
  pendingPauseTarget = null;
  const modal = document.getElementById('pause-inst-modal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');
};

const handleConfirmPause = async () => {
  if (!pendingPauseTarget) return;
  const slug = pendingPauseTarget.slug || pendingPauseTarget.id;
  const reason = String(document.getElementById('pause-reason-input')?.value || '').trim();
  try {
    await updateDoc(doc(db, INSTITUTIONS_COLLECTION, slug), {
      status: 'paused',
      isActive: false,
      pauseReason: reason,
      updatedAt: serverTimestamp()
    });
    closePauseModal();
    showToast(`Paused /${slug}`);
    await loadInstitutions();
  } catch (err) {
    showToast(`Pause failed: ${err.message}`, 'error');
  }
};

const handleResumeInstitution = async (slug) => {
  const inst = allInstitutions.find((i) => (i.slug || i.id) === slug);
  if (!inst) return;
  try {
    await updateDoc(doc(db, INSTITUTIONS_COLLECTION, slug), {
      status: 'active',
      isActive: true,
      pauseReason: '',
      updatedAt: serverTimestamp()
    });
    showToast(`Resumed /${slug}`);
    await loadInstitutions();
  } catch (err) {
    showToast(`Resume failed: ${err.message}`, 'error');
  }
};

const verifyCompanyOwnerSession = async (user) => {
  if (!user || user.isAnonymous || !user.email) return false;
  const email = String(user.email).trim().toLowerCase();
  try {
    try {
      await user.getIdToken();
    } catch (_) {}
    const configRef = doc(db, COMPANY_COLLECTION, COMPANY_CONFIG_DOC_ID);
    let configSnap = null;
    try {
      configSnap = await getDocFromServer(configRef);
    } catch (serverErr) {
      if (serverErr?.code === 'unavailable' || String(serverErr?.message || '').toLowerCase().includes('offline')) {
        configSnap = await getDoc(configRef);
      } else {
        throw serverErr;
      }
    }
    if (!configSnap?.exists()) return false;
    const data = configSnap.data() || {};
    const ownersList = Array.isArray(data.owners) ? data.owners : [];
    const isOwner = String(data.email || '').trim().toLowerCase() === email
      || data.ownersIndex?.[email] === true
      || ownersList.some((o) => String(o?.email || '').trim().toLowerCase() === email && o?.isActive !== false);
    if (!isOwner) return false;

    verifiedCompanyOwnerEmail = email;
    const brandTitle = document.getElementById('company-brand-title');
    const ownerEmailEl = document.getElementById('company-owner-email');
    if (brandTitle) brandTitle.textContent = data.companyName || 'Institution Manage';
    if (ownerEmailEl) ownerEmailEl.textContent = `${email} • Project: ${firebaseConfig.projectId}`;
    window.AppSession?.startCompany?.({
      name: ownersList.find((o) => String(o?.email || '').toLowerCase() === email)?.name || 'Company Owner',
      email,
      companyName: data.companyName || 'Institution Manage'
    });
    return true;
  } catch (err) {
    console.error('Company verification error:', err);
    return false;
  }
};

const bindEvents = () => {
  document.getElementById('btn-company-signout')?.addEventListener('click', () => {
    window.AppSession?.signOut?.(auth, { redirectUrl: '/?public=1' });
  });
  document.getElementById('btn-refresh-institutions')?.addEventListener('click', loadInstitutions);
  document.getElementById('inst-search-input')?.addEventListener('input', renderInstitutionsGrid);
  document.getElementById('inst-status-filter')?.addEventListener('change', renderInstitutionsGrid);
  document.getElementById('btn-open-add-inst')?.addEventListener('click', () => openInstitutionModal('create'));
  document.getElementById('btn-close-inst-modal')?.addEventListener('click', closeInstitutionModal);
  document.getElementById('btn-cancel-inst-modal')?.addEventListener('click', closeInstitutionModal);
  document.getElementById('inst-form')?.addEventListener('submit', handleInstitutionSubmit);

  // Portal URL Slug is entered independently of Institution Name (supports multiple institutions with the same name)
  document.getElementById('inst-slug')?.addEventListener('input', () => {
    updateSlugPreview();
  });

  document.getElementById('btn-toggle-inst-admin-pass')?.addEventListener('click', () => {
    const pwdEl = document.getElementById('inst-admin-password');
    const eyeEl = document.getElementById('inst-admin-pass-eye');
    if (!pwdEl) return;
    const isPassword = pwdEl.type === 'password';
    pwdEl.type = isPassword ? 'text' : 'password';
    if (eyeEl) {
      eyeEl.className = isPassword ? 'fas fa-eye-slash text-xs' : 'fas fa-eye text-xs';
    }
  });

  document.getElementById('btn-copy-inst-admin-pass')?.addEventListener('click', async () => {
    const pwdEl = document.getElementById('inst-admin-password');
    const val = String(pwdEl?.value || '');
    if (!val) {
      showToast('No password entered to copy.', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(val);
      showToast('Copied Super Admin Password');
    } catch (_) {
      showToast(`Password: ${val}`, 'info');
    }
  });

  document.getElementById('inst-duration-months')?.addEventListener('change', () => {
    const months = Number(document.getElementById('inst-duration-months').value || 0);
    const startVal = document.getElementById('inst-start-date').value || toIsoDateInput();
    if (months > 0 && !document.getElementById('inst-is-lifetime').checked) {
      document.getElementById('inst-expiry-date').value = addMonthsToDateStr(startVal, months);
    }
  });
  document.getElementById('inst-start-date')?.addEventListener('change', () => {
    const months = Number(document.getElementById('inst-duration-months').value || 0);
    if (months > 0 && !document.getElementById('inst-is-lifetime').checked) {
      document.getElementById('inst-expiry-date').value = addMonthsToDateStr(document.getElementById('inst-start-date').value, months);
    }
  });
  document.getElementById('inst-is-lifetime')?.addEventListener('change', syncLifetimeInputs);
  document.getElementById('inst-link-existing-auth')?.addEventListener('change', (e) => {
    const pwd = document.getElementById('inst-admin-password');
    if (pwd) {
      pwd.required = !e.target.checked && document.getElementById('inst-form-mode').value === 'create';
    }
  });

  document.getElementById('btn-pages-select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.inst-page-checkbox').forEach((cb) => { cb.checked = true; });
  });
  document.getElementById('btn-pages-core-only')?.addEventListener('click', () => {
    document.querySelectorAll('.inst-page-checkbox').forEach((cb) => {
      cb.checked = CORE_PAGE_KEYS.has(cb.dataset.pageKey);
    });
  });

  document.getElementById('btn-send-admin-reset')?.addEventListener('click', async () => {
    const email = String(document.getElementById('inst-admin-email')?.value || '').trim().toLowerCase();
    if (!email || !email.includes('@') || isInternalStaffEmail(email)) return;
    const ok = await openConfirmDialog({
      title: 'Send Password Reset Email',
      message: `Send a Firebase password reset link to ${email}?`,
      okLabel: 'Send Email'
    });
    if (!ok) return;
    try {
      await sendPasswordResetEmail(auth, email);
      showToast(`Password reset email sent to ${email}`);
    } catch (err) {
      showToast(`Failed to send reset email: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-cancel-pause-modal')?.addEventListener('click', closePauseModal);
  document.getElementById('btn-confirm-pause-modal')?.addEventListener('click', handleConfirmPause);
};

bindEvents();

let authInitialized = false;
onAuthStateChanged(auth, async (user) => {
  if (authInitialized && !user) {
    window.location.replace('/?public=1');
    return;
  }
  const ok = await verifyCompanyOwnerSession(user);
  authInitialized = true;
  if (!ok) {
    await window.AppSession?.signOut?.(auth, { redirectUrl: '/?public=1' });
    return;
  }
  document.getElementById('company-loader')?.classList.add('hidden');
  document.getElementById('company-main')?.classList.remove('hidden');
  await loadInstitutions();
});
