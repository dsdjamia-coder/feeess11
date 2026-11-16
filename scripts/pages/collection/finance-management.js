import { doc, collection, writeBatch, setDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from '../../../config/firebase-config.js';
import { BASE_PATH, escapeHtml, formatCurrency, populateClassSelect, compareClassLabelsNatural, openConfirmDialog, enableSmartSelectWindowing, syncSmartSelectDisplay } from '../../shared/app-common.js';
import { showToast } from '../../shared/toaster.js';

const MONTH_SEQUENCE = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
];

let ctx = {
    getStudents: () => [],
    getRawStudents: () => [],
    getClasses: () => [],
    getDutyClasses: () => [],
    getRawDutyClasses: () => [],
    isAdmin: () => false,
    isClassInDutyScope: () => false,
    getStudentGroups: () => [],
    getFeeItems: () => [],
    getDefaultFee: () => 200,
    getAcademicYear: () => '',
    getUserEmail: () => ''
};

let editGroupWorkingMembers = [];
let pendingGroupCreationData = null;
let grpPageOffset = 0;
let concSearchPageOffset = 0;
let activeConcPageOffset = 0;

const isUserAdmin = () => Boolean(ctx.isAdmin?.());
const isValidCollectionClass = (c = '') => {
    const u = String(c || '').trim().toUpperCase();
    return Boolean(u && u !== 'ALUMNI' && u !== 'GRADUATED' && u !== 'ALUMNI_DUES');
};
const getScopedClasses = () => {
    const raw = isUserAdmin() ? (ctx.getClasses?.() || []) : (ctx.getDutyClasses?.() || []);
    return Array.from(new Set((Array.isArray(raw) ? raw : []).filter(isValidCollectionClass))).sort(compareClassLabelsNatural);
};
const isDutyClassMatch = (cls = '') => {
    if (isUserAdmin()) return true;
    const trimmed = String(cls || '').trim();
    if (!trimmed) return false;
    return Boolean(ctx.isClassInDutyScope?.(trimmed));
};
const getStudentEffectiveClass = (st = {}, activeYear = '') => {
    if (!st || typeof st !== 'object') return '';
    return String((activeYear && st.academicYears?.[activeYear]?.class) || st.class || '').trim();
};
const canManageFeeItem = (item = null) => {
    if (!item) return false;
    if (isUserAdmin()) return true;
    if (item.type !== 'custom') return false;
    const duty = getScopedClasses();
    if (!duty.length) return false;
    if (item.scope === 'specific') {
        return Boolean(item.targetClass && isDutyClassMatch(item.targetClass));
    }
    if (item.scope === 'class-wise') {
        const clsKeys = Object.keys(item.classValues || {}).filter(Boolean);
        return clsKeys.length > 0 && clsKeys.every((cls) => isDutyClassMatch(cls));
    }
    return false;
};

const syncAdvFeeScopeOptionsAndInputs = () => {
    const admin = isUserAdmin();
    const scopedClasses = getScopedClasses();
    const scopeSelect = document.getElementById('adv-fee-scope');
    if (scopeSelect) {
        const prevScope = scopeSelect.value || '';
        if (admin) {
            scopeSelect.innerHTML = `
                <option value="global">Global (Same for all classes)</option>
                <option value="class-wise">Class-wise (Different for each class)</option>
                <option value="specific">Specific Class Only</option>
            `;
            scopeSelect.value = ['global', 'class-wise', 'specific'].includes(prevScope) ? prevScope : 'global';
        } else {
            let opts = '';
            if (scopedClasses.length > 1) {
                opts += '<option value="class-wise">Class-wise (Assigned Duty Classes)</option>';
            }
            opts += '<option value="specific">Specific Class Only</option>';
            scopeSelect.innerHTML = opts;
            if (prevScope === 'class-wise' && scopedClasses.length > 1) {
                scopeSelect.value = 'class-wise';
            } else {
                scopeSelect.value = 'specific';
            }
        }
        syncSmartSelectDisplay(scopeSelect);
    }

    const activeScope = scopeSelect?.value || (admin ? 'global' : 'specific');
    document.getElementById('scope-global-container')?.classList.toggle('hidden', !admin || activeScope !== 'global');
    document.getElementById('scope-class-wise-container')?.classList.toggle('hidden', activeScope !== 'class-wise');
    document.getElementById('scope-specific-container')?.classList.toggle('hidden', activeScope !== 'specific');

    const inputsCont = document.getElementById('class-wise-inputs');
    if (inputsCont && activeScope === 'class-wise') {
        const existingVals = {};
        inputsCont.querySelectorAll('.cw-input').forEach((inp) => {
            if (inp.dataset.class) existingVals[inp.dataset.class] = inp.value;
        });
        inputsCont.innerHTML = scopedClasses.map((c) => `<div><label class="block text-xs font-bold text-gray-600 mb-1">${escapeHtml(c)}</label><input type="number" data-class="${escapeHtml(c)}" class="cw-input w-full p-2 border rounded text-sm font-medium" value="${escapeHtml(String(existingVals[c] ?? ''))}"></div>`).join('');
    }

    const targetSelect = document.getElementById('adv-fee-specific-class');
    if (targetSelect) {
        if (scopedClasses.length === 0) {
            populateClassSelect(targetSelect, [], {
                selectedValue: '',
                placeholder: 'No classes assigned',
                includeAllOption: false
            });
        } else {
            const curTarget = targetSelect.value || '';
            const safeTarget = scopedClasses.includes(curTarget) ? curTarget : '';
            populateClassSelect(targetSelect, scopedClasses, {
                selectedValue: safeTarget,
                placeholder: '-- Select Class --',
                includeAllOption: false
            });
        }
    }
};

export const applyFinanceSettingsAccessUI = () => {
    const admin = isUserAdmin();
    const scopedClasses = getScopedClasses();

    // 1. Structure -> Default Configuration (Admin Only)
    document.getElementById('default-fee-readonly-badge')?.classList.toggle('hidden', admin);
    document.getElementById('save-fee-config-btn')?.classList.toggle('hidden', !admin);
    [
        'default-fee-input',
        'fee-collect-start-day',
        'fee-collect-end-day',
        'fee-notify-mode',
        'fee-notify-days-before',
        'default-fee-receipt-req'
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !admin;
        el.classList.toggle('opacity-75', !admin);
        el.classList.toggle('cursor-not-allowed', !admin);
        if (el.tagName === 'SELECT') {
            syncSmartSelectDisplay(el);
        }
    });

    // 2. Structure -> Advanced Fee Builder & Active Items Reorder Hint
    document.getElementById('adv-fee-scope-note-badge')?.classList.toggle('hidden', admin);
    document.getElementById('fee-items-reorder-note')?.classList.toggle('hidden', !admin);
    const builderBox = document.getElementById('adv-fee-builder-form-box');
    const noDutyNotice = document.getElementById('adv-fee-no-duty-notice');
    if (!admin && scopedClasses.length === 0) {
        builderBox?.classList.add('hidden');
        noDutyNotice?.classList.remove('hidden');
    } else {
        builderBox?.classList.remove('hidden');
        noDutyNotice?.classList.add('hidden');
        syncAdvFeeScopeOptionsAndInputs();
    }

    // 3. Groups -> View Mode for Non-Admin
    const createGrpCard = document.getElementById('create-student-group-card');
    const existingGrpCard = document.getElementById('existing-student-groups-card');
    createGrpCard?.classList.toggle('hidden', !admin);
    if (existingGrpCard) {
        existingGrpCard.classList.toggle('lg:col-span-7', admin);
        existingGrpCard.classList.toggle('lg:col-span-12', !admin);
    }
    document.getElementById('groups-readonly-badge')?.classList.toggle('hidden', admin);

    // 4. Concessions -> Active Concessions Only View Mode for Non-Admin
    const assignConcCard = document.getElementById('conc-assign-card');
    const activeConcCard = document.getElementById('active-conc-directory-card');
    assignConcCard?.classList.toggle('hidden', !admin);
    if (activeConcCard) {
        activeConcCard.classList.toggle('xl:col-span-8', admin);
        activeConcCard.classList.toggle('xl:col-span-12', !admin);
    }
    document.getElementById('conc-readonly-badge')?.classList.toggle('hidden', admin);
    document.getElementById('active-conc-actions-th')?.classList.toggle('hidden', !admin);
};

const computePaginationSlice = (totalItems, offset, rowLimitRaw = '25') => {
    const isAllRows = rowLimitRaw === 'all';
    const rowLimit = isAllRows ? totalItems : (parseInt(rowLimitRaw, 10) || 25);
    let safeOffset = offset;
    if (isAllRows) {
        safeOffset = 0;
    } else if (safeOffset >= totalItems) {
        safeOffset = Math.max(0, Math.floor(Math.max(0, totalItems - 1) / rowLimit) * rowLimit);
    }
    const sliceStart = isAllRows ? 0 : Math.max(0, safeOffset);
    const sliceEnd = isAllRows ? totalItems : Math.min(totalItems, sliceStart + rowLimit);
    return { isAllRows, rowLimit, sliceStart, sliceEnd, nextOffset: safeOffset };
};

const renderSlicePagination = ({ el, sliceStart, sliceEnd, totalFiltered, rowLimit, isAllRows, noun = 'records', roundedCard = false, onPageChange }) => {
    if (!el) return;
    const radiusCls = roundedCard ? 'rounded-xl border border-slate-200 bg-slate-50/80' : 'border-t border-slate-200 bg-slate-50/70';
    if (!isAllRows) {
        const hasPrev = sliceStart > 0;
        const hasNext = sliceEnd < totalFiltered;
        el.className = `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 ${radiusCls} text-[11px] sm:text-xs`;
        el.innerHTML = `
            <span class="font-semibold text-slate-600">Showing <b class="text-slate-900">${sliceStart + 1} - ${sliceEnd}</b> of <b class="text-slate-900">${totalFiltered}</b> ${escapeHtml(noun)}</span>
            <div class="flex items-center gap-2">
                <button type="button" data-page-dir="prev" class="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition" ${hasPrev ? '' : 'disabled'}>
                    <i class="fas fa-chevron-left mr-1 text-[10px]"></i> Previous
                </button>
                <button type="button" data-page-dir="next" class="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition" ${hasNext ? '' : 'disabled'}>
                    Next <i class="fas fa-chevron-right ml-1 text-[10px]"></i>
                </button>
            </div>
        `;
        el.querySelector('[data-page-dir="prev"]')?.addEventListener('click', () => {
            onPageChange(Math.max(0, sliceStart - rowLimit));
        });
        el.querySelector('[data-page-dir="next"]')?.addEventListener('click', () => {
            if (sliceEnd < totalFiltered) onPageChange(sliceEnd);
        });
    } else {
        el.className = `flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 ${radiusCls} text-[11px] sm:text-xs`;
        el.innerHTML = `<span class="font-semibold text-slate-600">Showing all <b class="text-slate-900">${totalFiltered}</b> ${escapeHtml(noun)}</span>`;
    }
};

// --- Helper Audit Logging ---
const logAudit = async (category, action, entityType, entityId, message) => {
    try {
        const payload = {
            category,
            action,
            entityType,
            entityId,
            message,
            performedBy: ctx.getUserEmail() || 'cashier',
            createdAt: new Date().toISOString()
        };
        const ref = doc(collection(db, `${BASE_PATH}/auditLogs`));
        await setDoc(ref, payload);
    } catch (e) {
        console.warn('Audit log write error:', e);
    }
};

// =========================================================================
// 1. FEE SETTINGS CONTROLLER
// =========================================================================

