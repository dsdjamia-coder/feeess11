import {
    DEFAULT_LOGO_URL,
    DEFAULT_PWA_ICON_192,
    escapeHtml,
    getActivePwaBranding,
    registerServiceWorker
} from './app-common.js';

let deferredPrompt = null;
let promptListenersInitialized = false;
let relatedAppInstalled = false;
const registeredPortals = new Map();
const registeredTriggers = new Map();
const INSTALLED_FLAG_KEY = 'app_pwa_installed_v1';

const getPersistedInstalledFlag = () => {
    try {
        return localStorage.getItem(INSTALLED_FLAG_KEY) === 'true';
    } catch (_err) {
        return false;
    }
};

const setPersistedInstalledFlag = (installed) => {
    try {
        if (installed) {
            localStorage.setItem(INSTALLED_FLAG_KEY, 'true');
        } else {
            localStorage.removeItem(INSTALLED_FLAG_KEY);
        }
    } catch (_err) {}
};

export const isAppStandalone = () => {
    if (typeof window === 'undefined') return false;
    const displayStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches ||
           window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches ||
           window.matchMedia?.('(display-mode: minimal-ui)')?.matches ||
           window.navigator.standalone === true ||
           document.referrer.includes('android-app://');
    return Boolean(displayStandalone);
};

export const isAppInstalled = () => {
    return isAppStandalone() || relatedAppInstalled || getPersistedInstalledFlag();
};

export const detectInstallPlatform = () => {
    if (typeof window === 'undefined') {
        return { os: 'other', tab: 'desktop', label: 'This Device' };
    }
    const ua = String(window.navigator.userAgent || '').toLowerCase();
    const platform = String(window.navigator.platform || '').toLowerCase();
    const maxTouchPoints = Number(window.navigator.maxTouchPoints || 0);

    const isIos = /iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && maxTouchPoints > 1);
    if (isIos) {
        return { os: 'ios', tab: 'ios', label: /ipad/.test(ua) || (platform === 'macintel' && maxTouchPoints > 1) ? 'iPad' : 'iPhone' };
    }
    if (/android/.test(ua)) {
        return { os: 'android', tab: 'android', label: 'Android' };
    }
    if (/win/.test(platform) || /windows/.test(ua)) {
        return { os: 'windows', tab: 'desktop', label: 'Windows PC' };
    }
    if (/mac/.test(platform) || /macintosh|mac os x/.test(ua)) {
        return { os: 'macos', tab: 'desktop', label: 'macOS' };
    }
    if (/linux|x11|cros/.test(platform) || /linux|cros/.test(ua)) {
        return { os: 'linux', tab: 'desktop', label: 'Linux / Chromebook' };
    }
    return { os: 'other', tab: 'desktop', label: 'This Device' };
};

const getCompanyAppIconUrl = () => {
    const branding = getActivePwaBranding();
    return branding.iconUrl || DEFAULT_PWA_ICON_192 || DEFAULT_LOGO_URL;
};

const DISMISS_SESSION_KEY = 'pwa_install_dismissed';

export const isPromptDismissedThisSession = () => {
    try {
        return sessionStorage.getItem(DISMISS_SESSION_KEY) === 'true';
    } catch (_err) {
        return false;
    }
};

export const markPromptDismissed = () => {
    try {
        sessionStorage.setItem(DISMISS_SESSION_KEY, 'true');
    } catch (_err) {}
};

export const clearPromptDismissed = () => {
    try {
        sessionStorage.removeItem(DISMISS_SESSION_KEY);
    } catch (_err) {}
};

const refreshInstallModalBranding = () => {
    const branding = getActivePwaBranding();
    const companyIcon = getCompanyAppIconUrl();
    const logoImg = document.getElementById('pwa-install-modal-logo');
    const titleEl = document.getElementById('pwa-install-modal-title');
    const descEl = document.getElementById('pwa-install-modal-desc');

    if (logoImg) {
        logoImg.src = companyIcon;
        logoImg.onerror = () => {
            logoImg.onerror = null;
            logoImg.src = DEFAULT_LOGO_URL;
        };
    }
    if (titleEl) {
        titleEl.textContent = branding.name ? `Install ${branding.name}` : 'Install App';
    }
    if (descEl) {
        descEl.textContent = branding.isRoot
            ? 'Install Institution Manage on your device for instant launch and a native app experience.'
            : `Install ${branding.name} on your home screen for one-tap portal access across Android, iPhone, iPad, Windows, and Mac.`;
    }

    const guideLogoImg = document.getElementById('pwa-device-guide-logo');
    const guideTitleEl = document.getElementById('pwa-device-guide-title');
    if (guideLogoImg) {
        guideLogoImg.src = companyIcon;
    }
    if (guideTitleEl) {
        guideTitleEl.textContent = branding.name ? `Install ${branding.name}` : 'Install App';
    }
};

