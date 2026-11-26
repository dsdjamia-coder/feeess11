import {
  DEFAULT_COMPANY_ALLOWED_PAGES,
  DEFAULT_ELITE_PLAN_LIMITS,
  DEFAULT_FREE_PLAN_LIMITS,
  DEFAULT_STANDARD_PLAN_LIMITS,
  ELITE_PLAN_ALLOWED_PAGES,
  ELITE_PLAN_FEATURES,
  FREE_PLAN_ALLOWED_PAGES,
  FREE_PLAN_FEATURES,
  STANDARD_PLAN_ALLOWED_PAGES,
  STANDARD_PLAN_FEATURES
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

export const PLAN_TIER_LABELS = {
  free: 'Free',
  standard: 'Standard',
  elite: 'ELITE'
};

const esc = (val = '') => String(val ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const normalizePlanTier = (rawTier = '', fallback = 'elite') => {
  const clean = String(rawTier || '').trim().toLowerCase();
  if (!clean) return fallback;
  if (clean === 'free' || clean === 'basic' || clean === 'starter') return 'free';
  if (clean === 'standard' || clean === 'pro' || clean === 'growth') return 'standard';
  if (clean === 'elite' || clean === 'premium' || clean === 'enterprise' || clean === 'unlimited') return 'elite';
  return fallback;
};

const parseTimestampMs = (val) => {
  if (!val) return 0;
  if (typeof val === 'number') return Number.isFinite(val) && val > 0 ? val : 0;
  if (typeof val?.toMillis === 'function') return val.toMillis();
  if (typeof val?.seconds === 'number') return val.seconds * 1000;
  const parsed = Date.parse(String(val));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const formatRemainingDuration = (ms = 0) => {
  const diff = Math.max(0, Number(ms || 0));
  if (diff <= 0) return 'Ended';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${Math.max(1, mins)}m left`;
};

const getTierDefaults = (tier = 'elite') => {
  if (tier === 'free') {
    return {
      limits: DEFAULT_FREE_PLAN_LIMITS,
      features: FREE_PLAN_FEATURES,
      pages: FREE_PLAN_ALLOWED_PAGES
    };
  }
  if (tier === 'standard') {
    return {
      limits: DEFAULT_STANDARD_PLAN_LIMITS,
      features: STANDARD_PLAN_FEATURES,
      pages: STANDARD_PLAN_ALLOWED_PAGES
    };
  }
  return {
    limits: DEFAULT_ELITE_PLAN_LIMITS,
    features: ELITE_PLAN_FEATURES,
    pages: ELITE_PLAN_ALLOWED_PAGES
  };
};

export const getRequiredTierForFeature = (featureKey = '') => {
  if (!featureKey) return 'standard';
  if (FREE_PLAN_FEATURES[featureKey] === true) return 'free';
  if (STANDARD_PLAN_FEATURES[featureKey] === true) return 'standard';
  return 'elite';
};

export const getRequiredTierForModule = (moduleKey = '') => {
  let clean = String(moduleKey || '').trim();
  if (clean === 'activity') clean = 'studentActivity';
  if (clean === 'evaluation') clean = 'classroomEvaluation';
  if (FREE_PLAN_ALLOWED_PAGES[clean] === true) return 'free';
  if (STANDARD_PLAN_ALLOWED_PAGES[clean] === true) return 'standard';
  return 'elite';
};

let activePlanState = {
  basePlanTier: 'elite',
  effectiveTier: 'elite',
  planTier: 'elite',
  planName: 'ELITE',
  isFree: false,
  isBasic: false,
  isStandard: false,
  isElite: true,
  isPremium: true,
  isTrialActive: false,
  isTrialExpired: false,
  trialTier: '',
  trialEndsAtMs: 0,
  trialRemainingMs: 0,
  trialRemainingLabel: '',
  isLifetime: true,
  signupSource: 'manual',
  verificationStatus: 'verified',
  institutionName: '',
  institutionSlug: '',
  allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES },
  limits: { ...DEFAULT_ELITE_PLAN_LIMITS },
  features: { ...ELITE_PLAN_FEATURES },
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
      basePlanTier: 'elite',
      effectiveTier: 'elite',
      planTier: 'elite',
      planName: 'ELITE',
      isFree: false,
      isBasic: false,
      isStandard: false,
      isElite: true,
      isPremium: true,
      isTrialActive: false,
      isTrialExpired: false,
      trialTier: '',
      trialEndsAtMs: 0,
      trialRemainingMs: 0,
      trialRemainingLabel: '',
      isLifetime: true,
      signupSource: 'manual',
      verificationStatus: 'verified',
      institutionName: '',
      institutionSlug: '',
      allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES },
      limits: { ...DEFAULT_ELITE_PLAN_LIMITS },
      features: { ...ELITE_PLAN_FEATURES },
      rawInstitution: null
    };
  }

  // Backward compatibility:
  // - legacy 'basic' -> 'free'
  // - legacy 'premium' or unset planTier -> 'elite'
  const basePlanTier = normalizePlanTier(institutionData.planTier, 'elite');

  const rawTrialTier = String(institutionData.trialTier || '').trim().toLowerCase();
  const normalizedTrialTier = rawTrialTier ? normalizePlanTier(rawTrialTier, 'standard') : '';
  const trialEndsAtMs = parseTimestampMs(institutionData.trialEndsAtMs || institutionData.trialEndsAt);
  const nowMs = Date.now();
  const isTrialActive = basePlanTier === 'free' && Boolean(normalizedTrialTier) && trialEndsAtMs > nowMs;
  const isTrialExpired = basePlanTier === 'free' && Boolean(normalizedTrialTier) && trialEndsAtMs > 0 && trialEndsAtMs <= nowMs;
  const trialRemainingMs = isTrialActive ? Math.max(0, trialEndsAtMs - nowMs) : 0;
  const trialRemainingLabel = isTrialActive ? formatRemainingDuration(trialRemainingMs) : '';

  const effectiveTier = isTrialActive ? normalizedTrialTier : basePlanTier;
  const defaults = getTierDefaults(effectiveTier);

  // Limits resolution (during active trial, prefer trialPlanLimits -> tier defaults; otherwise planLimits -> tier defaults)
  const rawLimits = isTrialActive
    ? ((institutionData.trialPlanLimits && typeof institutionData.trialPlanLimits === 'object') ? institutionData.trialPlanLimits : {})
    : ((institutionData.planLimits && typeof institutionData.planLimits === 'object') ? institutionData.planLimits : {});

  const limits = {};
  Object.keys(defaults.limits).forEach((key) => {
    if (effectiveTier === 'elite') {
      limits[key] = key === 'maxGalleryPhotos' ? 24 : 0;
    } else if (key in rawLimits && rawLimits[key] !== '' && rawLimits[key] !== null && rawLimits[key] !== undefined) {
      limits[key] = normalizeLimitValue(rawLimits[key], defaults.limits[key]);
    } else {
      limits[key] = defaults.limits[key];
    }
  });

  // Feature flags resolution
  const rawFeatures = institutionData.planFeatures && typeof institutionData.planFeatures === 'object'
    ? institutionData.planFeatures
    : {};
  const features = {};
  Object.keys(defaults.features).forEach((key) => {
    features[key] = typeof rawFeatures[key] === 'boolean' ? rawFeatures[key] : defaults.features[key];
  });

  // Allowed pages resolution:
  // - During active trial: use trialAllowedPages (or Standard defaults)
  // - Otherwise: merge tier default pages with explicit company-level overrides in institutionData.allowedPages
  const allowedPages = { ...defaults.pages };
  if (isTrialActive) {
    const trialPages = institutionData.trialAllowedPages && typeof institutionData.trialAllowedPages === 'object'
      ? institutionData.trialAllowedPages
      : STANDARD_PLAN_ALLOWED_PAGES;
    Object.keys(allowedPages).forEach((key) => {
      if (key in trialPages) {
        allowedPages[key] = trialPages[key] !== false;
      }
    });
  } else {
    const rawPages = institutionData.allowedPages && typeof institutionData.allowedPages === 'object'
      ? institutionData.allowedPages
      : {};
    Object.keys(allowedPages).forEach((key) => {
      if (key in rawPages) {
        allowedPages[key] = rawPages[key] !== false;
      }
    });
  }

  const instSlug = String(institutionData.slug || institutionData.id || '').trim().toLowerCase();
  const instName = String(institutionData.name || instSlug || '').trim();
  const defaultDisplayName = isTrialActive
    ? `${PLAN_TIER_LABELS[effectiveTier] || 'Standard'} Trial`
    : (PLAN_TIER_LABELS[effectiveTier] || 'ELITE');
  const planName = isTrialActive
    ? defaultDisplayName
    : String(institutionData.planName || defaultDisplayName).trim();

  return {
    basePlanTier,
    effectiveTier,
    planTier: effectiveTier,
    planName,
    isFree: effectiveTier === 'free',
    isBasic: effectiveTier === 'free',
    isStandard: effectiveTier === 'standard',
    isElite: effectiveTier === 'elite',
    isPremium: effectiveTier === 'elite',
    isTrialActive,
    isTrialExpired,
    trialTier: normalizedTrialTier,
    trialEndsAtMs,
    trialRemainingMs,
    trialRemainingLabel,
    isLifetime: institutionData.isLifetime === true || basePlanTier === 'free',
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

export const getEffectivePlanTier = (institutionData = null) => {
  const plan = institutionData ? resolveInstitutionPlan(institutionData) : activePlanState;
  return plan.effectiveTier;
};

export const isFreePlan = (institutionData = null) => getEffectivePlanTier(institutionData) === 'free';
export const isBasicPlan = (institutionData = null) => isFreePlan(institutionData);
export const isStandardPlan = (institutionData = null) => getEffectivePlanTier(institutionData) === 'standard';
export const isElitePlan = (institutionData = null) => getEffectivePlanTier(institutionData) === 'elite';
export const isPremiumPlan = (institutionData = null) => isElitePlan(institutionData);
export const isTrialActivePlan = (institutionData = null) => {
  const plan = institutionData ? resolveInstitutionPlan(institutionData) : activePlanState;
  return plan.isTrialActive === true;
};

export const hasFeature = (featureKey, institutionData = null) => {
  const plan = institutionData ? resolveInstitutionPlan(institutionData) : activePlanState;
  if (!featureKey) return true;
  if (plan.isElite && !(featureKey in plan.features)) return true;
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
  const resolvedFeature = featureName || PLAN_FEATURE_LABELS[featureKey] || (limitKey ? `${PLAN_LIMIT_LABELS[limitKey] || limitKey} Limit` : 'ELITE Feature');
  const resolvedLimit = limit || (limitKey ? getPlanLimit(limitKey) : 0);
  const requiredTier = featureKey ? getRequiredTierForFeature(featureKey) : (plan.isFree ? 'standard' : 'elite');
  const nextTierLabel = requiredTier === 'standard' && plan.isFree ? 'Standard or ELITE' : 'ELITE';
  const currentTierLabel = plan.isTrialActive
    ? 'Standard 3-Day Trial'
    : (PLAN_TIER_LABELS[plan.effectiveTier] || 'Current');

  const quotaSummary = isQuota && resolvedLimit > 0
    ? `You have reached the ${currentTierLabel} Plan limit of ${resolvedLimit} ${PLAN_LIMIT_LABELS[limitKey] || 'records'} (currently ${currentCount}/${resolvedLimit}). Upgrade to ${plan.isFree ? 'Standard or ELITE' : 'ELITE'} for higher capacity.`
    : '';

  const featureSummary = !isQuota && !customMessage
    ? `${resolvedFeature} is available on ${nextTierLabel} plans. Compare plans below or request an instant upgrade.`
    : '';

  return openPremiumPlansModal({
    contextType: isQuota ? 'quota' : 'feature',
    moduleName: resolvedFeature,
    moduleKey: featureKey || limitKey,
    institutionName: plan.institutionName,
    institutionSlug: plan.institutionSlug,
    currentTier: plan.effectiveTier,
    isTrialActive: plan.isTrialActive,
    trialRemainingLabel: plan.trialRemainingLabel,
    recommendedTier: requiredTier === 'standard' ? 'standard' : 'elite',
    customReason: customMessage || quotaSummary || featureSummary
  });
};

export const requirePlanFeature = (featureKey, featureName = '') => {
  if (hasFeature(featureKey)) return true;
  openFeatureUpgradePrompt({
    featureKey,
    featureName: featureName || PLAN_FEATURE_LABELS[featureKey] || 'ELITE Feature',
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

export const decorateProLockElement = (el, { featureKey = '', featureName = '', badgeText = '' } = {}) => {
  if (!el) return;
  const unlocked = hasFeature(featureKey);
  const existingBadge = el.querySelector('.plan-pro-lock-badge');

  if (unlocked) {
    el.removeAttribute('data-plan-locked');
    el.classList.remove('plan-pro-locked-control');
    if (existingBadge) existingBadge.remove();
    return;
  }

  const requiredTier = getRequiredTierForFeature(featureKey);
  const resolvedBadge = badgeText || (requiredTier === 'standard' ? 'STD' : 'ELITE');
  const isStdBadge = resolvedBadge === 'STD' || resolvedBadge === 'STANDARD';
  const badgeStyle = isStdBadge
    ? 'bg-blue-50 text-blue-800 border-blue-200'
    : 'bg-amber-100 text-amber-900 border-amber-300';
  const iconHtml = isStdBadge
    ? '<i class="fas fa-layer-group text-[8px] text-blue-600"></i>'
    : '<i class="fas fa-crown text-[8px] text-amber-600"></i>';

  el.setAttribute('data-plan-locked', featureKey || 'elite');
  el.classList.add('plan-pro-locked-control');
  if (existingBadge) existingBadge.remove();

  const badge = document.createElement('span');
  badge.className = `plan-pro-lock-badge ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${badgeStyle} text-[9px] font-extrabold uppercase tracking-wider shrink-0`;
  badge.innerHTML = `${iconHtml}${esc(resolvedBadge)}`;
  el.appendChild(badge);

  if (!el.dataset.planLockBound) {
    el.dataset.planLockBound = '1';
    el.addEventListener('click', (e) => {
      if (el.getAttribute('data-plan-locked')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFeatureUpgradePrompt({
          featureKey,
          featureName: featureName || PLAN_FEATURE_LABELS[featureKey] || 'ELITE Feature',
          contextType: 'feature'
        });
      }
    }, true);
  }
};

export const renderPlanUsageBanner = (container, usage = {}, { compact = false } = {}) => {
  if (!container) return;
  const plan = activePlanState;
  if (plan.isElite) {
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

  const metricItems = metrics
    .filter((m) => m.max > 0)
    .map((m) => {
      const pct = Math.min(100, Math.round((m.count / m.max) * 100));
      const nearLimit = pct >= 85;
      const textColor = nearLimit ? 'text-rose-700 font-extrabold' : 'text-slate-700 font-semibold';
      return `<span class="tabular-nums ${textColor}">${esc(m.label)} <strong class="font-extrabold">${m.count}/${m.max}</strong></span>`;
    })
    .join('<span aria-hidden="true" class="text-slate-300 mx-1.5">·</span>');

  let wrapperClass = 'border-slate-200 bg-slate-50/90';
  let tierLabel = 'Free Plan';
  let tierSubtext = plan.isTrialExpired
    ? '3-Day Standard Trial Ended · 1 Academic Year'
    : 'Free Forever · 1 Academic Year';
  let ctaLabel = 'Upgrade Plan';
  let tierAccentClass = 'text-slate-900';

  if (plan.isTrialActive) {
    wrapperClass = 'border-blue-200 bg-blue-50/70';
    tierLabel = 'Standard 3-Day Trial';
    tierSubtext = plan.trialRemainingLabel ? `${plan.trialRemainingLabel} · Auto-switches to Free after trial` : 'Active Trial';
    ctaLabel = 'Keep Standard / Go ELITE';
    tierAccentClass = 'text-blue-900';
  } else if (plan.isStandard) {
    wrapperClass = 'border-indigo-200 bg-indigo-50/50';
    tierLabel = 'Standard Plan';
    tierSubtext = 'Daily Operations Active · Upgrade to ELITE for Excel Bulk & All 10 Modules';
    ctaLabel = 'Upgrade to ELITE';
    tierAccentClass = 'text-indigo-950';
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="rounded-2xl border ${wrapperClass} ${compact ? 'px-3.5 py-2.5' : 'px-4 py-3'} flex flex-col md:flex-row md:items-center justify-between gap-2.5">
      <div class="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xs font-extrabold ${tierAccentClass} whitespace-nowrap">${esc(tierLabel)}</span>
          <span aria-hidden="true" class="text-slate-300">·</span>
          <span class="text-[11px] font-semibold text-slate-600 truncate">${esc(tierSubtext)}</span>
        </div>
        ${metricItems ? `<div class="text-[11px] flex flex-wrap items-center">${metricItems}</div>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button type="button" data-plan-compare-cta="true" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer whitespace-nowrap">
          Compare Plans
        </button>
        <button type="button" data-plan-upgrade-cta="true" class="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition cursor-pointer whitespace-nowrap">
          <i class="fas fa-crown text-amber-400 text-[10px]"></i>
          <span>${esc(ctaLabel)}</span>
        </button>
      </div>
    </div>
  `;

  container.querySelector('[data-plan-upgrade-cta="true"]')?.addEventListener('click', () => {
    openPremiumPlansModal({
      contextType: 'feature',
      moduleName: plan.isStandard ? 'ELITE Plan' : 'Standard & ELITE Plans',
      institutionName: plan.institutionName,
      institutionSlug: plan.institutionSlug,
      currentTier: plan.effectiveTier,
      isTrialActive: plan.isTrialActive,
      trialRemainingLabel: plan.trialRemainingLabel
    });
  });

  container.querySelector('[data-plan-compare-cta="true"]')?.addEventListener('click', () => {
    openPremiumPlansModal({
      contextType: 'compare',
      initialView: 'compare',
      institutionName: plan.institutionName,
      institutionSlug: plan.institutionSlug,
      currentTier: plan.effectiveTier,
      isTrialActive: plan.isTrialActive,
      trialRemainingLabel: plan.trialRemainingLabel
    });
  });
};
