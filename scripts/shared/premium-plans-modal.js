import { doc, getDoc, getDocFromServer } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db as defaultDb } from '../../config/firebase-config.js';
import {
  COMPANY_COLLECTION,
  COMPANY_PUBLIC_CATALOG_DOC_ID,
  INSTITUTION_ID
} from '../../config/app-config.js';

const MODAL_ID = 'shared-premium-plans-modal';

const MODULE_LABELS = {
  collection: 'Fee Collection',
  student: 'Student Portal',
  attendance: 'Attendance Register',
  academicPlan: 'Academic Planning',
  result: 'Result Management',
  worksheet: 'Worksheets & Registers',
  studentActivity: 'Activity & Rewards',
  classroomEvaluation: 'Classroom Evaluation',
  admin: 'Admin Dashboard',
  official: 'Official Hub'
};

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

export const normalizePublicCatalog = (raw = {}) => {
  const offer = raw?.offerBanner && typeof raw.offerBanner === 'object' ? raw.offerBanner : {};
  const contact = raw?.contact && typeof raw.contact === 'object' ? raw.contact : {};
  const rawPlans = Array.isArray(raw?.plans) ? raw.plans : [];

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
      const includedModules = Array.isArray(p.includedModules)
        ? p.includedModules.map((m) => String(m || '').trim()).filter(Boolean)
        : [];
      return {
        id: String(p.id || `plan_${idx + 1}`),
        name: String(p.name || 'Custom Plan').trim(),
        tagline: String(p.tagline || '').trim(),
        currency: String(p.currency || '₹').trim() || '₹',
        mrpPrice: Number.isFinite(mrpPrice) && mrpPrice > 0 ? mrpPrice : 0,
        offerPrice: Number.isFinite(offerPrice) && offerPrice >= 0 ? offerPrice : 0,
        billingCycle: String(p.billingCycle || 'Per Year').trim() || 'Per Year',
        discountBadge: String(p.discountBadge || '').trim(),
        features,
        includedModules,
        isPopular: Boolean(p.isPopular),
        isActive: p.isActive !== false,
        displayOrder: Number.isFinite(Number(p.displayOrder)) ? Number(p.displayOrder) : idx + 1
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);

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
    }
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

export const closePremiumPlansModal = () => {
  const modal = document.getElementById(MODAL_ID);
  if (modal) modal.remove();
  if (document.body) {
    document.body.classList.remove('overflow-hidden');
  }
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
    return `Hello, we are interested in upgrading to the "${planName}" plan (${planPriceText}) for ${instLabel}.${moduleName ? ` Requested module: ${moduleName}.` : ''}`;
  }
  if (customTemplate) {
    return customTemplate
      .replace(/\{institution\}/gi, instLabel)
      .replace(/\{module\}/gi, moduleName || 'Premium Features');
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
  return `Hello, we would like to know more about premium plans for ${instLabel}.`;
};

const resolveContextHeader = ({
  contextType = 'module',
  moduleName = '',
  institutionName = '',
  pauseReason = '',
  expiryDate = ''
} = {}) => {
  if (contextType === 'paused') {
    return {
      kicker: institutionName || 'Institution Portal Paused',
      title: 'Reactivate & View Plans',
      subtitle: pauseReason
        ? `Current status: Paused (${pauseReason}). Explore available plans or contact support to resume access.`
        : 'Portal access is currently paused. Explore available plans or contact our team to resume service.'
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
      title: 'Premium Plans & Offers',
      subtitle: 'Live preview of how institutions see your custom plans, pricing, and contact channels.'
    };
  }
  if (moduleName) {
    return {
      kicker: institutionName || 'Premium Feature',
      title: `Unlock ${moduleName}`,
      subtitle: `${moduleName} is not included in your current plan. Compare plans below or contact us to upgrade.`
    };
  }
  return {
    kicker: institutionName || 'Subscription Upgrade',
    title: 'Premium Plans & Offers',
    subtitle: 'Compare available plans and contact our team to upgrade your institution workspace.'
  };
};

