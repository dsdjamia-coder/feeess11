import { DEFAULT_LOGO_URL, escapeHtml, getActivePwaBranding, registerServiceWorker } from './app-common.js';

let deferredPrompt = null;
let promptListenersInitialized = false;
const registeredPortals = new Map();

export const isAppStandalone = () => {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.includes('android-app://');
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
    const logoImg = document.getElementById('pwa-install-modal-logo');
    const titleEl = document.getElementById('pwa-install-modal-title');
    const descEl = document.getElementById('pwa-install-modal-desc');
    if (logoImg) {
        logoImg.src = branding.logoUrl || DEFAULT_LOGO_URL;
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
            ? 'Install Institution Manage on your device for fast access and a native app experience.'
            : `Install ${branding.name} on your device with its official app icon for fast access and offline support.`;
    }
};

export const initPwaPromptListener = () => {
    if (promptListenersInitialized) return;
    promptListenersInitialized = true;

    registerServiceWorker();

    window.addEventListener('pwa-branding-updated', () => {
        refreshInstallModalBranding();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        registeredPortals.forEach((config) => {
            updatePortalInstallState(config);
        });
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        clearPromptDismissed();
        registeredPortals.forEach((config) => {
            hideInstallModal();
            hideMenuInstallButton(config);
        });
    });
};

const ensureInstallModal = () => {
    let modal = document.getElementById('pwa-install-modal');
    if (modal) {
        refreshInstallModalBranding();
        return modal;
    }

    const branding = getActivePwaBranding();
    modal = document.createElement('div');
    modal.id = 'pwa-install-modal';
    modal.className = 'fixed inset-0 z-[9999] hidden items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 no-print';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pwa-install-modal-title');
    modal.innerHTML = `
        <div class="relative w-full max-w-sm rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-200">
            <button type="button" id="pwa-install-close-btn" class="absolute top-3.5 right-3.5 h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center transition cursor-pointer border-none" aria-label="Close">
                <i class="fas fa-times text-xs"></i>
            </button>
            <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white border border-slate-200 p-2 flex items-center justify-center shadow-md">
                <img id="pwa-install-modal-logo" src="${escapeHtml(branding.logoUrl || DEFAULT_LOGO_URL)}" alt="App Icon" class="w-full h-full object-contain rounded-xl" referrerpolicy="no-referrer">
            </div>
            <h3 id="pwa-install-modal-title" class="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight mb-2">${escapeHtml(branding.name ? `Install ${branding.name}` : 'Install App')}</h3>
            <p id="pwa-install-modal-desc" class="text-xs sm:text-sm text-slate-600 mb-6 leading-relaxed">
                ${escapeHtml(branding.isRoot ? 'Install Institution Manage on your device for fast access and a native app experience.' : `Install ${branding.name} on your device with its official app icon for fast access and offline support.`)}
            </p>
            <div class="flex flex-col gap-2.5">
                <button type="button" id="pwa-install-action-btn" class="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-bold shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer border-none">
                    <i class="fas fa-download"></i>
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

const showIosInstallGuide = () => {
    let guideModal = document.getElementById('pwa-ios-guide-modal');
    if (!guideModal) {
        const branding = getActivePwaBranding();
        guideModal = document.createElement('div');
        guideModal.id = 'pwa-ios-guide-modal';
        guideModal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 no-print';
        guideModal.innerHTML = `
            <div class="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-200">
                <button type="button" id="pwa-ios-guide-close" class="absolute top-3.5 right-3.5 h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center transition cursor-pointer border-none" aria-label="Close">
                    <i class="fas fa-times text-xs"></i>
                </button>
                <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white border border-slate-200 p-2 flex items-center justify-center shadow-sm">
                    <img src="${escapeHtml(branding.logoUrl || DEFAULT_LOGO_URL)}" alt="App Icon" class="w-full h-full object-contain rounded-xl" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/assets/images/logo.png'">
                </div>
                <h3 class="text-base sm:text-lg font-extrabold text-slate-900 mb-2">Install ${escapeHtml(branding.name || 'App')} on iOS</h3>
                <p class="text-xs text-slate-600 mb-4 leading-relaxed text-left">
                    1. Tap the <strong>Share</strong> button <i class="fas fa-arrow-up-from-bracket mx-1 text-blue-600"></i> in Safari.<br>
                    2. Scroll down and tap <strong>Add to Home Screen</strong> <i class="fas fa-plus-square mx-1 text-slate-700"></i>.<br>
                    3. Tap <strong>Add</strong> in the top right.
                </p>
                <button type="button" id="pwa-ios-guide-ok" class="w-full py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition border-none cursor-pointer">
                    Got it
                </button>
            </div>
        `;
        document.body.appendChild(guideModal);
        const close = () => guideModal.remove();
        document.getElementById('pwa-ios-guide-close')?.addEventListener('click', close);
        document.getElementById('pwa-ios-guide-ok')?.addEventListener('click', close);
    }
};

const isIosDevice = () => {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
};

export const promptInstall = async () => {
    if (deferredPrompt) {
        try {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                console.log('App install accepted by user');
            }
            deferredPrompt = null;
            return true;
        } catch (_err) {
            return false;
        }
    } else if (isIosDevice()) {
        showIosInstallGuide();
        return false;
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
    if (isAppStandalone()) return;
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
    if (isAppStandalone()) {
        hideInstallModal();
        hideMenuInstallButton(config);
        return;
    }
    // Make sure hamburger menu has install option if dismissed or if deferred prompt is available
    if (isPromptDismissedThisSession() || deferredPrompt || isIosDevice()) {
        showMenuInstallButton(config);
    }
};

export const registerPortalForPwa = (portalKey, { menuItemId, menuBtnId }) => {
    const config = { portalKey, menuItemId, menuBtnId };
    registeredPortals.set(portalKey, config);
    initPwaPromptListener();

    const menuBtn = document.getElementById(menuBtnId);
    if (menuBtn && !menuBtn.dataset.boundPwa) {
        menuBtn.dataset.boundPwa = 'true';
        menuBtn.addEventListener('click', async () => {
            const success = await promptInstall();
            if (!success && !deferredPrompt && !isIosDevice()) {
                // If deferredPrompt is not yet ready, show popup modal as a friendly trigger
                showInstallModal(config);
            }
        });
    }

    updatePortalInstallState(config);

    return {
        showPopupIfEligible: () => {
            if (isAppStandalone()) return;
            if (isPromptDismissedThisSession()) {
                showMenuInstallButton(config);
                return;
            }
            setTimeout(() => {
                if (!isAppStandalone() && !isPromptDismissedThisSession()) {
                    showInstallModal(config);
                }
            }, 600);
        }
    };
};
