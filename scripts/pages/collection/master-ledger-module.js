import { db, auth } from '../../../config/firebase-config.js';
import { BASE_PATH, formatCurrency, escapeHtml, populateAcademicYearSelect, populateClassSelect, compareClassLabelsNatural, resolveAcademicYearClasses } from '../../shared/app-common.js';
import { appLog } from '../../shared/logger.js';
import { showToast } from '../../shared/toaster.js';
import { collection, doc, writeBatch, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { openFeeEntryEditModal, closeFeeEntryEditModal, submitFeeEntryPayment } from './shared-fee-modal.js';

/**
 * Master Fee Ledger Module
 * Provides edge-to-edge spreadsheet monitoring, consolidated family sibling groupings,
 * multi-parameter sorting & filtering, inline payment recording, and landscape PDF export.
 */

// Module state
let ledgerStudents = [];
let ledgerAllStudents = [];
let ledgerRawStudents = [];
let ledgerDutyClasses = [];
let ledgerGroups = [];
let ledgerPayments = [];
let ledgerClasses = ['+2', '+1', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'];
let ledgerDefaultFee = 200;
let ledgerMonthlyFeeEnabled = true;
let ledgerAcademicYear = '';
let isInitialized = false;

// Filter state
const filters = {
    viewMode: 'GROUPED', // 'GROUPED' or 'INDIVIDUAL'
    search: '',
    classFilter: '',
    academicYear: '',
    classOrder: 'DESC', // 'DESC' (+2 to 1) or 'ASC' (1 to +2)
    studentSort: 'DEFAULT', // 'DEFAULT', 'ADM', 'A-Z', 'Z-A'
    genderMode: 'MIXED', // 'MIXED', 'CLASS_BOYS_FIRST', 'GLOBAL_BOYS_FIRST'
    statusFilter: 'ALL' // 'ALL', 'CONCESSION', 'GROUP', 'PENDING', 'PAID'
};

let ledgerRowLimit = 25;
let ledgerPageOffset = 0;

// Bulk Selection State for Master Fee Ledger
// Key: `${unitId}__${month}`, Value: { unitId, month, type: 'pay' | 'edit', paymentId }
const selectedLedgerCells = new Map();

const updateLedgerBulkActionButtons = () => {
    const actionsWrap = document.getElementById('ledger-bulk-actions');
    const collectBtn = document.getElementById('ledger-bulk-collect-btn');
    const collectLabel = document.getElementById('ledger-bulk-collect-label');
    const editBtn = document.getElementById('ledger-bulk-edit-btn');
    const editLabel = document.getElementById('ledger-bulk-edit-label');

    let payCount = 0;
    let editCount = 0;
    selectedLedgerCells.forEach(val => {
        if (val.type === 'pay') payCount += 1;
        else if (val.type === 'edit') editCount += 1;
    });

    if (actionsWrap) {
        const hasAny = payCount > 0 || editCount > 0;
        actionsWrap.classList.toggle('hidden', !hasAny);
        actionsWrap.classList.toggle('flex', hasAny);
    }

    if (collectBtn && collectLabel) {
        collectBtn.classList.toggle('hidden', payCount === 0);
        collectBtn.classList.toggle('flex', payCount > 0);
        collectLabel.textContent = `Collect (${payCount})`;
    }

    if (editBtn && editLabel) {
        editBtn.classList.toggle('hidden', editCount === 0);
        editBtn.classList.toggle('flex', editCount > 0);
        editLabel.textContent = `Edit (${editCount})`;
    }
};

export const clearLedgerBulkSelection = () => {
    selectedLedgerCells.clear();
    document.querySelectorAll('.ledger-cell-select-cb').forEach(cb => {
        cb.checked = false;
        const cell = cb.closest('td');
        if (cell) cell.classList.remove('ring-2', 'ring-blue-500', 'ring-inset', 'bg-blue-50/70');
    });
    document.querySelectorAll('.ledger-col-select-all-cb, .ledger-row-select-all-cb').forEach(cb => {
        cb.checked = false;
    });
    updateLedgerBulkActionButtons();
};

const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let ledgerAcademicYearSettings = [];
let ledgerAcademicMonths = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];

const resolveLedgerMonths = (yearLabel = ledgerAcademicYear, yearSettings = ledgerAcademicYearSettings) => {
    const matched = Array.isArray(yearSettings) ? yearSettings.find(y => y?.label === yearLabel) : null;
    const startMonth = Number.isInteger(Number(matched?.startMonth)) ? Number(matched.startMonth) : 5; // default June (5)
    const endMonth = Number.isInteger(Number(matched?.endMonth)) ? Number(matched.endMonth) : 4; // default May (4)
    const list = [];
    let cur = startMonth;
    for (let count = 0; count < 24; count++) {
        list.push(MONTH_SHORT_NAMES[cur]);
        if (cur === endMonth) break;
        cur = (cur + 1) % 12;
    }
    return list.length ? list : ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];
};

// Class ranking helper
const getClassRank = (cls = '') => {
    const text = String(cls || '').trim().toUpperCase();
    if (text.includes('+2') || text.includes('PLUS TWO') || text === '12') return 12;
    if (text.includes('+1') || text.includes('PLUS ONE') || text === '11') return 11;
    const match = text.match(/\d+/);
    if (match) return parseInt(match[0], 10);
    if (text.includes('UKG')) return 0.2;
    if (text.includes('LKG')) return 0.1;
    return 0;
};

// Match payment itemKey with month
const isMonthMatch = (itemKey = '', month = '', targetYear = ledgerAcademicYear) => {
    const key = String(itemKey || '').trim().toLowerCase();
    const m = String(month || '').trim().toLowerCase().slice(0, 3);
    if (!key || !m) return false;

    const keyYearMatch = key.match(/^([a-z]{3})-(\d{4})$/);
    if (keyYearMatch) {
        const itemMonth = keyYearMatch[1];
        const itemYearSuffix = keyYearMatch[2];
        if (itemMonth !== m) return false;
        if (targetYear) {
            const curYearClean = String(targetYear).replace(/[^0-9]/g, '');
            const curYearSuffix = curYearClean.length >= 4 ? curYearClean.substring(2, 6) : curYearClean;
            if (curYearSuffix && itemYearSuffix !== curYearSuffix) {
                return false;
            }
        }
        return true;
    }

    return key === m || key.startsWith(m) || key.includes(`-${m}`) || key.includes(`_${m}`);
};

// Next receipt number helper
const getNextReceiptNumber = () => {
    let maxRcpt = 0;
    (ledgerPayments || []).forEach(p => {
        const num = parseInt(p.receiptNo, 10);
        if (!isNaN(num) && num > maxRcpt) maxRcpt = num;
    });
    return maxRcpt + 1;
};

// Resolve exact paid amount for a payment record (respects overrides/concessions & group mirror records)
const resolveLedgerPaymentAmount = (p, fallbackFee = 200) => {
    if (!p) return Number(fallbackFee || 0);
    const isGroupedRec = Boolean(
        p.billingGroupId ||
        p.isGroupPrimary ||
        p.isGroupMirror ||
        (Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 1)
    );
    const gm = Number(p.groupMonthAmount ?? p.groupCoveredAmount ?? 0);
    if (isGroupedRec && Number.isFinite(gm) && gm > 0) {
        return gm;
    }
    if (p.isGroupMirror) {
        const gp = Number(p.groupPaidAmount ?? 0);
        if (Number.isFinite(gp) && gp > 0) return gp;
    }
    const amt = Number(p.amount);
    if (Number.isFinite(amt) && amt >= 0) {
        if (amt === 0 && Number(p.groupPaidAmount || 0) > 0) {
            return Number(p.groupPaidAmount);
        }
        return amt;
    }
    return Number(fallbackFee || 0);
};

// Prefer primary records over mirror records when matching a student+month payment
const findPreferredLedgerPayment = (predicate) => {
    let fallbackMirror = null;
    for (let i = 0; i < ledgerPayments.length; i++) {
        const p = ledgerPayments[i];
        if (!predicate(p)) continue;
        if (!p.isGroupMirror) return p;
        if (!fallbackMirror) fallbackMirror = p;
    }
    return fallbackMirror;
};

// Sum distinct member payments once per shared transaction/group so partial+remaining payments add accurately
const resolveGroupPaidTotalAmount = (paidMemberEntries = [], fallbackGroupFee = 200) => {
    if (!Array.isArray(paidMemberEntries) || paidMemberEntries.length === 0) {
        return Number(fallbackGroupFee || 0);
    }
    const seenKeys = new Set();
    let total = 0;
    paidMemberEntries.forEach(({ member, payment }) => {
        if (!payment) return;
        const isGroupScoped = Boolean(
            payment.billingGroupId ||
            payment.isGroupPrimary ||
            payment.isGroupMirror ||
            (Array.isArray(payment.targetGroupMemberIds) && payment.targetGroupMemberIds.length > 1)
        );
        const dedupKey = isGroupScoped
            ? `${payment.transactionId || payment.receiptNo || payment.id}__${String(payment.itemKey || '').toLowerCase()}__${payment.billingGroupId || 'subset'}`
            : `${payment.id || `${payment.transactionId || payment.receiptNo}__${member?.id || payment.studentId}`}`;
        if (seenKeys.has(dedupKey)) return;
        seenKeys.add(dedupKey);
        total += resolveLedgerPaymentAmount(payment, fallbackGroupFee);
    });
    return Math.round(total * 100) / 100;
};

// Helper to resolve a student's class for a specific academic year
const resolveStudentClassForLedgerYear = (s = {}, activeYear = '') => {
    if (!s) return '-';
    return (activeYear && s.academicYears?.[activeYear]?.class) || s.class || s.studentClass || '-';
};

