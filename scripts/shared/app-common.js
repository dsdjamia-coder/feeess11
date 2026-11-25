import { doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { APP_VERSION, LAST_UPDATED, RELEASE_STAGE } from '../../config/version.js';
import {
    BASE_PATH,
    INSTITUTION_ID,
    INSTITUTIONS_COLLECTION,
    DEFAULT_COMPANY_ALLOWED_PAGES,
    isRootGatewayLocation,
    buildInternalStaffEmail,
    isInternalStaffEmail,
    extractInternalUsername
} from '../../config/app-config.js';
import { openPremiumPlansModal } from './premium-plans-modal.js';
import { mountUnifiedFooter, openLegalInfoModal } from './site-footer.js';
import {
    resolveInstitutionPlan,
    setActiveInstitutionPlan,
    getActiveInstitutionPlan,
    isBasicPlan,
    isPremiumPlan,
    hasFeature,
    getPlanLimit,
    checkQuotaLimit,
    requirePlanFeature,
    requirePlanQuota,
    openFeatureUpgradePrompt,
    decorateProLockElement,
    renderPlanUsageBanner,
    onPlanChange
} from './plan-entitlements.js';

export {
    BASE_PATH,
    INSTITUTION_ID,
    INSTITUTIONS_COLLECTION,
    DEFAULT_COMPANY_ALLOWED_PAGES,
    isRootGatewayLocation,
    buildInternalStaffEmail,
    isInternalStaffEmail,
    extractInternalUsername,
    openPremiumPlansModal,
    mountUnifiedFooter,
    openLegalInfoModal,
    resolveInstitutionPlan,
    setActiveInstitutionPlan,
    getActiveInstitutionPlan,
    isBasicPlan,
    isPremiumPlan,
    hasFeature,
    getPlanLimit,
    checkQuotaLimit,
    requirePlanFeature,
    requirePlanQuota,
    openFeatureUpgradePrompt,
    decorateProLockElement,
    renderPlanUsageBanner,
    onPlanChange
};
export const formatCurrency = (value = 0) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '₹0';
    const hasFractions = (num % 1 !== 0);
    return '₹' + num.toLocaleString('en-IN', {
        minimumFractionDigits: hasFractions ? 2 : 0,
        maximumFractionDigits: hasFractions ? 2 : 0
    });
};
export const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
export const sanitizePhone = (value = '') => String(value).replace(/[^\d+]/g, '');
export const sanitizeUrl = (value = '', allowedProtocols = ['https:', 'http:', 'mailto:', 'tel:', 'data:']) => {
    if (!value) return '';
    if (value.startsWith('data:')) return value;
    try {
        const parsed = new URL(value, window.location.origin);
        return allowedProtocols.includes(parsed.protocol) ? parsed.href : '';
    } catch (error) {
        return '';
    }
};
export const resolveSafePhotoUrl = (value = '', fallback = '') => {
    if (!value || typeof value !== 'string') return fallback;
    const clean = value.trim();
    if (!clean) return fallback;
    if (clean.startsWith('data:image/') || clean.startsWith('data:')) return clean;
    const sanitized = sanitizeUrl(clean, ['https:', 'http:', 'data:']);
    return sanitized || fallback;
};
export const formatDateDisplay = (value, locale = 'en-GB') => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(locale);
};
export const formatMonthLabel = (value) => {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return value || '--';
    const [year, month] = value.split('-').map(Number);
    return new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
};
export const buildEmptyState = (message, icon = 'fa-circle-info') => `
    <div class="shared-empty-state">
        <i class="fas ${icon}"></i>
        <span>${escapeHtml(message)}</span>
    </div>
`;
export const hardenExternalLinks = () => {
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
        link.rel = 'noopener noreferrer';
    });
};

export const initGlobalModalScrollLock = () => {
    const rootEl = document.documentElement;
    if (!rootEl || rootEl.dataset.modalScrollLockBound === 'true') return;
    rootEl.dataset.modalScrollLockBound = 'true';

    const isVisible = (el) => {
        if (!el || el.classList.contains('hidden') || el.style.display === 'none') return false;
        if (el.style.display === 'flex' || el.style.display === 'block') return true;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    let syncRaf = null;
    const syncBodyLock = () => {
        if (syncRaf) cancelAnimationFrame(syncRaf);
        syncRaf = requestAnimationFrame(() => {
            syncRaf = null;
            if (document.body?.classList.contains('collection-fullscreen-lock')) {
                if (document.body.classList.contains('modal-scroll-lock')) {
                    document.body.classList.remove('modal-scroll-lock');
                }
                return;
            }
            const overlays = document.querySelectorAll('.modal-overlay:not(.hidden), .popup-overlay:not(.hidden)');
            const hasOpenOverlay = Array.from(overlays).some((overlay) => isVisible(overlay));
            if (document.body && document.body.classList.contains('modal-scroll-lock') !== hasOpenOverlay) {
                document.body.classList.toggle('modal-scroll-lock', hasOpenOverlay);
            }
        });
    };

    const bindObserver = () => {
        if (!document.body) return;
        const overlays = document.querySelectorAll('.modal-overlay, .popup-overlay');
        if (overlays.length > 0) {
            const observer = new MutationObserver(syncBodyLock);
            overlays.forEach((el) => {
                observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
            });
        }
        syncBodyLock();
    };

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            syncBodyLock();
        }
    });

    if (document.body) bindObserver();
    else window.addEventListener('DOMContentLoaded', bindObserver, { once: true });
};

export const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
            registration.addEventListener('updatefound', () => {
                const installingWorker = registration.installing;
                if (installingWorker) {
                    installingWorker.addEventListener('statechange', () => {
                        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('[Service Worker] New update available, will activate on next load.');
                        }
                    });
                }
            });
            // Skip waiting automatically if there is a waiting worker to install immediately
            if (registration.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
        }).catch((error) => {
            console.warn('Service worker registration failed.', error);
        });
    }, { once: true });
};

const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
};

const setLink = (id, value, prefix = '') => {
    const el = document.getElementById(id);
    if (!el) return;
    const safeValue = prefix === 'tel:'
        ? `${prefix}${sanitizePhone(value)}`
        : sanitizeUrl(prefix ? `${prefix}${value}` : value, prefix ? [prefix === 'mailto:' ? 'mailto:' : 'tel:'] : undefined);
    if (safeValue) el.href = safeValue;
};

export const DEFAULT_LOGO_URL = '/assets/images/logo.png';
export const DEFAULT_PWA_ICON_192 = '/assets/images/pwa-192x192.png';
export const DEFAULT_PWA_ICON_512 = '/assets/images/pwa-512x512.png';
export const DEFAULT_PWA_ICON_MASKABLE_512 = '/assets/images/pwa-maskable-512x512.png';
export const DEFAULT_APPLE_TOUCH_ICON = '/assets/images/apple-touch-icon.png';

const getLogoCacheKey = () => `institution_logo_url_v2_${INSTITUTION_ID || 'school'}`;
const getNameCacheKey = () => `institution_name_v2_${INSTITUTION_ID || 'school'}`;

const FAST_LOGO_IDS = [
    'splash-logo-img',
    'header-logo',
    'hero-logo-img',
    'login-modal-logo',
    'admin-loader-logo',
    'admin-header-logo',
    'header-logo-right',
    'official-login-modal-logo'
];

const normalizeLogoUrl = (logoUrl = '') => {
    const value = String(logoUrl || '').trim();
    if (!value) return '';
    return sanitizeUrl(value, ['https:', 'http:', 'data:']) || '';
};

export const getCachedInstitutionLogo = () => {
    if (isRootGatewayLocation()) return '';
    try {
        return normalizeLogoUrl(localStorage.getItem(getLogoCacheKey()) || '');
    } catch (_error) {
        return '';
    }
};

export const getCachedInstitutionName = () => {
    if (isRootGatewayLocation()) return '';
    try {
        return String(localStorage.getItem(getNameCacheKey()) || '').trim();
    } catch (_error) {
        return '';
    }
};

export const rememberInstitutionName = (name = '') => {
    if (isRootGatewayLocation()) return '';
    const cleanName = String(name || '').trim();
    try {
        if (cleanName) localStorage.setItem(getNameCacheKey(), cleanName);
        else localStorage.removeItem(getNameCacheKey());
    } catch (_error) {}
    return cleanName;
};

let lastDynamicPwaSignature = '';

const buildCondensedShortName = (fullName = '') => {
    const clean = String(fullName || '').trim();
    if (!clean) return 'InstManage';
    if (clean.length <= 12) return clean;
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        const firstWord = words[0];
        if (firstWord.length >= 3 && firstWord.length <= 12) return firstWord;
        const acronym = words.map((w) => w[0]).join('').toUpperCase();
        if (acronym.length >= 3 && acronym.length <= 12) return acronym;
    }
    return clean.slice(0, 12).trim();
};

