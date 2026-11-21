import { onAuthStateChanged, signInWithEmailAndPassword, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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
    hardenExternalLinks,
    mountUnifiedFooter,
    normalizePhone,
    openPremiumPlansModal,
    renderVersionInfo,
    sanitizePhone,
    sanitizeUrl,
    syncDynamicPwaBranding
} from '../shared/app-common.js';
import {
    initPwaPromptListener,
    registerInstallTrigger,
    showDeviceInstallGuide
} from '../shared/pwa-install.js';
import {
    verifyLoginIdentifier,
    signInWithCustomUsernameAndPassword
} from '../shared/custom-auth-service.js';

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
        const openStudentLoginModal = () => {
            if (window.AppSession?.hasCompanySession?.()) {
                window.location.href = '/company';
                return;
            }
            if (!isRootGatewayMode && (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.())) {
                window.location.href = getPageUrl('official.html');
                return;
            }
            document.getElementById('login-modal').style.display = 'flex'; 
            setMobileMenuState(false);
            resetUniversalLoginForm();
            const sessionNotice = window.AppSession?.consumeFlash?.();
            if (sessionNotice) showLoginMessage(sessionNotice);
            // Warm up verification registries in background while user types
            ensureVerificationRegistriesLoaded().catch(() => {});
        };
        const syncStudentGroupMembersToSession = async (studentId = '', { clearDismissed = false } = {}) => {
            const cleanStudentId = String(studentId || '').trim();
            if (!cleanStudentId) return;
            if (clearDismissed) {
                window.AppSession?.clearDismissedGroupStudents?.();
            }
            try {
                if (!auth.currentUser) {
                    try { await signInAnonymously(auth); } catch (_) {}
                }
                if (!auth.currentUser) return;

                const groupSnap = await getDocs(
                    query(collection(db, `${BASE_PATH}/studentGroups`), where('memberIds', 'array-contains', cleanStudentId))
                );
                if (!groupSnap || groupSnap.empty) return;

                const matchingGroups = groupSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                const primaryGroup = matchingGroups[0];
                const primaryGroupId = String(primaryGroup?.id || '');
                const primaryGroupName = String(primaryGroup?.name || '').trim();

                window.AppSession?.registerStudentAccount?.(cleanStudentId, {
                    groupId: primaryGroupId,
                    groupName: primaryGroupName
                }, { keepOrder: true });

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
                    siblingIds.map((sibId) => getDoc(doc(db, `${BASE_PATH}/students`, sibId)).catch(() => null))
                );

                siblingSnaps.forEach((snap, idx) => {
                    if (!snap?.exists?.()) return;
                    const sibData = snap.data() || {};
                    const statusNorm = String(sibData.status || '').trim().toLowerCase();
                    if (sibData.isActive === false || statusNorm === 'inactive' || statusNorm === 'discontinued') return;
                    const sibId = siblingIds[idx];
                    const grpMeta = siblingGroupMap.get(sibId) || {};
                    window.AppSession?.registerStudentAccount?.(sibId, {
                        name: sibData.name || '',
                        class: sibData.class || '',
                        adm: sibData.adm || '',
                        groupId: grpMeta.groupId || '',
                        groupName: grpMeta.groupName || ''
                    }, { append: true });
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
                if (isRootGatewayMode && window.AppSession?.hasCompanySession?.()) {
                    window.location.href = '/company';
                    return;
                }

                const params = new URLSearchParams(window.location.search);
                const forceAdd = params.get('addStudent') === '1' || params.get('login') === 'new';

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
            document.getElementById('modal-img').src = (img && img.startsWith('data:')) ? img : (sanitizeUrl(img) || 'https://via.placeholder.com/150?text=User');
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
            openStudentLoginModal();
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
                        const photoValue = (rawPhoto && rawPhoto.startsWith('data:')) ? rawPhoto : (sanitizeUrl(rawPhoto) || 'https://via.placeholder.com/150?text=User');
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
                            slugBtn.innerHTML = '<span>Open Portal</span><i class="fas fa-arrow-up-right-from-square text-xs"></i>';
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

            const filterButtons = Array.from(document.querySelectorAll('[data-module-filter]'));
            const moduleCards = Array.from(document.querySelectorAll('#gateway-modules-grid [data-module-category]'));
            filterButtons.forEach((btn) => {
                if (btn.dataset.boundFilter) return;
                btn.dataset.boundFilter = 'true';
                btn.addEventListener('click', () => {
                    const selected = btn.getAttribute('data-module-filter') || 'all';
                    filterButtons.forEach((b) => {
                        const isActive = (b.getAttribute('data-module-filter') || 'all') === selected;
                        b.className = isActive
                            ? 'px-3.5 py-2 text-xs font-bold rounded-lg bg-white text-slate-900 shadow-2xs transition-colors cursor-pointer whitespace-nowrap shrink-0'
                            : 'px-3.5 py-2 text-xs font-bold rounded-lg text-slate-600 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap shrink-0';
                    });
                    moduleCards.forEach((card) => {
                        const cat = card.getAttribute('data-module-category') || '';
                        const visible = selected === 'all' || cat === selected;
                        card.classList.toggle('hidden', !visible);
                    });
                });
            });

            const demoTabButtons = Array.from(document.querySelectorAll('[data-demo-tab]'));
            const demoPanels = Array.from(document.querySelectorAll('[data-demo-panel]'));
            const tabScroller = document.getElementById('demo-tablist-scroller');
            const tabScrollLeftBtn = document.getElementById('demo-tabs-scroll-left');
            const tabScrollRightBtn = document.getElementById('demo-tabs-scroll-right');

            let activeDemoTabKey = demoTabButtons[0]?.getAttribute('data-demo-tab') || 'public';
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

            // Full-screen Showcase Lightbox state & controls
            let lightboxState = { pageKey: '', images: [], index: 0 };
            const lightboxModal = document.getElementById('showcase-lightbox-modal');
            const lightboxImg = document.getElementById('showcase-lightbox-img');
            const lightboxTitle = document.getElementById('showcase-lightbox-title');
            const lightboxMeta = document.getElementById('showcase-lightbox-meta');
            const lightboxPrevBtn = document.getElementById('showcase-lightbox-prev');
            const lightboxNextBtn = document.getElementById('showcase-lightbox-next');
            const lightboxCaptionBar = document.getElementById('showcase-lightbox-caption-bar');
            const lightboxStage = document.getElementById('showcase-lightbox-stage');
            let lightboxTouchStartX = 0;
            let lightboxTouchStartY = 0;

            const renderLightboxSlide = () => {
                const { pageKey, images, index } = lightboxState;
                if (!images.length || !lightboxImg) return;
                const safeIdx = ((index % images.length) + images.length) % images.length;
                lightboxState.index = safeIdx;
                const shot = images[safeIdx];
                const moduleLabel = showcaseLabelByKey.get(pageKey) || 'Platform Preview';

                lightboxImg.src = shot.url;
                lightboxImg.alt = `${moduleLabel} screenshot ${safeIdx + 1}`;
                if (lightboxTitle) lightboxTitle.textContent = moduleLabel;
                if (lightboxMeta) {
                    lightboxMeta.textContent = images.length > 1
                        ? `Screenshot ${safeIdx + 1} / ${images.length}`
                        : 'Full-size screenshot preview';
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
                const captionEl = wrapper.querySelector('[data-carousel-caption]');
                const dots = wrapper.querySelectorAll('[data-carousel-dot]');

                if (track) {
                    track.style.transform = `translate3d(-${safeIdx * 100}%, 0, 0)`;
                }
                if (counter) {
                    counter.textContent = `${safeIdx + 1} / ${images.length}`;
                }
                if (captionEl) {
                    const cap = String(images[safeIdx]?.caption || '').trim();
                    captionEl.textContent = cap || `${showcaseLabelByKey.get(pageKey) || 'Platform'} · View ${safeIdx + 1}`;
                }
                dots.forEach((dot, idx) => {
                    const isActive = idx === safeIdx;
                    dot.setAttribute('aria-current', isActive ? 'true' : 'false');
                    dot.className = isActive
                        ? 'h-2 w-6 rounded-full bg-blue-600 transition-all cursor-pointer'
                        : 'h-2 w-2 rounded-full bg-slate-300 hover:bg-slate-400 transition-all cursor-pointer';
                });
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
                    const shot = images[0];
                    mediaEl.innerHTML = `
                        <div class="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
                            <div class="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(moduleLabel)}</span>
                                    <span class="text-[11px] font-semibold text-slate-400 hidden sm:inline">· Live Screen</span>
                                </div>
                                <button type="button" data-showcase-zoom="0" class="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap transition">
                                    <i class="fas fa-expand text-[10px]" aria-hidden="true"></i>
                                    <span>Zoom</span>
                                </button>
                            </div>
                            <button type="button" data-showcase-zoom="0" class="block w-full aspect-[16/10] bg-slate-100 overflow-hidden cursor-zoom-in relative group" aria-label="Open full-size screenshot for ${escapeHtml(moduleLabel)}">
                                <img src="${escapeHtml(shot.url)}" alt="${escapeHtml(moduleLabel)} platform screenshot" class="w-full h-full object-contain transition-transform duration-200 group-hover:scale-[1.01]" referrerpolicy="no-referrer" loading="lazy">
                            </button>
                            ${shot.caption ? `<div class="px-4 py-2 bg-white border-t border-slate-200 text-[11px] font-semibold text-slate-600 truncate">${escapeHtml(shot.caption)}</div>` : ''}
                        </div>
                    `;
                    mediaEl.querySelectorAll('[data-showcase-zoom]').forEach((btn) => {
                        btn.addEventListener('click', () => openShowcaseLightbox(pageKey, 0));
                    });
                    const imgEl = mediaEl.querySelector('img');
                    imgEl?.addEventListener('error', () => {
                        fallbackEl.classList.remove('hidden');
                        mediaEl.classList.add('hidden');
                    }, { once: true });
                    return;
                }

                // Multi-screenshot interactive carousel (2–5 images)
                mediaEl.innerHTML = `
                    <div class="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
                        <div class="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
                            <div class="flex items-center gap-2 min-w-0">
                                <span class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(moduleLabel)}</span>
                                <span aria-hidden="true" class="text-slate-300">·</span>
                                <span data-carousel-counter class="text-xs font-extrabold text-blue-600 tabular-nums shrink-0">${currentIdx + 1} / ${images.length}</span>
                            </div>
                            <button type="button" data-carousel-zoom-active class="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap transition">
                                <i class="fas fa-expand text-[10px]" aria-hidden="true"></i>
                                <span>Zoom</span>
                            </button>
                        </div>

                        <div data-carousel-stage class="relative aspect-[16/10] bg-slate-100 overflow-hidden select-none" style="touch-action: pan-y;">
                            <div data-carousel-track class="flex h-full transition-transform duration-200 ease-out" style="transform: translate3d(-${currentIdx * 100}%, 0, 0);">
                                ${images.map((shot, idx) => `
                                    <button type="button" data-showcase-zoom="${idx}" class="w-full h-full shrink-0 flex items-center justify-center bg-slate-100 cursor-zoom-in overflow-hidden" aria-label="Zoom ${escapeHtml(moduleLabel)} screenshot ${idx + 1}">
                                        <img src="${escapeHtml(shot.url)}" alt="${escapeHtml(moduleLabel)} screenshot ${idx + 1}" class="w-full h-full object-contain pointer-events-none" referrerpolicy="no-referrer" loading="lazy">
                                    </button>
                                `).join('')}
                            </div>

                            <button type="button" data-carousel-prev class="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/95 hover:bg-white text-slate-900 border border-slate-200 shadow-md items-center justify-center cursor-pointer transition active:scale-95" aria-label="Previous screenshot">
                                <i class="fas fa-chevron-left text-xs" aria-hidden="true"></i>
                            </button>
                            <button type="button" data-carousel-next class="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/95 hover:bg-white text-slate-900 border border-slate-200 shadow-md items-center justify-center cursor-pointer transition active:scale-95" aria-label="Next screenshot">
                                <i class="fas fa-chevron-right text-xs" aria-hidden="true"></i>
                            </button>
                        </div>

                        <div class="px-4 py-2.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                            <span data-carousel-caption class="text-[11px] font-semibold text-slate-500 truncate max-w-[60%]">
                                ${escapeHtml(images[currentIdx]?.caption || `${moduleLabel} · Swipe or use arrows`)}
                            </span>
                            <div class="flex items-center gap-1.5" role="group" aria-label="Screenshot slides">
                                ${images.map((_, idx) => `
                                    <button type="button" data-carousel-dot="${idx}" aria-label="Go to slide ${idx + 1}" aria-current="${idx === currentIdx ? 'true' : 'false'}" class="${idx === currentIdx ? 'h-2 w-6 rounded-full bg-blue-600 transition-all cursor-pointer' : 'h-2 w-2 rounded-full bg-slate-300 hover:bg-slate-400 transition-all cursor-pointer'}"></button>
                                `).join('')}
                            </div>
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

                // Mobile touch-swipe support (40px horizontal threshold)
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

            const selectDemoTab = (selectedTab) => {
                activeDemoTabKey = selectedTab;
                demoTabButtons.forEach((b) => {
                    const isActive = (b.getAttribute('data-demo-tab') || '') === selectedTab;
                    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
                    b.className = isActive
                        ? 'px-3.5 py-2.5 text-xs font-extrabold rounded-lg bg-blue-600 text-white shadow-2xs transition-all cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5'
                        : 'px-3.5 py-2.5 text-xs font-extrabold rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5';
                    if (isActive && typeof b.scrollIntoView === 'function') {
                        b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                });
                demoPanels.forEach((panel) => {
                    const panelKey = panel.getAttribute('data-demo-panel') || '';
                    panel.classList.toggle('hidden', panelKey !== selectedTab);
                });
            };

            demoTabButtons.forEach((btn) => {
                if (btn.dataset.boundDemoTab) return;
                btn.dataset.boundDemoTab = 'true';
                btn.addEventListener('click', () => {
                    const selectedTab = btn.getAttribute('data-demo-tab') || 'public';
                    selectDemoTab(selectedTab);
                });
            });

            if (tabScrollLeftBtn && !tabScrollLeftBtn.dataset.boundScroll) {
                tabScrollLeftBtn.dataset.boundScroll = 'true';
                tabScrollLeftBtn.addEventListener('click', () => {
                    tabScroller?.scrollBy({ left: -260, behavior: 'smooth' });
                });
            }
            if (tabScrollRightBtn && !tabScrollRightBtn.dataset.boundScroll) {
                tabScrollRightBtn.dataset.boundScroll = 'true';
                tabScrollRightBtn.addEventListener('click', () => {
                    tabScroller?.scrollBy({ left: 260, behavior: 'smooth' });
                });
            }

            if (!document.documentElement.dataset.boundShowcaseKeyboard) {
                document.documentElement.dataset.boundShowcaseKeyboard = 'true';
                document.addEventListener('keydown', (e) => {
                    if (!isRootGatewayMode) return;
                    const lightboxOpen = lightboxModal && !lightboxModal.classList.contains('hidden');
                    if (lightboxOpen) {
                        if (e.key === 'Escape') {
                            closeShowcaseLightbox();
                        } else if (e.key === 'ArrowLeft' && lightboxState.images.length > 1) {
                            lightboxState.index -= 1;
                            renderLightboxSlide();
                        } else if (e.key === 'ArrowRight' && lightboxState.images.length > 1) {
                            lightboxState.index += 1;
                            renderLightboxSlide();
                        }
                        return;
                    }

                    const activeTag = String(document.activeElement?.tagName || '').toLowerCase();
                    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

                    const demoSection = document.getElementById('product-demo');
                    if (!demoSection) return;
                    const rect = demoSection.getBoundingClientRect();
                    const isSectionVisible = rect.top < window.innerHeight && rect.bottom > 0;
                    if (!isSectionVisible) return;

                    const imgs = showcaseImagesByPage.get(activeDemoTabKey) || [];
                    if (imgs.length <= 1) return;
                    updateCarouselPosition(
                        activeDemoTabKey,
                        (showcaseSlideIndexByPage.get(activeDemoTabKey) || 0) + (e.key === 'ArrowRight' ? 1 : -1)
                    );
                });
            }

            // Load uploaded platform showcase screenshots from Firestore (public read)
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
                liveWatch: true,
                onStatusUpdate: (statusRes) => {
                    if (statusRes?.exists && statusRes?.institution?.name) {
                        const loginInstEl = document.getElementById('login-institution-name');
                        if (loginInstEl && !globalInstitutionConfig?.appName) {
                            loginInstEl.textContent = statusRes.institution.name;
                        }
                    }
                }
            });

            isRootGatewayMode = Boolean(tenantCheck?.isRootGateway);
            if (!tenantCheck?.active) {
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

            // Tenant public page PWA install controls (menu + hero button only, no auto-popup)
            registerInstallTrigger({
                key: 'tenant-public',
                buttonIds: ['public-install-menu-btn', 'hero-btn-install'],
                containerIds: ['public-install-menu-item'],
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
                        .map((entry) => entry.notice);

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
                        .filter(Boolean);
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

            // 4. Category Auth & Page Access settings
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
                            const safePhoto = (p.photo && p.photo.startsWith('data:')) ? p.photo : (sanitizeUrl(p.photo) || 'https://via.placeholder.com/150?text=User');
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
        
        // State for unified smart verification & login
        let verifiedUser = null;

        const VERIFY_BTN_HTML = '<i class="fas fa-arrow-right" aria-hidden="true"></i><span>Verify Account</span>';
        const SIGN_IN_BTN_HTML = '<i class="fas fa-shield-halved" aria-hidden="true"></i><span>Sign In Securely</span>';

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

        const setLoginStepState = (step = 1) => {
            const step1Item = document.getElementById('login-progress-step-1');
            const step2Item = document.getElementById('login-progress-step-2');
            const stepDot1 = document.getElementById('login-step-dot-1');
            const stepLine = document.getElementById('login-progress-line');

            if (step === 2) {
                step1Item?.classList.remove('is-active');
                step1Item?.classList.add('is-completed');
                step1Item?.removeAttribute('aria-current');
                if (stepDot1) stepDot1.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
                stepLine?.classList.add('is-completed');
                step2Item?.classList.add('is-active');
                step2Item?.setAttribute('aria-current', 'step');
            } else {
                step1Item?.classList.add('is-active');
                step1Item?.classList.remove('is-completed');
                step1Item?.setAttribute('aria-current', 'step');
                if (stepDot1) stepDot1.textContent = '1';
                stepLine?.classList.remove('is-completed');
                step2Item?.classList.remove('is-active');
                step2Item?.removeAttribute('aria-current');
            }
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

        const loginModalEl = document.getElementById('login-modal');
        loginModalEl?.addEventListener('click', (e) => {
            if (e.target === loginModalEl) loginModalEl.style.display = 'none';
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && loginModalEl && loginModalEl.style.display === 'flex') {
                loginModalEl.style.display = 'none';
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

        const resetUniversalLoginForm = () => {
            verifiedUser = null;
            setLoginStepState(1);
            resetPasswordVisibility();
            document.getElementById('login-step-2')?.classList.add('hidden');
            document.getElementById('login-step-1')?.classList.remove('hidden');
            const verifyBtn = document.getElementById('btn-verify-user');
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = VERIFY_BTN_HTML;
            }
            const submitBtn = document.getElementById('btn-login-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = SIGN_IN_BTN_HTML;
            }
            const userInput = document.getElementById('login-username');
            if (userInput) {
                userInput.value = '';
                userInput.focus();
            }
            const passInput = document.getElementById('login-password');
            if (passInput) passInput.value = '';
            showLoginMessage('');
        };

        document.getElementById('btn-change-user')?.addEventListener('click', () => {
            verifiedUser = null;
            setLoginStepState(1);
            resetPasswordVisibility();
            document.getElementById('login-step-2')?.classList.add('hidden');
            document.getElementById('login-step-1')?.classList.remove('hidden');
            const submitBtn = document.getElementById('btn-login-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = SIGN_IN_BTN_HTML;
            }
            document.getElementById('login-username')?.focus();
            showLoginMessage('');
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

        const verifyUniversalIdentifier = async () => {
            const userInput = document.getElementById('login-username');
            const rawInput = (userInput?.value || '').trim();
            if (!rawInput) {
                showLoginMessage('Please enter your Username, Admission Number, or Email.');
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
                            if (lookupRes.institutionStatus && lookupRes.institutionStatus !== 'active') {
                                showLoginMessage('This institution portal is currently paused or inactive.');
                                return;
                            }
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
                                targetInstitutionId: String(lookupRes.institutionId || INSTITUTION_ID || '').trim().toLowerCase()
                            };
                        }
                    } catch (fnErr) {
                        customLookupError = fnErr;
                        console.warn('Custom username lookup notice:', fnErr?.message || fnErr);
                    }
                }

                // 2. Root Platform Gateway: Allow Company Owner Email/Password sign-in
                if (!matched && isRootGatewayMode) {
                    if (cleanLower.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanLower)) {
                        matched = {
                            type: 'company_owner',
                            data: null,
                            displayName: cleanLower.split('@')[0] || 'Company Owner',
                            meta: 'Company Console Account',
                            loginEmail: cleanLower,
                            loginId: cleanLower
                        };
                    } else if (customLookupError) {
                        showLoginMessage(customLookupError.message || 'Unable to reach authentication service.');
                        return;
                    } else {
                        showLoginMessage(`User "${rawInput}" not found. Enter a valid Super Admin / Staff username or Company Owner email.`);
                        userInput?.focus();
                        return;
                    }
                }

                // 3. Tenant Portal: Strict Student Auth Lookup (exact Admission Number)
                if (!matched && !isRootGatewayMode && cleanAdm) {
                    try {
                        let lookupSnap = await getDoc(doc(db, `${BASE_PATH}/studentAuthLookup`, `adm_${cleanAdm}`));
                        if (lookupSnap.exists()) {
                            const stData = lookupSnap.data() || {};
                            if (stData.studentId) {
                                matched = {
                                    type: 'student',
                                    data: stData,
                                    displayName: stData.name || 'Student',
                                    meta: `Student • Class ${stData.class || '-'} (Adm: ${stData.adm || rawInput})`
                                };
                            }
                        } else {
                            lookupSnap = await getDoc(doc(db, `${BASE_PATH}/studentAuthLookup`, cleanAdm));
                            if (lookupSnap.exists()) {
                                const stData = lookupSnap.data() || {};
                                const recordAdmKey = normalizeAdmKey(stData.adm || '');
                                if (stData.studentId && (!recordAdmKey || recordAdmKey === cleanAdm)) {
                                    matched = {
                                        type: 'student',
                                        data: stData,
                                        displayName: stData.name || 'Student',
                                        meta: `Student • Class ${stData.class || '-'} (Adm: ${stData.adm || rawInput})`
                                    };
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('Student lookup notice:', e);
                    }
                }

                // 4. Tenant Portal: Strict Directory Login Verification
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
                        matched = {
                            type: 'directory',
                            data: dirMatch,
                            displayName,
                            meta: dirMatch.role || dirMatch.values?.role || 'Category User',
                            loginId: resolvedUsername
                        };
                    }
                }

                // 5. Tenant Portal: Allow Company Owner email fallback
                if (!matched && !isRootGatewayMode && cleanLower.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanLower)) {
                    matched = {
                        type: 'company_owner',
                        data: null,
                        displayName: cleanLower.split('@')[0] || 'Account',
                        meta: 'Company Owner Verification',
                        loginEmail: cleanLower,
                        loginId: cleanLower
                    };
                }

                if (matched) {
                    if (!isRootGatewayMode && matched.type === 'student') {
                        if (window.AppSession?.isCompanyPageAllowed?.('student') === false) {
                            showLoginMessage('Student Portal is a Premium module (Premium - Upgrade).');
                            openPremiumPlansModal({
                                contextType: 'module',
                                moduleKey: 'student',
                                moduleName: 'Student Portal',
                                institutionName: globalInstitutionConfig?.appName || ''
                            });
                            return;
                        }
                        if (globalInstitutionConfig?.enabledModules?.student === false || window.AppSession?.isModuleEnabled('student') === false) {
                            showLoginMessage('Student Portal is currently disabled by institution administration.');
                            return;
                        }
                    }
                    verifiedUser = matched;
                    const nameEl = document.getElementById('verified-user-name');
                    const metaEl = document.getElementById('verified-user-meta');
                    const avatarIcon = document.getElementById('verified-user-avatar-icon');
                    const passLeadingIcon = document.getElementById('login-password-leading-icon');
                    const passLabel = document.getElementById('login-password-label');
                    const passInput = document.getElementById('login-password');
                    const passHint = document.getElementById('login-password-hint');

                    if (nameEl) nameEl.textContent = matched.displayName;
                    if (metaEl) metaEl.textContent = matched.meta;
                    resetPasswordVisibility();

                    if (matched.type === 'student') {
                        if (avatarIcon) avatarIcon.className = 'fas fa-user-graduate';
                        if (passLeadingIcon) passLeadingIcon.className = 'fas fa-mobile-screen-button login-input-leading';
                        if (passLabel) passLabel.textContent = 'Registered Mobile Number (Password)';
                        if (passInput) {
                            passInput.placeholder = '10-digit mobile number';
                            passInput.type = 'password';
                        }
                        if (passHint) passHint.textContent = 'Enter the mobile phone number registered with the school.';
                    } else {
                        const isShield = matched.type === 'company_owner' || (matched.type === 'custom_auth' && matched.role === 'super_admin');
                        if (avatarIcon) avatarIcon.className = isShield ? 'fas fa-user-shield' : 'fas fa-user-tie';
                        if (passLeadingIcon) passLeadingIcon.className = 'fas fa-lock login-input-leading';
                        if (passLabel) passLabel.textContent = 'Password';
                        if (passInput) {
                            passInput.placeholder = 'Enter account password';
                            passInput.type = 'password';
                        }
                        if (passHint) passHint.textContent = 'Enter your account password to sign in.';
                    }

                    setLoginStepState(2);
                    document.getElementById('login-step-1')?.classList.add('hidden');
                    document.getElementById('login-step-2')?.classList.remove('hidden');
                    if (passInput) {
                        passInput.value = '';
                        passInput.focus();
                    }
                } else {
                    if (customLookupError) {
                        showLoginMessage(customLookupError.message || 'Unable to verify username.');
                    } else {
                        showLoginMessage(`User "${rawInput}" not found. Please verify your Username or Admission Number.`);
                    }
                    userInput?.focus();
                }
            } catch (err) {
                console.error('Universal verification error:', err);
                showLoginMessage('Verification error: ' + err.message);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = VERIFY_BTN_HTML;
                }
            }
        };

        const handleUniversalLoginSubmit = async () => {
            if (!verifiedUser) {
                resetUniversalLoginForm();
                return;
            }

            const passInput = document.getElementById('login-password');
            const enteredPass = (passInput?.value || '').trim();
            if (!enteredPass) {
                const isStudent = verifiedUser.type === 'student';
                showLoginMessage(isStudent ? 'Please enter registered mobile number.' : 'Please enter your password.');
                passInput?.focus();
                return;
            }

            const btn = document.getElementById('btn-login-submit');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Authenticating...</span>';
            }
            showLoginMessage('');

            try {
                if (verifiedUser.type === 'student') {
                    const enteredPhone = normalizePhone(enteredPass);
                    const st = verifiedUser.data;
                    const phones = Array.isArray(st.phones)
                        ? st.phones
                        : [normalizePhone(st.phone || '')];

                    const isMatch = phones.some(p => p && (p === enteredPhone || p.endsWith(enteredPhone) || enteredPhone.endsWith(p)));
                    if (isMatch) {
                        showLoginMessage('');
                        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Loading Dashboard...</span>';
                        await window.AppSession?.clearAll?.();
                        if (!auth.currentUser) {
                            try { await signInAnonymously(auth); } catch (_) {}
                        }
                        window.AppSession?.startStudent(st.studentId, {
                            name: st.name || '',
                            class: st.class || '',
                            adm: st.adm || ''
                        });
                        await Promise.race([
                            syncStudentGroupMembersToSession(st.studentId, { clearDismissed: true }),
                            new Promise((resolve) => setTimeout(resolve, 1500))
                        ]);
                        window.location.href = getPageUrl('student.html');
                        return;
                    } else {
                        showLoginMessage('Incorrect registered mobile number. Please check and try again.');
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = SIGN_IN_BTN_HTML;
                        }
                    }
                    return;
                }

                if (!isRootGatewayMode && (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.())) {
                    showLoginMessage('An official account is already logged in. Please log out first.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = SIGN_IN_BTN_HTML;
                    }
                    return;
                }

                // Clear prior session before authenticating Official / Admin / Company Owner / Directory
                await window.AppSession?.clearAll();
                const enteredPassword = enteredPass.trim();

                // A. Directory User Login (Tenant Portal only)
                if (verifiedUser.type === 'directory' && !isRootGatewayMode) {
                    const userLogin = String(verifiedUser.loginId || '').toLowerCase().trim();
                    const directoryLogin = await resolveDirectoryLogin(userLogin, enteredPassword);
                    if (directoryLogin?.entry) {
                        if (!auth.currentUser) {
                            try { await signInAnonymously(auth); } catch (_) {}
                        }
                        const access = directoryLogin.access || {};
                        const entry = directoryLogin.entry;
                        const rawName = String(entry?.values?.name || entry?.values?.Name || entry?.authMeta?.usernameRaw || userLogin || 'User');
                        const dirRoleTitle = String(entry?.values?.role || entry?.role || 'Category User');
                        const dirAccess = {
                            ...access,
                            worksheet: true,
                            userKey: userLogin,
                            loginId: userLogin,
                            entryId: entry.id,
                            categoryId: entry.categoryId || '',
                            name: rawName,
                            role: dirRoleTitle,
                            type: 'Category User',
                            source: 'directory',
                            requiresEmailAuth: false
                        };
                        window.AppSession?.startStaff(rawName, userLogin, dirAccess);
                        const activeProject = window.AppSession?.getActiveProjectId?.() || '';
                        localStorage.setItem('official_portal_session_v1', JSON.stringify({
                            ...(activeProject ? { projectId: activeProject } : {}),
                            institutionId: INSTITUTION_ID,
                            id: entry.id,
                            name: rawName,
                            username: userLogin,
                            email: '',
                            role: dirRoleTitle,
                            type: 'Category User',
                            categoryId: entry.categoryId || '',
                            canCollect: dirAccess.collection === true,
                            canAccessWorksheet: true,
                            source: 'directory',
                            access: dirAccess
                        }));
                        window.location.href = getPageUrl('official.html');
                        return;
                    }
                    showLoginMessage('Incorrect password. Please check and try again.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = SIGN_IN_BTN_HTML;
                    }
                    return;
                }

                // B. Custom Username Authentication (Institution Super Admin & Staff via Cloud Function Custom Token)
                if (verifiedUser.type === 'custom_auth') {
                    const { userCred, profile } = await signInWithCustomUsernameAndPassword(auth, {
                        username: verifiedUser.loginId,
                        password: enteredPassword,
                        institutionId: isRootGatewayMode ? '' : INSTITUTION_ID
                    });

                    const effectiveInstId = String(profile.institutionId || verifiedUser.targetInstitutionId || INSTITUTION_ID || '').trim().toLowerCase();
                    if (!effectiveInstId) {
                        try { await signOut(auth); } catch (_) {}
                        showLoginMessage('Account is not linked to an active institution.');
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = SIGN_IN_BTN_HTML;
                        }
                        return;
                    }

                    const effectiveBasePath = `institutions/${effectiveInstId}`;
                    const buildTargetUrl = (page = 'official.html') => (
                        window.AppSession?.buildPageUrl?.(page, effectiveInstId) || `/${effectiveInstId}/${page.replace(/\.html$/i, '')}`
                    );
                    const displayUser = String(profile.displayUsername || profile.username || verifiedUser.loginId || '').trim();
                    const normUser = String(profile.username || displayUser).trim().toLowerCase();

                    if (profile.role === 'super_admin') {
                        window.AppSession?.startAdmin({
                            name: profile.displayName || verifiedUser.displayName || 'Super Admin',
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
                            btn.innerHTML = SIGN_IN_BTN_HTML;
                        }
                        return;
                    }

                    const dutyClasses = Array.isArray(activeCollector.dutyClasses) && activeCollector.dutyClasses.length
                        ? activeCollector.dutyClasses.filter(Boolean)
                        : [];
                    const staffName = activeCollector.name || profile.displayName || verifiedUser.displayName || displayUser;
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
                    window.AppSession?.startStaff(staffName, displayUser, staffAccess, effectiveInstId);

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
                    return;
                }

                // C. Company Owner Login (Standard Firebase Email/Password)
                if (verifiedUser.type === 'company_owner') {
                    const loginEmail = String(verifiedUser.loginEmail || verifiedUser.loginId || '').trim().toLowerCase();
                    let userCred = null;
                    try {
                        userCred = await signInWithEmailAndPassword(auth, loginEmail, enteredPassword);
                    } catch (authErr) {
                        const code = String(authErr?.code || '').trim();
                        const proj = firebaseConfig?.projectId || 'unknown';
                        showLoginMessage(
                            code === 'auth/invalid-credential' || code === 'auth/wrong-password'
                                ? `Invalid email or password (${code}). Check Company Owner credentials in Firebase Auth (${proj}).`
                                : `Authentication failed (${code || 'error'}): ${authErr?.message || 'Check credentials.'}`
                        );
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = SIGN_IN_BTN_HTML;
                        }
                        return;
                    }

                    const authedEmail = String(userCred?.user?.email || loginEmail).trim().toLowerCase();
                    let isOwner = false;
                    let companyName = 'Institution Manage';
                    let ownerName = 'Company Owner';
                    try {
                        const companyRef = doc(db, COMPANY_COLLECTION, COMPANY_CONFIG_DOC_ID);
                        let companySnap = null;
                        try {
                            companySnap = await getDocFromServer(companyRef);
                        } catch (serverErr) {
                            if (serverErr?.code === 'unavailable' || String(serverErr?.message || '').toLowerCase().includes('offline')) {
                                companySnap = await getDoc(companyRef);
                            } else {
                                throw serverErr;
                            }
                        }
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
                                ownerName = String(arrayMatch?.name || data.name || data.ownerName || 'Company Owner').trim();
                            }
                        }
                    } catch (companyErr) {
                        console.warn('Company owner verification notice:', companyErr);
                    }

                    if (isOwner) {
                        window.AppSession?.startCompany?.({
                            name: ownerName,
                            email: authedEmail,
                            companyName
                        });
                        window.location.href = '/company';
                        return;
                    }

                    try { await signOut(auth); } catch (_) {}
                    showLoginMessage(`Account "${authedEmail}" is not authorized as a Company Console Owner.`);
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = SIGN_IN_BTN_HTML;
                    }
                    return;
                }

                showLoginMessage('Unsupported login state. Please verify your username again.');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = SIGN_IN_BTN_HTML;
                }
            } catch (err) {
                console.error('Universal login error:', err);
                showLoginMessage(err?.message || 'Invalid username or password.');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = SIGN_IN_BTN_HTML;
                }
            }
        };

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

        document.getElementById('login-username')?.addEventListener('input', (e) => {
            if (e.target.value.length > 60) e.target.value = e.target.value.slice(0, 60);
        });
        document.getElementById('login-password')?.addEventListener('input', (e) => {
            if (e.target.value.length > 60) e.target.value = e.target.value.slice(0, 60);
        });

        const sessionNotice = window.AppSession?.consumeFlash?.();
        if (sessionNotice) {
            window.openLogin();
            showLoginMessage(sessionNotice);
        }
        if (new URLSearchParams(window.location.search).get('addStudent') === '1') {
            if (window.AppSession?.hasCompanySession?.()) {
                window.location.href = '/company';
            } else if (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.()) {
                window.location.href = getPageUrl('official.html');
            } else {
                history.replaceState(null, '', window.location.pathname);
                openStudentLoginModal();
            }
        }

        init();