export const renderFeeItemsManagement = () => {
    applyFinanceSettingsAccessUI();
    const cont = document.getElementById('fee-items-management-container');
    if (!cont) return;

    const admin = isUserAdmin();
    const activeYear = ctx.getAcademicYear();
    const feeItems = ctx.getFeeItems();
    const scopedFeeItems = feeItems.filter((item) => (item.academicYear || activeYear) === activeYear);

    const monthlyItems = scopedFeeItems
        .filter((item) => (item.type || 'month') === 'month')
        .sort((a, b) => {
            const aMonth = (a.name || '').split('(')[0].trim().toLowerCase();
            const bMonth = (b.name || '').split('(')[0].trim().toLowerCase();
            const aIndex = MONTH_SEQUENCE.indexOf(aMonth);
            const bIndex = MONTH_SEQUENCE.indexOf(bMonth);
            if (aIndex === -1 && bIndex === -1) return (a.name || '').localeCompare(b.name || '');
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        });

    const customItems = scopedFeeItems.filter((item) => item.type === 'custom');

    const renderMonthlyItemCard = (item) => {
        const cleanName = (item.name || '').replace(/^default\s*[-:—–]?\s*/i, '').trim();
        return `<div class="flex items-center gap-2 sm:gap-3 p-2 sm:p-3.5 bg-white border border-slate-200 hover:border-blue-300 rounded-xl shadow-2xs hover:shadow-xs transition drag-item" data-key="${escapeHtml(item.key)}">
            <span class="w-6 h-6 sm:w-8 sm:h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 text-[11px] sm:text-xs shadow-2xs"><i class="fas fa-calendar-alt"></i></span>
            <span class="font-bold text-gray-800 text-xs sm:text-sm truncate">${escapeHtml(cleanName)}</span>
        </div>`;
    };

    const renderItemCard = (item) => {
        const canManage = canManageFeeItem(item);
        let scopeDesc = (item.scope || 'GLOBAL').toUpperCase();
        if (item.scope === 'specific' && item.targetClass) {
            scopeDesc = `SPECIFIC (${escapeHtml(item.targetClass)})`;
        } else if (item.scope === 'class-wise' && item.classValues) {
            const clsList = Object.keys(item.classValues).filter(Boolean);
            if (clsList.length) scopeDesc = `CLASS-WISE (${escapeHtml(clsList.join(', '))})`;
        }

        let detailsHtml = '';
        if (item.type === 'custom') {
            detailsHtml = `<div class="text-[11px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">Scope: <span class="font-semibold text-blue-600">${scopeDesc}</span> | Receipt Mandatory: <span class="font-semibold ${item.isReceiptMandatory ? 'text-red-500' : 'text-gray-400'}">${item.isReceiptMandatory ? 'YES' : 'NO'}</span></div>`;
        }
        const handleHtml = item.type === 'custom' && admin
            ? `<span class="drag-handle mr-2 sm:mr-4 text-gray-500 text-sm sm:text-lg bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg px-1.5 sm:px-2 py-0.5 sm:py-1 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder"><i class="fas fa-grip-lines"></i></span>`
            : `<span class="mr-2 sm:mr-3 w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 text-xs"><i class="fas ${item.type === 'custom' ? 'fa-tag' : 'fa-calendar'}"></i></span>`;

        const actionHtml = item.type === 'custom'
            ? (canManage
                ? `<button type="button" class="text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-bold transition edit-fee mr-1.5 sm:mr-2 cursor-pointer shrink-0" data-key="${escapeHtml(item.key)}" title="Edit Fee Item"><i class="fas fa-edit"></i></button>
                   <button type="button" class="text-red-600 bg-red-50 hover:bg-red-100 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-bold transition del-fee cursor-pointer shrink-0" data-key="${escapeHtml(item.key)}" title="Delete Fee Item"><i class="fas fa-trash"></i></button>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider shrink-0"><i class="fas fa-lock text-[9px]"></i> View Only</span>`)
            : `<span class="px-2 sm:px-3 py-0.5 sm:py-1 bg-gray-100 text-gray-500 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider shrink-0">Month</span>`;

        return `<div class="flex items-center bg-white border border-gray-200 p-2.5 sm:p-4 rounded-xl shadow-sm drag-item transition hover:shadow-md" data-key="${escapeHtml(item.key)}">
            ${handleHtml}
            <div class="flex-grow min-w-0 pr-2">
                <span class="font-bold text-gray-800 text-sm sm:text-lg block truncate">${escapeHtml(item.name)}</span>
                ${detailsHtml}
            </div>
            ${actionHtml}
        </div>`;
    };

    cont.innerHTML = `
        <div class="mb-3.5 sm:mb-5">
            <h4 class="text-xs sm:text-sm font-bold text-blue-800 mb-2 sm:mb-2.5 uppercase tracking-wider flex items-center gap-1.5 sm:gap-2"><i class="fas fa-calendar-check text-blue-600"></i> Default Months (${escapeHtml(activeYear || '--')})</h4>
            <div id="fee-items-monthly-list" class="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
                ${monthlyItems.map(renderMonthlyItemCard).join('') || '<p class="text-xs text-gray-500 italic col-span-full">Monthly defaults are not available.</p>'}
            </div>
        </div>
        <div>
            <h4 class="text-xs sm:text-sm font-bold text-emerald-800 mb-2 sm:mb-2.5 uppercase tracking-wider flex items-center gap-1.5 sm:gap-2"><i class="fas fa-layer-group text-emerald-600"></i> Other Fee Items (${escapeHtml(activeYear || '--')})</h4>
            <div id="fee-items-custom-list" class="space-y-2 sm:space-y-3">
                ${customItems.map(renderItemCard).join('') || '<p class="text-xs text-gray-500 italic">No custom fee items added yet.</p>'}
            </div>
        </div>
    `;

    const persistFeeOrder = async () => {
        if (!isUserAdmin()) return;
        const orderedKeys = [
            ...Array.from(cont.querySelectorAll('#fee-items-monthly-list .drag-item')).map((el) => el.dataset.key),
            ...Array.from(cont.querySelectorAll('#fee-items-custom-list .drag-item')).map((el) => el.dataset.key)
        ];
        const allItems = ctx.getFeeItems();
        const orderedItems = orderedKeys.map((key) => allItems.find((item) => item.key === key)).filter(Boolean);
        const remainingItems = allItems.filter((item) => !orderedKeys.includes(item.key));
        const nextItems = [...orderedItems, ...remainingItems];
        if (orderedItems.length === 0) return;
        await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), { feeItems: nextItems }, { merge: true });
        showToast('Fee item order saved.', 'info');
    };

    const customList = document.getElementById('fee-items-custom-list');
    if (admin && customList && customItems.length > 1 && typeof Sortable !== 'undefined') {
        new Sortable(customList, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: persistFeeOrder
        });
    }
};

export const syncFeeConfigUI = (data = {}) => {
    const defFeeInput = document.getElementById('default-fee-input');
    const reqCheckbox = document.getElementById('default-fee-receipt-req');
    const startDaySelect = document.getElementById('fee-collect-start-day');
    const endDaySelect = document.getElementById('fee-collect-end-day');
    const notifyModeSelect = document.getElementById('fee-notify-mode');
    const notifyDaysInput = document.getElementById('fee-notify-days-before');

    if (defFeeInput && data.defaultFee !== undefined) defFeeInput.value = data.defaultFee;
    if (reqCheckbox && data.defaultReceiptMandatory !== undefined) reqCheckbox.checked = !!data.defaultReceiptMandatory;

    const windowCfg = data.feeCollectionWindow || {};
    const startVal = windowCfg.startDay ?? data.feeCollectionStartDay;
    const endVal = windowCfg.endDay ?? data.feeCollectionEndDay;
    const modeVal = windowCfg.notifyMode ?? data.feeNotifyMode;
    const daysVal = windowCfg.notifyDaysBefore ?? data.feeNotifyDaysBefore;

    if (startDaySelect && startVal) startDaySelect.value = String(startVal);
    if (endDaySelect && endVal) endDaySelect.value = String(endVal);
    if (notifyModeSelect && modeVal) {
        notifyModeSelect.value = modeVal;
        syncSmartSelectDisplay(notifyModeSelect);
        const daysContainer = document.getElementById('fee-notify-days-container');
        if (daysContainer) {
            daysContainer.classList.toggle('hidden', !['days_before_end', 'days_before_month_end'].includes(modeVal));
        }
    }
    if (notifyDaysInput && daysVal !== undefined) notifyDaysInput.value = daysVal;

    updateFeeScheduleSummary();
};

const updateFeeScheduleSummary = () => {
    const startDay = parseInt(document.getElementById('fee-collect-start-day')?.value || '1', 10);
    const endDay = parseInt(document.getElementById('fee-collect-end-day')?.value || '10', 10);
    const mode = document.getElementById('fee-notify-mode')?.value || 'month_start';
    const daysBefore = parseInt(document.getElementById('fee-notify-days-before')?.value || '5', 10);

    const badge = document.getElementById('fee-collection-window-badge');
    const summaryText = document.getElementById('fee-schedule-live-summary-text');
    const isCrossMonth = endDay < startDay;

    const startLabel = `Date ${startDay}`;
    const endLabel = endDay === 31 ? 'Date 31 (Month End)' : `Date ${endDay}`;

    if (badge) {
        if (isCrossMonth) {
            badge.textContent = `Spans Months: ${startLabel} to ${endLabel} of next month`;
            badge.className = 'inline-flex items-center gap-1.5 text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 px-3 py-1 rounded-full self-start sm:self-auto';
        } else {
            badge.textContent = `Every Month: ${startLabel} to ${endLabel}`;
            badge.className = 'inline-flex items-center gap-1.5 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full self-start sm:self-auto';
        }
    }

    let notifyDesc = 'on Date 1 of every month';
    if (mode === 'collection_start') notifyDesc = `on ${startLabel} of each month (when collection begins)`;
    else if (mode === 'days_before_end') notifyDesc = `${daysBefore} days before collection ends (${isCrossMonth ? 'deadline in next month' : 'Date ' + Math.max(1, endDay - daysBefore)})`;
    else if (mode === 'days_before_month_end') notifyDesc = `${daysBefore} days before the end of each month`;

    if (summaryText) {
        summaryText.textContent = `Regular monthly fee collection runs from ${startLabel} to ${endLabel} of every month. Student alerts trigger ${notifyDesc}.`;
    }
};

const saveFeeConfiguration = async () => {
    if (!isUserAdmin()) {
        showToast('Only administrators can modify default fee settings.', 'warn');
        return;
    }
    const defFeeInput = document.getElementById('default-fee-input');
    const reqCheckbox = document.getElementById('default-fee-receipt-req');
    const startDaySelect = document.getElementById('fee-collect-start-day');
    const endDaySelect = document.getElementById('fee-collect-end-day');
    const notifyModeSelect = document.getElementById('fee-notify-mode');
    const notifyDaysInput = document.getElementById('fee-notify-days-before');

    const defaultFee = parseFloat(defFeeInput?.value) || 0;
    const defaultReceiptMandatory = !!reqCheckbox?.checked;

    const startDay = parseInt(startDaySelect?.value || '1', 10);
    const endDay = parseInt(endDaySelect?.value || '10', 10);
    const notifyMode = notifyModeSelect?.value || 'month_start';
    const notifyDaysBefore = parseInt(notifyDaysInput?.value || '5', 10);

    const payload = {
        defaultFee,
        defaultReceiptMandatory,
        feeCollectionStartDay: startDay,
        feeCollectionEndDay: endDay,
        feeNotifyMode: notifyMode,
        feeNotifyDaysBefore: notifyDaysBefore,
        feeCollectionWindow: {
            startDay,
            endDay,
            notifyMode,
            notifyDaysBefore
        }
    };

    try {
        await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), payload, { merge: true });
        await logAudit('fee', 'config.save', 'feeConfig', 'config', `Fee config updated. Default Fee: ₹${defaultFee}.`);
        showToast('Fee configuration successfully saved!', 'success');
    } catch (err) {
        console.error('Error saving fee config:', err);
        showToast('Failed to save fee configuration: ' + err.message, 'error');
    }
};