export const syncDynamicPwaBranding = async ({ name = '', logoUrl = '' } = {}) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const isRoot = isRootGatewayLocation() || window.location.pathname.startsWith('/company');
    const resolvedName = isRoot
        ? 'Institution Manage'
        : (String(name || '').trim() || getCachedInstitutionName() || 'Institution Manage');
    const resolvedLogo = isRoot
        ? DEFAULT_LOGO_URL
        : (normalizeLogoUrl(logoUrl) || getCachedInstitutionLogo() || DEFAULT_LOGO_URL);

    if (!isRoot && name) {
        rememberInstitutionName(name);
    }

    const startPath = isRoot
        ? '/'
        : `${BASE_PATH || `/${INSTITUTION_ID}`}/`;
    const signature = `${startPath}::${resolvedName}::${resolvedLogo}`;
    if (signature === lastDynamicPwaSignature) return;
    lastDynamicPwaSignature = signature;

    const shortName = isRoot ? 'InstManage' : buildCondensedShortName(resolvedName);

    let appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!appleTitleMeta && document.head) {
        appleTitleMeta = document.createElement('meta');
        appleTitleMeta.setAttribute('name', 'apple-mobile-web-app-title');
        document.head.appendChild(appleTitleMeta);
    }
    if (appleTitleMeta) {
        appleTitleMeta.setAttribute('content', resolvedName);
    }

    // Always use company asset icon for installed PWA home-screen icons (iOS, Android, Desktop)
    document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((linkEl) => {
        if (linkEl.getAttribute('href') !== DEFAULT_APPLE_TOUCH_ICON) {
            linkEl.setAttribute('href', DEFAULT_APPLE_TOUCH_ICON);
        }
    });

    // Keep browser tab favicon aligned with company icon so desktop shortcut fallbacks also use company branding
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((linkEl) => {
        if (linkEl.getAttribute('href') !== DEFAULT_LOGO_URL) {
            linkEl.setAttribute('href', DEFAULT_LOGO_URL);
        }
    });

    const origin = window.location.origin;
    const toAbs = (url) => (url.startsWith('data:') || url.startsWith('http')) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;

    try {
        let manifestLink = document.querySelector('link[rel="manifest"]');
        if (!manifestLink && document.head) {
            manifestLink = document.createElement('link');
            manifestLink.setAttribute('rel', 'manifest');
            document.head.appendChild(manifestLink);
        }

        if (manifestLink) {
            if (isRoot) {
                if (manifestLink.getAttribute('href') !== '/manifest.json') {
                    manifestLink.setAttribute('href', '/manifest.json');
                }
            } else {
                const manifestObj = {
                    id: `${origin}${startPath}`,
                    name: resolvedName,
                    short_name: shortName,
                    description: `${resolvedName} - Official Portal & Learning Management App`,
                    start_url: `${origin}${startPath}`,
                    scope: `${origin}${startPath}`,
                    display: 'standalone',
                    background_color: '#f8fafc',
                    theme_color: '#2563eb',
                    icons: [
                        {
                            src: toAbs(DEFAULT_PWA_ICON_192),
                            sizes: '192x192',
                            type: 'image/png',
                            purpose: 'any'
                        },
                        {
                            src: toAbs(DEFAULT_PWA_ICON_512),
                            sizes: '512x512',
                            type: 'image/png',
                            purpose: 'any'
                        },
                        {
                            src: toAbs(DEFAULT_PWA_ICON_MASKABLE_512),
                            sizes: '512x512',
                            type: 'image/png',
                            purpose: 'maskable'
                        }
                    ]
                };
                const manifestJson = JSON.stringify(manifestObj);
                const manifestDataUrl = `data:application/manifest+json;charset=utf-8,${encodeURIComponent(manifestJson)}`;
                manifestLink.setAttribute('href', manifestDataUrl);
            }
        }
    } catch (_err) {}

    try {
        window.dispatchEvent(new CustomEvent('pwa-branding-updated', {
            detail: {
                name: resolvedName,
                shortName,
                logoUrl: resolvedLogo,
                iconUrl: DEFAULT_PWA_ICON_192,
                isRoot
            }
        }));
    } catch (_err) {}
};

export const getActivePwaBranding = () => {
    const isRoot = isRootGatewayLocation() || (typeof window !== 'undefined' && window.location.pathname.startsWith('/company'));
    const name = isRoot
        ? 'Institution Manage'
        : (getCachedInstitutionName() || 'Institution Manage');
    const logoUrl = isRoot
        ? DEFAULT_LOGO_URL
        : (getCachedInstitutionLogo() || DEFAULT_LOGO_URL);
    return {
        name,
        shortName: isRoot ? 'InstManage' : buildCondensedShortName(name),
        logoUrl,
        iconUrl: DEFAULT_PWA_ICON_192,
        isRoot
    };
};

export const rememberInstitutionLogo = (logoUrl = '', institutionName = '') => {
    if (isRootGatewayLocation()) return DEFAULT_LOGO_URL;
    const normalizedLogo = normalizeLogoUrl(logoUrl);
    try {
        if (normalizedLogo) localStorage.setItem(getLogoCacheKey(), normalizedLogo);
        else localStorage.removeItem(getLogoCacheKey());
    } catch (_error) {}
    if (institutionName) {
        rememberInstitutionName(institutionName);
    }
    syncDynamicPwaBranding({
        name: institutionName || getCachedInstitutionName(),
        logoUrl: normalizedLogo || DEFAULT_LOGO_URL
    });
    return normalizedLogo;
};

const warmLogoCache = (logoUrl = '') => {
    const normalizedLogo = normalizeLogoUrl(logoUrl);
    if (!normalizedLogo) return;
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = normalizedLogo;
    } catch (_error) {}
};

const setLogo = (ids, logoUrl, { useCachedFallback = false } = {}) => {
    const normalizedLogo = normalizeLogoUrl(logoUrl);
    const effectiveLogo = normalizedLogo || (useCachedFallback ? getCachedInstitutionLogo() : '') || DEFAULT_LOGO_URL;
    warmLogoCache(effectiveLogo);
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.getAttribute('src') !== effectiveLogo) el.src = effectiveLogo;
        el.classList.remove('hidden');
        el.style.display = '';
        el.style.opacity = '1';
        el.onerror = () => {
            const currentSrc = el.getAttribute('src') || '';
            if (currentSrc !== DEFAULT_LOGO_URL) {
                el.src = DEFAULT_LOGO_URL;
                el.classList.remove('hidden');
                el.style.display = '';
                el.style.opacity = '1';
            } else {
                el.onerror = null;
            }
        };
    });
};

export const applyCachedInstitutionLogo = (ids = FAST_LOGO_IDS) => {
    setLogo(ids, '', { useCachedFallback: true });
    syncDynamicPwaBranding();
};

const applyCachedLogoWhenReady = () => applyCachedInstitutionLogo();
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyCachedLogoWhenReady, { once: true });
    } else {
        applyCachedLogoWhenReady();
    }
}

export const normalizePhone = (value = '') => value.toString().replace(/\D/g, '');

export const normalizeStudentEntity = (raw = {}) => {
    if (!raw || typeof raw !== 'object') return raw;
    const id = String(raw.id || '').trim();
    const adm = String(raw.adm || raw.admNo || raw.admissionNo || raw.admissionNumber || id).trim();
    const rollNo = String(raw.rollNo ?? raw.roll ?? '').trim();
    const name = String(raw.name || raw.studentName || '').trim();
    const studentClass = String(raw.class || raw.className || raw.studentClass || '').trim();
    const mobile = String(raw.mobile || raw.phone || raw.contact || raw.guardianPhone || '').trim();
    const father = String(raw.father || raw.guardian || raw.parentName || '').trim();
    const passedOutYear = String(raw.passedOutYear || raw.graduatedYear || '').trim();
    const isAlumni = raw.isAlumni === true || raw.status === 'Alumni' || studentClass.toUpperCase() === 'ALUMNI' || studentClass.toUpperCase() === 'GRADUATED';
    const status = isAlumni ? 'Alumni' : (raw.status || 'Active');
    return {
        ...raw,
        id,
        adm,
        admNo: adm,
        admissionNo: adm,
        rollNo,
        roll: rollNo,
        name,
        class: studentClass,
        studentClass,
        className: studentClass,
        mobile,
        phone: mobile,
        father,
        passedOutYear,
        isAlumni,
        status
    };
};

export const fitTextToContainer = (elementId, minFontSize = 12) => {
    const el = document.getElementById(elementId);
    if (!el || !el.parentElement) return;
    el.style.fontSize = '';
    el.style.whiteSpace = 'nowrap';
    let fontSize = parseInt(window.getComputedStyle(el).fontSize, 10);
    while (el.scrollWidth > el.parentElement.clientWidth && fontSize > minFontSize) {
        fontSize -= 1;
        el.style.fontSize = `${fontSize}px`;
    }
};

