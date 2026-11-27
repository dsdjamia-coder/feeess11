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
  onAuthStateChanged,
  signOut as firebaseSignOut
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { auth, db, functions, firebaseConfig } from '../../config/firebase-config.js';
import {
  BASIC_PLAN_ALLOWED_PAGES,
  COMPANY_COLLECTION,
  COMPANY_CONFIG_DOC_ID,
  COMPANY_PUBLIC_CATALOG_DOC_ID,
  COMPANY_SHOWCASES_SUBCOLLECTION,
  DEFAULT_BASIC_PLAN_LIMITS,
  DEFAULT_COMPANY_ALLOWED_PAGES,
  DEFAULT_FREE_PLAN_LIMITS,
  DEFAULT_STANDARD_PLAN_LIMITS,
  DEFAULT_TRIAL_DAYS,
  ELITE_PLAN_ALLOWED_PAGES,
  FREE_PLAN_ALLOWED_PAGES,
  INSTITUTIONS_COLLECTION,
  PLAN_CATALOG_FEATURE_PRESETS,
  PLATFORM_SHOWCASE_PAGES,
  RESERVED_INSTITUTION_SLUGS,
  STANDARD_PLAN_ALLOWED_PAGES,
  UPGRADE_REQUESTS_COLLECTION,
  extractInternalUsername,
  isInternalStaffEmail
} from '../../config/app-config.js';
import {
  escapeHtml,
  formatDateDisplay,
  normalizePlanTier,
  openConfirmDialog,
  registerServiceWorker,
  resolveInstitutionPlan
} from '../shared/app-common.js';
import {
  buildDefaultSubscriptionPlans,
  fetchCompanyPublicCatalog,
  inferPlanTierKey,
  invalidatePublicCatalogCache,
  normalizePublicCatalog,
  openPlanFullDetailsModal,
  openPremiumPlansModal
} from '../shared/premium-plans-modal.js';
import {
  DEFAULT_FOOTER_CONFIG,
  DEFAULT_LEGAL_DOCS,
  invalidateCompanyFooterCache,
  mountUnifiedFooter,
  normalizeFooterConfig,
  normalizeLegalDocs,
  openLegalInfoModal
} from '../shared/site-footer.js';
import {
  buildSuperAdminUid,
  normalizePhoneToE164Client,
  upsertInstitutionSuperAdminCredential,
  validateCustomUsername
} from '../shared/custom-auth-service.js';
import {
  MEDIA_PRESETS,
  deleteStorageUrlIfManaged,
  uploadImageToStorage,
  uploadShowcaseVideoToStorage
} from '../shared/storage-media-service.js';

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

const COMPANY_VIEWS = {
  dashboard: {
    elId: 'view-dashboard',
    title: 'Dashboard',
    subtitle: 'Platform overview, quick actions, and subscription health.'
  },
  'add-institution': {
    elId: 'view-add-institution',
    title: 'Add Institution',
    subtitle: 'Provision a new institution workspace, URL slug, and admin credentials.'
  },
  institutions: {
    elId: 'view-institutions',
    title: 'Institutions',
    subtitle: 'Search, verify, manage credentials, plan tiers, modules, extend, or pause portals.'
  },
  'upgrade-requests': {
    elId: 'view-upgrade-requests',
    title: 'Upgrade Requests',
    subtitle: 'Review Basic Free Plan upgrade enquiries and approve Premium upgrades in 1 click.'
  },
  plans: {
    elId: 'view-plans',
    title: 'Premium Plans & Offers',
    subtitle: 'Configure self-signup defaults, promotional offer banner, and custom pricing plans.'
  },
  contact: {
    elId: 'view-contact',
    title: 'Contact & OTP Security',
    subtitle: 'Manage Company Owner 2-Step SMS OTP mobile and public WhatsApp/call support channels.'
  },
  screenshots: {
    elId: 'view-screenshots',
    title: 'Platform Screenshots & Videos',
    subtitle: 'Upload up to 5 showcase images or HD videos per module for the Root Public Gateway.'
  },
  'footer-legal': {
    elId: 'view-footer-legal',
    title: 'Footer & Legal',
    subtitle: 'Configure unified platform footer branding, copyright, and Terms, Privacy, and Security modal policies.'
  }
};

const MAX_SHOWCASE_IMAGES_PER_PAGE = 5;
const ALLOWED_SHOWCASE_KEY_SET = new Set(PLATFORM_SHOWCASE_PAGES.map((p) => p.key));

let allInstitutions = [];
let allUpgradeRequests = [];
let pendingPauseTarget = null;
let verifiedCompanyOwnerEmail = '';
let activeCompanyView = 'dashboard';
let catalogState = normalizePublicCatalog({});
let legalDraftState = normalizeLegalDocs({});
let activeLegalTabKey = 'terms';
let platformShowcasesMap = new Map();
const showcaseBusyPages = new Set();
const showcaseBusyStatusMap = new Map();

const showToast = (message, tone = 'success') => {
  const el = document.getElementById('company-toast');
  if (!el) return;
  const tones = {
    success: 'bg-emerald-900 text-emerald-50 border-emerald-700',
    error: 'bg-rose-900 text-rose-50 border-rose-700',
    info: 'bg-slate-900 text-slate-50 border-slate-700'
  };
  el.className = `fixed bottom-20 md:bottom-5 right-4 md:right-5 z-[11000] max-w-sm rounded-2xl px-4 py-3 shadow-2xl border text-xs font-bold flex items-center gap-2.5 ${tones[tone] || tones.info}`;
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

const formatPriceNumber = (value = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '0';
  const hasFractions = num % 1 !== 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: hasFractions ? 2 : 0,
    maximumFractionDigits: hasFractions ? 2 : 0
  });
};

// Fix minor guard in parseSuperAdminLoginInput for non-email usernames
const validateUsernameStrict = (clean = '') => /^[a-z0-9._-]{3,60}$/.test(clean);

const STORAGE_KEY_SIDEBAR_COLLAPSED = 'company_sidebar_collapsed';
const STORAGE_KEY_ACTIVE_VIEW = 'company_active_view';

const applyCompanySidebarCollapsed = (collapsed = false, persist = true) => {
  const sidebar = document.getElementById('company-sidebar');
  const toggleIcon = document.getElementById('company-sidebar-toggle-icon');
  const toggleBtn = document.getElementById('btn-open-company-sidebar');
  const isCollapsed = Boolean(collapsed);

  if (sidebar) {
    sidebar.setAttribute('data-collapsed', isCollapsed ? 'true' : 'false');
  }
  if (toggleIcon) {
    toggleIcon.className = isCollapsed ? 'fas fa-angles-right text-xs' : 'fas fa-bars text-xs';
  }
  if (toggleBtn) {
    toggleBtn.title = isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY_SIDEBAR_COLLAPSED, isCollapsed ? '1' : '0');
    } catch (_) {}
  }
};

const toggleCompanySidebar = () => {
  const sidebar = document.getElementById('company-sidebar');
  const currentlyCollapsed = sidebar?.getAttribute('data-collapsed') === 'true';
  applyCompanySidebarCollapsed(!currentlyCollapsed, true);
};

const restoreCompanySidebarState = () => {
  let savedCollapsed = false;
  try {
    savedCollapsed = localStorage.getItem(STORAGE_KEY_SIDEBAR_COLLAPSED) === '1';
  } catch (_) {}
  applyCompanySidebarCollapsed(savedCollapsed, false);
};

const getSavedCompanyView = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_VIEW) || 'dashboard';
    return COMPANY_VIEWS[saved] ? saved : 'dashboard';
  } catch (_) {
    return 'dashboard';
  }
};

const MORE_SHEET_VIEWS = new Set(['plans', 'contact', 'footer-legal']);

const closeCompanyMobileMoreSheet = () => {
  const sheet = document.getElementById('company-mobile-more-sheet');
  const trigger = document.getElementById('btn-company-mobile-more');
  if (sheet) {
    sheet.classList.add('hidden');
    sheet.classList.remove('flex');
  }
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
};

const openCompanyMobileMoreSheet = () => {
  const sheet = document.getElementById('company-mobile-more-sheet');
  const trigger = document.getElementById('btn-company-mobile-more');
  if (sheet) {
    sheet.classList.remove('hidden');
    sheet.classList.add('flex');
  }
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
};

const setActiveCompanyView = (viewKey = 'dashboard') => {
  const targetKey = COMPANY_VIEWS[viewKey] ? viewKey : 'dashboard';
  activeCompanyView = targetKey;
  const meta = COMPANY_VIEWS[targetKey];

  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_VIEW, targetKey);
  } catch (_) {}

  Object.entries(COMPANY_VIEWS).forEach(([key, cfg]) => {
    const section = document.getElementById(cfg.elId);
    if (section) section.classList.toggle('hidden', key !== targetKey);
  });

  document.querySelectorAll('.company-nav-btn[data-company-view]').forEach((btn) => {
    const isActive = btn.dataset.companyView === targetKey;
    btn.className = isActive
      ? 'company-nav-btn w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer text-left bg-indigo-50 text-indigo-700 border border-indigo-200'
      : 'company-nav-btn w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer text-left text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent';
  });

  // Sync mobile bottom navigation active state
  document.querySelectorAll('.company-bottom-nav-btn[data-company-view]').forEach((btn) => {
    const isActive = btn.dataset.companyView === targetKey;
    btn.className = isActive
      ? 'company-bottom-nav-btn flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[10px] font-extrabold text-indigo-700 bg-indigo-50 cursor-pointer transition'
      : 'company-bottom-nav-btn flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer transition';
  });
  const moreBtn = document.getElementById('btn-company-mobile-more');
  if (moreBtn) {
    const moreActive = MORE_SHEET_VIEWS.has(targetKey);
    moreBtn.className = moreActive
      ? 'company-bottom-nav-btn flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[10px] font-extrabold text-indigo-700 bg-indigo-50 cursor-pointer transition'
      : 'company-bottom-nav-btn flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer transition';
  }
  document.querySelectorAll('.company-more-nav-btn[data-company-view]').forEach((btn) => {
    const isActive = btn.dataset.companyView === targetKey;
    btn.className = isActive
      ? 'company-more-nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200 cursor-pointer text-left'
      : 'company-more-nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 border border-transparent cursor-pointer text-left';
  });
  closeCompanyMobileMoreSheet();

  const titleEl = document.getElementById('company-view-title');
  const subtitleEl = document.getElementById('company-view-subtitle');
  if (titleEl) titleEl.textContent = meta.title;
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;
  window.scrollTo({ top: 0, behavior: 'instant' });
};

const updateSlugPreviewFor = (inputId, previewId) => {
  const slugInput = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
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

const updateSlugPreview = () => updateSlugPreviewFor('inst-slug', 'inst-slug-preview');

const renderAllowedPagesCheckboxesInto = (containerId, checkboxClass, selectedMap = DEFAULT_COMPANY_ALLOWED_PAGES, isCompact = false) => {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = PAGE_DEFINITIONS.map((item) => {
    const isChecked = selectedMap?.[item.key] !== false;
    if (isCompact) {
      return `
        <label class="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-indigo-50/50 hover:border-indigo-200 cursor-pointer transition">
          <input type="checkbox" class="rounded border-slate-300 text-indigo-600 shrink-0 ${checkboxClass}" data-page-key="${escapeHtml(item.key)}" ${isChecked ? 'checked' : ''}>
          <div class="min-w-0">
            <div class="text-[11px] font-extrabold text-slate-800 truncate">${escapeHtml(item.label)}</div>
            <div class="text-[10px] text-slate-500 truncate">${escapeHtml(item.desc)}</div>
          </div>
        </label>
      `;
    }
    return `
      <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50/50 hover:border-indigo-200 cursor-pointer transition">
        <input type="checkbox" class="mt-0.5 rounded border-slate-300 text-indigo-600 ${checkboxClass}" data-page-key="${escapeHtml(item.key)}" ${isChecked ? 'checked' : ''}>
        <div class="min-w-0">
          <div class="text-xs font-extrabold text-slate-800">${escapeHtml(item.label)}</div>
          <div class="text-[11px] text-slate-500 leading-snug">${escapeHtml(item.desc)}</div>
        </div>
      </label>
    `;
  }).join('');
};

const renderAllowedPagesCheckboxes = (selectedMap = DEFAULT_COMPANY_ALLOWED_PAGES) => {
  renderAllowedPagesCheckboxesInto('inst-allowed-pages-grid', 'inst-page-checkbox', selectedMap, false);
};

const readAllowedPagesFromCheckboxes = (checkboxClass = 'inst-page-checkbox') => {
  const result = { ...DEFAULT_COMPANY_ALLOWED_PAGES };
  document.querySelectorAll(`.${checkboxClass}`).forEach((cb) => {
    const key = cb.dataset.pageKey;
    if (key) result[key] = cb.checked;
  });
  return result;
};

const syncLifetimeInputsFor = (prefix = 'inst') => {
  const isLifetime = document.getElementById(`${prefix}-is-lifetime`)?.checked === true;
  const durEl = document.getElementById(`${prefix}-duration-months`);
  const startEl = document.getElementById(`${prefix}-start-date`);
  const expEl = document.getElementById(`${prefix}-expiry-date`);
  if (durEl) durEl.disabled = isLifetime;
  if (expEl) {
    expEl.disabled = isLifetime;
    if (isLifetime) expEl.value = '';
    else if (!expEl.value && startEl?.value && durEl && Number(durEl.value) > 0) {
      expEl.value = addMonthsToDateStr(startEl.value, Number(durEl.value));
    }
  }
};

const syncLifetimeInputs = () => syncLifetimeInputsFor('inst');

const initAddInstitutionPageForm = () => {
  const form = document.getElementById('add-inst-page-form');
  if (!form) return;
  form.reset();
  const errorBox = document.getElementById('add-inst-form-error');
  if (errorBox) {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }
  const pwdEl = document.getElementById('add-inst-admin-password');
  const eyeEl = document.getElementById('add-inst-pass-eye');
  if (pwdEl) {
    pwdEl.type = 'password';
    pwdEl.required = true;
  }
  if (eyeEl) eyeEl.className = 'fas fa-eye text-[11px]';

  const todayStr = toIsoDateInput();
  const startEl = document.getElementById('add-inst-start-date');
  const durEl = document.getElementById('add-inst-duration-months');
  const expEl = document.getElementById('add-inst-expiry-date');
  const lifetimeEl = document.getElementById('add-inst-is-lifetime');
  if (startEl) startEl.value = todayStr;
  if (durEl) durEl.value = '12';
  if (expEl) expEl.value = addMonthsToDateStr(todayStr, 12);
  if (lifetimeEl) lifetimeEl.checked = false;

  renderAllowedPagesCheckboxesInto('add-inst-allowed-pages-grid', 'add-inst-page-checkbox', DEFAULT_COMPANY_ALLOWED_PAGES, true);
  syncLifetimeInputsFor('add-inst');
  updateSlugPreviewFor('add-inst-slug', 'add-inst-slug-preview');
};

const renderKpis = () => {
  const total = allInstitutions.length;
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

  const kpiTotal = document.getElementById('kpi-total');
  const kpiActive = document.getElementById('kpi-active');
  const kpiPaused = document.getElementById('kpi-paused');
  const kpiExpired = document.getElementById('kpi-expired');
  const sidebarCount = document.getElementById('sidebar-inst-count');
  if (kpiTotal) kpiTotal.textContent = String(total);
  if (kpiActive) kpiActive.textContent = String(active);
  if (kpiPaused) kpiPaused.textContent = String(paused);
  if (kpiExpired) kpiExpired.textContent = String(expired);
  if (sidebarCount) sidebarCount.textContent = String(total);
};

const renderDashboardOverview = () => {
  const container = document.getElementById('dashboard-institutions-overview');
  if (!container) return;

  const activePlansCount = (catalogState.plans || []).filter((p) => p.isActive !== false).length;
  const totalPlansCount = (catalogState.plans || []).length;
  const plansSummaryEl = document.getElementById('dash-plans-summary');
  const sidebarPlansCount = document.getElementById('sidebar-plans-count');
  if (plansSummaryEl) {
    plansSummaryEl.textContent = totalPlansCount
      ? `${activePlansCount} visible (${totalPlansCount} total) custom plans`
      : 'No plans configured yet — click to add';
  }
  if (sidebarPlansCount) sidebarPlansCount.textContent = String(totalPlansCount);

  const contact = catalogState.contact || {};
  const configuredChannels = [
    contact.whatsapp ? 'WhatsApp' : '',
    contact.instagram ? 'Instagram' : '',
    contact.phone ? 'Phone' : '',
    contact.email ? 'Email' : '',
    contact.website ? 'Website' : ''
  ].filter(Boolean);
  const contactSummaryEl = document.getElementById('dash-contact-summary');
  if (contactSummaryEl) {
    contactSummaryEl.textContent = configuredChannels.length
      ? `Active channels: ${configuredChannels.join(', ')}`
      : 'Configure WhatsApp, Instagram, Phone & Email';
  }

  if (!allInstitutions.length) {
    container.innerHTML = `
      <div class="p-6 text-center space-y-2">
        <p class="text-xs font-bold text-slate-700">No institutions provisioned yet.</p>
        <button type="button" id="btn-dash-empty-add" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5">
          <i class="fas fa-plus"></i><span>Provision Institution</span>
        </button>
      </div>
    `;
    document.getElementById('btn-dash-empty-add')?.addEventListener('click', () => setActiveCompanyView('add-institution'));
    return;
  }

  const priorityRank = { expired: 0, expiring: 1, paused: 2, active: 3 };
  const sorted = [...allInstitutions]
    .sort((a, b) => {
      const sa = classifyInstitutionState(a);
      const sb = classifyInstitutionState(b);
      const ra = priorityRank[sa.code] ?? 9;
      const rb = priorityRank[sb.code] ?? 9;
      if (ra !== rb) return ra - rb;
      return String(a.name || a.slug).localeCompare(String(b.name || b.slug));
    })
    .slice(0, 8);

  container.innerHTML = `
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="bg-slate-50 border-b border-slate-200 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
          <th class="py-2.5 pl-4 pr-2 w-10 text-center">#</th>
          <th class="py-2.5 px-3">Institution &amp; URL</th>
          <th class="py-2.5 px-3">Plan &amp; Validity</th>
          <th class="py-2.5 px-3 text-center">Pages</th>
          <th class="py-2.5 pl-3 pr-4 text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100 text-xs">
        ${sorted.map((inst, idx) => {
          const slug = String(inst.slug || inst.id || '').trim().toLowerCase();
          const state = classifyInstitutionState(inst);
          const badgeClass = state.code === 'paused'
            ? 'bg-amber-100 text-amber-800 border-amber-200'
            : state.code === 'expired'
              ? 'bg-rose-100 text-rose-800 border-rose-200'
              : state.code === 'expiring'
                ? 'bg-orange-100 text-orange-800 border-orange-200'
                : 'bg-emerald-100 text-emerald-800 border-emerald-200';
          const pages = { ...DEFAULT_COMPANY_ALLOWED_PAGES, ...(inst.allowedPages || {}) };
          const enabledCount = PAGE_DEFINITIONS.filter((p) => pages[p.key] !== false).length;
          const expiryShort = inst.isLifetime
            ? 'Lifetime Validity'
            : (inst.expiryDate ? `Exp: ${formatDateDisplay(inst.expiryDate)}` : 'No Expiry Date');

          return `
            <tr class="hover:bg-slate-50/80 transition align-top">
              <td class="py-2.5 pl-4 pr-2 text-center font-extrabold text-slate-400 tabular-nums">${idx + 1}</td>
              <td class="py-2.5 px-3 min-w-[160px]">
                <div class="font-extrabold text-slate-900 truncate max-w-[200px]">${escapeHtml(inst.name || slug)}</div>
                <div class="font-mono text-[11px] font-bold text-indigo-600 truncate">/${escapeHtml(slug)}</div>
              </td>
              <td class="py-2.5 px-3">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-extrabold">${escapeHtml(inst.planName || 'Standard')}</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${badgeClass}">${escapeHtml(state.label)}</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-1">${escapeHtml(expiryShort)}</div>
              </td>
              <td class="py-2.5 px-3 text-center whitespace-nowrap">
                <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-extrabold text-[11px] tabular-nums">${enabledCount}/${PAGE_DEFINITIONS.length}</span>
              </td>
              <td class="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">
                <div class="inline-flex flex-col items-stretch gap-1 w-24">
                  <button type="button" class="btn-dash-edit-inst px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer text-center" data-slug="${escapeHtml(slug)}">
                    Edit
                  </button>
                  ${state.code === 'paused'
                    ? `<button type="button" class="btn-dash-resume-inst px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer text-center" data-slug="${escapeHtml(slug)}">Continue</button>`
                    : `<a href="/${escapeHtml(slug)}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold text-center">Open</a>`}
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('.btn-dash-edit-inst').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inst = allInstitutions.find((i) => (i.slug || i.id) === btn.dataset.slug);
      if (inst) openInstitutionModal('edit', inst);
    });
  });
  container.querySelectorAll('.btn-dash-resume-inst').forEach((btn) => {
    btn.addEventListener('click', () => handleResumeInstitution(btn.dataset.slug));
  });
};