// =========================================================================
// 2. STUDENT GROUPS CONTROLLER
// =========================================================================

export const renderStudentGroups = () => {
    applyFinanceSettingsAccessUI();
    const listNode = document.getElementById('student-groups-list');
    if (!listNode) return;

    populateExistingGroupClassFilter();

    const admin = isUserAdmin();
    const dutyClasses = getScopedClasses();
    const activeYear = ctx.getAcademicYear?.() || '';
    const students = ctx.getStudents();
    const rawStudents = ctx.getRawStudents();
    const studentGroups = ctx.getStudentGroups();

    const sTerm = (document.getElementById('grp-search-input')?.value || '').trim().toLowerCase();
    const fCls = document.getElementById('grp-class-filter')?.value ?? '';
    const fSize = document.getElementById('filter-groups-size')?.value || 'all';
    const rowLimitRaw = document.getElementById('grp-row-limit')?.value || '25';
    const countBadge = document.getElementById('grp-count-badge');
    const paginationEl = document.getElementById('grp-pagination');
    const resetGrpPagination = () => {
        if (paginationEl) {
            paginationEl.className = 'hidden';
            paginationEl.innerHTML = '';
        }
    };

    const uniqueGroups = Array.from(new Map((studentGroups || []).map((g) => [g.id, g])).values());
    const resolveGroupMembers = (group) => (group.memberIds || [])
        .map((mid) => students.find((entry) => entry.id === mid) || rawStudents.find((entry) => entry.id === mid))
        .filter(Boolean);

    const eligibleGroups = admin
        ? uniqueGroups
        : (dutyClasses.length
            ? uniqueGroups.filter((g) => {
                const members = resolveGroupMembers(g);
                return members.some((st) => isDutyClassMatch(getStudentEffectiveClass(st, activeYear)));
            })
            : []);

    populateExistingGroupSizeFilter(eligibleGroups);

    if (!admin && dutyClasses.length === 0) {
        if (countBadge) countBadge.textContent = '0 Groups';
        listNode.innerHTML = `
            <div class="text-center py-8 px-4 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs font-semibold">
                <i class="fas fa-exclamation-circle text-amber-600 text-xl mb-1.5 block"></i>
                No duty classes assigned to your account. Please ask the administrator to assign duty classes in Staff Management.
            </div>
        `;
        resetGrpPagination();
        return;
    }

    if (!fCls && !sTerm && fSize === 'all') {
        if (countBadge) countBadge.textContent = `${eligibleGroups.length} Groups`;
        listNode.innerHTML = `
            <div class="text-center py-8 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-500 text-xs">
                <i class="fas fa-users text-slate-300 text-2xl mb-2 block"></i>
                <p class="font-bold text-slate-700 text-xs sm:text-sm">Select a Class to View Student Groups</p>
                <p class="mt-1 text-[11px] text-slate-500">Please choose a specific class, select &ldquo;All Classes&rdquo;, or search by student or father name above.</p>
            </div>
        `;
        resetGrpPagination();
        return;
    }

    const filteredGroups = eligibleGroups.filter((g) => {
        const memberIds = g.memberIds || [];
        if (fSize !== 'all' && memberIds.length !== parseInt(fSize, 10)) {
            return false;
        }

        const memberStudents = resolveGroupMembers(g);

        let matchClass = (!fCls || fCls === 'all');
        if (!matchClass) {
            const fNorm = String(fCls).replace(/^class\s*/i, '').trim().toLowerCase();
            matchClass = memberStudents.some((st) => {
                const stCls = getStudentEffectiveClass(st, activeYear);
                const stNorm = stCls.replace(/^class\s*/i, '').trim().toLowerCase();
                return stCls === fCls || stNorm === fNorm;
            });
        }

        let matchSearch = true;
        if (sTerm) {
            const matchesMember = memberStudents.some((st) => {
                const sName = (st.name || '').toLowerCase();
                const sAdm = (st.adm ? String(st.adm) : '').toLowerCase();
                const fName = (st.father || st.fatherName || st.profile?.father || '').toLowerCase();
                const fPhone = (st.mobile || st.fatherMobile || st.parentPhone || st.phone || st.profile?.fatherMobile || '').toLowerCase();
                const mName = (st.mother || st.motherName || st.profile?.mother || '').toLowerCase();
                const mPhone = (st.motherMobile || st.profile?.motherMobile || '').toLowerCase();

                return sName.includes(sTerm) ||
                    sAdm.includes(sTerm) ||
                    fName.includes(sTerm) ||
                    fPhone.includes(sTerm) ||
                    mName.includes(sTerm) ||
                    mPhone.includes(sTerm);
            });
            const matchesFee = String(g.fee || '').includes(sTerm);
            matchSearch = matchesMember || matchesFee;
        }

        return matchClass && matchSearch;
    });

    if (countBadge) {
        if (fCls !== 'all' || sTerm || fSize !== 'all') {
            countBadge.textContent = `Showing ${filteredGroups.length} of ${eligibleGroups.length} Groups`;
        } else {
            countBadge.textContent = `${eligibleGroups.length} Groups`;
        }
    }

    if (filteredGroups.length === 0) {
        listNode.innerHTML = `
            <div class="text-center py-8 px-4 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-gray-500 text-xs">
                <i class="fas fa-users-slash text-gray-400 text-xl mb-1.5 block"></i>
                ${eligibleGroups.length === 0 ? 'No student groups available.' : 'No student groups match the current search or class filter.'}
            </div>
        `;
        resetGrpPagination();
        return;
    }

    const { isAllRows, rowLimit, sliceStart, sliceEnd, nextOffset } = computePaginationSlice(filteredGroups.length, grpPageOffset, rowLimitRaw);
    grpPageOffset = nextOffset;
    const visibleGroups = filteredGroups.slice(sliceStart, sliceEnd);

    listNode.innerHTML = visibleGroups.map((g, gIdx) => {
        const displayGroupNo = sliceStart + gIdx + 1;
        const memberRows = (g.memberIds || []).map((memberId, mIdx) => {
            const student = students.find((entry) => entry.id === memberId) || rawStudents.find((entry) => entry.id === memberId);
            if (!student) {
                return `
                    <tr class="hover:bg-amber-50/50">
                        <td class="py-2.5 px-3 text-center text-gray-400 font-semibold">${mIdx + 1}</td>
                        <td colspan="4" class="py-2.5 px-3 text-amber-600 font-semibold italic text-xs">
                            <i class="fas fa-exclamation-triangle mr-1"></i> Missing student record
                        </td>
                    </tr>
                `;
            }

            const studentName = escapeHtml(student.name || '-');
            const studentClass = escapeHtml(student.class || '--');
            const admNo = escapeHtml(student.adm || '-');

            const fatherName = (student.father || student.fatherName || student.profile?.father || '').trim();
            const fatherPhone = (student.mobile || student.fatherMobile || student.parentPhone || student.phone || student.profile?.fatherMobile || '').trim();
            const motherName = (student.mother || student.motherName || student.profile?.mother || '').trim();
            const motherPhone = (student.motherMobile || student.profile?.motherMobile || '').trim();

            let parentDisplayName = '';
            let parentDisplayPhone = '';

            if (fatherName || fatherPhone) {
                parentDisplayName = fatherName;
                parentDisplayPhone = fatherPhone;
            } else if (motherName || motherPhone) {
                parentDisplayName = motherName;
                parentDisplayPhone = motherPhone;
            }

            return `
                <tr class="hover:bg-blue-50/40 transition-colors">
                    <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-center text-gray-400 font-semibold tabular-nums">${mIdx + 1}</td>
                    <td class="py-1.5 sm:py-2.5 px-2 sm:px-3">
                        <span class="font-bold text-slate-800 text-[11px] sm:text-xs">${studentName}</span>
                    </td>
                    <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-center">
                        <span class="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold text-[10px] sm:text-[11px] border border-blue-200">
                            Class ${studentClass}
                        </span>
                    </td>
                    <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-center">
                        <span class="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-semibold text-[10px] sm:text-[11px] border border-gray-200 tabular-nums">
                            ${admNo}
                        </span>
                    </td>
                    <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs">
                        ${parentDisplayName || parentDisplayPhone ? `
                            <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                <span class="font-bold text-gray-800">${escapeHtml(parentDisplayName || '-')}</span>
                                ${parentDisplayPhone ? `<span class="text-gray-500 font-mono text-[10px] sm:text-[11px] inline-flex items-center gap-1"><i class="fas fa-phone text-[10px] text-gray-400"></i>${escapeHtml(parentDisplayPhone)}</span>` : ''}
                            </div>
                        ` : `<span class="text-gray-400 italic">--</span>`}
                    </td>
                </tr>
            `;
        }).join('');

        const feeAmount = Number(g.fee) || 0;

        return `
            <div class="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden hover:border-blue-300 transition-all">
                <div class="bg-slate-50 px-2.5 py-2 sm:px-3.5 sm:py-2.5 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2">
                    <div class="flex items-center gap-1.5 sm:gap-2.5 flex-wrap">
                        <span class="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] sm:text-xs font-black shadow-2xs">
                            ${displayGroupNo}
                        </span>
                        <h4 class="font-bold text-xs sm:text-sm text-gray-800">Group #${displayGroupNo}</h4>
                        <span class="inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 sm:px-2.5 py-0.5 rounded-full">
                            <i class="fas fa-users text-[10px]"></i> ${(g.memberIds || []).length} Students
                        </span>
                        <span class="inline-flex items-center gap-1 text-[11px] sm:text-xs font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 sm:px-2.5 py-0.5 rounded-md shadow-2xs tabular-nums">
                            ${formatCurrency(feeAmount)}/month
                        </span>
                    </div>

                    ${admin ? `
                        <div class="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                            <button type="button" class="text-blue-600 bg-white hover:bg-blue-50 border border-blue-200 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[11px] sm:text-xs font-bold transition inline-flex items-center gap-1 edit-grp cursor-pointer" data-id="${escapeHtml(g.id)}">
                                <i class="fas fa-edit text-[10px]"></i> Edit
                            </button>
                            <button type="button" class="text-rose-600 bg-white hover:bg-rose-50 border border-rose-200 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[11px] sm:text-xs font-bold transition inline-flex items-center gap-1 del-grp cursor-pointer" data-id="${escapeHtml(g.id)}">
                                <i class="fas fa-trash-alt text-[10px]"></i> Delete
                            </button>
                        </div>
                    ` : ''}
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead class="bg-gray-50/80 text-gray-600 uppercase font-bold text-[10px] tracking-wider border-b border-gray-200">
                            <tr>
                                <th class="py-1.5 sm:py-2 px-2 sm:px-3 w-8 sm:w-10 text-center">#</th>
                                <th class="py-1.5 sm:py-2 px-2 sm:px-3">Student Name</th>
                                <th class="py-1.5 sm:py-2 px-2 sm:px-3 text-center">Class</th>
                                <th class="py-1.5 sm:py-2 px-2 sm:px-3 text-center">Adm No</th>
                                <th class="py-1.5 sm:py-2 px-2 sm:px-3">Parent (Father / Mother)</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${memberRows || '<tr><td colspan="5" class="py-3 text-center text-gray-400 italic">No linked members.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');

    renderSlicePagination({
        el: paginationEl,
        sliceStart,
        sliceEnd,
        totalFiltered: filteredGroups.length,
        rowLimit,
        isAllRows,
        noun: 'groups',
        roundedCard: true,
        onPageChange: (next) => {
            grpPageOffset = next;
            renderStudentGroups();
        }
    });
};

const populateExistingGroupClassFilter = () => {
    const classFilter = document.getElementById('grp-class-filter');
    if (!classFilter) return;
    const validClasses = getScopedClasses();
    if (!isUserAdmin() && validClasses.length === 0) {
        populateClassSelect(classFilter, [], {
            selectedValue: '',
            includeAllOption: false,
            placeholder: 'No classes assigned'
        });
        return;
    }
    let curVal = classFilter.value ?? '';
    if (!isUserAdmin() && curVal && curVal !== 'all' && !isDutyClassMatch(curVal)) {
        curVal = '';
    }
    populateClassSelect(classFilter, validClasses, {
        selectedValue: curVal,
        includeAllOption: true,
        allOptionLabel: 'All Classes',
        allOptionValue: 'all',
        placeholder: '-- Select Class --'
    });
};

const populateExistingGroupSizeFilter = (uniqueGroups = []) => {
    const sizeSelect = document.getElementById('filter-groups-size');
    if (!sizeSelect) return;
    const curVal = sizeSelect.value || 'all';

    const sizeCounts = {};
    (uniqueGroups || []).forEach(g => {
        const sz = (g.memberIds || []).length;
        if (sz >= 2) {
            sizeCounts[sz] = (sizeCounts[sz] || 0) + 1;
        }
    });

    const sortedSizes = Object.keys(sizeCounts).map(Number).sort((a, b) => a - b);
    let optionsHtml = `<option value="all">All Groups</option>`;
    sortedSizes.forEach(sz => {
        optionsHtml += `<option value="${sz}">${sz} Students</option>`;
    });

    sizeSelect.innerHTML = optionsHtml;
    if (curVal && (curVal === 'all' || sortedSizes.includes(Number(curVal)))) {
        sizeSelect.value = curVal;
    }
    syncSmartSelectDisplay(sizeSelect);
};

export const populateConcessionClassFilters = () => {
    const concClassFilter = document.getElementById('filter-conc-class');
    const activeConcClassFilter = document.getElementById('active-conc-class-filter');
    let validClasses = getScopedClasses();
    if (isUserAdmin() && !validClasses.length) {
        const students = ctx.getStudents ? ctx.getStudents() : [];
        validClasses = [...new Set(students.map(s => s.class).filter(isValidCollectionClass))].sort(compareClassLabelsNatural);
    }

    if (!isUserAdmin() && validClasses.length === 0) {
        if (concClassFilter) {
            populateClassSelect(concClassFilter, [], {
                selectedValue: '',
                includeAllOption: false,
                placeholder: 'No classes assigned'
            });
        }
        if (activeConcClassFilter) {
            populateClassSelect(activeConcClassFilter, [], {
                selectedValue: '',
                includeAllOption: false,
                placeholder: 'No classes assigned'
            });
        }
        return;
    }
    if (!validClasses.length) return;

    if (concClassFilter) {
        let curVal = concClassFilter.value ?? '';
        if (!isUserAdmin() && curVal && curVal !== 'all' && !isDutyClassMatch(curVal)) curVal = '';
        populateClassSelect(concClassFilter, validClasses, {
            selectedValue: curVal,
            includeAllOption: true,
            allOptionLabel: 'All Classes',
            allOptionValue: 'all',
            placeholder: '-- Select Class --'
        });
    }

    if (activeConcClassFilter) {
        let curActiveVal = activeConcClassFilter.value ?? '';
        if (!isUserAdmin() && curActiveVal && curActiveVal !== 'all' && !isDutyClassMatch(curActiveVal)) curActiveVal = '';
        populateClassSelect(activeConcClassFilter, validClasses, {
            selectedValue: curActiveVal,
            includeAllOption: true,
            allOptionLabel: 'All Classes',
            allOptionValue: 'all',
            placeholder: '-- Select Class --'
        });
    }
};

const matchesGroupGenderFilter = (studentGender, filterGender) => {
    const f = String(filterGender || 'all').trim().toLowerCase();
    if (!f || f === 'all') return true;
    const g = String(studentGender || '').trim().toLowerCase();
    if (f === 'male') return g === 'male' || g === 'm' || g === 'boy';
    if (f === 'female') return g === 'female' || g === 'f' || g === 'girl';
    return g === f;
};

const renderGroupStudentDatalist = (idx) => {
    const cls = document.querySelector(`.grp-cls[data-idx="${idx}"]`)?.value || 'all';
    const gen = document.querySelector(`.grp-gen[data-idx="${idx}"]`)?.value || 'all';
    const stuSelect = document.getElementById(`grp-stu-${idx}`);
    if (!stuSelect) return;

    const students = ctx.getStudents();
    const alreadySelected = Array.from(document.querySelectorAll('.grp-stu'))
        .filter((el) => String(el.dataset.idx) !== String(idx))
        .map((el) => el.value)
        .filter(Boolean);

    const matches = students
        .filter((s) => (cls === 'all' || s.class === cls) && matchesGroupGenderFilter(s.gender, gen) && !alreadySelected.includes(s.id))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));

    const prevVal = stuSelect.value || '';
    if (matches.length === 0) {
        stuSelect.innerHTML = '<option value="">No eligible students found</option>';
        stuSelect.value = '';
    } else {
        stuSelect.innerHTML = '<option value="">-- Select Student --</option>' +
            matches.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (Class ${escapeHtml(s.class || '--')} · Adm: ${escapeHtml(s.adm || '--')})</option>`).join('');
        stuSelect.value = matches.some((m) => m.id === prevVal) ? prevVal : '';
    }
    syncSmartSelectDisplay(stuSelect);
};