export const enableSmartSelectWindowing = (root = document, { visibleCount = 6 } = {}) => {
    const scope = root || document;
    const selects = Array.from(scope.querySelectorAll('select'))
        .filter((select) => !select.multiple && !select.dataset.smartWindowBound && select.dataset.nativeSelect !== 'true' && (select.dataset.smartSelect === 'true' || select.options.length > visibleCount));

    const closeAll = () => {
        document.querySelectorAll('.smart-select-list.active').forEach((el) => {
            el.classList.remove('active');
            el.style.position = '';
            el.style.top = '';
            el.style.left = '';
            el.style.right = '';
            el.style.width = '';
            el.style.minWidth = '';
            el.style.maxWidth = '';
            el.style.maxHeight = '';
            el.style.zIndex = '';
            el._onSmartSelectClose?.();
        });
        document.querySelectorAll('.smart-select-trigger[aria-expanded="true"]').forEach((btn) => {
            btn.setAttribute('aria-expanded', 'false');
        });
    };

    selects.forEach((select) => {
        select.dataset.smartWindowBound = 'true';
        const isFloating = select.dataset.smartFloating === 'true';
        const isSearchable = select.dataset.smartSearch === 'true';
        const extraWrapperClass = String(select.dataset.smartWrapperClass || '').trim();
        const placeholderText = String(select.dataset.smartPlaceholder || 'Select option...').trim();
        const wrapper = document.createElement('div');
        wrapper.className = `smart-select-wrapper relative w-full${extraWrapperClass ? ` ${extraWrapperClass}` : ''}`;
        if (select.classList.contains('hidden')) {
            wrapper.classList.add('hidden');
        }
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        const trigger = document.createElement(isSearchable ? 'input' : 'button');
        if (isSearchable) {
            trigger.type = 'text';
            trigger.autocomplete = 'off';
            trigger.spellcheck = false;
            trigger.placeholder = placeholderText;
            trigger.setAttribute('role', 'combobox');
            trigger.setAttribute('aria-autocomplete', 'list');
        } else {
            trigger.type = 'button';
            trigger.setAttribute('aria-haspopup', 'listbox');
        }
        trigger.className = select.className;
        trigger.classList.remove('hidden', 'smart-select-native-hidden');
        trigger.classList.add('smart-select-input', 'smart-select-trigger', isSearchable ? 'smart-select-search-input' : 'pr-8', 'text-left', 'truncate');
        trigger.setAttribute('aria-expanded', 'false');
        if (select.id) trigger.setAttribute('aria-controls', `${select.id}-smart-list`);
        wrapper.insertBefore(trigger, select);

        let clearBtn = null;
        if (isSearchable) {
            clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'smart-select-clear hidden';
            clearBtn.setAttribute('aria-label', 'Clear selection');
            clearBtn.title = 'Clear';
            clearBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
            wrapper.insertBefore(clearBtn, select);
        }

        const caret = document.createElement('i');
        caret.className = 'fas fa-chevron-down smart-select-caret';
        caret.setAttribute('aria-hidden', 'true');
        wrapper.insertBefore(caret, select);

        const list = document.createElement('div');
        list.className = 'suggestions-box smart-select-list';
        list.setAttribute('role', 'listbox');
        if (isFloating) list.dataset.smartFloatingList = 'true';
        if (select.id) list.id = `${select.id}-smart-list`;
        wrapper.appendChild(list);

        select.classList.add('smart-select-native-hidden');
        select.tabIndex = -1;

        let activeIndex = -1;
        const getOptionItems = () => Array.from(list.querySelectorAll('.smart-select-option'));

        const toLocalRect = (domRect, rotatedRoot) => {
            if (!rotatedRoot) {
                return {
                    left: domRect.left,
                    right: domRect.right,
                    top: domRect.top,
                    bottom: domRect.bottom,
                    width: domRect.width,
                    height: domRect.height
                };
            }
            const rRect = rotatedRoot.getBoundingClientRect();
            return {
                left: domRect.top - rRect.top,
                right: domRect.bottom - rRect.top,
                top: rRect.right - domRect.right,
                bottom: rRect.right - domRect.left,
                width: domRect.height,
                height: domRect.width
            };
        };

        const getSmartSelectBounds = (preferredWidth = 0) => {
            const rotatedRoot = trigger.closest('.spreadsheet-css-rotated');
            const spaceWidth = rotatedRoot
                ? Math.max(160, rotatedRoot.clientWidth || window.innerHeight || 0)
                : Math.max(160, window.innerWidth || 0);
            const vpLeft = 8;
            const vpRight = Math.max(vpLeft + 120, spaceWidth - 8);
            let boundLeft = vpLeft;
            let boundRight = vpRight;
            const container = trigger.closest('.modal-box, .card, #app, main');
            if (container) {
                const cRect = toLocalRect(container.getBoundingClientRect(), rotatedRoot);
                if (cRect.width > 0) {
                    boundLeft = Math.max(vpLeft, cRect.left + 8);
                    boundRight = Math.min(vpRight, cRect.right - 8);
                }
            }
            if (boundRight <= boundLeft) {
                boundLeft = vpLeft;
                boundRight = vpRight;
            }
            const capWidth = isSearchable ? Math.max(260, preferredWidth || 0) : 260;
            const maxAllowedWidth = Math.max(80, Math.min(capWidth, boundRight - boundLeft));
            return { rotatedRoot, boundLeft, boundRight, maxAllowedWidth };
        };

        const positionFloatingList = () => {
            if (!isFloating) return;
            const rotatedRoot = trigger.closest('.spreadsheet-css-rotated');
            const rect = toLocalRect(trigger.getBoundingClientRect(), rotatedRoot);
            const { boundLeft, boundRight, maxAllowedWidth } = getSmartSelectBounds(rect.width);
            const spaceHeight = rotatedRoot
                ? Math.max(160, rotatedRoot.clientHeight || window.innerWidth || 0)
                : Math.max(160, window.innerHeight || 0);
            const spaceBelow = spaceHeight - rect.bottom;
            const maxListHeight = 220;
            const openUpwards = spaceBelow < 180 && rect.top > spaceBelow;
            const explicitMin = Number(select.dataset.smartMinWidth || 0);
            const minWidth = Math.min(maxAllowedWidth, Math.max(rect.width, explicitMin));

            list.style.position = 'fixed';
            list.style.right = 'auto';
            list.style.minWidth = `${minWidth}px`;
            list.style.width = 'max-content';
            list.style.maxWidth = `${maxAllowedWidth}px`;
            list.style.left = `${boundLeft}px`;
            list.style.zIndex = '10020';

            const measuredRect = toLocalRect(list.getBoundingClientRect(), rotatedRoot);
            const measuredWidth = Math.ceil(measuredRect.width || rect.width);
            const width = Math.max(minWidth, Math.min(measuredWidth, maxAllowedWidth));

            let left = rect.left;
            if (left + width > boundRight) {
                left = rect.right - width;
            }
            left = Math.max(boundLeft, Math.min(left, boundRight - width));

            list.style.left = `${left}px`;
            list.style.width = `${width}px`;

            if (openUpwards) {
                const topPos = Math.max(8, rect.top - Math.min(maxListHeight, rect.top - 12) - 4);
                list.style.top = `${topPos}px`;
                list.style.maxHeight = `${Math.min(maxListHeight, rect.top - 12)}px`;
            } else {
                list.style.top = `${rect.bottom + 4}px`;
                list.style.maxHeight = `${Math.max(120, Math.min(maxListHeight, spaceBelow - 12))}px`;
            }
        };

        const positionStaticList = () => {
            if (isFloating) return;
            const rotatedRoot = trigger.closest('.spreadsheet-css-rotated');
            const rect = toLocalRect(trigger.getBoundingClientRect(), rotatedRoot);
            const { boundLeft, boundRight, maxAllowedWidth } = getSmartSelectBounds(rect.width);
            list.style.left = '0px';
            list.style.right = 'auto';
            list.style.minWidth = '100%';
            list.style.width = 'max-content';
            list.style.maxWidth = `${maxAllowedWidth}px`;

            const listRect = toLocalRect(list.getBoundingClientRect(), rotatedRoot);
            if (listRect.right > boundRight && (rect.right - listRect.width) >= boundLeft) {
                list.style.left = 'auto';
                list.style.right = '0px';
            }
        };

        list._reposition = () => {
            if (!list.classList.contains('active')) return;
            if (isFloating) positionFloatingList();
            else positionStaticList();
        };

        const syncVisibilityState = () => {
            const isHidden = select.classList.contains('hidden');
            wrapper.classList.toggle('hidden', isHidden);
            if (isHidden) {
                list.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
            }
        };

        const syncClearButton = () => {
            if (!clearBtn) return;
            const hasContent = !select.disabled && (Boolean(select.value) || Boolean(String(trigger.value || '').trim()));
            clearBtn.classList.toggle('hidden', !hasContent);
        };

        const syncDisabledState = () => {
            const isDisabled = Boolean(select.disabled);
            trigger.disabled = isDisabled;
            wrapper.classList.toggle('smart-select-disabled', isDisabled);
            if (isDisabled) {
                list.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
            }
            syncClearButton();
        };

        const highlightOption = (idx) => {
            const items = getOptionItems();
            items.forEach((item, i) => item.classList.toggle('smart-active-option', i === idx));
            activeIndex = idx;
            if (idx >= 0 && items[idx]) {
                items[idx].scrollIntoView({ block: 'nearest' });
            }
        };

        const renderList = (filterQuery = '') => {
            if (select.disabled) return;
            const allOptions = Array.from(select.options);
            let optionsToRender = allOptions;
            let emptyHint = 'No options available';

            if (isSearchable) {
                const selectableOptions = allOptions.filter((option) => option.value !== '');
                const placeholderOpt = allOptions.find((option) => option.value === '');
                const q = String(filterQuery || '').trim().toLowerCase();
                if (selectableOptions.length === 0) {
                    optionsToRender = [];
                    emptyHint = placeholderOpt ? (placeholderOpt.textContent || 'No options available') : 'No options available';
                } else if (q) {
                    const tokens = q.split(/\s+/).filter(Boolean);
                    optionsToRender = selectableOptions.filter((option) => {
                        const haystack = `${option.textContent || ''} ${option.dataset.search || ''}`.toLowerCase();
                        return tokens.every((tok) => haystack.includes(tok));
                    });
                    emptyHint = 'No matching options found';
                } else {
                    optionsToRender = selectableOptions;
                }
            }

            activeIndex = -1;
            list.innerHTML = optionsToRender.length
                ? optionsToRender.map((option) => `<div class="suggestion-item smart-select-option ${option.value === select.value ? 'smart-selected-option' : ''}" role="option" aria-selected="${option.value === select.value ? 'true' : 'false'}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.textContent || '')}</div>`).join('')
                : `<div class="suggestion-item text-gray-400 cursor-default">${escapeHtml(emptyHint)}</div>`;
            list.classList.add('active');
            trigger.setAttribute('aria-expanded', 'true');
            if (isFloating) positionFloatingList();
            else positionStaticList();

            if (isSearchable && String(filterQuery || '').trim() && optionsToRender.length > 0) {
                highlightOption(0);
            } else {
                const selectedIdx = optionsToRender.findIndex((o) => o.value === select.value);
                if (selectedIdx >= 0) highlightOption(selectedIdx);
            }
        };

        const syncInputValue = () => {
            const selectedOption = select.options[select.selectedIndex];
            if (isSearchable) {
                const hasRealValue = Boolean(selectedOption && selectedOption.value !== '');
                trigger.value = hasRealValue ? String(selectedOption.textContent || '').trim() : '';
                trigger.classList.toggle('smart-select-placeholder', !hasRealValue);
                syncClearButton();
                return;
            }
            const label = selectedOption ? String(selectedOption.textContent || '').trim() : '';
            if (label) {
                trigger.textContent = label;
                trigger.classList.remove('smart-select-placeholder');
            } else {
                trigger.textContent = placeholderText;
                trigger.classList.add('smart-select-placeholder');
            }
        };

        list._onSmartSelectClose = () => {
            if (isSearchable) {
                syncInputValue();
            }
        };

        select._syncSmartSelect = () => {
            syncVisibilityState();
            syncDisabledState();
            syncInputValue();
        };

        // Keep visible text in sync when JS updates select.value programmatically
        try {
            const protoDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
            if (protoDesc && protoDesc.get && protoDesc.set) {
                Object.defineProperty(select, 'value', {
                    configurable: true,
                    get() {
                        return protoDesc.get.call(this);
                    },
                    set(nextVal) {
                        protoDesc.set.call(this, nextVal);
                        syncInputValue();
                    }
                });
            }
        } catch (_err) {
            // Fallback handled by explicit syncSmartSelectDisplay / change event
        }

        syncVisibilityState();
        syncDisabledState();
        syncInputValue();

        if (isSearchable) {
            trigger.addEventListener('focus', () => {
                if (select.disabled) return;
                if (!list.classList.contains('active')) {
                    closeAll();
                    renderList('');
                    if (select.value && typeof trigger.select === 'function') {
                        trigger.select();
                    }
                }
            });

            trigger.addEventListener('click', (event) => {
                event.stopPropagation();
                if (select.disabled) return;
                if (!list.classList.contains('active')) {
                    closeAll();
                    renderList('');
                }
            });

            trigger.addEventListener('input', () => {
                if (select.disabled) return;
                syncClearButton();
                renderList(trigger.value);
            });

            clearBtn?.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });

            clearBtn?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (select.disabled) return;
                select.value = '';
                trigger.value = '';
                select.dispatchEvent(new Event('change', { bubbles: true }));
                syncClearButton();
                trigger.focus();
                renderList('');
            });

            list.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });
        } else {
            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (select.disabled) return;
                const wasOpen = list.classList.contains('active');
                closeAll();
                if (!wasOpen) {
                    renderList();
                }
            });
        }

        trigger.addEventListener('keydown', (event) => {
            if (select.disabled) return;
            const items = getOptionItems();
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!list.classList.contains('active')) {
                    closeAll();
                    renderList(isSearchable ? trigger.value : '');
                } else if (items.length > 0) {
                    highlightOption((activeIndex + 1) % items.length);
                }
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!list.classList.contains('active')) {
                    closeAll();
                    renderList(isSearchable ? trigger.value : '');
                } else if (items.length > 0) {
                    highlightOption(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
                }
            } else if (event.key === 'Enter' || (!isSearchable && event.key === ' ')) {
                event.preventDefault();
                if (!list.classList.contains('active')) {
                    closeAll();
                    renderList(isSearchable ? trigger.value : '');
                    return;
                }
                const targetItem = (activeIndex >= 0 && items[activeIndex]) ? items[activeIndex] : items[0];
                if (targetItem) {
                    select.value = targetItem.dataset.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    syncInputValue();
                    closeAll();
                }
            } else if (event.key === 'Escape') {
                if (isSearchable) syncInputValue();
                closeAll();
            }
        });

        list.addEventListener('click', (event) => {
            event.stopPropagation();
            const optionEl = event.target.closest('.smart-select-option');
            if (!optionEl || select.disabled) return;
            select.value = optionEl.dataset.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncInputValue();
            closeAll();
        });

        select.addEventListener('change', syncInputValue);
        const observer = new MutationObserver(() => {
            syncVisibilityState();
            syncDisabledState();
            syncInputValue();
        });
        observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value', 'disabled', 'class'] });
    });

    if (typeof document !== 'undefined' && !document.documentElement?.dataset?.smartSelectGlobalBound) {
        if (document.documentElement?.dataset) document.documentElement.dataset.smartSelectGlobalBound = 'true';
        document.addEventListener('click', (event) => {
            if (event.target.closest('.smart-select-wrapper')) return;
            closeAll();
        });
        document.addEventListener('focusin', (event) => {
            if (event.target.closest('.smart-select-wrapper')) return;
            closeAll();
        });
        window.addEventListener('resize', () => {
            const activeSearch = document.activeElement?.classList?.contains('smart-select-search-input');
            if (activeSearch) {
                document.activeElement.closest('.smart-select-wrapper')?.querySelector('.smart-select-list.active')?._reposition?.();
                return;
            }
            closeAll();
        });
        document.addEventListener('scroll', (event) => {
            if (event.target && event.target.classList && event.target.classList.contains('smart-select-list')) return;
            const activeSearch = document.activeElement?.classList?.contains('smart-select-search-input');
            if (activeSearch) {
                document.activeElement.closest('.smart-select-wrapper')?.querySelector('.smart-select-list.active')?._reposition?.();
                return;
            }
            closeAll();
        }, true);
    }
};