const renderInstitutionsGrid = () => {
  const grid = document.getElementById('institutions-grid');
  if (!grid) return;

  const queryText = String(document.getElementById('inst-search-input')?.value || '').trim().toLowerCase();
  const statusFilter = String(document.getElementById('inst-status-filter')?.value || 'all').toLowerCase();

  const filtered = allInstitutions.filter((inst) => {
    const state = classifyInstitutionState(inst);
    const resolved = resolveInstitutionPlan(inst);
    const baseTier = resolved.basePlanTier;
    const isSelfSignup = String(inst.signupSource || '').trim().toLowerCase() === 'self_signup';
    const verStatus = String(inst.verificationStatus || (isSelfSignup ? 'unverified' : 'verified')).trim().toLowerCase();

    if ((statusFilter === 'free' || statusFilter === 'basic') && baseTier !== 'free') return false;
    if (statusFilter === 'trial' && !resolved.isTrialActive) return false;
    if (statusFilter === 'standard' && baseTier !== 'standard') return false;
    if ((statusFilter === 'elite' || statusFilter === 'premium') && baseTier !== 'elite') return false;
    if (statusFilter === 'self_signup' && !isSelfSignup) return false;
    if (statusFilter === 'unverified' && verStatus !== 'unverified') return false;
    if (statusFilter === 'active' && state.code !== 'active' && state.code !== 'expiring') return false;
    if (statusFilter === 'paused' && state.code !== 'paused') return false;
    if (statusFilter === 'expired' && state.code !== 'expired') return false;
    if (statusFilter === 'expiring' && state.code !== 'expiring' && state.code !== 'expired') return false;

    if (queryText) {
      const haystack = `${inst.name || ''} ${inst.slug || ''} ${inst.place || ''} ${inst.adminEmail || ''} ${inst.adminUsername || ''} ${inst.adminLoginDisplay || ''}`.toLowerCase();
      if (!haystack.includes(queryText)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="p-10 text-center">
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
    document.getElementById('btn-empty-add-inst')?.addEventListener('click', () => setActiveCompanyView('add-institution'));
    return;
  }

  const origin = window.location.origin || '';
  grid.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
            <th class="py-3 pl-4 pr-2 w-12 text-center">#</th>
            <th class="py-3 px-3 min-w-[210px]">Institution &amp; URL</th>
            <th class="py-3 px-3 min-w-[230px]">Super Admin Credentials</th>
            <th class="py-3 px-3 min-w-[200px]">Plan &amp; Validity</th>
            <th class="py-3 px-3 min-w-[140px]">Pages / Modules</th>
            <th class="py-3 pl-3 pr-4 text-right min-w-[145px]">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200 text-xs">
          ${filtered.map((inst, idx) => {
            const slug = String(inst.slug || inst.id || '').trim().toLowerCase();
            const state = classifyInstitutionState(inst);
            const resolved = resolveInstitutionPlan(inst);
            const baseTier = resolved.basePlanTier;
            const cleanUrl = `${origin}/${slug}`;
            const pages = resolved.allowedPages || { ...DEFAULT_COMPANY_ALLOWED_PAGES, ...(inst.allowedPages || {}) };
            const enabledPages = PAGE_DEFINITIONS.filter((p) => pages[p.key] !== false);
            const disabledPages = PAGE_DEFINITIONS.filter((p) => pages[p.key] === false);
            const enabledCount = enabledPages.length;
            const isPaused = state.code === 'paused';

            const badgeClasses = isPaused
              ? 'bg-amber-100 text-amber-800 border-amber-200'
              : state.code === 'expired'
                ? 'bg-rose-100 text-rose-800 border-rose-200'
                : state.code === 'expiring'
                  ? 'bg-orange-100 text-orange-800 border-orange-200'
                  : 'bg-emerald-100 text-emerald-800 border-emerald-200';

            const tierBadgeHtml = baseTier === 'free'
              ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold"><i class="fas fa-seedling text-[9px]"></i>Free</span>`
              : baseTier === 'standard'
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-extrabold"><i class="fas fa-layer-group text-[9px] text-indigo-600"></i>Standard</span>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-900 text-white border border-slate-800 text-[10px] font-extrabold"><i class="fas fa-crown text-[9px] text-amber-400"></i>ELITE</span>`;

            const expiryLabel = baseTier === 'free'
              ? (resolved.isTrialActive ? `Standard Trial: ${resolved.trialRemainingLabel}` : 'Free Forever (1 Academic Yr)')
              : inst.isLifetime
                ? 'Lifetime Validity'
                : (inst.expiryDate ? `Expires: ${formatDateDisplay(inst.expiryDate)}` : 'No Expiry Date');

            const loginDisplay = inst.adminDisplayUsername || inst.adminUsername || inst.adminLoginDisplay || inst.adminEmail || '--';

            return `
              <tr class="inst-table-row hover:bg-slate-50/80 transition align-top">
                <!-- 1. Serial Number -->
                <td class="py-3.5 pl-4 pr-2 text-center font-extrabold text-slate-400 tabular-nums">
                  ${idx + 1}
                </td>

                <!-- 2. Institution & URL -->
                <td class="py-3.5 px-3">
                  <div class="font-extrabold text-slate-900 text-xs sm:text-sm leading-snug">${escapeHtml(inst.name || slug)}</div>
                  <div class="flex items-center gap-1.5 mt-1">
                    <a href="/${escapeHtml(slug)}" target="_blank" rel="noopener noreferrer" class="font-mono text-xs font-bold text-indigo-600 hover:underline truncate max-w-[160px]" title="Open /${escapeHtml(slug)}">/${escapeHtml(slug)}</a>
                    <button type="button" class="btn-copy-url w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-indigo-600 flex items-center justify-center cursor-pointer shrink-0" data-url="${escapeHtml(cleanUrl)}" title="Copy Portal URL">
                      <i class="fas fa-copy text-[10px]"></i>
                    </button>
                  </div>
                  ${(inst.place || inst.phone) ? `
                    <div class="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      ${inst.place ? `<span><i class="fas fa-location-dot mr-1 text-slate-400"></i>${escapeHtml(inst.place)}</span>` : ''}
                      ${inst.phone ? `<span><i class="fas fa-phone mr-1 text-slate-400"></i>${escapeHtml(inst.phone)}</span>` : ''}
                    </div>
                  ` : ''}
                </td>

                <!-- 3. Super Admin Credentials -->
                <td class="py-3.5 px-3">
                  <div class="rounded-xl bg-slate-50 border border-slate-200/90 p-2.5 space-y-1.5">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 truncate">
                        <i class="fas fa-user-shield mr-1 text-indigo-600"></i>${escapeHtml(inst.adminName || 'Master Admin')}
                      </span>
                      <button type="button" class="btn-edit-inst text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 cursor-pointer shrink-0" data-slug="${escapeHtml(slug)}" title="Edit Credentials">
                        <i class="fas fa-pen-to-square mr-0.5"></i>Edit
                      </button>
                    </div>
                    <div class="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1">
                      <div class="min-w-0 truncate">
                        <span class="text-[9px] font-bold text-slate-400 uppercase mr-1">User:</span>
                        <span class="font-mono font-bold text-slate-800 text-[11px]">${escapeHtml(loginDisplay)}</span>
                      </div>
                      <button type="button" class="btn-copy-admin-login w-6 h-6 rounded hover:bg-slate-100 text-slate-500 hover:text-indigo-600 shrink-0 flex items-center justify-center cursor-pointer" data-val="${escapeHtml(loginDisplay)}" title="Copy Username">
                        <i class="fas fa-copy text-[10px]"></i>
                      </button>
                    </div>
                    <div class="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1">
                      <div class="min-w-0 truncate">
                        <span class="text-[9px] font-bold text-slate-400 uppercase mr-1">Pass:</span>
                        <span class="text-[10px] font-semibold text-emerald-700"><i class="fas fa-lock mr-1 text-[9px]"></i>Encrypted • Edit to Reset</span>
                      </div>
                    </div>
                  </div>
                </td>

                <!-- 4. Plan & Validity (with 3-Tier, Trial, Source & Verification badges) -->
                <td class="py-3.5 px-3">
                  <div class="flex flex-wrap items-center gap-1.5">
                    ${tierBadgeHtml}
                    ${resolved.isTrialActive
                      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-extrabold"><i class="fas fa-sparkles text-[9px]"></i>Trial</span>`
                      : ''}
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold border whitespace-nowrap ${badgeClasses}">
                      ${escapeHtml(state.label)}
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5 mt-1">
                    ${String(inst.signupSource || '').toLowerCase() === 'self_signup'
                      ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[9px] font-extrabold uppercase">Self-Signup</span>`
                      : ''}
                    ${String(inst.verificationStatus || (inst.signupSource === 'self_signup' ? 'unverified' : 'verified')).toLowerCase() === 'verified'
                      ? `<button type="button" class="btn-toggle-verify inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-extrabold cursor-pointer" data-slug="${escapeHtml(slug)}" data-next="unverified" title="Click to mark Unverified"><i class="fas fa-badge-check text-[9px]"></i>Verified</button>`
                      : `<button type="button" class="btn-toggle-verify inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[9px] font-extrabold cursor-pointer" data-slug="${escapeHtml(slug)}" data-next="verified" title="Click to Verify Institution"><i class="fas fa-clock text-[9px]"></i>Unverified · Verify</button>`}
                  </div>
                  <div class="text-[11px] font-semibold ${resolved.isTrialActive ? 'text-indigo-700' : 'text-slate-600'} mt-1.5">
                    <i class="fas ${resolved.isTrialActive ? 'fa-hourglass-half text-indigo-500' : 'fa-calendar-days text-slate-400'} mr-1"></i>${escapeHtml(expiryLabel)}
                  </div>
                  ${isPaused && inst.pauseReason ? `
                    <div class="mt-1.5 text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 max-w-[200px] leading-snug">
                      ${escapeHtml(inst.pauseReason)}
                    </div>
                  ` : ''}
                </td>

                <!-- 5. Pages / Modules -->
                <td class="py-3.5 px-3">
                  <button type="button" class="btn-edit-inst text-left group cursor-pointer" data-slug="${escapeHtml(slug)}" title="Click to configure allowed pages">
                    <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 group-hover:bg-indigo-50 text-slate-800 group-hover:text-indigo-700 border border-slate-200 group-hover:border-indigo-200 text-[11px] font-extrabold tabular-nums transition">
                      <i class="fas fa-layer-group text-indigo-500 text-[10px]"></i>
                      <span>${enabledCount}/${PAGE_DEFINITIONS.length} Enabled</span>
                    </div>
                    <div class="text-[10px] text-slate-500 mt-1 max-w-[155px] truncate">
                      ${disabledPages.length === 0
                        ? '<span class="text-emerald-700 font-semibold">All modules unlocked</span>'
                        : `<span class="text-amber-700 font-semibold">${disabledPages.length} locked (${baseTier === 'standard' || resolved.isTrialActive ? 'ELITE' : 'Std/ELITE'})</span>`}
                    </div>
                  </button>
                </td>

                <!-- 6. Actions (Stacked one per line: Edit & Pages, Open, Pause/Continue) -->
                <td class="py-3.5 pl-3 pr-4 text-right">
                  <div class="inline-flex flex-col items-stretch gap-1.5 w-32">
                    <button type="button" class="btn-edit-inst w-full px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap" data-slug="${escapeHtml(slug)}">
                      <i class="fas fa-sliders text-[10px]"></i><span>Edit &amp; Pages</span>
                    </button>
                    <a href="/${escapeHtml(slug)}" target="_blank" rel="noopener noreferrer" class="w-full px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                      <i class="fas fa-arrow-up-right-from-square text-[10px]"></i><span>Open</span>
                    </a>
                    ${isPaused
                      ? `<button type="button" class="btn-resume-inst w-full px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap" data-slug="${escapeHtml(slug)}"><i class="fas fa-play text-[10px]"></i><span>Continue</span></button>`
                      : `<button type="button" class="btn-pause-inst w-full px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-extrabold cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap" data-slug="${escapeHtml(slug)}"><i class="fas fa-pause text-[10px]"></i><span>Pause</span></button>`}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  grid.querySelectorAll('.btn-toggle-verify').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const slug = btn.dataset.slug;
      const nextStatus = btn.dataset.next === 'verified' ? 'verified' : 'unverified';
      if (!slug) return;
      try {
        await updateDoc(doc(db, INSTITUTIONS_COLLECTION, slug), {
          verificationStatus: nextStatus,
          verifiedAt: nextStatus === 'verified' ? serverTimestamp() : null,
          updatedAt: serverTimestamp()
        });
        showToast(`Marked /${slug} as ${nextStatus === 'verified' ? 'Verified' : 'Unverified'}.`);
        await loadInstitutions();
      } catch (err) {
        showToast(`Failed to update verification status: ${err.message}`, 'error');
      }
    });
  });

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
      const row = btn.closest('.inst-table-row') || btn.closest('tr') || btn.closest('article');
      const display = row?.querySelector('.card-pass-display');
      const icon = btn.querySelector('i');
      if (!display) return;
      const isVisible = display.dataset.visible === 'true';
      if (isVisible) {
        display.textContent = '••••••••';
        display.dataset.visible = 'false';
        if (icon) icon.className = 'fas fa-eye text-[10px]';
      } else {
        display.textContent = display.dataset.pass || '';
        display.dataset.visible = 'true';
        if (icon) icon.className = 'fas fa-eye-slash text-[10px]';
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

  await Promise.all(
    allInstitutions.map(async (inst) => {
      const slug = String(inst.slug || inst.id || '').trim().toLowerCase();
      if (!slug) return;
      try {
        const authSnap = await getDoc(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'adminAuth'));
        if (authSnap.exists()) {
          const authData = authSnap.data() || {};
          if (authData.uid) inst.adminUid = authData.uid;
          if (authData.username) inst.adminUsername = authData.username;
          if (authData.displayUsername || authData.loginDisplay) {
            inst.adminLoginDisplay = authData.displayUsername || authData.loginDisplay;
          }
          if (authData.phone || authData.phoneE164) {
            inst.adminPhone = authData.phone || authData.phoneE164;
          }
          if (authData.authMode) inst.authMode = authData.authMode;
        }
      } catch (e) {
        console.warn(`AdminAuth sync notice for /${slug}:`, e);
      }
    })
  );

  renderKpis();
  renderDashboardOverview();
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
    document.getElementById('inst-modal-subtitle').textContent = 'Update details, allowed modules, Super Admin username, password, or subscription validity.';
    document.getElementById('inst-name').value = inst.name || '';
    slugEl.value = inst.slug || inst.id || '';
    slugEl.readOnly = true;
    slugEl.classList.add('bg-slate-100', 'text-slate-500');
    document.getElementById('inst-place').value = inst.place || '';
    document.getElementById('inst-phone').value = inst.phone || '';
    document.getElementById('inst-admin-name').value = inst.adminName || 'Master Admin';

    const displayLogin = inst.adminLoginDisplay
      || inst.adminUsername
      || (isInternalStaffEmail(inst.adminEmail || '') ? extractInternalUsername(inst.adminEmail || '') : (inst.adminEmail || ''));
    document.getElementById('inst-admin-email').value = displayLogin;
    const adminPhoneInput = document.getElementById('inst-admin-phone');
    if (adminPhoneInput) {
      adminPhoneInput.value = inst.adminPhone || inst.phone || '';
      adminPhoneInput.required = false;
    }

    if (passInput) {
      passInput.disabled = false;
      passInput.required = false;
      passInput.value = '';
      passInput.placeholder = 'Leave blank to keep current password, or enter new password';
    }
    if (passLabel) {
      passLabel.innerHTML = 'Set New Super Admin Password <span class="text-slate-400 font-normal">(Optional)</span>';
    }
    if (passHint) {
      passHint.textContent = 'Passwords are stored encrypted on the server. Enter a new password (min 6 characters) to reset it immediately.';
    }
    linkExistingWrap?.classList.add('hidden');
    resetBtn?.classList.add('hidden');

    editStatusWrap?.classList.remove('hidden');
    document.getElementById('inst-status-select').value = String(inst.status || 'active').toLowerCase() === 'paused' ? 'paused' : 'active';
    document.getElementById('inst-pause-reason').value = inst.pauseReason || '';

    const resolvedPlan = resolveInstitutionPlan(inst);
    const tierVal = resolvedPlan.basePlanTier; // 'free' | 'standard' | 'elite'
    const planLabelDefault = tierVal === 'free' ? 'Free' : (tierVal === 'standard' ? 'Standard' : 'ELITE');
    const planNameSelect = document.getElementById('inst-plan-name');
    if (planNameSelect) {
      const candidate = inst.planName || planLabelDefault;
      const hasOpt = Array.from(planNameSelect.options).some((o) => o.value === candidate);
      planNameSelect.value = hasOpt ? candidate : planLabelDefault;
    }
    document.getElementById('inst-is-lifetime').checked = inst.isLifetime === true;
    document.getElementById('inst-duration-months').value = String(inst.durationMonths ?? 0);
    document.getElementById('inst-start-date').value = inst.startDate || toIsoDateInput();
    document.getElementById('inst-expiry-date').value = inst.expiryDate || '';

    const tierSelect = document.getElementById('inst-plan-tier-select');
    if (tierSelect) tierSelect.value = tierVal;
    const verSelect = document.getElementById('inst-verification-select');
    if (verSelect) verSelect.value = String(inst.verificationStatus || (inst.signupSource === 'self_signup' ? 'unverified' : 'verified')).toLowerCase();

    const tierDefaultLimits = tierVal === 'standard'
      ? (catalogState?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS)
      : (catalogState?.selfSignupConfig?.defaultFreeLimits || DEFAULT_FREE_PLAN_LIMITS);
    const limits = { ...tierDefaultLimits, ...(inst.planLimits || {}) };
    const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v ?? ''); };
    setNum('inst-limit-students', limits.maxStudents);
    setNum('inst-limit-staff', limits.maxStaff);
    setNum('inst-limit-classes', limits.maxClasses);
    setNum('inst-limit-years', limits.maxAcademicYears);
    setNum('inst-limit-fee-items', limits.maxFeeItems);
    setNum('inst-limit-exams', limits.maxExamsPerYear);
    setNum('inst-limit-notices', limits.maxNotices);
    setNum('inst-limit-gallery', limits.maxGalleryPhotos);
    const limitsHeading = document.getElementById('inst-limits-heading');
    if (limitsHeading) {
      limitsHeading.textContent = tierVal === 'standard'
        ? 'Per-Institution Standard Plan Quota Overrides'
        : 'Per-Institution Free Plan Quota Overrides';
    }
    document.getElementById('inst-basic-limits-wrap')?.classList.toggle('hidden', tierVal === 'elite');

    const trialWrap = document.getElementById('inst-trial-control-wrap');
    const trialStatusText = document.getElementById('inst-trial-status-text');
    const extendTrialBtn = document.getElementById('btn-inst-extend-trial');
    const endTrialBtn = document.getElementById('btn-inst-end-trial');
    if (trialWrap) {
      trialWrap.classList.toggle('hidden', tierVal !== 'free');
      if (trialStatusText) {
        trialStatusText.textContent = resolvedPlan.isTrialActive
          ? `Active Standard Trial · ${resolvedPlan.trialRemainingLabel} (ends ${new Date(resolvedPlan.trialEndsAtMs).toLocaleString('en-IN')})`
          : (resolvedPlan.isTrialExpired
            ? 'Previous Standard trial has ended (currently on Free plan)'
            : 'No Standard trial active on this Free institution');
      }
      if (extendTrialBtn) extendTrialBtn.dataset.slug = inst.slug || inst.id || '';
      if (endTrialBtn) {
        endTrialBtn.dataset.slug = inst.slug || inst.id || '';
        endTrialBtn.classList.toggle('hidden', !resolvedPlan.isTrialActive);
      }
    }

    renderAllowedPagesCheckboxes({ ...DEFAULT_COMPANY_ALLOWED_PAGES, ...(inst.allowedPages || {}) });
  } else {
    document.getElementById('inst-modal-title').textContent = 'Add New Institution';
    document.getElementById('inst-modal-subtitle').textContent = 'Provisions institution workspace, globally unique Super Admin username, and subscription rules.';
    slugEl.readOnly = false;
    slugEl.value = '';
    slugEl.classList.remove('bg-slate-100', 'text-slate-500');
    const todayStr = toIsoDateInput();
    document.getElementById('inst-start-date').value = todayStr;
    document.getElementById('inst-duration-months').value = '12';
    document.getElementById('inst-expiry-date').value = addMonthsToDateStr(todayStr, 12);
    document.getElementById('inst-is-lifetime').checked = false;
    const planNameSelect = document.getElementById('inst-plan-name');
    if (planNameSelect) planNameSelect.value = 'ELITE';
    const tierSelect = document.getElementById('inst-plan-tier-select');
    if (tierSelect) tierSelect.value = 'elite';
    const verSelect = document.getElementById('inst-verification-select');
    if (verSelect) verSelect.value = 'verified';
    document.getElementById('inst-basic-limits-wrap')?.classList.add('hidden');
    document.getElementById('inst-trial-control-wrap')?.classList.add('hidden');
    linkExistingWrap?.classList.add('hidden');
    const adminPhoneInput = document.getElementById('inst-admin-phone');
    if (adminPhoneInput) {
      adminPhoneInput.value = '';
      adminPhoneInput.required = true;
    }
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
      passHint.textContent = 'Passwords are encrypted securely on the server. You can update the username or password at any time from this console.';
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

const showErrorInBox = (boxId, msg) => {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.textContent = msg;
  box.classList.remove('hidden');
};

const saveInstitutionData = async ({
  mode = 'create',
  name,
  slug,
  place,
  phone,
  adminName,
  rawAdminLogin,
  adminPhone = '',
  adminPassword,
  planTier = 'premium',
  planLimits = null,
  verificationStatus = 'verified',
  planName,
  isLifetime,
  durationMonths,
  startDate,
  expiryDate,
  status = 'active',
  pauseReason = '',
  allowedPages,
  errorBoxId,
  submitBtnId
}) => {
  const errorBox = document.getElementById(errorBoxId);
  if (errorBox) errorBox.classList.add('hidden');

  if (!name) {
    showErrorInBox(errorBoxId, 'Institution Name is required.');
    return false;
  }
  if (!slug) {
    showErrorInBox(errorBoxId, 'Valid Portal URL Slug is required (letters, numbers, hyphen).');
    return false;
  }
  if (RESERVED_INSTITUTION_SLUGS.has(slug)) {
    showErrorInBox(errorBoxId, `"${slug}" is reserved by the system. Please choose another slug.`);
    return false;
  }

  const parsedUsername = validateCustomUsername(rawAdminLogin);
  if (!parsedUsername.valid) {
    showErrorInBox(errorBoxId, parsedUsername.error || 'Please enter a valid Super Admin Username (no spaces).');
    return false;
  }
  const adminUsername = parsedUsername.username;
  const adminLoginDisplay = parsedUsername.displayUsername;

  if (!isLifetime && !expiryDate) {
    showErrorInBox(errorBoxId, 'Please select an Expiry Date or enable Lifetime Access.');
    return false;
  }

  if (mode === 'create' && (!adminPassword || adminPassword.length < 6)) {
    showErrorInBox(errorBoxId, 'Super Admin Password must be at least 6 characters.');
    return false;
  }
  if (mode === 'edit' && adminPassword && adminPassword.length < 6) {
    showErrorInBox(errorBoxId, 'Super Admin Password must be at least 6 characters.');
    return false;
  }

  const effectiveAdminPhoneRaw = String(adminPhone || '').trim();
  const normalizedAdminPhoneE164 = effectiveAdminPhoneRaw ? normalizePhoneToE164Client(effectiveAdminPhoneRaw) : '';
  if (mode === 'create' && !normalizedAdminPhoneE164) {
    showErrorInBox(errorBoxId, 'Please enter a valid Super Admin Mobile Number (for OTP 2FA).');
    return false;
  }
  if (effectiveAdminPhoneRaw && !normalizedAdminPhoneE164) {
    showErrorInBox(errorBoxId, 'Super Admin Mobile Number format is invalid. Use 10 digits or +91XXXXXXXXXX.');
    return false;
  }

  const saveBtn = document.getElementById(submitBtnId);
  const originalHtml = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
  }

  try {
    const expiryTimestamp = isLifetime ? null : toExpiryTimestamp(expiryDate);

    if (mode === 'create') {
      const existingSnap = await getDoc(doc(db, INSTITUTIONS_COLLECTION, slug));
      if (existingSnap.exists()) {
        throw new Error(`Portal URL Slug "/${slug}" is already taken by another institution.`);
      }
    }

    // 1. Provision or update Super Admin custom username, OTP phone & scrypt-hashed password via Cloud Function
    const credRes = await upsertInstitutionSuperAdminCredential({
      mode,
      slug,
      institutionName: name,
      adminName,
      username: adminLoginDisplay,
      password: adminPassword || '',
      phone: normalizedAdminPhoneE164 || effectiveAdminPhoneRaw
    });
    const adminUid = credRes?.uid || buildSuperAdminUid(slug);
    const savedAdminPhone = credRes?.phoneE164 || normalizedAdminPhoneE164 || effectiveAdminPhoneRaw;

    // 2. Persist institution metadata & public config (never storing plaintext passwords)
    const cleanTier = normalizePlanTier(planTier || 'elite'); // 'free' | 'standard' | 'elite'
    const cleanVer = String(verificationStatus || 'verified').trim().toLowerCase();
    const resolvedPlanName = cleanTier === 'free'
      ? 'Free'
      : cleanTier === 'standard'
        ? (isLifetime ? 'Standard Lifetime' : (planName && planName !== 'Free' ? planName : 'Standard'))
        : (isLifetime ? 'ELITE Lifetime' : (planName || 'ELITE'));
    const resolvedPlanLimits = cleanTier === 'elite'
      ? null
      : (planLimits || (cleanTier === 'standard'
        ? { ...(catalogState?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS) }
        : { ...(catalogState?.selfSignupConfig?.defaultFreeLimits || DEFAULT_FREE_PLAN_LIMITS) }));
    const clearTrialOnUpgrade = cleanTier !== 'free'
      ? { trialTier: '', trialEndsAtMs: 0, trialAllowedPages: null, trialPlanLimits: null }
      : {};

    const batch = writeBatch(db);
    if (mode === 'create') {
      batch.set(doc(db, INSTITUTIONS_COLLECTION, slug), {
        slug,
        name,
        place,
        phone,
        adminName,
        adminPhone: savedAdminPhone,
        adminUid,
        adminUsername,
        adminLoginDisplay,
        authMode: 'custom_token',
        status: 'active',
        isActive: true,
        pauseReason: '',
        planTier: cleanTier,
        planName: resolvedPlanName,
        planLimits: resolvedPlanLimits,
        signupSource: 'manual',
        verificationStatus: cleanVer,
        durationMonths: cleanTier === 'free' ? 0 : durationMonths,
        isLifetime: cleanTier === 'free' ? true : isLifetime,
        startDate,
        expiryDate: cleanTier === 'free' ? '' : expiryDate,
        expiryTimestamp: cleanTier === 'free' ? null : expiryTimestamp,
        allowedPages,
        createdBy: verifiedCompanyOwnerEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      batch.update(doc(db, INSTITUTIONS_COLLECTION, slug), {
        name,
        place,
        phone,
        adminName,
        ...(savedAdminPhone ? { adminPhone: savedAdminPhone } : {}),
        adminUid,
        adminUsername,
        adminLoginDisplay,
        authMode: 'custom_token',
        status,
        isActive: status === 'active',
        pauseReason,
        planTier: cleanTier,
        planName: resolvedPlanName,
        planLimits: resolvedPlanLimits,
        ...clearTrialOnUpgrade,
        verificationStatus: cleanVer,
        durationMonths: cleanTier === 'free' ? 0 : durationMonths,
        isLifetime: cleanTier === 'free' ? true : isLifetime,
        startDate,
        expiryDate: cleanTier === 'free' ? '' : expiryDate,
        expiryTimestamp: cleanTier === 'free' ? null : expiryTimestamp,
        allowedPages,
        updatedAt: serverTimestamp()
      });
    }

    batch.set(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'config'), {
      appName: name,
      place,
      contactPhone: phone,
      enabledModules: { ...allowedPages },
      adminProfile: {
        uid: adminUid,
        name: adminName,
        username: adminUsername,
        displayUsername: adminLoginDisplay,
        ...(savedAdminPhone ? { phone: savedAdminPhone } : {})
      },
      updatedAt: serverTimestamp()
    }, { merge: true });

    await batch.commit();

    showToast(
      mode === 'create'
        ? `Created /${slug} (Username: ${adminLoginDisplay}) successfully!`
        : `Updated /${slug} successfully!`
    );

    await loadInstitutions();
    return true;
  } catch (err) {
    console.error('Save institution error:', err);
    showErrorInBox(errorBoxId, err.message || 'Failed to save institution.');
    return false;
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalHtml;
    }
  }
};

