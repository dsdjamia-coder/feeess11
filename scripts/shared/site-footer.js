import { APP_VERSION, LAST_UPDATED } from '../../config/version.js';
import { isRootGatewayLocation } from '../../config/app-config.js';
import { fetchCompanyPublicCatalog } from './premium-plans-modal.js';

const FOOTER_CACHE_KEY = 'company_footer_legal_cache_v1';
const FOOTER_CACHE_TTL_MS = 10 * 60 * 1000;
const LEGAL_MODAL_ID = 'unified-company-legal-modal';

export const DEFAULT_FOOTER_CONFIG = Object.freeze({
    brandName: 'Institution Manage',
    tagline: 'Academic & Financial Management Platform',
    copyrightText: '© Institution Manage. All Rights Reserved.',
    creditName: 'HADI MAHIRI FAIZY',
    creditUrl: 'https://www.instagram.com/muhammed_sanjide_p',
    showCredit: true
});

export const DEFAULT_LEGAL_DOCS = Object.freeze({
    terms: Object.freeze({
        title: 'Terms of Service',
        updatedAtLabel: 'Effective 2026',
        content: [
            '## 1. Platform Scope & Acceptance',
            'By accessing or using Institution Manage, including any dedicated institutional public website, Official Portal, or Student Portal, you agree to comply with these Terms of Service and all applicable institutional policies.',
            '',
            '## 2. Institutional Account Responsibility',
            '- Each registered institution is solely responsible for the accuracy of its student records, staff accounts, fee ledgers, attendance entries, and academic publications.',
            '- Administrators must safeguard login credentials and assign staff permissions strictly according to institutional duties.',
            '- Unauthorized account sharing, credential misuse, or attempts to bypass role restrictions are strictly prohibited.',
            '',
            '## 3. Acceptable Use',
            'Users agree not to misuse platform services, upload malicious files, attempt unauthorized data extraction, or disrupt availability for other institutions.',
            '',
            '## 4. Service Availability & Updates',
            'We continuously improve security, performance, and features. Scheduled maintenance or software upgrades may occur automatically to keep every institution on the latest stable release.',
            '',
            '## 5. Intellectual Property & Subscriptions',
            'Platform software, design architecture, and brand assets belong to Institution Manage. Institutional access to premium modules depends on the active subscription plan configured by the platform administrator.'
        ].join('\n')
    }),
    privacy: Object.freeze({
        title: 'Privacy Policy',
        updatedAtLabel: 'Effective 2026',
        content: [
            '## 1. Data Ownership & Multi-Tenant Isolation',
            'Each institution retains ownership of the academic, student, staff, and financial data stored within its dedicated institutional workspace. Institutional data is strictly isolated per institution.',
            '',
            '## 2. Information We Process',
            '- Institutional profile details (name, logo, public notices, gallery, and contact channels).',
            '- Student, parent, and staff records managed directly by authorized institutional administrators.',
            '- Authentication identifiers and session tokens required to verify secure portal access.',
            '',
            '## 3. How Data Is Used',
            '- To deliver fee receipts, attendance registers, examination reports, timetables, and student self-service portals.',
            '- We do not sell, rent, or trade student, parent, or institutional records to third-party advertisers.',
            '',
            '## 4. Cloud Storage & Retention',
            'Records are hosted on managed Google Cloud / Firebase infrastructure with access governed by server-side security rules. Institutions control the lifecycle, correction, and deletion of their own records.',
            '',
            '## 5. Privacy Inquiries',
            'For student or staff record corrections, please contact your institution administration directly. For platform-level privacy questions, reach out through our official Contact details.'
        ].join('\n')
    }),
    security: Object.freeze({
        title: 'Security & Data Protection',
        updatedAtLabel: 'Verified Architecture',
        content: [
            '## 1. Strict Tenant Isolation',
            'Every institution operates inside an isolated database namespace enforced by server-side Firestore Security Rules and Cloud Storage access rules.',
            '',
            '## 2. Role-Based Access Control (RBAC)',
            '- Distinct security boundaries separate Company Owners, Institution Super Admins, Permission-Scoped Staff, and Students.',
            '- Sensitive financial ledgers, fee deletions, and administrative settings require authenticated role verification on the server, never relying solely on browser checks.',
            '',
            '## 3. Authentication & Credential Protection',
            '- All staff and administrator custom credentials are protected using salted cryptographic password hashing (scrypt) stored in a server-only credential vault inaccessible to client browsers.',
            '- Login sessions are verified with signed Firebase Authentication tokens and live account-status checks.',
            '',
            '## 4. Transport & Browser Security',
            'All traffic is encrypted in transit over HTTPS/TLS with Content Security Policy (CSP) headers and sanitized URL/HTML rendering to prevent script injection.',
            '',
            '## 5. Reporting a Security Issue',
            'If you discover a potential security vulnerability or unauthorized access concern, please notify our platform team immediately using the official Contact tab.'
        ].join('\n')
    })
});

