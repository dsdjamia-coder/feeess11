(function () {
    const RESERVED_TENANT_SEGMENTS = new Set([
        'index',
        'company',
        'admin',
        'attendance',
        'academic-plan',
        'activity',
        'evaluation',
        'collection',
        'official',
        'result',
        'student',
        'worksheet',
        'platform',
        'official-dashboard',
        'student-fee-system',
        'studentmanagement',
        'assets',
        'scripts',
        'styles',
        'config',
        'public'
    ]);

    const sanitizeInstitutionSlug = (val = '') => {
        const clean = String(val || '').trim().toLowerCase();
        if (!clean || RESERVED_TENANT_SEGMENTS.has(clean)) return '';
        return /^[a-z0-9][a-z0-9-_]{0,63}$/.test(clean) ? clean : '';
    };

    const resolveCurrentInstitutionId = () => {
        try {
            const segments = String(window.location.pathname || '').split('/').filter(Boolean);
            if (segments.length > 0 && !segments[0].includes('.')) {
                const fromPath = sanitizeInstitutionSlug(segments[0]);
                if (fromPath) return fromPath;
            }
            const params = new URLSearchParams(window.location.search || '');
            const fromQuery = sanitizeInstitutionSlug(params.get('inst') || params.get('institution') || '');
            if (fromQuery) return fromQuery;
        } catch (_) {}
        return 'school';
    };

    const CURRENT_INSTITUTION_ID = resolveCurrentInstitutionId();

    // Clean URL Guard: Strip any lingering hash fragment on initial load
    if (typeof window !== 'undefined' && window.location) {
        try {
            if (window.location.hash) {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        } catch (_) {}
    }

    const DEFAULT_SESSION_MAX_AGE_MS = 0;
    const DEFAULT_SESSION_IDLE_MAX_AGE_MS = 0;
    const ROLE_SESSION_POLICY = {
        student: { maxAgeMs: 0, idleMs: 0 },
        staff: { maxAgeMs: 0, idleMs: 0 },
        admin: { maxAgeMs: 0, idleMs: 0 },
        company: { maxAgeMs: 0, idleMs: 0 }
    };
    const STAFF_STATE_KEY = 'app_session_staff_state';
    const ADMIN_STATE_KEY = 'app_session_admin_state';
    const STUDENT_STATE_KEY = 'app_session_student_state';
    const COMPANY_STATE_KEY = 'app_session_company_state';
    const COMPANY_ALLOWED_PAGES_KEY = 'app_company_allowed_pages';
    const STUDENT_ACCOUNTS_KEY = 'app_student_accounts';
    const REMEMBERED_ACCOUNTS_KEY = 'app_remembered_accounts';
    const DISMISSED_GROUP_STUDENTS_KEY = 'app_dismissed_group_students';
    const CURRENT_ROLE_KEY = 'app_session_current_role';
    const FLASH_KEY = 'app_session_flash';
    const ACTIVE_PROJECT_KEY = 'app_active_firebase_project_id';
    const ACTIVE_INSTITUTION_KEY = 'app_active_institution_id';
    const LAST_INSTITUTION_KEY = 'app_last_institution_id';
    const OFFICIAL_SESSION_KEY = 'official_portal_session_v1';

    const now = () => Date.now();

    const readJson = (key) => {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    };
    const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const removeKey = (key) => localStorage.removeItem(key);

    const getInstitutionId = () => CURRENT_INSTITUTION_ID;

    const buildPageUrl = (target = 'index.html', overrideInstitutionId = null) => {
        const raw = String(target || 'index.html').trim();
        if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('#')) return raw;
        const cleaned = raw.replace(/^\/+/, '').replace(/^\.?\//, '');
        if (!cleaned) {
            const targetInst = overrideInstitutionId !== null
                ? (sanitizeInstitutionSlug(overrideInstitutionId) || 'school')
                : CURRENT_INSTITUTION_ID;
            return targetInst === 'school' ? '/' : `/${targetInst}`;
        }
        const match = cleaned.match(/^([^?#]+)(.*)$/);
        const pagePart = match ? match[1] : cleaned;
        const suffixPart = match ? (match[2] || '') : '';
        if (/^company(?:\.html)?$/i.test(pagePart)) {
            return `/company${suffixPart}`;
        }
        const targetInst = overrideInstitutionId !== null
            ? (sanitizeInstitutionSlug(overrideInstitutionId) || 'school')
            : CURRENT_INSTITUTION_ID;
        if (targetInst === 'school') {
            return `/${cleaned}`;
        }
        if (pagePart.toLowerCase().startsWith(`${targetInst}/`)) {
            return `/${pagePart}${suffixPart}`;
        }
        const normalizedPage = pagePart.replace(/\.html$/i, '');
        if (!normalizedPage || normalizedPage.toLowerCase() === 'index') {
            return `/${targetInst}${suffixPart}`;
        }
        return `/${targetInst}/${normalizedPage}${suffixPart}`;
    };

    try {
        const prevInst = String(localStorage.getItem(ACTIVE_INSTITUTION_KEY) || '').trim().toLowerCase();
        if (prevInst && prevInst !== CURRENT_INSTITUTION_ID) {
            ['app_enabled_modules', 'app_current_academic_year', 'current_academic_year', 'cached_institution_logo', COMPANY_ALLOWED_PAGES_KEY].forEach(removeKey);
        }
        localStorage.setItem(ACTIVE_INSTITUTION_KEY, CURRENT_INSTITUTION_ID);
    } catch (_) {}

    const getActiveProjectId = () => {
        try {
            return String(localStorage.getItem(ACTIVE_PROJECT_KEY) || '').trim();
        } catch (_) {
            return '';
        }
    };

    const setActiveProjectId = (projectId = '') => {
        const clean = String(projectId || '').trim();
        if (!clean) return;
        try {
            localStorage.setItem(ACTIVE_PROJECT_KEY, clean);
        } catch (_) {}
    };

    const matchesProjectScope = (record = null, { ignoreInstitution = false } = {}) => {
        if (!record || typeof record !== 'object') return false;
        const activeProject = getActiveProjectId();
        if (activeProject && record.projectId !== activeProject) return false;
        if (ignoreInstitution) return true;
        const recordInst = String(record.institutionId || 'school').trim().toLowerCase();
        return recordInst === CURRENT_INSTITUTION_ID;
    };

    const rememberLastInstitution = (institutionId = '') => {
        const cleanSlug = sanitizeInstitutionSlug(institutionId);
        if (!cleanSlug || cleanSlug === 'school') return '';
        try {
            const activeProject = getActiveProjectId();
            writeJson(LAST_INSTITUTION_KEY, {
                institutionId: cleanSlug,
                ...(activeProject ? { projectId: activeProject } : {}),
                updatedAt: now()
            });
        } catch (_) {}
        return cleanSlug;
    };

    const clearLastInstitution = () => {
        try { removeKey(LAST_INSTITUTION_KEY); } catch (_) {}
    };

    const getLastInstitutionId = () => {
        const activeProject = getActiveProjectId();
        const stored = readJson(LAST_INSTITUTION_KEY);
        if (stored && typeof stored === 'object') {
            const slug = sanitizeInstitutionSlug(stored.institutionId || '');
            if (slug && slug !== 'school' && (!activeProject || !stored.projectId || stored.projectId === activeProject)) {
                return slug;
            }
        }
        // Fallback for existing logged-in users before LAST_INSTITUTION_KEY was stored
        const candidates = [
            readJson(ADMIN_STATE_KEY),
            readJson(STAFF_STATE_KEY),
            readJson(STUDENT_STATE_KEY)
        ];
        for (const rec of candidates) {
            if (!rec || typeof rec !== 'object') continue;
            if (activeProject && rec.projectId && rec.projectId !== activeProject) continue;
            const slug = sanitizeInstitutionSlug(rec.institutionId || '');
            if (slug && slug !== 'school') return slug;
        }
        const remembered = readJson(REMEMBERED_ACCOUNTS_KEY);
        if (Array.isArray(remembered)) {
            for (const acc of remembered) {
                if (!acc || typeof acc !== 'object') continue;
                if (activeProject && acc.projectId && acc.projectId !== activeProject) continue;
                const slug = sanitizeInstitutionSlug(acc.institutionId || '');
                if (slug && slug !== 'school') return slug;
            }
        }
        return '';
    };

    const setCurrentRole = (role = '') => {
        if (role) {
            sessionStorage.setItem(CURRENT_ROLE_KEY, role);
            localStorage.setItem(CURRENT_ROLE_KEY, role);
        } else {
            sessionStorage.removeItem(CURRENT_ROLE_KEY);
            localStorage.removeItem(CURRENT_ROLE_KEY);
        }
    };

    const getCompanyState = () => {
        const state = readJson(COMPANY_STATE_KEY);
        return matchesProjectScope(state, { ignoreInstitution: true }) ? state : null;
    };

    const getRole = () => {
        const storedRole = sessionStorage.getItem(CURRENT_ROLE_KEY) || localStorage.getItem(CURRENT_ROLE_KEY);
        if (storedRole) {
            if (storedRole === 'company' && isCompanyStateFresh(getCompanyState())) return 'company';
            if (storedRole === 'student' && getStudentState()?.studentId) return 'student';
            if (storedRole === 'staff' && isStateFresh(getStaffState(), 'staff')) return 'staff';
            if (storedRole === 'admin' && isStateFresh(getAdminState(), 'admin')) return 'admin';
        }
        if (isCompanyStateFresh(getCompanyState())) return 'company';
        if (getStudentState()?.studentId) return 'student';
        if (isStateFresh(getStaffState(), 'staff')) return 'staff';
        if (isStateFresh(getAdminState(), 'admin')) return 'admin';
        return '';
    };

    const buildState = (extra = {}) => {
        const timestamp = now();
        const projectId = getActiveProjectId();
        return {
            startedAt: timestamp,
            lastActiveAt: timestamp,
            institutionId: CURRENT_INSTITUTION_ID,
            ...(projectId ? { projectId } : {}),
            ...extra
        };
    };

    const getSessionPolicy = (role = '') => ROLE_SESSION_POLICY[role] || {
        maxAgeMs: DEFAULT_SESSION_MAX_AGE_MS,
        idleMs: DEFAULT_SESSION_IDLE_MAX_AGE_MS
    };

    const isStateFresh = (state, _role = getRole()) => {
        if (!state || !state.lastActiveAt || !state.startedAt) return false;
        if (!matchesProjectScope(state)) return false;
        return true;
    };

    const isCompanyStateFresh = (state) => {
        if (!state || !state.lastActiveAt || !state.startedAt) return false;
        return matchesProjectScope(state, { ignoreInstitution: true });
    };

    const getStaffState = () => {
        const state = readJson(STAFF_STATE_KEY);
        return matchesProjectScope(state) ? state : null;
    };
    const getAdminState = () => {
        const state = readJson(ADMIN_STATE_KEY);
        return matchesProjectScope(state) ? state : null;
    };
    const getStudentState = () => {
        const state = readJson(STUDENT_STATE_KEY);
        return matchesProjectScope(state) ? state : null;
    };
    const getStudentAccounts = () => {
        const accounts = readJson(STUDENT_ACCOUNTS_KEY);
        if (!Array.isArray(accounts)) return [];
        const activeProject = getActiveProjectId();
        return accounts.filter((a) => {
            if (!a) return false;
            if (activeProject && a.projectId !== activeProject) return false;
            return String(a.institutionId || 'school').trim().toLowerCase() === CURRENT_INSTITUTION_ID;
        });
    };
    const saveStudentAccounts = (accounts = []) => {
        const activeProject = getActiveProjectId();
        const allStored = readJson(STUDENT_ACCOUNTS_KEY);
        const otherTenants = Array.isArray(allStored)
            ? allStored.filter((a) => a && (!activeProject || a.projectId === activeProject) && String(a.institutionId || 'school').trim().toLowerCase() !== CURRENT_INSTITUTION_ID)
            : [];
        const stamped = (Array.isArray(accounts) ? accounts : []).map((a) => ({
            ...a,
            institutionId: CURRENT_INSTITUTION_ID,
            ...(activeProject ? { projectId: activeProject } : {})
        }));
        writeJson(STUDENT_ACCOUNTS_KEY, [...stamped, ...otherTenants]);
    };

    const isStudentAccountRecord = (account = null) => Boolean(
        account && (account.role === 'student' || (!account.role && account.studentId))
    );

    const getDismissedGroupStudentIds = () => {
        const raw = readJson(DISMISSED_GROUP_STUDENTS_KEY);
        if (!raw) return [];
        const activeProject = getActiveProjectId();
        if (Array.isArray(raw)) {
            return (activeProject || CURRENT_INSTITUTION_ID !== 'school') ? [] : raw.map((id) => String(id || '').trim()).filter(Boolean);
        }
        if (typeof raw === 'object') {
            if (activeProject && raw.projectId && raw.projectId !== activeProject) return [];
            if (String(raw.institutionId || 'school').trim().toLowerCase() !== CURRENT_INSTITUTION_ID) return [];
            const ids = Array.isArray(raw.ids) ? raw.ids : [];
            return ids.map((id) => String(id || '').trim()).filter(Boolean);
        }
        return [];
    };

    const saveDismissedGroupStudentIds = (ids = []) => {
        const activeProject = getActiveProjectId();
        const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
        if (!unique.length) {
            removeKey(DISMISSED_GROUP_STUDENTS_KEY);
            return;
        }
        writeJson(DISMISSED_GROUP_STUDENTS_KEY, {
            institutionId: CURRENT_INSTITUTION_ID,
            ...(activeProject ? { projectId: activeProject } : {}),
            ids: unique
        });
    };

    const dismissGroupStudent = (studentId = '') => {
        const cleanId = String(studentId || '').trim();
        if (!cleanId) return;
        const current = getDismissedGroupStudentIds();
        if (!current.includes(cleanId)) {
            saveDismissedGroupStudentIds([...current, cleanId]);
        }
    };

    const undismissGroupStudent = (studentId = '') => {
        const cleanId = String(studentId || '').trim();
        if (!cleanId) return;
        const current = getDismissedGroupStudentIds();
        if (current.includes(cleanId)) {
            saveDismissedGroupStudentIds(current.filter((id) => id !== cleanId));
        }
    };

    const clearDismissedGroupStudents = () => {
        removeKey(DISMISSED_GROUP_STUDENTS_KEY);
    };

    const getRememberedAccounts = () => {
        let accounts = readJson(REMEMBERED_ACCOUNTS_KEY);
        const activeProject = getActiveProjectId();
        if (!Array.isArray(accounts)) {
            const legacyStudents = getStudentAccounts();
            accounts = legacyStudents.map((st) => ({
                id: st.studentId,
                role: 'student',
                studentId: st.studentId,
                name: st.name || '',
                class: st.class || '',
                adm: st.adm || '',
                ...(st.groupId ? { groupId: st.groupId } : {}),
                ...(st.groupName ? { groupName: st.groupName } : {}),
                ...(st.projectId || activeProject ? { projectId: st.projectId || activeProject } : {}),
                updatedAt: st.updatedAt || now()
            }));
            if (accounts.length) writeJson(REMEMBERED_ACCOUNTS_KEY, accounts);
        }
        if (!Array.isArray(accounts)) return [];
        // Strictly restrict remembered multi-account switching to student accounts for the current institution
        const studentOnly = accounts.filter((a) => isStudentAccountRecord(a) && String(a.institutionId || 'school').trim().toLowerCase() === CURRENT_INSTITUTION_ID);
        if (!activeProject) return studentOnly;
        return studentOnly.filter((a) => a.projectId === activeProject);
    };

    const saveRememberedAccounts = (accounts = []) => {
        const activeProject = getActiveProjectId();
        const rawStored = readJson(REMEMBERED_ACCOUNTS_KEY);
        const otherTenantAccounts = Array.isArray(rawStored)
            ? rawStored.filter((a) => isStudentAccountRecord(a) && (!activeProject || a.projectId === activeProject) && String(a.institutionId || 'school').trim().toLowerCase() !== CURRENT_INSTITUTION_ID)
            : [];
        const studentOnly = (Array.isArray(accounts) ? accounts : [])
            .filter((a) => isStudentAccountRecord(a))
            .map((a) => ({
                ...a,
                role: 'student',
                studentId: a.studentId || a.id,
                id: a.id || a.studentId,
                institutionId: CURRENT_INSTITUTION_ID,
                ...(activeProject ? { projectId: activeProject } : {})
            }));
        writeJson(REMEMBERED_ACCOUNTS_KEY, [...studentOnly, ...otherTenantAccounts]);
        saveStudentAccounts(studentOnly.map((s) => ({
            studentId: s.studentId || s.id,
            name: s.name || '',
            class: s.class || '',
            adm: s.adm || '',
            ...(s.groupId ? { groupId: s.groupId } : {}),
            ...(s.groupName ? { groupName: s.groupName } : {}),
            institutionId: CURRENT_INSTITUTION_ID,
            ...(activeProject ? { projectId: activeProject } : {}),
            updatedAt: s.updatedAt
        })));
    };

    const registerRememberedAccount = (accountData = {}, options = {}) => {
        if (!accountData || !accountData.id || !isStudentAccountRecord(accountData)) return;
        const currentAccounts = getRememberedAccounts();
        const activeProject = getActiveProjectId();
        const targetId = String(accountData.studentId || accountData.id);
        const existingIndex = currentAccounts.findIndex((a) => String(a.studentId || a.id) === targetId);
        const existing = existingIndex >= 0 ? currentAccounts[existingIndex] : null;
        const nextAccount = {
            ...(existing || {}),
            ...accountData,
            id: targetId,
            studentId: targetId,
            role: 'student',
            institutionId: CURRENT_INSTITUTION_ID,
            ...(activeProject ? { projectId: activeProject } : {}),
            updatedAt: now()
        };

        let updatedAccounts;
        if (options.keepOrder && existingIndex >= 0) {
            updatedAccounts = currentAccounts.map((acc, idx) => (idx === existingIndex ? nextAccount : acc));
        } else if (options.append) {
            const withoutExisting = currentAccounts.filter((a) => String(a.studentId || a.id) !== targetId);
            updatedAccounts = [...withoutExisting, nextAccount];
        } else {
            updatedAccounts = [nextAccount, ...currentAccounts.filter((a) => String(a.studentId || a.id) !== targetId)];
        }
        saveRememberedAccounts(updatedAccounts.slice(0, 25));
    };

    const getStateByRole = (role) => {
        if (role === 'company') return getCompanyState();
        if (role === 'staff') return getStaffState();
        if (role === 'admin') return getAdminState();
        if (role === 'student') return getStudentState();
        return null;
    };

    const setFlash = (message) => {
        if (message) sessionStorage.setItem(FLASH_KEY, message);
    };

    const clearClientData = async ({ clearRememberedStudents = false } = {}) => {
        try {
            const preserve = {};
            if (!clearRememberedStudents) {
                const savedStudentAccounts = localStorage.getItem(STUDENT_ACCOUNTS_KEY);
                if (savedStudentAccounts) preserve[STUDENT_ACCOUNTS_KEY] = savedStudentAccounts;
                const savedRemembered = localStorage.getItem(REMEMBERED_ACCOUNTS_KEY);
                if (savedRemembered) preserve[REMEMBERED_ACCOUNTS_KEY] = savedRemembered;
                const savedDismissed = localStorage.getItem(DISMISSED_GROUP_STUDENTS_KEY);
                if (savedDismissed) preserve[DISMISSED_GROUP_STUDENTS_KEY] = savedDismissed;
            }
            const savedProject = localStorage.getItem(ACTIVE_PROJECT_KEY);
            if (savedProject) preserve[ACTIVE_PROJECT_KEY] = savedProject;
            const savedInst = localStorage.getItem(ACTIVE_INSTITUTION_KEY);
            if (savedInst) preserve[ACTIVE_INSTITUTION_KEY] = savedInst;
            const savedLastInst = localStorage.getItem(LAST_INSTITUTION_KEY);
            if (savedLastInst) preserve[LAST_INSTITUTION_KEY] = savedLastInst;
            localStorage.clear();
            Object.entries(preserve).forEach(([key, value]) => localStorage.setItem(key, value));
        } catch (error) {
            console.warn('Local storage clear failed.', error);
        }

        if ('caches' in window) {
            try {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
            } catch (error) {
                console.warn('Cache storage clear failed.', error);
            }
        }
    };

    const clearAll = async (options = {}) => {
        [STAFF_STATE_KEY, ADMIN_STATE_KEY, STUDENT_STATE_KEY, COMPANY_STATE_KEY, OFFICIAL_SESSION_KEY].forEach(removeKey);
        if (options.clearRememberedStudents) {
            [STUDENT_ACCOUNTS_KEY, REMEMBERED_ACCOUNTS_KEY, DISMISSED_GROUP_STUDENTS_KEY].forEach(removeKey);
        }
        setCurrentRole('');
        if (options.purgeClientData) {
            await clearClientData({ clearRememberedStudents: options.clearRememberedStudents === true });
        }
        if (options.redirectUrl) {
            window.location.href = buildPageUrl(options.redirectUrl);
        }
    };

    const syncFirebaseProject = (projectId = '') => {
        const cleanProject = String(projectId || '').trim();
        if (!cleanProject) return false;
        const previousProject = getActiveProjectId();
        const rawRemembered = readJson(REMEMBERED_ACCOUNTS_KEY);
        const rawStudents = readJson(STUDENT_ACCOUNTS_KEY);
        const rawStaff = readJson(STAFF_STATE_KEY);
        const rawAdmin = readJson(ADMIN_STATE_KEY);
        const rawStudent = readJson(STUDENT_STATE_KEY);
        const rawCompany = readJson(COMPANY_STATE_KEY);

        const hasStaleOrUntaggedRemembered = Array.isArray(rawRemembered) && rawRemembered.some((a) => !a || a.projectId !== cleanProject);
        const hasStaleOrUntaggedStudents = Array.isArray(rawStudents) && rawStudents.some((a) => !a || a.projectId !== cleanProject);
        const hasStaleOrUntaggedSession = [rawStaff, rawAdmin, rawStudent, rawCompany].some((s) => s && s.projectId !== cleanProject);

        const projectChanged = Boolean(previousProject && previousProject !== cleanProject);
        const needsLegacyPurge = !previousProject && (hasStaleOrUntaggedRemembered || hasStaleOrUntaggedStudents || hasStaleOrUntaggedSession);

        if (projectChanged || needsLegacyPurge || hasStaleOrUntaggedRemembered || hasStaleOrUntaggedStudents || hasStaleOrUntaggedSession) {
            [
                STAFF_STATE_KEY,
                ADMIN_STATE_KEY,
                STUDENT_STATE_KEY,
                COMPANY_STATE_KEY,
                COMPANY_ALLOWED_PAGES_KEY,
                STUDENT_ACCOUNTS_KEY,
                REMEMBERED_ACCOUNTS_KEY,
                DISMISSED_GROUP_STUDENTS_KEY,
                OFFICIAL_SESSION_KEY,
                'app_enabled_modules',
                'app_current_academic_year',
                'current_academic_year'
            ].forEach(removeKey);
            setCurrentRole('');
            setActiveProjectId(cleanProject);
            return projectChanged || needsLegacyPurge;
        }

        setActiveProjectId(cleanProject);
        return false;
    };

    const pruneExpiredStates = () => {
        const companyState = readJson(COMPANY_STATE_KEY);
        if (companyState && !isCompanyStateFresh(companyState)) removeKey(COMPANY_STATE_KEY);
        const staffState = readJson(STAFF_STATE_KEY);
        if (staffState && !isStateFresh(staffState, 'staff')) removeKey(STAFF_STATE_KEY);
        const adminState = readJson(ADMIN_STATE_KEY);
        if (adminState && !isStateFresh(adminState, 'admin')) removeKey(ADMIN_STATE_KEY);
        const studentState = readJson(STUDENT_STATE_KEY);
        if (studentState && (!studentState.studentId || !matchesProjectScope(studentState))) removeKey(STUDENT_STATE_KEY);
    };

    const touchSession = () => {
        const role = getRole();
        const state = getStateByRole(role);
        if (!state) return;
        const targetKey = role === 'company'
            ? COMPANY_STATE_KEY
            : (role === 'admin' ? ADMIN_STATE_KEY : role === 'staff' ? STAFF_STATE_KEY : STUDENT_STATE_KEY);
        writeJson(targetKey, {
            ...state,
            lastActiveAt: now()
        });
    };

    const hasCompanySession = () => isCompanyStateFresh(getCompanyState());
    const hasStaffSession = () => isStateFresh(getStaffState(), 'staff');
    const hasAdminSession = () => isStateFresh(getAdminState(), 'admin');
    const hasStudentSession = () => Boolean(getStudentState()?.studentId);

    const setCompanyAllowedPages = (allowedPages = null, overrideInstitutionId = null) => {
        try {
            if (!allowedPages || typeof allowedPages !== 'object') {
                removeKey(COMPANY_ALLOWED_PAGES_KEY);
                return;
            }
            const targetInst = overrideInstitutionId
                ? (sanitizeInstitutionSlug(overrideInstitutionId) || CURRENT_INSTITUTION_ID)
                : CURRENT_INSTITUTION_ID;
            writeJson(COMPANY_ALLOWED_PAGES_KEY, {
                institutionId: targetInst,
                pages: allowedPages
            });
        } catch (_) {}
    };

    const getCompanyAllowedPages = () => {
        try {
            const stored = readJson(COMPANY_ALLOWED_PAGES_KEY);
            if (!stored || typeof stored !== 'object') return null;
            if (String(stored.institutionId || 'school').trim().toLowerCase() !== CURRENT_INSTITUTION_ID) return null;
            return stored.pages && typeof stored.pages === 'object' ? stored.pages : null;
        } catch (_) {
            return null;
        }
    };

    const isCompanyPageAllowed = (pageKey = '') => {
        const pages = getCompanyAllowedPages();
        if (!pages) return true;
        if (pageKey === 'evaluation' && pages.classroomEvaluation === false) return false;
        if (pageKey === 'classroomEvaluation' && pages.evaluation === false) return false;
        if (pageKey === 'activity' && pages.studentActivity === false) return false;
        if (pageKey === 'studentActivity' && pages.activity === false) return false;
        return pages[pageKey] !== false;
    };

    const redirectHome = (message = '') => {
        setFlash(message);
        window.location.href = buildPageUrl('index.html');
    };

    // Preserve /<slug>/ routing when static HTML anchors link to sibling pages
    if (typeof document !== 'undefined') {
        document.addEventListener('click', (event) => {
            if (CURRENT_INSTITUTION_ID === 'school') return;
            const anchor = event.target?.closest?.('a[href]');
            if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
            const href = String(anchor.getAttribute('href') || '').trim();
            if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith(`/${CURRENT_INSTITUTION_ID}/`)) return;
            if (/^\.?\/?[a-z0-9-_]+\.html(?:[?#].*)?$/i.test(href)) {
                event.preventDefault();
                window.location.href = buildPageUrl(href);
            }
        });
    }

    let activityBound = false;
    const bindActivityTracking = () => {
        if (activityBound) return;
        activityBound = true;

        let lastTouch = 0;
        const throttledTouch = () => {
            const currentTime = now();
            if ((currentTime - lastTouch) < 15000) return;
            lastTouch = currentTime;
            touchSession();
        };

        ['click', 'keydown', 'pointerdown', 'focus'].forEach((eventName) => {
            window.addEventListener(eventName, throttledTouch, { passive: true });
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') throttledTouch();
        });
    };

    pruneExpiredStates();
    bindActivityTracking();

    window.AppSession = {
        SESSION_MAX_AGE_MS: DEFAULT_SESSION_MAX_AGE_MS,
        SESSION_IDLE_MAX_AGE_MS: DEFAULT_SESSION_IDLE_MAX_AGE_MS,
        SESSION_POLICY: ROLE_SESSION_POLICY,
        getInstitutionId,
        getLastInstitutionId,
        rememberLastInstitution,
        clearLastInstitution,
        buildPageUrl,
        getActiveProjectId,
        syncFirebaseProject,
        clearAll,
        async signOut(authInstance, options = {}) {
            const wasCompany = getRole() === 'company' || hasCompanySession();
            try {
                if (authInstance && typeof authInstance.signOut === 'function') {
                    await authInstance.signOut();
                } else if (window.__firebaseAuth && typeof window.__firebaseAuth.signOut === 'function') {
                    await window.__firebaseAuth.signOut();
                }
            } catch (err) {
                console.warn('Firebase sign out failed:', err);
            }
            await clearAll({ purgeClientData: true, clearRememberedStudents: true });
            const redirectUrl = options.redirectUrl !== undefined ? options.redirectUrl : 'index.html?public=1';
            if (redirectUrl) {
                window.location.href = wasCompany ? `/${String(redirectUrl).replace(/^\/+/, '')}` : buildPageUrl(redirectUrl);
            }
        },
        async revokeCurrentAccount(options = {}) {
            const {
                accountId = '',
                message = 'Your account is no longer active or has been removed by the administrator.',
                authInstance = null,
                redirectUrl = 'index.html'
            } = options;

            const role = getRole();
            const resolvedAccountIds = new Set();
            if (accountId) resolvedAccountIds.add(accountId);
            if (role === 'student') {
                const sid = getStudentState()?.studentId;
                if (sid) resolvedAccountIds.add(sid);
            } else if (role === 'staff') {
                const staffState = getStaffState();
                const official = readJson(OFFICIAL_SESSION_KEY) || {};
                const candidates = [
                    staffState?.staffId,
                    staffState?.email,
                    staffState?.access?.entryId,
                    staffState?.access?.staffId,
                    official?.id,
                    official?.email
                ].filter(Boolean);
                candidates.forEach((c) => {
                    resolvedAccountIds.add(c);
                    resolvedAccountIds.add(`staff_${c}`);
                    resolvedAccountIds.add(`dir_${c}`);
                });
            } else if (role === 'admin') {
                const adminState = getAdminState();
                const email = adminState?.email || '';
                resolvedAccountIds.add('admin_master');
                if (email) resolvedAccountIds.add(`admin_${email}`);
            }

            if (resolvedAccountIds.size > 0) {
                const filteredRemembered = getRememberedAccounts().filter((a) => {
                    if (!a) return false;
                    if (resolvedAccountIds.has(a.id)) return false;
                    if (a.studentId && resolvedAccountIds.has(a.studentId)) return false;
                    if (a.staffId && resolvedAccountIds.has(a.staffId)) return false;
                    if (a.entryId && resolvedAccountIds.has(a.entryId)) return false;
                    if (a.email && resolvedAccountIds.has(a.email)) return false;
                    return true;
                });
                saveRememberedAccounts(filteredRemembered);
            }

            if (message) setFlash(message);
            await clearAll({ purgeClientData: true });
            try {
                const authRef = authInstance || window.__firebaseAuth;
                if (authRef && typeof authRef.signOut === 'function') {
                    await authRef.signOut();
                }
            } catch (err) {
                console.warn('Sign out on account revocation warning:', err);
            }
            if (redirectUrl) {
                window.location.replace(buildPageUrl(redirectUrl));
            }
        },
        consumeFlash() {
            const message = sessionStorage.getItem(FLASH_KEY) || '';
            if (message) sessionStorage.removeItem(FLASH_KEY);
            return message;
        },
        getStartedAt() {
            const role = getRole();
            const state = getStateByRole(role);
            return Number(state?.startedAt || 0);
        },
        getLastActiveAt() {
            const role = getRole();
            const state = getStateByRole(role);
            return Number(state?.lastActiveAt || 0);
        },
        getRole,
        getRolePolicy(role = getRole()) {
            return getSessionPolicy(role);
        },
        getStudentId() {
            const state = getStudentState();
            return state?.studentId || '';
        },
        getStaffName() {
            const state = getStaffState();
            if (state?.name) return state.name;
            const official = readJson(OFFICIAL_SESSION_KEY);
            return matchesProjectScope(official) ? (official?.name || '') : '';
        },
        getStaffEmail() {
            const state = getStaffState();
            if (state?.email) return state.email;
            const official = readJson(OFFICIAL_SESSION_KEY);
            return matchesProjectScope(official) ? (official?.email || official?.username || '') : '';
        },
        isFresh() {
            const role = getRole();
            return isStateFresh(getStateByRole(role), role);
        },
        isModuleEnabled(moduleKey) {
            if (!isCompanyPageAllowed(moduleKey)) return false;
            try {
                const raw = localStorage.getItem('app_enabled_modules');
                if (!raw) return true;
                const parsed = JSON.parse(raw);
                return parsed?.[moduleKey] !== false;
            } catch (_e) {
                return true;
            }
        },
        setCompanyAllowedPages,
        getCompanyAllowedPages,
        isCompanyPageAllowed,
        hasCompanySession,
        getCompanyState,
        startCompany(companyProfile = {}) {
            const email = String(companyProfile?.email || '').trim().toLowerCase();
            const name = companyProfile?.name || 'Company Owner';
            const companyName = companyProfile?.companyName || 'Platform Master Console';
            const projectId = getActiveProjectId();
            const timestamp = now();
            writeJson(COMPANY_STATE_KEY, {
                startedAt: timestamp,
                lastActiveAt: timestamp,
                ...(projectId ? { projectId } : {}),
                role: 'company',
                name,
                email,
                companyName
            });
            setCurrentRole('company');
        },
        hasStudentSession,
        hasStaffSession,
        hasAdminSession,
        startStudent(studentId, profile = {}) {
            if (!studentId) return;
            undismissGroupStudent(studentId);
            writeJson(STUDENT_STATE_KEY, buildState({ studentId, role: 'student' }));
            rememberLastInstitution(CURRENT_INSTITUTION_ID);
            registerRememberedAccount({
                id: studentId,
                role: 'student',
                studentId,
                name: profile.name || '',
                class: profile.class || '',
                adm: profile.adm || '',
                ...(profile.groupId ? { groupId: profile.groupId } : {}),
                ...(profile.groupName ? { groupName: profile.groupName } : {})
            });
            setCurrentRole('student');
        },
        registerStudentAccount(studentId, profile = {}, options = {}) {
            if (!studentId) return;
            registerRememberedAccount({
                id: studentId,
                role: 'student',
                studentId,
                name: profile.name || '',
                class: profile.class || '',
                adm: profile.adm || '',
                ...(profile.groupId ? { groupId: profile.groupId } : {}),
                ...(profile.groupName ? { groupName: profile.groupName } : {})
            }, {
                append: options.append !== false,
                keepOrder: options.keepOrder === true
            });
        },
        getDismissedGroupStudentIds,
        dismissGroupStudent,
        clearDismissedGroupStudents,
        getStudentAccounts() {
            return getStudentAccounts();
        },
        switchStudent(studentId = '') {
            const account = getStudentAccounts().find((item) => item.studentId === studentId);
            if (!account) return false;
            this.startStudent(studentId, account);
            return true;
        },
        logoutStudent(studentId = '', { removeAccount = false } = {}) {
            const targetId = String(studentId || this.getStudentId() || '').trim();
            if (removeAccount && targetId) {
                const nextAccounts = getStudentAccounts().filter((account) => account.studentId !== targetId);
                saveStudentAccounts(nextAccounts);
                const nextRemembered = getRememberedAccounts().filter((a) => a.id !== targetId && a.studentId !== targetId);
                saveRememberedAccounts(nextRemembered);
                dismissGroupStudent(targetId);
            }
            if (!studentId || targetId === this.getStudentId()) {
                removeKey(STUDENT_STATE_KEY);
                if (getRole() === 'student') setCurrentRole('');
            }
        },
        startStaff(name = '', email = '', access = null, overrideInstitutionId = null) {
            const targetInst = overrideInstitutionId
                ? (sanitizeInstitutionSlug(overrideInstitutionId) || CURRENT_INSTITUTION_ID)
                : CURRENT_INSTITUTION_ID;
            try { localStorage.setItem(ACTIVE_INSTITUTION_KEY, targetInst); } catch (_) {}
            const dutyClasses = Array.isArray(access?.dutyClasses) ? access.dutyClasses.filter(Boolean) : [];
            const staffId = access?.staffId || access?.entryId || email || name;
            const source = access?.source === 'directory' ? 'directory' : 'staff';
            const profile = {
                id: staffId,
                staffId,
                name: name || 'Staff Member',
                email: email || '',
                role: access?.role || access?.type || 'Staff Member',
                type: access?.type || (source === 'directory' ? 'Category User' : 'Staff'),
                phone: access?.phone || '',
                photo: access?.photo || '',
                dutyClasses
            };
            writeJson(STAFF_STATE_KEY, buildState({
                institutionId: targetInst,
                name,
                email,
                role: 'staff',
                staffId,
                dutyClasses,
                profile,
                access: access && typeof access === 'object' ? access : null
            }));
            rememberLastInstitution(targetInst);
            setCurrentRole('staff');
        },
        getStaffAccess() {
            const state = getStaffState();
            return (state?.access && typeof state.access === 'object') ? state.access : null;
        },
        getStaffState() {
            const state = getStaffState();
            if (!state) return null;
            if (!state.profile) {
                const dutyClasses = Array.isArray(state.dutyClasses) ? state.dutyClasses
                    : (Array.isArray(state.access?.dutyClasses) ? state.access.dutyClasses : []);
                state.profile = {
                    id: state.staffId || state.access?.staffId || '',
                    staffId: state.staffId || state.access?.staffId || '',
                    name: state.name || '',
                    email: state.email || '',
                    role: state.access?.role || state.access?.type || 'Staff',
                    type: state.access?.type || 'Staff',
                    phone: state.access?.phone || '',
                    photo: state.access?.photo || '',
                    dutyClasses
                };
            }
            return state;
        },
        getAdminState() {
            return getAdminState();
        },
        getDutyClasses() {
            const staffState = this.getStaffState();
            if (Array.isArray(staffState?.dutyClasses) && staffState.dutyClasses.length) {
                return staffState.dutyClasses.filter(Boolean);
            }
            if (Array.isArray(staffState?.access?.dutyClasses) && staffState.access.dutyClasses.length) {
                return staffState.access.dutyClasses.filter(Boolean);
            }
            const officialSession = readJson(OFFICIAL_SESSION_KEY);
            if (matchesProjectScope(officialSession) && Array.isArray(officialSession?.dutyClasses) && officialSession.dutyClasses.length) {
                return officialSession.dutyClasses.filter(Boolean);
            }
            return [];
        },
        getSession() {
            const role = getRole();
            if (role === 'admin' || hasAdminSession()) {
                const adminState = getAdminState() || {};
                return {
                    id: 'admin',
                    staffId: 'admin',
                    name: adminState.name || 'Administrator',
                    username: adminState.email || 'admin',
                    email: adminState.email || 'admin',
                    role: 'Super Admin',
                    type: 'Admin',
                    source: 'legacy-admin',
                    actLikeSuperAdmin: true,
                    canAccessAdmin: true
                };
            }
            if (role === 'staff' || hasStaffSession()) {
                const state = this.getStaffState() || {};
                const rawOfficial = readJson(OFFICIAL_SESSION_KEY);
                const official = (rawOfficial && matchesProjectScope(rawOfficial)) ? rawOfficial : {};
                const access = state.access || official.access || {};
                const dutyClasses = this.getDutyClasses();
                return {
                    id: state.staffId || access.staffId || access.entryId || official.id || '',
                    staffId: state.staffId || access.staffId || official.id || '',
                    name: state.name || official.name || 'Staff Member',
                    username: state.email || official.username || official.email || '',
                    email: state.email || official.email || '',
                    phone: access.phone || official.phone || '',
                    role: access.role || official.role || 'Staff',
                    type: access.type || official.type || 'Staff',
                    photo: access.photo || official.photo || '',
                    dutyClasses,
                    access,
                    profile: state.profile || {
                        id: state.staffId || access.staffId || official.id || '',
                        name: state.name || official.name || 'Staff Member',
                        email: state.email || official.email || '',
                        role: access.role || official.role || 'Staff',
                        dutyClasses
                    },
                    source: access.source || official.source || 'staff',
                    categoryId: access.categoryId || official.categoryId || '',
                    actLikeSuperAdmin: access.actLikeSuperAdmin === true || official.actLikeSuperAdmin === true
                };
            }
            return null;
        },
        getUserSession() {
            return this.getSession() || {};
        },
        getCurrentSessionProfile() {
            const session = this.getSession();
            if (!session) return {};
            return {
                id: session.id || session.staffId || '',
                staffId: session.staffId || session.id || '',
                name: session.name || '',
                username: session.username || session.email || '',
                email: session.email || '',
                role: session.role || 'Staff',
                type: session.type || 'Staff',
                phone: session.phone || '',
                photo: session.photo || '',
                dutyClasses: session.dutyClasses || [],
                access: session.access || null
            };
        },
        getStaffProfile() {
            return this.getCurrentSessionProfile();
        },
        updateStaffAccess(partialAccess = {}) {
            const state = getStaffState();
            if (!state) return;
            const currentAccess = (state.access && typeof state.access === 'object') ? state.access : {};
            const updatedAccess = { ...currentAccess, ...partialAccess };
            const dutyClasses = Array.isArray(partialAccess.dutyClasses) ? partialAccess.dutyClasses.filter(Boolean)
                : (Array.isArray(state.dutyClasses) ? state.dutyClasses : []);
            const staffId = partialAccess.staffId || state.staffId || state.access?.staffId || '';
            const name = partialAccess.name || state.name || '';
            const updatedProfile = {
                ...(state.profile || {}),
                ...(staffId ? { id: staffId, staffId } : {}),
                ...(name ? { name } : {}),
                ...(dutyClasses.length ? { dutyClasses } : {})
            };
            writeJson(STAFF_STATE_KEY, {
                ...state,
                name: name || state.name,
                staffId: staffId || state.staffId,
                dutyClasses: dutyClasses.length ? dutyClasses : state.dutyClasses,
                profile: updatedProfile,
                access: updatedAccess
            });
        },
        startAdmin(adminProfile = {}) {
            const email = String(adminProfile?.email || 'admin').trim().toLowerCase();
            const name = adminProfile?.name || 'Administrator';
            const targetInst = adminProfile?.institutionId
                ? (sanitizeInstitutionSlug(adminProfile.institutionId) || CURRENT_INSTITUTION_ID)
                : CURRENT_INSTITUTION_ID;
            try { localStorage.setItem(ACTIVE_INSTITUTION_KEY, targetInst); } catch (_) {}
            writeJson(ADMIN_STATE_KEY, buildState({ institutionId: targetInst, role: 'admin', name, email }));
            rememberLastInstitution(targetInst);
            setCurrentRole('admin');
        },
        getRememberedAccounts() {
            return getRememberedAccounts();
        },
        switchAccount(accountId = '') {
            const account = getRememberedAccounts().find((a) => a.id === accountId);
            if (!account) return false;
            const activeProject = getActiveProjectId();

            if (account.role === 'student') {
                removeKey(STAFF_STATE_KEY);
                removeKey(ADMIN_STATE_KEY);
                removeKey(OFFICIAL_SESSION_KEY);
                this.startStudent(account.studentId || account.id, account);
                window.location.href = buildPageUrl('student.html');
                return true;
            }

            if (account.role === 'staff' || account.role === 'directory') {
                removeKey(STUDENT_STATE_KEY);
                removeKey(ADMIN_STATE_KEY);
                const dutyClasses = Array.isArray(account.dutyClasses) && account.dutyClasses.length
                    ? account.dutyClasses
                    : (Array.isArray(account.access?.dutyClasses) ? account.access.dutyClasses : []);
                const source = account.source === 'directory' || account.role === 'directory' ? 'directory' : 'staff';
                const staffAccess = account.access || {
                    staffId: account.staffId || account.entryId || '',
                    entryId: account.entryId || '',
                    categoryId: account.categoryId || '',
                    name: account.name || 'Staff Member',
                    role: account.roleTitle || 'Staff',
                    dutyClasses,
                    source,
                    worksheet: true
                };
                if (!staffAccess.dutyClasses || !staffAccess.dutyClasses.length) {
                    staffAccess.dutyClasses = dutyClasses;
                }
                this.startStaff(account.name, account.email || account.loginId || '', staffAccess);

                const officialSessionObj = {
                    institutionId: CURRENT_INSTITUTION_ID,
                    ...(activeProject ? { projectId: activeProject } : {}),
                    id: account.staffId || account.entryId || '',
                    name: account.name || 'Staff Member',
                    username: account.email || account.loginId || 'staff',
                    email: account.email || '',
                    phone: staffAccess.phone || '',
                    role: account.roleTitle || staffAccess.role || 'Staff',
                    type: staffAccess.type || (source === 'directory' ? 'Category User' : 'Staff'),
                    photo: staffAccess.photo || '',
                    dutyClasses,
                    categoryId: account.categoryId || staffAccess.categoryId || '',
                    canAccessAdmin: staffAccess.admin === true || staffAccess.canAccessAdmin === true,
                    actLikeSuperAdmin: staffAccess.actLikeSuperAdmin === true,
                    canCollect: staffAccess.collection === true,
                    canAccessWorksheet: staffAccess.worksheet !== false,
                    canManageResults: staffAccess.result === true,
                    canAccessAttendance: staffAccess.attendance === true,
                    canAccessAcademicPlan: staffAccess.academicPlan === true,
                    canAccessActivity: staffAccess.studentActivity === true || staffAccess.activity === true,
                    canAccessEvaluation: staffAccess.evaluation === true,
                    source,
                    access: staffAccess
                };
                localStorage.setItem(OFFICIAL_SESSION_KEY, JSON.stringify(officialSessionObj));
                window.location.href = buildPageUrl('official.html');
                return true;
            }

            if (account.role === 'admin') {
                removeKey(STUDENT_STATE_KEY);
                removeKey(STAFF_STATE_KEY);
                this.startAdmin(account);
                const officialSessionObj = {
                    institutionId: CURRENT_INSTITUTION_ID,
                    ...(activeProject ? { projectId: activeProject } : {}),
                    id: 'admin',
                    name: account.name || 'Administrator',
                    username: account.email || 'admin',
                    email: account.email || 'admin',
                    role: 'Super Admin',
                    type: 'Admin',
                    source: 'legacy-admin',
                    canAccessAdmin: true,
                    actLikeSuperAdmin: true,
                    canCollect: true,
                    canAccessWorksheet: true,
                    canManageResults: true,
                    canAccessAttendance: true,
                    canAccessAcademicPlan: true,
                    canAccessActivity: true,
                    canAccessEvaluation: true
                };
                localStorage.setItem(OFFICIAL_SESSION_KEY, JSON.stringify(officialSessionObj));
                window.location.href = buildPageUrl('official.html');
                return true;
            }

            return false;
        },
        removeRememberedAccount(accountId = '') {
            if (!accountId) return;
            const target = getRememberedAccounts().find((a) => a.id === accountId || a.studentId === accountId);
            const updated = getRememberedAccounts().filter((a) => a.id !== accountId && a.studentId !== accountId);
            saveRememberedAccounts(updated);
            const targetStudentId = String(target?.studentId || accountId || '').trim();
            if (targetStudentId) dismissGroupStudent(targetStudentId);
            if (getStudentState()?.studentId === accountId || (target?.studentId && getStudentState()?.studentId === target.studentId)) {
                removeKey(STUDENT_STATE_KEY);
                if (getRole() === 'student') setCurrentRole('');
            }
            if ((target?.role === 'staff' || target?.role === 'directory') && getStaffState()?.staffId && (getStaffState()?.staffId === target.staffId || getStaffState()?.staffId === target.entryId || `staff_${getStaffState()?.staffId}` === accountId || `dir_${getStaffState()?.staffId}` === accountId)) {
                removeKey(STAFF_STATE_KEY);
                removeKey(OFFICIAL_SESSION_KEY);
                if (getRole() === 'staff') setCurrentRole('');
            }
            if (target?.role === 'admin' && (accountId === 'admin_master' || getAdminState())) {
                removeKey(ADMIN_STATE_KEY);
                removeKey(OFFICIAL_SESSION_KEY);
                if (getRole() === 'admin') setCurrentRole('');
            }
        },
        canViewAlumni() {
            if (hasAdminSession()) return true;
            const access = this.getStaffAccess();
            if (access?.actLikeSuperAdmin === true || access?.canAccessAdmin === true) return true;
            const duty = Array.isArray(access?.dutyClasses) ? access.dutyClasses : [];
            return duty.some(c => String(c).trim().toUpperCase() === 'ALUMNI');
        },
        touchSession,
        guardStudentPage() {
            pruneExpiredStates();
            if (!isCompanyPageAllowed('student')) {
                this.logoutStudent();
                redirectHome('Premium - Upgrade: Student Portal is not included in your plan.');
                return;
            }
            if (this.isModuleEnabled('student') === false) {
                this.logoutStudent();
                redirectHome('Student Portal is currently disabled by institution administration.');
                return;
            }
            if (!hasStudentSession()) {
                redirectHome('Please log in to continue.');
                return;
            }
            setCurrentRole('student');
            if (!this.getStudentId()) redirectHome('Please select your student profile again.');
        },
        guardStaffOrAdminPage() {
            pruneExpiredStates();
            if (!isCompanyPageAllowed('official')) {
                redirectHome('Premium - Upgrade: Official Hub is not included in your plan.');
                return;
            }
            if (hasAdminSession()) {
                setCurrentRole('admin');
                return;
            }
            if (hasStaffSession()) {
                setCurrentRole('staff');
                return;
            }
            redirectHome('Please log in to continue.');
        },
        guardStaffPageAccess(requiredPage = 'collection') {
            pruneExpiredStates();

            const MODULE_NAMES = {
                admin: 'Admin Dashboard',
                official: 'Official Hub',
                collection: 'Fee Collection',
                worksheet: 'Worksheet Hub',
                student: 'Student Directory',
                result: 'Exam Results',
                attendance: 'Attendance Register',
                academicPlan: 'Academic Planning',
                studentActivity: 'Activity & Rewards',
                activity: 'Activity & Rewards',
                classroomEvaluation: 'Classroom Evaluation',
                evaluation: 'Classroom Evaluation'
            };

            if (!isCompanyPageAllowed(requiredPage)) {
                const modName = MODULE_NAMES[requiredPage] || 'Requested';
                setFlash(`Premium - Upgrade: ${modName} is not included in your plan.`);
                window.location.href = buildPageUrl(isCompanyPageAllowed('official') ? 'official.html' : 'index.html?public=1');
                return;
            }

            // Institutional module enablement check
            const enabledModules = (function () {
                try {
                    const raw = localStorage.getItem('app_enabled_modules');
                    return raw ? JSON.parse(raw) : null;
                } catch (_e) {
                    return null;
                }
            })();

            if (enabledModules && enabledModules[requiredPage] === false) {
                const modName = MODULE_NAMES[requiredPage] || 'Requested';
                setFlash(`Module Disabled: The ${modName} module is currently disabled by institution administration.`);
                window.location.href = buildPageUrl('official.html');
                return;
            }

            if (hasAdminSession() && !hasStaffSession()) {
                setCurrentRole('admin');
                return;
            }
            if (!hasStaffSession()) {
                if (hasAdminSession()) {
                    setCurrentRole('admin');
                    return;
                }
                redirectHome('Please log in to continue.');
                return;
            }
            setCurrentRole('staff');
            const access = this.getStaffAccess();
            if (access?.actLikeSuperAdmin === true || access?.canAccessAdmin === true || access?.admin === true) {
                return;
            }
            if (requiredPage === 'collection' && access && access.collection !== true) {
                setFlash('Access Restricted: Your account does not have Fee Collection page access.');
                window.location.href = buildPageUrl('official.html');
                return;
            }
            if (requiredPage === 'worksheet' && access && access.worksheet !== true) {
                setFlash('Access Restricted: Your account does not have Class Worksheet page access.');
                window.location.href = buildPageUrl('official.html');
                return;
            }
            if (requiredPage === 'student' && access && access.student !== true) {
                setFlash('Access Restricted: Your account does not have Student page access.');
                window.location.href = buildPageUrl('official.html');
                return;
            }
            if (requiredPage === 'result' && access) {
                const hasResultAccess = access.result === true || access.canManageResults === true || access.canAccessAdmin === true || access.admin === true || access.actLikeSuperAdmin === true;
                const collectionFallback = access.collection === true && window.location.search.includes('from=collection');
                if (!hasResultAccess && !collectionFallback) {
                    setFlash('Access Restricted: Your account does not have Result System page access.');
                    window.location.href = buildPageUrl('official.html');
                    return;
                }
            }
            if (requiredPage === 'attendance' && access && access.attendance !== true) {
                setFlash('Access Restricted: Your account does not have Attendance Register page access.');
                window.location.href = buildPageUrl('official.html');
                return;
            }
            if (requiredPage === 'academicPlan' && access && access.academicPlan !== true) {
                setFlash('Access Restricted: Your account does not have Academic Planning page access.');
                window.location.href = buildPageUrl('official.html');
                return;
            }
            if (requiredPage === 'studentActivity' && access && access.studentActivity !== true && access.activity !== true) {
                setFlash('Access Restricted: Your account does not have Activity & Rewards page access.');
                window.location.href = buildPageUrl('official.html');
                return;
            }
            if ((requiredPage === 'classroomEvaluation' || requiredPage === 'evaluation') && access && access.classroomEvaluation !== true && access.evaluation !== true && access.canAccessEvaluation !== true) {
                setFlash('Access Restricted: Your account does not have Classroom Evaluation page access.');
                window.location.href = buildPageUrl('official.html');
                return;
            }
        },
        guardAdminPage() {
            pruneExpiredStates();
            if (!isCompanyPageAllowed('admin')) {
                setFlash('Premium - Upgrade: Admin Dashboard is not included in your plan.');
                window.location.href = buildPageUrl(isCompanyPageAllowed('official') ? 'official.html' : 'index.html?public=1');
                return;
            }
            const requestedTab = (window.location.hash || '#dashboard').replace('#', '') || 'dashboard';
            const wantsResultsTab = requestedTab === 'results';
            if (hasAdminSession()) {
                setCurrentRole('admin');
                return;
            }
            if (hasStaffSession()) {
                const access = this.getStaffAccess();
                if (access && (access.canAccessAdmin === true || access.admin === true || access.actLikeSuperAdmin === true)) {
                    setCurrentRole('staff');
                    return;
                }
            }
            if (wantsResultsTab && hasStaffSession()) {
                // Allow result-operator/staff users to reach admin.html#results.
                // admin-page.js will perform strict Firebase + permission checks.
                setCurrentRole('staff');
                return;
            }
            redirectHome('Please log in to continue.');
        },
        guardCompanyPage() {
            pruneExpiredStates();
            if (!hasCompanySession()) {
                setFlash('Please log in with a Company Owner account to access the Platform Console.');
                window.location.href = '/?public=1';
                return;
            }
            setCurrentRole('company');
        }
    };
}());