export const syncSmartSelectDisplay = (targetOrRoot = document) => {
    if (!targetOrRoot) return;
    if (targetOrRoot instanceof HTMLSelectElement) {
        if (targetOrRoot.dataset.smartSelect === 'true' && !targetOrRoot.dataset.smartWindowBound) {
            enableSmartSelectWindowing(targetOrRoot.parentElement || document, { visibleCount: 0 });
        }
        targetOrRoot._syncSmartSelect?.();
        return;
    }
    const container = targetOrRoot instanceof Element || targetOrRoot instanceof Document ? targetOrRoot : document;
    enableSmartSelectWindowing(container, { visibleCount: 6 });
    container.querySelectorAll('select[data-smart-window-bound="true"]').forEach((sel) => {
        sel._syncSmartSelect?.();
    });
};

export const renderVersionInfo = (options = {}) => {
    const {
        versionId = 'footer-version',
        updatedId = 'footer-updated',
        prefix = 'Version'
    } = options;

    const versionText = `${prefix}: ${APP_VERSION}`;
    const updatedText = `Last Updated: ${LAST_UPDATED}`;
    setText(versionId, versionText);
    setText(updatedId, updatedText);
    if (typeof document !== 'undefined') {
        document.querySelectorAll('[data-footer-version]').forEach((el) => {
            el.textContent = versionText;
        });
        document.querySelectorAll('[data-footer-updated]').forEach((el) => {
            el.textContent = updatedText;
        });
    }
};

export const applyInstitutionBranding = (conf = {}, options = {}) => {
    const {
        defaultAppName = 'Institution Manage',
        defaultSubtitle = 'Excellence in Education',
        headerTitleIds = ['header-title'],
        primaryTitleIds = [],
        subtitleIds = [],
        footerNameIds = ['footer-inst-name'],
        logoIds = ['header-logo'],
        updateDocumentTitle = false,
        documentTitleSuffix = ''
    } = options;

    const appName = conf.appName || defaultAppName;
    const subtitle = conf.appSubtitle || defaultSubtitle;

    headerTitleIds.forEach((id) => setText(id, appName));
    primaryTitleIds.forEach((id) => setText(id, appName));
    subtitleIds.forEach((id) => setText(id, subtitle));
    footerNameIds.forEach((id) => setText(id, appName));

    const regEl = document.getElementById('header-regno');
    const placeEl = document.getElementById('header-place');
    const sepEl = document.getElementById('header-sep');
    const subContainer = document.getElementById('header-subtitle');
    if (regEl && placeEl && sepEl && subContainer) {
        regEl.textContent = conf.regNo ? `Reg: ${conf.regNo}` : '';
        placeEl.textContent = conf.place || '';
        if (conf.regNo || conf.place) {
            subContainer.classList.remove('hidden');
            sepEl.classList.toggle('hidden', !(conf.regNo && conf.place));
        } else {
            subContainer.classList.add('hidden');
        }
    }

    const heroRegEl = document.getElementById('hero-regno');
    const heroPlaceEl = document.getElementById('hero-place');
    const heroSepEl = document.getElementById('hero-place-separator');
    if (heroRegEl && heroPlaceEl && heroSepEl) {
        heroRegEl.textContent = conf.regNo ? `Reg No: ${conf.regNo}` : '';
        heroPlaceEl.textContent = conf.place || '';
        heroSepEl.classList.toggle('hidden', !(conf.regNo && conf.place));
    }

    setText('footer-phone', conf.contactPhone || 'Not Available');
    setText('footer-email', conf.contactEmail || 'Not Available');
    setLink('footer-phone-link', conf.contactPhone, 'tel:');
    setLink('footer-email-link', conf.contactEmail, 'mailto:');

    ['youtube', 'telegram', 'instagram', 'whatsapp', 'facebook'].forEach((key) => {
        const id = `link-${key}`;
        const url = key === 'youtube'
            ? conf.socialYouTube
            : conf[`social${key.charAt(0).toUpperCase()}${key.slice(1)}`];
        const el = document.getElementById(id);
        if (!el) return;
        const safeUrl = sanitizeUrl(url);
        if (safeUrl) {
            el.href = safeUrl;
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    rememberInstitutionLogo(conf.logoUrl || '', appName);
    setLogo(logoIds, conf.logoUrl);

    if (updateDocumentTitle) {
        document.title = documentTitleSuffix ? `${appName} - ${documentTitleSuffix}` : appName;
    }

    hardenExternalLinks();
    renderVersionInfo();
};

export const getPeriodDateRange = (cadence = 'daily', { weeklyResetDay = 'sunday', monthlyResetDay = 1, referenceDate = new Date() } = {}) => {
    const ref = new Date(referenceDate);
    if (Number.isNaN(ref.getTime())) ref.setTime(Date.now());

    const toDateStr = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    if (cadence === 'daily') {
        const dStr = toDateStr(ref);
        return {
            startDate: dStr,
            endDate: dStr,
            label: formatDateDisplay(dStr),
            periodKey: dStr
        };
    }

    if (cadence === 'weekly') {
        const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const resetIdx = DAY_MAP[String(weeklyResetDay).toLowerCase()] ?? 0;
        const currentDayIdx = ref.getDay();
        const diff = (currentDayIdx - resetIdx + 7) % 7;
        const start = new Date(ref);
        start.setDate(ref.getDate() - diff);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const sStr = toDateStr(start);
        const eStr = toDateStr(end);
        return {
            startDate: sStr,
            endDate: eStr,
            label: `${formatDateDisplay(sStr)} – ${formatDateDisplay(eStr)}`,
            periodKey: `${sStr}__${eStr}`
        };
    }

    if (cadence === 'monthly') {
        const resetDayNum = Math.max(1, Math.min(28, Number(monthlyResetDay) || 1));
        const y = ref.getFullYear();
        const m = ref.getMonth();
        const d = ref.getDate();

        let startYear = y;
        let startMonth = m;
        if (d < resetDayNum) {
            startMonth = m - 1;
            if (startMonth < 0) {
                startMonth = 11;
                startYear = y - 1;
            }
        }
        const start = new Date(startYear, startMonth, resetDayNum);
        let endYear = startYear;
        let endMonth = startMonth + 1;
        if (endMonth > 11) {
            endMonth = 0;
            endYear = startYear + 1;
        }
        const end = new Date(endYear, endMonth, resetDayNum - 1);
        if (resetDayNum === 1) {
            end.setDate(new Date(startYear, startMonth + 1, 0).getDate());
            end.setMonth(startMonth);
            end.setFullYear(startYear);
        }
        const sStr = toDateStr(start);
        const eStr = toDateStr(end);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return {
            startDate: sStr,
            endDate: eStr,
            label: `${monthNames[startMonth]} ${startYear} (${formatDateDisplay(sStr)} – ${formatDateDisplay(eStr)})`,
            periodKey: `${startYear}-${String(startMonth + 1).padStart(2, '0')}`
        };
    }

    if (cadence === 'yearly') {
        const sStr = `${ref.getFullYear()}-01-01`;
        const eStr = `${ref.getFullYear()}-12-31`;
        return {
            startDate: sStr,
            endDate: eStr,
            label: `Session ${ref.getFullYear()}`,
            periodKey: String(ref.getFullYear())
        };
    }

    const dStr = toDateStr(ref);
    return { startDate: dStr, endDate: dStr, label: dStr, periodKey: dStr };
};

export const initInfoMessageTags = () => {
    if (typeof document === 'undefined' || window.__infoMessageTagsInitialized) return;
    window.__infoMessageTagsInitialized = true;

    const dismissActiveTag = () => {
        const active = document.getElementById('active-info-message-tag');
        if (active) active.remove();
    };

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.info-tooltip-btn, [data-info]');
        if (!btn) {
            if (!e.target.closest('#active-info-message-tag')) {
                dismissActiveTag();
            }
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const activeTag = document.getElementById('active-info-message-tag');
        if (activeTag && activeTag._triggerEl === btn) {
            dismissActiveTag();
            return;
        }
        dismissActiveTag();

        const text = btn.getAttribute('data-info') || btn.getAttribute('title');
        if (!text) return;

        const tag = document.createElement('div');
        tag.id = 'active-info-message-tag';
        tag.className = 'fixed z-[99999] max-w-[280px] sm:max-w-[340px] p-3 rounded-xl bg-slate-900 text-white text-xs font-medium shadow-2xl border border-slate-700 animate-fadeIn';
        tag._triggerEl = btn;
        tag.innerHTML = `
            <div class="flex items-start gap-2">
                <i class="fas fa-info-circle text-blue-400 mt-0.5 text-xs shrink-0"></i>
                <div class="flex-1 leading-relaxed text-[11px] sm:text-xs text-slate-100 font-normal">${escapeHtml(text)}</div>
                <button type="button" class="text-slate-400 hover:text-white p-0.5 ml-1 text-xs shrink-0 cursor-pointer" aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="tag-arrow absolute w-2.5 h-2.5 bg-slate-900 border-slate-700 transform rotate-45"></div>
        `;

        tag.querySelector('button')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            tag.remove();
        });

        document.body.appendChild(tag);

        const rect = btn.getBoundingClientRect();
        const tagRect = tag.getBoundingClientRect();

        let top = rect.bottom + 8;
        let left = Math.min(Math.max(10, rect.left - 20), window.innerWidth - tagRect.width - 10);
        const arrow = tag.querySelector('.tag-arrow');

        if (top + tagRect.height > window.innerHeight - 10) {
            top = Math.max(10, rect.top - tagRect.height - 8);
            if (arrow) {
                arrow.style.bottom = '-5px';
                arrow.style.top = 'auto';
                arrow.style.borderBottom = '1px solid #334155';
                arrow.style.borderRight = '1px solid #334155';
            }
        } else {
            if (arrow) {
                arrow.style.top = '-5px';
                arrow.style.bottom = 'auto';
                arrow.style.borderTop = '1px solid #334155';
                arrow.style.borderLeft = '1px solid #334155';
            }
        }

        if (arrow) {
            const arrowLeft = Math.max(12, Math.min(tagRect.width - 24, rect.left - left + (rect.width / 2) - 5));
            arrow.style.left = `${arrowLeft}px`;
        }

        tag.style.top = `${top}px`;
        tag.style.left = `${left}px`;
    });
};

