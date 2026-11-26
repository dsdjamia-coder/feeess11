import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInAnonymously, signOut, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, onSnapshot, collection, getDoc, getDocFromServer, getDocs, setDoc, query, where, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth, firebaseConfig } from '../../config/firebase-config.js';
import {
    ADMIN_AUTH_DOC_ID,
    COMPANY_COLLECTION,
    COMPANY_CONFIG_DOC_ID,
    COMPANY_PUBLIC_CATALOG_DOC_ID,
    COMPANY_SHOWCASES_SUBCOLLECTION,
    INSTITUTIONS_COLLECTION,
    INSTITUTION_ID,
    PLATFORM_SHOWCASE_PAGES,
    RESERVED_INSTITUTION_SLUGS,
    SINGLE_ADMIN_MODE,
    isRootGatewayLocation
} from '../../config/app-config.js';
import {
    BASE_PATH,
    applyInstitutionBranding,
    ensureTenantStatusAndAccess,
    escapeHtml,
    getPlanLimit,
    hardenExternalLinks,
    isBasicPlan,
    isElitePlan,
    mountUnifiedFooter,
    normalizePhone,
    openPremiumPlansModal,
    renderVersionInfo,
    sanitizePhone,
    sanitizeUrl,
    showTenantLockOverlay,
    syncDynamicPwaBranding
} from '../shared/app-common.js';
import { fetchCompanyPublicCatalog, renderPublicPricingSection } from '../shared/premium-plans-modal.js';
import {
    initPwaPromptListener,
    registerInstallTrigger,
    showDeviceInstallGuide
} from '../shared/pwa-install.js';
import {
    verifyLoginIdentifier,
    verifyOfficialPasswordForOtp,
    completeOfficialOtpLoginAndSignIn,
    verifyDirectoryPasswordForOtp,
    completeDirectoryOtpLogin,
    lookupStudentsByPhone,
    completeStudentOtpLogin,
    initiateCompanyOwnerOtp,
    completeCompanyOwnerOtpLogin,
    normalizePhoneToE164Client
} from '../shared/custom-auth-service.js';
import { openSelfSignupWizard } from './self-signup-wizard.js';

window.openSelfSignupWizard = openSelfSignupWizard;

let companyOtpAuthInstance = null;
const getCompanyOtpAuth = () => {
    if (companyOtpAuthInstance) return companyOtpAuthInstance;
    const existing = getApps().find((a) => a.name === 'company-otp-verifier');
    const secondaryApp = existing || initializeApp(firebaseConfig, 'company-otp-verifier');
    companyOtpAuthInstance = getAuth(secondaryApp);
    return companyOtpAuthInstance;
};