// Group resolving logic
export const buildLedgerUnits = () => {
    const activeYear = filters.academicYear || ledgerAcademicYear;
    const dutyStudentIdSet = new Set();
    ledgerStudents.forEach(s => {
        if (s?.id) dutyStudentIdSet.add(s.id);
    });

    // Full lookup map allows resolving cross-class group siblings while dutyStudentIdSet gates eligibility
    const studentMap = new Map();
    ledgerRawStudents.forEach(s => {
        if (s?.id) studentMap.set(s.id, s);
    });
    ledgerAllStudents.forEach(s => {
        if (s?.id) studentMap.set(s.id, s);
    });
    ledgerStudents.forEach(s => {
        if (s?.id) studentMap.set(s.id, s);
    });

    const units = [];

    // Map each student ID to their group if assigned
    const studentGroupMap = new Map();
    ledgerGroups.forEach(group => {
        const memberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
        memberIds.forEach(id => studentGroupMap.set(id, group));
    });

    if (filters.viewMode === 'INDIVIDUAL') {
        // Individual student view: every student has an individual row (Fee Status style)
        ledgerStudents.forEach(s => {
            const grp = studentGroupMap.get(s.id);
            const isGroupMember = !!grp;
            const groupName = grp?.name || 'Family Group';
            const groupFee = grp ? Number(grp.fee || grp.amount || (ledgerDefaultFee * (grp.memberIds?.length || 1))) : 0;
            const hasConcession = s.concessionFee !== undefined && s.concessionFee !== null && s.concessionFee !== '';
            const indFee = hasConcession ? Number(s.concessionFee) : (isGroupMember ? groupFee : ledgerDefaultFee);
            const activeYear = filters.academicYear || ledgerAcademicYear;
            const sClass = (activeYear && s.academicYears?.[activeYear]?.class) || s.class || s.studentClass || '-';

            const monthStatus = {};
            ledgerAcademicMonths.forEach(month => {
                const matchedPayment = findPreferredLedgerPayment(p => {
                    if (ledgerAcademicYear && p.academicYear && p.academicYear !== ledgerAcademicYear) return false;
                    if (!isMonthMatch(p.itemKey, month)) return false;
                    const isSelfPay = p.studentId === s.id || (s.adm && p.admissionNo === s.adm);
                    if (isSelfPay) return true;
                    if (isGroupMember && p.billingGroupId === grp.id) {
                        if (Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 0) {
                            return p.targetGroupMemberIds.includes(s.id);
                        }
                        return true;
                    }
                    return false;
                });

                if (matchedPayment) {
                    monthStatus[month] = {
                        isPaid: true,
                        amount: resolveLedgerPaymentAmount(matchedPayment, indFee),
                        receipt: matchedPayment.receiptNo || 'Paid',
                        date: matchedPayment.paymentDate || (matchedPayment.timestamp ? new Date(matchedPayment.timestamp).toLocaleDateString('en-GB') : '-'),
                        paymentId: matchedPayment.id || null
                    };
                } else {
                    monthStatus[month] = {
                        isPaid: false,
                        due: indFee,
                        receipt: '',
                        date: ''
                    };
                }
            });

            const unpaidMonths = ledgerAcademicMonths.filter(m => !monthStatus[m]?.isPaid);
            const unpaidMonthsCount = unpaidMonths.length;
            const totalDue = unpaidMonthsCount * indFee;

            units.push({
                id: s.id,
                isGroup: false,
                isGroupMember,
                groupId: grp?.id || null,
                groupName,
                groupFee,
                defaultFee: ledgerDefaultFee,
                students: [s],
                classes: [sClass],
                guardian: s.guardian || s.father || grp?.guardianName || 'Guardian',
                phone: s.phone || s.mobile || grp?.phone || '',
                fee: indFee,
                isConcession: hasConcession,
                extraFees: { total: 0, balance: 0 },
                arrears: 0,
                unpaidMonthsCount,
                totalDue,
                monthStatus
            });
        });
    } else {
        // Grouped family units view: siblings grouped into single row
        const processedStudentIds = new Set();

        // 1. Process defined student groups (family / siblings)
        ledgerGroups.forEach(group => {
            const memberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
            const members = memberIds.map(id => studentMap.get(id)).filter(Boolean);
            const hasDutyMember = members.some(m => dutyStudentIdSet.has(m.id));

            if (members.length > 0 && hasDutyMember) {
                members.forEach(m => processedStudentIds.add(m.id));

                // Sort siblings by class high to low (year-aware), then name
                members.sort((a, b) =>
                    getClassRank(resolveStudentClassForLedgerYear(b, activeYear)) - getClassRank(resolveStudentClassForLedgerYear(a, activeYear))
                    || (a.name || '').localeCompare(b.name || '')
                );

                const primary = members[0];
                const groupFee = Number(group.fee || group.amount || (ledgerDefaultFee * members.length));
                const guardianName = group.guardianName || primary.guardian || primary.father || 'Guardian';
                const contactPhone = group.phone || primary.phone || primary.mobile || '';

                // Calculate month payments per group member accurately (handles full group & partial individual payments)
                const monthStatus = {};
                ledgerAcademicMonths.forEach(month => {
                    const paidMemberEntries = [];
                    const unpaidMembers = [];

                    members.forEach(member => {
                        const matchedPayment = findPreferredLedgerPayment(p => {
                            if (ledgerAcademicYear && p.academicYear && p.academicYear !== ledgerAcademicYear) return false;
                            if (!isMonthMatch(p.itemKey, month)) return false;
                            if (p.studentId === member.id || (member.adm && p.admissionNo === member.adm)) return true;
                            if (p.billingGroupId === group.id) {
                                if (Array.isArray(p.targetGroupMemberIds) && p.targetGroupMemberIds.length > 0) {
                                    return p.targetGroupMemberIds.includes(member.id);
                                }
                                return true;
                            }
                            return false;
                        });
                        if (matchedPayment) {
                            paidMemberEntries.push({ member, payment: matchedPayment });
                        } else {
                            unpaidMembers.push(member);
                        }
                    });

                    if (unpaidMembers.length === 0 && paidMemberEntries.length > 0) {
                        const primaryEntry = paidMemberEntries.find(e => !e.payment?.isGroupMirror) || paidMemberEntries[0];
                        const firstPay = primaryEntry.payment;
                        monthStatus[month] = {
                            isPaid: true,
                            isPartial: false,
                            paidMemberIds: paidMemberEntries.map(e => e.member.id),
                            unpaidMemberIds: [],
                            paidCount: paidMemberEntries.length,
                            totalCount: members.length,
                            amount: resolveGroupPaidTotalAmount(paidMemberEntries, groupFee),
                            receipt: firstPay.receiptNo || 'Paid',
                            date: firstPay.paymentDate || (firstPay.timestamp ? new Date(firstPay.timestamp).toLocaleDateString('en-GB') : '-'),
                            paymentId: firstPay.id || null,
                            payment: firstPay
                        };
                    } else if (paidMemberEntries.length > 0 && unpaidMembers.length > 0) {
                        const unpaidIndivSum = unpaidMembers.reduce((sum, m) => {
                            const hasConc = m.concessionFee !== undefined && m.concessionFee !== null && m.concessionFee !== '';
                            return sum + (hasConc ? Number(m.concessionFee) : ledgerDefaultFee);
                        }, 0);
                        const firstPay = paidMemberEntries[0].payment;
                        monthStatus[month] = {
                            isPaid: false,
                            isPartial: true,
                            paidMemberIds: paidMemberEntries.map(e => e.member.id),
                            unpaidMemberIds: unpaidMembers.map(m => m.id),
                            paidCount: paidMemberEntries.length,
                            totalCount: members.length,
                            due: unpaidIndivSum,
                            receipt: firstPay.receiptNo || '',
                            date: firstPay.paymentDate || '',
                            paymentId: firstPay.id || null
                        };
                    } else {
                        monthStatus[month] = {
                            isPaid: false,
                            isPartial: false,
                            paidMemberIds: [],
                            unpaidMemberIds: members.map(m => m.id),
                            paidCount: 0,
                            totalCount: members.length,
                            due: groupFee,
                            receipt: '',
                            date: ''
                        };
                    }
                });

                const unpaidMonths = ledgerAcademicMonths.filter(m => !monthStatus[m]?.isPaid);
                const unpaidMonthsCount = unpaidMonths.length;
                const totalDue = unpaidMonths.reduce((sum, m) => sum + Number(monthStatus[m]?.due ?? groupFee), 0);

                units.push({
                    id: `group_${group.id}`,
                    isGroup: true,
                    isGroupMember: false,
                    groupId: group.id,
                    groupName: group.name || 'Family Group',
                    defaultFee: ledgerDefaultFee,
                    students: members,
                    classes: members.map(m => ((filters.academicYear || ledgerAcademicYear) && m.academicYears?.[filters.academicYear || ledgerAcademicYear]?.class) || m.class || m.studentClass || '-'),
                    guardian: guardianName,
                    phone: contactPhone,
                    fee: groupFee,
                    isConcession: false,
                    extraFees: { total: 0, balance: 0 },
                    arrears: 0,
                    unpaidMonthsCount,
                    totalDue,
                    monthStatus
                });
            }
        });

        // 2. Process ungrouped individual students
        ledgerStudents.forEach(s => {
            if (!processedStudentIds.has(s.id)) {
                const hasConcession = s.concessionFee !== undefined && s.concessionFee !== null && s.concessionFee !== '';
                const indFee = hasConcession ? Number(s.concessionFee) : ledgerDefaultFee;
                const activeYear = filters.academicYear || ledgerAcademicYear;
                const sClass = (activeYear && s.academicYears?.[activeYear]?.class) || s.class || s.studentClass || '-';

                const monthStatus = {};
                ledgerAcademicMonths.forEach(month => {
                    const matchedPayment = findPreferredLedgerPayment(p => {
                        if (ledgerAcademicYear && p.academicYear && p.academicYear !== ledgerAcademicYear) return false;
                        return (p.studentId === s.id || (s.adm && p.admissionNo === s.adm)) && isMonthMatch(p.itemKey, month);
                    });

                    if (matchedPayment) {
                        monthStatus[month] = {
                            isPaid: true,
                            amount: resolveLedgerPaymentAmount(matchedPayment, indFee),
                            receipt: matchedPayment.receiptNo || 'Paid',
                            date: matchedPayment.paymentDate || (matchedPayment.timestamp ? new Date(matchedPayment.timestamp).toLocaleDateString('en-GB') : '-'),
                            paymentId: matchedPayment.id || null,
                            payment: matchedPayment
                        };
                    } else {
                        monthStatus[month] = {
                            isPaid: false,
                            due: indFee,
                            receipt: '',
                            date: ''
                        };
                    }
                });

                const unpaidMonths = ledgerAcademicMonths.filter(m => !monthStatus[m]?.isPaid);
                const unpaidMonthsCount = unpaidMonths.length;
                const totalDue = unpaidMonthsCount * indFee;

                units.push({
                    id: s.id,
                    isGroup: false,
                    isGroupMember: false,
                    groupId: null,
                    groupName: '',
                    students: [s],
                    classes: [sClass],
                    guardian: s.guardian || s.father || 'Guardian',
                    phone: s.phone || s.mobile || '',
                    fee: indFee,
                    isConcession: hasConcession,
                    extraFees: { total: 0, balance: 0 },
                    arrears: 0,
                    unpaidMonthsCount,
                    totalDue,
                    monthStatus
                });
            }
        });
    }

    return units;
};