const handleInstitutionSubmit = async (e) => {
  e.preventDefault();
  const mode = document.getElementById('inst-form-mode').value;
  const status = mode === 'edit'
    ? String(document.getElementById('inst-status-select').value || 'active').toLowerCase()
    : 'active';
  const pauseReason = mode === 'edit' && status === 'paused'
    ? String(document.getElementById('inst-pause-reason').value || '').trim()
    : '';

  const planTier = normalizePlanTier(document.getElementById('inst-plan-tier-select')?.value || 'elite');
  const verificationStatus = String(document.getElementById('inst-verification-select')?.value || 'verified').toLowerCase();
  const numVal = (id, fb) => {
    const n = Number(document.getElementById(id)?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fb;
  };
  const baseDefaults = planTier === 'standard'
    ? (catalogState?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS)
    : (catalogState?.selfSignupConfig?.defaultFreeLimits || DEFAULT_FREE_PLAN_LIMITS);
  const planLimits = planTier === 'elite' ? null : {
    ...baseDefaults,
    maxStudents: numVal('inst-limit-students', baseDefaults.maxStudents),
    maxStaff: numVal('inst-limit-staff', baseDefaults.maxStaff),
    maxClasses: numVal('inst-limit-classes', baseDefaults.maxClasses),
    maxAcademicYears: numVal('inst-limit-years', baseDefaults.maxAcademicYears),
    maxFeeItems: numVal('inst-limit-fee-items', baseDefaults.maxFeeItems),
    maxExamsPerYear: numVal('inst-limit-exams', baseDefaults.maxExamsPerYear),
    maxNotices: numVal('inst-limit-notices', baseDefaults.maxNotices),
    maxGalleryPhotos: numVal('inst-limit-gallery', baseDefaults.maxGalleryPhotos)
  };

  const ok = await saveInstitutionData({
    mode,
    name: String(document.getElementById('inst-name').value || '').trim(),
    slug: sanitizeSlugInput(document.getElementById('inst-slug').value),
    place: String(document.getElementById('inst-place').value || '').trim(),
    phone: String(document.getElementById('inst-phone').value || '').trim(),
    adminName: String(document.getElementById('inst-admin-name').value || '').trim() || 'Master Admin',
    rawAdminLogin: String(document.getElementById('inst-admin-email').value || '').trim(),
    adminPhone: String(document.getElementById('inst-admin-phone')?.value || '').trim(),
    adminPassword: String(document.getElementById('inst-admin-password').value || '').trim(),
    planTier,
    planLimits,
    verificationStatus,
    planName: String(document.getElementById('inst-plan-name').value || 'ELITE').trim(),
    isLifetime: planTier === 'free' ? true : (document.getElementById('inst-is-lifetime')?.checked === true),
    durationMonths: Number(document.getElementById('inst-duration-months').value || 0),
    startDate: String(document.getElementById('inst-start-date').value || toIsoDateInput()).trim(),
    expiryDate: (planTier === 'free' || document.getElementById('inst-is-lifetime')?.checked === true)
      ? ''
      : String(document.getElementById('inst-expiry-date').value || '').trim(),
    status,
    pauseReason,
    allowedPages: readAllowedPagesFromCheckboxes('inst-page-checkbox'),
    errorBoxId: 'inst-form-error',
    submitBtnId: 'btn-save-inst'
  });

  if (ok) {
    closeInstitutionModal();
  }
};

const handleAddInstPageSubmit = async (e) => {
  e.preventDefault();
  const isLifetime = document.getElementById('add-inst-is-lifetime')?.checked === true;
  const rawPlanName = String(document.getElementById('add-inst-plan-name').value || 'ELITE').trim();
  const inferredTier = rawPlanName.toLowerCase() === 'free' || rawPlanName.toLowerCase() === 'trial'
    ? 'free'
    : rawPlanName.toLowerCase() === 'standard'
      ? 'standard'
      : 'elite';
  const ok = await saveInstitutionData({
    mode: 'create',
    name: String(document.getElementById('add-inst-name').value || '').trim(),
    slug: sanitizeSlugInput(document.getElementById('add-inst-slug').value),
    place: String(document.getElementById('add-inst-place').value || '').trim(),
    phone: String(document.getElementById('add-inst-phone').value || '').trim(),
    adminName: String(document.getElementById('add-inst-admin-name').value || '').trim() || 'Master Admin',
    rawAdminLogin: String(document.getElementById('add-inst-admin-email').value || '').trim(),
    adminPhone: String(document.getElementById('add-inst-admin-phone')?.value || '').trim(),
    adminPassword: String(document.getElementById('add-inst-admin-password').value || '').trim(),
    planTier: inferredTier,
    planName: rawPlanName,
    isLifetime: inferredTier === 'free' ? true : isLifetime,
    durationMonths: Number(document.getElementById('add-inst-duration-months').value || 0),
    startDate: String(document.getElementById('add-inst-start-date').value || toIsoDateInput()).trim(),
    expiryDate: (inferredTier === 'free' || isLifetime) ? '' : String(document.getElementById('add-inst-expiry-date').value || '').trim(),
    status: 'active',
    pauseReason: '',
    allowedPages: readAllowedPagesFromCheckboxes('add-inst-page-checkbox'),
    errorBoxId: 'add-inst-form-error',
    submitBtnId: 'btn-submit-add-inst-page'
  });

  if (ok) {
    initAddInstitutionPageForm();
    setActiveCompanyView('institutions');
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

// --- PREMIUM PLANS & CONTACT CATALOG MANAGEMENT ---

const readOfferBannerFromInputs = () => ({
  enabled: document.getElementById('catalog-offer-enabled')?.checked === true,
  badgeText: String(document.getElementById('catalog-offer-badge')?.value || '').trim(),
  headline: String(document.getElementById('catalog-offer-headline')?.value || '').trim(),
  description: String(document.getElementById('catalog-offer-desc')?.value || '').trim()
});

const readContactFromInputs = () => ({
  brandName: String(document.getElementById('contact-brand-name')?.value || '').trim(),
  phone: String(document.getElementById('contact-phone')?.value || '').trim(),
  whatsapp: String(document.getElementById('contact-whatsapp')?.value || '').trim(),
  instagram: String(document.getElementById('contact-instagram')?.value || '').trim(),
  email: String(document.getElementById('contact-email')?.value || '').trim(),
  website: String(document.getElementById('contact-website')?.value || '').trim(),
  supportNote: String(document.getElementById('contact-support-note')?.value || '').trim(),
  whatsappMessage: String(document.getElementById('contact-whatsapp-msg')?.value || '').trim()
});

const readFooterFromInputs = () => normalizeFooterConfig({
  brandName: String(document.getElementById('footer-brand-name')?.value || '').trim(),
  tagline: String(document.getElementById('footer-brand-tagline')?.value || '').trim(),
  copyrightText: String(document.getElementById('footer-copyright-text')?.value || '').trim(),
  creditName: String(document.getElementById('footer-credit-name')?.value || '').trim(),
  creditUrl: String(document.getElementById('footer-credit-url')?.value || '').trim(),
  showCredit: document.getElementById('footer-show-credit')?.checked === true
});

const syncActiveLegalTabToDraft = () => {
  const titleEl = document.getElementById('legal-doc-title');
  const updatedEl = document.getElementById('legal-doc-updated');
  const contentEl = document.getElementById('legal-doc-content');
  if (!titleEl || !contentEl) return;
  legalDraftState[activeLegalTabKey] = {
    title: String(titleEl.value || '').trim() || DEFAULT_LEGAL_DOCS[activeLegalTabKey].title,
    updatedAtLabel: String(updatedEl?.value || '').trim() || DEFAULT_LEGAL_DOCS[activeLegalTabKey].updatedAtLabel,
    content: String(contentEl.value || '').trim() || DEFAULT_LEGAL_DOCS[activeLegalTabKey].content
  };
};

const renderActiveLegalTabInputs = (tabKey = activeLegalTabKey) => {
  const validKey = ['terms', 'privacy', 'security'].includes(tabKey) ? tabKey : 'terms';
  activeLegalTabKey = validKey;
  const docItem = legalDraftState[validKey] || DEFAULT_LEGAL_DOCS[validKey];

  const titleEl = document.getElementById('legal-doc-title');
  const updatedEl = document.getElementById('legal-doc-updated');
  const contentEl = document.getElementById('legal-doc-content');
  if (titleEl) titleEl.value = docItem.title || '';
  if (updatedEl) updatedEl.value = docItem.updatedAtLabel || '';
  if (contentEl) contentEl.value = docItem.content || '';

  document.querySelectorAll('[data-company-legal-tab]').forEach((btn) => {
    const isActive = btn.getAttribute('data-company-legal-tab') === validKey;
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.className = isActive
      ? 'px-3.5 py-2 rounded-lg text-xs font-extrabold bg-white text-slate-900 shadow-2xs cursor-pointer border-none inline-flex items-center gap-1.5'
      : 'px-3.5 py-2 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer border-none bg-transparent inline-flex items-center gap-1.5';
  });
};

const readSelfSignupConfigFromInputs = () => {
  const num = (id, fb, allowZero = false) => {
    const v = Number(document.getElementById(id)?.value);
    if (!Number.isFinite(v)) return fb;
    if (allowZero && v === 0) return 0;
    return v > 0 ? Math.floor(v) : fb;
  };
  const freeLimits = {
    maxStudents: num('basic-limit-students', DEFAULT_FREE_PLAN_LIMITS.maxStudents),
    maxStaff: num('basic-limit-staff', DEFAULT_FREE_PLAN_LIMITS.maxStaff),
    maxClasses: num('basic-limit-classes', DEFAULT_FREE_PLAN_LIMITS.maxClasses),
    maxAcademicYears: num('basic-limit-years', DEFAULT_FREE_PLAN_LIMITS.maxAcademicYears),
    maxFeeItems: num('basic-limit-fee-items', DEFAULT_FREE_PLAN_LIMITS.maxFeeItems),
    maxNotices: num('basic-limit-notices', DEFAULT_FREE_PLAN_LIMITS.maxNotices),
    maxGalleryPhotos: num('basic-limit-gallery', DEFAULT_FREE_PLAN_LIMITS.maxGalleryPhotos),
    maxExamsPerYear: num('basic-limit-exams', DEFAULT_FREE_PLAN_LIMITS.maxExamsPerYear),
    maxDirectoryEntries: num('basic-limit-directory', DEFAULT_FREE_PLAN_LIMITS.maxDirectoryEntries)
  };
  const standardLimits = {
    maxStudents: num('std-limit-students', DEFAULT_STANDARD_PLAN_LIMITS.maxStudents),
    maxStaff: num('std-limit-staff', DEFAULT_STANDARD_PLAN_LIMITS.maxStaff),
    maxClasses: num('std-limit-classes', DEFAULT_STANDARD_PLAN_LIMITS.maxClasses),
    maxAcademicYears: num('std-limit-years', DEFAULT_STANDARD_PLAN_LIMITS.maxAcademicYears),
    maxFeeItems: num('std-limit-fee-items', DEFAULT_STANDARD_PLAN_LIMITS.maxFeeItems),
    maxNotices: num('std-limit-notices', DEFAULT_STANDARD_PLAN_LIMITS.maxNotices),
    maxGalleryPhotos: num('std-limit-gallery', DEFAULT_STANDARD_PLAN_LIMITS.maxGalleryPhotos),
    maxExamsPerYear: num('std-limit-exams', DEFAULT_STANDARD_PLAN_LIMITS.maxExamsPerYear),
    maxDirectoryEntries: num('std-limit-directory', DEFAULT_STANDARD_PLAN_LIMITS.maxDirectoryEntries)
  };
  return {
    enabled: document.getElementById('catalog-self-signup-enabled')?.checked !== false,
    trialDays: Math.min(30, num('catalog-trial-days', DEFAULT_TRIAL_DAYS, true)),
    defaultFreeLimits: freeLimits,
    defaultBasicLimits: freeLimits,
    defaultStandardLimits: standardLimits
  };
};

const collectCatalogDraft = () => {
  syncActiveLegalTabToDraft();
  return normalizePublicCatalog({
    offerBanner: readOfferBannerFromInputs(),
    plans: catalogState.plans || [],
    contact: readContactFromInputs(),
    selfSignupConfig: readSelfSignupConfigFromInputs(),
    footer: readFooterFromInputs(),
    legal: normalizeLegalDocs(legalDraftState)
  });
};

const populateCatalogInputs = (catalog) => {
  const { offerBanner, contact, selfSignupConfig } = catalog;
  const footerCfg = normalizeFooterConfig(catalog?.footer);
  legalDraftState = normalizeLegalDocs(catalog?.legal);

  const ssEnabled = document.getElementById('catalog-self-signup-enabled');
  if (ssEnabled) ssEnabled.checked = selfSignupConfig?.enabled !== false;
  const setLimitInput = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = String(val ?? '');
  };
  setLimitInput('catalog-trial-days', selfSignupConfig?.trialDays ?? DEFAULT_TRIAL_DAYS);

  const freeLimits = selfSignupConfig?.defaultFreeLimits || selfSignupConfig?.defaultBasicLimits || DEFAULT_FREE_PLAN_LIMITS;
  setLimitInput('basic-limit-students', freeLimits.maxStudents);
  setLimitInput('basic-limit-staff', freeLimits.maxStaff);
  setLimitInput('basic-limit-classes', freeLimits.maxClasses);
  setLimitInput('basic-limit-fee-items', freeLimits.maxFeeItems);
  setLimitInput('basic-limit-exams', freeLimits.maxExamsPerYear);
  setLimitInput('basic-limit-notices', freeLimits.maxNotices);
  setLimitInput('basic-limit-gallery', freeLimits.maxGalleryPhotos);
  setLimitInput('basic-limit-directory', freeLimits.maxDirectoryEntries);
  setLimitInput('basic-limit-years', freeLimits.maxAcademicYears);

  const stdLimits = selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS;
  setLimitInput('std-limit-students', stdLimits.maxStudents);
  setLimitInput('std-limit-staff', stdLimits.maxStaff);
  setLimitInput('std-limit-classes', stdLimits.maxClasses);
  setLimitInput('std-limit-fee-items', stdLimits.maxFeeItems);
  setLimitInput('std-limit-exams', stdLimits.maxExamsPerYear);
  setLimitInput('std-limit-notices', stdLimits.maxNotices);
  setLimitInput('std-limit-gallery', stdLimits.maxGalleryPhotos);
  setLimitInput('std-limit-directory', stdLimits.maxDirectoryEntries);
  setLimitInput('std-limit-years', stdLimits.maxAcademicYears);

  const offerEnabled = document.getElementById('catalog-offer-enabled');
  const offerBadge = document.getElementById('catalog-offer-badge');
  const offerHeadline = document.getElementById('catalog-offer-headline');
  const offerDesc = document.getElementById('catalog-offer-desc');

  if (offerEnabled) offerEnabled.checked = Boolean(offerBanner?.enabled);
  if (offerBadge) offerBadge.value = offerBanner?.badgeText || '';
  if (offerHeadline) offerHeadline.value = offerBanner?.headline || '';
  if (offerDesc) offerDesc.value = offerBanner?.description || '';

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('contact-brand-name', contact?.brandName || '');
  setVal('contact-phone', contact?.phone || '');
  setVal('contact-whatsapp', contact?.whatsapp || '');
  setVal('contact-instagram', contact?.instagram || '');
  setVal('contact-email', contact?.email || '');
  setVal('contact-website', contact?.website || '');
  setVal('contact-support-note', contact?.supportNote || '');
  setVal('contact-whatsapp-msg', contact?.whatsappMessage || '');

  setVal('footer-brand-name', footerCfg.brandName);
  setVal('footer-brand-tagline', footerCfg.tagline);
  setVal('footer-copyright-text', footerCfg.copyrightText);
  setVal('footer-credit-name', footerCfg.creditName);
  setVal('footer-credit-url', footerCfg.creditUrl);
  const showCreditEl = document.getElementById('footer-show-credit');
  if (showCreditEl) showCreditEl.checked = Boolean(footerCfg.showCredit);

  renderActiveLegalTabInputs(activeLegalTabKey);
};

const persistPublicCatalog = async (nextCatalog, toastMsg = 'Saved plans and contact catalog!') => {
  const normalized = normalizePublicCatalog(nextCatalog);
  const payload = {
    offerBanner: normalized.offerBanner,
    plans: normalized.plans.map((p, idx) => ({
      ...p,
      displayOrder: idx + 1
    })),
    contact: normalized.contact,
    selfSignupConfig: normalized.selfSignupConfig || readSelfSignupConfigFromInputs(),
    footer: normalizeFooterConfig(normalized.footer || catalogState.footer),
    legal: normalizeLegalDocs(normalized.legal || legalDraftState),
    updatedAt: serverTimestamp(),
    updatedBy: verifiedCompanyOwnerEmail || 'company'
  };
  await setDoc(doc(db, COMPANY_COLLECTION, COMPANY_PUBLIC_CATALOG_DOC_ID), payload, { merge: true });
  catalogState = normalizePublicCatalog(payload);
  legalDraftState = normalizeLegalDocs(payload.legal);
  invalidatePublicCatalogCache();
  invalidateCompanyFooterCache();
  mountUnifiedFooter({ mode: 'compact' });
  renderPlansGrid();
  renderDashboardOverview();
  showToast(toastMsg);
};

const renderPlansGrid = () => {
  const grid = document.getElementById('company-plans-grid');
  if (!grid) return;

  const plans = catalogState.plans || [];
  const sidebarPlansCount = document.getElementById('sidebar-plans-count');
  if (sidebarPlansCount) sidebarPlansCount.textContent = String(plans.length);

  if (!plans.length) {
    grid.innerHTML = `
      <div class="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center space-y-3">
        <div class="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 mx-auto flex items-center justify-center text-xl">
          <i class="fas fa-crown"></i>
        </div>
        <h4 class="text-sm font-extrabold text-slate-900">No Custom Plans Added Yet</h4>
        <p class="text-xs text-slate-500 max-w-md mx-auto">Add multiple subscription tiers with MRP, Offer Price, billing cycle, and features. Institutions will see them when clicking "Premium - Upgrade" or "View Premium Plans".</p>
        <button type="button" id="btn-empty-add-plan" class="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold cursor-pointer inline-flex items-center gap-2">
          <i class="fas fa-plus"></i><span>Create First Custom Plan</span>
        </button>
      </div>
    `;
    document.getElementById('btn-empty-add-plan')?.addEventListener('click', () => openPlanEditorModal());
    return;
  }

  const labelByKey = Object.fromEntries(PAGE_DEFINITIONS.map((p) => [p.key, p.label]));

  grid.innerHTML = plans.map((plan, idx) => {
    const tierKey = inferPlanTierKey(plan);
    const hasDiscount = plan.mrpPrice > 0 && plan.mrpPrice > plan.offerPrice;
    const computedPct = hasDiscount
      ? Math.round(((plan.mrpPrice - plan.offerPrice) / plan.mrpPrice) * 100)
      : 0;
    const badgeLabel = plan.discountBadge || (computedPct > 0 ? `Save ${computedPct}%` : '');
    const isHidden = plan.isActive === false;
    const tierPill = tierKey === 'free'
      ? '<span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold uppercase">Free</span>'
      : tierKey === 'standard'
        ? '<span class="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-extrabold uppercase">Standard</span>'
        : tierKey === 'elite'
          ? '<span class="px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 border border-slate-800 text-[10px] font-extrabold uppercase">ELITE</span>'
          : '<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-extrabold uppercase">Custom</span>';

    return `
      <article class="rounded-2xl border ${plan.isPopular ? 'border-indigo-300 bg-indigo-50/20' : 'border-slate-200 bg-white'} ${isHidden ? 'opacity-70' : ''} p-5 flex flex-col justify-between gap-4">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <h4 class="text-base font-extrabold text-slate-900 truncate">${escapeHtml(plan.name)}</h4>
                ${tierPill}
                ${plan.isPopular ? `<span class="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold"><i class="fas fa-star mr-1 text-[9px] text-amber-600"></i>Recommended</span>` : ''}
                ${isHidden ? `<span class="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-bold">Hidden</span>` : ''}
              </div>
              ${plan.tagline ? `<p class="text-xs text-slate-500 mt-1">${escapeHtml(plan.tagline)}</p>` : ''}
            </div>
            <span class="text-[11px] font-extrabold text-slate-400 tabular-nums">#${idx + 1}</span>
          </div>

          <div class="pb-3 border-b border-slate-100">
            <div class="flex flex-wrap items-baseline gap-2 tabular-nums">
              <span class="text-2xl font-extrabold text-slate-900">${escapeHtml(plan.currency)}${escapeHtml(formatPriceNumber(plan.offerPrice))}</span>
              ${hasDiscount ? `<span class="text-sm font-bold text-slate-400 line-through">${escapeHtml(plan.currency)}${escapeHtml(formatPriceNumber(plan.mrpPrice))}</span>` : ''}
              ${badgeLabel ? `<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold">${escapeHtml(badgeLabel)}</span>` : ''}
            </div>
            <div class="text-xs font-semibold text-slate-500 mt-0.5">${escapeHtml(plan.billingCycle)}</div>
          </div>

          ${plan.features.length ? `
            <ul class="space-y-1.5 text-xs text-slate-700">
              ${plan.features.slice(0, 6).map((f) => `<li class="flex items-start gap-2"><i class="fas fa-check text-emerald-600 mt-0.5 text-[10px]"></i><span>${escapeHtml(f)}</span></li>`).join('')}
            </ul>
          ` : '<p class="text-xs text-slate-400 italic">No bullet features listed.</p>'}

          <div class="pt-1 flex items-center justify-between gap-2 text-[11px]">
            <span class="font-semibold text-slate-500 tabular-nums">${(plan.includedModules || []).length}/10 modules included</span>
            <button type="button" class="btn-plan-more inline-flex items-center gap-1 font-extrabold text-indigo-600 hover:text-indigo-800 cursor-pointer" data-plan-id="${escapeHtml(plan.id)}">
              <span>More</span>
              <i class="fas fa-chevron-right text-[9px]"></i>
            </button>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-1.5">
          <div class="flex items-center gap-1">
            <button type="button" class="btn-plan-move w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer disabled:opacity-40" data-plan-id="${escapeHtml(plan.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} title="Move Up">
              <i class="fas fa-arrow-up text-[10px]"></i>
            </button>
            <button type="button" class="btn-plan-move w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer disabled:opacity-40" data-plan-id="${escapeHtml(plan.id)}" data-dir="1" ${idx === plans.length - 1 ? 'disabled' : ''} title="Move Down">
              <i class="fas fa-arrow-down text-[10px]"></i>
            </button>
            <button type="button" class="btn-plan-toggle-vis px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer" data-plan-id="${escapeHtml(plan.id)}">
              ${isHidden ? 'Show' : 'Hide'}
            </button>
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" class="btn-plan-duplicate px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer" data-plan-id="${escapeHtml(plan.id)}">
              Copy
            </button>
            <button type="button" class="btn-plan-edit px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer" data-plan-id="${escapeHtml(plan.id)}">
              Edit
            </button>
            <button type="button" class="btn-plan-delete px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold cursor-pointer" data-plan-id="${escapeHtml(plan.id)}">
              Delete
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.btn-plan-more').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = (catalogState.plans || []).find((p) => p.id === btn.dataset.planId);
      if (target) {
        openPlanFullDetailsModal(target, collectCatalogDraft(), { previewMode: true });
      }
    });
  });

  grid.querySelectorAll('.btn-plan-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = (catalogState.plans || []).find((p) => p.id === btn.dataset.planId);
      if (target) openPlanEditorModal(target);
    });
  });

  grid.querySelectorAll('.btn-plan-duplicate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = (catalogState.plans || []).find((p) => p.id === btn.dataset.planId);
      if (!target) return;
      const copyPlan = {
        ...target,
        id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `${target.name} (Copy)`,
        tierKey: 'custom',
        isDefaultTier: false,
        isPopular: false,
        displayOrder: (catalogState.plans || []).length + 1
      };
      const nextCatalog = collectCatalogDraft();
      nextCatalog.plans = [...nextCatalog.plans, copyPlan];
      try {
        await persistPublicCatalog(nextCatalog, `Duplicated plan "${target.name}"!`);
      } catch (err) {
        showToast(`Failed to duplicate plan: ${err.message}`, 'error');
      }
    });
  });

  grid.querySelectorAll('.btn-plan-toggle-vis').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextCatalog = collectCatalogDraft();
      nextCatalog.plans = nextCatalog.plans.map((p) => (
        p.id === btn.dataset.planId ? { ...p, isActive: p.isActive === false } : p
      ));
      try {
        await persistPublicCatalog(nextCatalog, 'Updated plan visibility!');
      } catch (err) {
        showToast(`Failed to update plan visibility: ${err.message}`, 'error');
      }
    });
  });

  grid.querySelectorAll('.btn-plan-move').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const dir = Number(btn.dataset.dir || 0);
      const nextCatalog = collectCatalogDraft();
      const idx = nextCatalog.plans.findIndex((p) => p.id === btn.dataset.planId);
      const swapIdx = idx + dir;
      if (idx < 0 || swapIdx < 0 || swapIdx >= nextCatalog.plans.length) return;
      const arr = [...nextCatalog.plans];
      [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
      nextCatalog.plans = arr.map((p, i) => ({ ...p, displayOrder: i + 1 }));
      try {
        await persistPublicCatalog(nextCatalog, 'Updated plan order!');
      } catch (err) {
        showToast(`Failed to reorder plan: ${err.message}`, 'error');
      }
    });
  });

  grid.querySelectorAll('.btn-plan-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = (catalogState.plans || []).find((p) => p.id === btn.dataset.planId);
      if (!target) return;
      const ok = await openConfirmDialog({
        title: 'Delete Subscription Plan',
        message: `Remove "${target.name}" from the public plans catalog?`,
        okLabel: 'Delete Plan'
      });
      if (!ok) return;
      const nextCatalog = collectCatalogDraft();
      nextCatalog.plans = nextCatalog.plans.filter((p) => p.id !== target.id);
      try {
        await persistPublicCatalog(nextCatalog, `Deleted plan "${target.name}"`);
      } catch (err) {
        showToast(`Failed to delete plan: ${err.message}`, 'error');
      }
    });
  });
};