const getPageUrl = (target = '') => window.AppSession?.buildPageUrl?.(target) || target;
let isRootGatewayMode = false;

        hardenExternalLinks();

        // Hamburger Menu Logic with 'X' Animation
        const mobileToggle = document.getElementById('mobile-menu-btn');
        const navMenu = document.querySelector('.nav-menu');
        const setMobileMenuState = (isOpen) => {
            navMenu.classList.toggle('active', isOpen);
            mobileToggle.classList.toggle('active-toggle', isOpen);
            mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        };

        mobileToggle.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            setMobileMenuState(!navMenu.classList.contains('active'));
        });

        document.addEventListener('click', (e) => { 
            if (!navMenu.contains(e.target) && !mobileToggle.contains(e.target)) { 
                setMobileMenuState(false);
            } 
        });

        document.querySelectorAll('.nav-link').forEach(link => { 
            link.addEventListener('click', () => { 
                setMobileMenuState(false);
            }); 
        });

        const loginMessageEl = document.getElementById('login-msg');
        const loginMessageTextEl = document.getElementById('login-msg-text');
        const showLoginMessage = (message) => {
            if (!loginMessageEl) return;
            const target = loginMessageTextEl || loginMessageEl;
            if (!message) {
                target.textContent = '';
                loginMessageEl.style.display = 'none';
                return;
            }
            target.textContent = message;
            loginMessageEl.style.display = 'flex';
        };

        const renderSavedAccounts = () => {
            const list = document.getElementById('saved-student-list');
            const rawAccounts = window.AppSession?.getRememberedAccounts?.() || window.AppSession?.getStudentAccounts?.() || [];
            const accounts = rawAccounts.filter((a) => a && (a.role === 'student' || (!a.role && a.studentId)));
            if (!list) return;

            if (!accounts.length) {
                list.innerHTML = '<p class="text-sm text-gray-500 py-3 text-center">No saved student accounts found on this device.</p>';
                return;
            }

            const activeStudentId = window.AppSession?.hasStudentSession?.()
                ? String(window.AppSession?.getStudentId?.() || '')
                : '';

            list.innerHTML = accounts.map((account) => {
                const accountId = String(account.studentId || account.id || '');
                const isActive = Boolean(activeStudentId && accountId === activeStudentId);
                const activeBadgeHtml = isActive
                    ? '<span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 border border-emerald-300 inline-flex items-center gap-1"><i class="fas fa-circle text-[6px]"></i> Active</span>'
                    : '<span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">Student</span>';
                const groupBadgeHtml = (account.groupId || account.groupName)
                    ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">${escapeHtml(account.groupName || 'Group')}</span>`
                    : '';
                const metaText = `Class ${escapeHtml(account.class || '--')} • Adm: ${escapeHtml(account.adm || '--')}`;
                const cardClasses = isActive
                    ? 'border-emerald-300 bg-emerald-50/40 ring-1 ring-emerald-200/70'
                    : 'border-slate-200 bg-white hover:border-emerald-400';

                return `
                <div class="rounded-2xl border ${cardClasses} hover:shadow-xs p-3 flex items-center justify-between gap-3 transition cursor-pointer text-left saved-account-card group" data-id="${escapeHtml(accountId)}">
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div class="w-10 h-10 rounded-xl ${isActive ? 'bg-emerald-600 text-white' : 'bg-blue-100 text-blue-700'} flex items-center justify-center shrink-0 text-base shadow-2xs">
                            <i class="fas fa-user-graduate"></i>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center flex-wrap gap-1.5">
                                <span class="font-extrabold text-slate-800 text-sm truncate group-hover:text-emerald-700 transition-colors">${escapeHtml(account.name || 'Student')}</span>
                                ${activeBadgeHtml}
                                ${groupBadgeHtml}
                            </div>
                            <div class="text-xs text-slate-500 font-medium mt-0.5 truncate">
                                ${metaText}
                            </div>
                        </div>
                    </div>
                    <button type="button" class="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 transition cursor-pointer shadow-2xs saved-account-remove" data-id="${escapeHtml(accountId)}" title="Remove this account" aria-label="Remove">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                </div>
                `;
            }).join('');
        };
        const renderSavedStudents = renderSavedAccounts;

        let globalInstitutionConfig = {};
        let isOpeningLoginFlow = false;
        const openSavedStudentModal = () => {
            renderSavedAccounts();
            document.getElementById('saved-student-modal').style.display = 'flex';
        };
        let isAddingStudentAccountFlow = false;
        let latestTenantStatus = null;
        const showPublicPageLoginBlockedModal = () => {
            if (isRootGatewayMode) return false;
            if (!latestTenantStatus?.exists || latestTenantStatus?.active !== false) return false;
            const evalData = latestTenantStatus.evaluation || {};
            setMobileMenuState(false);
            showTenantLockOverlay({
                ...evalData,
                institutionSlug: evalData.institutionSlug || INSTITUTION_ID,
                institutionName: evalData.institutionName || globalInstitutionConfig?.appName || latestTenantStatus?.institution?.name || '',
                dismissible: true
            });
            return true;
        };
        const openStudentLoginModal = (options = {}) => {
            if (window.AppSession?.hasCompanySession?.()) {
                window.location.href = '/company';
                return;
            }
            if (showPublicPageLoginBlockedModal()) {
                return;
            }
            if (!isRootGatewayMode && (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.())) {
                window.location.href = getPageUrl('official.html');
                return;
            }
            isAddingStudentAccountFlow = Boolean(options?.addStudent);
            const preferredMode = options?.mode === 'official' ? 'official' : 'student';
            document.getElementById('login-modal').style.display = 'flex';
            setMobileMenuState(false);
            resetUniversalLoginForm(preferredMode);
            const sessionNotice = window.AppSession?.consumeFlash?.();
            if (sessionNotice) showLoginMessage(sessionNotice);
            // Warm up verification registries in background on tenant portals while user types
            if (!isRootGatewayMode) {
                ensureVerificationRegistriesLoaded().catch(() => {});
            }
        };
        const syncStudentGroupMembersToSession = async (studentId = '', { clearDismissed = false, institutionId = '' } = {}) => {
            const cleanStudentId = String(studentId || '').trim();
            if (!cleanStudentId) return;
            const targetInstId = String(institutionId || INSTITUTION_ID || '').trim().toLowerCase();
            const targetBasePath = targetInstId ? `institutions/${targetInstId}` : BASE_PATH;
            if (clearDismissed) {
                window.AppSession?.clearDismissedGroupStudents?.();
            }
            try {
                if (!auth.currentUser) {
                    try { await signInAnonymously(auth); } catch (_) {}
                }
                if (!auth.currentUser) return;

                const groupSnap = await getDocs(
                    query(collection(db, `${targetBasePath}/studentGroups`), where('memberIds', 'array-contains', cleanStudentId))
                );
                if (!groupSnap || groupSnap.empty) return;

                const matchingGroups = groupSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                const primaryGroup = matchingGroups[0];
                const primaryGroupId = String(primaryGroup?.id || '');
                const primaryGroupName = String(primaryGroup?.name || '').trim();

                window.AppSession?.registerStudentAccount?.(cleanStudentId, {
                    institutionId: targetInstId,
                    groupId: primaryGroupId,
                    groupName: primaryGroupName
                }, { keepOrder: true, institutionId: targetInstId });

                const dismissed = new Set(window.AppSession?.getDismissedGroupStudentIds?.() || []);
                const siblingGroupMap = new Map();
                matchingGroups.forEach((grp) => {
                    const memberIds = Array.isArray(grp.memberIds) ? grp.memberIds : [];
                    memberIds.forEach((rawId) => {
                        const mId = String(rawId || '').trim();
                        if (!mId || mId === cleanStudentId || dismissed.has(mId)) return;
                        if (!siblingGroupMap.has(mId)) {
                            siblingGroupMap.set(mId, {
                                groupId: String(grp.id || ''),
                                groupName: String(grp.name || '').trim()
                            });
                        }
                    });
                });

                const siblingIds = Array.from(siblingGroupMap.keys());
                if (!siblingIds.length) return;

                const siblingSnaps = await Promise.all(
                    siblingIds.map((sibId) => getDoc(doc(db, `${targetBasePath}/students`, sibId)).catch(() => null))
                );

                siblingSnaps.forEach((snap, idx) => {
                    if (!snap?.exists?.()) return;
                    const sibData = snap.data() || {};
                    const statusNorm = String(sibData.status || '').trim().toLowerCase();
                    if (sibData.isActive === false || statusNorm === 'inactive' || statusNorm === 'discontinued') return;
                    const sibId = siblingIds[idx];
                    const grpMeta = siblingGroupMap.get(sibId) || {};
                    window.AppSession?.registerStudentAccount?.(sibId, {
                        institutionId: targetInstId,
                        name: sibData.name || '',
                        class: sibData.class || '',
                        adm: sibData.adm || '',
                        groupId: grpMeta.groupId || '',
                        groupName: grpMeta.groupName || ''
                    }, { append: true, institutionId: targetInstId });
                });
            } catch (err) {
                console.warn('Student group session sync notice:', err);
            }
        };

        let isActivatingRememberedAccount = false;
        const activateRememberedAccount = async (account, cardEl = null) => {
            if (!account || isActivatingRememberedAccount) return false;
            isActivatingRememberedAccount = true;
            const restoreCardUi = () => {
                if (!cardEl) return;
                cardEl.classList.remove('opacity-75', 'pointer-events-none');
                const removeBtn = cardEl.querySelector('.saved-account-remove');
                if (removeBtn) {
                    removeBtn.innerHTML = '<i class="fas fa-trash-alt text-xs"></i>';
                    removeBtn.disabled = false;
                }
            };
            if (cardEl) {
                cardEl.classList.add('opacity-75', 'pointer-events-none');
                const removeBtn = cardEl.querySelector('.saved-account-remove');
                if (removeBtn) {
                    removeBtn.innerHTML = '<i class="fas fa-spinner fa-spin text-xs text-emerald-600"></i>';
                    removeBtn.disabled = true;
                }
            }

            try {
                if (account.role === 'student' || (!account.role && account.studentId)) {
                    if (!isRootGatewayMode && window.AppSession?.isCompanyPageAllowed?.('student') === false) {
                        restoreCardUi();
                        openPremiumPlansModal({
                            contextType: 'module',
                            moduleKey: 'student',
                            moduleName: 'Student Portal',
                            institutionName: globalInstitutionConfig?.appName || ''
                        });
                        return false;
                    }
                    if (!isRootGatewayMode && (globalInstitutionConfig?.enabledModules?.student === false || window.AppSession?.isModuleEnabled('student') === false)) {
                        restoreCardUi();
                        showToast('Student Portal is currently disabled by institution administration.', 'error');
                        return false;
                    }
                    const targetStudentId = String(account.studentId || account.id || '').trim();
                    if (!targetStudentId) {
                        restoreCardUi();
                        return false;
                    }
                    if (!auth.currentUser) {
                        try { await signInAnonymously(auth); } catch (_) {}
                    }
                    if (auth.currentUser) {
                        try {
                            const stuSnap = await getDoc(doc(db, `${BASE_PATH}/students`, targetStudentId));
                            if (!stuSnap.metadata?.fromCache || stuSnap.exists()) {
                                const st = stuSnap.exists() ? stuSnap.data() : null;
                                const statusNorm = String(st?.status || '').trim().toLowerCase();
                                if (!stuSnap.exists() || st?.isActive === false || statusNorm === 'inactive' || statusNorm === 'discontinued') {
                                    window.AppSession?.removeRememberedAccount?.(account.id || targetStudentId);
                                    renderSavedAccounts();
                                    showToast('Your student account is inactive or has been removed.', 'error');
                                    const remaining = window.AppSession?.getRememberedAccounts?.() || [];
                                    if (!remaining.length) {
                                        document.getElementById('saved-student-modal').style.display = 'none';
                                        openStudentLoginModal();
                                        showLoginMessage('Saved account is no longer active. Please log in with an active account.');
                                    }
                                    restoreCardUi();
                                    return false;
                                }
                            }
                        } catch (_) {}
                    }

                    if (window.AppSession?.hasStudentSession?.() && String(window.AppSession?.getStudentId?.() || '') === targetStudentId) {
                        window.AppSession?.startStudent?.(targetStudentId, account);
                        window.location.href = getPageUrl('student.html');
                        return true;
                    }
                    return window.AppSession?.switchAccount?.(account.id || targetStudentId);
                }

                restoreCardUi();
                return false;
            } finally {
                isActivatingRememberedAccount = false;
            }
        };
        window.openLogin = () => {
            if (isOpeningLoginFlow) return;
            isOpeningLoginFlow = true;
            try {
                const params = new URLSearchParams(window.location.search);
                const forceAdd = params.get('addStudent') === '1' || params.get('login') === 'new';

                if (!forceAdd && window.AppSession?.hasCompanySession?.()) {
                    window.location.href = '/company';
                    return;
                }

                if (showPublicPageLoginBlockedModal()) {
                    return;
                }

                // Official accounts (Admin / Staff) strictly enforce single-session access
                if (!isRootGatewayMode && !forceAdd && (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.())) {
                    window.location.href = getPageUrl('official.html');
                    return;
                }

                // Active Student session opens Student Portal directly when clicking Login
                if (!isRootGatewayMode && !forceAdd && window.AppSession?.hasStudentSession?.()) {
                    window.location.href = getPageUrl('student.html');
                    return;
                }

                if (forceAdd || isRootGatewayMode) {
                    openStudentLoginModal();
                    return;
                }

                const accounts = window.AppSession?.getRememberedAccounts?.() || [];
                if (accounts.length >= 1) {
                    openSavedStudentModal();
                    // Validate saved accounts in parallel in the background so UI opens instantly
                    validateAndPruneRememberedAccounts({ verifyStudentsOnline: true })
                        .then((validList) => {
                            const savedModal = document.getElementById('saved-student-modal');
                            if (savedModal && savedModal.style.display === 'flex' && Array.isArray(validList) && validList.length === 0) {
                                savedModal.style.display = 'none';
                                openStudentLoginModal();
                                showLoginMessage('Saved account is no longer active. Please log in with an active account.');
                            }
                        })
                        .catch(() => {});
                    return;
                }
                openStudentLoginModal();
            } finally {
                isOpeningLoginFlow = false;
            }
        };

        const setAccordionState = (accordionId = '', open = false) => {
            const content = document.getElementById(accordionId);
            if (!content) return;
            content.classList.toggle('hidden', !open);
            const icon = document.querySelector(`[data-accordion-icon="${accordionId}"]`);
            icon?.classList.toggle('fa-chevron-down', !open);
            icon?.classList.toggle('fa-chevron-up', open);
        };
        window.togglePublicAccordion = (accordionId = '') => {
            const content = document.getElementById(accordionId);
            if (!content) return;
            setAccordionState(accordionId, content.classList.contains('hidden'));
        };
        const expandAccordionForTarget = (targetId = '') => {
            if (targetId === 'management-container') setAccordionState('management-accordion', true);
            const target = document.getElementById(targetId);
            const accordionContent = target?.querySelector?.('[data-accordion-content]');
            if (accordionContent?.id) setAccordionState(accordionContent.id, true);
        };
        window.smoothScrollTo = (e, targetId) => {
            e.preventDefault();
            expandAccordionForTarget(targetId);
            const target = document.getElementById(targetId);
            if(target) window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset - 90, behavior: "smooth" });
        };
        
        let galleryUrls = [];
        let currentGalleryIndex = -1;
        let galleryTouchStartX = 0;

        const closePersonModal = () => {
            const modal = document.getElementById('person-modal');
            if (modal) modal.style.display = 'none';
        };

        window.openPersonModal = (name, role, phone, img, address) => {
            document.getElementById('modal-name').textContent = name;
            document.getElementById('modal-role').textContent = role;
            const modalPhone = document.getElementById('modal-phone');
            const whatsappBtn = document.getElementById('modal-whatsapp-btn');
            modalPhone.textContent = '';
            if (phone) {
                const normalizedPhone = sanitizePhone(phone);
                const phoneLink = document.createElement('a');
                phoneLink.href = `tel:${normalizedPhone}`;
                phoneLink.style.color = 'inherit';
                phoneLink.textContent = phone;
                modalPhone.appendChild(phoneLink);
                if (whatsappBtn && normalizedPhone) {
                    whatsappBtn.href = `https://wa.me/${encodeURIComponent(normalizedPhone)}?text=${encodeURIComponent('Assalamu Alaikum')}`;
                    whatsappBtn.style.display = 'inline-flex';
                } else if (whatsappBtn) {
                    whatsappBtn.style.display = 'none';
                }
            } else {
                modalPhone.textContent = 'Not Available';
                if (whatsappBtn) whatsappBtn.style.display = 'none';
            }
            document.getElementById('modal-address').textContent = address || 'Not Available';
            document.getElementById('modal-img').src = (img && img.startsWith('data:')) ? img : (sanitizeUrl(img) || '/assets/images/logo.png');
            document.getElementById('person-modal').style.display = 'flex';
        };

        document.getElementById('person-modal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) closePersonModal();
        });

        const setGalleryImage = (index = 0) => {
            if (!galleryUrls.length) return;
            currentGalleryIndex = (index + galleryUrls.length) % galleryUrls.length;
            document.getElementById('zoom-img').src = galleryUrls[currentGalleryIndex];
        };

        const closeImageModal = () => {
            const modal = document.getElementById('img-modal');
            if (!modal) return;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            currentGalleryIndex = -1;
        };

        const openImageModal = (url, index = -1) => {
            const safeUrl = sanitizeUrl(url);
            if (!safeUrl) return;
            const resolvedIndex = index >= 0 ? index : galleryUrls.indexOf(safeUrl);
            if (!galleryUrls.includes(safeUrl)) galleryUrls = [safeUrl];
            setGalleryImage(resolvedIndex >= 0 ? resolvedIndex : 0);
            const modal = document.getElementById('img-modal');
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
        };

        document.getElementById('img-modal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) closeImageModal();
        });
        document.getElementById('gallery-prev-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            setGalleryImage(currentGalleryIndex - 1);
        });
        document.getElementById('gallery-next-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            setGalleryImage(currentGalleryIndex + 1);
        });
        document.getElementById('zoom-img')?.addEventListener('click', (event) => event.stopPropagation());
        document.getElementById('img-modal')?.addEventListener('touchstart', (event) => {
            galleryTouchStartX = event.changedTouches?.[0]?.clientX || 0;
        }, { passive: true });
        document.getElementById('img-modal')?.addEventListener('touchend', (event) => {
            const endX = event.changedTouches?.[0]?.clientX || 0;
            const deltaX = endX - galleryTouchStartX;
            if (Math.abs(deltaX) < 45) return;
            setGalleryImage(currentGalleryIndex + (deltaX < 0 ? 1 : -1));
        }, { passive: true });

        function togglePassword(inputId, iconId) {
            const input = document.getElementById(inputId);
            const icon = document.getElementById(iconId);
            if (input.type === "password") {
                input.type = "text";
                icon.classList.remove("fa-eye");
                icon.classList.add("fa-eye-slash");
                icon.style.color = "#3b82f6";
            } else {
                input.type = "password";
                icon.classList.remove("fa-eye-slash");
                icon.classList.add("fa-eye");
                icon.style.color = "#94a3b8";
            }
        }
        document.getElementById('saved-student-add-btn')?.addEventListener('click', () => {
            document.getElementById('saved-student-modal').style.display = 'none';
            openStudentLoginModal({ mode: 'student', addStudent: true });
        });
        document.getElementById('saved-student-list')?.addEventListener('click', async (e) => {
            const removeBtn = e.target.closest('.saved-account-remove') || e.target.closest('.saved-student-remove');
            const card = e.target.closest('.saved-account-card') || e.target.closest('.saved-student-card');
            if (removeBtn) {
                e.stopPropagation();
                if (!confirm('Remove this account from this device?')) return;
                window.AppSession?.removeRememberedAccount?.(removeBtn.dataset.id);
                renderSavedAccounts();
                return;
            }
            if (card) {
                const accountId = card.dataset.id;
                const accounts = window.AppSession?.getRememberedAccounts?.() || [];
                const targetAccount = accounts.find((a) => a.id === accountId || a.studentId === accountId);
                if (targetAccount) {
                    await activateRememberedAccount(targetAccount, card);
                } else {
                    const stSwitched = window.AppSession?.switchStudent?.(accountId);
                    if (stSwitched) window.location.href = getPageUrl('student.html');
                }
            }
        });

        function fitHeroTitle() {
            const el = document.getElementById('hero-main-title');
            if(!el) return;
            el.style.fontSize = '';
        }
        window.addEventListener('resize', fitHeroTitle);

        initPwaPromptListener();
        let allStudents = [], selectedLoginStudent = null;
        let allStaffCategories = [];
        let directoryCategories = [];
        let directoryEntries = [];
        let staffDirectoryEntries = [];
        let allStaffSnapshotRecords = [];
        let cachedActiveStaff = [];
        let categoryAuthConfig = { categories: {} };
        let pageAccessConfig = { categories: {}, overrides: {} };
        const normalizeCategoryAuthItem = (raw = {}) => ({
            enabled: raw?.enabled === true,
            mode: raw?.mode === 'mapped' ? 'mapped' : 'manual',
            targetPage: raw?.targetPage === 'student' ? 'student' : 'collection'
        });
        const normalizeCategoryPageAccess = (raw = {}) => ({
            collection: raw?.collection === true,
            student: raw?.student === true
        });
        const hashCredentialValue = async (rawValue = '') => {
            const value = String(rawValue || '');
            if (!value) return '';
            if (!(window.crypto?.subtle)) return value;
            const encoded = new TextEncoder().encode(value);
            const digest = await window.crypto.subtle.digest('SHA-256', encoded);
            return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        const resolveDirectoryLogin = async (usernameInput = '', passwordInput = '') => {
            const username = String(usernameInput || '').trim().toLowerCase();
            const passwordHash = await hashCredentialValue(passwordInput);
            if (!username || !passwordHash) return null;
            for (const entry of (Array.isArray(directoryEntries) ? directoryEntries : [])) {
                if (!entry?.categoryId) continue;
                const authConfig = normalizeCategoryAuthItem(categoryAuthConfig?.categories?.[entry.categoryId] || {});
                if (!authConfig.enabled) continue;
                const authMeta = entry?.authMeta && typeof entry.authMeta === 'object' ? entry.authMeta : {};
                if ((String(authMeta.username || '').toLowerCase() || '') !== username) continue;
                if ((String(authMeta.passwordHash || '') || '') !== passwordHash) continue;

                const categoryAccess = normalizeCategoryPageAccess(pageAccessConfig?.categories?.[entry.categoryId] || {});
                const override = pageAccessConfig?.overrides?.[entry.id] || {};
                if (override?.blocked === true) return { blocked: true };
                const access = {
                    collection: (override?.collection === true) || (override?.collection !== false && categoryAccess.collection === true),
                    student: (override?.student === true) || (override?.student !== false && categoryAccess.student === true),
                    source: 'directory',
                    categoryId: entry.categoryId,
                    entryId: entry.id
                };
                return {
                    blocked: false,
                    targetPage: authConfig.targetPage,
                    access,
                    entry
                };
            }
            return null;
        };
        let loaded = { config: false, content: false, students: false, staff: false, dirEntries: false, dirAuth: false, pageAccess: false };
        let staffSnapshotFromServer = false;
        let dirEntriesFromServer = false;
        let minTimeOver = false;
        let splashHidden = false; 

        setTimeout(() => { minTimeOver = true; triggerAnim(); }, 800); 
        setTimeout(() => { forceHideSplash(); }, 3000); 

        function forceHideSplash() {
            if(splashHidden) return;
            splashHidden = true;
            const splash = document.getElementById('splash-screen');
            if(splash && splash.style.display !== 'none') {
                splash.style.opacity = '0';
                const hero = document.querySelector('.hero');
                if(hero) hero.classList.add('animate-active');
                setTimeout(() => splash.style.display = 'none', 500);
            }
        }

        function triggerAnim() {
            if (minTimeOver && loaded.config && loaded.content && loaded.staff && !splashHidden) {
                forceHideSplash();
            }
        }

        const noticeModal = document.getElementById('notice-modal');
        const noticeModalTitle = document.getElementById('notice-modal-title');
        const noticeModalDate = document.getElementById('notice-modal-date');
        const noticeModalBody = document.getElementById('notice-modal-body');
        const closeNoticeModalBtn = document.getElementById('close-notice-modal');
        const noticeListEl = document.getElementById('notices-list');
        let latestNoticeCache = [];

        const closeNoticeModal = () => {
            if (!noticeModal) return;
            noticeModal.style.display = 'none';
            noticeModal.setAttribute('aria-hidden', 'true');
        };

        closeNoticeModalBtn?.addEventListener('click', closeNoticeModal);
        noticeModal?.addEventListener('click', (event) => {
            if (event.target === noticeModal) closeNoticeModal();
        });

        const renderNoticeTextWithLinks = (rawText = '', linkLabelLength = 25) => {
            const text = String(rawText || '');
            const urlPattern = /(https?:\/\/[^\s]+)/gi;
            let cursor = 0;
            let html = '';
            text.replace(urlPattern, (url, _unused, offset) => {
                const leading = text.slice(cursor, offset);
                html += escapeHtml(leading);
                const safeHref = sanitizeUrl(url, ['https:', 'http:']);
                if (safeHref) {
                    const shortLabel = url.length > linkLabelLength
                        ? `${url.slice(0, linkLabelLength)}...`
                        : url;
                    html += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline break-all">${escapeHtml(shortLabel)}</a>`;
                } else {
                    html += escapeHtml(url);
                }
                cursor = offset + url.length;
                return url;
            });
            html += escapeHtml(text.slice(cursor));
            return html.replace(/\n/g, '<br>');
        };
        const renderDynamicDirectory = () => {
            const container = document.getElementById('dynamic-directory-container');
            const sectionsEl = document.getElementById('dynamic-directory-sections');
            const navDynamicLinks = document.getElementById('nav-dynamic-directory-links');
            if (!container || !sectionsEl) return;
            const visibleCategories = (Array.isArray(directoryCategories) ? directoryCategories : [])
                .filter((category) => category?.showPublic !== false)
                .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
            if (!visibleCategories.length) {
                container.classList.add('hidden');
                if (navDynamicLinks) {
                    navDynamicLinks.classList.add('hidden');
                    navDynamicLinks.innerHTML = '';
                }
                return;
            }
            container.classList.remove('hidden');
            if (navDynamicLinks) {
                navDynamicLinks.classList.remove('hidden');
                navDynamicLinks.innerHTML = `<ul class="space-y-1">${visibleCategories.map((category) => {
                    const sectionId = `directory-category-${category.id}`;
                    return `<li><a href="#${escapeHtml(sectionId)}" class="nav-link" onclick="smoothScrollTo(event, '${escapeHtml(sectionId)}')">${escapeHtml(category.name || 'Category')}</a></li>`;
                }).join('')}</ul>`;
            }
            sectionsEl.innerHTML = visibleCategories.map((category) => {
                const fields = (Array.isArray(category.fields) ? category.fields : []).sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
                const combinedDirectoryEntries = [...directoryEntries, ...staffDirectoryEntries];
                const rows = combinedDirectoryEntries
                    .filter((entry) => entry.categoryId === category.id)
                    .sort((a, b) => {
                        const orderDiff = Number(a?.displayOrder || 999) - Number(b?.displayOrder || 999);
                        if (orderDiff !== 0) return orderDiff;
                        return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
                    });
                const sectionId = `directory-category-${category.id}`;
                const accordionId = `accordion-${category.id}`;
                if (!rows.length) return `<div id="${escapeHtml(sectionId)}" class="container">
                    <div class="section-header">
                        <button type="button" class="accordion-heading-btn section-heading-pill" onclick="window.togglePublicAccordion('${escapeHtml(accordionId)}')">
                            <span>${escapeHtml(category.name || 'Category')}</span>
                            <i class="fas fa-chevron-down text-sm" data-accordion-icon="${escapeHtml(accordionId)}"></i>
                        </button>
                        <div></div>
                    </div>
                    <div id="${escapeHtml(accordionId)}" data-accordion-content class="hidden mt-3"><div class="about-box"><p class="text-sm text-gray-500 italic">No entries yet.</p></div></div>
                </div>`;
                return `<div id="${escapeHtml(sectionId)}" class="container">
                    <div class="section-header">
                        <button type="button" class="accordion-heading-btn section-heading-pill" onclick="window.togglePublicAccordion('${escapeHtml(accordionId)}')">
                            <span>${escapeHtml(category.name || 'Category')}</span>
                            <i class="fas fa-chevron-down text-sm" data-accordion-icon="${escapeHtml(accordionId)}"></i>
                        </button>
                        <div></div>
                    </div>
                    <div id="${escapeHtml(accordionId)}" data-accordion-content class="hidden mt-3"><div class="scroll-wrapper">${rows.map((entry) => {
                        const values = entry.values || {};
                        const nameValue = String(values.name || values.Name || values.title || 'Profile');
                        const rawPhoto = values.photo || values.Photo || values.image || values.img || '';
                        const photoValue = (rawPhoto && rawPhoto.startsWith('data:')) ? rawPhoto : (sanitizeUrl(rawPhoto) || '/assets/images/logo.png');
                        const phoneValue = String(values.phone || values.mobile || values.contact || '');
                        const addressValue = String(values.address || values.place || '');
                        const roleField = fields.find((field) => !['name', 'role', 'photo', 'phone', 'address'].includes(String(field.key || '').toLowerCase()));
                        const roleValue = String(values.role || (roleField ? (values[roleField.key] || '') : '')).trim();
                        return `<button type="button" class="person-card" data-person-name="${escapeHtml(nameValue)}" data-person-role="${escapeHtml(roleValue || 'Role not added')}" data-person-phone="${escapeHtml(phoneValue)}" data-person-img="${escapeHtml(photoValue)}" data-person-address="${escapeHtml(addressValue)}">
                            <img src="${photoValue}" class="person-img" alt="${escapeHtml(nameValue)}">
                            <div class="person-name">${escapeHtml(nameValue)}</div>
                            <div class="person-role">${escapeHtml(roleValue || 'Role not added')}</div>
                        </button>`;
                    }).join('')}</div></div>
                </div>`;
            }).join('');
        };

        const deriveNoticeHeading = (notice = {}, index = 0) => {
            const directHeading = notice.heading || notice.title;
            if (directHeading && String(directHeading).trim()) return String(directHeading).trim();
            if (notice.image || notice.imageUrl) return '';
            const baseText = String(notice.text || '').trim();
            if (!baseText) return `Notification ${index + 1}`;
            const firstLine = baseText.split('\n').map((line) => line.trim()).find(Boolean) || '';
            const firstSentence = firstLine.split(/[.!?]/).map((part) => part.trim()).find(Boolean) || '';
            const compact = firstSentence || firstLine || baseText;
            return compact.length > 70 ? `${compact.slice(0, 70)}...` : compact;
        };

        const isNoticeLong = (text = '') => String(text || '').length > 260 || String(text || '').split('\n').length > 5;

        const openNoticeModal = (noticeIndex) => {
            const selected = latestNoticeCache[noticeIndex];
            if (!selected || !noticeModal || !noticeModalBody) return;
            noticeModalTitle.textContent = selected.heading || 'Notification';
            noticeModalDate.textContent = selected.date ? `Posted: ${selected.date}` : 'Posted date unavailable';
            const imgHtml = selected.image
                ? `<div class="mb-3 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex justify-center"><img src="${selected.image}" alt="${escapeHtml(selected.heading || 'Notice image')}" class="max-h-[60vh] w-auto object-contain cursor-pointer notice-modal-img" data-notice-img-url="${escapeHtml(selected.image)}"></div>`
                : '';
            const textHtml = selected.text
                ? `<div class="notice-modal-text">${renderNoticeTextWithLinks(selected.text, 25)}</div>`
                : '';
            noticeModalBody.innerHTML = `${imgHtml}${textHtml}`;
            noticeModal.style.display = 'flex';
            noticeModal.setAttribute('aria-hidden', 'false');
        };

        noticeModalBody?.addEventListener('click', (event) => {
            const imgEl = event.target.closest('[data-notice-img-url]');
            if (!imgEl) return;
            openImageModal(imgEl.dataset.noticeImgUrl, -1);
        });

        noticeListEl?.addEventListener('click', (event) => {
            const imgBtn = event.target.closest('[data-notice-card-img]');
            if (imgBtn) {
                const noticeIndex = Number(imgBtn.dataset.noticeIndex);
                if (!Number.isNaN(noticeIndex)) {
                    openNoticeModal(noticeIndex);
                }
                return;
            }
            const expandButton = event.target.closest('.notice-expand-btn');
            if (!expandButton) return;
            const noticeIndex = Number(expandButton.dataset.noticeIndex);
            if (Number.isNaN(noticeIndex)) return;
            openNoticeModal(noticeIndex);
        });

        const fitNoticeViewportForFourCards = () => {
            if (!noticeListEl) return;
            const cards = Array.from(noticeListEl.querySelectorAll('.notice-card'));
            if (!cards.length) {
                noticeListEl.style.maxHeight = '';
                return;
            }
            const width = window.innerWidth;
            const cols = width >= 1024 ? 3 : (width >= 640 ? 2 : 1);
            const maxRowsToFit = cols === 1 ? Math.min(4, cards.length) : Math.min(2, Math.ceil(cards.length / cols));

            let totalHeight = 0;
            for (let r = 0; r < maxRowsToFit; r++) {
                const rowCards = cards.slice(r * cols, (r + 1) * cols);
                if (!rowCards.length) break;
                const maxRowHeight = Math.max(...rowCards.map(c => c.offsetHeight || 0));
                totalHeight += maxRowHeight;
            }
            const gapSize = cols >= 3 ? 20 : (cols === 2 ? 16 : 14);
            const gaps = Math.max(0, maxRowsToFit - 1) * gapSize;
            noticeListEl.style.maxHeight = `${totalHeight + gaps + 12}px`;
        };
        window.addEventListener('resize', fitNoticeViewportForFourCards);


        function populateClassDropdown(conf = globalInstitutionConfig) {
            const configClasses = Array.isArray(conf?.classes) && conf.classes.length > 0
                ? conf.classes
                : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
            let classOptions = configClasses.map(c => {
                const raw = String(c).trim();
                const label = raw.toLowerCase().startsWith('class') ? raw : `Class: ${raw}`;
                return `<option value="${escapeHtml(raw)}">${escapeHtml(label)}</option>`;
            }).join('');
            classOptions += `<option value="Alumni">🎓 Alumni</option>`;
            const loginClassEl = document.getElementById('login-class');
            if (loginClassEl) {
                const currentVal = loginClassEl.value;
                loginClassEl.innerHTML = '<option value="">Select Class</option>' + classOptions;
                if (currentVal) loginClassEl.value = currentVal;
            }
        }

        function activateRootGatewayMode() {
            isRootGatewayMode = true;
            if (document.body) {
                document.body.style.backgroundColor = '#ffffff';
            }
            document.querySelector('body > header')?.classList.add('hidden');
            document.getElementById('hero-section')?.classList.add('hidden');
            document.getElementById('about-container')?.classList.add('hidden');
            document.querySelector('body > footer.footer')?.classList.add('hidden');
            document.getElementById('root-gateway-container')?.classList.remove('hidden');

            const headerTitle = document.getElementById('header-title');
            const heroTitle = document.getElementById('hero-main-title');
            const heroSubtitle = document.getElementById('hero-subtitle');
            const loginInstEl = document.getElementById('login-institution-name');
            const footerInstEl = document.getElementById('footer-inst-name');
            const gatewayPrefix = document.getElementById('gateway-origin-prefix');

            if (headerTitle) headerTitle.textContent = 'Institution Manage';
            if (heroTitle) heroTitle.textContent = 'Institution Manage';
            if (heroSubtitle) heroSubtitle.textContent = 'Academic & Financial Management Platform';
            if (loginInstEl) loginInstEl.textContent = 'Institution Manage';
            if (footerInstEl) footerInstEl.textContent = 'Institution Manage';
            if (gatewayPrefix) gatewayPrefix.textContent = `${window.location.origin}/`;

            const pricingRoot = document.getElementById('gateway-pricing-root');
            if (pricingRoot && !pricingRoot.dataset.pricingLoaded) {
                pricingRoot.dataset.pricingLoaded = '1';
                renderPublicPricingSection(pricingRoot, {
                    db,
                    onStartFreeTrial: () => openSelfSignupWizard()
                });
            }

            const slugInput = document.getElementById('gateway-slug-input');
            const slugBtn = document.getElementById('btn-gateway-open-slug');
            const slugMsg = document.getElementById('gateway-slug-msg');

            const showGatewayErr = (msg = '') => {
                if (!slugMsg) return;
                if (!msg) {
                    slugMsg.textContent = '';
                    slugMsg.classList.add('hidden');
                    return;
                }
                slugMsg.textContent = msg;
                slugMsg.classList.remove('hidden');
            };

            const handleOpenSlug = async () => {
                const rawSlug = String(slugInput?.value || '').trim().toLowerCase();
                showGatewayErr('');
                if (!rawSlug) {
                    showGatewayErr('Please enter an institution code (e.g. demo-academy).');
                    slugInput?.focus();
                    return;
                }
                if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(rawSlug) || RESERVED_INSTITUTION_SLUGS.has(rawSlug)) {
                    showGatewayErr('Invalid or reserved institution code. Use letters, numbers, hyphens, or underscores.');
                    slugInput?.focus();
                    return;
                }
                if (slugBtn) {
                    slugBtn.disabled = true;
                    slugBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Opening...</span>';
                }
                try {
                    const instSnap = await getDoc(doc(db, 'institutions', rawSlug));
                    if (!instSnap.exists()) {
                        showGatewayErr(`Institution "${rawSlug}" was not found. Please check the code with your administrator.`);
                        if (slugBtn) {
                            slugBtn.disabled = false;
                            slugBtn.innerHTML = '<span>Open</span><i class="fas fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i>';
                        }
                        return;
                    }
                    window.location.href = `/${encodeURIComponent(rawSlug)}`;
                } catch (_err) {
                    window.location.href = `/${encodeURIComponent(rawSlug)}`;
                }
            };

            if (slugBtn && !slugBtn.dataset.boundGateway) {
                slugBtn.dataset.boundGateway = 'true';
                slugBtn.addEventListener('click', handleOpenSlug);
                slugInput?.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleOpenSlug();
                    }
                });
            }

            const bottomFocusSlugBtn = document.getElementById('btn-bottom-focus-slug');
            if (bottomFocusSlugBtn && !bottomFocusSlugBtn.dataset.boundFocus) {
                bottomFocusSlugBtn.dataset.boundFocus = 'true';
                bottomFocusSlugBtn.addEventListener('click', () => {
                    document.getElementById('portal-launcher-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => slugInput?.focus(), 250);
                });
            }

            syncDynamicPwaBranding();
            mountUnifiedFooter({ mode: 'root-gateway' });
            registerInstallTrigger({
                key: 'root-gateway',
                buttonIds: ['btn-gateway-hero-install', 'btn-gateway-section-install'],
                statusTextIds: ['gateway-install-status-text'],
                hideWhenStandalone: false
            });

            const gatewayGuideBtn = document.getElementById('btn-gateway-install-guide');
            if (gatewayGuideBtn && !gatewayGuideBtn.dataset.boundGuide) {
                gatewayGuideBtn.dataset.boundGuide = 'true';
                gatewayGuideBtn.addEventListener('click', () => {
                    showDeviceInstallGuide();
                });
            }

            document.querySelectorAll('[data-install-guide-tab]').forEach((cardBtn) => {
                if (cardBtn.dataset.boundGuideCard) return;
                cardBtn.dataset.boundGuideCard = 'true';
                cardBtn.addEventListener('click', () => {
                    const preferredTab = cardBtn.getAttribute('data-install-guide-tab') || '';
                    showDeviceInstallGuide(preferredTab);
                });
            });

            // Slide-Over Hamburger Navigation Drawer
            const navDrawer = document.getElementById('gateway-nav-drawer');
            const navOpenBtn = document.getElementById('btn-gateway-menu-open');
            const navCloseBtn = document.getElementById('btn-gateway-menu-close');
            const navBackdrop = document.getElementById('gateway-nav-backdrop');
            const setGatewayDrawerOpen = (open) => {
                if (!navDrawer) return;
                navDrawer.classList.toggle('hidden', !open);
                navDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');
                navOpenBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
                document.body?.classList.toggle('overflow-hidden', open);
            };
            if (navOpenBtn && !navOpenBtn.dataset.boundDrawer) {
                navOpenBtn.dataset.boundDrawer = 'true';
                navOpenBtn.addEventListener('click', () => setGatewayDrawerOpen(true));
                navCloseBtn?.addEventListener('click', () => setGatewayDrawerOpen(false));
                navBackdrop?.addEventListener('click', () => setGatewayDrawerOpen(false));
                navDrawer?.querySelectorAll('[data-drawer-nav]').forEach((link) => {
                    link.addEventListener('click', (e) => {
                        const href = link.getAttribute('href') || '';
                        setGatewayDrawerOpen(false);
                        if (href.startsWith('#') && href.length > 1) {
                            const target = document.getElementById(href.slice(1));
                            if (target) {
                                e.preventDefault();
                                setTimeout(() => {
                                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }, 80);
                            }
                        }
                    });
                });
                navDrawer?.querySelector('[data-drawer-signup]')?.addEventListener('click', () => {
                    setGatewayDrawerOpen(false);
                    openSelfSignupWizard();
                });
                navDrawer?.querySelector('[data-drawer-login]')?.addEventListener('click', () => {
                    setGatewayDrawerOpen(false);
                    window.openLogin?.();
                });
                navDrawer?.querySelector('[data-drawer-portal]')?.addEventListener('click', () => {
                    setGatewayDrawerOpen(false);
                    setTimeout(() => {
                        document.getElementById('portal-launcher-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => slugInput?.focus(), 250);
                    }, 80);
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && navDrawer && !navDrawer.classList.contains('hidden')) {
                        setGatewayDrawerOpen(false);
                    }
                });
            }

            // 11-Workspace Horizontal Swipe Carousel (Arrows, Dots & Counter)
            const modulesTrack = document.getElementById('gateway-modules-grid');
            const modulesPrevBtn = document.getElementById('modules-carousel-prev');
            const modulesNextBtn = document.getElementById('modules-carousel-next');
            const modulesCounterEl = document.getElementById('modules-carousel-counter');
            const modulesDotsEl = document.getElementById('modules-carousel-dots');
            const moduleCards = Array.from(modulesTrack?.querySelectorAll('[data-module-index]') || []);

            if (modulesTrack && moduleCards.length > 0 && !modulesTrack.dataset.boundModulesCarousel) {
                modulesTrack.dataset.boundModulesCarousel = 'true';

                const getViewportMetric = () => {
                    const firstCard = moduleCards[0];
                    const trackWidth = modulesTrack.clientWidth || 320;
                    const cardWidth = firstCard?.offsetWidth || trackWidth;
                    const perView = Math.max(1, Math.min(3, Math.round(trackWidth / Math.max(1, cardWidth))));
                    const pageCount = Math.max(1, Math.ceil(moduleCards.length / perView));
                    return { perView, pageCount, trackWidth };
                };

                const getStartIndexForPage = (pageIdx, perView) => {
                    if (pageIdx <= 0) return 0;
                    return Math.min(moduleCards.length - perView, pageIdx * perView);
                };

                const scrollToCardIndex = (cardIdx) => {
                    const safeIdx = Math.max(0, Math.min(moduleCards.length - 1, cardIdx));
                    const targetCard = moduleCards[safeIdx];
                    if (!targetCard) return;
                    const left = Math.max(0, targetCard.offsetLeft - modulesTrack.offsetLeft);
                    modulesTrack.scrollTo({ left, behavior: 'smooth' });
                };

                const getCurrentStartCardIndex = () => {
                    const scrollLeft = modulesTrack.scrollLeft;
                    let closestIdx = 0;
                    let closestDist = Infinity;
                    moduleCards.forEach((card, idx) => {
                        const cardLeft = Math.max(0, card.offsetLeft - modulesTrack.offsetLeft);
                        const dist = Math.abs(cardLeft - scrollLeft);
                        if (dist < closestDist) {
                            closestDist = dist;
                            closestIdx = idx;
                        }
                    });
                    return closestIdx;
                };

                let renderedDotCount = 0;
                const syncCarouselUi = () => {
                    const { perView, pageCount } = getViewportMetric();
                    const currentIdx = getCurrentStartCardIndex();
                    const endIdx = Math.min(moduleCards.length, currentIdx + perView);
                    const startDisplay = Math.min(moduleCards.length, currentIdx + 1);
                    const maxScrollLeft = Math.max(0, modulesTrack.scrollWidth - modulesTrack.clientWidth);
                    const activePage = maxScrollLeft > 8 && modulesTrack.scrollLeft >= maxScrollLeft - 12
                        ? pageCount - 1
                        : Math.min(pageCount - 1, Math.floor((currentIdx + (perView > 1 ? 1 : 0)) / perView));

                    if (modulesCounterEl) {
                        modulesCounterEl.textContent = perView === 1
                            ? `${startDisplay} / ${moduleCards.length}`
                            : `${startDisplay}–${endIdx} / ${moduleCards.length}`;
                    }
                    if (modulesPrevBtn) {
                        modulesPrevBtn.disabled = modulesTrack.scrollLeft <= 6;
                    }
                    if (modulesNextBtn) {
                        modulesNextBtn.disabled = modulesTrack.scrollLeft >= maxScrollLeft - 6;
                    }

                    if (modulesDotsEl) {
                        if (renderedDotCount !== pageCount) {
                            renderedDotCount = pageCount;
                            modulesDotsEl.innerHTML = Array.from({ length: pageCount }, (_, idx) => `
                                <button type="button" data-modules-dot="${idx}" aria-label="Show workspaces page ${idx + 1}" class="h-1.5 rounded-full transition-all cursor-pointer"></button>
                            `).join('');
                            modulesDotsEl.querySelectorAll('[data-modules-dot]').forEach((dotBtn) => {
                                dotBtn.addEventListener('click', () => {
                                    const page = Number(dotBtn.getAttribute('data-modules-dot') || 0);
                                    const { perView: pv } = getViewportMetric();
                                    scrollToCardIndex(getStartIndexForPage(page, pv));
                                });
                            });
                        }
                        modulesDotsEl.querySelectorAll('[data-modules-dot]').forEach((dotBtn, idx) => {
                            const isActive = idx === activePage;
                            dotBtn.setAttribute('aria-current', isActive ? 'true' : 'false');
                            dotBtn.className = isActive
                                ? 'h-1.5 w-6 rounded-full bg-blue-600 transition-all cursor-pointer'
                                : 'h-1.5 w-1.5 rounded-full bg-slate-300 hover:bg-slate-400 transition-all cursor-pointer';
                        });
                    }
                };

                modulesPrevBtn?.addEventListener('click', () => {
                    const { perView } = getViewportMetric();
                    const cur = getCurrentStartCardIndex();
                    scrollToCardIndex(Math.max(0, cur - perView));
                });

                modulesNextBtn?.addEventListener('click', () => {
                    const { perView } = getViewportMetric();
                    const cur = getCurrentStartCardIndex();
                    scrollToCardIndex(Math.min(moduleCards.length - 1, cur + perView));
                });

                let modulesScrollRaf = 0;
                modulesTrack.addEventListener('scroll', () => {
                    if (modulesScrollRaf) return;
                    modulesScrollRaf = window.requestAnimationFrame(() => {
                        modulesScrollRaf = 0;
                        syncCarouselUi();
                    });
                }, { passive: true });
                window.addEventListener('resize', () => {
                    if (isRootGatewayMode) syncCarouselUi();
                });
                syncCarouselUi();
            }

            // Populate About / Support Contact Strip from shared cached Company Catalog (zero extra Firestore reads)
            (async () => {
                const contactWrap = document.getElementById('gateway-contact-links');
                if (!contactWrap) return;
                try {
                    const catalog = await fetchCompanyPublicCatalog({ db });
                    const contact = catalog?.contact || {};
                    const waDigits = String(contact.whatsapp || '').replace(/[^\d]/g, '');
                    const phoneDigits = String(contact.phone || '').replace(/[^\d+]/g, '');
                    const email = String(contact.email || '').trim();
                    const buttons = [];
                    if (waDigits) {
                        const waHref = `https://wa.me/${waDigits}?text=${encodeURIComponent('Hello, I would like to know more about Institution Manage.')}`;
                        buttons.push(`<a href="${escapeHtml(waHref)}" target="_blank" rel="noopener noreferrer" class="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5 transition-colors"><i class="fa-brands fa-whatsapp text-sm" aria-hidden="true"></i><span>WhatsApp</span></a>`);
                    }
                    if (phoneDigits) {
                        buttons.push(`<a href="tel:${escapeHtml(phoneDigits)}" class="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold inline-flex items-center gap-1.5 transition-colors"><i class="fas fa-phone text-[11px] text-blue-600" aria-hidden="true"></i><span>Call Support</span></a>`);
                    }
                    if (email) {
                        buttons.push(`<a href="mailto:${escapeHtml(email)}" class="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold inline-flex items-center gap-1.5 transition-colors"><i class="fas fa-envelope text-[11px] text-slate-600" aria-hidden="true"></i><span>Email</span></a>`);
                    }
                    if (buttons.length > 0) {
                        contactWrap.innerHTML = buttons.join('');
                    }
                } catch (_) {}
            })();

            // Smooth Scroll-Reveal Animations on Scroll/Swipe Down
            const revealTargets = Array.from(document.querySelectorAll('#root-gateway-container [data-gateway-reveal]'));
            if (revealTargets.length > 0) {
                const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (prefersReduced || typeof IntersectionObserver === 'undefined') {
                    revealTargets.forEach((el) => el.classList.add('is-visible'));
                } else {
                    const revealObserver = new IntersectionObserver((entries, obs) => {
                        entries.forEach((entry) => {
                            if (entry.isIntersecting) {
                                entry.target.classList.add('is-visible');
                                obs.unobserve(entry.target);
                            }
                        });
                    }, {
                        rootMargin: '0px 0px -8% 0px',
                        threshold: 0.08
                    });
                    revealTargets.forEach((el) => revealObserver.observe(el));
                }
            }

            const showcaseImagesByPage = new Map();
            const showcaseSlideIndexByPage = new Map();
            const showcaseLabelByKey = new Map(PLATFORM_SHOWCASE_PAGES.map((p) => [p.key, p.label]));

            const isSafeShowcaseUrl = (rawUrl = '') => {
                const clean = String(rawUrl || '').trim();
                if (!clean || clean.length < 8 || clean.length > 240000) return false;
                if (/^data:image\/(webp|jpeg|jpg|png);base64,[a-z0-9+/=\s]+$/i.test(clean)) return true;
                try {
                    const parsed = new URL(clean);
                    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
                } catch (_) {
                    return false;
                }
            };

            const isShowcaseVideoItem = (item = {}) => {
                if (item.mediaType === 'video') return true;
                const clean = String(item.url || '').trim().toLowerCase();
                if (!clean) return false;
                try {
                    const parsed = new URL(clean);
                    return /\.(mp4|webm|mov)(\?|$)/i.test(parsed.pathname)
                        || clean.includes('_vid_')
                        || (parsed.searchParams.get('alt') === 'media' && /\.(mp4|webm|mov)/i.test(decodeURIComponent(parsed.pathname)));
                } catch (_) {
                    return /\.(mp4|webm|mov)(\?|$)/i.test(clean);
                }
            };

            // Full-screen Showcase Lightbox state & controls (supports Images & HD Videos)
            let lightboxState = { pageKey: '', images: [], index: 0 };
            const lightboxModal = document.getElementById('showcase-lightbox-modal');
            const lightboxImg = document.getElementById('showcase-lightbox-img');
            const lightboxVideo = document.getElementById('showcase-lightbox-video');
            const lightboxTitle = document.getElementById('showcase-lightbox-title');
            const lightboxMeta = document.getElementById('showcase-lightbox-meta');
            const lightboxPrevBtn = document.getElementById('showcase-lightbox-prev');
            const lightboxNextBtn = document.getElementById('showcase-lightbox-next');
            const lightboxCaptionBar = document.getElementById('showcase-lightbox-caption-bar');
            const lightboxStage = document.getElementById('showcase-lightbox-stage');
            let lightboxTouchStartX = 0;
            let lightboxTouchStartY = 0;

            const stopLightboxVideo = () => {
                if (!lightboxVideo) return;
                try { lightboxVideo.pause(); } catch (_) {}
                lightboxVideo.removeAttribute('src');
                lightboxVideo.poster = '';
                lightboxVideo.load();
                lightboxVideo.classList.add('hidden');
            };

            const renderLightboxSlide = () => {
                const { pageKey, images, index } = lightboxState;
                if (!images.length || !lightboxImg) return;
                const safeIdx = ((index % images.length) + images.length) % images.length;
                lightboxState.index = safeIdx;
                const shot = images[safeIdx];
                const moduleLabel = showcaseLabelByKey.get(pageKey) || 'Platform Preview';
                const isVideo = isShowcaseVideoItem(shot);

                if (isVideo && lightboxVideo) {
                    lightboxImg.classList.add('hidden');
                    lightboxImg.src = '';
                    lightboxVideo.classList.remove('hidden');
                    lightboxVideo.poster = shot.posterUrl || '';
                    lightboxVideo.src = shot.url;
                    lightboxVideo.load();
                } else {
                    stopLightboxVideo();
                    lightboxImg.classList.remove('hidden');
                    lightboxImg.src = shot.url;
                    lightboxImg.alt = `${moduleLabel} screenshot ${safeIdx + 1}`;
                }

                if (lightboxTitle) lightboxTitle.textContent = moduleLabel;
                if (lightboxMeta) {
                    const kind = isVideo ? 'Video' : 'Screenshot';
                    lightboxMeta.textContent = images.length > 1
                        ? `${kind} ${safeIdx + 1} / ${images.length}`
                        : `Full-size ${kind.toLowerCase()} preview`;
                }
                const hasMultiple = images.length > 1;
                lightboxPrevBtn?.classList.toggle('hidden', !hasMultiple);
                lightboxNextBtn?.classList.toggle('hidden', !hasMultiple);

                if (lightboxCaptionBar) {
                    const caption = String(shot.caption || '').trim();
                    lightboxCaptionBar.textContent = caption;
                    lightboxCaptionBar.classList.toggle('hidden', !caption);
                }
            };

            const openShowcaseLightbox = (pageKey, startIndex = 0) => {
                const images = showcaseImagesByPage.get(pageKey) || [];
                if (!images.length || !lightboxModal) return;
                lightboxState = { pageKey, images, index: startIndex };
                renderLightboxSlide();
                lightboxModal.classList.remove('hidden');
                lightboxModal.classList.add('flex');
                lightboxModal.setAttribute('aria-hidden', 'false');
            };

            const closeShowcaseLightbox = () => {
                if (!lightboxModal) return;
                lightboxModal.classList.add('hidden');
                lightboxModal.classList.remove('flex');
                lightboxModal.setAttribute('aria-hidden', 'true');
                if (lightboxImg) lightboxImg.src = '';
                stopLightboxVideo();
                lightboxState = { pageKey: '', images: [], index: 0 };
            };

            if (lightboxModal && !lightboxModal.dataset.boundShowcaseLightbox) {
                lightboxModal.dataset.boundShowcaseLightbox = 'true';
                document.getElementById('btn-close-showcase-lightbox')?.addEventListener('click', closeShowcaseLightbox);
                lightboxModal.addEventListener('click', (e) => {
                    if (e.target === lightboxModal) closeShowcaseLightbox();
                });
                lightboxPrevBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (lightboxState.images.length > 1) {
                        lightboxState.index -= 1;
                        renderLightboxSlide();
                    }
                });
                lightboxNextBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (lightboxState.images.length > 1) {
                        lightboxState.index += 1;
                        renderLightboxSlide();
                    }
                });
                lightboxStage?.addEventListener('touchstart', (e) => {
                    lightboxTouchStartX = e.changedTouches?.[0]?.clientX || 0;
                    lightboxTouchStartY = e.changedTouches?.[0]?.clientY || 0;
                }, { passive: true });
                lightboxStage?.addEventListener('touchend', (e) => {
                    if (lightboxState.images.length <= 1) return;
                    const endX = e.changedTouches?.[0]?.clientX || 0;
                    const endY = e.changedTouches?.[0]?.clientY || 0;
                    const deltaX = endX - lightboxTouchStartX;
                    const deltaY = endY - lightboxTouchStartY;
                    if (Math.abs(deltaX) < 40 || Math.abs(deltaY) > Math.abs(deltaX)) return;
                    lightboxState.index += deltaX < 0 ? 1 : -1;
                    renderLightboxSlide();
                }, { passive: true });
            }

            const updateCarouselPosition = (pageKey, targetIndex) => {
                const images = showcaseImagesByPage.get(pageKey) || [];
                if (images.length <= 1) return;
                const safeIdx = ((targetIndex % images.length) + images.length) % images.length;
                showcaseSlideIndexByPage.set(pageKey, safeIdx);

                const wrapper = document.querySelector(`[data-demo-showcase="${pageKey}"]`);
                if (!wrapper) return;
                const track = wrapper.querySelector('[data-carousel-track]');
                const counter = wrapper.querySelector('[data-carousel-counter]');
                const dots = wrapper.querySelectorAll('[data-carousel-dot]');

                if (track) {
                    track.style.transform = `translate3d(-${safeIdx * 100}%, 0, 0)`;
                }
                if (counter) {
                    counter.textContent = `${safeIdx + 1}/${images.length}`;
                }
                dots.forEach((dot, idx) => {
                    const isActive = idx === safeIdx;
                    dot.setAttribute('aria-current', isActive ? 'true' : 'false');
                    dot.className = isActive
                        ? 'h-1.5 w-4 rounded-full bg-blue-600 transition-all cursor-pointer'
                        : 'h-1.5 w-1.5 rounded-full bg-slate-300 hover:bg-slate-400 transition-all cursor-pointer';
                });
            };

            const renderSlideVisualHtml = (shot, moduleLabel, idx) => {
                const isVideo = isShowcaseVideoItem(shot);
                if (isVideo) {
                    const posterVisual = shot.posterUrl
                        ? `<img src="${escapeHtml(shot.posterUrl)}" alt="${escapeHtml(moduleLabel)} video preview ${idx + 1}" class="w-full h-full object-cover pointer-events-none" referrerpolicy="no-referrer" loading="lazy">`
                        : `<div class="w-full h-full bg-slate-900 flex items-center justify-center"><i class="fas fa-film text-slate-600 text-2xl"></i></div>`;
                    return `
                        <button type="button" data-showcase-zoom="${idx}" class="w-full h-full shrink-0 relative flex items-center justify-center bg-slate-900 cursor-pointer overflow-hidden group" aria-label="Play ${escapeHtml(moduleLabel)} video ${idx + 1}">
                            ${posterVisual}
                            <span class="absolute inset-0 bg-slate-950/30 group-hover:bg-slate-950/20 transition-colors flex items-center justify-center">
                                <span class="w-11 h-11 rounded-full bg-white/95 text-slate-900 shadow-lg flex items-center justify-center group-hover:scale-105 transition-transform">
                                    <i class="fas fa-play text-xs ml-0.5" aria-hidden="true"></i>
                                </span>
                            </span>
                            <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-indigo-600/95 text-white text-[9px] font-extrabold uppercase tracking-wide inline-flex items-center gap-1">
                                <i class="fas fa-video text-[8px]" aria-hidden="true"></i>Video
                            </span>
                        </button>
                    `;
                }
                return `
                    <button type="button" data-showcase-zoom="${idx}" class="w-full h-full shrink-0 relative flex items-center justify-center bg-slate-100 cursor-zoom-in overflow-hidden group" aria-label="Expand ${escapeHtml(moduleLabel)} screenshot ${idx + 1}">
                        <img src="${escapeHtml(shot.url)}" alt="${escapeHtml(moduleLabel)} screenshot ${idx + 1}" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200 pointer-events-none" referrerpolicy="no-referrer" loading="lazy">
                        <span class="absolute bottom-2 right-2 w-7 h-7 rounded-lg bg-slate-900/70 text-white text-[10px] flex items-center justify-center opacity-85 group-hover:opacity-100 transition-opacity">
                            <i class="fas fa-expand" aria-hidden="true"></i>
                        </span>
                    </button>
                `;
            };

            const renderPageShowcaseViewport = (pageKey) => {
                const wrapper = document.querySelector(`[data-demo-showcase="${pageKey}"]`);
                if (!wrapper) return;
                const fallbackEl = wrapper.querySelector('[data-showcase-fallback]');
                const mediaEl = wrapper.querySelector('[data-showcase-media]');
                if (!fallbackEl || !mediaEl) return;

                const images = showcaseImagesByPage.get(pageKey) || [];
                const moduleLabel = showcaseLabelByKey.get(pageKey) || 'Platform Preview';

                if (!images.length) {
                    fallbackEl.classList.remove('hidden');
                    mediaEl.classList.add('hidden');
                    mediaEl.innerHTML = '';
                    return;
                }

                fallbackEl.classList.add('hidden');
                mediaEl.classList.remove('hidden');
                const currentIdx = Math.min(showcaseSlideIndexByPage.get(pageKey) || 0, images.length - 1);
                showcaseSlideIndexByPage.set(pageKey, currentIdx);

                if (images.length === 1) {
                    mediaEl.innerHTML = `
                        <div class="rounded-xl border border-slate-200 bg-slate-100 overflow-hidden aspect-[16/10] relative">
                            ${renderSlideVisualHtml(images[0], moduleLabel, 0)}
                        </div>
                    `;
                    mediaEl.querySelectorAll('[data-showcase-zoom]').forEach((btn) => {
                        btn.addEventListener('click', () => openShowcaseLightbox(pageKey, 0));
                    });
                    return;
                }

                // Multi-media compact interactive carousel (2–5 images/videos)
                mediaEl.innerHTML = `
                    <div class="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                        <div data-carousel-stage class="relative aspect-[16/10] bg-slate-100 overflow-hidden select-none" style="touch-action: pan-y;">
                            <div data-carousel-track class="flex h-full transition-transform duration-200 ease-out" style="transform: translate3d(-${currentIdx * 100}%, 0, 0);">
                                ${images.map((shot, idx) => renderSlideVisualHtml(shot, moduleLabel, idx)).join('')}
                            </div>

                            <button type="button" data-carousel-prev class="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/90 hover:bg-white text-slate-900 border border-slate-200 shadow-sm flex items-center justify-center cursor-pointer transition" aria-label="Previous media">
                                <i class="fas fa-chevron-left text-[10px]" aria-hidden="true"></i>
                            </button>
                            <button type="button" data-carousel-next class="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/90 hover:bg-white text-slate-900 border border-slate-200 shadow-sm flex items-center justify-center cursor-pointer transition" aria-label="Next media">
                                <i class="fas fa-chevron-right text-[10px]" aria-hidden="true"></i>
                            </button>
                            <span data-carousel-counter class="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded-md bg-slate-900/75 text-white text-[10px] font-extrabold tabular-nums pointer-events-none">${currentIdx + 1}/${images.length}</span>
                        </div>

                        <div class="px-2.5 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between gap-2">
                            <div class="flex items-center gap-1" role="group" aria-label="Media slides">
                                ${images.map((_, idx) => `
                                    <button type="button" data-carousel-dot="${idx}" aria-label="Go to slide ${idx + 1}" aria-current="${idx === currentIdx ? 'true' : 'false'}" class="${idx === currentIdx ? 'h-1.5 w-4 rounded-full bg-blue-600 transition-all cursor-pointer' : 'h-1.5 w-1.5 rounded-full bg-slate-300 hover:bg-slate-400 transition-all cursor-pointer'}"></button>
                                `).join('')}
                            </div>
                            <button type="button" data-carousel-zoom-active class="text-[10px] font-extrabold text-blue-600 hover:text-blue-700 cursor-pointer inline-flex items-center gap-1">
                                <i class="fas fa-expand text-[9px]" aria-hidden="true"></i><span>Full View</span>
                            </button>
                        </div>
                    </div>
                `;

                mediaEl.querySelector('[data-carousel-prev]')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateCarouselPosition(pageKey, (showcaseSlideIndexByPage.get(pageKey) || 0) - 1);
                });
                mediaEl.querySelector('[data-carousel-next]')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateCarouselPosition(pageKey, (showcaseSlideIndexByPage.get(pageKey) || 0) + 1);
                });
                mediaEl.querySelectorAll('[data-carousel-dot]').forEach((dot) => {
                    dot.addEventListener('click', () => {
                        updateCarouselPosition(pageKey, Number(dot.getAttribute('data-carousel-dot') || 0));
                    });
                });
                mediaEl.querySelector('[data-carousel-zoom-active]')?.addEventListener('click', () => {
                    openShowcaseLightbox(pageKey, showcaseSlideIndexByPage.get(pageKey) || 0);
                });
                mediaEl.querySelectorAll('[data-showcase-zoom]').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        openShowcaseLightbox(pageKey, Number(btn.getAttribute('data-showcase-zoom') || 0));
                    });
                });

                const stage = mediaEl.querySelector('[data-carousel-stage]');
                let touchStartX = 0;
                let touchStartY = 0;
                stage?.addEventListener('touchstart', (e) => {
                    touchStartX = e.changedTouches?.[0]?.clientX || 0;
                    touchStartY = e.changedTouches?.[0]?.clientY || 0;
                }, { passive: true });
                stage?.addEventListener('touchend', (e) => {
                    const endX = e.changedTouches?.[0]?.clientX || 0;
                    const endY = e.changedTouches?.[0]?.clientY || 0;
                    const deltaX = endX - touchStartX;
                    const deltaY = endY - touchStartY;
                    if (Math.abs(deltaX) < 40 || Math.abs(deltaY) > Math.abs(deltaX)) return;
                    updateCarouselPosition(pageKey, (showcaseSlideIndexByPage.get(pageKey) || 0) + (deltaX < 0 ? 1 : -1));
                }, { passive: true });
            };

            if (!document.documentElement.dataset.boundShowcaseKeyboard) {
                document.documentElement.dataset.boundShowcaseKeyboard = 'true';
                document.addEventListener('keydown', (e) => {
                    if (!isRootGatewayMode) return;
                    const lightboxOpen = lightboxModal && !lightboxModal.classList.contains('hidden');
                    if (!lightboxOpen) return;
                    if (e.key === 'Escape') {
                        closeShowcaseLightbox();
                    } else if (e.key === 'ArrowLeft' && lightboxState.images.length > 1) {
                        lightboxState.index -= 1;
                        renderLightboxSlide();
                    } else if (e.key === 'ArrowRight' && lightboxState.images.length > 1) {
                        lightboxState.index += 1;
                        renderLightboxSlide();
                    }
                });
            }

            // Load uploaded platform showcase images & videos from Firestore (public read)
            (async () => {
                try {
                    const snap = await getDocs(
                        collection(db, COMPANY_COLLECTION, COMPANY_PUBLIC_CATALOG_DOC_ID, COMPANY_SHOWCASES_SUBCOLLECTION)
                    );
                    snap.forEach((docSnap) => {
                        const pageKey = docSnap.id;
                        if (!showcaseLabelByKey.has(pageKey)) return;
                        const rawImages = Array.isArray(docSnap.data()?.images) ? docSnap.data().images : [];
                        const validImages = rawImages
                            .filter((item) => item && typeof item === 'object' && isSafeShowcaseUrl(item.url))
                            .slice(0, 5)
                            .map((item, idx) => ({
                                id: String(item.id || `${pageKey}_${idx}`),
                                url: String(item.url).trim(),
                                mediaType: item.mediaType === 'video' || (!item.mediaType && isShowcaseVideoItem(item)) ? 'video' : 'image',
                                posterUrl: item.posterUrl && isSafeShowcaseUrl(item.posterUrl) ? String(item.posterUrl).trim() : '',
                                caption: String(item.caption || '').trim()
                            }));
                        showcaseImagesByPage.set(pageKey, validImages);
                        renderPageShowcaseViewport(pageKey);
                    });
                } catch (err) {
                    console.warn('Platform showcases load notice:', err);
                }
            })();

            renderVersionInfo();
            loaded.config = true;
            loaded.content = true;
            loaded.staff = true;
            loaded.students = true;
            forceHideSplash();
        }

        async function init() {
            populateClassDropdown();

            const tenantCheck = await ensureTenantStatusAndAccess({
                db,
                institutionId: INSTITUTION_ID,
                allowMissingRoot: true,
                allowPublicIndex: true,
                liveWatch: true,
                onStatusUpdate: (statusRes) => {
                    latestTenantStatus = statusRes;
                    if (statusRes?.exists && statusRes?.institution?.name) {
                        const loginInstEl = document.getElementById('login-institution-name');
                        if (loginInstEl && !globalInstitutionConfig?.appName) {
                            loginInstEl.textContent = statusRes.institution.name;
                        }
                    }
                    if (!statusRes?.isRootGateway && statusRes?.exists && statusRes?.active === false) {
                        const loginModal = document.getElementById('login-modal');
                        if (loginModal && loginModal.style.display === 'flex') {
                            loginModal.style.display = 'none';
                        }
                        const savedModal = document.getElementById('saved-student-modal');
                        if (savedModal && savedModal.style.display === 'flex') {
                            savedModal.style.display = 'none';
                        }
                    }
                }
            });

            latestTenantStatus = tenantCheck;
            isRootGatewayMode = Boolean(tenantCheck?.isRootGateway);
            if (!tenantCheck?.active && !tenantCheck?.publicIndexAllowed) {
                loaded.config = true;
                loaded.content = true;
                loaded.staff = true;
                loaded.students = true;
                forceHideSplash();
                return;
            }
            if (isRootGatewayMode) {
                activateRootGatewayMode();
                return;
            }

            // Tenant public page PWA install control (header button left of hamburger menu, hidden when installed)
            registerInstallTrigger({
                key: 'tenant-public',
                buttonIds: ['header-btn-install'],
                containerIds: [],
                hideWhenStandalone: true,
                onBeforeTrigger: () => setMobileMenuState(false)
            });

            // 1. Institution Config snapshot (Public)
            onSnapshot(doc(db, `${BASE_PATH}/settings`, 'config'), snap => {
                const conf = snap.exists() ? snap.data() : {};
                globalInstitutionConfig = conf;
                if (conf.enabledModules && typeof conf.enabledModules === 'object') {
                    try {
                        localStorage.setItem('app_enabled_modules', JSON.stringify(conf.enabledModules));
                    } catch (_) {}
                }
                
                const institutionName = conf.appName || conf.institutionName || conf.schoolName || conf.name || '';
                if (institutionName) {
                    const loginInstEl = document.getElementById('login-institution-name');
                    if (loginInstEl) loginInstEl.textContent = institutionName;
                }
                applyInstitutionBranding(conf, {
                    defaultAppName: 'Institution',
                    primaryTitleIds: ['hero-main-title'],
                    subtitleIds: ['hero-subtitle'],
                    logoIds: ['splash-logo-img', 'hero-logo-img', 'header-logo', 'login-modal-logo']
                });

                setTimeout(() => { fitHeroTitle(); }, 50);

                const effectiveLogo = sanitizeUrl(conf.logoUrl || '') || '/assets/images/logo.png';
                ['splash-logo-img', 'hero-logo-img', 'header-logo', 'login-modal-logo'].forEach((id) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.src = effectiveLogo;
                    el.classList.remove('hidden');
                    el.style.display = '';
                    el.style.opacity = '1';
                });
                document.getElementById('login-modal-logo-fallback')?.classList.add('hidden');
                
                renderVersionInfo();
                populateClassDropdown(conf);
                const stats = conf.stats || {};
                const statTotal = document.getElementById('stat-total');
                const statMale = document.getElementById('stat-male');
                const statFemale = document.getElementById('stat-female');
                if (statTotal) statTotal.textContent = (stats.total !== undefined && stats.total !== null) ? stats.total : '-';
                if (statMale) statMale.textContent = (stats.male !== undefined && stats.male !== null) ? stats.male : '-';
                if (statFemale) statFemale.textContent = (stats.female !== undefined && stats.female !== null) ? stats.female : '-';
                loaded.config = true;
                loaded.students = true;
                triggerAnim();
            }, err => {
                console.warn('Config snapshot notice:', err);
                loaded.config = true;
                loaded.students = true;
                triggerAnim();
            });

            // 2. Institution Content snapshot (Notices & Gallery) (Public)
            onSnapshot(doc(db, `${BASE_PATH}/settings`, 'content'), snap => {
                const content = snap.exists() ? snap.data() : {};
                const rawDirCats = Array.isArray(content.directoryCategories) ? content.directoryCategories : [];
                allStaffCategories = rawDirCats;
                directoryCategories = rawDirCats.filter((c) => c && !['Teacher', 'Management'].includes(String(c.id || '').trim()));
                const aboutDescEl = document.getElementById('about-desc');
                if (aboutDescEl) {
                    aboutDescEl.innerHTML = renderNoticeTextWithLinks(content.description || 'Welcome to our institution.', 25);
                }
                
                // Notices Display Logic
                const notices = Array.isArray(content.notices) ? content.notices : [];
                const noticesCont = document.getElementById('notices-container');
                const navNoticesLink = document.getElementById('nav-notices-link');
                const heroBtnNotice = document.getElementById('hero-btn-notice');
                
                if (notices.length === 0) {
                    noticesCont.classList.add('hidden');
                    if (navNoticesLink) navNoticesLink.classList.add('hidden');
                    if (heroBtnNotice) heroBtnNotice.classList.add('hidden');
                } else {
                    noticesCont.classList.remove('hidden');
                    if (navNoticesLink) navNoticesLink.classList.remove('hidden');
                    if (heroBtnNotice) heroBtnNotice.classList.remove('hidden');
                    
                    const noticeLimit = !isElitePlan() ? getPlanLimit('maxNotices') : Infinity;
                    const sortedNotices = notices
                        .map((notice, originalIndex) => ({ notice, originalIndex }))
                        .sort((a, b) => {
                            const pinWeight = Number(b.notice?.pinned === true) - Number(a.notice?.pinned === true);
                            if (pinWeight !== 0) return pinWeight;
                            const dateA = new Date(a.notice?.date || 0).getTime() || 0;
                            const dateB = new Date(b.notice?.date || 0).getTime() || 0;
                            if (dateA !== dateB) return dateB - dateA;
                            return b.originalIndex - a.originalIndex;
                        })
                        .map((entry) => entry.notice)
                        .slice(0, Number.isFinite(noticeLimit) ? Math.max(1, noticeLimit) : notices.length);

                    latestNoticeCache = sortedNotices.map((notice, index) => {
                        const text = String(notice?.text || '').trim();
                        const rawImg = String(notice?.image || notice?.imageUrl || '').trim();
                        const safeImage = (rawImg && rawImg.startsWith('data:image/')) ? rawImg : sanitizeUrl(rawImg);
                        return {
                            heading: deriveNoticeHeading(notice, index),
                            text,
                            image: safeImage || '',
                            date: String(notice?.date || ''),
                            pinned: notice?.pinned === true
                        };
                    });

                    noticeListEl.innerHTML = latestNoticeCache.map((notice, index) => {
                        const longNotice = isNoticeLong(notice.text);
                        const hasHeading = Boolean(notice.heading);
                        const hasText = Boolean(notice.text);
                        const hasImage = Boolean(notice.image);
                        return `
                        <article class="notice-card">
                            <div class="notice-card-content">
                                ${hasHeading ? `<h4 class="notice-title">${notice.pinned ? '<i class="fas fa-thumbtack text-amber-500 mr-1" title="Pinned"></i>' : ''}${escapeHtml(notice.heading)}</h4>` : (notice.pinned ? `<div class="text-xs font-bold text-amber-600 flex items-center justify-center gap-1"><i class="fas fa-thumbtack"></i> Pinned Notice</div>` : '')}
                                ${hasImage ? `<div class="notice-image-wrap cursor-pointer" data-notice-card-img="1" data-notice-index="${index}"><img src="${notice.image}" alt="${escapeHtml(notice.heading || 'Notification image')}" loading="lazy"></div>` : ''}
                                ${hasText ? `<p class="notice-body ${longNotice ? 'notice-preview-clamp' : ''}">${renderNoticeTextWithLinks(notice.text, 25)}</p>` : ''}
                            </div>
                            <div class="notice-footer">
                                <span class="notice-date"><i class="far fa-calendar-alt"></i> ${escapeHtml(notice.date || 'Date unavailable')}</span>
                                ${(longNotice || hasImage) ? `<button type="button" class="notice-expand-btn" data-notice-index="${index}">${longNotice ? 'Expand' : 'View'}</button>` : ''}
                            </div>
                        </article>
                    `;
                    }).join('');
                    fitNoticeViewportForFourCards();
                    noticeListEl.querySelectorAll('img').forEach((img) => {
                        img.addEventListener('load', fitNoticeViewportForFourCards, { once: true });
                    });
                }

                // Gallery Display Logic
                const gallery = Array.isArray(content.gallery) ? content.gallery : [];
                const galleryCont = document.getElementById('gallery-container');
                const navGalleryLink = document.getElementById('nav-gallery-link');
                const heroBtnGallery = document.getElementById('hero-btn-gallery');
                
                if (gallery.length === 0) {
                    galleryCont.classList.add('hidden');
                    if (navGalleryLink) navGalleryLink.classList.add('hidden');
                    if (heroBtnGallery) heroBtnGallery.classList.add('hidden');
                } else {
                    galleryCont.classList.remove('hidden');
                    if (navGalleryLink) navGalleryLink.classList.remove('hidden');
                    if (heroBtnGallery) heroBtnGallery.classList.remove('hidden');
                    
                    const galleryLimit = !isElitePlan() ? getPlanLimit('maxGalleryPhotos') : Infinity;
                    galleryUrls = gallery
                        .map((item, originalIndex) => {
                            const parsedOrder = Number(item?.order);
                            return {
                                url: typeof item === 'string' ? item : (item?.url || item?.imageUrl || item?.src || ''),
                                order: Number.isFinite(parsedOrder) && parsedOrder > 0 ? parsedOrder : originalIndex + 1,
                                originalIndex
                            };
                        })
                        .sort((a, b) => (a.order - b.order) || (a.originalIndex - b.originalIndex))
                        .map((item) => sanitizeUrl(item.url))
                        .filter(Boolean)
                        .slice(0, Number.isFinite(galleryLimit) ? Math.max(1, galleryLimit) : gallery.length);
                    document.getElementById('gallery-list').innerHTML = galleryUrls.map((safeUrl, index) => {
                        return `<button type="button" class="gallery-item" data-gallery-index="${index}" data-gallery-url="${escapeHtml(safeUrl)}" aria-label="View photo ${index + 1}"><img src="${safeUrl}" alt="Gallery image ${index + 1}" loading="lazy"></button>`;
                    }).join('');
                }
                
                loaded.content = true;
                triggerAnim();
                renderDynamicDirectory();
                if (typeof renderStaffDirectory === 'function') renderStaffDirectory();
            }, err => {
                console.warn('Content snapshot notice:', err);
                loaded.content = true;
                triggerAnim();
            });

            // 3. Public Directory snapshot
            onSnapshot(collection(db, `${BASE_PATH}/publicDirectory`), snap => {
                directoryEntries = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
                loaded.dirEntries = true;
                dirEntriesFromServer = !snap.metadata?.fromCache;
                renderDynamicDirectory();
                validateAndPruneRememberedAccounts({ verifyStudentsOnline: false });
            }, err => {
                console.warn('Public directory notice:', err);
                loaded.dirEntries = true;
            });

            // 4. Category Auth & Page Access settings (only required when tenant portal login is active)
            if (tenantCheck?.active) {
                onSnapshot(doc(db, `${BASE_PATH}/settings`, 'categoryAuthConfig'), snap => {
                    const payload = snap.exists() ? snap.data() : {};
                    categoryAuthConfig = payload && typeof payload.categories === 'object' ? payload : { categories: {} };
                    loaded.dirAuth = true;
                    validateAndPruneRememberedAccounts({ verifyStudentsOnline: false });
                }, err => {
                    console.warn('Category auth notice:', err);
                    loaded.dirAuth = true;
                });

                onSnapshot(doc(db, `${BASE_PATH}/settings`, 'pageAccess'), snap => {
                    const payload = snap.exists() ? snap.data() : {};
                    pageAccessConfig = (payload && typeof payload === 'object') ? payload : { categories: {}, overrides: {} };
                    loaded.pageAccess = true;
                    validateAndPruneRememberedAccounts({ verifyStudentsOnline: false });
                }, err => {
                    console.warn('Page access notice:', err);
                    loaded.pageAccess = true;
                });
            } else {
                loaded.dirAuth = true;
                loaded.pageAccess = true;
            }

            const isCategoryPubliclyVisible = (categoryId = '') => {
                const target = String(categoryId || '').trim().toLowerCase();
                const match = allStaffCategories.find((c) => c && (String(c.id || '').trim().toLowerCase() === target || String(c.name || '').trim().toLowerCase() === target));
                return match ? match.showPublic !== false : true;
            };

            const renderStaffDirectory = () => {
                const isTeacherPublic = isCategoryPubliclyVisible('Teacher');
                const isMgmtPublic = isCategoryPubliclyVisible('Management');

                staffDirectoryEntries = cachedActiveStaff
                    .filter((staffMember) => staffMember.showPublic !== false && directoryCategories.some((category) => category.id === staffMember.type && category.showPublic !== false))
                    .map((staffMember) => ({
                        id: `staff:${staffMember.id}`,
                        categoryId: staffMember.type,
                        displayOrder: staffMember.displayOrder || 999,
                        updatedAt: staffMember.updatedAt || 0,
                        values: {
                            name: staffMember.name || '',
                            role: staffMember.role || '',
                            phone: staffMember.phone || '',
                            photo: staffMember.photo || '',
                            address: staffMember.address || ''
                        }
                    }));
                renderDynamicDirectory();
                const sortByDisplayOrder = (list = []) => [...list].sort((a, b) => {
                    const orderDiff = Number(a?.displayOrder || 999) - Number(b?.displayOrder || 999);
                    if (orderDiff !== 0) return orderDiff;
                    return String(a?.name || '').localeCompare(String(b?.name || ''));
                });
                const publicStaff = cachedActiveStaff.filter((staffMember) => staffMember.showPublic !== false);
                const teachers = sortByDisplayOrder(publicStaff.filter(s => s.type === 'Teacher'));
                const mgmt = sortByDisplayOrder(publicStaff.filter(s => s.type === 'Management'));
                
                const renderStaffList = (id, list, contId, linkId, btnId, isCategoryVisible) => {
                    const cont = document.getElementById(contId);
                    const navLink = linkId ? document.getElementById(linkId) : null;
                    const heroBtn = btnId ? document.getElementById(btnId) : null;
                    if (!cont) return;

                    if (!isCategoryVisible) {
                        cont.classList.add('hidden');
                        if (navLink) navLink.classList.add('hidden');
                        if (heroBtn) heroBtn.classList.add('hidden');
                        return;
                    }

                    const forceShow = id === 'teachers-list';
                    if (!list.length) { 
                        if (forceShow) {
                            cont.classList.remove('hidden');
                            if (navLink) navLink.classList.remove('hidden');
                            if (heroBtn) heroBtn.classList.remove('hidden');
                            document.getElementById(id).innerHTML = '<p class="text-sm text-gray-500 italic">No profiles available.</p>';
                        } else {
                            cont.classList.add('hidden'); 
                            if (navLink) navLink.classList.add('hidden'); 
                            if (heroBtn) heroBtn.classList.add('hidden'); 
                        }
                    } else { 
                        cont.classList.remove('hidden'); 
                        if (navLink) navLink.classList.remove('hidden'); 
                        if (heroBtn) heroBtn.classList.remove('hidden'); 
                        
                        document.getElementById(id).innerHTML = list.map((p) => {
                            const safePhoto = (p.photo && p.photo.startsWith('data:')) ? p.photo : (sanitizeUrl(p.photo) || '/assets/images/logo.png');
                            return `<button type="button" class="person-card" data-person-name="${escapeHtml(p.name || '')}" data-person-role="${escapeHtml(p.role || '')}" data-person-phone="${escapeHtml(p.phone || '')}" data-person-img="${escapeHtml(safePhoto)}" data-person-address="${escapeHtml(p.address || '')}"><img src="${safePhoto}" class="person-img" alt="${escapeHtml(p.name || 'Staff member')}"><div class="person-name">${escapeHtml(p.name)}</div><div class="person-role">${escapeHtml(p.role)}</div></button>`;
                        }).join('');
                    }
                };
                
                renderStaffList('teachers-list', teachers, 'teachers-container', 'nav-teachers-link', 'hero-btn-teachers', isTeacherPublic);
                renderStaffList('comm-list', mgmt, 'management-container', 'nav-management-link', null, isMgmtPublic);
                
                const statStaffEl = document.getElementById('stat-staff');
                if (statStaffEl) {
                    statStaffEl.textContent = isTeacherPublic ? teachers.length : 0;
                }
            };

            // 5. Staff Directory snapshot (Public profiles)
            onSnapshot(collection(db, `${BASE_PATH}/staff`), snap => {
                allStaffSnapshotRecords = snap.docs.map(d => ({id: d.id, ...d.data()}));
                cachedActiveStaff = allStaffSnapshotRecords.filter(s => s.isActive !== false);
                staffSnapshotFromServer = !snap.metadata?.fromCache;
                renderStaffDirectory();
                loaded.staff = true;
                triggerAnim();
                validateAndPruneRememberedAccounts({ verifyStudentsOnline: false });
            }, err => {
                console.warn('Staff listener notice:', err);
                loaded.staff = true;
                triggerAnim();
            });
        }


        const lName = document.getElementById('login-student-name');
        const lClass = document.getElementById('login-class');
        const lSugg = document.getElementById('student-suggestions');
        const galleryList = document.getElementById('gallery-list');
        const galleryPrevBtn = document.getElementById('gallery-nav-prev');
        const galleryNextBtn = document.getElementById('gallery-nav-next');
        const staffContainers = ['teachers-list', 'comm-list', 'dynamic-directory-sections']
            .map((id) => document.getElementById(id))
            .filter(Boolean);

        galleryPrevBtn?.addEventListener('click', () => {
            if (!galleryList) return;
            const scrollDist = galleryList.clientWidth * 0.75;
            galleryList.scrollBy({ left: -scrollDist, behavior: 'smooth' });
        });
        galleryNextBtn?.addEventListener('click', () => {
            if (!galleryList) return;
            const scrollDist = galleryList.clientWidth * 0.75;
            galleryList.scrollBy({ left: scrollDist, behavior: 'smooth' });
        });

        let isGalleryDragging = false;
        let galleryStartX = 0;
        let galleryScrollLeft = 0;
        let hasGalleryDragged = false;

        galleryList?.addEventListener('mousedown', (e) => {
            isGalleryDragging = true;
            hasGalleryDragged = false;
            galleryStartX = e.pageX - galleryList.offsetLeft;
            galleryScrollLeft = galleryList.scrollLeft;
            galleryList.style.cursor = 'grabbing';
        });

        window.addEventListener('mouseup', () => {
            if (!isGalleryDragging) return;
            isGalleryDragging = false;
            if (galleryList) galleryList.style.cursor = '';
        });

        galleryList?.addEventListener('mousemove', (e) => {
            if (!isGalleryDragging) return;
            const x = e.pageX - galleryList.offsetLeft;
            const walk = (x - galleryStartX) * 1.4;
            if (Math.abs(walk) > 6) hasGalleryDragged = true;
            galleryList.scrollLeft = galleryScrollLeft - walk;
        });

        galleryList?.addEventListener('click', (event) => {
            if (hasGalleryDragged) {
                event.preventDefault();
                event.stopPropagation();
                hasGalleryDragged = false;
                return;
            }
            const card = event.target.closest('[data-gallery-url]');
            if (!card) return;
            openImageModal(card.dataset.galleryUrl, Number(card.dataset.galleryIndex || -1));
        }, true);

        staffContainers.forEach((container) => {
            container.addEventListener('click', (event) => {
                const card = event.target.closest('[data-person-name]');
                if (!card) return;
                window.openPersonModal(
                    card.dataset.personName || '',
                    card.dataset.personRole || '',
                    card.dataset.personPhone || '',
                    card.dataset.personImg || '',
                    card.dataset.personAddress || ''
                );
            });
        });
        
        // State for Student OTP & Official 2FA Login
        let activeLoginMode = 'student';
        let verifiedUser = null;
        let studentOtpState = {
            rawPhone: '',
            countryCode: '+91',
            phoneE164: '',
            maskedPhone: '',
            previews: [],
            confirmationResult: null,
            verifiedStudents: []
        };
        let officialOtpState = {
            challengeId: '',
            phoneE164: '',
            maskedPhone: '',
            confirmationResult: null,
            cachedPassword: '',
            flowType: '' // 'custom_auth' | 'directory'
        };
        let recaptchaVerifierInstance = null;
        let recaptchaMountCounter = 0;
        let otpResendTimers = { student: null, official: null };

        const OTP_QUOTA_STORAGE_KEY = 'app_otp_send_quota_v1';
        const OTP_MAX_TOTAL_SENDS = 3; // 1 initial OTP + max 2 resends
        const OTP_MAX_RESENDS = OTP_MAX_TOTAL_SENDS - 1;
        const OTP_QUOTA_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

        const getOtpQuotaKey = (scope = 'student', phoneE164 = '') =>
            `${INSTITUTION_ID || 'root'}:${scope}:${String(phoneE164 || '').trim().toLowerCase()}`;

        const readOtpQuotaStore = () => {
            try {
                const raw = localStorage.getItem(OTP_QUOTA_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : {};
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (_) {
                return {};
            }
        };

        const writeOtpQuotaStore = (store) => {
            try {
                localStorage.setItem(OTP_QUOTA_STORAGE_KEY, JSON.stringify(store));
            } catch (_) {}
        };

        const getOtpQuotaStatus = (scope = 'student', phoneE164 = '') => {
            const nowMs = Date.now();
            const key = getOtpQuotaKey(scope, phoneE164);
            const store = readOtpQuotaStore();
            const rawList = Array.isArray(store[key]) ? store[key] : [];
            const active = rawList
                .map(Number)
                .filter((ts) => Number.isFinite(ts) && (nowMs - ts) < OTP_QUOTA_WINDOW_MS)
                .sort((a, b) => a - b);

            if (active.length !== rawList.length) {
                if (active.length) store[key] = active;
                else delete store[key];
                writeOtpQuotaStore(store);
            }

            const totalSent = active.length;
            const remainingSends = Math.max(0, OTP_MAX_TOTAL_SENDS - totalSent);
            const resendsUsed = Math.max(0, Math.min(OTP_MAX_RESENDS, totalSent - 1));
            const locked = totalSent >= OTP_MAX_TOTAL_SENDS;
            const waitMinutes = locked && active.length
                ? Math.max(1, Math.ceil((OTP_QUOTA_WINDOW_MS - (nowMs - active[0])) / 60000))
                : 0;

            return {
                totalSent,
                resendsUsed,
                remainingSends,
                locked,
                waitMinutes
            };
        };

        const recordOtpSendAttempt = (scope = 'student', phoneE164 = '') => {
            if (!phoneE164) return getOtpQuotaStatus(scope, phoneE164);
            const nowMs = Date.now();
            const key = getOtpQuotaKey(scope, phoneE164);
            const store = readOtpQuotaStore();
            // Prune stale buckets opportunistically
            Object.keys(store).forEach((bucket) => {
                const list = Array.isArray(store[bucket]) ? store[bucket] : [];
                const fresh = list.map(Number).filter((ts) => Number.isFinite(ts) && (nowMs - ts) < OTP_QUOTA_WINDOW_MS);
                if (fresh.length) store[bucket] = fresh;
                else delete store[bucket];
            });
            const current = Array.isArray(store[key]) ? store[key] : [];
            current.push(nowMs);
            store[key] = current;
            writeOtpQuotaStore(store);
            return getOtpQuotaStatus(scope, phoneE164);
        };

        const VERIFY_BTN_HTML = '<i class="fas fa-arrow-right" aria-hidden="true"></i><span>Verify Account</span>';
        const SIGN_IN_BTN_HTML = '<i class="fas fa-shield-halved" aria-hidden="true"></i><span>Sign In Securely</span>';
        const SEND_OFFICIAL_OTP_BTN_HTML = '<i class="fas fa-shield-halved" aria-hidden="true"></i><span>Verify &amp; Send OTP</span>';
        const VERIFY_PHONE_BTN_HTML = '<i class="fas fa-arrow-right" aria-hidden="true"></i><span>Verify Mobile</span>';
        const SEND_STUDENT_OTP_BTN_HTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i><span>Send OTP</span>';
        const VERIFY_OTP_BTN_HTML = '<i class="fas fa-check-circle" aria-hidden="true"></i><span>Verify &amp; Sign In</span>';

        const loginModalLogoEl = document.getElementById('login-modal-logo');
        const loginModalLogoFallbackEl = document.getElementById('login-modal-logo-fallback');
        loginModalLogoEl?.addEventListener('error', () => {
            const currentSrc = loginModalLogoEl.getAttribute('src') || '';
            if (currentSrc !== '/assets/images/logo.png') {
                loginModalLogoEl.src = '/assets/images/logo.png';
                return;
            }
            loginModalLogoEl.classList.add('hidden');
            loginModalLogoFallbackEl?.classList.remove('hidden');
        });
        loginModalLogoEl?.addEventListener('load', () => {
            if (loginModalLogoEl.getAttribute('src')) {
                loginModalLogoEl.classList.remove('hidden');
                loginModalLogoFallbackEl?.classList.add('hidden');
            }
        });

        const stopOtpTimers = () => {
            ['student', 'official'].forEach((key) => {
                if (otpResendTimers[key]) {
                    clearInterval(otpResendTimers[key]);
                    otpResendTimers[key] = null;
                }
            });
        };

        const startOtpResendTimer = (scope = 'student', seconds = 60, phoneE164 = '') => {
            if (otpResendTimers[scope]) {
                clearInterval(otpResendTimers[scope]);
                otpResendTimers[scope] = null;
            }
            const timerEl = document.getElementById(scope === 'student' ? 'student-otp-timer-text' : 'official-otp-timer-text');
            const resendBtn = document.getElementById(scope === 'student' ? 'btn-student-resend-otp' : 'btn-official-resend-otp');
            let remaining = seconds;
            const renderTick = () => {
                const quota = phoneE164 ? getOtpQuotaStatus(scope, phoneE164) : { locked: false, remainingSends: OTP_MAX_RESENDS, waitMinutes: 0 };
                if (quota.locked) {
                    if (otpResendTimers[scope]) {
                        clearInterval(otpResendTimers[scope]);
                        otpResendTimers[scope] = null;
                    }
                    if (timerEl) {
                        timerEl.textContent = `Resend limit reached (${OTP_MAX_RESENDS}/${OTP_MAX_RESENDS} used). Try again in ${quota.waitMinutes} min.`;
                    }
                    if (resendBtn) {
                        resendBtn.disabled = true;
                        resendBtn.textContent = 'Limit Reached';
                    }
                    return;
                }
                const leftCount = Math.min(OTP_MAX_RESENDS, quota.remainingSends);
                if (remaining > 0) {
                    if (timerEl) {
                        timerEl.textContent = `Resend in ${remaining}s (${leftCount} resend${leftCount === 1 ? '' : 's'} left)`;
                    }
                    if (resendBtn) {
                        resendBtn.disabled = true;
                        resendBtn.textContent = 'Resend OTP';
                    }
                } else {
                    if (timerEl) timerEl.textContent = 'Did not receive the SMS?';
                    if (resendBtn) {
                        resendBtn.disabled = false;
                        resendBtn.textContent = `Resend OTP (${leftCount} left)`;
                    }
                }
            };
            renderTick();
            if (!phoneE164 || !getOtpQuotaStatus(scope, phoneE164).locked) {
                otpResendTimers[scope] = setInterval(() => {
                    remaining -= 1;
                    if (remaining <= 0) {
                        clearInterval(otpResendTimers[scope]);
                        otpResendTimers[scope] = null;
                        remaining = 0;
                    }
                    renderTick();
                }, 1000);
            }
        };

        const resetRecaptchaVerifier = () => {
            if (recaptchaVerifierInstance) {
                try { recaptchaVerifierInstance.clear(); } catch (_) {}
                recaptchaVerifierInstance = null;
            }
            const container = document.getElementById('firebase-recaptcha-container');
            if (container) {
                container.replaceChildren();
            }
        };

        const ensureRecaptchaVerifier = async (targetAuth = auth) => {
            const container = document.getElementById('firebase-recaptcha-container');
            if (!container) {
                throw new Error('Verification container is missing. Please reload the page.');
            }
            resetRecaptchaVerifier();
            // Mount each RecaptchaVerifier on a brand-new child element so Google reCAPTCHA never throws
            // "reCAPTCHA has already been rendered in this element" on Resend OTP or retry.
            const slot = document.createElement('div');
            slot.id = `firebase-recaptcha-slot-${++recaptchaMountCounter}`;
            container.appendChild(slot);

            recaptchaVerifierInstance = new RecaptchaVerifier(targetAuth, slot, {
                size: 'invisible',
                callback: () => {},
                'expired-callback': () => {
                    resetRecaptchaVerifier();
                }
            });
            await recaptchaVerifierInstance.render();
            return recaptchaVerifierInstance;
        };

        const formatPhoneAuthError = (err, fallback = 'Unable to send or verify SMS OTP. Please try again.') => {
            const code = String(err?.code || '').trim();
            const rawMessage = String(err?.message || '').trim();
            const currentHostname = typeof window !== 'undefined' && window.location?.hostname
                ? window.location.hostname
                : 'this domain';
            if (code === 'auth/invalid-verification-code') {
                return 'Invalid 6-digit OTP code. Please check the SMS and try again.';
            }
            if (code === 'auth/code-expired') {
                return 'This OTP code has expired. Click Resend OTP to receive a new code.';
            }
            if (code === 'auth/too-many-requests') {
                return 'Too many OTP attempts from this device. Please wait a few minutes and try again.';
            }
            if (
                code === 'auth/unauthorized-domain'
                || (code === 'auth/captcha-check-failed' && /hostname match not found/i.test(rawMessage))
            ) {
                return `SMS verification is not enabled for this domain (${currentHostname}). Please add this domain to Firebase Authorized Domains.`;
            }
            if (code === 'auth/captcha-check-failed') {
                return 'Security verification (reCAPTCHA) failed. Please refresh the page and try again.';
            }
            if (code === 'auth/operation-not-allowed') {
                return 'Phone SMS authentication is not enabled yet in Firebase Console. Please contact the administrator.';
            }
            if (code === 'auth/invalid-phone-number') {
                return 'Invalid mobile number format. Please check the country code and digits.';
            }
            if (code === 'auth/quota-exceeded') {
                return 'SMS OTP quota limit reached. Please contact the administrator.';
            }
            if (code === 'auth/network-request-failed') {
                return 'Network error while verifying OTP. Check your internet connection and try again.';
            }
            return err?.message || fallback;
        };

        const setLoginStepState = (step = 1, { totalSteps = 3, labels = null } = {}) => {
            const step1Item = document.getElementById('login-progress-step-1');
            const step2Item = document.getElementById('login-progress-step-2');
            const step3Item = document.getElementById('login-progress-step-3');
            const stepDot1 = document.getElementById('login-step-dot-1');
            const stepDot2 = document.getElementById('login-step-dot-2');
            const stepDot3 = document.getElementById('login-step-dot-3');
            const stepLabel1 = document.getElementById('login-step-label-1');
            const stepLabel2 = document.getElementById('login-step-label-2');
            const stepLabel3 = document.getElementById('login-step-label-3');
            const line1 = document.getElementById('login-progress-line-1');
            const line2 = document.getElementById('login-progress-line-2');

            if (Array.isArray(labels)) {
                if (stepLabel1 && labels[0]) stepLabel1.textContent = labels[0];
                if (stepLabel2 && labels[1]) stepLabel2.textContent = labels[1];
                if (stepLabel3 && labels[2]) stepLabel3.textContent = labels[2];
            }

            const showStep3 = totalSteps >= 3;
            step3Item?.classList.toggle('hidden', !showStep3);
            line2?.classList.toggle('hidden', !showStep3);

            const applyItem = (item, dot, num) => {
                if (!item) return;
                item.classList.remove('is-active', 'is-completed');
                item.removeAttribute('aria-current');
                if (step > num) {
                    item.classList.add('is-completed');
                    if (dot) dot.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
                } else if (step === num) {
                    item.classList.add('is-active');
                    item.setAttribute('aria-current', 'step');
                    if (dot) dot.textContent = String(num);
                } else {
                    if (dot) dot.textContent = String(num);
                }
            };

            applyItem(step1Item, stepDot1, 1);
            applyItem(step2Item, stepDot2, 2);
            applyItem(step3Item, stepDot3, 3);
            line1?.classList.toggle('is-completed', step > 1);
            line2?.classList.toggle('is-completed', step > 2);
        };

        const hideAllLoginPanels = () => {
            [
                'student-step-1',
                'student-step-2',
                'student-step-3',
                'student-step-select',
                'official-step-1',
                'official-step-2',
                'official-step-3'
            ].forEach((id) => {
                document.getElementById(id)?.classList.add('hidden');
            });
        };

        const resetPasswordVisibility = () => {
            const passEl = document.getElementById('login-password');
            const toggleBtn = document.getElementById('toggle-universal-pass');
            const toggleIcon = document.getElementById('toggle-universal-pass-icon');
            if (passEl) passEl.type = 'password';
            if (toggleIcon) {
                toggleIcon.classList.add('fa-eye');
                toggleIcon.classList.remove('fa-eye-slash');
            }
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-label', 'Show password');
                toggleBtn.setAttribute('aria-pressed', 'false');
            }
        };

        const collapseLoginSessionNotices = () => {
            document.querySelectorAll('#login-modal details.login-session-disclosure[open]').forEach((el) => {
                el.removeAttribute('open');
            });
        };

        const closeLoginModal = () => {
            stopOtpTimers();
            resetRecaptchaVerifier();
            collapseLoginSessionNotices();
            // If Company Owner abandoned 2-Step SMS OTP before completing it, sign out the unverified primary session
            if (officialOtpState.flowType === 'company_owner') {
                signOut(auth).catch(() => {});
                if (companyOtpAuthInstance) signOut(companyOtpAuthInstance).catch(() => {});
            }
            const modalEl = document.getElementById('login-modal');
            if (modalEl) modalEl.style.display = 'none';
            officialOtpState.cachedPassword = '';
            officialOtpState.flowType = '';
            showLoginMessage('');
        };

        const loginModalEl = document.getElementById('login-modal');
        document.getElementById('btn-close-login-modal')?.addEventListener('click', closeLoginModal);
        loginModalEl?.addEventListener('click', (e) => {
            if (e.target === loginModalEl) closeLoginModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && loginModalEl && loginModalEl.style.display === 'flex') {
                closeLoginModal();
            }
        });

        document.getElementById('toggle-universal-pass')?.addEventListener('click', () => {
            const passEl = document.getElementById('login-password');
            const toggleBtn = document.getElementById('toggle-universal-pass');
            const icon = document.getElementById('toggle-universal-pass-icon') || toggleBtn;
            if (passEl) {
                const isPass = passEl.type === 'password';
                passEl.type = isPass ? 'text' : 'password';
                icon?.classList.toggle('fa-eye', !isPass);
                icon?.classList.toggle('fa-eye-slash', isPass);
                toggleBtn?.setAttribute('aria-label', isPass ? 'Hide password' : 'Show password');
                toggleBtn?.setAttribute('aria-pressed', isPass ? 'true' : 'false');
            }
        });

        const setLoginMode = (mode = 'student') => {
            const effectiveMode = mode === 'official' ? 'official' : 'student';
            activeLoginMode = effectiveMode;
            stopOtpTimers();
            collapseLoginSessionNotices();
            showLoginMessage('');

            const tabsWrap = document.getElementById('login-mode-tabs');
            const studentTab = document.getElementById('login-tab-student');
            const officialTab = document.getElementById('login-tab-official');
            tabsWrap?.classList.remove('hidden');

            if (studentTab) {
                const active = effectiveMode === 'student';
                studentTab.classList.toggle('is-active', active);
                studentTab.setAttribute('aria-selected', active ? 'true' : 'false');
            }
            if (officialTab) {
                const active = effectiveMode === 'official';
                officialTab.classList.toggle('is-active', active);
                officialTab.setAttribute('aria-selected', active ? 'true' : 'false');
            }

            if (officialOtpState.flowType === 'company_owner') {
                signOut(auth).catch(() => {});
                if (companyOtpAuthInstance) signOut(companyOtpAuthInstance).catch(() => {});
            }

            verifiedUser = null;
            studentOtpState = {
                rawPhone: '',
                countryCode: document.getElementById('student-country-code')?.value || '+91',
                phoneE164: '',
                maskedPhone: '',
                previews: [],
                confirmationResult: null,
                verifiedStudents: []
            };
            officialOtpState = {
                challengeId: '',
                phoneE164: '',
                maskedPhone: '',
                confirmationResult: null,
                cachedPassword: '',
                flowType: ''
            };

            hideAllLoginPanels();
            resetPasswordVisibility();

            if (effectiveMode === 'student') {
                setLoginStepState(1, { totalSteps: 3, labels: ['Mobile', 'Confirm', 'OTP'] });
                document.getElementById('student-step-1')?.classList.remove('hidden');
                const phoneInput = document.getElementById('student-login-phone');
                if (phoneInput) {
                    phoneInput.value = '';
                    setTimeout(() => phoneInput.focus(), 40);
                }
                const verifyPhoneBtn = document.getElementById('btn-student-verify-phone');
                if (verifyPhoneBtn) {
                    verifyPhoneBtn.disabled = false;
                    verifyPhoneBtn.innerHTML = VERIFY_PHONE_BTN_HTML;
                }
                const sendOtpBtn = document.getElementById('btn-student-send-otp');
                if (sendOtpBtn) {
                    sendOtpBtn.disabled = false;
                    sendOtpBtn.innerHTML = SEND_STUDENT_OTP_BTN_HTML;
                }
                const verifyOtpBtn = document.getElementById('btn-student-verify-otp');
                if (verifyOtpBtn) {
                    verifyOtpBtn.disabled = false;
                    verifyOtpBtn.innerHTML = VERIFY_OTP_BTN_HTML;
                }
                const otpInput = document.getElementById('student-otp-input');
                if (otpInput) otpInput.value = '';
            } else {
                setLoginStepState(1, { totalSteps: 3, labels: ['Account', 'Password', 'OTP'] });
                document.getElementById('official-step-1')?.classList.remove('hidden');
                const userInput = document.getElementById('login-username');
                if (userInput) {
                    userInput.value = '';
                    setTimeout(() => userInput.focus(), 40);
                }
                const passInput = document.getElementById('login-password');
                if (passInput) passInput.value = '';
                const otpInput = document.getElementById('official-otp-input');
                if (otpInput) otpInput.value = '';
                const verifyBtn = document.getElementById('btn-verify-user');
                if (verifyBtn) {
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = VERIFY_BTN_HTML;
                }
                const submitBtn = document.getElementById('btn-login-submit');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = SEND_OFFICIAL_OTP_BTN_HTML;
                }
                const officialVerifyBtn = document.getElementById('btn-official-verify-otp');
                if (officialVerifyBtn) {
                    officialVerifyBtn.disabled = false;
                    officialVerifyBtn.innerHTML = VERIFY_OTP_BTN_HTML;
                }
            }
        };

        const resetUniversalLoginForm = (preferredMode = null) => {
            const targetMode = preferredMode || 'student';
            setLoginMode(targetMode);
        };

        document.getElementById('login-tab-student')?.addEventListener('click', () => {
            setLoginMode('student');
        });
        document.getElementById('login-tab-official')?.addEventListener('click', () => {
            setLoginMode('official');
        });

        document.getElementById('btn-student-change-phone')?.addEventListener('click', () => {
            stopOtpTimers();
            hideAllLoginPanels();
            setLoginStepState(1, { totalSteps: 3, labels: ['Mobile', 'Confirm', 'OTP'] });
            document.getElementById('student-step-1')?.classList.remove('hidden');
            showLoginMessage('');
            document.getElementById('student-login-phone')?.focus();
        });

        document.getElementById('btn-student-otp-change')?.addEventListener('click', () => {
            stopOtpTimers();
            studentOtpState.confirmationResult = null;
            hideAllLoginPanels();
            setLoginStepState(1, { totalSteps: 3, labels: ['Mobile', 'Confirm', 'OTP'] });
            document.getElementById('student-step-1')?.classList.remove('hidden');
            showLoginMessage('');
            document.getElementById('student-login-phone')?.focus();
        });

        document.getElementById('btn-change-user')?.addEventListener('click', () => {
            verifiedUser = null;
            officialOtpState = { challengeId: '', phoneE164: '', maskedPhone: '', confirmationResult: null, cachedPassword: '', flowType: '' };
            stopOtpTimers();
            hideAllLoginPanels();
            setLoginStepState(1, { totalSteps: 3, labels: ['Account', 'Password', 'OTP'] });
            resetPasswordVisibility();
            document.getElementById('official-step-1')?.classList.remove('hidden');
            const submitBtn = document.getElementById('btn-login-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = SEND_OFFICIAL_OTP_BTN_HTML;
            }
            document.getElementById('login-username')?.focus();
            showLoginMessage('');
        });

        document.getElementById('btn-official-otp-back')?.addEventListener('click', () => {
            stopOtpTimers();
            officialOtpState.confirmationResult = null;
            officialOtpState.challengeId = '';
            hideAllLoginPanels();
            setLoginStepState(2, { totalSteps: 3, labels: ['Account', 'Password', 'OTP'] });
            document.getElementById('official-step-2')?.classList.remove('hidden');
            const submitBtn = document.getElementById('btn-login-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = SEND_OFFICIAL_OTP_BTN_HTML;
            }
            showLoginMessage('');
            document.getElementById('login-password')?.focus();
        });

        const normalizeAdmKey = (value = '') => String(value || '').trim().toLowerCase().replace(/[\\/\s]+/g, '_');

        const ensureVerificationRegistriesLoaded = async () => {
            const fetches = [];
            if (!loaded.config) {
                fetches.push(
                    getDoc(doc(db, `${BASE_PATH}/settings`, 'config'))
                        .then((snap) => {
                            if (snap.exists()) globalInstitutionConfig = snap.data() || {};
                            loaded.config = true;
                        })
                        .catch(() => {})
                );
            }
            if (!loaded.staff) {
                fetches.push(
                    getDocs(collection(db, `${BASE_PATH}/staff`))
                        .then((snap) => {
                            allStaffSnapshotRecords = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                            cachedActiveStaff = allStaffSnapshotRecords.filter((s) => s.isActive !== false);
                            staffSnapshotFromServer = !snap.metadata?.fromCache;
                            loaded.staff = true;
                        })
                        .catch(() => {})
                );
            }
            if (!loaded.dirEntries || !loaded.dirAuth || !loaded.pageAccess) {
                fetches.push(
                    Promise.all([
                        getDocs(collection(db, `${BASE_PATH}/publicDirectory`)).catch(() => null),
                        getDoc(doc(db, `${BASE_PATH}/settings`, 'categoryAuthConfig')).catch(() => null),
                        getDoc(doc(db, `${BASE_PATH}/settings`, 'pageAccess')).catch(() => null)
                    ]).then(([dirSnap, authSnap, accessSnap]) => {
                        if (dirSnap) {
                            directoryEntries = dirSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                            dirEntriesFromServer = !dirSnap.metadata?.fromCache;
                            loaded.dirEntries = true;
                        }
                        if (authSnap?.exists?.()) {
                            categoryAuthConfig = { categories: {}, ...(authSnap.data() || {}) };
                            loaded.dirAuth = true;
                        }
                        if (accessSnap?.exists?.()) {
                            pageAccessConfig = { categories: {}, overrides: {}, ...(accessSnap.data() || {}) };
                            loaded.pageAccess = true;
                        }
                    })
                );
            }
            if (fetches.length > 0) await Promise.all(fetches);
        };

        const isRememberedAccountValid = async (account, { verifyStudentOnline = false } = {}) => {
            if (!account) return false;
            const role = account.role || (account.studentId ? 'student' : '');

            if (role === 'student') {
                if (!verifyStudentOnline) return true;
                const studentId = account.studentId || account.id;
                if (auth.currentUser && studentId) {
                    try {
                        const stuSnap = await getDoc(doc(db, `${BASE_PATH}/students`, studentId));
                        if (!stuSnap.metadata?.fromCache || stuSnap.exists()) {
                            if (!stuSnap.exists()) return false;
                            const st = stuSnap.data() || {};
                            const statusNorm = String(st.status || '').trim().toLowerCase();
                            if (st.isActive === false || statusNorm === 'inactive' || statusNorm === 'discontinued') return false;
                            return true;
                        }
                    } catch (_) {}
                }
                const cleanAdm = normalizeAdmKey(account.adm || '');
                if (cleanAdm) {
                    try {
                        const lookupSnap = await getDoc(doc(db, `${BASE_PATH}/studentAuthLookup`, `adm_${cleanAdm}`));
                        if (lookupSnap.exists()) {
                            const st = lookupSnap.data() || {};
                            const statusNorm = String(st.status || '').trim().toLowerCase();
                            if (st.isActive === false || statusNorm === 'inactive' || statusNorm === 'discontinued') return false;
                        }
                    } catch (_) {}
                }
                return true;
            }

            if (account.source === 'directory' || role === 'directory') {
                if (!loaded.dirEntries || !loaded.dirAuth || !loaded.pageAccess) return true;
                if (!dirEntriesFromServer && directoryEntries.length === 0) return true;
                const cleanLogin = String(account.loginId || account.email || '').trim().toLowerCase();
                const entry = (directoryEntries || []).find((e) =>
                    (account.entryId && e.id === account.entryId)
                    || (cleanLogin && String(e.authMeta?.username || '').trim().toLowerCase() === cleanLogin)
                );
                if (!entry) return false;
                const authConf = normalizeCategoryAuthItem(categoryAuthConfig?.categories?.[entry.categoryId] || {});
                if (!authConf.enabled) return false;
                if (pageAccessConfig?.overrides?.[entry.id]?.blocked === true) return false;
                return true;
            }

            if (role === 'staff') {
                if (!loaded.staff) return true;
                if (!staffSnapshotFromServer && allStaffSnapshotRecords.length === 0) return true;
                const cleanEmail = String(account.email || '').trim().toLowerCase();
                const cleanLogin = String(account.loginId || '').trim().toLowerCase();
                const matched = (allStaffSnapshotRecords || []).find((s) =>
                    (account.staffId && s.id === account.staffId)
                    || (cleanEmail && String(s.email || '').trim().toLowerCase() === cleanEmail)
                    || (cleanLogin && [s.username, s.userName, s.loginId].some((u) => String(u || '').trim().toLowerCase() === cleanLogin))
                );
                if (!matched || matched.isActive === false) return false;
                return true;
            }

            if (role === 'admin') {
                if (!loaded.config) return true;
                const adminProfile = globalInstitutionConfig?.adminProfile || {};
                const activeEmails = new Set();
                if (adminProfile.email) activeEmails.add(String(adminProfile.email).trim().toLowerCase());
                if (Array.isArray(adminProfile.admins)) {
                    adminProfile.admins.forEach((a) => {
                        if (a && a.isActive !== false && a.email) {
                            activeEmails.add(String(a.email).trim().toLowerCase());
                        }
                    });
                }
                const accEmail = String(account.email || '').trim().toLowerCase();
                if (activeEmails.size > 0 && accEmail && !activeEmails.has(accEmail)) {
                    return false;
                }
                return true;
            }

            return true;
        };

        const validateAndPruneRememberedAccounts = async ({ verifyStudentsOnline = false } = {}) => {
            const accounts = window.AppSession?.getRememberedAccounts?.() || [];
            if (!accounts.length) return [];
            if (latestTenantStatus?.exists && latestTenantStatus?.active === false) return accounts;
            if (verifyStudentsOnline && !auth.currentUser) {
                try { await signInAnonymously(auth); } catch (_) {}
            }
            const results = await Promise.all(
                accounts.map(async (account) => {
                    const ok = await isRememberedAccountValid(account, { verifyStudentOnline: verifyStudentsOnline });
                    return { account, ok };
                })
            );
            let removedAny = false;
            const validList = [];
            results.forEach(({ account, ok }) => {
                if (!ok) {
                    window.AppSession?.removeRememberedAccount?.(account.id || account.studentId);
                    removedAny = true;
                } else {
                    validList.push(account);
                }
            });
            if (removedAny) {
                const savedModal = document.getElementById('saved-student-modal');
                if (savedModal && savedModal.style.display === 'flex') {
                    renderSavedAccounts();
                }
            }
            return validList;
        };

        // =========================================================================
        // STUDENT MOBILE OTP FLOW
        // =========================================================================
        const checkStudentPortalAvailable = () => {
            if (isRootGatewayMode) return true;
            if (window.AppSession?.isCompanyPageAllowed?.('student') === false) {
                showLoginMessage('Student Portal is a Premium module (Premium - Upgrade).');
                openPremiumPlansModal({
                    contextType: 'module',
                    moduleKey: 'student',
                    moduleName: 'Student Portal',
                    institutionName: globalInstitutionConfig?.appName || ''
                });
                return false;
            }
            if (globalInstitutionConfig?.enabledModules?.student === false || window.AppSession?.isModuleEnabled('student') === false) {
                showLoginMessage('Student Portal is currently disabled by institution administration.');
                return false;
            }
            return true;
        };

        const handleStudentVerifyPhone = async () => {
            if (!checkStudentPortalAvailable()) return;

            const phoneInput = document.getElementById('student-login-phone');
            const countrySelect = document.getElementById('student-country-code');
            const rawPhone = String(phoneInput?.value || '').trim();
            const countryCode = String(countrySelect?.value || '+91').trim();
            const normalizedE164 = normalizePhoneToE164Client(rawPhone, countryCode);

            if (!normalizedE164) {
                showLoginMessage('Please enter a valid 10-digit mobile number.');
                phoneInput?.focus();
                return;
            }

            const btn = document.getElementById('btn-student-verify-phone');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Checking...</span>';
            }
            showLoginMessage('');

            try {
                const lookup = await lookupStudentsByPhone({
                    institutionId: isRootGatewayMode ? '' : INSTITUTION_ID,
                    phone: rawPhone,
                    countryCode
                });

                if (!lookup?.found || !Array.isArray(lookup.students) || !lookup.students.length) {
                    showLoginMessage('No active student record is registered with this mobile number. Please contact the school office.');
                    phoneInput?.focus();
                    return;
                }

                studentOtpState = {
                    rawPhone,
                    countryCode,
                    phoneE164: lookup.phoneE164 || normalizedE164,
                    maskedPhone: lookup.maskedPhone || normalizedE164,
                    previews: lookup.students,
                    confirmationResult: null,
                    verifiedStudents: []
                };

                const phoneEl = document.getElementById('student-preview-phone');
                const summaryEl = document.getElementById('student-preview-summary');
                const previewListEl = document.getElementById('student-preview-list');
                if (phoneEl) phoneEl.textContent = studentOtpState.maskedPhone;
                if (summaryEl) {
                    const cnt = lookup.students.length;
                    summaryEl.textContent = cnt === 1 ? '1 student linked' : `${cnt} students linked`;
                }
                if (previewListEl) {
                    previewListEl.innerHTML = lookup.students.map((item) => {
                        const displayName = item.fullName || item.name || item.maskedName || 'Student';
                        const displayClass = item.classLabel || 'Student';
                        const metaText = (isRootGatewayMode && item.institutionName)
                            ? `${displayClass} • ${item.institutionName}`
                            : displayClass;
                        return `
                        <div class="login-preview-item">
                            <span class="login-preview-icon" aria-hidden="true"><i class="fas fa-user-graduate"></i></span>
                            <div class="min-w-0">
                                <div class="login-preview-name">${escapeHtml(displayName)}</div>
                                <div class="login-preview-meta">${escapeHtml(metaText)}</div>
                            </div>
                        </div>`;
                    }).join('');
                }

                hideAllLoginPanels();
                setLoginStepState(2, { totalSteps: 3, labels: ['Mobile', 'Confirm', 'OTP'] });
                document.getElementById('student-step-2')?.classList.remove('hidden');
            } catch (err) {
                console.error('Student phone lookup error:', err);
                showLoginMessage(err?.message || 'Unable to verify mobile number. Please try again.');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = VERIFY_PHONE_BTN_HTML;
                }
            }
        };

        const sendStudentSmsOtp = async ({ isResend = false } = {}) => {
            if (!studentOtpState.phoneE164) {
                setLoginMode('student');
                return;
            }
            const sendBtn = document.getElementById('btn-student-send-otp');
            const resendBtn = document.getElementById('btn-student-resend-otp');
            const quotaBefore = getOtpQuotaStatus('student', studentOtpState.phoneE164);
            if (quotaBefore.locked) {
                const limitMsg = isResend
                    ? `Resend limit reached (${OTP_MAX_RESENDS}/${OTP_MAX_RESENDS} used). Please wait ${quotaBefore.waitMinutes} minute${quotaBefore.waitMinutes === 1 ? '' : 's'} before requesting a new OTP.`
                    : `Maximum OTP limit (${OTP_MAX_TOTAL_SENDS} OTPs per 15 minutes) reached for this mobile number. Please wait ${quotaBefore.waitMinutes} minute${quotaBefore.waitMinutes === 1 ? '' : 's'} and try again.`;
                showLoginMessage(limitMsg);
                if (isResend) {
                    startOtpResendTimer('student', 0, studentOtpState.phoneE164);
                }
                return;
            }

            if (!isResend && sendBtn) {
                sendBtn.disabled = true;
                sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Sending OTP...</span>';
            }
            if (isResend && resendBtn) {
                resendBtn.disabled = true;
                resendBtn.textContent = 'Sending...';
            }
            showLoginMessage('');

            try {
                const verifier = await ensureRecaptchaVerifier();
                const confirmationResult = await signInWithPhoneNumber(auth, studentOtpState.phoneE164, verifier);
                studentOtpState.confirmationResult = confirmationResult;
                recordOtpSendAttempt('student', studentOtpState.phoneE164);

                const otpPhoneMeta = document.getElementById('student-otp-phone-meta');
                if (otpPhoneMeta) otpPhoneMeta.textContent = `Code sent to ${studentOtpState.maskedPhone || studentOtpState.phoneE164}`;

                hideAllLoginPanels();
                setLoginStepState(3, { totalSteps: 3, labels: ['Mobile', 'Confirm', 'OTP'] });
                document.getElementById('student-step-3')?.classList.remove('hidden');

                const otpInput = document.getElementById('student-otp-input');
                if (otpInput) {
                    otpInput.value = '';
                    setTimeout(() => otpInput.focus(), 50);
                }
                startOtpResendTimer('student', 60, studentOtpState.phoneE164);
            } catch (err) {
                console.error('Student send OTP error:', err);
                resetRecaptchaVerifier();
                showLoginMessage(formatPhoneAuthError(err, 'Failed to send SMS OTP. Please try again.'));
                if (isResend && resendBtn) {
                    const quotaNow = getOtpQuotaStatus('student', studentOtpState.phoneE164);
                    resendBtn.disabled = quotaNow.locked;
                    resendBtn.textContent = quotaNow.locked
                        ? 'Limit Reached'
                        : `Resend OTP (${Math.min(OTP_MAX_RESENDS, quotaNow.remainingSends)} left)`;
                }
            } finally {
                if (!isResend && sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = SEND_STUDENT_OTP_BTN_HTML;
                }
                if (isResend && resendBtn && !otpResendTimers.student) {
                    const quotaNow = getOtpQuotaStatus('student', studentOtpState.phoneE164);
                    resendBtn.disabled = quotaNow.locked;
                    resendBtn.textContent = quotaNow.locked
                        ? 'Limit Reached'
                        : `Resend OTP (${Math.min(OTP_MAX_RESENDS, quotaNow.remainingSends)} left)`;
                }
            }
        };

        const finalizeStudentSessionSelection = async (selectedStudent, allVerifiedStudents = []) => {
            if (!selectedStudent?.studentId) return;
            const list = Array.isArray(allVerifiedStudents) && allVerifiedStudents.length
                ? allVerifiedStudents
                : [selectedStudent];
            const targetInstId = String(selectedStudent.institutionId || INSTITUTION_ID || '').trim().toLowerCase();
            const sameInstList = list.filter((st) => {
                const stInst = String(st?.institutionId || targetInstId).trim().toLowerCase();
                return !targetInstId || stInst === targetInstId;
            });

            if (!isAddingStudentAccountFlow && !window.AppSession?.hasStudentSession?.()) {
                await window.AppSession?.clearAll?.({ clearRemembered: false });
            }

            // Register all linked siblings verified under this phone number for the target institution
            sameInstList.forEach((st) => {
                if (!st?.studentId) return;
                window.AppSession?.registerStudentAccount?.(st.studentId, {
                    institutionId: targetInstId,
                    name: st.name || '',
                    class: st.class || '',
                    adm: st.adm || ''
                }, { append: true, institutionId: targetInstId });
            });

            window.AppSession?.startStudent?.(selectedStudent.studentId, {
                institutionId: targetInstId,
                name: selectedStudent.name || '',
                class: selectedStudent.class || '',
                adm: selectedStudent.adm || ''
            }, targetInstId);

            await Promise.race([
                syncStudentGroupMembersToSession(selectedStudent.studentId, { clearDismissed: true, institutionId: targetInstId }),
                new Promise((resolve) => setTimeout(resolve, 1500))
            ]);
            window.location.href = (targetInstId && window.AppSession?.buildPageUrl)
                ? window.AppSession.buildPageUrl('student.html', targetInstId)
                : getPageUrl('student.html');
        };

        const handleStudentVerifyOtp = async () => {
            const otpInput = document.getElementById('student-otp-input');
            const code = String(otpInput?.value || '').replace(/\D/g, '').trim();
            if (code.length !== 6) {
                showLoginMessage('Please enter the 6-digit OTP sent to your mobile.');
                otpInput?.focus();
                return;
            }
            if (!studentOtpState.confirmationResult) {
                showLoginMessage('OTP session expired. Please request a new OTP.');
                return;
            }

            const btn = document.getElementById('btn-student-verify-otp');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Verifying OTP...</span>';
            }
            showLoginMessage('');

            try {
                const phoneCred = await studentOtpState.confirmationResult.confirm(code);
                const phoneIdToken = await phoneCred.user.getIdToken(true);
                const completeRes = await completeStudentOtpLogin({
                    institutionId: isRootGatewayMode ? '' : INSTITUTION_ID,
                    phoneIdToken
                });

                const students = Array.isArray(completeRes?.students) ? completeRes.students : [];
                if (!students.length) {
                    showLoginMessage('No active student profile is linked to this mobile number.');
                    return;
                }

                stopOtpTimers();
                studentOtpState.verifiedStudents = students;

                if (students.length === 1) {
                    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Loading Dashboard...</span>';
                    await finalizeStudentSessionSelection(students[0], students);
                    return;
                }

                // Multiple siblings linked to this mobile -> display selection list
                const uniqueInstCount = new Set(students.map((st) => String(st.institutionId || '').trim().toLowerCase()).filter(Boolean)).size;
                const showInstitutionLabel = isRootGatewayMode || uniqueInstCount > 1;
                const verifiedListEl = document.getElementById('student-verified-list');
                if (verifiedListEl) {
                    verifiedListEl.innerHTML = students.map((st, idx) => {
                        const baseMeta = `Class ${st.class || '-'} • Adm: ${st.adm || '-'}`;
                        const metaLine = (showInstitutionLabel && st.institutionName)
                            ? `${baseMeta} • ${st.institutionName}`
                            : baseMeta;
                        return `
                        <button type="button" class="login-sibling-btn" data-verified-student-index="${idx}">
                            <span class="login-preview-avatar" aria-hidden="true"><i class="fas fa-user-graduate"></i></span>
                            <span class="login-sibling-info">
                                <span class="login-sibling-name">${escapeHtml(st.name || 'Student')}</span>
                                <span class="login-sibling-meta">${escapeHtml(metaLine)}</span>
                            </span>
                            <i class="fas fa-chevron-right login-sibling-chevron" aria-hidden="true"></i>
                        </button>`;
                    }).join('');
                }

                hideAllLoginPanels();
                setLoginStepState(4, { totalSteps: 3, labels: ['Mobile', 'Confirm', 'OTP'] });
                document.getElementById('student-step-select')?.classList.remove('hidden');
            } catch (err) {
                console.error('Student OTP confirm error:', err);
                showLoginMessage(formatPhoneAuthError(err, 'OTP verification failed. Please check the code and try again.'));
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = VERIFY_OTP_BTN_HTML;
                }
            }
        };

        document.getElementById('student-verified-list')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-verified-student-index]');
            if (!btn) return;
            const idx = Number(btn.dataset.verifiedStudentIndex);
            const selected = studentOtpState.verifiedStudents?.[idx];
            if (!selected) return;
            btn.disabled = true;
            btn.style.opacity = '0.7';
            await finalizeStudentSessionSelection(selected, studentOtpState.verifiedStudents);
        });

        // =========================================================================
        // OFFICIAL (ADMIN / STAFF / DIRECTORY / COMPANY OWNER) 2FA FLOW
        // =========================================================================
        const verifyUniversalIdentifier = async () => {
            const userInput = document.getElementById('login-username');
            const rawInput = (userInput?.value || '').trim();
            if (!rawInput) {
                showLoginMessage('Please enter your username.');
                userInput?.focus();
                return;
            }

            const btn = document.getElementById('btn-verify-user');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Verifying...</span>';
            }
            showLoginMessage('');

            try {
                if (!isRootGatewayMode) {
                    await ensureVerificationRegistriesLoaded();
                }

                const cleanLower = rawInput.toLowerCase();
                const cleanAdm = normalizeAdmKey(rawInput);

                let matched = null;
                let customLookupError = null;

                // 1. Server-side Custom Username Verification (Super Admin & Staff across all institutions)
                if (!/\s/.test(rawInput) && rawInput.length >= 3 && rawInput.length <= 60) {
                    try {
                        const lookupRes = await verifyLoginIdentifier({
                            username: rawInput,
                            institutionId: isRootGatewayMode ? '' : INSTITUTION_ID
                        });
                        if (lookupRes?.found) {
                            if (lookupRes.isActive === false) {
                                showLoginMessage('This account is currently inactive. Please contact your administrator.');
                                return;
                            }
                            if (lookupRes.institutionActive === false || (lookupRes.institutionStatus && lookupRes.institutionStatus !== 'active')) {
                                showLoginMessage('This institution portal is currently paused or inactive.');
                                return;
                            }
                            if (lookupRes.institutionExpired === true) {
                                showLoginMessage('This institution subscription has expired. Please contact support.');
                                return;
                            }
                            if (lookupRes.accountType === 'directory' || lookupRes.role === 'directory') {
                                const roleLabel = String(lookupRes.roleTitle || 'Category User').trim();
                                matched = {
                                    type: 'directory',
                                    role: 'directory',
                                    data: {
                                        id: lookupRes.entryId || '',
                                        categoryId: lookupRes.categoryId || ''
                                    },
                                    displayName: lookupRes.displayName || lookupRes.displayUsername || rawInput,
                                    meta: lookupRes.institutionName ? `${roleLabel} • ${lookupRes.institutionName}` : roleLabel,
                                    loginId: String(lookupRes.username || rawInput).toLowerCase().trim(),
                                    targetInstitutionId: String(lookupRes.institutionId || INSTITUTION_ID || '').trim().toLowerCase(),
                                    hasPhone: Boolean(lookupRes.hasPhone),
                                    maskedPhone: String(lookupRes.maskedPhone || '').trim()
                                };
                            } else {
                                const isSuper = lookupRes.role === 'super_admin';
                                matched = {
                                    type: 'custom_auth',
                                    role: lookupRes.role || 'staff',
                                    data: lookupRes,
                                    displayName: lookupRes.displayName || lookupRes.displayUsername || rawInput,
                                    meta: lookupRes.institutionName
                                        ? `${isSuper ? 'Super Admin' : 'Staff Member'} • ${lookupRes.institutionName}`
                                        : (isSuper ? 'Super Admin' : 'Staff Member'),
                                    loginId: lookupRes.displayUsername || lookupRes.username || rawInput,
                                    targetInstitutionId: String(lookupRes.institutionId || INSTITUTION_ID || '').trim().toLowerCase(),
                                    hasPhone: Boolean(lookupRes.hasPhone),
                                    maskedPhone: String(lookupRes.maskedPhone || '').trim()
                                };
                            }
                        }
                    } catch (fnErr) {
                        customLookupError = fnErr;
                        console.warn('Custom username lookup notice:', fnErr?.message || fnErr);
                    }
                }

                // 2. Root Platform Gateway: Silent owner email verification path
                if (!matched && isRootGatewayMode) {
                    if (cleanLower.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanLower)) {
                        matched = {
                            type: 'company_owner',
                            data: null,
                            displayName: cleanLower.split('@')[0] || 'Account',
                            meta: 'Official Account',
                            loginEmail: cleanLower,
                            loginId: cleanLower
                        };
                    } else if (customLookupError) {
                        showLoginMessage(customLookupError.message || 'Unable to reach authentication service.');
                        return;
                    } else {
                        showLoginMessage(`Account "${rawInput}" not found. Please check your username and try again.`);
                        userInput?.focus();
                        return;
                    }
                }

                // 3. Tenant Portal: Directory / Management Login Verification
                if (!matched && !isRootGatewayMode) {
                    const dirMatch = (Array.isArray(directoryEntries) ? directoryEntries : []).find((e) => {
                        if (!e?.categoryId) return false;
                        const authConf = normalizeCategoryAuthItem(categoryAuthConfig?.categories?.[e.categoryId] || {});
                        if (!authConf.enabled) return false;
                        if (pageAccessConfig?.overrides?.[e.id]?.blocked === true) return false;
                        const usernameField = String(categoryAuthConfig?.categories?.[e.categoryId]?.usernameField || '').trim();
                        const configuredUsername = usernameField ? String(e?.values?.[usernameField] || '').toLowerCase().trim() : '';
                        const authUsername = String(e?.authMeta?.username || '').toLowerCase().trim();
                        return [authUsername, configuredUsername]
                            .filter(Boolean)
                            .some((u) => u === cleanLower || normalizeAdmKey(u) === cleanAdm);
                    });
                    if (dirMatch) {
                        const displayName = dirMatch.name || dirMatch.values?.name || dirMatch.values?.Name || String(dirMatch.authMeta?.usernameRaw || 'Category User');
                        const resolvedUsername = String(dirMatch.authMeta?.username || cleanLower).toLowerCase().trim();
                        const rawDirPhone = dirMatch.phone || dirMatch.values?.phone || dirMatch.values?.Phone || dirMatch.values?.mobile || dirMatch.values?.Mobile || dirMatch.values?.contact || '';
                        const dirPhoneE164 = normalizePhoneToE164Client(rawDirPhone);
                        const dirMaskedPhone = dirPhoneE164
                            ? `${dirPhoneE164.slice(0, 3)} ${'*'.repeat(Math.max(4, dirPhoneE164.length - 7))}${dirPhoneE164.slice(-4)}`
                            : '';
                        matched = {
                            type: 'directory',
                            data: dirMatch,
                            displayName,
                            meta: dirMatch.role || dirMatch.values?.role || 'Category User',
                            loginId: resolvedUsername,
                            hasPhone: Boolean(dirPhoneE164),
                            maskedPhone: dirMaskedPhone
                        };
                    }
                }

                // 4. Tenant Portal: Silent owner email path (works identically from any institution's Official login)
                if (!matched && !isRootGatewayMode && cleanLower.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanLower)) {
                    matched = {
                        type: 'company_owner',
                        data: null,
                        displayName: cleanLower.split('@')[0] || 'Account',
                        meta: 'Official Account',
                        loginEmail: cleanLower,
                        loginId: cleanLower
                    };
                }

                if (matched) {
                    verifiedUser = matched;
                    const nameEl = document.getElementById('verified-user-name');
                    const metaEl = document.getElementById('verified-user-meta');
                    const phoneMetaEl = document.getElementById('verified-user-phone-meta');
                    const avatarIcon = document.getElementById('verified-user-avatar-icon');
                    const passInput = document.getElementById('login-password');
                    const passHint = document.getElementById('login-password-hint');
                    const submitBtn = document.getElementById('btn-login-submit');

                    if (nameEl) nameEl.textContent = matched.displayName;
                    if (metaEl) metaEl.textContent = matched.meta;
                    resetPasswordVisibility();

                    const isCompanyOwner = matched.type === 'company_owner';
                    const isShield = isCompanyOwner || (matched.type === 'custom_auth' && matched.role === 'super_admin');
                    if (avatarIcon) avatarIcon.className = isShield ? 'fas fa-user-shield' : 'fas fa-user-tie';

                    if (phoneMetaEl) {
                        if (isCompanyOwner) {
                            phoneMetaEl.classList.add('hidden');
                            phoneMetaEl.classList.remove('is-missing');
                            phoneMetaEl.textContent = '';
                        } else if (matched.hasPhone && matched.maskedPhone) {
                            phoneMetaEl.classList.remove('hidden', 'is-missing');
                            phoneMetaEl.innerHTML = `<i class="fas fa-mobile-screen-button" aria-hidden="true"></i><span>OTP mobile: ${escapeHtml(matched.maskedPhone)}</span>`;
                        } else {
                            phoneMetaEl.classList.remove('hidden');
                            phoneMetaEl.classList.add('is-missing');
                            phoneMetaEl.innerHTML = '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i><span>No OTP mobile number registered</span>';
                        }
                    }

                    if (passHint) {
                        passHint.textContent = 'After verifying your password, an SMS OTP will be sent to your registered mobile.';
                    }
                    const officialNoticeEl = document.getElementById('official-otp-session-notice');
                    if (officialNoticeEl) {
                        officialNoticeEl.classList.remove('hidden');
                    }
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = SEND_OFFICIAL_OTP_BTN_HTML;
                    }

                    hideAllLoginPanels();
                    setLoginStepState(2, {
                        totalSteps: 3,
                        labels: ['Account', 'Password', 'OTP']
                    });
                    document.getElementById('official-step-2')?.classList.remove('hidden');
                    if (passInput) {
                        passInput.value = '';
                        passInput.focus();
                    }
                } else {
                    if (customLookupError) {
                        showLoginMessage(customLookupError.message || 'Unable to verify username.');
                    } else {
                        showLoginMessage(`Official account "${rawInput}" not found. Students should switch to the Student tab.`);
                    }
                    userInput?.focus();
                }
            } catch (err) {
                console.error('Official verification error:', err);
                showLoginMessage('Verification error: ' + err.message);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = VERIFY_BTN_HTML;
                }
            }
        };

        const dispatchOfficialSmsOtp = async ({ isResend = false } = {}) => {
            if (!officialOtpState.phoneE164) {
                showLoginMessage('OTP verification session expired. Please verify your password again.');
                return;
            }
            const resendBtn = document.getElementById('btn-official-resend-otp');
            const quotaBefore = getOtpQuotaStatus('official', officialOtpState.phoneE164);
            if (quotaBefore.locked) {
                const limitMsg = isResend
                    ? `Resend limit reached (${OTP_MAX_RESENDS}/${OTP_MAX_RESENDS} used). Please wait ${quotaBefore.waitMinutes} minute${quotaBefore.waitMinutes === 1 ? '' : 's'} before requesting a new OTP.`
                    : `Maximum OTP limit (${OTP_MAX_TOTAL_SENDS} OTPs per 15 minutes) reached for this account. Please wait ${quotaBefore.waitMinutes} minute${quotaBefore.waitMinutes === 1 ? '' : 's'} and try again.`;
                showLoginMessage(limitMsg);
                if (isResend) {
                    startOtpResendTimer('official', 0, officialOtpState.phoneE164);
                }
                return;
            }

            if (isResend && resendBtn) {
                resendBtn.disabled = true;
                resendBtn.textContent = 'Sending...';
            }
            showLoginMessage('');

            try {
                // On resend, refresh the server-side challenge so the 5-minute TTL resets cleanly
                if (isResend && verifiedUser) {
                    if (officialOtpState.flowType === 'company_owner') {
                        const refreshed = await initiateCompanyOwnerOtp();
                        if (refreshed?.challengeId) {
                            officialOtpState.challengeId = refreshed.challengeId;
                            officialOtpState.phoneE164 = refreshed.phoneE164 || officialOtpState.phoneE164;
                            officialOtpState.maskedPhone = refreshed.maskedPhone || officialOtpState.maskedPhone;
                        }
                    } else if (officialOtpState.flowType === 'custom_auth' && officialOtpState.cachedPassword) {
                        const refreshed = await verifyOfficialPasswordForOtp({
                            username: verifiedUser.loginId,
                            password: officialOtpState.cachedPassword,
                            institutionId: isRootGatewayMode ? '' : INSTITUTION_ID
                        });
                        if (refreshed?.challengeId) {
                            officialOtpState.challengeId = refreshed.challengeId;
                            officialOtpState.phoneE164 = refreshed.phoneE164 || officialOtpState.phoneE164;
                            officialOtpState.maskedPhone = refreshed.maskedPhone || officialOtpState.maskedPhone;
                        }
                    } else if (officialOtpState.flowType === 'directory' && officialOtpState.cachedPassword) {
                        const refreshed = await verifyDirectoryPasswordForOtp({
                            institutionId: verifiedUser.targetInstitutionId || INSTITUTION_ID,
                            username: verifiedUser.loginId,
                            password: officialOtpState.cachedPassword
                        });
                        if (refreshed?.challengeId) {
                            officialOtpState.challengeId = refreshed.challengeId;
                            officialOtpState.phoneE164 = refreshed.phoneE164 || officialOtpState.phoneE164;
                            officialOtpState.maskedPhone = refreshed.maskedPhone || officialOtpState.maskedPhone;
                        }
                    }
                }

                // Company Owner OTP runs on a secondary Firebase Auth instance so the primary
                // email/password Company Owner session stays intact for Firestore & Storage rules.
                const otpAuthInstance = officialOtpState.flowType === 'company_owner' ? getCompanyOtpAuth() : auth;
                const verifier = await ensureRecaptchaVerifier(otpAuthInstance);
                const confirmationResult = await signInWithPhoneNumber(otpAuthInstance, officialOtpState.phoneE164, verifier);
                officialOtpState.confirmationResult = confirmationResult;
                recordOtpSendAttempt('official', officialOtpState.phoneE164);

                const otpNameEl = document.getElementById('official-otp-name');
                const otpPhoneEl = document.getElementById('official-otp-phone-meta');
                if (otpNameEl) otpNameEl.textContent = officialOtpState.ownerName || verifiedUser?.displayName || 'Two-Step Verification';
                if (otpPhoneEl) otpPhoneEl.textContent = `OTP sent to ${officialOtpState.maskedPhone || officialOtpState.phoneE164}`;

                hideAllLoginPanels();
                setLoginStepState(3, { totalSteps: 3, labels: ['Account', 'Password', 'OTP'] });
                document.getElementById('official-step-3')?.classList.remove('hidden');

                const otpInput = document.getElementById('official-otp-input');
                if (otpInput) {
                    otpInput.value = '';
                    setTimeout(() => otpInput.focus(), 50);
                }
                startOtpResendTimer('official', 60, officialOtpState.phoneE164);
            } catch (err) {
                console.error('Official SMS OTP error:', err);
                resetRecaptchaVerifier();
                showLoginMessage(formatPhoneAuthError(err, 'Failed to send SMS OTP. Please try again.'));
                if (isResend && resendBtn) {
                    const quotaNow = getOtpQuotaStatus('official', officialOtpState.phoneE164);
                    resendBtn.disabled = quotaNow.locked;
                    resendBtn.textContent = quotaNow.locked
                        ? 'Limit Reached'
                        : `Resend OTP (${Math.min(OTP_MAX_RESENDS, quotaNow.remainingSends)} left)`;
                }
                throw err;
            } finally {
                if (isResend && resendBtn && !otpResendTimers.official) {
                    const quotaNow = getOtpQuotaStatus('official', officialOtpState.phoneE164);
                    resendBtn.disabled = quotaNow.locked;
                    resendBtn.textContent = quotaNow.locked
                        ? 'Limit Reached'
                        : `Resend OTP (${Math.min(OTP_MAX_RESENDS, quotaNow.remainingSends)} left)`;
                }
            }
        };

        const handleUniversalLoginSubmit = async () => {
            if (!verifiedUser) {
                setLoginMode('official');
                return;
            }

            const passInput = document.getElementById('login-password');
            const enteredPassword = (passInput?.value || '').trim();
            if (!enteredPassword) {
                showLoginMessage('Please enter your password.');
                passInput?.focus();
                return;
            }

            const isCompanyOwner = verifiedUser.type === 'company_owner';
            const defaultBtnHtml = SEND_OFFICIAL_OTP_BTN_HTML;
            const btn = document.getElementById('btn-login-submit');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Verifying &amp; Sending OTP...</span>';
            }
            showLoginMessage('');

            try {
                if (!isRootGatewayMode && !isCompanyOwner && (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.())) {
                    showLoginMessage('An official account is already logged in. Please log out first.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = defaultBtnHtml;
                    }
                    return;
                }

                // A. Owner Account Login (Email/Password + Server-Verified 2-Step SMS OTP when otpPhone is configured)
                if (isCompanyOwner) {
                    await window.AppSession?.clearAll?.();
                    const loginEmail = String(verifiedUser.loginEmail || verifiedUser.loginId || '').trim().toLowerCase();
                    let userCred = null;
                    try {
                        userCred = await signInWithEmailAndPassword(auth, loginEmail, enteredPassword);
                    } catch (authErr) {
                        const code = String(authErr?.code || '').trim();
                        showLoginMessage(
                            code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
                                ? 'Invalid username or password. Please check your credentials and try again.'
                                : `Authentication failed: ${authErr?.message || 'Please check your credentials and try again.'}`
                        );
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = defaultBtnHtml;
                        }
                        return;
                    }

                    try {
                        const otpInit = await initiateCompanyOwnerOtp();
                        if (otpInit?.otpRequired && otpInit?.challengeId && otpInit?.phoneE164) {
                            officialOtpState = {
                                challengeId: otpInit.challengeId,
                                phoneE164: otpInit.phoneE164,
                                maskedPhone: otpInit.maskedPhone || otpInit.phoneE164,
                                confirmationResult: null,
                                cachedPassword: '',
                                flowType: 'company_owner',
                                ownerName: otpInit.ownerName || 'Administrator',
                                companyName: otpInit.companyName || 'Institution Manage',
                                email: otpInit.email || String(userCred?.user?.email || loginEmail).trim().toLowerCase()
                            };
                            await dispatchOfficialSmsOtp({ isResend: false });
                            return;
                        }

                        // Safe first-time bootstrap when otpPhone is not yet configured in company/config
                        if (otpInit?.ok) {
                            try { await userCred.user.getIdToken(true); } catch (_) {}
                            window.AppSession?.startCompany?.({
                                name: otpInit.ownerName || 'Administrator',
                                email: otpInit.email || String(userCred?.user?.email || loginEmail).trim().toLowerCase(),
                                companyName: otpInit.companyName || 'Institution Manage'
                            });
                            window.location.href = '/company';
                            return;
                        }
                    } catch (otpInitErr) {
                        // Graceful fallback ONLY if initiateCompanyOwnerOtp Cloud Function is not deployed yet
                        if (otpInitErr?.code === 'functions/not-found') {
                            const authedEmail = String(userCred?.user?.email || loginEmail).trim().toLowerCase();
                            let isOwner = false;
                            let companyName = 'Institution Manage';
                            let ownerName = 'Administrator';
                            try {
                                const companyRef = doc(db, COMPANY_COLLECTION, COMPANY_CONFIG_DOC_ID);
                                const companySnap = await getDocFromServer(companyRef).catch(() => getDoc(companyRef));
                                if (companySnap?.exists()) {
                                    const data = companySnap.data() || {};
                                    const primaryEmail = String(data.email || '').trim().toLowerCase();
                                    const indexMatch = data?.ownersIndex?.[authedEmail] === true;
                                    const ownersList = Array.isArray(data.owners) ? data.owners : [];
                                    const arrayMatch = ownersList.find((o) => String(o?.email || '').trim().toLowerCase() === authedEmail && o?.isActive !== false);
                                    const ownerEmailsArr = Array.isArray(data.ownerEmails) ? data.ownerEmails.map((e) => String(e || '').trim().toLowerCase()) : [];
                                    if (primaryEmail === authedEmail || indexMatch || Boolean(arrayMatch) || ownerEmailsArr.includes(authedEmail)) {
                                        isOwner = true;
                                        companyName = String(data.companyName || 'Institution Manage').trim();
                                        ownerName = String(arrayMatch?.name || data.name || data.ownerName || 'Administrator').trim();
                                    }
                                }
                            } catch (_) {}
                            if (isOwner) {
                                window.AppSession?.startCompany?.({ name: ownerName, email: authedEmail, companyName });
                                window.location.href = '/company';
                                return;
                            }
                        }

                        try { await signOut(auth); } catch (_) {}
                        showLoginMessage(otpInitErr?.message || 'Unable to verify account credentials.');
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = defaultBtnHtml;
                        }
                        return;
                    }

                    try { await signOut(auth); } catch (_) {}
                    showLoginMessage('This account is not authorized to sign in.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = defaultBtnHtml;
                    }
                    return;
                }

                // B. Directory User 2FA Step 1 (Server Password Verification -> SMS OTP)
                if (verifiedUser.type === 'directory') {
                    const dirInstId = String(verifiedUser.targetInstitutionId || INSTITUTION_ID || '').trim().toLowerCase();
                    const challenge = await verifyDirectoryPasswordForOtp({
                        institutionId: dirInstId,
                        username: verifiedUser.loginId,
                        password: enteredPassword
                    });
                    if (!challenge?.challengeId || !challenge?.phoneE164) {
                        throw new Error('Unable to initiate OTP verification for this directory account.');
                    }
                    officialOtpState = {
                        challengeId: challenge.challengeId,
                        phoneE164: challenge.phoneE164,
                        maskedPhone: challenge.maskedPhone || challenge.phoneE164,
                        confirmationResult: null,
                        cachedPassword: enteredPassword,
                        flowType: 'directory'
                    };
                    await dispatchOfficialSmsOtp({ isResend: false });
                    return;
                }

                // C. Custom Auth (Super Admin & Staff) 2FA Step 1 (Server Password Verification -> SMS OTP)
                if (verifiedUser.type === 'custom_auth') {
                    const challenge = await verifyOfficialPasswordForOtp({
                        username: verifiedUser.loginId,
                        password: enteredPassword,
                        institutionId: isRootGatewayMode ? '' : INSTITUTION_ID
                    });
                    if (!challenge?.challengeId || !challenge?.phoneE164) {
                        throw new Error('Unable to initiate OTP verification. Ensure a registered mobile number is saved on this account.');
                    }
                    officialOtpState = {
                        challengeId: challenge.challengeId,
                        phoneE164: challenge.phoneE164,
                        maskedPhone: challenge.maskedPhone || challenge.phoneE164,
                        confirmationResult: null,
                        cachedPassword: enteredPassword,
                        flowType: 'custom_auth'
                    };
                    await dispatchOfficialSmsOtp({ isResend: false });
                    return;
                }

                showLoginMessage('Unsupported login state. Please verify your username again.');
            } catch (err) {
                console.error('Official login step-2 error:', err);
                showLoginMessage(err?.message || 'Invalid username or password.');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = defaultBtnHtml;
                }
            }
        };

        const handleOfficialVerifyOtp = async () => {
            const otpInput = document.getElementById('official-otp-input');
            const code = String(otpInput?.value || '').replace(/\D/g, '').trim();
            if (code.length !== 6) {
                showLoginMessage('Please enter the 6-digit OTP sent to your registered mobile.');
                otpInput?.focus();
                return;
            }
            if (!officialOtpState.confirmationResult || !officialOtpState.challengeId) {
                showLoginMessage('OTP verification session expired. Please request a new OTP.');
                return;
            }

            const btn = document.getElementById('btn-official-verify-otp');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Verifying OTP...</span>';
            }
            showLoginMessage('');

            try {
                const phoneCred = await officialOtpState.confirmationResult.confirm(code);
                const phoneIdToken = await phoneCred.user.getIdToken(true);

                // Company Owner 2FA completion (keeps primary Email/Password Firebase Auth intact!)
                if (officialOtpState.flowType === 'company_owner') {
                    const completeRes = await completeCompanyOwnerOtpLogin({
                        challengeId: officialOtpState.challengeId,
                        phoneIdToken
                    });
                    // Cleanly sign out the temporary secondary phone verifier app
                    if (companyOtpAuthInstance) {
                        try { await signOut(companyOtpAuthInstance); } catch (_) {}
                    }
                    // Refresh primary Company Owner ID token so companyOwner claim is active
                    if (auth.currentUser) {
                        try { await auth.currentUser.getIdToken(true); } catch (_) {}
                    }
                    stopOtpTimers();
                    officialOtpState.cachedPassword = '';
                    officialOtpState.flowType = '';
                    await window.AppSession?.clearAll?.();
                    window.AppSession?.startCompany?.({
                        name: completeRes?.ownerName || officialOtpState.ownerName || 'Administrator',
                        email: completeRes?.email || officialOtpState.email || auth.currentUser?.email || '',
                        companyName: completeRes?.companyName || officialOtpState.companyName || 'Institution Manage'
                    });
                    window.location.href = '/company';
                    return;
                }

                // Clear prior client session right before finalizing official session
                await window.AppSession?.clearAll?.();

                // Directory User 2FA completion
                if (officialOtpState.flowType === 'directory') {
                    const completeRes = await completeDirectoryOtpLogin({
                        challengeId: officialOtpState.challengeId,
                        phoneIdToken
                    });
                    const profile = completeRes?.profile || {};
                    const effectiveDirInstId = String(profile.institutionId || verifiedUser?.targetInstitutionId || INSTITUTION_ID || '').trim().toLowerCase();
                    const userLogin = String(profile.username || verifiedUser?.loginId || '').toLowerCase().trim();
                    const rawName = String(profile.displayName || verifiedUser?.displayName || userLogin || 'User');
                    const dirRoleTitle = String(profile.roleTitle || verifiedUser?.meta || 'Category User');
                    const access = profile.access || {};
                    const dirAccess = {
                        ...access,
                        worksheet: true,
                        userKey: userLogin,
                        loginId: userLogin,
                        entryId: profile.entryId || verifiedUser?.data?.id || '',
                        categoryId: profile.categoryId || verifiedUser?.data?.categoryId || '',
                        name: rawName,
                        role: dirRoleTitle,
                        type: 'Category User',
                        source: 'directory',
                        requiresEmailAuth: false
                    };
                    stopOtpTimers();
                    officialOtpState.cachedPassword = '';
                    window.AppSession?.startStaff?.(rawName, userLogin, dirAccess, effectiveDirInstId);
                    const activeProject = window.AppSession?.getActiveProjectId?.() || '';
                    localStorage.setItem('official_portal_session_v1', JSON.stringify({
                        ...(activeProject ? { projectId: activeProject } : {}),
                        institutionId: effectiveDirInstId,
                        id: dirAccess.entryId,
                        name: rawName,
                        username: userLogin,
                        email: '',
                        phone: profile.phone || '',
                        role: dirRoleTitle,
                        type: 'Category User',
                        categoryId: dirAccess.categoryId,
                        canCollect: dirAccess.collection === true,
                        canAccessWorksheet: true,
                        source: 'directory',
                        access: dirAccess
                    }));
                    window.location.href = (effectiveDirInstId && window.AppSession?.buildPageUrl)
                        ? window.AppSession.buildPageUrl('official.html', effectiveDirInstId)
                        : getPageUrl('official.html');
                    return;
                }

                // Custom Auth (Super Admin & Staff) 2FA completion -> exchanges Phone Token for Official Custom Token
                const { userCred, profile } = await completeOfficialOtpLoginAndSignIn(auth, {
                    challengeId: officialOtpState.challengeId,
                    phoneIdToken
                });

                const effectiveInstId = String(profile.institutionId || verifiedUser?.targetInstitutionId || INSTITUTION_ID || '').trim().toLowerCase();
                if (!effectiveInstId) {
                    try { await signOut(auth); } catch (_) {}
                    showLoginMessage('Account is not linked to an active institution.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = VERIFY_OTP_BTN_HTML;
                    }
                    return;
                }

                const effectiveBasePath = `institutions/${effectiveInstId}`;
                const buildTargetUrl = (page = 'official.html') => (
                    window.AppSession?.buildPageUrl?.(page, effectiveInstId) || `/${effectiveInstId}/${page.replace(/\.html$/i, '')}`
                );
                const displayUser = String(profile.displayUsername || profile.username || verifiedUser?.loginId || '').trim();
                const normUser = String(profile.username || displayUser).trim().toLowerCase();

                stopOtpTimers();
                officialOtpState.cachedPassword = '';

                if (profile.role === 'super_admin') {
                    window.AppSession?.startAdmin?.({
                        name: profile.displayName || verifiedUser?.displayName || 'Super Admin',
                        email: displayUser,
                        institutionId: effectiveInstId
                    });
                    window.location.href = buildTargetUrl('official.html');
                    return;
                }

                // Staff custom auth session: read live permissions from institutions/{slug}/staffAccess/{uid}
                let activeCollector = { ...(profile.access || {}) };
                try {
                    const accessSnap = await getDoc(doc(db, `${effectiveBasePath}/staffAccess`, userCred.user.uid));
                    if (accessSnap.exists()) {
                        activeCollector = { ...activeCollector, ...accessSnap.data() };
                    }
                } catch (_) {}

                if (activeCollector.isActive === false) {
                    try { await signOut(auth); } catch (_) {}
                    showLoginMessage('Your staff account is currently inactive. Please contact your administrator.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = VERIFY_OTP_BTN_HTML;
                    }
                    return;
                }

                const dutyClasses = Array.isArray(activeCollector.dutyClasses) && activeCollector.dutyClasses.length
                    ? activeCollector.dutyClasses.filter(Boolean)
                    : [];
                const staffName = activeCollector.name || profile.displayName || verifiedUser?.displayName || displayUser;
                const staffId = profile.staffId || activeCollector.staffId || '';
                const staffAccess = {
                    uid: userCred.user.uid,
                    username: normUser,
                    displayUsername: displayUser,
                    collection: activeCollector.canCollect === true,
                    worksheet: activeCollector.canAccessWorksheet === true,
                    result: activeCollector.canManageResults === true,
                    attendance: activeCollector.canAccessAttendance === true,
                    academicPlan: activeCollector.canAccessAcademicPlan === true,
                    studentActivity: activeCollector.canAccessActivity === true,
                    classroomEvaluation: activeCollector.canAccessEvaluation === true,
                    evaluation: activeCollector.canAccessEvaluation === true,
                    admin: activeCollector.canAccessAdmin === true,
                    canAccessAdmin: activeCollector.canAccessAdmin === true,
                    actLikeSuperAdmin: activeCollector.actLikeSuperAdmin === true || activeCollector.canAccessAdmin === true,
                    dutyClasses,
                    staffId,
                    name: staffName,
                    phone: activeCollector.phone || '',
                    role: activeCollector.role || activeCollector.type || 'Staff',
                    type: activeCollector.type || 'Staff',
                    photo: activeCollector.photo || '',
                    source: 'staff',
                    userKey: normUser,
                    loginId: displayUser,
                    requiresEmailAuth: true
                };
                window.AppSession?.startStaff?.(staffName, displayUser, staffAccess, effectiveInstId);

                const activeProject = window.AppSession?.getActiveProjectId?.() || '';
                localStorage.setItem('official_portal_session_v1', JSON.stringify({
                    ...(activeProject ? { projectId: activeProject } : {}),
                    institutionId: effectiveInstId,
                    id: staffId,
                    uid: userCred.user.uid,
                    name: staffName,
                    username: displayUser,
                    email: displayUser,
                    phone: activeCollector.phone || '',
                    role: activeCollector.role || activeCollector.type || 'Staff',
                    type: activeCollector.type || 'Staff',
                    photo: activeCollector.photo || '',
                    dutyClasses,
                    canAccessAdmin: staffAccess.canAccessAdmin,
                    actLikeSuperAdmin: staffAccess.actLikeSuperAdmin,
                    canCollect: staffAccess.collection,
                    canAccessWorksheet: staffAccess.worksheet,
                    canManageResults: staffAccess.result,
                    canAccessAttendance: staffAccess.attendance,
                    canAccessAcademicPlan: staffAccess.academicPlan,
                    canAccessActivity: staffAccess.studentActivity,
                    canAccessEvaluation: staffAccess.evaluation,
                    source: 'staff',
                    access: staffAccess
                }));
                window.location.href = buildTargetUrl('official.html');
            } catch (err) {
                console.error('Official OTP verify error:', err);
                showLoginMessage(formatPhoneAuthError(err, 'OTP verification failed. Please check the code and try again.'));
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = VERIFY_OTP_BTN_HTML;
                }
            }
        };

        // Wire Student OTP listeners
        document.getElementById('btn-student-verify-phone')?.addEventListener('click', handleStudentVerifyPhone);
        document.getElementById('student-login-phone')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleStudentVerifyPhone();
            }
        });
        document.getElementById('student-login-phone')?.addEventListener('input', (e) => {
            const clean = e.target.value.replace(/[^\d+\-\s()]/g, '').slice(0, 15);
            if (e.target.value !== clean) e.target.value = clean;
        });
        document.getElementById('btn-student-send-otp')?.addEventListener('click', () => sendStudentSmsOtp({ isResend: false }));
        document.getElementById('btn-student-resend-otp')?.addEventListener('click', () => sendStudentSmsOtp({ isResend: true }));
        document.getElementById('btn-student-verify-otp')?.addEventListener('click', handleStudentVerifyOtp);
        document.getElementById('student-otp-input')?.addEventListener('input', (e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
            if (e.target.value !== digits) e.target.value = digits;
        });
        document.getElementById('student-otp-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleStudentVerifyOtp();
            }
        });

        // Wire Official 2FA listeners
        document.getElementById('btn-verify-user')?.addEventListener('click', verifyUniversalIdentifier);
        document.getElementById('login-username')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                verifyUniversalIdentifier();
            }
        });
        document.getElementById('btn-login-submit')?.addEventListener('click', handleUniversalLoginSubmit);
        document.getElementById('login-password')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleUniversalLoginSubmit();
            }
        });
        document.getElementById('btn-official-resend-otp')?.addEventListener('click', () => {
            dispatchOfficialSmsOtp({ isResend: true }).catch(() => {});
        });
        document.getElementById('btn-official-verify-otp')?.addEventListener('click', handleOfficialVerifyOtp);
        document.getElementById('official-otp-input')?.addEventListener('input', (e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
            if (e.target.value !== digits) e.target.value = digits;
        });
        document.getElementById('official-otp-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleOfficialVerifyOtp();
            }
        });

        document.getElementById('login-username')?.addEventListener('input', (e) => {
            if (e.target.value.length > 100) e.target.value = e.target.value.slice(0, 100);
        });
        document.getElementById('login-password')?.addEventListener('input', (e) => {
            if (e.target.value.length > 60) e.target.value = e.target.value.slice(0, 60);
        });

        const sessionNotice = window.AppSession?.consumeFlash?.();
        if (sessionNotice) {
            window.openLogin();
            showLoginMessage(sessionNotice);
        }
        const urlSearchParams = new URLSearchParams(window.location.search);
        if (urlSearchParams.get('addStudent') === '1') {
            if (window.AppSession?.hasCompanySession?.()) {
                window.location.href = '/company';
            } else if (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.()) {
                window.location.href = getPageUrl('official.html');
            } else {
                history.replaceState(null, '', window.location.pathname);
                openStudentLoginModal({ mode: 'student', addStudent: true });
            }
        } else if (urlSearchParams.get('login') === 'official') {
            if (window.AppSession?.hasCompanySession?.()) {
                window.location.href = '/company';
            } else if (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.()) {
                window.location.href = getPageUrl('official.html');
            } else {
                history.replaceState(null, '', window.location.pathname);
                openStudentLoginModal({ mode: 'official' });
            }
        }

        init();
