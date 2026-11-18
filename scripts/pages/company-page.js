import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  collection,
  doc,
  getDoc,
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
  signOut as firebaseSignOut
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { auth, db, firebaseConfig } from '../../config/firebase-config.js';
import {
  COMPANY_COLLECTION,
  COMPANY_CONFIG_DOC_ID,
  DEFAULT_COMPANY_ALLOWED_PAGES,
  INSTITUTIONS_COLLECTION,
  RESERVED_INSTITUTION_SLUGS
} from '../../config/app-config.js';
import {
  escapeHtml,
  formatDateDisplay,
  openConfirmDialog,
  registerServiceWorker
} from '../shared/app-common.js';

registerServiceWorker();

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
      const haystack = `${inst.name || ''} ${inst.slug || ''} ${inst.place || ''} ${inst.adminEmail || ''}`.toLowerCase();
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
                ${inst.adminEmail ? `<span><i class="fas fa-user-shield mr-1 text-slate-400"></i>${escapeHtml(inst.adminEmail)}</span>` : ''}
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 text-[11px] font-extrabold shrink-0">
              ${escapeHtml(inst.planName || 'Standard')}
            </span>
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
  renderKpis();
  renderInstitutionsGrid();
};

const openInstitutionModal = (mode = 'create', inst = null) => {
  const modal = document.getElementById('inst-form-modal');
  const form = document.getElementById('inst-form');
  const errorBox = document.getElementById('inst-form-error');
  if (!modal || !form) return;

  form.reset();
  if (errorBox) {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  document.getElementById('inst-form-mode').value = mode;
  const slugEl = document.getElementById('inst-slug');
  const passWrap = document.getElementById('inst-admin-password-wrap');
  const resetBtn = document.getElementById('btn-send-admin-reset');
  const editStatusWrap = document.getElementById('inst-edit-status-wrap');

  if (mode === 'edit' && inst) {
    document.getElementById('inst-modal-title').textContent = `Edit Institution: ${inst.name || inst.slug}`;
    document.getElementById('inst-modal-subtitle').textContent = 'Update details, allowed modules, admin account email, or subscription validity.';
    document.getElementById('inst-name').value = inst.name || '';
    slugEl.value = inst.slug || inst.id || '';
    slugEl.readOnly = true;
    slugEl.classList.add('bg-slate-100', 'text-slate-500');
    document.getElementById('inst-place').value = inst.place || '';
    document.getElementById('inst-phone').value = inst.phone || '';
    document.getElementById('inst-admin-name').value = inst.adminName || 'Master Admin';
    document.getElementById('inst-admin-email').value = inst.adminEmail || '';
    passWrap?.classList.add('hidden');
    document.getElementById('inst-admin-password').required = false;
    resetBtn?.classList.toggle('hidden', !inst.adminEmail);
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
    document.getElementById('inst-modal-subtitle').textContent = 'Provisions institution workspace, Firebase Auth admin user, and subscription rules automatically.';
    slugEl.readOnly = false;
    slugEl.classList.remove('bg-slate-100', 'text-slate-500');
    const todayStr = toIsoDateInput();
    document.getElementById('inst-start-date').value = todayStr;
    document.getElementById('inst-duration-months').value = '12';
    document.getElementById('inst-expiry-date').value = addMonthsToDateStr(todayStr, 12);
    document.getElementById('inst-is-lifetime').checked = false;
    document.getElementById('inst-link-existing-auth').checked = false;
    passWrap?.classList.remove('hidden');
    document.getElementById('inst-admin-password').required = true;
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

const provisionAdminAuthUser = async (email, password) => {
  const appName = `SecondaryProvisioner_${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    await createUserWithEmailAndPassword(secondaryAuth, email, password);
    try { await firebaseSignOut(secondaryAuth); } catch (_) {}
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
  const adminEmail = String(document.getElementById('inst-admin-email').value || '').trim().toLowerCase();
  const adminPassword = String(document.getElementById('inst-admin-password').value || '');
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
  if (!slug) return showFormError('Valid URL Slug is required (letters, numbers, hyphen).');
  if (RESERVED_INSTITUTION_SLUGS.has(slug)) return showFormError(`"${slug}" is reserved by the system. Please choose another slug.`);
  if (!adminEmail || !adminEmail.includes('@')) return showFormError('Valid Super Admin email is required.');
  if (!isLifetime && !expiryDate) return showFormError('Please select an Expiry Date or enable Lifetime Access.');

  const saveBtn = document.getElementById('btn-save-inst');
  const originalHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';

  try {
    const expiryTimestamp = isLifetime ? null : toExpiryTimestamp(expiryDate);

    if (mode === 'create') {
      const existingSnap = await getDoc(doc(db, INSTITUTIONS_COLLECTION, slug));
      if (existingSnap.exists()) {
        throw new Error(`Slug "/${slug}" is already taken by another institution.`);
      }
      if (!linkExistingAuth) {
        if (!adminPassword || adminPassword.length < 6) {
          throw new Error('Initial Admin Password must be at least 6 characters (or check "Account already exists in Firebase Auth").');
        }
        try {
          await provisionAdminAuthUser(adminEmail, adminPassword);
        } catch (authErr) {
          if (authErr?.code === 'auth/email-already-in-use') {
            throw new Error(`Email "${adminEmail}" already exists in Firebase Auth. Check "Account already exists in Firebase Auth" above to link it without creating a duplicate.`);
          }
          throw authErr;
        }
      }

      const batch = writeBatch(db);
      batch.set(doc(db, INSTITUTIONS_COLLECTION, slug), {
        slug,
        name,
        place,
        phone,
        adminName,
        adminEmail,
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
        adminsIndex: { [adminEmail]: true },
        admins: [
          {
            name: adminName,
            email: adminEmail,
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
          email: adminEmail
        },
        updatedAt: serverTimestamp()
      });

      await batch.commit();
      showToast(`Created /${slug} successfully!`);
    } else {
      const status = document.getElementById('inst-status-select').value === 'paused' ? 'paused' : 'active';
      const pauseReason = status === 'paused' ? String(document.getElementById('inst-pause-reason').value || '').trim() : '';

      const batch = writeBatch(db);
      batch.update(doc(db, INSTITUTIONS_COLLECTION, slug), {
        name,
        place,
        phone,
        adminName,
        adminEmail,
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
        adminsIndex: { [adminEmail]: true },
        admins: [
          {
            name: adminName,
            email: adminEmail,
            role: 'super_admin',
            isActive: true
          }
        ],
        updatedAt: serverTimestamp()
      }, { merge: true });

      await batch.commit();
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
    const configSnap = await getDoc(doc(db, COMPANY_COLLECTION, COMPANY_CONFIG_DOC_ID));
    if (!configSnap.exists()) return false;
    const data = configSnap.data() || {};
    const ownersList = Array.isArray(data.owners) ? data.owners : [];
    const isOwner = String(data.email || '').trim().toLowerCase() === email
      || data.ownersIndex?.[email] === true
      || ownersList.some((o) => String(o?.email || '').trim().toLowerCase() === email && o?.isActive !== false);
    if (!isOwner) return false;

    verifiedCompanyOwnerEmail = email;
    const brandTitle = document.getElementById('company-brand-title');
    const ownerEmailEl = document.getElementById('company-owner-email');
    if (brandTitle) brandTitle.textContent = data.companyName || 'Company Master Portal';
    if (ownerEmailEl) ownerEmailEl.textContent = `${email} • Project: ${firebaseConfig.projectId}`;
    window.AppSession?.startCompany?.({
      name: ownersList.find((o) => String(o?.email || '').toLowerCase() === email)?.name || 'Company Owner',
      email,
      companyName: data.companyName || 'Company Master Portal'
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

  document.getElementById('inst-name')?.addEventListener('input', (e) => {
    if (document.getElementById('inst-form-mode').value !== 'create') return;
    const slugEl = document.getElementById('inst-slug');
    if (slugEl && !slugEl.dataset.userEdited) {
      slugEl.value = sanitizeSlugInput(e.target.value);
      updateSlugPreview();
    }
  });
  document.getElementById('inst-slug')?.addEventListener('input', (e) => {
    e.target.dataset.userEdited = 'true';
    updateSlugPreview();
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
      pwd.disabled = e.target.checked;
      pwd.required = !e.target.checked && document.getElementById('inst-form-mode').value === 'create';
      if (e.target.checked) pwd.value = '';
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
    if (!email) return;
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