const inferPresetTier = (label = '') => {
  const txt = String(label || '').toLowerCase();
  if (
    txt.includes('unlimited') ||
    txt.includes('excel') ||
    txt.includes('activity') ||
    txt.includes('evaluation') ||
    txt.includes('ledger') ||
    txt.includes('report cards') ||
    txt.includes('promotion') ||
    txt.includes('backup') ||
    txt.includes('alumni') ||
    txt.includes('concessions')
  ) {
    return 'elite';
  }
  if (
    txt.includes('multi-academic') ||
    txt.includes('500 students') ||
    txt.includes('attendance') ||
    txt.includes('academic planning') ||
    txt.includes('worksheet') ||
    txt.includes('multi-exam')
  ) {
    return 'standard';
  }
  return 'free';
};

const renderPlanFeaturePresetsGrid = (selectedLines = []) => {
  const grid = document.getElementById('plan-feature-presets-grid');
  if (!grid) return;
  const normalizedSelected = new Set(
    (Array.isArray(selectedLines) ? selectedLines : [])
      .map((line) => String(line || '').trim().toLowerCase())
      .filter(Boolean)
  );
  grid.innerHTML = PLAN_CATALOG_FEATURE_PRESETS.map((rawPreset) => {
    const label = typeof rawPreset === 'string'
      ? rawPreset.trim()
      : String(rawPreset?.label || '').trim();
    if (!label) return '';
    const tier = (typeof rawPreset === 'object' && rawPreset?.tier)
      ? String(rawPreset.tier).toLowerCase()
      : inferPresetTier(label);
    const checked = normalizedSelected.has(label.toLowerCase());
    const tierTag = tier === 'elite'
      ? '<span class="text-[9px] font-extrabold uppercase text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">ELITE</span>'
      : tier === 'standard'
        ? '<span class="text-[9px] font-extrabold uppercase text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded shrink-0">STD</span>'
        : '<span class="text-[9px] font-extrabold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0">FREE</span>';
    return `
      <label class="flex items-start justify-between gap-2 p-2 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50/40 cursor-pointer text-[11px] font-semibold text-slate-700">
        <span class="flex items-start gap-2 min-w-0">
          <input type="checkbox" class="plan-feature-preset-cb mt-0.5 rounded border-slate-300 text-indigo-600" value="${escapeHtml(label)}" ${checked ? 'checked' : ''}>
          <span class="leading-snug">${escapeHtml(label)}</span>
        </span>
        ${tierTag}
      </label>
    `;
  }).join('');

  grid.querySelectorAll('.plan-feature-preset-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      const textarea = document.getElementById('plan-features');
      if (!textarea) return;
      const val = String(cb.value || '').trim();
      const lines = textarea.value
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const lowerVal = val.toLowerCase();
      const existsIdx = lines.findIndex((l) => l.toLowerCase() === lowerVal);
      if (cb.checked && existsIdx === -1) {
        lines.push(val);
      } else if (!cb.checked && existsIdx >= 0) {
        lines.splice(existsIdx, 1);
      }
      textarea.value = lines.join('\n');
    });
  });
};

