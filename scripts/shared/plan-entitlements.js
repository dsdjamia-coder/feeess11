import {
  BASIC_PLAN_ALLOWED_PAGES,
  BASIC_PLAN_FEATURES,
  DEFAULT_BASIC_PLAN_LIMITS,
  DEFAULT_COMPANY_ALLOWED_PAGES,
  DEFAULT_PREMIUM_PLAN_LIMITS,
  PREMIUM_PLAN_FEATURES
} from '../../config/app-config.js';
import { openPremiumPlansModal } from './premium-plans-modal.js';

export const PLAN_FEATURE_LABELS = {
  excelBulkImport: 'Excel Bulk Import',
  excelExport: 'Excel & Bulk Data Export',
  blankSheets: 'Blank Printable Sheets & Templates',
  multiAcademicYears: 'Multi-Academic Year Management',
  batchPromotion: 'Batch Promotion',
  alumniManagement: 'Alumni Management',
  studentContinuity: 'Student Continuity Tracker',
  studentGroups: 'Student Groups & Sibling Bundles',
  feeConcessions: 'Fee Concessions & Scholarships',
  transferCertificates: 'Transfer Certificates (TC)',
  customStudentFields: 'Custom Student Fields',
  customDirectoryCategories: 'Custom Directory Categories',
  backupAndAudit: 'Backup, Restore & Audit Logs',
  workflowOverrides: 'Advanced Workflow Overrides',
  masterLedger: 'Master Ledger & Analytics',
  advancedFeeReports: 'Advanced Financial Reports',
  donations: 'Donations Management',
  bulkWhatsappReminders: 'Bulk WhatsApp Reminders',
  bulkReportCards: 'Bulk Report Cards & Rank Sheets',
  resultPromotionEngine: 'Automated Result Promotion Engine',
  studentSelfEdit: 'Student Self Photo & Profile Edit',
  siblingSwitcher: 'Multi-Sibling Switcher'
};

export const PLAN_LIMIT_LABELS = {
  maxStudents: 'Students',
  maxStaff: 'Staff Accounts',
  maxClasses: 'Classes',
  maxAcademicYears: 'Academic Years',
  maxFeeItems: 'Custom Fee Heads',
  maxNotices: 'Public Notices',
  maxGalleryPhotos: 'Gallery Photos',
  maxExamsPerYear: 'Exams per Year',
  maxDirectoryEntries: 'Directory Entries'
};

const esc = (val = '') => String(val ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

let activePlanState = {
  planTier: 'premium',
  planName: 'Premium',
  isBasic: false,
  isPremium: true,
  isLifetime: true,
  signupSource: 'manual',
  verificationStatus: 'verified',
  institutionName: '',
  institutionSlug: '',
  allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES },
  limits: { ...DEFAULT_PREMIUM_PLAN_LIMITS },
  features: { ...PREMIUM_PLAN_FEATURES },
  rawInstitution: null
};

const planListeners = new Set();

const normalizeLimitValue = (val, fallback) => {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
};

export const resolveInstitutionPlan = (institutionData = null) => {
  if (!institutionData || typeof institutionData !== 'object') {
    return {
      planTier: 'premium',
      planName: 'Premium',
      isBasic: false,
      isPremium: true,
      isLifetime: true,
      signupSource: 'manual',
      verificationStatus: 'verified',
      institutionName: '',
      institutionSlug: '',
      allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES },
      limits: { ...DEFAULT_PREMIUM_PLAN_LIMITS },
      features: { ...PREMIUM_PLAN_FEATURES },
      rawInstitution: null
    };
  }

  // Backward compatibility: existing institutions without planTier remain 'premium'
  const rawTier = String(institutionData.planTier || '').trim().toLowerCase();
  const isBasic = rawTier === 'basic';
  const planTier = isBasic ? 'basic' : 'premium';

  const baseLimits = isBasic ? DEFAULT_BASIC_PLAN_LIMITS : DEFAULT_PREMIUM_PLAN_LIMITS;
  const rawLimits = institutionData.planLimits && typeof institutionData.planLimits === 'object'
    ? institutionData.planLimits
    : {};

  const limits = {};
  Object.keys(baseLimits).forEach((key) => {
    if (key in rawLimits && rawLimits[key] !== '' && rawLimits[key] !== null && rawLimits[key] !== undefined) {
      limits[key] = normalizeLimitValue(rawLimits[key], baseLimits[key]);
    } else {
      limits[key] = baseLimits[key];
    }
  });

  const baseFeatures = isBasic ? BASIC_PLAN_FEATURES : PREMIUM_PLAN_FEATURES;
  const rawFeatures = institutionData.planFeatures && typeof institutionData.planFeatures === 'object'
    ? institutionData.planFeatures
    : {};
  const features = {};
  Object.keys(baseFeatures).forEach((key) => {
    features[key] = typeof rawFeatures[key] === 'boolean' ? rawFeatures[key] : baseFeatures[key];
  });

  const basePages = isBasic ? BASIC_PLAN_ALLOWED_PAGES : DEFAULT_COMPANY_ALLOWED_PAGES;
  const rawPages = institutionData.allowedPages && typeof institutionData.allowedPages === 'object'
    ? institutionData.allowedPages
    : {};
  const allowedPages = { ...basePages };
  Object.keys(allowedPages).forEach((key) => {
    if (key in rawPages) {
      allowedPages[key] = rawPages[key] !== false;
    }
  });

  const instSlug = String(institutionData.slug || institutionData.id || '').trim().toLowerCase();
  const instName = String(institutionData.name || instSlug || '').trim();
  const planName = String(
    institutionData.planName || (isBasic ? 'Basic (Free)' : 'Premium')
  ).trim();

  return {
    planTier,
    planName,
    isBasic,
    isPremium: !isBasic,
    isLifetime: institutionData.isLifetime === true || isBasic,
    signupSource: String(institutionData.signupSource || 'manual').trim().toLowerCase(),
    verificationStatus: String(
      institutionData.verificationStatus || (institutionData.signupSource === 'self_signup' ? 'unverified' : 'verified')
    ).trim().toLowerCase(),
    institutionName: instName,
    institutionSlug: instSlug,
    allowedPages,
    limits,
    features,
    rawInstitution: institutionData
  };
};

