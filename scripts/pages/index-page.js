import { onAuthStateChanged, signInWithEmailAndPassword, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, onSnapshot, collection, getDoc, getDocs, setDoc, query, where, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth } from '../../config/firebase-config.js';
import { ADMIN_AUTH_DOC_ID, SINGLE_ADMIN_MODE } from '../../config/app-config.js';
import { BASE_PATH, applyInstitutionBranding, escapeHtml, hardenExternalLinks, normalizePhone, registerServiceWorker, renderVersionInfo, sanitizePhone, sanitizeUrl } from '../shared/app-common.js';

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
            if (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.()) {
                window.location.href = 'official.html';
                return;
            }
            if (globalInstitutionConfig?.enabledModules?.student === false || window.AppSession?.isModuleEnabled('student') === false) {
                showToast("Student Portal is currently disabled by institution administration.", "error");
                showLoginMessage("Student Portal is currently disabled by institution administration.");
                return;
            }
            document.getElementById('login-modal').style.display = 'flex'; 
            setMobileMenuState(false);
            resetUniversalLoginForm();
            const sessionNotice = window.AppSession?.consumeFlash?.();
            if (sessionNotice) showLoginMessage(sessionNotice);
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

        const activateRememberedAccount = async (account) => {
            if (!account) return false;
            await ensureVerificationRegistriesLoaded();
            const isValid = await isRememberedAccountValid(account, { verifyStudentOnline: true });
            if (!isValid) {
                window.AppSession?.removeRememberedAccount?.(account.id || account.studentId);
                renderSavedAccounts();
                showToast('This account is no longer active or has been removed by the administrator.', 'error');
                const remaining = window.AppSession?.getRememberedAccounts?.() || [];
                if (!remaining.length) {
                    document.getElementById('saved-student-modal').style.display = 'none';
                    openStudentLoginModal();
                    showLoginMessage('Saved account is no longer active. Please log in with an active account.');
                }
                return false;
            }

            if (account.role === 'student' || (!account.role && account.studentId)) {
                if (!auth.currentUser) {
                    try { await signInAnonymously(auth); } catch (_) {}
                }
                const targetStudentId = account.studentId || account.id;
                if (auth.currentUser && targetStudentId) {
                    try {
                        const stuSnap = await getDoc(doc(db, `${BASE_PATH}/students`, targetStudentId));
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
                            }
                            return false;
                        }
                    } catch (_) {}
                }
                await syncStudentGroupMembersToSession(targetStudentId, { clearDismissed: false });
                if (window.AppSession?.hasStudentSession?.() && String(window.AppSession?.getStudentId?.() || '') === String(targetStudentId)) {
                    window.AppSession?.startStudent?.(targetStudentId, account);
                    window.location.href = 'student.html';
                    return true;
                }
                return window.AppSession?.switchAccount?.(account.id || targetStudentId);
            }

            return false;
        };
        window.openLogin = async () => {
            if (isOpeningLoginFlow) return;
            isOpeningLoginFlow = true;
            try {
                // Official accounts (Admin / Staff) strictly enforce single-session access
                if (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.()) {
                    window.location.href = 'official.html';
                    return;
                }

                const params = new URLSearchParams(window.location.search);
                const forceAdd = params.get('addStudent') === '1' || params.get('login') === 'new';
                if (forceAdd) {
                    openStudentLoginModal();
                    return;
                }

                await ensureVerificationRegistriesLoaded();
                await validateAndPruneRememberedAccounts({ verifyStudentsOnline: true });

                const accounts = window.AppSession?.getRememberedAccounts?.() || [];
                if (accounts.length >= 1) {
                    openSavedStudentModal();
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
                    await activateRememberedAccount(targetAccount);
                } else {
                    const stSwitched = window.AppSession?.switchStudent?.(accountId);
                    if (stSwitched) window.location.href = 'student.html';
                }
            }
        });

        function fitHeroTitle() {
            const el = document.getElementById('hero-main-title');
            if(!el) return;
            el.style.fontSize = '';
        }
        window.addEventListener('resize', fitHeroTitle);

        registerServiceWorker();
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

        async function init() {
            populateClassDropdown();

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
                        }
                    } catch (_) {}
                }
                const cleanAdm = normalizeAdmKey(account.adm || '');
                if (cleanAdm) {
                    try {
                        let lookupSnap = await getDoc(doc(db, `${BASE_PATH}/studentAuthLookup`, `adm_${cleanAdm}`));
                        if (!lookupSnap.exists()) {
                            lookupSnap = await getDoc(doc(db, `${BASE_PATH}/studentAuthLookup`, cleanAdm));
                        }
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
            let removedAny = false;
            const validList = [];
            for (const account of accounts) {
                const ok = await isRememberedAccountValid(account, { verifyStudentOnline: verifyStudentsOnline });
                if (!ok) {
                    window.AppSession?.removeRememberedAccount?.(account.id || account.studentId);
                    removedAny = true;
                } else {
                    validList.push(account);
                }
            }
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
                await ensureVerificationRegistriesLoaded();

                const cleanLower = rawInput.toLowerCase();
                const cleanAdm = normalizeAdmKey(rawInput);
                const cleanEmail = cleanLower;
                const cleanPhone = normalizePhone(rawInput);

                let matched = null;

                // 1. Strict Student Auth Lookup (exact Admission Number only)
                if (cleanAdm) {
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

                // 2. Strict Staff Registry Verification (active staff only)
                if (!matched) {
                    const staffMember = (cachedActiveStaff || []).find((s) => {
                        if (!s || s.isActive === false) return false;
                        const sEmail = String(s.email || '').toLowerCase().trim();
                        const explicitUsernames = [
                            s.username,
                            s.userName,
                            s.loginId,
                            s.login,
                            s.staffId
                        ].map((val) => String(val || '').toLowerCase().trim()).filter(Boolean);
                        if (!s.username && sEmail.includes('@')) {
                            explicitUsernames.push(sEmail.split('@')[0]);
                        }
                        const sPhone = normalizePhone(s.phone || '');
                        const isEmailMatch = Boolean(sEmail && sEmail === cleanEmail);
                        const isUsernameMatch = explicitUsernames.some((u) => u === cleanLower || normalizeAdmKey(u) === cleanAdm);
                        const isPhoneMatch = Boolean(
                            cleanPhone.length >= 7 &&
                            sPhone &&
                            (sPhone === cleanPhone || (sPhone.length >= 10 && cleanPhone.length >= 10 && sPhone.slice(-10) === cleanPhone.slice(-10)))
                        );
                        return isEmailMatch || isUsernameMatch || isPhoneMatch;
                    });

                    if (staffMember) {
                        const baseLoginId = (staffMember.username || staffMember.userName || staffMember.loginId || staffMember.email || cleanAdm).toLowerCase().trim();
                        const loginEmail = staffMember.email && staffMember.email.includes('@')
                            ? staffMember.email.toLowerCase().trim()
                            : `${baseLoginId}@school.internal`;

                        matched = {
                            type: 'staff',
                            data: staffMember,
                            displayName: staffMember.name || 'Staff Member',
                            meta: staffMember.role || staffMember.type || 'Staff Member',
                            loginEmail
                        };
                    }
                }

                // 3. Strict Admin Registry Verification (no arbitrary email or hardcoded 'admin' fallback)
                if (!matched) {
                    const adminProfile = globalInstitutionConfig?.adminProfile || {};
                    const adminCandidates = [];
                    const primaryEmail = String(adminProfile.email || '').toLowerCase().trim();
                    const primaryUsername = String(adminProfile.username || '').toLowerCase().trim();
                    if (primaryEmail || primaryUsername) {
                        adminCandidates.push({
                            email: primaryEmail,
                            username: primaryUsername || (primaryEmail.includes('@') ? primaryEmail.split('@')[0] : ''),
                            name: adminProfile.name || 'Institution Administrator'
                        });
                    }
                    if (Array.isArray(adminProfile.admins)) {
                        adminProfile.admins.forEach((entry) => {
                            if (!entry || entry.isActive === false) return;
                            const eEmail = String(entry.email || '').toLowerCase().trim();
                            const eUsername = String(entry.username || (eEmail.includes('@') ? eEmail.split('@')[0] : '')).toLowerCase().trim();
                            if (eEmail || eUsername) {
                                adminCandidates.push({
                                    email: eEmail,
                                    username: eUsername,
                                    name: entry.name || adminProfile.name || 'Institution Administrator'
                                });
                            }
                        });
                    }

                    const matchedAdmin = adminCandidates.find((candidate) => (
                        (candidate.email && candidate.email === cleanEmail) ||
                        (candidate.username && (candidate.username === cleanLower || normalizeAdmKey(candidate.username) === cleanAdm))
                    ));

                    if (matchedAdmin) {
                        matched = {
                            type: 'admin',
                            data: adminProfile,
                            displayName: matchedAdmin.name || 'Institution Administrator',
                            meta: 'Administrator',
                            loginEmail: matchedAdmin.email || (cleanEmail.includes('@') ? cleanEmail : `${matchedAdmin.username}@school.internal`)
                        };
                    } else if (cleanEmail.includes('@') && !cleanEmail.endsWith('@school.internal')) {
                        // Allow first-time Super Admin verification on fresh Firebase projects before adminProfile exists in settings/config
                        matched = {
                            type: 'admin_candidate',
                            data: null,
                            displayName: cleanEmail.split('@')[0] || 'Administrator',
                            meta: 'Email Account Verification',
                            loginEmail: cleanEmail
                        };
                    }
                }

                // 4. Strict Directory Login Verification
                if (!matched || matched.type === 'admin_candidate') {
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
                        const displayName = dirMatch.name || dirMatch.values?.name || dirMatch.values?.Name || String(dirMatch.authMeta?.usernameRaw || 'Staff Member');
                        const resolvedUsername = String(dirMatch.authMeta?.username || cleanLower).toLowerCase().trim();
                        matched = {
                            type: 'directory',
                            data: dirMatch,
                            displayName,
                            meta: dirMatch.role || dirMatch.values?.role || 'Staff Member',
                            loginId: resolvedUsername
                        };
                    }
                }

                if (matched) {
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
                        if (avatarIcon) avatarIcon.className = (matched.type === 'admin' || matched.type === 'admin_candidate') ? 'fas fa-user-shield' : 'fas fa-user-tie';
                        if (passLeadingIcon) passLeadingIcon.className = 'fas fa-lock login-input-leading';
                        if (passLabel) passLabel.textContent = 'Password';
                        if (passInput) {
                            passInput.placeholder = 'Enter account password';
                            passInput.type = 'password';
                        }
                        if (passHint) passHint.textContent = 'Enter your account credentials to log in.';
                    }

                    setLoginStepState(2);
                    document.getElementById('login-step-1')?.classList.add('hidden');
                    document.getElementById('login-step-2')?.classList.remove('hidden');
                    if (passInput) {
                        passInput.value = '';
                        passInput.focus();
                    }
                } else {
                    showLoginMessage(`User "${rawInput}" not found. Please verify your Username or Admission Number.`);
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
                        await syncStudentGroupMembersToSession(st.studentId, { clearDismissed: true });
                        window.location.href = 'student.html';
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

                if (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.()) {
                    showLoginMessage('An official account is already logged in. Please log out first.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = SIGN_IN_BTN_HTML;
                    }
                    return;
                }

                // If Admin or Staff
                await window.AppSession?.clearAll();
                const loginEmail = verifiedUser.loginEmail || (verifiedUser.data?.email || '').toLowerCase();
                const userLogin = loginEmail || verifiedUser.displayName.toLowerCase();
                const enteredPassword = enteredPass.trim();

                let isAuthenticated = false;
                let userCred = null;

                // 1. Firebase Auth login attempt (Admin & Staff)
                if (verifiedUser.type !== 'directory' && loginEmail) {
                    try {
                        userCred = await signInWithEmailAndPassword(auth, loginEmail, enteredPassword);
                        if (userCred?.user) isAuthenticated = true;
                    } catch (_authError) {
                        if (!loginEmail.includes('@')) {
                            try {
                                userCred = await signInWithEmailAndPassword(auth, `${loginEmail}@school.internal`, enteredPassword);
                                if (userCred?.user) isAuthenticated = true;
                            } catch (_) {}
                        }
                    }
                }

                // 2. Directory login fallback (for Category Users)
                if (!isAuthenticated) {
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
                        window.location.href = 'official.html';
                        return;
                    }

                    showLoginMessage('Incorrect password. Please verify your credentials.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = SIGN_IN_BTN_HTML;
                    }
                    return;
                }

                if (!auth.currentUser) {
                    try { await signInAnonymously(auth); } catch (_) {}
                }

                const authedEmail = (userCred?.user?.email || loginEmail).toLowerCase();
                const authedUsername = authedEmail.includes('@school.internal') ? authedEmail.replace('@school.internal', '') : authedEmail.split('@')[0];
                const usedFirebaseEmailAuth = Boolean(userCred?.user && !userCred.user.isAnonymous);

                // 1. Check if Admin via settings/adminAuth
                let isAdmin = false;
                let adminAuthData = null;
                try {
                    const adminRef = doc(db, `${BASE_PATH}/settings`, ADMIN_AUTH_DOC_ID);
                    const adminSnap = await getDoc(adminRef);
                    if (adminSnap.exists()) {
                        adminAuthData = adminSnap.data();
                        const adminEmail = (adminAuthData.email || '').toLowerCase();
                        const adminAccounts = SINGLE_ADMIN_MODE ? [] : (Array.isArray(adminAuthData.admins) ? adminAuthData.admins : []);
                        if (
                            adminEmail === authedEmail
                            || adminAuthData?.adminsIndex?.[authedEmail] === true
                            || adminAccounts.some((a) => (a.email || '').toLowerCase() === authedEmail && a.isActive !== false)
                        ) {
                            isAdmin = true;
                        }
                    }
                } catch (e) {
                    console.warn('Admin check notice:', e);
                }

                if (isAdmin && usedFirebaseEmailAuth) {
                    const adminName = verifiedUser.type === 'admin'
                        ? (verifiedUser.displayName || 'Institution Administrator')
                        : (adminAuthData?.name || 'Institution Administrator');
                    if (!globalInstitutionConfig?.adminProfile?.email) {
                        try {
                            await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), {
                                adminProfile: {
                                    email: authedEmail,
                                    username: authedUsername,
                                    name: adminName
                                }
                            }, { merge: true });
                        } catch (_) {}
                    }
                    window.AppSession?.startAdmin({ name: adminName, email: authedEmail });
                    window.location.href = 'official.html';
                    return;
                }

                // 2. Check Staff Access
                try {
                    let staffAccessDoc = await getDoc(doc(db, `${BASE_PATH}/staffAccess`, authedEmail));
                    if (!staffAccessDoc.exists() && authedUsername) {
                        staffAccessDoc = await getDoc(doc(db, `${BASE_PATH}/staffAccess`, authedUsername));
                    }

                    if (staffAccessDoc.exists() && staffAccessDoc.data()?.isActive !== false) {
                        const activeCollector = staffAccessDoc.data();
                        const collectorKey = authedEmail;
                        const dutyClasses = Array.isArray(activeCollector.dutyClasses) && activeCollector.dutyClasses.length
                            ? activeCollector.dutyClasses.filter(Boolean)
                            : (Array.isArray(activeCollector.assignedClasses) ? activeCollector.assignedClasses.filter(Boolean) : []);
                        const staffAccess = {
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
                            actLikeSuperAdmin: activeCollector.actLikeSuperAdmin === true,
                            dutyClasses,
                            staffId: activeCollector.staffId || '',
                            name: activeCollector.name || verifiedUser.displayName || '',
                            phone: activeCollector.phone || '',
                            role: activeCollector.role || activeCollector.type || 'Staff',
                            type: activeCollector.type || 'Staff',
                            photo: activeCollector.photo || '',
                            source: 'staff',
                            userKey: collectorKey,
                            loginId: authedUsername || userLogin,
                            requiresEmailAuth: usedFirebaseEmailAuth
                        };
                        window.AppSession?.startStaff(activeCollector.name || verifiedUser.displayName || '', collectorKey, staffAccess);

                        const activeProject = window.AppSession?.getActiveProjectId?.() || '';
                        const officialSessionObj = {
                            ...(activeProject ? { projectId: activeProject } : {}),
                            id: activeCollector.staffId || '',
                            name: activeCollector.name || verifiedUser.displayName || '',
                            username: collectorKey,
                            email: authedEmail,
                            phone: activeCollector.phone || '',
                            role: activeCollector.role || activeCollector.type || 'Staff',
                            type: activeCollector.type || 'Staff',
                            photo: activeCollector.photo || '',
                            dutyClasses,
                            canAccessAdmin: activeCollector.canAccessAdmin === true,
                            actLikeSuperAdmin: activeCollector.actLikeSuperAdmin === true,
                            canCollect: activeCollector.canCollect === true,
                            canAccessWorksheet: activeCollector.canAccessWorksheet === true,
                            canManageResults: activeCollector.canManageResults === true,
                            canAccessAttendance: activeCollector.canAccessAttendance === true,
                            canAccessAcademicPlan: activeCollector.canAccessAcademicPlan === true,
                            canAccessActivity: activeCollector.canAccessActivity === true,
                            canAccessEvaluation: activeCollector.canAccessEvaluation === true,
                            source: 'staff',
                            access: staffAccess
                        };
                        localStorage.setItem('official_portal_session_v1', JSON.stringify(officialSessionObj));
                        window.location.href = 'official.html';
                        return;
                    }
                } catch (e) {
                    console.warn('Staff access notice:', e);
                }

                // If authenticated via Firebase Email Auth and matched in staff registry
                if (verifiedUser.type === 'staff' && verifiedUser.data && usedFirebaseEmailAuth && verifiedUser.data.isActive !== false) {
                    const staffData = verifiedUser.data;
                    const staffDutyClasses = Array.isArray(staffData.dutyClasses) && staffData.dutyClasses.length
                        ? staffData.dutyClasses.filter(Boolean)
                        : (Array.isArray(staffData.assignedClasses) ? staffData.assignedClasses.filter(Boolean) : []);
                    const staffAccess = {
                        collection: staffData.canCollect === true,
                        worksheet: staffData.canAccessWorksheet !== false,
                        result: staffData.canManageResults === true,
                        attendance: staffData.canAccessAttendance === true,
                        academicPlan: staffData.canAccessAcademicPlan === true,
                        studentActivity: staffData.canAccessActivity === true,
                        classroomEvaluation: staffData.canAccessEvaluation === true,
                        evaluation: staffData.canAccessEvaluation === true,
                        admin: staffData.canAccessAdmin === true,
                        canAccessAdmin: staffData.canAccessAdmin === true,
                        actLikeSuperAdmin: staffData.actLikeSuperAdmin === true,
                        dutyClasses: staffDutyClasses,
                        staffId: staffData.id || '',
                        name: staffData.name || '',
                        role: staffData.role || 'Staff',
                        type: staffData.type || 'Staff',
                        phone: staffData.phone || '',
                        photo: staffData.photo || '',
                        source: 'staff',
                        userKey: authedEmail,
                        loginId: authedUsername || userLogin,
                        requiresEmailAuth: usedFirebaseEmailAuth
                    };
                    window.AppSession?.startStaff(staffData.name || '', authedEmail, staffAccess);

                    const activeProject = window.AppSession?.getActiveProjectId?.() || '';
                    const officialSessionObj = {
                        ...(activeProject ? { projectId: activeProject } : {}),
                        id: staffData.id || '',
                        name: staffData.name || '',
                        username: authedUsername || authedEmail,
                        email: staffData.email || authedEmail,
                        phone: staffData.phone || '',
                        role: staffData.role || 'Staff',
                        type: staffData.type || 'Staff',
                        photo: staffData.photo || '',
                        dutyClasses: staffDutyClasses,
                        canAccessAdmin: staffData.canAccessAdmin === true,
                        actLikeSuperAdmin: staffData.actLikeSuperAdmin === true,
                        canCollect: staffData.canCollect === true,
                        canAccessWorksheet: staffData.canAccessWorksheet !== false,
                        canManageResults: staffData.canManageResults === true,
                        canAccessAttendance: staffData.canAccessAttendance === true,
                        canAccessAcademicPlan: staffData.canAccessAcademicPlan === true,
                        canAccessActivity: staffData.canAccessActivity === true,
                        canAccessEvaluation: staffData.canAccessEvaluation === true,
                        source: 'staff',
                        access: staffAccess
                    };
                    localStorage.setItem('official_portal_session_v1', JSON.stringify(officialSessionObj));
                    window.location.href = 'official.html';
                    return;
                }

                if (usedFirebaseEmailAuth) {
                    try { await signOut(auth); } catch (_) {}
                }
                showLoginMessage('Incorrect credentials or account not active.');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = SIGN_IN_BTN_HTML;
                }
            } catch (err) {
                console.error('Universal login error:', err);
                showLoginMessage('Login failed: ' + (err.message || 'Invalid credentials.'));
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
            if (window.AppSession?.hasStaffSession?.() || window.AppSession?.hasAdminSession?.()) {
                window.location.href = 'official.html';
            } else {
                history.replaceState(null, '', window.location.pathname);
                openStudentLoginModal();
            }
        }

        init();
