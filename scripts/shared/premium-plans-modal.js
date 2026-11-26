import { doc, getDoc, getDocFromServer } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db as defaultDb } from '../../config/firebase-config.js';
import {
  COMPANY_COLLECTION,
  COMPANY_PUBLIC_CATALOG_DOC_ID,
  DEFAULT_ELITE_PLAN_LIMITS,
  DEFAULT_FREE_PLAN_LIMITS,
  DEFAULT_STANDARD_PLAN_LIMITS,
  DEFAULT_SUBSCRIPTION_PLANS,
  DEFAULT_TRIAL_DAYS,
  ELITE_PLAN_ALLOWED_PAGES,
  ELITE_PLAN_FEATURES,
  FREE_PLAN_ALLOWED_PAGES,
  FREE_PLAN_FEATURES,
  INSTITUTION_ID,
  STANDARD_PLAN_ALLOWED_PAGES,
  STANDARD_PLAN_FEATURES
} from '../../config/app-config.js';
import { submitUpgradeRequest } from './custom-auth-service.js';

const MODAL_ID = 'shared-premium-plans-modal';
const DETAIL_MODAL_ID = 'shared-plan-details-modal';
const COMPARE_MODAL_ID = 'shared-plan-compare-modal';

const MODULE_LABELS = {
  admin: 'Admin Dashboard',
  official: 'Official Hub',
  student: 'Student & Parent Portal',
  collection: 'Fee Collection',
  result: 'Result Management',
  attendance: 'Attendance Register',
  academicPlan: 'Academic Planning',
  worksheet: 'Worksheet Hub',
  studentActivity: 'Activity & Rewards',
  classroomEvaluation: 'Classroom Evaluation'
};

const ALL_MODULE_KEYS = [
  'admin',
  'official',
  'student',
  'collection',
  'result',
  'attendance',
  'academicPlan',
  'worksheet',
  'studentActivity',
  'classroomEvaluation'
];

const POWER_CAPABILITY_ROWS = [
  { key: 'multiAcademicYears', label: 'Multi-Academic Year Progression' },
  { key: 'excelBulkImport', label: 'Excel Bulk Upload (Students, Fees, Marks)' },
  { key: 'excelExport', label: 'Excel & PDF Data Exports' },
  { key: 'blankSheets', label: 'Blank Printable Sheets & Excel Templates' },
  { key: 'masterLedger', label: 'Master Fee Ledger Matrix' },
  { key: 'advancedFeeReports', label: 'Advanced Financial Analytics & Reports' },
  { key: 'donations', label: 'Donations & Misc Income Tracking' },
  { key: 'bulkWhatsappReminders', label: 'Bulk WhatsApp Dues Reminders' },
  { key: 'bulkReportCards', label: 'Bulk Printable Progress Cards & Rank Lists' },
  { key: 'resultPromotionEngine', label: 'Automated Result Promotion Engine' },
  { key: 'batchPromotion', label: 'Batch Class Promotion Wizard' },
  { key: 'transferCertificates', label: 'Transfer Certificates (TC)' },
  { key: 'feeConcessions', label: 'Fee Concessions & Scholarships' },
  { key: 'studentGroups', label: 'Student Groups & Sibling Bundles' },
  { key: 'alumniManagement', label: 'Alumni & Student Continuity Tracker' },
  { key: 'customStudentFields', label: 'Custom Student Fields & Directory Categories' },
  { key: 'backupAndAudit', label: 'Full System Backup, Restore & Audit Logs' },
  { key: 'siblingSwitcher', label: 'Student Self-Edit & Multi-Sibling Switcher' }
];

let cachedCatalog = null;
let cachedAtMs = 0;
const CACHE_TTL_MS = 60 * 1000;

const esc = (val = '') => String(val ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sanitizeExternalUrl = (raw = '', allowedProtocols = ['https:', 'http:', 'mailto:', 'tel:']) => {
  const val = String(raw || '').trim();
  if (!val) return '';
  try {
    const parsed = new URL(val, window.location.origin);
    return allowedProtocols.includes(parsed.protocol) ? parsed.href : '';
  } catch (_) {
    return '';
  }
};

const formatPriceNumber = (value = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '0';
  const hasFractions = num % 1 !== 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: hasFractions ? 2 : 0,
    maximumFractionDigits: hasFractions ? 2 : 0
  });
};

const buildWhatsappDigits = (raw = '') => String(raw || '').replace(/[^\d]/g, '');

const buildInstagramHref = (raw = '') => {
  const val = String(raw || '').trim();
  if (!val) return '';
  if (/^https?:\/\//i.test(val)) {
    return sanitizeExternalUrl(val, ['https:', 'http:']);
  }
  const cleanHandle = val.replace(/^@+/, '').replace(/\/+$/, '');
  if (!cleanHandle) return '';
  return `https://instagram.com/${encodeURIComponent(cleanHandle)}`;
};

const buildWebsiteHref = (raw = '') => {
  const val = String(raw || '').trim();
  if (!val) return '';
  const withProto = /^https?:\/\//i.test(val) ? val : `https://${val}`;
  return sanitizeExternalUrl(withProto, ['https:', 'http:']);
};

export const inferPlanTierKey = (plan = {}) => {
  const raw = String(plan?.tierKey || '').trim().toLowerCase();
  if (raw === 'free' || raw === 'basic') return 'free';
  if (raw === 'standard') return 'standard';
  if (raw === 'elite' || raw === 'premium') return 'elite';
  if (raw === 'custom') return 'custom';
  const nameAndId = `${plan?.id || ''} ${plan?.name || ''}`.toLowerCase();
  if (/\bfree\b|\bbasic\b|\bstarter\b/.test(nameAndId) || Number(plan?.offerPrice ?? -1) === 0) return 'free';
  if (/\belite\b|\bpremium\b|\benterprise\b|\bultimate\b/.test(nameAndId)) return 'elite';
  if (/\bstandard\b|\bgrowth\b|\bplus\b/.test(nameAndId)) return 'standard';
  return 'custom';
};

const normalizeLimitMap = (raw = {}, defaults = DEFAULT_FREE_PLAN_LIMITS) => {
  const out = {};
  Object.keys(defaults).forEach((key) => {
    const num = Number(raw?.[key]);
    out[key] = Number.isFinite(num) && num >= 0 ? Math.floor(num) : defaults[key];
  });
  return out;
};

export const buildDefaultSubscriptionPlans = () => DEFAULT_SUBSCRIPTION_PLANS.map((p, idx) => ({
  ...p,
  features: [...(p.features || [])],
  includedModules: [...(p.includedModules || [])],
  displayOrder: idx + 1
}));