// --- 16 Canonical Student Fields Definition & Safe Normalizer ---
export const STUDENT_STANDARD_FIELDS = Object.freeze([
    { num: 1, key: 'photo', label: 'Student Profile Photo', type: 'image' },
    { num: 2, key: 'class', label: 'Class', type: 'text' },
    { num: 3, key: 'uid', label: 'ID/UID', type: 'text' },
    { num: 4, key: 'name', label: 'Student Name', type: 'text' },
    { num: 5, key: 'father', label: "Father's Name", type: 'text' },
    { num: 6, key: 'mother', label: "Mother's Name", type: 'text' },
    { num: 7, key: 'gender', label: 'Gender', type: 'text' },
    { num: 8, key: 'adm', label: 'Admission Number (Adm. No.)', type: 'text' },
    { num: 9, key: 'dob', label: 'Date of Birth', type: 'date' },
    { num: 10, key: 'admDate', label: 'Date of Admission', type: 'date' },
    { num: 11, key: 'status', label: 'Student Status', type: 'badge' },
    { num: 12, key: 'adhaar', label: 'Aadhaar Number', type: 'text' },
    { num: 13, key: 'mobile', label: "Father's Phone Number", type: 'tel' },
    { num: 14, key: 'motherMobile', label: "Mother's Phone Number", type: 'tel' },
    { num: 15, key: 'address', label: 'Permanent Address', type: 'text' },
    { num: 16, key: 'academicYear', label: 'Academic Year', type: 'text' }
]);

export const getStudentNormalizedDetails = (student = {}, defaultAcademicYear = '') => {
    if (!student || typeof student !== 'object') return {};
    const prof = (student.profile && typeof student.profile === 'object') ? student.profile : {};
    const pick = (...vals) => {
        for (const v of vals) {
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
    };
    const formatDate = (val) => {
        if (!val) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            const [y, m, d] = val.split('-');
            return `${d}/${m}/${y}`;
        }
        return val;
    };

    return {
        photo: pick(student.photo, prof.photo, student.profilePhoto, student.photoUrl),
        class: pick(student.class, student.studentClass, prof.class),
        uid: pick(student.uid, prof.uid),
        name: pick(student.name, prof.name),
        father: pick(student.father, prof.father, student.guardian),
        mother: pick(student.mother, prof.mother),
        gender: pick(student.gender, prof.gender) || 'Male',
        adm: pick(student.adm, prof.admNo, prof.adm),
        dob: formatDate(pick(student.dob, prof.dob)),
        dobRaw: pick(student.dob, prof.dob),
        admDate: formatDate(pick(student.admDate, prof.admDate, student.adm_date, prof.adm_date)),
        admDateRaw: pick(student.admDate, prof.admDate, student.adm_date, prof.adm_date),
        status: pick(student.status, prof.status) || 'Active',
        passedOutYear: pick(student.passedOutYear, student.graduatedYear),
        adhaar: pick(student.adhaar, prof.adhaar, student.aadhaar, prof.aadhaar),
        mobile: pick(student.mobile, prof.mobile, student.phone, prof.fatherMobile, student.fatherMobile),
        motherMobile: pick(student.motherMobile, prof.motherMobile),
        address: pick(student.address, prof.address, student.permanentAddress),
        academicYear: pick(student.academicYear, prof.academicYear, defaultAcademicYear)
    };
};

/**
 * Parses an academic year label (e.g. '2025-2026' or '2025-2026 (Current)') into start/end numbers.
 */
export const parseAcademicYearRange = (label = '') => {
    const raw = typeof label === 'object' && label !== null
        ? (label.label || label.year || label.name || label.id || '')
        : String(label || '');
    const clean = raw
        .replace(/^Academic\s*Year\s*[:\-–]?\s*/i, '')
        .replace(/^Session\s*:\s*/i, '')
        .replace(/^Year\s*:\s*/i, '')
        .replace(/\s*\((Active|Current)\)\s*$/i, '')
        .trim();
    const match = clean.match(/(\d{4})\s*-\s*(\d{4})/);
    if (!match) return null;
    const startYear = Number(match[1]);
    const endYear = Number(match[2]);
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
    return { startYear, endYear, label: `${startYear}-${endYear}` };
};

/**
 * Chronological comparator for YYYY-YYYY academic year labels (ascending: a < b -> negative).
 */