const renderPlanModulesGrid = (selectedKeys = []) => {
  const grid = document.getElementById('plan-modules-grid');
  if (!grid) return;
  const selectedSet = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  grid.innerHTML = PAGE_DEFINITIONS.map((m) => `
    <label class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50/40 cursor-pointer text-xs font-bold text-slate-700">
      <input type="checkbox" class="plan-module-checkbox rounded border-slate-300 text-indigo-600" value="${escapeHtml(m.key)}" ${selectedSet.has(m.key) ? 'checked' : ''}>
      <span class="truncate">${escapeHtml(m.label)}</span>
    </label>
  `).join('');
};

const populatePlanModalTierQuotas = (tierKey = 'standard') => {
  const section = document.getElementById('plan-quotas-section');
  const inputsGrid = document.getElementById('plan-quotas-inputs-grid');
  const unlimitedBanner = document.getElementById('plan-quotas-unlimited-banner');
  const heading = document.getElementById('plan-quotas-heading');
  const badge = document.getElementById('plan-quotas-tier-badge');
  if (!section) return;

  const cleanTier = String(tierKey || 'custom').trim().toLowerCase();
  if (cleanTier !== 'free' && cleanTier !== 'standard' && cleanTier !== 'elite') {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  if (cleanTier === 'elite') {
    if (heading) heading.textContent = 'ELITE Tier Capacity & Quotas';
    if (badge) {
      badge.textContent = 'ELITE';
      badge.className = 'px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 text-[10px] font-extrabold uppercase';
    }
    inputsGrid?.classList.add('hidden');
    unlimitedBanner?.classList.remove('hidden');
    return;
  }

  const draftSelfSignup = readSelfSignupConfigFromInputs();
  const isFree = cleanTier === 'free';
  const limits = isFree
    ? (draftSelfSignup?.defaultFreeLimits || catalogState?.selfSignupConfig?.defaultFreeLimits || DEFAULT_FREE_PLAN_LIMITS)
    : (draftSelfSignup?.defaultStandardLimits || catalogState?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS);

  if (heading) heading.textContent = isFree ? 'Free Tier Capacity & Quotas' : 'Standard Tier Capacity & Quotas';
  if (badge) {
    badge.textContent = isFree ? 'Free' : 'Standard';
    badge.className = isFree
      ? 'px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase'
      : 'px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-extrabold uppercase';
  }
  unlimitedBanner?.classList.add('hidden');
  inputsGrid?.classList.remove('hidden');

  const setQuotaVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = String(val ?? '');
  };
  setQuotaVal('plan-quota-students', limits.maxStudents);
  setQuotaVal('plan-quota-staff', limits.maxStaff);
  setQuotaVal('plan-quota-classes', limits.maxClasses);
  setQuotaVal('plan-quota-fee-items', limits.maxFeeItems);
  setQuotaVal('plan-quota-exams', limits.maxExamsPerYear);
  setQuotaVal('plan-quota-notices', limits.maxNotices);
  setQuotaVal('plan-quota-gallery', limits.maxGalleryPhotos);
  setQuotaVal('plan-quota-directory', limits.maxDirectoryEntries);
  setQuotaVal('plan-quota-years', limits.maxAcademicYears);
};

const readPlanModalTierQuotas = (tierKey = 'standard') => {
  const fallback = tierKey === 'free' ? DEFAULT_FREE_PLAN_LIMITS : DEFAULT_STANDARD_PLAN_LIMITS;
  const num = (id, fb) => {
    const v = Number(document.getElementById(id)?.value);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fb;
  };
  return {
    maxStudents: num('plan-quota-students', fallback.maxStudents),
    maxStaff: num('plan-quota-staff', fallback.maxStaff),
    maxClasses: num('plan-quota-classes', fallback.maxClasses),
    maxAcademicYears: num('plan-quota-years', fallback.maxAcademicYears),
    maxFeeItems: num('plan-quota-fee-items', fallback.maxFeeItems),
    maxNotices: num('plan-quota-notices', fallback.maxNotices),
    maxGalleryPhotos: num('plan-quota-gallery', fallback.maxGalleryPhotos),
    maxExamsPerYear: num('plan-quota-exams', fallback.maxExamsPerYear),
    maxDirectoryEntries: num('plan-quota-directory', fallback.maxDirectoryEntries)
  };
};

const openPlanEditorModal = (plan = null) => {
  const modal = document.getElementById('plan-editor-modal');
  const form = document.getElementById('plan-editor-form');
  const errBox = document.getElementById('plan-form-error');
  if (!modal || !form) return;

  form.reset();
  if (errBox) {
    errBox.textContent = '';
    errBox.classList.add('hidden');
  }

  const isEdit = Boolean(plan && plan.id);
  const resolvedTierKey = plan ? (plan.tierKey || inferPlanTierKey(plan)) : 'standard';
  const modalTitleEl = document.getElementById('plan-modal-title');
  if (modalTitleEl) modalTitleEl.textContent = isEdit ? `Edit Plan: ${plan.name}` : 'Add Custom Plan';
  document.getElementById('plan-edit-id').value = isEdit ? plan.id : '';
  document.getElementById('plan-name').value = plan?.name || '';
  const tierSelect = document.getElementById('plan-tier-key');
  if (tierSelect) tierSelect.value = resolvedTierKey;
  document.getElementById('plan-tagline').value = plan?.tagline || '';
  document.getElementById('plan-currency').value = plan?.currency || '₹';
  document.getElementById('plan-mrp').value = plan?.mrpPrice > 0 ? String(plan.mrpPrice) : '';
  document.getElementById('plan-offer-price').value = plan?.offerPrice !== undefined ? String(plan.offerPrice) : '';
  document.getElementById('plan-billing-cycle').value = plan?.billingCycle || 'Per Year';
  document.getElementById('plan-discount-badge').value = plan?.discountBadge || '';
  document.getElementById('plan-is-popular').checked = Boolean(plan?.isPopular);
  document.getElementById('plan-is-active').checked = plan ? plan.isActive !== false : true;
  const featureLines = Array.isArray(plan?.features) ? plan.features : [];
  document.getElementById('plan-features').value = featureLines.join('\n');

  populatePlanModalTierQuotas(resolvedTierKey);
  renderPlanFeaturePresetsGrid(featureLines);
  renderPlanModulesGrid(plan?.includedModules || Object.keys(STANDARD_PLAN_ALLOWED_PAGES).filter((k) => STANDARD_PLAN_ALLOWED_PAGES[k]));
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

const closePlanEditorModal = () => {
  const modal = document.getElementById('plan-editor-modal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');
};

const handlePlanEditorSubmit = async (e) => {
  e.preventDefault();
  const editId = String(document.getElementById('plan-edit-id')?.value || '').trim();
  const name = String(document.getElementById('plan-name')?.value || '').trim();
  const tierKey = String(document.getElementById('plan-tier-key')?.value || 'custom').trim().toLowerCase();
  const tagline = String(document.getElementById('plan-tagline')?.value || '').trim();
  const currency = String(document.getElementById('plan-currency')?.value || '₹').trim() || '₹';
  const mrpRaw = document.getElementById('plan-mrp')?.value;
  const offerRaw = document.getElementById('plan-offer-price')?.value;
  const billingCycle = String(document.getElementById('plan-billing-cycle')?.value || 'Per Year').trim() || 'Per Year';
  const discountBadge = String(document.getElementById('plan-discount-badge')?.value || '').trim();
  const isPopular = document.getElementById('plan-is-popular')?.checked === true;
  const isActive = document.getElementById('plan-is-active')?.checked === true;
  const features = String(document.getElementById('plan-features')?.value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const includedModules = Array.from(document.querySelectorAll('.plan-module-checkbox:checked')).map((cb) => cb.value);

  const mrpPrice = mrpRaw === '' || mrpRaw === null ? 0 : Number(mrpRaw);
  const offerPrice = Number(offerRaw);

  if (!name) return showErrorInBox('plan-form-error', 'Plan Name is required.');
  if (!Number.isFinite(offerPrice) || offerPrice < 0) {
    return showErrorInBox('plan-form-error', 'Please enter a valid Offer Price.');
  }
  if (!Number.isFinite(mrpPrice) || mrpPrice < 0) {
    return showErrorInBox('plan-form-error', 'Please enter a valid MRP Price (or leave empty).');
  }
  if (mrpPrice > 0 && mrpPrice < offerPrice) {
    return showErrorInBox('plan-form-error', 'MRP Price should be greater than or equal to Offer Price.');
  }

  const nextCatalog = collectCatalogDraft();
  const existingIdx = editId ? nextCatalog.plans.findIndex((p) => p.id === editId) : -1;
  const planObj = {
    id: editId || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    tierKey: ['free', 'standard', 'elite', 'custom'].includes(tierKey) ? tierKey : 'custom',
    isDefaultTier: ['free', 'standard', 'elite'].includes(tierKey),
    name,
    tagline,
    currency,
    mrpPrice,
    offerPrice,
    billingCycle,
    discountBadge,
    features,
    includedModules,
    isPopular,
    isActive,
    displayOrder: existingIdx >= 0 ? existingIdx + 1 : nextCatalog.plans.length + 1
  };

  if (existingIdx >= 0) {
    nextCatalog.plans[existingIdx] = planObj;
  } else {
    nextCatalog.plans.push(planObj);
  }

  // Sync edited tier quotas back into selfSignupConfig so all surfaces stay consistent
  if (tierKey === 'free') {
    const editedFreeQuotas = readPlanModalTierQuotas('free');
    nextCatalog.selfSignupConfig = {
      ...(nextCatalog.selfSignupConfig || readSelfSignupConfigFromInputs()),
      defaultFreeLimits: editedFreeQuotas,
      defaultBasicLimits: editedFreeQuotas
    };
  } else if (tierKey === 'standard') {
    const editedStdQuotas = readPlanModalTierQuotas('standard');
    nextCatalog.selfSignupConfig = {
      ...(nextCatalog.selfSignupConfig || readSelfSignupConfigFromInputs()),
      defaultStandardLimits: editedStdQuotas
    };
  }

  const saveBtn = document.getElementById('btn-save-plan-modal');
  const origHtml = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
  }

  try {
    await persistPublicCatalog(nextCatalog, existingIdx >= 0 ? `Updated plan "${name}"!` : `Added plan "${name}"!`);
    populateCatalogInputs(catalogState);
    closePlanEditorModal();
  } catch (err) {
    console.error('Save plan error:', err);
    showErrorInBox('plan-form-error', err.message || 'Failed to save plan.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origHtml;
    }
  }
};

const loadPublicCatalog = async () => {
  try {
    catalogState = await fetchCompanyPublicCatalog({ db, forceRefresh: true });
  } catch (err) {
    console.warn('Could not load company public catalog:', err);
    catalogState = normalizePublicCatalog({});
  }
  populateCatalogInputs(catalogState);
  renderPlansGrid();
  renderDashboardOverview();
};

// --- UPGRADE REQUESTS MANAGEMENT ---

const loadUpgradeRequests = async () => {
  try {
    const snap = await getDocs(collection(db, UPGRADE_REQUESTS_COLLECTION));
    allUpgradeRequests = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => String(b.updatedAtIso || b.createdAtIso || '').localeCompare(String(a.updatedAtIso || a.createdAtIso || '')));
  } catch (err) {
    console.warn('Could not load upgrade requests:', err);
    allUpgradeRequests = [];
  }
  const pendingCount = allUpgradeRequests.filter((r) => String(r.status || 'pending').toLowerCase() === 'pending').length;
  const pill = document.getElementById('sidebar-upgrade-requests-count');
  if (pill) pill.textContent = String(pendingCount);
  renderUpgradeRequests();
};