const syncAllInstallStates = () => {
    registeredPortals.forEach((config) => {
        updatePortalInstallState(config);
    });
    registeredTriggers.forEach((config) => {
        updateTriggerInstallState(config);
    });
};

export const initPwaPromptListener = () => {
    if (promptListenersInitialized) return;
    promptListenersInitialized = true;

    registerServiceWorker();

    window.addEventListener('pwa-branding-updated', () => {
        refreshInstallModalBranding();
        syncAllInstallStates();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        // Browser only fires beforeinstallprompt when the PWA is not currently installed
        relatedAppInstalled = false;
        setPersistedInstalledFlag(false);
        syncAllInstallStates();
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        relatedAppInstalled = true;
        setPersistedInstalledFlag(true);
        clearPromptDismissed();
        hideInstallModal();
        const guideModal = document.getElementById('pwa-device-guide-modal');
        if (guideModal) guideModal.remove();
        syncAllInstallStates();
    });

    if (typeof window !== 'undefined' && window.matchMedia) {
        try {
            const standaloneMedia = window.matchMedia('(display-mode: standalone)');
            if (typeof standaloneMedia.addEventListener === 'function') {
                standaloneMedia.addEventListener('change', () => syncAllInstallStates());
            }
        } catch (_err) {}
    }

    if (typeof navigator !== 'undefined' && typeof navigator.getInstalledRelatedApps === 'function') {
        navigator.getInstalledRelatedApps().then((apps) => {
            if (Array.isArray(apps) && apps.length > 0) {
                relatedAppInstalled = true;
                setPersistedInstalledFlag(true);
                syncAllInstallStates();
            }
        }).catch(() => {});
    }
};