// Filter & Sort Pipeline
const getFilteredUnits = () => {
    if (!filters.classFilter) {
        return [];
    }
    let list = buildLedgerUnits();

    // 1. Search Query (Name, Adm, Guardian, Phone)
    if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        list = list.filter(u => {
            const matchName = u.students.some(s => (s.name || '').toLowerCase().includes(q));
            const matchAdm = u.students.some(s => String(s.adm || '').toLowerCase().includes(q));
            const matchGuardian = String(u.guardian || '').toLowerCase().includes(q);
            const matchPhone = String(u.phone || '').includes(q);
            return matchName || matchAdm || matchGuardian || matchPhone;
        });
    }

    // 2. Class Filter
    if (filters.classFilter && filters.classFilter !== 'all') {
        const normalizeCls = (v) => String(v || '').replace(/^class\s*:?\s*/i, '').trim().toLowerCase();
        const targetCls = normalizeCls(filters.classFilter);
        list = list.filter(u => u.classes.some(c => normalizeCls(c) === targetCls));
    }

    // 3. Status Filter
    if (filters.statusFilter === 'GROUP') {
        list = list.filter(u => u.isGroup || u.isGroupMember);
    } else if (filters.statusFilter === 'CONCESSION') {
        list = list.filter(u => u.isConcession);
    } else if (filters.statusFilter === 'PENDING') {
        list = list.filter(u => (u.totalDue || 0) > 0);
    } else if (filters.statusFilter === 'PAID') {
        list = list.filter(u => (u.totalDue || 0) === 0);
    }

    // Helper for max class rank of a unit
    const getUnitClassRank = (u) => {
        const ranks = u.classes.map(c => getClassRank(c));
        return Math.max(...ranks, 0);
    };

    // 4. Sorting & Gender arrangement
    list.sort((a, b) => {
        // A. Class Order sorting
        const rankA = getUnitClassRank(a);
        const rankB = getUnitClassRank(b);
        const classDiff = filters.classOrder === 'DESC' ? (rankB - rankA) : (rankA - rankB);

        // B. Gender Mode logic
        if (filters.genderMode === 'GLOBAL_BOYS_FIRST') {
            const hasFemaleA = a.students.some(s => (s.gender || '').toUpperCase() === 'F' || (s.gender || '').toLowerCase() === 'female');
            const hasFemaleB = b.students.some(s => (s.gender || '').toUpperCase() === 'F' || (s.gender || '').toLowerCase() === 'female');
            if (!hasFemaleA && hasFemaleB) return -1;
            if (hasFemaleA && !hasFemaleB) return 1;
        }

        if (classDiff !== 0) return classDiff;

        if (filters.genderMode === 'CLASS_BOYS_FIRST') {
            const hasFemaleA = a.students.some(s => (s.gender || '').toUpperCase() === 'F' || (s.gender || '').toLowerCase() === 'female');
            const hasFemaleB = b.students.some(s => (s.gender || '').toUpperCase() === 'F' || (s.gender || '').toLowerCase() === 'female');
            if (!hasFemaleA && hasFemaleB) return -1;
            if (hasFemaleA && !hasFemaleB) return 1;
        }

        // C. Student Sorting
        if (filters.studentSort === 'ADM') {
            const admA = parseInt(a.students[0]?.adm, 10) || 0;
            const admB = parseInt(b.students[0]?.adm, 10) || 0;
            return admA - admB;
        } else if (filters.studentSort === 'A-Z') {
            return (a.students[0]?.name || '').localeCompare(b.students[0]?.name || '');
        } else if (filters.studentSort === 'Z-A') {
            return (b.students[0]?.name || '').localeCompare(a.students[0]?.name || '');
        }

        // Default: By student name
        return (a.students[0]?.name || '').localeCompare(b.students[0]?.name || '');
    });

    return list;
};

// Render toolbar filter controls
const renderFilterControls = () => {
    const activeYear = filters.academicYear || ledgerAcademicYear;

    // Populate Academic Year Filter Dropdown
    const yearSelect = document.getElementById('ledger-academic-year-select');
    if (yearSelect) {
        populateAcademicYearSelect(yearSelect, ledgerAcademicYearSettings, ledgerAcademicYear, {
            selectedValue: activeYear,
            preferCurrentUnlessUserChanged: true
        });
    }

    // Populate Class Filter Dropdown (keep collector's duty classes when restricted)
    const classFilterSelect = document.getElementById('ledger-class-filter');
    const resolvedClasses = resolveAcademicYearClasses({
        academicYears: ledgerAcademicYearSettings,
        targetYear: activeYear,
        students: ledgerStudents,
        configuredClasses: ledgerClasses
    });
    const fallbackClasses = Array.isArray(ledgerClasses) ? ledgerClasses : [];
    const normalizeDutyCls = (v) => String(v || '').replace(/^class\s*:?\s*/i, '').trim().toLowerCase();
    const dutyAllowSet = Array.isArray(ledgerDutyClasses) && ledgerDutyClasses.length > 0
        ? new Set(ledgerDutyClasses.map(normalizeDutyCls).filter(Boolean))
        : null;
    const rawUniqueClasses = (resolvedClasses.length ? resolvedClasses : fallbackClasses).filter(Boolean);
    const scopedUniqueClasses = dutyAllowSet
        ? rawUniqueClasses.filter(cls => dutyAllowSet.has(normalizeDutyCls(cls)))
        : rawUniqueClasses;
    const uniqueClasses = (scopedUniqueClasses.length ? scopedUniqueClasses : fallbackClasses.filter(Boolean))
        .sort(compareClassLabelsNatural);

    if (classFilterSelect) {
        populateClassSelect(classFilterSelect, uniqueClasses, {
            selectedValue: filters.classFilter,
            placeholder: '-- Select Class --',
            includeAllOption: true,
            allOptionLabel: 'All Classes',
            allOptionValue: 'all'
        });
        filters.classFilter = classFilterSelect.value;
    }

    // Populate Class Order Dropdown dynamically
    const classOrderSelect = document.getElementById('ledger-class-order');
    if (classOrderSelect) {
        const lowestClass = uniqueClasses[0] || '1';
        const highestClass = uniqueClasses[uniqueClasses.length - 1] || '+2';

        classOrderSelect.innerHTML = `
            <option value="DESC" ${filters.classOrder === 'DESC' ? 'selected' : ''}>Class Order: ${escapeHtml(highestClass)} to ${escapeHtml(lowestClass)}</option>
            <option value="ASC" ${filters.classOrder === 'ASC' ? 'selected' : ''}>Class Order: ${escapeHtml(lowestClass)} to ${escapeHtml(highestClass)}</option>
        `;
    }
};