const renderUpgradeRequests = () => {
  const container = document.getElementById('upgrade-requests-container');
  if (!container) return;
  const filterVal = String(document.getElementById('upgrade-req-status-filter')?.value || 'pending').toLowerCase();
  const list = allUpgradeRequests.filter((r) => filterVal === 'all' || String(r.status || 'pending').toLowerCase() === filterVal);

  if (!list.length) {
    container.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
        <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center text-lg">
          <i class="fas fa-inbox"></i>
        </div>
        <h4 class="text-sm font-extrabold text-slate-900">No Upgrade Requests</h4>
        <p class="text-xs text-slate-500">Requests submitted by Basic Free Plan institutions will appear here for 1-click Premium activation.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map((req) => {
    const st = String(req.status || 'pending').toLowerCase();
    const stBadge = st === 'approved'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : st === 'declined'
        ? 'bg-rose-100 text-rose-800 border-rose-200'
        : st === 'contacted'
          ? 'bg-blue-100 text-blue-800 border-blue-200'
          : 'bg-amber-100 text-amber-800 border-amber-200';
    const reqTier = String(req.requestedTier || '').toLowerCase() === 'standard'
      || String(req.requestedPlanName || '').toLowerCase().includes('standard')
      ? 'standard'
      : 'elite';
    const waDigits = String(req.contactPhone || '').replace(/\D/g, '');
    const waHref = waDigits
      ? `https://wa.me/${waDigits}?text=${encodeURIComponent(`Hello ${req.institutionName || ''}, we received your upgrade request for ${req.requestedPlanName || (reqTier === 'standard' ? 'Standard Plan' : 'ELITE Plan')}. Let's get your plan activated!`)}`
      : '';
    const dateText = req.updatedAtIso ? new Date(req.updatedAtIso).toLocaleString('en-IN') : '--';
    const usage = req.usageSnapshot || {};

    return `
      <article class="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-2xs">
        <div class="space-y-1.5 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="text-sm font-extrabold text-slate-900">${escapeHtml(req.institutionName || req.institutionId)}</h4>
            <span class="font-mono text-[11px] font-bold text-indigo-600">/${escapeHtml(req.institutionId || '')}</span>
            <span class="px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase ${stBadge}">${escapeHtml(st)}</span>
            <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${reqTier === 'standard' ? 'bg-indigo-50 text-indigo-800 border border-indigo-200' : 'bg-slate-900 text-amber-300 border border-slate-800'}">Target: ${reqTier === 'standard' ? 'Standard' : 'ELITE'}</span>
          </div>
          <div class="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span><strong class="text-slate-800">Requested Plan:</strong> ${escapeHtml(req.requestedPlanName || (reqTier === 'standard' ? 'Standard' : 'ELITE'))}</span>
            ${req.requestedFeature ? `<span><strong class="text-slate-800">Trigger:</strong> ${escapeHtml(req.requestedFeature)}</span>` : ''}
            <span><strong class="text-slate-800">Usage:</strong> ${Number(usage.students || 0)} Students · ${Number(usage.staff || 0)} Staff</span>
          </div>
          <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            ${req.contactPhone ? `<span><i class="fas fa-phone mr-1"></i>${escapeHtml(req.contactPhone)}</span>` : ''}
            ${req.requestedBy ? `<span><i class="fas fa-user mr-1"></i>By: ${escapeHtml(req.requestedBy)}</span>` : ''}
            <span><i class="fas fa-clock mr-1"></i>${escapeHtml(dateText)}</span>
          </div>
          ${req.note ? `<p class="text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mt-1">${escapeHtml(req.note)}</p>` : ''}
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0">
          ${waHref ? `<a href="${escapeHtml(waHref)}" target="_blank" rel="noopener noreferrer" class="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-extrabold inline-flex items-center gap-1.5"><i class="fab fa-whatsapp"></i><span>WhatsApp</span></a>` : ''}
          ${st !== 'approved' ? `
            <button type="button" class="btn-approve-upgrade px-3 py-2 rounded-xl ${reqTier === 'standard' ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs' : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200'} text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5" data-req-id="${escapeHtml(req.id)}" data-slug="${escapeHtml(req.institutionId || '')}" data-target-tier="standard" data-plan-name="Standard">
              <i class="fas fa-layer-group"></i>
              <span>Approve Standard</span>
            </button>
            <button type="button" class="btn-approve-upgrade px-3 py-2 rounded-xl ${reqTier === 'elite' ? 'bg-slate-900 hover:bg-slate-800 text-white shadow-2xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'} text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5" data-req-id="${escapeHtml(req.id)}" data-slug="${escapeHtml(req.institutionId || '')}" data-target-tier="elite" data-plan-name="ELITE">
              <i class="fas fa-crown text-amber-400"></i>
              <span>Approve ELITE</span>
            </button>
          ` : ''}
          ${st === 'pending' ? `
            <button type="button" class="btn-mark-contacted px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold cursor-pointer" data-req-id="${escapeHtml(req.id)}">
              Contacted
            </button>
          ` : ''}
          ${st !== 'declined' && st !== 'approved' ? `
            <button type="button" class="btn-decline-upgrade px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer" data-req-id="${escapeHtml(req.id)}">
              Decline
            </button>
          ` : ''}
        </div>
      </article>
    `;
  }).join('');

  container.querySelectorAll('.btn-approve-upgrade').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reqId = btn.dataset.reqId;
      const slug = btn.dataset.slug;
      const targetTier = btn.dataset.targetTier === 'standard' ? 'standard' : 'elite';
      const planName = targetTier === 'standard' ? 'Standard' : 'ELITE';
      const ok = await openConfirmDialog({
        title: `Approve & Activate ${planName}`,
        message: targetTier === 'standard'
          ? `Activate Standard plan for /${slug} (8 modules, Multi-Year progression, Standard quotas, 12-month validity, and Verified status)?`
          : `Activate ELITE plan for /${slug} (all 10 modules, unlimited quotas, Excel Bulk/Reports/TC/Audit, 12-month validity, and Verified status)?`,
        okLabel: `Activate ${planName}`
      });
      if (!ok) return;
      try {
        const startStr = toIsoDateInput();
        const expiryStr = addMonthsToDateStr(startStr, 12);
        const stdLimits = { ...(catalogState?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS) };
        const nextAllowedPages = targetTier === 'standard'
          ? { ...STANDARD_PLAN_ALLOWED_PAGES }
          : { ...ELITE_PLAN_ALLOWED_PAGES };

        const batch = writeBatch(db);
        batch.update(doc(db, INSTITUTIONS_COLLECTION, slug), {
          planTier: targetTier,
          planName,
          planLimits: targetTier === 'standard' ? stdLimits : null,
          trialTier: '',
          trialEndsAtMs: 0,
          trialAllowedPages: null,
          trialPlanLimits: null,
          verificationStatus: 'verified',
          isLifetime: false,
          durationMonths: 12,
          startDate: startStr,
          expiryDate: expiryStr,
          expiryTimestamp: toExpiryTimestamp(expiryStr),
          allowedPages: nextAllowedPages,
          updatedAt: serverTimestamp()
        });
        batch.set(doc(db, `${INSTITUTIONS_COLLECTION}/${slug}/settings`, 'config'), {
          enabledModules: nextAllowedPages,
          updatedAt: serverTimestamp()
        }, { merge: true });
        batch.update(doc(db, UPGRADE_REQUESTS_COLLECTION, reqId), {
          status: 'approved',
          approvedTier: targetTier,
          approvedBy: verifiedCompanyOwnerEmail || 'company',
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedAtIso: new Date().toISOString()
        });
        await batch.commit();
        showToast(`Activated ${planName} for /${slug} successfully!`);
        await Promise.all([loadInstitutions(), loadUpgradeRequests()]);
      } catch (err) {
        showToast(`Failed to approve upgrade: ${err.message}`, 'error');
      }
    });
  });

  container.querySelectorAll('.btn-mark-contacted').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, UPGRADE_REQUESTS_COLLECTION, btn.dataset.reqId), {
          status: 'contacted',
          updatedAt: serverTimestamp(),
          updatedAtIso: new Date().toISOString()
        });
        showToast('Marked request as Contacted.');
        await loadUpgradeRequests();
      } catch (err) {
        showToast(`Failed to update request: ${err.message}`, 'error');
      }
    });
  });

  container.querySelectorAll('.btn-decline-upgrade').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, UPGRADE_REQUESTS_COLLECTION, btn.dataset.reqId), {
          status: 'declined',
          updatedAt: serverTimestamp(),
          updatedAtIso: new Date().toISOString()
        });
        showToast('Marked request as Declined.');
        await loadUpgradeRequests();
      } catch (err) {
        showToast(`Failed to decline request: ${err.message}`, 'error');
      }
    });
  });
};

// --- PLATFORM PAGE SCREENSHOTS MANAGER ---

const isSafeShowcaseImageUrl = (rawUrl = '') => {
  const clean = String(rawUrl || '').trim();
  if (!clean || clean.length < 8 || clean.length > 240000) return false;
  if (/^data:image\/(webp|jpeg|jpg|png);base64,[a-z0-9+/=\s]+$/i.test(clean)) {
    return true;
  }
  try {
    const parsed = new URL(clean);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (_) {
    return false;
  }
};

const isLikelyVideoUrl = (rawUrl = '') => {
  const clean = String(rawUrl || '').trim().toLowerCase();
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    return /\.(mp4|webm|mov)(\?|$)/i.test(parsed.pathname)
      || clean.includes('_vid_')
      || parsed.searchParams.get('alt') === 'media' && /\.(mp4|webm|mov)/i.test(decodeURIComponent(parsed.pathname));
  } catch (_) {
    return /\.(mp4|webm|mov)(\?|$)/i.test(clean);
  }
};

const normalizeShowcaseImages = (rawImages = []) => {
  if (!Array.isArray(rawImages)) return [];
  const normalized = [];
  for (const item of rawImages) {
    if (!item || typeof item !== 'object') continue;
    const url = String(item.url || '').trim();
    if (!isSafeShowcaseImageUrl(url)) continue;
    const id = String(item.id || `shot_${Date.now()}_${normalized.length}`).trim().slice(0, 80);
    const caption = String(item.caption || '').trim().slice(0, 160);
    const mediaType = item.mediaType === 'video' || (!item.mediaType && isLikelyVideoUrl(url)) ? 'video' : 'image';
    const rawPoster = String(item.posterUrl || '').trim();
    const posterUrl = rawPoster && rawPoster.length <= 2048 && isSafeShowcaseImageUrl(rawPoster) ? rawPoster : '';
    const updatedAt = typeof item.updatedAt === 'string' && item.updatedAt
      ? item.updatedAt
      : new Date().toISOString();
    const entry = { id, url, mediaType, caption, updatedAt };
    if (posterUrl) entry.posterUrl = posterUrl;
    normalized.push(entry);
    if (normalized.length >= MAX_SHOWCASE_IMAGES_PER_PAGE) break;
  }
  return normalized;
};

const loadImageElementFromFile = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error(`Unable to decode image "${file.name}".`));
  };
  img.src = objectUrl;
});

const compressShowcaseImageFile = async (file) => {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error(`"${file?.name || 'File'}" is not a supported image format.`);
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error(`"${file.name}" exceeds the 20 MB upload limit.`);
  }

  const img = await loadImageElementFromFile(file);
  const srcWidth = img.naturalWidth || img.width || 1280;
  const srcHeight = img.naturalHeight || img.height || 720;

  const maxInitialWidth = 1280;
  const maxInitialHeight = 900;
  let scale = Math.min(1, maxInitialWidth / srcWidth, maxInitialHeight / srcHeight);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser canvas is unavailable for image compression.');

  // Detect WebP support
  const testCanvas = document.createElement('canvas');
  testCanvas.width = 2;
  testCanvas.height = 2;
  const supportsWebp = testCanvas.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
  const mimeType = supportsWebp ? 'image/webp' : 'image/jpeg';

  // Target ~90 KB binary (~120,000 Base64 chars), hard ceiling 210,000 chars (rules allow 240,000)
  const targetMaxChars = 120000;
  const hardMaxChars = 210000;
  const qualitySteps = [0.82, 0.72, 0.62, 0.52, 0.42];
  let bestDataUrl = '';

  for (let pass = 0; pass < 4; pass += 1) {
    const targetW = Math.max(320, Math.round(srcWidth * scale));
    const targetH = Math.max(200, Math.round(srcHeight * scale));
    canvas.width = targetW;
    canvas.height = targetH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    for (const quality of qualitySteps) {
      const candidate = canvas.toDataURL(mimeType, quality);
      if (!bestDataUrl || candidate.length < bestDataUrl.length) {
        bestDataUrl = candidate;
      }
      if (candidate.length <= targetMaxChars) {
        return candidate;
      }
    }

    scale *= 0.78;
  }

  if (bestDataUrl && bestDataUrl.length <= hardMaxChars) {
    return bestDataUrl;
  }
  throw new Error(`Could not compress "${file.name}" within storage limits. Try a smaller image.`);
};

const updateShowcaseCountersUI = () => {
  let totalImages = 0;
  let configuredPages = 0;
  PLATFORM_SHOWCASE_PAGES.forEach((page) => {
    const count = (platformShowcasesMap.get(page.key) || []).length;
    totalImages += count;
    if (count > 0) configuredPages += 1;
  });

  const sidebarBadge = document.getElementById('sidebar-screenshots-count');
  const dashSummary = document.getElementById('dash-screenshots-summary');
  const configuredEl = document.getElementById('screenshots-configured-count');
  const totalEl = document.getElementById('screenshots-total-count');

  if (sidebarBadge) sidebarBadge.textContent = String(totalImages);
  if (dashSummary) {
    dashSummary.textContent = `${totalImages} media item${totalImages === 1 ? '' : 's'} across ${configuredPages} / ${PLATFORM_SHOWCASE_PAGES.length} modules`;
  }
  if (configuredEl) configuredEl.textContent = `${configuredPages} / ${PLATFORM_SHOWCASE_PAGES.length}`;
  if (totalEl) totalEl.textContent = `${totalImages} / ${PLATFORM_SHOWCASE_PAGES.length * MAX_SHOWCASE_IMAGES_PER_PAGE}`;
};