export const normalizePublicCatalog = (raw = {}) => {
  const offer = raw?.offerBanner && typeof raw.offerBanner === 'object' ? raw.offerBanner : {};
  const contact = raw?.contact && typeof raw.contact === 'object' ? raw.contact : {};
  const rawPlans = Array.isArray(raw?.plans) && raw.plans.length > 0
    ? raw.plans
    : buildDefaultSubscriptionPlans();

  const plans = rawPlans
    .filter((p) => p && typeof p === 'object')
    .map((p, idx) => {
      const mrpPrice = Number(p.mrpPrice || 0);
      const offerPrice = Number(p.offerPrice ?? p.price ?? 0);
      const features = Array.isArray(p.features)
        ? p.features.map((f) => String(f || '').trim()).filter(Boolean)
        : String(p.features || '')
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean);
      const tierKey = inferPlanTierKey(p);
      const defaultMods = tierKey === 'free'
        ? Object.keys(FREE_PLAN_ALLOWED_PAGES).filter((k) => FREE_PLAN_ALLOWED_PAGES[k])
        : (tierKey === 'standard'
          ? Object.keys(STANDARD_PLAN_ALLOWED_PAGES).filter((k) => STANDARD_PLAN_ALLOWED_PAGES[k])
          : Object.keys(ELITE_PLAN_ALLOWED_PAGES));
      const includedModules = Array.isArray(p.includedModules) && p.includedModules.length > 0
        ? p.includedModules.map((m) => String(m || '').trim()).filter(Boolean)
        : defaultMods;
      return {
        id: String(p.id || `plan_${idx + 1}`),
        tierKey,
        isDefaultTier: Boolean(p.isDefaultTier) || ['tier_free', 'tier_standard', 'tier_elite'].includes(String(p.id || '')),
        name: String(p.name || 'Custom Plan').trim(),
        tagline: String(p.tagline || '').trim(),
        currency: String(p.currency || '₹').trim() || '₹',
        mrpPrice: Number.isFinite(mrpPrice) && mrpPrice > 0 ? mrpPrice : 0,
        offerPrice: Number.isFinite(offerPrice) && offerPrice >= 0 ? offerPrice : 0,
        billingCycle: String(p.billingCycle || (tierKey === 'free' ? 'Free Forever' : 'Per Year')).trim(),
        discountBadge: String(p.discountBadge || '').trim(),
        features,
        includedModules,
        isPopular: Boolean(p.isPopular),
        isActive: p.isActive !== false,
        displayOrder: Number.isFinite(Number(p.displayOrder)) ? Number(p.displayOrder) : idx + 1
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const footer = raw?.footer && typeof raw.footer === 'object' ? raw.footer : null;
  const legal = raw?.legal && typeof raw.legal === 'object' ? raw.legal : null;
  const rawSelfSignup = raw?.selfSignupConfig && typeof raw.selfSignupConfig === 'object' ? raw.selfSignupConfig : {};
  const rawFreeLimits = rawSelfSignup.defaultFreeLimits || rawSelfSignup.defaultBasicLimits || {};
  const rawStandardLimits = rawSelfSignup.defaultStandardLimits || {};
  const defaultFreeLimits = normalizeLimitMap(rawFreeLimits, DEFAULT_FREE_PLAN_LIMITS);
  const defaultStandardLimits = normalizeLimitMap(rawStandardLimits, DEFAULT_STANDARD_PLAN_LIMITS);
  const rawTrialDays = Number(rawSelfSignup.trialDays);
  const trialDays = Number.isFinite(rawTrialDays) && rawTrialDays >= 0 && rawTrialDays <= 30
    ? Math.floor(rawTrialDays)
    : DEFAULT_TRIAL_DAYS;

  return {
    offerBanner: {
      enabled: Boolean(offer.enabled),
      badgeText: String(offer.badgeText || '').trim(),
      headline: String(offer.headline || '').trim(),
      description: String(offer.description || '').trim()
    },
    plans,
    contact: {
      brandName: String(contact.brandName || '').trim(),
      whatsapp: String(contact.whatsapp || '').trim(),
      whatsappMessage: String(contact.whatsappMessage || '').trim(),
      instagram: String(contact.instagram || '').trim(),
      phone: String(contact.phone || '').trim(),
      email: String(contact.email || '').trim(),
      website: String(contact.website || '').trim(),
      supportNote: String(contact.supportNote || '').trim()
    },
    selfSignupConfig: {
      enabled: rawSelfSignup.enabled !== false,
      trialDays,
      defaultFreeLimits,
      defaultBasicLimits: defaultFreeLimits,
      defaultStandardLimits
    },
    ...(footer ? { footer } : {}),
    ...(legal ? { legal } : {})
  };
};

export const invalidatePublicCatalogCache = () => {
  cachedCatalog = null;
  cachedAtMs = 0;
};

export const fetchCompanyPublicCatalog = async ({ db = defaultDb, forceRefresh = false } = {}) => {
  if (!forceRefresh && cachedCatalog && (Date.now() - cachedAtMs) < CACHE_TTL_MS) {
    return cachedCatalog;
  }
  const targetDb = db || defaultDb;
  if (!targetDb) return normalizePublicCatalog({});
  const ref = doc(targetDb, COMPANY_COLLECTION, COMPANY_PUBLIC_CATALOG_DOC_ID);
  let snap = null;
  try {
    if (forceRefresh) {
      snap = await getDocFromServer(ref);
    } else {
      snap = await getDoc(ref);
    }
  } catch (err) {
    snap = await getDoc(ref);
  }
  const normalized = normalizePublicCatalog(snap?.exists?.() ? snap.data() : {});
  cachedCatalog = normalized;
  cachedAtMs = Date.now();
  return normalized;
};

export const closePlanFullDetailsModal = () => {
  const el = document.getElementById(DETAIL_MODAL_ID);
  if (el) el.remove();
};

export const closePlanComparisonModal = () => {
  const el = document.getElementById(COMPARE_MODAL_ID);
  if (el) el.remove();
  if (document.body && !document.getElementById(MODAL_ID)) {
    document.body.classList.remove('overflow-hidden');
  }
};

export const closePremiumPlansModal = () => {
  closePlanFullDetailsModal();
  closePlanComparisonModal();
  const modal = document.getElementById(MODAL_ID);
  if (modal) modal.remove();
  if (document.body) {
    document.body.classList.remove('overflow-hidden');
  }
};

const getTierLimitsForCatalog = (tierKey, catalog) => {
  if (tierKey === 'free') return catalog?.selfSignupConfig?.defaultFreeLimits || DEFAULT_FREE_PLAN_LIMITS;
  if (tierKey === 'standard') return catalog?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS;
  return DEFAULT_ELITE_PLAN_LIMITS;
};

const getTierFeatureFlags = (tierKey) => {
  if (tierKey === 'free') return FREE_PLAN_FEATURES;
  if (tierKey === 'standard') return STANDARD_PLAN_FEATURES;
  return ELITE_PLAN_FEATURES;
};

const formatQuotaCell = (val, suffix = '') => {
  const num = Number(val || 0);
  if (!Number.isFinite(num) || num <= 0) return 'Unlimited';
  return suffix ? `${num.toLocaleString('en-IN')} ${suffix}` : num.toLocaleString('en-IN');
};

const buildInquiryText = ({
  planName = '',
  planPriceText = '',
  moduleName = '',
  contextType = 'module',
  institutionName = '',
  institutionSlug = '',
  customTemplate = ''
} = {}) => {
  const instLabel = institutionName
    ? `${institutionName}${institutionSlug ? ` (/${institutionSlug})` : ''}`
    : (institutionSlug ? `/${institutionSlug}` : 'our institution');
  if (planName) {
    return `Hello, we are interested in the "${planName}" plan (${planPriceText}) for ${instLabel}.${moduleName ? ` Needed feature/module: ${moduleName}.` : ''}`;
  }
  if (customTemplate) {
    return customTemplate
      .replace(/\{institution\}/gi, instLabel)
      .replace(/\{module\}/gi, moduleName || 'Upgrade');
  }
  if (contextType === 'paused') {
    return `Hello, our portal for ${instLabel} is currently paused. Please share renewal and plan reactivation details.`;
  }
  if (contextType === 'expired') {
    return `Hello, our subscription for ${instLabel} has expired. Please help us renew our plan.`;
  }
  if (moduleName) {
    return `Hello, we would like to upgrade our plan for ${instLabel} to unlock "${moduleName}".`;
  }
  return `Hello, we would like to know more about Standard and ELITE plans for ${instLabel}.`;
};

const resolveContextHeader = ({
  contextType = 'module',
  moduleName = '',
  institutionName = '',
  pauseReason = '',
  expiryDate = '',
  customReason = '',
  isTrialActive = false,
  trialRemainingLabel = ''
} = {}) => {
  if (contextType === 'paused') {
    return {
      kicker: institutionName || 'Institution Portal Paused',
      title: 'Reactivate & Choose Your Plan',
      subtitle: pauseReason
        ? `Current status: Paused (${pauseReason}). Review plans below or contact support to resume access.`
        : 'Portal access is currently paused. Review plans below or contact our team to resume service.'
    };
  }
  if (contextType === 'expired') {
    return {
      kicker: institutionName || 'Subscription Renewal',
      title: 'Renew Your Plan',
      subtitle: expiryDate
        ? `Your subscription expired on ${expiryDate}. Choose a plan below or contact our team to renew.`
        : 'Your subscription has expired. Choose a plan below or contact our team to renew access.'
    };
  }
  if (contextType === 'preview') {
    return {
      kicker: 'Company Catalog Preview',
      title: 'Upgrade Your Plan',
      subtitle: 'Live preview of Free, Standard, and ELITE cards, More details, and side-by-side comparison.'
    };
  }
  if (contextType === 'compare') {
    return {
      kicker: isTrialActive && trialRemainingLabel ? `Standard Trial · ${trialRemainingLabel}` : (institutionName || 'Plan Comparison'),
      title: 'Compare Plans — Free, Standard & ELITE',
      subtitle: 'Review modules, academic year limits, and automation capabilities side by side.'
    };
  }
  if (contextType === 'quota') {
    return {
      kicker: institutionName || 'Plan Capacity Limit',
      title: moduleName ? `Upgrade for More ${moduleName.replace(/\s*Limit$/i, '')}` : 'Upgrade Your Plan',
      subtitle: customReason || 'You have reached your current plan capacity. Upgrade to Standard or ELITE for higher limits.'
    };
  }
  if (contextType === 'feature' || moduleName) {
    return {
      kicker: isTrialActive && trialRemainingLabel ? `Standard Trial · ${trialRemainingLabel}` : (institutionName || 'Upgrade Plan'),
      title: moduleName ? `Unlock ${moduleName}` : 'Upgrade Your Plan',
      subtitle: customReason || `${moduleName || 'This capability'} requires a higher plan tier. Compare Free, Standard, and ELITE below.`
    };
  }
  return {
    kicker: institutionName || 'Subscription Plans',
    title: 'Upgrade Your Plan',
    subtitle: 'Choose the right tier for your institution — Free, Standard, or ELITE.'
  };
};

// --- Full Details Modal ("More" button on every plan card) ---
export const openPlanFullDetailsModal = (plan, catalog, options = {}) => {
  if (typeof document === 'undefined' || !plan) return;
  closePlanFullDetailsModal();

  const tierKey = inferPlanTierKey(plan);
  const limits = getTierLimitsForCatalog(tierKey, catalog);
  const featureFlags = getTierFeatureFlags(tierKey);
  const includedSet = new Set(plan.includedModules || []);
  const trialDays = catalog?.selfSignupConfig?.trialDays ?? DEFAULT_TRIAL_DAYS;
  const priceDisplay = plan.offerPrice > 0 ? `${plan.currency}${formatPriceNumber(plan.offerPrice)}` : `${plan.currency}0`;
  const hasDiscount = plan.mrpPrice > 0 && plan.mrpPrice > plan.offerPrice;
  const mrpDisplay = hasDiscount ? `${plan.currency}${formatPriceNumber(plan.mrpPrice)}` : '';

  const quotaRows = [
    { label: 'Academic Years', value: formatQuotaCell(limits.maxAcademicYears, limits.maxAcademicYears === 1 ? 'Year Only' : 'Years') },
    { label: 'Active Students', value: formatQuotaCell(limits.maxStudents) },
    { label: 'Staff Accounts', value: formatQuotaCell(limits.maxStaff) },
    { label: 'Classes', value: formatQuotaCell(limits.maxClasses) },
    { label: 'Exams per Year', value: formatQuotaCell(limits.maxExamsPerYear, limits.maxExamsPerYear === 1 ? 'Exam (Manual)' : 'Exams') },
    { label: 'Custom Fee Heads', value: formatQuotaCell(limits.maxFeeItems) },
    { label: 'Public Notices', value: formatQuotaCell(limits.maxNotices) },
    { label: 'Gallery Photos', value: `${limits.maxGalleryPhotos || (tierKey === 'free' ? 6 : tierKey === 'standard' ? 15 : 24)} Photos` },
    { label: 'Directory Entries', value: formatQuotaCell(limits.maxDirectoryEntries) }
  ];

  const tierAccentHeader = tierKey === 'standard'
    ? 'bg-blue-50/80 border-blue-200'
    : (tierKey === 'elite' ? 'bg-slate-900 text-white border-slate-800' : 'bg-slate-50 border-slate-200');
  const isDarkHeader = tierKey === 'elite';

  const modal = document.createElement('div');
  modal.id = DETAIL_MODAL_ID;
  modal.style.zIndex = '1000020';
  modal.className = 'fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `${plan.name} full plan details`);

  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden" style="font-family:'Plus Jakarta Sans',sans-serif;">
      <div class="px-5 py-4 sm:px-6 border-b ${tierAccentHeader} flex items-start justify-between gap-3 shrink-0">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="text-lg font-extrabold ${isDarkHeader ? 'text-white' : 'text-slate-900'}">${esc(plan.name)} Plan — Complete Details</h3>
            ${plan.isPopular ? `<span class="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-600 text-white">Recommended</span>` : ''}
          </div>
          ${plan.tagline ? `<p class="text-xs ${isDarkHeader ? 'text-slate-300' : 'text-slate-600'} mt-0.5">${esc(plan.tagline)}</p>` : ''}
          <div class="flex flex-wrap items-baseline gap-2 mt-2 tabular-nums">
            <span class="text-xl font-extrabold ${isDarkHeader ? 'text-white' : 'text-slate-900'}">${esc(priceDisplay)}</span>
            ${hasDiscount ? `<span class="text-xs font-bold line-through ${isDarkHeader ? 'text-slate-400' : 'text-slate-400'}">${esc(mrpDisplay)}</span>` : ''}
            <span class="text-xs font-semibold ${isDarkHeader ? 'text-slate-300' : 'text-slate-500'}">/ ${esc(plan.billingCycle)}</span>
            ${tierKey === 'free' && trialDays > 0 ? `<span class="text-[11px] font-bold ${isDarkHeader ? 'text-amber-300' : 'text-blue-700'}">· Includes ${trialDays}-day free Standard trial on signup</span>` : ''}
          </div>
        </div>
        <button type="button" id="plan-detail-close-x" class="w-8 h-8 rounded-full ${isDarkHeader ? 'hover:bg-slate-800 text-slate-300 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'} flex items-center justify-center shrink-0 cursor-pointer transition" aria-label="Close">
          <i class="fas fa-times text-xs"></i>
        </button>
      </div>

      <div class="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
        <!-- Section 1: Exact Capacity & Quotas -->
        <div>
          <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2.5">Capacity &amp; Data Quotas</h4>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${quotaRows.map((q) => `
              <div class="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div class="text-[11px] font-semibold text-slate-500">${esc(q.label)}</div>
                <div class="text-xs sm:text-sm font-extrabold text-slate-900 tabular-nums mt-0.5">${esc(q.value)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Section 2: Portal Modules -->
        <div>
          <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2.5">Portal Modules (${includedSet.size}/${ALL_MODULE_KEYS.length} Included)</h4>
          <div class="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
            ${ALL_MODULE_KEYS.map((key) => {
              const ok = includedSet.has(key);
              const extraNote = key === 'result' && tierKey === 'free'
                ? 'Manual entry only · Max 1 Exam/Year'
                : (key === 'result' && tierKey === 'standard'
                  ? 'Manual entry & publishing · Multi-Exam'
                  : (key === 'student' && tierKey === 'free'
                    ? 'Profile, Fees & Published Result'
                    : (key === 'student' && tierKey === 'standard'
                      ? 'Profile, Fees, Results, Attendance, Timetable & Syllabus'
                      : '')));
              return `
                <div class="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-white text-xs">
                  <div class="min-w-0">
                    <div class="font-bold ${ok ? 'text-slate-900' : 'text-slate-400'}">${esc(MODULE_LABELS[key] || key)}</div>
                    ${extraNote ? `<div class="text-[11px] text-slate-500">${esc(extraNote)}</div>` : ''}
                  </div>
                  ${ok
                    ? `<span class="inline-flex items-center gap-1 text-emerald-700 font-extrabold text-[11px] shrink-0"><i class="fas fa-check text-[10px]"></i>Included</span>`
                    : `<span class="text-slate-400 font-bold text-xs shrink-0">—</span>`
                  }
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Section 3: Advanced & Automation Capabilities -->
        <div>
          <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2.5">Workflow, Bulk &amp; Automation Tools</h4>
          <div class="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
            ${POWER_CAPABILITY_ROWS.map((row) => {
              const ok = featureFlags[row.key] === true;
              return `
                <div class="px-3.5 py-2 flex items-center justify-between gap-3 bg-white text-xs">
                  <span class="${ok ? 'font-semibold text-slate-800' : 'font-medium text-slate-400'}">${esc(row.label)}</span>
                  ${ok
                    ? `<i class="fas fa-check text-blue-600 text-xs shrink-0" aria-label="Included"></i>`
                    : `<span class="text-slate-300 font-bold text-xs shrink-0" aria-label="Not included">—</span>`
                  }
                </div>
              `;
            }).join('')}
          </div>
        </div>

        ${plan.features.length > 0 ? `
          <div>
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">Plan Highlights</h4>
            <ul class="space-y-1.5 text-xs text-slate-700">
              ${plan.features.map((f) => `<li class="flex items-start gap-2"><i class="fas fa-check text-emerald-600 mt-0.5 text-[10px]"></i><span>${esc(f)}</span></li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>

      <div class="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <button type="button" id="plan-detail-close-btn" class="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer">
          Back
        </button>
        ${typeof options.onSelectPlan === 'function' ? `
          <button type="button" id="plan-detail-action-btn" class="px-4 py-2 rounded-xl ${tierKey === 'standard' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-900 hover:bg-slate-800'} text-white text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5">
            <span>${esc(options.actionLabel || (tierKey === 'free' ? 'Start Free Account' : `Choose ${plan.name}`))}</span>
            <i class="fas fa-arrow-right text-[10px]"></i>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const onEsc = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onEsc);
      closePlanFullDetailsModal();
    }
  };
  document.addEventListener('keydown', onEsc);
  const closeMe = () => {
    document.removeEventListener('keydown', onEsc);
    closePlanFullDetailsModal();
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeMe();
  });
  modal.querySelector('#plan-detail-close-x')?.addEventListener('click', closeMe);
  modal.querySelector('#plan-detail-close-btn')?.addEventListener('click', closeMe);
  modal.querySelector('#plan-detail-action-btn')?.addEventListener('click', () => {
    closeMe();
    options.onSelectPlan?.(plan);
  });
};

// --- Side-by-Side Comparison Matrix (Free vs Standard vs ELITE) ---
export const renderPlanComparisonMatrixHtml = (catalog) => {
  const freeLimits = catalog?.selfSignupConfig?.defaultFreeLimits || DEFAULT_FREE_PLAN_LIMITS;
  const stdLimits = catalog?.selfSignupConfig?.defaultStandardLimits || DEFAULT_STANDARD_PLAN_LIMITS;

  const checkIcon = (accent = 'text-blue-600') => `<i class="fas fa-check ${accent} text-xs" aria-label="Included"></i>`;
  const dashIcon = '<span class="text-slate-300 font-bold" aria-label="Not included">—</span>';

  const sections = [
    {
      title: 'Capacity & Academic Years',
      rows: [
        { label: 'Academic Years', free: formatQuotaCell(freeLimits.maxAcademicYears, 'Yr'), std: formatQuotaCell(stdLimits.maxAcademicYears, 'Yrs'), elite: 'Unlimited' },
        { label: 'Students Capacity', free: formatQuotaCell(freeLimits.maxStudents), std: formatQuotaCell(stdLimits.maxStudents), elite: 'Unlimited' },
        { label: 'Staff Accounts', free: formatQuotaCell(freeLimits.maxStaff), std: formatQuotaCell(stdLimits.maxStaff), elite: 'Unlimited' },
        { label: 'Classes', free: formatQuotaCell(freeLimits.maxClasses), std: formatQuotaCell(stdLimits.maxClasses), elite: 'Unlimited' },
        { label: 'Exams per Year', free: formatQuotaCell(freeLimits.maxExamsPerYear), std: formatQuotaCell(stdLimits.maxExamsPerYear), elite: 'Unlimited' },
        { label: 'Custom Fee Heads', free: formatQuotaCell(freeLimits.maxFeeItems), std: formatQuotaCell(stdLimits.maxFeeItems), elite: 'Unlimited' },
        { label: 'Gallery Photos', free: `${freeLimits.maxGalleryPhotos || 6}`, std: `${stdLimits.maxGalleryPhotos || 15}`, elite: '24' }
      ]
    },
    {
      title: 'Portal Modules',
      rows: [
        { label: 'Public Website & Official Hub', free: checkIcon('text-slate-700'), std: checkIcon(), elite: checkIcon('text-amber-600') },
        { label: 'Admin Panel & Manual Fee Collection', free: checkIcon('text-slate-700'), std: checkIcon(), elite: checkIcon('text-amber-600') },
        { label: 'Student & Parent Self-Service Portal', free: 'Core', std: '+ Attend/Plan', elite: 'Full + Siblings' },
        { label: 'Result System (Manual Marks & Publish)', free: '1 Exam/Yr', std: checkIcon(), elite: 'Full + Cards' },
        { label: 'Attendance Register (Daily & Monthly)', free: dashIcon, std: checkIcon(), elite: checkIcon('text-amber-600') },
        { label: 'Academic Planning (Timetable & Syllabus)', free: dashIcon, std: checkIcon(), elite: checkIcon('text-amber-600') },
        { label: 'Worksheet Hub (Custom Registers)', free: dashIcon, std: checkIcon(), elite: checkIcon('text-amber-600') },
        { label: 'Activity & Rewards', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') },
        { label: 'Classroom Evaluation', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') }
      ]
    },
    {
      title: 'ELITE Power Tools & Automation',
      rows: [
        { label: 'Excel Bulk Upload / Export & Blank Sheets', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') },
        { label: 'Master Fee Ledger, Donations & PDF Reports', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') },
        { label: 'Bulk WhatsApp Dues Reminders', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') },
        { label: 'Bulk Printable Report Cards & Rank Lists', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') },
        { label: 'Automated Promotion Engine & Batch Promotion', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') },
        { label: 'Transfer Certificates (TC), Concessions & Alumni', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') },
        { label: 'Full System Backup, Restore & Audit Logs', free: dashIcon, std: dashIcon, elite: checkIcon('text-amber-600') }
      ]
    }
  ];

  return `
    <div class="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[540px]">
          <thead>
            <tr class="border-b border-slate-200 bg-slate-50/90 text-xs">
              <th class="py-3 px-4 font-extrabold text-slate-700 w-[46%]">Features</th>
              <th class="py-3 px-3 text-center font-extrabold text-slate-700 w-[18%]">Free</th>
              <th class="py-3 px-3 text-center font-extrabold text-blue-700 bg-blue-50/60 w-[18%]">Standard</th>
              <th class="py-3 px-3 text-center font-extrabold text-slate-900 w-[18%]">ELITE</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-xs">
            ${sections.map((sec) => `
              <tr class="bg-slate-50/60">
                <td colspan="4" class="py-2 px-4 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">${esc(sec.title)}</td>
              </tr>
              ${sec.rows.map((r) => `
                <tr class="hover:bg-slate-50/60 transition-colors">
                  <td class="py-2.5 px-4 font-semibold text-slate-800">${esc(r.label)}</td>
                  <td class="py-2.5 px-3 text-center font-bold text-slate-700 tabular-nums">${r.free}</td>
                  <td class="py-2.5 px-3 text-center font-bold text-blue-800 bg-blue-50/25 tabular-nums">${r.std}</td>
                  <td class="py-2.5 px-3 text-center font-extrabold text-slate-900 tabular-nums">${r.elite}</td>
                </tr>
              `).join('')}
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

export const openPlanComparisonModal = (catalog) => {
  if (typeof document === 'undefined') return;
  closePlanComparisonModal();

  const modal = document.createElement('div');
  modal.id = COMPARE_MODAL_ID;
  modal.style.zIndex = '1000010';
  modal.className = 'fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Compare subscription plans');

  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden" style="font-family:'Plus Jakarta Sans',sans-serif;">
      <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <div class="min-w-0">
          <div class="text-[10px] font-extrabold uppercase tracking-wider text-blue-600">Side-by-Side Comparison</div>
          <h3 class="text-base sm:text-lg font-extrabold text-slate-950 leading-snug">Free vs Standard vs ELITE</h3>
        </div>
        <button type="button" id="plan-compare-close-x" class="w-9 h-9 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center shrink-0 cursor-pointer transition" aria-label="Close comparison">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>

      <div class="p-4 sm:p-6 overflow-y-auto flex-1">
        ${renderPlanComparisonMatrixHtml(catalog)}
      </div>

      <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <span class="text-[11px] font-semibold text-slate-500 truncate">Upgrade or switch plans anytime without losing data.</span>
        <button type="button" id="plan-compare-close-btn" class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold cursor-pointer whitespace-nowrap shrink-0">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add('overflow-hidden');

  const onEsc = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onEsc);
      closePlanComparisonModal();
    }
  };
  document.addEventListener('keydown', onEsc);
  const closeMe = () => {
    document.removeEventListener('keydown', onEsc);
    closePlanComparisonModal();
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeMe();
  });
  modal.querySelector('#plan-compare-close-x')?.addEventListener('click', closeMe);
  modal.querySelector('#plan-compare-close-btn')?.addEventListener('click', closeMe);
};

// --- Shared 3-Tier Pricing Cards Grid (ChatGPT-inspired Clean Scannability) ---
const renderTierCardsGridHtml = (activePlans, catalog, {
  mode = 'modal', // 'modal' | 'public'
  currentTier = '',
  isTrialActive = false,
  trialRemainingLabel = ''
} = {}) => {
  const trialDays = catalog?.selfSignupConfig?.trialDays ?? DEFAULT_TRIAL_DAYS;
  const isPublicMode = mode === 'public';
  const gridColsClass = activePlans.length === 1
    ? 'grid-cols-1 max-w-md mx-auto'
    : activePlans.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-3';

  const trackLayoutClass = (isPublicMode && activePlans.length > 1)
    ? `flex md:grid ${activePlans.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4 overflow-x-auto md:overflow-visible snap-x snap-mandatory scroll-smooth gateway-no-scrollbar pb-2 md:pb-0 items-stretch`
    : `grid ${gridColsClass} gap-4 items-stretch`;

  return `
    <div ${isPublicMode ? 'id="public-pricing-track"' : ''} class="${trackLayoutClass}">
      ${activePlans.map((plan, planIdx) => {
        const tierKey = inferPlanTierKey(plan);
        const hasDiscount = plan.mrpPrice > 0 && plan.mrpPrice > plan.offerPrice;
        const computedPct = hasDiscount
          ? Math.round(((plan.mrpPrice - plan.offerPrice) / plan.mrpPrice) * 100)
          : 0;
        const discountTag = plan.discountBadge || (computedPct > 0 ? `Save ${computedPct}%` : '');
        const priceDisplay = plan.offerPrice > 0
          ? `${plan.currency}${formatPriceNumber(plan.offerPrice)}`
          : `${plan.currency}0`;
        const mrpDisplay = hasDiscount ? `${plan.currency}${formatPriceNumber(plan.mrpPrice)}` : '';

        const isCurrentPlan = mode === 'modal' && currentTier && (
          (!isTrialActive && currentTier === tierKey) ||
          (isTrialActive && tierKey === 'standard')
        );
        const isLowerPlan = mode === 'modal' && currentTier && (
          (currentTier === 'elite' && tierKey !== 'elite') ||
          (currentTier === 'standard' && !isTrialActive && tierKey === 'free')
        );

        const isRecommended = plan.isPopular || tierKey === 'standard';
        const isElite = tierKey === 'elite';

        const cardStyle = isRecommended
          ? 'border-blue-500 bg-blue-50/20 ring-1 ring-blue-200'
          : (isElite
            ? 'border-slate-900 bg-slate-950 text-white'
            : 'border-slate-200 bg-white');

        const titleColor = isElite ? 'text-white' : 'text-slate-900';
        const mutedColor = isElite ? 'text-slate-300' : 'text-slate-500';
        const dividerColor = isElite ? 'border-slate-800' : 'border-slate-100';
        const featureTextColor = isElite ? 'text-slate-200' : 'text-slate-700';
        const checkColor = isRecommended ? 'text-blue-600' : (isElite ? 'text-amber-400' : 'text-slate-700');

        let ctaLabel = 'Get Started';
        let ctaDisabled = false;
        let ctaClasses = isRecommended
          ? 'bg-blue-600 hover:bg-blue-700 text-white'
          : (isElite
            ? 'bg-white hover:bg-slate-100 text-slate-950'
            : 'bg-slate-900 hover:bg-slate-800 text-white');

        if (mode === 'public') {
          if (tierKey === 'free') {
            ctaLabel = 'Start Free Now';
          } else if (tierKey === 'standard') {
            ctaLabel = 'Get Standard';
          } else if (tierKey === 'elite') {
            ctaLabel = 'Get ELITE';
          } else {
            ctaLabel = `Choose ${plan.name}`;
          }
        } else {
          if (isCurrentPlan && isTrialActive) {
            ctaLabel = `Active Trial (${trialRemainingLabel || 'Running'}) — Keep Standard`;
          } else if (isCurrentPlan) {
            ctaLabel = 'Your Current Plan';
            ctaDisabled = true;
            ctaClasses = isElite
              ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-default'
              : 'bg-slate-100 text-slate-500 border border-slate-200 cursor-default';
          } else if (isLowerPlan) {
            ctaLabel = 'Included in Your Plan';
            ctaDisabled = true;
            ctaClasses = 'bg-slate-100 text-slate-400 border border-slate-200 cursor-default';
          } else if (tierKey === 'free') {
            ctaLabel = 'Free Tier';
            ctaDisabled = true;
            ctaClasses = 'bg-slate-100 text-slate-500 border border-slate-200 cursor-default';
          } else {
            ctaLabel = `Upgrade to ${plan.name}`;
          }
        }

        const compactFeatures = (plan.features || []).slice(0, 6);
        const cardSwipeClass = (isPublicMode && activePlans.length > 1)
          ? 'w-[84vw] max-w-[340px] md:w-auto md:max-w-none shrink-0 snap-center'
          : '';

        return `
          <article data-public-plan-idx="${planIdx}" class="${cardSwipeClass} rounded-2xl border ${cardStyle} p-5 sm:p-6 flex flex-col justify-between gap-4 transition">
            <div class="space-y-4">
              <!-- Tier Header -->
              <div>
                <div class="flex items-center justify-between gap-2">
                  <h4 class="text-lg font-extrabold tracking-tight ${titleColor}">${esc(plan.name)}</h4>
                  ${tierKey === 'free' && trialDays > 0 && !isRecommended ? `<span class="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded whitespace-nowrap">${trialDays}-Day Standard Trial</span>` : ''}
                  ${isRecommended ? `<span class="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 bg-blue-100 px-2 py-0.5 rounded whitespace-nowrap">Recommended</span>` : ''}
                  ${isElite && !isRecommended ? `<span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-300 whitespace-nowrap"><i class="fas fa-crown mr-1 text-[9px]"></i>Full Suite</span>` : ''}
                </div>
                ${plan.tagline ? `<p class="text-xs ${mutedColor} mt-1 leading-snug">${esc(plan.tagline)}</p>` : ''}
              </div>

              <!-- Prominent Tabular Price -->
              <div class="pb-3.5 border-b ${dividerColor}">
                <div class="flex flex-wrap items-baseline gap-2 tabular-nums">
                  <span class="text-3xl font-extrabold tracking-tight ${titleColor}">${esc(priceDisplay)}</span>
                  ${hasDiscount ? `<span class="text-sm font-bold line-through ${isElite ? 'text-slate-500' : 'text-slate-400'}">${esc(mrpDisplay)}</span>` : ''}
                </div>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] font-semibold ${mutedColor}">
                  <span>${esc(plan.billingCycle)}</span>
                  ${discountTag ? `<span aria-hidden="true">·</span><span class="${isElite ? 'text-amber-300' : 'text-emerald-700'} font-bold">${esc(discountTag)}</span>` : ''}
                </div>
              </div>

              <!-- Primary Tier CTA -->
              <button
                type="button"
                data-plan-cta-id="${esc(plan.id)}"
                data-plan-tier-key="${esc(tierKey)}"
                ${ctaDisabled ? 'disabled' : ''}
                class="w-full py-2.5 px-4 rounded-xl text-xs font-extrabold transition inline-flex items-center justify-center gap-2 whitespace-nowrap ${ctaDisabled ? '' : 'cursor-pointer'} ${ctaClasses}"
              >
                <span>${esc(ctaLabel)}</span>
              </button>

              <!-- Concise Ticked Highlights -->
              <ul class="space-y-2.5 text-xs ${featureTextColor} pt-1">
                ${compactFeatures.map((feat) => `
                  <li class="flex items-start gap-2.5">
                    <i class="fas fa-check ${checkColor} mt-0.5 shrink-0 text-[11px]" aria-hidden="true"></i>
                    <span class="leading-snug">${esc(feat)}</span>
                  </li>
                `).join('')}
              </ul>
            </div>

            <!-- Footer with "Compare" & "More" Popup Triggers -->
            <div class="pt-3 border-t ${dividerColor} flex items-center justify-between gap-3 text-[11px]">
              ${isPublicMode ? `
                <button
                  type="button"
                  data-plan-compare-trigger
                  class="font-bold ${isElite ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-950'} inline-flex items-center gap-1.5 cursor-pointer transition underline-offset-2 hover:underline"
                >
                  <i class="fas fa-table-columns text-[10px]" aria-hidden="true"></i>
                  <span>Compare</span>
                </button>
              ` : `<span class="${mutedColor} font-semibold tabular-nums">${(plan.includedModules || []).length}/10 modules</span>`}
              <button
                type="button"
                data-plan-more-id="${esc(plan.id)}"
                class="font-extrabold ${isElite ? 'text-amber-300 hover:text-amber-200' : 'text-blue-600 hover:text-blue-700'} inline-flex items-center gap-1 cursor-pointer transition underline-offset-2 hover:underline"
              >
                <span>More</span>
                <i class="fas fa-chevron-right text-[9px]" aria-hidden="true"></i>
              </button>
            </div>
          </article>
        `;
      }).join('')}
    </div>
    ${(isPublicMode && activePlans.length > 1) ? `
      <div id="public-pricing-dots" class="flex md:hidden items-center justify-center gap-1.5 pt-2" aria-label="Plan slide indicators">
        ${activePlans.map((_, idx) => `
          <button type="button" data-pricing-dot="${idx}" aria-label="View plan ${idx + 1}" class="${idx === 0 ? 'h-1.5 w-5 rounded-full bg-blue-600 transition-all cursor-pointer' : 'h-1.5 w-1.5 rounded-full bg-slate-300 transition-all cursor-pointer'}"></button>
        `).join('')}
      </div>
    ` : ''}
  `;
};

const renderCatalogContent = (container, catalog, options) => {
  const {
    contextType = 'module',
    moduleName = '',
    institutionName = '',
    institutionSlug = '',
    currentTier = '',
    isTrialActive = false,
    trialRemainingLabel = '',
    recommendedTier = '',
    initialView = 'plans'
  } = options;

  const activePlans = (catalog.plans || []).filter((p) => p.isActive !== false);
  const { offerBanner, contact } = catalog;
  const waDigits = buildWhatsappDigits(contact.whatsapp);
  const igHref = buildInstagramHref(contact.instagram);
  const webHref = buildWebsiteHref(contact.website);
  const phoneClean = String(contact.phone || '').replace(/[^\d+\-\s()]/g, '').trim();
  const phoneHref = phoneClean ? `tel:${phoneClean.replace(/\s+/g, '')}` : '';
  const emailClean = String(contact.email || '').trim();

  const defaultInquiry = buildInquiryText({
    moduleName,
    contextType,
    institutionName,
    institutionSlug,
    customTemplate: contact.whatsappMessage
  });

  const waDefaultHref = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(defaultInquiry)}`
    : '';
  const emailDefaultHref = emailClean
    ? `mailto:${encodeURIComponent(emailClean)}?subject=${encodeURIComponent(`Plan Upgrade Enquiry${institutionName ? ` - ${institutionName}` : ''}`)}&body=${encodeURIComponent(defaultInquiry)}`
    : '';

  const bannerHtml = (offerBanner.enabled && (offerBanner.headline || offerBanner.badgeText || offerBanner.description))
    ? `
      <div class="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="space-y-0.5 min-w-0">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            ${offerBanner.badgeText ? `<span class="font-extrabold uppercase tracking-wider text-amber-800">${esc(offerBanner.badgeText)}</span><span aria-hidden="true" class="text-amber-400">·</span>` : ''}
            ${offerBanner.headline ? `<span class="font-extrabold text-slate-900">${esc(offerBanner.headline)}</span>` : ''}
          </div>
          ${offerBanner.description ? `<p class="text-xs text-slate-700 leading-relaxed">${esc(offerBanner.description)}</p>` : ''}
        </div>
      </div>`
    : '';

  const plansViewHtml = renderTierCardsGridHtml(activePlans, catalog, {
    mode: 'modal',
    currentTier,
    isTrialActive,
    trialRemainingLabel
  });
  const compareViewHtml = renderPlanComparisonMatrixHtml(catalog);

  const contactButtons = [];
  if (waDefaultHref) {
    contactButtons.push(`
      <a href="${esc(waDefaultHref)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition whitespace-nowrap">
        <i class="fab fa-whatsapp text-sm"></i><span>WhatsApp</span>
      </a>
    `);
  }
  if (igHref) {
    contactButtons.push(`
      <a href="${esc(igHref)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-xs font-extrabold transition whitespace-nowrap">
        <i class="fab fa-instagram text-sm"></i><span>Instagram</span>
      </a>
    `);
  }
  if (phoneHref) {
    contactButtons.push(`
      <a href="${esc(phoneHref)}" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition whitespace-nowrap">
        <i class="fas fa-phone text-xs"></i><span>${esc(phoneClean)}</span>
      </a>
    `);
  }
  if (emailDefaultHref) {
    contactButtons.push(`
      <a href="${esc(emailDefaultHref)}" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-extrabold transition whitespace-nowrap">
        <i class="fas fa-envelope text-xs"></i><span>${esc(emailClean)}</span>
      </a>
    `);
  }
  if (webHref) {
    contactButtons.push(`
      <a href="${esc(webHref)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-extrabold transition whitespace-nowrap">
        <i class="fas fa-globe text-xs"></i><span>Website</span>
      </a>
    `);
  }

  const upgradeablePlans = activePlans.filter((p) => inferPlanTierKey(p) !== 'free');
  const canRequestInApp = contextType !== 'preview' && Boolean(institutionSlug) && Boolean(window.__firebaseAuth?.currentUser);
  const defaultSelectedPlan = upgradeablePlans.find((p) => inferPlanTierKey(p) === recommendedTier)
    || upgradeablePlans.find((p) => inferPlanTierKey(p) === (currentTier === 'standard' && !isTrialActive ? 'elite' : 'standard'))
    || upgradeablePlans[0];

  const inAppRequestHtml = canRequestInApp ? `
    <div id="premium-modal-inapp-request" class="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
      <div>
        <div class="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
          <i class="fas fa-paper-plane text-blue-600"></i>
          <span>Request Instant Plan Upgrade</span>
        </div>
        <p class="text-[11px] text-slate-600 mt-0.5">Submit an in-app upgrade request to the platform team. They will review and activate your selected plan with zero data loss.</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <select id="premium-upgrade-plan-select" class="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 outline-none focus:border-blue-500">
          ${upgradeablePlans.length > 0
            ? upgradeablePlans.map((p) => {
              const tKey = inferPlanTierKey(p);
              const selected = defaultSelectedPlan && defaultSelectedPlan.id === p.id ? 'selected' : '';
              return `<option value="${esc(p.id)}" data-plan-name="${esc(p.name)}" data-plan-tier="${esc(tKey)}" ${selected}>${esc(p.name)} (${esc(p.currency)}${esc(formatPriceNumber(p.offerPrice))} / ${esc(p.billingCycle)})</option>`;
            }).join('')
            : '<option value="tier_standard" data-plan-name="Standard" data-plan-tier="standard">Standard Plan</option><option value="tier_elite" data-plan-name="ELITE" data-plan-tier="elite">ELITE Plan</option>'
          }
        </select>
        <input id="premium-upgrade-phone" type="tel" maxlength="20" placeholder="Contact mobile / WhatsApp" class="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none focus:border-blue-500">
        <input id="premium-upgrade-note" type="text" maxlength="200" placeholder="Optional note (e.g. Standard or ELITE)" class="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none focus:border-blue-500">
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div id="premium-upgrade-feedback" class="text-xs font-bold text-slate-700 min-h-[1rem]"></div>
        <button type="button" id="premium-upgrade-submit-btn" class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold transition cursor-pointer whitespace-nowrap">
          <i class="fas fa-bolt text-[11px]"></i>
          <span>Submit Upgrade Request</span>
        </button>
      </div>
    </div>
  ` : '';

  const contactSectionHtml = `
    <div id="premium-modal-contact-section" class="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-10 h-10 rounded-xl bg-white border border-slate-200 p-1.5 flex items-center justify-center shrink-0">
          <img src="/assets/images/logo.png" alt="Company Logo" class="w-full h-full object-contain rounded-lg" referrerpolicy="no-referrer">
        </div>
        <div class="space-y-0.5 min-w-0">
          <div class="text-xs font-extrabold text-slate-900">
            ${esc(contact.brandName || 'Institution Manage — Support & Upgrades')}
          </div>
          <p class="text-xs text-slate-600 leading-relaxed">
            ${esc(contact.supportNote || 'Contact us on WhatsApp or phone for quick activation and institutional pricing.')}
          </p>
        </div>
      </div>
      ${contactButtons.length > 0 ? `<div class="flex flex-wrap items-center gap-2 shrink-0">${contactButtons.join('')}</div>` : ''}
    </div>
  `;

  const showCompareFirst = initialView === 'compare';

  container.innerHTML = `
    <div class="space-y-5">
      ${bannerHtml}

      <!-- Clean Segmented Switch: Plans vs Compare Plans -->
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
          <button type="button" data-plan-view-tab="plans" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${!showCompareFirst ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}">
            Plans (Free · Standard · ELITE)
          </button>
          <button type="button" data-plan-view-tab="compare" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${showCompareFirst ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}">
            Compare Plans
          </button>
        </div>
        <span class="text-[11px] font-semibold text-slate-500">Click <strong>More</strong> on any plan for full modules &amp; quota details.</span>
      </div>

      <div id="shared-plans-cards-pane" class="${showCompareFirst ? 'hidden' : ''}">
        ${plansViewHtml}
      </div>
      <div id="shared-plans-compare-pane" class="${showCompareFirst ? '' : 'hidden'}">
        ${compareViewHtml}
      </div>

      ${inAppRequestHtml}
      ${contactSectionHtml}
    </div>
  `;

  // Tab switch handler
  const switchTab = (target) => {
    const cardsPane = container.querySelector('#shared-plans-cards-pane');
    const comparePane = container.querySelector('#shared-plans-compare-pane');
    cardsPane?.classList.toggle('hidden', target !== 'plans');
    comparePane?.classList.toggle('hidden', target !== 'compare');
    container.querySelectorAll('[data-plan-view-tab]').forEach((btn) => {
      const active = btn.dataset.planViewTab === target;
      btn.className = `px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${active ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`;
    });
  };
  container.querySelectorAll('[data-plan-view-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.planViewTab));
  });

  const handlePlanSelect = (plan) => {
    const tKey = inferPlanTierKey(plan);
    if (canRequestInApp) {
      const sel = container.querySelector('#premium-upgrade-plan-select');
      if (sel) {
        const matchOpt = Array.from(sel.options).find((o) => o.value === plan.id || o.dataset.planTier === tKey);
        if (matchOpt) sel.value = matchOpt.value;
      }
      const reqBox = container.querySelector('#premium-modal-inapp-request');
      reqBox?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      container.querySelector('#premium-upgrade-phone')?.focus();
      return;
    }
    const priceDisplay = plan.offerPrice > 0 ? `${plan.currency}${formatPriceNumber(plan.offerPrice)}` : `${plan.currency}0`;
    const planInquiry = buildInquiryText({
      planName: plan.name,
      planPriceText: `${priceDisplay} / ${plan.billingCycle}`,
      moduleName,
      contextType,
      institutionName,
      institutionSlug
    });
    const href = waDigits
      ? `https://wa.me/${waDigits}?text=${encodeURIComponent(planInquiry)}`
      : (emailClean ? `mailto:${encodeURIComponent(emailClean)}?subject=${encodeURIComponent(`Enquiry: ${plan.name} Plan`)}&body=${encodeURIComponent(planInquiry)}` : phoneHref || '');
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    } else {
      container.querySelector('#premium-modal-contact-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Bind card CTAs
  container.querySelectorAll('[data-plan-cta-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const plan = activePlans.find((p) => p.id === btn.dataset.planCtaId);
      if (plan) handlePlanSelect(plan);
    });
  });

  // Bind "More" Full Details button on every card
  container.querySelectorAll('[data-plan-more-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = activePlans.find((p) => p.id === btn.dataset.planMoreId);
      if (!plan) return;
      const tKey = inferPlanTierKey(plan);
      openPlanFullDetailsModal(plan, catalog, {
        actionLabel: tKey === 'free' ? 'Close' : `Request ${plan.name} Upgrade`,
        onSelectPlan: tKey === 'free' ? null : (selectedPlan) => handlePlanSelect(selectedPlan)
      });
    });
  });

  // Bind In-App Upgrade Request submit
  const submitBtn = container.querySelector('#premium-upgrade-submit-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const planSelect = container.querySelector('#premium-upgrade-plan-select');
      const phoneInput = container.querySelector('#premium-upgrade-phone');
      const noteInput = container.querySelector('#premium-upgrade-note');
      const feedbackEl = container.querySelector('#premium-upgrade-feedback');

      const selectedOpt = planSelect?.selectedOptions?.[0];
      const requestedPlanId = String(planSelect?.value || 'tier_standard').trim();
      const requestedPlanName = String(selectedOpt?.dataset?.planName || selectedOpt?.textContent || 'Standard').trim();
      const requestedTier = String(selectedOpt?.dataset?.planTier || 'standard').trim().toLowerCase();
      const contactPhone = String(phoneInput?.value || '').trim();
      const note = String(noteInput?.value || '').trim();

      submitBtn.disabled = true;
      const origHtml = submitBtn.innerHTML;
      submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-[11px]"></i><span>Sending...</span>';
      if (feedbackEl) {
        feedbackEl.className = 'text-xs font-bold text-blue-800';
        feedbackEl.textContent = 'Submitting your upgrade request...';
      }

      try {
        const res = await submitUpgradeRequest({
          institutionId: institutionSlug,
          requestedTier,
          requestedPlanId,
          requestedPlanName,
          requestedFeature: moduleName || contextType,
          contactPhone,
          note
        });
        if (feedbackEl) {
          feedbackEl.className = 'text-xs font-bold text-emerald-700';
          feedbackEl.innerHTML = `<i class="fas fa-circle-check mr-1"></i>${esc(res?.message || 'Upgrade request submitted! Our team will contact you shortly.')}`;
        }
        submitBtn.innerHTML = '<i class="fas fa-check text-[11px]"></i><span>Request Sent</span>';
        submitBtn.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-extrabold whitespace-nowrap cursor-default';
      } catch (err) {
        if (feedbackEl) {
          feedbackEl.className = 'text-xs font-bold text-rose-700';
          feedbackEl.textContent = err?.message || 'Could not submit request. Please use WhatsApp below.';
        }
        submitBtn.disabled = false;
        submitBtn.innerHTML = origHtml;
      }
    });
  }
};