export const compareAcademicYearLabels = (a = '', b = '') => {
    const pA = parseAcademicYearRange(a);
    const pB = parseAcademicYearRange(b);
    if (pA && pB) {
        if (pA.startYear !== pB.startYear) return pA.startYear - pB.startYear;
        return pA.endYear - pB.endYear;
    }
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * Classifies an academic year chronologically against the saved Current Academic Year:
 * - 'past' if startYear < currentStartYear
 * - 'current' if equal
 * - 'upcoming' if startYear > currentStartYear
 */
export const getAcademicYearPhase = (yearLabel = '', currentYearLabel = '') => {
    const target = parseAcademicYearRange(yearLabel);
    const ref = parseAcademicYearRange(currentYearLabel);
    if (!target || !ref) return 'unknown';
    if (target.startYear < ref.startYear) return 'past';
    if (target.startYear > ref.startYear) return 'upcoming';
    return 'current';
};

export const isPastAcademicYearLabel = (yearLabel = '', currentYearLabel = '') =>
    getAcademicYearPhase(yearLabel, currentYearLabel) === 'past';

export const isUpcomingAcademicYearLabel = (yearLabel = '', currentYearLabel = '') =>
    getAcademicYearPhase(yearLabel, currentYearLabel) === 'upcoming';

/**
 * Resolves the authoritative Current Academic Year saved in settings/academicYears.
 */
export const resolveAuthoritativeCurrentYear = (payload = {}, fallback = '') => {
    const data = payload && typeof payload === 'object' ? payload : {};
    const directRaw = data.currentYear || data.activeYear || '';
    const directClean = parseAcademicYearRange(directRaw)?.label || String(directRaw || '').replace(/\s*\((Active|Current)\)\s*$/i, '').trim();
    if (directClean) return directClean;

    const years = Array.isArray(data.years) ? data.years : [];
    const flagged = years.find((y) => typeof y === 'object' && y !== null && (
        y.isCurrent === true || y.active === true || String(y.status || '').toLowerCase() === 'current'
    )) || years.find((y) => typeof y === 'object' && y !== null && String(y.status || '').toLowerCase() === 'active');
    if (flagged) {
        const clean = parseAcademicYearRange(flagged)?.label || String(flagged.label || flagged.year || flagged.name || flagged.id || '').trim();
        if (clean) return clean;
    }
    return parseAcademicYearRange(fallback)?.label || String(fallback || '').trim();
};

/**
 * Normalizes and filters academic years list for standard dropdowns across all portals.
 * - Strictly excludes archived years (status === 'archived' or isArchived === true).
 * - Suffixes the current academic year with ' (Current)' (e.g. '2026-2027 (Current)').
 * - Leaves all other active years as bare strings (e.g. '2025-2026').
 * - Sorts descending chronologically (latest year first).
 *
 * @param {Array<object|string>} yearsList - List of academic year records or strings.
 * @param {string} currentYear - The active/current academic year label.
 * @returns {Array<{ value: string, label: string, isCurrent: boolean, phase: string }>}
 */
export const getCleanAcademicYearOptions = (yearsList = [], currentYear = '') => {
    const rawCur = typeof currentYear === 'object' && currentYear !== null
        ? (currentYear.label || currentYear.year || currentYear.name || currentYear.id || '')
        : String(currentYear || '');
    const cleanCur = rawCur.replace(/^Session:\s*/i, '').replace(/\s*\((Active|Current)\)\s*$/i, '').trim();
    const activeMap = new Map();

    (yearsList || []).forEach((y) => {
        if (!y) return;
        const isObj = typeof y === 'object' && y !== null;
        const rawLabel = (isObj ? (y.label || y.year || y.name || y.id) : String(y)).trim();
        const cleanLabel = rawLabel.replace(/^Session:\s*/i, '').replace(/^Year:\s*/i, '').replace(/\s*\((Active|Current)\)\s*$/i, '').trim();
        if (!cleanLabel) return;

        const isArchived = isObj && (String(y.status || '').toLowerCase() === 'archived' || y.isArchived === true);
        if (isArchived && cleanLabel !== cleanCur) return;

        if (!activeMap.has(cleanLabel)) {
            const isCur = Boolean(cleanCur && cleanLabel === cleanCur);
            activeMap.set(cleanLabel, {
                value: cleanLabel,
                label: isCur ? `${cleanLabel} (Current)` : cleanLabel,
                isCurrent: isCur,
                phase: cleanCur ? getAcademicYearPhase(cleanLabel, cleanCur) : 'unknown'
            });
        }
    });

    if (cleanCur && !activeMap.has(cleanCur)) {
        activeMap.set(cleanCur, {
            value: cleanCur,
            label: `${cleanCur} (Current)`,
            isCurrent: true,
            phase: 'current'
        });
    }

    return Array.from(activeMap.values()).sort((a, b) => compareAcademicYearLabels(b.value, a.value));
};

/**
 * Populates a target <select> element with uniform academic year options.
 *
 * @param {HTMLSelectElement|string} selectElementOrId
 * @param {Array<object|string>} yearsList
 * @param {string} currentYear
 * @param {object} [options]
 * @param {string} [options.selectedValue] - Value to preserve or select.
 * @param {string} [options.placeholder] - Optional empty placeholder option.
 * @param {boolean} [options.defaultToCurrent=true] - Default to current year if selectedValue not in list.
 * @param {boolean} [options.preferCurrentUnlessUserChanged=false] - Force cleanCur unless user explicitly changed select in this open session.
 */
export const populateAcademicYearSelect = (selectElementOrId, yearsList, currentYear, options = {}) => {
    const select = typeof selectElementOrId === 'string' ? document.getElementById(selectElementOrId) : selectElementOrId;
    if (!select) return;

    if (!select.dataset.userYearChangeWired) {
        select.dataset.userYearChangeWired = 'true';
        select.addEventListener('change', (evt) => {
            if (evt && evt.isTrusted) {
                select.dataset.userChangedYear = 'true';
            }
        });
    }

    const {
        selectedValue = '',
        placeholder = '',
        defaultToCurrent = true,
        preferCurrentUnlessUserChanged = false
    } = options;
    const rawCur = typeof currentYear === 'object' && currentYear !== null
        ? (currentYear.label || currentYear.year || currentYear.name || currentYear.id || '')
        : String(currentYear || '');
    const cleanCur = rawCur.replace(/^Session:\s*/i, '').replace(/\s*\((Active|Current)\)\s*$/i, '').trim();
    const items = getCleanAcademicYearOptions(yearsList, cleanCur);

    let html = '';
    if (placeholder) {
        html += `<option value="">${escapeHtml(placeholder)}</option>`;
    }
    html += items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('');
    select.innerHTML = html;

    const availableValues = items.map((i) => i.value);
    const effectiveSelected = preferCurrentUnlessUserChanged
        ? (select.dataset.userChangedYear === 'true' ? (selectedValue || select.value) : cleanCur)
        : selectedValue;

    if (effectiveSelected && availableValues.includes(effectiveSelected)) {
        select.value = effectiveSelected;
    } else if (defaultToCurrent && cleanCur && availableValues.includes(cleanCur)) {
        select.value = cleanCur;
    } else if (availableValues.length > 0) {
        select.value = availableValues[0];
    }

    syncSmartSelectDisplay(select);
};

/**
 * Natural sort comparison for class names and divisions.
 * Accurately sorts numeric class names ('1', '2', '10', '12'),
 * alphanumeric designations ('1A', '1B', '10-A', '10-B'),
 * and preserved custom text strings ('LKG', 'UKG', 'Plus One').
 */
const parseClassLabelNatural = (label = '') => {
    const raw = String(label || '').trim();
    if (!raw) return { rank: 9999, num: 9999, suffix: '', raw: '' };

    const lower = raw.toLowerCase();
    const stripped = raw.replace(/^(class|std|standard|grade)\s*[-:]?\s*/i, '').trim();
    const sLower = stripped.toLowerCase();

    if (sLower === 'pre-kg' || sLower === 'prekg' || sLower === 'playgroup') return { rank: 1, num: 1, suffix: sLower, raw };
    if (sLower === 'nursery') return { rank: 1, num: 2, suffix: sLower, raw };
    if (sLower === 'lkg') return { rank: 1, num: 3, suffix: sLower, raw };
    if (sLower === 'ukg') return { rank: 1, num: 4, suffix: sLower, raw };
    if (sLower === 'kg') return { rank: 1, num: 5, suffix: sLower, raw };
    if (lower === 'alumni' || lower === 'graduated' || lower === 'alumni_dues') return { rank: 999, num: 999, suffix: '', raw };

    const plusMatch = sLower.match(/^(?:\+|plus\s*[-_]?)\s*(1|2|one|two)(?:[\s\-_]*(.*))?$/i);
    if (plusMatch) {
        const token = plusMatch[1].toLowerCase();
        const num = (token === '1' || token === 'one') ? 11 : 12;
        return { rank: 2, num, suffix: String(plusMatch[2] || '').trim().toLowerCase(), raw };
    }

    const digitMatch = stripped.match(/^(\d+)(?:st|nd|rd|th)?[\s\-_]*(.*)$/i);
    if (digitMatch) {
        return {
            rank: 2,
            num: parseInt(digitMatch[1], 10),
            suffix: digitMatch[2].trim().toLowerCase(),
            raw
        };
    }

    const romanMap = {
        i: 1, ii: 2, iii: 3, iv: 4, v: 5,
        vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
        xi: 11, xii: 12
    };
    const romanMatch = stripped.match(/^([ivx]+)[\s\-_]*(.*)$/i);
    if (romanMatch && romanMap[romanMatch[1].toLowerCase()]) {
        return {
            rank: 2,
            num: romanMap[romanMatch[1].toLowerCase()],
            suffix: romanMatch[2].trim().toLowerCase(),
            raw
        };
    }

    return { rank: 3, num: 0, suffix: sLower, raw };
};

export const compareClassLabelsNatural = (a = '', b = '') => {
    const pA = parseClassLabelNatural(a);
    const pB = parseClassLabelNatural(b);
    if (pA.rank !== pB.rank) return pA.rank - pB.rank;
    if (pA.num !== pB.num) return pA.num - pB.num;
    const comp = pA.suffix.localeCompare(pB.suffix, undefined, { numeric: true, sensitivity: 'base' });
    if (comp !== 0) return comp;
    return String(a || '').trim().localeCompare(String(b || '').trim(), undefined, {
        numeric: true,
        sensitivity: 'base'
    });
};

/**
 * Resolves the complete list of classes for a given academic year:
 * 1. Retrieves classes configured in settings/academicYears for the matching session.
 * 2. Merges with secondary fallback configuredClasses (settings/classes).
 * 3. Merges with any student class values (to guarantee existing students match).
 * 4. Filters out invalid values (Alumni, Graduated, empty).
 * 5. Preserves exact naming, punctuation, and casing defined by Admin.
 * 6. Sorts naturally.
 */
export const resolveAcademicYearClasses = ({
    academicYears = [],
    targetYear = '',
    students = [],
    configuredClasses = []
} = {}) => {
    const classSet = new Set();
    const cleanTargetYear = String(
        typeof targetYear === 'object' && targetYear !== null
            ? (targetYear.label || targetYear.year || targetYear.id || '')
            : targetYear || ''
    ).replace(/^Session:\s*/i, '').replace(/\s*\((Active|Current)\)\s*$/i, '').trim();

    // 1. From academicYears settings
    const yearList = Array.isArray(academicYears) ? academicYears : [];
    let matchedYear = null;
    if (cleanTargetYear) {
        matchedYear = yearList.find(y => {
            const yLabel = String(typeof y === 'object' && y !== null ? (y.label || y.year || y.id || '') : y || '').trim();
            return yLabel && yLabel.toLowerCase() === cleanTargetYear.toLowerCase();
        });
    }
    if (!matchedYear && yearList.length > 0) {
        matchedYear = yearList.find(y => typeof y === 'object' && y !== null && (y.isCurrent === true || y.active === true || String(y.status || '').toLowerCase() === 'active'))
            || (typeof yearList[0] === 'object' ? yearList[0] : null);
    }

    if (matchedYear && Array.isArray(matchedYear.classes)) {
        matchedYear.classes.forEach(c => {
            const str = String(c?.name || c?.id || c || '').trim();
            if (str) classSet.add(str);
        });
    }

    // 2. From configuredClasses fallback (e.g. settings/classes)
    (Array.isArray(configuredClasses) ? configuredClasses : []).forEach(c => {
        const str = String(c?.name || c?.id || c || '').trim();
        if (str) classSet.add(str);
    });

    // 3. From students enrolled in this session / active students
    (Array.isArray(students) ? students : []).forEach(s => {
        const str = String(s.class || s.studentClass || s.className || '').trim();
        if (str) classSet.add(str);
        if (s.academicYears && typeof s.academicYears === 'object' && cleanTargetYear) {
            const yrData = s.academicYears[cleanTargetYear];
            const yrClass = String(yrData?.class || yrData?.studentClass || '').trim();
            if (yrClass) classSet.add(yrClass);
        }
    });

    // 4. Filter exclusions (Alumni, Graduated, Alumni Dues, empty)
    const cleanClasses = Array.from(classSet).filter(c => {
        const u = c.toUpperCase();
        return u && u !== 'ALUMNI' && u !== 'GRADUATED' && u !== 'ALUMNI_DUES';
    });

    // 5. Natural sort
    return cleanClasses.sort(compareClassLabelsNatural);
};

/**
 * Populates a target <select> element with standardized Class options.
 * Accurately sorts classes naturally and supports duty-class scoping.
 *
 * @param {HTMLSelectElement|string} selectElementOrId
 * @param {Array<string|object>} classesList
 * @param {object} [options]
 * @param {string} [options.selectedValue] - Class value to select or preserve
 * @param {boolean} [options.includeAllOption=true] - Whether to include "All Classes"
 * @param {string} [options.allOptionLabel='All Classes'] - Label for the "All Classes" option
 * @param {string} [options.allOptionValue='all'] - Value for the "All Classes" option
 * @param {string} [options.placeholder=''] - Optional empty placeholder option (e.g. '-- Select Class --')
 * @param {Array<string>} [options.dutyClasses=null] - Optional duty class scope for restricted staff
 * @param {boolean} [options.autoSelectSingle=false] - Auto-select if only 1 class is available
 */
export const populateClassSelect = (selectElementOrId, classesList = [], options = {}) => {
    const select = typeof selectElementOrId === 'string' ? document.getElementById(selectElementOrId) : selectElementOrId;
    if (!select) return;

    const {
        selectedValue = '',
        includeAllOption = true,
        allOptionLabel = 'All Classes',
        allOptionValue = 'all',
        placeholder = '',
        dutyClasses = null,
        autoSelectSingle = false
    } = options;

    let availableClasses = (Array.isArray(classesList) ? classesList : []).map(c => {
        return typeof c === 'object' && c !== null ? (c.name || c.id || c.label || '') : String(c || '');
    }).map(s => String(s).trim()).filter(Boolean);

    // Apply dutyClasses scoping if restricted staff
    if (Array.isArray(dutyClasses) && dutyClasses.length > 0) {
        const dutyNormalized = dutyClasses.map(d => String(d).trim().toLowerCase());
        availableClasses = availableClasses.filter(c => dutyNormalized.includes(c.toLowerCase()));
    }

    // Deduplicate and natural sort
    availableClasses = Array.from(new Set(availableClasses)).sort(compareClassLabelsNatural);

    let html = '';
    if (placeholder) {
        html += `<option value="">${escapeHtml(placeholder)}</option>`;
    }

    const showAllOption = includeAllOption && (!dutyClasses || dutyClasses.length > 1);
    if (showAllOption) {
        const isAllSelected = selectedValue === allOptionValue;
        html += `<option value="${escapeHtml(allOptionValue)}" ${isAllSelected ? 'selected' : ''}>${escapeHtml(allOptionLabel)}</option>`;
    }

    availableClasses.forEach(cls => {
        const cleanCls = String(cls).trim();
        const displayLabel = cleanCls.toLowerCase().startsWith('class') ? cleanCls : `Class: ${cleanCls}`;
        const isSelected = selectedValue === cleanCls || (availableClasses.length === 1 && autoSelectSingle && !showAllOption);
        html += `<option value="${escapeHtml(cleanCls)}" ${isSelected ? 'selected' : ''}>${escapeHtml(displayLabel)}</option>`;
    });

    select.innerHTML = html;

    // Preserve or apply selection
    if (selectedValue && (selectedValue === allOptionValue || availableClasses.includes(selectedValue))) {
        select.value = selectedValue;
    } else if (placeholder && (selectedValue === '' || selectedValue === null || selectedValue === undefined)) {
        select.value = '';
    } else if (availableClasses.length === 1 && autoSelectSingle && !showAllOption) {
        select.value = availableClasses[0];
    } else if (showAllOption) {
        select.value = allOptionValue;
    }

    syncSmartSelectDisplay(select);
};

/**
 * Standardizes Student option label across all select dropdowns.
 * Format: "[adm] - [name] (Class: [class])"
 *
 * @param {object} student
 * @param {object} [options]
 * @param {boolean} [options.includeAdm=true]
 * @param {boolean} [options.includeClass=true]
 * @returns {string}
 */
export const formatStudentOptionLabel = (student = {}, { includeAdm = true, includeClass = true } = {}) => {
    const adm = String(student.adm || student.admissionNo || '').trim();
    const name = String(student.name || 'Unnamed Student').trim();
    const cls = String(student.class || student.studentClass || '').trim();

    const parts = [];
    if (includeAdm && adm) parts.push(adm);
    parts.push(name);
    let str = parts.join(' - ');
    if (includeClass && cls) str += ` (Class: ${cls})`;
    return str;
};

/**
 * Populates target <select> with standard Gender filter options.
 *
 * @param {HTMLSelectElement|string} selectElementOrId
 * @param {object} [options]
 * @param {string} [options.selectedValue='all']
 * @param {boolean} [options.includeAll=true]
 * @param {string} [options.allLabel='All Genders']
 */
export const populateGenderSelect = (selectElementOrId, { selectedValue = 'all', includeAll = true, allLabel = 'All Genders' } = {}) => {
    const select = typeof selectElementOrId === 'string' ? document.getElementById(selectElementOrId) : selectElementOrId;
    if (!select) return;

    let html = includeAll ? `<option value="all" ${selectedValue === 'all' ? 'selected' : ''}>${escapeHtml(allLabel)}</option>` : '';
    html += `
        <option value="Male" ${selectedValue === 'Male' ? 'selected' : ''}>Male</option>
        <option value="Female" ${selectedValue === 'Female' ? 'selected' : ''}>Female</option>
    `;
    select.innerHTML = html;
    select.value = selectedValue || 'all';
    syncSmartSelectDisplay(select);
};

/**
 * Populates target <select> with standard Row Limit options.
 *
 * @param {HTMLSelectElement|string} selectElementOrId
 * @param {object} [options]
 * @param {string} [options.selectedValue='25']
 * @param {Array<{ val: string, label: string }>} [options.customLimits]
 */
export const populateRowLimitSelect = (selectElementOrId, { selectedValue = '25', customLimits = null } = {}) => {
    const select = typeof selectElementOrId === 'string' ? document.getElementById(selectElementOrId) : selectElementOrId;
    if (!select) return;

    const limits = Array.isArray(customLimits) && customLimits.length > 0 ? customLimits : [
        { val: '25', label: 'Rows: 25' },
        { val: '50', label: 'Rows: 50' },
        { val: '100', label: 'Rows: 100' },
        { val: 'all', label: 'Show All' }
    ];
    select.innerHTML = limits.map(l => `<option value="${l.val}" ${String(selectedValue) === l.val ? 'selected' : ''}>${l.label}</option>`).join('');
    select.value = String(selectedValue);
    syncSmartSelectDisplay(select);
};

/**
 * Displays the shared in-app confirmation modal (#confirm-popup) and resolves to true/false.
 * Falls back safely if modal DOM is missing.
 */
export const openConfirmDialog = ({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    okLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false
} = {}) => {
    return new Promise((resolve) => {
        const popup = document.getElementById('confirm-popup');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        if (!popup || !okBtn || !cancelBtn) {
            resolve(false);
            return;
        }

        if (titleEl) titleEl.textContent = title;
        if (msgEl) {
            msgEl.textContent = '';
            const p = document.createElement('p');
            p.className = 'text-gray-700 font-medium leading-relaxed';
            p.textContent = message;
            msgEl.appendChild(p);
        }

        const prevOkClass = okBtn.dataset.defaultClass || okBtn.className;
        if (!okBtn.dataset.defaultClass) okBtn.dataset.defaultClass = prevOkClass;

        okBtn.textContent = okLabel;
        okBtn.disabled = false;
        okBtn.className = danger
            ? 'px-5 py-2.5 rounded-lg font-bold shadow-md bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer'
            : prevOkClass;
        cancelBtn.textContent = cancelLabel;
        cancelBtn.disabled = false;

        popup.style.zIndex = '10050';
        popup.classList.remove('hidden');
        popup.classList.add('flex');

        let settled = false;
        const cleanup = (result) => {
            if (settled) return;
            settled = true;
            okBtn.onclick = null;
            cancelBtn.removeEventListener('click', onCancel);
            popup.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKeyDown);
            popup.classList.add('hidden');
            popup.classList.remove('flex');
            okBtn.textContent = 'OK';
            okBtn.className = prevOkClass;
            resolve(result);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => {
            if (e.target === popup) cleanup(false);
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') cleanup(false);
        };

        okBtn.onclick = onOk;
        cancelBtn.addEventListener('click', onCancel);
        popup.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKeyDown);
        okBtn.focus?.();
    });
};