const openScreenshotPreviewModal = (title = 'Media Preview', url = '', meta = '', mediaType = 'image', posterUrl = '') => {
  if (!isSafeShowcaseImageUrl(url)) return;
  const modal = document.getElementById('screenshot-preview-modal');
  const imgEl = document.getElementById('screenshot-preview-img');
  const videoEl = document.getElementById('screenshot-preview-video');
  const titleEl = document.getElementById('screenshot-preview-title');
  const metaEl = document.getElementById('screenshot-preview-meta');
  if (!modal || !imgEl) return;

  const isVideo = mediaType === 'video' || isLikelyVideoUrl(url);
  if (isVideo && videoEl) {
    imgEl.classList.add('hidden');
    imgEl.src = '';
    videoEl.classList.remove('hidden');
    videoEl.poster = posterUrl || '';
    videoEl.src = url;
    videoEl.load();
  } else {
    if (videoEl) {
      try { videoEl.pause(); } catch (_) {}
      videoEl.classList.add('hidden');
      videoEl.removeAttribute('src');
      videoEl.poster = '';
    }
    imgEl.classList.remove('hidden');
    imgEl.src = url;
  }

  if (titleEl) titleEl.textContent = title;
  if (metaEl) metaEl.textContent = meta || (isVideo ? 'HD video preview' : 'Full-size preview');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

const closeScreenshotPreviewModal = () => {
  const modal = document.getElementById('screenshot-preview-modal');
  const imgEl = document.getElementById('screenshot-preview-img');
  const videoEl = document.getElementById('screenshot-preview-video');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  if (imgEl) imgEl.src = '';
  if (videoEl) {
    try { videoEl.pause(); } catch (_) {}
    videoEl.removeAttribute('src');
    videoEl.poster = '';
    videoEl.load();
  }
};

const persistPageShowcase = async (pageKey, nextImages, successMsg = 'Saved platform screenshots!') => {
  if (!ALLOWED_SHOWCASE_KEY_SET.has(pageKey)) {
    throw new Error('Invalid platform module key.');
  }
  const cleanImages = normalizeShowcaseImages(nextImages);
  const payload = {
    pageKey,
    images: cleanImages,
    updatedAt: new Date().toISOString(),
    updatedBy: String(verifiedCompanyOwnerEmail || 'company').slice(0, 160)
  };
  await setDoc(
    doc(db, COMPANY_COLLECTION, COMPANY_PUBLIC_CATALOG_DOC_ID, COMPANY_SHOWCASES_SUBCOLLECTION, pageKey),
    payload
  );
  platformShowcasesMap.set(pageKey, cleanImages);
  updateShowcaseCountersUI();
  renderScreenshotsManager();
  showToast(successMsg);
};

const updateShowcaseBusyText = (pageKey, text) => {
  showcaseBusyStatusMap.set(pageKey, text);
  const labelEl = document.querySelector(`.btn-shot-upload[data-page-key="${pageKey}"] .shot-upload-label`);
  if (labelEl) labelEl.textContent = text;
};

const handleShowcaseFileUpload = async (pageKey, fileList) => {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const existing = platformShowcasesMap.get(pageKey) || [];
  const remainingSlots = MAX_SHOWCASE_IMAGES_PER_PAGE - existing.length;
  if (remainingSlots <= 0) {
    showToast(`Maximum ${MAX_SHOWCASE_IMAGES_PER_PAGE} media items already uploaded for this module.`, 'info');
    return;
  }

  const pageMeta = PLATFORM_SHOWCASE_PAGES.find((p) => p.key === pageKey);
  const toProcess = files.slice(0, remainingSlots);
  const skippedCount = files.length - toProcess.length;

  showcaseBusyPages.add(pageKey);
  showcaseBusyStatusMap.set(pageKey, 'Preparing...');
  renderScreenshotsManager();

  const uploadedUrlsThisBatch = [];
  try {
    const newItems = [];
    for (let i = 0; i < toProcess.length; i += 1) {
      const file = toProcess[i];
      const mime = String(file?.type || '').toLowerCase();
      const isImage = mime.startsWith('image/');
      const isVideo = mime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(String(file?.name || ''));
      if (!file || (!isImage && !isVideo)) {
        throw new Error(`"${file?.name || 'File'}" is not a supported image or video format (JPG, PNG, WebP, MP4, WebM, MOV).`);
      }

      const baseName = String(file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

      if (isVideo) {
        updateShowcaseBusyText(pageKey, 'Generating poster...');
        const videoRes = await uploadShowcaseVideoToStorage(
          file,
          `company/showcases/${pageKey}`,
          {
            fileNamePrefix: pageKey,
            onStageProgress: (stage, pct) => {
              if (stage === 'poster') {
                updateShowcaseBusyText(pageKey, 'Extracting poster...');
              } else if (stage === 'compressing') {
                updateShowcaseBusyText(pageKey, `Compressing 720p ${pct}%`);
              } else if (stage === 'uploading') {
                updateShowcaseBusyText(pageKey, `Uploading video ${pct}%`);
              }
            }
          }
        );
        uploadedUrlsThisBatch.push(videoRes.url);
        if (videoRes.posterUrl) uploadedUrlsThisBatch.push(videoRes.posterUrl);
        const item = {
          id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${i}`,
          url: videoRes.url,
          mediaType: 'video',
          caption: baseName.slice(0, 120),
          updatedAt: new Date().toISOString()
        };
        if (videoRes.posterUrl) item.posterUrl = videoRes.posterUrl;
        newItems.push(item);
      } else {
        if (file.size > 20 * 1024 * 1024) {
          throw new Error(`"${file.name}" exceeds the 20 MB image upload limit.`);
        }
        updateShowcaseBusyText(pageKey, `Uploading image ${i + 1}/${toProcess.length}...`);
        const uploadRes = await uploadImageToStorage(
          file,
          `company/showcases/${pageKey}`,
          {
            ...MEDIA_PRESETS.SHOWCASE,
            fileNamePrefix: pageKey
          }
        );
        uploadedUrlsThisBatch.push(uploadRes.url);
        newItems.push({
          id: `shot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${i}`,
          url: uploadRes.url,
          mediaType: 'image',
          caption: baseName.slice(0, 120),
          updatedAt: new Date().toISOString()
        });
      }
    }

    const combined = [...existing, ...newItems].slice(0, MAX_SHOWCASE_IMAGES_PER_PAGE);
    const note = skippedCount > 0 ? ` (${skippedCount} extra file${skippedCount === 1 ? '' : 's'} skipped due to 5-item limit)` : '';
    await persistPageShowcase(
      pageKey,
      combined,
      `Uploaded ${newItems.length} media item${newItems.length === 1 ? '' : 's'} for ${pageMeta?.label || pageKey}${note}`
    );
  } catch (err) {
    if (uploadedUrlsThisBatch.length) {
      await Promise.allSettled(uploadedUrlsThisBatch.map((u) => deleteStorageUrlIfManaged(u)));
    }
    console.error('Showcase upload error:', err);
    showToast(err?.message || 'Failed to upload media.', 'error');
  } finally {
    showcaseBusyPages.delete(pageKey);
    showcaseBusyStatusMap.delete(pageKey);
    renderScreenshotsManager();
  }
};

const handleShowcaseUrlAdd = async (pageKey, rawUrl) => {
  const cleanUrl = String(rawUrl || '').trim();
  if (!cleanUrl) {
    showToast('Please enter an image or video URL first.', 'info');
    return;
  }
  let parsedUrl = null;
  try {
    parsedUrl = new URL(cleanUrl);
  } catch (_) {
    showToast('Please enter a valid HTTPS media URL.', 'error');
    return;
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    showToast('Only HTTPS/HTTP media URLs are supported.', 'error');
    return;
  }
  if (cleanUrl.length > 2000) {
    showToast('Media URL is too long.', 'error');
    return;
  }

  const existing = platformShowcasesMap.get(pageKey) || [];
  if (existing.length >= MAX_SHOWCASE_IMAGES_PER_PAGE) {
    showToast(`Maximum ${MAX_SHOWCASE_IMAGES_PER_PAGE} media items allowed per module.`, 'info');
    return;
  }

  const pageMeta = PLATFORM_SHOWCASE_PAGES.find((p) => p.key === pageKey);
  const detectedType = isLikelyVideoUrl(parsedUrl.href) ? 'video' : 'image';
  showcaseBusyPages.add(pageKey);
  showcaseBusyStatusMap.set(pageKey, 'Saving URL...');
  renderScreenshotsManager();

  try {
    const nextImages = [
      ...existing,
      {
        id: `url_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url: parsedUrl.href,
        mediaType: detectedType,
        caption: '',
        updatedAt: new Date().toISOString()
      }
    ];
    await persistPageShowcase(pageKey, nextImages, `Added ${detectedType} URL for ${pageMeta?.label || pageKey}`);
  } catch (err) {
    console.error('Add media URL error:', err);
    showToast(err?.message || 'Failed to save media URL.', 'error');
  } finally {
    showcaseBusyPages.delete(pageKey);
    showcaseBusyStatusMap.delete(pageKey);
    renderScreenshotsManager();
  }
};

const handleShowcaseMove = async (pageKey, imageIndex, direction) => {
  const existing = [...(platformShowcasesMap.get(pageKey) || [])];
  const targetIndex = imageIndex + direction;
  if (imageIndex < 0 || targetIndex < 0 || targetIndex >= existing.length) return;
  [existing[imageIndex], existing[targetIndex]] = [existing[targetIndex], existing[imageIndex]];

  showcaseBusyPages.add(pageKey);
  showcaseBusyStatusMap.set(pageKey, 'Reordering...');
  renderScreenshotsManager();

  try {
    await persistPageShowcase(pageKey, existing, 'Updated media display order');
  } catch (err) {
    showToast(`Failed to reorder media: ${err.message}`, 'error');
  } finally {
    showcaseBusyPages.delete(pageKey);
    showcaseBusyStatusMap.delete(pageKey);
    renderScreenshotsManager();
  }
};

const handleShowcaseDelete = async (pageKey, imageIndex) => {
  const existing = [...(platformShowcasesMap.get(pageKey) || [])];
  if (imageIndex < 0 || imageIndex >= existing.length) return;
  const pageMeta = PLATFORM_SHOWCASE_PAGES.find((p) => p.key === pageKey);
  const targetItem = existing[imageIndex];
  const itemLabel = targetItem?.mediaType === 'video' ? 'video' : 'screenshot';

  const ok = await openConfirmDialog({
    title: `Delete ${targetItem?.mediaType === 'video' ? 'Video' : 'Screenshot'}`,
    message: `Remove ${itemLabel} #${imageIndex + 1} from ${pageMeta?.label || pageKey}?${existing.length === 1 ? ' This module will automatically revert to the built-in preview card on the Root Gateway.' : ''}`,
    okLabel: 'Delete'
  });
  if (!ok) return;

  const [removedShot] = existing.splice(imageIndex, 1);
  showcaseBusyPages.add(pageKey);
  showcaseBusyStatusMap.set(pageKey, 'Removing...');
  renderScreenshotsManager();

  try {
    await persistPageShowcase(pageKey, existing, `Removed ${itemLabel} from ${pageMeta?.label || pageKey}`);
    if (removedShot?.url) {
      deleteStorageUrlIfManaged(removedShot.url);
    }
    if (removedShot?.posterUrl) {
      deleteStorageUrlIfManaged(removedShot.posterUrl);
    }
  } catch (err) {
    showToast(`Failed to delete ${itemLabel}: ${err.message}`, 'error');
  } finally {
    showcaseBusyPages.delete(pageKey);
    showcaseBusyStatusMap.delete(pageKey);
    renderScreenshotsManager();
  }
};

const renderScreenshotsManager = () => {
  const grid = document.getElementById('company-screenshots-grid');
  if (!grid) return;

  const queryText = String(document.getElementById('screenshots-search-input')?.value || '').trim().toLowerCase();
  const statusFilter = String(document.getElementById('screenshots-status-filter')?.value || 'all');

  const filteredPages = PLATFORM_SHOWCASE_PAGES.filter((page) => {
    const imgs = platformShowcasesMap.get(page.key) || [];
    if (statusFilter === 'configured' && imgs.length === 0) return false;
    if (statusFilter === 'fallback' && imgs.length > 0) return false;
    if (queryText) {
      const hay = `${page.label} ${page.key} ${page.desc}`.toLowerCase();
      if (!hay.includes(queryText)) return false;
    }
    return true;
  });

  if (!filteredPages.length) {
    grid.innerHTML = `
      <div class="col-span-full bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
        <div class="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 mx-auto flex items-center justify-center">
          <i class="fas fa-filter"></i>
        </div>
        <h4 class="text-sm font-extrabold text-slate-900">No Matching Platform Modules</h4>
        <p class="text-xs text-slate-500">Clear your search filter to view all ${PLATFORM_SHOWCASE_PAGES.length} platform modules.</p>
      </div>
    `;
    return;
  }

  const accentBadgeMap = {
    blue: 'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    teal: 'bg-teal-50 text-teal-600',
    cyan: 'bg-cyan-50 text-cyan-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-700'
  };

  grid.innerHTML = filteredPages.map((page, listIdx) => {
    const images = platformShowcasesMap.get(page.key) || [];
    const isBusy = showcaseBusyPages.has(page.key);
    const busyLabel = showcaseBusyStatusMap.get(page.key) || 'Processing...';
    const isFull = images.length >= MAX_SHOWCASE_IMAGES_PER_PAGE;
    const iconTone = accentBadgeMap[page.accent] || accentBadgeMap.indigo;
    const modeLabel = images.length === 0
      ? 'Default UI Fallback'
      : images.length === 1
        ? (images[0].mediaType === 'video' ? 'Single Video View' : 'Single Image View')
        : `Carousel (${images.length} Items)`;

    const thumbsHtml = images.length
      ? `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          ${images.map((item, idx) => {
            const isVideo = item.mediaType === 'video' || isLikelyVideoUrl(item.url);
            const thumbContent = isVideo
              ? (item.posterUrl
                  ? `<img src="${escapeHtml(item.posterUrl)}" alt="${escapeHtml(page.label)} video poster ${idx + 1}" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200" referrerpolicy="no-referrer" loading="lazy">
                     <span class="absolute inset-0 bg-slate-900/25 flex items-center justify-center"><span class="w-9 h-9 rounded-full bg-white/95 text-slate-900 shadow-md flex items-center justify-center"><i class="fas fa-play text-xs ml-0.5"></i></span></span>`
                  : `<div class="w-full h-full bg-slate-900 flex flex-col items-center justify-center gap-1 text-white"><span class="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center"><i class="fas fa-play text-xs ml-0.5"></i></span><span class="text-[10px] font-bold text-slate-300">Video Clip</span></div>`)
              : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(page.label)} screenshot ${idx + 1}" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200" referrerpolicy="no-referrer" loading="lazy">`;
            return `
            <div class="group rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex flex-col">
              <button type="button" class="btn-shot-preview relative aspect-[16/10] w-full bg-slate-100 overflow-hidden cursor-pointer block" data-page-key="${escapeHtml(page.key)}" data-shot-idx="${idx}" title="Click to preview full size">
                ${thumbContent}
                <span class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-slate-900/75 text-white text-[10px] font-extrabold tabular-nums">#${idx + 1}</span>
                ${isVideo ? '<span class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-indigo-600 text-white text-[9px] font-extrabold uppercase tracking-wide inline-flex items-center gap-1"><i class="fas fa-video text-[8px]"></i>Video</span>' : ''}
              </button>
              <div class="px-2 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between gap-1">
                <div class="flex items-center gap-1">
                  <button type="button" class="btn-shot-move w-6 h-6 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed" data-page-key="${escapeHtml(page.key)}" data-shot-idx="${idx}" data-dir="-1" ${idx === 0 || isBusy ? 'disabled' : ''} title="Move Left" aria-label="Move Left">
                    <i class="fas fa-chevron-left text-[9px]"></i>
                  </button>
                  <button type="button" class="btn-shot-move w-6 h-6 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed" data-page-key="${escapeHtml(page.key)}" data-shot-idx="${idx}" data-dir="1" ${idx === images.length - 1 || isBusy ? 'disabled' : ''} title="Move Right" aria-label="Move Right">
                    <i class="fas fa-chevron-right text-[9px]"></i>
                  </button>
                </div>
                <div class="flex items-center gap-1">
                  <button type="button" class="btn-shot-preview w-6 h-6 rounded-md border border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 flex items-center justify-center cursor-pointer" data-page-key="${escapeHtml(page.key)}" data-shot-idx="${idx}" title="Preview" aria-label="Preview media">
                    <i class="fas ${isVideo ? 'fa-play' : 'fa-expand'} text-[9px]"></i>
                  </button>
                  <button type="button" class="btn-shot-delete w-6 h-6 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center cursor-pointer disabled:opacity-40" data-page-key="${escapeHtml(page.key)}" data-shot-idx="${idx}" ${isBusy ? 'disabled' : ''} title="Delete Media" aria-label="Delete media">
                    <i class="fas fa-trash-alt text-[9px]"></i>
                  </button>
                </div>
              </div>
            </div>
          `;
          }).join('')}
        </div>
      `
      : `
        <div class="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-5 text-center space-y-1">
          <div class="text-xs font-extrabold text-slate-700">No Custom Media Uploaded</div>
          <p class="text-[11px] text-slate-500">Root Gateway currently displays the built-in preview card for ${escapeHtml(page.label)}.</p>
        </div>
      `;

    return `
      <article class="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
        <div class="space-y-3.5">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl ${iconTone} flex items-center justify-center shrink-0 text-sm">
                <i class="fas ${escapeHtml(page.icon)}"></i>
              </div>
              <div class="min-w-0">
                <h4 class="text-sm font-extrabold text-slate-900 truncate">${String(listIdx + 1).padStart(2, '0')}. ${escapeHtml(page.label)}</h4>
                <p class="text-[11px] text-slate-500 mt-0.5 leading-snug">${escapeHtml(page.desc)}</p>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-xs font-extrabold tabular-nums ${images.length > 0 ? 'text-indigo-700' : 'text-slate-600'}">${images.length} / ${MAX_SHOWCASE_IMAGES_PER_PAGE} Media</div>
              <div class="text-[10px] font-semibold text-slate-500 mt-0.5">${escapeHtml(modeLabel)}</div>
            </div>
          </div>

          ${thumbsHtml}
        </div>

        <div class="pt-3.5 border-t border-slate-100 space-y-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple class="hidden shot-file-input" id="shot-file-${escapeHtml(page.key)}" data-page-key="${escapeHtml(page.key)}" ${isFull || isBusy ? 'disabled' : ''}>
            <button type="button" class="btn-shot-upload px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-extrabold cursor-pointer disabled:cursor-not-allowed inline-flex items-center gap-1.5 whitespace-nowrap transition" data-page-key="${escapeHtml(page.key)}" ${isFull || isBusy ? 'disabled' : ''}>
              <i class="fas ${isBusy ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-[11px]"></i>
              <span class="shot-upload-label">${isBusy ? escapeHtml(busyLabel) : isFull ? 'Limit Reached (5/5)' : 'Upload Image / Video'}</span>
            </button>
            <span class="text-[11px] text-slate-500 font-medium">Images &amp; MP4/WebM (≤15MB HD, &gt;15MB 720p)</span>
          </div>

          <div class="flex items-center gap-2">
            <input type="url" class="shot-url-input flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:border-indigo-500 text-xs font-medium outline-none disabled:opacity-50" data-page-key="${escapeHtml(page.key)}" placeholder="Or paste optional https:// image or .mp4 URL..." ${isFull || isBusy ? 'disabled' : ''}>
            <button type="button" class="btn-shot-add-url px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition" data-page-key="${escapeHtml(page.key)}" ${isFull || isBusy ? 'disabled' : ''}>
              Add URL
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.btn-shot-upload').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.pageKey;
      const input = document.getElementById(`shot-file-${key}`);
      if (input && !input.disabled) {
        input.value = '';
        input.click();
      }
    });
  });

  grid.querySelectorAll('.shot-file-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const key = input.dataset.pageKey;
      if (e.target.files?.length) {
        handleShowcaseFileUpload(key, e.target.files);
      }
    });
  });

  grid.querySelectorAll('.btn-shot-add-url').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.pageKey;
      const urlInput = grid.querySelector(`.shot-url-input[data-page-key="${key}"]`);
      if (urlInput) {
        handleShowcaseUrlAdd(key, urlInput.value);
      }
    });
  });

  grid.querySelectorAll('.shot-url-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleShowcaseUrlAdd(input.dataset.pageKey, input.value);
      }
    });
  });

  grid.querySelectorAll('.btn-shot-move').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleShowcaseMove(btn.dataset.pageKey, Number(btn.dataset.shotIdx), Number(btn.dataset.dir));
    });
  });

  grid.querySelectorAll('.btn-shot-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleShowcaseDelete(btn.dataset.pageKey, Number(btn.dataset.shotIdx));
    });
  });

  grid.querySelectorAll('.btn-shot-preview').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.pageKey;
      const idx = Number(btn.dataset.shotIdx);
      const imgs = platformShowcasesMap.get(key) || [];
      const pageMeta = PLATFORM_SHOWCASE_PAGES.find((p) => p.key === key);
      const shot = imgs[idx];
      if (shot) {
        const isVideo = shot.mediaType === 'video' || isLikelyVideoUrl(shot.url);
        openScreenshotPreviewModal(
          `${pageMeta?.label || key} — ${isVideo ? 'Video' : 'Screenshot'} #${idx + 1}`,
          shot.url,
          `Item ${idx + 1} of ${imgs.length}${shot.caption ? ` · ${shot.caption}` : ''}`,
          isVideo ? 'video' : 'image',
          shot.posterUrl || ''
        );
      }
    });
  });
};

const loadPlatformShowcases = async () => {
  const nextMap = new Map();
  PLATFORM_SHOWCASE_PAGES.forEach((p) => nextMap.set(p.key, []));
  try {
    const snap = await getDocs(
      collection(db, COMPANY_COLLECTION, COMPANY_PUBLIC_CATALOG_DOC_ID, COMPANY_SHOWCASES_SUBCOLLECTION)
    );
    snap.forEach((docSnap) => {
      const key = docSnap.id;
      if (!ALLOWED_SHOWCASE_KEY_SET.has(key)) return;
      const data = docSnap.data() || {};
      nextMap.set(key, normalizeShowcaseImages(data.images || []));
    });
  } catch (err) {
    console.warn('Could not load platform showcases:', err);
  }
  platformShowcasesMap = nextMap;
  updateShowcaseCountersUI();
  renderScreenshotsManager();
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

    try {
      const tokenRes = await user.getIdTokenResult();
      if (tokenRes?.claims?.companyOwner !== true) {
        const syncClaimsFn = httpsCallable(functions, 'syncCompanyOwnerClaims');
        const syncRes = await syncClaimsFn();
        if (syncRes?.data?.ok) {
          await user.getIdToken(true);
        }
      }
    } catch (claimErr) {
      console.warn('Company owner claim sync notice:', claimErr?.message || claimErr);
    }

    verifiedCompanyOwnerEmail = email;
    const brandTitle = document.getElementById('company-brand-title');
    const ownerEmailEl = document.getElementById('company-owner-email');
    const mobileEmailEl = document.getElementById('company-mobile-owner-email');
    if (brandTitle) brandTitle.textContent = data.companyName || 'Institution Manage';
    if (ownerEmailEl) ownerEmailEl.textContent = `${email} • Project: ${firebaseConfig.projectId}`;
    if (mobileEmailEl) mobileEmailEl.textContent = email;

    const matchedOwner = ownersList.find((o) => String(o?.email || '').trim().toLowerCase() === email && o?.isActive !== false);
    const activeOtpPhone = String(matchedOwner?.otpPhone || matchedOwner?.phone || data.otpPhone || data.ownerOtpPhone || '').trim();
    syncCompanyOtpSecurityUI(activeOtpPhone);

    window.AppSession?.startCompany?.({
      name: matchedOwner?.name || 'Company Owner',
      email,
      companyName: data.companyName || 'Institution Manage'
    });
    return true;
  } catch (err) {
    console.error('Company verification error:', err);
    return false;
  }
};

const syncCompanyOtpSecurityUI = (rawPhone = '') => {
  const cleanPhone = String(rawPhone || '').trim();
  const inputEl = document.getElementById('company-otp-phone-input');
  const badgeEl = document.getElementById('company-otp-status-badge');
  const dashBannerEl = document.getElementById('dash-otp-setup-banner');

  if (inputEl) inputEl.value = cleanPhone;
  const isConfigured = Boolean(normalizePhoneToE164Client(cleanPhone));
  if (badgeEl) {
    badgeEl.textContent = isConfigured ? `Active (${cleanPhone})` : 'Not Configured';
    badgeEl.className = isConfigured
      ? 'px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 whitespace-nowrap'
      : 'px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 whitespace-nowrap';
  }
  if (dashBannerEl) {
    dashBannerEl.classList.toggle('hidden', isConfigured);
  }
};