// Render Table
const renderLedgerTable = (options = {}) => {
    const preserveScroll = Boolean(options && options.preserveScroll);
    const tableContainer = document.getElementById('master-ledger-table-container');
    if (!tableContainer) return;

    if (!ledgerMonthlyFeeEnabled) {
        selectedLedgerCells.clear();
        updateLedgerBulkActionButtons();
        tableContainer.innerHTML = `
            <div class="py-14 px-5 text-center max-w-lg mx-auto bg-white rounded-2xl border border-amber-200 shadow-xs my-2">
                <div class="w-14 h-14 mx-auto mb-3.5 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center text-2xl shadow-2xs">
                    <i class="fas fa-calendar-times"></i>
                </div>
                <h3 class="text-base font-extrabold text-slate-900 mb-1.5">Default Monthly Fee (12 Months) is Disabled</h3>
                <p class="text-xs text-slate-600 leading-relaxed mb-5">This institution has turned off recurring 12-month tuition fees in Fee Settings &amp; Setup. Custom fee items can be collected from Collection Entry and monitored in Fee Dues, while all past monthly payment records remain safely preserved in Payment History and Reports.</p>
                <div class="flex flex-wrap items-center justify-center gap-2.5">
                    <button type="button" id="ledger-go-entry-btn" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition cursor-pointer inline-flex items-center gap-1.5">
                        <i class="fas fa-cash-register"></i> Go to Collection Entry
                    </button>
                    <button type="button" id="ledger-go-settings-btn" class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold transition cursor-pointer inline-flex items-center gap-1.5">
                        <i class="fas fa-sliders-h"></i> Open Fee Settings
                    </button>
                </div>
            </div>
        `;
        document.getElementById('ledger-go-entry-btn')?.addEventListener('click', () => {
            document.querySelector('.nav-link[data-target="home-page"]')?.click();
        });
        document.getElementById('ledger-go-settings-btn')?.addEventListener('click', () => {
            document.querySelector('.nav-link[data-target="fee-settings-page"]')?.click();
        });
        return;
    }

    if (!filters.classFilter) {
        selectedLedgerCells.clear();
        updateLedgerBulkActionButtons();
        tableContainer.innerHTML = `
            <div class="py-16 px-4 text-center max-w-md mx-auto">
                <div class="w-12 h-12 mx-auto mb-3 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl shadow-xs">
                    <i class="fas fa-layer-group"></i>
                </div>
                <h3 class="text-sm font-bold text-slate-800 mb-1">Select a Class to View Fee Register</h3>
                <p class="text-xs text-slate-500 leading-relaxed">Please select a class or choose "All Classes" from the class filter dropdown above to display the fee register records.</p>
            </div>
        `;
        return;
    }

    const list = getFilteredUnits();

    if (list.length === 0) {
        tableContainer.innerHTML = `
            <div class="text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200">
                <i class="fas fa-folder-open text-4xl mb-3 block text-slate-300"></i>
                <p class="font-bold text-sm text-slate-600">No records found matching current filters.</p>
                <p class="text-xs text-slate-400 mt-1">Try resetting search or filter options.</p>
                <button id="ledger-reset-empty-btn" class="mt-4 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition">Clear All Filters</button>
            </div>
        `;
        document.getElementById('ledger-reset-empty-btn')?.addEventListener('click', resetFilters);
        return;
    }

    const totalUnitsCount = list.length;
    const isAll = ledgerRowLimit === 'all';
    const effectiveLimit = isAll ? totalUnitsCount : (parseInt(ledgerRowLimit, 10) || 25);

    if (!isAll && ledgerPageOffset >= totalUnitsCount) {
        ledgerPageOffset = Math.max(0, Math.floor((totalUnitsCount - 1) / effectiveLimit) * effectiveLimit);
    } else if (isAll) {
        ledgerPageOffset = 0;
    }

    const visibleList = isAll ? list : list.slice(ledgerPageOffset, ledgerPageOffset + effectiveLimit);
    const startNumber = totalUnitsCount > 0 ? (isAll ? 1 : ledgerPageOffset + 1) : 0;
    const endNumber = isAll ? totalUnitsCount : (ledgerPageOffset + visibleList.length);

    // Dynamic mobile column widths scaled strictly to visible serial digits and class text length
    const maxSerialDigits = String(Math.max(1, endNumber || visibleList.length)).length;
    const mobileCol1WidthPx = maxSerialDigits <= 2 ? 26 : (maxSerialDigits === 3 ? 32 : 38);
    const maxClassChars = visibleList.reduce((maxLen, u) => {
        const clsLongest = (u.classes || []).reduce((m, c) => Math.max(m, String(c || '').trim().length), 0);
        return Math.max(maxLen, clsLongest);
    }, 1);
    const mobileCol2WidthPx = maxClassChars <= 2 ? 34 : (maxClassChars === 3 ? 40 : (maxClassChars === 4 ? 46 : 52));

    let html = `
        <table class="min-w-full text-xs text-left border-collapse border border-slate-200 bg-white shadow-sm master-ledger-sticky-table" style="--ledger-mobile-col1-w: ${mobileCol1WidthPx}px; --ledger-mobile-col2-w: ${mobileCol2WidthPx}px;">
            <thead class="bg-slate-50 text-[11px] font-black text-slate-700 uppercase tracking-wider border-b border-slate-200 sticky top-0 z-30 shadow-xs">
                <tr>
                    <th class="px-1 sm:px-2.5 py-2.5 sm:py-3.5 text-center border-r border-slate-200 sticky left-0 bg-slate-50 z-40">NO</th>
                    <th class="px-1 sm:px-2.5 py-2.5 sm:py-3.5 text-center border-r border-slate-200 sticky bg-slate-50 z-40"><span class="hidden sm:inline">CLASS</span><span class="sm:hidden">CLS</span></th>
                    <th class="px-1.5 sm:px-3.5 py-2.5 sm:py-3.5 border-r border-slate-300 sticky bg-slate-50 z-40"><span class="hidden sm:inline">STUDENT NAME</span><span class="sm:hidden">STUDENT</span></th>
                    <th class="px-3.5 py-3.5 border-r border-slate-200 min-w-[170px] sm:min-w-[190px]">GUARDIAN & CONTACT</th>
                    <th class="px-2.5 sm:px-3 py-3 sm:py-3.5 text-center border-r border-slate-200 min-w-[105px] sm:min-w-[130px] text-slate-800 bg-slate-100/70">FEE SETUP</th>
                    <th class="px-2 sm:px-3 py-3 sm:py-3.5 text-center border-r border-slate-200 min-w-[102px] sm:min-w-[125px] text-rose-900 bg-rose-50/70">TOTAL DUE</th>
                    ${ledgerAcademicMonths.map(m => `
                        <th class="px-1.5 sm:px-2 py-2 sm:py-2.5 text-center border-r border-slate-200 min-w-[84px] sm:min-w-[98px]">
                            <div class="flex flex-col items-center gap-1">
                                <span>${m.toUpperCase()}</span>
                                <input type="checkbox" class="ledger-col-select-all-cb w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" data-month="${m}" title="Select all unpaid in ${m}">
                            </div>
                        </th>
                    `).join('')}
                </tr>
            </thead>
            <tbody class="font-medium">
    `;

    visibleList.forEach((unit, idx) => {
        const serialNo = ledgerPageOffset + idx + 1;
        const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50';
        const isRowAllSelected = ledgerAcademicMonths.every(m => selectedLedgerCells.has(`${unit.id}__${m}`));

        // Student Names markup: mobile stacks 2-line Name + (Adm + M/F below); desktop keeps single-row Name + (M/F)
        const studentNamesHtml = unit.students.map((s, sIdx) => {
            const genderVal = (s.gender || '').toUpperCase();
            const isFem = genderVal === 'F' || genderVal === 'FEMALE';
            const genderDesktopBadge = isFem
                ? `<span class="hidden sm:inline-block text-[10px] font-extrabold text-pink-600 bg-pink-50 px-1 py-0.5 rounded border border-pink-100 ml-1.5 shrink-0">(F)</span>`
                : `<span class="hidden sm:inline-block text-[10px] font-extrabold text-blue-600 bg-blue-50 px-1 py-0.5 rounded border border-blue-100 ml-1.5 shrink-0">(M)</span>`;
            const genderMobileBadge = isFem
                ? `<span class="text-[9.5px] font-extrabold text-pink-600 shrink-0">(F)</span>`
                : `<span class="text-[9.5px] font-extrabold text-blue-600 shrink-0">(M)</span>`;
            const prefix = unit.isGroup ? `<span class="text-blue-600 font-bold text-[10.5px] sm:text-xs shrink-0">${sIdx + 1}. </span>` : '';

            const desktopSubBadges = [];
            if (s.adm) {
                desktopSubBadges.push(`<span class="font-mono text-slate-500 font-semibold text-[10px]">Adm: ${escapeHtml(s.adm)}</span>`);
            }
            if (unit.isGroupMember) {
                desktopSubBadges.push(`<span class="text-purple-700 font-bold text-[10px] inline-flex items-center gap-0.5"><i class="fas fa-users text-[8px]"></i> ${escapeHtml(unit.groupName)}</span>`);
            }
            if (unit.isConcession) {
                desktopSubBadges.push(`<span class="text-emerald-700 font-bold text-[10px] inline-flex items-center gap-0.5"><i class="fas fa-tag text-[8px]"></i> Concession</span>`);
            }

            const mobileSubParts = [];
            if (s.adm) {
                mobileSubParts.push(`<span class="font-mono text-slate-500 font-semibold text-[9.5px]">Adm: ${escapeHtml(s.adm)}</span>`);
            }
            mobileSubParts.push(genderMobileBadge);
            if (unit.isGroupMember) {
                mobileSubParts.push(`<span class="text-purple-700 font-bold text-[9.5px] inline-flex items-center gap-0.5"><i class="fas fa-users text-[8px]"></i>${escapeHtml(unit.groupName)}</span>`);
            }
            if (unit.isConcession) {
                mobileSubParts.push(`<span class="text-emerald-700 font-bold text-[9.5px] inline-flex items-center gap-0.5"><i class="fas fa-tag text-[8px]"></i>Conc</span>`);
            }

            return `
                <div class="leading-tight sm:leading-snug py-0.5">
                    <div class="flex items-start sm:items-center gap-0.5 sm:gap-1 min-w-0">
                        ${prefix}
                        <span class="font-bold text-[10.5px] sm:text-xs text-slate-800 uppercase hover:text-blue-600 cursor-pointer ledger-student-name line-clamp-2 sm:line-clamp-none break-words whitespace-normal sm:truncate" data-student-id="${escapeHtml(s.id)}" title="${escapeHtml(s.name || 'Student')} (Adm: ${escapeHtml(s.adm || '--')})">${escapeHtml(s.name || 'Student')}</span>
                        ${genderDesktopBadge}
                    </div>
                    <div class="flex sm:hidden flex-wrap items-center gap-x-1 gap-y-0.5 mt-0.5 leading-tight">${mobileSubParts.join('')}</div>
                    ${desktopSubBadges.length > 0 ? `<div class="hidden sm:flex flex-wrap items-center gap-1.5 mt-0.5">${desktopSubBadges.join('<span class="text-slate-300">•</span>')}</div>` : ''}
                </div>
            `;
        }).join('');

        // Classes markup
        const classesHtml = unit.classes.map(c => `
            <div class="font-bold text-slate-800 text-[10px] sm:text-[11px] leading-tight sm:leading-snug py-0.5 whitespace-nowrap">${escapeHtml(c)}</div>
        `).join('');

        // Fee Setup badge
        let feeSetupHtml = '';
        if (unit.isGroup) {
            feeSetupHtml = `<div class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-purple-200 bg-purple-50 text-purple-900 font-bold text-xs shadow-2xs" title="Family group with ${unit.students.length} siblings">
                 <i class="fas fa-users text-purple-600 text-[10px]"></i> ₹${unit.fee} (${unit.students.length})
               </div>`;
        } else if (unit.isGroupMember) {
            feeSetupHtml = `<div class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-purple-200 bg-purple-50 text-purple-900 font-bold text-xs shadow-2xs" title="Member of ${escapeHtml(unit.groupName)}">
                 <i class="fas fa-users text-purple-600 text-[10px]"></i> ₹${unit.fee}
               </div>`;
        } else if (unit.isConcession) {
            feeSetupHtml = `<div class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 font-bold text-xs shadow-2xs" title="Concession Fee: ₹${unit.fee}">
                 <i class="fas fa-hand-holding-heart text-emerald-600 text-[10px]"></i> ₹${unit.fee}
               </div>`;
        } else {
            feeSetupHtml = `<div class="inline-flex items-center justify-center px-3 py-1 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-xs">
                 ₹${unit.fee}
               </div>`;
        }

        // Live Total Due badge
        const dueHtml = (unit.totalDue || 0) > 0
            ? `<div class="inline-flex flex-col items-center justify-center px-2 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 shadow-2xs leading-tight" title="${unit.unpaidMonthsCount} unpaid month${unit.unpaidMonthsCount > 1 ? 's' : ''}">
                 <span class="text-xs font-black">₹${formatCurrency(unit.totalDue)}</span>
                 <span class="text-[9px] font-bold text-rose-500">${unit.unpaidMonthsCount} mo${unit.unpaidMonthsCount > 1 ? 's' : ''} due</span>
               </div>`
            : `<div class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-xs shadow-2xs">
                 <i class="fas fa-check text-[9px]"></i> Nil Due
               </div>`;

        html += `
            <tr class="${rowBg} hover:bg-blue-50/40 transition-colors">
                <!-- NO -->
                <td class="px-1 sm:px-2.5 py-2 sm:py-3 text-center text-[10.5px] sm:text-xs font-bold text-slate-500 border-r border-slate-200 sticky left-0 bg-white z-20 tabular-nums">
                    ${serialNo}
                </td>

                <!-- CLASS -->
                <td class="px-1 sm:px-2.5 py-2 sm:py-3 text-center font-black border-r border-slate-200 sticky bg-white z-20 tabular-nums">
                    ${classesHtml}
                </td>

                <!-- STUDENT NAME -->
                <td class="px-1.5 sm:px-3.5 py-2 sm:py-3 border-r border-slate-300 sticky bg-white z-20">
                    <div class="flex items-start sm:items-center justify-between gap-1 sm:gap-2">
                        <div class="space-y-0.5 min-w-0 flex-1">
                            ${studentNamesHtml}
                        </div>
                        <input type="checkbox" class="ledger-row-select-all-cb w-3.5 h-3.5 mt-0.5 sm:mt-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer flex-shrink-0" data-unit-id="${escapeHtml(unit.id)}" ${isRowAllSelected ? 'checked' : ''} title="Select all months for this student/group">
                    </div>
                </td>

                <!-- GUARDIAN & CONTACT -->
                <td class="px-3.5 py-3 border-r border-slate-200">
                    <div class="font-bold text-slate-800 text-xs uppercase">${escapeHtml(unit.guardian)}</div>
                    <div class="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono mt-0.5">
                        <span>${escapeHtml(unit.phone || '--')}</span>
                        ${unit.phone ? `
                            <button type="button" class="copy-phone-btn text-slate-400 hover:text-slate-600 transition" data-phone="${escapeHtml(unit.phone)}" title="Copy phone">
                                <i class="fas fa-copy text-[10px]"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>

                <!-- FEE SETUP -->
                <td class="px-3 py-3 text-center border-r border-slate-200 bg-slate-50/20">
                    ${feeSetupHtml}
                </td>

                <!-- TOTAL DUE -->
                <td class="px-2.5 py-3 text-center border-r border-slate-200 bg-rose-50/20">
                    ${dueHtml}
                </td>

                <!-- 12 ACADEMIC MONTHS -->
                ${ledgerAcademicMonths.map(month => {
                    const st = unit.monthStatus[month] || { isPaid: false, due: unit.fee };
                    const selKey = `${unit.id}__${month}`;
                    const isSelected = selectedLedgerCells.has(selKey);
                    const selRing = isSelected ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/70' : '';

                    if (st.isPaid) {
                        const paidAmtDisplay = Math.round(Number(st.amount ?? unit.fee ?? 0));
                        const paidPaymentRec = st.payment || ledgerPayments.find(p => st.paymentId && p.id === st.paymentId) || null;
                        const canEditPaidCell = typeof window.canModifyPaymentRecord === 'function'
                            ? window.canModifyPaymentRecord(paidPaymentRec)
                            : true;
                        const cellTitle = canEditPaidCell
                            ? `Paid ₹${paidAmtDisplay} (${escapeHtml(st.receipt || 'Paid')}) • Click to view receipt or tick checkbox to bulk edit`
                            : `Paid ₹${paidAmtDisplay} (${escapeHtml(st.receipt || 'Paid')}) • Click to view receipt (View Only)`;
                        return `
                            <td class="px-1.5 py-2 text-center border-r border-slate-200 bg-emerald-50/50 fee-cell-interactive cursor-pointer hover:bg-emerald-100 transition relative ${selRing}"
                                data-ledger-action="view-receipt" data-payment-id="${st.paymentId || ''}" data-unit-id="${unit.id}" data-month="${month}" title="${cellTitle}">
                                <div class="flex items-center ${canEditPaidCell ? 'justify-between' : 'justify-center'} mb-0.5 px-0.5">
                                    ${canEditPaidCell ? `<input type="checkbox" class="ledger-cell-select-cb w-3.5 h-3.5 rounded border-emerald-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                        data-sel-key="${escapeHtml(selKey)}"
                                        data-unit-id="${escapeHtml(unit.id)}"
                                        data-month="${escapeHtml(month)}"
                                        data-sel-type="edit"
                                        data-payment-id="${escapeHtml(st.paymentId || '')}"
                                        ${isSelected ? 'checked' : ''}
                                        title="Select to bulk edit">` : ''}
                                    <div class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black border border-emerald-200">
                                        <i class="fas fa-check text-[7px]"></i> Paid
                                    </div>
                                </div>
                                <div class="flex flex-col items-center justify-center">
                                    <div class="text-[10px] font-black font-mono tabular-nums text-emerald-900">₹${paidAmtDisplay}</div>
                                    <div class="text-[9px] font-mono font-bold text-emerald-850 truncate max-w-[85px]" title="${escapeHtml(st.receipt)}">${st.receipt ? `R:${escapeHtml(st.receipt)}` : 'Paid'}</div>
                                    <div class="text-[8.5px] text-emerald-600 font-medium leading-tight">${escapeHtml(st.date)}</div>
                                </div>
                            </td>
                        `;
                    }

                    if (st.isPartial) {
                        const dueFeeAttr = Number(st.due ?? unit.fee ?? ledgerDefaultFee);
                        return `
                            <td class="px-1.5 py-2 text-center border-r border-slate-200 bg-amber-50/70 fee-cell-interactive cursor-pointer hover:bg-amber-100/70 transition relative ${selRing}"
                                data-ledger-action="pay-fee" data-unit-id="${unit.id}" data-month="${month}" data-fee="${dueFeeAttr}" title="Partial payment (${st.paidCount}/${st.totalCount} paid). Click to collect remaining dues">
                                <div class="flex items-center justify-between mb-1 px-0.5">
                                    <input type="checkbox" class="ledger-cell-select-cb w-3.5 h-3.5 rounded border-amber-400 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        data-sel-key="${escapeHtml(selKey)}"
                                        data-unit-id="${escapeHtml(unit.id)}"
                                        data-month="${escapeHtml(month)}"
                                        data-sel-type="pay"
                                        data-fee="${dueFeeAttr}"
                                        ${isSelected ? 'checked' : ''}
                                        title="Select to collect remaining dues">
                                    <span class="text-[9px] font-black text-amber-700">${st.paidCount}/${st.totalCount} Paid</span>
                                </div>
                                <div class="flex flex-col items-center justify-center">
                                    <button type="button" class="ledger-quick-pay-btn w-full py-0.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-bold text-[10px] transition shadow-2xs">
                                        Collect
                                    </button>
                                </div>
                            </td>
                        `;
                    }

                    return `
                        <td class="px-1.5 py-2 text-center border-r border-slate-200 bg-white fee-cell-interactive cursor-pointer hover:bg-blue-50 transition relative ${selRing}"
                            data-ledger-action="pay-fee" data-unit-id="${unit.id}" data-month="${month}" data-fee="${unit.fee}" title="Click to record fee payment or tick checkbox for multi-entry">
                            <div class="flex items-center justify-between mb-1 px-0.5">
                                <input type="checkbox" class="ledger-cell-select-cb w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    data-sel-key="${escapeHtml(selKey)}"
                                    data-unit-id="${escapeHtml(unit.id)}"
                                    data-month="${escapeHtml(month)}"
                                    data-sel-type="pay"
                                    data-fee="${unit.fee}"
                                    ${isSelected ? 'checked' : ''}
                                    title="Select to collect together">
                                <span class="text-[9px] font-black text-rose-500">Unpaid</span>
                            </div>
                            <div class="flex flex-col items-center justify-center">
                                <button type="button" class="ledger-quick-pay-btn w-full py-0.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-700 rounded-md font-bold text-[10px] transition border border-blue-200 shadow-2xs">
                                    Pay
                                </button>
                            </div>
                        </td>
                    `;
                }).join('')}
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    const hasPrevPage = !isAll && ledgerPageOffset > 0;
    const hasNextPage = !isAll && (endNumber < totalUnitsCount);
    const totalDuesSum = list.reduce((sum, u) => sum + (u.totalDue || 0), 0);
    const totalPaidUnits = list.filter(u => (u.totalDue || 0) === 0).length;

    if (totalUnitsCount > 0) {
        html += `
            <div class="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3.5 bg-slate-50 border-t border-slate-200">
                <div class="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
                    <span class="font-bold text-slate-600">
                        Showing <span class="text-slate-900 font-extrabold">${startNumber} - ${endNumber}</span> of <span class="text-slate-900 font-extrabold">${totalUnitsCount}</span> records
                    </span>
                    <span class="text-slate-300">|</span>
                    <span class="font-bold text-rose-700 bg-rose-100/70 border border-rose-200 px-2.5 py-0.5 rounded-lg shadow-2xs">
                        Total Due: ₹${formatCurrency(totalDuesSum)}
                    </span>
                    <span class="font-bold text-emerald-700 bg-emerald-100/70 border border-emerald-200 px-2.5 py-0.5 rounded-lg shadow-2xs">
                        Fully Paid: ${totalPaidUnits}
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="ledger-prev-btn" ${!hasPrevPage ? 'disabled' : ''} class="px-4 py-2 ${hasPrevPage ? 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 cursor-pointer' : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'} rounded-xl text-xs font-extrabold shadow-2xs transition inline-flex items-center gap-1.5">
                        <i class="fas fa-arrow-left text-[10px]"></i>
                        <span>Previous</span>
                    </button>
                    <button type="button" id="ledger-load-next-btn" ${!hasNextPage ? 'disabled' : ''} class="px-5 py-2 ${hasNextPage ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer' : 'bg-slate-200 text-slate-400 cursor-not-allowed'} rounded-xl text-xs font-extrabold shadow-xs transition inline-flex items-center gap-1.5">
                        <span>Next</span>
                        <i class="fas fa-arrow-right text-[10px]"></i>
                    </button>
                </div>
            </div>
        `;
    }

    const prevScrollTop = preserveScroll ? tableContainer.scrollTop : 0;
    const prevScrollLeft = tableContainer.scrollLeft;
    tableContainer.innerHTML = html;
    tableContainer.scrollTop = prevScrollTop;
    tableContainer.scrollLeft = prevScrollLeft;

    document.getElementById('ledger-prev-btn')?.addEventListener('click', () => {
        if (!isAll && ledgerPageOffset > 0) {
            ledgerPageOffset = Math.max(0, ledgerPageOffset - effectiveLimit);
            renderLedgerTable();
        }
    });

    document.getElementById('ledger-load-next-btn')?.addEventListener('click', () => {
        if (!isAll && (ledgerPageOffset + effectiveLimit < totalUnitsCount)) {
            ledgerPageOffset += effectiveLimit;
            renderLedgerTable();
        }
    });

    // Attach event handlers for interactive checkboxes & buttons
    attachTableEventHandlers(list);
    updateLedgerBulkActionButtons();
};

// Event handlers on table elements
const attachTableEventHandlers = (currentUnits) => {
    // 1. Phone copy
    document.querySelectorAll('.copy-phone-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const phone = btn.dataset.phone;
            if (phone) {
                navigator.clipboard?.writeText(phone);
                showToast(`Copied phone: ${phone}`, 'success');
            }
        });
    });

    // 1b. Column Header "Select All in Month" Checkboxes
    document.querySelectorAll('.ledger-col-select-all-cb').forEach(colCb => {
        colCb.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        colCb.addEventListener('change', (e) => {
            const month = colCb.dataset.month;
            const shouldCheck = colCb.checked;
            const monthCbs = Array.from(document.querySelectorAll(`.ledger-cell-select-cb[data-month="${month}"][data-sel-type="pay"]`));
            const targetCbs = monthCbs.length > 0
                ? monthCbs
                : Array.from(document.querySelectorAll(`.ledger-cell-select-cb[data-month="${month}"]`));

            targetCbs.forEach(cb => {
                cb.checked = shouldCheck;
                const selKey = cb.dataset.selKey;
                const td = cb.closest('td');
                if (shouldCheck) {
                    selectedLedgerCells.set(selKey, {
                        unitId: cb.dataset.unitId,
                        month: cb.dataset.month,
                        type: cb.dataset.selType,
                        paymentId: cb.dataset.paymentId || '',
                        fee: Number(cb.dataset.fee || 200)
                    });
                    if (td) td.classList.add('ring-2', 'ring-blue-500', 'ring-inset', 'bg-blue-50/70');
                } else {
                    selectedLedgerCells.delete(selKey);
                    if (td) td.classList.remove('ring-2', 'ring-blue-500', 'ring-inset', 'bg-blue-50/70');
                }
            });
            updateLedgerBulkActionButtons();
        });
    });

    // 1b-row. Student Row "Select All Months for Student/Group" Checkboxes
    document.querySelectorAll('.ledger-row-select-all-cb').forEach(rowCb => {
        rowCb.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        rowCb.addEventListener('change', () => {
            const unitId = rowCb.dataset.unitId;
            const shouldCheck = rowCb.checked;
            const unpaidRowCbs = Array.from(document.querySelectorAll(`.ledger-cell-select-cb[data-unit-id="${CSS.escape(unitId)}"][data-sel-type="pay"]`));
            const targetCbs = unpaidRowCbs.length > 0
                ? unpaidRowCbs
                : Array.from(document.querySelectorAll(`.ledger-cell-select-cb[data-unit-id="${CSS.escape(unitId)}"]`));

            targetCbs.forEach(cb => {
                cb.checked = shouldCheck;
                const selKey = cb.dataset.selKey;
                const td = cb.closest('td');
                if (shouldCheck) {
                    selectedLedgerCells.set(selKey, {
                        unitId: cb.dataset.unitId,
                        month: cb.dataset.month,
                        type: cb.dataset.selType,
                        paymentId: cb.dataset.paymentId || '',
                        fee: Number(cb.dataset.fee || 200)
                    });
                    if (td) td.classList.add('ring-2', 'ring-blue-500', 'ring-inset', 'bg-blue-50/70');
                } else {
                    selectedLedgerCells.delete(selKey);
                    if (td) td.classList.remove('ring-2', 'ring-blue-500', 'ring-inset', 'bg-blue-50/70');
                }
            });
            updateLedgerBulkActionButtons();
        });
    });

    // 1c. Individual Cell Checkboxes
    document.querySelectorAll('.ledger-cell-select-cb').forEach(cb => {
        cb.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        cb.addEventListener('change', () => {
            const selKey = cb.dataset.selKey;
            const td = cb.closest('td');
            if (cb.checked) {
                selectedLedgerCells.set(selKey, {
                    unitId: cb.dataset.unitId,
                    month: cb.dataset.month,
                    type: cb.dataset.selType,
                    paymentId: cb.dataset.paymentId || '',
                    fee: Number(cb.dataset.fee || 200)
                });
                if (td) td.classList.add('ring-2', 'ring-blue-500', 'ring-inset', 'bg-blue-50/70');
            } else {
                selectedLedgerCells.delete(selKey);
                if (td) td.classList.remove('ring-2', 'ring-blue-500', 'ring-inset', 'bg-blue-50/70');
            }
            updateLedgerBulkActionButtons();
        });
    });

    // 2. Cell Action clicks (Pay or View Receipt)
    const tableContainer = document.getElementById('master-ledger-table-container');
    if (tableContainer) {
        tableContainer.onclick = (e) => {
            if (e.target.closest('.ledger-cell-select-cb') || e.target.closest('.ledger-col-select-all-cb') || e.target.closest('.ledger-row-select-all-cb')) {
                return;
            }
            const viewCell = e.target.closest('[data-ledger-action="view-receipt"]');
            if (viewCell) {
                const paymentId = viewCell.dataset.paymentId;
                const unitId = viewCell.dataset.unitId;
                const month = viewCell.dataset.month;
                let payment = ledgerPayments.find(p => paymentId && p.id === paymentId);
                if (!payment && unitId) {
                    const unit = currentUnits.find(u => u.id === unitId);
                    if (unit) {
                        const mIds = unit.students.map(s => s.id);
                        payment = ledgerPayments.find(p => (p.billingGroupId === unit.groupId || mIds.includes(p.studentId)) && isMonthMatch(p.itemKey, month));
                    }
                }
                if (payment && typeof window.openPaymentReceiptDetailModal === 'function') {
                    window.openPaymentReceiptDetailModal(payment.id || paymentId, viewCell);
                } else {
                    showToast('Receipt details not found.', 'info');
                }
                return;
            }

            const payCell = e.target.closest('[data-ledger-action="pay-fee"]');
            if (payCell) {
                const unitId = payCell.dataset.unitId;
                const month = payCell.dataset.month;
                const unit = currentUnits.find(u => u.id === unitId);
                if (unit) {
                    openQuickPayModal(unit, month, payCell);
                }
                return;
            }

            const studentNameEl = e.target.closest('.ledger-student-name');
            if (studentNameEl) {
                const sId = studentNameEl.dataset.studentId;
                if (sId && typeof window.openStudentProfile === 'function') {
                    window.openStudentProfile(sId);
                }
                return;
            }
        };
    }
};