// --- Public Homepage Pricing Section Renderer (Reuses the exact same 3-Tier Cards, More Modal & Compare Matrix) ---
export const renderPublicPricingSection = async (container, {
  db = defaultDb,
  onStartFreeTrial = null
} = {}) => {
  if (!container) return;
  container.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
      <div class="h-80 rounded-2xl bg-slate-100 border border-slate-200"></div>
      <div class="h-80 rounded-2xl bg-blue-50/50 border border-blue-200"></div>
      <div class="h-80 rounded-2xl bg-slate-900/10 border border-slate-200"></div>
    </div>
  `;

  let catalog = normalizePublicCatalog({});
  try {
    catalog = await fetchCompanyPublicCatalog({ db });
  } catch (_) {}

  const activePlans = (catalog.plans || []).filter((p) => p.isActive !== false);
  const trialDays = catalog?.selfSignupConfig?.trialDays ?? DEFAULT_TRIAL_DAYS;
  const waDigits = buildWhatsappDigits(catalog?.contact?.whatsapp || '');

  const triggerPlanAction = (plan) => {
    const tKey = inferPlanTierKey(plan);
    if (tKey === 'free' && typeof onStartFreeTrial === 'function') {
      onStartFreeTrial();
      return;
    }
    if (waDigits) {
      const priceDisplay = plan.offerPrice > 0 ? `${plan.currency}${formatPriceNumber(plan.offerPrice)}` : `${plan.currency}0`;
      const inquiry = buildInquiryText({
        planName: plan.name,
        planPriceText: `${priceDisplay} / ${plan.billingCycle}`,
        contextType: 'module'
      });
      const link = document.createElement('a');
      link.href = `https://wa.me/${waDigits}?text=${encodeURIComponent(inquiry)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
      return;
    }
    if (typeof onStartFreeTrial === 'function') {
      onStartFreeTrial();
    } else {
      openPremiumPlansModal({ contextType: 'module', moduleName: `${plan.name} Plan` });
    }
  };

  container.innerHTML = `
    <div class="space-y-6">
      <div>
        <div class="text-[11px] font-extrabold text-blue-600 uppercase tracking-[0.1em] mb-1.5">
          Transparent Plans
        </div>
        <h2 class="text-xl sm:text-3xl font-extrabold text-slate-950 tracking-tight" style="text-wrap: balance;">
          Start Free Forever, Scale Anytime
        </h2>
        <p class="text-xs sm:text-sm text-slate-600 mt-1 max-w-2xl">
          Use the Free plan forever with zero lock-in${trialDays > 0 ? ` — plus get ${trialDays} days of Standard access automatically on signup` : ''}. Upgrade to Standard or ELITE whenever your campus grows.
        </p>
      </div>

      ${renderTierCardsGridHtml(activePlans, catalog, { mode: 'public' })}
    </div>
  `;

  // Mobile horizontal swipe dot synchronization for public plans
  const pricingTrack = container.querySelector('#public-pricing-track');
  const pricingDots = Array.from(container.querySelectorAll('[data-pricing-dot]'));
  const pricingCards = Array.from(container.querySelectorAll('[data-public-plan-idx]'));
  if (pricingTrack && pricingDots.length > 1 && pricingCards.length > 1) {
    const syncPricingDots = (activeIdx) => {
      pricingDots.forEach((dot, idx) => {
        const active = idx === activeIdx;
        dot.className = active
          ? 'h-1.5 w-5 rounded-full bg-blue-600 transition-all cursor-pointer'
          : 'h-1.5 w-1.5 rounded-full bg-slate-300 hover:bg-slate-400 transition-all cursor-pointer';
      });
    };

    pricingDots.forEach((dot, idx) => {
      dot.addEventListener('click', () => {
        const card = pricingCards[idx];
        if (!card) return;
        const targetLeft = card.offsetLeft - pricingTrack.offsetLeft;
        pricingTrack.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        syncPricingDots(idx);
      });
    });

    let pricingScrollRaf = 0;
    pricingTrack.addEventListener('scroll', () => {
      if (pricingScrollRaf) return;
      pricingScrollRaf = window.requestAnimationFrame(() => {
        pricingScrollRaf = 0;
        const center = pricingTrack.scrollLeft + (pricingTrack.clientWidth / 2);
        let closestIdx = 0;
        let closestDist = Infinity;
        pricingCards.forEach((card, idx) => {
          const cardCenter = (card.offsetLeft - pricingTrack.offsetLeft) + (card.offsetWidth / 2);
          const dist = Math.abs(cardCenter - center);
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = idx;
          }
        });
        syncPricingDots(closestIdx);
      });
    }, { passive: true });
  }

  container.querySelectorAll('[data-plan-cta-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = activePlans.find((p) => p.id === btn.dataset.planCtaId);
      if (plan) triggerPlanAction(plan);
    });
  });

  container.querySelectorAll('[data-plan-compare-trigger]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPlanComparisonModal(catalog);
    });
  });

  container.querySelectorAll('[data-plan-more-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = activePlans.find((p) => p.id === btn.dataset.planMoreId);
      if (!plan) return;
      const tKey = inferPlanTierKey(plan);
      openPlanFullDetailsModal(plan, catalog, {
        actionLabel: tKey === 'free' ? 'Start Free Now' : `Get ${plan.name}`,
        onSelectPlan: (selectedPlan) => triggerPlanAction(selectedPlan)
      });
    });
  });
};