const ensureInstallModal = () => {
    let modal = document.getElementById('pwa-install-modal');
    if (modal) {
        refreshInstallModalBranding();
        return modal;
    }

    const branding = getActivePwaBranding();
    const companyIcon = getCompanyAppIconUrl();
    modal = document.createElement('div');
    modal.id = 'pwa-install-modal';
    modal.className = 'fixed inset-0 z-[9999] hidden items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 no-print';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pwa-install-modal-title');
    modal.innerHTML = `
        <div class="relative w-full max-w-sm rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-200">
            <button type="button" id="pwa-install-close-btn" class="absolute top-3.5 right-3.5 h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center transition cursor-pointer border-none" aria-label="Close">
                <i class="fas fa-times text-xs" aria-hidden="true"></i>
            </button>
            <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white border border-slate-200 p-2 flex items-center justify-center shadow-md">
                <img id="pwa-install-modal-logo" src="${escapeHtml(companyIcon)}" alt="App Icon" class="w-full h-full object-contain rounded-xl" referrerpolicy="no-referrer">
            </div>
            <h3 id="pwa-install-modal-title" class="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight mb-2">${escapeHtml(branding.name ? `Install ${branding.name}` : 'Install App')}</h3>
            <p id="pwa-install-modal-desc" class="text-xs sm:text-sm text-slate-600 mb-6 leading-relaxed">
                ${escapeHtml(branding.isRoot ? 'Install Institution Manage on your device for instant launch and a native app experience.' : `Install ${branding.name} on your home screen for one-tap portal access across Android, iPhone, iPad, Windows, and Mac.`)}
            </p>
            <div class="flex flex-col gap-2.5">
                <button type="button" id="pwa-install-action-btn" class="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-bold shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer border-none">
                    <i class="fas fa-download" aria-hidden="true"></i>
                    <span>Install Now</span>
                </button>
                <button type="button" id="pwa-install-later-btn" class="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 text-xs font-bold transition-all cursor-pointer border-none">
                    Later
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    refreshInstallModalBranding();
    return modal;
};

export const showDeviceInstallGuide = (preferredTab = '') => {
    const existing = document.getElementById('pwa-device-guide-modal');
    if (existing) existing.remove();

    const branding = getActivePwaBranding();
    const companyIcon = getCompanyAppIconUrl();
    const detected = detectInstallPlatform();
    const initialTab = ['android', 'ios', 'desktop'].includes(preferredTab) ? preferredTab : detected.tab;
    const appTitle = branding.name || 'Institution Manage';

    const guideModal = document.createElement('div');
    guideModal.id = 'pwa-device-guide-modal';
    guideModal.className = 'fixed inset-0 z-[10050] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 no-print';
    guideModal.setAttribute('role', 'dialog');
    guideModal.setAttribute('aria-modal', 'true');
    guideModal.setAttribute('aria-labelledby', 'pwa-device-guide-title');

    guideModal.innerHTML = `
        <div class="relative w-full max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-slate-200 text-left">
            <button type="button" id="pwa-device-guide-close" class="absolute top-3.5 right-3.5 h-8 w-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer border-none" aria-label="Close install guide">
                <i class="fas fa-times text-xs" aria-hidden="true"></i>
            </button>

            <div class="flex items-center gap-3.5 pr-8 mb-4">
                <div class="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 p-1.5 flex items-center justify-center shrink-0">
                    <img id="pwa-device-guide-logo" src="${escapeHtml(companyIcon)}" alt="App Icon" class="w-full h-full object-contain rounded-lg" referrerpolicy="no-referrer">
                </div>
                <div class="min-w-0">
                    <h3 id="pwa-device-guide-title" class="text-base sm:text-lg font-extrabold text-slate-900 leading-tight truncate">Install ${escapeHtml(appTitle)}</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Works on Android, iPhone, iPad, Windows &amp; macOS</p>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/80 mb-4" role="tablist" aria-label="Device platform instructions">
                <button type="button" role="tab" data-guide-tab="android" class="px-2.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer border-none flex items-center justify-center gap-1.5">
                    <i class="fa-brands fa-android text-sm" aria-hidden="true"></i>
                    <span>Android</span>
                </button>
                <button type="button" role="tab" data-guide-tab="ios" class="px-2.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer border-none flex items-center justify-center gap-1.5">
                    <i class="fa-brands fa-apple text-sm" aria-hidden="true"></i>
                    <span>iPhone / iPad</span>
                </button>
                <button type="button" role="tab" data-guide-tab="desktop" class="px-2.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer border-none flex items-center justify-center gap-1.5">
                    <i class="fas fa-laptop text-xs" aria-hidden="true"></i>
                    <span>PC / Mac</span>
                </button>
            </div>

            <div data-guide-panel="android" class="hidden space-y-2.5 mb-5">
                <div class="text-xs font-bold text-slate-500">Google Chrome · Microsoft Edge · Samsung Internet</div>
                <ol class="space-y-2 text-xs sm:text-sm text-slate-700 leading-relaxed">
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                        <span>Open this page in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on your Android phone or tablet.</span>
                    </li>
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                        <span>Tap the browser menu icon <strong class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-900">⋮</strong> at the top-right corner.</span>
                    </li>
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                        <span>Select <strong>Install app</strong> or <strong>Add to Home screen</strong>, then tap <strong>Install</strong>.</span>
                    </li>
                </ol>
            </div>

            <div data-guide-panel="ios" class="hidden space-y-2.5 mb-5">
                <div class="text-xs font-bold text-slate-500">Safari Browser on iPhone &amp; iPad</div>
                <ol class="space-y-2 text-xs sm:text-sm text-slate-700 leading-relaxed">
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                        <span>Open this page in <strong>Safari</strong> on your iPhone or iPad.</span>
                    </li>
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                        <span>Tap the <strong>Share</strong> button <i class="fas fa-arrow-up-from-bracket mx-1 text-blue-600" aria-hidden="true"></i> in the Safari toolbar.</span>
                    </li>
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                        <span>Scroll down, tap <strong>Add to Home Screen</strong>, and tap <strong>Add</strong> at the top right.</span>
                    </li>
                </ol>
            </div>

            <div data-guide-panel="desktop" class="hidden space-y-2.5 mb-5">
                <div class="text-xs font-bold text-slate-500">Windows 10/11 · macOS · Linux (Chrome / Edge)</div>
                <ol class="space-y-2 text-xs sm:text-sm text-slate-700 leading-relaxed">
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                        <span>Open this page in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on your computer.</span>
                    </li>
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                        <span>Click the <strong>Install</strong> icon <i class="fas fa-download mx-1 text-blue-600 text-xs" aria-hidden="true"></i> in the right side of the address bar, or open menu <strong>⋮</strong>.</span>
                    </li>
                    <li class="flex items-start gap-2.5">
                        <span class="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                        <span>Click <strong>Install ${escapeHtml(appTitle)}</strong> (or <strong>Cast, save, and share → Install page as app</strong>).</span>
                    </li>
                </ol>
            </div>

            <div class="pt-3.5 border-t border-slate-100 flex items-center justify-between gap-3">
                <span class="text-[11px] text-slate-500 font-medium">No App Store required · Always up to date</span>
                <button type="button" id="pwa-device-guide-ok" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold transition border-none cursor-pointer shrink-0">
                    Got it
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(guideModal);

    const logoEl = document.getElementById('pwa-device-guide-logo');
    if (logoEl) {
        logoEl.onerror = () => {
            logoEl.onerror = null;
            logoEl.src = DEFAULT_LOGO_URL;
        };
    }

    const tabs = Array.from(guideModal.querySelectorAll('[data-guide-tab]'));
    const panels = Array.from(guideModal.querySelectorAll('[data-guide-panel]'));
    const activateTab = (tabKey) => {
        tabs.forEach((btn) => {
            const active = btn.getAttribute('data-guide-tab') === tabKey;
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.className = active
                ? 'px-2.5 py-2 rounded-lg text-xs font-extrabold bg-white text-slate-900 shadow-xs transition-colors cursor-pointer border-none flex items-center justify-center gap-1.5'
                : 'px-2.5 py-2 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 bg-transparent transition-colors cursor-pointer border-none flex items-center justify-center gap-1.5';
        });
        panels.forEach((panel) => {
            panel.classList.toggle('hidden', panel.getAttribute('data-guide-panel') !== tabKey);
        });
    };

    tabs.forEach((btn) => {
        btn.addEventListener('click', () => {
            activateTab(btn.getAttribute('data-guide-tab') || 'android');
        });
    });
    activateTab(initialTab);

    const handleKeydown = (e) => {
        if (e.key === 'Escape') close();
    };
    const close = () => {
        document.removeEventListener('keydown', handleKeydown);
        guideModal.remove();
    };

    document.addEventListener('keydown', handleKeydown);
    guideModal.addEventListener('click', (e) => {
        if (e.target === guideModal) close();
    });
    document.getElementById('pwa-device-guide-close')?.addEventListener('click', close);
    document.getElementById('pwa-device-guide-ok')?.addEventListener('click', close);
};