export const setActiveInstitutionPlan = (institutionData = null) => {
  activePlanState = resolveInstitutionPlan(institutionData);
  if (typeof window !== 'undefined') {
    window.__institutionPlanState = activePlanState;
  }
  planListeners.forEach((fn) => {
    try {
      fn(activePlanState);
    } catch (_) {}
  });
  return activePlanState;
};

export const getActiveInstitutionPlan = () => activePlanState;

export const onPlanChange = (listener) => {
  if (typeof listener !== 'function') return () => {};
  planListeners.add(listener);
  return () => planListeners.delete(listener);
};

export const isBasicPlan = (institutionData = null) => {
  const plan = institutionData ? resolveInstitutionPlan(institutionData) : activePlanState;
  return plan.isBasic === true;
};

export const isPremiumPlan = (institutionData = null) => !isBasicPlan(institutionData);

export const hasFeature = (featureKey, institutionData = null) => {
  const plan = institutionData ? resolveInstitutionPlan(institutionData) : activePlanState;
  if (!featureKey) return true;
  if (plan.isPremium && !(featureKey in plan.features)) return true;
  return plan.features[featureKey] !== false;
};

export const getPlanLimit = (limitKey, institutionData = null) => {
  const plan = institutionData ? resolveInstitutionPlan(institutionData) : activePlanState;
  if (!limitKey) return 0;
  const val = Number(plan.limits?.[limitKey] ?? 0);
  return Number.isFinite(val) && val > 0 ? val : 0; // 0 means unlimited
};

export const checkQuotaLimit = (limitKey, currentCount = 0, institutionData = null) => {
  const limit = getPlanLimit(limitKey, institutionData);
  const count = Math.max(0, Number(currentCount || 0));
  if (!limit || limit <= 0) {
    return {
      allowed: true,
      limit: 0,
      currentCount: count,
      remaining: Infinity,
      label: PLAN_LIMIT_LABELS[limitKey] || limitKey
    };
  }
  const remaining = Math.max(0, limit - count);
  return {
    allowed: count < limit,
    limit,
    currentCount: count,
    remaining,
    label: PLAN_LIMIT_LABELS[limitKey] || limitKey
  };
};

export const openFeatureUpgradePrompt = ({
  featureKey = '',
  featureName = '',
  limitKey = '',
  currentCount = 0,
  limit = 0,
  contextType = '',
  customMessage = ''
} = {}) => {
  const plan = activePlanState;
  const isQuota = contextType === 'quota' || Boolean(limitKey);
  const resolvedFeature = featureName || PLAN_FEATURE_LABELS[featureKey] || (limitKey ? `${PLAN_LIMIT_LABELS[limitKey] || limitKey} Limit` : 'Premium Feature');
  const resolvedLimit = limit || (limitKey ? getPlanLimit(limitKey) : 0);

  const quotaSummary = isQuota && resolvedLimit > 0
    ? `You have reached the Basic Plan limit of ${resolvedLimit} ${PLAN_LIMIT_LABELS[limitKey] || 'records'} (currently ${currentCount}/${resolvedLimit}). Upgrade to Premium for unlimited capacity.`
    : '';

  return openPremiumPlansModal({
    contextType: isQuota ? 'quota' : 'feature',
    moduleName: resolvedFeature,
    moduleKey: featureKey || limitKey,
    institutionName: plan.institutionName,
    institutionSlug: plan.institutionSlug,
    customReason: customMessage || quotaSummary
  });
};