const renderCatalogContent = (container, catalog, options) => {
  const {
    contextType = 'module',
    moduleName = '',
    institutionName = '',
    institutionSlug = ''
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
      <div class="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50/70 to-amber-50 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="space-y-0.5 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            ${offerBanner.badgeText ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-extrabold uppercase tracking-wider"><i class="fas fa-tag text-[9px]"></i>${esc(offerBanner.badgeText)}</span>` : ''}
            ${offerBanner.headline ? `<span class="text-sm font-extrabold text-amber-950">${esc(offerBanner.headline)}</span>` : ''}
          </div>
          ${offerBanner.description ? `<p class="text-xs text-amber-900/90 leading-relaxed">${esc(offerBanner.description)}</p>` : ''}
        </div>
      </div>`
    : '';

  let plansHtml = '';
  if (activePlans.length > 0) {
    const gridColsClass = activePlans.length === 1
      ? 'grid-cols-1 max-w-md mx-auto'
      : activePlans.length === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

    plansHtml = `
      <div class="grid ${gridColsClass} gap-4">
        ${activePlans.map((plan) => {
          const hasDiscount = plan.mrpPrice > 0 && plan.mrpPrice > plan.offerPrice;
          const computedPct = hasDiscount
            ? Math.round(((plan.mrpPrice - plan.offerPrice) / plan.mrpPrice) * 100)
            : 0;
          const badgeLabel = plan.discountBadge || (computedPct > 0 ? `Save ${computedPct}%` : '');
          const priceDisplay = `${plan.currency}${formatPriceNumber(plan.offerPrice)}`;
          const mrpDisplay = plan.mrpPrice > 0 ? `${plan.currency}${formatPriceNumber(plan.mrpPrice)}` : '';

          const planInquiry = buildInquiryText({
            planName: plan.name,
            planPriceText: `${priceDisplay} / ${plan.billingCycle}`,
            moduleName,
            contextType,
            institutionName,
            institutionSlug
          });

          const planActionHref = waDigits
            ? `https://wa.me/${waDigits}?text=${encodeURIComponent(planInquiry)}`
            : emailClean
              ? `mailto:${encodeURIComponent(emailClean)}?subject=${encodeURIComponent(`Enquiry: ${plan.name} Plan`)}&body=${encodeURIComponent(planInquiry)}`
              : phoneHref || igHref || webHref || '';

          const cardBorder = plan.isPopular
            ? 'border-amber-400 bg-amber-50/20 ring-1 ring-amber-200'
            : 'border-slate-200 bg-white';

          const modTags = (plan.includedModules || [])
            .map((key) => MODULE_LABELS[key] || key)
            .filter(Boolean);

          return `
            <div class="rounded-2xl border ${cardBorder} p-5 flex flex-col justify-between gap-4 transition hover:border-slate-300">
              <div class="space-y-3.5">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <h4 class="text-base font-extrabold text-slate-900 leading-snug">${esc(plan.name)}</h4>
                    ${plan.tagline ? `<p class="text-xs text-slate-500 mt-0.5 leading-snug">${esc(plan.tagline)}</p>` : ''}
                  </div>
                  ${plan.isPopular ? `<span class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold whitespace-nowrap"><i class="fas fa-crown text-amber-600 text-[9px]"></i>Popular</span>` : ''}
                </div>

                <div class="pt-1 pb-2 border-b border-slate-100">
                  <div class="flex flex-wrap items-baseline gap-2 tabular-nums">
                    <span class="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">${esc(priceDisplay)}</span>
                    ${hasDiscount ? `<span class="text-sm font-bold text-slate-400 line-through">${esc(mrpDisplay)}</span>` : ''}
                    ${badgeLabel ? `<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold">${esc(badgeLabel)}</span>` : ''}
                  </div>
                  <div class="text-xs font-semibold text-slate-500 mt-0.5">${esc(plan.billingCycle)}</div>
                </div>

                ${plan.features.length > 0 ? `
                  <ul class="space-y-2 text-xs text-slate-700">
                    ${plan.features.map((feat) => `
                      <li class="flex items-start gap-2">
                        <i class="fas fa-circle-check text-emerald-600 mt-0.5 shrink-0 text-[11px]"></i>
                        <span class="leading-snug">${esc(feat)}</span>
                      </li>
                    `).join('')}
                  </ul>
                ` : ''}

                ${modTags.length > 0 ? `
                  <div class="pt-1 text-[11px] text-slate-500 leading-relaxed">
                    <span class="font-bold text-slate-700">Modules:</span> ${esc(modTags.join(' · '))}
                  </div>
                ` : ''}
              </div>

              ${planActionHref ? `
                <a href="${esc(planActionHref)}" ${planActionHref.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''} class="w-full py-2.5 px-4 rounded-xl text-xs font-extrabold text-center inline-flex items-center justify-center gap-2 transition whitespace-nowrap ${plan.isPopular ? 'bg-slate-900 hover:bg-slate-800 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}">
                  <i class="${waDigits ? 'fab fa-whatsapp text-sm' : 'fas fa-crown text-[11px]'}"></i>
                  <span>${waDigits ? 'Enquire on WhatsApp' : 'Choose Plan'}</span>
                </a>
              ` : `
                <button type="button" data-scroll-contact="true" class="w-full py-2.5 px-4 rounded-xl text-xs font-extrabold bg-slate-100 hover:bg-slate-200 text-slate-800 transition cursor-pointer whitespace-nowrap">
                  Contact Support to Upgrade
                </button>
              `}
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    plansHtml = `
      <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-2">
        <div class="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 mx-auto flex items-center justify-center text-lg">
          <i class="fas fa-crown"></i>
        </div>
        <h4 class="text-sm font-extrabold text-slate-900">Custom Plans Available</h4>
        <p class="text-xs text-slate-600 max-w-md mx-auto">Contact our team directly using the channels below to activate premium modules or renew your institution plan.</p>
      </div>
    `;
  }

  const contactButtons = [];
  if (waDefaultHref) {
    contactButtons.push(`
      <a href="${esc(waDefaultHref)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition whitespace-nowrap">
        <i class="fab fa-whatsapp text-sm"></i>
        <span>WhatsApp</span>
      </a>
    `);
  }
  if (igHref) {
    contactButtons.push(`
      <a href="${esc(igHref)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-xs font-extrabold transition whitespace-nowrap">
        <i class="fab fa-instagram text-sm"></i>
        <span>Instagram</span>
      </a>
    `);
  }
  if (phoneHref) {
    contactButtons.push(`
      <a href="${esc(phoneHref)}" class="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition whitespace-nowrap">
        <i class="fas fa-phone text-xs"></i>
        <span>${esc(phoneClean)}</span>
      </a>
    `);
  }
  if (emailDefaultHref) {
    contactButtons.push(`
      <a href="${esc(emailDefaultHref)}" class="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-extrabold transition whitespace-nowrap">
        <i class="fas fa-envelope text-xs"></i>
        <span>${esc(emailClean)}</span>
      </a>
    `);
  }
  if (webHref) {
    contactButtons.push(`
      <a href="${esc(webHref)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-extrabold transition whitespace-nowrap">
        <i class="fas fa-globe text-xs"></i>
        <span>Website</span>
      </a>
    `);
  }

  const contactSectionHtml = `
    <div id="premium-modal-contact-section" class="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="space-y-0.5 min-w-0">
        <div class="text-xs font-extrabold text-slate-900">
          ${esc(contact.brandName || 'Platform Support & Upgrades')}
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          ${esc(contact.supportNote || (contactButtons.length > 0 ? 'Reach out directly on any channel to activate modules or request custom pricing.' : 'Contact your platform provider directly to upgrade or renew your subscription.'))}
        </p>
      </div>
      ${contactButtons.length > 0 ? `<div class="flex flex-wrap items-center gap-2 shrink-0">${contactButtons.join('')}</div>` : ''}
    </div>
  `;

  container.innerHTML = `
    <div class="space-y-5">
      ${bannerHtml}
      ${plansHtml}
      ${contactSectionHtml}
    </div>
  `;

  container.querySelectorAll('[data-scroll-contact="true"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('premium-modal-contact-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  forceRefresh = false,
  catalogOverride = null
} = {}) => {
  if (typeof document === 'undefined') return;
  closePremiumPlansModal();

  const resolvedSlug = institutionSlug || (INSTITUTION_ID !== 'school' ? INSTITUTION_ID : '');
  const resolvedHeader = resolveContextHeader({
    contextType,
    moduleName: moduleName || MODULE_LABELS[moduleKey] || '',
    institutionName,
    pauseReason,
    expiryDate
  });

  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.style.zIndex = '1000000';
  modal.className = 'fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden" style="font-family:'Plus Jakarta Sans',sans-serif;">
      <div class="px-5 py-4 sm:px-6 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 border border-amber-200 flex items-center justify-center text-lg shrink-0">
            <i class="fas fa-crown"></i>
          </div>
          <div class="min-w-0">
            <div class="text-[11px] font-extrabold uppercase tracking-wider text-amber-700 truncate">${esc(resolvedHeader.kicker)}</div>
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
          <div class="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center text-lg">
            <i class="fas fa-circle-notch fa-spin"></i>
          </div>
          <p class="text-xs font-bold text-slate-500">Loading plans and contact details...</p>
        </div>
      </div>

      <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <span class="text-[11px] font-semibold text-slate-500 truncate">
          <i class="fas fa-shield-halved text-emerald-600 mr-1"></i>All existing data remains safe during upgrades.
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
    if (e.key === 'Escape') {
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
        institutionName,
        institutionSlug: resolvedSlug
      });
    } catch (err) {
      console.error('Failed to load premium plans catalog:', err);
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
