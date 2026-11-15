import { db, auth } from '../../../config/firebase-config.js';
import { BASE_PATH, escapeHtml } from '../../shared/app-common.js';
import { showToast } from '../../shared/toaster.js';
import { collection, doc, writeBatch, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/**
 * Shared Fee Entry & Edit Modal Manager
 * Serves both "Master Fee Ledger" and "Fee Status" tabs for unified in-place fee entry and editing.
 * Performs direct Firestore updates, instant cell DOM refresh, and local array syncing.
 */

// Active modal invocation options
let activeModalOptions = null;
let isSubmitting = false;

// Compute next receipt number across all available payments (consistent with Staff and Global)
export const getGlobalNextReceiptNumber = () => {
    let maxRcpt = 0;
    const candidates = [];

    // Check staff-specific next receipt first if function exists
    if (typeof window.getNextReceiptNoForStaff === 'function') {
        const staffNext = window.getNextReceiptNoForStaff();
        if (staffNext && !isNaN(Number(staffNext)) && Number(staffNext) > 0) {
            return Number(staffNext);
        }
    }

    if (Array.isArray(window.allPayments)) {
        candidates.push(...window.allPayments);
    }
    if (Array.isArray(window.MasterLedger?.ledgerPayments)) {
        candidates.push(...window.MasterLedger.ledgerPayments);
    }

    candidates.forEach(p => {
        if (!p) return;
        const num = parseInt(p.receiptNo, 10);
        if (!isNaN(num) && num > maxRcpt) {
            maxRcpt = num;
        }
    });

    return maxRcpt > 0 ? maxRcpt + 1 : 1;
};

// Check if receipt is mandatory for this specific fee item or by default setting
export const checkIsReceiptMandatoryForItem = (itemKey = '', itemType = '') => {
    const isDefaultMandatory = Boolean(window.defaultReceiptMandatory);
    if (Array.isArray(window.feeItems) && window.feeItems.length > 0) {
        const lowerKey = String(itemKey || '').trim().toLowerCase();
        const customItem = window.feeItems.find(i => 
            String(i.key || '').trim().toLowerCase() === lowerKey || 
            String(i.name || '').trim().toLowerCase() === lowerKey
        );
        if (customItem && typeof customItem.isReceiptMandatory === 'boolean') {
            return customItem.isReceiptMandatory;
        }
    }
    return isDefaultMandatory;
};

/**
 * Resolve canonical fee item from configured fee items matching the key or month in target academic year
 */
export const resolveCanonicalItem = (rawKey, rawMonth, fallbackName, fallbackType = 'month', targetYear = '') => {
    const yr = targetYear || window.currentWorkingAcademicYear || window.MasterLedger?.academicYear || '';
    if (typeof window.resolveCanonicalFeeItem === 'function') {
        const canonical = window.resolveCanonicalFeeItem(rawKey || rawMonth, yr);
        if (canonical) {
            return {
                key: canonical.key,
                name: canonical.name || fallbackName || (rawMonth ? `${rawMonth} Tuition Fee` : 'Tuition Fee'),
                type: canonical.type || fallbackType || 'month'
            };
        }
    }
    if (typeof window.resolveCanonicalFeeItemKey === 'function') {
        const canonical = window.resolveCanonicalFeeItemKey(rawKey || rawMonth, yr);
        if (canonical) {
            return {
                key: canonical.key || canonical,
                name: canonical.name || fallbackName || (rawMonth ? `${rawMonth} Tuition Fee` : 'Tuition Fee'),
                type: canonical.type || fallbackType || 'month'
            };
        }
    }
    if (Array.isArray(window.feeItems) && window.feeItems.length > 0) {
        const raw = String(rawKey || rawMonth || '').trim().toLowerCase();
        const mPrefix = raw.replace(/^month[-_]/, '').slice(0, 3);
        const matched = window.feeItems.find(i => {
            if (yr && i.academicYear && i.academicYear !== yr) return false;
            const cKey = String(i.key || '').trim().toLowerCase();
            const cName = String(i.name || '').trim().toLowerCase();
            return cKey === raw || (mPrefix.length === 3 && (cKey.includes(mPrefix) || cName.includes(mPrefix)));
        });
        if (matched) {
            return {
                key: matched.key,
                name: matched.name || fallbackName,
                type: matched.type || fallbackType || 'month'
            };
        }
    }
    const k = String(rawKey || rawMonth || 'fee').trim().toLowerCase();
    return {
        key: k,
        name: fallbackName || (rawMonth ? `${rawMonth} Tuition Fee` : 'Tuition Fee'),
        type: fallbackType || 'month'
    };
};
window.resolveCanonicalItem = resolveCanonicalItem;

const roundMoney = (value) => {
    const num = Number(value || 0);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
};

// Resolve true total paid amount for single or grouped/mirror payment records
const resolveModalPaymentAmount = (p, fallbackFee = 0) => {
    if (!p) return roundMoney(fallbackFee);
    const isGrouped = Boolean(
        p.billingGroupId ||
        p.isGroupPrimary ||
        p.isGroupMirror ||
        (Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 1)
    );
    const gm = Number(p.groupMonthAmount ?? p.groupCoveredAmount ?? 0);
    if (isGrouped && Number.isFinite(gm) && gm > 0) {
        return roundMoney(gm);
    }
    if (p.isGroupMirror) {
        const gp = Number(p.groupPaidAmount ?? 0);
        if (Number.isFinite(gp) && gp > 0) return roundMoney(gp);
    }
    const amt = Number(p.amount);
    if (Number.isFinite(amt) && amt >= 0) {
        if (amt === 0 && Number(p.groupPaidAmount || 0) > 0) {
            return roundMoney(p.groupPaidAmount);
        }
        return roundMoney(amt);
    }
    return roundMoney(fallbackFee);
};

// Locate all sibling payment docs belonging to the same grouped item in a transaction
const findSiblingGroupPayments = (basePayment, relatedList = []) => {
    if (!basePayment) return [];
    const byId = new Map();
    const pool = [
        ...(Array.isArray(relatedList) ? relatedList : []),
        ...(Array.isArray(window.allPayments) ? window.allPayments : []),
        ...(Array.isArray(window.MasterLedger?.ledgerPayments) ? window.MasterLedger.ledgerPayments : [])
    ];
    const baseTxn = String(basePayment.transactionId || '').trim();
    const baseKey = String(basePayment.itemKey || '').trim().toLowerCase();
    const baseYear = String(basePayment.academicYear || '').trim();
    const isGrouped = Boolean(
        basePayment.isGroupPrimary ||
        basePayment.isGroupMirror ||
        basePayment.billingGroupId ||
        (Array.isArray(basePayment.targetGroupMemberIds) && basePayment.targetGroupMemberIds.length > 1)
    );

    if (basePayment.id) {
        byId.set(basePayment.id, basePayment);
    }

    if (Array.isArray(relatedList) && relatedList.length > 0) {
        relatedList.forEach(p => {
            if (!p?.id) return;
            const pKey = String(p.itemKey || '').trim().toLowerCase();
            if (!baseKey || !pKey || pKey === baseKey) {
                byId.set(p.id, { ...(byId.get(p.id) || {}), ...p });
            }
        });
    }

    if (isGrouped && baseTxn) {
        pool.forEach(p => {
            if (!p?.id) return;
            if (String(p.transactionId || '').trim() !== baseTxn) return;
            const pKey = String(p.itemKey || '').trim().toLowerCase();
            if (baseKey && pKey && pKey !== baseKey) return;
            const pYear = String(p.academicYear || '').trim();
            if (baseYear && pYear && pYear !== baseYear) return;
            byId.set(p.id, { ...(byId.get(p.id) || {}), ...p });
        });
    }

    return Array.from(byId.values());
};

// Proportionally distribute an edited total amount across item inputs while keeping exact sum
const distributeAmountAcrossBulkInputs = (targetTotal, itemInputs = []) => {
    if (!itemInputs || itemInputs.length === 0) return;
    const total = Math.max(0, roundMoney(targetTotal));
    let weights = itemInputs.map(inp => Math.max(0, Number(inp.value || 0)));
    let weightSum = weights.reduce((s, w) => s + w, 0);
    if (weightSum <= 0) {
        weights = itemInputs.map(inp => Math.max(0, Number(inp.dataset.defaultAmount || 0)));
        weightSum = weights.reduce((s, w) => s + w, 0);
    }
    if (weightSum <= 0) {
        weights = itemInputs.map(() => 1);
        weightSum = itemInputs.length;
    }

    const useWholeRupees = Number.isInteger(total);
    const scale = useWholeRupees ? 1 : 100;
    const targetUnits = Math.round(total * scale);
    const rawUnits = weights.map(w => (targetUnits * w) / weightSum);
    const baseUnits = rawUnits.map(u => Math.floor(u));
    let remainder = targetUnits - baseUnits.reduce((s, u) => s + u, 0);

    const order = rawUnits
        .map((u, idx) => ({ idx, frac: u - baseUnits[idx] }))
        .sort((a, b) => (b.frac - a.frac) || (b.idx - a.idx));

    for (let i = 0; i < remainder; i++) {
        const slot = order[i % order.length];
        baseUnits[slot.idx] += 1;
    }

    itemInputs.forEach((inp, idx) => {
        inp.value = scale === 1 ? baseUnits[idx] : roundMoney(baseUnits[idx] / scale);
    });
};

/**
 * Open Shared Fee Entry/Edit Modal
 * @param {Object} options
 * @param {string} options.mode - 'add' or 'edit'
 * @param {Object} [options.student] - Student object { id, name, class, adm, guardian, phone }
 * @param {Object} [options.unit] - Ledger unit object (may include family group)
 * @param {string} [options.month] - Target month label e.g. "Jun", "June"
 * @param {string} [options.itemKey] - Item key e.g. "jun", "june", "cf", "admission"
 * @param {string} [options.itemName] - Item display name
 * @param {number} [options.defaultAmount] - Default fee amount
 * @param {Object} [options.payment] - Existing payment object (if edit mode)
 * @param {string} [options.paymentId] - Payment ID (if edit mode)
 * @param {HTMLElement} [options.targetCellElement] - Clicked table cell for instant DOM update
 * @param {string} [options.source] - 'fee-status', 'master-ledger', or 'edit'
 * @param {string} [options.academicYear] - Academic year (e.g. "2025-2026")
 * @param {Function} [options.onUpdated] - Callback after successful save
 */
export const openFeeEntryEditModal = (options = {}) => {
    const modal = document.getElementById('master-ledger-pay-modal');
    if (!modal) {
        console.error('Fee Entry modal element (#master-ledger-pay-modal) not found in DOM.');
        return;
    }

    activeModalOptions = { ...options };

    const isEdit = options.mode === 'edit' || Boolean(options.payment || options.paymentId);
    const isBulkAdd = options.mode === 'bulk-add' && Array.isArray(options.bulkItems) && options.bulkItems.length > 0;
    const isBulkEdit = options.mode === 'bulk-edit' && Array.isArray(options.bulkItems) && options.bulkItems.length > 0;
    const isBulk = isBulkAdd || isBulkEdit;
    const existingPayment = options.payment || (isBulkEdit ? options.bulkItems[0]?.payment : null) || null;

    // Resolve Student / Unit details
    const student = options.student || (existingPayment ? {
        id: existingPayment.studentId,
        name: existingPayment.studentName,
        class: existingPayment.studentClass || existingPayment.classLabel,
        adm: existingPayment.studentAdm,
        guardian: existingPayment.guardianName
    } : null);

    const unit = options.unit || null;
    const isGroup = Boolean(unit?.isGroup) && !isBulk;

    // Labels & Keys
    const effectiveYear = options.academicYear || existingPayment?.academicYear || window.currentWorkingAcademicYear || window.MasterLedger?.academicYear || '2025-2026';
    const canonicalItem = resolveCanonicalItem(
        existingPayment?.itemKey || options.itemKey,
        options.month,
        existingPayment?.itemName || options.itemName,
        options.itemType,
        effectiveYear
    );
    const effectiveItemKey = canonicalItem.key;
    const effectiveItemName = isBulk
        ? `${options.bulkItems.length} Fee Items`
        : (canonicalItem.name || existingPayment?.itemName || options.itemName || (options.month ? `${options.month} Tuition Fee` : 'Tuition Fee'));
    const effectiveMonth = options.month || existingPayment?.itemKey || 'Tuition Fee';

    // Populate Hidden Inputs
    const unitIdEl = document.getElementById('ledger-pay-unit-id');
    if (unitIdEl) unitIdEl.value = unit ? unit.id : (student ? student.id : '');

    const monthEl = document.getElementById('ledger-pay-month');
    if (monthEl) monthEl.value = effectiveMonth;

    const itemKeyEl = document.getElementById('ledger-pay-item-key');
    if (itemKeyEl) itemKeyEl.value = effectiveItemKey;

    const itemNameEl = document.getElementById('ledger-pay-item-name');
    if (itemNameEl) itemNameEl.value = effectiveItemName;

    const studentIdEl = document.getElementById('ledger-pay-student-id');
    if (studentIdEl) studentIdEl.value = student?.id || (unit?.students?.[0]?.id) || '';

    const studentNameEl = document.getElementById('ledger-pay-student-name');
    if (studentNameEl) studentNameEl.value = student?.name || (unit?.students?.map(s => s.name).join(', ')) || '';

    const studentClassEl = document.getElementById('ledger-pay-student-class');
    if (studentClassEl) studentClassEl.value = student?.class || (unit?.classes?.join(', ')) || '';

    const studentAdmEl = document.getElementById('ledger-pay-student-adm');
    if (studentAdmEl) studentAdmEl.value = student?.adm || (unit?.students?.[0]?.adm) || '';

    const yearEl = document.getElementById('ledger-pay-academic-year');
    if (yearEl) yearEl.value = effectiveYear;

    const sourceEl = document.getElementById('ledger-pay-source');
    if (sourceEl) sourceEl.value = isBulk ? options.mode : (options.source || (isEdit ? 'edit' : 'ledger'));

    const paymentIdEl = document.getElementById('ledger-pay-payment-id');
    if (paymentIdEl) paymentIdEl.value = existingPayment?.id || options.paymentId || '';

    const txnIdEl = document.getElementById('ledger-pay-txn-id');
    if (txnIdEl) txnIdEl.value = existingPayment?.transactionId || '';

    // Title & Header Badges
    const titleEl = modal.querySelector('h3');
    if (titleEl) {
        if (isBulkEdit) titleEl.textContent = `Edit ${options.bulkItems.length} Selected Payments`;
        else if (isBulkAdd) titleEl.textContent = `Collect ${options.bulkItems.length} Selected Fees`;
        else titleEl.textContent = isEdit ? 'Edit Fee Payment' : 'Record Fee Payment';
    }

    const subTitleEl = modal.querySelector('h3 + p');
    if (subTitleEl) {
        if (isBulkEdit) {
            subTitleEl.textContent = 'Bulk Edit Selected Fee Receipts';
        } else if (isBulkAdd) {
            subTitleEl.textContent = 'Single Receipt for Multiple Selected Items';
        } else if (isEdit) {
            subTitleEl.textContent = 'Modify Verified Transaction Record';
        } else if (options.source === 'fee-status') {
            subTitleEl.textContent = 'Instant Fee Status Entry';
        } else {
            subTitleEl.textContent = 'Fee Register Direct Collection';
        }
    }

    const submitBtn = document.getElementById('ledger-pay-confirm-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50');
        submitBtn.innerHTML = (isEdit || isBulkEdit)
            ? '<i class="fas fa-save mr-1"></i> Update Payment'
            : '<i class="fas fa-check mr-1"></i> Record Payment';
    }

    const monthBadge = document.getElementById('ledger-pay-month-badge');
    if (monthBadge) {
        monthBadge.textContent = effectiveItemName;
    }

    // Display Names & Meta
    const namesEl = document.getElementById('ledger-pay-names');
    const guardianEl = document.getElementById('ledger-pay-guardian');
    const classTag = document.getElementById('ledger-pay-class-tag');

    if (isBulk) {
        const uniqueStudentNames = [...new Set(options.bulkItems.map(item => item.studentName).filter(Boolean))];
        const uniqueClasses = [...new Set(options.bulkItems.map(item => item.studentClass).filter(Boolean))];
        if (namesEl) {
            namesEl.textContent = uniqueStudentNames.length === 1
                ? uniqueStudentNames[0]
                : `${uniqueStudentNames.length} Students (${uniqueStudentNames.slice(0, 2).join(', ')}${uniqueStudentNames.length > 2 ? '...' : ''})`;
        }
        if (guardianEl) {
            guardianEl.textContent = uniqueStudentNames.length === 1 ? (options.bulkItems[0]?.guardian || '--') : 'Multiple';
        }
        if (classTag) {
            classTag.textContent = `Class: ${uniqueClasses.join(', ') || '-'}`;
        }
    } else {
        const includedList = Array.isArray(options.includedStudents) && options.includedStudents.length > 0
            ? options.includedStudents
            : null;
        if (namesEl) {
            if (includedList) {
                namesEl.textContent = includedList.map((s, i) => `${includedList.length > 1 ? `${i + 1}. ` : ''}${s.name} (${s.class || '-'})`).join(', ');
            } else if (unit) {
                namesEl.textContent = unit.students.map((s, i) => `${unit.isGroup ? `${i + 1}. ` : ''}${s.name} (${s.class || s.studentClass || '-'})`).join(', ');
            } else if (student) {
                namesEl.textContent = `${student.name} (Adm: ${student.adm || '-'})`;
            } else {
                namesEl.textContent = 'Student';
            }
        }
        if (guardianEl) {
            guardianEl.textContent = unit?.guardian || student?.guardian || existingPayment?.guardianName || includedList?.[0]?.guardian || '--';
        }
        if (classTag) {
            if (includedList) {
                const clsTxt = [...new Set(includedList.map(s => s.class).filter(Boolean))].join(', ');
                classTag.textContent = `Class: ${clsTxt || '-'}`;
            } else {
                classTag.textContent = unit ? `Class: ${unit.classes?.join(', ')}` : `Class: ${student?.class || '-'}`;
            }
        }
    }

    // Multi-Items Bulk Breakdown List
    const multiWrap = document.getElementById('ledger-pay-multi-items-wrap');
    const multiListEl = document.getElementById('ledger-pay-multi-items-list');
    const multiCountEl = document.getElementById('ledger-multi-items-count');

    if (isBulk && multiWrap && multiListEl) {
        multiWrap.classList.remove('hidden');
        if (multiCountEl) multiCountEl.textContent = `${options.bulkItems.length} Selected`;

        multiListEl.innerHTML = options.bulkItems.map((item, idx) => {
            const itemAmt = Number(isBulkEdit
                ? (item.amount ?? resolveModalPaymentAmount(item.payment, 200))
                : (item.amount ?? 200));
            return `
                <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-blue-200/80 shadow-2xs">
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-slate-800 text-xs truncate">${idx + 1}. ${escapeHtml(item.studentName || 'Student')} <span class="text-[10px] font-semibold text-slate-500">(${escapeHtml(item.studentClass || '-')})</span></div>
                        <div class="text-[10px] font-bold text-blue-700">${escapeHtml(item.itemName || item.month || item.itemKey || 'Tuition Fee')}${item.payment?.receiptNo ? ` • R:${escapeHtml(item.payment.receiptNo)}` : ''}</div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <span class="text-[10px] font-bold text-slate-400">₹</span>
                        <input type="number" min="0" step="1" class="bulk-item-amount-input w-20 px-2 py-1 text-right text-xs font-mono font-bold border border-slate-200 rounded-md focus:border-blue-500 outline-none" data-bulk-idx="${idx}" data-default-amount="${itemAmt}" value="${itemAmt}">
                    </div>
                </div>
            `;
        }).join('');

        const syncBulkTotalAmount = () => {
            let sum = 0;
            multiListEl.querySelectorAll('.bulk-item-amount-input').forEach(inp => {
                sum += Number(inp.value || 0);
            });
            const amtEl = document.getElementById('ledger-pay-amount');
            if (amtEl) amtEl.value = roundMoney(sum);
        };

        multiListEl.querySelectorAll('.bulk-item-amount-input').forEach(inp => {
            inp.addEventListener('input', syncBulkTotalAmount);
        });
    } else if (multiWrap) {
        multiWrap.classList.add('hidden');
        if (multiListEl) multiListEl.innerHTML = '';
    }

    // Group Scope Wrap: Render vertical student list for group selection
    const scopeWrap = document.getElementById('ledger-pay-group-scope-wrap');
    const studentsListEl = document.getElementById('ledger-pay-group-students-list');
    const countBadgeEl = document.getElementById('ledger-group-selected-count');
    const toggleAllBtn = document.getElementById('ledger-group-toggle-all-btn');
    let groupDefaultCalculatedAmount = null;

    if (isGroup && unit?.students && unit.students.length > 0 && !isEdit) {
        if (scopeWrap) scopeWrap.classList.remove('hidden');

        // Ensure group rate banner sits cleanly inside scopeWrap above the list
        let rateBannerEl = document.getElementById('ledger-pay-group-rate-banner');
        if (!rateBannerEl && scopeWrap && studentsListEl) {
            rateBannerEl = document.createElement('div');
            rateBannerEl.id = 'ledger-pay-group-rate-banner';
            scopeWrap.insertBefore(rateBannerEl, studentsListEl);
        }

        const baseDefaultFee = Number(unit?.defaultFee || options?.defaultFee || window.defaultFee || 200);
        const groupCollectiveFee = Number(unit.fee > 0 ? unit.fee : (baseDefaultFee * unit.students.length));

        // Resolve already-paid members for this month/item & academic year
        const candidatePayments = Array.isArray(window.MasterLedger?.ledgerPayments) && window.MasterLedger.ledgerPayments.length > 0
            ? window.MasterLedger.ledgerPayments
            : (Array.isArray(window.allPayments) ? window.allPayments : []);

        const monthLower = String(effectiveMonth || '').trim().toLowerCase();
        const monthPrefix = monthLower.replace(/^month[-_]/, '').slice(0, 3);
        const matchesModalItem = (payment) => {
            if (!payment) return false;
            const pYear = String(payment.academicYear || '').trim();
            if (pYear && effectiveYear && pYear !== effectiveYear) return false;
            if (typeof window.isFeeItemMatch === 'function') {
                if (window.isFeeItemMatch(payment.itemKey, { key: effectiveItemKey, type: canonicalItem.type || 'month', name: effectiveItemName })) {
                    return true;
                }
            }
            const pKey = String(payment.itemKey || '').trim().toLowerCase();
            if (!pKey) return false;
            if (pKey === effectiveItemKey.toLowerCase() || pKey === monthLower) return true;
            if (monthPrefix.length === 3 && pKey.replace(/^month[-_]/, '').slice(0, 3) === monthPrefix) return true;
            return false;
        };

        const paidMemberMap = new Map();
        unit.students.forEach((s) => {
            const matchedPay = candidatePayments.find((p) => {
                if (!matchesModalItem(p)) return false;
                if (p.studentId === s.id || (s.adm && p.admissionNo === s.adm)) return true;
                if (unit.groupId && p.billingGroupId === unit.groupId) {
                    if (Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 0) {
                        return p.targetGroupMemberIds.includes(s.id);
                    }
                    return true;
                }
                return false;
            });
            if (matchedPay) {
                paidMemberMap.set(s.id, matchedPay);
            }
        });

        let listHtml = '';
        unit.students.forEach((s, idx) => {
            const hasConc = s.concessionFee !== undefined && s.concessionFee !== null && s.concessionFee !== '';
            const memberIndivFee = hasConc ? Math.max(0, Number(s.concessionFee) || 0) : baseDefaultFee;
            const paidRec = paidMemberMap.get(s.id);
            const isAlreadyPaid = Boolean(paidRec);

            if (isAlreadyPaid) {
                const rcptTxt = paidRec.receiptNo ? `#${escapeHtml(String(paidRec.receiptNo))}` : 'Paid';
                const paidAmt = Math.round(resolveModalPaymentAmount(paidRec, memberIndivFee));
                const isSharedGrp = Boolean(paidRec.isGroupPrimary || paidRec.isGroupMirror || paidRec.billingGroupId || (Array.isArray(paidRec.targetGroupMemberIds) && paidRec.targetGroupMemberIds.length > 1));
                listHtml += `
                    <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50/90 border border-emerald-300 cursor-not-allowed select-none opacity-90 group-student-row">
                        <div class="flex items-center gap-2 min-w-0">
                            <input type="checkbox" class="ledger-group-student-cb w-4 h-4 text-emerald-600 rounded border-emerald-300 cursor-not-allowed flex-shrink-0"
                                data-student-id="${escapeHtml(s.id)}"
                                data-student-name="${escapeHtml(s.name)}"
                                data-student-class="${escapeHtml(s.class || s.studentClass || '-')}"
                                data-student-adm="${escapeHtml(s.adm || '')}"
                                data-student-fee="${memberIndivFee}"
                                data-already-paid="true"
                                disabled>
                            <div class="min-w-0">
                                <div class="font-bold text-emerald-900 text-xs truncate">✓ ${idx + 1}. ${escapeHtml(s.name)}</div>
                                <div class="text-[10px] text-emerald-700">
                                    Class: <span class="font-semibold">${escapeHtml(s.class || s.studentClass || '-')}</span>
                                    ${s.adm ? ` | Adm: <span class="font-mono">${escapeHtml(s.adm)}</span>` : ''}
                                    <span> | ${hasConc ? 'Conc' : 'Indiv'}: ₹${memberIndivFee}</span>
                                </div>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-300 font-mono">
                                <i class="fas fa-check text-[8px]"></i> Paid ₹${paidAmt}${isSharedGrp ? ' (Grp)' : ''} · ${rcptTxt}
                            </span>
                        </div>
                    </label>
                `;
            } else {
                listHtml += `
                    <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-amber-200/80 hover:bg-amber-100/40 cursor-pointer transition select-none group-student-row">
                        <div class="flex items-center gap-2 min-w-0">
                            <input type="checkbox" class="ledger-group-student-cb w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer flex-shrink-0"
                                data-student-id="${escapeHtml(s.id)}"
                                data-student-name="${escapeHtml(s.name)}"
                                data-student-class="${escapeHtml(s.class || s.studentClass || '-')}"
                                data-student-adm="${escapeHtml(s.adm || '')}"
                                data-student-fee="${memberIndivFee}"
                                data-already-paid="false"
                                checked>
                            <div class="min-w-0">
                                <div class="font-bold text-slate-800 text-xs truncate">${idx + 1}. ${escapeHtml(s.name)}</div>
                                <div class="text-[10px] text-slate-500">
                                    Class: <span class="font-semibold text-slate-700">${escapeHtml(s.class || s.studentClass || '-')}</span>
                                    ${s.adm ? ` | Adm: <span class="font-mono">${escapeHtml(s.adm)}</span>` : ''}
                                    ${hasConc ? ` | <span class="text-amber-700 font-bold">Concession</span>` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <span class="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold text-[11px] font-mono border border-slate-200">₹${memberIndivFee}</span>
                            <span class="text-[10px] font-bold text-red-600">Due</span>
                        </div>
                    </label>
                `;
            }
        });
        if (studentsListEl) studentsListEl.innerHTML = listHtml;

        const updateGroupSelectionState = () => {
            const selectableCbs = Array.from(document.querySelectorAll('.ledger-group-student-cb:not([data-already-paid="true"])'));
            const checkedCbs = selectableCbs.filter(cb => cb.checked);
            const totalMembersCount = unit.students.length;
            const alreadyPaidCount = paidMemberMap.size;
            const isFullCollectiveGroup = alreadyPaidCount === 0 && checkedCbs.length === totalMembersCount;

            let dynamicTotal = 0;
            if (isFullCollectiveGroup) {
                dynamicTotal = groupCollectiveFee;
            } else {
                checkedCbs.forEach(cb => {
                    dynamicTotal += Number(cb.dataset.studentFee || baseDefaultFee);
                });
            }
            groupDefaultCalculatedAmount = dynamicTotal;

            const amtEl = document.getElementById('ledger-pay-amount');
            if (amtEl) amtEl.value = dynamicTotal;

            if (rateBannerEl) {
                if (isFullCollectiveGroup) {
                    rateBannerEl.className = 'text-[10.5px] font-bold text-emerald-800 bg-emerald-100/80 border border-emerald-300 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2';
                    rateBannerEl.innerHTML = `<span><i class="fas fa-users mr-1"></i>Group Rate Active (All ${totalMembersCount} members)</span><span class="font-mono font-extrabold text-emerald-900">₹${groupCollectiveFee}/mo</span>`;
                } else if (checkedCbs.length > 0) {
                    const reasonTag = alreadyPaidCount > 0
                        ? `${alreadyPaidCount} paid · Collecting ${checkedCbs.length} due`
                        : `Individual Rate (${checkedCbs.length} of ${totalMembersCount})`;
                    rateBannerEl.className = 'text-[10.5px] font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2';
                    rateBannerEl.innerHTML = `<span><i class="fas fa-user-check mr-1"></i>${reasonTag}</span><span class="font-mono font-extrabold text-blue-900">₹${dynamicTotal}</span>`;
                } else {
                    rateBannerEl.className = 'text-[10.5px] font-bold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2';
                    rateBannerEl.innerHTML = `<span><i class="fas fa-exclamation-circle mr-1"></i>Select at least 1 due member</span><span class="font-mono font-bold">₹0</span>`;
                }
            }

            if (countBadgeEl) {
                if (isFullCollectiveGroup) {
                    countBadgeEl.textContent = `All Selected (${totalMembersCount})`;
                    countBadgeEl.className = 'text-[10px] font-bold text-emerald-800 bg-emerald-100/90 px-1.5 py-0.5 rounded';
                } else if (checkedCbs.length === 0) {
                    countBadgeEl.textContent = 'None Selected (0)';
                    countBadgeEl.className = 'text-[10px] font-bold text-rose-800 bg-rose-100/90 px-1.5 py-0.5 rounded';
                } else {
                    countBadgeEl.textContent = `${checkedCbs.length} of ${totalMembersCount} Selected`;
                    countBadgeEl.className = 'text-[10px] font-bold text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded';
                }
            }

            if (toggleAllBtn) {
                const allSelectableChecked = selectableCbs.length > 0 && checkedCbs.length === selectableCbs.length;
                toggleAllBtn.textContent = allSelectableChecked ? 'Deselect All' : 'Select All';
            }

            const confirmBtn = document.getElementById('ledger-pay-confirm-btn');
            if (confirmBtn) {
                confirmBtn.disabled = checkedCbs.length === 0;
                confirmBtn.classList.toggle('opacity-50', checkedCbs.length === 0);
            }
        };

        document.querySelectorAll('.ledger-group-student-cb:not([data-already-paid="true"])').forEach(cb => {
            cb.addEventListener('change', updateGroupSelectionState);
        });

        if (toggleAllBtn) {
            toggleAllBtn.onclick = () => {
                const selectableCbs = Array.from(document.querySelectorAll('.ledger-group-student-cb:not([data-already-paid="true"])'));
                const allChecked = selectableCbs.length > 0 && selectableCbs.every(cb => cb.checked);
                selectableCbs.forEach(cb => { cb.checked = !allChecked; });
                updateGroupSelectionState();
            };
        }

        // Apply initial accurate total (group fee or unpaid members sum)
        updateGroupSelectionState();
    } else {
        if (scopeWrap) scopeWrap.classList.add('hidden');
        const rateBannerEl = document.getElementById('ledger-pay-group-rate-banner');
        if (rateBannerEl) rateBannerEl.remove();
    }

    // Receipt requirement indicator (Mandatory with red star vs Optional)
    const isReceiptMandatory = checkIsReceiptMandatoryForItem(effectiveItemKey, options.itemType);
    const receiptReqStar = document.getElementById('ledger-pay-receipt-req');
    const receiptBadge = document.getElementById('ledger-pay-receipt-badge');

    if (receiptReqStar) {
        receiptReqStar.classList.toggle('hidden', !isReceiptMandatory);
    }
    if (receiptBadge) {
        if (isReceiptMandatory) {
            receiptBadge.textContent = '(Mandatory)';
            receiptBadge.className = 'text-[9px] font-bold text-rose-600';
        } else {
            receiptBadge.textContent = '(Optional)';
            receiptBadge.className = 'text-[9px] font-normal text-slate-400';
        }
    }

    // Amount, Receipt, Date, Mode
    const defaultFeeAmount = isBulk
        ? roundMoney(options.bulkItems.reduce((acc, item) => acc + Number(isBulkEdit ? (item.amount ?? resolveModalPaymentAmount(item.payment, 200)) : (item.amount ?? 200)), 0))
        : (isEdit
            ? resolveModalPaymentAmount(existingPayment, 0)
            : (groupDefaultCalculatedAmount !== null ? groupDefaultCalculatedAmount : (options.defaultAmount ?? unit?.fee ?? 200)));

    const calculatedNextReceipt = getGlobalNextReceiptNumber();
    const nextReceipt = (isEdit || isBulkEdit)
        ? (existingPayment?.receiptNo || '')
        : (options.receiptNo || calculatedNextReceipt || '');

    const paymentDateVal = (isEdit || isBulkEdit)
        ? (existingPayment?.paymentDate || new Date().toISOString().split('T')[0])
        : new Date().toISOString().split('T')[0];

    const paymentModeVal = (isEdit || isBulkEdit)
        ? (existingPayment?.paymentMode || 'Cash')
        : 'Cash';

    const amtInput = document.getElementById('ledger-pay-amount');
    if (amtInput) {
        amtInput.value = defaultFeeAmount;
        amtInput.oninput = isBulk
            ? () => {
                const container = document.getElementById('ledger-pay-multi-items-list');
                const itemInputs = container ? Array.from(container.querySelectorAll('.bulk-item-amount-input')) : [];
                distributeAmountAcrossBulkInputs(amtInput.value, itemInputs);
            }
            : null;
    }

    const rcptInput = document.getElementById('ledger-pay-receipt');
    if (rcptInput) rcptInput.value = nextReceipt;

    const dateInput = document.getElementById('ledger-pay-date');
    if (dateInput) dateInput.value = paymentDateVal;

    const modeInput = document.getElementById('ledger-pay-mode');
    if (modeInput) modeInput.value = paymentModeVal;

    const descInput = document.getElementById('ledger-pay-description');
    if (descInput) {
        descInput.value = (isEdit || isBulkEdit) ? (existingPayment?.description || '') : '';
    }

    // Show Modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Focus amount input after modal frame paints so IME resize does not collide with overlay mount
    const isMobileOrFullscreen = Boolean(
        document.body?.classList.contains('collection-landscape-modal-mode') ||
        document.body?.classList.contains('collection-fullscreen-lock') ||
        window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches
    );
    const scheduleFocus = () => {
        if (!amtInput || modal.classList.contains('hidden')) return;
        try {
            amtInput.focus({ preventScroll: true });
            amtInput.select();
        } catch (_) {
            amtInput.focus();
            amtInput.select();
        }
    };
    if (isMobileOrFullscreen) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(scheduleFocus, 90);
            });
        });
    } else {
        setTimeout(scheduleFocus, 50);
    }
};