export const promptInstall = async ({ preferredTab = '', openGuideOnFallback = true } = {}) => {
    if (isAppInstalled()) return false;
    if (deferredPrompt) {
        try {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            if (outcome === 'accepted') {
                relatedAppInstalled = true;
                setPersistedInstalledFlag(true);
            }
            syncAllInstallStates();
            return outcome === 'accepted';
        } catch (_err) {
            deferredPrompt = null;
            syncAllInstallStates();
            if (openGuideOnFallback) {
                showDeviceInstallGuide(preferredTab);
            }
            return false;
        }
    }
    if (openGuideOnFallback) {
        showDeviceInstallGuide(preferredTab);
    }
    return false;
};

const hideInstallModal = () => {
    const modal = document.getElementById('pwa-install-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

const showInstallModal = (config) => {
    if (isAppStandalone()) return;
    const modal = ensureInstallModal();
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const confirmBtn = document.getElementById('pwa-install-action-btn');
    const laterBtn = document.getElementById('pwa-install-later-btn');
    const closeBtn = document.getElementById('pwa-install-close-btn');

    const handleDismiss = () => {
        hideInstallModal();
        markPromptDismissed();
        showMenuInstallButton(config);
    };

    if (confirmBtn && !confirmBtn.dataset.bound) {
        confirmBtn.dataset.bound = 'true';
        confirmBtn.addEventListener('click', async () => {
            hideInstallModal();
            await promptInstall();
        });
    }

    if (laterBtn && !laterBtn.dataset.bound) {
        laterBtn.dataset.bound = 'true';
        laterBtn.addEventListener('click', handleDismiss);
    }

    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', handleDismiss);
    }
};

const showMenuInstallButton = (config) => {
    if (isAppInstalled()) return;
    const menuItem = document.getElementById(config.menuItemId);
    if (menuItem) {
        menuItem.classList.remove('hidden');
    }
};

const hideMenuInstallButton = (config) => {
    const menuItem = document.getElementById(config.menuItemId);
    if (menuItem) {
        menuItem.classList.add('hidden');
    }
};

const updatePortalInstallState = (config) => {
    if (isAppInstalled()) {
        hideInstallModal();
        hideMenuInstallButton(config);
        return;
    }
    // Always keep the menu Install App entry visible when running in a browser so any device can install
    showMenuInstallButton(config);
};

const updateTriggerInstallState = (config) => {
    const standalone = isAppInstalled();
    const platform = detectInstallPlatform();
    const canPromptNatively = Boolean(deferredPrompt);

    (config.containerIds || []).forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (standalone && config.hideWhenStandalone) {
            el.classList.add('hidden');
        } else {
            el.classList.remove('hidden');
        }
    });

    (config.buttonIds || []).forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (standalone && config.hideWhenStandalone) {
            btn.classList.add('hidden');
        } else {
            btn.classList.remove('hidden');
            if (standalone && !config.hideWhenStandalone) {
                btn.disabled = true;
                btn.classList.add('opacity-75', 'cursor-default');
                const labelEl = btn.querySelector('[data-install-btn-label]');
                if (labelEl) labelEl.textContent = 'App Installed on This Device';
            } else {
                btn.disabled = false;
                btn.classList.remove('opacity-75', 'cursor-default');
                const labelEl = btn.querySelector('[data-install-btn-label]');
                if (labelEl && btn.dataset.defaultInstallLabel) {
                    labelEl.textContent = btn.dataset.defaultInstallLabel;
                }
            }
        }
    });

    (config.statusTextIds || []).forEach((id) => {
        const statusEl = document.getElementById(id);
        if (!statusEl) return;
        if (standalone) {
            statusEl.textContent = `Running as installed app on ${platform.label}.`;
        } else if (canPromptNatively) {
            statusEl.textContent = `Detected ${platform.label} · Ready for instant one-tap installation.`;
        } else if (platform.os === 'ios') {
            statusEl.textContent = `Detected ${platform.label} · Tap Install App for quick Safari Add to Home Screen steps.`;
        } else {
            statusEl.textContent = `Detected ${platform.label} · Supported on Android, iPhone, iPad, Windows, macOS & Linux.`;
        }
    });

    if (typeof config.onStateChange === 'function') {
        config.onStateChange({ standalone, canPromptNatively, platform });
    }
};