// Trigger Bulk Collect or Bulk Edit Modal for selected cells in Master Fee Ledger
const openLedgerBulkActionModal = (actionType = 'pay') => {
    const allUnits = buildLedgerUnits();
    const bulkItems = [];

    selectedLedgerCells.forEach((sel, selKey) => {
        if (sel.type !== actionType) return;
        const unit = allUnits.find(u => u.id === sel.unitId);
        if (!unit) return;

        const cbEl = document.querySelector(`.ledger-cell-select-cb[data-sel-key="${CSS.escape(selKey)}"]`);
        const cellEl = cbEl ? cbEl.closest('td') : null;
        const studentNames = unit.students.map(s => s.name).join(', ');
        const studentClasses = unit.classes.join(', ');
        const primaryStudent = unit.students[0] || {};

        if (actionType === 'pay') {
            const monthState = unit.monthStatus?.[sel.month];
            const unpaidIds = Array.isArray(monthState?.unpaidMemberIds) ? monthState.unpaidMemberIds : null;
            const collectStudents = (unit.isGroup && unpaidIds && unpaidIds.length > 0)
                ? unit.students.filter(s => unpaidIds.includes(s.id))
                : unit.students;
            const collectNames = collectStudents.map(s => s.name).join(', ');
            const collectClasses = collectStudents.map(s => ((filters.academicYear || ledgerAcademicYear) && s.academicYears?.[filters.academicYear || ledgerAcademicYear]?.class) || s.class || s.studentClass || '-').join(', ');
            const targetPrimary = collectStudents[0] || primaryStudent;

            bulkItems.push({
                unitId: unit.id,
                unit: unit,
                collectStudents: collectStudents,
                isPartialGroup: Boolean(unit.isGroup && monthState?.isPartial),
                studentId: targetPrimary.id || unit.id,
                studentName: unit.isGroup ? `${collectNames} (${monthState?.isPartial ? 'Due Members' : 'Group'})` : collectNames,
                studentClass: collectClasses || studentClasses,
                studentAdm: collectStudents.map(s => s.adm).filter(Boolean).join(', '),
                guardian: unit.guardian || '',
                billingGroupId: (unit.isGroup && !monthState?.isPartial && collectStudents.length === unit.students.length) ? unit.groupId : null,
                month: sel.month,
                itemKey: sel.month.toLowerCase(),
                itemName: unit.isGroup ? `${sel.month} Tuition Fee (${monthState?.isPartial ? 'Remaining Group Members' : 'Family Group'})` : `${sel.month} Tuition Fee`,
                itemType: 'month',
                amount: Number(sel.fee ?? (monthState?.isPartial ? monthState.due : unit.fee) ?? ledgerDefaultFee ?? 200),
                academicYear: ledgerAcademicYear,
                targetCellElement: cellEl
            });
        } else if (actionType === 'edit') {
            const mIds = unit.students.map(s => s.id);
            const payment = findPreferredLedgerPayment(p => (sel.paymentId && p.id === sel.paymentId) || ((p.billingGroupId === unit.groupId || mIds.includes(p.studentId)) && isMonthMatch(p.itemKey, sel.month)));
            const canEditPayment = typeof window.canModifyPaymentRecord === 'function' ? window.canModifyPaymentRecord(payment) : true;
            if (payment && canEditPayment) {
                bulkItems.push({
                    paymentId: payment.id,
                    payment: payment,
                    unit: unit,
                    studentId: payment.studentId || primaryStudent.id,
                    studentName: unit.isGroup ? `${studentNames} (Group)` : (payment.studentName || studentNames),
                    studentClass: payment.studentClass || studentClasses,
                    guardian: unit.guardian || payment.guardianName || '',
                    month: sel.month,
                    itemKey: payment.itemKey || sel.month.toLowerCase(),
                    itemName: payment.itemName || `${sel.month} Tuition Fee`,
                    amount: resolveLedgerPaymentAmount(payment, unit.fee || 200),
                    academicYear: payment.academicYear || ledgerAcademicYear,
                    targetCellElement: cellEl
                });
            }
        }
    });

    if (bulkItems.length === 0) {
        showToast('No valid items selected.', 'info');
        return;
    }

    openFeeEntryEditModal({
        source: 'master-ledger',
        mode: actionType === 'edit' ? 'bulk-edit' : 'bulk-add',
        bulkItems: bulkItems,
        academicYear: ledgerAcademicYear,
        onUpdated: () => {
            clearLedgerBulkSelection();
        }
    });
};