const openUnifyFamilyModal = (creationData) => {
    const modal = document.getElementById('group-unify-family-modal');
    const listContainer = document.getElementById('unify-family-members-list');
    const confirmBtn = document.getElementById('unify-family-confirm-btn');
    if (!modal || !listContainer) return;

    pendingGroupCreationData = creationData;
    const { studentIds, isEdit } = creationData;

    const students = ctx.getStudents();
    const rawStudents = ctx.getRawStudents();
    const groupStudents = studentIds.map((id) => (rawStudents || []).find((s) => s.id === id) || (students || []).find((s) => s.id === id)).filter(Boolean);

    if (groupStudents.length < 2) {
        showToast('Could not load member details for unification.', 'error');
        return;
    }

    if (confirmBtn) {
        confirmBtn.innerHTML = isEdit
            ? '<i class="fas fa-check-circle mr-1"></i> <span>Confirm &amp; Update Group</span>'
            : '<i class="fas fa-check-circle mr-1"></i> <span>Confirm &amp; Save Group</span>';
    }

    // Default option: "Keep individual details as they are (Do not unify)"
    const defaultKeepOption = `
        <label class="unify-option-card block p-3.5 rounded-xl border border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-400 hover:border-emerald-600 transition cursor-pointer relative select-none">
            <div class="flex items-start gap-3">
                <input type="radio" name="unify-option-choice" value="keep" class="unify-option-radio mt-1 w-4 h-4 text-emerald-600 border-slate-300 focus:ring-emerald-500 shrink-0" checked>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-1 pb-1 border-b border-emerald-200">
                        <div class="font-extrabold text-sm text-emerald-950 flex items-center gap-1.5">
                            <i class="fas fa-shield-halved text-emerald-600"></i>
                            <span>Keep individual details as they are (Do not unify)</span>
                        </div>
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white uppercase tracking-wider">Default</span>
                    </div>
                    <p class="mt-1.5 text-xs text-emerald-900 leading-normal">
                        Recommended. Each student retains their own existing parent names, phone numbers, and addresses. Student Group discount will still apply to all members without altering individual profiles.
                    </p>
                </div>
            </div>
        </label>
    `;

    const divider = `
        <div class="pt-2 pb-1 flex items-center gap-2">
            <span class="h-px bg-slate-200 flex-1"></span>
            <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Or unify family details using one sibling's information</span>
            <span class="h-px bg-slate-200 flex-1"></span>
        </div>
    `;

    const memberCards = groupStudents.map((st) => {
        const fatherName = st.father || st.profile?.father || '--';
        const fatherMobile = st.mobile || st.phone || st.profile?.mobile || '--';
        const motherName = st.mother || st.profile?.mother || '--';
        const motherMobile = st.motherMobile || st.profile?.motherMobile || '--';
        const address = st.address || st.profile?.address || '--';
        const className = st.class || st.studentClass || '--';
        const adm = st.adm || '--';

        return `
            <label class="unify-option-card block p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition cursor-pointer relative select-none">
                <div class="flex items-start gap-3">
                    <input type="radio" name="unify-option-choice" value="unify_${st.id}" class="unify-option-radio mt-1 w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500 shrink-0">
                    <div class="flex-1 min-w-0">
                        <div class="flex flex-wrap items-center justify-between gap-1 pb-1.5 border-b border-slate-100">
                            <div class="font-extrabold text-sm text-slate-900">${escapeHtml(st.name)}</div>
                            <div class="text-xs text-slate-500 font-mono">
                                <span>Adm: <b class="text-slate-700">${escapeHtml(adm)}</b></span> · 
                                <span>Class: <b class="text-slate-700">${escapeHtml(className)}</b></span>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-2 text-xs">
                            <div>
                                <span class="text-slate-500 font-medium">Father:</span>
                                <span class="font-bold text-slate-800 ml-1">${escapeHtml(fatherName)}</span>
                            </div>
                            <div>
                                <span class="text-slate-500 font-medium">Father Phone:</span>
                                <span class="font-bold font-mono text-slate-800 ml-1">${escapeHtml(fatherMobile)}</span>
                            </div>
                            <div>
                                <span class="text-slate-500 font-medium">Mother:</span>
                                <span class="font-bold text-slate-800 ml-1">${escapeHtml(motherName)}</span>
                            </div>
                            <div>
                                <span class="text-slate-500 font-medium">Mother Phone:</span>
                                <span class="font-bold font-mono text-slate-800 ml-1">${escapeHtml(motherMobile)}</span>
                            </div>
                            <div class="sm:col-span-2">
                                <span class="text-slate-500 font-medium">Address:</span>
                                <span class="font-medium text-slate-800 ml-1">${escapeHtml(address)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </label>
        `;
    }).join('');

    listContainer.innerHTML = defaultKeepOption + divider + memberCards;

    // Attach card active-state styling listeners
    listContainer.querySelectorAll('input[name="unify-option-choice"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            listContainer.querySelectorAll('.unify-option-card').forEach((card) => {
                const r = card.querySelector('input[name="unify-option-choice"]');
                if (r && r.checked) {
                    if (r.value === 'keep') {
                        card.className = 'unify-option-card block p-3.5 rounded-xl border border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-400 hover:border-emerald-600 transition cursor-pointer relative select-none';
                    } else {
                        card.className = 'unify-option-card block p-3.5 rounded-xl border border-blue-500 bg-blue-50/70 ring-2 ring-blue-400 hover:border-blue-600 transition cursor-pointer relative select-none';
                    }
                } else {
                    card.className = 'unify-option-card block p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition cursor-pointer relative select-none';
                }
            });
        });
    });

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.style.display = 'flex';
};