const esc = (val = '') => String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeHref = (raw = '', allowedProtocols = ['https:', 'http:', 'mailto:', 'tel:']) => {
    const val = String(raw || '').trim();
    if (!val) return '';
    try {
        const parsed = new URL(val, window.location.origin);
        return allowedProtocols.includes(parsed.protocol) ? parsed.href : '';
    } catch (_) {
        return '';
    }
};

const buildInstagramUrl = (raw = '') => {
    const val = String(raw || '').trim();
    if (!val) return '';
    if (/^https?:\/\//i.test(val)) return sanitizeHref(val, ['https:', 'http:']);
    const clean = val.replace(/^@+/, '').replace(/\/+$/, '');
    return clean ? `https://instagram.com/${encodeURIComponent(clean)}` : '';
};

const buildWebsiteUrl = (raw = '') => {
    const val = String(raw || '').trim();
    if (!val) return '';
    return sanitizeHref(/^https?:\/\//i.test(val) ? val : `https://${val}`, ['https:', 'http:']);
};

const buildWhatsappUrl = (raw = '') => {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    return digits ? `https://wa.me/${digits}` : '';
};

export const normalizeFooterConfig = (raw = {}) => {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        brandName: String(src.brandName || '').trim() || DEFAULT_FOOTER_CONFIG.brandName,
        tagline: String(src.tagline || '').trim() || DEFAULT_FOOTER_CONFIG.tagline,
        copyrightText: String(src.copyrightText || '').trim() || DEFAULT_FOOTER_CONFIG.copyrightText,
        creditName: String(src.creditName !== undefined ? src.creditName : DEFAULT_FOOTER_CONFIG.creditName).trim(),
        creditUrl: String(src.creditUrl !== undefined ? src.creditUrl : DEFAULT_FOOTER_CONFIG.creditUrl).trim(),
        showCredit: src.showCredit !== undefined ? Boolean(src.showCredit) : DEFAULT_FOOTER_CONFIG.showCredit
    };
};

export const normalizeLegalDocs = (raw = {}) => {
    const src = raw && typeof raw === 'object' ? raw : {};
    const normalizeDoc = (key) => {
        const def = DEFAULT_LEGAL_DOCS[key];
        const item = src[key] && typeof src[key] === 'object' ? src[key] : {};
        return {
            title: String(item.title || '').trim() || def.title,
            updatedAtLabel: String(item.updatedAtLabel || '').trim() || def.updatedAtLabel,
            content: String(item.content || '').trim() || def.content
        };
    };
    return {
        terms: normalizeDoc('terms'),
        privacy: normalizeDoc('privacy'),
        security: normalizeDoc('security')
    };
};

let memoryCatalogData = null;
let inflightCatalogPromise = null;

const readSessionCatalogCache = () => {
    try {
        const raw = sessionStorage.getItem(FOOTER_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.savedAt) return null;
        if ((Date.now() - Number(parsed.savedAt)) > FOOTER_CACHE_TTL_MS) return null;
        return parsed.data || null;
    } catch (_) {
        return null;
    }
};

const writeSessionCatalogCache = (data) => {
    try {
        sessionStorage.setItem(FOOTER_CACHE_KEY, JSON.stringify({
            savedAt: Date.now(),
            data
        }));
    } catch (_) {}
};

export const invalidateCompanyFooterCache = () => {
    memoryCatalogData = null;
    inflightCatalogPromise = null;
    try {
        sessionStorage.removeItem(FOOTER_CACHE_KEY);
    } catch (_) {}
};

const getEffectiveCatalogData = (raw = null) => {
    const src = raw || memoryCatalogData || readSessionCatalogCache() || {};
    return {
        footer: normalizeFooterConfig(src.footer),
        legal: normalizeLegalDocs(src.legal),
        contact: (src.contact && typeof src.contact === 'object') ? src.contact : {}
    };
};

const loadCompanyFooterCatalog = async ({ forceRefresh = false } = {}) => {
    if (!forceRefresh) {
        if (memoryCatalogData) return getEffectiveCatalogData(memoryCatalogData);
        const cached = readSessionCatalogCache();
        if (cached) {
            memoryCatalogData = cached;
            return getEffectiveCatalogData(cached);
        }
    }
    if (inflightCatalogPromise && !forceRefresh) return inflightCatalogPromise;

    inflightCatalogPromise = fetchCompanyPublicCatalog({ forceRefresh })
        .then((catalog) => {
            const payload = {
                footer: normalizeFooterConfig(catalog?.footer),
                legal: normalizeLegalDocs(catalog?.legal),
                contact: catalog?.contact || {}
            };
            memoryCatalogData = payload;
            writeSessionCatalogCache(payload);
            return payload;
        })
        .catch(() => getEffectiveCatalogData())
        .finally(() => {
            inflightCatalogPromise = null;
        });

    return inflightCatalogPromise;
};

const renderStructuredPolicyHtml = (rawText = '') => {
    const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let listItems = [];

    const flushList = () => {
        if (!listItems.length) return;
        blocks.push(
            `<ul class="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-600 leading-relaxed">${listItems
                .map((item) => `<li>${esc(item)}</li>`)
                .join('')}</ul>`
        );
        listItems = [];
    };

    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) {
            flushList();
            return;
        }
        if (line.startsWith('## ')) {
            flushList();
            blocks.push(`<h4 class="text-sm sm:text-base font-extrabold text-slate-900 pt-2 first:pt-0">${esc(line.slice(3).trim())}</h4>`);
            return;
        }
        if (line.startsWith('# ')) {
            flushList();
            blocks.push(`<h4 class="text-sm sm:text-base font-extrabold text-slate-900 pt-2 first:pt-0">${esc(line.slice(2).trim())}</h4>`);
            return;
        }
        if (line.startsWith('- ') || line.startsWith('• ')) {
            listItems.push(line.slice(2).trim());
            return;
        }
        flushList();
        blocks.push(`<p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${esc(line)}</p>`);
    });
    flushList();

    return blocks.join('');
};