// Open Quick Pay Modal for recording new payment in Master Ledger
export const openQuickPayModal = (unit, month, targetCellElement = null) => {
    if (!unit) return;
    const monthState = unit.monthStatus?.[month];
    const effectiveDefault = unit.isGroup && monthState?.isPartial && Number.isFinite(Number(monthState.due))
        ? Number(monthState.due)
        : unit.fee;
    openFeeEntryEditModal({
        source: 'master-ledger',
        mode: 'add',
        unit: unit,
        month: month,
        itemKey: month.toLowerCase(),
        itemName: `${month} Tuition Fee`,
        defaultAmount: effectiveDefault,
        defaultFee: ledgerDefaultFee,
        targetCellElement: targetCellElement,
        academicYear: ledgerAcademicYear
    });
};

// Open Quick Pay Modal for an individual student (Fee Status compatibility adapter)
export const openStudentQuickPayModal = ({ studentId, studentName, studentClass, studentAdm, guardian, month, itemKey, defaultAmount, targetCellElement }) => {
    openFeeEntryEditModal({
        source: 'fee-status',
        mode: 'add',
        student: {
            id: studentId,
            name: studentName,
            class: studentClass,
            adm: studentAdm,
            guardian: guardian
        },
        month: month,
        itemKey: itemKey || month,
        itemName: month ? `${month} Tuition Fee` : 'Tuition Fee',
        defaultAmount: defaultAmount || ledgerDefaultFee || 200,
        targetCellElement: targetCellElement,
        academicYear: ledgerAcademicYear
    });
};
window.openStudentQuickPayModal = openStudentQuickPayModal;

// Open in-place Edit Modal for existing payment without redirecting to Fee Entry
export const openEditPaymentInQuickModal = (payment, targetCellElement = null) => {
    if (!payment) return;
    if (typeof window.canModifyPaymentRecord === 'function' && !window.canModifyPaymentRecord(payment)) {
        showToast('You can only edit payments that you collected.', 'warn');
        return;
    }
    openFeeEntryEditModal({
        mode: 'edit',
        payment: payment,
        targetCellElement: targetCellElement,
        academicYear: payment.academicYear || ledgerAcademicYear
    });
};
window.openEditPaymentInQuickModal = openEditPaymentInQuickModal;

// Close Quick Pay Modal
export const closeQuickPayModal = () => {
    closeFeeEntryEditModal();
};

// Process and Save Fee Payment (Delegates to shared submission utility)
export const submitLedgerPayment = async () => {
    return submitFeeEntryPayment();
};