if (typeof document !== 'undefined') {
    initGlobalModalScrollLock();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInfoMessageTags);
    } else {
        initInfoMessageTags();
    }
}

const normalizeAllowedPages = (rawPages = {}) => {
    const base = { ...DEFAULT_COMPANY_ALLOWED_PAGES };
    if (rawPages && typeof rawPages === 'object') {
        Object.keys(base).forEach((key) => {
            if (key in rawPages) {
                base[key] = rawPages[key] !== false;
            }
        });
        if ('activity' in rawPages && !('studentActivity' in rawPages)) {
            base.studentActivity = rawPages.activity !== false;
        }
        if ('evaluation' in rawPages && !('classroomEvaluation' in rawPages)) {
            base.classroomEvaluation = rawPages.evaluation !== false;
        }
    }
    return base;
};

export const evaluateInstitutionAccess = (institutionData = null, requiredPage = '') => {
    if (!institutionData || typeof institutionData !== 'object') {
        return {
            allowed: false,
            reasonCode: 'not_found',
            title: 'Institution Portal Not Found',
            message: 'The requested institution workspace does not exist or has not been activated yet.',
            allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES }
        };
    }

    const allowedPages = normalizeAllowedPages(institutionData.allowedPages || {});
    const status = String(institutionData.status || 'active').trim().toLowerCase();
    const instSlug = String(institutionData.slug || institutionData.id || '').trim();
    const instName = String(institutionData.name || instSlug || '').trim();

    if (status === 'unsubscribed' || status === 'pending' || status === 'no_plan') {
        return {
            allowed: false,
            reasonCode: 'unsubscribed',
            title: 'No Active Subscription Plan',
            message: 'Portal login and internal modules are not active for this institution yet. Please activate a subscription plan to enable portal access.',
            reason: String(institutionData.pauseReason || '').trim(),
            institutionName: instName,
            institutionSlug: instSlug,
            allowedPages
        };
    }

    if (status === 'paused' || status === 'suspended' || status === 'inactive' || institutionData.isActive === false) {
        return {
            allowed: false,
            reasonCode: 'paused',
            title: 'Portal Temporarily Paused',
            message: 'Access to this institution portal has been temporarily paused by the platform administrator.',
            reason: String(institutionData.pauseReason || '').trim(),
            institutionName: instName,
            institutionSlug: instSlug,
            allowedPages
        };
    }

    const isLifetime = institutionData.isLifetime === true || String(institutionData.planName || '').toLowerCase() === 'lifetime';
    if (!isLifetime) {
        let expiryMs = 0;
        const ts = institutionData.expiryTimestamp;
        if (ts && typeof ts.toMillis === 'function') {
            expiryMs = ts.toMillis();
        } else if (ts && typeof ts.seconds === 'number') {
            expiryMs = ts.seconds * 1000;
        } else if (institutionData.expiryDate) {
            const parsed = Date.parse(`${String(institutionData.expiryDate).trim()}T23:59:59Z`);
            if (Number.isFinite(parsed)) expiryMs = parsed;
        }
        if (expiryMs > 0 && Date.now() > expiryMs) {
            return {
                allowed: false,
                reasonCode: 'expired',
                title: 'Subscription Expired',
                message: 'This institution subscription plan has expired. Please contact the platform provider to renew service.',
                expiryDate: String(institutionData.expiryDate || '').trim(),
                institutionName: instName,
                institutionSlug: instSlug,
                allowedPages
            };
        }
    }

    if (requiredPage) {
        let normalizedKey = requiredPage;
        if (requiredPage === 'activity') normalizedKey = 'studentActivity';
        if (requiredPage === 'evaluation') normalizedKey = 'classroomEvaluation';
        if (allowedPages[normalizedKey] === false) {
            return {
                allowed: false,
                reasonCode: 'module_disabled',
                requiredPage: normalizedKey,
                title: 'Premium - Upgrade',
                message: 'This module is not included in your current plan. Upgrade to unlock full access.',
                institutionName: instName,
                institutionSlug: instSlug,
                allowedPages
            };
        }
    }

    return {
        allowed: true,
        reasonCode: 'active',
        institutionName: instName,
        institutionSlug: instSlug,
        allowedPages
    };
};

let tenantLockEscHandler = null;

export const removeTenantLockOverlay = () => {
    if (tenantLockEscHandler && typeof document !== 'undefined') {
        document.removeEventListener('keydown', tenantLockEscHandler);
        tenantLockEscHandler = null;
    }
    const existing = document.getElementById('tenant-status-lock-overlay');
    if (existing) existing.remove();
};