const closeUnifyFamilyModal = () => {
    const modal = document.getElementById('group-unify-family-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
    pendingGroupCreationData = null;
};

const handleConfirmGroupCreation = async () => {
    if (!isUserAdmin()) {
        showToast('Only administrators can create or update student groups.', 'warn');
        closeUnifyFamilyModal();
        return;
    }
    if (!pendingGroupCreationData) return;

    const { studentIds, groupFee, isEdit, groupId } = pendingGroupCreationData;
    const modal = document.getElementById('group-unify-family-modal');
    const confirmBtn = document.getElementById('unify-family-confirm-btn');

    const students = ctx.getStudents();
    const rawStudents = ctx.getRawStudents();
    const groupStudents = studentIds.map((id) => (rawStudents || []).find((s) => s.id === id) || (students || []).find((s) => s.id === id)).filter(Boolean);

    const selectedChoice = modal?.querySelector('input[name="unify-option-choice"]:checked')?.value || 'keep';
    let chosenStudent = null;

    if (selectedChoice.startsWith('unify_')) {
        const targetId = selectedChoice.replace('unify_', '');
        chosenStudent = groupStudents.find((s) => s.id === targetId) || null;
    }

    try {
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> <span>Saving...</span>';
        }

        const batch = writeBatch(db);
        const nowTs = Date.now();

        // 1. Unify parent details ONLY if a specific sibling was chosen (not 'keep')
        if (chosenStudent) {
            const father = (chosenStudent.father || chosenStudent.profile?.father || '').toUpperCase().trim();
            const mobile = (chosenStudent.mobile || chosenStudent.phone || chosenStudent.profile?.mobile || '').trim();
            const mother = (chosenStudent.mother || chosenStudent.profile?.mother || '').toUpperCase().trim();
            const motherMobile = (chosenStudent.motherMobile || chosenStudent.profile?.motherMobile || '').trim();
            const address = (chosenStudent.address || chosenStudent.profile?.address || '').trim();

            groupStudents.forEach((st) => {
                const stRef = doc(db, `${BASE_PATH}/students`, st.id);
                batch.update(stRef, {
                    father,
                    mobile,
                    mother,
                    motherMobile,
                    address,
                    'profile.father': father,
                    'profile.mobile': mobile,
                    'profile.mother': mother,
                    'profile.motherMobile': motherMobile,
                    'profile.address': address,
                    updatedAt: new Date().toISOString()
                });
            });
        }

        if (isEdit && groupId) {
            const groupRef = doc(db, `${BASE_PATH}/studentGroups`, groupId);
            batch.update(groupRef, {
                memberIds: studentIds,
                fee: groupFee,
                updatedAt: nowTs
            });
            await batch.commit();
            const auditMsg = chosenStudent
                ? `Student group updated: ${studentIds.length} members. Fee: ₹${groupFee}. Family details unified from ${chosenStudent.name}.`
                : `Student group updated: ${studentIds.length} members. Fee: ₹${groupFee}. Individual details preserved (no unification).`;
            await logAudit('group', 'group.update', 'studentGroup', groupId, auditMsg);
            closeUnifyFamilyModal();
            showToast('Student group updated successfully!', 'success');
        } else {
            const groupRef = doc(collection(db, `${BASE_PATH}/studentGroups`));
            batch.set(groupRef, {
                academicYear: ctx.getAcademicYear(),
                memberIds: studentIds,
                fee: groupFee,
                createdAt: nowTs,
                updatedAt: nowTs
            });
            await batch.commit();
            const auditMsg = chosenStudent
                ? `Student group created: ${studentIds.length} members. Fee: ₹${groupFee}. Family details unified from ${chosenStudent.name}.`
                : `Student group created: ${studentIds.length} members. Fee: ₹${groupFee}. Individual details preserved (no unification).`;
            await logAudit('group', 'group.create', 'studentGroup', groupRef.id, auditMsg);
            closeUnifyFamilyModal();

            // Clear inputs
            const numInput = document.getElementById('num-of-students-group');
            const feeInput = document.getElementById('group-monthly-fee');
            if (numInput) numInput.value = '';
            if (feeInput) feeInput.value = '';
            const cont = document.getElementById('group-creation-container');
            if (cont) cont.innerHTML = '';
            document.getElementById('create-group-btn-container')?.classList.add('hidden');

            showToast('Student group created successfully!', 'success');
        }

        renderStudentGroups();
    } catch (err) {
        console.error('Failed to save student group:', err);
        showToast('Failed to save student group: ' + err.message, 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-check-circle mr-1"></i> <span>Confirm &amp; Save Group</span>';
        }
    }
};

// =========================================================================
// 3. FEE CONCESSIONS CONTROLLER
// =========================================================================

export const renderConcessionsList = () => {
    applyFinanceSettingsAccessUI();
    populateConcessionClassFilters();
    renderActiveConcessionsList();

    if (!isUserAdmin()) return;

    const fCls = document.getElementById('filter-conc-class')?.value || '';
    const sTerm = (document.getElementById('search-conc-input')?.value || '').trim().toLowerCase();
    const rowLimitRaw = document.getElementById('conc-search-row-limit')?.value || '25';
    const cont = document.getElementById('conc-list-container');
    const emptyState = document.getElementById('conc-list-empty');
    const paginationEl = document.getElementById('conc-list-pagination');
    const resetConcSearchPagination = () => {
        if (paginationEl) {
            paginationEl.className = 'hidden';
            paginationEl.innerHTML = '';
        }
    };

    if (!cont || !emptyState) return;

    if (!fCls && !sTerm) {
        emptyState.classList.remove('hidden');
        cont.classList.add('hidden');
        resetConcSearchPagination();
        return;
    }
    emptyState.classList.add('hidden');
    cont.classList.remove('hidden');

    const students = ctx.getStudents();
    const fil = students.filter((s) => {
        let match = true;
        if (fCls && fCls !== 'all') match = match && s.class === fCls;
        if (sTerm) match = match && ((s.name || '').toLowerCase().includes(sTerm) || (s.adm && String(s.adm).toLowerCase().includes(sTerm)));
        return match;
    });

    if (fil.length === 0) {
        cont.innerHTML = '<p class="text-xs text-slate-500 py-4 text-center">No matching students found.</p>';
        resetConcSearchPagination();
        return;
    }

    const { isAllRows, rowLimit, sliceStart, sliceEnd, nextOffset } = computePaginationSlice(fil.length, concSearchPageOffset, rowLimitRaw);
    concSearchPageOffset = nextOffset;
    const visibleStudents = fil.slice(sliceStart, sliceEnd);

    cont.innerHTML = visibleStudents.map((s) => {
        const hasConc = s.concessionFee !== undefined && s.concessionFee !== null && s.concessionFee !== '';
        return `
            <div class="p-2 sm:p-2.5 bg-white border border-slate-200 rounded-lg shadow-2xs hover:border-blue-200 transition flex items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                    <span class="font-bold text-xs text-slate-800 break-words leading-tight block">${escapeHtml(s.name || '-')}</span>
                    <div class="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-500 mt-0.5 sm:mt-1">
                        <span class="font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Class ${escapeHtml(s.class || '--')}</span>
                        <span>•</span>
                        <span>Adm: ${escapeHtml(s.adm || '-')}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1 sm:gap-1.5 shrink-0">
                    ${hasConc ? `<span class="bg-emerald-50 text-emerald-800 text-[10px] sm:text-[11px] font-bold px-1.5 sm:px-2 py-0.5 rounded border border-emerald-200 tabular-nums">₹${escapeHtml(String(s.concessionFee))}</span>` : ''}
                    <button type="button" class="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-2 sm:px-2.5 py-1 rounded-md text-[11px] sm:text-xs transition concession-open-btn cursor-pointer" data-id="${escapeHtml(s.id)}">
                        ${hasConc ? 'Edit' : 'Assign'}
                    </button>
                    ${hasConc ? `<button type="button" class="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-1.5 sm:px-2 py-1 rounded-md text-[11px] sm:text-xs transition concession-delete-btn cursor-pointer" data-id="${escapeHtml(s.id)}"><i class="fas fa-trash-alt text-[10px]"></i></button>` : ''}
                </div>
            </div>
        `;
    }).join('');
    cont.scrollTop = 0;

    renderSlicePagination({
        el: paginationEl,
        sliceStart,
        sliceEnd,
        totalFiltered: fil.length,
        rowLimit,
        isAllRows,
        noun: 'students',
        roundedCard: true,
        onPageChange: (next) => {
            concSearchPageOffset = next;
            renderConcessionsList();
        }
    });
};

const renderActiveConcessionsList = () => {
    populateConcessionClassFilters();
    const admin = isUserAdmin();
    const dutyClasses = getScopedClasses();
    const colSpan = admin ? 6 : 5;

    const cont = document.getElementById('active-concessions-list');
    const badge = document.getElementById('active-conc-count-badge');
    const statusLabel = document.getElementById('active-conc-filter-status');
    const sTerm = (document.getElementById('active-conc-search')?.value || '').trim().toLowerCase();
    const fCls = document.getElementById('active-conc-class-filter')?.value ?? '';
    const rowLimitRaw = document.getElementById('active-conc-row-limit')?.value || '25';
    const paginationEl = document.getElementById('active-conc-pagination');
    const resetActiveConcPagination = () => {
        if (paginationEl) {
            paginationEl.className = 'hidden';
            paginationEl.innerHTML = '';
        }
    };

    if (!cont) return;

    const activeYear = ctx.getAcademicYear?.() || '';
    const students = ctx.getStudents();
    const activeAll = students.filter((s) => s.concessionFee !== undefined && s.concessionFee !== null && s.concessionFee !== '');
    const active = admin
        ? activeAll
        : (dutyClasses.length
            ? activeAll.filter((s) => isDutyClassMatch(getStudentEffectiveClass(s, activeYear)))
            : []);

    if (badge) badge.textContent = String(active.length);

    if (!admin && dutyClasses.length === 0) {
        if (statusLabel) statusLabel.textContent = 'No Duty Classes Assigned';
        cont.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 px-4 text-center text-amber-700 bg-amber-50 font-semibold text-xs"><i class="fas fa-exclamation-circle text-amber-600 text-xl mb-1.5 block"></i>No duty classes assigned to your account. Please ask the administrator to assign duty classes.</td></tr>`;
        resetActiveConcPagination();
        return;
    }

    if (!fCls && !sTerm) {
        if (statusLabel) statusLabel.textContent = 'Select Class or Search';
        cont.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 px-4 text-center text-slate-500 font-medium text-xs"><i class="fas fa-filter text-slate-300 text-xl mb-1.5 block"></i>Please select a class, choose &ldquo;All Classes&rdquo;, or search above to view active concessions.</td></tr>`;
        resetActiveConcPagination();
        return;
    }

    const filtered = active.filter((s) => {
        if (fCls && fCls !== 'all') {
            const stCls = getStudentEffectiveClass(s, activeYear);
            const stNorm = stCls.replace(/^class\s*/i, '').trim().toLowerCase();
            const fNorm = String(fCls).replace(/^class\s*/i, '').trim().toLowerCase();
            if (stCls !== fCls && stNorm !== fNorm) return false;
        }
        if (sTerm) {
            const name = (s.name || '').toLowerCase();
            const adm = (s.adm ? String(s.adm) : '').toLowerCase();
            return name.includes(sTerm) || adm.includes(sTerm);
        }
        return true;
    });

    if (statusLabel) {
        statusLabel.textContent = (fCls !== 'all' || sTerm) ? `Showing ${filtered.length} of ${active.length}` : `Showing All (${active.length})`;
    }

    if (!filtered.length) {
        cont.innerHTML = `<tr><td colspan="${colSpan}" class="p-4 text-center text-slate-400 font-semibold text-xs">No active concessions found.</td></tr>`;
        resetActiveConcPagination();
        return;
    }

    const { isAllRows, rowLimit, sliceStart, sliceEnd, nextOffset } = computePaginationSlice(filtered.length, activeConcPageOffset, rowLimitRaw);
    activeConcPageOffset = nextOffset;
    const visibleActive = filtered.slice(sliceStart, sliceEnd);

    cont.innerHTML = visibleActive.map((s, idx) => `
        <tr class="hover:bg-slate-50 transition">
            <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-center text-slate-400 font-semibold tabular-nums">${sliceStart + idx + 1}</td>
            <td class="py-1.5 sm:py-2.5 px-2 sm:px-3">
                <span class="font-bold text-slate-800 text-[11px] sm:text-xs">${escapeHtml(s.name || '-')}</span>
            </td>
            <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-center">
                <span class="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-200">${escapeHtml(s.class || '--')}</span>
            </td>
            <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-center font-mono font-bold text-slate-700 tabular-nums">${escapeHtml(s.adm || '-')}</td>
            <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-right font-extrabold text-emerald-700 tabular-nums">₹${escapeHtml(String(s.concessionFee))}</td>
            ${admin ? `
                <td class="py-1.5 sm:py-2.5 px-2 sm:px-3 text-center whitespace-nowrap">
                    <button type="button" class="p-1 sm:p-1.5 rounded-lg text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition concession-open-btn cursor-pointer mr-0.5 sm:mr-1" data-id="${escapeHtml(s.id)}" title="Edit Concession"><i class="fas fa-edit"></i></button>
                    <button type="button" class="p-1 sm:p-1.5 rounded-lg text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition concession-delete-btn cursor-pointer" data-id="${escapeHtml(s.id)}" title="Remove Concession"><i class="fas fa-trash-alt"></i></button>
                </td>
            ` : ''}
        </tr>
    `).join('');

    renderSlicePagination({
        el: paginationEl,
        sliceStart,
        sliceEnd,
        totalFiltered: filtered.length,
        rowLimit,
        isAllRows,
        noun: 'concessions',
        roundedCard: false,
        onPageChange: (next) => {
            activeConcPageOffset = next;
            renderActiveConcessionsList();
        }
    });
};