export const openPremiumPlansModal = async ({
  db = defaultDb,
  contextType = 'module',
  moduleName = '',
  moduleKey = '',
  institutionName = '',
  institutionSlug = '',
  pauseReason = '',
  expiryDate = '',
  customReason = '',
  currentTier = '',
  isTrialActive = false,
  trialRemainingLabel = '',
  recommendedTier = '',
  initialView = 'plans',
  forceRefresh = false,
  catalogOverride = null
} = {}) => {
  if (typeof document === 'undefined') return;
  closePremiumPlansModal();

  const winPlan = window.__institutionPlanState || null;
  const resolvedSlug = institutionSlug || winPlan?.institutionSlug || (INSTITUTION_ID !== 'school' ? INSTITUTION_ID : '');
  const resolvedInstName = institutionName || winPlan?.institutionName || '';
  const resolvedCurrentTier = currentTier || (contextType === 'preview' ? '' : (winPlan?.effectiveTier || ''));
  const resolvedTrialActive = typeof isTrialActive === 'boolean' && isTrialActive
    ? true
    : (contextType !== 'preview' && Boolean(winPlan?.isTrialActive));
  const resolvedTrialRemaining = trialRemainingLabel || (resolvedTrialActive ? (winPlan?.trialRemainingLabel || '') : '');

  const resolvedHeader = resolveContextHeader({
    contextType,
    moduleName: moduleName || MODULE_LABELS[moduleKey] || '',
    institutionName: resolvedInstName,
    pauseReason,
    expiryDate,
    customReason,
    isTrialActive: resolvedTrialActive,
    trialRemainingLabel: resolvedTrialRemaining
  });

  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.style.zIndex = '1000000';
  modal.className = 'fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden" style="font-family:'Plus Jakarta Sans',sans-serif;">
      <div class="px-5 py-4 sm:px-6 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-11 h-11 rounded-2xl bg-white border border-slate-200 p-1.5 flex items-center justify-center shrink-0">
            <img src="/assets/images/logo.png" alt="Company Logo" class="w-full h-full object-contain rounded-xl" referrerpolicy="no-referrer">
          </div>
          <div class="min-w-0">
            <div class="text-[11px] font-extrabold uppercase tracking-wider text-blue-700 truncate">${esc(resolvedHeader.kicker)}</div>
            <h3 class="text-base sm:text-lg font-extrabold text-slate-900 leading-snug">${esc(resolvedHeader.title)}</h3>
            <p class="text-xs text-slate-600 mt-0.5 leading-relaxed">${esc(resolvedHeader.subtitle)}</p>
          </div>
        </div>
        <button type="button" id="shared-premium-modal-close" class="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center shrink-0 cursor-pointer transition" aria-label="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div id="shared-premium-modal-body" class="p-5 sm:p-6 overflow-y-auto flex-1">
        <div class="py-12 text-center space-y-3">
          <div class="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center text-lg">
            <i class="fas fa-circle-notch fa-spin"></i>
          </div>
          <p class="text-xs font-bold text-slate-500">Loading plans and comparison...</p>
        </div>
      </div>

      <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <span class="text-[11px] font-semibold text-slate-500 truncate">
          <i class="fas fa-shield-halved text-emerald-600 mr-1"></i>All existing data stays 100% safe during plan changes.
        </span>
        <button type="button" id="shared-premium-modal-done" class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold cursor-pointer transition whitespace-nowrap shrink-0">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add('overflow-hidden');

  const onEscape = (e) => {
    if (e.key === 'Escape' && !document.getElementById(DETAIL_MODAL_ID)) {
      document.removeEventListener('keydown', onEscape);
      closePremiumPlansModal();
    }
  };
  document.addEventListener('keydown', onEscape);

  const cleanupAndClose = () => {
    document.removeEventListener('keydown', onEscape);
    closePremiumPlansModal();
  };

  modal.addEventListener('click', (e) => {
    if (e.target === modal) cleanupAndClose();
  });
  modal.querySelector('#shared-premium-modal-close')?.addEventListener('click', cleanupAndClose);
  modal.querySelector('#shared-premium-modal-done')?.addEventListener('click', cleanupAndClose);

  const bodyEl = modal.querySelector('#shared-premium-modal-body');
  if (!bodyEl) return;

  const loadAndRender = async (force = forceRefresh) => {
    try {
      const catalog = catalogOverride
        ? normalizePublicCatalog(catalogOverride)
        : await fetchCompanyPublicCatalog({ db, forceRefresh: force });
      renderCatalogContent(bodyEl, catalog, {
        contextType,
        moduleName: moduleName || MODULE_LABELS[moduleKey] || '',
        institutionName: resolvedInstName,
        institutionSlug: resolvedSlug,
        currentTier: resolvedCurrentTier,
        isTrialActive: resolvedTrialActive,
        trialRemainingLabel: resolvedTrialRemaining,
        recommendedTier,
        initialView
      });
    } catch (err) {
      console.error('Failed to load plans catalog:', err);
      bodyEl.innerHTML = `
        <div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center space-y-3">
          <div class="w-11 h-11 rounded-xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center text-lg">
            <i class="fas fa-triangle-exclamation"></i>
          </div>
          <h4 class="text-sm font-extrabold text-rose-950">Could Not Load Plans</h4>
          <p class="text-xs text-rose-700 max-w-sm mx-auto">Please check your connection and try again.</p>
          <button type="button" id="shared-premium-retry-btn" class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold cursor-pointer">
            Retry
          </button>
        </div>
      `;
      bodyEl.querySelector('#shared-premium-retry-btn')?.addEventListener('click', () => loadAndRender(true));
    }
  };

  await loadAndRender(forceRefresh);
};