export const showTenantLockOverlay = ({
    reasonCode = 'paused',
    requiredPage = '',
    title = 'Portal Unavailable',
    message = 'This institution portal is currently unavailable.',
    reason = '',
    expiryDate = '',
    institutionName = '',
    institutionSlug = '',
    allowedPages = DEFAULT_COMPANY_ALLOWED_PAGES,
    dismissible = false
} = {}) => {
    if (typeof document === 'undefined') return;
    const isModuleBlock = reasonCode === 'module_disabled';
    const isNotFound = reasonCode === 'not_found';
    const isExpired = reasonCode === 'expired';
    const isUnsubscribed = reasonCode === 'unsubscribed';
    const showPlansAction = !isNotFound && (isModuleBlock || isExpired || isUnsubscribed || reasonCode === 'paused');

    if (tenantLockEscHandler) {
        document.removeEventListener('keydown', tenantLockEscHandler);
        tenantLockEscHandler = null;
    }

    let overlay = document.getElementById('tenant-status-lock-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tenant-status-lock-overlay';
        document.body.appendChild(overlay);
    }
    overlay.style.cssText = dismissible
        ? 'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,0.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;'
        : 'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,0.94);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;';

    const iconClass = isNotFound
        ? 'fa-compass'
        : isExpired
            ? 'fa-hourglass-end'
            : isUnsubscribed
                ? 'fa-lock'
                : isModuleBlock
                    ? 'fa-crown'
                    : 'fa-pause-circle';
    const badgeColor = isNotFound
        ? 'background:#334155;color:#e2e8f0;'
        : isExpired
            ? 'background:#7f1d1d;color:#fecaca;'
            : isUnsubscribed
                ? 'background:#fef3c7;color:#b45309;border:1px solid #fde68a;'
                : isModuleBlock
                    ? 'background:#fef3c7;color:#b45309;border:1px solid #fde68a;'
                    : 'background:#78350f;color:#fde68a;';

    const targetSlug = String(institutionSlug || INSTITUTION_ID || '').trim().toLowerCase();
    const officialHref = window.AppSession?.buildPageUrl?.('official.html', targetSlug || null) || '/official.html';
    const homeHref = window.AppSession?.buildPageUrl?.('index.html?public=1', targetSlug || null) || '/index.html?public=1';
    const canGoOfficial = !dismissible && isModuleBlock && allowedPages?.official !== false;
    const showPublicPageBtn = !dismissible && !isNotFound && !isModuleBlock && Boolean(targetSlug && targetSlug !== 'school');

    overlay.innerHTML = `
        <div id="tenant-lock-card" style="position:relative;max-width:460px;width:100%;background:#ffffff;border-radius:24px;padding:30px 26px;text-align:center;box-shadow:0 30px 70px rgba(0,0,0,0.45);border:1px solid #e2e8f0;font-family:'Plus Jakarta Sans',sans-serif;">
            ${dismissible ? `<button type="button" id="tenant-lock-close-x" aria-label="Close popup" style="position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:18px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">&times;</button>` : ''}
            <div style="width:68px;height:68px;border-radius:20px;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;font-size:28px;${badgeColor}">
                <i class="fas ${escapeHtml(iconClass)}"></i>
            </div>
            ${institutionName ? `<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:6px;">${escapeHtml(institutionName)}</div>` : ''}
            <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 10px;">${escapeHtml(title)}</h2>
            <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 18px;">${escapeHtml(message)}</p>
            ${reason ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:600;color:#92400e;">Reason: ${escapeHtml(reason)}</div>` : ''}
            ${expiryDate ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:600;color:#991b1b;">Expired On: ${escapeHtml(formatDateDisplay(expiryDate))}</div>` : ''}
            <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:20px;">
                ${showPlansAction ? `<button type="button" id="tenant-lock-view-plans-btn" style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;background:#d97706;color:#ffffff;font-weight:800;font-size:13px;border:none;cursor:pointer;"><i class="fas fa-crown"></i><span>View Premium Plans</span></button>` : ''}
                ${dismissible ? `<button type="button" id="tenant-lock-close-btn" style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;background:#f1f5f9;color:#334155;font-weight:700;font-size:13px;border:1px solid #cbd5e1;cursor:pointer;"><i class="fas fa-times"></i><span>Close</span></button>` : ''}
                ${canGoOfficial ? `<a href="${escapeHtml(officialHref)}" style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;background:#4f46e5;color:#ffffff;font-weight:700;font-size:13px;text-decoration:none;"><i class="fas fa-th-large"></i><span>Back to Official Hub</span></a>` : ''}
                ${showPublicPageBtn ? `<a href="${escapeHtml(homeHref)}" style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;background:#2563eb;color:#ffffff;font-weight:700;font-size:13px;text-decoration:none;"><i class="fas fa-globe"></i><span>Public Page</span></a>` : ''}
                ${(!dismissible && !isNotFound) ? `<button type="button" id="tenant-lock-signout-btn" style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;background:#0f172a;color:#ffffff;font-weight:700;font-size:13px;border:none;cursor:pointer;"><i class="fas fa-arrow-right-from-bracket"></i><span>${isModuleBlock ? 'Public Home' : 'Sign Out & Return Home'}</span></button>` : ''}
                ${!dismissible ? `<a href="/" style="display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:12px;background:#f1f5f9;color:#334155;font-weight:700;font-size:13px;text-decoration:none;border:1px solid #cbd5e1;"><i class="fas fa-house"></i><span>Platform Home</span></a>` : ''}
            </div>
        </div>
    `;

    const viewPlansBtn = document.getElementById('tenant-lock-view-plans-btn');
    if (viewPlansBtn) {
        viewPlansBtn.addEventListener('click', () => {
            if (dismissible) removeTenantLockOverlay();
            openPremiumPlansModal({
                contextType: isModuleBlock ? 'module' : (isExpired ? 'expired' : 'paused'),
                moduleKey: requiredPage,
                institutionName,
                institutionSlug: targetSlug,
                pauseReason: reason || (isUnsubscribed ? 'No active subscription plan.' : ''),
                expiryDate
            });
        });
    }

    if (dismissible) {
        const closeXBtn = document.getElementById('tenant-lock-close-x');
        const closeBtn = document.getElementById('tenant-lock-close-btn');
        closeXBtn?.addEventListener('click', removeTenantLockOverlay);
        closeBtn?.addEventListener('click', removeTenantLockOverlay);
        overlay.onclick = (e) => {
            if (e.target === overlay) removeTenantLockOverlay();
        };
        tenantLockEscHandler = (e) => {
            if (e.key === 'Escape') removeTenantLockOverlay();
        };
        document.addEventListener('keydown', tenantLockEscHandler);
    } else {
        overlay.onclick = null;
    }

    const signoutBtn = document.getElementById('tenant-lock-signout-btn');
    if (signoutBtn) {
        signoutBtn.addEventListener('click', () => {
            if (isModuleBlock) {
                window.location.href = homeHref;
            } else {
                window.AppSession?.signOut?.(window.__firebaseAuth, { redirectUrl: '/' });
            }
        });
    }
};

let activeTenantUnsubscribe = null;

export const ensureTenantStatusAndAccess = async ({
    db,
    requiredPage = '',
    institutionId = INSTITUTION_ID,
    allowMissingRoot = false,
    allowPublicIndex = false,
    liveWatch = true,
    onStatusUpdate = null
} = {}) => {
    if (!db) {
        return {
            active: true,
            publicIndexAllowed: true,
            exists: false,
            isRootGateway: false,
            institution: null,
            allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES }
        };
    }

    const cleanSlug = String(institutionId || 'school').trim().toLowerCase() || 'school';
    const instRef = doc(db, INSTITUTIONS_COLLECTION, cleanSlug);

    const handleSnapshot = (snap) => {
        if (!snap.exists()) {
            const canTreatAsRoot = allowMissingRoot && cleanSlug === 'school' && isRootGatewayLocation();
            if (canTreatAsRoot) {
                removeTenantLockOverlay();
                const res = {
                    active: true,
                    publicIndexAllowed: true,
                    exists: false,
                    isRootGateway: true,
                    institution: null,
                    allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES }
                };
                onStatusUpdate?.(res);
                return res;
            }
            const evalRes = evaluateInstitutionAccess(null, requiredPage);
            showTenantLockOverlay(evalRes);
            const res = {
                active: false,
                publicIndexAllowed: false,
                exists: false,
                isRootGateway: false,
                institution: null,
                allowedPages: evalRes.allowedPages,
                evaluation: evalRes
            };
            onStatusUpdate?.(res);
            return res;
        }

        const data = { id: snap.id, ...snap.data() };
        const planInfo = setActiveInstitutionPlan(data);
        const evalRes = evaluateInstitutionAccess(data, requiredPage);
        window.AppSession?.setCompanyAllowedPages?.(evalRes.allowedPages);

        if (!evalRes.allowed) {
            if (allowPublicIndex) {
                removeTenantLockOverlay();
                const res = {
                    active: false,
                    publicIndexAllowed: true,
                    exists: true,
                    isRootGateway: false,
                    institution: data,
                    planInfo,
                    allowedPages: evalRes.allowedPages,
                    evaluation: evalRes
                };
                onStatusUpdate?.(res);
                return res;
            }
            showTenantLockOverlay(evalRes);
            const res = {
                active: false,
                publicIndexAllowed: false,
                exists: true,
                isRootGateway: false,
                institution: data,
                planInfo,
                allowedPages: evalRes.allowedPages,
                evaluation: evalRes
            };
            onStatusUpdate?.(res);
            return res;
        }

        removeTenantLockOverlay();
        const res = {
            active: true,
            publicIndexAllowed: true,
            exists: true,
            isRootGateway: false,
            institution: data,
            planInfo,
            allowedPages: evalRes.allowedPages,
            evaluation: evalRes
        };
        onStatusUpdate?.(res);
        return res;
    };

    let result = {
        active: true,
        exists: false,
        isRootGateway: false,
        institution: null,
        allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES }
    };

    try {
        const snap = await getDoc(instRef);
        result = handleSnapshot(snap);
    } catch (err) {
        console.warn('Institution status check warning:', err);
        if (allowMissingRoot && cleanSlug === 'school' && isRootGatewayLocation()) {
            return {
                active: true,
                exists: false,
                isRootGateway: true,
                institution: null,
                allowedPages: { ...DEFAULT_COMPANY_ALLOWED_PAGES }
            };
        }
    }

    if (liveWatch && typeof onSnapshot === 'function') {
        try {
            if (activeTenantUnsubscribe) activeTenantUnsubscribe();
            activeTenantUnsubscribe = onSnapshot(instRef, (liveSnap) => {
                handleSnapshot(liveSnap);
            }, (err) => {
                console.warn('Tenant status live watcher notice:', err);
            });
        } catch (_) {}
    }

    return result;
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const initUnifiedFooterAuto = () => {
        try {
            mountUnifiedFooter();
        } catch (err) {
            console.warn('Unified footer mount notice:', err);
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUnifiedFooterAuto, { once: true });
    } else {
        setTimeout(initUnifiedFooterAuto, 0);
    }
}