const handleCompanyOtpSecuritySubmit = async (e) => {
  e.preventDefault();
  const inputEl = document.getElementById('company-otp-phone-input');
  const rawVal = String(inputEl?.value || '').trim();
  let normalized = '';
  if (rawVal) {
    normalized = normalizePhoneToE164Client(rawVal);
    if (!normalized) {
      showToast('Please enter a valid 10-digit mobile number or E.164 format (e.g. +919876543210).', 'error');
      inputEl?.focus();
      return;
    }
  }

  const btn = document.getElementById('btn-save-company-otp-phone');
  const orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
  }

  try {
    const configRef = doc(db, COMPANY_COLLECTION, COMPANY_CONFIG_DOC_ID);
    await setDoc(configRef, {
      otpPhone: normalized,
      updatedAt: serverTimestamp(),
      updatedBy: verifiedCompanyOwnerEmail || 'company'
    }, { merge: true });
    syncCompanyOtpSecurityUI(normalized);
    showToast(
      normalized
        ? `Company Owner 2-Step SMS OTP enabled for ${normalized}`
        : 'Company Owner SMS OTP number cleared.'
    );
  } catch (err) {
    console.error('Save Company OTP phone error:', err);
    showToast(`Failed to save OTP mobile number: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }
};

const bindEvents = () => {
  // Persistent Expand / Collapse sidebar toggle
  document.getElementById('btn-open-company-sidebar')?.addEventListener('click', toggleCompanySidebar);
  document.getElementById('btn-close-company-sidebar')?.addEventListener('click', () => applyCompanySidebarCollapsed(true, true));

  document.querySelectorAll('.company-nav-btn[data-company-view], .company-bottom-nav-btn[data-company-view], .company-more-nav-btn[data-company-view]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveCompanyView(btn.dataset.companyView));
  });
  document.querySelectorAll('[data-jump-view]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveCompanyView(btn.dataset.jumpView));
  });

  // Mobile More bottom sheet
  document.getElementById('btn-company-mobile-more')?.addEventListener('click', openCompanyMobileMoreSheet);
  document.getElementById('btn-close-company-mobile-more')?.addEventListener('click', closeCompanyMobileMoreSheet);
  document.getElementById('company-mobile-more-sheet')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCompanyMobileMoreSheet();
  });

  document.getElementById('btn-open-add-inst')?.addEventListener('click', () => setActiveCompanyView('add-institution'));

  const openCatalogPreview = () => {
    openPremiumPlansModal({
      contextType: 'preview',
      catalogOverride: collectCatalogDraft()
    });
  };
  document.getElementById('btn-header-preview-plans')?.addEventListener('click', openCatalogPreview);
  document.getElementById('btn-preview-catalog-modal')?.addEventListener('click', openCatalogPreview);
  document.getElementById('btn-preview-contact-modal')?.addEventListener('click', openCatalogPreview);

  const handleCompanySignOut = () => {
    window.AppSession?.signOut?.(auth, { redirectUrl: '/?public=1' });
  };
  document.getElementById('btn-company-signout')?.addEventListener('click', handleCompanySignOut);
  document.getElementById('btn-company-mobile-signout')?.addEventListener('click', handleCompanySignOut);
  document.getElementById('company-otp-security-form')?.addEventListener('submit', handleCompanyOtpSecuritySubmit);

  // Institutions view filters
  document.getElementById('btn-refresh-institutions')?.addEventListener('click', loadInstitutions);
  document.getElementById('inst-search-input')?.addEventListener('input', renderInstitutionsGrid);
  document.getElementById('inst-status-filter')?.addEventListener('change', renderInstitutionsGrid);

  // Add Institution page view form
  document.getElementById('btn-reset-add-inst-page')?.addEventListener('click', initAddInstitutionPageForm);
  document.getElementById('add-inst-page-form')?.addEventListener('submit', handleAddInstPageSubmit);
  document.getElementById('add-inst-slug')?.addEventListener('input', () => updateSlugPreviewFor('add-inst-slug', 'add-inst-slug-preview'));

  document.getElementById('btn-toggle-add-inst-pass')?.addEventListener('click', () => {
    const pwdEl = document.getElementById('add-inst-admin-password');
    const eyeEl = document.getElementById('add-inst-pass-eye');
    if (!pwdEl) return;
    const isPassword = pwdEl.type === 'password';
    pwdEl.type = isPassword ? 'text' : 'password';
    if (eyeEl) eyeEl.className = isPassword ? 'fas fa-eye-slash text-xs' : 'fas fa-eye text-xs';
  });
  document.getElementById('btn-copy-add-inst-pass')?.addEventListener('click', async () => {
    const val = String(document.getElementById('add-inst-admin-password')?.value || '');
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
  document.getElementById('add-inst-duration-months')?.addEventListener('change', () => {
    const months = Number(document.getElementById('add-inst-duration-months').value || 0);
    const startVal = document.getElementById('add-inst-start-date').value || toIsoDateInput();
    if (months > 0 && !document.getElementById('add-inst-is-lifetime').checked) {
      document.getElementById('add-inst-expiry-date').value = addMonthsToDateStr(startVal, months);
    }
  });
  document.getElementById('add-inst-start-date')?.addEventListener('change', () => {
    const months = Number(document.getElementById('add-inst-duration-months').value || 0);
    if (months > 0 && !document.getElementById('add-inst-is-lifetime').checked) {
      document.getElementById('add-inst-expiry-date').value = addMonthsToDateStr(document.getElementById('add-inst-start-date').value, months);
    }
  });
  document.getElementById('add-inst-is-lifetime')?.addEventListener('change', () => syncLifetimeInputsFor('add-inst'));
  document.getElementById('add-inst-plan-name')?.addEventListener('change', (e) => {
    const val = String(e.target?.value || '').toLowerCase();
    const map = val === 'free' || val === 'trial'
      ? FREE_PLAN_ALLOWED_PAGES
      : val === 'standard'
        ? STANDARD_PLAN_ALLOWED_PAGES
        : ELITE_PLAN_ALLOWED_PAGES;
    document.querySelectorAll('.add-inst-page-checkbox').forEach((cb) => {
      cb.checked = map[cb.dataset.pageKey] === true;
    });
  });
  document.getElementById('btn-add-pages-select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.add-inst-page-checkbox').forEach((cb) => { cb.checked = true; });
    const planSel = document.getElementById('add-inst-plan-name');
    if (planSel) planSel.value = 'ELITE';
  });
  document.getElementById('btn-add-pages-standard-preset')?.addEventListener('click', () => {
    document.querySelectorAll('.add-inst-page-checkbox').forEach((cb) => {
      cb.checked = STANDARD_PLAN_ALLOWED_PAGES[cb.dataset.pageKey] === true;
    });
    const planSel = document.getElementById('add-inst-plan-name');
    if (planSel) planSel.value = 'Standard';
  });
  document.getElementById('btn-add-pages-core-only')?.addEventListener('click', () => {
    document.querySelectorAll('.add-inst-page-checkbox').forEach((cb) => {
      cb.checked = FREE_PLAN_ALLOWED_PAGES[cb.dataset.pageKey] === true;
    });
    const planSel = document.getElementById('add-inst-plan-name');
    if (planSel) planSel.value = 'Free';
  });

  // Institution Edit / Create Modal
  document.getElementById('btn-close-inst-modal')?.addEventListener('click', closeInstitutionModal);
  document.getElementById('btn-cancel-inst-modal')?.addEventListener('click', closeInstitutionModal);
  document.getElementById('inst-form')?.addEventListener('submit', handleInstitutionSubmit);
  document.getElementById('inst-slug')?.addEventListener('input', updateSlugPreview);

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

  const applyInstTierPreset = (tierKey) => {
    const tier = normalizePlanTier(tierKey);
    const tierSelect = document.getElementById('inst-plan-tier-select');
    if (tierSelect) tierSelect.value = tier;
    const planLabelSel = document.getElementById('inst-plan-name');
    if (planLabelSel) {
      planLabelSel.value = tier === 'free' ? 'Free' : (tier === 'standard' ? 'Standard' : 'ELITE');
    }
    const pageMap = tier === 'free'
      ? FREE_PLAN_ALLOWED_PAGES
      : tier === 'standard'
        ? STANDARD_PLAN_ALLOWED_PAGES
        : ELITE_PLAN_ALLOWED_PAGES;
    document.querySelectorAll('.inst-page-checkbox').forEach((cb) => {
      cb.checked = pageMap[cb.dataset.pageKey] === true;
    });
    const limitsWrap = document.getElementById('inst-basic-limits-wrap');
    limitsWrap?.classList.toggle('hidden', tier === 'elite');
    if (tier !== 'elite') {
      const defaults = tier === 'standard'
        ? (catalogState?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS)
        : (catalogState?.selfSignupConfig?.defaultFreeLimits || DEFAULT_FREE_PLAN_LIMITS);
      const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v ?? ''); };
      setNum('inst-limit-students', defaults.maxStudents);
      setNum('inst-limit-staff', defaults.maxStaff);
      setNum('inst-limit-classes', defaults.maxClasses);
      setNum('inst-limit-years', defaults.maxAcademicYears);
      setNum('inst-limit-fee-items', defaults.maxFeeItems);
      setNum('inst-limit-exams', defaults.maxExamsPerYear);
      setNum('inst-limit-notices', defaults.maxNotices);
      setNum('inst-limit-gallery', defaults.maxGalleryPhotos);
      const heading = document.getElementById('inst-limits-heading');
      if (heading) {
        heading.textContent = tier === 'standard'
          ? 'Per-Institution Standard Plan Quota Overrides'
          : 'Per-Institution Free Plan Quota Overrides';
      }
    }
  };

  document.getElementById('inst-plan-tier-select')?.addEventListener('change', (e) => {
    applyInstTierPreset(e.target?.value || 'elite');
  });

  document.getElementById('btn-pages-select-all')?.addEventListener('click', () => applyInstTierPreset('elite'));
  document.getElementById('btn-pages-standard-preset')?.addEventListener('click', () => applyInstTierPreset('standard'));
  document.getElementById('btn-pages-basic-preset')?.addEventListener('click', () => applyInstTierPreset('free'));

  document.getElementById('btn-inst-extend-trial')?.addEventListener('click', async (e) => {
    const slug = e.currentTarget?.dataset?.slug;
    if (!slug) return;
    const trialDays = Math.max(1, Number(catalogState?.selfSignupConfig?.trialDays ?? DEFAULT_TRIAL_DAYS) || DEFAULT_TRIAL_DAYS);
    const inst = allInstitutions.find((i) => (i.slug || i.id) === slug);
    const baseMs = Math.max(Date.now(), Number(inst?.trialEndsAtMs || 0));
    const nextEndsAtMs = baseMs + (trialDays * 24 * 60 * 60 * 1000);
    try {
      const stdLimits = { ...(catalogState?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS) };
      await updateDoc(doc(db, INSTITUTIONS_COLLECTION, slug), {
        trialTier: 'standard',
        trialDays,
        trialStartedAtMs: Number(inst?.trialStartedAtMs || 0) || Date.now(),
        trialEndsAtMs: nextEndsAtMs,
        trialAllowedPages: { ...STANDARD_PLAN_ALLOWED_PAGES },
        trialPlanLimits: stdLimits,
        updatedAt: serverTimestamp()
      });
      showToast(`Granted +${trialDays} days Standard trial for /${slug}`);
      await loadInstitutions();
      const updated = allInstitutions.find((i) => (i.slug || i.id) === slug);
      if (updated) openInstitutionModal('edit', updated);
    } catch (err) {
      showToast(`Failed to update trial: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-inst-end-trial')?.addEventListener('click', async (e) => {
    const slug = e.currentTarget?.dataset?.slug;
    if (!slug) return;
    try {
      await updateDoc(doc(db, INSTITUTIONS_COLLECTION, slug), {
        trialTier: '',
        trialEndsAtMs: 0,
        trialAllowedPages: null,
        trialPlanLimits: null,
        updatedAt: serverTimestamp()
      });
      showToast(`Ended Standard trial for /${slug} (now on Free tier).`);
      await loadInstitutions();
      const updated = allInstitutions.find((i) => (i.slug || i.id) === slug);
      if (updated) openInstitutionModal('edit', updated);
    } catch (err) {
      showToast(`Failed to end trial: ${err.message}`, 'error');
    }
  });

  // Upgrade Requests events
  document.getElementById('btn-refresh-upgrade-requests')?.addEventListener('click', loadUpgradeRequests);
  document.getElementById('upgrade-req-status-filter')?.addEventListener('change', renderUpgradeRequests);

  // Pause modal
  document.getElementById('btn-cancel-pause-modal')?.addEventListener('click', closePauseModal);
  document.getElementById('btn-confirm-pause-modal')?.addEventListener('click', handleConfirmPause);

  // Plans & Offers + Self-Signup Config + Contact Details
  document.getElementById('btn-open-add-plan')?.addEventListener('click', () => openPlanEditorModal());
  document.getElementById('btn-sync-default-tiers')?.addEventListener('click', async () => {
    const ok = await openConfirmDialog({
      title: 'Sync Default 3 Tiers (Free · Standard · ELITE)',
      message: 'Restore the default Free, Standard, and ELITE subscription plans with curated highlights and module mappings? Custom pricing can be edited anytime.',
      okLabel: 'Sync 3 Tiers'
    });
    if (!ok) return;
    const nextCatalog = collectCatalogDraft();
    nextCatalog.plans = buildDefaultSubscriptionPlans();
    try {
      await persistPublicCatalog(nextCatalog, 'Synced default Free, Standard, and ELITE plans!');
    } catch (err) {
      showToast(`Failed to sync default plans: ${err.message}`, 'error');
    }
  });
  document.getElementById('plan-tier-key')?.addEventListener('change', (e) => {
    const tier = String(e.target?.value || '').toLowerCase();
    populatePlanModalTierQuotas(tier);
    if (tier === 'free' || tier === 'standard' || tier === 'elite') {
      const pageMap = tier === 'free'
        ? FREE_PLAN_ALLOWED_PAGES
        : tier === 'standard'
          ? STANDARD_PLAN_ALLOWED_PAGES
          : ELITE_PLAN_ALLOWED_PAGES;
      document.querySelectorAll('.plan-module-checkbox').forEach((cb) => {
        cb.checked = pageMap[cb.value] === true;
      });
    }
  });
  document.getElementById('plan-features')?.addEventListener('input', (e) => {
    const selectedSet = new Set(
      String(e.target?.value || '')
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean)
    );
    document.querySelectorAll('.plan-feature-preset-cb').forEach((cb) => {
      cb.checked = selectedSet.has(String(cb.value || '').trim().toLowerCase());
    });
  });
  document.getElementById('plan-editor-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePlanEditorModal();
  });
  document.getElementById('btn-close-plan-modal')?.addEventListener('click', closePlanEditorModal);
  document.getElementById('btn-cancel-plan-modal')?.addEventListener('click', closePlanEditorModal);
  document.getElementById('plan-editor-form')?.addEventListener('submit', handlePlanEditorSubmit);

  document.getElementById('btn-save-self-signup-config')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-self-signup-config');
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
    }
    try {
      await persistPublicCatalog(collectCatalogDraft(), 'Saved Self-Signup, Trial & Tier Quota Rules!');
    } catch (err) {
      showToast(`Failed to save Tier rules: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  });

  document.getElementById('btn-save-plans-catalog')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-plans-catalog');
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
    }
    try {
      await persistPublicCatalog(collectCatalogDraft(), 'Saved Premium Plans & Offer Banner!');
    } catch (err) {
      showToast(`Failed to save plans & offer: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  });

  document.getElementById('company-contact-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-contact-details');
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
    }
    try {
      await persistPublicCatalog(collectCatalogDraft(), 'Saved Company Contact Details!');
    } catch (err) {
      showToast(`Failed to save contact details: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  });

  // Footer & Legal CMS events
  document.querySelectorAll('[data-company-legal-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      syncActiveLegalTabToDraft();
      renderActiveLegalTabInputs(tabBtn.getAttribute('data-company-legal-tab') || 'terms');
    });
  });

  document.getElementById('btn-reset-footer-defaults')?.addEventListener('click', () => {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };
    setVal('footer-brand-name', DEFAULT_FOOTER_CONFIG.brandName);
    setVal('footer-brand-tagline', DEFAULT_FOOTER_CONFIG.tagline);
    setVal('footer-copyright-text', DEFAULT_FOOTER_CONFIG.copyrightText);
    setVal('footer-credit-name', DEFAULT_FOOTER_CONFIG.creditName);
    setVal('footer-credit-url', DEFAULT_FOOTER_CONFIG.creditUrl);
    const showCreditEl = document.getElementById('footer-show-credit');
    if (showCreditEl) showCreditEl.checked = Boolean(DEFAULT_FOOTER_CONFIG.showCredit);
    showToast('Restored default footer fields. Click Save to publish.', 'info');
  });

  document.getElementById('btn-reset-active-legal-doc')?.addEventListener('click', () => {
    const def = DEFAULT_LEGAL_DOCS[activeLegalTabKey] || DEFAULT_LEGAL_DOCS.terms;
    legalDraftState[activeLegalTabKey] = { ...def };
    renderActiveLegalTabInputs(activeLegalTabKey);
    showToast(`Restored default ${def.title}. Click Save to publish.`, 'info');
  });

  document.getElementById('btn-preview-active-legal-doc')?.addEventListener('click', () => {
    const draft = collectCatalogDraft();
    openLegalInfoModal(activeLegalTabKey, draft);
  });

  document.getElementById('btn-preview-legal-contact')?.addEventListener('click', () => {
    const draft = collectCatalogDraft();
    openLegalInfoModal('contact', draft);
  });

  document.getElementById('btn-jump-contact-from-legal')?.addEventListener('click', () => {
    setActiveCompanyView('contact');
  });

  document.getElementById('company-footer-legal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-footer-legal');
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
    }
    try {
      await persistPublicCatalog(collectCatalogDraft(), 'Saved Unified Footer & Legal Settings!');
    } catch (err) {
      showToast(`Failed to save footer & legal settings: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  });

  // Platform Screenshots Manager events
  document.getElementById('btn-refresh-screenshots')?.addEventListener('click', loadPlatformShowcases);
  document.getElementById('screenshots-search-input')?.addEventListener('input', renderScreenshotsManager);
  document.getElementById('screenshots-status-filter')?.addEventListener('change', renderScreenshotsManager);
  document.getElementById('btn-close-screenshot-preview')?.addEventListener('click', closeScreenshotPreviewModal);
  document.getElementById('screenshot-preview-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeScreenshotPreviewModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const planModal = document.getElementById('plan-editor-modal');
      if (planModal && !planModal.classList.contains('hidden')) {
        closePlanEditorModal();
        return;
      }
      const modal = document.getElementById('screenshot-preview-modal');
      if (modal && !modal.classList.contains('hidden')) {
        closeScreenshotPreviewModal();
      }
    }
  });
};

restoreCompanySidebarState();
bindEvents();
initAddInstitutionPageForm();
setActiveCompanyView(getSavedCompanyView());

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
  document.getElementById('company-shell')?.classList.remove('hidden');
  await Promise.all([loadInstitutions(), loadPublicCatalog(), loadPlatformShowcases(), loadUpgradeRequests()]);
});