// Close Shared Modal
export const closeFeeEntryEditModal = () => {
    const modal = document.getElementById('master-ledger-pay-modal');
    if (modal) {
        const activeEl = document.activeElement;
        if (activeEl && modal.contains(activeEl) && typeof activeEl.blur === 'function') {
            activeEl.blur();
        }
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    const descInput = document.getElementById('ledger-pay-description');
    if (descInput) descInput.value = '';
    activeModalOptions = null;
    isSubmitting = false;
};

// Perform instant in-place DOM update of the clicked table cell
const applyInstantCellUpdate = (targetCell, paymentData) => {
    if (!targetCell || !paymentData) return;

    const paidAmtDisplay = Math.round(resolveModalPaymentAmount(paymentData, 0));
    const receiptDisplay = paymentData.receiptNo ? `R:${escapeHtml(paymentData.receiptNo)}` : 'Paid';
    const dateDisplay = paymentData.paymentDate
        ? new Date(paymentData.paymentDate).toLocaleDateString('en-GB')
        : new Date().toLocaleDateString('en-GB');

    // Fee Status Table Cell
    if (targetCell.dataset.feeAction !== undefined || targetCell.hasAttribute('data-fee-action')) {
        targetCell.className = "p-1.5 text-center bg-emerald-50/70 border-r border-slate-200 cursor-pointer hover:bg-emerald-100/90 transition group";
        targetCell.dataset.feeAction = "view-receipt";
        targetCell.dataset.paymentId = paymentData.id || '';
        targetCell.setAttribute('title', `Paid ₹${paidAmtDisplay} (${receiptDisplay}) on ${dateDisplay}`);
        targetCell.innerHTML = `
            <div class="flex flex-col items-center justify-center gap-0.5">
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black border border-emerald-200">
                    <i class="fas fa-check text-[8px]"></i> Paid
                </span>
                <span class="text-[10px] font-black font-mono tabular-nums text-emerald-900">₹${paidAmtDisplay}</span>
                <span class="text-[9.5px] font-mono font-bold text-emerald-950">${receiptDisplay}</span>
                <span class="text-[8.5px] text-emerald-600 font-medium">${dateDisplay}</span>
            </div>
        `;
    }
    // Master Fee Ledger Month Cell
    else if (targetCell.dataset.ledgerAction !== undefined || targetCell.hasAttribute('data-ledger-action')) {
        targetCell.className = "px-1.5 py-2 text-center border-r border-slate-200 bg-emerald-50/60 fee-cell-interactive cursor-pointer hover:bg-emerald-100 transition";
        targetCell.dataset.ledgerAction = "view-receipt";
        targetCell.dataset.paymentId = paymentData.id || '';
        targetCell.setAttribute('title', `Paid ₹${paidAmtDisplay} (${receiptDisplay}) on ${dateDisplay}`);
        targetCell.innerHTML = `
            <div class="flex flex-col items-center justify-center">
                <div class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black border border-emerald-200 mb-0.5">
                    <i class="fas fa-check text-[7px]"></i> Paid
                </div>
                <div class="text-[10px] font-black font-mono tabular-nums text-emerald-900">₹${paidAmtDisplay}</div>
                <div class="text-[9px] font-mono font-bold text-emerald-850 truncate max-w-[85px]" title="${escapeHtml(paymentData.receiptNo || 'Paid')}">${receiptDisplay}</div>
                <div class="text-[8.5px] text-emerald-600 font-medium leading-tight">${dateDisplay}</div>
            </div>
        `;
    }

    // Flash glow effect
    targetCell.classList.add('ring-2', 'ring-emerald-400');
    setTimeout(() => {
        targetCell.classList.remove('ring-2', 'ring-emerald-400');
    }, 1200);
};

// Process Submit (Add or Edit)
export const submitFeeEntryPayment = async () => {
    if (isSubmitting) return;

    const unitId = document.getElementById('ledger-pay-unit-id')?.value || '';
    const month = document.getElementById('ledger-pay-month')?.value || 'Tuition Fee';
    const itemKey = (document.getElementById('ledger-pay-item-key')?.value || month || 'fee').toLowerCase();
    const itemName = document.getElementById('ledger-pay-item-name')?.value || `${month} Tuition Fee`;
    const source = document.getElementById('ledger-pay-source')?.value || 'ledger';
    const existingPaymentId = document.getElementById('ledger-pay-payment-id')?.value || '';
    const existingTxnId = document.getElementById('ledger-pay-txn-id')?.value || '';
    const academicYear = document.getElementById('ledger-pay-academic-year')?.value || window.currentWorkingAcademicYear || '2025-2026';
    const cleanYear = String(academicYear).replace(/[^\w-]/g, '_');

    const studentId = document.getElementById('ledger-pay-student-id')?.value || unitId;
    const studentName = document.getElementById('ledger-pay-student-name')?.value || 'Student';
    const studentClass = document.getElementById('ledger-pay-student-class')?.value || '-';
    const studentAdm = document.getElementById('ledger-pay-student-adm')?.value || '';

    const amountInput = document.getElementById('ledger-pay-amount');
    const amount = Number(amountInput?.value || 0);

    const isEdit = source === 'edit' || Boolean(existingPaymentId);
    const receiptRaw = document.getElementById('ledger-pay-receipt')?.value?.trim() || '';
    let receiptNo = receiptRaw ? parseInt(receiptRaw, 10) : null;
    if (receiptNo !== null && (isNaN(receiptNo) || receiptNo <= 0)) {
        receiptNo = null;
    }

    // Check mandatory receipt setting (item-level or global default)
    const isReceiptMandatory = checkIsReceiptMandatoryForItem(itemKey);
    if (isReceiptMandatory) {
        if (!receiptNo) {
            showToast('Receipt number is mandatory. Please enter a receipt number.', 'error');
            const rcptInput = document.getElementById('ledger-pay-receipt');
            if (rcptInput) {
                rcptInput.focus();
                rcptInput.classList.add('ring-2', 'ring-rose-500');
                setTimeout(() => rcptInput.classList.remove('ring-2', 'ring-rose-500'), 1500);
            }
            return;
        }
    }

    const paymentDate = document.getElementById('ledger-pay-date')?.value || new Date().toISOString().split('T')[0];
    const mode = document.getElementById('ledger-pay-mode')?.value || 'Cash';
    const description = document.getElementById('ledger-pay-description')?.value?.trim() || '';
    const submitBtn = document.getElementById('ledger-pay-confirm-btn');

    if (!amount || amount <= 0) {
        showToast('Please enter a valid payment amount.', 'error');
        if (amountInput) amountInput.focus();
        return;
    }

    try {
        isSubmitting = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';
        }

        const batch = writeBatch(db);
        const currentUser = auth.currentUser;
        const collectorKey = (typeof window.getCollectorKey === 'function' ? window.getCollectorKey() : '') ||
            String(currentUser?.email || window.AppSession?.getStaffEmail?.() || window.AppSession?.getStaffAccess?.()?.userKey || window.AppSession?.getStaffAccess?.()?.loginId || 'admin@institution.edu').trim().toLowerCase();
        const collectorDisplayName = (typeof window.getCollectorDisplayName === 'function' ? window.getCollectorDisplayName() : '') ||
            window.AppSession?.getStaffAccess?.()?.name ||
            window.AppSession?.getStaffAccess?.()?.staffName ||
            collectorKey;

        const isBulkAdd = activeModalOptions?.mode === 'bulk-add' && Array.isArray(activeModalOptions?.bulkItems);
        const isBulkEdit = activeModalOptions?.mode === 'bulk-edit' && Array.isArray(activeModalOptions?.bulkItems);
        const isBulk = isBulkAdd || isBulkEdit;

        let savedPaymentRecord = null;
        const savedPaymentRecords = [];

        if (isBulk) {
            const bulkItems = activeModalOptions.bulkItems;
            const itemAmountInputs = Array.from(document.querySelectorAll('.bulk-item-amount-input'));
            const sharedTxnId = Date.now().toString() + Math.random().toString(36).substr(2, 5);

            bulkItems.forEach((bItem, idx) => {
                const inpEl = itemAmountInputs.find(el => Number(el.dataset.bulkIdx) === idx);
                const parsedItemAmt = inpEl ? Number(inpEl.value) : Number(bItem.amount ?? 200);
                const finalAmt = (Number.isFinite(parsedItemAmt) && parsedItemAmt >= 0)
                    ? roundMoney(parsedItemAmt)
                    : roundMoney(bItem.amount ?? 200);
                const itemAcademicYear = bItem.academicYear || academicYear;
                const itemCleanYear = String(itemAcademicYear).replace(/[^\w-]/g, '_');

                if (isBulkEdit && (bItem.payment?.id || bItem.paymentId)) {
                    const pId = bItem.payment?.id || bItem.paymentId;
                    const basePay = bItem.payment || { id: pId, itemKey: bItem.itemKey, academicYear: itemAcademicYear };
                    const siblingDocs = findSiblingGroupPayments(basePay, []);
                    if (siblingDocs.length > 1) {
                        const primarySib = siblingDocs.find(p => p.isGroupPrimary)
                            || siblingDocs.find(p => Number(p.amount || 0) > 0)
                            || siblingDocs.find(p => p.id === pId)
                            || siblingDocs[0];
                        siblingDocs.forEach((sib) => {
                            const isPrim = sib.id === primarySib.id;
                            const updatePayload = {
                                amount: isPrim ? finalAmt : 0,
                                groupMonthAmount: finalAmt,
                                groupPaidAmount: finalAmt,
                                groupCoveredAmount: finalAmt,
                                receiptNo: receiptNo,
                                paymentDate: paymentDate,
                                paymentMode: mode,
                                description: description,
                                updatedAt: new Date().toISOString()
                            };
                            batch.set(doc(db, `${BASE_PATH}/payments`, sib.id), updatePayload, { merge: true });
                            if (itemAcademicYear) {
                                batch.set(doc(db, `${BASE_PATH}/years/${itemAcademicYear}/payments`, sib.id), updatePayload, { merge: true });
                                batch.set(doc(db, `${BASE_PATH}/academicYears/${itemCleanYear}/payments`, sib.id), updatePayload, { merge: true });
                            }
                            const rec = { ...sib, ...updatePayload };
                            savedPaymentRecords.push({
                                record: rec,
                                cell: (sib.id === pId || isPrim) ? bItem.targetCellElement : null
                            });
                        });
                    } else {
                        const payRef = doc(db, `${BASE_PATH}/payments`, pId);
                        const updatePayload = {
                            amount: finalAmt,
                            groupMonthAmount: finalAmt,
                            groupPaidAmount: finalAmt,
                            receiptNo: receiptNo,
                            paymentDate: paymentDate,
                            paymentMode: mode,
                            description: description,
                            updatedAt: new Date().toISOString()
                        };
                        batch.set(payRef, updatePayload, { merge: true });
                        if (itemAcademicYear) {
                            batch.set(doc(db, `${BASE_PATH}/years/${itemAcademicYear}/payments`, pId), updatePayload, { merge: true });
                            batch.set(doc(db, `${BASE_PATH}/academicYears/${itemCleanYear}/payments`, pId), updatePayload, { merge: true });
                        }
                        const rec = {
                            ...(bItem.payment || {}),
                            id: pId,
                            ...updatePayload
                        };
                        savedPaymentRecords.push({ record: rec, cell: bItem.targetCellElement });
                    }
                } else if (isBulkAdd) {
                    const canonicalItem = resolveCanonicalItem(bItem.itemKey, bItem.month, bItem.itemName, bItem.itemType || 'month', itemAcademicYear);
                    const collectStudents = Array.isArray(bItem.collectStudents) && bItem.collectStudents.length > 0
                        ? bItem.collectStudents
                        : null;

                    if (bItem.unit?.isGroup && collectStudents && collectStudents.length > 1) {
                        const targetGroupMemberIds = collectStudents.map(s => s.id);
                        collectStudents.forEach((stu, sIdx) => {
                            const isPrimary = sIdx === 0;
                            const payRef = doc(collection(db, `${BASE_PATH}/payments`));
                            const sClass = (itemAcademicYear && stu.academicYears?.[itemAcademicYear]?.class) || stu.class || stu.studentClass || bItem.studentClass || '-';
                            const paymentPayload = {
                                studentId: stu.id,
                                studentName: stu.name || 'Student',
                                studentClass: sClass,
                                classLabel: sClass,
                                studentAdm: stu.adm || '',
                                guardianName: bItem.guardian || bItem.unit?.guardian || '',
                                amount: isPrimary ? finalAmt : 0,
                                groupMonthAmount: finalAmt,
                                groupPaidAmount: finalAmt,
                                groupCoveredAmount: finalAmt,
                                isGroupPrimary: isPrimary,
                                isGroupMirror: !isPrimary,
                                targetGroupMemberIds: targetGroupMemberIds,
                                billingGroupId: bItem.billingGroupId || null,
                                receiptNo: receiptNo,
                                itemKey: canonicalItem.key,
                                itemName: canonicalItem.name || bItem.itemName || (bItem.month ? `${bItem.month} Tuition Fee` : 'Tuition Fee'),
                                itemType: canonicalItem.type || bItem.itemType || 'month',
                                paymentMode: mode,
                                paymentDate: paymentDate,
                                description: description,
                                timestamp: Date.now(),
                                transactionId: sharedTxnId,
                                collectedBy: collectorKey,
                                collectedByName: collectorDisplayName,
                                academicYear: itemAcademicYear,
                                status: 'FULL'
                            };
                            batch.set(payRef, paymentPayload);
                            batch.set(doc(db, `${BASE_PATH}/years/${itemAcademicYear}/payments`, payRef.id), paymentPayload);
                            batch.set(doc(db, `${BASE_PATH}/academicYears/${itemCleanYear}/payments`, payRef.id), paymentPayload);
                            savedPaymentRecords.push({
                                record: { id: payRef.id, ...paymentPayload },
                                cell: isPrimary ? bItem.targetCellElement : null
                            });
                        });
                    } else {
                        const payRef = doc(collection(db, `${BASE_PATH}/payments`));
                        const paymentPayload = {
                            studentId: bItem.studentId,
                            studentName: bItem.studentName || 'Student',
                            studentClass: bItem.studentClass || '-',
                            classLabel: bItem.studentClass || '-',
                            studentAdm: bItem.studentAdm || '',
                            guardianName: bItem.guardian || '',
                            amount: finalAmt,
                            groupMonthAmount: finalAmt,
                            groupPaidAmount: finalAmt,
                            billingGroupId: bItem.billingGroupId || null,
                            receiptNo: receiptNo,
                            itemKey: canonicalItem.key,
                            itemName: canonicalItem.name || bItem.itemName || (bItem.month ? `${bItem.month} Tuition Fee` : 'Tuition Fee'),
                            itemType: canonicalItem.type || bItem.itemType || 'month',
                            paymentMode: mode,
                            paymentDate: paymentDate,
                            description: description,
                            timestamp: Date.now(),
                            transactionId: sharedTxnId,
                            collectedBy: collectorKey,
                            collectedByName: collectorDisplayName,
                            academicYear: itemAcademicYear,
                            status: 'FULL'
                        };
                        batch.set(payRef, paymentPayload);
                        batch.set(doc(db, `${BASE_PATH}/years/${itemAcademicYear}/payments`, payRef.id), paymentPayload);
                        batch.set(doc(db, `${BASE_PATH}/academicYears/${itemCleanYear}/payments`, payRef.id), paymentPayload);
                        const rec = { id: payRef.id, ...paymentPayload };
                        savedPaymentRecords.push({ record: rec, cell: bItem.targetCellElement });
                    }
                }
            });
            savedPaymentRecord = savedPaymentRecords[0]?.record || null;
        } else if (isEdit && existingPaymentId) {
            // EDIT EXISTING PAYMENT (Atomic primary + sibling mirror sync for group records)
            const canonicalEditItem = resolveCanonicalItem(itemKey, month, itemName, 'month', academicYear);
            const basePayment = activeModalOptions?.payment || {
                id: existingPaymentId,
                transactionId: existingTxnId,
                studentId,
                studentName,
                studentClass,
                studentAdm,
                itemKey: canonicalEditItem.key,
                itemName: canonicalEditItem.name,
                academicYear
            };
            const siblingDocs = findSiblingGroupPayments(basePayment, activeModalOptions?.relatedPayments || []);
            const isGroupEdit = siblingDocs.length > 1 || Boolean(
                basePayment.isGroupPrimary ||
                basePayment.isGroupMirror ||
                basePayment.billingGroupId ||
                (Array.isArray(basePayment.targetGroupMemberIds) && basePayment.targetGroupMemberIds.length > 1)
            );

            if (isGroupEdit && siblingDocs.length > 1) {
                const primarySib = siblingDocs.find(p => p.isGroupPrimary)
                    || siblingDocs.find(p => Number(p.amount || 0) > 0)
                    || siblingDocs.find(p => p.id === existingPaymentId)
                    || siblingDocs[0];

                siblingDocs.forEach((sib) => {
                    const isPrim = sib.id === primarySib.id;
                    const updatePayload = {
                        amount: isPrim ? amount : 0,
                        groupMonthAmount: amount,
                        groupPaidAmount: amount,
                        groupCoveredAmount: amount,
                        receiptNo: receiptNo,
                        paymentDate: paymentDate,
                        paymentMode: mode,
                        description: description,
                        itemKey: canonicalEditItem.key,
                        itemName: canonicalEditItem.name,
                        updatedAt: new Date().toISOString()
                    };
                    batch.set(doc(db, `${BASE_PATH}/payments`, sib.id), updatePayload, { merge: true });
                    if (academicYear) {
                        batch.set(doc(db, `${BASE_PATH}/years/${academicYear}/payments`, sib.id), updatePayload, { merge: true });
                        batch.set(doc(db, `${BASE_PATH}/academicYears/${cleanYear}/payments`, sib.id), updatePayload, { merge: true });
                    }
                    const rec = {
                        ...sib,
                        transactionId: sib.transactionId || existingTxnId || basePayment.transactionId || existingPaymentId,
                        academicYear: sib.academicYear || academicYear,
                        collectedBy: sib.collectedBy || collectorKey,
                        collectedByName: sib.collectedByName || collectorDisplayName,
                        ...updatePayload
                    };
                    savedPaymentRecords.push({
                        record: rec,
                        cell: (sib.id === existingPaymentId || isPrim) ? activeModalOptions?.targetCellElement : null
                    });
                    if (isPrim) savedPaymentRecord = rec;
                });
                if (!savedPaymentRecord) savedPaymentRecord = savedPaymentRecords[0]?.record || null;
            } else {
                const payRef = doc(db, `${BASE_PATH}/payments`, existingPaymentId);
                const updatePayload = {
                    studentId: studentId,
                    amount: amount,
                    groupMonthAmount: amount,
                    groupPaidAmount: amount,
                    receiptNo: receiptNo,
                    paymentDate: paymentDate,
                    paymentMode: mode,
                    description: description,
                    itemKey: canonicalEditItem.key,
                    itemName: canonicalEditItem.name,
                    updatedAt: new Date().toISOString()
                };
                batch.set(payRef, updatePayload, { merge: true });
                if (academicYear) {
                    batch.set(doc(db, `${BASE_PATH}/years/${academicYear}/payments`, existingPaymentId), updatePayload, { merge: true });
                    batch.set(doc(db, `${BASE_PATH}/academicYears/${cleanYear}/payments`, existingPaymentId), updatePayload, { merge: true });
                }

                savedPaymentRecord = {
                    ...(activeModalOptions?.payment || {}),
                    id: existingPaymentId,
                    transactionId: existingTxnId || activeModalOptions?.payment?.transactionId || existingPaymentId,
                    studentId: studentId,
                    studentName: studentName,
                    studentClass: studentClass,
                    classLabel: studentClass,
                    studentAdm: studentAdm,
                    itemKey: canonicalEditItem.key,
                    itemName: canonicalEditItem.name,
                    academicYear: academicYear,
                    collectedBy: activeModalOptions?.payment?.collectedBy || collectorKey,
                    collectedByName: activeModalOptions?.payment?.collectedByName || collectorDisplayName,
                    ...updatePayload
                };
                savedPaymentRecords.push({ record: savedPaymentRecord, cell: activeModalOptions?.targetCellElement });
            }
        } else {
            // NEW PAYMENT ENTRY (Supports selecting individual child, partial subset, or full group)
            const unit = activeModalOptions?.unit || null;
            const checkedStudentCbs = unit?.isGroup
                ? Array.from(document.querySelectorAll('.ledger-group-student-cb:checked:not(:disabled):not([data-already-paid="true"])'))
                : [];
            const isGroup = Boolean(unit?.isGroup);

            if (isGroup && checkedStudentCbs.length === 0) {
                showToast('Please select at least one unpaid student from the group.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Record Payment';
                }
                isSubmitting = false;
                return;
            }

            const canonicalItem = resolveCanonicalItem(itemKey, month, itemName, 'month', academicYear);
            const newTxnId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
            const totalUnitMembers = isGroup && Array.isArray(unit?.students) ? unit.students.length : 1;
            const alreadyPaidCount = isGroup
                ? document.querySelectorAll('.ledger-group-student-cb[data-already-paid="true"]').length
                : 0;

            if (isGroup && checkedStudentCbs.length > 1) {
                // Single Family Billing Entity / Subset Model (matches Fee Entry tab — primary gets amount, mirrors get 0)
                const isAllGroupMembers = alreadyPaidCount === 0 && checkedStudentCbs.length === totalUnitMembers;
                const billingGroupId = isAllGroupMembers ? (unit.groupId || null) : null;
                const splitStudents = checkedStudentCbs.map(cb => ({
                    id: cb.dataset.studentId || studentId,
                    name: cb.dataset.studentName || studentName,
                    class: cb.dataset.studentClass || studentClass,
                    adm: cb.dataset.studentAdm || studentAdm
                }));
                const targetGroupMemberIds = splitStudents.map(s => s.id);

                splitStudents.forEach((stu, idx) => {
                    const isPrimary = idx === 0;
                    const studentAmt = isPrimary ? amount : 0;
                    const payRef = doc(collection(db, `${BASE_PATH}/payments`));
                    const paymentPayload = {
                        studentId: stu.id,
                        studentName: stu.name,
                        studentClass: stu.class,
                        classLabel: stu.class,
                        studentAdm: stu.adm,
                        guardianName: unit?.guardian || document.getElementById('ledger-pay-guardian')?.textContent || '',
                        amount: studentAmt,
                        groupMonthAmount: amount,
                        groupPaidAmount: amount,
                        groupCoveredAmount: amount,
                        isGroupPrimary: isPrimary,
                        isGroupMirror: !isPrimary,
                        targetGroupMemberIds: targetGroupMemberIds,
                        billingGroupId: billingGroupId,
                        receiptNo: receiptNo,
                        itemKey: canonicalItem.key,
                        itemName: canonicalItem.name || itemName,
                        itemType: canonicalItem.type || 'month',
                        paymentMode: mode,
                        paymentDate: paymentDate,
                        description: description,
                        timestamp: Date.now(),
                        transactionId: newTxnId,
                        collectedBy: collectorKey,
                        collectedByName: collectorDisplayName,
                        academicYear: academicYear,
                        status: 'FULL'
                    };
                    batch.set(payRef, paymentPayload);
                    batch.set(doc(db, `${BASE_PATH}/years/${academicYear}/payments`, payRef.id), paymentPayload);
                    batch.set(doc(db, `${BASE_PATH}/academicYears/${cleanYear}/payments`, payRef.id), paymentPayload);
                    const rec = { id: payRef.id, ...paymentPayload };
                    savedPaymentRecords.push({
                        record: rec,
                        cell: isPrimary ? activeModalOptions?.targetCellElement : null
                    });
                });
                savedPaymentRecord = savedPaymentRecords[0]?.record || null;
            } else {
                const payRef = doc(collection(db, `${BASE_PATH}/payments`));
                let effectiveStudentId = studentId;
                let effectiveStudentName = studentName;
                let effectiveStudentClass = studentClass;
                let effectiveStudentAdm = studentAdm;

                if (isGroup && checkedStudentCbs.length === 1) {
                    const singleCb = checkedStudentCbs[0];
                    effectiveStudentId = singleCb.dataset.studentId || studentId;
                    effectiveStudentName = singleCb.dataset.studentName || studentName;
                    effectiveStudentClass = singleCb.dataset.studentClass || studentClass;
                    effectiveStudentAdm = singleCb.dataset.studentAdm || studentAdm;
                }

                // Single student / single checked member of a group -> billingGroupId stays null so siblings stay due
                const paymentPayload = {
                    studentId: effectiveStudentId,
                    studentName: effectiveStudentName,
                    studentClass: effectiveStudentClass,
                    classLabel: effectiveStudentClass,
                    studentAdm: effectiveStudentAdm,
                    guardianName: unit?.guardian || document.getElementById('ledger-pay-guardian')?.textContent || '',
                    amount: amount,
                    groupMonthAmount: amount,
                    groupPaidAmount: amount,
                    billingGroupId: null,
                    receiptNo: receiptNo,
                    itemKey: canonicalItem.key,
                    itemName: canonicalItem.name || itemName,
                    itemType: canonicalItem.type || 'month',
                    paymentMode: mode,
                    paymentDate: paymentDate,
                    description: description,
                    timestamp: Date.now(),
                    transactionId: newTxnId,
                    collectedBy: collectorKey,
                    collectedByName: collectorDisplayName,
                    academicYear: academicYear,
                    status: 'FULL'
                };

                batch.set(payRef, paymentPayload);
                batch.set(doc(db, `${BASE_PATH}/years/${academicYear}/payments`, payRef.id), paymentPayload);
                batch.set(doc(db, `${BASE_PATH}/academicYears/${cleanYear}/payments`, payRef.id), paymentPayload);

                savedPaymentRecord = {
                    id: payRef.id,
                    ...paymentPayload
                };
                savedPaymentRecords.push({ record: savedPaymentRecord, cell: activeModalOptions?.targetCellElement });
            }
        }

        // Commit to Firestore directly
        await batch.commit();

        // 1. Instant Cell DOM Update (immediate visual feedback for user)
        savedPaymentRecords.forEach(({ record, cell }) => {
            if (cell && record) {
                applyInstantCellUpdate(cell, record);
            }
        });

        // 2. Synchronize in-memory payments lists
        savedPaymentRecords.forEach(({ record }) => {
            if (!record) return;
            if (Array.isArray(window.allPayments)) {
                const idx = window.allPayments.findIndex(p => p.id === record.id);
                if (idx >= 0) {
                    window.allPayments[idx] = { ...window.allPayments[idx], ...record };
                } else {
                    window.allPayments.push(record);
                }
            }

            if (window.MasterLedger?.ledgerPayments && Array.isArray(window.MasterLedger.ledgerPayments)) {
                const idx = window.MasterLedger.ledgerPayments.findIndex(p => p.id === record.id);
                if (idx >= 0) {
                    window.MasterLedger.ledgerPayments[idx] = { ...window.MasterLedger.ledgerPayments[idx], ...record };
                } else {
                    window.MasterLedger.ledgerPayments.push(record);
                }
            }
        });

        // 3. User feedback
        const successMsg = (isEdit || isBulkEdit)
            ? (isBulkEdit ? `${savedPaymentRecords.length} payments updated successfully!` : 'Payment updated successfully!')
            : (isBulkAdd ? `${savedPaymentRecords.length} fees recorded under Receipt${receiptNo ? ` #${receiptNo}` : ''}!` : `Fee recorded successfully!${receiptNo ? ` Receipt: #${receiptNo}` : ''}`);
        showToast(successMsg, 'success');

        // 4. Callback
        if (typeof activeModalOptions?.onUpdated === 'function') {
            activeModalOptions.onUpdated(isBulk ? savedPaymentRecords.map(r => r.record) : savedPaymentRecord);
        }

        // 5. Close modal & keyboard smoothly BEFORE staggered non-blocking background refreshes
        closeFeeEntryEditModal();

        const isPanelVisible = (id) => {
            const el = document.getElementById(id);
            return Boolean(el && !el.classList.contains('hidden'));
        };

        const runDeferredRefreshes = () => {
            if (isPanelVisible('master-ledger-page')) {
                if (typeof window.MasterLedger?.renderTable === 'function') {
                    window.MasterLedger.renderTable({ preserveScroll: true });
                } else if (typeof window.syncMasterLedgerState === 'function') {
                    window.syncMasterLedgerState();
                }
            }

            const runIdleSecondary = () => {
                if (isPanelVisible('history-page') && typeof window.prepareHistoryData === 'function') {
                    window.prepareHistoryData();
                }
                if (isPanelVisible('dashboard-page') && typeof window.updateDashboardMetrics === 'function') {
                    window.updateDashboardMetrics();
                }
                if (isPanelVisible('monthly-collected-page')) {
                    if (isPanelVisible('collector-wise-monthly-page') && typeof window.renderCollectorWiseMonthlyPage === 'function') {
                        window.renderCollectorWiseMonthlyPage();
                    } else if (typeof window.renderMonthlyCollectedPage === 'function') {
                        const searchVal = document.getElementById('monthly-collected-search-input')?.value || '';
                        window.renderMonthlyCollectedPage(searchVal);
                    }
                }
            };

            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(runIdleSecondary, { timeout: 600 });
            } else {
                setTimeout(runIdleSecondary, 120);
            }
        };

        requestAnimationFrame(() => {
            setTimeout(runDeferredRefreshes, 220);
        });
    } catch (err) {
        console.error('Error saving fee payment:', err);
        showToast(`Failed to save payment: ${err.message || 'Firestore error'}`, 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = isEdit
                ? '<i class="fas fa-save mr-1"></i> Update Payment'
                : '<i class="fas fa-check mr-1"></i> Record Payment';
        }
    } finally {
        isSubmitting = false;
    }
};