export const requirePlanFeature = (featureKey, featureName = '') => {
  if (hasFeature(featureKey)) return true;
  openFeatureUpgradePrompt({
    featureKey,
    featureName: featureName || PLAN_FEATURE_LABELS[featureKey] || 'Premium Feature',
    contextType: 'feature'
  });
  return false;
};

export const requirePlanQuota = (limitKey, currentCount = 0, customMessage = '') => {
  const check = checkQuotaLimit(limitKey, currentCount);
  if (check.allowed) return true;
  openFeatureUpgradePrompt({
    limitKey,
    currentCount: check.currentCount,
    limit: check.limit,
    contextType: 'quota',
    customMessage
  });
  return false;
};

export const decorateProLockElement = (el, { featureKey = '', featureName = '', badgeText = 'PRO' } = {}) => {
  if (!el) return;
  const unlocked = hasFeature(featureKey);
  const existingBadge = el.querySelector('.plan-pro-lock-badge');

  if (unlocked) {
    el.removeAttribute('data-plan-locked');
    el.classList.remove('plan-pro-locked-control');
    if (existingBadge) existingBadge.remove();
    return;
  }

  el.setAttribute('data-plan-locked', featureKey || 'premium');
  el.classList.add('plan-pro-locked-control');
  if (!existingBadge) {
    const badge = document.createElement('span');
    badge.className = 'plan-pro-lock-badge ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-extrabold uppercase tracking-wider shrink-0';
    badge.innerHTML = `<i class="fas fa-crown text-[8px] text-amber-600"></i>${esc(badgeText)}`;
    el.appendChild(badge);
  }

  if (!el.dataset.planLockBound) {
    el.dataset.planLockBound = '1';
    el.addEventListener('click', (e) => {
      if (el.getAttribute('data-plan-locked')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFeatureUpgradePrompt({
          featureKey,
          featureName: featureName || PLAN_FEATURE_LABELS[featureKey] || 'Premium Feature',
          contextType: 'feature'
        });
      }
    }, true);
  }
};

export const renderPlanUsageBanner = (container, usage = {}, { compact = false } = {}) => {
  if (!container) return;
  const plan = activePlanState;
  if (!plan.isBasic) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  const metrics = [];
  if (typeof usage.students === 'number') {
    metrics.push({ label: 'Students', count: usage.students, max: plan.limits.maxStudents });
  }
  if (typeof usage.staff === 'number') {
    metrics.push({ label: 'Staff', count: usage.staff, max: plan.limits.maxStaff });
  }
  if (typeof usage.classes === 'number') {
    metrics.push({ label: 'Classes', count: usage.classes, max: plan.limits.maxClasses });
  }
  if (typeof usage.exams === 'number') {
    metrics.push({ label: 'Exams', count: usage.exams, max: plan.limits.maxExamsPerYear });
  }
  if (typeof usage.feeItems === 'number') {
    metrics.push({ label: 'Fee Heads', count: usage.feeItems, max: plan.limits.maxFeeItems });
  }

  const metricPills = metrics
    .filter((m) => m.max > 0)
    .map((m) => {
      const pct = Math.min(100, Math.round((m.count / m.max) * 100));
      const nearLimit = pct >= 85;
      const chipColor = nearLimit
        ? 'bg-rose-50 text-rose-800 border-rose-200'
        : 'bg-white text-slate-700 border-amber-200';
      return `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${chipColor} text-[11px] font-bold tabular-nums">
          <span>${esc(m.label)}:</span>
          <span class="font-extrabold">${m.count}/${m.max}</span>
        </span>
      `;
    })
    .join('');

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50/70 ${compact ? 'px-3.5 py-2.5' : 'px-4 py-3'} flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
      <div class="flex flex-wrap items-center gap-2.5 min-w-0">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500 text-white text-[11px] font-extrabold uppercase tracking-wide shrink-0">
          <i class="fas fa-seedling text-[10px]"></i>Basic Free Plan
        </span>
        ${metricPills ? `<div class="flex flex-wrap items-center gap-1.5">${metricPills}</div>` : `<span class="text-xs font-semibold text-slate-600">Free Forever · Upgrade anytime to unlock all 10 modules & bulk tools.</span>`}
      </div>
      <button type="button" data-plan-upgrade-cta="true" class="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition cursor-pointer whitespace-nowrap shrink-0">
        <i class="fas fa-crown text-amber-400 text-[11px]"></i>
        <span>Upgrade to Premium</span>
      </button>
    </div>
  `;

  container.querySelector('[data-plan-upgrade-cta="true"]')?.addEventListener('click', () => {
    openPremiumPlansModal({
      contextType: 'feature',
      moduleName: 'Full Premium Access',
      institutionName: plan.institutionName,
      institutionSlug: plan.institutionSlug
    });
  });
};