const renderContactPanelHtml = (contact = {}, footerCfg = DEFAULT_FOOTER_CONFIG) => {
    const brandName = String(contact.brandName || '').trim() || footerCfg.brandName || DEFAULT_FOOTER_CONFIG.brandName;
    const supportNote = String(contact.supportNote || '').trim() || 'Reach our platform team for onboarding, institutional support, technical assistance, or security inquiries.';
    const email = String(contact.email || '').trim();
    const phone = String(contact.phone || '').trim();
    const whatsapp = String(contact.whatsapp || '').trim();
    const instagram = String(contact.instagram || '').trim();
    const website = String(contact.website || '').trim();

    const channels = [];
    if (whatsapp) {
        const href = buildWhatsappUrl(whatsapp);
        if (href) {
            channels.push({
                label: 'WhatsApp Support',
                value: whatsapp,
                href,
                external: true,
                icon: 'fa-brands fa-whatsapp',
                tone: 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
            });
        }
    }
    if (phone) {
        const cleanPhone = phone.replace(/[^\d+]/g, '');
        if (cleanPhone) {
            channels.push({
                label: 'Phone Call',
                value: phone,
                href: `tel:${cleanPhone}`,
                external: false,
                icon: 'fas fa-phone',
                tone: 'bg-blue-50 text-blue-700 border-blue-200/80'
            });
        }
    }
    if (email) {
        channels.push({
            label: 'Email Support',
            value: email,
            href: `mailto:${encodeURIComponent(email)}`,
            external: false,
            icon: 'fas fa-envelope',
            tone: 'bg-indigo-50 text-indigo-700 border-indigo-200/80'
        });
    }
    if (instagram) {
        const href = buildInstagramUrl(instagram);
        if (href) {
            channels.push({
                label: 'Instagram',
                value: instagram.startsWith('http') ? instagram.replace(/^https?:\/\/(www\.)?/i, '') : instagram,
                href,
                external: true,
                icon: 'fa-brands fa-instagram',
                tone: 'bg-rose-50 text-rose-700 border-rose-200/80'
            });
        }
    }
    if (website) {
        const href = buildWebsiteUrl(website);
        if (href) {
            channels.push({
                label: 'Official Website',
                value: website.replace(/^https?:\/\//i, ''),
                href,
                external: true,
                icon: 'fas fa-globe',
                tone: 'bg-slate-100 text-slate-700 border-slate-200'
            });
        }
    }

    const channelsHtml = channels.length
        ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            ${channels.map((c) => `
                <a href="${esc(c.href)}" ${c.external ? 'target="_blank" rel="noopener noreferrer"' : ''} class="flex items-center gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-blue-300 transition-colors no-underline">
                    <div class="w-10 h-10 rounded-xl border ${c.tone} flex items-center justify-center shrink-0 text-base">
                        <i class="${c.icon}" aria-hidden="true"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="text-[11px] font-bold text-slate-500">${esc(c.label)}</div>
                        <div class="text-xs sm:text-sm font-extrabold text-slate-900 truncate">${esc(c.value)}</div>
                    </div>
                    <i class="fas fa-arrow-up-right-from-square text-[11px] text-slate-400 shrink-0" aria-hidden="true"></i>
                </a>
            `).join('')}
        </div>`
        : `<div class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs sm:text-sm text-slate-600 leading-relaxed">
            Platform contact channels have not been published yet. For student, fee, or academic inquiries, please contact your institution's administration office directly.
        </div>`;

    return `
        <div class="space-y-4">
            <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 p-1.5 flex items-center justify-center shrink-0">
                    <img src="/assets/images/logo.png" alt="${esc(brandName)}" class="w-full h-full object-contain rounded-lg" referrerpolicy="no-referrer">
                </div>
                <div class="min-w-0">
                    <h4 class="text-sm sm:text-base font-extrabold text-slate-900 truncate">${esc(brandName)}</h4>
                    <p class="text-xs text-slate-500">${esc(footerCfg.tagline || DEFAULT_FOOTER_CONFIG.tagline)}</p>
                </div>
            </div>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${esc(supportNote)}</p>
            ${channelsHtml}
        </div>
    `;
};

const MODAL_TABS = [
    { key: 'terms', label: 'Terms', icon: 'fas fa-file-contract' },
    { key: 'privacy', label: 'Privacy', icon: 'fas fa-user-shield' },
    { key: 'security', label: 'Security', icon: 'fas fa-shield-halved' },
    { key: 'contact', label: 'Contact', icon: 'fas fa-headset' }
];

export const openLegalInfoModal = (initialKey = 'terms', overrideData = null) => {
    if (typeof document === 'undefined') return;
    const validKey = MODAL_TABS.some((t) => t.key === initialKey) ? initialKey : 'terms';

    const existing = document.getElementById(LEGAL_MODAL_ID);
    if (existing) existing.remove();

    let currentKey = validKey;
    let activeData = overrideData ? getEffectiveCatalogData(overrideData) : getEffectiveCatalogData();

    const modal = document.createElement('div');
    modal.id = LEGAL_MODAL_ID;
    modal.className = 'fixed inset-0 z-[10080] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-3 sm:p-5 no-print';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'unified-legal-modal-title');

    modal.innerHTML = `
        <div class="relative w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-left">
            <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 text-sm">
                        <i id="unified-legal-modal-icon" class="fas fa-file-contract" aria-hidden="true"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 id="unified-legal-modal-title" class="text-base sm:text-lg font-extrabold text-slate-900 truncate">Terms of Service</h3>
                        <p id="unified-legal-modal-subtitle" class="text-xs text-slate-500 font-medium truncate">Institution Manage</p>
                    </div>
                </div>
                <button type="button" id="unified-legal-modal-close" class="w-9 h-9 rounded-xl bg-white hover:bg-slate-200 border border-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 transition" aria-label="Close modal">
                    <i class="fas fa-times text-xs" aria-hidden="true"></i>
                </button>
            </div>

            <div class="px-4 sm:px-5 py-2.5 bg-white border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto shrink-0" role="tablist" aria-label="Legal and contact sections">
                ${MODAL_TABS.map((t) => `
                    <button type="button" role="tab" data-legal-tab="${t.key}" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer border-none inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        <i class="${t.icon} text-[11px]" aria-hidden="true"></i>
                        <span>${t.label}</span>
                    </button>
                `).join('')}
            </div>

            <div id="unified-legal-modal-body" class="p-5 sm:p-6 overflow-y-auto flex-1 space-y-3 bg-white"></div>

            <div class="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <span id="unified-legal-modal-copyright" class="text-[11px] font-semibold text-slate-500">${esc(activeData.footer.copyrightText)}</span>
                <button type="button" id="unified-legal-modal-done" class="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition cursor-pointer border-none">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const titleEl = document.getElementById('unified-legal-modal-title');
    const subEl = document.getElementById('unified-legal-modal-subtitle');
    const iconEl = document.getElementById('unified-legal-modal-icon');
    const bodyEl = document.getElementById('unified-legal-modal-body');
    const copyEl = document.getElementById('unified-legal-modal-copyright');
    const tabBtns = Array.from(modal.querySelectorAll('[data-legal-tab]'));

    const renderActiveTab = (tabKey) => {
        currentKey = tabKey;
        const tabMeta = MODAL_TABS.find((t) => t.key === tabKey) || MODAL_TABS[0];
        if (iconEl) iconEl.className = tabMeta.icon;
        if (copyEl) copyEl.textContent = activeData.footer.copyrightText;

        tabBtns.forEach((btn) => {
            const isActive = btn.getAttribute('data-legal-tab') === tabKey;
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.className = isActive
                ? 'px-3 py-1.5 rounded-lg text-xs font-extrabold bg-slate-900 text-white transition-colors cursor-pointer border-none inline-flex items-center gap-1.5 whitespace-nowrap shrink-0'
                : 'px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer border-none inline-flex items-center gap-1.5 whitespace-nowrap shrink-0';
        });

        if (tabKey === 'contact') {
            if (titleEl) titleEl.textContent = 'Contact & Platform Support';
            if (subEl) subEl.textContent = activeData.footer.brandName;
            if (bodyEl) bodyEl.innerHTML = renderContactPanelHtml(activeData.contact, activeData.footer);
        } else {
            const docItem = activeData.legal[tabKey] || DEFAULT_LEGAL_DOCS.terms;
            if (titleEl) titleEl.textContent = docItem.title;
            if (subEl) subEl.textContent = `${activeData.footer.brandName} · ${docItem.updatedAtLabel}`;
            if (bodyEl) bodyEl.innerHTML = renderStructuredPolicyHtml(docItem.content);
        }
        if (bodyEl) bodyEl.scrollTop = 0;
    };

    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            renderActiveTab(btn.getAttribute('data-legal-tab') || 'terms');
        });
    });

    const handleKeydown = (e) => {
        if (e.key === 'Escape') close();
    };
    const close = () => {
        document.removeEventListener('keydown', handleKeydown);
        modal.remove();
    };

    document.addEventListener('keydown', handleKeydown);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    document.getElementById('unified-legal-modal-close')?.addEventListener('click', close);
    document.getElementById('unified-legal-modal-done')?.addEventListener('click', close);

    renderActiveTab(currentKey);

    if (!overrideData) {
        loadCompanyFooterCatalog().then((fresh) => {
            if (!document.getElementById(LEGAL_MODAL_ID)) return;
            activeData = fresh;
            renderActiveTab(currentKey);
        }).catch(() => {});
    }
};