export const registerInstallTrigger = ({
    key = 'default',
    buttonIds = [],
    containerIds = [],
    statusTextIds = [],
    hideWhenStandalone = true,
    onBeforeTrigger = null,
    onStateChange = null
} = {}) => {
    const config = {
        key,
        buttonIds,
        containerIds,
        statusTextIds,
        hideWhenStandalone,
        onBeforeTrigger,
        onStateChange
    };
    registeredTriggers.set(key, config);
    initPwaPromptListener();

    buttonIds.forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn || btn.dataset.boundPwaTrigger) return;
        btn.dataset.boundPwaTrigger = 'true';
        const labelEl = btn.querySelector('[data-install-btn-label]');
        if (labelEl && !btn.dataset.defaultInstallLabel) {
            btn.dataset.defaultInstallLabel = labelEl.textContent.trim();
        }
        btn.addEventListener('click', async () => {
            if (isAppInstalled()) return;
            if (typeof config.onBeforeTrigger === 'function') {
                config.onBeforeTrigger(btn);
            }
            await promptInstall();
        });
    });

    updateTriggerInstallState(config);
    return {
        refresh: () => updateTriggerInstallState(config)
    };
};

export const registerPortalForPwa = (portalKey, { menuItemId, menuBtnId }) => {
    const config = { portalKey, menuItemId, menuBtnId };
    registeredPortals.set(portalKey, config);
    initPwaPromptListener();

    const menuBtn = document.getElementById(menuBtnId);
    if (menuBtn && !menuBtn.dataset.boundPwa) {
        menuBtn.dataset.boundPwa = 'true';
        menuBtn.addEventListener('click', async () => {
            await promptInstall();
        });
    }

    updatePortalInstallState(config);

    return {
        showPopupIfEligible: () => {
            if (isAppInstalled()) return;
            if (isPromptDismissedThisSession()) {
                showMenuInstallButton(config);
                return;
            }
            setTimeout(() => {
                if (!isAppInstalled() && !isPromptDismissedThisSession()) {
                    showInstallModal(config);
                }
            }, 600);
        }
    };
};