// Open PDF Export Options Modal for Fee Register
const openLedgerPdfModal = () => {
    if (!filters.classFilter) {
        showToast('Please select a class or choose All Classes to preview PDF.', 'info');
        return;
    }

    if (!window.jspdf?.jsPDF) {
        showToast('PDF generator is loading, please try again.', 'info');
        return;
    }

    const list = getFilteredUnits();
    if (list.length === 0) {
        showToast('No records available to export.', 'error');
        return;
    }

    const modal = document.getElementById('ledger-pdf-export-modal');
    if (!modal) {
        exportLedgerPdfWithOptions({});
        return;
    }

    const scopeLabel = document.getElementById('ledger-pdf-modal-scope-label');
    const countLabel = document.getElementById('ledger-pdf-modal-count-label');
    const optClass = document.getElementById('ledger-pdf-opt-class');
    const optGuardian = document.getElementById('ledger-pdf-opt-guardian');
    const optPhone = document.getElementById('ledger-pdf-opt-phone');
    const optFeeSetup = document.getElementById('ledger-pdf-opt-fee-setup');

    if (scopeLabel) {
        const classTxt = filters.classFilter && filters.classFilter !== 'all'
            ? (filters.classFilter.toLowerCase().startsWith('class') ? filters.classFilter : `Class: ${filters.classFilter}`)
            : 'All Classes';
        scopeLabel.textContent = `Scope: ${classTxt}`;
    }
    if (countLabel) {
        countLabel.textContent = `${list.length} Records`;
    }
    if (optClass) optClass.checked = false;
    if (optGuardian) optGuardian.checked = false;
    if (optPhone) optPhone.checked = false;
    if (optFeeSetup) optFeeSetup.checked = false;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.style.display = 'flex';
};

// Close Fee Register PDF Export Options Modal
const closeLedgerPdfModal = () => {
    const modal = document.getElementById('ledger-pdf-export-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
};

// Export to Landscape PDF (Class-wise Boys then Girls, without currency symbols)
const exportLedgerPdfWithOptions = ({
    includeClass = false,
    includeGuardian = false,
    includePhone = false,
    includeFeeSetup = false
} = {}) => {
    if (!filters.classFilter) {
        showToast('Please select a class or choose All Classes to preview PDF.', 'info');
        return;
    }

    if (!window.jspdf?.jsPDF) {
        showToast('PDF generator is loading, please try again.', 'info');
        return;
    }

    const list = getFilteredUnits();
    if (list.length === 0) {
        showToast('No records available to export.', 'error');
        return;
    }

    const docPdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const conf = window.institutionConfig || {};
    const instName = conf.appName || document.getElementById('header-title')?.textContent?.trim() || 'Institution Name';
    const place = conf.place || document.getElementById('header-place')?.textContent?.trim() || '';
    const regNo = conf.regNo || document.getElementById('header-regno')?.textContent?.trim() || '';

    const pageWidth = docPdf.internal.pageSize.getWidth();
    const pageHeight = docPdf.internal.pageSize.getHeight();
    const marginH = 20;

    // Header
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(14);
    docPdf.setTextColor(15, 23, 42);
    docPdf.text(instName.toUpperCase(), pageWidth / 2, 28, { align: 'center' });

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9);
    docPdf.setTextColor(100, 116, 139);
    const subtitle = [place, regNo ? `Reg No: ${regNo}` : '', `Academic Year: ${ledgerAcademicYear || 'Current'}`].filter(Boolean).join(' • ');
    docPdf.text(subtitle, pageWidth / 2, 42, { align: 'center' });

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(11);
    docPdf.setTextColor(30, 41, 59);
    docPdf.text('FEE REGISTER', marginH, 60);

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(8);
    docPdf.text(`Generated on: ${new Date().toLocaleString('en-GB')} | Total Records: ${list.length}`, pageWidth - marginH, 60, { align: 'right' });

    // Group units by first student's class in natural class order, then split Boys and Girls
    const isFemaleUnit = (unit) => {
        const g = String(unit.students?.[0]?.gender || '').trim().toLowerCase();
        return g === 'female' || g === 'f' || g === 'girl';
    };

    const groupedByClass = Object.values(list.reduce((acc, unit) => {
        const primaryClass = String(unit.classes?.[0] || unit.students?.[0]?.class || '-').trim() || '-';
        if (!acc[primaryClass]) acc[primaryClass] = { classLabel: primaryClass, boys: [], girls: [] };
        if (isFemaleUnit(unit)) acc[primaryClass].girls.push(unit);
        else acc[primaryClass].boys.push(unit);
        return acc;
    }, {})).sort((a, b) => compareClassLabelsNatural(a.classLabel, b.classLabel));

    const includeContactCol = includeGuardian || includePhone;
    const contactHeaderLabel = (includeGuardian && includePhone)
        ? 'GUARDIAN & PHONE'
        : (includeGuardian ? 'GUARDIAN' : 'PHONE');

    const buildHead = (genderTitle) => {
        const cols = ['NO'];
        if (includeClass) cols.push('CLASS');
        cols.push(genderTitle);
        if (includeContactCol) cols.push(contactHeaderLabel);
        if (includeFeeSetup) cols.push('FEE SETUP');
        cols.push('TOTAL DUE', ...ledgerAcademicMonths.map(m => m.toUpperCase()), 'STATUS');
        return [cols];
    };

    const buildRows = (units = []) => units.map((unit, idx) => {
        const studentNamesStr = unit.students.map((s, i) => `${unit.isGroup ? `${i + 1}. ` : ''}${s.name} (${s.gender === 'F' ? 'F' : 'M'})${s.adm ? ` [${s.adm}]` : ''}`).join('\n');
        const classesStr = unit.classes.join('\n');

        let contactStr = '';
        if (includeGuardian && includePhone) {
            contactStr = `${unit.guardian || '--'}\n${unit.phone || '--'}`;
        } else if (includeGuardian) {
            contactStr = `${unit.guardian || '--'}`;
        } else if (includePhone) {
            contactStr = `${unit.phone || '--'}`;
        }

        let feeStr = `${unit.fee}`;
        if (unit.isGroup) feeStr = `Group (${unit.students.length})\n${unit.fee}`;
        else if (unit.isGroupMember) feeStr = `Group: ${unit.groupName}\n${unit.fee}`;
        else if (unit.isConcession) feeStr = `Concession\n${unit.fee}`;

        const plainDueAmount = Math.round(Number(unit.totalDue || 0));
        const dueStr = plainDueAmount > 0 ? `${plainDueAmount}\n(${unit.unpaidMonthsCount} mos)` : 'Nil Due';

        const monthValues = ledgerAcademicMonths.map(m => {
            const st = unit.monthStatus[m];
            if (st?.isPaid) {
                const rcpt = st.receipt && String(st.receipt).trim() !== '' && st.receipt !== 'Paid'
                    ? String(st.receipt).trim()
                    : 'Paid';
                return rcpt;
            }
            return '';
        });

        const overallStatus = (unit.totalDue || 0) === 0 ? 'Completed' : `${unit.unpaidMonthsCount} mos due`;

        const row = [idx + 1];
        if (includeClass) row.push(classesStr);
        row.push(studentNamesStr);
        if (includeContactCol) row.push(contactStr);
        if (includeFeeSetup) row.push(feeStr);
        row.push(dueStr, ...monthValues, overallStatus);
        return row;
    });

    const usableWidth = pageWidth - (marginH * 2);
    const monthCount = Math.max(1, ledgerAcademicMonths.length || 12);
    const contactColWidth = includeContactCol
        ? ((includeGuardian && includePhone) ? 78 : (includeGuardian ? 68 : 56))
        : 0;
    const fixedCols = {
        no: 20,
        cls: includeClass ? 32 : 0,
        contact: contactColWidth,
        fee: includeFeeSetup ? 42 : 0,
        due: 44,
        status: 48
    };
    const targetNameWidth = 92;
    const minNameWidth = 68;
    const fixedWithoutName = Object.values(fixedCols).reduce((sum, w) => sum + w, 0);
    const maxMonthsBudget = Math.max(120, usableWidth - fixedWithoutName - minNameWidth - 4);
    const idealMonthsBudget = Math.max(120, usableWidth - fixedWithoutName - targetNameWidth - 2);
    const remainingForMonths = Math.min(maxMonthsBudget, idealMonthsBudget);
    const monthColWidth = Math.floor((remainingForMonths / monthCount) * 10) / 10;
    const isDenseMonths = monthCount > 13;

    const ledgerColumnStyles = {};
    let colIdx = 0;
    ledgerColumnStyles[colIdx++] = { cellWidth: fixedCols.no, halign: 'center' };
    if (includeClass) {
        ledgerColumnStyles[colIdx++] = { cellWidth: fixedCols.cls, halign: 'center', fontStyle: 'bold' };
    }
    ledgerColumnStyles[colIdx++] = { cellWidth: 'auto', minCellWidth: minNameWidth };
    if (includeContactCol) {
        ledgerColumnStyles[colIdx++] = { cellWidth: fixedCols.contact };
    }
    if (includeFeeSetup) {
        ledgerColumnStyles[colIdx++] = { cellWidth: fixedCols.fee, halign: 'center' };
    }
    ledgerColumnStyles[colIdx++] = { cellWidth: fixedCols.due, halign: 'center', fontStyle: 'bold' };
    const monthStartColIdx = colIdx;
    for (let mIdx = 0; mIdx < monthCount; mIdx++) {
        ledgerColumnStyles[colIdx++] = { cellWidth: monthColWidth, halign: 'center' };
    }
    ledgerColumnStyles[colIdx++] = { cellWidth: fixedCols.status, halign: 'center' };

    const sharedDidParseCell = (data) => {
        if (data.section === 'body' && data.column.index >= monthStartColIdx && data.column.index < monthStartColIdx + monthCount) {
            const cellText = String(data.cell.raw || '').trim();
            data.cell.styles.halign = 'center';
            if (cellText) {
                data.cell.styles.textColor = [15, 23, 42];
                data.cell.styles.fontStyle = 'bold';
            }
        }
    };

    let currentY = 68;
    groupedByClass.forEach((classGroup, classIdx) => {
        if (classIdx > 0) {
            currentY = docPdf.lastAutoTable ? docPdf.lastAutoTable.finalY + 14 : currentY + 14;
        }
        if (currentY > pageHeight - 105) {
            docPdf.addPage();
            currentY = 30;
        }

        // Class Section Banner
        docPdf.setFillColor(241, 245, 249);
        docPdf.rect(marginH, currentY, pageWidth - (marginH * 2), 18, 'F');
        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(10);
        docPdf.setTextColor(15, 23, 42);
        docPdf.text(`CLASS: ${classGroup.classLabel.toUpperCase()}`, marginH + 6, currentY + 12.5);

        const clsTotal = classGroup.boys.length + classGroup.girls.length;
        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8);
        docPdf.setTextColor(100, 116, 139);
        docPdf.text(
            `Records in Class: ${clsTotal} (Boys: ${classGroup.boys.length}, Girls: ${classGroup.girls.length})`,
            pageWidth - marginH - 6,
            currentY + 12.5,
            { align: 'right' }
        );
        currentY += 22;

        // 1. Boys Table
        if (classGroup.boys.length > 0) {
            docPdf.autoTable({
                startY: currentY,
                margin: { left: marginH, right: marginH },
                tableWidth: 'auto',
                head: buildHead('STUDENT NAME (BOYS)'),
                body: buildRows(classGroup.boys),
                theme: 'grid',
                styles: {
                    fontSize: isDenseMonths ? 5.5 : 6.5,
                    cellPadding: isDenseMonths ? 1.5 : 2,
                    lineColor: [226, 232, 240],
                    lineWidth: 0.5,
                    valign: 'middle',
                    overflow: 'linebreak'
                },
                headStyles: {
                    fillColor: [37, 99, 235],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    halign: 'center',
                    fontSize: isDenseMonths ? 5.5 : 6.5
                },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                columnStyles: ledgerColumnStyles,
                didParseCell: sharedDidParseCell
            });
            currentY = docPdf.lastAutoTable.finalY + 8;
        }

        // 2. Girls Table
        if (classGroup.girls.length > 0) {
            if (currentY > pageHeight - 70) {
                docPdf.addPage();
                currentY = 30;
            }
            docPdf.autoTable({
                startY: currentY,
                margin: { left: marginH, right: marginH },
                tableWidth: 'auto',
                head: buildHead('STUDENT NAME (GIRLS)'),
                body: buildRows(classGroup.girls),
                theme: 'grid',
                styles: {
                    fontSize: isDenseMonths ? 5.5 : 6.5,
                    cellPadding: isDenseMonths ? 1.5 : 2,
                    lineColor: [226, 232, 240],
                    lineWidth: 0.5,
                    valign: 'middle',
                    overflow: 'linebreak'
                },
                headStyles: {
                    fillColor: [16, 185, 129],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    halign: 'center',
                    fontSize: isDenseMonths ? 5.5 : 6.5
                },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                columnStyles: ledgerColumnStyles,
                didParseCell: sharedDidParseCell
            });
            currentY = docPdf.lastAutoTable.finalY + 8;
        }
    });

    const totalPages = docPdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        docPdf.setPage(i);
        docPdf.setFont('helvetica', 'normal');
        docPdf.setFontSize(8);
        docPdf.setTextColor(148, 163, 184);
        docPdf.text(`Page ${i} of ${totalPages}`, pageWidth - marginH, pageHeight - 14, { align: 'right' });
        docPdf.text('Generated by Fee Register', marginH, pageHeight - 14);
    }

    docPdf.save(`fee-register-${new Date().toISOString().split('T')[0]}.pdf`);
    showToast('Fee Register PDF downloaded!', 'success');
};

