import { APP_VERSION, LAST_UPDATED, RELEASE_STAGE } from '../../config/version.js';
import { BASE_PATH } from '../../config/app-config.js';

export { BASE_PATH };
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

const DEFAULT_LOGO_URL = '/assets/images/logo.png';
const LOGO_CACHE_KEY = 'institution_logo_url_v1';
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
    try {
        return normalizeLogoUrl(localStorage.getItem(LOGO_CACHE_KEY) || '');
    } catch (_error) {
        return '';
    }
};

export const rememberInstitutionLogo = (logoUrl = '') => {
    const normalizedLogo = normalizeLogoUrl(logoUrl);
    try {
        if (normalizedLogo) localStorage.setItem(LOGO_CACHE_KEY, normalizedLogo);
        else localStorage.removeItem(LOGO_CACHE_KEY);
    } catch (_error) {}
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
        document.querySelectorAll('.smart-select-list.active').forEach((el) => el.classList.remove('active'));
    };

    selects.forEach((select) => {
        select.dataset.smartWindowBound = 'true';
        const wrapper = document.createElement('div');
        wrapper.className = 'smart-select-wrapper relative w-full';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = select.className;
        input.classList.add('smart-select-input', 'pr-8');
        input.placeholder = 'Type or select...';
        input.autocomplete = 'off';
        if (select.id) input.setAttribute('aria-controls', `${select.id}-smart-list`);
        wrapper.insertBefore(input, select);

        const caret = document.createElement('i');
        caret.className = 'fas fa-chevron-down smart-select-caret';
        caret.setAttribute('aria-hidden', 'true');
        wrapper.insertBefore(caret, select);

        const list = document.createElement('div');
        list.className = 'suggestions-box smart-select-list';
        if (select.id) list.id = `${select.id}-smart-list`;
        wrapper.appendChild(list);

        select.classList.add('smart-select-native-hidden');
        select.tabIndex = -1;

        let activeIndex = -1;
        const getOptionItems = () => Array.from(list.querySelectorAll('.smart-select-option'));

        const highlightOption = (idx) => {
            const items = getOptionItems();
            items.forEach((item, i) => item.classList.toggle('smart-active-option', i === idx));
            activeIndex = idx;
            if (idx >= 0 && items[idx]) {
                items[idx].scrollIntoView({ block: 'nearest' });
            }
        };

        const renderList = (term = '') => {
            const normalizedTerm = String(term || '').trim().toLowerCase();
            const options = Array.from(select.options);
            const filtered = options.filter((option) => String(option.textContent || '').toLowerCase().includes(normalizedTerm));
            activeIndex = -1;
            list.innerHTML = filtered.length
                ? filtered.map((option) => `<div class="suggestion-item smart-select-option ${option.value === select.value ? 'smart-selected-option' : ''}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.textContent || '')}</div>`).join('')
                : '<div class="suggestion-item text-gray-400">No matches</div>';
            list.classList.add('active');
            const selectedIdx = filtered.findIndex((o) => o.value === select.value);
            if (selectedIdx >= 0) highlightOption(selectedIdx);
        };

        const syncInputValue = () => {
            const selectedOption = select.options[select.selectedIndex];
            input.value = selectedOption ? selectedOption.textContent : '';
        };

        select._syncSmartSelect = syncInputValue;

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

        syncInputValue();
        input.addEventListener('focus', () => {
            closeAll();
            renderList('');
            input.select?.();
        });
        input.addEventListener('input', () => renderList(input.value));
        input.addEventListener('click', (event) => {
            event.stopPropagation();
            closeAll();
            renderList('');
            input.select?.();
        });
        input.addEventListener('keydown', (event) => {
            const items = getOptionItems();
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!list.classList.contains('active')) renderList('');
                const nextItems = getOptionItems();
                if (nextItems.length > 0) {
                    highlightOption((activeIndex + 1) % nextItems.length);
                }
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!list.classList.contains('active')) renderList('');
                const nextItems = getOptionItems();
                if (nextItems.length > 0) {
                    highlightOption(activeIndex <= 0 ? nextItems.length - 1 : activeIndex - 1);
                }
            } else if (event.key === 'Enter') {
                if (!list.classList.contains('active')) return;
                event.preventDefault();
                const targetItem = (activeIndex >= 0 && items[activeIndex]) ? items[activeIndex] : items[0];
                if (targetItem) {
                    select.value = targetItem.dataset.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    syncInputValue();
                    list.classList.remove('active');
                    input.blur();
                }
            } else if (event.key === 'Escape') {
                list.classList.remove('active');
                syncInputValue();
                input.blur();
            }
        });
        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (!list.matches(':hover')) {
                    list.classList.remove('active');
                    syncInputValue();
                }
            }, 160);
        });

        list.addEventListener('mousedown', (event) => {
            const optionEl = event.target.closest('.smart-select-option');
            if (!optionEl) return;
            event.preventDefault();
            select.value = optionEl.dataset.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncInputValue();
            list.classList.remove('active');
            input.blur();
        });

        select.addEventListener('change', syncInputValue);
        const observer = new MutationObserver(() => syncInputValue());
        observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });
    });

    if (typeof document !== 'undefined' && !document.documentElement?.dataset?.smartSelectGlobalBound) {
        if (document.documentElement?.dataset) document.documentElement.dataset.smartSelectGlobalBound = 'true';
        document.addEventListener('click', (event) => {
            if (event.target.closest('.smart-select-wrapper')) return;
            closeAll();
        });
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

    setText(versionId, `${prefix}: ${APP_VERSION}`);
    setText(updatedId, `Last Updated: ${LAST_UPDATED}`);
};

export const applyInstitutionBranding = (conf = {}, options = {}) => {
    const {
        defaultAppName = 'Institution Tracer',
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

    rememberInstitutionLogo(conf.logoUrl || '');
    setLogo(logoIds, conf.logoUrl);
    const effectiveFavicon = normalizeLogoUrl(conf.logoUrl) || DEFAULT_LOGO_URL;
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((linkEl) => {
        if (linkEl.getAttribute('href') !== effectiveFavicon) {
            linkEl.setAttribute('href', effectiveFavicon);
        }
    });

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