const bindLegalButtons = (root) => {
    if (!root) return;
    root.querySelectorAll('[data-open-legal]').forEach((btn) => {
        if (btn.dataset.boundLegalBtn) return;
        btn.dataset.boundLegalBtn = 'true';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openLegalInfoModal(btn.getAttribute('data-open-legal') || 'terms');
        });
    });
};

const buildCreditHtml = (footerCfg, isDark = true) => {
    if (!footerCfg.showCredit || !footerCfg.creditName) return '';
    const safeUrl = sanitizeHref(footerCfg.creditUrl, ['https:', 'http:']);
    const textClass = isDark ? 'text-slate-400' : 'text-slate-500';
    const linkClass = isDark
        ? 'text-slate-200 hover:text-white underline decoration-slate-600 underline-offset-2 font-semibold'
        : 'text-slate-700 hover:text-slate-900 underline decoration-slate-300 underline-offset-2 font-semibold';
    const creditInner = safeUrl
        ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${esc(footerCfg.creditName)}</a>`
        : `<span class="font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}">${esc(footerCfg.creditName)}</span>`;
    return `<span aria-hidden="true" class="${isDark ? 'text-slate-700' : 'text-slate-300'}">·</span><span class="${textClass}">Developed by ${creditInner}</span>`;
};

const buildLegalLinksHtml = (isDark = true) => {
    const btnClass = isDark
        ? 'text-slate-300 hover:text-white font-semibold transition-colors cursor-pointer bg-transparent border-none p-0 text-xs'
        : 'text-slate-600 hover:text-slate-900 font-semibold transition-colors cursor-pointer bg-transparent border-none p-0 text-xs';
    const sepClass = isDark ? 'text-slate-700' : 'text-slate-300';
    return MODAL_TABS.map((t, i) => `
        ${i > 0 ? `<span aria-hidden="true" class="${sepClass}">·</span>` : ''}
        <button type="button" data-open-legal="${t.key}" class="${btnClass}">${t.label}</button>
    `).join('');
};

const buildCompanyBarInnerHtml = (footerCfg, { variant = 'compact', includeGatewayNav = false } = {}) => {
    const isRoot = variant === 'root-gateway';
    const gatewayLinks = includeGatewayNav
        ? `<div class="flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1 text-xs text-slate-400">
            <a href="#product-overview" class="hover:text-white transition-colors font-medium">Overview</a>
            <span aria-hidden="true" class="text-slate-700">·</span>
            <a href="#product-demo" class="hover:text-white transition-colors font-medium">Live Preview</a>
            <span aria-hidden="true" class="text-slate-700">·</span>
            <a href="#product-modules" class="hover:text-white transition-colors font-medium">Modules</a>
            <span aria-hidden="true" class="text-slate-700">·</span>
            <a href="#product-download" class="hover:text-white transition-colors font-medium">Download App</a>
        </div>`
        : '';

    const versionIdAttr = isRoot ? '' : 'id="footer-version"';
    const updatedIdAttr = isRoot ? '' : 'id="footer-updated"';

    return `
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${variant === 'compact' ? 'py-4' : 'py-5'} space-y-3">
            <div class="flex flex-col md:flex-row items-center justify-between gap-3">
                <div class="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs">
                    <img src="/assets/images/logo.png" alt="${esc(footerCfg.brandName)}" class="w-5 h-5 object-contain rounded bg-white/95 p-0.5 shrink-0" referrerpolicy="no-referrer">
                    <span class="font-extrabold text-white tracking-tight" data-company-brand-name>${esc(footerCfg.brandName)}</span>
                    <span aria-hidden="true" class="text-slate-600 hidden sm:inline">·</span>
                    <span class="text-slate-400 hidden sm:inline" data-company-brand-tagline>${esc(footerCfg.tagline)}</span>
                </div>

                <nav aria-label="Platform legal and support links" class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
                    ${buildLegalLinksHtml(true)}
                </nav>
            </div>

            ${gatewayLinks}

            <div class="pt-3 border-t border-slate-800/90 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-400 text-center sm:text-left">
                <div class="flex flex-wrap items-center justify-center sm:justify-start gap-x-2 gap-y-1">
                    <span data-company-copyright>${esc(footerCfg.copyrightText)}</span>
                    <span data-company-credit-slot>${buildCreditHtml(footerCfg, true)}</span>
                </div>
                <div class="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 tabular-nums text-slate-500">
                    <span ${versionIdAttr} data-footer-version>Version: ${esc(APP_VERSION)}</span>
                    <span aria-hidden="true" class="text-slate-700">·</span>
                    <span ${updatedIdAttr} data-footer-updated>Last Updated: ${esc(LAST_UPDATED)}</span>
                </div>
            </div>
        </div>
    `;
};

const syncCompanyBarData = (footerCfg) => {
    document.querySelectorAll('[data-company-brand-name]').forEach((el) => {
        el.textContent = footerCfg.brandName;
    });
    document.querySelectorAll('[data-company-brand-tagline]').forEach((el) => {
        el.textContent = footerCfg.tagline;
    });
    document.querySelectorAll('[data-company-copyright]').forEach((el) => {
        el.textContent = footerCfg.copyrightText;
    });
    document.querySelectorAll('[data-company-credit-slot]').forEach((el) => {
        el.innerHTML = buildCreditHtml(footerCfg, true);
    });
};

const upgradeInstitutionFooter = (footerEl, footerCfg) => {
    if (!footerEl || footerEl.dataset.unifiedMounted === 'institution-full') {
        syncCompanyBarData(footerCfg);
        return;
    }

    // Preserve existing institution live DOM elements (and their href/text/hidden states)
    const instNameText = document.getElementById('footer-inst-name')?.textContent || 'Institution Name';
    const emailEl = document.getElementById('footer-email-link');
    const phoneEl = document.getElementById('footer-phone-link');
    const socialIds = ['link-youtube', 'link-telegram', 'link-instagram', 'link-whatsapp', 'link-facebook'];
    const existingSocialEls = socialIds.map((id) => document.getElementById(id)).filter(Boolean);

    footerEl.dataset.unifiedMounted = 'institution-full';
    footerEl.className = 'footer unified-institution-footer no-print !p-0 !m-0 !mt-10 !border-t !border-slate-200 !bg-white !text-slate-700 !text-left';

    footerEl.innerHTML = `
        <!-- Tier 1: Institution Details & Social Band -->
        <div class="bg-white border-b border-slate-200">
            <div class="max-w-5xl mx-auto px-4 sm:px-6 py-7 sm:py-8 text-center space-y-4">
                <div class="space-y-1">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Official Institution Contact</div>
                    <div class="text-base sm:text-lg font-extrabold text-slate-900">
                        <span id="footer-inst-name">${esc(instNameText)}</span>
                    </div>
                </div>

                <div class="socials !m-0 flex items-center justify-center gap-3 flex-wrap" data-unified-socials-slot></div>

                <div class="corporate !m-0 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs sm:text-sm font-semibold text-slate-600" data-unified-contact-slot></div>

                <div class="text-xs text-slate-500 pt-1">
                    © <span data-inst-copy-mirror>${esc(instNameText)}</span>. All Rights Reserved.
                </div>
            </div>
        </div>

        <!-- Tier 2: Unified Company Platform & Legal Band -->
        <div class="bg-slate-900 text-slate-300" data-unified-company-band>
            ${buildCompanyBarInnerHtml(footerCfg, { variant: 'institution-full' })}
        </div>
    `;

    // Re-attach preserved live institution elements so existing snapshot listeners continue updating them seamlessly
    const socialsSlot = footerEl.querySelector('[data-unified-socials-slot]');
    if (socialsSlot) {
        if (existingSocialEls.length) {
            existingSocialEls.forEach((a) => {
                a.classList.add('w-9', 'h-9', 'rounded-xl', 'border', 'border-slate-200', 'bg-slate-50', 'hover:bg-blue-50', 'hover:border-blue-200', 'text-slate-700', 'hover:text-blue-600', 'inline-flex', 'items-center', 'justify-center', 'transition-colors');
                socialsSlot.appendChild(a);
            });
        } else {
            socialsSlot.innerHTML = `
                <a href="#" id="link-youtube" target="_blank" rel="noopener noreferrer" class="hidden w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-blue-50 text-slate-700 inline-flex items-center justify-center"><i class="fa-brands fa-youtube"></i></a>
                <a href="#" id="link-telegram" target="_blank" rel="noopener noreferrer" class="hidden w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-blue-50 text-slate-700 inline-flex items-center justify-center"><i class="fa-brands fa-telegram-plane"></i></a>
                <a href="#" id="link-instagram" target="_blank" rel="noopener noreferrer" class="hidden w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-blue-50 text-slate-700 inline-flex items-center justify-center"><i class="fa-brands fa-instagram"></i></a>
                <a href="#" id="link-whatsapp" target="_blank" rel="noopener noreferrer" class="hidden w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-blue-50 text-slate-700 inline-flex items-center justify-center"><i class="fa-brands fa-whatsapp"></i></a>
                <a href="#" id="link-facebook" target="_blank" rel="noopener noreferrer" class="hidden w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-blue-50 text-slate-700 inline-flex items-center justify-center"><i class="fa-brands fa-facebook-f"></i></a>
            `;
        }
    }

    const contactSlot = footerEl.querySelector('[data-unified-contact-slot]');
    if (contactSlot) {
        if (emailEl) {
            emailEl.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/90 text-slate-700 hover:text-blue-700 transition-colors no-underline';
            contactSlot.appendChild(emailEl);
        } else {
            contactSlot.insertAdjacentHTML('beforeend', '<a href="#" id="footer-email-link" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 text-slate-700 no-underline"><i class="fas fa-envelope text-blue-600"></i> <span id="footer-email">Email</span></a>');
        }
        if (phoneEl) {
            phoneEl.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/90 text-slate-700 hover:text-blue-700 transition-colors no-underline';
            contactSlot.appendChild(phoneEl);
        } else {
            contactSlot.insertAdjacentHTML('beforeend', '<a href="#" id="footer-phone-link" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 text-slate-700 no-underline"><i class="fas fa-phone text-emerald-600"></i> <span id="footer-phone">Phone</span></a>');
        }
    }

    // Keep the copyright mirror synced whenever applyInstitutionBranding updates #footer-inst-name
    const instNameNode = document.getElementById('footer-inst-name');
    const copyMirror = footerEl.querySelector('[data-inst-copy-mirror]');
    if (instNameNode && copyMirror && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
            copyMirror.textContent = instNameNode.textContent || 'Institution Name';
        });
        observer.observe(instNameNode, { childList: true, characterData: true, subtree: true });
    }

    bindLegalButtons(footerEl);
};

const upgradeRootGatewayFooter = (footerCfg) => {
    const gatewayFooter = document.querySelector('#root-gateway-container > footer');
    if (!gatewayFooter) return;
    if (gatewayFooter.dataset.unifiedMounted === 'root-gateway') {
        syncCompanyBarData(footerCfg);
        return;
    }
    gatewayFooter.dataset.unifiedMounted = 'root-gateway';
    gatewayFooter.className = 'bg-slate-900 text-slate-300 border-t border-slate-800 no-print';
    gatewayFooter.innerHTML = buildCompanyBarInnerHtml(footerCfg, { variant: 'root-gateway', includeGatewayNav: true });
    bindLegalButtons(gatewayFooter);
};

const resolveCompactFooterMountTarget = () => {
    const guardType = String(document.documentElement?.dataset?.sessionGuard || '').toLowerCase();
    const pageContent = document.getElementById('page-content');
    const companyMainCol = document.querySelector('#company-shell > div.flex-1');
    const sidebarAppShell = document.querySelector('.has-desktop-sidebar');

    // Official hub & Worksheet (Dashboard / Students / Alumni / Staff tabs scroll inside #page-content;
    // Excel worksheet tab hides #page-content automatically)
    if (pageContent && (guardType === 'official' || guardType === 'worksheet')) {
        return pageContent;
    }
    if (companyMainCol) {
        return companyMainCol;
    }
    // All sidebar-driven portals (#admin-app, #collection-app, #attendance-app, #result-app,
    // #evaluation-app, #activity-app, #academic-app): mount directly inside the sidebar shell
    // so CSS shifts the footer smoothly with sidebar expand/collapse.
    if (sidebarAppShell) {
        return sidebarAppShell;
    }
    return document.body;
};

const ensureCompactWorkspaceFooterStyles = () => {
    if (typeof document === 'undefined' || document.getElementById('unified-workspace-footer-layout-styles')) return;
    const style = document.createElement('style');
    style.id = 'unified-workspace-footer-layout-styles';
    style.textContent = `
        footer.unified-workspace-footer {
            box-sizing: border-box !important;
            max-width: none !important;
            margin-left: 0;
            margin-right: 0;
        }
        @media (min-width: 1024px) {
            .has-desktop-sidebar:not(.sidebar-collapsed) > footer.unified-workspace-footer {
                margin-left: 16rem !important;
                width: calc(100% - 16rem) !important;
                max-width: calc(100% - 16rem) !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
                transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .has-desktop-sidebar.sidebar-collapsed > footer.unified-workspace-footer {
                margin-left: 4.5rem !important;
                width: calc(100% - 4.5rem) !important;
                max-width: calc(100% - 4.5rem) !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
                transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
        }
        @media (max-width: 1023px) {
            .has-desktop-sidebar > footer.unified-workspace-footer {
                margin-left: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
                transition: none;
            }
            #collection-app > footer.unified-workspace-footer,
            #attendance-app > footer.unified-workspace-footer,
            #result-app > footer.unified-workspace-footer,
            #evaluation-app > footer.unified-workspace-footer,
            #activity-app > footer.unified-workspace-footer,
            #academic-app > footer.unified-workspace-footer {
                padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px)) !important;
            }
        }
    `;
    document.head.appendChild(style);
};

const mountCompactWorkspaceFooter = (footerCfg) => {
    ensureCompactWorkspaceFooterStyles();
    const mountTarget = resolveCompactFooterMountTarget();
    if (!mountTarget) return;

    const existingFooters = Array.from(document.querySelectorAll('footer[data-unified-mounted="compact"], footer.admin-footer, footer.footer'));
    let targetFooter = existingFooters.find((el) => el.dataset.unifiedMounted === 'compact') || existingFooters[0] || null;

    // Remove any duplicate legacy footers so only one unified footer exists per workspace page
    existingFooters.forEach((el) => {
        if (el && el !== targetFooter) {
            el.remove();
        }
    });

    if (!targetFooter) {
        targetFooter = document.createElement('footer');
    }

    if (targetFooter.parentElement !== mountTarget) {
        mountTarget.appendChild(targetFooter);
    }

    if (targetFooter.dataset.unifiedMounted === 'compact') {
        syncCompanyBarData(footerCfg);
        return;
    }

    targetFooter.dataset.unifiedMounted = 'compact';
    targetFooter.className = 'unified-workspace-footer no-print w-full bg-slate-900 text-slate-300 border-t border-slate-800 mt-8 !p-0 !text-left';
    targetFooter.innerHTML = buildCompanyBarInnerHtml(footerCfg, { variant: 'compact' });
    bindLegalButtons(targetFooter);
};

const detectFooterMode = () => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return 'compact';
    const path = String(window.location.pathname || '').toLowerCase();
    const isIndexDoc = Boolean(document.getElementById('root-gateway-container') && document.getElementById('hero-section'));
    const isStudentDoc = document.documentElement?.dataset?.sessionGuard === 'student' || path.endsWith('/student') || path.endsWith('/student.html');

    if (isIndexDoc) {
        return isRootGatewayLocation() ? 'root-gateway' : 'institution-full';
    }
    if (isStudentDoc) {
        return 'institution-full';
    }
    return 'compact';
};

export const mountUnifiedFooter = ({ mode = '' } = {}) => {
    if (typeof document === 'undefined') return;
    if (typeof window !== 'undefined') {
        window.openCompanyLegalModal = openLegalInfoModal;
    }

    const effectiveMode = mode || detectFooterMode();
    const initialData = getEffectiveCatalogData();

    if (document.getElementById('root-gateway-container')) {
        upgradeRootGatewayFooter(initialData.footer);
    }

    if (effectiveMode === 'institution-full') {
        const tenantFooter = document.querySelector('body > footer.footer');
        if (tenantFooter) {
            upgradeInstitutionFooter(tenantFooter, initialData.footer);
        }
    } else if (effectiveMode === 'compact') {
        mountCompactWorkspaceFooter(initialData.footer);
    }

    // Hydrate live company footer/legal settings in background (cached for 10 min)
    loadCompanyFooterCatalog().then((fresh) => {
        syncCompanyBarData(fresh.footer);
    }).catch(() => {});
};