// Reset all filter controls
const resetFilters = () => {
    filters.viewMode = 'GROUPED';
    filters.search = '';
    filters.classFilter = '';
    filters.academicYear = '';
    filters.classOrder = 'DESC';
    filters.studentSort = 'DEFAULT';
    filters.genderMode = 'MIXED';
    filters.statusFilter = 'ALL';
    ledgerPageOffset = 0;

    const viewModeSelect = document.getElementById('ledger-view-mode');
    if (viewModeSelect) viewModeSelect.value = 'GROUPED';

    const searchInput = document.getElementById('ledger-search-input');
    if (searchInput) searchInput.value = '';

    const classFilter = document.getElementById('ledger-class-filter');
    if (classFilter) classFilter.value = '';

    const yearSelect = document.getElementById('ledger-academic-year-select');
    if (yearSelect) yearSelect.value = '';

    const classOrder = document.getElementById('ledger-class-order');
    if (classOrder) classOrder.value = 'DESC';

    const studentSort = document.getElementById('ledger-student-sort');
    if (studentSort) studentSort.value = 'DEFAULT';

    const genderMode = document.getElementById('ledger-gender-mode');
    if (genderMode) genderMode.value = 'MIXED';

    const statusFilter = document.getElementById('ledger-status-filter');
    if (statusFilter) statusFilter.value = 'ALL';

    ledgerAcademicMonths = resolveLedgerMonths(ledgerAcademicYear, ledgerAcademicYearSettings);
    clearLedgerBulkSelection();
    renderFilterControls();
    renderLedgerTable();
};

// Public update hook to sync with collection-page.js data
export const updateMasterLedgerData = ({ students, allStudents, rawStudents, dutyClasses, groups, payments, classes, defaultFee, defaultMonthlyFeeEnabled, academicYear, academicYearSettings, forceResetYear = false }) => {
    if (Array.isArray(students)) ledgerStudents = students;
    if (Array.isArray(allStudents)) ledgerAllStudents = allStudents;
    else if (Array.isArray(students) && ledgerAllStudents.length === 0) ledgerAllStudents = students;
    if (Array.isArray(rawStudents)) ledgerRawStudents = rawStudents;
    if (Array.isArray(dutyClasses)) ledgerDutyClasses = dutyClasses;
    if (Array.isArray(groups)) ledgerGroups = groups;
    if (Array.isArray(payments)) ledgerPayments = payments;
    if (Array.isArray(classes)) ledgerClasses = classes;
    if (typeof defaultFee === 'number') ledgerDefaultFee = defaultFee;
    if (typeof defaultMonthlyFeeEnabled === 'boolean') ledgerMonthlyFeeEnabled = defaultMonthlyFeeEnabled;
    if (forceResetYear) {
        filters.academicYear = '';
        const yearSelect = document.getElementById('ledger-academic-year-select');
        if (yearSelect) yearSelect.dataset.userChangedYear = 'false';
        if (academicYear) ledgerAcademicYear = academicYear;
    } else if (academicYear && !filters.academicYear) {
        ledgerAcademicYear = academicYear;
    }
    if (Array.isArray(academicYearSettings)) ledgerAcademicYearSettings = academicYearSettings;

    ledgerAcademicMonths = resolveLedgerMonths(ledgerAcademicYear, ledgerAcademicYearSettings);

    renderFilterControls();
    renderLedgerTable();
};

// Initialize Module UI & Listeners
export const initMasterLedgerModule = () => {
    if (isInitialized) return;
    isInitialized = true;

    appLog('info', 'collection.masterLedger', 'Master Fee Ledger module initialized');

    // View Mode (Grouped vs Individual) Listener
    const viewModeSelect = document.getElementById('ledger-view-mode');
    if (viewModeSelect) {
        viewModeSelect.addEventListener('change', (e) => {
            filters.viewMode = e.target.value;
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // Academic Year Select Listener
    const yearSelect = document.getElementById('ledger-academic-year-select');
    if (yearSelect) {
        yearSelect.addEventListener('change', (e) => {
            const selectedVal = e.target.value;
            filters.academicYear = selectedVal;
            if (selectedVal) {
                ledgerAcademicYear = selectedVal;
            }
            ledgerAcademicMonths = resolveLedgerMonths(ledgerAcademicYear, ledgerAcademicYearSettings);
            ledgerPageOffset = 0;
            renderFilterControls();
            renderLedgerTable();
            window.dispatchEvent(new CustomEvent('ledgerAcademicYearChanged', { detail: { academicYear: ledgerAcademicYear } }));
        });
    }

    // 0. Rows Limit Listener
    const rowLimitSelect = document.getElementById('ledger-row-limit');
    if (rowLimitSelect) {
        rowLimitSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            ledgerRowLimit = val === 'all' ? 'all' : (parseInt(val, 10) || 25);
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // 1. Search Input Listener
    const searchInput = document.getElementById('ledger-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filters.search = e.target.value;
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // 2. Class Filter Listener
    const classFilter = document.getElementById('ledger-class-filter');
    if (classFilter) {
        classFilter.addEventListener('change', (e) => {
            filters.classFilter = e.target.value;
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // 3. Class Order Listener
    const classOrder = document.getElementById('ledger-class-order');
    if (classOrder) {
        classOrder.addEventListener('change', (e) => {
            filters.classOrder = e.target.value;
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // 4. Student Sort Listener
    const studentSort = document.getElementById('ledger-student-sort');
    if (studentSort) {
        studentSort.addEventListener('change', (e) => {
            filters.studentSort = e.target.value;
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // 5. Gender Mode Listener
    const genderMode = document.getElementById('ledger-gender-mode');
    if (genderMode) {
        genderMode.addEventListener('change', (e) => {
            filters.genderMode = e.target.value;
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // 6. Status Filter Listener
    const statusFilter = document.getElementById('ledger-status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            filters.statusFilter = e.target.value;
            ledgerPageOffset = 0;
            renderLedgerTable();
        });
    }

    // 7. Clear Filters & Selection Button
    const clearBtn = document.getElementById('ledger-clear-filters-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (selectedLedgerCells.size > 0) {
                clearLedgerBulkSelection();
                showToast('Selection cleared.', 'info');
            } else {
                resetFilters();
            }
        });
    }

    // 7b. Bulk Collect & Bulk Edit Buttons
    document.getElementById('ledger-bulk-collect-btn')?.addEventListener('click', () => openLedgerBulkActionModal('pay'));
    document.getElementById('ledger-bulk-edit-btn')?.addEventListener('click', () => openLedgerBulkActionModal('edit'));

    // 8. PDF Export Button & Configuration Modal Listeners
    const pdfBtn = document.getElementById('master-ledger-pdf-btn');
    if (pdfBtn) {
        pdfBtn.addEventListener('click', openLedgerPdfModal);
    }

    document.getElementById('ledger-pdf-modal-close-x')?.addEventListener('click', closeLedgerPdfModal);
    document.getElementById('ledger-pdf-modal-cancel-btn')?.addEventListener('click', closeLedgerPdfModal);
    document.getElementById('ledger-pdf-export-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'ledger-pdf-export-modal') {
            closeLedgerPdfModal();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('ledger-pdf-export-modal');
            if (modal && !modal.classList.contains('hidden')) {
                closeLedgerPdfModal();
            }
        }
    });
    document.getElementById('ledger-pdf-modal-confirm-btn')?.addEventListener('click', () => {
        const includeClass = Boolean(document.getElementById('ledger-pdf-opt-class')?.checked);
        const includeGuardian = Boolean(document.getElementById('ledger-pdf-opt-guardian')?.checked);
        const includePhone = Boolean(document.getElementById('ledger-pdf-opt-phone')?.checked);
        const includeFeeSetup = Boolean(document.getElementById('ledger-pdf-opt-fee-setup')?.checked);
        closeLedgerPdfModal();
        exportLedgerPdfWithOptions({ includeClass, includeGuardian, includePhone, includeFeeSetup });
    });

    // 9. Quick Pay Modal Close & Submit Buttons are managed by shared-fee-modal.js

    // Initial render
    renderFilterControls();
    renderLedgerTable();
};

window.MasterLedger = {
    init: initMasterLedgerModule,
    update: updateMasterLedgerData,
    render: renderLedgerTable,
    renderTable: renderLedgerTable,
    exportPdf: openLedgerPdfModal,
    exportPdfWithOptions: exportLedgerPdfWithOptions,
    openQuickPayModal: openQuickPayModal,
    openStudentQuickPayModal: openStudentQuickPayModal,
    openEditPaymentInQuickModal: openEditPaymentInQuickModal,
    get ledgerPayments() { return ledgerPayments; },
    set ledgerPayments(val) { ledgerPayments = val; },
    get academicYear() { return ledgerAcademicYear; }
};