/**
 * Initialize Shared Modal Event Listeners
 */
export const initSharedFeeModal = () => {
    const modal = document.getElementById('master-ledger-pay-modal');
    if (!modal) return;

    // Close buttons
    document.getElementById('ledger-pay-close-x')?.addEventListener('click', closeFeeEntryEditModal);
    document.getElementById('ledger-pay-cancel-btn')?.addEventListener('click', closeFeeEntryEditModal);

    // Overlay click to close
    modal.addEventListener('click', (e) => {
        if (e.target.id === 'master-ledger-pay-modal') {
            closeFeeEntryEditModal();
        }
    });

    // Confirm button click
    const confirmBtn = document.getElementById('ledger-pay-confirm-btn');
    if (confirmBtn) {
        confirmBtn.onclick = submitFeeEntryPayment;
    }

    // Submit on Enter key in amount/receipt/description input
    ['ledger-pay-amount', 'ledger-pay-receipt', 'ledger-pay-description'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitFeeEntryPayment();
            }
        });
    });
};

// Global Exposure for legacy script interop
window.openFeeEntryEditModal = openFeeEntryEditModal;
window.closeFeeEntryEditModal = closeFeeEntryEditModal;
window.submitFeeEntryPayment = submitFeeEntryPayment;
window.initSharedFeeModal = initSharedFeeModal;

// Compatibility adapters
window.openStudentQuickPayModal = (args) => {
    openFeeEntryEditModal({
        source: 'fee-status',
        mode: 'add',
        student: {
            id: args.studentId,
            name: args.studentName,
            class: args.studentClass,
            adm: args.studentAdm,
            guardian: args.guardian
        },
        month: args.month,
        itemKey: args.itemKey,
        itemName: args.itemName || args.month,
        defaultAmount: args.defaultAmount,
        targetCellElement: args.targetCellElement
    });
};

window.openEditPaymentInQuickModal = (payment, targetCellElement) => {
    openFeeEntryEditModal({
        mode: 'edit',
        payment: payment,
        targetCellElement: targetCellElement
    });
};