const openConcModal = (studentId) => {
    if (!isUserAdmin()) {
        showToast('Only administrators can edit fee concessions.', 'warn');
        return;
    }
    const students = ctx.getStudents();
    const s = students.find((st) => st.id === studentId);
    if (!s) return;

    document.getElementById('conc-student-id').value = s.id;
    document.getElementById('conc-student-name').textContent = `${s.name} (Class: ${s.class || '--'}, Adm: ${s.adm || '--'})`;
    document.getElementById('conc-fee-amount').value = (s.concessionFee !== undefined && s.concessionFee !== null) ? s.concessionFee : '';
    const hasConc = s.concessionFee !== undefined && s.concessionFee !== null && s.concessionFee !== '';
    document.getElementById('conc-remove').classList.toggle('hidden', !hasConc);

    const popup = document.getElementById('concession-popup');
    if (popup) {
        popup.classList.remove('hidden');
        popup.classList.add('flex');
    }
};

const closeConcModal = () => {
    const popup = document.getElementById('concession-popup');
    if (popup) {
        popup.classList.add('hidden');
        popup.classList.remove('flex');
    }
};

// =========================================================================
// 4. MODULE INITIALIZER
// =========================================================================

export const initFinanceManagementModule = (stateContext) => {
    ctx = { ...ctx, ...stateContext };

    // --- Number Range Validation (1 to 31) for Collection Days ---
    const startInput = document.getElementById('fee-collect-start-day');
    const endInput = document.getElementById('fee-collect-end-day');
    if (startInput && !startInput.value) startInput.value = '1';
    if (endInput && !endInput.value) endInput.value = '10';

    [startInput, endInput].forEach((inp) => {
        inp?.addEventListener('input', () => {
            if (inp.value === '') return;
            let val = parseInt(inp.value, 10);
            if (isNaN(val)) inp.value = '';
            else if (val > 31) inp.value = 31;
            else if (val < 1 && inp.value.length > 0) inp.value = 1;
        });
        inp?.addEventListener('blur', () => {
            let val = parseInt(inp.value, 10);
            if (isNaN(val) || val < 1) inp.value = inp.id.includes('start') ? '1' : '10';
            else if (val > 31) inp.value = 31;
            updateFeeScheduleSummary();
        });
    });

    // --- Fee Settings Listeners ---
    document.getElementById('save-fee-config-btn')?.addEventListener('click', saveFeeConfiguration);

    ['fee-collect-start-day', 'fee-collect-end-day', 'fee-notify-mode', 'fee-notify-days-before'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', updateFeeScheduleSummary);
        document.getElementById(id)?.addEventListener('input', updateFeeScheduleSummary);
    });

    document.getElementById('fee-notify-mode')?.addEventListener('change', (e) => {
        const val = e.target.value;
        const daysContainer = document.getElementById('fee-notify-days-container');
        if (daysContainer) {
            daysContainer.classList.toggle('hidden', !['days_before_end', 'days_before_month_end'].includes(val));
        }
    });

    // --- Advanced Fee Builder Scope Toggle ---
    document.getElementById('adv-fee-scope')?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!isUserAdmin() && val === 'global') {
            syncAdvFeeScopeOptionsAndInputs();
            return;
        }
        document.getElementById('scope-global-container')?.classList.toggle('hidden', val !== 'global');
        document.getElementById('scope-class-wise-container')?.classList.toggle('hidden', val !== 'class-wise');
        document.getElementById('scope-specific-container')?.classList.toggle('hidden', val !== 'specific');

        const scopedClasses = getScopedClasses();
        if (val === 'class-wise') {
            const inputsCont = document.getElementById('class-wise-inputs');
            if (inputsCont) {
                inputsCont.innerHTML = scopedClasses.map((c) => `<div><label class="block text-xs font-bold text-gray-600 mb-1">${escapeHtml(c)}</label><input type="number" data-class="${escapeHtml(c)}" class="cw-input w-full p-2 border rounded text-sm font-medium"></div>`).join('');
            }
        }
        if (val === 'specific') {
            const targetSelect = document.getElementById('adv-fee-specific-class');
            if (targetSelect) {
                if (scopedClasses.length === 0) {
                    populateClassSelect(targetSelect, [], {
                        selectedValue: '',
                        placeholder: 'No classes assigned',
                        includeAllOption: false
                    });
                } else {
                    populateClassSelect(targetSelect, scopedClasses, {
                        selectedValue: scopedClasses.includes(targetSelect.value) ? targetSelect.value : '',
                        placeholder: '-- Select Class --',
                        includeAllOption: false
                    });
                }
            }
        }
    });

    document.getElementById('add-adv-fee-btn')?.addEventListener('click', async () => {
        const admin = isUserAdmin();
        const dutyClasses = getScopedClasses();
        if (!admin && dutyClasses.length === 0) {
            return showToast('No duty classes assigned to your account.', 'warn');
        }

        const nameInput = document.getElementById('adv-fee-name');
        const scopeSelect = document.getElementById('adv-fee-scope');
        const name = (nameInput?.value || '').trim();
        const scope = scopeSelect?.value || (admin ? 'global' : 'specific');
        if (!name) return showToast('Fee item name is required.', 'warn');
        if (!admin && scope === 'global') {
            return showToast('Only administrators can create Global fee items.', 'warn');
        }

        const key = `custom_fee_${Date.now()}`;
        const newFee = {
            key,
            name,
            type: 'custom',
            scope,
            isVisible: true,
            isReceiptMandatory: !!document.getElementById('adv-fee-receipt-req')?.checked,
            academicYear: ctx.getAcademicYear(),
            createdAt: new Date().toISOString(),
            timestamp: Date.now()
        };

        if (scope === 'global') {
            const amt = parseFloat(document.getElementById('adv-fee-global-amt')?.value);
            if (isNaN(amt) || amt < 0) return showToast('Please enter a valid global amount.', 'warn');
            newFee.amount = amt;
        } else if (scope === 'class-wise') {
            const classAmounts = {};
            document.querySelectorAll('.cw-input').forEach((inp) => {
                const amt = parseFloat(inp.value);
                const cls = inp.dataset.class;
                if (!isNaN(amt) && cls && (admin || isDutyClassMatch(cls))) {
                    classAmounts[cls] = amt;
                }
            });
            if (Object.keys(classAmounts).length === 0) return showToast('Enter amount for at least one assigned class.', 'warn');
            newFee.classValues = classAmounts;
        } else if (scope === 'specific') {
            const targetClass = document.getElementById('adv-fee-specific-class')?.value;
            const amt = parseFloat(document.getElementById('adv-fee-specific-amt')?.value);
            if (!targetClass || isNaN(amt)) return showToast('Select class and enter valid amount.', 'warn');
            if (!admin && !isDutyClassMatch(targetClass)) {
                return showToast('You can only add fee items for your assigned duty classes.', 'warn');
            }
            newFee.targetClass = targetClass;
            newFee.amount = amt;
        }

        try {
            const feeItems = ctx.getFeeItems();
            const nextItems = [...feeItems, newFee];
            await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), { feeItems: nextItems }, { merge: true });
            await logAudit('fee', 'fee.create', 'feeItem', key, `Custom fee item created: ${name}.`);

            nameInput.value = '';
            const globalAmtInput = document.getElementById('adv-fee-global-amt');
            if (globalAmtInput) globalAmtInput.value = '';
            const specAmtInput = document.getElementById('adv-fee-specific-amt');
            if (specAmtInput) specAmtInput.value = '';
            document.querySelectorAll('.cw-input').forEach((inp) => { inp.value = ''; });
            renderFeeItemsManagement();
            showToast(`Fee item "${name}" created!`, 'success');
        } catch (err) {
            console.error('Failed to create fee item:', err);
            showToast('Failed to create fee item: ' + (err.message || 'Network error'), 'error');
        }
    });

    const renderEditFeeScopeSection = (scope, existingItem = null) => {
        const admin = isUserAdmin();
        const safeScope = (!admin && scope === 'global') ? 'specific' : scope;
        document.getElementById('e-scope-global-container')?.classList.toggle('hidden', !admin || safeScope !== 'global');
        document.getElementById('e-scope-class-wise-container')?.classList.toggle('hidden', safeScope !== 'class-wise');
        document.getElementById('e-scope-specific-container')?.classList.toggle('hidden', safeScope !== 'specific');

        const scopedClasses = getScopedClasses();
        if (safeScope === 'global') {
            const amtEl = document.getElementById('e-fee-global-amt');
            if (amtEl && existingItem) amtEl.value = existingItem.amount || '';
        } else if (safeScope === 'class-wise') {
            const inputsEl = document.getElementById('e-class-wise-inputs');
            if (inputsEl) {
                inputsEl.innerHTML = scopedClasses.map((c) => {
                    const existingVal = existingItem?.classValues?.[c] ?? '';
                    return `<div><label class="block text-xs font-bold text-gray-600 mb-1">${escapeHtml(c)}</label><input type="number" data-class="${escapeHtml(c)}" class="e-cw-input w-full p-2 border rounded text-sm font-medium" value="${escapeHtml(String(existingVal))}"></div>`;
                }).join('');
            }
        } else if (safeScope === 'specific') {
            const specificSelect = document.getElementById('e-fee-specific-class');
            if (specificSelect) {
                const candidateVal = existingItem ? (existingItem.targetClass || '') : (specificSelect.value || '');
                const safeTarget = scopedClasses.includes(candidateVal) ? candidateVal : '';
                populateClassSelect(specificSelect, scopedClasses, {
                    selectedValue: safeTarget,
                    placeholder: '-- Select Class --',
                    includeAllOption: false
                });
            }
            const amtEl = document.getElementById('e-fee-specific-amt');
            if (amtEl && existingItem) amtEl.value = existingItem.amount || '';
        }
    };

    document.getElementById('e-fee-scope')?.addEventListener('change', (e) => {
        const key = document.getElementById('e-fee-key')?.value;
        const item = ctx.getFeeItems().find((i) => i.key === key) || null;
        if (!isUserAdmin() && e.target.value === 'global') {
            e.target.value = 'specific';
            syncSmartSelectDisplay(e.target);
        }
        renderEditFeeScopeSection(e.target.value, item);
    });

    const closeEditFeeModal = () => {
        document.getElementById('edit-fee-popup')?.classList.add('hidden');
        document.getElementById('edit-fee-popup')?.classList.remove('flex');
    };

    document.getElementById('edit-fee-popup')?.addEventListener('click', (e) => {
        if (e.target.id === 'edit-fee-popup') closeEditFeeModal();
    });

    // --- Fee Items Container Delegated Click ---
    document.getElementById('fee-items-management-container')?.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('.del-fee');
        const editBtn = e.target.closest('.edit-fee');
        const feeItems = ctx.getFeeItems();

        if (delBtn) {
            const key = delBtn.dataset.key;
            const item = feeItems.find((i) => i.key === key);
            if (!canManageFeeItem(item)) {
                showToast('You can only delete custom fee items belonging to your assigned duty classes.', 'warn');
                return;
            }
            const confirmed = await openConfirmDialog({
                title: 'Delete Fee Item',
                message: 'Permanently delete this fee item?',
                okLabel: 'Delete',
                danger: true
            });
            if (!confirmed) return;
            try {
                const nextItems = feeItems.filter((i) => i.key !== key);
                await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), { feeItems: nextItems }, { merge: true });
                await logAudit('fee', 'fee.delete', 'feeItem', key, `Fee item deleted: ${key}.`);
                renderFeeItemsManagement();
                showToast('Fee item deleted.', 'info');
            } catch (err) {
                console.error('Failed to delete fee item:', err);
                showToast('Failed to delete fee item: ' + (err.message || 'Network error'), 'error');
            }
        }

        if (editBtn) {
            const key = editBtn.dataset.key;
            const item = feeItems.find((i) => i.key === key);
            if (!item || !canManageFeeItem(item)) {
                showToast('You can only edit custom fee items belonging to your assigned duty classes.', 'warn');
                return;
            }

            const admin = isUserAdmin();
            const scopedClasses = getScopedClasses();
            document.getElementById('e-fee-key').value = item.key;
            document.getElementById('e-fee-name').value = item.name;
            const itemScope = (!admin && item.scope === 'global') ? 'specific' : (item.scope || 'global');
            const scopeEl = document.getElementById('e-fee-scope');
            if (scopeEl) {
                if (admin) {
                    scopeEl.innerHTML = `
                        <option value="global">Global (Same for all classes)</option>
                        <option value="class-wise">Class-wise (Different for each)</option>
                        <option value="specific">Specific Class Only</option>
                    `;
                } else {
                    let opts = '';
                    if (scopedClasses.length > 1) {
                        opts += '<option value="class-wise">Class-wise (Assigned Duty Classes)</option>';
                    }
                    opts += '<option value="specific">Specific Class Only</option>';
                    scopeEl.innerHTML = opts;
                }
                scopeEl.value = (!admin && itemScope === 'class-wise' && scopedClasses.length <= 1) ? 'specific' : itemScope;
                syncSmartSelectDisplay(scopeEl);
            }
            document.getElementById('e-fee-receipt-req').checked = !!item.isReceiptMandatory;

            renderEditFeeScopeSection(scopeEl?.value || itemScope, item);

            const modal = document.getElementById('edit-fee-popup');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        }
    });

    document.getElementById('e-fee-cancel')?.addEventListener('click', closeEditFeeModal);

    document.getElementById('e-fee-update')?.addEventListener('click', async () => {
        const key = document.getElementById('e-fee-key').value;
        const feeItems = ctx.getFeeItems();
        const existing = feeItems.find((f) => f.key === key);
        if (!existing || !canManageFeeItem(existing)) {
            showToast('You do not have permission to modify this fee item.', 'warn');
            closeEditFeeModal();
            return;
        }

        const admin = isUserAdmin();
        const name = (document.getElementById('e-fee-name').value || '').trim();
        const scope = document.getElementById('e-fee-scope').value;
        if (!name) return showToast('Fee item name is mandatory.', 'warn');
        if (!admin && scope === 'global') {
            return showToast('Only administrators can configure Global fee items.', 'warn');
        }

        const updated = {
            ...existing,
            key,
            name,
            type: 'custom',
            scope,
            isVisible: true,
            isReceiptMandatory: !!document.getElementById('e-fee-receipt-req')?.checked,
            academicYear: existing.academicYear || ctx.getAcademicYear(),
            updatedAt: new Date().toISOString()
        };

        if (scope === 'global') {
            const amt = parseFloat(document.getElementById('e-fee-global-amt')?.value);
            if (isNaN(amt) || amt < 0) return showToast('Enter a valid amount.', 'warn');
            updated.amount = amt;
        } else if (scope === 'class-wise') {
            const classAmounts = {};
            document.querySelectorAll('.e-cw-input').forEach((inp) => {
                const amt = parseFloat(inp.value);
                const cls = inp.dataset.class;
                if (!isNaN(amt) && cls && (admin || isDutyClassMatch(cls))) {
                    classAmounts[cls] = amt;
                }
            });
            if (Object.keys(classAmounts).length === 0) return showToast('Enter amount for at least one assigned class.', 'warn');
            updated.classValues = classAmounts;
            delete updated.targetClass;
            delete updated.amount;
        } else if (scope === 'specific') {
            const targetCls = document.getElementById('e-fee-specific-class')?.value;
            const amt = parseFloat(document.getElementById('e-fee-specific-amt')?.value);
            if (!targetCls || isNaN(amt)) return showToast('Select class and enter valid amount.', 'warn');
            if (!admin && !isDutyClassMatch(targetCls)) {
                return showToast('You can only assign fee items to your duty classes.', 'warn');
            }
            updated.targetClass = targetCls;
            updated.amount = amt;
            delete updated.classValues;
        }

        try {
            const nextFees = feeItems.map((f) => f.key === key ? updated : f);
            await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), { feeItems: nextFees }, { merge: true });
            await logAudit('fee', 'fee.update', 'feeItem', key, `Fee item updated: ${name}.`);

            closeEditFeeModal();
            renderFeeItemsManagement();
            showToast(`Fee item "${name}" updated!`, 'success');
        } catch (err) {
            console.error('Failed to update fee item:', err);
            showToast('Failed to update fee item: ' + (err.message || 'Network error'), 'error');
        }
    });

    // --- Student Group Form Listeners ---
    document.getElementById('num-of-students-group')?.addEventListener('input', (e) => {
        const count = parseInt(e.target.value, 10) || 0;
        const cont = document.getElementById('group-creation-container');
        if (!cont) return;
        cont.innerHTML = '';
        document.getElementById('create-group-btn-container')?.classList.toggle('hidden', count < 2);
        if (count < 2) return;

        const classes = [...(ctx.getClasses() || [])].sort(compareClassLabelsNatural);
        const clsOpts = '<option value="all" selected>All Classes</option>' + classes.map((c) => {
            const clean = String(c || '').trim();
            const lbl = clean.toLowerCase().startsWith('class') ? clean : `Class: ${clean}`;
            return `<option value="${escapeHtml(c)}">${escapeHtml(lbl)}</option>`;
        }).join('');

        for (let i = 0; i < count; i++) {
            cont.innerHTML += `
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 pb-4 border-b border-gray-100 mb-2">
                    <div class="sm:col-span-2">
                        <select id="grp-cls-${i}" data-smart-select="true" class="grp-cls p-2.5 border rounded-lg bg-gray-50 text-sm font-semibold" data-idx="${i}">${clsOpts}</select>
                    </div>
                    <div>
                        <select id="grp-gen-${i}" data-smart-select="true" class="grp-gen p-2.5 border rounded-lg bg-gray-50 text-sm font-semibold" data-idx="${i}"><option value="all" selected>All</option><option value="Male">Male</option><option value="Female">Female</option></select>
                    </div>
                    <div class="col-span-2 sm:col-span-3">
                        <select id="grp-stu-${i}" data-smart-select="true" data-smart-floating="true" data-smart-search="true" data-smart-placeholder="Type student name or Adm No..." class="grp-stu p-2.5 border rounded-lg text-sm font-semibold bg-white w-full" data-idx="${i}">
                            <option value="">-- Select Student --</option>
                        </select>
                        <p class="text-xs text-gray-500 mt-1">Type student name or admission no. to search, or filter by class and gender.</p>
                    </div>
                </div>
            `;
        }
        enableSmartSelectWindowing(cont, { visibleCount: 0 });
        for (let i = 0; i < count; i++) {
            renderGroupStudentDatalist(i);
        }
    });

    document.getElementById('group-creation-container')?.addEventListener('change', (e) => {
        if (e.target.classList.contains('grp-cls') || e.target.classList.contains('grp-gen')) {
            const idx = e.target.dataset.idx;
            const stuSelect = document.getElementById(`grp-stu-${idx}`);
            if (stuSelect) {
                stuSelect.value = '';
            }
            renderGroupStudentDatalist(idx);
        } else if (e.target.classList.contains('grp-stu')) {
            const changedIdx = String(e.target.dataset.idx || '');
            document.querySelectorAll('.grp-stu').forEach((el) => {
                if (String(el.dataset.idx || '') !== changedIdx) {
                    renderGroupStudentDatalist(el.dataset.idx);
                }
            });
        }
    });

    document.getElementById('create-group-btn')?.addEventListener('click', () => {
        if (!isUserAdmin()) {
            showToast('Only administrators can create student groups.', 'warn');
            return;
        }
        const studentSelects = Array.from(document.querySelectorAll('.grp-stu'));
        const studentIds = studentSelects.map((sel) => sel.value).filter(Boolean);
        const feeInput = document.getElementById('group-monthly-fee');
        const groupFee = parseFloat(feeInput?.value);

        if (studentIds.length < 2) {
            return showToast('Please select at least 2 valid students from the dropdown.', 'warn');
        }

        const uniqueIds = [...new Set(studentIds)];
        if (uniqueIds.length !== studentIds.length) {
            return showToast('Duplicate students selected in group. Each student must be unique.', 'warn');
        }

        if (isNaN(groupFee) || groupFee <= 0) {
            showToast('Please enter a valid Group Monthly Fee.', 'warn');
            feeInput?.focus();
            return;
        }

        openUnifyFamilyModal({
            studentIds: uniqueIds,
            groupFee,
            isEdit: false
        });
    });

    document.getElementById('unify-family-modal-close')?.addEventListener('click', closeUnifyFamilyModal);
    document.getElementById('unify-family-cancel-btn')?.addEventListener('click', closeUnifyFamilyModal);
    document.getElementById('unify-family-confirm-btn')?.addEventListener('click', handleConfirmGroupCreation);

    // Existing groups filters
    const handleGroupFilterChange = () => {
        grpPageOffset = 0;
        renderStudentGroups();
    };
    document.getElementById('grp-search-input')?.addEventListener('input', handleGroupFilterChange);
    document.getElementById('grp-class-filter')?.addEventListener('change', handleGroupFilterChange);
    document.getElementById('filter-groups-size')?.addEventListener('change', handleGroupFilterChange);
    document.getElementById('grp-row-limit')?.addEventListener('change', handleGroupFilterChange);

    const closeEditGroupModal = () => {
        document.getElementById('edit-group-popup')?.classList.add('hidden');
        document.getElementById('edit-group-popup')?.classList.remove('flex');
    };

    document.getElementById('edit-group-popup')?.addEventListener('click', (e) => {
        if (e.target.id === 'edit-group-popup') closeEditGroupModal();
    });

    // Existing groups delegated actions (Edit / Delete)
    document.getElementById('student-groups-list')?.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('.del-grp');
        const editBtn = e.target.closest('.edit-grp');
        if ((delBtn || editBtn) && !isUserAdmin()) {
            showToast('Only administrators can modify student groups.', 'warn');
            return;
        }

        if (delBtn) {
            const gid = delBtn.dataset.id;
            const confirmed = await openConfirmDialog({
                title: 'Delete Student Group',
                message: 'Permanently delete this student group?',
                okLabel: 'Delete',
                danger: true
            });
            if (!confirmed) return;
            try {
                await deleteDoc(doc(db, `${BASE_PATH}/studentGroups`, gid));
                await logAudit('group', 'group.delete', 'studentGroup', gid, 'Student group deleted.');
                renderStudentGroups();
                showToast('Student group deleted.', 'info');
            } catch (err) {
                console.error('Failed to delete student group:', err);
                showToast('Failed to delete student group: ' + (err.message || 'Network error'), 'error');
            }
        }

        if (editBtn) {
            const gid = editBtn.dataset.id;
            const groups = ctx.getStudentGroups();
            const g = groups.find((gr) => gr.id === gid);
            if (!g) return;

            document.getElementById('e-grp-id').value = g.id;
            document.getElementById('e-grp-fee').value = g.fee || '';
            editGroupWorkingMembers = [...(g.memberIds || [])];

            const classFilter = document.getElementById('e-grp-class-filter');
            if (classFilter) {
                const classes = ctx.getClasses();
                populateClassSelect(classFilter, classes, {
                    selectedValue: 'all',
                    includeAllOption: true,
                    allOptionLabel: 'All Classes',
                    allOptionValue: 'all'
                });
            }
            const genderFilter = document.getElementById('e-grp-gender-filter');
            if (genderFilter) {
                genderFilter.value = 'all';
                syncSmartSelectDisplay(genderFilter);
            }

            renderEditGroupMembers();
            populateEditGroupStudentDatalist();

            const modal = document.getElementById('edit-group-popup');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        }
    });

    const renderEditGroupMembers = () => {
        const cont = document.getElementById('e-grp-members');
        if (!cont) return;
        const students = ctx.getStudents();
        const rawStudents = ctx.getRawStudents();

        cont.innerHTML = editGroupWorkingMembers.length
            ? editGroupWorkingMembers.map((sid) => {
                const s = students.find((st) => st.id === sid) || rawStudents.find((st) => st.id === sid);
                if (!s) return '';
                return `
                    <div class="flex items-center justify-between bg-white border border-gray-200 px-2 py-1.5 rounded">
                        <span class="text-sm font-medium text-gray-700">${escapeHtml(s.name || '-')} <span class="text-xs text-gray-500">(Class ${escapeHtml(s.class || '--')})</span></span>
                        <button type="button" class="text-red-600 hover:text-red-800 text-xs font-bold e-grp-remove-member cursor-pointer" data-id="${escapeHtml(s.id)}"><i class="fas fa-times mr-1"></i>Remove</button>
                    </div>
                `;
            }).join('')
            : '<p class="text-sm italic text-gray-500">No members in this group.</p>';
    };

    document.getElementById('e-grp-members')?.addEventListener('click', (e) => {
        const rem = e.target.closest('.e-grp-remove-member');
        if (rem) {
            editGroupWorkingMembers = editGroupWorkingMembers.filter((id) => id !== rem.dataset.id);
            renderEditGroupMembers();
            populateEditGroupStudentDatalist();
        }
    });

    const populateEditGroupStudentDatalist = () => {
        const cls = document.getElementById('e-grp-class-filter')?.value || 'all';
        const gen = document.getElementById('e-grp-gender-filter')?.value || 'all';
        const stuSelect = document.getElementById('e-grp-student-select');
        if (!stuSelect) return;

        const students = ctx.getStudents();
        const matches = students
            .filter((s) => (cls === 'all' || s.class === cls) && matchesGroupGenderFilter(s.gender, gen) && !editGroupWorkingMembers.includes(s.id))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));

        if (matches.length === 0) {
            stuSelect.innerHTML = '<option value="">No eligible students found</option>';
        } else {
            stuSelect.innerHTML = '<option value="">-- Select Student --</option>' +
                matches.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (Class ${escapeHtml(s.class || '--')} · Adm: ${escapeHtml(s.adm || '--')})</option>`).join('');
        }
        stuSelect.value = '';
        syncSmartSelectDisplay(stuSelect);
    };

    document.getElementById('e-grp-class-filter')?.addEventListener('change', () => {
        populateEditGroupStudentDatalist();
    });
    document.getElementById('e-grp-gender-filter')?.addEventListener('change', () => {
        populateEditGroupStudentDatalist();
    });

    document.getElementById('e-grp-add-member')?.addEventListener('click', () => {
        const sel = document.getElementById('e-grp-student-select');
        const studentId = sel?.value || '';
        if (!studentId) return showToast('Please select a student from the dropdown.', 'warn');
        if (editGroupWorkingMembers.includes(studentId)) return showToast('Student already in group.', 'warn');
        editGroupWorkingMembers.push(studentId);
        renderEditGroupMembers();
        populateEditGroupStudentDatalist();
    });

    document.getElementById('edit-group-cancel')?.addEventListener('click', closeEditGroupModal);

    document.getElementById('edit-group-update')?.addEventListener('click', () => {
        if (!isUserAdmin()) {
            showToast('Only administrators can update student groups.', 'warn');
            closeEditGroupModal();
            return;
        }
        const gid = document.getElementById('e-grp-id')?.value;
        const feeVal = document.getElementById('e-grp-fee')?.value;
        const gfee = parseFloat(feeVal);

        if (editGroupWorkingMembers.length < 2) {
            return showToast('Group must contain at least 2 members.', 'warn');
        }

        if (isNaN(gfee) || gfee <= 0) {
            return showToast('Please enter a valid monthly fee.', 'warn');
        }

        closeEditGroupModal();

        openUnifyFamilyModal({
            isEdit: true,
            groupId: gid,
            studentIds: [...editGroupWorkingMembers],
            groupFee: gfee
        });
    });

    // --- Fee Concessions Listeners ---
    const handleConcSearchFilterChange = () => {
        concSearchPageOffset = 0;
        renderConcessionsList();
    };
    const handleActiveConcFilterChange = () => {
        activeConcPageOffset = 0;
        renderActiveConcessionsList();
    };
    document.getElementById('filter-conc-class')?.addEventListener('change', handleConcSearchFilterChange);
    document.getElementById('conc-search-row-limit')?.addEventListener('change', handleConcSearchFilterChange);
    document.getElementById('search-conc-input')?.addEventListener('input', handleConcSearchFilterChange);
    document.getElementById('active-conc-search')?.addEventListener('input', handleActiveConcFilterChange);
    document.getElementById('active-conc-class-filter')?.addEventListener('change', handleActiveConcFilterChange);
    document.getElementById('active-conc-row-limit')?.addEventListener('change', handleActiveConcFilterChange);

    // Populate concession class filter dropdowns & sync View Mode UI
    populateConcessionClassFilters();
    applyFinanceSettingsAccessUI();

    document.getElementById('fee-concessions-page')?.addEventListener('click', async (e) => {
        const openBtn = e.target.closest('.concession-open-btn');
        const delBtn = e.target.closest('.concession-delete-btn');
        if ((openBtn || delBtn) && !isUserAdmin()) {
            showToast('Only administrators can modify fee concessions.', 'warn');
            return;
        }

        if (openBtn) {
            openConcModal(openBtn.dataset.id);
        }

        if (delBtn) {
            const sid = delBtn.dataset.id;
            const confirmed = await openConfirmDialog({
                title: 'Remove Concession',
                message: 'Remove fee concession for this student?',
                okLabel: 'Remove',
                danger: true
            });
            if (!confirmed) return;
            try {
                await updateDoc(doc(db, `${BASE_PATH}/students`, sid), { concessionFee: null, concessionUpdatedAt: Date.now() });
                const s = ctx.getStudents().find((st) => st.id === sid);
                if (s) s.concessionFee = null;
                await logAudit('fee', 'concession.remove', 'student', sid, 'Concession removed.');
                renderConcessionsList();
                showToast('Fee concession removed.', 'info');
            } catch (err) {
                console.error('Failed to remove concession:', err);
                showToast('Failed to remove concession: ' + (err.message || 'Network error'), 'error');
            }
        }
    });

    document.getElementById('conc-cancel')?.addEventListener('click', closeConcModal);
    document.getElementById('concession-popup')?.addEventListener('click', (e) => {
        if (e.target.id === 'concession-popup') closeConcModal();
    });

    document.getElementById('conc-save')?.addEventListener('click', async () => {
        if (!isUserAdmin()) {
            showToast('Only administrators can modify fee concessions.', 'warn');
            closeConcModal();
            return;
        }
        const sid = document.getElementById('conc-student-id')?.value;
        const amt = parseFloat(document.getElementById('conc-fee-amount')?.value);
        if (isNaN(amt) || amt < 0) return showToast('Please enter a valid concession amount.', 'warn');

        try {
            await updateDoc(doc(db, `${BASE_PATH}/students`, sid), {
                concessionFee: amt,
                concessionAppliedAt: Date.now(),
                concessionUpdatedAt: Date.now()
            });
            const s = ctx.getStudents().find((st) => st.id === sid);
            if (s) {
                s.concessionFee = amt;
                s.concessionUpdatedAt = Date.now();
            }
            await logAudit('fee', 'concession.save', 'student', sid, `Concession saved: ₹${amt}.`);
            closeConcModal();
            renderConcessionsList();
            showToast(`Concession of ₹${amt} saved!`, 'success');
        } catch (err) {
            console.error('Failed to save concession:', err);
            showToast('Failed to save concession: ' + err.message, 'error');
        }
    });

    document.getElementById('conc-remove')?.addEventListener('click', async () => {
        if (!isUserAdmin()) {
            showToast('Only administrators can remove fee concessions.', 'warn');
            closeConcModal();
            return;
        }
        const sid = document.getElementById('conc-student-id')?.value;
        const confirmed = await openConfirmDialog({
            title: 'Remove Concession',
            message: 'Remove fee concession for this student?',
            okLabel: 'Remove',
            danger: true
        });
        if (!confirmed) return;
        try {
            await updateDoc(doc(db, `${BASE_PATH}/students`, sid), { concessionFee: null, concessionUpdatedAt: Date.now() });
            const s = ctx.getStudents().find((st) => st.id === sid);
            if (s) s.concessionFee = null;
            await logAudit('fee', 'concession.remove', 'student', sid, 'Concession removed.');
            closeConcModal();
            renderConcessionsList();
            showToast('Fee concession removed.', 'info');
        } catch (err) {
            console.error('Failed to remove concession:', err);
            showToast('Failed to remove concession: ' + (err.message || 'Network error'), 'error');
        }
    });
};
