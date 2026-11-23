import { signOut, onAuthStateChanged} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, onSnapshot, collection, getDocs, writeBatch, setDoc, query, where, getDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth } from '../../config/firebase-config.js';
import { ADMIN_AUTH_DOC_ID, SINGLE_ADMIN_MODE } from '../../config/app-config.js';
import { BASE_PATH, INSTITUTION_ID, applyInstitutionBranding, buildEmptyState, enableSmartSelectWindowing, ensureTenantStatusAndAccess, syncSmartSelectDisplay, openConfirmDialog, escapeHtml, fitTextToContainer, formatCurrency, formatMonthLabel, hardenExternalLinks, isPastAcademicYearLabel, populateAcademicYearSelect, registerServiceWorker, renderVersionInfo, resolveAcademicYearClasses, resolveAuthoritativeCurrentYear, populateClassSelect, formatStudentOptionLabel, populateGenderSelect, populateRowLimitSelect, compareClassLabelsNatural } from '../shared/app-common.js';
import { appLog } from '../shared/logger.js';
import { showToast } from '../shared/toaster.js';

const getPageUrl = (target = '') => window.AppSession?.buildPageUrl?.(target) || target;
import { initCollectionEntryModule } from './collection/entry-module.js';
import { initCollectionHistoryModule } from './collection/history-module.js';
import { initCollectionReportsModule } from './collection/reports-module.js';
import {
    initCollectionUploadModule,
    buildBulkRosterWithGroups,
    resolveActiveBulkFeeItems,
    buildBulkSheetMatrixData,
    evaluateCollectionBulkSheet,
    buildBulkFirestorePaymentPayloads
} from './collection/upload-module.js';
import { initCollectionSettingsModule } from './collection/settings-module.js';
import { initMasterLedgerModule, updateMasterLedgerData } from './collection/master-ledger-module.js';
import { initSharedFeeModal, openFeeEntryEditModal } from './collection/shared-fee-modal.js';
import { initFinanceManagementModule, renderFeeItemsManagement, renderStudentGroups, renderConcessionsList, syncFeeConfigUI, applyFinanceSettingsAccessUI } from './collection/finance-management.js';
import { initFeeDuesModule, updateFeeDuesData, renderFeeDues } from './collection/dues-module.js';
import { downloadSpreadsheetRows, formatSpreadsheetCellValue, normalizeToIsoDate, parseCsvArrayBufferToMatrix } from '../shared/spreadsheet-utils.js';
import {
    formatStudentFieldDisplayValue,
    getStudentCustomValuesMap,
    isStudentFieldVisible,
    normalizeStudentFieldSchema
} from '../shared/student-fields.js';

let studentFieldSchema = normalizeStudentFieldSchema([]);

// Clean URL Guard: Strip any lingering hash fragment to ensure clean base .html on every refresh
if (typeof window !== 'undefined' && window.location && window.location.hash) {
    try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (_) {}
}

// --- GLOBAL STATE (Initialized early to prevent Temporal Dead Zone ReferenceErrors) ---
const getAcademicYearFromDate = (dateObj = new Date()) => {
    const month = dateObj.getMonth();
    const year = dateObj.getFullYear();
    return month < 5 ? `${year - 1}-${year}` : `${year}-${year + 1}`;
};
let isCurrentAdmin = false;
let currentUserEmail = '';
let currentCollectorKey = '';
let students = [], allStudentsRaw = [], allPayments = [], allDonations = [], classes = [], institutionalConfiguredClasses = [], studentGroups = [], feeItems = [], allStaff = [];
let directoryEntries = [], directoryCategories = [], pageAccessConfig = { categories: {}, overrides: {} };
let defaultFee = 200, defaultReceiptMandatory = false, defaultMonthlyFeeEnabled = true;
let currentWorkingAcademicYear = getAcademicYearFromDate(new Date());
let hasLoadedCollectionAcademicYears = false;
if (typeof document !== 'undefined') {
    const earlyHeaderYearEl = document.getElementById('header-active-year');
    if (earlyHeaderYearEl && (!earlyHeaderYearEl.textContent || earlyHeaderYearEl.textContent.includes('Loading'))) {
        earlyHeaderYearEl.textContent = currentWorkingAcademicYear;
    }
}
let isEditMode = false, editingPaymentGroup = {}, selectedStudentId = null;
let userExplicitClass = '', userExplicitGender = '';
let selectedGroupMemberIds = new Set();
let editTouchedItemKeys = new Set();
let availableFeeAcademicYears = [];
let selectedFeeAcademicYear = '';
let selectedDutyClasses = [];
const normalizeClassLabel = (str = '') => String(str || '').replace(/^class\s*/i, '').trim().toLowerCase();
const isClassInDutyScope = (clsName = '', dutyList = []) => {
    if (!Array.isArray(dutyList) || dutyList.length === 0) return false;
    const targetNorm = normalizeClassLabel(clsName);
    return dutyList.some((d) => normalizeClassLabel(d) === targetNorm || String(d).trim().toLowerCase() === String(clsName).trim().toLowerCase());
};
const getOfficialSession = () => {
    try {
        const raw = localStorage.getItem('official_portal_session_v1');
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
};
const isMasterSuperAdmin = () => {
    const staffAccess = window.AppSession?.getStaffAccess?.();
    if (staffAccess?.actLikeSuperAdmin === true || staffAccess?.canAccessAdmin === true) return true;
    if (staffAccess && (staffAccess.source === 'staff' || staffAccess.staffId || staffAccess.userKey)) {
        return false;
    }
    const officialSession = getOfficialSession();
    if (officialSession?.actLikeSuperAdmin === true || officialSession?.canAccessAdmin === true) return true;
    if (officialSession && (officialSession.source === 'staff' || (officialSession.id && officialSession.id !== 'admin'))) {
        return false;
    }
    return Boolean(isCurrentAdmin || window.AppSession?.getRole?.() === 'admin');
};
const getClassOptionsForCollector = () => {
    if (isMasterSuperAdmin()) return classes;
    if (!selectedDutyClasses || !selectedDutyClasses.length) return [];
    return classes.filter((cls) => isClassInDutyScope(cls, selectedDutyClasses));
};
let pendingFeeSelectionsByYear = {};
let isPaymentMutationInFlight = false;

window.AppSession?.guardStaffPageAccess?.('collection');

appLog('info', 'collection.bootstrap', 'Collection page loaded');
window.notifyApp = (message = '', type = 'info') => showToast(message, type);

export const hideLoader = () => {
    if (typeof window.hideCollectionLoader === 'function') {
        window.hideCollectionLoader();
    } else {
        const loader = document.getElementById('loading-screen');
        if (loader) {
            loader.style.pointerEvents = 'none';
            loader.style.opacity = '0';
            setTimeout(() => { 
                if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
                else if (loader) loader.style.display = 'none';
            }, 200);
        }
    }
};

hideLoader();
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    hideLoader();
} else {
    window.addEventListener('load', hideLoader);
    document.addEventListener('DOMContentLoaded', hideLoader);
}
setTimeout(hideLoader, 200);
setTimeout(hideLoader, 500);

initCollectionEntryModule();
initCollectionHistoryModule();
initCollectionReportsModule();
initCollectionUploadModule();
initCollectionSettingsModule();
initMasterLedgerModule();
initSharedFeeModal();
initFeeDuesModule({
    onSelectStudentForCollection: (studentId) => {
        const student = getStudentById(studentId) || (allStudentsRaw || []).find(s => s.id === studentId);
        if (!student) return;
        activateTab('home-page');
        selectedStudentId = student.id;
        const input = document.getElementById('entry-student-input');
        if (input) input.value = `${student.name} (Adm: ${student.adm || '-'})`;
        const classEl = document.getElementById('entry-class');
        if (classEl && student.class) classEl.value = student.class;
        populateFeeItemSelection();
        updateTotalAmount();
    }
});

registerServiceWorker();
hardenExternalLinks();
enableSmartSelectWindowing(document, { visibleCount: 6 });

const prefillDefaultDates = () => {
    try {
        const todayIso = new Date().toISOString().split('T')[0];
        const entryDate = document.getElementById('entry-date');
        if (entryDate && !entryDate.value) entryDate.value = todayIso;
        const donationDate = document.getElementById('donation-date');
        if (donationDate && !donationDate.value) donationDate.value = todayIso;
    } catch (_) {}
};
prefillDefaultDates();
const syncCollectionPwaMode = () => {
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true;
    document.body.classList.toggle('pwa-standalone', Boolean(isStandalone));
};
syncCollectionPwaMode();
window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', syncCollectionPwaMode);

const NON_TOGGLE_TAB_TARGETS = new Set(['dashboard-page']);
const getSessionCollectorKey = () => {
    const access = window.AppSession?.getStaffAccess?.() || {};
    const fallback = window.AppSession?.getStaffEmail?.() || '';
    return String(access.userKey || access.loginId || fallback || '').trim().toLowerCase();
};
const getTabPrefsStorageKey = () => `collector_tab_prefs_${getSessionCollectorKey() || 'default'}`;
const readTabPrefsFromLocal = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(getTabPrefsStorageKey()) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
};
const writeTabPrefsToLocal = (prefs = {}) => {
    localStorage.setItem(getTabPrefsStorageKey(), JSON.stringify(prefs));
};

const getCollectorPrefsRef = () => doc(db, `${BASE_PATH}/collectorPreferences`, getSessionCollectorKey() || 'default');
const readTabPrefsFromCloud = async () => {
    try {
        const snap = await getDoc(getCollectorPrefsRef());
        if (!snap.exists()) return null;
        const prefs = snap.data()?.menuTabs;
        return prefs && typeof prefs === 'object' ? prefs : null;
    } catch (error) {
        console.warn('Unable to read cloud menu settings.', error);
        return null;
    }
};
const writeTabPrefsToCloud = async (prefs = {}) => {
    try {
        await setDoc(getCollectorPrefsRef(), {
            userKey: getSessionCollectorKey(),
            menuTabs: prefs,
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (error) {
        console.warn('Unable to save cloud menu settings.', error);
    }
};


// ---- Sidebar / Drawer (admin-style collapsible) ----
const collectionOverlay = document.getElementById('drawer-overlay');

const isCollectionDesktop = () => window.innerWidth >= 1024;

const setCollectionSidebarCollapsed = (collapsed) => {
    const app = document.getElementById('collection-app');
    if (!app) return;
    app.classList.toggle('sidebar-collapsed', collapsed);
    if (isCollectionDesktop()) {
        localStorage.setItem('collection_sidebar_collapsed', collapsed ? 'true' : 'false');
    }
    if (!isCollectionDesktop() && collectionOverlay) {
        if (!collapsed) {
            collectionOverlay.classList.remove('hidden');
            setTimeout(() => collectionOverlay.classList.remove('opacity-0'), 10);
        } else {
            collectionOverlay.classList.add('opacity-0');
            setTimeout(() => collectionOverlay.classList.add('hidden'), 300);
        }
    }
};

const toggleCollectionSidebarState = () => {
    const app = document.getElementById('collection-app');
    const isCollapsed = app?.classList.contains('sidebar-collapsed');
    setCollectionSidebarCollapsed(!isCollapsed);
};

const initCollectionSidebarState = () => {
    if (!isCollectionDesktop()) {
        setCollectionSidebarCollapsed(true);
    } else {
        const stored = localStorage.getItem('collection_sidebar_collapsed');
        // Default to expanded (false) on desktop unless explicitly set to 'true'
        setCollectionSidebarCollapsed(stored === 'true');
    }
};

const setMobileMenuState = (isOpen) => {
    if (!isCollectionDesktop()) {
        setCollectionSidebarCollapsed(!isOpen);
    }
};

const collectionMoreSheet = document.getElementById('collection-more-sheet');

const closeCollectionMoreSheet = () => {
    if (collectionMoreSheet) {
        collectionMoreSheet.classList.add('hidden');
        collectionMoreSheet.classList.remove('flex');
    }
};

const openCollectionMoreSheet = () => {
    if (collectionMoreSheet) {
        collectionMoreSheet.classList.remove('hidden');
        collectionMoreSheet.classList.add('flex');
    }
};

document.getElementById('sidebar-collapse-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCollectionSidebarState();
});
document.getElementById('btn-collection-more')?.addEventListener('click', (e) => {
    e.preventDefault();
    openCollectionMoreSheet();
});
document.getElementById('btn-close-collection-more')?.addEventListener('click', () => {
    closeCollectionMoreSheet();
});
collectionMoreSheet?.addEventListener('click', (e) => {
    if (e.target === collectionMoreSheet) {
        closeCollectionMoreSheet();
    }
});
document.getElementById('mobile-more-logout-btn')?.addEventListener('click', () => {
    closeCollectionMoreSheet();
    handleCollectionLogout();
});
document.getElementById('collection-mobile-menu-btn')?.addEventListener('click', () => {
    setCollectionSidebarCollapsed(false);
});
document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    setCollectionSidebarCollapsed(false);
});
collectionOverlay?.addEventListener('click', () => setCollectionSidebarCollapsed(true));

window.addEventListener('resize', () => {
    if (isCollectionDesktop()) {
        closeCollectionMoreSheet();
        if (collectionOverlay && !collectionOverlay.classList.contains('hidden')) {
            collectionOverlay.classList.add('opacity-0');
            collectionOverlay.classList.add('hidden');
        }
        let isCollapsed = false;
        try {
            const stored = localStorage.getItem('collection_sidebar_collapsed');
            if (stored !== null) isCollapsed = stored === 'true';
        } catch (_) {}
        setCollectionSidebarCollapsed(isCollapsed);
    } else {
        setCollectionSidebarCollapsed(true);
    }
});

initCollectionSidebarState();

// TABS LOGIC (Main Tab & Sub-Tab Hierarchy - Hash-Free Session Architecture)
const MAIN_TAB_GROUPS = {
    dashboard: ['dashboard-page'],
    collection: ['home-page'],
    ledgers: ['master-ledger-page', 'fee-dues-page', 'history-page'],
    reports: ['monthly-collected-page', 'students-page'],
    finance: ['fee-settings-page']
};

const links = Array.from(document.querySelectorAll('.tab-link'));
const pages = Array.from(document.querySelectorAll('.page-content'));
const defaultTabId = 'dashboard-page';
const ACTIVE_TAB_STORAGE_KEY = 'collection_active_tab';

const getInitialActiveTab = () => {
    try {
        const stored = sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        if (stored && document.getElementById(stored)) return stored;
    } catch (_) {}
    return defaultTabId;
};

const linkItems = links.map((link) => ({
    link,
    target: link.dataset.target,
    listItem: link.closest('li') || link,
    isBottomNav: link.dataset.bottomNav === 'true'
}));
const getToggleableLinks = () => linkItems.filter((item) => item.target && !item.isBottomNav && !item.link.classList.contains('collection-more-tile') && !NON_TOGGLE_TAB_TARGETS.has(item.target));

const isSubTabAllowedAndVisible = (targetId) => {
    if (targetId === 'collector-wise-monthly-page' && !isCurrentAdmin) return false;
    const prefs = readTabPrefsFromLocal();
    if (!NON_TOGGLE_TAB_TARGETS.has(targetId) && prefs[targetId] === false) return false;
    return true;
};

const applyTabVisibilityPreferences = () => {
    const prefs = readTabPrefsFromLocal();
    getToggleableLinks().forEach(({ target, listItem }) => {
        if (target === 'collector-wise-monthly-page' && !isCurrentAdmin) {
            listItem?.classList.add('hidden');
            return;
        }
        const isVisible = prefs[target] !== false;
        listItem?.classList.toggle('hidden', !isVisible);
    });

    // Hide entire Main Group section in side menu if all its sub-tabs are hidden
    Object.entries(MAIN_TAB_GROUPS).forEach(([groupKey, targets]) => {
        if (groupKey === 'dashboard') return;
        const hasAnyVisible = targets.some((t) => isSubTabAllowedAndVisible(t));
        const menuGroupLi = document.querySelector(`.nav-group-static[data-menu-group="${groupKey}"]`);
        menuGroupLi?.classList.toggle('hidden', !hasAnyVisible);
    });

    const currentActive = sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || defaultTabId;
    if (!isSubTabAllowedAndVisible(currentActive)) {
        activateTab(defaultTabId);
    }
};

const getLinkForTarget = (targetId) => links.find(link => link.dataset.target === targetId && !link.dataset.bottomNav) || links.find(link => link.dataset.target === targetId);

const syncMasterLedgerState = (forceResetYear = false) => {
    try {
        const isSuper = isMasterSuperAdmin();
        const effectiveStudents = isSuper
            ? (Array.isArray(students) ? students : [])
            : (Array.isArray(students) && selectedDutyClasses.length ? students.filter(s => isClassInDutyScope(s.class, selectedDutyClasses)) : (Array.isArray(students) ? students : []));
        const effectiveClasses = isSuper
            ? (Array.isArray(classes) ? classes : [])
            : getClassOptionsForCollector();
        updateMasterLedgerData({
            students: effectiveStudents,
            allStudents: Array.isArray(students) ? students : [],
            rawStudents: Array.isArray(allStudentsRaw) ? allStudentsRaw : [],
            dutyClasses: isSuper ? [] : [...(selectedDutyClasses || [])],
            groups: Array.isArray(studentGroups) ? studentGroups : [],
            payments: Array.isArray(allPayments) ? allPayments : [],
            classes: effectiveClasses,
            defaultFee: typeof defaultFee === 'number' ? defaultFee : 200,
            defaultMonthlyFeeEnabled: defaultMonthlyFeeEnabled !== false,
            academicYear: currentWorkingAcademicYear || '',
            academicYearSettings: Array.isArray(academicYearSettings) ? academicYearSettings : [],
            forceResetYear
        });
    } catch (err) {
        console.warn('Sync master ledger error:', err);
    }
};
window.syncMasterLedgerState = syncMasterLedgerState;

const syncFeeDuesState = (preferredClass, forceResetYear = false) => {
    try {
        const isSuper = isMasterSuperAdmin();
        const effectiveStudents = isSuper
            ? (Array.isArray(students) ? students : [])
            : (Array.isArray(students) && selectedDutyClasses.length ? students.filter(s => isClassInDutyScope(s.class, selectedDutyClasses)) : []);
        const effectiveClasses = isSuper
            ? (Array.isArray(classes) ? classes : [])
            : getClassOptionsForCollector();
        const activeClass = preferredClass !== undefined
            ? preferredClass
            : (document.getElementById('dues-class-filter')?.value ?? '');
        updateFeeDuesData({
            students: effectiveStudents,
            rawStudents: Array.isArray(allStudentsRaw) ? allStudentsRaw : [],
            groups: Array.isArray(studentGroups) ? studentGroups : [],
            payments: Array.isArray(allPayments) ? allPayments : [],
            feeItems: Array.isArray(feeItems) ? feeItems : [],
            classes: effectiveClasses,
            isAdmin: isSuper,
            dutyClasses: isSuper ? [] : (Array.isArray(selectedDutyClasses) ? [...selectedDutyClasses] : []),
            defaultFee: typeof defaultFee === 'number' ? defaultFee : 200,
            defaultMonthlyFeeEnabled: defaultMonthlyFeeEnabled !== false,
            academicYear: currentWorkingAcademicYear || '',
            academicYearSettings: Array.isArray(academicYearSettings) ? academicYearSettings : [],
            initialClass: activeClass,
            forceResetYear
        });
    } catch (err) {
        console.warn('Sync fee dues error:', err);
    }
};
window.syncFeeDuesState = syncFeeDuesState;

const OVERFLOW_COLLECTION_TABS = new Set([
    'history-page',
    'monthly-collected-page',
    'students-page',
    'fee-settings-page'
]);

// --- UNIFIED SUB-TAB NAVIGATION HANDLERS ---
const switchCollectionSubTab = (subtab = 'entry') => {
    const panels = {
        entry: document.getElementById('subview-fee-entry'),
        bulk: document.getElementById('bulk-upload-page'),
        donation: document.getElementById('donation-page')
    };
    Object.entries(panels).forEach(([key, panel]) => {
        if (!panel) return;
        panel.classList.toggle('hidden', key !== subtab);
    });

    document.querySelectorAll('.fee-collection-subtab-btn').forEach(btn => {
        const isActive = btn.dataset.collectionSubtab === subtab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (subtab === 'entry' && typeof setupFeeEntryUI === 'function') {
        setupFeeEntryUI();
    } else if (subtab === 'bulk' && typeof setupBulkUploadUI === 'function') {
        setupBulkUploadUI();
    } else if (subtab === 'donation' && typeof setupDonationEntryUI === 'function') {
        setupDonationEntryUI();
    }
};
window.switchCollectionSubTab = switchCollectionSubTab;

const switchReportsSubTab = (subtab = 'monthly') => {
    const panels = {
        monthly: document.getElementById('subview-monthly-overview'),
        collector: document.getElementById('collector-wise-monthly-page')
    };
    Object.entries(panels).forEach(([key, panel]) => {
        if (!panel) return;
        panel.classList.toggle('hidden', key !== subtab);
    });

    document.querySelectorAll('.reports-subtab-btn').forEach(btn => {
        const isActive = btn.dataset.reportsSubtab === subtab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (subtab === 'collector' && typeof renderCollectorWiseMonthlyPage === 'function') {
        renderCollectorWiseMonthlyPage();
    } else if (subtab === 'monthly' && typeof renderMonthlyCollectedPage === 'function') {
        renderMonthlyCollectedPage(document.getElementById('monthly-collected-search-input')?.value || '');
    }
};
window.switchReportsSubTab = switchReportsSubTab;

const switchSettingsSubTab = (subtab = 'structure') => {
    const panels = {
        structure: document.getElementById('subview-fee-structure'),
        groups: document.getElementById('manage-groups-page'),
        concessions: document.getElementById('fee-concessions-page')
    };
    Object.entries(panels).forEach(([key, panel]) => {
        if (!panel) return;
        panel.classList.toggle('hidden', key !== subtab);
    });

    document.querySelectorAll('.settings-subtab-btn').forEach(btn => {
        const isActive = btn.dataset.settingsSubtab === subtab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (typeof applyFinanceSettingsAccessUI === 'function') {
        applyFinanceSettingsAccessUI();
    }
    if (subtab === 'structure' && typeof renderFeeItemsManagement === 'function') {
        renderFeeItemsManagement();
    } else if (subtab === 'groups' && typeof renderStudentGroups === 'function') {
        renderStudentGroups();
    } else if (subtab === 'concessions' && typeof renderConcessionsList === 'function') {
        renderConcessionsList();
    }
};
window.switchSettingsSubTab = switchSettingsSubTab;

// Subtab event delegation
document.addEventListener('click', (e) => {
    const colBtn = e.target.closest('.fee-collection-subtab-btn');
    if (colBtn && colBtn.dataset.collectionSubtab) {
        e.preventDefault();
        switchCollectionSubTab(colBtn.dataset.collectionSubtab);
        return;
    }
    const repBtn = e.target.closest('.reports-subtab-btn');
    if (repBtn && repBtn.dataset.reportsSubtab) {
        e.preventDefault();
        switchReportsSubTab(repBtn.dataset.reportsSubtab);
        return;
    }
    const setBtn = e.target.closest('.settings-subtab-btn');
    if (setBtn && setBtn.dataset.settingsSubtab) {
        e.preventDefault();
        switchSettingsSubTab(setBtn.dataset.settingsSubtab);
        return;
    }
});

const activateTab = (targetId, subTabId = null) => {
    // Legacy / Merged Target Mapping
    if (targetId === 'fee-page') {
        activateTab('master-ledger-page');
        return;
    }
    if (targetId === 'bulk-upload-page') {
        activateTab('home-page', 'bulk');
        return;
    }
    if (targetId === 'donation-page') {
        activateTab('home-page', 'donation');
        return;
    }
    if (targetId === 'collector-wise-monthly-page') {
        activateTab('monthly-collected-page', 'collector');
        return;
    }
    if (targetId === 'manage-groups-page') {
        activateTab('fee-settings-page', 'groups');
        return;
    }
    if (targetId === 'fee-concessions-page') {
        activateTab('fee-settings-page', 'concessions');
        return;
    }

    const safeTargetId = document.getElementById(targetId) ? targetId : defaultTabId;
    const activeLink = getLinkForTarget(safeTargetId);

    try {
        sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, safeTargetId);
    } catch (_) {}

    links.forEach(link => {
        const isActive = link.dataset.target === safeTargetId;
        link.classList.toggle('active', isActive);
        link.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    document.querySelectorAll('.collection-more-tile').forEach(tile => {
        const isActive = tile.dataset.target === safeTargetId;
        tile.classList.toggle('active', isActive);
    });

    const isOverflowActive = OVERFLOW_COLLECTION_TABS.has(safeTargetId);
    document.getElementById('btn-collection-more')?.classList.toggle('active', isOverflowActive);

    closeCollectionMoreSheet();

    pages.forEach(page => {
        page.classList.toggle('hidden', page.id !== safeTargetId);
    });

    if (subTabId) {
        if (safeTargetId === 'home-page') switchCollectionSubTab(subTabId);
        else if (safeTargetId === 'monthly-collected-page') switchReportsSubTab(subTabId);
        else if (safeTargetId === 'fee-settings-page') switchSettingsSubTab(subTabId);
    }

    const mainApp = document.getElementById('app');
    if (mainApp) {
        if (safeTargetId === 'master-ledger-page') {
            mainApp.style.maxWidth = '100%';
            mainApp.style.width = '100%';
            mainApp.style.boxSizing = 'border-box';
            mainApp.style.padding = '';
            document.body.classList.remove('ledger-fullwidth');
            if (typeof syncMasterLedgerState === 'function') {
                syncMasterLedgerState();
            }
        } else {
            mainApp.style.maxWidth = '';
            mainApp.style.width = '';
            mainApp.style.padding = '';
            document.body.classList.remove('ledger-fullwidth');
            exitSpreadsheetFullscreen();
        }
    }

    // Ensure clean URL without lingering hash fragments
    if (window.location.hash) {
        try {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch (_) {}
    }

    setMobileMenuState(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    if (safeTargetId === 'home-page') {
        const activeSubtab = document.querySelector('.fee-collection-subtab-btn.active')?.dataset.collectionSubtab || 'entry';
        if (activeSubtab === 'bulk' && typeof setupBulkUploadUI === 'function') setupBulkUploadUI();
        else if (activeSubtab === 'donation' && typeof setupDonationEntryUI === 'function') setupDonationEntryUI();
        else if (typeof setupFeeEntryUI === 'function') setupFeeEntryUI();
    }
    if (safeTargetId === 'fee-settings-page') {
        if (typeof applyFinanceSettingsAccessUI === 'function') applyFinanceSettingsAccessUI();
        const activeSubtab = document.querySelector('.settings-subtab-btn.active')?.dataset.settingsSubtab || 'structure';
        if (activeSubtab === 'structure' && typeof renderFeeItemsManagement === 'function') renderFeeItemsManagement();
        else if (activeSubtab === 'groups' && typeof renderStudentGroups === 'function') renderStudentGroups();
        else if (activeSubtab === 'concessions' && typeof renderConcessionsList === 'function') renderConcessionsList();
    }
    if (safeTargetId === 'monthly-collected-page') {
        const activeSubtab = document.querySelector('.reports-subtab-btn.active')?.dataset.reportsSubtab || 'monthly';
        if (activeSubtab === 'collector' && typeof renderCollectorWiseMonthlyPage === 'function') renderCollectorWiseMonthlyPage();
        else if (typeof renderMonthlyCollectedPage === 'function') renderMonthlyCollectedPage(document.getElementById('monthly-collected-search-input')?.value || '');
    }
    if (safeTargetId === 'fee-dues-page' && typeof renderFeeDues === 'function') {
        syncFeeDuesState();
        renderFeeDues();
    }
    if (safeTargetId === 'students-page' && typeof renderStudentInfoList === 'function') {
        renderStudentInfoList();
    }
    if (safeTargetId === 'history-page' && typeof prepareHistoryData === 'function') {
        prepareHistoryData();
    }
    if (safeTargetId === 'dashboard-page' && typeof updateDashboardMetrics === 'function') {
        updateDashboardMetrics();
    }
    window.dispatchEvent(new CustomEvent('tabChanged', { detail: { tab: safeTargetId } }));
};

links.forEach(link => {
    link.addEventListener('click', (e) => {
        if (!link.dataset.target) return;
        e.preventDefault();
        activateTab(link.dataset.target);
    });
});

// Modals close logic
const closeStudentProfileModal = () => {
    const popup = document.getElementById('student-profile-popup');
    if (popup) {
        popup.classList.add('hidden');
        popup.classList.remove('flex');
        popup.style.display = 'none';
    }
};
document.getElementById('confirm-cancel')?.addEventListener('click', () => {
    const p = document.getElementById('confirm-popup');
    p?.classList.add('hidden');
    p?.classList.remove('flex');
});
document.getElementById('close-profile-btn')?.addEventListener('click', closeStudentProfileModal);
document.getElementById('close-profile-footer-btn')?.addEventListener('click', closeStudentProfileModal);
document.getElementById('student-profile-popup')?.addEventListener('click', (e) => {
    if (e.target.id === 'student-profile-popup') closeStudentProfileModal();
});
document.getElementById('close-my-profile-btn')?.addEventListener('click', () => {
    const p = document.getElementById('my-profile-popup');
    p?.classList.add('hidden');
    p?.classList.remove('flex');
});
document.getElementById('close-tab-settings-btn')?.addEventListener('click', () => {
    const p = document.getElementById('tab-settings-popup');
    p?.classList.add('hidden');
    p?.classList.remove('flex');
});

// Navigation button actions
document.getElementById('new-fee-entry-btn')?.addEventListener('click', () => { activateTab('home-page'); });
document.getElementById('back-to-official-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = getPageUrl('official.html');
});

// ============================================================
// SPREADSHEET FULLSCREEN & MOBILE LANDSCAPE CONTROLLER
// ============================================================
let nativeFullscreenActive = false;
const MODAL_DOCK_STORAGE_KEY = 'collection_modal_dock_side_v1';
const MODAL_DOCK_CYCLE = ['left', 'right', 'center'];

const getSavedModalDockSide = () => {
    try {
        const raw = localStorage.getItem(MODAL_DOCK_STORAGE_KEY);
        if (MODAL_DOCK_CYCLE.includes(raw)) return raw;
    } catch (_) {}
    return 'left';
};

const getModalDockUiMeta = (side) => {
    if (side === 'right') return { label: 'Right', icon: 'fa-align-right', title: 'Popup on Right (tap to move Center)' };
    if (side === 'center') return { label: 'Center', icon: 'fa-align-center', title: 'Popup Centered (tap to move Left)' };
    return { label: 'Left', icon: 'fa-align-left', title: 'Popup on Left (tap to move Right)' };
};

const applyModalDockSide = (side = getSavedModalDockSide()) => {
    const validSide = MODAL_DOCK_CYCLE.includes(side) ? side : 'left';
    try {
        localStorage.setItem(MODAL_DOCK_STORAGE_KEY, validSide);
    } catch (_) {}
    if (document.body) {
        document.body.dataset.modalDock = validSide;
    }
    const meta = getModalDockUiMeta(validSide);
    document.querySelectorAll('.modal-dock-switch-btn').forEach((btn) => {
        btn.title = meta.title;
        btn.setAttribute('aria-label', meta.title);
        btn.innerHTML = `<i class="fas ${meta.icon} text-[10px]"></i><span>${meta.label}</span>`;
    });
};

const ensureModalDockSwitchButtons = () => {
    const side = getSavedModalDockSide();
    const meta = getModalDockUiMeta(side);
    const modalSelectors = [
        '.modal-overlay > .modal-box',
        '.popup-overlay > .card',
        '#student-profile-popup > div'
    ];
    document.querySelectorAll(modalSelectors.join(', ')).forEach((box) => {
        if (!box || box.querySelector('.modal-dock-switch-btn')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal-dock-switch-btn items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-slate-100 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-600 text-[10px] font-bold transition shrink-0 cursor-pointer';
        btn.title = meta.title;
        btn.setAttribute('aria-label', meta.title);
        btn.innerHTML = `<i class="fas ${meta.icon} text-[10px]"></i><span>${meta.label}</span>`;

        // Try placing beside close button inside structured flex header row
        const firstChild = box.firstElementChild;
        if (firstChild && firstChild.classList.contains('flex') && firstChild.classList.contains('justify-between')) {
            const closeBtn = firstChild.querySelector('button[id*="close"], button[title*="Close"]');
            if (closeBtn && closeBtn.parentElement === firstChild) {
                const actionGroup = document.createElement('div');
                actionGroup.className = 'flex items-center gap-1.5 shrink-0';
                firstChild.insertBefore(actionGroup, closeBtn);
                actionGroup.appendChild(btn);
                actionGroup.appendChild(closeBtn);
                return;
            }
            firstChild.appendChild(btn);
            return;
        }

        // Fallback for simpler card/modal-box headers (e.g. Confirm, Edit Fee, Concession)
        const heading = box.querySelector(':scope > h3, :scope > h2');
        if (heading) {
            const hasAbsClose = Boolean(box.querySelector(':scope > button.absolute'));
            const row = document.createElement('div');
            row.className = `flex items-center justify-between gap-2 mb-3 border-b pb-2${hasAbsClose ? ' pr-8' : ''}`;
            heading.classList.remove('mb-4', 'mb-3', 'mb-2', 'border-b', 'pb-2');
            heading.classList.add('!mb-0', '!border-0', '!pb-0');
            box.insertBefore(row, heading);
            row.appendChild(heading);
            row.appendChild(btn);
            return;
        }

        btn.classList.add('ml-auto', 'mb-2');
        box.insertBefore(btn, box.firstChild);
    });
};

export function syncSpreadsheetFullscreenViewport() {
    const appEl = document.getElementById('collection-app');
    const vv = window.visualViewport;
    const vw = Math.max(160, Math.round(vv?.width || window.innerWidth || document.documentElement?.clientWidth || 0));
    const vh = Math.max(160, Math.round(vv?.height || window.innerHeight || document.documentElement?.clientHeight || 0));
    const vvTop = Math.max(0, Math.round(vv?.offsetTop || 0));

    const rootStyle = document.documentElement?.style;
    if (rootStyle) {
        rootStyle.setProperty('--vv-width', `${vw}px`);
        rootStyle.setProperty('--vv-height', `${vh}px`);
        rootStyle.setProperty('--vv-offset-top', `${vvTop}px`);
    }

    const isFullscreen = Boolean(appEl && appEl.classList.contains('spreadsheet-fullscreen-mode'));
    const isPortraitViewport = vw > 0 && vh > vw;
    const isCompactLandscape = isFullscreen
        ? (isPortraitViewport || vw <= 1024 || vh <= 560)
        : (vw > vh && vh <= 560);

    if (document.body) {
        document.body.classList.toggle('collection-landscape-modal-mode', isCompactLandscape);
        if (!document.body.dataset.modalDock) {
            document.body.dataset.modalDock = getSavedModalDockSide();
        }
    }

    if (!appEl) return;

    if (!isFullscreen) {
        appEl.classList.remove('spreadsheet-css-rotated', 'spreadsheet-fs-filters-open');
        appEl.style.removeProperty('--fs-rot-w');
        appEl.style.removeProperty('--fs-rot-h');
        document.body?.classList.remove('collection-fullscreen-lock');
        return;
    }

    document.body?.classList.add('collection-fullscreen-lock');

    if (isPortraitViewport) {
        appEl.style.setProperty('--fs-rot-w', `${vh}px`);
        appEl.style.setProperty('--fs-rot-h', `${vw}px`);
        appEl.classList.add('spreadsheet-css-rotated');
    } else {
        appEl.classList.remove('spreadsheet-css-rotated');
        appEl.style.removeProperty('--fs-rot-w');
        appEl.style.removeProperty('--fs-rot-h');
    }
}

export function toggleSpreadsheetFullscreen(targetPageId) {
    const appEl = document.getElementById('collection-app');
    if (!appEl) return;
    if (appEl.classList.contains('spreadsheet-fullscreen-mode')) {
        exitSpreadsheetFullscreen();
    } else {
        enterSpreadsheetFullscreen(targetPageId);
    }
}

export function enterSpreadsheetFullscreen(_targetPageId) {
    const appEl = document.getElementById('collection-app');
    if (!appEl) return;
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    appEl.classList.add('spreadsheet-fullscreen-mode');
    appEl.classList.remove('spreadsheet-fs-filters-open');

    updateFullscreenButtons(true);
    syncFullscreenFiltersToggleState(false);
    ensureModalDockSwitchButtons();
    applyModalDockSide(getSavedModalDockSide());
    syncSpreadsheetFullscreenViewport();
    requestAnimationFrame(() => syncSpreadsheetFullscreenViewport());

    const tryLockLandscape = () => {
        try {
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape')
                    .then(() => {
                        syncSpreadsheetFullscreenViewport();
                        requestAnimationFrame(() => syncSpreadsheetFullscreenViewport());
                    })
                    .catch(() => syncSpreadsheetFullscreenViewport());
            }
        } catch (_) {}
    };

    try {
        const root = document.documentElement;
        const onNativeEntered = () => {
            nativeFullscreenActive = true;
            syncSpreadsheetFullscreenViewport();
            tryLockLandscape();
            requestAnimationFrame(() => syncSpreadsheetFullscreenViewport());
            setTimeout(syncSpreadsheetFullscreenViewport, 50);
        };
        if (root.requestFullscreen) {
            let fsPromise;
            try {
                fsPromise = root.requestFullscreen({ navigationUI: 'hide' });
            } catch (_) {
                fsPromise = root.requestFullscreen();
            }
            Promise.resolve(fsPromise)
                .then(onNativeEntered)
                .catch(() => {
                    tryLockLandscape();
                    syncSpreadsheetFullscreenViewport();
                });
        } else if (root.webkitRequestFullscreen) {
            root.webkitRequestFullscreen();
            onNativeEntered();
        } else {
            tryLockLandscape();
        }
    } catch (_) {
        tryLockLandscape();
    }
}

export function exitSpreadsheetFullscreen() {
    const appEl = document.getElementById('collection-app');
    if (appEl) {
        appEl.classList.remove('spreadsheet-fullscreen-mode', 'spreadsheet-css-rotated', 'spreadsheet-fs-filters-open');
        appEl.style.removeProperty('--fs-rot-w');
        appEl.style.removeProperty('--fs-rot-h');
    }
    document.body?.classList.remove('collection-fullscreen-lock');
    nativeFullscreenActive = false;

    try {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else if (document.webkitFullscreenElement) {
            document.webkitExitFullscreen();
        }
    } catch (_) {}

    try {
        if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
        }
    } catch (_) {}

    updateFullscreenButtons(false);
    syncFullscreenFiltersToggleState(false);
    syncSpreadsheetFullscreenViewport();
}

function syncFullscreenFiltersToggleState(isOpen) {
    const filterBtn = document.getElementById('ledger-fullscreen-filters-btn');
    if (!filterBtn) return;
    filterBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    filterBtn.classList.toggle('bg-blue-600', isOpen);
    filterBtn.classList.toggle('text-white', isOpen);
    filterBtn.classList.toggle('border-blue-600', isOpen);
    filterBtn.classList.toggle('bg-slate-100', !isOpen);
    filterBtn.classList.toggle('text-slate-700', !isOpen);
    filterBtn.classList.toggle('border-slate-200', !isOpen);
}

function updateFullscreenButtons(isFullscreen) {
    document.querySelectorAll('.fullscreen-toggle-btn').forEach(btn => {
        if (isFullscreen) {
            btn.innerHTML = '<i class="fas fa-compress"></i> <span>Exit</span>';
            btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            btn.classList.add('bg-rose-600', 'hover:bg-rose-700');
            btn.title = 'Exit Fullscreen';
        } else {
            btn.innerHTML = '<i class="fas fa-expand"></i> <span>Fullscreen</span>';
            btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            btn.classList.remove('bg-rose-600', 'hover:bg-rose-700');
            btn.title = 'Toggle Fullscreen Landscape View';
        }
    });
}

// Initialize dock buttons & visualViewport listeners
const initMobileLandscapeModalSupport = () => {
    ensureModalDockSwitchButtons();
    applyModalDockSide(getSavedModalDockSide());
    syncSpreadsheetFullscreenViewport();
};
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileLandscapeModalSupport, { once: true });
} else {
    initMobileLandscapeModalSupport();
}

// Global Fullscreen, VisualViewport, Orientation and Keyboard Event Listeners
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && nativeFullscreenActive) {
        nativeFullscreenActive = false;
        exitSpreadsheetFullscreen();
    } else {
        setTimeout(syncSpreadsheetFullscreenViewport, 80);
    }
});
document.addEventListener('webkitfullscreenchange', () => {
    if (!document.webkitFullscreenElement && nativeFullscreenActive) {
        nativeFullscreenActive = false;
        exitSpreadsheetFullscreen();
    } else {
        setTimeout(syncSpreadsheetFullscreenViewport, 80);
    }
});
window.addEventListener('resize', syncSpreadsheetFullscreenViewport);
window.addEventListener('orientationchange', () => {
    setTimeout(syncSpreadsheetFullscreenViewport, 100);
});
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncSpreadsheetFullscreenViewport);
    window.visualViewport.addEventListener('scroll', syncSpreadsheetFullscreenViewport);
}
document.addEventListener('focusin', (e) => {
    const field = e.target?.closest?.('input, select, textarea');
    if (!field) return;
    const modal = field.closest('.modal-overlay, .popup-overlay, #student-profile-popup');
    if (!modal) return;
    setTimeout(() => {
        syncSpreadsheetFullscreenViewport();
        if (document.body?.classList.contains('collection-landscape-modal-mode')) {
            field.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
    }, 180);
});
document.addEventListener('focusout', () => {
    setTimeout(syncSpreadsheetFullscreenViewport, 140);
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const appEl = document.getElementById('collection-app');
        if (appEl && appEl.classList.contains('spreadsheet-fullscreen-mode')) {
            exitSpreadsheetFullscreen();
        }
    }
});

document.addEventListener('click', (e) => {
    const dockBtn = e.target.closest('.modal-dock-switch-btn');
    if (dockBtn) {
        e.stopPropagation();
        const cur = getSavedModalDockSide();
        const nextIdx = (MODAL_DOCK_CYCLE.indexOf(cur) + 1) % MODAL_DOCK_CYCLE.length;
        applyModalDockSide(MODAL_DOCK_CYCLE[nextIdx]);
        return;
    }
    const fsFiltersBtn = e.target.closest('#ledger-fullscreen-filters-btn');
    if (fsFiltersBtn) {
        const appEl = document.getElementById('collection-app');
        if (appEl && appEl.classList.contains('spreadsheet-fullscreen-mode')) {
            const isOpen = appEl.classList.toggle('spreadsheet-fs-filters-open');
            syncFullscreenFiltersToggleState(isOpen);
        }
        return;
    }
    const fsBtn = e.target.closest('.fullscreen-toggle-btn');
    if (fsBtn) {
        const targetPage = fsBtn.dataset.target || 'master-ledger-page';
        toggleSpreadsheetFullscreen(targetPage);
        return;
    }
});
let isDonationSaveInFlight = false;
let collectorPaymentDetails = {
    accountName: '',
    upiNumber: '',
    upiId: '',
};
const setResultPageNavVisibility = (canAccess = false) => {
    const navItem = document.getElementById('result-nav-item');
    if (!navItem) return;
    navItem.classList.toggle('hidden', !canAccess);
};
const normalizeEmail = (email = '') => String(email || '').trim().toLowerCase();
const getEffectiveStaffEmail = () => normalizeEmail(currentUserEmail || window.AppSession?.getStaffEmail?.() || auth?.currentUser?.email || '');
const getCollectorKey = () => normalizeEmail(currentCollectorKey || window.AppSession?.getStaffAccess?.()?.userKey || window.AppSession?.getStaffAccess?.()?.loginId || getEffectiveStaffEmail());

const canUserViewAlumni = () => {
    if (isMasterSuperAdmin()) return true;
    const staffAccess = window.AppSession?.getStaffAccess?.();
    if (staffAccess?.actLikeSuperAdmin === true || staffAccess?.canAccessAdmin === true) return true;
    const duty = Array.isArray(selectedDutyClasses) ? selectedDutyClasses : [];
    return duty.some(c => String(c).trim().toUpperCase() === 'ALUMNI');
};

const findCurrentStaffMember = (staffList = []) => {
    if (!Array.isArray(staffList) || !staffList.length) return null;
    const staffAccess = window.AppSession?.getStaffAccess?.() || null;
    const officialSession = getOfficialSession();

    const targetStaffId = staffAccess?.staffId || officialSession?.id || officialSession?.access?.staffId || '';
    const targetEmail = normalizeEmail(staffAccess?.email || officialSession?.email || currentUserEmail || auth?.currentUser?.email || '');
    const targetUsername = String(staffAccess?.loginId || staffAccess?.userKey || officialSession?.username || '').toLowerCase().trim();
    const targetName = String(staffAccess?.name || officialSession?.name || window.AppSession?.getStaffName?.() || auth?.currentUser?.displayName || '').toLowerCase().trim();

    if (targetStaffId) {
        const found = staffList.find((s) => s.id === targetStaffId);
        if (found) return found;
    }

    if (targetEmail) {
        const found = staffList.find((s) => {
            const sEmail = normalizeEmail(s.email);
            return sEmail && sEmail === targetEmail;
        });
        if (found) return found;

        const emailPrefix = targetEmail.split('@')[0];
        if (emailPrefix) {
            const prefixFound = staffList.find((s) => {
                const sUsername = String(s.username || '').toLowerCase().trim();
                const sEmail = normalizeEmail(s.email);
                return sUsername === emailPrefix || (sEmail && sEmail.split('@')[0] === emailPrefix);
            });
            if (prefixFound) return prefixFound;
        }
    }

    if (targetUsername) {
        const cleanUser = targetUsername.includes('@') ? targetUsername.split('@')[0] : targetUsername;
        const found = staffList.find((s) => {
            const sUsername = String(s.username || '').toLowerCase().trim();
            const sEmailPrefix = normalizeEmail(s.email).split('@')[0];
            return sUsername === cleanUser || sEmailPrefix === cleanUser;
        });
        if (found) return found;
    }

    if (targetName) {
        const found = staffList.find((s) => String(s.name || '').toLowerCase().trim() === targetName);
        if (found) return found;
    }

    return null;
};

const resolveStaffDutyClasses = (staffRecord = null) => {
    if (staffRecord) {
        if (Array.isArray(staffRecord.dutyClasses) && staffRecord.dutyClasses.length) {
            return staffRecord.dutyClasses.filter(Boolean);
        }
        if (Array.isArray(staffRecord.assignedClasses) && staffRecord.assignedClasses.length) {
            return staffRecord.assignedClasses.filter(Boolean);
        }
        if (staffRecord.customValues && Array.isArray(staffRecord.customValues.dutyClasses) && staffRecord.customValues.dutyClasses.length) {
            return staffRecord.customValues.dutyClasses.filter(Boolean);
        }
    }
    const staffAccess = window.AppSession?.getStaffAccess?.();
    if (Array.isArray(staffAccess?.dutyClasses) && staffAccess.dutyClasses.length) {
        return staffAccess.dutyClasses.filter(Boolean);
    }
    const officialSession = getOfficialSession();
    if (Array.isArray(officialSession?.dutyClasses) && officialSession.dutyClasses.length) {
        return officialSession.dutyClasses.filter(Boolean);
    }
    const localSaved = readDutyClassesFromLocal();
    if (Array.isArray(localSaved) && localSaved.length) {
        return localSaved.filter(Boolean);
    }
    return [];
};

const getCurrentCollectorName = () => {
    const myStaff = findCurrentStaffMember(allStaff);
    if (myStaff?.name) return myStaff.name;
    const sessionName = window.AppSession?.getStaffName?.();
    if (sessionName && !isCurrentAdmin) return sessionName;
    if (isMasterSuperAdmin()) return 'Administrator';
    return currentUserEmail || 'Collector';
};

const getCollectorDisplayName = () => {
    return getCurrentCollectorName();
};
window.getCollectorKey = getCollectorKey;
window.getCollectorDisplayName = getCollectorDisplayName;
window.isMasterSuperAdmin = isMasterSuperAdmin;
const getDutyUserKey = () => getCollectorKey();
const getDutyStorageKey = () => `collector_duty_classes_${getDutyUserKey()}`;
const getDutyPaymentStorageKey = () => `collector_duty_payment_${getDutyUserKey()}`;
const readDutyClassesFromLocal = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(getDutyStorageKey()) || '[]');
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
        return [];
    }
};
const readDutyPaymentFromLocal = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(getDutyPaymentStorageKey()) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
};
const hasDutyPaymentDetails = (details = {}) => Object.values(details || {}).some((value) => String(value || '').trim().length > 0);
const getDirectoryCategoryName = (categoryId = '') => directoryCategories.find((category) => category.id === categoryId)?.name || 'Category';
const getDirectoryCollectionAccess = (entry = {}) => {
    const categoryAccess = pageAccessConfig?.categories?.[entry.categoryId] || {};
    const override = pageAccessConfig?.overrides?.[entry.id] || {};
    if (override.blocked === true) return false;
    if (typeof override.collection === 'boolean') return override.collection;
    return categoryAccess.collection === true;
};
const getDirectoryValue = (entry = {}, keys = []) => {
    const values = entry.values || {};
    for (const key of keys) {
        const value = values[key];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
};
const normalizeFeeItemName = (name = '') => String(name || '').replace(/\s*\((?:\d{4}\s*-\s*\d{2,4}|\d{4}\s*-\s*\d{4})\)\s*$/i, '').trim();
const getPaymentItemType = (payment = {}) => {
    if (payment.entryType === 'donation' || payment.itemKey === STUDENT_DONATION_ITEM_KEY) return 'donation';
    if (payment.itemType === 'month') return 'month';
    if (payment.itemType === 'custom') return 'custom';
    const feeItem = feeItems.find((item) => item.key === payment.itemKey);
    if (feeItem?.type === 'month') return 'month';
    if (feeItem?.type === 'custom') return 'custom';
    const key = String(payment.itemKey || '').trim().toLowerCase();
    if (key.startsWith('month-') || key.startsWith('month_') || key.includes('-month-')) return 'month';
    if (MONTH_SEQUENCE.some(m => key === m || key === m.slice(0, 3) || key.startsWith(m))) return 'month';
    return 'custom';
};
const getDutyPaymentDetails = () => ({
    accountName: document.getElementById('duty-pay-account-name')?.value?.trim() || '',
    upiNumber: document.getElementById('duty-pay-upi-number')?.value?.trim() || '',
    upiId: document.getElementById('duty-pay-upi-id')?.value?.trim() || '',
});
const setDutyPaymentDetailsInputs = (details = {}) => {
    const values = { ...collectorPaymentDetails, ...details };
    const setVal = (id, value = '') => { const el = document.getElementById(id); if (el) el.value = value; };
    setVal('duty-pay-account-name', values.accountName || '');
    setVal('duty-pay-upi-number', values.upiNumber || '');
    setVal('duty-pay-upi-id', values.upiId || '');
};

// History Pagination State
let sortedHistoryList = [];
let historyPageOffset = 0;
let historyRowLimit = 25;
let historyRenderToken = 0;
let historyLoadTimer = null;
let multiEntryQueue = [];
const MONTH_SEQUENCE = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const STUDENT_DONATION_ITEM_KEY = '__student_donation__';
const STUDENT_DONATION_ITEM = {
    key: STUDENT_DONATION_ITEM_KEY,
    name: 'Donation',
    type: 'custom',
    scope: 'global',
    amount: '',
    isVisible: true
};
let editingDonationId = null;
let academicYearSettings = [];
let sessionRegistryHeartbeat = null;
const getSessionRegistryRef = () => doc(db, `${BASE_PATH}/settings`, 'sessionRegistry');
const getLocalDeviceId = () => {
    const key = 'fee_collection_device_id';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const generated = `col-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(key, generated);
    return generated;
};
const getCollectionSessionUserKey = () => getCollectorKey();
const updateCollectionSessionRegistry = async () => {
    const userKey = getCollectionSessionUserKey();
    if (!userKey) return;
    const deviceId = getLocalDeviceId();
    await setDoc(getSessionRegistryRef(), {
        sessions: {
            [deviceId]: {
                deviceId,
                role: 'collection',
                userKey,
                userName: window.AppSession?.getStaffName?.() || currentUserEmail || 'Collector',
                adminEmail: currentUserEmail || '',
                deviceLabel: navigator.userAgent.includes('Android') ? 'Android Device' : navigator.userAgent.includes('iPhone') ? 'iOS Device' : 'Browser Device',
                platform: navigator.platform || '',
                lastSeenAt: new Date().toISOString(),
                forceLogout: false
            }
        }
    }, { merge: true });
};
const startCollectionSessionHeartbeat = () => {
    if (sessionRegistryHeartbeat) clearInterval(sessionRegistryHeartbeat);
    updateCollectionSessionRegistry().catch((error) => console.error('Failed to update collection session registry.', error));
    // Heartbeat disabled to protect Firebase quota - single register on entry


};
const getAcademicYearRecord = (label = '') => academicYearSettings.find((year) => year?.label === label) || null;
const getAcademicYearStatus = (label = '') => String(getAcademicYearRecord(label)?.status || 'active').toLowerCase();
const isYearVisibleInCollection = (label = '') => getAcademicYearStatus(label) !== 'archived';
const getAcademicMonthSequence = (yearLabel = '') => {
    const yearRecord = getAcademicYearRecord(yearLabel) || {};
    const startMonth = Number.isInteger(Number(yearRecord?.startMonth)) ? Number(yearRecord.startMonth) : 5;
    const endMonth = Number.isInteger(Number(yearRecord?.endMonth)) ? Number(yearRecord.endMonth) : 4;
    const months = [];
    let cursor = startMonth;
    for (let count = 0; count < 24; count += 1) {
        months.push(cursor);
        if (cursor === endMonth) break;
        cursor = (cursor + 1) % 12;
    }
    return months.length ? months : [5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];
};
const getMonthIndexFromName = (name = '') => {
    const normalized = normalizeFeeItemName(name || '').toLowerCase();
    const matchedMonth = MONTH_SEQUENCE.find((month) => normalized.startsWith(month) || (normalized.length >= 3 && month.startsWith(normalized.slice(0, 3))));
    return matchedMonth ? MONTH_SEQUENCE.indexOf(matchedMonth) : -1;
};
const sortFeeItemsForDisplay = (items = [], customYear = null) => {
    const effectiveYear = customYear || selectedFeeAcademicYear || currentWorkingAcademicYear;
    const selectedYearMonthOrder = getAcademicMonthSequence(effectiveYear);
    const monthly = items.filter((item) => (item.type || 'month') === 'month')
        .sort((a, b) => {
            const aLabel = normalizeFeeItemName(a.name || '');
            const bLabel = normalizeFeeItemName(b.name || '');
            const aIndex = getMonthIndexFromName(aLabel);
            const bIndex = getMonthIndexFromName(bLabel);
            const aOrder = selectedYearMonthOrder.indexOf(aIndex);
            const bOrder = selectedYearMonthOrder.indexOf(bIndex);
            if (aOrder === -1 && bOrder === -1) return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
            if (aOrder === -1) return 1;
            if (bOrder === -1) return -1;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
        });
    const monthlyKeys = new Set(monthly.map((item) => item.key));
    const custom = items.filter((item) => !monthlyKeys.has(item.key));
    return [...monthly, ...custom];
};
const sortMonthlyItemsByAcademicYear = (items = [], academicYear = '') => {
    const yearMonthOrder = getAcademicMonthSequence(academicYear || selectedFeeAcademicYear || currentWorkingAcademicYear);
    return [...items].sort((a, b) => {
        const aLabel = normalizeFeeItemName(a.name || '');
        const bLabel = normalizeFeeItemName(b.name || '');
        const aOrder = yearMonthOrder.indexOf(getMonthIndexFromName(aLabel));
        const bOrder = yearMonthOrder.indexOf(getMonthIndexFromName(bLabel));
        if (aOrder === -1 && bOrder === -1) return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
        if (aOrder === -1) return 1;
        if (bOrder === -1) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
    });
};

// --- LISTEN FOR TAB CHANGES FROM HTML ---
window.addEventListener('tabChanged', (e) => {
    const targetId = e.detail.tab;
    if (targetId === 'history-page') prepareHistoryData();
    if (targetId === 'fee-page' || targetId === 'master-ledger-page') syncMasterLedgerState();
    if (targetId === 'students-page') renderStudentInfoList();
    if (targetId === 'home-page') exitEditMode();
    if (targetId === 'bulk-upload-page') setupBulkUploadUI();
    if (targetId === 'donation-page') setupDonationEntryUI();
    if (targetId === 'dashboard-page') updateDashboardMetrics();
    if (targetId === 'monthly-collected-page') renderMonthlyCollectedPage(document.getElementById('monthly-collected-search-input').value);
    if (targetId === 'collector-wise-monthly-page') renderCollectorWiseMonthlyPage();
});

// --- GLOBAL EXPORTS (For HTML buttons) ---
window.openStudentProfile = (id) => {
    const s = getStudentById(id);
    if (!s) return;
    const prof = (s.profile && typeof s.profile === 'object') ? s.profile : {};
    const pick = (...vals) => {
        for (const v of vals) {
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
    };
    const formatDateIfIso = (val = '') => {
        if (!val) return '-';
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            const [y, m, d] = val.split('-');
            return `${d}/${m}/${y}`;
        }
        return val;
    };

    // 1. Photo
    const photoUrl = pick(s.photo, s.profilePhoto, s.photoUrl, prof.photo);
    const photoImg = document.getElementById('prof-photo-img');
    const photoAvatar = document.getElementById('prof-photo-avatar');
    if (photoImg && photoAvatar) {
        if (photoUrl) {
            photoImg.src = photoUrl;
            photoImg.classList.remove('hidden');
            photoAvatar.classList.add('hidden');
            photoImg.onerror = () => {
                photoImg.classList.add('hidden');
                photoAvatar.classList.remove('hidden');
            };
        } else {
            photoImg.removeAttribute('src');
            photoImg.classList.add('hidden');
            photoAvatar.classList.remove('hidden');
        }
    }

    // 2. Class, 3. UID, 4. Name, 5. Father, 6. Mother, 7. Gender, 8. Adm No, 9. DOB, 10. Adm Date, 11. Status, 12. Aadhaar, 13. Father Phone, 14. Mother Phone, 15. Address
    const setText = (elId, val) => {
        const el = document.getElementById(elId);
        if (el) el.textContent = val || '-';
    };

    setText('prof-name', pick(s.name, prof.name, 'Unnamed Student'));
    setText('prof-class', pick(s.class, s.studentClass, prof.class));
    setText('prof-gender', pick(s.gender, prof.gender));
    setText('prof-adm', pick(s.adm, prof.admNo, prof.adm));
    setText('prof-uid', pick(s.uid, prof.uid) || '-');
    setText('prof-father', pick(s.father, s.fatherName, prof.father, s.guardian));
    setText('prof-mother', pick(s.mother, s.motherName, prof.mother));
    setText('prof-dob', formatDateIfIso(pick(s.dob, prof.dob)));
    setText('prof-adm-date', formatDateIfIso(pick(s.admDate, prof.admDate)));
    setText('prof-aadhaar', pick(s.adhaar, s.aadhaar, prof.adhaar, prof.aadhaar));
    setText('prof-addr', pick(s.address, s.permanentAddress, prof.address));

    const academicYr = pick(s.academicYear, prof.academicYear, currentWorkingAcademicYear, selectedFeeAcademicYear) || '--';
    setText('prof-academic-year', academicYr);
    setText('prof-academic-year-val', academicYr);

    const statusVal = pick(s.status, prof.status) || 'Active';
    const statusEl = document.getElementById('prof-status');
    if (statusEl) {
        statusEl.textContent = statusVal;
        const lowerStatus = statusVal.toLowerCase();
        statusEl.className = lowerStatus === 'active'
            ? 'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200'
            : lowerStatus === 'discontinued'
                ? 'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200'
                : (lowerStatus === 'alumni' || lowerStatus === 'graduated')
                    ? 'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-indigo-100 text-indigo-800 border border-indigo-200'
                    : 'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-slate-200 text-slate-700 border border-slate-300';
    }

    // Fee Concession & Group Details
    const activeGroup = studentGroups.find((group) => Array.isArray(group.memberIds) && group.memberIds.includes(s.id));
    const groupWrap = document.getElementById('prof-group-wrap');
    const groupMembersEl = document.getElementById('prof-group-members');
    const groupAmountEl = document.getElementById('prof-group-amount');
    const hasIndividualConc = s.concessionFee !== undefined && s.concessionFee !== null && String(s.concessionFee).trim() !== '';

    if (activeGroup && groupWrap && groupMembersEl && groupAmountEl) {
        const groupFee = Number(activeGroup.fee || defaultFee || 200);
        setText('prof-conc', hasIndividualConc ? `${formatCurrency(s.concessionFee)}/mo (Group: ${formatCurrency(groupFee)}/mo)` : `Group Rate: ${formatCurrency(groupFee)}/mo`);
        groupAmountEl.textContent = `Group Fee: ${formatCurrency(groupFee)}/mo`;
        groupMembersEl.innerHTML = (activeGroup.memberIds || []).map((memberId, index) => {
            const member = students.find((student) => student.id === memberId) || allStudentsRaw.find((student) => student.id === memberId) || {};
            const isSelected = memberId === s.id;
            return `
                <div class="flex items-center justify-between gap-2 rounded-lg bg-white border ${isSelected ? 'border-blue-300 bg-blue-50/40' : 'border-blue-100'} px-2.5 py-1.5 text-xs">
                    <span class="${isSelected ? 'font-extrabold text-blue-950' : 'font-bold text-slate-800'} truncate">${index + 1}. ${escapeHtml(member.name || 'Unknown Student')}</span>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-bold">Adm: ${escapeHtml(member.adm || '-')}</span>
                        <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px]">Cls: ${escapeHtml(member.class || '-')}</span>
                    </div>
                </div>`;
        }).join('');
        groupWrap.classList.remove('hidden');
    } else {
        setText('prof-conc', hasIndividualConc ? `${formatCurrency(s.concessionFee)}/month` : 'None (Standard Rate)');
        groupWrap?.classList.add('hidden');
        if (groupMembersEl) groupMembersEl.innerHTML = '';
        if (groupAmountEl) groupAmountEl.textContent = '';
    }

    // 13. Father's Phone, Call & WhatsApp Buttons
    const fatherPhone = pick(s.mobile, s.fatherMobile, s.parentPhone, s.phone, prof.mobile, prof.fatherMobile);
    const mobCont = document.getElementById('prof-mobile');
    const callBtn = document.getElementById('prof-call-btn');
    const waBtn = document.getElementById('prof-wa-btn');
    if (mobCont) mobCont.textContent = fatherPhone || 'Not Available';
    if (callBtn) {
        if (fatherPhone) {
            callBtn.href = `tel:${fatherPhone}`;
            callBtn.classList.remove('hidden');
            callBtn.classList.add('inline-flex');
        } else {
            callBtn.classList.add('hidden');
            callBtn.classList.remove('inline-flex');
        }
    }
    if (waBtn) {
        const cleanWa = String(fatherPhone || '').replace(/\D/g, '');
        if (cleanWa) {
            const waNum = cleanWa.length === 10 ? `91${cleanWa}` : cleanWa;
            waBtn.href = `https://wa.me/${waNum}`;
            waBtn.classList.remove('hidden');
            waBtn.classList.add('inline-flex');
        } else {
            waBtn.classList.add('hidden');
            waBtn.classList.remove('inline-flex');
        }
    }

    // 14. Mother's Phone, Call & WhatsApp Buttons
    const motherPhone = pick(s.motherMobile, prof.motherMobile);
    const motherMobCont = document.getElementById('prof-mother-mobile');
    const motherCallBtn = document.getElementById('prof-mother-call-btn');
    const motherWaBtn = document.getElementById('prof-mother-wa-btn');
    if (motherMobCont) motherMobCont.textContent = motherPhone || 'Not Available';
    if (motherCallBtn) {
        if (motherPhone) {
            motherCallBtn.href = `tel:${motherPhone}`;
            motherCallBtn.classList.remove('hidden');
            motherCallBtn.classList.add('inline-flex');
        } else {
            motherCallBtn.classList.add('hidden');
            motherCallBtn.classList.remove('inline-flex');
        }
    }
    if (motherWaBtn) {
        const cleanWa = String(motherPhone || '').replace(/\D/g, '');
        if (cleanWa) {
            const waNum = cleanWa.length === 10 ? `91${cleanWa}` : cleanWa;
            motherWaBtn.href = `https://wa.me/${waNum}`;
            motherWaBtn.classList.remove('hidden');
            motherWaBtn.classList.add('inline-flex');
        } else {
            motherWaBtn.classList.add('hidden');
            motherWaBtn.classList.remove('inline-flex');
        }
    }

    // Apply dynamic student form field schema (visibility, labels, order, custom fields)
    const popup = document.getElementById('student-profile-popup');
    if (popup) {
        const schema = normalizeStudentFieldSchema(studentFieldSchema);

        const photoBox = photoImg?.parentElement;
        if (photoBox) {
            photoBox.classList.toggle('hidden', !isStudentFieldVisible(schema, 'photo'));
        }
        popup.querySelectorAll('[data-prof-field="status"], [data-prof-field="adm"], [data-prof-field="uid"]').forEach((el) => {
            const key = el.dataset.profField;
            el.classList.toggle('hidden', !isStudentFieldVisible(schema, key));
        });

        const grid = document.getElementById('prof-fields-grid');
        if (grid) {
            grid.querySelectorAll('[data-prof-custom-card="true"]').forEach((el) => el.remove());

            schema.forEach((field) => {
                const card = grid.querySelector(`[data-prof-field="${field.key}"]`);
                if (card) {
                    card.classList.toggle('hidden', field.visible === false);
                    const lbl = card.querySelector(`[data-prof-label="${field.key}"]`);
                    if (lbl) lbl.textContent = field.label;
                    grid.appendChild(card);
                    return;
                }
                if (field.isCustom && field.visible !== false) {
                    const rawVal = getStudentCustomValuesMap(s)[field.key] || '';
                    const displayVal = formatStudentFieldDisplayValue(s, field, '-');
                    const customCard = document.createElement('div');
                    customCard.dataset.profCustomCard = 'true';
                    customCard.dataset.profField = field.key;
                    customCard.className = `${field.type === 'textarea' ? 'sm:col-span-2 ' : ''}bg-slate-50/80 border border-slate-200/80 rounded-xl p-2.5`;

                    if (field.type === 'phone') {
                        const cleanWa = String(rawVal || '').replace(/\D/g, '');
                        const waNum = cleanWa.length === 10 ? `91${cleanWa}` : cleanWa;
                        customCard.innerHTML = `
                            <div data-prof-label="${escapeHtml(field.key)}" class="text-[10px] font-bold uppercase text-slate-400">${escapeHtml(field.label)}</div>
                            <div class="flex items-center justify-between gap-1.5 mt-0.5">
                                <span class="font-bold font-mono text-slate-800 truncate">${escapeHtml(rawVal || 'Not Available')}</span>
                                ${rawVal ? `<div class="flex items-center gap-1 shrink-0">
                                    <a href="tel:${escapeHtml(rawVal)}" class="inline-flex px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold items-center gap-1 shadow-2xs transition">
                                        <i class="fas fa-phone text-[8.5px]"></i> Call
                                    </a>
                                    ${cleanWa ? `<a href="https://wa.me/${escapeHtml(waNum)}" target="_blank" rel="noopener noreferrer" class="inline-flex px-2 py-0.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold items-center gap-1 shadow-2xs transition">
                                        <i class="fab fa-whatsapp text-[9px]"></i> WA
                                    </a>` : ''}
                                </div>` : ''}
                            </div>`;
                    } else {
                        customCard.innerHTML = `
                            <div data-prof-label="${escapeHtml(field.key)}" class="text-[10px] font-bold uppercase text-slate-400">${escapeHtml(field.label)}</div>
                            <div class="font-bold ${field.type === 'date' || field.type === 'number' ? 'font-mono ' : ''}text-slate-800 mt-0.5 break-words">${escapeHtml(displayVal)}</div>`;
                    }
                    grid.appendChild(customCard);
                }
            });
        }

        popup.classList.remove('hidden');
        popup.classList.add('flex');
        popup.style.display = 'flex';
    }
};

const renderTabSettings = () => {
    const listEl = document.getElementById('tab-settings-list');
    if (!listEl) return;
    const prefs = readTabPrefsFromLocal();
    listEl.innerHTML = getToggleableLinks().map(({ link, target }) => {
        const checked = prefs[target] !== false;
        return `<label class="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
            <span class="text-sm font-semibold text-gray-700">${escapeHtml(link.textContent.trim())}</span>
            <input type="checkbox" class="tab-pref-checkbox w-4 h-4" data-target="${target}" ${checked ? 'checked' : ''}>
        </label>`;
    }).join('');
};

document.getElementById('open-tab-settings-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    renderTabSettings();
    document.getElementById('tab-settings-popup')?.classList.remove('hidden');
    document.getElementById('tab-settings-popup')?.classList.add('flex');
    setMobileMenuState(false);
});

document.getElementById('tab-settings-save-btn')?.addEventListener('click', () => {
    const checkboxes = Array.from(document.querySelectorAll('.tab-pref-checkbox'));
    const prefs = {};
    checkboxes.forEach((checkbox) => {
        prefs[checkbox.dataset.target] = checkbox.checked;
    });
    writeTabPrefsToLocal(prefs);
    writeTabPrefsToCloud(prefs);
    applyTabVisibilityPreferences();
    document.getElementById('tab-settings-popup')?.classList.add('hidden');
    document.getElementById('tab-settings-popup')?.classList.remove('flex');
});

const openProfileHandler = (e) => {
    if (e) e.preventDefault();
    const searchKey = getCollectorKey();
    const myData = allStaff.find(s => normalizeEmail(s.email) === searchKey || String(s.loginId || '').toLowerCase() === searchKey || normalizeEmail(s.name) === searchKey);
    const staffAccess = window.AppSession?.getStaffAccess?.();

    if(myData) {
        document.getElementById('my-prof-name').textContent = myData.name || 'Staff';
        document.getElementById('my-prof-role').textContent = myData.role || myData.type || 'Staff';
        document.getElementById('my-prof-email').textContent = myData.email || '-';
        document.getElementById('my-prof-phone').textContent = myData.phone || '-';
        document.getElementById('my-prof-msr').textContent = myData.msr || '-';
        document.getElementById('my-prof-addr').textContent = myData.address || '-';
        document.getElementById('my-prof-img').src = myData.photo || "/assets/images/logo.png";
    } else if (staffAccess) {
        document.getElementById('my-prof-name').textContent = window.AppSession?.getStaffName?.() || 'Staff';
        document.getElementById('my-prof-role').textContent = staffAccess.role || staffAccess.type || 'Staff';
        document.getElementById('my-prof-email').textContent = window.AppSession?.getStaffEmail?.() || '-';
        document.getElementById('my-prof-phone').textContent = staffAccess.phone || '-';
        document.getElementById('my-prof-msr').textContent = '-';
        document.getElementById('my-prof-addr').textContent = '-';
        document.getElementById('my-prof-img').src = staffAccess.photo || "/assets/images/logo.png";
    } else if(isCurrentAdmin) {
        document.getElementById('my-prof-name').textContent = "Administrator";
        document.getElementById('my-prof-role').textContent = "Master Admin";
        document.getElementById('my-prof-email').textContent = currentUserEmail || 'admin@institute.com';
        document.getElementById('my-prof-phone').textContent = "-";
        document.getElementById('my-prof-msr').textContent = "-";
        document.getElementById('my-prof-addr').textContent = "System Administrator Account";
        document.getElementById('my-prof-img').src = "/assets/images/logo.png";
    }
    document.getElementById('my-profile-popup').classList.remove('hidden');
    document.getElementById('my-profile-popup').classList.add('flex');

    // Close Mobile Menu / Sidebar if Open
    setMobileMenuState(false);
};

document.getElementById('open-profile-btn')?.addEventListener('click', openProfileHandler);
document.getElementById('header-user-badge')?.addEventListener('click', openProfileHandler);

const handleCollectionLogout = async () => {
    try {
        if (window.AppSession?.signOut) {
            await window.AppSession.signOut(auth, { redirectUrl: getPageUrl('index.html?public=1') });
        } else {
            await signOut(auth);
            await window.AppSession?.clearAll({ purgeClientData: true });
            window.location.href = getPageUrl('index.html?public=1');
        }
    } catch (err) {
        console.warn('Logout error, forcing redirect:', err);
        window.location.href = getPageUrl('index.html?public=1');
    }
};

document.getElementById('logout-btn')?.addEventListener('click', handleCollectionLogout);
document.getElementById('sidebar-logout-btn')?.addEventListener('click', handleCollectionLogout);

// --- HELPER FUNCTIONS ---
const getStudentById = (id) => students.find(s => s.id === id) || (allStudentsRaw || []).find(s => s.id === id);
window.getStudentById = getStudentById;

const getStaffName = (email, savedName) => {
    if (savedName && savedName !== email) return savedName;
    if (!email) return 'Admin';
    const st = allStaff.find(s => s.email === email);
    if (st && st.name) return st.name;
    if (email === currentUserEmail && isCurrentAdmin) return 'Administrator';
    return email;
};

const getCurrentCollectorIdentityTokens = () => {
    const tokens = new Set();
    const staffAccess = window.AppSession?.getStaffAccess?.() || null;
    const officialSession = getOfficialSession();
    const myStaff = findCurrentStaffMember(allStaff);
    [
        getCollectorKey(),
        getEffectiveStaffEmail(),
        auth?.currentUser?.email,
        staffAccess?.userKey,
        staffAccess?.loginId,
        staffAccess?.staffId,
        officialSession?.username,
        officialSession?.email,
        officialSession?.id,
        myStaff?.id,
        myStaff?.email,
        myStaff?.loginId,
        myStaff?.username,
        myStaff?.userKey,
        myStaff?.name
    ].forEach((val) => {
        const clean = normalizeEmail(val);
        if (clean) tokens.add(clean);
    });
    return tokens;
};

const isSameCollectorRecord = (recordOrCollector = '') => {
    if (!recordOrCollector) return false;
    if (typeof recordOrCollector === 'object') {
        const currentUid = String(auth?.currentUser?.uid || '').trim();
        if (currentUid && recordOrCollector.collectedByUid && String(recordOrCollector.collectedByUid).trim() === currentUid) {
            return true;
        }
        const tokens = getCurrentCollectorIdentityTokens();
        const recBy = normalizeEmail(recordOrCollector.collectedBy || '');
        const recEmail = normalizeEmail(recordOrCollector.collectedByEmail || '');
        return Boolean((recBy && tokens.has(recBy)) || (recEmail && tokens.has(recEmail)));
    }
    const rec = normalizeEmail(recordOrCollector);
    if (!rec) return false;
    return getCurrentCollectorIdentityTokens().has(rec);
};

const canModifyPaymentRecord = (paymentOrList = null) => {
    if (isMasterSuperAdmin()) return true;
    if (!paymentOrList) return false;
    if (Array.isArray(paymentOrList)) {
        if (!paymentOrList.length) return false;
        return paymentOrList.some((p) => isSameCollectorRecord(p))
            && paymentOrList.every((p) => !(p?.collectedBy || p?.collectedByEmail || p?.collectedByUid) || isSameCollectorRecord(p));
    }
    return isSameCollectorRecord(paymentOrList);
};

const canModifyDonationRecord = (donation = null) => {
    if (isMasterSuperAdmin()) return true;
    if (!donation) return false;
    return isSameCollectorRecord(donation);
};

window.isSameCollectorRecord = isSameCollectorRecord;
window.canModifyPaymentRecord = canModifyPaymentRecord;
window.canModifyDonationRecord = canModifyDonationRecord;

const isFeeItemMatch = (paymentItemKey = '', targetItem = {}) => {
    const pKey = String(paymentItemKey || '').trim().toLowerCase();
    const tKey = String(targetItem?.key || '').trim().toLowerCase();
    if (!pKey || !tKey) return false;
    if (pKey === tKey) return true;
    if ((targetItem?.type || 'month') === 'month') {
        const tName = normalizeFeeItemName(targetItem.name || '').toLowerCase();
        const shortMonth = tName.slice(0, 3);
        if (shortMonth && (pKey === shortMonth || pKey === tName || pKey === `month_${shortMonth}` || pKey === `month-${shortMonth}`)) {
            return true;
        }
    }
    return false;
};
window.isFeeItemMatch = isFeeItemMatch;

const resolveCanonicalFeeItem = (rawKeyOrMonth = '', academicYear = '') => {
    const raw = String(rawKeyOrMonth || '').trim().toLowerCase();
    if (!raw || !Array.isArray(feeItems) || feeItems.length === 0) return null;
    const yearToMatch = academicYear || selectedFeeAcademicYear || currentWorkingAcademicYear || '';

    // 1. Exact key match in target academic year
    const exactYearMatch = feeItems.find(i =>
        String(i.key || '').trim().toLowerCase() === raw &&
        (!yearToMatch || !i.academicYear || i.academicYear === yearToMatch)
    );
    if (exactYearMatch) return exactYearMatch;

    // 2. Exact key match across any year
    const exactAnyMatch = feeItems.find(i => String(i.key || '').trim().toLowerCase() === raw);
    if (exactAnyMatch) return exactAnyMatch;

    // 3. Month prefix match (e.g. 'apr' -> 'April (2025-26)')
    const monthPrefix = raw.replace(/^month[-_]/, '').slice(0, 3);
    if (monthPrefix.length === 3) {
        const monthMatch = feeItems.find(i => {
            if ((i.type || 'month') !== 'month') return false;
            if (yearToMatch && i.academicYear && i.academicYear !== yearToMatch) return false;
            const cleanName = normalizeFeeItemName(i.name || '').toLowerCase();
            const cleanKey = String(i.key || '').toLowerCase();
            return cleanName.startsWith(monthPrefix) || cleanKey.includes(monthPrefix);
        });
        if (monthMatch) return monthMatch;
    }
    return null;
};
window.resolveCanonicalFeeItem = resolveCanonicalFeeItem;
window.resolveCanonicalFeeItemKey = resolveCanonicalFeeItem;

const isStudentInCollectorDutyScope = (studentObj = null, academicYear = '') => {
    if (isMasterSuperAdmin()) return true;
    if (!selectedDutyClasses || !selectedDutyClasses.length || !studentObj) return false;
    const stuClass = (academicYear ? getStudentClassForFeeYear(studentObj, academicYear) : '') || studentObj.class || studentObj.studentClass || '';
    return isClassInDutyScope(stuClass, selectedDutyClasses);
};

const getVisiblePayments = () => {
    if (isMasterSuperAdmin()) return allPayments;
    if (!selectedDutyClasses || !selectedDutyClasses.length) return [];
    const collectorPayments = allPayments.filter((payment) => isSameCollectorRecord(payment.collectedBy));
    const isRecordInDutyScope = (payment = {}) => {
        const st = getStudentById(payment.studentId);
        const paymentClass = payment.classLabel || payment.studentClass || getStudentClassForFeeYear(st, payment.academicYear) || st?.class || '';
        return isClassInDutyScope(paymentClass, selectedDutyClasses);
    };

    const dutyGroupIds = new Set();
    (studentGroups || []).forEach((grp) => {
        const members = Array.isArray(grp?.memberIds) ? grp.memberIds : [];
        if (members.some((mid) => isStudentInCollectorDutyScope(getStudentById(mid)))) {
            if (grp.id) dutyGroupIds.add(grp.id);
        }
    });

    const dutyLinkedTxnKeys = new Set();
    collectorPayments.forEach((payment) => {
        const hasDutyMemberTarget = Array.isArray(payment.targetGroupMemberIds)
            && payment.targetGroupMemberIds.some((mid) => isStudentInCollectorDutyScope(getStudentById(mid), payment.academicYear));
        if (isRecordInDutyScope(payment) || hasDutyMemberTarget || (payment.billingGroupId && dutyGroupIds.has(payment.billingGroupId))) {
            dutyLinkedTxnKeys.add(getPaymentGroupKey(payment));
        }
    });

    return collectorPayments.filter((payment) =>
        isRecordInDutyScope(payment)
        || dutyLinkedTxnKeys.has(getPaymentGroupKey(payment))
        || (payment.billingGroupId && dutyGroupIds.has(payment.billingGroupId))
    );
};
const getVisibleDonations = () => isMasterSuperAdmin()
    ? [...allDonations]
    : allDonations.filter((donation) => isSameCollectorRecord(donation.collectedBy));
// (getAcademicYearFromDate is initialized globally at top of file)
const toAcademicYearDocId = (academicYear = '') => String(academicYear || '').trim().replace(/[^\w-]/g, '_');
const getYearPaymentsCollectionPath = (academicYear = '') => `${BASE_PATH}/academicYears/${toAcademicYearDocId(academicYear || getAcademicYearFromDate())}/payments`;
const queuePaymentWrite = (batch, payload) => {
    const paymentRef = doc(collection(db, `${BASE_PATH}/payments`));
    batch.set(paymentRef, payload);
    const yearPath = getYearPaymentsCollectionPath(payload.academicYear);
    batch.set(doc(db, yearPath, paymentRef.id), payload);
};
const compareAcademicYears = (a = '', b = '') => {
    const [aStart = 0] = String(a).split('-').map(Number);
    const [bStart = 0] = String(b).split('-').map(Number);
    return bStart - aStart;
};
const applyCurrentYearStudentScope = () => {
    if (!Array.isArray(allStudentsRaw)) {
        students = [];
        return;
    }
    const filterActiveOnly = (student) => {
        const cls = String(student.class || '').trim().toLowerCase();
        const st = String(student.status || '').trim().toLowerCase();
        return cls !== 'alumni' && st !== 'alumni' && st !== 'graduated' && st !== 'discontinued' && student.isAlumni !== true;
    };
    if (!currentWorkingAcademicYear) {
        students = allStudentsRaw.filter(filterActiveOnly);
        return;
    }
    students = allStudentsRaw.filter((student) => {
        const hasYearEntry = student.academicYears && typeof student.academicYears[currentWorkingAcademicYear] === 'object';
        const studentYear = student.academicYear || currentWorkingAcademicYear;
        const matchesYear = hasYearEntry || (studentYear === currentWorkingAcademicYear);
        return matchesYear && filterActiveOnly(student);
    }).map((student) => {
        const yearEntry = student.academicYears?.[currentWorkingAcademicYear];
        if (yearEntry && typeof yearEntry === 'object') {
            return {
                ...student,
                class: yearEntry.class || student.class,
                studentClass: yearEntry.class || student.studentClass || student.class,
                status: yearEntry.status || student.status
            };
        }
        return student;
    });
};
const getPaymentGroupKey = (payment = {}) => {
    if (payment.transactionId) return `txn:${payment.transactionId}`;
    if (payment.receiptNo !== undefined && payment.receiptNo !== null && payment.receiptNo !== '') {
        return `rcpt:${payment.collectedBy || 'unknown'}:${payment.receiptNo}`;
    }
    return `fallback:${payment.studentId || 'unknown'}:${payment.itemKey || 'unknown'}:${payment.timestamp || payment.paymentDate || 'na'}`;
};
const parsePaymentGroupKey = (groupKey = '') => {
    if (groupKey.startsWith('txn:')) return { type: 'transaction', transactionId: groupKey.slice(4) };
    if (groupKey.startsWith('rcpt:')) {
        const payload = groupKey.slice(5);
        const splitIndex = payload.lastIndexOf(':');
        if (splitIndex === -1) return { type: 'unknown' };
        const collectedBy = payload.slice(0, splitIndex);
        const receiptNo = Number(payload.slice(splitIndex + 1));
        if (Number.isNaN(receiptNo)) return { type: 'unknown' };
        return { type: 'receipt', collectedBy, receiptNo };
    }
    return { type: 'fallback' };
};
const collectPaymentDocsForGroup = async (groupKey = '', expectedStudentId = '') => {
    const parsed = parsePaymentGroupKey(groupKey);
    if (parsed.type === 'transaction') {
        const txnSnap = await getDocs(query(collection(db, `${BASE_PATH}/payments`), where("transactionId", "==", parsed.transactionId)));
        return txnSnap.docs;
    }

    if (parsed.type === 'receipt') {
        const receiptSnap = await getDocs(query(collection(db, `${BASE_PATH}/payments`), where("receiptNo", "==", parsed.receiptNo)));
        return receiptSnap.docs.filter((docSnap) => {
            const data = docSnap.data();
            const sameCollector = (data.collectedBy || '') === parsed.collectedBy;
            if (!sameCollector) return false;
            if (!expectedStudentId) return true;
            return (data.studentId || '') === expectedStudentId;
        });
    }

    return [];
};

const logFirestorePermissionError = (error, operationType = 'write', path = `${BASE_PATH}/payments`) => {
    const errMsg = error instanceof Error ? error.message : String(error || 'Firestore error');
    if (errMsg.toLowerCase().includes('permission')) {
        const currentUser = auth?.currentUser || null;
        const errInfo = {
            error: errMsg,
            operationType,
            path,
            authInfo: {
                userId: currentUser?.uid || null,
                email: currentUser?.email || null,
                emailVerified: currentUser?.emailVerified ?? null,
                isAnonymous: currentUser?.isAnonymous ?? null,
                tenantId: currentUser?.tenantId || null,
                providerInfo: Array.isArray(currentUser?.providerData)
                    ? currentUser.providerData.map((p) => ({ providerId: p.providerId, email: p.email }))
                    : []
            }
        };
        console.error('Firestore Error: ', JSON.stringify(errInfo));
    }
};

const queueExistingPaymentDeletes = async (batch, docsList = [], fallbackList = []) => {
    const seenPaths = new Set();
    const queueIfUnique = (ref) => {
        if (!ref?.path || seenPaths.has(ref.path)) return;
        seenPaths.add(ref.path);
        batch.delete(ref);
    };
    const checkExists = async (ref) => {
        try {
            const snap = await getDoc(ref);
            return snap.exists() ? ref : null;
        } catch (_) {
            return null;
        }
    };

    const items = (Array.isArray(docsList) && docsList.length > 0)
        ? docsList.map((docSnap) => ({
            id: docSnap.id,
            primaryRef: docSnap.ref,
            primaryKnownExists: true,
            payment: docSnap.data() || {}
        }))
        : (Array.isArray(fallbackList) ? fallbackList : [])
            .filter((payment) => Boolean(payment?.id))
            .map((payment) => ({
                id: payment.id,
                primaryRef: doc(db, `${BASE_PATH}/payments`, payment.id),
                primaryKnownExists: false,
                payment
            }));

    const refsToProbe = [];
    items.forEach((item) => {
        if (item.primaryKnownExists) {
            queueIfUnique(item.primaryRef);
        } else {
            refsToProbe.push(item.primaryRef);
        }
        const year = item.payment?.academicYear || '';
        if (year) {
            const academicYearRef = doc(db, getYearPaymentsCollectionPath(year), item.id);
            const legacyYearRef = doc(db, `${BASE_PATH}/years/${year}/payments`, item.id);
            refsToProbe.push(academicYearRef, legacyYearRef);
        }
    });

    const uniqueProbeRefs = [];
    const seenProbes = new Set();
    refsToProbe.forEach((ref) => {
        if (ref?.path && !seenProbes.has(ref.path)) {
            seenProbes.add(ref.path);
            uniqueProbeRefs.push(ref);
        }
    });

    if (uniqueProbeRefs.length > 0) {
        const existingRefs = await Promise.all(uniqueProbeRefs.map(checkExists));
        existingRefs.filter(Boolean).forEach(queueIfUnique);
    }
};

const downloadTextFile = (filename, content, mimeType = 'text/plain;charset=utf-8') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const buildMonthlyReportSummary = (payments) => {
    const summary = {
        totalAmount: 0,
        defaultAmount: 0,
        donationAmount: 0,
        otherAmount: 0,
        receipts: new Set(),
        students: new Set()
    };

    const seenBillingKeys = new Set();
    payments.forEach((payment) => {
        const itemType = getPaymentItemType(payment);
        const billingKey = getPaymentBillingKey(payment);
        const shouldCountAmount = !seenBillingKeys.has(billingKey);
        if (shouldCountAmount) seenBillingKeys.add(billingKey);
        const amount = shouldCountAmount ? getMonthlyReportPaymentAmount(payment) : 0;
        summary.totalAmount = roundMoney(summary.totalAmount + amount);
        if (itemType === 'donation') summary.donationAmount = roundMoney(summary.donationAmount + amount);
        else if (itemType === 'month') summary.defaultAmount = roundMoney(summary.defaultAmount + amount);
        else summary.otherAmount = roundMoney(summary.otherAmount + amount);
        summary.receipts.add(getPaymentGroupKey(payment));
        if (payment.studentId) summary.students.add(payment.studentId);
    });

    return summary;
};

const renderMonthlySummaryCards = (payments, searchTerm = '') => {
    const summary = buildMonthlyReportSummary(payments);
    const summaryContainer = document.getElementById('monthly-report-summary');
    const subtitle = searchTerm ? `Filtered by "${searchTerm}"` : 'All visible collections';

    summaryContainer.innerHTML = `
        <div class="insight-card success">
            <div class="insight-label">Default Fee</div>
            <div class="insight-value">${formatCurrency(summary.defaultAmount)}</div>
            <div class="insight-subvalue">Monthly collections</div>
        </div>
        <div class="insight-card warning">
            <div class="insight-label">Donation</div>
            <div class="insight-value">${formatCurrency(summary.donationAmount)}</div>
            <div class="insight-subvalue">All donation entries</div>
        </div>
        <div class="insight-card info">
            <div class="insight-label">Other Fees</div>
            <div class="insight-value">${formatCurrency(summary.otherAmount)}</div>
            <div class="insight-subvalue">Custom or additional items</div>
        </div>
        <div class="insight-card">
            <div class="insight-label">Total</div>
            <div class="insight-value">${formatCurrency(summary.totalAmount)}</div>
            <div class="insight-subvalue">${summary.students.size} students • ${summary.receipts.size} receipts • ${escapeHtml(subtitle)}</div>
        </div>
    `;
};

const exportMonthlySummaryCsv = () => openReportMonthExportModal('monthly');

// --- DASHBOARD RENDER ---
const renderDashboardStudentClassTable = () => {
    const tableHost = document.getElementById('dash-students-class-table');
    if (!tableHost) return;

    if (!isMasterSuperAdmin() && (!selectedDutyClasses || !selectedDutyClasses.length)) {
        tableHost.innerHTML = '<div class="p-4 text-center text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg border border-amber-200">No duty classes assigned to your account.</div>';
        return;
    }

    const visibleClasses = isMasterSuperAdmin()
        ? [...new Set([...classes, ...students.map((student) => student.class).filter(Boolean)])]
        : getClassOptionsForCollector();

    const dutyStudents = isMasterSuperAdmin()
        ? students
        : (selectedDutyClasses.length ? students.filter(s => isClassInDutyScope(s.class, selectedDutyClasses)) : []);

    const classNames = [...visibleClasses].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));

    const rows = classNames.map((className) => {
        const classStudents = dutyStudents.filter((student) => student.class === className);
        const boys = classStudents.filter((student) => String(student.gender || '').toLowerCase().startsWith('male')).length;
        const girls = classStudents.filter((student) => String(student.gender || '').toLowerCase().startsWith('female')).length;
        return { className, boys, girls, total: classStudents.length };
    }).filter((row) => row.total > 0);

    const totals = rows.reduce((acc, row) => ({
        boys: acc.boys + row.boys,
        girls: acc.girls + row.girls,
        total: acc.total + row.total
    }), { boys: 0, girls: 0, total: 0 });

    if (!rows.length) {
        tableHost.innerHTML = '<div class="p-4 text-center text-xs font-semibold text-gray-400">No student data available.</div>';
        return;
    }

    tableHost.innerHTML = `
        <table class="w-full text-xs sm:text-sm text-left tabular-nums">
            <thead class="bg-gray-50 text-gray-500 uppercase tracking-wider text-[10px] sm:text-xs">
                <tr>
                    <th class="px-2.5 sm:px-4 py-1.5 sm:py-2 font-bold">Class</th>
                    <th class="px-2.5 sm:px-4 py-1.5 sm:py-2 font-bold text-right">Boys</th>
                    <th class="px-2.5 sm:px-4 py-1.5 sm:py-2 font-bold text-right">Girls</th>
                    <th class="px-2.5 sm:px-4 py-1.5 sm:py-2 font-bold text-right">Total</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row) => `
                    <tr class="border-t border-gray-100 hover:bg-indigo-50/30">
                        <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 font-semibold text-gray-800">${escapeHtml(row.className)}</td>
                        <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 text-right text-blue-700 font-bold">${row.boys}</td>
                        <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 text-right text-pink-700 font-bold">${row.girls}</td>
                        <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 text-right text-gray-900 font-extrabold">${row.total}</td>
                    </tr>`).join('')}
            </tbody>
            <tfoot class="bg-indigo-50 border-t border-indigo-100">
                <tr>
                    <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 font-extrabold text-indigo-900">Total</td>
                    <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 text-right font-extrabold text-indigo-900">${totals.boys}</td>
                    <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 text-right font-extrabold text-indigo-900">${totals.girls}</td>
                    <td class="px-2.5 sm:px-4 py-1.5 sm:py-2 text-right font-extrabold text-indigo-900">${totals.total}</td>
                </tr>
            </tfoot>
        </table>`;
};

const updateDashboardMetrics = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthStr = todayStr.substring(0, 7);
    const myPays = [...getVisiblePayments(), ...getVisibleDonations()];

    const sumVisiblePeriodTotal = (entries = []) => {
        const donationSum = entries
            .filter(p => p.entryType === 'donation')
            .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        const feeEntries = entries.filter(p => p.entryType !== 'donation');
        return roundMoney(sumReportPaymentsOnce(feeEntries) + donationSum);
    };

    const todayEntries = myPays.filter(p => p.paymentDate === todayStr);
    const monthEntries = myPays.filter(p => p.paymentDate && p.paymentDate.substring(0, 7) === currentMonthStr);
    const todayTotal = sumVisiblePeriodTotal(todayEntries);
    const monthTotal = sumVisiblePeriodTotal(monthEntries);
    const todayReceipts = new Set();
    todayEntries.forEach(p => todayReceipts.add(getPaymentGroupKey(p)));

    document.getElementById('dash-today-amt').textContent = todayTotal.toFixed(0);
    document.getElementById('dash-month-amt').textContent = monthTotal.toFixed(0);
    document.getElementById('dash-today-receipts').textContent = todayReceipts.size;
    const effectiveStudentsCount = isMasterSuperAdmin()
        ? students.length
        : (selectedDutyClasses.length ? students.filter(s => isClassInDutyScope(s.class, selectedDutyClasses)).length : 0);
    document.getElementById('dash-students-count').textContent = effectiveStudentsCount;
    renderDashboardStudentClassTable();
};

const getStudentEnrolledAcademicYears = (student) => {
    if (!student) return [];
    const years = new Set();
    const isAlum = student.isAlumni === true || 
        String(student.status || '').toLowerCase() === 'alumni' || 
        String(student.class || '').toLowerCase() === 'alumni';

    // 1. History keys from student.academicYears
    if (student.academicYears && typeof student.academicYears === 'object') {
        Object.keys(student.academicYears).forEach((y) => {
            if (/^\d{4}-\d{4}$/.test(y)) years.add(y);
        });
    }

    // 2. student.academicYear (if valid session format)
    if (student.academicYear && /^\d{4}-\d{4}$/.test(student.academicYear)) {
        years.add(student.academicYear);
    }

    // 3. Admission date session
    let admStartYear = null;
    if (student.admDate) {
        const d = new Date(student.admDate);
        if (!isNaN(d.getTime())) {
            const startY = (d.getMonth() >= 4) ? d.getFullYear() : d.getFullYear() - 1;
            admStartYear = startY;
            years.add(`${startY}-${startY + 1}`);
        }
    }

    // 4. Passed out / graduated year
    const gradYear = student.passedOutYear || student.graduatedYear;
    let gradStartYear = null;
    if (gradYear && /^\d{4}-\d{4}$/.test(gradYear)) {
        years.add(gradYear);
        const [gStart] = gradYear.split('-').map(Number);
        if (Number.isFinite(gStart)) gradStartYear = gStart;
    }

    // 5. Payment records for this student
    if (Array.isArray(allPayments)) {
        allPayments.forEach((p) => {
            if (p.studentId === student.id || (student.adm && p.admissionNo === student.adm)) {
                if (p.academicYear && /^\d{4}-\d{4}$/.test(p.academicYear)) {
                    years.add(p.academicYear);
                }
            }
        });
    }

    // 6. Fill intermediate continuous years between admStartYear and gradStartYear (if both exist)
    if (admStartYear !== null && gradStartYear !== null && gradStartYear >= admStartYear) {
        for (let y = admStartYear; y <= gradStartYear; y++) {
            years.add(`${y}-${y + 1}`);
        }
    }

    // 7. For non-alumni active students, also include up to current working academic year
    if (!isAlum && currentWorkingAcademicYear && /^\d{4}-\d{4}$/.test(currentWorkingAcademicYear)) {
        years.add(currentWorkingAcademicYear);
        const [curStart] = currentWorkingAcademicYear.split('-').map(Number);
        if (admStartYear !== null && Number.isFinite(curStart) && curStart >= admStartYear) {
            for (let y = admStartYear; y <= curStart; y++) {
                years.add(`${y}-${y + 1}`);
            }
        }
    }

    return Array.from(years).sort(compareAcademicYears);
};

const getAvailableFeeYearsForStudent = (student) => {
    if (!student) return [];
    const isAlum = student?.isAlumni === true || 
        String(student?.status || '').toLowerCase() === 'alumni' || 
        String(student?.class || '').toLowerCase() === 'alumni';

    const enrolledYears = getStudentEnrolledAcademicYears(student);

    if (isAlum) {
        // Strictly enrolled years only! Under NO circumstance include non-enrolled or future years.
        if (enrolledYears.length > 0) return enrolledYears;
        const fallback = student.passedOutYear || student.graduatedYear || student.academicYear;
        return (fallback && /^\d{4}-\d{4}$/.test(fallback)) ? [fallback] : [];
    }

    // Regular active students
    const configuredYears = academicYearSettings
        .filter((y) => y.status !== 'archived')
        .map((y) => y.label);

    const fallbackYear = student.academicYear || currentWorkingAcademicYear || getAcademicYearFromDate();

    const allCandidateYears = [
        ...enrolledYears,
        ...configuredYears,
        fallbackYear
    ].filter(y => y && /^\d{4}-\d{4}$/.test(y));

    return [...new Set(allCandidateYears)]
        .filter(isYearVisibleInCollection)
        .sort(compareAcademicYears);
};

const calculateStudentDuesForYear = (student, year) => {
    if (!student || !year) return { totalDues: 0, unpaidCount: 0 };

    const yearItems = (feeItems || []).filter((item) => {
        const itemYear = item.academicYear || getAcademicYearFromDate();
        if (itemYear !== year) return false;
        if (item.isVisible === false) return false;
        if (!defaultMonthlyFeeEnabled && (item.type || 'month') === 'month') return false;
        return true;
    });

    if (yearItems.length === 0) return { totalDues: 0, unpaidCount: 0 };

    const studentClassInYear = student.academicYears?.[year]?.class || 
        (student.class !== 'Alumni' && student.class !== 'ALUMNI_DUES' ? student.class : '') || '';

    const studentConcession = student.academicYears?.[year]?.concessionFee ?? student.concessionFee;
    const effectiveMonthly = (studentConcession !== undefined && studentConcession !== null && studentConcession !== '')
        ? Number(studentConcession)
        : defaultFee;

    let unpaidTotal = 0;
    let unpaidCount = 0;

    yearItems.forEach((item) => {
        const itemType = item.type || 'month';
        let itemAmount = 0;

        if (itemType === 'custom') {
            if (item.scope === 'specific') {
                if (studentClassInYear && item.targetClass && item.targetClass !== studentClassInYear) return;
                itemAmount = Number(item.amount || 0);
            } else if (item.scope === 'class-wise') {
                itemAmount = Number(item.classValues?.[studentClassInYear] || item.amount || 0);
            } else {
                itemAmount = Number(item.amount || 0);
            }
        } else {
            itemAmount = effectiveMonthly;
        }

        if (itemAmount <= 0) return;

        const isPaid = (allPayments || []).some((payment) => {
            if (payment.studentId !== student.id && (!student.adm || payment.admissionNo !== student.adm)) return false;
            const matchesItem = payment.itemKey === item.key || isFeeItemMatch(payment.itemKey, item);
            if (!matchesItem) return false;
            return (payment.academicYear || '') === year;
        });

        if (!isPaid) {
            unpaidTotal += itemAmount;
            unpaidCount += 1;
        }
    });

    return {
        totalDues: Math.max(0, roundMoney(unpaidTotal)),
        unpaidCount
    };
};

const parseAcademicStartYear = (yearStr = '') => {
    if (!yearStr) return null;
    const [start] = String(yearStr).split('-').map(Number);
    return Number.isFinite(start) ? start : null;
};

const isPastAcademicYear = (yearStr, referenceYearStr = currentWorkingAcademicYear) =>
    isPastAcademicYearLabel(yearStr, referenceYearStr);

const renderFeePastDuesBanner = (student) => {
    const banner = document.getElementById('fee-past-dues-banner');
    if (!banner) return;

    if (!student || !availableFeeAcademicYears || availableFeeAcademicYears.length <= 1) {
        banner.innerHTML = '';
        banner.classList.add('hidden');
        return;
    }

    const currentRefYear = currentWorkingAcademicYear || getAcademicYearFromDate();

    // Check only genuine PAST academic years (strictly earlier than current working year)
    // Future years (startYear > currentYear) and the current year (startYear === currentYear) are EXCLUDED!
    const pastDueItems = [];
    availableFeeAcademicYears.forEach((year) => {
        if (year === selectedFeeAcademicYear) return;
        if (!isPastAcademicYear(year, currentRefYear)) return;

        const duesInfo = calculateStudentDuesForYear(student, year);
        if (duesInfo.totalDues > 0) {
            pastDueItems.push({
                year: year,
                totalDues: duesInfo.totalDues,
                unpaidCount: duesInfo.unpaidCount
            });
        }
    });

    if (pastDueItems.length === 0) {
        banner.innerHTML = '';
        banner.classList.add('hidden');
        return;
    }

    banner.className = 'mb-3 p-2.5 rounded-lg border border-amber-200 bg-amber-50/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2';
    banner.innerHTML = `
        <div class="flex items-center gap-1.5 text-xs font-bold text-amber-900 shrink-0">
            <i class="fas fa-history text-amber-600"></i>
            <span>Past Academic Year Dues:</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
            ${pastDueItems.map(p => `
                <button type="button" class="past-due-year-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-white text-amber-950 border border-amber-300 hover:bg-amber-100 hover:border-amber-400 active:scale-95 transition shadow-2xs cursor-pointer" data-year="${escapeHtml(p.year)}" title="Switch to ${escapeHtml(p.year)} to view and collect dues">
                    <span>${escapeHtml(p.year)}:</span>
                    <span class="text-rose-700 font-black">₹${p.totalDues.toLocaleString('en-IN')} Due</span>
                    <i class="fas fa-arrow-right text-[10px] text-amber-600"></i>
                </button>
            `).join('')}
        </div>
    `;
    banner.classList.remove('hidden');
};
const renderFeeYearSwitcher = () => {
    const switcher = document.getElementById('fee-year-switcher');
    const label = document.getElementById('fee-year-label');
    const prevBtn = document.getElementById('fee-year-prev-btn');
    const nextBtn = document.getElementById('fee-year-next-btn');
    const prevLabel = document.getElementById('fee-year-prev-label');
    const nextLabel = document.getElementById('fee-year-next-label');
    if (!switcher || !label || !prevBtn || !nextBtn || !prevLabel || !nextLabel) return;
    if (!selectedStudentId || availableFeeAcademicYears.length === 0) {
        switcher.classList.add('hidden');
        return;
    }
    switcher.classList.remove('hidden');
    const currentIndex = Math.max(0, availableFeeAcademicYears.indexOf(selectedFeeAcademicYear));
    label.textContent = `${selectedFeeAcademicYear}`;
    prevBtn.disabled = currentIndex >= availableFeeAcademicYears.length - 1;
    nextBtn.disabled = currentIndex <= 0;
    prevBtn.classList.toggle('opacity-40', prevBtn.disabled);
    nextBtn.classList.toggle('opacity-40', nextBtn.disabled);
    prevLabel.textContent = currentIndex < availableFeeAcademicYears.length - 1 ? availableFeeAcademicYears[currentIndex + 1] : '--';
    nextLabel.textContent = currentIndex > 0 ? availableFeeAcademicYears[currentIndex - 1] : '--';
};

const renderMyClassTab = () => {
    const listEl = document.getElementById('my-class-list');
    if (!listEl) return;
    if (isMasterSuperAdmin()) {
        listEl.innerHTML = '<div class="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3 font-semibold"><i class="fas fa-shield-halved mr-1"></i> Administrator account has access to all classes across the institution.</div>';
        return;
    }
    const myStaffRecord = findCurrentStaffMember(allStaff);
    const adminAssigned = resolveStaffDutyClasses(myStaffRecord);
    if (!adminAssigned.length) {
        listEl.innerHTML = '<div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 font-semibold"><i class="fas fa-ban mr-1"></i> No classes assigned to your account by administrator. Please contact administrator to assign duty classes.</div>';
        return;
    }
    listEl.innerHTML = adminAssigned.map((classLabel) => {
        return `<div class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span class="text-gray-800">Class ${escapeHtml(classLabel)}</span>
            <span class="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Assigned by Admin</span>
        </div>`;
    }).join('');
};

const getStaffDirectoryRank = (staff = {}) => {
    const type = String(staff.type || '').trim().toLowerCase();
    if (type === 'teacher') return 1;
    if (type === 'management') return 2;
    return 3;
};
const buildStaffDirectoryCard = (staff = {}) => {
    const displayName = escapeHtml(staff.name || staff.email || 'Staff');
    const roleLabel = escapeHtml(staff.role || staff.type || 'Staff');
    const typeRank = getStaffDirectoryRank(staff);
    const badgeClass = typeRank === 1
        ? 'bg-blue-100 text-blue-800 border-blue-200'
        : typeRank === 2
            ? 'bg-purple-100 text-purple-800 border-purple-200'
            : 'bg-slate-100 text-slate-700 border-slate-200';
    const roleBadge = `<span class="${badgeClass} text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border">${roleLabel}</span>`;
    const classLabel = Array.isArray(staff.dutyClasses) && staff.dutyClasses.length
        ? `<div class="flex flex-wrap gap-1 mt-1">${staff.dutyClasses.map(c => `<span class="bg-gray-100 text-gray-700 text-[10px] px-1.5 py-0.5 rounded border border-gray-200">${escapeHtml(c)}</span>`).join('')}</div>`
        : '<span class="text-[10px] text-gray-400 italic">Not assigned</span>';
    const emailLine = isCurrentAdmin ? `<div class="text-[10px] text-gray-400 mt-1 truncate" title="${escapeHtml(staff.email || '--')}"><i class="fas fa-envelope mr-1"></i>${escapeHtml(staff.email || '--')}</div>` : '';
    const photo = staff.photo || '';

    return `<div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition relative flex gap-3">
        <div class="w-12 h-12 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 shadow-inner mt-0.5">
            ${photo ? `<img src="${photo}" class="w-full h-full object-cover">` : `<i class="fas fa-user text-slate-400 text-lg"></i>`}
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start mb-1 gap-2">
                <div class="font-bold text-gray-800 text-sm truncate pr-2">${displayName}</div>
                ${roleBadge}
            </div>
            ${emailLine}
            <div class="mt-3 pt-3 border-t border-gray-50">
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Duty Classes</div>
                ${classLabel}
            </div>
        </div>
    </div>`;
};
const buildDirectoryCollectorCard = (entry = {}) => {
    const displayName = escapeHtml(getDirectoryValue(entry, ['name', 'fullName', 'title']) || 'Collector');
    const categoryName = escapeHtml(getDirectoryCategoryName(entry.categoryId));
    const roleLabel = escapeHtml(getDirectoryValue(entry, ['role', 'designation', 'type']) || categoryName);
    const phone = getDirectoryValue(entry, ['phone', 'mobile', 'contactPhone']);
    const phoneLine = phone ? `<div class="text-[10px] text-gray-500 mt-1 truncate"><i class="fas fa-phone mr-1"></i>${escapeHtml(phone)}</div>` : '';
    const photo = getDirectoryValue(entry, ['photo', 'image', 'logo', 'img']) || '';

    return `<div class="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm hover:shadow-md transition relative flex gap-3">
        <div class="w-12 h-12 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 shadow-inner mt-0.5">
            ${photo ? `<img src="${photo}" class="w-full h-full object-cover">` : `<i class="fas fa-user text-slate-400 text-lg"></i>`}
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start mb-1 gap-2">
                <div class="font-bold text-gray-800 text-sm truncate pr-2">${displayName}</div>
                <span class="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">${categoryName}</span>
            </div>
            <div class="text-xs text-gray-500 font-medium">${roleLabel}</div>
            ${phoneLine}
            <div class="mt-3 pt-3 border-t border-gray-50">
                <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">Collection Access</span>
            </div>
        </div>
    </div>`;
};
const renderStaffDirectory = () => {
    const host = document.getElementById('collection-staff-directory');
    if (!host) return;
    const visibleStaff = [...allStaff]
        .filter((staff) => staff && staff.isActive !== false && staff.canCollect !== false)
        .sort((a, b) => getStaffDirectoryRank(a) - getStaffDirectoryRank(b) || Number(a.displayOrder || 999) - Number(b.displayOrder || 999) || String(a.name || '').localeCompare(String(b.name || '')));
    const visibleDirectoryCollectors = [...directoryEntries]
        .filter((entry) => entry && entry.categoryId && entry.isActive !== false && getDirectoryCollectionAccess(entry))
        .sort((a, b) => getDirectoryCategoryName(a.categoryId).localeCompare(getDirectoryCategoryName(b.categoryId)) || Number(a.displayOrder || 999) - Number(b.displayOrder || 999) || getDirectoryValue(a, ['name', 'fullName', 'title']).localeCompare(getDirectoryValue(b, ['name', 'fullName', 'title'])));
    if (!visibleStaff.length && !visibleDirectoryCollectors.length) {
        host.innerHTML = '<div class="text-xs text-gray-500 bg-white border border-dashed rounded-lg p-3">No collection-access staff available.</div>';
        return;
    }
    host.innerHTML = [
        ...visibleStaff.map(buildStaffDirectoryCard),
        ...visibleDirectoryCollectors.map(buildDirectoryCollectorCard)
    ].join('');
};

// 🌟 FIX: Database Sync Logic Update
document.getElementById('save-my-class-btn')?.addEventListener('click', async () => {
    const myStaffRecord = findCurrentStaffMember(allStaff);
    const adminAssigned = resolveStaffDutyClasses(myStaffRecord);
    selectedDutyClasses = adminAssigned;
    collectorPaymentDetails = getDutyPaymentDetails();
    
    // Save to local storage for immediate UI reflect
    localStorage.setItem(getDutyStorageKey(), JSON.stringify(selectedDutyClasses));
    localStorage.setItem(getDutyPaymentStorageKey(), JSON.stringify(collectorPaymentDetails));
    
    const msg = document.getElementById('my-class-save-msg');
    
    if (isMasterSuperAdmin()) {
        alert("Admin account cannot be assigned specific classes. Please log in as a staff member to take class duty.");
        return;
    }

    try {
        const btn = document.getElementById('save-my-class-btn');
        btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Saving...`;
        btn.disabled = true;

        if (myStaffRecord?.id) {
            // Update the collector's duty payment details in central database
            await updateDoc(doc(db, `${BASE_PATH}/staff`, myStaffRecord.id), {
                dutyPaymentDetails: collectorPaymentDetails,
                updatedAt: new Date().toISOString()
            });
            
            if (msg) {
                msg.textContent = 'Details saved successfully!';
                msg.classList.remove('opacity-0');
                setTimeout(() => { msg.classList.add('opacity-0'); }, 3000);
            }
        } else {
            alert("Your staff profile was not found in the system. Please contact the administrator.");
        }
    } catch (error) {
        console.error('Failed to save My Class Duty details', error);
        alert('Failed to save details. Please check your internet connection.');
    } finally {
        const btn = document.getElementById('save-my-class-btn');
        btn.innerHTML = `<i class="fas fa-save mr-2"></i> Save Details`;
        btn.disabled = false;
        populateClassDropdowns();
        resetStudentSelection();
        syncMasterLedgerState();
    }
});

['duty-pay-account-name', 'duty-pay-upi-number', 'duty-pay-upi-id']
    .forEach((inputId) => {
        document.getElementById(inputId)?.addEventListener('input', () => {
            collectorPaymentDetails = getDutyPaymentDetails();
        });
    });

const updateDonationDonorClearBtn = () => {
    const donorInput = document.getElementById('donation-name');
    const clearBtn = document.getElementById('donation-donor-clear-btn');
    if (!clearBtn) return;
    if (donorInput && donorInput.value.trim().length > 0) {
        clearBtn.classList.remove('hidden');
    } else {
        clearBtn.classList.add('hidden');
    }
};

const populateDonationDonorSuggestions = (searchTerm = '') => {
    const listEl = document.getElementById('donation-donor-suggestions');
    if (!listEl) return;
    const lowerTerm = (searchTerm || '').trim().toLowerCase();
    if (!lowerTerm) {
        listEl.classList.add('hidden');
        listEl.innerHTML = '';
        return;
    }

    const studentPool = Array.isArray(allStudentsRaw) && allStudentsRaw.length > 0
        ? allStudentsRaw
        : (Array.isArray(students) ? students : []);

    const matches = studentPool.filter((s) => {
        const nameMatch = (s.name || '').toLowerCase().includes(lowerTerm);
        const admMatch = (s.adm || '').toLowerCase().includes(lowerTerm);
        const rollMatch = (s.rollNo || s.roll || '').toString().toLowerCase().includes(lowerTerm);
        return nameMatch || admMatch || rollMatch;
    }).slice(0, 30);

    matches.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    listEl.innerHTML = '';

    if (matches.length > 0) {
        matches.forEach((s) => {
            const item = document.createElement('div');
            item.className = 'p-2.5 hover:bg-blue-50/80 cursor-pointer border-b border-slate-100 flex items-center justify-between gap-2 text-sm transition';
            item.innerHTML = `
                <div class="min-w-0 flex-1">
                    <div class="font-bold text-slate-800 text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                        <span>${escapeHtml(s.name)}</span>
                        ${s.class ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-800">Class: ${escapeHtml(s.class)}</span>` : ''}
                    </div>
                    <div class="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                        <span>Adm: <b class="text-slate-700">${escapeHtml(s.adm || '-')}</b></span>
                        ${s.guardian ? `<span class="text-slate-400 truncate">• Guardian: ${escapeHtml(s.guardian)}</span>` : ''}
                    </div>
                </div>
                <i class="fas fa-arrow-turn-down text-xs text-slate-300 flex-shrink-0"></i>
            `;
            item.onmousedown = (e) => {
                e.preventDefault();
                const donorInput = document.getElementById('donation-name');
                if (donorInput) {
                    donorInput.value = `${s.name}${s.adm ? ` (Adm: ${s.adm}, Class: ${s.class || '-'})` : ''}`.trim();
                }
                listEl.classList.add('hidden');
                updateDonationDonorClearBtn();
                document.getElementById('donation-amount')?.focus();
            };
            listEl.appendChild(item);
        });
        listEl.classList.remove('hidden');
    } else {
        listEl.innerHTML = `<div class="p-2.5 text-center text-xs font-semibold text-slate-500">No student matched "${escapeHtml(lowerTerm)}". Custom donor name will be used.</div>`;
        listEl.classList.remove('hidden');
    }
};

let isDonationDonorAutocompleteInitialized = false;
const initDonationDonorAutocomplete = () => {
    if (isDonationDonorAutocompleteInitialized) return;
    const donorInput = document.getElementById('donation-name');
    const clearBtn = document.getElementById('donation-donor-clear-btn');
    if (donorInput) {
        donorInput.addEventListener('input', (e) => {
            populateDonationDonorSuggestions(e.target.value);
            updateDonationDonorClearBtn();
        });
        donorInput.addEventListener('focus', (e) => {
            if (e.target.value.trim()) {
                populateDonationDonorSuggestions(e.target.value);
            }
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (donorInput) {
                donorInput.value = '';
                donorInput.focus();
            }
            populateDonationDonorSuggestions('');
            updateDonationDonorClearBtn();
        });
    }
    document.addEventListener('click', (e) => {
        const container = document.getElementById('donation-donor-container');
        if (container && !container.contains(e.target)) {
            document.getElementById('donation-donor-suggestions')?.classList.add('hidden');
        }
    });
    isDonationDonorAutocompleteInitialized = true;
};

const setupDonationEntryUI = () => {
    initDonationDonorAutocomplete();
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('donation-date');
    if (dateInput && !dateInput.value) dateInput.value = today;
    const saveBtn = document.getElementById('save-donation-btn');
    if (saveBtn) saveBtn.textContent = editingDonationId ? 'Update Donation' : 'Save Donation';
    updateDonationDonorClearBtn();
    document.getElementById('donation-donor-suggestions')?.classList.add('hidden');
};
document.getElementById('save-donation-btn')?.addEventListener('click', async () => {
    if (isDonationSaveInFlight) return;
    const donorName = document.getElementById('donation-name')?.value?.trim() || '';
    const receiptRaw = document.getElementById('donation-receipt')?.value?.trim() || '';
    const description = document.getElementById('donation-description')?.value?.trim() || '';
    const amount = Number(document.getElementById('donation-amount')?.value || 0);
    const donationDate = document.getElementById('donation-date')?.value || new Date().toISOString().split('T')[0];
    if (!donorName || !amount || amount <= 0) {
        alert('Donor name and valid amount are required.');
        return;
    }
    const receiptNo = receiptRaw ? parseInt(receiptRaw, 10) : null;
    if (receiptNo) {
        const hasDuplicate = allDonations.some((donation) => {
            if (editingDonationId && donation.id === editingDonationId) return false;
            return donation.collectedBy === getCollectorKey() && Number(donation.receiptNo) === receiptNo;
        });
        if (hasDuplicate) {
            alert(`Donation receipt ${receiptNo} is already used.`);
            return;
        }
    }
    const existingDonation = editingDonationId
        ? allDonations.find((entry) => entry.id === editingDonationId)
        : null;
    if (editingDonationId && existingDonation && !canModifyDonationRecord(existingDonation)) {
        showToast('You can only edit donations that you collected.', 'warn');
        return;
    }
    const collectorLabel = getCurrentCollectorName();
    const activeCollectorKey = getCollectorKey();
    const activeCollectorEmail = normalizeEmail(getEffectiveStaffEmail() || auth?.currentUser?.email || '');
    const activeCollectorUid = String(auth?.currentUser?.uid || '').trim();
    const preservedCollector = existingDonation?.collectedBy || activeCollectorKey;
    const preservedCollectorName = existingDonation?.collectedByName || collectorLabel;
    const isCurrentOwner = !isMasterSuperAdmin() && Boolean(existingDonation && canModifyDonationRecord(existingDonation));
    const preservedCollectorEmail = existingDonation?.collectedByEmail || (preservedCollector.includes('@') ? preservedCollector : activeCollectorEmail) || (isCurrentOwner ? activeCollectorEmail : '');
    const preservedCollectorUid = existingDonation?.collectedByUid || (editingDonationId ? (isCurrentOwner ? activeCollectorUid : '') : activeCollectorUid);
    const donationDoc = {
        donorName,
        receiptNo,
        description,
        amount,
        paymentDate: donationDate,
        academicYear: getAcademicYearFromDate(new Date(donationDate)),
        timestamp: existingDonation?.timestamp || Date.now(),
        collectedBy: editingDonationId ? preservedCollector : activeCollectorKey,
        collectedByName: editingDonationId ? preservedCollectorName : collectorLabel,
        ...(editingDonationId
            ? (preservedCollectorEmail ? { collectedByEmail: preservedCollectorEmail } : {})
            : (activeCollectorEmail ? { collectedByEmail: activeCollectorEmail } : {})),
        ...(editingDonationId
            ? (preservedCollectorUid ? { collectedByUid: preservedCollectorUid } : {})
            : (activeCollectorUid ? { collectedByUid: activeCollectorUid } : {})),
        ...(editingDonationId ? { updatedBy: activeCollectorKey, updatedAt: new Date().toISOString() } : {}),
        entryType: 'donation'
    };
    isDonationSaveInFlight = true;
    const donationBtn = document.getElementById('save-donation-btn');
    if (donationBtn) donationBtn.disabled = true;
    try {
        if (editingDonationId) {
            await updateDoc(doc(db, `${BASE_PATH}/donations`, editingDonationId), donationDoc);
        } else {
            await setDoc(doc(collection(db, `${BASE_PATH}/donations`)), donationDoc);
        }
        document.getElementById('donation-name').value = '';
        document.getElementById('donation-receipt').value = '';
        document.getElementById('donation-description').value = '';
        document.getElementById('donation-amount').value = '';
        editingDonationId = null;
        setupDonationEntryUI();
        const msg = document.getElementById('donation-save-msg');
        if (msg) {
            msg.textContent = 'Donation saved.';
            setTimeout(() => { msg.textContent = ''; }, 2000);
        }
    } catch (error) {
        logFirestorePermissionError(error, editingDonationId ? 'update' : 'create', `${BASE_PATH}/donations`);
        console.error(error);
        showToast('Failed to save donation: ' + (error?.message || 'Permission or network error'), 'error');
    } finally {
        isDonationSaveInFlight = false;
        if (donationBtn) donationBtn.disabled = false;
    }
});


const isMultiEntryMode = () => document.getElementById('multi-entry-toggle')?.checked === true;
const renderMultiEntryQueue = () => {
    const panel = document.getElementById('multi-entry-panel');
    const count = document.getElementById('multi-entry-count');
    const list = document.getElementById('multi-entry-list');
    if (!panel || !count || !list) return;
    panel.classList.toggle('hidden', !isMultiEntryMode());
    count.textContent = `${multiEntryQueue.length} students queued for same receipt`;
    list.innerHTML = multiEntryQueue.map((entry, index) => `
        <div class="flex items-center justify-between bg-white border border-blue-100 rounded-lg px-3 py-2 text-sm">
            <div><b>${escapeHtml(entry.studentName)}</b> <span class="text-slate-500">(${escapeHtml(entry.classLabel || '--')})</span><div class="text-xs text-slate-500">Items: ${entry.items.length} • ₹${Number(entry.total || 0).toFixed(0)}</div></div>
            <div class="flex gap-2">${entry.isGroupedClone ? '' : `<button type="button" class="text-blue-600 font-bold" data-multi-edit="${index}">Edit</button>`}<button type="button" class="text-red-600 font-bold" data-multi-remove="${index}">Remove</button></div>
        </div>
    `).join('') || '<div class="text-xs text-slate-500">No students added yet.</div>';
};

const buildSelectedItemsForCurrentStudent = () => {
    captureCurrentYearFeeSelections();
    return Object.entries(pendingFeeSelectionsByYear).flatMap(([year, selections]) =>
        Object.entries(selections || {})
            .filter(([, item]) => item?.checked)
            .map(([itemKey, item]) => ({ year, itemKey, itemType: item.type, amount: Number(item.amount || 0) }))
    );
};


const getStudentBillingGroup = (studentId = '') => studentGroups.find((g) => Array.isArray(g.memberIds) && g.memberIds.includes(studentId));

const roundMoney = (value = 0) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const getPaymentBillingKey = (payment = {}) => {
    const isGroupedMonthly = getPaymentItemType(payment) === 'month' && (
        Boolean(payment.billingGroupId)
        || Boolean(payment.isGroupPrimary)
        || Boolean(payment.isGroupMirror)
        || (Array.isArray(payment.targetGroupMemberIds) && payment.targetGroupMemberIds.length > 1)
    );
    if (isGroupedMonthly) {
        const groupToken = payment.billingGroupId || (Array.isArray(payment.targetGroupMemberIds) ? [...payment.targetGroupMemberIds].sort().join(',') : 'grp');
        return `${getPaymentGroupKey(payment)}__${payment.itemKey || ''}__${payment.academicYear || ''}__${groupToken}`;
    }
    return `${getPaymentGroupKey(payment)}__${payment.studentId || ''}__${payment.itemKey || ''}__${payment.academicYear || ''}`;
};
const getCurrentEffectiveMonthlyFee = () => {
    const st = getStudentById(selectedStudentId);
    if (!st) return defaultFee;
    const group = getStudentBillingGroup(st.id);
    if (!group || !Array.isArray(group.memberIds) || group.memberIds.length <= 1) {
        if (st.concessionFee !== undefined && st.concessionFee !== null && st.concessionFee !== "") {
            return parseFloat(st.concessionFee);
        }
        return defaultFee;
    }

    const selectedIds = selectedGroupMemberIds && selectedGroupMemberIds.size > 0
        ? [...selectedGroupMemberIds]
        : group.memberIds;

    // All members in group selected -> collective group fee
    if (selectedIds.length === group.memberIds.length) {
        return Number(group.fee > 0 ? group.fee : defaultFee);
    }

    // Only 1 member selected -> individual rate applies
    if (selectedIds.length === 1) {
        const member = getStudentById(selectedIds[0]);
        if (member && member.concessionFee !== undefined && member.concessionFee !== null && member.concessionFee !== "") {
            return parseFloat(member.concessionFee);
        }
        return defaultFee;
    }

    // Subset of members selected -> sum of individual rates
    let subsetSum = 0;
    selectedIds.forEach((id) => {
        const member = getStudentById(id);
        if (member && member.concessionFee !== undefined && member.concessionFee !== null && member.concessionFee !== "") {
            subsetSum += parseFloat(member.concessionFee);
        } else {
            subsetSum += defaultFee;
        }
    });
    return subsetSum;
};

const getMonthlyReportPaymentAmount = (payment = {}) => {
    const isGroupedMonthly = getPaymentItemType(payment) === 'month' && (
        Boolean(payment.billingGroupId)
        || Boolean(payment.isGroupPrimary)
        || Boolean(payment.isGroupMirror)
        || (Array.isArray(payment.targetGroupMemberIds) && payment.targetGroupMemberIds.length > 1)
    );
    if (!isGroupedMonthly) return roundMoney(payment.amount || 0);
    if (payment.groupMonthAmount !== undefined && payment.groupMonthAmount !== null && Number(payment.groupMonthAmount) > 0) {
        return roundMoney(payment.groupMonthAmount);
    }
    if (!payment.isGroupMirror && Number(payment.amount || 0) > 0) {
        return roundMoney(payment.amount);
    }
    if (payment.billingGroupId) {
        const billingGroup = studentGroups.find((group) => group.id === payment.billingGroupId);
        const groupFee = Number(billingGroup?.fee || 0);
        if (groupFee > 0) return roundMoney(groupFee);
    }
    return roundMoney(payment.amount || 0);
};
const sumReportPaymentsOnce = (payments = [], predicate = () => true) => {
    const seenBillingKeys = new Set();
    return roundMoney(payments.reduce((sum, payment) => {
        if (!predicate(payment)) return sum;
        const billingKey = getPaymentBillingKey(payment);
        if (seenBillingKeys.has(billingKey)) return sum;
        seenBillingKeys.add(billingKey);
        return sum + getMonthlyReportPaymentAmount(payment);
    }, 0));
};

const getGroupMemberStudents = (group = {}) => (group.memberIds || []).map((id) => getStudentById(id)).filter(Boolean);

const getStudentClassForFeeYear = (student = {}, academicYear = '') => {
    if (!student) return '';
    return student.academicYears?.[academicYear]?.class
        || (student.class !== 'Alumni' && student.class !== 'ALUMNI_DUES' ? student.class : '')
        || '';
};

const getCustomFeeConfigForStudent = (item = {}, student = {}, academicYear = '') => {
    if (!item || item.type !== 'custom' || !student) {
        return { amount: 0, rawAmount: '', locked: false, applicable: true };
    }
    const stuClass = getStudentClassForFeeYear(student, academicYear);
    let rawAmt = '';
    if (item.scope === 'global') {
        rawAmt = item.amount ?? '';
    } else if (item.scope === 'class-wise' && item.classValues) {
        rawAmt = item.classValues[stuClass] ?? item.classValues[student.class] ?? '';
    } else if (item.scope === 'specific') {
        if (stuClass && item.targetClass && stuClass !== item.targetClass) {
            return { amount: 0, rawAmount: '', locked: true, applicable: false };
        }
        rawAmt = item.amount ?? '';
    }
    const hasConfigured = rawAmt !== '' && rawAmt !== null && rawAmt !== undefined;
    const numericAmt = hasConfigured ? Math.max(0, Number(rawAmt) || 0) : 0;
    return {
        amount: numericAmt,
        rawAmount: hasConfigured ? rawAmt : '',
        locked: hasConfigured,
        applicable: true
    };
};

const getSelectedMembersCustomFeeConfig = (item = {}, selectedIdsSet = null, academicYear = '') => {
    const st = getStudentById(selectedStudentId);
    const group = st ? getStudentBillingGroup(st.id) : null;
    const members = group ? getGroupMemberStudents(group) : [];
    const targetIds = (group && members.length > 1)
        ? (selectedIdsSet && selectedIdsSet.size > 0 ? [...selectedIdsSet] : members.map(m => m.id))
        : (st ? [st.id] : []);

    const perMemberAmounts = {};
    let total = 0;
    let allLocked = targetIds.length > 0;
    let anyConfigured = false;

    targetIds.forEach((id) => {
        const member = getStudentById(id);
        const cfg = getCustomFeeConfigForStudent(item, member, academicYear);
        perMemberAmounts[id] = cfg.amount;
        total += cfg.amount;
        if (cfg.locked) anyConfigured = true;
        else allLocked = false;
    });

    return {
        defaultAmount: anyConfigured ? roundMoney(total) : '',
        amountLocked: targetIds.length > 0 && allLocked && anyConfigured,
        perMemberAmounts
    };
};

const getFeeItemGroupState = (item = {}, academicYear = '', selectedMemberIdsSet = null, options = {}) => {
    const st = getStudentById(selectedStudentId);
    const group = st ? getStudentBillingGroup(st.id) : null;
    const members = group ? getGroupMemberStudents(group) : [];
    if (!group || members.length <= 1) {
        return {
            isGroup: false,
            group: null,
            members: st ? [st] : [],
            paidMembers: [],
            unpaidMembers: st ? [st] : [],
            checkedPaidMembers: [],
            checkedUnpaidMembers: st ? [st] : [],
            isAllPaid: false,
            isPartial: false,
            isLockedByCheckedPaid: false,
            isLocked: false
        };
    }

    const excludeTxnId = options?.excludeTxnId || '';
    const itemType = item?.type || 'month';
    const targetObj = {
        key: item?.key || item?.itemKey || '',
        type: itemType,
        name: item?.name || item?.key || ''
    };

    const paidMembers = [];
    const unpaidMembers = [];

    members.forEach((member) => {
        const memberPay = (allPayments || []).find((payment) => {
            if (excludeTxnId && getPaymentGroupKey(payment) === excludeTxnId) return false;
            const matchesItem = payment.itemKey === targetObj.key || isFeeItemMatch(payment.itemKey, targetObj);
            if (!matchesItem) return false;
            if ((payment.academicYear || '') !== (academicYear || '')) return false;

            if (payment.studentId === member.id) return true;
            if (itemType === 'month' && payment.billingGroupId && payment.billingGroupId === group.id) {
                if (Array.isArray(payment.targetGroupMemberIds) && payment.targetGroupMemberIds.length > 0) {
                    return payment.targetGroupMemberIds.includes(member.id);
                }
                return true;
            }
            return false;
        });

        if (memberPay) {
            paidMembers.push({
                member,
                payment: memberPay,
                receiptNo: memberPay.receiptNo !== undefined && memberPay.receiptNo !== null && memberPay.receiptNo !== '' ? String(memberPay.receiptNo) : ''
            });
        } else {
            unpaidMembers.push(member);
        }
    });

    const checkedIds = selectedMemberIdsSet && selectedMemberIdsSet.size > 0
        ? selectedMemberIdsSet
        : new Set(members.map(m => m.id));

    const checkedPaidMembers = paidMembers.filter(entry => checkedIds.has(entry.member.id));
    const checkedUnpaidMembers = unpaidMembers.filter(member => checkedIds.has(member.id));

    const isAllPaid = unpaidMembers.length === 0;
    const isPartial = paidMembers.length > 0 && unpaidMembers.length > 0;
    const isLockedByCheckedPaid = !isAllPaid && checkedPaidMembers.length > 0;
    const isLocked = isAllPaid || isLockedByCheckedPaid;

    return {
        isGroup: true,
        group,
        members,
        paidMembers,
        unpaidMembers,
        checkedPaidMembers,
        checkedUnpaidMembers,
        isAllPaid,
        isPartial,
        isLockedByCheckedPaid,
        isLocked
    };
};

const buildFeeItemGroupMembersMarkup = (groupState) => {
    if (!groupState?.isGroup || !Array.isArray(groupState.members) || groupState.members.length <= 1) {
        return '';
    }
    const paidMap = new Map(groupState.paidMembers.map(entry => [entry.member.id, entry]));
    const rowsHtml = groupState.members.map((member) => {
        const paidInfo = paidMap.get(member.id);
        const memberName = member.name || 'Student';
        if (paidInfo) {
            const rcptBadge = paidInfo.receiptNo ? `#${paidInfo.receiptNo}` : 'Paid';
            return `<div class="fee-member-row is-paid" title="${escapeHtml(memberName)} - Paid${paidInfo.receiptNo ? ` (Rcpt: ${escapeHtml(paidInfo.receiptNo)})` : ''}">
                <span class="fee-member-name">✓ ${escapeHtml(memberName)}</span>
                <span class="fee-member-tag">${escapeHtml(rcptBadge)}</span>
            </div>`;
        }
        return `<div class="fee-member-row is-due" title="${escapeHtml(memberName)} - Due">
            <span class="fee-member-name">• ${escapeHtml(memberName)}</span>
            <span class="fee-member-tag">Due</span>
        </div>`;
    }).join('');
    return `<div class="fee-item-group-members">${rowsHtml}</div>`;
};

const getVisibleFeeItemsForCurrentStudentAndYear = () => {
    const st = getStudentById(selectedStudentId);
    if (!st) return [];
    const activeGroup = getStudentBillingGroup(st.id);
    const groupMembers = activeGroup ? getGroupMemberStudents(activeGroup) : [];
    const targetMembers = groupMembers.length > 1
        ? (selectedGroupMemberIds && selectedGroupMemberIds.size > 0
            ? groupMembers.filter(m => selectedGroupMemberIds.has(m.id))
            : groupMembers)
        : [st];
    const targetClasses = [...new Set(
        targetMembers
            .map(m => getStudentClassForFeeYear(m, selectedFeeAcademicYear))
            .filter(Boolean)
    )];
    return feeItems.filter((i) => {
        const itemYear = i.academicYear || getAcademicYearFromDate();
        if (selectedFeeAcademicYear && itemYear !== selectedFeeAcademicYear) return false;
        if (i.isVisible === false) return false;
        if (!defaultMonthlyFeeEnabled && (i.type || 'month') === 'month') return false;
        if (i.type === 'custom' && st) {
            if (i.scope === 'specific' && targetClasses.length > 0 && i.targetClass && !targetClasses.includes(i.targetClass)) {
                return false;
            }
        }
        return true;
    });
};

const syncFeeItemCardsGroupState = (options = {}) => {
    const st = getStudentById(selectedStudentId);
    if (!st) return;

    const excludeTxnId = options?.excludeTxnId ?? (isEditMode ? editingPaymentGroup?.txnId || '' : '');
    const isEdit = options?.isEdit ?? isEditMode;
    const visibleItems = getVisibleFeeItemsForCurrentStudentAndYear().filter(i => i.key !== STUDENT_DONATION_ITEM_KEY);
    const itemLookup = new Map(visibleItems.map(i => [i.key, i]));

    document.querySelectorAll('.fee-item-checkbox').forEach((cb) => {
        const itemKey = cb.dataset.itemKey || '';
        const itemType = cb.dataset.itemType || 'month';
        if (itemKey === STUDENT_DONATION_ITEM_KEY) return;

        const currentItemObj = itemLookup.get(itemKey) || { key: itemKey, type: itemType, name: itemKey };
        const card = cb.closest('.fee-month-item-card');
        const labelEl = cb.nextElementSibling;
        const receiptEl = labelEl?.querySelector('.fee-item-receipt');
        const membersContainer = labelEl?.querySelector('.fee-item-group-members');
        const groupState = getFeeItemGroupState(currentItemObj, selectedFeeAcademicYear, selectedGroupMemberIds, { excludeTxnId });

        if (!groupState.isGroup) {
            if (membersContainer) membersContainer.remove();
            return;
        }

        const membersMarkup = buildFeeItemGroupMembersMarkup(groupState);
        if (membersContainer) {
            membersContainer.outerHTML = membersMarkup;
        } else if (labelEl && membersMarkup) {
            labelEl.querySelector('.leading-tight')?.insertAdjacentHTML('beforeend', membersMarkup);
        }

        const isPaidHereInEdit = Boolean(isEdit && editingPaymentGroup?.itemKeys?.has(`${itemKey}__${selectedFeeAcademicYear || ''}`));

        if (isEdit && isPaidHereInEdit) {
            cb.disabled = false;
            if (receiptEl) {
                receiptEl.textContent = groupState.isPartial
                    ? `${groupState.paidMembers.length}/${groupState.members.length} Paid elsewhere`
                    : 'Editing';
                receiptEl.className = 'fee-item-receipt text-[9.5px] sm:text-[10px] opacity-90 mt-0.5 leading-tight';
            }
            return;
        }

        labelEl?.classList.remove('fee-item-paid-elsewhere', 'fee-item-partial-locked', 'fee-item-editing-yellow', 'fee-item-new-green');

        if (receiptEl) {
            if (groupState.isAllPaid) {
                receiptEl.textContent = 'All Paid';
                receiptEl.className = 'fee-item-receipt text-[9.5px] sm:text-[10px] font-bold text-emerald-700 mt-0.5 leading-tight';
            } else if (groupState.isLockedByCheckedPaid) {
                receiptEl.textContent = `${groupState.paidMembers.length}/${groupState.members.length} Paid · Uncheck paid`;
                receiptEl.className = 'fee-item-receipt text-[9px] sm:text-[10px] font-bold text-amber-800 mt-0.5 leading-tight';
            } else if (groupState.isPartial) {
                receiptEl.textContent = `${groupState.paidMembers.length}/${groupState.members.length} Paid · Due open`;
                receiptEl.className = 'fee-item-receipt text-[9px] sm:text-[10px] font-bold mt-0.5 leading-tight';
            } else {
                receiptEl.textContent = `0/${groupState.members.length} Paid`;
                receiptEl.className = 'fee-item-receipt text-[9px] sm:text-[10px] opacity-75 mt-0.5 leading-tight';
            }
        }

        if (groupState.isLocked) {
            cb.disabled = true;
            cb.checked = groupState.isAllPaid;
            labelEl?.classList.add(groupState.isAllPaid ? 'fee-item-paid-elsewhere' : 'fee-item-partial-locked');

            if (pendingFeeSelectionsByYear[selectedFeeAcademicYear]?.[itemKey]) {
                pendingFeeSelectionsByYear[selectedFeeAcademicYear][itemKey].checked = false;
            }
            if (itemType === 'custom') {
                const customInput = card?.querySelector('.custom-fee-amount-input');
                if (customInput) {
                    customInput.classList.add('hidden');
                    if (customInput.dataset.locked !== 'true') customInput.value = '';
                }
            } else {
                const monthWrap = card?.querySelector('.month-amount-wrapper');
                const monthInput = card?.querySelector('.month-fee-amount-input');
                if (monthWrap) monthWrap.classList.add('hidden');
                if (monthInput) monthInput.value = '';
            }
            return;
        }

        cb.disabled = false;
        const pending = pendingFeeSelectionsByYear[selectedFeeAcademicYear]?.[itemKey];
        if (pending?.checked || cb.checked) {
            cb.checked = true;
            if (isEdit && !editTouchedItemKeys.has(itemKey)) {
                labelEl?.classList.add('fee-item-new-green');
            }
            if (itemType === 'custom') {
                const customInput = card?.querySelector('.custom-fee-amount-input');
                const customCfg = getSelectedMembersCustomFeeConfig(currentItemObj, selectedGroupMemberIds, selectedFeeAcademicYear);
                if (customInput) {
                    customInput.dataset.locked = 'false';
                    customInput.dataset.defaultAmount = customCfg.defaultAmount !== '' ? String(customCfg.defaultAmount) : '';
                    customInput.readOnly = false;
                    customInput.classList.remove('hidden', 'bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
                    customInput.classList.add('bg-white');
                    if ((pending?.manualEdited || customInput.dataset.manualEdited === 'true') && Number.isFinite(Number(pending?.amount))) {
                        customInput.value = pending.amount;
                        customInput.dataset.manualEdited = 'true';
                    } else if (customCfg.defaultAmount !== '') {
                        customInput.value = customCfg.defaultAmount;
                    } else if (Number.isFinite(Number(pending?.amount))) {
                        customInput.value = pending.amount;
                    }
                }
            } else {
                const monthWrap = card?.querySelector('.month-amount-wrapper');
                const monthInput = card?.querySelector('.month-fee-amount-input');
                if (monthWrap) monthWrap.classList.remove('hidden');
                if (monthInput) {
                    if ((pending?.manualEdited || monthInput.dataset.manualEdited === 'true') && Number.isFinite(Number(pending?.amount))) {
                        monthInput.value = pending.amount;
                        monthInput.dataset.manualEdited = 'true';
                    } else {
                        monthInput.value = getCurrentEffectiveMonthlyFee();
                    }
                }
            }
        } else if (itemType === 'custom') {
            const customInput = card?.querySelector('.custom-fee-amount-input');
            const customCfg = getSelectedMembersCustomFeeConfig(currentItemObj, selectedGroupMemberIds, selectedFeeAcademicYear);
            if (customInput) {
                customInput.dataset.locked = 'false';
                customInput.dataset.defaultAmount = customCfg.defaultAmount !== '' ? String(customCfg.defaultAmount) : '';
                customInput.readOnly = false;
                customInput.classList.add('hidden');
                if (customInput.dataset.manualEdited !== 'true' && customCfg.defaultAmount !== '') {
                    customInput.value = customCfg.defaultAmount;
                }
            }
        }
    });
};

const renderGroupedStudentsPanel = () => {
    const panel = document.getElementById('grouped-students-panel');
    if (!panel) return;
    const group = selectedStudentId ? getStudentBillingGroup(selectedStudentId) : null;
    const members = group ? getGroupMemberStudents(group) : [];
    if (!group || members.length <= 1) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    if (!selectedGroupMemberIds || selectedGroupMemberIds.size === 0) {
        selectedGroupMemberIds = new Set(group.memberIds);
    }

    const effectiveBaseFee = getCurrentEffectiveMonthlyFee();
    const groupCollectiveFee = Number(group.fee > 0 ? group.fee : defaultFee);
    const isAllSelected = selectedGroupMemberIds.size === members.length;
    const isSingleSelected = selectedGroupMemberIds.size === 1;
    const singleStudent = isSingleSelected ? getStudentById([...selectedGroupMemberIds][0]) : null;

    const visibleItems = getVisibleFeeItemsForCurrentStudentAndYear().filter(i => i.key !== STUDENT_DONATION_ITEM_KEY);
    const excludeTxnId = isEditMode ? editingPaymentGroup?.txnId || '' : '';
    const itemGroupStates = visibleItems.map(item => ({
        item,
        state: getFeeItemGroupState(item, selectedFeeAcademicYear, selectedGroupMemberIds, { excludeTxnId })
    }));
    const hasPartialLockedItems = itemGroupStates.some(({ state }) => state.isLockedByCheckedPaid);

    const memberRows = members.map((student, index) => {
        const isChecked = selectedGroupMemberIds.has(student.id);
        const memberClass = getStudentClassForFeeYear(student, selectedFeeAcademicYear) || student.class || '--';
        const isOtherClass = !isMasterSuperAdmin() && selectedDutyClasses?.length > 0 && !isClassInDutyScope(memberClass, selectedDutyClasses);
        const hasConcession = student.concessionFee !== undefined && student.concessionFee !== null && student.concessionFee !== '';
        const indRate = hasConcession ? parseFloat(student.concessionFee) : defaultFee;
        const rateBadge = hasConcession
            ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">Concession: ${formatCurrency(indRate)}</span>`
            : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">Normal: ${formatCurrency(indRate)}</span>`;

        let memberPaidCount = 0;
        let memberDueCount = 0;
        itemGroupStates.forEach(({ state }) => {
            if (state.paidMembers.some(entry => entry.member.id === student.id)) {
                memberPaidCount += 1;
            } else {
                memberDueCount += 1;
            }
        });
        const progressText = visibleItems.length > 0
            ? `<span class="text-emerald-700 font-bold">✓ ${memberPaidCount} Paid</span><span class="text-slate-300">·</span><span class="text-red-600 font-bold">• ${memberDueCount} Due</span>`
            : '';

        return `
        <li class="flex items-center justify-between gap-2 rounded-xl bg-white border ${isChecked ? 'border-emerald-300 shadow-sm' : 'border-gray-200 opacity-65'} p-2 sm:p-2.5 transition">
            <div class="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <input type="checkbox" id="grp-stu-${student.id}" data-grp-student-id="${student.id}"
                       class="group-member-checkbox w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer flex-shrink-0"
                       ${isChecked ? 'checked' : ''}>
                <label for="grp-stu-${student.id}" class="cursor-pointer min-w-0">
                    <div class="font-bold text-gray-900 text-xs sm:text-sm truncate">${index + 1}. ${escapeHtml(student.name || 'Student')}</div>
                    <div class="text-[10.5px] sm:text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span class="font-semibold ${isOtherClass ? 'text-indigo-700' : 'text-emerald-700'}">Class: ${escapeHtml(memberClass)}${isOtherClass ? ' (Sibling)' : ''}</span>
                        <span>•</span>
                        <span>Adm: ${escapeHtml(student.adm || '--')}</span>
                        <span>•</span>
                        ${rateBadge}
                        ${progressText ? `<span>•</span>${progressText}` : ''}
                    </div>
                </label>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <button type="button" data-grp-only-id="${student.id}"
                        class="group-member-only-btn text-xs font-bold px-2.5 py-1 rounded-lg border transition ${isChecked && isSingleSelected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}"
                        title="Collect fee only for this student">
                    <i class="fas fa-user-check text-[10px] mr-1"></i>Only
                </button>
            </div>
        </li>`;
    }).join('');

    let statusNote = '';
    if (isAllSelected) {
        statusNote = `<div class="text-[11px] font-medium text-emerald-800 bg-emerald-100/70 p-2 rounded-lg border border-emerald-200 flex items-center justify-between gap-2">
            <span><i class="fas fa-users mr-1"></i><b>All ${members.length} members selected</b> (Group rate: ${formatCurrency(groupCollectiveFee)}/month applied)</span>
            <span class="font-mono font-bold text-emerald-900 shrink-0">${formatCurrency(groupCollectiveFee)}/mo</span>
        </div>`;
    } else if (isSingleSelected && singleStudent) {
        statusNote = `<div class="text-[11px] font-medium text-blue-800 bg-blue-50 p-2 rounded-lg border border-blue-200">
            <div class="flex items-center justify-between gap-2">
                <span><i class="fas fa-user mr-1"></i><b>Only ${escapeHtml(singleStudent.name)} selected</b></span>
                <span class="font-mono font-bold text-blue-900 shrink-0">${formatCurrency(effectiveBaseFee)}/mo</span>
            </div>
            <p class="text-[10px] text-blue-600 mt-1">Individual rate applies. Unchecked siblings remain due without any balance carry-over.</p>
        </div>`;
    } else {
        statusNote = `<div class="text-[11px] font-medium text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 flex items-center justify-between gap-2">
            <span><i class="fas fa-user-friends mr-1"></i><b>${selectedGroupMemberIds.size} members selected</b></span>
            <span class="font-mono font-bold text-amber-900 shrink-0">${formatCurrency(effectiveBaseFee)}/mo</span>
        </div>`;
    }

    const partialLockNotice = hasPartialLockedItems
        ? `<div class="text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1.5 flex items-start gap-2">
            <i class="fas fa-lock text-amber-600 mt-0.5"></i>
            <span>Partially paid fee items are locked while an already-paid member is checked. Uncheck the paid member(s) or tap <b>Only</b> on a due member to collect.</span>
        </div>`
        : '';

    panel.innerHTML = `
        <div class="space-y-2">
            <div class="flex items-center justify-between gap-2 border-b border-emerald-200 pb-2">
                <div class="flex items-center gap-2">
                    <span class="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs"><i class="fas fa-users"></i></span>
                    <div>
                        <div class="font-extrabold text-emerald-900 text-xs sm:text-sm">Group / Sibling Fee Selection</div>
                        <div class="text-[10px] text-emerald-700 font-semibold">${selectedGroupMemberIds.size} of ${members.length} student(s) included</div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    <button type="button" id="grp-select-all-btn"
                            class="text-xs font-bold px-2.5 py-1 rounded-lg border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100 transition shadow-sm">
                        <i class="fas fa-check-double mr-1"></i>Select All
                    </button>
                </div>
            </div>
            <ol class="space-y-1.5">${memberRows}</ol>
            ${partialLockNotice}
            ${statusNote}
        </div>`;
    panel.classList.remove('hidden');
};

const onGroupMemberSelectionChanged = () => {
    syncFeeItemCardsGroupState();
    const effectiveFee = getCurrentEffectiveMonthlyFee();
    if (pendingFeeSelectionsByYear[selectedFeeAcademicYear]) {
        Object.entries(pendingFeeSelectionsByYear[selectedFeeAcademicYear]).forEach(([key, sel]) => {
            if (!sel?.checked) return;
            const cb = document.querySelector(`.fee-item-checkbox[data-item-key="${key}"]`);
            if (!cb || cb.disabled) return;
            if (sel.type === 'month') {
                const monthInput = document.querySelector(`.month-fee-amount-input[data-item-key="${key}"]`);
                if (monthInput && monthInput.dataset.manualEdited !== 'true') {
                    sel.amount = effectiveFee;
                    monthInput.value = effectiveFee;
                }
            } else if (sel.type === 'custom') {
                const card = cb.closest('.fee-month-item-card');
                const customInput = card?.querySelector('.custom-fee-amount-input');
                const itemObj = feeItems.find(i => i.key === key);
                if (customInput && customInput.dataset.manualEdited !== 'true' && itemObj) {
                    const customCfg = getSelectedMembersCustomFeeConfig(itemObj, selectedGroupMemberIds, selectedFeeAcademicYear);
                    if (customCfg.defaultAmount !== '') {
                        sel.amount = Number(customCfg.defaultAmount);
                        customInput.value = customCfg.defaultAmount;
                    }
                }
            }
        });
    }
    updateTotalAmount();
};

const setupGroupPanelListeners = () => {
    const panel = document.getElementById('grouped-students-panel');
    if (!panel || panel.dataset.listenersAttached === 'true') return;
    panel.dataset.listenersAttached = 'true';

    panel.addEventListener('click', (e) => {
        const onlyBtn = e.target.closest('[data-grp-only-id]');
        if (onlyBtn) {
            const stuId = onlyBtn.dataset.grpOnlyId;
            if (stuId) {
                selectedGroupMemberIds = new Set([stuId]);
                onGroupMemberSelectionChanged();
            }
            return;
        }

        const selectAllBtn = e.target.closest('#grp-select-all-btn');
        if (selectAllBtn) {
            const group = selectedStudentId ? getStudentBillingGroup(selectedStudentId) : null;
            if (group && Array.isArray(group.memberIds)) {
                selectedGroupMemberIds = new Set(group.memberIds);
                onGroupMemberSelectionChanged();
            }
            return;
        }
    });

    panel.addEventListener('change', (e) => {
        const cb = e.target.closest('.group-member-checkbox');
        if (cb) {
            const stuId = cb.dataset.grpStudentId;
            if (cb.checked) {
                selectedGroupMemberIds.add(stuId);
            } else {
                if (selectedGroupMemberIds.size <= 1) {
                    cb.checked = true;
                    showToast('At least one group member must be selected.', 'warning');
                    return;
                }
                selectedGroupMemberIds.delete(stuId);
            }
            onGroupMemberSelectionChanged();
        }
    });
};

const syncGroupedStudentsForSelectedStudent = () => {
    setupGroupPanelListeners();
    syncFeeItemCardsGroupState();
    renderGroupedStudentsPanel();
};

const calculateEntryTotalForStudent = (entryItems = [], studentId = '') => {
    const baseFee = getCurrentEffectiveMonthlyFee();
    return entryItems.reduce((sum, item) => sum + Number(item.itemType === 'month' ? (item.amount !== undefined && item.amount !== null ? item.amount : baseFee) : (item.amount || 0)), 0);
};

const addCurrentStudentToMultiQueue = () => {
    if (!isMultiEntryMode()) return;
    if (!selectedStudentId) return alert('Please select a student.');
    const selected = buildSelectedItemsForCurrentStudent();
    if (!selected.length) return alert('Please select at least one fee item.');
    const activeGroup = getStudentBillingGroup(selectedStudentId);
    const targetGroupMemberIds = activeGroup && Array.isArray(activeGroup.memberIds) && activeGroup.memberIds.length > 1
        ? (selectedGroupMemberIds && selectedGroupMemberIds.size > 0 ? [...selectedGroupMemberIds] : [...activeGroup.memberIds])
        : [selectedStudentId];
    const isSingleMemberOnly = targetGroupMemberIds.length === 1;
    const isAllGroupMembers = Boolean(activeGroup && targetGroupMemberIds.length === activeGroup.memberIds.length);
    const primaryTargetId = isSingleMemberOnly ? targetGroupMemberIds[0] : selectedStudentId;
    const st = getStudentById(primaryTargetId);
    const memberNames = targetGroupMemberIds.length > 1
        ? targetGroupMemberIds.map(id => getStudentById(id)?.name).filter(Boolean).join(', ')
        : (st?.name || 'Student');
    const total = roundMoney(calculateEntryTotalForStudent(selected, primaryTargetId));
    multiEntryQueue.push({
        studentId: primaryTargetId,
        studentName: memberNames || st?.name || 'Student',
        classLabel: getStudentClassForFeeYear(st, selectedFeeAcademicYear) || st?.class || '',
        items: selected,
        total,
        billingGroupId: isAllGroupMembers ? activeGroup.id : null,
        targetGroupMemberIds
    });
    resetStudentSelection();
    document.getElementById('total-amount').value = 0;
    renderMultiEntryQueue();
};


const editMultiEntryItem = (index = -1) => {
    const entry = multiEntryQueue[index];
    if (!entry) return;
    const st = getStudentById(entry.studentId);
    if (!st) return;
    document.getElementById('entry-class').value = st.class || '';
    document.getElementById('entry-gender').value = st.gender || 'all';
    selectedStudentId = st.id;
    const entryGroup = getStudentBillingGroup(st.id);
    if (Array.isArray(entry.targetGroupMemberIds) && entry.targetGroupMemberIds.length > 0) {
        selectedGroupMemberIds = new Set(entry.targetGroupMemberIds);
    } else if (entryGroup && Array.isArray(entryGroup.memberIds) && entryGroup.memberIds.length > 1) {
        selectedGroupMemberIds = new Set(entryGroup.memberIds);
    } else {
        selectedGroupMemberIds = new Set([st.id]);
    }
    document.getElementById('entry-student-input').value = `${st.name} (Adm: ${st.adm || '-'})`;
    pendingFeeSelectionsByYear = {};
    (entry.items || []).forEach((item) => {
        const year = item.year || selectedFeeAcademicYear || '';
        if (!pendingFeeSelectionsByYear[year]) pendingFeeSelectionsByYear[year] = {};
        pendingFeeSelectionsByYear[year][item.itemKey] = { checked: true, type: item.itemType, amount: Number(item.amount || 0) };
    });
    multiEntryQueue.splice(index, 1);
    populateFeeItemSelection();
    syncGroupedStudentsForSelectedStudent();
    updateTotalAmount();
    renderMultiEntryQueue();
};

// --- FEE ENTRY & LOGIC ---
const populateClassDropdowns = () => {
    classes = resolveAcademicYearClasses({
        academicYears: academicYearSettings,
        targetYear: currentWorkingAcademicYear,
        students: Array.isArray(students) ? students : [],
        configuredClasses: institutionalConfiguredClasses
    });
    if (!classes.length) {
        classes = institutionalConfiguredClasses.length ? [...institutionalConfiguredClasses] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '+1', '+2'];
    }
    const isSuperAdmin = isMasterSuperAdmin();
    const classOptions = getClassOptionsForCollector().filter(c => {
        const u = String(c).trim().toUpperCase();
        return u && u !== 'ALUMNI' && u !== 'GRADUATED' && u !== 'ALUMNI_DUES';
    });

    const entryClassEl = document.getElementById('entry-class');
    const stuInfoClassEl = document.getElementById('stu-info-class');
    const bulkClassEl = document.getElementById('bulk-class');
    const allowAlumni = canUserViewAlumni();
    const alumniEntryOpt = allowAlumni ? `<optgroup label="Alumni"><option value="ALUMNI_DUES">🎓 Alumni</option></optgroup>` : '';
    const allowedTargetClasses = isSuperAdmin ? classes : classOptions;

    if (entryClassEl) {
        const curEntryVal = entryClassEl.value || '';
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(entryClassEl, allowedTargetClasses, {
                selectedValue: curEntryVal === 'ALUMNI_DUES' ? '' : curEntryVal,
                placeholder: '-- Select Class --',
                includeAllOption: true,
                allOptionLabel: 'All Classes',
                allOptionValue: 'all'
            });
            if (alumniEntryOpt) entryClassEl.insertAdjacentHTML('beforeend', alumniEntryOpt);
            if (curEntryVal === 'ALUMNI_DUES' && allowAlumni) {
                entryClassEl.value = 'ALUMNI_DUES';
            }
        } else {
            entryClassEl.innerHTML = `<option value="">No classes assigned</option>` + alumniEntryOpt;
            if (curEntryVal === 'ALUMNI_DUES' && allowAlumni) entryClassEl.value = 'ALUMNI_DUES';
        }
    }

    if (stuInfoClassEl) {
        const curStuVal = stuInfoClassEl.value || '';
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(stuInfoClassEl, allowedTargetClasses, {
                selectedValue: curStuVal,
                placeholder: '-- Select Class --',
                includeAllOption: true,
                allOptionLabel: 'All Classes',
                allOptionValue: 'all'
            });
        } else {
            stuInfoClassEl.innerHTML = `<option value="">No classes assigned</option>`;
        }
    }

    if (bulkClassEl) {
        const curBulkVal = bulkClassEl.value || '';
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(bulkClassEl, allowedTargetClasses, {
                selectedValue: curBulkVal,
                placeholder: '-- Select Class --',
                includeAllOption: false
            });
        } else {
            bulkClassEl.innerHTML = `<option value="">No classes assigned</option>`;
        }
    }

    // Synchronize Fee Concessions Class Filters
    const filterConc = document.getElementById('filter-conc-class');
    if (filterConc) {
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(filterConc, allowedTargetClasses, {
                selectedValue: filterConc.value || '',
                placeholder: '-- Select Class --',
                includeAllOption: true,
                allOptionLabel: 'All Classes',
                allOptionValue: 'all'
            });
        } else {
            filterConc.innerHTML = `<option value="">No classes assigned</option>`;
        }
    }
    const activeConcClassFilter = document.getElementById('active-conc-class-filter');
    if (activeConcClassFilter) {
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(activeConcClassFilter, allowedTargetClasses, {
                selectedValue: activeConcClassFilter.value || '',
                placeholder: '-- Select Class --',
                includeAllOption: true,
                allOptionLabel: 'All Classes',
                allOptionValue: 'all'
            });
        } else {
            activeConcClassFilter.innerHTML = `<option value="">No classes assigned</option>`;
        }
    }

    // Synchronize Student Groups Class Filter
    const grpClassFilter = document.getElementById('grp-class-filter');
    if (grpClassFilter) {
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(grpClassFilter, allowedTargetClasses, {
                selectedValue: grpClassFilter.value || '',
                placeholder: '-- Select Class --',
                includeAllOption: true,
                allOptionLabel: 'All Classes',
                allOptionValue: 'all'
            });
        } else {
            grpClassFilter.innerHTML = `<option value="">No classes assigned</option>`;
        }
    }

    // Synchronize Advanced Fee Target Class Dropdown
    const advFeeClassSelect = document.getElementById('adv-fee-specific-class');
    if (advFeeClassSelect) {
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(advFeeClassSelect, allowedTargetClasses, {
                selectedValue: advFeeClassSelect.value || '',
                placeholder: '-- Select Class --',
                includeAllOption: false
            });
        } else {
            advFeeClassSelect.innerHTML = `<option value="">No classes assigned</option>`;
        }
    }

    // Synchronize Edit Fee Target Class Dropdown
    const eFeeClassSelect = document.getElementById('e-fee-specific-class');
    if (eFeeClassSelect) {
        if (allowedTargetClasses.length > 0) {
            populateClassSelect(eFeeClassSelect, allowedTargetClasses, {
                selectedValue: eFeeClassSelect.value || '',
                placeholder: '-- Select Class --',
                includeAllOption: false
            });
        } else {
            eFeeClassSelect.innerHTML = `<option value="">No classes assigned</option>`;
        }
    }

    // Synchronize Fee Dues Academic Year Select
    const duesYearSelect = document.getElementById('dues-academic-year-select');
    if (duesYearSelect) {
        const curDuesYear = duesYearSelect.value;
        populateAcademicYearSelect(duesYearSelect, academicYearSettings, currentWorkingAcademicYear, {
            selectedValue: curDuesYear,
            preferCurrentUnlessUserChanged: true
        });
    }

    if (userExplicitClass && (userExplicitClass === 'all' || allowedTargetClasses.includes(userExplicitClass))) {
        if (entryClassEl) entryClassEl.value = userExplicitClass;
    }

    if (typeof applyFinanceSettingsAccessUI === 'function') {
        applyFinanceSettingsAccessUI();
    }
    syncSmartSelectDisplay(document);
    renderMyClassTab();
};

const updateStudentInputClearButton = () => {
    const input = document.getElementById('entry-student-input');
    const clearBtn = document.getElementById('entry-student-clear-btn');
    if (!input || !clearBtn) return;
    clearBtn.classList.toggle('hidden', !input.value.trim());
};
const resetStudentSelection = () => {
    selectedStudentId = null;
    selectedGroupMemberIds = new Set();
    pendingFeeSelectionsByYear = {};
    const input = document.getElementById('entry-student-input');
    if (input) input.value = '';
    document.getElementById('student-suggestions')?.classList.add('hidden');
    document.getElementById('grouped-students-panel')?.classList.add('hidden');

    // Restore top Class and Gender filters to user's deliberate selection
    const classEl = document.getElementById('entry-class');
    if (classEl) classEl.value = userExplicitClass || '';
    const genderEl = document.getElementById('entry-gender');
    if (genderEl) genderEl.value = userExplicitGender || 'all';

    updateStudentInputClearButton();
    populateFeeItemSelection();
};
document.getElementById('entry-class')?.addEventListener('change', (e) => {
    userExplicitClass = e.target.value;
    const currentInputVal = document.getElementById('entry-student-input')?.value || '';
    if (selectedStudentId) {
        const currentStudent = getStudentById(selectedStudentId);
        if (userExplicitClass && userExplicitClass !== 'all' && currentStudent && currentStudent.class !== userExplicitClass) {
            resetStudentSelection();
        }
    }
    if (currentInputVal) {
        populateStudentSuggestions(currentInputVal);
    }
});
document.getElementById('entry-gender')?.addEventListener('change', (e) => {
    userExplicitGender = e.target.value;
    const currentInputVal = document.getElementById('entry-student-input')?.value || '';
    if (selectedStudentId) {
        const currentStudent = getStudentById(selectedStudentId);
        if (userExplicitGender && userExplicitGender !== 'all' && currentStudent && currentStudent.gender !== userExplicitGender) {
            resetStudentSelection();
        }
    }
    if (currentInputVal) {
        populateStudentSuggestions(currentInputVal);
    }
});

const populateStudentSuggestions = (searchTerm = '') => {
    const cls = document.getElementById('entry-class')?.value || '';
    const gen = document.getElementById('entry-gender')?.value || '';
    const lSugg = document.getElementById('student-suggestions');
    if (!lSugg) return;

    if (!isMasterSuperAdmin() && (!selectedDutyClasses || !selectedDutyClasses.length)) {
        lSugg.innerHTML = `<div class="p-4 text-center text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg border border-amber-200">
            <i class="fas fa-exclamation-circle mr-1"></i> No duty classes assigned to your account. Please ask the administrator to assign classes in Staff Management.
        </div>`;
        lSugg.classList.remove('hidden');
        return;
    }

    const lowerTerm = (searchTerm || '').trim().toLowerCase();
    const rawPool = (Array.isArray(allStudentsRaw) && allStudentsRaw.length > 0) ? allStudentsRaw : (Array.isArray(students) && students.length > 0 ? students : []);
    const allowAlumni = canUserViewAlumni();
    const studentPool = isMasterSuperAdmin()
        ? rawPool
        : rawPool.filter(s => {
            const isAlum = s.isAlumni === true || String(s.status || '').trim().toLowerCase() === 'alumni' || String(s.class || '').trim().toLowerCase() === 'alumni';
            if (isAlum) return allowAlumni;
            return isClassInDutyScope(s.class, selectedDutyClasses);
        });

    const fil = studentPool.filter(s => {
        const classMatch = !cls || cls === 'all' || s.class === cls || (cls === 'ALUMNI_DUES' && (s.isAlumni === true || String(s.status || '').trim().toLowerCase() === 'alumni' || String(s.class || '').trim().toLowerCase() === 'alumni'));
        const genderMatch = !gen || gen === 'all' || s.gender === gen;
        if (!classMatch || !genderMatch) return false;
        if (!lowerTerm) return true;
        const nameMatch = (s.name || '').toLowerCase().includes(lowerTerm);
        const admMatch = (s.adm || '').toLowerCase().includes(lowerTerm);
        const rollMatch = (s.rollNo || s.roll || '').toString().toLowerCase().includes(lowerTerm);
        const phoneMatch = (s.phone || '').toLowerCase().includes(lowerTerm);
        return nameMatch || admMatch || rollMatch || phoneMatch;
    }).slice(0, 40);

    fil.sort((a,b) => (a.name || '').localeCompare(b.name || ''));
    lSugg.innerHTML = '';

    if (fil.length > 0) {
        fil.forEach(s => {
            const isAlum = s.isAlumni === true || String(s.status || '').trim().toLowerCase() === 'alumni' || String(s.class || '').trim().toLowerCase() === 'alumni';
            const alumBatch = s.passedOutYear || s.graduatedYear || '';
            const grp = getStudentBillingGroup(s.id);
            const grpMembers = grp ? getGroupMemberStudents(grp) : [];
            const groupBadge = grpMembers.length > 1
                ? `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200"><i class="fas fa-users mr-1"></i>Group (${grpMembers.length})</span>`
                : '';
            const statusOrBatchBadge = isAlum
                ? `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200"><i class="fas fa-graduation-cap mr-1"></i>Alumni ${alumBatch ? `(Batch ${escapeHtml(alumBatch)})` : ''}</span>`
                : `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">Class: ${escapeHtml(s.class || '-')}</span>`;

            const d = document.createElement('div');
            d.className = 'p-3 hover:bg-blue-50/80 cursor-pointer border-b border-slate-100 flex items-center justify-between gap-3 text-sm transition';
            d.innerHTML = `
                <div class="min-w-0 flex-1">
                    <div class="font-bold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                        <span>${escapeHtml(s.name)}</span>
                        ${statusOrBatchBadge}
                        ${groupBadge}
                        ${s.gender ? `<span class="text-[10px] font-bold text-slate-500">(${escapeHtml(s.gender.charAt(0))})</span>` : ''}
                        ${String(s.status || '').toLowerCase() === 'discontinued' ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-200">Discontinued</span>` : ''}
                    </div>
                    <div class="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                        <span>Adm: <b class="text-slate-700">${escapeHtml(s.adm || '-')}</b></span>
                        ${s.guardian ? `<span class="text-slate-400 truncate">• Guardian: ${escapeHtml(s.guardian)}</span>` : ''}
                    </div>
                </div>
                <i class="fas fa-chevron-right text-xs text-slate-300 flex-shrink-0"></i>
            `;
            d.onclick = () => {
                selectedStudentId = s.id;
                selectedFeeAcademicYear = '';
                // Preserve top dropdowns as selected by user:
                // If user did not select Class at top, keep it on All Classes ('').
                // If user selected Class at top, keep user's selection.
                const classSelect = document.getElementById('entry-class');
                if (classSelect) {
                    classSelect.value = userExplicitClass || '';
                }
                // If user did not select Gender at top, keep it on All Genders ('').
                // If user selected Gender at top, keep user's selection.
                const genderSelect = document.getElementById('entry-gender');
                if (genderSelect) {
                    genderSelect.value = userExplicitGender || '';
                }
                const grp = getStudentBillingGroup(s.id);
                if (grp && Array.isArray(grp.memberIds) && grp.memberIds.length > 1) {
                    selectedGroupMemberIds = new Set(grp.memberIds);
                } else {
                    selectedGroupMemberIds = new Set([s.id]);
                }
                document.getElementById('entry-student-input').value = isAlum
                    ? `${s.name} (Alumni ${alumBatch ? `• Batch ${alumBatch}` : ''} • Adm: ${s.adm||'-'})`
                    : `${s.name} (Adm: ${s.adm||'-'}, Class: ${s.class||'-'})`;
                lSugg.classList.add('hidden');
                updateStudentInputClearButton();
                populateFeeItemSelection();
                syncGroupedStudentsForSelectedStudent();
            };
            lSugg.appendChild(d);
        });
        lSugg.classList.remove('hidden');
    } else {
        if (lowerTerm) {
            lSugg.innerHTML = `<div class="p-3 text-center text-xs font-semibold text-slate-500">No students found matching "${escapeHtml(lowerTerm)}"</div>`;
            lSugg.classList.remove('hidden');
        } else {
            lSugg.classList.add('hidden');
        }
    }
};
document.getElementById('entry-student-input')?.addEventListener('focus', () => populateStudentSuggestions(''));
document.getElementById('entry-student-input')?.addEventListener('input', e => {
    if (!e.target.value.trim() && selectedStudentId) {
        resetStudentSelection();
    }
    populateStudentSuggestions(e.target.value);
    updateStudentInputClearButton();
});
document.getElementById('entry-student-clear-btn')?.addEventListener('click', () => {
    resetStudentSelection();
    document.getElementById('entry-student-input')?.focus();
});
document.addEventListener('click', e => {
    if (!document.getElementById('student-combobox-container')?.contains(e.target)) {
        document.getElementById('student-suggestions')?.classList.add('hidden');
    }
});

document.getElementById('multi-entry-toggle')?.addEventListener('change', () => { if (!isMultiEntryMode()) multiEntryQueue = []; renderMultiEntryQueue(); });
document.getElementById('add-multi-student-btn')?.addEventListener('click', addCurrentStudentToMultiQueue);
document.getElementById('clear-multi-students-btn')?.addEventListener('click', () => { multiEntryQueue = []; renderMultiEntryQueue(); });
document.getElementById('multi-entry-list')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-multi-edit]');
    if (editBtn) {
        const idx = Number(editBtn.dataset.multiEdit);
        if (!Number.isNaN(idx) && !multiEntryQueue[idx]?.isGroupedClone) editMultiEntryItem(idx);
        return;
    }
    const btn = e.target.closest('[data-multi-remove]');
    if (!btn) return;
    const idx = Number(btn.dataset.multiRemove);
    if (Number.isNaN(idx)) return;
    multiEntryQueue.splice(idx, 1);
    renderMultiEntryQueue();
});


const getNextReceiptNoForStaff = () => {
    // Global receipt sequence to prevent collisions across multiple cashier counters
    const allValid = (allPayments || []).map(p => parseInt(p.receiptNo, 10)).filter(n => !isNaN(n) && n > 0);
    if (allValid.length > 0) return Math.max(...allValid) + 1;
    return 1;
};

const checkReceiptMandatory = () => {
    let isReq = false;
    let anyChecked = false;
    document.querySelectorAll('.fee-item-checkbox:checked').forEach(cb => {
        anyChecked = true;
        const type = cb.dataset.itemType, key = cb.dataset.itemKey;
        if(type === 'custom') { 
            const item = feeItems.find(i=>i.key === key); 
            if(item && typeof item.isReceiptMandatory === 'boolean') {
                if (item.isReceiptMandatory) isReq = true;
            } else if (defaultReceiptMandatory) {
                isReq = true;
            }
        }
        else if(type === 'month') { 
            if(defaultReceiptMandatory) isReq = true; 
        }
    });
    if (!anyChecked && defaultReceiptMandatory) {
        isReq = true;
    }
    const star = document.getElementById('receipt-req-star');
    if (star) star.classList.toggle('hidden', !isReq);
    return isReq;
};
const captureCurrentYearFeeSelections = () => {
    if (!selectedFeeAcademicYear) return;
    const yearSelections = {};
    document.querySelectorAll('.fee-item-checkbox:not(:disabled)').forEach((cb) => {
        const card = cb.closest('.fee-month-item-card') || cb.closest('.relative');
        const isMonth = (cb.dataset.itemType || 'month') === 'month';
        let itemAmount = 0;
        let isManualEdited = false;
        if (isMonth) {
            const monthInput = card?.querySelector('.month-fee-amount-input');
            const parsedVal = parseFloat(monthInput?.value);
            itemAmount = Number.isFinite(parsedVal) && parsedVal >= 0 ? parsedVal : getCurrentEffectiveMonthlyFee();
            isManualEdited = monthInput?.dataset.manualEdited === 'true';
        } else {
            const customInput = card?.querySelector('.custom-fee-amount-input');
            const parsedVal = parseFloat(customInput?.value);
            itemAmount = Number.isFinite(parsedVal) && parsedVal >= 0 ? parsedVal : 0;
            isManualEdited = customInput?.dataset.manualEdited === 'true';
        }

        yearSelections[cb.dataset.itemKey] = {
            checked: cb.checked,
            type: cb.dataset.itemType || 'month',
            amount: Math.max(0, roundMoney(itemAmount)),
            manualEdited: isManualEdited
        };
    });
    pendingFeeSelectionsByYear[selectedFeeAcademicYear] = yearSelections;
};

const updateTotalAmount = () => {
    let total = 0;
    captureCurrentYearFeeSelections();
    Object.values(pendingFeeSelectionsByYear).forEach((yearSelections = {}) => {
        Object.values(yearSelections).forEach((selection) => {
            if (!selection?.checked) return;
            total += Number(selection.amount || 0);
        });
    });
    document.getElementById('total-amount').value = roundMoney(total);
    renderGroupedStudentsPanel();
    checkReceiptMandatory();
};

const populateFeeItemSelection = () => {
    const st = getStudentById(selectedStudentId);
    const container = document.getElementById('fee-item-selection-container');

    if(!st) {
        container.innerHTML = '<div class="col-span-3 text-center text-xs font-semibold text-gray-400 py-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">Search and select a student first</div>';
        document.getElementById('total-amount').value = 0;
        const dueNotice = document.getElementById('fee-due-notice');
        if (dueNotice) {
            dueNotice.textContent = '';
            dueNotice.classList.add('hidden');
        }
        const pastDuesBanner = document.getElementById('fee-past-dues-banner');
        if (pastDuesBanner) {
            pastDuesBanner.innerHTML = '';
            pastDuesBanner.classList.add('hidden');
        }
        availableFeeAcademicYears = [];
        selectedFeeAcademicYear = '';
        renderFeeYearSwitcher();
        return;
    }

    availableFeeAcademicYears = getAvailableFeeYearsForStudent(st);

    const isAlum = st.isAlumni === true || 
        String(st.status || '').toLowerCase() === 'alumni' || 
        String(st.class || '').toLowerCase() === 'alumni';

    if (isAlum) {
        if (!selectedFeeAcademicYear || !availableFeeAcademicYears.includes(selectedFeeAcademicYear)) {
            let yearWithDues = null;
            for (const yr of availableFeeAcademicYears) {
                const duesInfo = calculateStudentDuesForYear(st, yr);
                if (duesInfo.totalDues > 0) {
                    yearWithDues = yr;
                    break;
                }
            }
            selectedFeeAcademicYear = yearWithDues || availableFeeAcademicYears[0] || '';
        }
    } else {
        if (!selectedFeeAcademicYear || !availableFeeAcademicYears.includes(selectedFeeAcademicYear)) {
            if (currentWorkingAcademicYear && availableFeeAcademicYears.includes(currentWorkingAcademicYear)) {
                selectedFeeAcademicYear = currentWorkingAcademicYear;
            } else {
                selectedFeeAcademicYear = st.academicYear && availableFeeAcademicYears.includes(st.academicYear)
                    ? st.academicYear
                    : availableFeeAcademicYears[0];
            }
        }
    }
    renderFeeYearSwitcher();
    renderFeePastDuesBanner(st);

    const studentClassInSelectedYear = st.academicYears?.[selectedFeeAcademicYear]?.class || 
        (st.class !== 'Alumni' && st.class !== 'ALUMNI_DUES' ? st.class : '') || '';

    const visibleItems = getVisibleFeeItemsForCurrentStudentAndYear();

    if (visibleItems.length === 0) {
         const emptyMsg = !defaultMonthlyFeeEnabled
             ? 'Default 12-Month Fee is disabled and no custom fee items are configured for this academic year.'
             : 'No fee items available';
         container.innerHTML = `<div class="col-span-3 text-center text-xs font-semibold text-gray-500 py-4 px-3 bg-gray-50 rounded-lg border border-dashed border-gray-300">${emptyMsg}</div>`;
         document.getElementById('total-amount').value = 0;
         return;
    }

    const activeGroup = getStudentBillingGroup(st.id);
    const isGroupedStudent = Boolean(activeGroup && getGroupMemberStudents(activeGroup).length > 1);

    const renderFeeOption = (item) => {
        let defaultAmt = '';
        if (item.type === 'custom' && st) {
            const customCfg = getSelectedMembersCustomFeeConfig(item, selectedGroupMemberIds, selectedFeeAcademicYear);
            defaultAmt = customCfg.defaultAmount;
        }

        const itemYear = item.academicYear || '--';
        const displayName = normalizeFeeItemName(item.name || 'Fee Item');
        const isMonth = (item.type || 'month') === 'month';
        return `
        <div class="relative fee-month-item-card" data-item-key="${item.key}">
            <input type="checkbox" id="item-${item.key}" data-item-key="${item.key}" data-item-type="${item.type||'month'}" class="fee-item-checkbox peer sr-only">
            <label for="item-${item.key}" class="block py-1.5 sm:py-2 px-1 text-[11px] sm:text-xs font-semibold border-2 border-red-300 text-red-700 rounded-lg cursor-pointer text-center bg-red-50 peer-checked:bg-green-600 peer-checked:text-white peer-checked:border-green-600 shadow-sm transition fee-item-label" title="${item.name}">
                <div class="leading-tight">
                    <div class="font-bold break-words">${displayName}</div>
                    <div class="text-[10px] opacity-80 mt-0.5 sm:mt-1 block">${itemYear}</div>
                    <div class="fee-item-receipt text-[10px] opacity-70 mt-0.5 sm:mt-1 ${isGroupedStudent ? 'min-h-[12px]' : 'h-3'}"></div>
                </div>
            </label>
            ${isMonth ? `
            <div class="month-amount-wrapper hidden mt-1 sm:mt-1.5">
                <div class="relative">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-green-700">₹</span>
                    <input type="number" step="any" min="0" data-item-key="${item.key}"
                           class="month-fee-amount-input w-full p-1 pl-5 text-xs font-bold border border-green-300 rounded-md shadow-sm text-center bg-white text-green-900 focus:ring-1 focus:ring-green-500 focus:outline-none tabular-nums"
                           placeholder="Amount">
                </div>
            </div>` : `
            <div class="custom-amount-wrapper">
                <input type="number" step="any" min="0" data-locked="false" data-default-amount="${defaultAmt}" class="custom-fee-amount-input hidden w-full mt-1 sm:mt-1.5 p-1 sm:p-1.5 text-xs font-bold border border-amber-300 rounded-md shadow-sm text-center bg-white text-slate-900 focus:ring-1 focus:ring-emerald-500 focus:outline-none tabular-nums" placeholder="₹ Amount" value="${defaultAmt}">
            </div>
            `}
        </div>`;
    };
    const monthlyItems = sortMonthlyItemsByAcademicYear(
        visibleItems.filter((item) => (item.type || 'month') === 'month'),
        selectedFeeAcademicYear
    );
    const otherItems = visibleItems.filter((item) => (item.type || 'month') === 'custom' && item.key !== STUDENT_DONATION_ITEM_KEY);
    const buildSection = (title, items, tone = 'text-gray-500') => {
        if (!items.length) return '';
        return `<div class="col-span-3 mt-1.5 sm:mt-2"><div class="text-[10px] uppercase tracking-widest font-bold ${tone} mb-1.5 sm:mb-2">${title}</div><div class="grid grid-cols-3 gap-1.5 sm:gap-2">${items.map(renderFeeOption).join('')}</div></div>`;
    };
    container.innerHTML = [
        buildSection('Monthly Fees', monthlyItems, 'text-blue-600'),
        buildSection('Other Fees', otherItems, 'text-amber-600')
    ].filter(Boolean).join('');

    if (st) {
        if (isGroupedStudent) {
            syncFeeItemCardsGroupState();
        } else {
            document.querySelectorAll('.fee-item-checkbox').forEach(cb => {
                const isDonationItem = cb.dataset.itemKey === STUDENT_DONATION_ITEM_KEY;
                const currentItemObj = visibleItems.find(i => i.key === cb.dataset.itemKey);
                const pay = allPayments.find((payment) => {
                    if (payment.studentId !== st.id) return false;
                    const matchesItem = payment.itemKey === cb.dataset.itemKey || isFeeItemMatch(payment.itemKey, currentItemObj || { key: cb.dataset.itemKey, type: cb.dataset.itemType, name: cb.dataset.itemKey });
                    if (!matchesItem) return false;
                    return (payment.academicYear || '') === (selectedFeeAcademicYear || '');
                });
                const donationCount = isDonationItem
                    ? allPayments.filter((payment) => payment.studentId === st.id && payment.itemKey === STUDENT_DONATION_ITEM_KEY && (payment.academicYear || '') === (selectedFeeAcademicYear || '')).length
                    : 0;
                cb.checked = false; cb.disabled = isDonationItem ? false : !!pay;
                const receiptEl = cb.nextElementSibling.querySelector('.fee-item-receipt');
                if (receiptEl) receiptEl.textContent = isDonationItem ? (donationCount ? `${donationCount} donation(s)` : '') : (pay?.receiptNo ? `Rcpt: ${pay.receiptNo}` : '');

                // Clear custom colors
                const labelEl = cb.nextElementSibling;
                labelEl.classList.remove('fee-item-paid-elsewhere', 'fee-item-partial-locked', 'fee-item-editing-yellow', 'fee-item-new-green');

                if (pay && !isDonationItem) {
                    labelEl.classList.add('fee-item-paid-elsewhere');
                    cb.checked = true;
                }
                const pending = pendingFeeSelectionsByYear[selectedFeeAcademicYear]?.[cb.dataset.itemKey];
                if (!cb.disabled && pending?.checked) {
                    cb.checked = true;
                    if (cb.dataset.itemType === 'custom') {
                        const customInput = cb.closest('.fee-month-item-card')?.querySelector('.custom-fee-amount-input');
                        if (customInput) {
                            customInput.classList.remove('hidden');
                            if (Number.isFinite(Number(pending.amount))) customInput.value = pending.amount;
                            if (pending.manualEdited) customInput.dataset.manualEdited = 'true';
                        }
                    } else {
                        const monthWrap = cb.closest('.fee-month-item-card')?.querySelector('.month-amount-wrapper');
                        const monthInput = cb.closest('.fee-month-item-card')?.querySelector('.month-fee-amount-input');
                        if (monthWrap) monthWrap.classList.remove('hidden');
                        if (monthInput) {
                            monthInput.value = Number.isFinite(Number(pending.amount)) ? pending.amount : getCurrentEffectiveMonthlyFee();
                            if (pending.manualEdited) monthInput.dataset.manualEdited = 'true';
                        }
                    }
                }
            });
        }
    }
    const dueNotice = document.getElementById('fee-due-notice');
    if (dueNotice) {
        dueNotice.textContent = '';
        dueNotice.classList.add('hidden');
    }
    updateTotalAmount();
};

document.getElementById('fee-item-selection-container')?.addEventListener('input', e => {
    if(e.target.classList.contains('custom-fee-amount-input') || e.target.classList.contains('month-fee-amount-input')) {
        e.target.dataset.manualEdited = 'true';
        updateTotalAmount();
    }
});
document.getElementById('fee-item-selection-container')?.addEventListener('change', e => {
    if (e.target.classList.contains('fee-item-checkbox')) {
        const cb = e.target;
        const card = cb.closest('.fee-month-item-card');
        const itemType = cb.dataset.itemType || 'month';
        const itemKey = cb.dataset.itemKey || '';

        if (isEditMode) {
            if (itemKey) editTouchedItemKeys.add(itemKey);
            const labelEl = cb.nextElementSibling;
            labelEl.classList.remove('fee-item-editing-yellow', 'fee-item-new-green');
            if (cb.checked) {
                labelEl.classList.add('fee-item-new-green');
            }
        }

        if(itemType === 'custom') {
            const input = card?.querySelector('.custom-fee-amount-input');
            if(input) {
                const itemObj = feeItems.find(i => i.key === itemKey);
                let resolvedDefault = input.dataset.defaultAmount || '';
                if (itemObj) {
                    const customCfg = getSelectedMembersCustomFeeConfig(itemObj, selectedGroupMemberIds, selectedFeeAcademicYear);
                    input.dataset.locked = 'false';
                    input.readOnly = false;
                    resolvedDefault = customCfg.defaultAmount !== '' ? String(customCfg.defaultAmount) : '';
                    input.dataset.defaultAmount = resolvedDefault;
                }
                input.classList.toggle('hidden', !cb.checked);
                if (cb.checked) {
                    if ((!input.value || Number(input.value) === 0) && resolvedDefault !== '' && input.dataset.manualEdited !== 'true') {
                        input.value = resolvedDefault;
                    }
                } else {
                    input.dataset.manualEdited = '';
                    input.value = resolvedDefault;
                }
            }
        } else {
            const monthWrap = card?.querySelector('.month-amount-wrapper');
            const monthInput = card?.querySelector('.month-fee-amount-input');
            if (monthWrap) monthWrap.classList.toggle('hidden', !cb.checked);
            if (monthInput) {
                if (cb.checked) {
                    if (!monthInput.value || Number(monthInput.value) === 0) {
                        monthInput.value = getCurrentEffectiveMonthlyFee();
                    }
                } else {
                    monthInput.dataset.manualEdited = '';
                    monthInput.value = '';
                }
            }
        }
        updateTotalAmount();
    }
});

const totalAmountInput = document.getElementById('total-amount');
if (totalAmountInput && totalAmountInput.dataset.listenerAttached !== 'true') {
    totalAmountInput.dataset.listenerAttached = 'true';
    totalAmountInput.addEventListener('input', (e) => {
        const rawTotal = parseFloat(e.target.value);
        const desiredTotal = Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : 0;

        const checkedEnabledCbs = Array.from(document.querySelectorAll('.fee-item-checkbox:checked'))
            .filter(cb => !cb.disabled);

        const activeMonthInputs = checkedEnabledCbs
            .filter(cb => (cb.dataset.itemType || 'month') === 'month')
            .map(cb => cb.closest('.fee-month-item-card')?.querySelector('.month-fee-amount-input'))
            .filter(Boolean);

        const activeCustomInputs = checkedEnabledCbs
            .filter(cb => cb.dataset.itemType === 'custom')
            .map(cb => cb.closest('.fee-month-item-card')?.querySelector('.custom-fee-amount-input'))
            .filter(Boolean);

        if (activeMonthInputs.length === 0 && activeCustomInputs.length === 0) return;

        const distributeIntoInputs = (inputs, totalToDistribute) => {
            if (!inputs.length) return;
            const targetTotal = Math.max(0, roundMoney(totalToDistribute));
            const currentSum = inputs.reduce((s, inp) => s + Math.max(0, Number(inp.value || 0)), 0);
            const allEqualOrZero = currentSum <= 0 || inputs.every(inp => Math.abs(Number(inp.value || 0) - Number(inputs[0].value || 0)) < 0.01);

            let runningSum = 0;
            inputs.forEach((inp, idx) => {
                const isLast = idx === inputs.length - 1;
                let amt = 0;
                if (isLast) {
                    amt = roundMoney(Math.max(0, targetTotal - runningSum));
                } else if (allEqualOrZero) {
                    amt = roundMoney(targetTotal / inputs.length);
                    runningSum = roundMoney(runningSum + amt);
                } else {
                    const weight = Math.max(0, Number(inp.value || 0)) / currentSum;
                    amt = roundMoney(targetTotal * weight);
                    runningSum = roundMoney(runningSum + amt);
                }
                inp.value = Math.max(0, amt);
                inp.dataset.manualEdited = 'true';
            });
        };

        const customTotal = roundMoney(activeCustomInputs.reduce((sum, inp) => sum + Math.max(0, Number(inp.value || 0)), 0));

        if (activeMonthInputs.length > 0 && activeCustomInputs.length === 0) {
            distributeIntoInputs(activeMonthInputs, desiredTotal);
        } else if (activeMonthInputs.length === 0 && activeCustomInputs.length > 0) {
            distributeIntoInputs(activeCustomInputs, desiredTotal);
        } else {
            if (desiredTotal >= customTotal) {
                distributeIntoInputs(activeMonthInputs, desiredTotal - customTotal);
            } else {
                activeMonthInputs.forEach(inp => {
                    inp.value = 0;
                    inp.dataset.manualEdited = 'true';
                });
                distributeIntoInputs(activeCustomInputs, desiredTotal);
            }
        }

        captureCurrentYearFeeSelections();
        renderGroupedStudentsPanel();
        checkReceiptMandatory();
    });
}
document.getElementById('fee-year-prev-btn')?.addEventListener('click', () => {
    if (!selectedStudentId) return;
    captureCurrentYearFeeSelections();
    const index = availableFeeAcademicYears.indexOf(selectedFeeAcademicYear);
    if (index < 0 || index >= availableFeeAcademicYears.length - 1) return;
    selectedFeeAcademicYear = availableFeeAcademicYears[index + 1];
    populateFeeItemSelection();
});
document.getElementById('fee-year-next-btn')?.addEventListener('click', () => {
    if (!selectedStudentId) return;
    captureCurrentYearFeeSelections();
    const index = availableFeeAcademicYears.indexOf(selectedFeeAcademicYear);
    if (index <= 0) return;
    selectedFeeAcademicYear = availableFeeAcademicYears[index - 1];
    populateFeeItemSelection();
});
document.getElementById('fee-past-dues-banner')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.past-due-year-pill');
    if (!pill) return;
    const targetYear = pill.dataset.year;
    if (!targetYear || targetYear === selectedFeeAcademicYear) return;
    if (!availableFeeAcademicYears.includes(targetYear)) return;

    captureCurrentYearFeeSelections();
    selectedFeeAcademicYear = targetYear;
    populateFeeItemSelection();
});
const setupFeeEntryUI = () => {
    document.getElementById('fee-entry-title').textContent = "Fee Entry";
    document.getElementById('save-fee-btn').classList.remove('hidden'); document.getElementById('cancel-edit-btn').classList.add('hidden'); document.getElementById('update-fee-btn').classList.add('hidden');

    document.getElementById('entry-receipt').value = getNextReceiptNoForStaff();
    document.getElementById('entry-description').value = '';
    document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
    const entryPayModeEl = document.getElementById('entry-payment-mode');
    if (entryPayModeEl) entryPayModeEl.value = 'Cash';
    populateFeeItemSelection();
    multiEntryQueue = [];
    renderMultiEntryQueue();
};

const exitEditMode = () => { isEditMode = false; editingPaymentGroup = {}; editTouchedItemKeys = new Set(); resetStudentSelection(); setupFeeEntryUI(); };
document.getElementById('cancel-edit-btn')?.addEventListener('click', exitEditMode);

const startEditingPayment = (studentId, txnId) => {
    const parsedKey = parsePaymentGroupKey(txnId);
    const grp = allPayments.filter((payment) => {
        if (parsedKey.type === 'transaction') return payment.transactionId === parsedKey.transactionId;
        if (parsedKey.type === 'receipt') return Number(payment.receiptNo) === parsedKey.receiptNo && (payment.collectedBy || '') === parsedKey.collectedBy;
        return getPaymentGroupKey(payment) === txnId;
    });
    if (grp.length === 0) {
        showToast('Payment record not found for editing.', 'warn');
        return;
    }
    if (!canModifyPaymentRecord(grp)) {
        showToast('You can only edit payments that you collected.', 'warn');
        return;
    }

    const effectiveStudentId = studentId || grp[0].studentId;
    const student = getStudentById(effectiveStudentId) || {
        id: effectiveStudentId,
        name: grp[0].studentName || 'Student',
        adm: grp[0].studentAdm || '-',
        class: grp[0].classLabel || grp[0].studentClass || '',
        gender: 'all'
    };
    activateTab('home-page', 'entry');
    document.getElementById('entry-class').value = student.class || ''; document.getElementById('entry-gender').value = student.gender || 'all';
    syncSmartSelectDisplay(document.getElementById('entry-class'));
    selectedStudentId = student.id; document.getElementById('entry-student-input').value = `${student.name} (Adm: ${student.adm||'-'})`; document.getElementById('student-suggestions').classList.add('hidden');

    isEditMode = true;
    editTouchedItemKeys = new Set();
    document.getElementById('fee-entry-title').textContent = "Edit Payment";
    document.getElementById('save-fee-btn').classList.add('hidden'); document.getElementById('cancel-edit-btn').classList.remove('hidden'); document.getElementById('update-fee-btn').classList.remove('hidden');

    populateFeeItemSelection();

    pendingFeeSelectionsByYear = {};
    grp.forEach((payment) => {
        const paymentYear = payment.academicYear || selectedFeeAcademicYear || '';
        if (!pendingFeeSelectionsByYear[paymentYear]) pendingFeeSelectionsByYear[paymentYear] = {};
        const feeItem = feeItems.find((item) => item.key === payment.itemKey);
        const itemType = feeItem?.type || getPaymentItemType(payment) || 'custom';
        const isMirrorZero = Boolean(payment.isGroupMirror) || (Number(payment.amount || 0) === 0 && Number(payment.groupMonthAmount || 0) > 0);
        const trueItemAmt = itemType === 'month' ? getMonthlyReportPaymentAmount(payment) : Number(payment.amount || 0);
        const existingSel = pendingFeeSelectionsByYear[paymentYear][payment.itemKey];
        if (!existingSel || (!isMirrorZero && trueItemAmt > 0) || existingSel.amount === 0) {
            pendingFeeSelectionsByYear[paymentYear][payment.itemKey] = {
                checked: true,
                type: itemType,
                amount: trueItemAmt,
                manualEdited: true
            };
        }
    });

    const firstPaymentYear = grp[0].academicYear || '';
    if (firstPaymentYear && firstPaymentYear !== selectedFeeAcademicYear) {
        selectedFeeAcademicYear = firstPaymentYear;
        populateFeeItemSelection();
    }

    editingPaymentGroup = {
        txnId,
        itemKeys: new Set(grp.map((p) => `${p.itemKey}__${p.academicYear || ''}`)),
        originalPayments: grp,
        originalCollectedBy: grp[0].collectedBy || '',
        originalCollectedByName: grp[0].collectedByName || '',
        originalCollectedByEmail: grp[0].collectedByEmail || '',
        originalCollectedByUid: grp[0].collectedByUid || '',
        originalTimestamp: grp[0].timestamp || null
    };

    document.getElementById('entry-receipt').value = grp[0].receiptNo || ''; document.getElementById('entry-date').value = grp[0].paymentDate;
    document.getElementById('entry-description').value = grp[0].description || '';
    document.getElementById('total-amount').value = sumReportPaymentsOnce(grp);
    const modeEl = document.getElementById('entry-payment-mode');
    if (modeEl) modeEl.value = grp[0].paymentMode || 'Cash';

    const groupedByStudent = grp.reduce((acc, payment) => {
        if (!acc[payment.studentId]) acc[payment.studentId] = [];
        acc[payment.studentId].push(payment);
        return acc;
    }, {});
    const groupStudentIds = Object.keys(groupedByStudent);
    if (groupStudentIds.length > 1) {
        selectedGroupMemberIds = new Set(groupStudentIds);
        const toggle = document.getElementById('multi-entry-toggle');
        if (toggle) toggle.checked = false;
        multiEntryQueue = [];
        renderMultiEntryQueue();
        syncGroupedStudentsForSelectedStudent();
    } else if (groupStudentIds.length === 1) {
        selectedGroupMemberIds = new Set(groupStudentIds);
        syncGroupedStudentsForSelectedStudent();
    }

    const activeGroup = getStudentBillingGroup(studentId);
    const isGroupedStudent = Boolean(activeGroup && getGroupMemberStudents(activeGroup).length > 1);

    document.querySelectorAll('.fee-item-checkbox').forEach(cb => {
        const isPaidHere = editingPaymentGroup.itemKeys.has(`${cb.dataset.itemKey}__${selectedFeeAcademicYear || ''}`);
        const itemObj = feeItems.find(i => i.key === cb.dataset.itemKey) || { key: cb.dataset.itemKey, type: cb.dataset.itemType || 'month', name: cb.dataset.itemKey };
        const groupState = isGroupedStudent
            ? getFeeItemGroupState(itemObj, selectedFeeAcademicYear, selectedGroupMemberIds, { excludeTxnId: txnId })
            : null;
        const isPaidElsewhere = isGroupedStudent
            ? (!isPaidHere && groupState.isLocked)
            : allPayments.some((payment) => {
                if (payment.studentId !== studentId || payment.itemKey !== cb.dataset.itemKey) return false;
                if ((payment.academicYear || '') !== (selectedFeeAcademicYear || '')) return false;
                return getPaymentGroupKey(payment) !== txnId;
            });

        cb.checked = isPaidHere;
        cb.disabled = isPaidElsewhere;

        const labelEl = cb.nextElementSibling;
        labelEl.classList.remove('fee-item-paid-elsewhere', 'fee-item-partial-locked', 'fee-item-editing-yellow', 'fee-item-new-green');

        if (isPaidHere) {
            labelEl.classList.add('fee-item-editing-yellow');
            const sameItemPays = grp.filter((p) => p.itemKey === cb.dataset.itemKey && (p.academicYear || '') === (selectedFeeAcademicYear || ''));
            const matchedPayment = sameItemPays.find((p) => !p.isGroupMirror && Number(p.amount || 0) > 0) || sameItemPays[0];
            const card = cb.closest('.fee-month-item-card') || cb.closest('.relative');
            if (cb.dataset.itemType === 'custom') {
                const input = card?.querySelector('.custom-fee-amount-input');
                if (input) {
                    const customSum = roundMoney(sameItemPays.reduce((s, p) => s + Number(p.amount || 0), 0));
                    input.value = sameItemPays.length > 1 ? customSum : (matchedPayment?.amount ?? '');
                    input.dataset.manualEdited = 'true';
                    input.readOnly = false;
                    input.classList.remove('hidden', 'bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
                }
            } else {
                const monthWrap = card?.querySelector('.month-amount-wrapper');
                const monthInput = card?.querySelector('.month-fee-amount-input');
                if (monthWrap) monthWrap.classList.remove('hidden');
                if (monthInput) {
                    monthInput.value = matchedPayment ? getMonthlyReportPaymentAmount(matchedPayment) : '';
                    monthInput.dataset.manualEdited = 'true';
                }
            }
        } else if (isPaidElsewhere) {
            if (isGroupedStudent && groupState?.isLockedByCheckedPaid) {
                labelEl.classList.add('fee-item-partial-locked');
                cb.checked = false;
            } else {
                labelEl.classList.add('fee-item-paid-elsewhere');
                cb.checked = true; // Visual check for disabled item
            }
        }
    });
    checkReceiptMandatory();
};

const processPaymentSubmit = async (isUpdate) => {
    if (isPaymentMutationInFlight) return;
    if(!selectedStudentId && !multiEntryQueue.length) return alert("Please select a student.");
    captureCurrentYearFeeSelections();
    const selected = buildSelectedItemsForCurrentStudent();
    const selectedGroup = selectedStudentId ? getStudentBillingGroup(selectedStudentId) : null;

    // Determine target members for group if applicable
    const targetGroupMemberIds = selectedGroup && Array.isArray(selectedGroup.memberIds) && selectedGroup.memberIds.length > 1
        ? (selectedGroupMemberIds && selectedGroupMemberIds.size > 0 ? [...selectedGroupMemberIds] : selectedGroup.memberIds)
        : (selectedStudentId ? [selectedStudentId] : []);

    const isSingleMemberOnly = targetGroupMemberIds.length === 1;
    const isAllGroupMembers = selectedGroup && targetGroupMemberIds.length === selectedGroup.memberIds.length;
    const effectiveBillingGroupId = isAllGroupMembers ? selectedGroup.id : null;

    // Guard against double-paying an item already paid by any checked group member
    if (selectedGroup && Array.isArray(selectedGroup.memberIds) && selectedGroup.memberIds.length > 1 && !isMultiEntryMode()) {
        const excludeTxnId = isUpdate ? editingPaymentGroup?.txnId || '' : '';
        const targetSet = new Set(targetGroupMemberIds);
        for (const selItem of selected) {
            const feeObj = feeItems.find(i => i.key === selItem.itemKey) || { key: selItem.itemKey, type: selItem.itemType || 'month', name: selItem.itemKey };
            const state = getFeeItemGroupState(feeObj, selItem.year || selectedFeeAcademicYear, targetSet, { excludeTxnId });
            if (state.isLocked && !(isUpdate && editingPaymentGroup?.itemKeys?.has(`${selItem.itemKey}__${selItem.year || selectedFeeAcademicYear || ''}`))) {
                const paidNames = state.checkedPaidMembers.map(e => e.member.name).filter(Boolean).join(', ');
                return alert(`"${feeObj.name || selItem.itemKey}" is already paid for ${paidNames || 'selected member(s)'}. Uncheck paid member(s) before saving.`);
            }
        }
    }

    const primaryEntry = selectedStudentId ? {
        studentId: isSingleMemberOnly ? targetGroupMemberIds[0] : selectedStudentId,
        studentName: getStudentById(isSingleMemberOnly ? targetGroupMemberIds[0] : selectedStudentId)?.name || 'Student',
        classLabel: getStudentById(isSingleMemberOnly ? targetGroupMemberIds[0] : selectedStudentId)?.class || '',
        items: selected,
        total: selected.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        billingGroupId: effectiveBillingGroupId,
        targetGroupMemberIds: targetGroupMemberIds
    } : null;

    const allEntries = isMultiEntryMode() ? [...multiEntryQueue, primaryEntry].filter(Boolean) : [primaryEntry].filter(Boolean);
    if(allEntries.length === 0 || allEntries.every((entry) => !entry.items.length)) return alert("Please select at least one fee item.");

    const rcptStr = document.getElementById('entry-receipt').value.trim();
    const rcpt = rcptStr ? parseInt(rcptStr) : null;

    const isReq = checkReceiptMandatory();
    if(isReq && !rcpt) return alert("Receipt number is mandatory for the selected fee.");

    if(rcpt) {
        const isDup = allPayments.some((payment) => {
            if (payment.receiptNo !== rcpt || payment.collectedBy !== getCollectorKey()) return false;
            if (!isUpdate) return true;
            return getPaymentGroupKey(payment) !== editingPaymentGroup.txnId;
        });
        if(isDup) return alert(`Receipt number ${rcpt} is already used. Please provide a different number.`);
    }

    const dt = document.getElementById('entry-date').value;
    const desc = document.getElementById('entry-description').value.trim();
    const paymentMode = document.getElementById('entry-payment-mode')?.value || 'Cash';
    const visibleTotal = parseFloat(document.getElementById('total-amount').value || 0);
    const computedEntriesTotal = roundMoney(allEntries.reduce((sum, e) => sum + Number(e.total || 0), 0));
    const tot = isMultiEntryMode() ? computedEntriesTotal : (Number.isFinite(visibleTotal) && visibleTotal >= 0 ? roundMoney(visibleTotal) : computedEntriesTotal);
    if(!dt || isNaN(tot) || tot < 0) return alert("Please check the date and amount.");

    const confirmBtn = document.getElementById('confirm-ok');
    document.getElementById('confirm-title').textContent = isUpdate ? 'Update Payment' : 'Confirm Payment';
    const confirmMessage = document.getElementById('confirm-message');
    const titleLine = document.createElement('p');
    titleLine.className = 'font-medium text-gray-800';

    if (isUpdate) {
        titleLine.textContent = 'Save changes to this payment?';
    } else if (isMultiEntryMode()) {
        titleLine.textContent = `Save fee payment for ${allEntries.length} students under receipt #${rcpt || 'Auto'}?`;
    } else if (isSingleMemberOnly) {
        const singleSt = getStudentById(targetGroupMemberIds[0]);
        titleLine.textContent = `Save individual fee payment for ${singleSt?.name || 'Student'}?`;
    } else if (targetGroupMemberIds.length > 1) {
        titleLine.textContent = `Save grouped fee payment for ${targetGroupMemberIds.length} students?`;
    } else {
        titleLine.textContent = `Save fee payment for ${getStudentById(selectedStudentId)?.name || 'Student'}?`;
    }

    const amountLine = document.createElement('p');
    amountLine.className = 'mt-2 text-sm text-gray-700 font-mono flex items-center justify-between border-t border-b py-1.5 border-slate-100';
    amountLine.innerHTML = `<span>Total Amount: <b>₹${tot}</b></span><span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-xs border border-blue-200">Mode: ${escapeHtml(paymentMode)}</span>`;
    const detailsWrap = document.createElement('div');
    detailsWrap.className = 'mt-2 text-xs text-slate-600 space-y-1 max-h-40 overflow-y-auto';

    if (targetGroupMemberIds.length > 1 && !isMultiEntryMode()) {
        targetGroupMemberIds.forEach(id => {
            const stObj = getStudentById(id);
            if (stObj) {
                const row = document.createElement('div');
                row.className = 'flex justify-between gap-3 bg-slate-50 rounded px-2 py-1';
                row.innerHTML = `<span>${escapeHtml(stObj.name)} (${escapeHtml(stObj.class || '--')})</span><span class="text-emerald-700 font-semibold">Included</span>`;
                detailsWrap.appendChild(row);
            }
        });
    } else {
        const finalEntries = allEntries.filter((entry) => (entry.items || []).length);
        finalEntries.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'flex justify-between gap-3 bg-slate-50 rounded px-2 py-1';
            row.innerHTML = `<span>${escapeHtml(entry.studentName)} (${escapeHtml(entry.classLabel || '--')})</span><b>₹${Number(entry.total || 0).toFixed(0)}</b>`;
            detailsWrap.appendChild(row);
        });
    }

    confirmMessage.replaceChildren(titleLine, amountLine, detailsWrap);
    document.getElementById('confirm-popup').classList.remove('hidden');
    document.getElementById('confirm-popup').classList.add('flex');

    confirmBtn.onclick = async () => {
        if (isPaymentMutationInFlight) return;
        isPaymentMutationInFlight = true;
        confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Processing...`;
        confirmBtn.disabled = true;
        const saveBtn = document.getElementById('save-fee-btn');
        const updateBtn = document.getElementById('update-fee-btn');
        if (saveBtn) saveBtn.disabled = true;
        if (updateBtn) updateBtn.disabled = true;
        try {
            if (isUpdate && Array.isArray(editingPaymentGroup?.originalPayments) && !canModifyPaymentRecord(editingPaymentGroup.originalPayments)) {
                throw new Error('You can only edit payments that you collected.');
            }
            const batch = writeBatch(db);
            const tId = isUpdate ? editingPaymentGroup.txnId : (Date.now().toString() + Math.random().toString(36).substr(2, 5));

            let fetchedOriginalData = null;
            if (isUpdate) {
                const docsToDelete = await collectPaymentDocsForGroup(editingPaymentGroup.txnId, '');
                if (docsToDelete.length > 0) {
                    fetchedOriginalData = docsToDelete[0].data();
                    if (!canModifyPaymentRecord(docsToDelete.map(d => d.data()))) {
                        throw new Error('You can only edit payments that you collected.');
                    }
                    await queueExistingPaymentDeletes(batch, docsToDelete, []);
                } else {
                    const fallbackDocs = allPayments.filter((p) => getPaymentGroupKey(p) === editingPaymentGroup.txnId || p.transactionId === editingPaymentGroup.txnId);
                    await queueExistingPaymentDeletes(batch, [], fallbackDocs);
                }
            }

            const currentStaffName = getCurrentCollectorName();
            const currentKey = getCollectorKey();
            const currentEmail = normalizeEmail(getEffectiveStaffEmail() || auth?.currentUser?.email || '');
            const currentUid = String(auth?.currentUser?.uid || '').trim();
            const isCurrentOwnerOnUpdate = isUpdate && !isMasterSuperAdmin();
            const resolvedCollectedBy = isUpdate
                ? (editingPaymentGroup?.originalCollectedBy || fetchedOriginalData?.collectedBy || currentKey)
                : currentKey;
            const resolvedCollectedByName = isUpdate
                ? (editingPaymentGroup?.originalCollectedByName || fetchedOriginalData?.collectedByName || currentStaffName)
                : currentStaffName;
            const resolvedCollectedByEmail = isUpdate
                ? (editingPaymentGroup?.originalCollectedByEmail || fetchedOriginalData?.collectedByEmail || (resolvedCollectedBy.includes('@') ? resolvedCollectedBy : currentEmail) || (isCurrentOwnerOnUpdate ? currentEmail : ''))
                : currentEmail;
            const resolvedCollectedByUid = isUpdate
                ? (editingPaymentGroup?.originalCollectedByUid || fetchedOriginalData?.collectedByUid || (isCurrentOwnerOnUpdate ? currentUid : ''))
                : currentUid;
            const writtenGroupedMonthlyItems = new Set();

            allEntries.forEach((entry) => {
                const entrySelected = entry.items || [];
                if (!entrySelected.length) return;
                const customCbs = entrySelected.filter((item) => item.itemType === 'custom');
                const monthlyCbs = entrySelected.filter((item) => (item.itemType || 'month') === 'month');
                const entryStuObj = getStudentById(entry.studentId);
                const studentClass = getStudentClassForFeeYear(entryStuObj, selectedFeeAcademicYear) || entryStuObj?.class || '';
                const common = {
                    receiptNo: rcpt,
                    transactionId: tId,
                    paymentDate: dt,
                    paymentMode: paymentMode,
                    timestamp: Date.now(),
                    description: desc,
                    collectedBy: resolvedCollectedBy,
                    collectedByName: resolvedCollectedByName,
                    ...(resolvedCollectedByEmail ? { collectedByEmail: resolvedCollectedByEmail } : {}),
                    ...(resolvedCollectedByUid ? { collectedByUid: resolvedCollectedByUid } : {}),
                    ...(isUpdate ? { updatedBy: currentKey, updatedByName: currentStaffName, updatedAt: new Date().toISOString() } : {}),
                    academicYear: selectedFeeAcademicYear || '',
                    classLabel: studentClass
                };

                const targets = entry.targetGroupMemberIds && entry.targetGroupMemberIds.length > 0
                    ? entry.targetGroupMemberIds
                    : [entry.studentId];

                // Write custom fee items (individually per checked group member)
                customCbs.forEach((item) => {
                    const itemYear = item.year || common.academicYear;
                    const enteredCustomTotal = roundMoney(Math.max(0, Number(item.amount || 0)));
                    if (targets.length === 1) {
                        const singleId = targets[0];
                        const singleStuObj = getStudentById(singleId);
                        const singleClass = getStudentClassForFeeYear(singleStuObj, itemYear) || singleStuObj?.class || studentClass;
                        queuePaymentWrite(batch, {
                            ...common,
                            academicYear: itemYear,
                            studentId: singleId,
                            classLabel: singleClass,
                            itemKey: item.itemKey,
                            amount: enteredCustomTotal,
                            billingGroupId: null
                        });
                    } else {
                        const feeObj = feeItems.find(i => i.key === item.itemKey);
                        const customCfg = feeObj ? getSelectedMembersCustomFeeConfig(feeObj, new Set(targets), itemYear) : { amountLocked: false, perMemberAmounts: {} };
                        const configuredSum = Object.values(customCfg.perMemberAmounts || {}).reduce((s, v) => s + Number(v || 0), 0);
                        const evenShare = roundMoney(enteredCustomTotal / targets.length);
                        let runningAssigned = 0;

                        targets.forEach((memberId, idx) => {
                            const memberStuObj = getStudentById(memberId);
                            const memberClass = getStudentClassForFeeYear(memberStuObj, itemYear) || memberStuObj?.class || studentClass;
                            const isLast = idx === targets.length - 1;
                            let memberAmt = 0;
                            if (isLast) {
                                memberAmt = roundMoney(Math.max(0, enteredCustomTotal - runningAssigned));
                            } else if (configuredSum > 0) {
                                const weight = Number(customCfg.perMemberAmounts[memberId] || 0) / configuredSum;
                                memberAmt = roundMoney(enteredCustomTotal * weight);
                                runningAssigned = roundMoney(runningAssigned + memberAmt);
                            } else {
                                memberAmt = evenShare;
                                runningAssigned = roundMoney(runningAssigned + memberAmt);
                            }
                            queuePaymentWrite(batch, {
                                ...common,
                                academicYear: itemYear,
                                studentId: memberId,
                                classLabel: memberClass,
                                itemKey: item.itemKey,
                                amount: Math.max(0, memberAmt),
                                billingGroupId: null
                            });
                        });
                    }
                });

                // Write monthly fee items
                if (monthlyCbs.length > 0) {

                    monthlyCbs.forEach((item) => {
                        const itemYear = item.year || common.academicYear;
                        const itemMonthAmount = roundMoney(Math.max(0, Number(item.amount || 0)));

                        if (targets.length === 1) {
                            // Single student payment ONLY - unchecked siblings remain unpaid without arrears!
                            const singleId = targets[0];
                            const singleStuObj = getStudentById(singleId);
                            const singleClass = getStudentClassForFeeYear(singleStuObj, itemYear) || singleStuObj?.class || studentClass;
                            queuePaymentWrite(batch, {
                                ...common,
                                academicYear: itemYear,
                                studentId: singleId,
                                classLabel: singleClass,
                                itemKey: item.itemKey,
                                amount: itemMonthAmount,
                                groupMonthAmount: itemMonthAmount,
                                groupPaidAmount: itemMonthAmount,
                                billingGroupId: null
                            });
                        } else {
                            // Multiple / all group members payment (Single Family Billing Entity Model)
                            const billingGroupId = entry.billingGroupId || null;
                            const groupedItemKey = billingGroupId ? `${billingGroupId}__${item.itemKey}__${itemYear}` : '';
                            if (groupedItemKey && writtenGroupedMonthlyItems.has(groupedItemKey)) return;
                            if (groupedItemKey) writtenGroupedMonthlyItems.add(groupedItemKey);

                            // Primary student receives full unified group fee (e.g. ₹500 or custom ₹450).
                            // Sibling members receive non-additive records (amount: 0) with groupMonthAmount
                            // to prevent revenue multiplication while ensuring all siblings register as settled.
                            targets.forEach((id, idx) => {
                                const isPrimary = idx === 0;
                                const studentAmt = isPrimary ? itemMonthAmount : 0;
                                const memberStuObj = getStudentById(id);
                                const memberClass = getStudentClassForFeeYear(memberStuObj, itemYear) || memberStuObj?.class || studentClass;
                                queuePaymentWrite(batch, {
                                    ...common,
                                    academicYear: itemYear,
                                    studentId: id,
                                    classLabel: memberClass,
                                    itemKey: item.itemKey,
                                    amount: studentAmt,
                                    groupMonthAmount: itemMonthAmount,
                                    groupPaidAmount: itemMonthAmount,
                                    billingGroupId,
                                    isGroupPrimary: isPrimary,
                                    isGroupMirror: !isPrimary,
                                    targetGroupMemberIds: targets
                                });
                            });
                        }
                    });
                }
            });

            await batch.commit();
            if(!isUpdate) document.getElementById('entry-receipt').value = rcpt ? rcpt + 1 : '';
            exitEditMode();
            showToast('Payment saved successfully!', 'success');
        } catch (e) {
            logFirestorePermissionError(e, isUpdate ? 'update' : 'create', `${BASE_PATH}/payments`);
            console.error(e);
            showToast(`Failed to save payment: ${e?.message || 'Permission or network error'}`, 'error');
        } finally {
            isPaymentMutationInFlight = false;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'OK';
            if (saveBtn) saveBtn.disabled = false;
            if (updateBtn) updateBtn.disabled = false;
            document.getElementById('confirm-popup')?.classList.add('hidden');
            document.getElementById('confirm-popup')?.classList.remove('flex');
        }
    };
};

document.getElementById('save-fee-btn')?.addEventListener('click', () => processPaymentSubmit(false));
document.getElementById('update-fee-btn')?.addEventListener('click', () => processPaymentSubmit(true));


// --- SMART BULK UPLOAD & IN-APP BLANK SHEET LOGIC ---
let collectionBulkState = {
    columns: [],
    workingRows: [],
    parsedRows: [],
    activeFeeItems: [],
    rosterEntries: [],
    paymentPlan: [],
    groupSummaryMap: new Map(),
    groupItemModes: new Map(),
    totalCollectionAmount: 0,
    year: '',
    targetClass: '',
    isEditMode: false,
    fileName: '',
    sheetSource: 'upload', // 'blank' | 'upload'
    duplicateReceiptMap: new Map(),
    groupSharedReceiptSet: new Set(),
    existingDbReceiptSet: new Set()
};

const notifyBulkMessage = (message = '', type = 'error') => {
    if (typeof showToast === 'function') {
        showToast(message, type);
    } else {
        appLog(type === 'error' ? 'error' : 'info', 'collection.bulk', message);
    }
};

const formatBulkCurrency = (amt = 0) => {
    const num = Number(amt || 0);
    if (!Number.isFinite(num)) return '₹0';
    return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const setCollectionBulkEditMode = (enabled, { skipRender = false } = {}) => {
    collectionBulkState.isEditMode = Boolean(enabled);
    const switchEl = document.getElementById('collection-bulk-edit-switch');
    if (switchEl && switchEl.checked !== collectionBulkState.isEditMode) {
        switchEl.checked = collectionBulkState.isEditMode;
    }
    const statusLabel = document.getElementById('collection-bulk-edit-status');
    const banner = document.getElementById('collection-bulk-edit-banner');
    if (statusLabel) {
        if (collectionBulkState.isEditMode) {
            statusLabel.textContent = 'ON';
            statusLabel.className = 'text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 font-mono';
            banner?.classList.remove('hidden');
        } else {
            statusLabel.textContent = 'OFF';
            statusLabel.className = 'text-[11px] font-extrabold uppercase tracking-wider text-slate-500 font-mono';
            banner?.classList.add('hidden');
        }
    }
    if (!skipRender) {
        renderCollectionBulkPreviewTable();
    }
};

const setupBulkUploadUI = () => {
    const yearSelect = document.getElementById('bulk-academic-year');
    if (yearSelect) {
        populateAcademicYearSelect(yearSelect, academicYearSettings, currentWorkingAcademicYear, {
            placeholder: '-- Select Academic Year --',
            selectedValue: currentWorkingAcademicYear
        });
    }
    document.getElementById('bulk-progress-container')?.classList.add('hidden');
    document.getElementById('bulk-preview-area')?.classList.add('hidden');
    document.getElementById('bulk-drop-zone')?.classList.remove('hidden');
    const fileInputEl = document.getElementById('bulk-file-input');
    if (fileInputEl) fileInputEl.value = '';
    const tableContainer = document.getElementById('collection-bulk-table-container');
    if (tableContainer) tableContainer.innerHTML = '';

    collectionBulkState = {
        columns: [],
        workingRows: [],
        parsedRows: [],
        activeFeeItems: [],
        rosterEntries: [],
        paymentPlan: [],
        groupSummaryMap: new Map(),
        groupItemModes: new Map(),
        totalCollectionAmount: 0,
        year: '',
        targetClass: '',
        isEditMode: false,
        fileName: '',
        sheetSource: 'upload',
        duplicateReceiptMap: new Map(),
        groupSharedReceiptSet: new Set(),
        existingDbReceiptSet: new Set()
    };
    const switchEl = document.getElementById('collection-bulk-edit-switch');
    if (switchEl) switchEl.checked = false;
    const statusLabel = document.getElementById('collection-bulk-edit-status');
    if (statusLabel) {
        statusLabel.textContent = 'OFF';
        statusLabel.className = 'text-[11px] font-extrabold uppercase tracking-wider text-slate-500 font-mono';
    }
    const amtEl = document.getElementById('collection-stat-ready-amount');
    if (amtEl) amtEl.textContent = '₹0';
    document.getElementById('collection-bulk-edit-banner')?.classList.add('hidden');
    window.bulkUploadParsedData = null;
};

// Collapsible Quick Guide in Step 1
(() => {
    const toggleBtn = document.getElementById('bulk-rules-guide-toggle');
    const body = document.getElementById('bulk-rules-guide-body');
    const chevron = document.getElementById('bulk-rules-guide-chevron');
    if (!toggleBtn || !body) return;
    toggleBtn.addEventListener('click', () => {
        const isHidden = body.classList.toggle('hidden');
        if (chevron) {
            chevron.classList.toggle('rotate-180', isHidden);
        }
    });
})();

const resolveBulkSelectionContext = ({ requireRoster = true } = {}) => {
    const year = document.getElementById('bulk-academic-year')?.value || '';
    const targetClass = document.getElementById('bulk-class')?.value || '';

    if (!year || !targetClass) {
        notifyBulkMessage('Please select both Academic Year and Target Class.', 'error');
        return null;
    }

    if (!isMasterSuperAdmin() && (!selectedDutyClasses.length || !isClassInDutyScope(targetClass, selectedDutyClasses))) {
        notifyBulkMessage('You do not have permission to access bulk sheets for this class.', 'error');
        return null;
    }

    const rosterEntries = buildBulkRosterWithGroups({
        allStudents: allStudentsRaw,
        studentGroups,
        targetClass,
        year,
        fallbackYear: currentWorkingAcademicYear
    });

    if (requireRoster && rosterEntries.length === 0) {
        notifyBulkMessage(`No active students found in Class ${targetClass} for ${year}.`, 'error');
        return null;
    }

    const rosterClasses = [...new Set([
        targetClass,
        ...rosterEntries.map((entry) => entry.studentClass).filter(Boolean)
    ])];

    const activeFeeItems = resolveActiveBulkFeeItems({
        feeItems,
        year,
        defaultMonthlyFeeEnabled,
        rosterClasses,
        sortMonthlyFn: sortMonthlyItemsByAcademicYear
    });

    if (activeFeeItems.length === 0) {
        notifyBulkMessage(`No active fee items (Monthly or Custom) found for ${year}. Check Fee Settings & Setup.`, 'error');
        return null;
    }

    return { year, targetClass, rosterEntries, rosterClasses, activeFeeItems };
};

const downloadCollectionBulkTemplate = (format = 'xlsx') => {
    const ctx = resolveBulkSelectionContext({ requireRoster: true });
    if (!ctx) return;

    const { year, targetClass, rosterEntries, activeFeeItems } = ctx;
    const { headers, rowsAsArrays } = buildBulkSheetMatrixData({
        rosterEntries,
        activeFeeItems,
        year,
        targetClass,
        defaultFee,
        allPayments,
        includeModelRow: true
    });

    const safeClassName = targetClass.replace(/[^a-zA-Z0-9]/g, '_');
    const filenameBase = `Bulk_Fee_Template_${safeClassName}_${year}`;

    try {
        const savedName = downloadSpreadsheetRows({
            headers,
            rows: rowsAsArrays,
            filenameBase,
            format,
            sheetName: 'Fee_Template',
            xlsxLib: typeof XLSX !== 'undefined' ? XLSX : null
        });
        notifyBulkMessage(`Downloaded auto-priced template: ${savedName}`, 'success');
    } catch (e) {
        console.error('Template generation failed:', e);
        notifyBulkMessage(e?.message || 'Failed to generate template. Please try again.', 'error');
    }
};

const openCollectionBlankSheet = () => {
    const ctx = resolveBulkSelectionContext({ requireRoster: true });
    if (!ctx) return;

    const { year, targetClass, rosterEntries, activeFeeItems } = ctx;
    const { columns, workingRows } = buildBulkSheetMatrixData({
        rosterEntries,
        activeFeeItems,
        year,
        targetClass,
        defaultFee,
        allPayments,
        includeModelRow: false
    });

    const displayLabel = `Blank Sheet — Class ${targetClass} (${year})`;
    collectionBulkState = {
        columns,
        workingRows,
        parsedRows: [],
        activeFeeItems,
        rosterEntries,
        paymentPlan: [],
        groupSummaryMap: new Map(),
        groupItemModes: new Map(),
        totalCollectionAmount: 0,
        year,
        targetClass,
        isEditMode: true,
        fileName: displayLabel,
        sheetSource: 'blank',
        duplicateReceiptMap: new Map(),
        groupSharedReceiptSet: new Set(),
        existingDbReceiptSet: new Set()
    };
    window.bulkUploadParsedData = collectionBulkState;

    const fileIconEl = document.getElementById('collection-bulk-file-icon');
    if (fileIconEl) {
        fileIconEl.className = 'fas fa-pen-to-square text-indigo-600 text-lg';
    }
    const fileNameEl = document.getElementById('bulk-file-name');
    if (fileNameEl) fileNameEl.textContent = displayLabel;

    document.getElementById('bulk-drop-zone')?.classList.add('hidden');
    document.getElementById('bulk-preview-area')?.classList.remove('hidden');
    document.getElementById('bulk-progress-container')?.classList.add('hidden');

    setCollectionBulkEditMode(true, { skipRender: true });
    rebuildCollectionBulkStateAndRender();

    const previewArea = document.getElementById('bulk-preview-area');
    previewArea?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    notifyBulkMessage(`Blank sheet opened for Class ${targetClass} (${rosterEntries.length} students, ${activeFeeItems.length} fee items).`, 'success');
};

const exportCurrentBulkSheetToExcel = () => {
    const { columns = [], workingRows = [], parsedRows = [], targetClass = '', year = '' } = collectionBulkState;
    if (!columns.length || !workingRows.length) {
        notifyBulkMessage('No active sheet data available to export.', 'error');
        return;
    }

    const headers = columns.map((c) => c.header);
    const exportRows = [];
    workingRows.forEach((rowObj, idx) => {
        if (parsedRows[idx]?.isSampleRow) return;
        exportRows.push(columns.map((col) => (rowObj?.[col.id] ?? '')));
    });

    const safeClassName = String(targetClass || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
    const filenameBase = `Fee_Sheet_${safeClassName}_${year || 'Export'}`;

    try {
        const savedName = downloadSpreadsheetRows({
            headers,
            rows: exportRows,
            filenameBase,
            format: 'xlsx',
            sheetName: 'Fee_Sheet',
            xlsxLib: typeof XLSX !== 'undefined' ? XLSX : null
        });
        notifyBulkMessage(`Exported sheet: ${savedName}`, 'success');
    } catch (e) {
        console.error('Sheet export failed:', e);
        notifyBulkMessage(e?.message || 'Failed to export Excel file.', 'error');
    }
};

document.getElementById('bulk-open-blank-sheet-btn')?.addEventListener('click', openCollectionBlankSheet);
document.getElementById('collection-bulk-export-xlsx-btn')?.addEventListener('click', exportCurrentBulkSheetToExcel);

(() => {
    const dropdown = document.getElementById('collection-bulk-template-dropdown');
    const menuBtn = document.getElementById('collection-bulk-template-menu-btn');
    const menu = document.getElementById('collection-bulk-template-menu');
    const chevron = document.getElementById('collection-bulk-template-chevron');
    if (!dropdown || !menuBtn || !menu) return;

    const setMenuOpen = (isOpen) => {
        menu.classList.toggle('hidden', !isOpen);
        menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        chevron?.classList.toggle('rotate-180', isOpen);
    };

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMenuOpen(menu.classList.contains('hidden'));
    });

    menu.querySelectorAll('.collection-bulk-template-option').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fmt = btn.getAttribute('data-template-format') || 'xlsx';
            setMenuOpen(false);
            downloadCollectionBulkTemplate(fmt);
        });
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) setMenuOpen(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setMenuOpen(false);
    });
})();

const buildCollectionBulkMappingOptions = (activeFeeItems = []) => {
    const options = [
        { key: 'adm', label: 'Admission No (Locked)' },
        { key: 'name', label: 'Student Name (Locked)' },
        { key: 'className', label: 'Class (Locked)' },
        { key: 'groupInfo', label: 'Group Info (Locked)' },
        { key: 'studentId', label: 'Student ID (Optional)' }
    ];
    activeFeeItems.forEach((item) => {
        const labelBase = normalizeFeeItemName(item.name || item.key);
        const typeSuffix = item.type === 'custom' ? ' [Custom]' : '';
        options.push({ key: `${item.key}::amount`, label: `${labelBase}${typeSuffix} - Amount` });
        options.push({ key: `${item.key}::receiptNo`, label: `${labelBase}${typeSuffix} - Receipt No` });
        options.push({ key: `${item.key}::date`, label: `${labelBase}${typeSuffix} - Date` });
    });
    options.push({ key: 'none', label: '-- Skip / Ignore --' });
    return options;
};

const isFeeEditableMappedField = (mappedField = '') => (
    mappedField.endsWith('::amount') ||
    mappedField.endsWith('::receiptNo') ||
    mappedField.endsWith('::date')
);

const getMappedItemKey = (mappedField = '') => {
    if (!isFeeEditableMappedField(mappedField)) return '';
    return mappedField.split('::')[0] || '';
};

const buildCollectionBulkColumns = (rawHeaders = [], activeFeeItems = []) => {
    const norm = (str = '') => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const usedTargets = new Set();

    const itemMatchers = activeFeeItems.map((item) => {
        const cleanName = normalizeFeeItemName(item.name || item.key || '');
        const safeName = cleanName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        return {
            itemKey: item.key,
            exactAmt: `${safeName}_Amount`,
            exactRcpt: `${safeName}_ReceiptNo`,
            exactDate: `${safeName}_Date`,
            normBase: norm(cleanName),
            normKey: norm(item.key || '')
        };
    });

    return rawHeaders.map((header, idx) => {
        const headerStr = String(header || '').trim() || `Column ${idx + 1}`;
        const nHeader = norm(headerStr);
        let mappedField = 'none';

        if (['studentid', 'stuid', 'docid'].includes(nHeader) && !usedTargets.has('studentId')) {
            mappedField = 'studentId';
        } else if (['admissionno', 'admno', 'adm', 'admissionnumber', 'admn'].includes(nHeader) && !usedTargets.has('adm')) {
            mappedField = 'adm';
        } else if (['studentname', 'name', 'fullname', 'nameofstudent'].includes(nHeader) && !usedTargets.has('name')) {
            mappedField = 'name';
        } else if (['class', 'classname', 'std', 'grade'].includes(nHeader) && !usedTargets.has('className')) {
            mappedField = 'className';
        } else if (['groupinfo', 'familygroup', 'group', 'feetype', 'category'].includes(nHeader) && !usedTargets.has('groupInfo')) {
            mappedField = 'groupInfo';
        } else {
            for (const matcher of itemMatchers) {
                const baseMatchesAmt = headerStr === matcher.exactAmt
                    || nHeader === `${matcher.normBase}amount`
                    || nHeader === `${matcher.normBase}amt`
                    || (matcher.normKey && nHeader === `${matcher.normKey}amount`);
                if (baseMatchesAmt) {
                    const candidate = `${matcher.itemKey}::amount`;
                    if (!usedTargets.has(candidate)) {
                        mappedField = candidate;
                        break;
                    }
                }
                const baseMatchesRcpt = headerStr === matcher.exactRcpt
                    || nHeader === `${matcher.normBase}receiptno`
                    || nHeader === `${matcher.normBase}receipt`
                    || nHeader === `${matcher.normBase}rcpt`
                    || (matcher.normKey && nHeader === `${matcher.normKey}receiptno`);
                if (baseMatchesRcpt) {
                    const candidate = `${matcher.itemKey}::receiptNo`;
                    if (!usedTargets.has(candidate)) {
                        mappedField = candidate;
                        break;
                    }
                }
                const baseMatchesDate = headerStr === matcher.exactDate
                    || nHeader === `${matcher.normBase}date`
                    || (matcher.normKey && nHeader === `${matcher.normKey}date`);
                if (baseMatchesDate) {
                    const candidate = `${matcher.itemKey}::date`;
                    if (!usedTargets.has(candidate)) {
                        mappedField = candidate;
                        break;
                    }
                }
            }
        }

        if (mappedField !== 'none') usedTargets.add(mappedField);

        return {
            id: `c_${idx}`,
            header: headerStr,
            mappedField
        };
    });
};

const getCollectionDuplicateMappedFields = () => {
    const counts = {};
    collectionBulkState.columns.forEach((col) => {
        if (col.mappedField && col.mappedField !== 'none') {
            counts[col.mappedField] = (counts[col.mappedField] || 0) + 1;
        }
    });
    const dupes = new Set();
    Object.entries(counts).forEach(([field, count]) => {
        if (count > 1) dupes.add(field);
    });
    return dupes;
};

// Re-orders uploaded data rows so detected Family Group members sit adjacently
const reorderUploadedRowsByFamilyGroup = (workingRows = [], columns = [], rosterEntries = []) => {
    const colByField = {};
    columns.forEach((c) => {
        if (c.mappedField && c.mappedField !== 'none' && !colByField[c.mappedField]) {
            colByField[c.mappedField] = c.id;
        }
    });

    const studentByAdm = new Map();
    const studentById = new Map();
    const studentByName = new Map();
    const groupIdByStudentId = new Map();

    (Array.isArray(allStudentsRaw) ? allStudentsRaw : []).forEach((s) => {
        if (!s?.id) return;
        studentById.set(s.id, s);
        if (s.adm) studentByAdm.set(String(s.adm).trim().toUpperCase(), s);
        if (s.name) {
            const key = String(s.name).trim().toLowerCase();
            if (!studentByName.has(key)) studentByName.set(key, []);
            studentByName.get(key).push(s);
        }
    });
    (Array.isArray(studentGroups) ? studentGroups : []).forEach((g) => {
        if (!g?.id || !Array.isArray(g.memberIds) || g.memberIds.length < 2) return;
        g.memberIds.forEach((id) => groupIdByStudentId.set(id, g.id));
    });

    const rosterOrder = new Map(rosterEntries.map((r, i) => [r.studentId, i]));

    const detectRowMeta = (rowObj) => {
        const stuId = colByField.studentId ? String(rowObj[colByField.studentId] || '').trim() : '';
        const adm = colByField.adm ? String(rowObj[colByField.adm] || '').trim() : '';
        const name = colByField.name ? String(rowObj[colByField.name] || '').trim() : '';
        const isSample = stuId === 'SAMPLE-ID-DO-NOT-DELETE' || (name.toLowerCase() === 'model student name' && (adm === '1234' || adm === ''));
        if (isSample) return { isSample: true, groupId: '', studentId: '' };

        let matched = stuId ? studentById.get(stuId) : null;
        if (!matched && adm) matched = studentByAdm.get(adm.toUpperCase()) || null;
        if (!matched && !adm && name) {
            const matches = studentByName.get(name.toLowerCase()) || [];
            if (matches.length === 1) matched = matches[0];
        }
        const groupId = matched ? (groupIdByStudentId.get(matched.id) || '') : '';
        return { isSample: false, groupId, studentId: matched?.id || '' };
    };

    const sampleRows = [];
    const groupedBuckets = new Map();
    const orderTokens = [];

    workingRows.forEach((rowObj, idx) => {
        const meta = detectRowMeta(rowObj);
        if (meta.isSample) {
            sampleRows.push(rowObj);
            return;
        }
        if (meta.groupId) {
            if (!groupedBuckets.has(meta.groupId)) {
                groupedBuckets.set(meta.groupId, []);
                orderTokens.push({ type: 'group', groupId: meta.groupId });
            }
            groupedBuckets.get(meta.groupId).push({ rowObj, studentId: meta.studentId, origIdx: idx });
        } else {
            orderTokens.push({ type: 'single', rowObj });
        }
    });

    const reordered = [...sampleRows];
    orderTokens.forEach((tok) => {
        if (tok.type === 'single') {
            reordered.push(tok.rowObj);
        } else {
            const members = groupedBuckets.get(tok.groupId) || [];
            members.sort((a, b) => {
                const oa = rosterOrder.has(a.studentId) ? rosterOrder.get(a.studentId) : 99999 + a.origIdx;
                const ob = rosterOrder.has(b.studentId) ? rosterOrder.get(b.studentId) : 99999 + b.origIdx;
                return oa - ob;
            });
            members.forEach((m) => reordered.push(m.rowObj));
        }
    });
    return reordered;
};

const getCollectionBulkRowBadgeHtml = (r) => {
    if (r.isSampleRow) {
        return `<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-500 text-white shadow-xs" title="Model guide row — automatically skipped">SAMPLE</span>`;
    }
    if (r.hasFatalError) {
        return `<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-600 text-white shadow-xs" title="${escapeHtml(r.fatalReason || 'Student not found')}">UNMATCHED</span>`;
    }
    if (r.errorCount > 0 && r.readyCount > 0) {
        return `<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500 text-white shadow-xs" title="${r.readyCount} valid payment(s), ${r.errorCount} issue(s)">${r.readyCount} READY • ${r.errorCount} ERR</span>`;
    }
    if (r.errorCount > 0) {
        return `<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-600 text-white shadow-xs" title="${r.errorCount} validation issue(s)">${r.errorCount} ISSUE(S)</span>`;
    }
    if (r.readyCount > 0) {
        const hasGroupReady = r.readyEntries?.some((e) => e.billingMode === 'group');
        return hasGroupReady
            ? `<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-indigo-600 text-white shadow-xs" title="${r.readyCount} payment(s) ready (includes Family Group billing)">READY (${r.readyCount})</span>`
            : `<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-600 text-white shadow-xs" title="${r.readyCount} payment(s) ready to save">READY (${r.readyCount})</span>`;
    }
    if (r.alreadyPaidCount > 0) {
        return `<span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-sky-600 text-white shadow-xs" title="Existing settled fees locked as PAID">PAID (${r.alreadyPaidCount})</span>`;
    }
    return `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 text-slate-700" title="Enter Receipt No or Date to collect fee">IDLE</span>`;
};

const getCollectionBulkRowBgClass = (r) => {
    const groupBorder = r.groupId ? 'border-l-4 border-l-indigo-500' : '';
    if (r.isSampleRow) return 'bg-slate-100/80 text-slate-500 italic border-b border-slate-200';
    if (r.hasFatalError) return `bg-red-100 hover:bg-red-200/80 font-semibold text-red-950 border-b border-red-300 ${groupBorder}`;
    if (r.errorCount > 0) return `bg-amber-50/90 hover:bg-amber-100/80 text-amber-950 border-b border-amber-200 ${groupBorder}`;
    if (r.readyCount > 0) return `${r.groupId ? 'bg-indigo-50/35 hover:bg-indigo-50/65' : 'bg-emerald-50/40 hover:bg-emerald-50/80'} border-b border-slate-100 ${groupBorder}`;
    if (r.groupId) return `bg-indigo-50/20 hover:bg-indigo-50/45 border-b border-indigo-100 ${groupBorder}`;
    if (r.alreadyPaidCount > 0) return 'bg-sky-50/30 hover:bg-sky-50/60 border-b border-slate-100';
    return 'hover:bg-slate-50 border-b border-slate-100';
};

const getCollectionBulkCellVisual = (col, rowValidation) => {
    const cellInfo = rowValidation.cellStatuses?.[col.id] || { status: 'blank', reason: '' };
    const isFeeCol = isFeeEditableMappedField(col.mappedField);
    let bgClass = '';
    if (cellInfo.status === 'skip') {
        bgClass = 'bg-slate-50/60 text-slate-400 italic';
    } else if (cellInfo.status === 'sample') {
        bgClass = 'bg-slate-100/70 text-slate-400';
    } else if (cellInfo.status === 'locked') {
        if (rowValidation.hasFatalError) {
            bgClass = 'bg-red-100/70 text-red-900 font-semibold';
        } else if (rowValidation.groupId) {
            bgClass = 'bg-indigo-50/50 text-slate-800 font-semibold';
        } else {
            bgClass = 'bg-slate-50/80 text-slate-700 font-semibold';
        }
    } else if (cellInfo.status === 'error') {
        bgClass = 'bg-red-200 text-red-950 border-2 border-red-500 font-black';
    } else if (cellInfo.status === 'paid') {
        bgClass = 'bg-sky-100 text-sky-900 border border-sky-300 font-semibold';
    } else if (cellInfo.status === 'na') {
        bgClass = 'bg-slate-100/90 text-slate-400 italic';
    } else if (cellInfo.status === 'ready-group') {
        bgClass = 'bg-indigo-100/85 text-indigo-950 border border-indigo-400 font-bold';
    } else if (cellInfo.status === 'ready') {
        bgClass = 'bg-emerald-100/80 text-emerald-950 border border-emerald-300 font-bold';
    } else if (isFeeCol) {
        bgClass = 'bg-white text-slate-600';
    }
    return { bgClass, title: cellInfo.reason || '', isFeeCol, status: cellInfo.status };
};

const recalculateCollectionBulkStats = () => {
    const rows = collectionBulkState.parsedRows || [];
    const dataRows = rows.filter((r) => !r.isSampleRow);
    const totalRowsCount = dataRows.length;
    const totalReadyEntries = dataRows.reduce((sum, r) => sum + (r.hasFatalError ? 0 : r.readyCount), 0);
    const cleanRowsReadyEntries = dataRows
        .filter((r) => !r.hasFatalError && r.errorCount === 0)
        .reduce((sum, r) => sum + r.readyCount, 0);
    const fatalRowsCount = dataRows.filter((r) => r.hasFatalError).length;
    const cellErrorCount = dataRows.filter((r) => !r.hasFatalError).reduce((sum, r) => sum + r.errorCount, 0);
    const totalPaidItems = dataRows.reduce((sum, r) => sum + r.alreadyPaidCount, 0);
    const totalAmt = Number(collectionBulkState.totalCollectionAmount || 0);
    const readyTxCount = (collectionBulkState.paymentPlan || []).length;

    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
    };

    setTxt('collection-stat-total', totalRowsCount);
    setTxt('collection-stat-ready', totalReadyEntries);
    setTxt('collection-stat-ready-amount', formatBulkCurrency(totalAmt));
    setTxt('collection-stat-paid', totalPaidItems);

    if (fatalRowsCount > 0 && cellErrorCount > 0) {
        setTxt('collection-stat-issues', `${fatalRowsCount} Unmatched (${cellErrorCount} errs)`);
    } else if (fatalRowsCount > 0) {
        setTxt('collection-stat-issues', `${fatalRowsCount} Unmatched`);
    } else {
        setTxt('collection-stat-issues', cellErrorCount);
    }

    const recordBadge = document.getElementById('bulk-record-count');
    if (recordBadge) {
        const groupCount = new Set(dataRows.map((r) => r.groupId).filter(Boolean)).size;
        const groupTag = groupCount > 0 ? ` • ${groupCount} family group(s)` : '';
        recordBadge.textContent = `${totalRowsCount} student(s)${groupTag} • ${readyTxCount} billing item(s) • Total ${formatBulkCurrency(totalAmt)} • Class ${collectionBulkState.targetClass} (${collectionBulkState.year})`;
    }

    const duplicateFields = getCollectionDuplicateMappedFields();
    const hasDuplicateMapping = duplicateFields.size > 0;

    const startBtn = document.getElementById('bulk-start-upload-btn');
    const startBtnText = document.getElementById('collection-bulk-upload-all-text');
    const skipBtn = document.getElementById('collection-bulk-skip-issues-btn');
    const validOnlySpan = document.getElementById('collection-bulk-valid-only-count');

    const hasIssues = fatalRowsCount > 0 || cellErrorCount > 0;

    if (hasDuplicateMapping) {
        if (startBtn) startBtn.disabled = true;
        if (startBtnText) startBtnText.textContent = 'Cannot Save (Duplicate Column Mapped)';
        if (skipBtn) {
            skipBtn.disabled = true;
            skipBtn.classList.add('hidden');
        }
    } else if (totalReadyEntries === 0) {
        if (startBtn) startBtn.disabled = true;
        if (startBtnText) startBtnText.textContent = 'Save Payments (0 Ready)';
        if (skipBtn) {
            skipBtn.classList.add('hidden');
            skipBtn.disabled = true;
        }
    } else {
        if (startBtn) startBtn.disabled = false;
        if (startBtnText) startBtnText.textContent = `Save Payments (${readyTxCount} • ${formatBulkCurrency(totalAmt)})`;
        if (skipBtn) {
            if (hasIssues) {
                skipBtn.classList.remove('hidden');
                if (validOnlySpan) validOnlySpan.textContent = cleanRowsReadyEntries;
                skipBtn.disabled = cleanRowsReadyEntries === 0;
            } else {
                skipBtn.classList.add('hidden');
                skipBtn.disabled = true;
            }
        }
    }
};

const normalizeBulkReceiptKey = (rawVal = '') => {
    const trimmed = String(rawVal ?? '').trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return '';
    const parsed = parseInt(trimmed, 10);
    return !Number.isNaN(parsed) && parsed > 0 ? String(parsed) : '';
};

const computeCollectionBulkDuplicateReceipts = () => {
    const { columns = [], workingRows = [], parsedRows = [] } = collectionBulkState;
    const collectorKey = typeof getCollectorKey === 'function' ? getCollectorKey() : '';
    const existingDbReceiptSet = new Set();

    (Array.isArray(allPayments) ? allPayments : []).forEach((p) => {
        if (!p || p.receiptNo === undefined || p.receiptNo === null || p.receiptNo === '') return;
        if (collectorKey && p.collectedBy && p.collectedBy !== collectorKey) return;
        const key = normalizeBulkReceiptKey(p.receiptNo);
        if (key) existingDbReceiptSet.add(key);
    });

    const receiptCols = columns.filter((col) => col.mappedField && col.mappedField.endsWith('::receiptNo'));
    // Track occurrences by receipt key along with group/item context so siblings sharing a receipt get a friendly GRP tag
    const occurrencesByKey = new Map();

    workingRows.forEach((rowObj, rowIdx) => {
        const rowVal = parsedRows[rowIdx];
        if (!rowVal || rowVal.isSampleRow) return;
        receiptCols.forEach((col) => {
            const cellStatus = rowVal.cellStatuses?.[col.id]?.status;
            if (cellStatus === 'paid' || cellStatus === 'na') return;
            const key = normalizeBulkReceiptKey(rowObj?.[col.id]);
            if (!key) return;
            if (!occurrencesByKey.has(key)) occurrencesByKey.set(key, []);
            occurrencesByKey.get(key).push({
                rowIdx,
                groupId: rowVal.groupId || '',
                itemKey: getMappedItemKey(col.mappedField),
                studentId: rowVal.matchedStudent?.id || `row_${rowIdx}`
            });
        });
    });

    const duplicateReceiptMap = new Map();
    const groupSharedReceiptSet = new Set();
    let groupNo = 1;

    occurrencesByKey.forEach((occList, key) => {
        if (occList.length < 2) return;
        const distinctGroups = new Set(occList.map((o) => o.groupId).filter(Boolean));
        const allSameFamilyGroup = occList.every((o) => Boolean(o.groupId)) && distinctGroups.size === 1;

        if (allSameFamilyGroup) {
            groupSharedReceiptSet.add(key);
        } else {
            duplicateReceiptMap.set(key, {
                groupNo: groupNo++,
                count: occList.length,
                existsInDb: existingDbReceiptSet.has(key)
            });
        }
    });

    collectionBulkState.duplicateReceiptMap = duplicateReceiptMap;
    collectionBulkState.groupSharedReceiptSet = groupSharedReceiptSet;
    collectionBulkState.existingDbReceiptSet = existingDbReceiptSet;
    return { duplicateReceiptMap, groupSharedReceiptSet, existingDbReceiptSet };
};

const getCollectionBulkReceiptBadgeInfo = (col, rowValidation, rawVal) => {
    if (!col?.mappedField?.endsWith('::receiptNo') || rowValidation?.isSampleRow) {
        return { key: '', dupInfo: null, isGroupShared: false, existsInDb: false, titleNote: '' };
    }
    const cellStatus = rowValidation?.cellStatuses?.[col.id]?.status;
    if (cellStatus === 'paid' || cellStatus === 'na') {
        return { key: '', dupInfo: null, isGroupShared: false, existsInDb: false, titleNote: '' };
    }
    const key = normalizeBulkReceiptKey(rawVal);
    if (!key) {
        return { key: '', dupInfo: null, isGroupShared: false, existsInDb: false, titleNote: '' };
    }
    const dupInfo = collectionBulkState.duplicateReceiptMap?.get(key) || null;
    const isGroupShared = Boolean(collectionBulkState.groupSharedReceiptSet?.has(key));
    const existsInDb = Boolean(collectionBulkState.existingDbReceiptSet?.has(key));
    const notes = [];
    if (isGroupShared) {
        notes.push(`Shared Family Group Receipt #${key}`);
    } else if (dupInfo) {
        notes.push(`Duplicate Receipt #${key} (${dupInfo.count} times in sheet • Group ${dupInfo.groupNo})`);
    }
    if (existsInDb) {
        notes.push(`Receipt #${key} also exists in saved payments`);
    }
    return { key, dupInfo, isGroupShared, existsInDb, titleNote: notes.join(' • ') };
};

const buildCollectionBulkCellInnerHtml = ({ col, rowIdx, rowValidation, rawVal, canEditCell, badgeInfo }) => {
    const isReceiptCol = Boolean(col?.mappedField?.endsWith('::receiptNo'));
    if (!isReceiptCol) {
        if (col.mappedField === 'name' && rowValidation?.studentClass && rowValidation.studentClass.toUpperCase() !== String(collectionBulkState.targetClass || '').toUpperCase() && !rowValidation.isSampleRow) {
            return `<span class="inline-flex items-center gap-1.5"><span>${escapeHtml(rawVal)}</span><span class="px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 border border-indigo-200 text-[9px] font-black uppercase">${escapeHtml(rowValidation.studentClass)}</span></span>`;
        }
        return escapeHtml(rawVal);
    }
    const editorAttrs = canEditCell
        ? `contenteditable="true" class="collection-bulk-cell-editor block w-full min-h-[1.15rem] outline-none font-mono cursor-text"`
        : `class="collection-bulk-cell-editor block w-full min-h-[1.15rem]"`;
    let badgeHtml = '';
    if (badgeInfo?.isGroupShared) {
        badgeHtml = `<span class="collection-bulk-dup-badge !bg-indigo-600 !text-white !w-auto !px-1 !rounded text-[9px]" title="${escapeHtml(badgeInfo.titleNote)}">GRP</span>`;
    } else if (badgeInfo?.dupInfo) {
        badgeHtml = `<span class="collection-bulk-dup-badge" title="${escapeHtml(badgeInfo.titleNote)}">${badgeInfo.dupInfo.groupNo}</span>`;
    }
    return `<span ${editorAttrs} data-row-idx="${rowIdx}" data-col-id="${col.id}">${escapeHtml(rawVal)}</span>${badgeHtml}`;
};

const getCollectionBulkDuplicateSummaryHtml = () => {
    const count = collectionBulkState.duplicateReceiptMap?.size || 0;
    if (count === 0) return '';
    return `
        <span class="w-4 h-4 rounded-full bg-red-600 text-white text-[10px] font-black inline-flex items-center justify-center">!</span>
        <span>${count} Duplicate Receipt Group${count > 1 ? 's' : ''}</span>
    `;
};

const updateCollectionBulkDuplicateSummaryDom = () => {
    const summaryEl = document.getElementById('collection-bulk-dup-summary');
    if (!summaryEl) return;
    const html = getCollectionBulkDuplicateSummaryHtml();
    if (html) {
        summaryEl.innerHTML = html;
        summaryEl.classList.remove('hidden');
        summaryEl.classList.add('inline-flex');
    } else {
        summaryEl.innerHTML = '';
        summaryEl.classList.add('hidden');
        summaryEl.classList.remove('inline-flex');
    }
};

// Build group banner inner cells (also reused for in-place DOM updates on blur without losing focus)
const buildGroupBannerSegmentsHtml = (groupRowSample) => {
    const { columns = [], groupSummaryMap = new Map(), groupItemModes = new Map() } = collectionBulkState;
    const groupId = groupRowSample.groupId;
    const groupName = groupRowSample.groupName || 'Family Group';
    const memberCount = groupRowSample.groupMemberCount || 2;
    const groupFee = Number(groupRowSample.groupFee || 0);
    const feePill = groupFee > 0
        ? `<span class="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-mono font-bold">${formatBulkCurrency(groupFee)}/mo</span>`
        : '';

    const segments = [];
    let i = 0;
    while (i < columns.length) {
        const itemKey = getMappedItemKey(columns[i].mappedField);
        if (!itemKey) {
            let span = 1;
            while (i + span < columns.length && !getMappedItemKey(columns[i + span].mappedField)) {
                span += 1;
            }
            segments.push({ type: 'identity', span });
            i += span;
        } else {
            let span = 1;
            while (i + span < columns.length && getMappedItemKey(columns[i + span].mappedField) === itemKey) {
                span += 1;
            }
            segments.push({ type: 'item', itemKey, span });
            i += span;
        }
    }

    let placedTitle = false;
    const segHtml = segments.map((seg) => {
        if (seg.type === 'identity') {
            if (!placedTitle) {
                placedTitle = true;
                return `
                    <td colspan="${seg.span}" class="px-2.5 py-1.5 bg-indigo-100/80 border-b border-r border-indigo-200 text-indigo-950">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="inline-flex items-center gap-1.5 font-extrabold text-[11px] text-indigo-900">
                                <i class="fas fa-users text-indigo-600"></i>
                                <span>${escapeHtml(groupName)}</span>
                            </span>
                            <span class="px-1.5 py-0.5 rounded bg-white text-indigo-700 border border-indigo-200 text-[10px] font-bold">${memberCount} Members</span>
                            ${feePill}
                        </div>
                    </td>
                `;
            }
            return `<td colspan="${seg.span}" class="px-2 py-1.5 bg-indigo-100/50 border-b border-r border-indigo-200"></td>`;
        }

        const bucketKey = `${groupId}::${seg.itemKey}`;
        const currentMode = groupItemModes.get(bucketKey) || 'auto';
        const summary = groupSummaryMap.get(bucketKey) || null;
        let statusPillHtml = '<span class="text-[10px] font-semibold text-indigo-500/80">Auto</span>';
        if (summary) {
            if (summary.resolvedMode === 'group') {
                statusPillHtml = `<span class="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-black font-mono whitespace-nowrap" title="Unified Family Group Payment (${summary.filledCount} members)">Group ${formatBulkCurrency(summary.totalAmount)}</span>`;
            } else if (summary.resolvedMode === 'single') {
                statusPillHtml = `<span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-black font-mono whitespace-nowrap" title="Individual Single Payment(s) (${summary.filledCount} member${summary.filledCount > 1 ? 's' : ''})">Single ${formatBulkCurrency(summary.totalAmount)}</span>`;
            } else if (summary.resolvedMode === 'error') {
                statusPillHtml = `<span class="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-black whitespace-nowrap" title="Amounts differ across group members">Mismatch!</span>`;
            }
        }

        return `
            <td colspan="${seg.span}" class="px-2 py-1.5 bg-indigo-50/95 border-b border-r border-indigo-200" data-group-item-cell="${escapeHtml(bucketKey)}">
                <div class="flex items-center justify-between gap-1.5">
                    <select class="collection-bulk-group-mode-select px-1.5 py-0.5 rounded border border-indigo-300 bg-white text-[10px] font-bold text-indigo-900 focus:ring-1 focus:ring-indigo-500 cursor-pointer" data-group-id="${escapeHtml(groupId)}" data-item-key="${escapeHtml(seg.itemKey)}" title="Choose billing mode for this group & fee item">
                        <option value="auto" ${currentMode === 'auto' ? 'selected' : ''}>Mode: Auto</option>
                        <option value="group" ${currentMode === 'group' ? 'selected' : ''}>Group Payment</option>
                        <option value="single" ${currentMode === 'single' ? 'selected' : ''}>Single Payment</option>
                    </select>
                    ${statusPillHtml}
                </div>
            </td>
        `;
    }).join('');

    return `
        <td colspan="2" class="px-2 py-1.5 bg-indigo-100/90 border-b border-r border-indigo-200 text-center">
            <span class="px-2 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-black uppercase tracking-wider">FAMILY GROUP</span>
        </td>
        ${segHtml}
    `;
};

function updateCollectionBulkGroupBannerDom(groupId = '') {
    if (!groupId) return;
    const bannerTr = document.querySelector(`tr.collection-bulk-group-banner[data-group-id="${CSS.escape(groupId)}"]`);
    if (!bannerTr) return;
    const sampleRow = collectionBulkState.parsedRows.find((r) => !r.isSampleRow && r.groupId === groupId);
    if (!sampleRow) return;
    bannerTr.innerHTML = buildGroupBannerSegmentsHtml(sampleRow);
}

function renderCollectionBulkPreviewTable() {
    const container = document.getElementById('collection-bulk-table-container');
    if (!container) return;

    const { columns, workingRows, parsedRows, activeFeeItems, isEditMode } = collectionBulkState;
    if (!parsedRows.length) {
        container.innerHTML = '';
        return;
    }

    const duplicateFields = getCollectionDuplicateMappedFields();
    const hasDuplicateMapping = duplicateFields.size > 0;
    const mappingOptions = buildCollectionBulkMappingOptions(activeFeeItems);
    const duplicateLabels = Array.from(duplicateFields).map((f) => (
        mappingOptions.find((opt) => opt.key === f)?.label || f
    ));

    const mappedCount = columns.filter((c) => c.mappedField && c.mappedField !== 'none').length;
    const skippedCount = columns.length - mappedCount;
    const dupSummaryHtml = getCollectionBulkDuplicateSummaryHtml();

    const duplicateAlertHtml = hasDuplicateMapping ? `
        <div class="p-3 bg-red-600 text-white flex items-center gap-3 text-xs font-bold">
            <i class="fas fa-exclamation-triangle text-lg shrink-0"></i>
            <div>
                <div class="font-black text-sm">Duplicate Column Mapping Detected!</div>
                <div class="font-normal text-red-100 text-[11px]">The field(s) <b>${escapeHtml(duplicateLabels.join(', '))}</b> are assigned to multiple columns. Remap duplicate columns or set them to Skip before saving.</div>
            </div>
        </div>
    ` : '';

    const headerBannerHtml = `
        <div class="px-3 py-2 bg-slate-100/90 border-b border-slate-200 text-xs font-semibold text-slate-800 flex flex-wrap justify-between items-center gap-2">
            <div class="flex items-center gap-2 flex-wrap">
                <i class="fas fa-table text-emerald-600"></i>
                <span>Sheet Preview (${parsedRows.filter((r) => !r.isSampleRow).length} students • ${activeFeeItems.length} fee items)</span>
                <span class="text-[11px] font-normal text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                    ${mappedCount} Mapped, ${skippedCount} Skipped
                </span>
                <span id="collection-bulk-dup-summary" class="${dupSummaryHtml ? 'inline-flex' : 'hidden'} items-center gap-1.5 text-[11px] font-bold text-red-700 bg-red-50 px-2.5 py-0.5 rounded-full border border-red-200" title="Repeated receipt numbers across unrelated students are highlighted with numbered red badges">${dupSummaryHtml}</span>
            </div>
            <div class="text-xs">
                ${isEditMode
                    ? '<span class="text-emerald-700 font-bold flex items-center gap-1.5"><i class="fas fa-edit"></i> Edit Mode ON: Amount, Receipt No &amp; Date cells are editable</span>'
                    : '<span class="text-slate-500 flex items-center gap-1.5"><i class="fas fa-lock text-slate-400"></i> View Only (Turn ON Edit &amp; Mapping switch above to edit cells)</span>'}
            </div>
        </div>
    `;

    const theadHtml = `
        <thead class="bg-slate-100 text-slate-700 font-bold sticky top-0 z-20 shadow-sm border-b-2 border-slate-300">
            <tr>
                <th class="p-2 border-b border-r bg-slate-100 text-center w-10 text-slate-500 font-mono">#</th>
                <th class="p-2 border-b border-r bg-slate-100 text-center w-28">
                    <span class="block text-[11px] uppercase tracking-wider text-slate-600">Status</span>
                </th>
                ${columns.map((col) => {
                    const isDup = duplicateFields.has(col.mappedField);
                    const isSkipped = col.mappedField === 'none';
                    const isIdentityLocked = !isFeeEditableMappedField(col.mappedField) && !isSkipped;
                    let headerBg = 'bg-slate-100 text-slate-800';
                    let selectStyle = !isEditMode
                        ? 'opacity-65 cursor-not-allowed pointer-events-none bg-slate-100 border-slate-200 text-slate-500'
                        : 'border-blue-400 text-blue-900 font-bold bg-white';

                    if (isDup) {
                        headerBg = 'bg-red-600 text-white border-2 border-red-700';
                        selectStyle = 'bg-red-700 text-white border-2 border-white font-extrabold';
                    } else if (isSkipped) {
                        headerBg = 'bg-slate-50 text-slate-500';
                        if (isEditMode) selectStyle = 'border-slate-300 text-slate-600 bg-white font-medium';
                    } else if (isIdentityLocked) {
                        headerBg = 'bg-slate-200/70 text-slate-800';
                    }

                    const disabledAttr = !isEditMode ? 'disabled' : '';
                    const badgeIcon = isDup
                        ? '<span class="text-[9px] px-1.5 py-0.5 bg-white text-red-700 font-black rounded uppercase">DUPLICATE</span>'
                        : (isIdentityLocked
                            ? '<span class="text-[9px] px-1.5 py-0.5 bg-slate-300 text-slate-700 font-bold rounded inline-flex items-center gap-1"><i class="fas fa-lock text-[8px]"></i> LOCKED</span>'
                            : (isSkipped ? '<span class="text-[9px] px-1 bg-slate-200 text-slate-600 rounded">SKIP</span>' : ''));

                    return `
                        <th class="p-2 border-b border-r ${headerBg} min-w-[155px] max-w-[230px]">
                            <div class="flex items-center justify-between gap-1 mb-1">
                                <span class="text-[11px] font-mono ${isDup ? 'text-white font-extrabold' : 'text-slate-700'} truncate" title="${escapeHtml(col.header)}">${escapeHtml(col.header)}</span>
                                ${badgeIcon}
                            </div>
                            <select data-smart-select="true" data-smart-floating="true" data-smart-min-width="220" data-smart-wrapper-class="collection-bulk-col-map-wrap" data-smart-placeholder="Search column..." class="collection-bulk-col-map w-full p-1 border ${selectStyle} rounded text-[11px] shadow-2xs focus:ring-1 focus:ring-blue-500" data-col-id="${col.id}" ${disabledAttr}>
                                ${mappingOptions.map((opt) => `
                                    <option value="${escapeHtml(opt.key)}" ${col.mappedField === opt.key ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
                                `).join('')}
                            </select>
                        </th>
                    `;
                }).join('')}
            </tr>
        </thead>
    `;

    let prevGroupId = '';
    const tbodyParts = [];

    parsedRows.forEach((rowVal, idx) => {
        if (!rowVal.isSampleRow && rowVal.groupId && rowVal.groupId !== prevGroupId) {
            tbodyParts.push(`
                <tr class="collection-bulk-group-banner border-t-2 border-indigo-400 border-l-4 border-l-indigo-600" data-group-id="${escapeHtml(rowVal.groupId)}">
                    ${buildGroupBannerSegmentsHtml(rowVal)}
                </tr>
            `);
        }
        prevGroupId = !rowVal.isSampleRow ? (rowVal.groupId || '') : '';

        const workingRow = workingRows[idx] || {};
        const rowBg = getCollectionBulkRowBgClass(rowVal);
        const statusBadge = getCollectionBulkRowBadgeHtml(rowVal);

        const cellsHtml = columns.map((col) => {
            const rawVal = workingRow[col.id] !== undefined && workingRow[col.id] !== null ? String(workingRow[col.id]) : '';
            const visual = getCollectionBulkCellVisual(col, rowVal);
            const isReceiptCol = Boolean(col.mappedField?.endsWith('::receiptNo'));
            const canEditCell = isEditMode && visual.isFeeCol && !rowVal.isSampleRow && !rowVal.hasFatalError && visual.status !== 'paid' && visual.status !== 'na';
            const badgeInfo = getCollectionBulkReceiptBadgeInfo(col, rowVal, rawVal);
            const combinedTitle = [visual.title, badgeInfo.titleNote].filter(Boolean).join(' | ');
            const titleAttr = combinedTitle ? `title="${escapeHtml(combinedTitle)}"` : '';
            const receiptPadClass = isReceiptCol ? 'relative pr-9' : '';

            let tdAttrs = '';
            if (isReceiptCol) {
                tdAttrs = canEditCell
                    ? `class="collection-bulk-cell ${receiptPadClass} p-2 border-b border-r border-slate-200 whitespace-nowrap cursor-text focus-within:outline focus-within:outline-2 focus-within:outline-emerald-500 focus-within:bg-white focus-within:z-10 transition-all font-mono text-xs ${visual.bgClass}"`
                    : `class="collection-bulk-cell ${receiptPadClass} p-2 border-b border-r border-slate-200 whitespace-nowrap text-xs ${visual.bgClass}"`;
            } else {
                tdAttrs = canEditCell
                    ? `contenteditable="true" class="collection-bulk-cell p-2 border-b border-r border-slate-200 whitespace-nowrap cursor-text focus:outline focus:outline-2 focus:outline-emerald-500 focus:bg-white focus:z-10 transition-all font-mono text-xs ${visual.bgClass}"`
                    : `class="collection-bulk-cell p-2 border-b border-r border-slate-200 whitespace-nowrap text-xs ${visual.bgClass}"`;
            }

            const innerHtml = buildCollectionBulkCellInnerHtml({
                col,
                rowIdx: idx,
                rowValidation: rowVal,
                rawVal,
                canEditCell,
                badgeInfo
            });

            return `<td ${tdAttrs} data-row-idx="${idx}" data-col-id="${col.id}" ${titleAttr}>${innerHtml}</td>`;
        }).join('');

        tbodyParts.push(`
            <tr id="collection-bulk-row-${idx}" class="${rowBg} transition-colors" data-group-id="${escapeHtml(rowVal.groupId || '')}">
                <td class="p-2 text-center text-slate-500 border-b border-r border-slate-200 font-mono text-xs">${idx + 1}</td>
                <td class="collection-bulk-status-cell p-2 border-b border-r border-slate-200 text-center whitespace-nowrap">${statusBadge}</td>
                ${cellsHtml}
            </tr>
        `);
    });

    container.innerHTML = `
        ${duplicateAlertHtml}
        ${headerBannerHtml}
        <div class="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table class="w-full text-xs text-left text-slate-700 border-collapse">
                ${theadHtml}
                <tbody class="divide-y divide-slate-100 font-sans">
                    ${tbodyParts.join('')}
                </tbody>
            </table>
        </div>
    `;

    enableSmartSelectWindowing(container, { visibleCount: 0 });
    syncSmartSelectDisplay(container);
}

function refreshAllCollectionBulkDuplicateBadges() {
    const receiptCols = collectionBulkState.columns.filter((c) => c.mappedField?.endsWith('::receiptNo'));
    if (receiptCols.length > 0) {
        collectionBulkState.parsedRows.forEach((rowVal, rowIdx) => {
            const tr = document.getElementById(`collection-bulk-row-${rowIdx}`);
            if (!tr) return;
            const workingRow = collectionBulkState.workingRows[rowIdx] || {};
            receiptCols.forEach((col) => {
                const td = tr.querySelector(`.collection-bulk-cell[data-col-id="${col.id}"]`);
                if (!td) return;
                const rawVal = workingRow[col.id] !== undefined && workingRow[col.id] !== null ? String(workingRow[col.id]) : '';
                const visual = getCollectionBulkCellVisual(col, rowVal);
                const badgeInfo = getCollectionBulkReceiptBadgeInfo(col, rowVal, rawVal);
                const combinedTitle = [visual.title, badgeInfo.titleNote].filter(Boolean).join(' | ');
                td.title = combinedTitle;

                const existingBadge = td.querySelector('.collection-bulk-dup-badge');
                if (badgeInfo.isGroupShared) {
                    if (existingBadge) {
                        existingBadge.className = 'collection-bulk-dup-badge !bg-indigo-600 !text-white !w-auto !px-1 !rounded text-[9px]';
                        existingBadge.textContent = 'GRP';
                        existingBadge.title = badgeInfo.titleNote;
                    } else {
                        const badgeEl = document.createElement('span');
                        badgeEl.className = 'collection-bulk-dup-badge !bg-indigo-600 !text-white !w-auto !px-1 !rounded text-[9px]';
                        badgeEl.title = badgeInfo.titleNote;
                        badgeEl.textContent = 'GRP';
                        td.appendChild(badgeEl);
                    }
                } else if (badgeInfo.dupInfo) {
                    if (existingBadge) {
                        existingBadge.className = 'collection-bulk-dup-badge';
                        existingBadge.textContent = String(badgeInfo.dupInfo.groupNo);
                        existingBadge.title = badgeInfo.titleNote;
                    } else {
                        const badgeEl = document.createElement('span');
                        badgeEl.className = 'collection-bulk-dup-badge';
                        badgeEl.title = badgeInfo.titleNote;
                        badgeEl.textContent = String(badgeInfo.dupInfo.groupNo);
                        td.appendChild(badgeEl);
                    }
                } else if (existingBadge) {
                    existingBadge.remove();
                }
            });
        });
    }
    updateCollectionBulkDuplicateSummaryDom();
}

function updateCollectionBulkRowDom(rowIdx) {
    const tr = document.getElementById(`collection-bulk-row-${rowIdx}`);
    const rowVal = collectionBulkState.parsedRows[rowIdx];
    if (!tr || !rowVal) return;

    tr.className = `${getCollectionBulkRowBgClass(rowVal)} transition-colors`;
    const statusCell = tr.querySelector('.collection-bulk-status-cell');
    if (statusCell) {
        statusCell.innerHTML = getCollectionBulkRowBadgeHtml(rowVal);
    }

    const workingRow = collectionBulkState.workingRows[rowIdx] || {};

    collectionBulkState.columns.forEach((col) => {
        const td = tr.querySelector(`.collection-bulk-cell[data-col-id="${col.id}"]`);
        if (!td) return;
        const rawVal = workingRow[col.id] !== undefined && workingRow[col.id] !== null ? String(workingRow[col.id]) : '';
        const visual = getCollectionBulkCellVisual(col, rowVal);
        const isReceiptCol = Boolean(col.mappedField?.endsWith('::receiptNo'));
        const canEditCell = collectionBulkState.isEditMode && visual.isFeeCol && !rowVal.isSampleRow && !rowVal.hasFatalError && visual.status !== 'paid' && visual.status !== 'na';
        const badgeInfo = getCollectionBulkReceiptBadgeInfo(col, rowVal, rawVal);

        if (isReceiptCol) {
            td.removeAttribute('contenteditable');
            td.className = canEditCell
                ? `collection-bulk-cell relative pr-9 p-2 border-b border-r border-slate-200 whitespace-nowrap cursor-text focus-within:outline focus-within:outline-2 focus-within:outline-emerald-500 focus-within:bg-white focus-within:z-10 transition-all font-mono text-xs ${visual.bgClass}`
                : `collection-bulk-cell relative pr-9 p-2 border-b border-r border-slate-200 whitespace-nowrap text-xs ${visual.bgClass}`;
            const editor = td.querySelector('.collection-bulk-cell-editor');
            if (editor) {
                if (canEditCell) {
                    editor.setAttribute('contenteditable', 'true');
                    editor.className = 'collection-bulk-cell-editor block w-full min-h-[1.15rem] outline-none font-mono cursor-text';
                } else {
                    editor.removeAttribute('contenteditable');
                    editor.className = 'collection-bulk-cell-editor block w-full min-h-[1.15rem]';
                }
            }
        } else {
            if (canEditCell) {
                td.setAttribute('contenteditable', 'true');
                td.className = `collection-bulk-cell p-2 border-b border-r border-slate-200 whitespace-nowrap cursor-text focus:outline focus:outline-2 focus:outline-emerald-500 focus:bg-white focus:z-10 transition-all font-mono text-xs ${visual.bgClass}`;
            } else {
                td.removeAttribute('contenteditable');
                td.className = `collection-bulk-cell p-2 border-b border-r border-slate-200 whitespace-nowrap text-xs ${visual.bgClass}`;
            }
        }
        td.title = [visual.title, badgeInfo.titleNote].filter(Boolean).join(' | ');
    });
}

function runBulkSheetEvaluation() {
    const evalResult = evaluateCollectionBulkSheet({
        columns: collectionBulkState.columns,
        workingRows: collectionBulkState.workingRows,
        activeFeeItems: collectionBulkState.activeFeeItems,
        rosterEntries: collectionBulkState.rosterEntries,
        allStudents: allStudentsRaw,
        studentGroups,
        allPayments,
        targetClass: collectionBulkState.targetClass,
        year: collectionBulkState.year,
        fallbackYear: currentWorkingAcademicYear,
        defaultFee,
        defaultReceiptMandatory,
        groupItemModes: collectionBulkState.groupItemModes,
        normalizeDateFn: normalizeToIsoDate
    });

    collectionBulkState.parsedRows = evalResult.parsedRows;
    collectionBulkState.paymentPlan = evalResult.paymentPlan;
    collectionBulkState.groupSummaryMap = evalResult.groupSummaryMap;
    collectionBulkState.totalCollectionAmount = evalResult.totalCollectionAmount;
    computeCollectionBulkDuplicateReceipts();
    recalculateCollectionBulkStats();
}

function rebuildCollectionBulkStateAndRender() {
    runBulkSheetEvaluation();
    renderCollectionBulkPreviewTable();
}

const handleBulkFileSelection = (file) => {
    if (!file) return;
    const year = document.getElementById('bulk-academic-year')?.value || '';
    const targetClass = document.getElementById('bulk-class')?.value || '';
    const resetFileInput = () => {
        const fi = document.getElementById('bulk-file-input');
        if (fi) fi.value = '';
    };

    if (!year || !targetClass) {
        notifyBulkMessage('Please select both Academic Year and Target Class before uploading.', 'error');
        resetFileInput();
        return;
    }

    if (!isMasterSuperAdmin() && (!selectedDutyClasses.length || !isClassInDutyScope(targetClass, selectedDutyClasses))) {
        notifyBulkMessage('You do not have permission to upload payments for this class.', 'error');
        resetFileInput();
        return;
    }

    const fileName = String(file.name || '');
    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const mime = String(file.type || '').toLowerCase();
    const isCsv = ext === 'csv' || (!ext && (mime.includes('csv') || mime === 'text/plain'));
    const isExcel = !isCsv && (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheetml') || mime.includes('ms-excel'));

    if (!isCsv && !isExcel) {
        notifyBulkMessage('Unsupported file format. Please upload a .xlsx, .xls, or .csv file.', 'error');
        resetFileInput();
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            let matrix = [];
            if (isCsv) {
                matrix = parseCsvArrayBufferToMatrix(e.target.result);
            } else {
                if (typeof XLSX === 'undefined') {
                    notifyBulkMessage('Spreadsheet library is still loading. Please try again in a moment.', 'error');
                    return;
                }
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheetName = workbook.SheetNames?.[0];
                if (!firstSheetName) {
                    notifyBulkMessage('No worksheets found in the uploaded file.', 'error');
                    return;
                }
                const worksheet = workbook.Sheets[firstSheetName];
                const rawMatrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                matrix = rawMatrix
                    .filter((r) => Array.isArray(r) && r.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== ''))
                    .map((r) => r.map((cell) => formatSpreadsheetCellValue(cell)));
            }

            if (matrix.length < 2) {
                notifyBulkMessage('No fee rows found in the selected file.', 'error');
                resetFileInput();
                return;
            }

            const rosterEntries = buildBulkRosterWithGroups({
                allStudents: allStudentsRaw,
                studentGroups,
                targetClass,
                year,
                fallbackYear: currentWorkingAcademicYear
            });

            const rawHeaders = matrix[0];
            const classColIdx = rawHeaders.findIndex((h) => ['class', 'classname', 'std', 'grade'].includes(String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
            const uploadedClasses = classColIdx >= 0
                ? matrix.slice(1).map((r) => String(r[classColIdx] || '').trim()).filter(Boolean)
                : [];
            const rosterClasses = [...new Set([
                targetClass,
                ...rosterEntries.map((r) => r.studentClass).filter(Boolean),
                ...uploadedClasses
            ])];

            const activeFeeItems = resolveActiveBulkFeeItems({
                feeItems,
                year,
                defaultMonthlyFeeEnabled,
                rosterClasses,
                sortMonthlyFn: sortMonthlyItemsByAcademicYear
            });

            if (activeFeeItems.length === 0) {
                notifyBulkMessage(`No active fee items found for ${year}. Check Fee Settings & Setup.`, 'error');
                resetFileInput();
                return;
            }

            const columns = buildCollectionBulkColumns(rawHeaders, activeFeeItems);
            const hasStudentIdentity = columns.some((c) => c.mappedField === 'adm' || c.mappedField === 'name' || c.mappedField === 'studentId');
            if (!hasStudentIdentity) {
                notifyBulkMessage('Invalid file format. Could not detect Admission_No or Student_Name column.', 'error');
                resetFileInput();
                return;
            }

            const rawWorkingRows = matrix.slice(1).map((cells) => {
                const rowObj = {};
                columns.forEach((col, idx) => {
                    rowObj[col.id] = cells[idx] !== undefined && cells[idx] !== null ? String(cells[idx]).trim() : '';
                });
                return rowObj;
            });

            const workingRows = reorderUploadedRowsByFamilyGroup(rawWorkingRows, columns, rosterEntries);

            collectionBulkState = {
                columns,
                workingRows,
                parsedRows: [],
                activeFeeItems,
                rosterEntries,
                paymentPlan: [],
                groupSummaryMap: new Map(),
                groupItemModes: new Map(),
                totalCollectionAmount: 0,
                year,
                targetClass,
                isEditMode: false,
                fileName,
                sheetSource: 'upload',
                duplicateReceiptMap: new Map(),
                groupSharedReceiptSet: new Set(),
                existingDbReceiptSet: new Set()
            };
            window.bulkUploadParsedData = collectionBulkState;

            const fileIconEl = document.getElementById('collection-bulk-file-icon');
            if (fileIconEl) {
                fileIconEl.className = isCsv
                    ? 'fas fa-file-csv text-blue-600 text-lg'
                    : 'fas fa-file-excel text-emerald-600 text-lg';
            }
            const fileNameEl = document.getElementById('bulk-file-name');
            if (fileNameEl) fileNameEl.textContent = fileName;

            document.getElementById('bulk-drop-zone')?.classList.add('hidden');
            document.getElementById('bulk-preview-area')?.classList.remove('hidden');
            document.getElementById('bulk-progress-container')?.classList.add('hidden');

            setCollectionBulkEditMode(false, { skipRender: true });
            rebuildCollectionBulkStateAndRender();
        } catch (error) {
            console.error('Parse Error:', error);
            notifyBulkMessage('Error reading file. Please ensure it is a valid .xlsx, .xls, or .csv file.', 'error');
            resetFileInput();
        }
    };
    reader.onerror = () => {
        notifyBulkMessage('Failed to read the selected file. Please try again.', 'error');
        resetFileInput();
    };
    reader.readAsArrayBuffer(file);
};

document.getElementById('collection-bulk-edit-switch')?.addEventListener('change', (e) => {
    setCollectionBulkEditMode(e.target.checked);
});

const collectionBulkTableContainer = document.getElementById('collection-bulk-table-container');
if (collectionBulkTableContainer) {
    collectionBulkTableContainer.addEventListener('change', (e) => {
        const modeSelect = e.target.closest('.collection-bulk-group-mode-select');
        if (modeSelect) {
            const groupId = modeSelect.dataset.groupId || '';
            const itemKey = modeSelect.dataset.itemKey || '';
            if (groupId && itemKey) {
                collectionBulkState.groupItemModes.set(`${groupId}::${itemKey}`, modeSelect.value || 'auto');
                runBulkSheetEvaluation();
                collectionBulkState.parsedRows.forEach((r, idx) => {
                    if (!r.isSampleRow && r.groupId === groupId) {
                        updateCollectionBulkRowDom(idx);
                    }
                });
                updateCollectionBulkGroupBannerDom(groupId);
                refreshAllCollectionBulkDuplicateBadges();
            }
            return;
        }

        const select = e.target.closest('.collection-bulk-col-map');
        if (!select) return;
        const colId = select.dataset.colId;
        const targetCol = collectionBulkState.columns.find((c) => c.id === colId);
        if (targetCol) {
            targetCol.mappedField = select.value;
            rebuildCollectionBulkStateAndRender();
        }
    });

    collectionBulkTableContainer.addEventListener('click', (e) => {
        if (!collectionBulkState.isEditMode) return;
        const cell = e.target.closest('.collection-bulk-cell');
        if (!cell) return;
        const editor = cell.querySelector('.collection-bulk-cell-editor[contenteditable="true"]');
        if (editor && e.target !== editor) {
            editor.focus();
        }
    });

    collectionBulkTableContainer.addEventListener('blur', (e) => {
        const cell = e.target.closest('.collection-bulk-cell');
        if (!cell || !collectionBulkState.isEditMode) return;
        const editor = cell.querySelector('.collection-bulk-cell-editor');
        const activeEditable = editor ? editor.getAttribute('contenteditable') === 'true' : cell.getAttribute('contenteditable') === 'true';
        if (!activeEditable) return;

        const rowIdx = parseInt(cell.dataset.rowIdx, 10);
        const colId = cell.dataset.colId;
        if (Number.isNaN(rowIdx) || !colId || !collectionBulkState.workingRows[rowIdx]) return;

        const newText = (editor ? editor.innerText : cell.innerText).trim();
        if (collectionBulkState.workingRows[rowIdx][colId] === newText) return;
        collectionBulkState.workingRows[rowIdx][colId] = newText;

        runBulkSheetEvaluation();

        const editedRowVal = collectionBulkState.parsedRows[rowIdx];
        const affectedGroupId = editedRowVal?.groupId || '';
        if (affectedGroupId) {
            collectionBulkState.parsedRows.forEach((r, idx) => {
                if (!r.isSampleRow && r.groupId === affectedGroupId) {
                    updateCollectionBulkRowDom(idx);
                }
            });
            updateCollectionBulkGroupBannerDom(affectedGroupId);
        } else {
            updateCollectionBulkRowDom(rowIdx);
        }

        const editedCol = collectionBulkState.columns.find((c) => c.id === colId);
        if (editedCol?.mappedField?.endsWith('::receiptNo')) {
            refreshAllCollectionBulkDuplicateBadges();
        }
    }, true);

    collectionBulkTableContainer.addEventListener('keydown', (e) => {
        const cell = e.target.closest('.collection-bulk-cell');
        if (!cell || !collectionBulkState.isEditMode) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            const rowIdx = parseInt(cell.dataset.rowIdx, 10);
            const colId = cell.dataset.colId;
            let nextIdx = rowIdx + 1;
            let moved = false;
            while (nextIdx < collectionBulkState.workingRows.length) {
                const nextTd = collectionBulkTableContainer.querySelector(`.collection-bulk-cell[data-row-idx="${nextIdx}"][data-col-id="${colId}"]`);
                const nextEditor = nextTd?.querySelector('.collection-bulk-cell-editor[contenteditable="true"]');
                if (nextEditor) {
                    nextEditor.focus();
                    moved = true;
                    break;
                }
                if (nextTd && nextTd.getAttribute('contenteditable') === 'true') {
                    nextTd.focus();
                    moved = true;
                    break;
                }
                nextIdx += 1;
            }
            if (!moved) {
                const currentTarget = cell.querySelector('.collection-bulk-cell-editor[contenteditable="true"]') || cell;
                currentTarget.blur();
            }
        }
    });
}

document.getElementById('bulk-file-input')?.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleBulkFileSelection(e.target.files[0]);
});

const bulkDropZone = document.getElementById('bulk-drop-zone');
if (bulkDropZone) {
    bulkDropZone.addEventListener('dragover', (e) => { e.preventDefault(); bulkDropZone.classList.add('dragover'); });
    bulkDropZone.addEventListener('dragleave', () => bulkDropZone.classList.remove('dragover'));
    bulkDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        bulkDropZone.classList.remove('dragover');
        if (e.dataTransfer.files?.length) handleBulkFileSelection(e.dataTransfer.files[0]);
    });
    bulkDropZone.addEventListener('click', () => document.getElementById('bulk-file-input')?.click());
}

document.getElementById('bulk-cancel-btn')?.addEventListener('click', setupBulkUploadUI);

const executeCollectionBulkUpload = async ({ validOnly = false } = {}) => {
    const duplicateFields = getCollectionDuplicateMappedFields();
    if (duplicateFields.size > 0) {
        notifyBulkMessage('Duplicate column mappings detected. Please resolve them before saving.', 'error');
        return;
    }

    // Re-evaluate right before saving to guarantee fresh state & prevent stale data
    runBulkSheetEvaluation();

    const { parsedRows, paymentPlan, year, targetClass, sheetSource } = collectionBulkState;
    const dataRows = parsedRows.filter((r) => !r.isSampleRow && !r.hasFatalError);
    const eligibleRows = validOnly ? dataRows.filter((r) => r.errorCount === 0) : dataRows;
    const eligibleRowIndices = new Set(eligibleRows.map((r) => r.rowIdx));

    let skippedAlreadyPaid = 0;
    let skippedInvalid = parsedRows.filter((r) => !r.isSampleRow && r.hasFatalError).length;

    dataRows.forEach((r) => {
        skippedAlreadyPaid += r.alreadyPaidCount;
        if (validOnly && r.errorCount > 0) {
            skippedInvalid += r.readyCount + r.errorCount;
        } else {
            skippedInvalid += r.errorCount;
        }
    });

    const collectorName = getCurrentCollectorName();
    const collectorUserKey = getCollectorKey();
    const collectorEmail = normalizeEmail(getEffectiveStaffEmail() || auth?.currentUser?.email || '');
    const collectorUid = auth?.currentUser?.uid ? String(auth.currentUser.uid).trim() : '';
    const startingAutoReceiptNo = getNextReceiptNoForStaff() || 1;

    const { payloads: paymentOperations, skippedAlreadyPaid: lateSkippedPaid } = buildBulkFirestorePaymentPayloads({
        paymentPlan,
        eligibleRowIndices,
        allPayments,
        year,
        targetClass,
        collectorUserKey,
        collectorName,
        collectorEmail,
        collectorUid,
        startingAutoReceiptNo,
        description: sheetSource === 'blank' ? 'Bulk Blank Sheet' : 'Bulk Upload'
    });
    skippedAlreadyPaid += lateSkippedPaid;

    if (paymentOperations.length === 0) {
        notifyBulkMessage('No valid unpaid fee entries found to save.', 'error');
        return;
    }

    const savedTotalAmount = paymentOperations.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const startBtn = document.getElementById('bulk-start-upload-btn');
    const skipBtn = document.getElementById('collection-bulk-skip-issues-btn');
    const cancelBtn = document.getElementById('bulk-cancel-btn');
    if (startBtn) startBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    const progressWrap = document.getElementById('bulk-progress-container');
    const progressBar = document.getElementById('bulk-progress-bar');
    const progressPct = document.getElementById('bulk-progress-pct');
    const progressText = document.getElementById('bulk-progress-text');
    progressWrap?.classList.remove('hidden');

    const CHUNK_SIZE = 150;
    let successCount = 0;

    try {
        for (let i = 0; i < paymentOperations.length; i += CHUNK_SIZE) {
            const batch = writeBatch(db);
            const chunk = paymentOperations.slice(i, i + CHUNK_SIZE);

            chunk.forEach((payload) => {
                queuePaymentWrite(batch, payload);
            });

            await batch.commit();
            successCount += chunk.length;

            const pct = Math.round((successCount / paymentOperations.length) * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressPct) progressPct.textContent = `${pct}%`;
            if (progressText) progressText.textContent = `Saving ${successCount} of ${paymentOperations.length} fee record(s)...`;
        }

        if (progressBar) progressBar.style.width = '100%';
        if (progressPct) progressPct.textContent = '100%';
        if (progressText) progressText.textContent = 'Save Complete!';

        const modal = document.getElementById('collection-bulk-status-modal');
        if (modal) {
            const scopeEl = document.getElementById('collection-bulk-result-scope');
            const savedEl = document.getElementById('collection-bulk-result-saved');
            const paidEl = document.getElementById('collection-bulk-result-paid');
            const skippedEl = document.getElementById('collection-bulk-result-skipped');
            const okBtn = document.getElementById('collection-bulk-result-ok-btn');

            if (scopeEl) scopeEl.textContent = `Class ${targetClass} • ${year} • Total ${formatBulkCurrency(savedTotalAmount)}`;
            if (savedEl) savedEl.textContent = String(successCount);
            if (paidEl) paidEl.textContent = String(skippedAlreadyPaid);
            if (skippedEl) skippedEl.textContent = String(skippedInvalid);

            modal.classList.remove('hidden');
            modal.classList.add('flex');

            if (okBtn) {
                okBtn.onclick = () => {
                    modal.classList.add('hidden');
                    modal.classList.remove('flex');
                    if (cancelBtn) cancelBtn.disabled = false;
                    setupBulkUploadUI();
                    notifyBulkMessage(`Successfully recorded ${successCount} fee record(s) totaling ${formatBulkCurrency(savedTotalAmount)}.`, 'success');
                    activateTab('dashboard-page');
                };
            }
        } else {
            notifyBulkMessage(`Success! ${successCount} fee record(s) totaling ${formatBulkCurrency(savedTotalAmount)} saved.`, 'success');
            if (cancelBtn) cancelBtn.disabled = false;
            setupBulkUploadUI();
            activateTab('dashboard-page');
        }
    } catch (error) {
        console.error('Bulk Upload Error:', error);
        notifyBulkMessage('An error occurred while saving: ' + (error?.message || 'Please check your network connection.'), 'error');
        if (startBtn) startBtn.disabled = false;
        if (skipBtn) skipBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        recalculateCollectionBulkStats();
    }
};

document.getElementById('bulk-start-upload-btn')?.addEventListener('click', () => executeCollectionBulkUpload({ validOnly: false }));
document.getElementById('collection-bulk-skip-issues-btn')?.addEventListener('click', () => executeCollectionBulkUpload({ validOnly: true }));


window.renderFeeTable = () => {
    if (typeof syncMasterLedgerState === 'function') syncMasterLedgerState();
};


// Shared Transaction & Group Receipt Reconstruction Helpers
const getMergedKnownPayments = () => {
    const map = new Map();
    (allPayments || []).forEach(p => { if (p?.id) map.set(p.id, p); });
    const ledgerList = window.MasterLedger?.ledgerPayments;
    if (Array.isArray(ledgerList)) {
        ledgerList.forEach(p => {
            if (p?.id && !map.has(p.id)) map.set(p.id, p);
        });
    }
    return [...map.values()];
};

const resolveTransactionReceiptDetails = (paymentOrId) => {
    const allKnown = getMergedKnownPayments();
    const clickedPayment = typeof paymentOrId === 'string'
        ? allKnown.find(p => p.id === paymentOrId)
        : paymentOrId;
    if (!clickedPayment) return null;

    const txnId = clickedPayment.transactionId || '';
    const hasReceiptNo = clickedPayment.receiptNo !== undefined && clickedPayment.receiptNo !== null && String(clickedPayment.receiptNo).trim() !== '';
    const collectorKey = clickedPayment.collectedBy || '';

    let txnPayments = [];
    if (txnId) {
        txnPayments = allKnown.filter(p => p.transactionId === txnId);
    } else if (hasReceiptNo) {
        txnPayments = allKnown.filter(p =>
            Number(p.receiptNo) === Number(clickedPayment.receiptNo)
            && (p.collectedBy || '') === collectorKey
            && (p.paymentDate || '') === (clickedPayment.paymentDate || '')
        );
    }
    if (!txnPayments.length) {
        txnPayments = [clickedPayment];
    }

    // Collect all unique students across transaction docs and targetGroupMemberIds
    const studentsMap = new Map();
    const addStudentEntry = (sid, fallbackPay = null) => {
        if (!sid) return;
        const stObj = getStudentById(sid);
        if (!studentsMap.has(sid)) {
            studentsMap.set(sid, {
                id: sid,
                name: stObj?.name || fallbackPay?.studentName || 'Student',
                class: stObj?.class || stObj?.studentClass || fallbackPay?.studentClass || fallbackPay?.classLabel || '-',
                adm: stObj?.adm || fallbackPay?.studentAdm || '-',
                guardian: stObj?.guardian || stObj?.father || fallbackPay?.guardianName || ''
            });
        }
    };

    // Sort primary records first so primary student appears first
    const orderedPayments = [...txnPayments].sort((a, b) => (a.isGroupMirror ? 1 : 0) - (b.isGroupMirror ? 1 : 0));
    orderedPayments.forEach((p) => {
        addStudentEntry(p.studentId, p);
        if (Array.isArray(p.targetGroupMemberIds)) {
            p.targetGroupMemberIds.forEach(mid => addStudentEntry(mid, p));
        }
    });

    // If full billingGroupId exists on an item with no explicit targetGroupMemberIds, include group members
    orderedPayments.forEach((p) => {
        if (p.billingGroupId && (!Array.isArray(p.targetGroupMemberIds) || p.targetGroupMemberIds.length === 0)) {
            const grp = studentGroups.find(g => g.id === p.billingGroupId);
            if (grp && Array.isArray(grp.memberIds)) {
                grp.memberIds.forEach(mid => addStudentEntry(mid, p));
            }
        }
    });

    // Group items cleanly so sibling mirrors of the same group fee collapse into 1 item line with exact paid amount
    const itemsMap = new Map();
    orderedPayments.forEach((p) => {
        const itemObj = feeItems.find(fi => fi.key === p.itemKey);
        const itemType = itemObj?.type || getPaymentItemType(p);
        const itemName = itemObj?.name || p.itemName || normalizeFeeItemName(p.itemKey) || 'Tuition Fee';
        const isGroupedMonthly = itemType === 'month' && (
            Boolean(p.billingGroupId)
            || Boolean(p.isGroupPrimary)
            || Boolean(p.isGroupMirror)
            || (Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 1)
        );
        const groupKey = isGroupedMonthly
            ? `${p.itemKey || ''}__${p.academicYear || ''}__${p.billingGroupId || (p.targetGroupMemberIds || []).join(',')}`
            : `${p.itemKey || ''}__${p.academicYear || ''}__${p.studentId || p.id}`;

        const resolvedAmt = isGroupedMonthly ? getMonthlyReportPaymentAmount(p) : roundMoney(p.amount || 0);

        if (!itemsMap.has(groupKey)) {
            const memberNames = [];
            if (isGroupedMonthly && Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 0) {
                p.targetGroupMemberIds.forEach(mid => {
                    const m = studentsMap.get(mid) || getStudentById(mid);
                    if (m?.name) memberNames.push(m.name);
                });
            } else {
                const st = studentsMap.get(p.studentId) || getStudentById(p.studentId);
                if (st?.name) memberNames.push(st.name);
            }
            itemsMap.set(groupKey, {
                key: groupKey,
                itemKey: p.itemKey,
                itemName: normalizeFeeItemName(itemName),
                itemType,
                academicYear: p.academicYear || '',
                amount: resolvedAmt,
                isGroupItem: isGroupedMonthly,
                isFullGroup: Boolean(p.billingGroupId),
                memberNames,
                primaryPayment: !p.isGroupMirror ? p : null,
                payments: [p]
            });
        } else {
            const existing = itemsMap.get(groupKey);
            existing.payments.push(p);
            if (!p.isGroupMirror && !existing.primaryPayment) {
                existing.primaryPayment = p;
            }
            if (resolvedAmt > existing.amount) {
                existing.amount = resolvedAmt;
            }
            const st = studentsMap.get(p.studentId) || getStudentById(p.studentId);
            if (st?.name && !existing.memberNames.includes(st.name)) {
                existing.memberNames.push(st.name);
            }
        }
    });

    const items = [...itemsMap.values()].map(entry => ({
        ...entry,
        primaryPayment: entry.primaryPayment || entry.payments[0]
    }));
    const grandTotal = roundMoney(items.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const clickedItemEntry = items.find(entry => entry.payments.some(p => p.id === clickedPayment.id)) || items[0];

    return {
        clickedPayment,
        primaryPayment: clickedItemEntry?.primaryPayment || orderedPayments.find(p => !p.isGroupMirror) || clickedPayment,
        txnPayments: orderedPayments,
        students: [...studentsMap.values()],
        items,
        grandTotal,
        clickedItemEntry
    };
};

// Printable Receipt Slip Generator
export const printPaymentReceiptSlip = (paymentId) => {
    const details = resolveTransactionReceiptDetails(paymentId);
    if (!details) {
        showToast('Receipt details not found for printing.', 'error');
        return;
    }
    const { clickedPayment, students: includedStudents, items, grandTotal } = details;
    const collectorName = getStaffName(clickedPayment.collectedBy, clickedPayment.collectedByName);
    const instName = document.getElementById('header-title')?.textContent?.trim() || 'Institution Name';
    const place = document.getElementById('header-place')?.textContent?.trim() || '';
    const regNo = document.getElementById('header-regno')?.textContent?.trim() || '';

    const studentsSectionHtml = includedStudents.map((stu, idx) => `
        <div class="student-line">
            <span class="bold">${includedStudents.length > 1 ? `${idx + 1}. ` : ''}${escapeHtml(stu.name)}</span>
            <span class="muted">Class: ${escapeHtml(stu.class)} • Adm: ${escapeHtml(stu.adm)}</span>
        </div>
    `).join('');

    const itemRowsHtml = items.map((item) => `
        <div class="row" style="align-items:flex-start; gap:8px;">
            <div>
                <div class="bold">${escapeHtml(item.itemName)}${item.academicYear ? ` <span class="muted">(${escapeHtml(item.academicYear)})</span>` : ''}</div>
                ${includedStudents.length > 1 && item.memberNames.length > 0 ? `<div class="muted" style="font-size:10px;">${escapeHtml(item.memberNames.join(', '))}</div>` : ''}
            </div>
            <span class="bold" style="white-space:nowrap;">₹${Number(item.amount || 0).toFixed(2)}</span>
        </div>
    `).join('');

    const printWindow = window.open('', '_blank', 'width=520,height=720');
    if (!printWindow) {
        window.print();
        return;
    }
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Fee Receipt - #${escapeHtml(clickedPayment.receiptNo || 'Slip')}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace, sans-serif; padding: 24px; max-width: 400px; margin: auto; color: #0f172a; line-height: 1.4; }
                .center { text-align: center; }
                .bold { font-weight: 700; }
                .muted { color: #64748b; font-size: 11px; }
                .border-b { border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; margin-bottom: 10px; }
                .border-t { border-top: 1px dashed #cbd5e1; padding-top: 10px; margin-top: 10px; }
                .row { display: flex; justify-content: space-between; margin: 6px 0; font-size: 12px; }
                .student-line { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; font-size: 11.5px; }
                .title { font-size: 15px; font-weight: 800; text-transform: uppercase; margin-bottom: 3px; }
                .subtitle { font-size: 11px; color: #64748b; margin-bottom: 8px; }
                .amt-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; margin: 12px 0; }
                .amt { font-size: 20px; font-weight: 800; color: #166534; }
                .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; background: #dcfce7; color: #166534; font-size: 10px; font-weight: 800; }
                @media print { body { padding: 0; max-width: 100%; } }
            </style>
        </head>
        <body>
            <div class="center border-b">
                <div class="title">${escapeHtml(instName)}</div>
                <div class="subtitle">${escapeHtml(place)} ${regNo ? `• Reg: ${escapeHtml(regNo)}` : ''}</div>
                <div class="badge">OFFICIAL FEE RECEIPT</div>
            </div>
            <div class="row"><span>Receipt No:</span><span class="bold">#${escapeHtml(clickedPayment.receiptNo || 'AUTO')}</span></div>
            <div class="row"><span>Date:</span><span>${escapeHtml(clickedPayment.paymentDate ? new Date(clickedPayment.paymentDate).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB'))}</span></div>
            <div class="border-t">
                <div class="muted" style="font-weight:700; text-transform:uppercase; font-size:10px; margin-bottom:4px;">Students (${includedStudents.length})</div>
                ${studentsSectionHtml}
            </div>
            <div class="border-t border-b">
                <div class="row bold"><span>Description / Item</span><span>Amount</span></div>
                ${itemRowsHtml}
            </div>
            <div class="amt-box">
                <div style="font-size: 11px; color: #64748b; font-weight: 600;">TOTAL AMOUNT PAID</div>
                <div class="amt">₹${grandTotal.toFixed(2)}</div>
            </div>
            <div class="row"><span>Payment Mode:</span><span class="bold">${escapeHtml(clickedPayment.paymentMode || 'Cash')}</span></div>
            <div class="row"><span>Collected By:</span><span>${escapeHtml(collectorName || 'Staff')}</span></div>
            ${clickedPayment.description ? `<div class="row"><span>Note:</span><span style="text-align:right; max-width:220px;">${escapeHtml(clickedPayment.description)}</span></div>` : ''}
            <div class="center border-t" style="margin-top: 16px; font-size: 10px; color: #94a3b8;">
                Verified Transaction Record • Thank You!
            </div>
            <script>
                window.onload = function() { window.print(); };
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

let lastReceiptActiveCell = null;

// Open Verified Receipt Details Modal
window.openPaymentReceiptDetailModal = (paymentId, targetCellElement = null) => {
    if (!paymentId) return;
    lastReceiptActiveCell = targetCellElement || null;
    const details = resolveTransactionReceiptDetails(paymentId);
    if (!details) {
        showToast('Receipt details not found.', 'error');
        return;
    }

    const modal = document.getElementById('payment-receipt-view-modal');
    if (!modal) return;

    const { clickedPayment, primaryPayment, students: includedStudents, items, grandTotal, clickedItemEntry } = details;
    const collectorName = getStaffName(clickedPayment.collectedBy, clickedPayment.collectedByName);
    const primaryStudent = includedStudents[0] || { name: clickedPayment.studentName || 'Student', class: '-', adm: '-', guardian: '' };

    const paymentIdInput = document.getElementById('receipt-view-payment-id');
    if (paymentIdInput) paymentIdInput.value = primaryPayment?.id || clickedPayment.id || '';

    const studentIdInput = document.getElementById('receipt-view-student-id');
    if (studentIdInput) studentIdInput.value = primaryPayment?.studentId || clickedPayment.studentId || '';

    const txnIdInput = document.getElementById('receipt-view-txn-id');
    if (txnIdInput) txnIdInput.value = getPaymentGroupKey(clickedPayment) || clickedPayment.transactionId || '';

    const rcptEl = document.getElementById('receipt-view-no');
    if (rcptEl) rcptEl.textContent = clickedPayment.receiptNo ? `#${clickedPayment.receiptNo}` : 'AUTO / N/A';

    const amtEl = document.getElementById('receipt-view-amount');
    if (amtEl) amtEl.textContent = `₹${grandTotal.toFixed(0)}`;

    const cellNoteEl = document.getElementById('receipt-view-cell-amount-note');
    if (cellNoteEl) {
        if (items.length > 1 && clickedItemEntry) {
            cellNoteEl.textContent = `Selected Item: ${clickedItemEntry.itemName} (₹${Number(clickedItemEntry.amount || 0).toFixed(0)}) · Combined Receipt (${items.length} Items)`;
            cellNoteEl.classList.remove('hidden');
        } else {
            cellNoteEl.textContent = '';
            cellNoteEl.classList.add('hidden');
        }
    }

    const groupBadgeEl = document.getElementById('receipt-view-group-badge');
    if (groupBadgeEl) {
        if (includedStudents.length > 1) {
            groupBadgeEl.textContent = `Group · ${includedStudents.length} Students`;
            groupBadgeEl.classList.remove('hidden');
        } else {
            groupBadgeEl.classList.add('hidden');
        }
    }

    const nameEl = document.getElementById('receipt-view-name');
    if (nameEl) {
        nameEl.textContent = includedStudents.length > 1
            ? `${primaryStudent.name} + ${includedStudents.length - 1} more`
            : primaryStudent.name;
    }

    const metaEl = document.getElementById('receipt-view-meta');
    if (metaEl) {
        metaEl.textContent = includedStudents.length > 1
            ? `Guardian: ${primaryStudent.guardian || '--'} | ${includedStudents.length} students covered in this receipt`
            : `Class: ${primaryStudent.class || '-'} | Adm: ${primaryStudent.adm || '-'} | Guardian: ${primaryStudent.guardian || '--'}`;
    }

    const studentsListEl = document.getElementById('receipt-view-students-list');
    if (studentsListEl) {
        studentsListEl.innerHTML = includedStudents.map((stu, idx) => `
            <div class="flex items-center justify-between gap-2 text-[11px] bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-100">
                <div class="font-bold text-slate-800 truncate">${includedStudents.length > 1 ? `${idx + 1}. ` : ''}${escapeHtml(stu.name)}</div>
                <div class="text-[10.5px] text-slate-600 font-medium shrink-0 tabular-nums">
                    Cls: <b>${escapeHtml(stu.class || '-')}</b> · Adm: <span class="font-mono">${escapeHtml(stu.adm || '-')}</span>
                </div>
            </div>
        `).join('');
    }

    const itemEl = document.getElementById('receipt-view-item');
    if (itemEl) {
        itemEl.textContent = items.length === 1
            ? items[0].itemName
            : `${items.length} Fee Items`;
    }

    const itemsListEl = document.getElementById('receipt-view-items-list');
    if (itemsListEl) {
        itemsListEl.innerHTML = items.map((item) => {
            const isHighlighted = items.length > 1 && clickedItemEntry && item.key === clickedItemEntry.key;
            return `
                <div class="flex items-center justify-between gap-2 px-2.5 py-2 ${isHighlighted ? 'bg-blue-50/70' : 'bg-white'}">
                    <div class="min-w-0">
                        <div class="font-bold text-slate-800 text-xs flex items-center gap-1.5 flex-wrap">
                            <span>${escapeHtml(item.itemName)}</span>
                            ${item.academicYear ? `<span class="text-[10px] font-medium text-slate-500">${escapeHtml(item.academicYear)}</span>` : ''}
                            ${item.isGroupItem ? `<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold">Group</span>` : ''}
                        </div>
                        ${includedStudents.length > 1 && item.memberNames.length > 0 ? `<div class="text-[10px] text-slate-500 truncate mt-0.5">${escapeHtml(item.memberNames.join(', '))}</div>` : ''}
                    </div>
                    <div class="font-mono tabular-nums font-extrabold text-slate-900 text-xs shrink-0">₹${Number(item.amount || 0).toFixed(0)}</div>
                </div>
            `;
        }).join('');
    }

    const dateEl = document.getElementById('receipt-view-date');
    if (dateEl) dateEl.textContent = clickedPayment.paymentDate ? new Date(clickedPayment.paymentDate).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');

    const modeEl = document.getElementById('receipt-view-mode');
    if (modeEl) modeEl.textContent = clickedPayment.paymentMode || 'Cash';

    const collEl = document.getElementById('receipt-view-collector');
    if (collEl) collEl.textContent = collectorName || 'Staff';

    const descWrap = document.getElementById('receipt-view-desc-wrap');
    const descEl = document.getElementById('receipt-view-desc');
    if (descWrap && descEl) {
        if (clickedPayment.description) {
            descEl.textContent = clickedPayment.description;
            descWrap.classList.remove('hidden');
        } else {
            descEl.textContent = '';
            descWrap.classList.add('hidden');
        }
    }

    const canModifyReceipt = canModifyPaymentRecord(details.txnPayments?.length ? details.txnPayments : clickedPayment);
    const receiptEditBtn = document.getElementById('receipt-view-edit-btn');
    const receiptDelBtn = document.getElementById('receipt-view-delete-btn');
    if (receiptEditBtn) receiptEditBtn.classList.toggle('hidden', !canModifyReceipt);
    if (receiptDelBtn) receiptDelBtn.classList.toggle('hidden', !canModifyReceipt);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

const closePaymentReceiptDetailModal = () => {
    const modal = document.getElementById('payment-receipt-view-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

document.getElementById('receipt-view-close-x')?.addEventListener('click', closePaymentReceiptDetailModal);
document.getElementById('payment-receipt-view-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'payment-receipt-view-modal') closePaymentReceiptDetailModal();
});

document.getElementById('receipt-view-print-btn')?.addEventListener('click', () => {
    const paymentId = document.getElementById('receipt-view-payment-id')?.value;
    if (paymentId) printPaymentReceiptSlip(paymentId);
});

document.getElementById('receipt-view-edit-btn')?.addEventListener('click', () => {
    const paymentId = document.getElementById('receipt-view-payment-id')?.value;
    const studentId = document.getElementById('receipt-view-student-id')?.value;
    const txnId = document.getElementById('receipt-view-txn-id')?.value;
    closePaymentReceiptDetailModal();

    const details = paymentId ? resolveTransactionReceiptDetails(paymentId) : null;
    if (details && details.items.length > 1 && studentId && txnId) {
        startEditingPayment(studentId, txnId);
        return;
    }

    const payment = details?.primaryPayment
        || allPayments.find(p => paymentId && p.id === paymentId)
        || (Array.isArray(window.MasterLedger?.ledgerPayments) ? window.MasterLedger.ledgerPayments.find(p => p.id === paymentId) : null)
        || (studentId && txnId ? allPayments.find(p => p.studentId === studentId && (getPaymentGroupKey(p) === txnId || p.transactionId === txnId)) : null);

    if (payment) {
        if (!canModifyPaymentRecord(details?.txnPayments?.length ? details.txnPayments : payment)) {
            showToast('You can only edit payments that you collected.', 'warn');
            return;
        }
        openFeeEntryEditModal({
            mode: 'edit',
            payment: payment,
            relatedPayments: details?.clickedItemEntry?.payments || details?.txnPayments || [payment],
            includedStudents: details?.students || [],
            targetCellElement: lastReceiptActiveCell,
            academicYear: payment.academicYear || selectedFeeAcademicYear || currentWorkingAcademicYear
        });
    } else if (studentId && txnId) {
        startEditingPayment(studentId, txnId);
    } else {
        showToast('Unable to edit this payment entry.', 'info');
    }
});

document.getElementById('receipt-view-delete-btn')?.addEventListener('click', async () => {
    const delBtn = document.getElementById('receipt-view-delete-btn');
    const paymentId = document.getElementById('receipt-view-payment-id')?.value;
    const txnId = document.getElementById('receipt-view-txn-id')?.value;
    if (!paymentId && !txnId) return;

    const details = paymentId ? resolveTransactionReceiptDetails(paymentId) : null;
    const targetRecords = details?.txnPayments?.length
        ? details.txnPayments
        : allPayments.filter((p) => (paymentId && p.id === paymentId) || (txnId && (getPaymentGroupKey(p) === txnId || p.transactionId === txnId)));
    if (targetRecords.length > 0 && !canModifyPaymentRecord(targetRecords)) {
        showToast('You can only delete payments that you collected.', 'warn');
        return;
    }

    const confirmed = await openConfirmDialog({
        title: 'Delete Payment',
        message: 'Are you sure you want to permanently delete this payment?',
        okLabel: 'Delete',
        danger: true
    });
    if (!confirmed) return;

    const prevHtml = delBtn ? delBtn.innerHTML : '';
    if (delBtn) {
        delBtn.disabled = true;
        delBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Deleting...';
    }

    try {
        const batch = writeBatch(db);
        let docsToDelete = [];
        if (txnId) {
            docsToDelete = await collectPaymentDocsForGroup(txnId, '');
        }
        if (docsToDelete.length === 0 && paymentId) {
            const singleRef = doc(db, `${BASE_PATH}/payments`, paymentId);
            const singleSnap = await getDoc(singleRef);
            if (singleSnap.exists()) docsToDelete = [singleSnap];
        }
        if (docsToDelete.length > 0 && !canModifyPaymentRecord(docsToDelete.map((d) => d.data()))) {
            throw new Error('You can only delete payments that you collected.');
        }

        if (docsToDelete.length > 0) {
            await queueExistingPaymentDeletes(batch, docsToDelete, []);
        } else {
            const fallbackMatches = txnId
                ? allPayments.filter((p) => getPaymentGroupKey(p) === txnId || p.transactionId === txnId)
                : (paymentId ? allPayments.filter((p) => p.id === paymentId) : []);
            await queueExistingPaymentDeletes(batch, [], fallbackMatches);
        }

        await batch.commit();
        showToast('Payment deleted successfully.', 'success');
        closePaymentReceiptDetailModal();
    } catch (err) {
        logFirestorePermissionError(err, 'delete', `${BASE_PATH}/payments`);
        console.error('Delete payment error:', err);
        showToast('Failed to delete payment: ' + (err.message || 'Network error'), 'error');
    } finally {
        if (delBtn) {
            delBtn.disabled = false;
            delBtn.innerHTML = prevHtml;
        }
    }
});

const getClassSortValue = (classLabel = '') => {
    const text = String(classLabel || '').toUpperCase();
    const numberMatch = text.match(/\d+/);
    if (numberMatch) return Number(numberMatch[0]);
    if (text.includes('PLUS TWO') || text.includes('+2')) return 12;
    if (text.includes('PLUS ONE') || text.includes('+1')) return 11;
    if (text.includes('UKG')) return 0.2;
    if (text.includes('LKG')) return 0.1;
    return -1;
};
const compareClassesHighToLow = (a = '', b = '') => {
    const rankDiff = getClassSortValue(b) - getClassSortValue(a);
    if (rankDiff !== 0) return rankDiff;
    return String(b || '').localeCompare(String(a || ''), undefined, { numeric: true, sensitivity: 'base' });
};
const studentConcGroupSearchText = (student = {}) => [student.name, student.adm, student.class, student.concessionFee, student.guardian, student.father]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
const groupConcGroupSearchText = (group = {}, members = []) => [
    group.fee,
    group.name,
    ...members.flatMap((member) => [member.name, member.adm, member.class, member.guardian, member.father])
].map((value) => String(value || '').toLowerCase()).join(' ');

let concGroupActiveView = 'concession'; // 'concession' | 'group'

const renderConcessionGroupOverview = () => {
    const yearSelect = document.getElementById('conc-group-year-select');
    const classSelect = document.getElementById('conc-group-class-select');
    const searchInput = document.getElementById('conc-group-search-input');
    const clearSearchBtn = document.getElementById('conc-group-search-clear');
    const viewTabsWrap = document.getElementById('conc-group-view-tabs');

    const selectedYear = yearSelect?.value || currentWorkingAcademicYear || getAcademicYearFromDate();
    if (yearSelect) {
        const years = [...new Set(students.map((s) => s.academicYear).filter(Boolean).concat([currentWorkingAcademicYear]).filter(Boolean))];
        populateAcademicYearSelect(yearSelect, years, currentWorkingAcademicYear, {
            selectedValue: selectedYear,
            preferCurrentUnlessUserChanged: true
        });
        if (!yearSelect.dataset.bound) {
            yearSelect.dataset.bound = '1';
            yearSelect.addEventListener('change', () => {
                if (classSelect) delete classSelect.dataset.populatedYear;
                renderConcessionGroupOverview();
            });
        }
    }

    const activeYear = yearSelect?.value || selectedYear;
    const yearStudents = students.filter((student) => (student.academicYear || '') === activeYear);

    if (classSelect && classSelect.dataset.populatedYear !== activeYear) {
        const prevClass = classSelect.value || '';
        const uniqueClasses = [...new Set(yearStudents.map((s) => s.class).filter(Boolean))].sort(compareClassLabelsNatural);
        populateClassSelect(classSelect, uniqueClasses, {
            selectedValue: prevClass,
            placeholder: '-- Select Class --',
            includeAllOption: true,
            allOptionLabel: 'All Classes',
            allOptionValue: 'all'
        });
        classSelect.dataset.populatedYear = activeYear;
        if (!classSelect.dataset.bound) {
            classSelect.dataset.bound = '1';
            classSelect.addEventListener('change', renderConcessionGroupOverview);
        }
    }

    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = '1';
        searchInput.addEventListener('input', renderConcessionGroupOverview);
    }

    if (clearSearchBtn && !clearSearchBtn.dataset.bound) {
        clearSearchBtn.dataset.bound = '1';
        clearSearchBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            renderConcessionGroupOverview();
        });
    }

    if (viewTabsWrap && !viewTabsWrap.dataset.bound) {
        viewTabsWrap.dataset.bound = '1';
        viewTabsWrap.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-conc-view]');
            if (!btn) return;
            concGroupActiveView = btn.dataset.concView === 'group' ? 'group' : 'concession';
            viewTabsWrap.querySelectorAll('.conc-view-tab-btn').forEach((b) => {
                const isActive = b.dataset.concView === concGroupActiveView;
                b.className = isActive
                    ? 'conc-view-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-blue-700 shadow-xs transition'
                    : 'conc-view-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition';
            });
            renderConcessionGroupOverview();
        });
    }

    const searchTerm = (searchInput?.value || '').trim().toLowerCase();
    const selectedClass = classSelect?.value || '';

    if (clearSearchBtn) {
        clearSearchBtn.classList.toggle('hidden', !searchTerm);
        clearSearchBtn.classList.toggle('inline-flex', Boolean(searchTerm));
    }

    const concessionStudents = yearStudents
        .filter((student) => student.concessionFee !== undefined && student.concessionFee !== null && student.concessionFee !== '')
        .filter((student) => !selectedClass || selectedClass === 'all' || student.class === selectedClass)
        .filter((student) => !searchTerm || studentConcGroupSearchText(student).includes(searchTerm))
        .sort((a, b) => compareClassesHighToLow(a.class, b.class) || String(a.adm || '').localeCompare(String(b.adm || ''), undefined, { numeric: true }) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

    const groupEntries = studentGroups
        .filter((group) => (group.academicYear || activeYear) === activeYear)
        .map((group) => ({
            group,
            members: (group.memberIds || [])
                .map((memberId) => students.find((student) => student.id === memberId))
                .filter(Boolean)
                .sort((a, b) => compareClassesHighToLow(a.class, b.class) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
        }))
        .filter((entry) => entry.members.length > 0)
        .filter((entry) => !selectedClass || selectedClass === 'all' || entry.members.some((m) => m.class === selectedClass))
        .filter((entry) => !searchTerm || groupConcGroupSearchText(entry.group, entry.members).includes(searchTerm))
        .sort((a, b) => {
            const topClassA = a.members[0]?.class || '';
            const topClassB = b.members[0]?.class || '';
            return compareClassesHighToLow(topClassA, topClassB)
                || String(a.members[0]?.name || '').localeCompare(String(b.members[0]?.name || ''), undefined, { sensitivity: 'base' });
        });

    const totalGroupedStudentsCount = groupEntries.reduce((sum, entry) => sum + entry.members.length, 0);

    const summaryEl = document.getElementById('conc-group-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between">
                <div>
                    <div class="text-[11px] uppercase font-extrabold text-emerald-700 tracking-wide">Concession Students</div>
                    <div class="text-2xl font-black text-emerald-900 mt-0.5">${concessionStudents.length}</div>
                </div>
                <div class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg"><i class="fas fa-percent"></i></div>
            </div>
            <div class="bg-blue-50/80 border border-blue-200 rounded-xl p-3.5 flex items-center justify-between">
                <div>
                    <div class="text-[11px] uppercase font-extrabold text-blue-700 tracking-wide">Concession Groups</div>
                    <div class="text-2xl font-black text-blue-900 mt-0.5">${groupEntries.length}</div>
                </div>
                <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-lg"><i class="fas fa-users"></i></div>
            </div>
            <div class="bg-indigo-50/80 border border-indigo-200 rounded-xl p-3.5 flex items-center justify-between">
                <div>
                    <div class="text-[11px] uppercase font-extrabold text-indigo-700 tracking-wide">Students in Groups</div>
                    <div class="text-2xl font-black text-indigo-900 mt-0.5">${totalGroupedStudentsCount}</div>
                </div>
                <div class="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-lg"><i class="fas fa-user-friends"></i></div>
            </div>
        `;
    }

    const emptyConcLabel = searchTerm || selectedClass ? 'No matching concession students found.' : 'No concession students configured for this academic year.';
    const emptyGroupLabel = searchTerm || selectedClass ? 'No matching groups found.' : 'No concession groups configured for this academic year.';

    // Build Concession Table HTML
    const concessionTableHtml = `
        <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs flex flex-col">
            <div class="px-4 py-3 bg-emerald-50/70 border-b border-emerald-200 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-lg bg-emerald-600 text-white inline-flex items-center justify-center text-xs"><i class="fas fa-user-tag"></i></span>
                    <h3 class="font-extrabold text-slate-800 text-sm">Individual Concession Table</h3>
                </div>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">${concessionStudents.length} Students</span>
            </div>
            <div class="overflow-x-auto custom-scroll max-h-[68vh]">
                ${concessionStudents.length > 0 ? `
                <table class="w-full text-xs text-left border-collapse">
                    <thead class="bg-slate-100 text-slate-700 uppercase font-extrabold sticky top-0 z-10 border-b border-slate-200 shadow-2xs">
                        <tr>
                            <th class="py-2.5 px-3 w-12 text-center border-r border-slate-200">#</th>
                            <th class="py-2.5 px-3 w-24 border-r border-slate-200">Adm No</th>
                            <th class="py-2.5 px-3 border-r border-slate-200 min-w-[170px]">Student Name</th>
                            <th class="py-2.5 px-3 w-20 text-center border-r border-slate-200">Class</th>
                            <th class="py-2.5 px-3 w-28 text-right">Concession Fee</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${concessionStudents.map((student, idx) => {
                            const guardian = student.guardian || student.father || '';
                            const normalFeeVal = Number(defaultFee || 200);
                            const concFeeVal = Number(student.concessionFee || 0);
                            const discountVal = normalFeeVal > concFeeVal ? normalFeeVal - concFeeVal : 0;
                            return `
                            <tr class="hover:bg-emerald-50/40 transition cursor-pointer" onclick="window.openStudentProfile && window.openStudentProfile('${escapeHtml(student.id)}')" title="Click to view profile">
                                <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-400 border-r border-slate-100">${idx + 1}</td>
                                <td class="py-2.5 px-3 font-mono font-bold text-slate-700 border-r border-slate-100 whitespace-nowrap">${escapeHtml(student.adm || '-')}</td>
                                <td class="py-2.5 px-3 border-r border-slate-100">
                                    <div class="font-bold text-slate-900 leading-snug">${escapeHtml(student.name || '--')}</div>
                                    ${guardian ? `<div class="text-[10px] text-slate-500 mt-0.5 truncate max-w-[220px]"><i class="fas fa-user-shield text-[9px] mr-1 text-slate-400"></i>${escapeHtml(guardian)}</div>` : ''}
                                </td>
                                <td class="py-2.5 px-3 text-center border-r border-slate-100 whitespace-nowrap">
                                    <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-bold text-[11px] border border-slate-200">${escapeHtml(student.class || '--')}</span>
                                </td>
                                <td class="py-2.5 px-3 text-right whitespace-nowrap">
                                    <span class="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-mono font-extrabold text-xs border border-emerald-200">
                                        ₹${escapeHtml(String(student.concessionFee))}/mo
                                    </span>
                                    ${discountVal > 0 ? `<div class="text-[9px] font-semibold text-emerald-600 mt-0.5">Saves ₹${discountVal}/mo</div>` : ''}
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                ` : `<div class="p-8 text-center text-xs font-semibold text-slate-400">${emptyConcLabel}</div>`}
            </div>
        </div>
    `;

    // Build Group List Table HTML
    const groupTableHtml = `
        <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs flex flex-col">
            <div class="px-4 py-3 bg-blue-50/70 border-b border-blue-200 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-lg bg-blue-600 text-white inline-flex items-center justify-center text-xs"><i class="fas fa-users"></i></span>
                    <h3 class="font-extrabold text-slate-800 text-sm">Concession Group Table (Family / Siblings)</h3>
                </div>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-100 text-blue-800 border border-blue-200">${groupEntries.length} Groups</span>
            </div>
            <div class="overflow-x-auto custom-scroll max-h-[68vh]">
                ${groupEntries.length > 0 ? `
                <table class="w-full text-xs text-left border-collapse">
                    <thead class="bg-slate-100 text-slate-700 uppercase font-extrabold sticky top-0 z-10 border-b border-slate-200 shadow-2xs">
                        <tr>
                            <th class="py-2.5 px-3 w-24 text-center border-r border-slate-200">Group #</th>
                            <th class="py-2.5 px-3 border-r border-slate-200 min-w-[260px]">Group Members (Students)</th>
                            <th class="py-2.5 px-3 w-32 text-right">Group Fee</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200">
                        ${groupEntries.map(({ group, members }, idx) => {
                            const primaryGuardian = members.map((m) => m.guardian || m.father).find(Boolean) || '';
                            const groupFeeDisplay = group.fee ? `₹${escapeHtml(String(group.fee))}/mo` : `₹${escapeHtml(String(defaultFee || 200))}/mo`;

                            const membersSubRows = members.map((member, mIdx) => `
                                <div class="flex items-center justify-between gap-2 py-1.5 ${mIdx > 0 ? 'border-t border-slate-100' : ''} hover:bg-blue-50/50 px-1.5 rounded transition cursor-pointer"
                                     onclick="window.openStudentProfile && window.openStudentProfile('${escapeHtml(member.id)}')"
                                     title="Click to view ${escapeHtml(member.name || 'student')} profile">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <span class="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-mono text-[10px] font-bold inline-flex items-center justify-center flex-shrink-0">${mIdx + 1}</span>
                                        <span class="font-bold text-slate-900 truncate">${escapeHtml(member.name || '--')}</span>
                                    </div>
                                    <div class="flex items-center gap-1.5 flex-shrink-0">
                                        <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-bold border border-slate-200">Adm: ${escapeHtml(member.adm || '-')}</span>
                                        <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px] border border-blue-200">Cls: ${escapeHtml(member.class || '-')}</span>
                                    </div>
                                </div>
                            `).join('');

                            return `
                            <tr class="hover:bg-slate-50/70 transition align-top">
                                <td class="py-3 px-3 text-center border-r border-slate-100 whitespace-nowrap">
                                    <div class="inline-flex flex-col items-center">
                                        <span class="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-extrabold text-[11px] shadow-2xs">Group ${idx + 1}</span>
                                        <span class="text-[10px] font-bold text-slate-500 mt-1">${members.length} ${members.length === 1 ? 'Child' : 'Children'}</span>
                                    </div>
                                </td>
                                <td class="py-2 px-3 border-r border-slate-100">
                                    ${primaryGuardian ? `<div class="text-[10px] font-bold text-slate-500 mb-1 px-1.5 flex items-center gap-1"><i class="fas fa-house-user text-blue-500"></i> Guardian: <span class="text-slate-700">${escapeHtml(primaryGuardian)}</span></div>` : ''}
                                    <div class="divide-y divide-slate-100">${membersSubRows}</div>
                                </td>
                                <td class="py-3 px-3 text-right whitespace-nowrap">
                                    <span class="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-100 text-blue-900 font-mono font-extrabold text-xs border border-blue-200">
                                        ${groupFeeDisplay}
                                    </span>
                                    <div class="text-[10px] font-semibold text-slate-500 mt-1">Combined Rate</div>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                ` : `<div class="p-8 text-center text-xs font-semibold text-slate-400">${emptyGroupLabel}</div>`}
            </div>
        </div>
    `;

    const contentEl = document.getElementById('conc-group-content');
    if (contentEl) {
        if (concGroupActiveView === 'group') {
            contentEl.innerHTML = `<div class="grid grid-cols-1 gap-5">${groupTableHtml}</div>`;
        } else {
            contentEl.innerHTML = `<div class="grid grid-cols-1 gap-5">${concessionTableHtml}</div>`;
        }
    }
};
// --- HISTORY RENDER ---
const updateHistoryStaffFilter = () => {
    const filterEl = document.getElementById('history-staff-filter');
    if (!filterEl) return;
    if (!isMasterSuperAdmin()) {
        filterEl.classList.add('hidden');
        syncSmartSelectDisplay(filterEl);
        return;
    }
    filterEl.classList.remove('hidden');

    const uniqueEmails = [...new Set([
        ...allPayments.map(p => p.collectedBy),
        ...allDonations.map(d => d.collectedBy)
    ])].filter(Boolean);
    const currentVal = filterEl.value;

    let opts = `<option value="all">All Staff Collections</option>`;
    uniqueEmails.forEach(email => { opts += `<option value="${escapeHtml(email)}">${escapeHtml(getStaffName(email, null))}</option>`; });

    filterEl.innerHTML = opts;
    if(uniqueEmails.includes(currentVal) || currentVal === 'all') filterEl.value = currentVal;
    syncSmartSelectDisplay(filterEl);
};

const prepareHistoryData = () => {
    historyRenderToken += 1;
    if (historyLoadTimer) {
        clearTimeout(historyLoadTimer);
        historyLoadTimer = null;
    }

    const hasAdminHistoryAccess = isMasterSuperAdmin();
    let myPays = hasAdminHistoryAccess ? [...allPayments] : allPayments.filter((payment) => isSameCollectorRecord(payment));
    let myDonations = hasAdminHistoryAccess ? [...allDonations] : allDonations.filter((donation) => isSameCollectorRecord(donation));

    if (hasAdminHistoryAccess) {
        const staffFilter = document.getElementById('history-staff-filter').value;
        if (staffFilter && staffFilter !== 'all') {
            myPays = myPays.filter(p => p.collectedBy === staffFilter);
            myDonations = myDonations.filter((donation) => donation.collectedBy === staffFilter);
        }
    }

    const searchTerm = (document.getElementById('history-search-input')?.value || '').toLowerCase();

    // 🌟 FIX: Timestamp History Sorting 🌟
    const feeHistoryGroups = Object.values(myPays.reduce((a, p) => {
        const k = getPaymentGroupKey(p);
        
        // Use exact millisecond timestamp from database
        const pTs = p.timestamp || new Date(p.paymentDate || Date.now()).getTime();
        
        if(!a[k]) {
            a[k] = {
                tId: k, r: p.receiptNo||'-', sId: p.studentId, dt: p.paymentDate,
                ts: pTs, kind: 'fee',
                i: [], tot: 0, by: getStaffName(p.collectedBy, p.collectedByName), studentIds: [], seenBillingKeys: new Set(),
                description: p.description || '',
                fallbackStudent: {
                    name: p.studentName || 'Student',
                    adm: p.studentAdm || '-',
                    class: p.classLabel || p.studentClass || '-'
                },
                payments: [p]
            };
        } else {
            // Keep the absolute highest (newest) timestamp for accurate sorting of this group
            if (pTs > a[k].ts) a[k].ts = pTs;
            if (!a[k].description && p.description) a[k].description = p.description;
            a[k].payments.push(p);
        }
        
        const billingKey = getPaymentBillingKey(p);
        if (!a[k].seenBillingKeys.has(billingKey)) {
            a[k].seenBillingKeys.add(billingKey);
            a[k].i.push(p.itemKey);
            a[k].tot = roundMoney(a[k].tot + getMonthlyReportPaymentAmount(p));
        }
        
        if (!a[k].studentIds.includes(p.studentId)) a[k].studentIds.push(p.studentId);
        
        return a;
    }, {})).map((grpItem) => ({
        ...grpItem,
        canModify: canModifyPaymentRecord(grpItem.payments)
    }));
    
    const donationHistoryRows = myDonations.map((donation) => ({
        tId: `donation:${donation.id}`,
        r: donation.receiptNo || '-',
        sId: '',
        dt: donation.paymentDate,
        ts: donation.timestamp || new Date(donation.paymentDate || Date.now()).getTime(),
        kind: 'donation',
        i: ['donation'],
        tot: Number(donation.amount || 0),
        by: getStaffName(donation.collectedBy, donation.collectedByName),
        studentIds: [],
        donorName: donation.donorName || '-',
        description: donation.description || '',
        canModify: canModifyDonationRecord(donation)
    }));
    sortedHistoryList = [...feeHistoryGroups, ...donationHistoryRows];

    if (searchTerm) {
        sortedHistoryList = sortedHistoryList.filter(item => {
            if (item.kind === 'donation') {
                const donor = (item.donorName || '').toLowerCase();
                const desc = (item.description || '').toLowerCase();
                const rNo = item.r.toString().toLowerCase();
                return donor.includes(searchTerm) || desc.includes(searchTerm) || rNo.includes(searchTerm);
            }
            const studentsInTxn = item.studentIds.map((id) => getStudentById(id)).filter(Boolean);
            const sName = (studentsInTxn.length ? studentsInTxn.map((student) => student.name.toLowerCase()).join(' ') : (item.fallbackStudent?.name || '').toLowerCase());
            const sAdm = (studentsInTxn.length ? studentsInTxn.map((student) => (student.adm || '').toLowerCase()).join(' ') : (item.fallbackStudent?.adm || '').toLowerCase());
            const rNo = item.r.toString().toLowerCase();
            const desc = (item.description || '').toLowerCase();
            return sName.includes(searchTerm) || sAdm.includes(searchTerm) || rNo.includes(searchTerm) || desc.includes(searchTerm);
        });
    }

    // Sort by entered payment date first (desc), then by timestamp within same date (desc)
    const toDayValue = (dateStr = '') => {
        if (!dateStr) return 0;
        const parsed = new Date(`${dateStr}T00:00:00`).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    };
    sortedHistoryList.sort((a, b) => {
        const dayDiff = toDayValue(b.dt) - toDayValue(a.dt);
        if (dayDiff !== 0) return dayDiff;
        return Number(b.ts || 0) - Number(a.ts || 0);
    });

    document.getElementById('history-count-badge').textContent = `${sortedHistoryList.length} Transactions`;
    const loader = document.getElementById('history-loading-indicator');
    if (loader) loader.classList.add('hidden');
    historyPageOffset = 0;
    renderHistoryPage();
};

const renderHistoryPage = () => {
    const tbody = document.getElementById('history-content-tbody');
    const infoEl = document.getElementById('history-pagination-info');
    const prevBtn = document.getElementById('history-prev-btn');
    const nextBtn = document.getElementById('history-next-btn');
    const loader = document.getElementById('history-loading-indicator');
    if (loader) loader.classList.add('hidden');
    if (!tbody) return;

    const totalTxnCount = sortedHistoryList.length;
    if (totalTxnCount === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-gray-500 font-medium">No payment history found.</td></tr>`;
        if (infoEl) infoEl.innerHTML = `Showing <span class="text-slate-900 font-extrabold">0</span> transactions`;
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    const isAll = historyRowLimit === 'all';
    const effectiveLimit = isAll ? totalTxnCount : (parseInt(historyRowLimit, 10) || 25);

    if (!isAll && historyPageOffset >= totalTxnCount) {
        historyPageOffset = Math.max(0, Math.floor((totalTxnCount - 1) / effectiveLimit) * effectiveLimit);
    } else if (isAll) {
        historyPageOffset = 0;
    }

    const pageSlice = isAll ? sortedHistoryList : sortedHistoryList.slice(historyPageOffset, historyPageOffset + effectiveLimit);
    const startNumber = isAll ? 1 : (historyPageOffset + 1);
    const endNumber = isAll ? totalTxnCount : (historyPageOffset + pageSlice.length);

    let html = '';
    pageSlice.forEach(i => {
        const seenStudentIds = new Set();
        const txnStudents = (i.studentIds || [])
            .filter((id) => {
                if (!id || seenStudentIds.has(id)) return false;
                seenStudentIds.add(id);
                return true;
            })
            .map((id) => getStudentById(id))
            .filter(Boolean);
        const primaryStudent = txnStudents[0] || getStudentById(i.sId) || i.fallbackStudent;
        const isDonationRow = i.kind === 'donation';
        if(!primaryStudent && !isDonationRow) return;
        const formatStudentMeta = (student) => `${student.name} (Adm: ${student.adm||'-'}, Class: ${student.class||'-'})`;
        const primaryStudentLabel = isDonationRow
            ? `Donation: ${i.donorName || '-'}`
            : formatStudentMeta(primaryStudent);
        const otherStudentRows = txnStudents.slice(1).map((student) => formatStudentMeta(student));
        const studentCount = isDonationRow ? 1 : (txnStudents.length || i.studentIds?.length || 1);
        const totalLabel = `₹${Number(i.tot || 0).toFixed(0)} (${studentCount})`;
        const hasDescription = Boolean(i.description && String(i.description).trim());
        const descHtml = hasDescription
            ? `<div class="text-[11px] font-normal text-slate-500 truncate max-w-[200px] sm:max-w-[260px] mt-0.5" title="${escapeHtml(i.description)}"><i class="fas fa-comment-dots text-[10px] text-slate-400 mr-1"></i>${escapeHtml(i.description)}</div>`
            : '';
        const actionControlsHtml = !i.canModify
            ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-bold uppercase tracking-wider"><i class="fas fa-lock text-[9px]"></i> View Only</span>`
            : (isDonationRow
                ? `<button type="button" class="donation-edit-btn inline-flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 hover:text-blue-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition cursor-pointer" data-id="${escapeHtml(i.tId.replace('donation:', ''))}" title="Edit Donation" aria-label="Edit Donation"><i class="fas fa-edit text-sm" aria-hidden="true"></i></button><button type="button" class="donation-del-btn inline-flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:text-red-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition cursor-pointer" data-id="${escapeHtml(i.tId.replace('donation:', ''))}" title="Delete Donation" aria-label="Delete Donation"><i class="fas fa-trash text-sm" aria-hidden="true"></i></button>`
                : `<button type="button" class="edit-payment-btn inline-flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 hover:text-blue-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition cursor-pointer" data-sid="${escapeHtml(i.sId || '')}" data-tid="${escapeHtml(i.tId)}" title="Edit Payment" aria-label="Edit Payment"><i class="fas fa-edit text-sm" aria-hidden="true"></i></button><button type="button" class="delete-payment-btn inline-flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:text-red-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition cursor-pointer" data-sid="${escapeHtml(i.sId || '')}" data-tid="${escapeHtml(i.tId)}" title="Delete Payment" aria-label="Delete Payment"><i class="fas fa-trash text-sm" aria-hidden="true"></i></button>`);
        html += `<tr class="bg-white hover:bg-gray-50 transition text-xs sm:text-sm">
            <td class="p-2 sm:p-3 font-medium text-gray-900 tabular-nums">${i.r}</td>
            <td class="p-2 sm:p-3 text-gray-600 tabular-nums">${new Date(i.dt).toLocaleDateString('en-GB')}</td>
            <td class="p-2 sm:p-3 font-medium text-blue-700 max-w-[180px] sm:max-w-[300px]">
                <div class="truncate font-semibold text-slate-900" title="${escapeHtml(primaryStudentLabel)}">${escapeHtml(primaryStudentLabel)}</div>
                ${descHtml}
                ${otherStudentRows.length ? `<span class="text-[10px] text-gray-500 block mt-0.5 sm:mt-1">${otherStudentRows.map((row) => escapeHtml(row)).join('<br>')}</span>` : ''}
            </td>
            <td class="p-2 sm:p-3"><span class="text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border border-blue-100 whitespace-nowrap">${escapeHtml(i.by)}</span></td>
            <td class="p-2 sm:p-3 text-center">
                <button type="button" class="view-history-breakdown-btn inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-semibold ${isDonationRow ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'} transition cursor-pointer shadow-2xs" data-tid="${escapeHtml(i.tId)}" data-sid="${escapeHtml(i.sId || '')}" title="Click to view fee breakdown">
                    <span>${isDonationRow ? 'Donation' : `${i.i.length} ${i.i.length === 1 ? 'Item' : 'Items'}`}</span>
                    <i class="fas fa-list-check text-[10px]"></i>
                </button>
            </td>
            <td class="p-2 sm:p-3 font-bold text-gray-800 tabular-nums">${totalLabel}</td>
            <td class="p-2 sm:p-3 text-center whitespace-nowrap">
                <div class="inline-flex items-center justify-center gap-2 sm:gap-2.5">
                ${actionControlsHtml}
                </div>
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;

    if (infoEl) {
        infoEl.innerHTML = `Showing <span class="text-slate-900 font-extrabold">${startNumber} - ${endNumber}</span> of <span class="text-slate-900 font-extrabold">${totalTxnCount}</span> transactions`;
    }

    const hasPrev = !isAll && historyPageOffset > 0;
    const hasNext = !isAll && (endNumber < totalTxnCount);
    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;
};

document.getElementById('history-staff-filter')?.addEventListener('change', prepareHistoryData);
document.getElementById('history-search-input')?.addEventListener('input', prepareHistoryData);
document.getElementById('history-row-limit')?.addEventListener('change', (e) => {
    const val = e.target.value;
    historyRowLimit = val === 'all' ? 'all' : (parseInt(val, 10) || 25);
    historyPageOffset = 0;
    renderHistoryPage();
});
document.getElementById('history-prev-btn')?.addEventListener('click', () => {
    if (historyRowLimit !== 'all' && historyPageOffset > 0) {
        const effectiveLimit = parseInt(historyRowLimit, 10) || 25;
        historyPageOffset = Math.max(0, historyPageOffset - effectiveLimit);
        renderHistoryPage();
    }
});
document.getElementById('history-next-btn')?.addEventListener('click', () => {
    if (historyRowLimit !== 'all') {
        const effectiveLimit = parseInt(historyRowLimit, 10) || 25;
        if (historyPageOffset + effectiveLimit < sortedHistoryList.length) {
            historyPageOffset += effectiveLimit;
            renderHistoryPage();
        }
    }
});

// History Items Breakdown Modal Logic
const showPaymentHistoryBreakdown = (txnId = '', fallbackStudentId = '') => {
    const modal = document.getElementById('history-items-breakdown-modal');
    const contentEl = document.getElementById('history-breakdown-content');
    const editBtn = document.getElementById('history-breakdown-edit-btn');
    if (!modal || !contentEl) return;

    // Handle Donation entries
    if (txnId.startsWith('donation:')) {
        const donationId = txnId.replace('donation:', '');
        const donation = allDonations.find((d) => d.id === donationId);
        if (!donation) {
            alert('Donation record not found.');
            return;
        }

        const collName = getStaffName(donation.collectedBy, donation.collectedByName);
        const formattedDate = donation.paymentDate ? new Date(donation.paymentDate).toLocaleDateString('en-GB') : '-';
        const amountVal = Number(donation.amount || 0);

        contentEl.innerHTML = `
            <div class="bg-amber-50/80 border border-amber-200 rounded-xl p-3 flex items-center justify-between shadow-2xs">
                <div>
                    <div class="text-[10px] uppercase font-bold text-amber-800 flex items-center gap-1">
                        <i class="fas fa-hand-holding-heart text-[10px]"></i> Donation Receipt
                    </div>
                    <div class="font-black text-amber-950 text-base font-mono">#${escapeHtml(donation.receiptNo ? String(donation.receiptNo) : 'AUTO')}</div>
                </div>
                <div class="text-right">
                    <div class="text-[10px] uppercase font-bold text-amber-800">Total Donated</div>
                    <div class="font-black text-emerald-700 text-lg font-mono">₹${amountVal.toLocaleString('en-IN')}</div>
                </div>
            </div>

            <div class="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-2xs">
                <div class="flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
                    <div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-sm">
                        <i class="fas fa-user-heart"></i>
                    </div>
                    <div>
                        <div class="text-[10px] uppercase font-bold text-slate-400">Donor Name</div>
                        <div class="font-black text-slate-900 text-sm">${escapeHtml(donation.donorName || 'Anonymous Donor')}</div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3 text-xs">
                    <div>
                        <span class="text-[10px] uppercase font-bold text-slate-400 block">Date</span>
                        <span class="font-semibold text-slate-800">${escapeHtml(formattedDate)}</span>
                    </div>
                    <div>
                        <span class="text-[10px] uppercase font-bold text-slate-400 block">Collected By</span>
                        <span class="font-semibold text-slate-800">${escapeHtml(collName || 'Staff')}</span>
                    </div>
                    ${donation.description ? `
                    <div class="col-span-2 pt-2 border-t border-slate-100">
                        <span class="text-[10px] uppercase font-bold text-slate-400 block">Purpose / Note</span>
                        <span class="font-medium text-slate-700 italic block mt-0.5">${escapeHtml(donation.description)}</span>
                    </div>` : ''}
                </div>
            </div>
        `;

        if (editBtn) {
            const canEditDonation = canModifyDonationRecord(donation);
            editBtn.classList.toggle('hidden', !canEditDonation);
            editBtn.onclick = () => {
                if (!canModifyDonationRecord(donation)) {
                    showToast('You can only edit donations that you collected.', 'warn');
                    return;
                }
                closeHistoryBreakdownModal();
                editingDonationId = donation.id;
                document.getElementById('donation-name').value = donation.donorName || '';
                document.getElementById('donation-receipt').value = donation.receiptNo || '';
                document.getElementById('donation-amount').value = donation.amount || '';
                document.getElementById('donation-date').value = donation.paymentDate || new Date().toISOString().split('T')[0];
                document.getElementById('donation-description').value = donation.description || '';
                setupDonationEntryUI();
                activateTab('home-page', 'donation');
            };
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        return;
    }

    // Handle Fee Payments
    const parsedKey = parsePaymentGroupKey(txnId);
    const matchingPayments = allPayments.filter((payment) => {
        if (parsedKey.type === 'transaction') return payment.transactionId === parsedKey.transactionId;
        if (parsedKey.type === 'receipt') return Number(payment.receiptNo) === parsedKey.receiptNo && (payment.collectedBy || '') === parsedKey.collectedBy;
        return getPaymentGroupKey(payment) === txnId;
    });

    if (matchingPayments.length === 0) {
        contentEl.innerHTML = `<div class="p-8 text-center text-slate-500 font-semibold"><i class="fas fa-circle-exclamation text-xl text-amber-500 mb-2 block"></i>No itemized records found for this receipt.</div>`;
        if (editBtn) editBtn.classList.add('hidden');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        return;
    }

    const firstPayment = matchingPayments[0];
    const receiptNo = firstPayment.receiptNo ? `#${firstPayment.receiptNo}` : 'AUTO / N/A';
    const paymentDateStr = firstPayment.paymentDate ? new Date(firstPayment.paymentDate).toLocaleDateString('en-GB') : '-';
    const paymentMode = firstPayment.paymentMode || 'Cash';
    const collectorName = getStaffName(firstPayment.collectedBy, firstPayment.collectedByName);
    const paymentDescription = firstPayment.description || '';

    // Calculate grand total accounting for shared billing groups
    const seenBillingKeys = new Set();
    let grandTotal = 0;
    matchingPayments.forEach((p) => {
        const bKey = getPaymentBillingKey(p);
        if (!seenBillingKeys.has(bKey)) {
            seenBillingKeys.add(bKey);
            grandTotal = roundMoney(grandTotal + getMonthlyReportPaymentAmount(p));
        }
    });

    // Group payments by studentId
    const studentPaymentMap = new Map();
    matchingPayments.forEach((p) => {
        const sid = p.studentId || fallbackStudentId || 'unknown';
        if (!studentPaymentMap.has(sid)) studentPaymentMap.set(sid, []);
        studentPaymentMap.get(sid).push(p);
    });

    const studentCount = studentPaymentMap.size;
    let studentsHtml = '';
    let studentIndex = 0;

    studentPaymentMap.forEach((paymentsForStudent, sId) => {
        studentIndex += 1;
        const student = getStudentById(sId);
        const studentName = student?.name || paymentsForStudent[0]?.studentName || 'Student';
        const studentAdm = student?.adm || paymentsForStudent[0]?.studentAdm || '-';
        const studentClass = student?.class || paymentsForStudent[0]?.classLabel || paymentsForStudent[0]?.studentClass || '-';
        const studentGender = student?.gender || '';
        const group = getStudentBillingGroup(sId);
        const isGroupMember = group && Array.isArray(group.memberIds) && group.memberIds.length > 1;

        // Calculate student's individual items and subtotal
        const stuSeenKeys = new Set();
        let studentSubtotal = 0;
        paymentsForStudent.forEach((p) => {
            const bKey = getPaymentBillingKey(p);
            if (!stuSeenKeys.has(bKey)) {
                stuSeenKeys.add(bKey);
                studentSubtotal = roundMoney(studentSubtotal + getMonthlyReportPaymentAmount(p));
            }
        });

        // Items breakdown table rows
        const itemRows = paymentsForStudent.map((p) => {
            const feeItem = feeItems.find((fi) => fi.key === p.itemKey);
            const rawItemName = feeItem?.name || p.itemName || normalizeFeeItemName(p.itemKey) || p.itemKey;
            const cleanItemName = normalizeFeeItemName(rawItemName);
            const itemType = getPaymentItemType(p);
            const isGroupedMonthly = itemType === 'month' && (
                Boolean(p.billingGroupId)
                || Boolean(p.isGroupPrimary)
                || Boolean(p.isGroupMirror)
                || (Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 1)
            );
            const sharedGroupAmt = getMonthlyReportPaymentAmount(p);
            const isMirrorRow = Boolean(isGroupedMonthly && (p.isGroupMirror || Number(p.amount || 0) === 0));
            const displayAmount = isGroupedMonthly ? sharedGroupAmt : roundMoney(p.amount || 0);

            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition">
                    <td class="py-2.5 px-3 font-medium text-slate-800">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-bold text-slate-800">${escapeHtml(cleanItemName)}</span>
                            <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${itemType === 'month' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-purple-50 text-purple-700 border border-purple-200'}">${itemType === 'month' ? 'Monthly' : 'Custom'}</span>
                            ${isGroupedMonthly ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200" title="Shared under combined group receipt"><i class="fas fa-users text-[8px] mr-0.5"></i>${isMirrorRow ? 'Included (Shared)' : 'Group Primary'}</span>` : ''}
                        </div>
                    </td>
                    <td class="py-2.5 px-2 text-center text-slate-500 font-medium whitespace-nowrap">${escapeHtml(p.academicYear || '-')}</td>
                    <td class="py-2.5 px-3 text-right font-black ${isMirrorRow ? 'text-emerald-700' : 'text-slate-900'} font-mono tabular-nums">${isMirrorRow ? `₹${displayAmount.toFixed(0)} <span class="text-[9px] font-sans font-semibold text-emerald-600">(shared)</span>` : `₹${displayAmount.toFixed(0)}`}</td>
                </tr>
            `;
        }).join('');

        studentsHtml += `
            <div class="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <!-- Student Card Header -->
                <div class="bg-gradient-to-r from-slate-50 to-blue-50/40 p-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            <i class="fas fa-user-graduate"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="font-black text-slate-900 text-xs sm:text-sm truncate flex items-center gap-1.5">
                                <span>${escapeHtml(studentName)}</span>
                                ${isGroupMember ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold shrink-0"><i class="fas fa-users text-[8px] mr-0.5"></i>Group Member</span>` : ''}
                            </div>
                            <div class="text-[10px] text-slate-500 font-medium flex items-center gap-2 mt-0.5 flex-wrap">
                                <span>Adm: <b class="text-slate-700 font-mono">${escapeHtml(studentAdm)}</b></span>
                                <span>•</span>
                                <span>Class: <b class="text-slate-700">${escapeHtml(studentClass)}</b></span>
                                ${studentGender ? `<span>•</span><span class="capitalize text-slate-600">${escapeHtml(studentGender)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <span class="text-[10px] uppercase font-bold text-slate-400 block">${studentCount > 1 ? `Student ${studentIndex} Subtotal` : 'Subtotal'}</span>
                        <span class="font-black text-blue-700 font-mono text-sm">₹${studentSubtotal.toFixed(0)}</span>
                    </div>
                </div>

                <!-- Items Table -->
                <div class="overflow-x-auto">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-slate-50/80 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                            <tr>
                                <th class="py-1.5 px-3">Fee Item</th>
                                <th class="py-1.5 px-2 text-center">Academic Year</th>
                                <th class="py-1.5 px-3 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemRows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });

    const summaryHtml = `
        <div class="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 flex items-center justify-between shadow-2xs">
            <div>
                <div class="text-[10px] uppercase font-bold text-emerald-800 flex items-center gap-1">
                    <i class="fas fa-receipt text-[10px]"></i> Receipt Number
                </div>
                <div class="font-black text-emerald-950 text-base font-mono">${escapeHtml(receiptNo)}</div>
            </div>
            <div class="text-right">
                <div class="text-[10px] uppercase font-bold text-emerald-800">Total Paid</div>
                <div class="font-black text-emerald-700 text-lg font-mono">₹${grandTotal.toFixed(0)}</div>
            </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white border border-slate-200 rounded-xl p-2.5 shadow-2xs">
            <div>
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Payment Date</span>
                <span class="font-bold text-slate-800 text-xs">${escapeHtml(paymentDateStr)}</span>
            </div>
            <div>
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Payment Mode</span>
                <span class="font-bold text-slate-800 text-xs">${escapeHtml(paymentMode)}</span>
            </div>
            <div>
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Students</span>
                <span class="font-bold text-slate-800 text-xs">${studentCount} ${studentCount === 1 ? 'Student' : 'Students'}</span>
            </div>
            <div>
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Collected By</span>
                <span class="font-bold text-slate-800 text-xs truncate block" title="${escapeHtml(collectorName)}">${escapeHtml(collectorName || 'Staff')}</span>
            </div>
            ${paymentDescription ? `
            <div class="col-span-2 sm:col-span-4 pt-1.5 border-t border-slate-100">
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Description:</span>
                <span class="text-slate-700 italic font-medium">${escapeHtml(paymentDescription)}</span>
            </div>` : ''}
        </div>
    `;

    const multiStudentNotice = studentCount > 1 ? `
        <div class="px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold flex items-center gap-2">
            <i class="fas fa-users text-blue-600"></i>
            <span>Combined Multi-Student Receipt (${studentCount} Students Included)</span>
        </div>
    ` : '';

    contentEl.innerHTML = summaryHtml + multiStudentNotice + `<div class="space-y-3">${studentsHtml}</div>`;

    if (editBtn) {
        const primaryStudentId = studentPaymentMap.keys().next().value || fallbackStudentId;
        const canEditPayment = canModifyPaymentRecord(matchingPayments);
        editBtn.classList.toggle('hidden', !canEditPayment);
        editBtn.onclick = () => {
            if (!canModifyPaymentRecord(matchingPayments)) {
                showToast('You can only edit payments that you collected.', 'warn');
                return;
            }
            closeHistoryBreakdownModal();
            startEditingPayment(primaryStudentId, txnId);
        };
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

const closeHistoryBreakdownModal = () => {
    const modal = document.getElementById('history-items-breakdown-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

document.getElementById('history-breakdown-close-x')?.addEventListener('click', closeHistoryBreakdownModal);
document.getElementById('history-breakdown-close-btn')?.addEventListener('click', closeHistoryBreakdownModal);
document.getElementById('history-items-breakdown-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'history-items-breakdown-modal') closeHistoryBreakdownModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('history-items-breakdown-modal');
        if (modal && !modal.classList.contains('hidden')) {
            closeHistoryBreakdownModal();
        }
    }
});

// Event Delegation for dynamically generated history buttons
document.getElementById('history-content-container')?.addEventListener('click', async (e) => {
    const breakdownBtn = e.target.closest('.view-history-breakdown-btn');
    if (breakdownBtn) {
        showPaymentHistoryBreakdown(breakdownBtn.dataset.tid, breakdownBtn.dataset.sid);
        return;
    }
    const editBtn = e.target.closest('.edit-payment-btn'), delBtn = e.target.closest('.delete-payment-btn');
    const donationEditBtn = e.target.closest('.donation-edit-btn');
    const donationDelBtn = e.target.closest('.donation-del-btn');
    if (editBtn) startEditingPayment(editBtn.dataset.sid, editBtn.dataset.tid);
    if (donationEditBtn) {
        const donation = allDonations.find((entry) => entry.id === donationEditBtn.dataset.id);
        if (!donation) return;
        if (!canModifyDonationRecord(donation)) {
            showToast('You can only edit donations that you collected.', 'warn');
            return;
        }
        editingDonationId = donation.id;
        document.getElementById('donation-name').value = donation.donorName || '';
        document.getElementById('donation-receipt').value = donation.receiptNo || '';
        document.getElementById('donation-amount').value = donation.amount || '';
        document.getElementById('donation-date').value = donation.paymentDate || new Date().toISOString().split('T')[0];
        document.getElementById('donation-description').value = donation.description || '';
        setupDonationEntryUI();
        activateTab('home-page', 'donation');
    }
    if (donationDelBtn) {
        const donation = allDonations.find((entry) => entry.id === donationDelBtn.dataset.id);
        if (donation && !canModifyDonationRecord(donation)) {
            showToast('You can only delete donations that you collected.', 'warn');
            return;
        }
        const confirmed = await openConfirmDialog({
            title: 'Delete Donation',
            message: 'Delete this donation entry?',
            okLabel: 'Delete',
            danger: true
        });
        if (!confirmed) return;
        try {
            await deleteDoc(doc(db, `${BASE_PATH}/donations`, donationDelBtn.dataset.id));
            showToast('Donation deleted.', 'info');
        } catch (error) {
            logFirestorePermissionError(error, 'delete', `${BASE_PATH}/donations/${donationDelBtn.dataset.id}`);
            console.error(error);
            showToast('Failed to delete donation: ' + (error.message || 'Permission error'), 'error');
        }
    }
    if (delBtn) {
        const tid = delBtn.dataset.tid;
        const targetGroupPayments = allPayments.filter((p) => getPaymentGroupKey(p) === tid || p.transactionId === tid);
        if (targetGroupPayments.length > 0 && !canModifyPaymentRecord(targetGroupPayments)) {
            showToast('You can only delete payments that you collected.', 'warn');
            return;
        }
        const confirmed = await openConfirmDialog({
            title: 'Delete Payment',
            message: 'Are you sure you want to permanently delete this payment?',
            okLabel: 'Delete',
            danger: true
        });
        if (!confirmed) return;

        const prevHtml = delBtn.innerHTML;
        delBtn.disabled = true;
        delBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            const batch = writeBatch(db);
            const docsToDelete = await collectPaymentDocsForGroup(tid, '');
            if (docsToDelete.length > 0) {
                if (!canModifyPaymentRecord(docsToDelete.map((d) => d.data()))) {
                    throw new Error('You can only delete payments that you collected.');
                }
                await queueExistingPaymentDeletes(batch, docsToDelete, []);
            } else {
                const fallbackMatches = allPayments.filter((p) => getPaymentGroupKey(p) === tid || p.transactionId === tid);
                await queueExistingPaymentDeletes(batch, [], fallbackMatches);
            }
            await batch.commit();
            showToast('Payment deleted successfully.', 'success');
        } catch (err) {
            logFirestorePermissionError(err, 'delete', `${BASE_PATH}/payments`);
            console.error('History delete payment error:', err);
            showToast('Failed to delete payment: ' + (err.message || 'Network error'), 'error');
        } finally {
            delBtn.disabled = false;
            delBtn.innerHTML = prevHtml;
        }
    }
});

const getPaymentMonthKey = (entry) => {
    if (!entry) return '';
    const raw = entry.paymentDate || entry.date || entry.createdAt;
    if (!raw) return '';
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        const match = trimmed.match(/^(\d{4})-(\d{2})/);
        if (match) return `${match[1]}-${match[2]}`;
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }
    } else if (raw instanceof Date) {
        return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}`;
    } else if (typeof raw === 'object' && typeof raw.toDate === 'function') {
        const d = raw.toDate();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return '';
};

const receiptSort = (a, b) => {
    const aNum = Number(a?.receiptNo ?? a ?? 0);
    const bNum = Number(b?.receiptNo ?? b ?? 0);
    const aValid = Number.isFinite(aNum);
    const bValid = Number.isFinite(bNum);
    if (aValid && bValid) return aNum - bNum;
    if (aValid) return -1;
    if (bValid) return 1;
    return String(a?.receiptNo ?? a ?? '').localeCompare(String(b?.receiptNo ?? b ?? ''), undefined, { numeric: true });
};

// --- MONTHLY REPORT RENDER ---
const renderMonthlyCollectedPage = (searchTerm = '') => {
    const cont = document.getElementById('monthly-collected-container'), lowerTerm = searchTerm.toLowerCase(); cont.innerHTML = '';
    const myPays = getVisiblePayments();
    const myDonations = getVisibleDonations();
    const combinedEntries = [...myPays, ...myDonations];
    renderMonthlySummaryCards(combinedEntries.filter((payment) => {
        if (!searchTerm) return true;
        if (payment.entryType === 'donation') {
            return (payment.donorName || '').toLowerCase().includes(lowerTerm)
                || (payment.description || '').toLowerCase().includes(lowerTerm)
                || (payment.receiptNo && payment.receiptNo.toString().includes(lowerTerm));
        }
        const student = getStudentById(payment.studentId);
        return Boolean(student) && (
            student.name.toLowerCase().includes(lowerTerm) ||
            (student.adm && student.adm.toLowerCase().includes(lowerTerm)) ||
            student.class.toLowerCase().includes(lowerTerm) ||
            (payment.receiptNo && payment.receiptNo.toString().includes(lowerTerm))
        );
    }), searchTerm);

    if (searchTerm) {
        const matching = students.filter(s => s.name.toLowerCase().includes(lowerTerm) || (s.adm && s.adm.toLowerCase().includes(lowerTerm)));
        if (matching.length === 1) {
            const s = matching[0], paysByItem = myPays.filter(p => p.studentId === s.id).reduce((acc, p) => { acc[p.itemKey] = p; return acc; }, {});
            let reportText = `NAME   : ${s.name.toUpperCase()}\nCLASS  : ${s.class}\nADM NO : ${s.adm||'-'}\n`;
            let mText = '', cText = '';
            feeItems.forEach(i => { const p = paysByItem[i.key]; if (p) { const rStr = p.receiptNo ? p.receiptNo.toString().padEnd(6,' ') : '-     '; if (i.type === 'month') mText += `RCPT : ${rStr} | ${normalizeFeeItemName(i.name)}\n`; else cText += `RCPT : ${rStr} | ${normalizeFeeItemName(i.name)} (₹${p.amount})\n`; } });
            if (mText) reportText += `\n--- MONTHS ---\n${mText}`; if (cText) reportText += `\n--- OTHER FEES ---\n${cText}`; if (!mText && !cText) reportText += `\nNo data.\n`;
            cont.innerHTML = `<div class="report-card whitespace-pre-wrap text-sm md:text-base bg-gray-50 border border-gray-200 p-4 rounded-xl"><div class="flex justify-between items-start border-b pb-3 mb-3"><h3 class="text-lg font-bold">Student Report</h3><button id="back-to-monthly-view-btn" class="py-1 px-3 bg-gray-200 rounded-lg text-sm font-semibold">Back</button></div><pre class="font-mono">${escapeHtml(reportText)}</pre></div><div class="mt-5 text-center"><button id="share-whatsapp-btn-monthly" data-share-text="${encodeURIComponent('*Student Payment Report*\n-----------------------\n'+reportText)}" class="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 transition text-white font-bold py-3 px-6 rounded-xl shadow-md w-full md:w-auto justify-center"><i class="fab fa-whatsapp text-xl"></i> <span>Share on WhatsApp</span></button></div>`; return;
        } else if (matching.length > 1) {
            cont.innerHTML = `<div class="p-4 bg-gray-50 border rounded-xl"><h3 class="font-bold text-lg mb-1">Search Results</h3><p class="text-sm text-gray-500 mb-4">Click to view report</p><ul class="space-y-2">${matching.map(s => `<li><button class="w-full text-left p-3 rounded-lg bg-white border hover:border-blue-400 font-medium monthly-student-select flex justify-between" data-student-name="${escapeHtml(s.name)}"><span>${escapeHtml(s.name)} <span class="text-gray-500 text-sm font-normal">(${escapeHtml(s.class)})</span></span><span class="text-xs text-gray-400 font-mono">Adm: ${escapeHtml(s.adm||'-')}</span></button></li>`).join('')}</ul></div>`; return;
        }
    }

    const pays = searchTerm
        ? combinedEntries.filter((entry) => {
            if (entry.entryType === 'donation') {
                return (entry.donorName || '').toLowerCase().includes(lowerTerm)
                    || (entry.description || '').toLowerCase().includes(lowerTerm)
                    || (entry.receiptNo && entry.receiptNo.toString().includes(lowerTerm));
            }
            const student = getStudentById(entry.studentId);
            return student && (student.class.toLowerCase().includes(lowerTerm) || (entry.receiptNo && entry.receiptNo.toString().includes(lowerTerm)));
        })
        : combinedEntries;
    const sortedKeys = Object.keys(pays.reduce((a, p) => {
        const mk = getPaymentMonthKey(p);
        if (mk) {
            if (!a[mk]) a[mk] = [];
            a[mk].push(p);
        }
        return a;
    }, {})).sort().reverse();
    if (sortedKeys.length === 0) { cont.innerHTML = buildEmptyState('No monthly report data found for the selected filter.', 'fa-chart-column'); return; }

    const currentMK = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const receiptSort = (a, b) => {
        const aNum = Number(a?.receiptNo ?? a ?? 0);
        const bNum = Number(b?.receiptNo ?? b ?? 0);
        const aValid = Number.isFinite(aNum);
        const bValid = Number.isFinite(bNum);
        if (aValid && bValid) return aNum - bNum;
        if (aValid) return -1;
        if (bValid) return 1;
        return String(a?.receiptNo ?? a ?? '').localeCompare(String(b?.receiptNo ?? b ?? ''), undefined, { numeric: true });
    };

    sortedKeys.forEach(mk => {
        const monthPays = pays.filter(p => getPaymentMonthKey(p) === mk), uTxns = {};
        monthPays.forEach(p => {
            const tid = p.transactionId || p.receiptNo;
            if (!uTxns[tid]) {
                const pt = monthPays.filter(pay => (pay.transactionId || pay.receiptNo) === tid);
                const m = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'month');
                const c = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'custom');
                uTxns[tid] = { m, c };
            }
        });
        const mTot = Object.values(uTxns).reduce((s, d) => s + d.m, 0);
        const cTot = Object.values(uTxns).reduce((s, d) => s + d.c, 0);
        const donationPays = monthPays.filter((entry) => entry.entryType === 'donation');
        const feePays = monthPays.filter((entry) => entry.entryType !== 'donation');
        const mF = feePays.filter((p) => getPaymentItemType(p) === 'month');
        const studentDonationPays = feePays.filter((p) => p.itemKey === STUDENT_DONATION_ITEM_KEY);
        const cF = feePays.filter((p) => getPaymentItemType(p) === 'custom' && p.itemKey !== STUDENT_DONATION_ITEM_KEY);
        const defaultTotal = roundMoney(mTot);
        const donationTotal = roundMoney(donationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
            + studentDonationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        const otherTotal = roundMoney(cTot);
        const grandTotal = roundMoney(defaultTotal + donationTotal + otherTotal);

        let html = `<div class="bg-gray-50 border p-2.5 sm:p-4 rounded-xl"><div class="flex flex-col md:flex-row md:justify-between md:items-center gap-2 sm:gap-3 cursor-pointer month-header"><div><h3 class="text-sm sm:text-base font-bold">${formatMonthLabel(mk)}</h3><p class="text-[11px] sm:text-xs text-gray-500 font-medium mt-0.5 sm:mt-1">${Object.keys(uTxns).length} receipt groups • ${new Set(monthPays.map((payment) => payment.studentId)).size} students</p></div><div class="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-bold tabular-nums"><span class="bg-white px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border">Default: ${formatCurrency(defaultTotal)}</span><span class="bg-emerald-50 text-emerald-700 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border border-emerald-200">Donation: ${formatCurrency(donationTotal)}</span><span class="bg-amber-50 text-amber-700 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border border-amber-200">Other: ${formatCurrency(otherTotal)}</span><span class="bg-indigo-50 text-indigo-700 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border border-indigo-200">Total: ${formatCurrency(grandTotal)}</span><i class="fas fa-chevron-down month-toggle-icon text-gray-400 ${mk === currentMK ? 'rotate-180' : ''} transition ml-auto sm:ml-1"></i></div></div><div class="month-details-container overflow-x-auto mt-2.5 pt-2.5 sm:mt-4 sm:pt-4 border-t ${mk === currentMK ? '' : 'hidden'}">`;
        if (mF.length > 0) {
            const monthlyTxnRows = Object.values(mF.reduce((acc, payment) => {
                const txnKey = payment.transactionId || payment.receiptNo || `tx-${payment.timestamp || Math.random()}`;
                if (!acc[txnKey]) acc[txnKey] = { receiptNo: payment.receiptNo || '-', total: 0, students: {}, seenBilling: new Set() };
                const billingKey = getPaymentBillingKey(payment);
                if (!acc[txnKey].seenBilling.has(billingKey)) {
                    acc[txnKey].seenBilling.add(billingKey);
                    acc[txnKey].total = roundMoney(acc[txnKey].total + getMonthlyReportPaymentAmount(payment));
                }
                const student = getStudentById(payment.studentId) || {};
                acc[txnKey].students[payment.studentId || txnKey] = {
                    name: student.name || payment.studentName || 'Unknown',
                    class: getStudentClassForFeeYear(student, payment.academicYear) || student.class || payment.classLabel || '-',
                    adm: student.adm || payment.studentAdm || '-'
                };
                return acc;
            }, {})).sort(receiptSort);
            html += `<table class="w-full text-xs sm:text-sm text-left mb-3 sm:mb-4 tabular-nums"><thead class="bg-gray-100"><tr><th class="p-1.5 sm:p-2">Rcpt</th><th class="p-1.5 sm:p-2">Students</th><th class="p-1.5 sm:p-2">Amount</th></tr></thead><tbody>${monthlyTxnRows.map((row) => {
                const studentLines = Object.values(row.students).map((student) => `<div class="leading-tight">${escapeHtml(student.name)} <span class="text-[10px] sm:text-[11px] text-gray-500">(${escapeHtml(student.class)} · Adm: ${escapeHtml(student.adm)})</span></div>`).join('');
                return `<tr class="border-b hover:bg-white align-top"><td class="p-1.5 sm:p-2">${row.receiptNo}</td><td class="p-1.5 sm:p-2">${studentLines}</td><td class="p-1.5 sm:p-2 font-semibold">₹${row.total.toFixed(0)}</td></tr>`;
            }).join('')}</tbody></table>`;
        }
        const sortedCustomFees = [...cF].sort(receiptSort);
        if (sortedCustomFees.length > 0) html += `<h4 class="text-xs sm:text-sm font-bold mt-3 sm:mt-4 mb-1.5 sm:mb-2 bg-gray-200 inline-block px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-lg">Other Fees</h4><table class="w-full text-xs sm:text-sm text-left whitespace-nowrap tabular-nums"><thead class="bg-gray-100"><tr><th class="p-1.5 sm:p-2">Rcpt</th><th class="p-1.5 sm:p-2">Student</th><th class="p-1.5 sm:p-2">Item</th><th class="p-1.5 sm:p-2">Amount</th></tr></thead><tbody>` + sortedCustomFees.map(p => `<tr class="border-b hover:bg-white"><td class="p-1.5 sm:p-2">${p.receiptNo||'-'}</td><td class="p-1.5 sm:p-2">${getStudentById(p.studentId)?.name||'Unknown'}</td><td class="p-1.5 sm:p-2">${normalizeFeeItemName(feeItems.find(fi => fi.key === p.itemKey)?.name||p.itemKey)}</td><td class="p-1.5 sm:p-2 font-semibold">₹${Number(p.amount || 0).toFixed(0)}</td></tr>`).join('') + `</tbody><tfoot class="font-bold border-t"><tr><td colspan="3" class="p-1.5 sm:p-2 text-right">Total</td><td class="p-1.5 sm:p-2 text-green-700">₹${otherTotal.toFixed(0)}</td></tr></tfoot></table>`;
        if (donationPays.length > 0 || studentDonationPays.length > 0) {
            const donationRows = [
                ...donationPays.map((entry) => ({
                    receiptNo: entry.receiptNo || '-',
                    name: entry.donorName || '-',
                    description: entry.description || '-',
                    amount: Number(entry.amount || 0),
                    by: getStaffName(entry.collectedBy, entry.collectedByName)
                })),
                ...studentDonationPays.map((entry) => {
                    const student = getStudentById(entry.studentId) || {};
                    return {
                        receiptNo: entry.receiptNo || '-',
                        name: student.name ? `${student.name} (Student)` : 'Student Donation',
                        description: `Class: ${student.class || '-'} · Adm: ${student.adm || '-'}`,
                        amount: Number(entry.amount || 0),
                        by: getStaffName(entry.collectedBy, entry.collectedByName)
                    };
                })
            ];
            const sortedDonationRows = donationRows.sort(receiptSort);
            html += `<h4 class="text-xs sm:text-sm font-bold mt-3 sm:mt-4 mb-1.5 sm:mb-2 bg-emerald-100 text-emerald-700 inline-block px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-lg">Donation</h4><table class="w-full text-xs sm:text-sm text-left whitespace-nowrap tabular-nums"><thead class="bg-emerald-50"><tr><th class="p-1.5 sm:p-2">Rcpt</th><th class="p-1.5 sm:p-2">Name</th><th class="p-1.5 sm:p-2">Description</th><th class="p-1.5 sm:p-2">Amount</th><th class="p-1.5 sm:p-2">Collected By</th></tr></thead><tbody>${sortedDonationRows.map((entry) => `<tr class="border-b hover:bg-white"><td class="p-1.5 sm:p-2">${entry.receiptNo}</td><td class="p-1.5 sm:p-2">${escapeHtml(entry.name)}</td><td class="p-1.5 sm:p-2">${escapeHtml(entry.description)}</td><td class="p-1.5 sm:p-2 font-semibold">₹${entry.amount.toFixed(0)}</td><td class="p-1.5 sm:p-2">${escapeHtml(entry.by)}</td></tr>`).join('')}</tbody><tfoot class="font-bold border-t"><tr><td colspan="3" class="p-1.5 sm:p-2 text-right">Donation Total</td><td class="p-1.5 sm:p-2 text-emerald-700">₹${donationTotal.toFixed(0)}</td><td></td></tr></tfoot></table>`;
        }
        cont.innerHTML += html + `</div></div>`;
    });
};
document.getElementById('monthly-collected-search-input')?.addEventListener('input', e => renderMonthlyCollectedPage(e.target.value));
document.getElementById('monthly-collected-container')?.addEventListener('click', e => {
    const h = e.target.closest('.month-header'), sel = e.target.closest('.monthly-student-select'), back = e.target.closest('#back-to-monthly-view-btn'), share = e.target.closest('#share-whatsapp-btn-monthly');
    if(h) { h.nextElementSibling.classList.toggle('hidden'); h.querySelector('.month-toggle-icon').classList.toggle('rotate-180'); }
    else if(sel) { document.getElementById('monthly-collected-search-input').value = sel.dataset.studentName; renderMonthlyCollectedPage(sel.dataset.studentName); }
    else if(back) { document.getElementById('monthly-collected-search-input').value = ''; renderMonthlyCollectedPage(''); }
    else if(share) window.open(`https://wa.me/?text=${share.dataset.shareText}`, '_blank');
});

const renderCollectorWiseMonthlyPage = () => {
    const container = document.getElementById('collector-wise-monthly-container');
    if (!container) return;
    if (!isCurrentAdmin) {
        container.innerHTML = `<div class="text-sm text-gray-500 bg-gray-50 border rounded-xl p-4">Admin access required.</div>`;
        return;
    }
    const groupedByMonth = [...allPayments, ...allDonations].reduce((acc, payment) => {
        const monthKey = getPaymentMonthKey(payment);
        if (!monthKey) return acc;
        if (!acc[monthKey]) acc[monthKey] = [];
        acc[monthKey].push(payment);
        return acc;
    }, {});
    const monthKeys = Object.keys(groupedByMonth).sort().reverse();
    if (!monthKeys.length) {
        container.innerHTML = buildEmptyState('No collector-wise monthly data available.', 'fa-users');
        return;
    }
    const currentMK = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    container.innerHTML = monthKeys.map((monthKey) => {
        const monthPayments = groupedByMonth[monthKey];
        const collectorRows = Object.values(monthPayments.reduce((acc, payment) => {
            const collectorKey = payment.collectedBy || 'unknown';
            if (!acc[collectorKey]) {
                acc[collectorKey] = {
                    collectorLabel: getStaffName(payment.collectedBy, payment.collectedByName),
                    monthlyDefaultTotal: 0,
                    monthlyOthersTotal: 0
                };
            }
            if (payment.entryType === 'donation') acc[collectorKey].monthlyOthersTotal += Number(payment.amount || 0);
            else {
                if (getPaymentItemType(payment) === 'month') acc[collectorKey].monthlyDefaultTotal += Number(payment.amount || 0);
                else acc[collectorKey].monthlyOthersTotal += Number(payment.amount || 0);
            }
            return acc;
        }, {})).sort((a, b) => (b.monthlyDefaultTotal + b.monthlyOthersTotal) - (a.monthlyDefaultTotal + a.monthlyOthersTotal));
        const monthTotalDefault = collectorRows.reduce((sum, row) => sum + row.monthlyDefaultTotal, 0);
        const monthTotalOthers = collectorRows.reduce((sum, row) => sum + row.monthlyOthersTotal, 0);
        const monthGrandTotal = monthTotalDefault + monthTotalOthers;
        const isExpanded = monthKey === currentMK;
        return `
            <div class="bg-gray-50 border border-gray-200 rounded-xl p-2.5 sm:p-4">
                <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-2 sm:gap-3 cursor-pointer collector-month-header" role="button" tabindex="0" aria-expanded="${isExpanded ? 'true' : 'false'}">
                    <div>
                        <h3 class="font-bold text-sm sm:text-base text-gray-800">${formatMonthLabel(monthKey)}</h3>
                        <p class="text-[11px] sm:text-xs text-gray-500 font-medium mt-0.5">${collectorRows.length} ${collectorRows.length === 1 ? 'collector' : 'collectors'}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-bold tabular-nums">
                        <span class="bg-white px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border border-gray-200 text-gray-700">Default: ${formatCurrency(monthTotalDefault)}</span>
                        <span class="bg-amber-50 text-amber-700 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border border-amber-200">Others: ${formatCurrency(monthTotalOthers)}</span>
                        <span class="bg-indigo-50 text-indigo-700 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border border-indigo-200">Total: ${formatCurrency(monthGrandTotal)}</span>
                        <i class="fas fa-chevron-down collector-month-toggle-icon text-gray-400 ${isExpanded ? 'rotate-180' : ''} transition ml-auto sm:ml-1"></i>
                    </div>
                </div>
                <div class="collector-month-details overflow-x-auto mt-2.5 pt-2.5 sm:mt-4 sm:pt-4 border-t border-gray-200 ${isExpanded ? '' : 'hidden'}">
                    <table class="w-full text-xs sm:text-sm text-left whitespace-nowrap tabular-nums bg-white rounded-lg overflow-hidden">
                        <thead class="bg-gray-100">
                            <tr>
                                <th class="p-1.5 sm:p-2">Collector</th>
                                <th class="p-1.5 sm:p-2 text-right">Default Fee Total</th>
                                <th class="p-1.5 sm:p-2 text-right">Others Fee Total</th>
                                <th class="p-1.5 sm:p-2 text-right">Grand Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${collectorRows.map((row) => `
                                <tr class="border-b hover:bg-gray-50">
                                    <td class="p-1.5 sm:p-2 font-semibold text-gray-800">${escapeHtml(row.collectorLabel)}</td>
                                    <td class="p-1.5 sm:p-2 text-right">${formatCurrency(row.monthlyDefaultTotal)}</td>
                                    <td class="p-1.5 sm:p-2 text-right">${formatCurrency(row.monthlyOthersTotal)}</td>
                                    <td class="p-1.5 sm:p-2 text-right font-bold text-indigo-700">${formatCurrency(row.monthlyDefaultTotal + row.monthlyOthersTotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');
};

const toggleCollectorMonthCard = (headerEl) => {
    if (!headerEl) return;
    const detailsEl = headerEl.nextElementSibling;
    const iconEl = headerEl.querySelector('.collector-month-toggle-icon');
    if (!detailsEl) return;
    const willExpand = detailsEl.classList.contains('hidden');
    detailsEl.classList.toggle('hidden', !willExpand);
    headerEl.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
    iconEl?.classList.toggle('rotate-180', willExpand);
};

document.getElementById('collector-wise-monthly-container')?.addEventListener('click', (e) => {
    const headerEl = e.target.closest('.collector-month-header');
    if (headerEl) toggleCollectorMonthCard(headerEl);
});

document.getElementById('collector-wise-monthly-container')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const headerEl = e.target.closest('.collector-month-header');
    if (headerEl) {
        e.preventDefault();
        toggleCollectorMonthCard(headerEl);
    }
});

window.prepareHistoryData = prepareHistoryData;
window.updateDashboardMetrics = updateDashboardMetrics;
window.renderMonthlyCollectedPage = renderMonthlyCollectedPage;
window.renderCollectorWiseMonthlyPage = renderCollectorWiseMonthlyPage;

// ============================================================================
// --- MONTHLY & COLLECTOR-WISE PDF REPORT EXPORT SUBSYSTEM ---
// ============================================================================
let activeReportExportType = 'monthly';

const normalizeAcademicYearLabel = (label = '') => {
    if (!label) return '';
    const trimmed = String(label).trim();
    const parts = trimmed.split('-');
    if (parts.length === 2) {
        const y1 = parts[0].trim();
        let y2 = parts[1].trim();
        if (y1.length === 4 && y2.length === 2) {
            y2 = y1.substring(0, 2) + y2;
        }
        return `${y1}-${y2}`;
    }
    return trimmed;
};

const getAllReportAcademicYears = () => {
    const yearsSet = new Set();
    const todayAcademicYear = getAcademicYearFromDate(new Date());
    if (todayAcademicYear) yearsSet.add(todayAcademicYear);
    if (currentWorkingAcademicYear) yearsSet.add(currentWorkingAcademicYear);

    (academicYearSettings || []).forEach(y => {
        if (y && y.label && y.status !== 'archived') {
            yearsSet.add(y.label);
        }
    });

    const records = [...(allPayments || []), ...(allDonations || [])];
    records.forEach(r => {
        if (r?.academicYear && typeof r.academicYear === 'string') {
            yearsSet.add(r.academicYear.trim());
        }
    });

    const yearsList = Array.from(yearsSet).filter(Boolean);
    return yearsList.sort((a, b) => {
        const [aStart = 0] = String(a).split('-').map(Number);
        const [bStart = 0] = String(b).split('-').map(Number);
        return bStart - aStart;
    });
};

const getAcademicYearMonthKeys = (yearLabel = '') => {
    const rawYear = yearLabel || getAcademicYearFromDate(new Date()) || currentWorkingAcademicYear || '';
    if (!rawYear) return [];
    const normalized = normalizeAcademicYearLabel(rawYear);
    const parts = normalized.split('-').map(p => Number(p.trim()));
    const y1 = parts[0];
    let y2 = parts[1] || y1;
    if (y2 < 100 && y1 >= 2000) {
        y2 = Math.floor(y1 / 100) * 100 + y2;
    }
    const seq = getAcademicMonthSequence(yearLabel) || getAcademicMonthSequence(normalized);
    const startMonth = (seq && seq.length) ? seq[0] : 5;
    const effectiveSeq = (seq && seq.length) ? seq : [5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];
    return effectiveSeq.map(mIdx => {
        const calYear = (mIdx >= startMonth) ? y1 : y2;
        const calMonth = String(mIdx + 1).padStart(2, '0');
        return `${calYear}-${calMonth}`;
    });
};

const renderReportModalMonths = (yearLabel = '', exportType = '') => {
    const listCont = document.getElementById('report-modal-months-list');
    if (!listCont) return;

    const resolvedType = exportType || activeReportExportType || 'monthly';
    const effectiveYear = yearLabel || getAcademicYearFromDate(new Date()) || currentWorkingAcademicYear || '';

    // 12 months for this academic year in reverse-chronological order (newest month at the top)
    const academicMonths = getAcademicYearMonthKeys(effectiveYear).slice().reverse();

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const hasCurrentMonth = academicMonths.includes(currentMonthKey);

    const records = resolvedType === 'collector'
        ? [...(allPayments || []), ...(allDonations || [])]
        : [...(typeof getVisiblePayments === 'function' ? getVisiblePayments() : (allPayments || [])), ...(typeof getVisibleDonations === 'function' ? getVisibleDonations() : (allDonations || []))];

    if (!academicMonths.length) {
        listCont.innerHTML = '<div class="p-4 text-center text-xs text-slate-400 font-semibold">No months configured for this academic year.</div>';
        return;
    }

    let defaultCheckedKey = hasCurrentMonth ? currentMonthKey : '';
    if (!defaultCheckedKey) {
        const monthWithRecords = academicMonths.find(mk => records.some(r => getPaymentMonthKey(r) === mk));
        defaultCheckedKey = monthWithRecords || academicMonths[0];
    }

    listCont.innerHTML = academicMonths.map((mk) => {
        const isCurrent = (mk === currentMonthKey);
        const isChecked = (mk === defaultCheckedKey);
        const label = formatMonthLabel(mk);
        const count = records.filter(r => getPaymentMonthKey(r) === mk).length;
        const countText = count > 0 ? `${count} record${count > 1 ? 's' : ''}` : 'No records';

        return `
            <label class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 cursor-pointer transition select-none">
                <div class="flex items-center gap-2.5 min-w-0">
                    <input type="checkbox" class="report-month-checkbox rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer" value="${mk}" ${isChecked ? 'checked' : ''}>
                    <span class="font-bold text-slate-800 text-xs">${escapeHtml(label)}</span>
                    ${isCurrent ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">Current</span>' : ''}
                </div>
                <span class="text-[11px] font-medium ${count > 0 ? 'text-blue-600 font-semibold' : 'text-slate-400'}">${countText}</span>
            </label>
        `;
    }).join('');
};

const openReportMonthExportModal = (exportType = '') => {
    const isCollectorTab = !document.getElementById('collector-wise-monthly-page')?.classList.contains('hidden');
    const resolvedType = exportType === 'collector' ? 'collector' : (exportType === 'monthly' ? 'monthly' : (isCollectorTab ? 'collector' : 'monthly'));
    activeReportExportType = resolvedType;

    const modal = document.getElementById('report-month-select-modal');
    if (!modal) {
        console.error('Report month selection modal (#report-month-select-modal) not found in DOM.');
        return;
    }
    modal.dataset.exportType = resolvedType;

    const titleEl = document.getElementById('report-modal-title');
    const subtitleEl = document.getElementById('report-modal-subtitle');
    const submitLabel = document.getElementById('report-modal-submit-label');
    const submitBtn = document.getElementById('report-modal-submit-pdf-btn');
    if (submitBtn) submitBtn.dataset.exportType = resolvedType;

    if (resolvedType === 'collector') {
        if (titleEl) titleEl.textContent = 'Download Collector-wise Report (PDF)';
        if (subtitleEl) subtitleEl.textContent = 'Administrative summary of collections grouped by staff member';
        if (submitLabel) submitLabel.textContent = 'Download Collector PDF';
    } else {
        if (titleEl) titleEl.textContent = 'Download Monthly Report (PDF)';
        if (subtitleEl) subtitleEl.textContent = 'Student collections, fee items, donations & receipts';
        if (submitLabel) submitLabel.textContent = 'Download Monthly PDF';
    }

    const calendarYear = getAcademicYearFromDate(new Date());
    const yearList = getAllReportAcademicYears();
    const defaultYear = (currentWorkingAcademicYear && yearList.includes(currentWorkingAcademicYear))
        ? currentWorkingAcademicYear
        : (calendarYear && yearList.includes(calendarYear))
            ? calendarYear
            : (yearList[0] || currentWorkingAcademicYear || calendarYear || '');

    // Populate Academic Year selector
    const yearSelect = document.getElementById('report-modal-year-select');
    if (yearSelect) {
        populateAcademicYearSelect(yearSelect, yearList, currentWorkingAcademicYear, { selectedValue: defaultYear });

        // Wire change event once
        if (!yearSelect.dataset.wired) {
            yearSelect.dataset.wired = 'true';
            yearSelect.addEventListener('change', () => {
                renderReportModalMonths(yearSelect.value, activeReportExportType);
            });
        }
    }

    // Render months for selected academic year in reverse chronological order
    renderReportModalMonths(defaultYear, resolvedType);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.style.display = 'flex';
};

const closeReportMonthExportModal = () => {
    const modal = document.getElementById('report-month-select-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
};

window.openReportMonthExportModal = openReportMonthExportModal;
window.closeReportMonthExportModal = closeReportMonthExportModal;

const generateMonthlyReportPdf = (selectedMonths = []) => {
    if (!window.jspdf?.jsPDF) {
        showToast('PDF generator is loading, please try again.', 'info');
        return;
    }
    if (!selectedMonths || selectedMonths.length === 0) {
        showToast('Please select at least one month to export.', 'info');
        return;
    }

    const searchTerm = document.getElementById('monthly-collected-search-input')?.value?.trim() || '';
    const lowerTerm = searchTerm.toLowerCase();
    const myPays = getVisiblePayments();
    const myDonations = getVisibleDonations();
    const combinedEntries = [...myPays, ...myDonations].filter((payment) => {
        if (!searchTerm) return true;
        if (payment.entryType === 'donation') {
            return (payment.donorName || '').toLowerCase().includes(lowerTerm)
                || (payment.description || '').toLowerCase().includes(lowerTerm)
                || (payment.receiptNo && String(payment.receiptNo).includes(lowerTerm));
        }
        const student = getStudentById(payment.studentId);
        return Boolean(student) && (
            student.name.toLowerCase().includes(lowerTerm) ||
            (student.adm && student.adm.toLowerCase().includes(lowerTerm)) ||
            student.class.toLowerCase().includes(lowerTerm) ||
            (payment.receiptNo && String(payment.receiptNo).includes(lowerTerm))
        );
    });

    const { jsPDF } = window.jspdf;
    const docPdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = docPdf.internal.pageSize.getWidth();
    const pageHeight = docPdf.internal.pageSize.getHeight();

    const conf = window.institutionConfig || {};
    const instName = conf.appName || document.getElementById('header-title')?.textContent?.trim() || 'Institution Name';
    const place = conf.place || document.getElementById('header-place')?.textContent?.trim() || '';
    const regNo = conf.regNo || document.getElementById('header-regno')?.textContent?.trim() || '';
    const selectedYear = document.getElementById('report-modal-year-select')?.value || currentWorkingAcademicYear || getAcademicYearFromDate(new Date()) || 'Current';
    const subtitleLine = [place, regNo ? `Reg No: ${regNo}` : '', `Academic Year: ${selectedYear}`].filter(Boolean).join(' • ');

    const formatInr = (num) => Math.round(Number(num) || 0).toLocaleString('en-IN');

    const drawHeader = (startY = 32) => {
        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(14);
        docPdf.setTextColor(15, 23, 42);
        docPdf.text(instName.toUpperCase(), pageWidth / 2, startY, { align: 'center' });

        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(9);
        docPdf.setTextColor(100, 116, 139);
        docPdf.text(subtitleLine, pageWidth / 2, startY + 14, { align: 'center' });

        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(11);
        docPdf.setTextColor(30, 41, 59);
        docPdf.text('MONTHLY COLLECTION & REVENUE REPORT', 24, startY + 34);

        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8);
        docPdf.setTextColor(100, 116, 139);
        const periodStr = selectedMonths.length === 1 
            ? `Month: ${formatMonthLabel(selectedMonths[0])}`
            : `Selected Period: ${selectedMonths.length} Months (${formatMonthLabel(selectedMonths[selectedMonths.length - 1])} to ${formatMonthLabel(selectedMonths[0])})`;
        docPdf.text(periodStr, 24, startY + 46);
        docPdf.text(`Generated: ${new Date().toLocaleString('en-GB')}`, pageWidth - 24, startY + 34, { align: 'right' });
        if (searchTerm) {
            docPdf.text(`Filter: "${searchTerm}"`, pageWidth - 24, startY + 46, { align: 'right' });
        }
        return startY + 54;
    };

    let currentY = drawHeader(32);
    const sortedMonths = [...selectedMonths].sort().reverse();

    // Top Consolidated Summary of all selected months (latest months first)
    const summaryRows = [];
    let grandDefault = 0, grandOthers = 0, grandDonations = 0, grandAll = 0, totalRcpts = 0, allStudentsSet = new Set();

    sortedMonths.forEach(mk => {
        const mPays = combinedEntries.filter(p => getPaymentMonthKey(p) === mk);
        const uTxns = {};
        mPays.forEach(p => {
            const tid = p.transactionId || p.receiptNo;
            if (!uTxns[tid]) {
                const pt = mPays.filter(pay => (pay.transactionId || pay.receiptNo) === tid);
                const m = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'month');
                const c = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'custom');
                uTxns[tid] = { m, c };
            }
        });
        const mTot = roundMoney(Object.values(uTxns).reduce((s, d) => s + d.m, 0));
        const cTot = roundMoney(Object.values(uTxns).reduce((s, d) => s + d.c, 0));
        const donationPays = mPays.filter((entry) => entry.entryType === 'donation');
        const feePays = mPays.filter((entry) => entry.entryType !== 'donation');
        const studentDonationPays = feePays.filter((p) => p.itemKey === STUDENT_DONATION_ITEM_KEY);
        const donTot = roundMoney(donationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
            + studentDonationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        const mGrand = roundMoney(mTot + donTot + cTot);
        const rCount = Object.keys(uTxns).length;
        const sCount = new Set(mPays.map(p => p.studentId).filter(Boolean)).size;

        grandDefault += mTot;
        grandOthers += cTot;
        grandDonations += donTot;
        grandAll += mGrand;
        totalRcpts += rCount;
        mPays.forEach(p => { if (p.studentId) allStudentsSet.add(p.studentId); });

        summaryRows.push([
            formatMonthLabel(mk),
            formatInr(mTot),
            formatInr(cTot),
            formatInr(donTot),
            formatInr(mGrand),
            String(rCount),
            String(sCount)
        ]);
    });

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(10.5);
    docPdf.setTextColor(30, 41, 59);
    docPdf.text('CONSOLIDATED SUMMARY (SELECTED PERIOD)', 24, currentY + 4);
    currentY += 12;

    docPdf.autoTable({
        startY: currentY,
        margin: { left: 24, right: 24 },
        head: [['Month', 'Default Fees', 'Other Fees', 'Donations', 'Total Collected', 'Receipts', 'Students']],
        body: summaryRows,
        foot: [[
            'OVERALL GRAND TOTAL',
            formatInr(grandDefault),
            formatInr(grandOthers),
            formatInr(grandDonations),
            formatInr(grandAll),
            String(totalRcpts),
            String(allStudentsSet.size)
        ]],
        styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
        columnStyles: {
            0: { cellWidth: 'auto', minCellWidth: 95, halign: 'left', fontStyle: 'bold' },
            1: { cellWidth: 72, halign: 'right' },
            2: { cellWidth: 72, halign: 'right' },
            3: { cellWidth: 72, halign: 'right' },
            4: { cellWidth: 78, halign: 'right', fontStyle: 'bold' },
            5: { cellWidth: 68, halign: 'right' },
            6: { cellWidth: 68, halign: 'right' }
        },
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell: (data) => {
            if (data.column.index === 0) {
                data.cell.styles.halign = 'left';
            } else {
                data.cell.styles.halign = 'right';
            }
        }
    });

    currentY = docPdf.lastAutoTable.finalY + 18;

    // Render month-by-month breakdowns (newest month first)
    sortedMonths.forEach(mk => {
        const monthPays = combinedEntries.filter(p => getPaymentMonthKey(p) === mk);
        const uTxns = {};
        monthPays.forEach(p => {
            const tid = p.transactionId || p.receiptNo;
            if (!uTxns[tid]) {
                const pt = monthPays.filter(pay => (pay.transactionId || pay.receiptNo) === tid);
                const m = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'month');
                const c = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'custom');
                uTxns[tid] = { m, c };
            }
        });
        const mTot = roundMoney(Object.values(uTxns).reduce((s, d) => s + d.m, 0));
        const cTot = roundMoney(Object.values(uTxns).reduce((s, d) => s + d.c, 0));
        const donationPays = monthPays.filter((entry) => entry.entryType === 'donation');
        const feePays = monthPays.filter((entry) => entry.entryType !== 'donation');
        const mF = feePays.filter((p) => getPaymentItemType(p) === 'month');
        const studentDonationPays = feePays.filter((p) => p.itemKey === STUDENT_DONATION_ITEM_KEY);
        const cF = feePays.filter((p) => getPaymentItemType(p) === 'custom' && p.itemKey !== STUDENT_DONATION_ITEM_KEY);
        const defaultTotal = mTot;
        const donationTotal = roundMoney(donationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
            + studentDonationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        const otherTotal = cTot;
        const grandTotal = roundMoney(defaultTotal + donationTotal + otherTotal);
        const rCount = Object.keys(uTxns).length;
        const sCount = new Set(monthPays.map(p => p.studentId).filter(Boolean)).size;

        if (currentY > pageHeight - 140) {
            docPdf.addPage();
            currentY = drawHeader(32);
        }

        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(11);
        docPdf.setTextColor(30, 41, 59);
        docPdf.text(`MONTH: ${formatMonthLabel(mk).toUpperCase()}`, 24, currentY);

        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8.5);
        docPdf.setTextColor(71, 85, 105);
        const monthStats = `Receipts: ${rCount}  |  Students: ${sCount}  •  Default Fees: ${formatInr(defaultTotal)}  |  Other Fees: ${formatInr(otherTotal)}  |  Donations: ${formatInr(donationTotal)}  |  Month Grand Total: ${formatInr(grandTotal)}`;
        docPdf.text(monthStats, 24, currentY + 12);
        currentY += 18;

        if (monthPays.length === 0) {
            docPdf.setFont('helvetica', 'italic');
            docPdf.setFontSize(8);
            docPdf.setTextColor(148, 163, 184);
            docPdf.text('No payment or donation records recorded for this month.', 24, currentY + 10);
            currentY += 24;
            return;
        }

        // Table 1: Default Monthly Fees
        if (mF.length > 0) {
            const monthlyTxnRows = Object.values(mF.reduce((acc, payment) => {
                const txnKey = payment.transactionId || payment.receiptNo || `tx-${payment.timestamp || Math.random()}`;
                if (!acc[txnKey]) {
                    acc[txnKey] = {
                        receiptNo: payment.receiptNo || '-',
                        total: 0,
                        students: {},
                        seenBilling: new Set(),
                        collector: getStaffName(payment.collectedBy, payment.collectedByName)
                    };
                }
                const billingKey = payment.billingGroupId
                    ? `${txnKey}__${payment.itemKey || ''}__${payment.academicYear || ''}__${payment.billingGroupId}`
                    : '';
                if (!(billingKey && acc[txnKey].seenBilling.has(billingKey))) {
                    acc[txnKey].total = roundMoney(acc[txnKey].total + getMonthlyReportPaymentAmount(payment));
                    if (billingKey) acc[txnKey].seenBilling.add(billingKey);
                }
                const student = getStudentById(payment.studentId) || {};
                acc[txnKey].students[payment.studentId || txnKey] = {
                    name: student.name || 'Unknown',
                    class: student.class || '-',
                    adm: student.adm || '-'
                };
                return acc;
            }, {})).sort(receiptSort);

            const bodyRows = monthlyTxnRows.map(row => {
                const studentsFormatted = Object.values(row.students).map(s => `${s.name} (${s.class} · Adm: ${s.adm})`).join('\n');
                return [
                    row.receiptNo,
                    studentsFormatted,
                    formatInr(row.total),
                    row.collector || '-'
                ];
            });

            docPdf.autoTable({
                startY: currentY,
                margin: { left: 24, right: 24 },
                head: [['Rcpt No', 'Student Details (Name, Class, Adm)', 'Default Fee Amount', 'Collected By']],
                body: bodyRows,
                foot: [['', 'Total Default Fees', formatInr(defaultTotal), '']],
                styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
                columnStyles: {
                    0: { cellWidth: 58, halign: 'center' },
                    1: { cellWidth: 'auto', minCellWidth: 200, halign: 'left' },
                    2: { cellWidth: 115, halign: 'right', fontStyle: 'bold' },
                    3: { cellWidth: 115, halign: 'left' }
                },
                headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
                footStyles: { fillColor: [239, 246, 255], textColor: [30, 58, 138], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                didParseCell: (data) => {
                    if (data.column.index === 0) data.cell.styles.halign = 'center';
                    else if (data.column.index === 2) data.cell.styles.halign = 'right';
                    else data.cell.styles.halign = 'left';
                }
            });
            currentY = docPdf.lastAutoTable.finalY + 10;
        }

        // Table 2: Other Fees
        const sortedCustomFees = [...cF].sort(receiptSort);
        if (sortedCustomFees.length > 0) {
            if (currentY > pageHeight - 90) {
                docPdf.addPage();
                currentY = drawHeader(32);
            }

            const bodyRows = sortedCustomFees.map(p => {
                const s = getStudentById(p.studentId) || {};
                const itemName = normalizeFeeItemName(feeItems.find(fi => fi.key === p.itemKey)?.name || p.itemKey);
                return [
                    p.receiptNo || '-',
                    s.name || 'Unknown',
                    s.class || '-',
                    s.adm || '-',
                    itemName,
                    formatInr(p.amount),
                    getStaffName(p.collectedBy, p.collectedByName)
                ];
            });

            docPdf.autoTable({
                startY: currentY,
                margin: { left: 24, right: 24 },
                head: [['Rcpt No', 'Student Name', 'Class', 'Adm', 'Fee Item', 'Amount', 'Collected By']],
                body: bodyRows,
                foot: [['', 'Total Other Fees', '', '', '', formatInr(otherTotal), '']],
                styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
                columnStyles: {
                    0: { cellWidth: 52, halign: 'center' },
                    1: { cellWidth: 'auto', minCellWidth: 105, halign: 'left' },
                    2: { cellWidth: 48, halign: 'center' },
                    3: { cellWidth: 52, halign: 'center' },
                    4: { cellWidth: 'auto', minCellWidth: 85, halign: 'left' },
                    5: { cellWidth: 80, halign: 'right', fontStyle: 'bold' },
                    6: { cellWidth: 88, halign: 'left' }
                },
                headStyles: { fillColor: [124, 58, 237], textColor: 255, fontStyle: 'bold' },
                footStyles: { fillColor: [245, 243, 255], textColor: [91, 33, 182], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                didParseCell: (data) => {
                    if (data.column.index === 0 || data.column.index === 2 || data.column.index === 3) data.cell.styles.halign = 'center';
                    else if (data.column.index === 5) data.cell.styles.halign = 'right';
                    else data.cell.styles.halign = 'left';
                }
            });
            currentY = docPdf.lastAutoTable.finalY + 10;
        }

        // Table 3: Donations
        if (donationPays.length > 0 || studentDonationPays.length > 0) {
            if (currentY > pageHeight - 90) {
                docPdf.addPage();
                currentY = drawHeader(32);
            }

            const donationRows = [
                ...donationPays.map((entry) => ({
                    receiptNo: entry.receiptNo || '-',
                    name: entry.donorName || '-',
                    description: entry.description || '-',
                    amount: Number(entry.amount || 0),
                    by: getStaffName(entry.collectedBy, entry.collectedByName)
                })),
                ...studentDonationPays.map((entry) => {
                    const student = getStudentById(entry.studentId) || {};
                    return {
                        receiptNo: entry.receiptNo || '-',
                        name: student.name ? `${student.name} (Student)` : 'Student Donation',
                        description: `Class: ${student.class || '-'} · Adm: ${student.adm || '-'}`,
                        amount: Number(entry.amount || 0),
                        by: getStaffName(entry.collectedBy, entry.collectedByName)
                    };
                })
            ].sort(receiptSort);

            const bodyRows = donationRows.map(entry => [
                entry.receiptNo,
                entry.name,
                entry.description,
                formatInr(entry.amount),
                entry.by
            ]);

            docPdf.autoTable({
                startY: currentY,
                margin: { left: 24, right: 24 },
                head: [['Rcpt No', 'Donor / Student Name', 'Description', 'Amount', 'Collected By']],
                body: bodyRows,
                foot: [['', 'Total Donations', '', formatInr(donationTotal), '']],
                styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
                columnStyles: {
                    0: { cellWidth: 52, halign: 'center' },
                    1: { cellWidth: 'auto', minCellWidth: 125, halign: 'left' },
                    2: { cellWidth: 'auto', minCellWidth: 125, halign: 'left' },
                    3: { cellWidth: 95, halign: 'right', fontStyle: 'bold' },
                    4: { cellWidth: 95, halign: 'left' }
                },
                headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
                footStyles: { fillColor: [236, 253, 245], textColor: [6, 95, 70], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                didParseCell: (data) => {
                    if (data.column.index === 0) data.cell.styles.halign = 'center';
                    else if (data.column.index === 3) data.cell.styles.halign = 'right';
                    else data.cell.styles.halign = 'left';
                }
            });
            currentY = docPdf.lastAutoTable.finalY + 14;
        }

        currentY += 8;
    });

    const totalPages = docPdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        docPdf.setPage(i);
        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8);
        docPdf.setTextColor(148, 163, 184);
        docPdf.text(`Page ${i} of ${totalPages}`, pageWidth - 24, pageHeight - 16, { align: 'right' });
    }

    const safeFileSuffix = selectedMonths.length === 1 ? selectedMonths[0] : `Multiple_${selectedMonths.length}_Months`;
    docPdf.save(`Monthly-Collection-Report-${safeFileSuffix}.pdf`);
    showToast('Monthly collection PDF report downloaded successfully.', 'success');
};

const generateCollectorWiseReportPdf = (selectedMonths = []) => {
    if (!window.jspdf?.jsPDF) {
        showToast('PDF generator is loading, please try again.', 'info');
        return;
    }
    if (!selectedMonths || selectedMonths.length === 0) {
        showToast('Please select at least one month to export.', 'info');
        return;
    }

    const allRecords = [...allPayments, ...allDonations];
    const { jsPDF } = window.jspdf;
    const docPdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = docPdf.internal.pageSize.getWidth();
    const pageHeight = docPdf.internal.pageSize.getHeight();

    const conf = window.institutionConfig || {};
    const instName = conf.appName || document.getElementById('header-title')?.textContent?.trim() || 'Institution Name';
    const place = conf.place || document.getElementById('header-place')?.textContent?.trim() || '';
    const regNo = conf.regNo || document.getElementById('header-regno')?.textContent?.trim() || '';
    const selectedYear = document.getElementById('report-modal-year-select')?.value || currentWorkingAcademicYear || getAcademicYearFromDate(new Date()) || 'Current';
    const subtitleLine = [place, regNo ? `Reg No: ${regNo}` : '', `Academic Year: ${selectedYear}`].filter(Boolean).join(' • ');

    const formatInr = (num) => Math.round(Number(num) || 0).toLocaleString('en-IN');

    const drawHeader = (startY = 32) => {
        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(14);
        docPdf.setTextColor(15, 23, 42);
        docPdf.text(instName.toUpperCase(), pageWidth / 2, startY, { align: 'center' });

        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(9);
        docPdf.setTextColor(100, 116, 139);
        docPdf.text(subtitleLine, pageWidth / 2, startY + 14, { align: 'center' });

        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(11);
        docPdf.setTextColor(30, 41, 59);
        docPdf.text('COLLECTOR-WISE MONTHLY COLLECTION TOTAL REPORT', 24, startY + 34);

        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8);
        docPdf.setTextColor(100, 116, 139);
        const periodStr = selectedMonths.length === 1 
            ? `Month: ${formatMonthLabel(selectedMonths[0])}`
            : `Selected Period: ${selectedMonths.length} Months (${formatMonthLabel(selectedMonths[selectedMonths.length - 1])} to ${formatMonthLabel(selectedMonths[0])})`;
        docPdf.text(periodStr, 24, startY + 46);
        docPdf.text(`Generated: ${new Date().toLocaleString('en-GB')}`, pageWidth - 24, startY + 34, { align: 'right' });
        return startY + 54;
    };

    let currentY = drawHeader(32);
    // Sort months reverse-chronological (latest month first)
    const sortedMonths = [...selectedMonths].sort().reverse();

    // If multiple months selected, render Consolidated Collector Breakdown first
    if (sortedMonths.length > 1) {
        const consolidatedMap = {};
        allRecords.forEach(payment => {
            const mk = getPaymentMonthKey(payment);
            if (!mk || !selectedMonths.includes(mk)) return;

            const collectorKey = payment.collectedBy || 'unknown';
            if (!consolidatedMap[collectorKey]) {
                consolidatedMap[collectorKey] = {
                    collectorLabel: getStaffName(payment.collectedBy, payment.collectedByName),
                    defaultTotal: 0,
                    othersTotal: 0
                };
            }
            if (payment.entryType === 'donation') {
                consolidatedMap[collectorKey].othersTotal += Number(payment.amount || 0);
            } else if (getPaymentItemType(payment) === 'month') {
                consolidatedMap[collectorKey].defaultTotal += Number(payment.amount || 0);
            } else {
                consolidatedMap[collectorKey].othersTotal += Number(payment.amount || 0);
            }
        });

        const consolidatedRows = Object.values(consolidatedMap)
            .sort((a, b) => (b.defaultTotal + b.othersTotal) - (a.defaultTotal + a.othersTotal));

        const grandDefault = consolidatedRows.reduce((sum, r) => sum + r.defaultTotal, 0);
        const grandOthers = consolidatedRows.reduce((sum, r) => sum + r.othersTotal, 0);
        const grandAll = grandDefault + grandOthers;

        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(10.5);
        docPdf.setTextColor(30, 41, 59);
        docPdf.text('CONSOLIDATED COLLECTOR TOTALS (SELECTED PERIOD)', 24, currentY + 4);
        currentY += 12;

        const bodyRows = consolidatedRows.map((r, i) => [
            String(i + 1),
            r.collectorLabel,
            formatInr(r.defaultTotal),
            formatInr(r.othersTotal),
            formatInr(r.defaultTotal + r.othersTotal)
        ]);

        docPdf.autoTable({
            startY: currentY,
            margin: { left: 24, right: 24 },
            head: [['Sl No', 'Collector Name', 'Default Fee Total', 'Others Fee Total', 'Grand Total']],
            body: bodyRows,
            foot: [['', 'GRAND TOTAL', formatInr(grandDefault), formatInr(grandOthers), formatInr(grandAll)]],
            styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 42, halign: 'center' },
                1: { cellWidth: 'auto', minCellWidth: 140, halign: 'left', fontStyle: 'bold' },
                2: { cellWidth: 110, halign: 'right' },
                3: { cellWidth: 110, halign: 'right' },
                4: { cellWidth: 110, halign: 'right', fontStyle: 'bold' }
            },
            headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
            footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didParseCell: (data) => {
                if (data.column.index === 0) {
                    data.cell.styles.halign = 'center';
                } else if (data.column.index === 1) {
                    data.cell.styles.halign = 'left';
                } else {
                    data.cell.styles.halign = 'right';
                }
            }
        });

        currentY = docPdf.lastAutoTable.finalY + 18;
    }

    // Month-by-Month collector tables (reverse-chronological order)
    sortedMonths.forEach(mk => {
        const monthPayments = allRecords.filter(p => getPaymentMonthKey(p) === mk);
        const collectorRows = Object.values(monthPayments.reduce((acc, payment) => {
            const collectorKey = payment.collectedBy || 'unknown';
            if (!acc[collectorKey]) {
                acc[collectorKey] = {
                    collectorLabel: getStaffName(payment.collectedBy, payment.collectedByName),
                    monthlyDefaultTotal: 0,
                    monthlyOthersTotal: 0
                };
            }
            if (payment.entryType === 'donation') {
                acc[collectorKey].monthlyOthersTotal += Number(payment.amount || 0);
            } else if (getPaymentItemType(payment) === 'month') {
                acc[collectorKey].monthlyDefaultTotal += Number(payment.amount || 0);
            } else {
                acc[collectorKey].monthlyOthersTotal += Number(payment.amount || 0);
            }
            return acc;
        }, {})).sort((a, b) => (b.monthlyDefaultTotal + b.monthlyOthersTotal) - (a.monthlyDefaultTotal + a.monthlyOthersTotal));

        const monthTotalDefault = collectorRows.reduce((sum, row) => sum + row.monthlyDefaultTotal, 0);
        const monthTotalOthers = collectorRows.reduce((sum, row) => sum + row.monthlyOthersTotal, 0);
        const monthGrandTotal = monthTotalDefault + monthTotalOthers;

        if (currentY > pageHeight - 120) {
            docPdf.addPage();
            currentY = drawHeader(32);
        }

        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(10.5);
        docPdf.setTextColor(30, 41, 59);
        docPdf.text(`MONTH: ${formatMonthLabel(mk).toUpperCase()}`, 24, currentY);

        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8.5);
        docPdf.setTextColor(71, 85, 105);
        docPdf.text(`Default Fee: ${formatInr(monthTotalDefault)}  |  Others Fee: ${formatInr(monthTotalOthers)}  |  Grand Total: ${formatInr(monthGrandTotal)}`, 24, currentY + 12);
        currentY += 18;

        if (collectorRows.length === 0) {
            docPdf.setFont('helvetica', 'italic');
            docPdf.setFontSize(8);
            docPdf.setTextColor(148, 163, 184);
            docPdf.text('No collector records for this month.', 24, currentY + 10);
            currentY += 24;
            return;
        }

        const bodyRows = collectorRows.map((r, i) => [
            String(i + 1),
            r.collectorLabel,
            formatInr(r.monthlyDefaultTotal),
            formatInr(r.monthlyOthersTotal),
            formatInr(r.monthlyDefaultTotal + r.monthlyOthersTotal)
        ]);

        docPdf.autoTable({
            startY: currentY,
            margin: { left: 24, right: 24 },
            head: [['Sl No', 'Collector Name', 'Default Fee Total', 'Others Fee Total', 'Grand Total']],
            body: bodyRows,
            foot: [['', 'GRAND TOTAL', formatInr(monthTotalDefault), formatInr(monthTotalOthers), formatInr(monthGrandTotal)]],
            styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 42, halign: 'center' },
                1: { cellWidth: 'auto', minCellWidth: 140, halign: 'left', fontStyle: 'bold' },
                2: { cellWidth: 110, halign: 'right' },
                3: { cellWidth: 110, halign: 'right' },
                4: { cellWidth: 110, halign: 'right', fontStyle: 'bold' }
            },
            headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
            footStyles: { fillColor: [238, 242, 255], textColor: [49, 46, 129], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didParseCell: (data) => {
                if (data.column.index === 0) {
                    data.cell.styles.halign = 'center';
                } else if (data.column.index === 1) {
                    data.cell.styles.halign = 'left';
                } else {
                    data.cell.styles.halign = 'right';
                }
            }
        });

        currentY = docPdf.lastAutoTable.finalY + 16;
    });

    const totalPages = docPdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        docPdf.setPage(i);
        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8);
        docPdf.setTextColor(148, 163, 184);
        docPdf.text(`Page ${i} of ${totalPages}`, pageWidth - 24, pageHeight - 16, { align: 'right' });
    }

    const safeFileSuffix = selectedMonths.length === 1 ? selectedMonths[0] : `Multiple_${selectedMonths.length}_Months`;
    docPdf.save(`Collector-Wise-Monthly-Report-${safeFileSuffix}.pdf`);
    showToast('Collector-wise monthly PDF report downloaded successfully.', 'success');
};

// Wire Report PDF Modal Event Listeners
document.getElementById('monthly-report-download-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openReportMonthExportModal('monthly');
});
document.getElementById('collector-wise-download-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openReportMonthExportModal('collector');
});

// Document-level delegated click handling for bulletproof activation
document.addEventListener('click', (e) => {
    const monthlyBtn = e.target.closest('#monthly-report-download-btn');
    if (monthlyBtn) {
        e.preventDefault();
        openReportMonthExportModal('monthly');
        return;
    }
    const collectorBtn = e.target.closest('#collector-wise-download-btn');
    if (collectorBtn) {
        e.preventDefault();
        openReportMonthExportModal('collector');
        return;
    }
});

document.getElementById('report-modal-close-x')?.addEventListener('click', closeReportMonthExportModal);
document.getElementById('report-modal-cancel-btn')?.addEventListener('click', closeReportMonthExportModal);

document.getElementById('report-modal-current-month-btn')?.addEventListener('click', () => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetAcademicYear = getAcademicYearFromDate(now);
    const yearSelect = document.getElementById('report-modal-year-select');

    let checkboxes = Array.from(document.querySelectorAll('.report-month-checkbox'));
    let hasCurrent = checkboxes.some(cb => cb.value === currentMonthKey);

    if (!hasCurrent && yearSelect && targetAcademicYear && yearSelect.value !== targetAcademicYear) {
        if (Array.from(yearSelect.options).some(opt => opt.value === targetAcademicYear)) {
            yearSelect.value = targetAcademicYear;
        }
        renderReportModalMonths(yearSelect.value, activeReportExportType);
        checkboxes = Array.from(document.querySelectorAll('.report-month-checkbox'));
        hasCurrent = checkboxes.some(cb => cb.value === currentMonthKey);
    }

    checkboxes.forEach((cb, idx) => {
        if (hasCurrent) {
            cb.checked = (cb.value === currentMonthKey);
        } else {
            cb.checked = (idx === 0);
        }
    });
});

document.getElementById('report-modal-select-all-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.report-month-checkbox').forEach(cb => {
        cb.checked = true;
    });
});

document.getElementById('report-modal-clear-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.report-month-checkbox').forEach(cb => {
        cb.checked = false;
    });
});

document.getElementById('report-month-select-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'report-month-select-modal') closeReportMonthExportModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('report-month-select-modal');
        if (modal && !modal.classList.contains('hidden')) {
            closeReportMonthExportModal();
        }
    }
});

document.getElementById('report-modal-submit-pdf-btn')?.addEventListener('click', () => {
    const checkedBoxes = Array.from(document.querySelectorAll('.report-month-checkbox:checked'));
    const selectedMonths = checkedBoxes.map(cb => cb.value);

    if (selectedMonths.length === 0) {
        showToast('Please select at least one month to export.', 'warning');
        return;
    }

    const modal = document.getElementById('report-month-select-modal');
    const submitBtn = document.getElementById('report-modal-submit-pdf-btn');
    const isCollectorTab = !document.getElementById('collector-wise-monthly-page')?.classList.contains('hidden');
    const finalType = submitBtn?.dataset?.exportType || modal?.dataset?.exportType || activeReportExportType || (isCollectorTab ? 'collector' : 'monthly');

    closeReportMonthExportModal();

    if (finalType === 'collector') {
        generateCollectorWiseReportPdf(selectedMonths);
    } else {
        generateMonthlyReportPdf(selectedMonths);
    }
});

// --- STUDENTS INFO RENDER ---
let stuInfoPageOffset = 0;

const renderStudentInfoList = () => {
    const classSelect = document.getElementById('stu-info-class');
    const sortSelect = document.getElementById('stu-info-sort');
    const genderSelect = document.getElementById('stu-info-gender');
    const rowLimitSelect = document.getElementById('stu-info-row-limit');
    const searchInput = document.getElementById('stu-info-search');

    const fCls = classSelect ? classSelect.value : '';
    const fSort = sortSelect ? sortSelect.value : 'boys-first';
    const fGen = genderSelect ? genderSelect.value : 'all';
    const rowLimitRaw = rowLimitSelect ? rowLimitSelect.value : '25';
    const sTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const cont = document.getElementById('stu-info-container');
    const emptyState = document.getElementById('stu-info-empty');
    const statsBar = document.getElementById('stu-info-stats-bar');
    const tbody = document.getElementById('stu-info-table-body');
    const paginationEl = document.getElementById('stu-info-pagination');

    const resetPagination = () => {
        if (paginationEl) {
            paginationEl.className = 'hidden';
            paginationEl.innerHTML = '';
        }
    };

    if (!fCls) {
        if (emptyState) {
            emptyState.innerHTML = (!isMasterSuperAdmin() && (!selectedDutyClasses || !selectedDutyClasses.length))
                ? '<div class="p-4 text-center text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg border border-amber-200"><i class="fas fa-exclamation-circle mr-1"></i> No duty classes assigned to your account. Please ask the administrator to assign classes in Staff Management.</div>'
                : '<i class="fas fa-user-graduate text-3xl mb-2 text-slate-300"></i><p>Please choose a class or &ldquo;All Classes&rdquo; above to view the student list.</p>';
            emptyState.classList.remove('hidden');
        }
        if (cont) cont.classList.add('hidden');
        resetPagination();
        return;
    }

    if (!isMasterSuperAdmin() && (!selectedDutyClasses || !selectedDutyClasses.length || (fCls !== 'all' && !isClassInDutyScope(fCls, selectedDutyClasses)))) {
        if (emptyState) {
            emptyState.innerHTML = fCls === 'all'
                ? '<div class="p-4 text-center text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg border border-amber-200"><i class="fas fa-exclamation-circle mr-1"></i> No duty classes assigned to your account. Please ask the administrator to assign classes in Staff Management.</div>'
                : `<div class="p-4 text-center text-xs font-semibold text-rose-700 bg-rose-50 rounded-lg border border-rose-200"><i class="fas fa-ban mr-1"></i> You do not have permission to view Class "${escapeHtml(fCls)}". Only assigned duty classes are accessible.</div>`;
            emptyState.classList.remove('hidden');
        }
        if (cont) cont.classList.add('hidden');
        resetPagination();
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (cont) cont.classList.remove('hidden');

    // Base students in selected class or all accessible classes
    const classStudents = fCls === 'all'
        ? (isMasterSuperAdmin() ? students : students.filter((s) => isClassInDutyScope(s.class, selectedDutyClasses)))
        : students.filter((s) => s.class === fCls);

    const totalInClass = classStudents.length;
    const totalBoysInClass = classStudents.filter((s) => {
        const g = String(s.gender || '').toLowerCase();
        return g === 'male' || g === 'boy';
    }).length;
    const totalGirlsInClass = classStudents.filter((s) => {
        const g = String(s.gender || '').toLowerCase();
        return g === 'female' || g === 'girl';
    }).length;

    // Apply gender and search filter
    let fil = classStudents.filter((s) => {
        if (fGen !== 'all') {
            const g = String(s.gender || '').toLowerCase();
            if (fGen === 'Male' && g !== 'male' && g !== 'boy') return false;
            if (fGen === 'Female' && g !== 'female' && g !== 'girl') return false;
        }
        if (sTerm) {
            const prof = (s.profile && typeof s.profile === 'object') ? s.profile : {};
            const matchName = String(s.name || '').toLowerCase().includes(sTerm);
            const matchAdm = String(s.adm || prof.admNo || '').toLowerCase().includes(sTerm);
            const matchGuardian = String(s.guardian || s.father || prof.father || s.mother || prof.mother || '').toLowerCase().includes(sTerm);
            const matchPhone = String(s.mobile || s.phone || prof.mobile || prof.fatherMobile || prof.motherMobile || '').toLowerCase().includes(sTerm);
            const matchClass = String(s.class || '').toLowerCase().includes(sTerm);
            if (!matchName && !matchAdm && !matchGuardian && !matchPhone && !matchClass) return false;
        }
        return true;
    });

    // Render Stats Bar
    const scopeLabel = fCls === 'all' ? 'All Classes' : `Class: ${escapeHtml(fCls)}`;
    if (statsBar) {
        statsBar.innerHTML = `
            <div class="flex items-center gap-1.5 sm:gap-2">
                <span class="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-blue-600 inline-block"></span>
                <span class="text-xs sm:text-sm font-black text-gray-800">${scopeLabel}</span>
                ${(sTerm || fGen !== 'all') ? `<span class="text-[11px] sm:text-xs text-gray-500 font-medium">(Showing ${fil.length} of ${totalInClass})</span>` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-bold tabular-nums">
                <span class="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200">
                    <i class="fas fa-users text-slate-500 text-[10px]"></i> Total: <b>${totalInClass}</b>
                </span>
                <span class="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                    <i class="fas fa-mars text-blue-500 text-[10px]"></i> Boys: <b>${totalBoysInClass}</b>
                </span>
                <span class="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg bg-pink-50 text-pink-700 border border-pink-200">
                    <i class="fas fa-venus text-pink-500 text-[10px]"></i> Girls: <b>${totalGirlsInClass}</b>
                </span>
            </div>
        `;
    }

    // Sorting Helper
    const compareAdmNo = (a, b, asc = true) => {
        const aVal = String(a.adm || a.profile?.admNo || '').trim();
        const bVal = String(b.adm || b.profile?.admNo || '').trim();
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        const aIsNum = !isNaN(aNum) && aVal !== '';
        const bIsNum = !isNaN(bNum) && bVal !== '';
        if (aIsNum && bIsNum) {
            return asc ? aNum - bNum : bNum - aNum;
        }
        return asc
            ? aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' })
            : bVal.localeCompare(aVal, undefined, { numeric: true, sensitivity: 'base' });
    };

    fil.sort((a, b) => {
        if (fSort === 'boys-first') {
            if (fCls === 'all') {
                const clsCmp = compareClassLabelsNatural(a.class || '', b.class || '');
                if (clsCmp !== 0) return clsCmp;
            }
            const genA = String(a.gender || '').toLowerCase();
            const genB = String(b.gender || '').toLowerCase();
            const rankA = (genA === 'male' || genA === 'boy') ? 1 : ((genA === 'female' || genA === 'girl') ? 2 : 3);
            const rankB = (genB === 'male' || genB === 'boy') ? 1 : ((genB === 'female' || genB === 'girl') ? 2 : 3);
            if (rankA !== rankB) return rankA - rankB;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        }
        if (fSort === 'girls-first') {
            if (fCls === 'all') {
                const clsCmp = compareClassLabelsNatural(a.class || '', b.class || '');
                if (clsCmp !== 0) return clsCmp;
            }
            const genA = String(a.gender || '').toLowerCase();
            const genB = String(b.gender || '').toLowerCase();
            const rankA = (genA === 'female' || genA === 'girl') ? 1 : ((genA === 'male' || genA === 'boy') ? 2 : 3);
            const rankB = (genB === 'female' || genB === 'girl') ? 1 : ((genB === 'male' || genB === 'boy') ? 2 : 3);
            if (rankA !== rankB) return rankA - rankB;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        }
        if (fSort === 'name-asc') {
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        }
        if (fSort === 'name-desc') {
            return String(b.name || '').localeCompare(String(a.name || ''), undefined, { sensitivity: 'base' });
        }
        if (fSort === 'adm-asc') {
            return compareAdmNo(a, b, true);
        }
        if (fSort === 'adm-desc') {
            return compareAdmNo(a, b, false);
        }
        return compareClassLabelsNatural(a.class || '', b.class || '');
    });

    if (!tbody) return;

    if (fil.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-10 px-4 text-gray-500 font-medium">
                    <i class="fas fa-search text-gray-300 text-2xl mb-2 block"></i>
                    No students matched the criteria${fCls === 'all' ? '' : ` in ${escapeHtml(fCls)}`}.
                </td>
            </tr>
        `;
        resetPagination();
        return;
    }

    const totalFiltered = fil.length;
    const isAllRows = rowLimitRaw === 'all';
    const rowLimit = isAllRows ? totalFiltered : (parseInt(rowLimitRaw, 10) || 25);
    if (isAllRows) {
        stuInfoPageOffset = 0;
    } else if (stuInfoPageOffset >= totalFiltered) {
        stuInfoPageOffset = Math.max(0, Math.floor(Math.max(0, totalFiltered - 1) / rowLimit) * rowLimit);
    }

    const sliceStart = isAllRows ? 0 : stuInfoPageOffset;
    const sliceEnd = isAllRows ? totalFiltered : Math.min(totalFiltered, sliceStart + rowLimit);
    const visibleStudents = fil.slice(sliceStart, sliceEnd);

    tbody.innerHTML = visibleStudents.map((s, idx) => {
        const prof = (s.profile && typeof s.profile === 'object') ? s.profile : {};
        const admNo = s.adm || prof.admNo || '-';
        const guardian = s.guardian || s.father || prof.father || s.mother || prof.mother || '-';
        const phone = s.mobile || s.phone || prof.mobile || prof.fatherMobile || prof.motherMobile || '';
        const genderLower = String(s.gender || '').toLowerCase();
        const isMale = genderLower === 'male' || genderLower === 'boy';
        const isFemale = genderLower === 'female' || genderLower === 'girl';
        const genderBadge = isMale
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200"><i class="fas fa-mars text-[9px]"></i> Male</span>`
            : isFemale
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-pink-50 text-pink-700 border border-pink-200"><i class="fas fa-venus text-[9px]"></i> Female</span>`
                : `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600 border border-gray-200">${escapeHtml(s.gender || '-')}</span>`;

        return `
            <tr class="hover:bg-blue-50/40 transition">
                <td class="py-2 sm:py-3 px-2 sm:px-3 text-center text-xs font-mono font-bold text-gray-400 tabular-nums">${sliceStart + idx + 1}</td>
                <td class="py-2 sm:py-3 px-2 sm:px-3 whitespace-nowrap">
                    <span class="font-mono text-[11px] sm:text-xs font-extrabold text-slate-700 bg-slate-100 px-1.5 sm:px-2 py-0.5 rounded border border-slate-200">${escapeHtml(admNo)}</span>
                </td>
                <td class="py-2 sm:py-3 px-2.5 sm:px-4 font-bold text-gray-900">
                    <div class="hover:text-blue-600 cursor-pointer inline-flex items-center gap-1.5" onclick="window.openStudentProfile('${escapeHtml(s.id)}')">
                        <span>${escapeHtml(s.name || '-')}</span>
                        ${String(s.status || '').toLowerCase() === 'discontinued' ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-rose-100 text-rose-700 border border-rose-200">Discontinued</span>` : ''}
                    </div>
                </td>
                <td class="py-2 sm:py-3 px-2 sm:px-3 whitespace-nowrap font-medium text-gray-600">${escapeHtml(s.class || '-')}</td>
                <td class="py-2 sm:py-3 px-2 sm:px-3 text-center whitespace-nowrap">${genderBadge}</td>
                <td class="py-2 sm:py-3 px-2 sm:px-3 whitespace-nowrap text-xs text-gray-600 font-medium">${escapeHtml(guardian)}</td>
                <td class="py-2 sm:py-3 px-2 sm:px-3 whitespace-nowrap text-xs font-mono">
                    ${phone ? `<a href="tel:${escapeHtml(phone)}" class="text-blue-600 hover:text-blue-800 hover:underline font-bold inline-flex items-center gap-1"><i class="fas fa-phone text-[10px] text-emerald-600"></i> ${escapeHtml(phone)}</a>` : '<span class="text-gray-400">-</span>'}
                </td>
                <td class="py-2 sm:py-3 px-2 sm:px-3 text-center whitespace-nowrap">
                    <button type="button" onclick="window.openStudentProfile('${escapeHtml(s.id)}')" class="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white text-[11px] sm:text-xs font-bold border border-blue-200 transition shadow-2xs cursor-pointer" title="View Full Profile">
                        <i class="fas fa-id-card text-[11px]"></i>
                        <span>Profile</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    if (paginationEl) {
        if (!isAllRows) {
            const hasPrev = sliceStart > 0;
            const hasNext = sliceEnd < totalFiltered;
            paginationEl.className = 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 py-2 sm:py-3 border-t border-slate-200 bg-slate-50/70 text-[11px] sm:text-xs';
            paginationEl.innerHTML = `
                <span class="font-semibold text-slate-600">Showing <b class="text-slate-900">${sliceStart + 1} - ${sliceEnd}</b> of <b class="text-slate-900">${totalFiltered}</b> students</span>
                <div class="flex items-center gap-2">
                    <button type="button" id="stu-info-prev-btn" class="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" ${hasPrev ? '' : 'disabled'}>
                        <i class="fas fa-chevron-left mr-1 text-[10px]"></i> Previous
                    </button>
                    <button type="button" id="stu-info-next-btn" class="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" ${hasNext ? '' : 'disabled'}>
                        Next <i class="fas fa-chevron-right ml-1 text-[10px]"></i>
                    </button>
                </div>
            `;
            document.getElementById('stu-info-prev-btn')?.addEventListener('click', () => {
                stuInfoPageOffset = Math.max(0, sliceStart - rowLimit);
                renderStudentInfoList();
            });
            document.getElementById('stu-info-next-btn')?.addEventListener('click', () => {
                if (sliceEnd < totalFiltered) {
                    stuInfoPageOffset = sliceEnd;
                    renderStudentInfoList();
                }
            });
        } else {
            paginationEl.className = 'flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 border-t border-slate-200 bg-slate-50/70 text-[11px] sm:text-xs';
            paginationEl.innerHTML = `<span class="font-semibold text-slate-600">Showing all <b class="text-slate-900">${totalFiltered}</b> students</span>`;
        }
    }
};

const handleStudentInfoFilterChange = () => {
    stuInfoPageOffset = 0;
    renderStudentInfoList();
};

document.getElementById('stu-info-class')?.addEventListener('change', handleStudentInfoFilterChange);
document.getElementById('stu-info-sort')?.addEventListener('change', handleStudentInfoFilterChange);
document.getElementById('stu-info-gender')?.addEventListener('change', handleStudentInfoFilterChange);
document.getElementById('stu-info-row-limit')?.addEventListener('change', handleStudentInfoFilterChange);
document.getElementById('stu-info-search')?.addEventListener('input', handleStudentInfoFilterChange);


// Initialize finance module & tabs after all module-level const/let handlers and state are initialized (prevents TDZ ReferenceErrors)
initFinanceManagementModule({
    getStudents: () => (Array.isArray(students) ? students : []),
    getRawStudents: () => (Array.isArray(allStudentsRaw) ? allStudentsRaw : []),
    getClasses: () => (Array.isArray(classes) ? classes : []),
    getDutyClasses: () => (isMasterSuperAdmin() ? (Array.isArray(classes) ? classes : []) : getClassOptionsForCollector()),
    getRawDutyClasses: () => (isMasterSuperAdmin() ? (Array.isArray(classes) ? classes : []) : (Array.isArray(selectedDutyClasses) ? selectedDutyClasses : [])),
    isAdmin: () => isMasterSuperAdmin(),
    isClassInDutyScope: (clsName = '') => isMasterSuperAdmin() || isClassInDutyScope(clsName, selectedDutyClasses),
    getStudentGroups: () => (Array.isArray(studentGroups) ? studentGroups : []),
    getFeeItems: () => (Array.isArray(feeItems) ? feeItems : []),
    getDefaultFee: () => defaultFee,
    isDefaultMonthlyFeeEnabled: () => defaultMonthlyFeeEnabled !== false,
    getAcademicYear: () => currentWorkingAcademicYear || selectedFeeAcademicYear || '',
    getUserEmail: () => getEffectiveStaffEmail() || currentUserEmail || '',
    getCollectorKey: () => getCollectorKey(),
    getCollectorName: () => getCurrentCollectorName(),
    getUserUid: () => auth?.currentUser?.uid || '',
    getStaffRecord: () => findCurrentStaffMember(allStaff)
});

const initialTabId = getInitialActiveTab();
activateTab(initialTabId);
applyTabVisibilityPreferences();
readTabPrefsFromCloud().then((cloudPrefs) => {
    if (!cloudPrefs) return;
    writeTabPrefsToLocal(cloudPrefs);
    applyTabVisibilityPreferences();
});

// --- INIT LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = getPageUrl('index.html');
        return;
    }
    const tenantCheck = await ensureTenantStatusAndAccess({
        db,
        requiredPage: 'collection',
        institutionId: INSTITUTION_ID,
        liveWatch: true
    });
    if (!tenantCheck?.active) {
        hideLoader();
        return;
    }
    hideLoader();
    const staffAccess = window.AppSession?.getStaffAccess?.() || null;
    const officialSession = getOfficialSession();
    const isDirectoryCollector = staffAccess?.source === 'directory';
    const isStaffSession = Boolean(staffAccess || (officialSession && officialSession.source === 'staff'));

    currentUserEmail = getEffectiveStaffEmail();
    currentCollectorKey = getCollectorKey();
    setupDonationEntryUI();
    selectedDutyClasses = [];
    collectorPaymentDetails = { accountName: '', upiNumber: '', upiId: '' };
    if (currentUserEmail) {
        selectedDutyClasses = resolveStaffDutyClasses(null);
        const savedDutyPayment = readDutyPaymentFromLocal();
        if (savedDutyPayment && typeof savedDutyPayment === 'object') {
            collectorPaymentDetails = { ...collectorPaymentDetails, ...savedDutyPayment };
        }
    }

    if (isDirectoryCollector || isStaffSession) {
        isCurrentAdmin = false;
        if (!staffAccess && officialSession?.access) {
            window.AppSession?.startStaff(officialSession.name || '', officialSession.email || currentUserEmail, officialSession.access);
        }
    } else {
        try {
            const adminRef = doc(db, `${BASE_PATH}/settings`, ADMIN_AUTH_DOC_ID);
            const adminSnap = await getDoc(adminRef);

            const adminData = adminSnap.exists() ? adminSnap.data() : {};
            const adminUid = String(adminData.uid || '').trim();
            const adminUsername = String(adminData.username || adminData.displayUsername || adminData.loginDisplay || '').trim().toLowerCase();
            const adminEmail = String(adminData.email || '').trim().toLowerCase();
            const normalizedLogin = String(currentUserEmail || '').trim().toLowerCase();
            const adminAccounts = SINGLE_ADMIN_MODE ? [] : (Array.isArray(adminData.admins) ? adminData.admins : []);
            const matchesAdminDoc = adminData.isActive !== false && (
                (adminUid && user?.uid && adminUid === user.uid)
                || (adminUsername && normalizedLogin && adminUsername === normalizedLogin)
                || (adminEmail && normalizedLogin && adminEmail === normalizedLogin)
                || adminAccounts.some((account) => account?.isActive !== false && (
                    (account?.uid && user?.uid && String(account.uid).trim() === user.uid)
                    || (normalizedLogin && (
                        String(account?.username || '').trim().toLowerCase() === normalizedLogin
                        || String(account?.email || '').trim().toLowerCase() === normalizedLogin
                    ))
                ))
            );
            if (matchesAdminDoc || window.AppSession?.getRole?.() === 'admin' || window.AppSession?.hasCompanySession?.()) {
                isCurrentAdmin = true;
                window.AppSession?.startAdmin();
            } else {
                isCurrentAdmin = false;
            }
        } catch (_) {
            isCurrentAdmin = false;
        }
    }

    const displayEl = document.getElementById('staff-name-display');
    setResultPageNavVisibility(isMasterSuperAdmin() || staffAccess?.result === true);
    document.getElementById('collector-wise-monthly-tab')?.classList.toggle('hidden', !isMasterSuperAdmin());
    document.getElementById('subtab-btn-collector-wise')?.classList.toggle('hidden', !isMasterSuperAdmin());
    applyTabVisibilityPreferences();
    if (isMasterSuperAdmin() && displayEl) { displayEl.textContent = "ADMINISTRATOR"; }
    syncFeeDuesState();
    applyFinanceSettingsAccessUI();

    const refreshVisibleViewOnDataUpdate = () => {
        // 1. Fee Collection Module
        if (!document.getElementById('home-page')?.classList.contains('hidden')) {
            if (!isEditMode && !document.getElementById('subview-fee-entry')?.classList.contains('hidden')) {
                if (!document.getElementById('entry-receipt')?.value) {
                    const receiptEl = document.getElementById('entry-receipt');
                    if (receiptEl) receiptEl.value = getNextReceiptNoForStaff();
                }
            }
        }
        // 2. Fee Register Module
        if (!document.getElementById('master-ledger-page')?.classList.contains('hidden')) {
            syncMasterLedgerState();
        }
        // 3. Fee Dues & Defaulters Module
        if (!document.getElementById('fee-dues-page')?.classList.contains('hidden')) {
            renderFeeDues();
        }
        // 4. Payment History Module
        if (!document.getElementById('history-page')?.classList.contains('hidden')) {
            prepareHistoryData();
        }
        // 5. Reports & Analytics Module
        if (!document.getElementById('monthly-collected-page')?.classList.contains('hidden')) {
            if (!document.getElementById('collector-wise-monthly-page')?.classList.contains('hidden')) {
                renderCollectorWiseMonthlyPage();
            } else {
                renderMonthlyCollectedPage(document.getElementById('monthly-collected-search-input')?.value || '');
            }
        }
        // 6. Student Directory Module
        if (!document.getElementById('students-page')?.classList.contains('hidden')) {
            renderStudentInfoList();
        }
        // 7. Fee Settings & Setup Module
        if (!document.getElementById('fee-settings-page')?.classList.contains('hidden')) {
            applyFinanceSettingsAccessUI();
            if (!document.getElementById('manage-groups-page')?.classList.contains('hidden')) {
                renderStudentGroups();
            } else if (!document.getElementById('fee-concessions-page')?.classList.contains('hidden')) {
                renderConcessionsList();
            } else {
                renderFeeItemsManagement();
            }
        }
    };
    window.refreshVisibleViewOnDataUpdate = refreshVisibleViewOnDataUpdate;

    onSnapshot(collection(db, `${BASE_PATH}/staff`), (snap) => {
        allStaff = snap.docs.map(d => ({id: d.id, ...d.data()}));
        if (!isMasterSuperAdmin()) {
            const myData = findCurrentStaffMember(allStaff);
            if(myData && myData.isActive !== false && myData.canCollect !== false) {
                currentUserEmail = normalizeEmail(myData.email || currentUserEmail || getEffectiveStaffEmail());
                currentCollectorKey = normalizeEmail(window.AppSession?.getStaffAccess?.()?.userKey || myData.email || currentUserEmail);
                if (displayEl) displayEl.textContent = myData.name;
                
                const existingAccess = window.AppSession?.getStaffAccess?.() || {};
                const resolvedDuty = resolveStaffDutyClasses(myData);
                window.AppSession?.startStaff(myData.name, currentUserEmail, {
                    ...existingAccess,
                    staffId: myData.id || existingAccess.staffId,
                    name: myData.name,
                    role: myData.role || existingAccess.role,
                    dutyClasses: resolvedDuty
                });
                
                selectedDutyClasses = resolvedDuty;
                localStorage.setItem(getDutyStorageKey(), JSON.stringify(selectedDutyClasses));

                const serverDutyPayment = (myData.dutyPaymentDetails && typeof myData.dutyPaymentDetails === 'object') ? myData.dutyPaymentDetails : {};
                collectorPaymentDetails = serverDutyPayment;
                localStorage.setItem(getDutyPaymentStorageKey(), JSON.stringify(collectorPaymentDetails));
                setResultPageNavVisibility(myData.canManageResults === true || staffAccess?.result === true);
            } else if (myData && myData.isActive === false) {
                if (!snap.metadata?.fromCache) {
                    window.AppSession?.revokeCurrentAccount?.({
                        accountId: myData.id || '',
                        message: 'Your staff account has been deactivated by the administrator.',
                        authInstance: auth,
                        redirectUrl: getPageUrl('index.html')
                    });
                }
                return;
            } else if (myData && myData.canCollect === false) {
                window.AppSession?.setFlash?.('Access Restricted: Fee Collection permission is disabled for your account.');
                window.location.href = getPageUrl('official.html');
                return;
            } else {
                if (isDirectoryCollector) {
                    if (displayEl) displayEl.textContent = window.AppSession?.getStaffName?.() || 'COLLECTOR';
                    setDutyPaymentDetailsInputs(collectorPaymentDetails);
                } else if (!snap.metadata?.fromCache && (window.AppSession?.getRole?.() || '') !== 'admin') {
                    window.AppSession?.revokeCurrentAccount?.({
                        accountId: staffAccess?.staffId || '',
                        message: 'Your staff account was removed by the administrator.',
                        authInstance: auth,
                        redirectUrl: getPageUrl('index.html')
                    });
                    return;
                } else {
                    selectedDutyClasses = resolveStaffDutyClasses(null);
                    if (displayEl) displayEl.textContent = window.AppSession?.getStaffName?.() || 'STAFF';
                }
            }
        } else {
            selectedDutyClasses = [];
            if (displayEl) displayEl.textContent = "ADMINISTRATOR";
            setResultPageNavVisibility(true);
        }
        if (isDirectoryCollector && displayEl) {
            displayEl.textContent = window.AppSession?.getStaffName?.() || 'COLLECTOR';
        }
        setDutyPaymentDetailsInputs(collectorPaymentDetails);
        populateClassDropdowns();
        syncFeeDuesState();
        applyFinanceSettingsAccessUI();
        renderStaffDirectory();
        updateHistoryStaffFilter();
        updateDashboardMetrics();
        refreshVisibleViewOnDataUpdate();
    });
    const verifyLiveDirectoryCollectorAccess = (fromCache = false) => {
        if (!isDirectoryCollector || fromCache) return;
        const entryId = staffAccess?.entryId || officialSession?.id || '';
        const loginId = String(staffAccess?.loginId || officialSession?.username || '').trim().toLowerCase();
        const matchedEntry = directoryEntries.find((e) =>
            (entryId && e.id === entryId)
            || (loginId && String(e.authMeta?.username || '').trim().toLowerCase() === loginId)
        );
        const isBlocked = matchedEntry && pageAccessConfig?.overrides?.[matchedEntry.id]?.blocked === true;
        if (!matchedEntry || isBlocked) {
            window.AppSession?.revokeCurrentAccount?.({
                accountId: matchedEntry?.id ? `dir_${matchedEntry.id}` : (entryId ? `dir_${entryId}` : ''),
                message: 'Your collection access is no longer active or has been removed by the administrator.',
                authInstance: auth,
                redirectUrl: getPageUrl('index.html')
            });
        }
    };
    onSnapshot(collection(db, `${BASE_PATH}/publicDirectory`), (snap) => {
        directoryEntries = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        verifyLiveDirectoryCollectorAccess(Boolean(snap.metadata?.fromCache));
        renderStaffDirectory();
    });
    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'content'), (contentSnap) => {
        const payload = contentSnap.exists() ? contentSnap.data() : {};
        directoryCategories = Array.isArray(payload.directoryCategories) ? payload.directoryCategories : [];
        renderStaffDirectory();
    });
    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'pageAccess'), (accessSnap) => {
        const payload = accessSnap.exists() ? accessSnap.data() : {};
        pageAccessConfig = payload && typeof payload === 'object' ? { categories: {}, overrides: {}, ...payload } : { categories: {}, overrides: {} };
        verifyLiveDirectoryCollectorAccess(Boolean(accessSnap.metadata?.fromCache));
        renderStaffDirectory();
    });
    getDoc(getSessionRegistryRef()).then((sessionSnap) => {
        const registry = sessionSnap.exists() ? sessionSnap.data() : {};
        const deviceId = getLocalDeviceId();
        const sessionEntry = registry?.sessions?.[deviceId] || null;
        if (!sessionEntry) return;
        if (sessionEntry.isBlocked === true || sessionEntry.forceLogout === true) {
            alert('This collection session is blocked or logged out by admin.');
            window.AppSession?.clearAll({ purgeClientData: true });
            signOut(auth).finally(() => { window.location.href = getPageUrl('index.html'); });
        }
    });
    startCollectionSessionHeartbeat();
    window.AppSession?.touchSession();

    const sessionControlRef = doc(db, `${BASE_PATH}/settings`, 'sessionControl');
    onSnapshot(sessionControlRef, (sessionSnap) => {
        const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};
        const startedAt = window.AppSession?.getStartedAt?.() || 0;
        const forcedAt = sessionData?.lastForcedLogoutAt ? new Date(sessionData.lastForcedLogoutAt).getTime() : 0;
        if (forcedAt && startedAt && forcedAt > startedAt) {
            alert(sessionData.message || 'An administrator ended this session. Please sign in again.');
            window.AppSession?.clearAll({ purgeClientData: true });
            signOut(auth).finally(() => { window.location.href = getPageUrl('index.html'); });
        }
    });

    const confRef = doc(db, `${BASE_PATH}/settings`, 'config');
    onSnapshot(confRef, (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();

            if (d.enabledModules && typeof d.enabledModules === 'object') {
                try {
                    localStorage.setItem('app_enabled_modules', JSON.stringify(d.enabledModules));
                } catch (_) {}
                if (d.enabledModules.collection === false) {
                    sessionStorage.setItem('app_session_flash', 'Module Disabled: The Fee Collection module is currently disabled by institution administration.');
                    window.location.href = getPageUrl('official.html');
                    return;
                }
            }

            applyInstitutionBranding(d, {
                defaultAppName: 'Fee Collection',
                logoIds: ['header-logo', 'splash-logo-img'],
                updateDocumentTitle: true,
                documentTitleSuffix: 'Fee Collection'
            });
            renderVersionInfo();
            setTimeout(() => { fitTextToContainer('header-title'); }, 50);

            studentFieldSchema = normalizeStudentFieldSchema(d.studentFields);
            defaultMonthlyFeeEnabled = d.defaultMonthlyFeeEnabled !== false;
            defaultFee = d.defaultFee || 200;
            feeItems = sortFeeItemsForDisplay(d.feeItems || []);
            defaultReceiptMandatory = d.defaultReceiptMandatory || false;
            syncFeeConfigUI(d);
            applyFinanceSettingsAccessUI();
            syncFeeDuesState();
            syncMasterLedgerState();

            window.defaultMonthlyFeeEnabled = defaultMonthlyFeeEnabled;
            window.defaultFee = defaultFee;
            window.feeItems = feeItems;
            window.defaultReceiptMandatory = defaultReceiptMandatory;
            window.getNextReceiptNoForStaff = getNextReceiptNoForStaff;
            window.getCollectorKey = getCollectorKey;
            checkReceiptMandatory();
            if (selectedStudentId && !isEditMode) {
                populateFeeItemSelection();
            }
            refreshVisibleViewOnDataUpdate();
        }
    });

    onSnapshot(collection(db, `${BASE_PATH}/students`), (snap) => {
        allStudentsRaw = snap.docs.map(d => ({id: d.id, ...d.data()}));
        applyCurrentYearStudentScope();
        populateClassDropdowns();
        updateDashboardMetrics();
        syncMasterLedgerState();
        syncFeeDuesState();
        hideLoader();
        refreshVisibleViewOnDataUpdate();
    });

    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'academicYears'), (snap) => {
        const payload = snap.exists() ? snap.data() : {};
        academicYearSettings = Array.isArray(payload.years) ? payload.years : [];
        const prevWorkingYear = currentWorkingAcademicYear;
        currentWorkingAcademicYear = resolveAuthoritativeCurrentYear(
            payload,
            currentWorkingAcademicYear || getAcademicYearFromDate(new Date())
        );
        window.currentWorkingAcademicYear = currentWorkingAcademicYear;
        try {
            if (currentWorkingAcademicYear) {
                localStorage.setItem('app_current_academic_year', currentWorkingAcademicYear);
                localStorage.setItem('current_academic_year', currentWorkingAcademicYear);
            }
        } catch (_) {}

        const shouldForceReset = !hasLoadedCollectionAcademicYears || (prevWorkingYear && prevWorkingYear !== currentWorkingAcademicYear);
        hasLoadedCollectionAcademicYears = true;
        if (shouldForceReset) {
            ['dues-academic-year-select', 'ledger-academic-year-select', 'conc-group-year-select', 'bulk-academic-year'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.dataset.userChangedYear = 'false';
            });
            selectedFeeAcademicYear = '';
        }

        const yearHeaderEl = document.getElementById('header-active-year');
        if (yearHeaderEl) {
            yearHeaderEl.textContent = currentWorkingAcademicYear || getAcademicYearFromDate(new Date());
        }
        applyCurrentYearStudentScope();
        populateClassDropdowns();
        setupBulkUploadUI();
        updateDashboardMetrics();
        syncMasterLedgerState(shouldForceReset);
        syncFeeDuesState(undefined, shouldForceReset);
        if (selectedStudentId) {
            populateFeeItemSelection();
        }
        hideLoader();
        refreshVisibleViewOnDataUpdate();
    });

    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'classes'), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            institutionalConfiguredClasses = (Array.isArray(data.list) ? data.list : (Array.isArray(data.classes) ? data.classes : [])).map(c => String(c?.id || c?.name || c).trim()).filter(Boolean);
        }
        populateClassDropdowns();
        syncMasterLedgerState();
        syncFeeDuesState();
        refreshVisibleViewOnDataUpdate();
    });

    onSnapshot(collection(db, `${BASE_PATH}/studentGroups`), (snap) => {
        studentGroups = snap.docs.map(d => ({id: d.id, ...d.data()}));
        if (selectedStudentId) {
            const grp = getStudentBillingGroup(selectedStudentId);
            if (grp && Array.isArray(grp.memberIds) && grp.memberIds.length > 1) {
                if (!selectedGroupMemberIds || selectedGroupMemberIds.size === 0) {
                    selectedGroupMemberIds = new Set(grp.memberIds);
                }
            }
            populateFeeItemSelection();
            syncGroupedStudentsForSelectedStudent();
        }
        syncMasterLedgerState();
        syncFeeDuesState();
        hideLoader();
        refreshVisibleViewOnDataUpdate();
    });

    onSnapshot(collection(db, `${BASE_PATH}/payments`), (snap) => {
        allPayments = snap.docs.map(d => ({id: d.id, ...d.data()}));
        window.allPayments = allPayments;
        window.currentWorkingAcademicYear = currentWorkingAcademicYear;
        updateDashboardMetrics();
        updateHistoryStaffFilter();
        syncMasterLedgerState();
        syncFeeDuesState();
        hideLoader();
        refreshVisibleViewOnDataUpdate();
    });

    onSnapshot(collection(db, `${BASE_PATH}/donations`), (snap) => {
        allDonations = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        updateDashboardMetrics();
        refreshVisibleViewOnDataUpdate();
    });
});
