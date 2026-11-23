import { appLog } from '../../shared/logger.js';

export const initCollectionUploadModule = () => {
    appLog('info', 'collection.upload', 'Upload module initialized');
};

const roundMoney = (val = 0) => Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;

const normalizeClassToken = (cls = '') => String(cls || '').trim().toUpperCase();

const normalizeFeeNameSafe = (name = '') => String(name || '')
    .replace(/^default\s*[-:—–]?\s*/i, '')
    .replace(/\s*\(\d{4}-\d{4}\)\s*$/i, '')
    .trim();

export const resolveStudentClassForYear = (student = {}, year = '', fallbackYear = '') => {
    const cleanYear = String(year || fallbackYear || '').trim();
    const yearEntry = cleanYear && student?.academicYears && typeof student.academicYears[cleanYear] === 'object'
        ? student.academicYears[cleanYear]
        : null;
    return String(yearEntry?.class || student?.class || '').trim();
};

export const resolveStudentConcessionForYear = (student = {}, year = '') => {
    const cleanYear = String(year || '').trim();
    const yearVal = cleanYear ? student?.academicYears?.[cleanYear]?.concessionFee : undefined;
    const rawVal = (yearVal !== undefined && yearVal !== null && yearVal !== '')
        ? yearVal
        : student?.concessionFee;
    if (rawVal === undefined || rawVal === null || rawVal === '') return null;
    const num = Number(rawVal);
    return Number.isFinite(num) && num >= 0 ? num : null;
};

export const isStudentActiveForBulkYear = (student = {}, year = '', fallbackYear = '') => {
    if (!student) return false;
    const cleanYear = String(year || fallbackYear || '').trim();
    const baseCls = String(student.class || '').trim().toLowerCase();
    const baseSt = String(student.status || '').trim().toLowerCase();
    if (baseCls === 'alumni' || baseSt === 'alumni' || baseSt === 'graduated' || baseSt === 'discontinued' || student.isAlumni === true) {
        return false;
    }
    const yearEntry = cleanYear && student.academicYears && typeof student.academicYears[cleanYear] === 'object'
        ? student.academicYears[cleanYear]
        : null;
    if (yearEntry) {
        const entrySt = String(yearEntry.status || student.status || '').trim().toLowerCase();
        const entryCls = String(yearEntry.class || student.class || '').trim().toLowerCase();
        return entrySt !== 'discontinued' && entrySt !== 'alumni' && entrySt !== 'graduated' && entryCls !== 'alumni';
    }
    return true;
};

const getStudentBillingGroupFromList = (studentId = '', studentGroups = []) => (
    (Array.isArray(studentGroups) ? studentGroups : []).find(
        (g) => g && Array.isArray(g.memberIds) && g.memberIds.includes(studentId)
    ) || null
);

/**
 * Builds the class roster for Bulk Template & Blank Sheet.
 * Any student in targetClass who belongs to a Family Group automatically pulls in
 * ALL active siblings from that Family Group (including siblings from other classes)
 * placed adjacently in one highlighted group block.
 */
export const buildBulkRosterWithGroups = ({
    allStudents = [],
    studentGroups = [],
    targetClass = '',
    year = '',
    fallbackYear = ''
} = {}) => {
    const cleanTargetClass = normalizeClassToken(targetClass);
    const cleanYear = String(year || fallbackYear || '').trim();
    if (!cleanTargetClass || !Array.isArray(allStudents)) return [];

    const activeAll = allStudents
        .filter((s) => isStudentActiveForBulkYear(s, cleanYear, fallbackYear))
        .map((s) => {
            const cls = resolveStudentClassForYear(s, cleanYear, fallbackYear);
            return {
                ...s,
                class: cls || s.class || '',
                studentClass: cls || s.studentClass || s.class || ''
            };
        });

    const studentById = new Map(activeAll.map((s) => [s.id, s]));

    // Primary students in targetClass for the selected academic year
    const targetClassStudents = activeAll
        .filter((s) => {
            const yearEntry = cleanYear && s.academicYears && typeof s.academicYears[cleanYear] === 'object'
                ? s.academicYears[cleanYear]
                : null;
            if (yearEntry) {
                return normalizeClassToken(yearEntry.class || s.class) === cleanTargetClass;
            }
            const stuYear = String(s.academicYear || fallbackYear || '').trim();
            return normalizeClassToken(s.class) === cleanTargetClass && (!cleanYear || !stuYear || stuYear === cleanYear);
        })
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));

    const emittedStudentIds = new Set();
    const emittedGroupIds = new Set();
    const roster = [];

    targetClassStudents.forEach((student) => {
        if (emittedStudentIds.has(student.id)) return;
        const group = getStudentBillingGroupFromList(student.id, studentGroups);

        if (group && Array.isArray(group.memberIds) && group.memberIds.length > 1) {
            if (emittedGroupIds.has(group.id)) return;
            emittedGroupIds.add(group.id);

            const activeMembers = group.memberIds
                .map((id) => studentById.get(id))
                .filter(Boolean)
                .sort((a, b) => {
                    const aInTarget = normalizeClassToken(a.class) === cleanTargetClass ? 0 : 1;
                    const bInTarget = normalizeClassToken(b.class) === cleanTargetClass ? 0 : 1;
                    if (aInTarget !== bInTarget) return aInTarget - bInTarget;
                    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
                });

            if (activeMembers.length > 1) {
                const memberIds = activeMembers.map((m) => m.id);
                activeMembers.forEach((member, idx) => {
                    emittedStudentIds.add(member.id);
                    roster.push({
                        student: member,
                        studentId: member.id,
                        studentClass: member.class || '',
                        isTargetClassMember: normalizeClassToken(member.class) === cleanTargetClass,
                        group,
                        groupId: group.id,
                        groupName: group.name || 'Family Group',
                        groupFee: Number(group.fee || group.amount || 0),
                        groupMemberIds: memberIds,
                        groupMemberCount: activeMembers.length,
                        groupIndex: idx,
                        isGroupFirst: idx === 0,
                        isGroupLast: idx === activeMembers.length - 1,
                        concessionFee: resolveStudentConcessionForYear(member, cleanYear)
                    });
                });
                return;
            }
        }

        emittedStudentIds.add(student.id);
        roster.push({
            student,
            studentId: student.id,
            studentClass: student.class || '',
            isTargetClassMember: true,
            group: null,
            groupId: '',
            groupName: '',
            groupFee: 0,
            groupMemberIds: [],
            groupMemberCount: 1,
            groupIndex: -1,
            isGroupFirst: false,
            isGroupLast: false,
            concessionFee: resolveStudentConcessionForYear(student, cleanYear)
        });
    });

    return roster;
};

const lookupClassValue = (classValues = {}, studentClass = '') => {
    if (!classValues || typeof classValues !== 'object') return undefined;
    if (classValues[studentClass] !== undefined && classValues[studentClass] !== '') {
        return classValues[studentClass];
    }
    const targetNorm = normalizeClassToken(studentClass);
    const matchedKey = Object.keys(classValues).find((k) => normalizeClassToken(k) === targetNorm);
    if (matchedKey !== undefined && classValues[matchedKey] !== '') {
        return classValues[matchedKey];
    }
    return undefined;
};

/**
 * Resolves all active fee items applicable to the academic year and the classes present in the roster.
 */
export const resolveActiveBulkFeeItems = ({
    feeItems = [],
    year = '',
    defaultMonthlyFeeEnabled = true,
    rosterClasses = [],
    sortMonthlyFn = null,
    excludeKeys = ['__student_donation__']
} = {}) => {
    const cleanYear = String(year || '').trim();
    const excluded = new Set(excludeKeys || []);
    const classSet = new Set((rosterClasses || []).map(normalizeClassToken).filter(Boolean));

    const yearItems = (Array.isArray(feeItems) ? feeItems : []).filter((item) => {
        if (!item || !item.key) return false;
        if (excluded.has(item.key)) return false;
        if (item.isVisible === false) return false;
        if (cleanYear && item.academicYear && item.academicYear !== cleanYear) return false;
        return true;
    });

    let monthlyItems = [];
    if (defaultMonthlyFeeEnabled !== false) {
        monthlyItems = yearItems.filter((item) => (item.type || 'month') === 'month');
        if (typeof sortMonthlyFn === 'function') {
            monthlyItems = sortMonthlyFn(monthlyItems, cleanYear);
        }
    }

    const customItems = yearItems.filter((item) => {
        if (item.type !== 'custom') return false;
        const scope = item.scope || 'global';
        if (scope === 'global') return true;
        if (scope === 'specific') {
            if (!item.targetClass) return true;
            return classSet.size === 0 || classSet.has(normalizeClassToken(item.targetClass));
        }
        if (scope === 'class-wise') {
            if (classSet.size === 0) return true;
            const classVals = item.classValues || {};
            const hasAnyClassMatch = Array.from(classSet).some((cls) => {
                const v = lookupClassValue(classVals, cls);
                return v !== undefined && v !== null && v !== '' && Number(v) >= 0;
            });
            return hasAnyClassMatch || Number(item.amount || 0) > 0;
        }
        return true;
    });

    return [...monthlyItems, ...customItems];
};

/**
 * Resolves the exact expected fee amount for a single student & fee item.
 */
export const resolveExpectedFeeForStudentItem = ({
    student = {},
    studentClass = '',
    group = null,
    item = {},
    year = '',
    defaultFee = 200
} = {}) => {
    const itemType = item?.type || 'month';
    const cls = String(studentClass || resolveStudentClassForYear(student, year) || '').trim();

    if (itemType === 'month') {
        const groupFee = Number(group?.fee || group?.amount || 0);
        if (group && Array.isArray(group.memberIds) && group.memberIds.length > 1 && groupFee > 0) {
            return { applicable: true, amount: roundMoney(groupFee), source: 'group' };
        }
        const concession = resolveStudentConcessionForYear(student, year);
        if (concession !== null) {
            return { applicable: true, amount: roundMoney(concession), source: 'concession' };
        }
        return { applicable: true, amount: roundMoney(Number(defaultFee || 0)), source: 'default' };
    }

    // Custom fee item
    const scope = item.scope || 'global';
    if (scope === 'specific') {
        if (item.targetClass && normalizeClassToken(item.targetClass) !== normalizeClassToken(cls)) {
            return { applicable: false, amount: null, source: 'na' };
        }
        return { applicable: true, amount: roundMoney(Number(item.amount || 0)), source: 'custom-specific' };
    }
    if (scope === 'class-wise') {
        const val = lookupClassValue(item.classValues || {}, cls);
        if (val !== undefined && val !== null && val !== '' && !Number.isNaN(Number(val))) {
            return { applicable: true, amount: roundMoney(Number(val)), source: 'custom-class' };
        }
        if (item.amount !== undefined && item.amount !== null && item.amount !== '' && Number(item.amount) > 0) {
            return { applicable: true, amount: roundMoney(Number(item.amount)), source: 'custom-class' };
        }
        return { applicable: false, amount: null, source: 'na' };
    }

    return { applicable: true, amount: roundMoney(Number(item.amount || 0)), source: 'custom-global' };
};

/**
 * Checks whether a student has already settled a given fee item for the target academic year.
 */
export const findExistingStudentItemPayment = ({
    student = {},
    group = null,
    item = {},
    year = '',
    allPayments = []
} = {}) => {
    if (!student?.id || !item?.key) return null;
    const cleanYear = String(year || '').trim();
    const isMonthly = (item.type || 'month') === 'month';

    return (Array.isArray(allPayments) ? allPayments : []).find((p) => {
        if (!p || p.itemKey !== item.key) return false;
        const pYear = String(p.academicYear || '').trim();
        if (cleanYear && pYear && pYear !== cleanYear) return false;
        if (p.studentId === student.id) return true;
        if (isMonthly && group?.id && p.billingGroupId && p.billingGroupId === group.id) return true;
        return false;
    }) || null;
};

/**
 * Generates standard columns & rows for both Template Download and In-App Blank Sheet.
 */
export const buildBulkSheetMatrixData = ({
    rosterEntries = [],
    activeFeeItems = [],
    year = '',
    targetClass = '',
    defaultFee = 200,
    allPayments = [],
    includeModelRow = false,
    todayIso = new Date().toISOString().split('T')[0]
} = {}) => {
    const columns = [
        { id: 'c_0', header: 'Admission_No', mappedField: 'adm' },
        { id: 'c_1', header: 'Student_Name', mappedField: 'name' },
        { id: 'c_2', header: 'Class', mappedField: 'className' },
        { id: 'c_3', header: 'Group_Info', mappedField: 'groupInfo' }
    ];

    const usedHeaderNames = new Set();
    let colIdx = 4;

    activeFeeItems.forEach((item) => {
        const cleanName = normalizeFeeNameSafe(item.name || item.key) || item.key;
        let safeBase = cleanName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Fee';
        if (usedHeaderNames.has(safeBase.toLowerCase())) {
            safeBase = `${safeBase}_${colIdx}`;
        }
        usedHeaderNames.add(safeBase.toLowerCase());

        columns.push({ id: `c_${colIdx++}`, header: `${safeBase}_Amount`, mappedField: `${item.key}::amount`, itemKey: item.key, subField: 'amount' });
        columns.push({ id: `c_${colIdx++}`, header: `${safeBase}_ReceiptNo`, mappedField: `${item.key}::receiptNo`, itemKey: item.key, subField: 'receiptNo' });
        columns.push({ id: `c_${colIdx++}`, header: `${safeBase}_Date`, mappedField: `${item.key}::date`, itemKey: item.key, subField: 'date' });
    });

    const headers = columns.map((c) => c.header);
    const rowsAsArrays = [];
    const workingRows = [];

    if (includeModelRow) {
        const modelArr = ['1234', 'Model Student Name', String(targetClass || ''), 'Individual'];
        activeFeeItems.forEach((item) => {
            const sampleAmt = (item.type || 'month') === 'month'
                ? roundMoney(Number(defaultFee || 200))
                : roundMoney(Number(item.amount || Object.values(item.classValues || {})[0] || 0));
            modelArr.push(sampleAmt > 0 ? String(sampleAmt) : '200');
            modelArr.push('1001');
            modelArr.push(todayIso);
        });
        rowsAsArrays.push(modelArr);
    }

    rosterEntries.forEach((entry) => {
        const { student, studentClass, group, concessionFee } = entry;
        let groupLabel = 'Individual';
        if (group && entry.groupMemberCount > 1) {
            const feeTag = entry.groupFee > 0 ? ` (₹${entry.groupFee})` : '';
            groupLabel = `Group: ${entry.groupName}${feeTag}`;
        } else if (concessionFee !== null) {
            groupLabel = `Concession (₹${concessionFee})`;
        }

        const arr = [
            student.adm || '',
            student.name || '',
            studentClass || '',
            groupLabel
        ];

        const rowObj = {
            c_0: String(student.adm || ''),
            c_1: String(student.name || ''),
            c_2: String(studentClass || ''),
            c_3: groupLabel,
            __studentId: student.id
        };

        let cPtr = 4;
        activeFeeItems.forEach((item) => {
            const amtColId = `c_${cPtr++}`;
            const rcptColId = `c_${cPtr++}`;
            const dateColId = `c_${cPtr++}`;

            const existingPay = findExistingStudentItemPayment({
                student,
                group,
                item,
                year,
                allPayments
            });
            const feeInfo = resolveExpectedFeeForStudentItem({
                student,
                studentClass,
                group,
                item,
                year,
                defaultFee
            });

            let amtVal = '';
            let rcptVal = '';
            let dateVal = '';

            if (existingPay) {
                const paidDisplayAmt = Number(existingPay.groupMonthAmount || existingPay.amount || 0);
                amtVal = paidDisplayAmt > 0 ? String(paidDisplayAmt) : '';
                rcptVal = existingPay.receiptNo ? String(existingPay.receiptNo) : '';
                dateVal = 'PAID';
            } else if (!feeInfo.applicable) {
                amtVal = '';
                rcptVal = '';
                dateVal = 'N/A';
            } else {
                amtVal = feeInfo.amount !== null && feeInfo.amount !== undefined ? String(feeInfo.amount) : '';
                rcptVal = '';
                dateVal = '';
            }

            arr.push(amtVal, rcptVal, dateVal);
            rowObj[amtColId] = amtVal;
            rowObj[rcptColId] = rcptVal;
            rowObj[dateColId] = dateVal;
        });

        rowsAsArrays.push(arr);
        workingRows.push(rowObj);
    });

    return { headers, columns, rowsAsArrays, workingRows };
};

/**
 * Two-Pass Smart Evaluation Engine for Bulk Upload & Blank Sheet:
 * - Trigger rule: minimum 1 of Date OR Receipt No required (edited amount = normal full payment).
 * - Already paid items locked as PAID.
 * - Not applicable class-specific custom items marked N/A.
 * - Family Group resolution (Auto / Group / Single per group & per fee item):
 *   * Group Payment (e.g. 3/3 members filled with 500): billed ONCE as ₹500 total (Primary + Mirrors).
 *   * Partial Group (e.g. 1/3 or 2/3 filled) or Single Mode: billed individually (e.g. 2 x 500 = ₹1,000).
 */
export const evaluateCollectionBulkSheet = ({
    columns = [],
    workingRows = [],
    activeFeeItems = [],
    rosterEntries = [],
    allStudents = [],
    studentGroups = [],
    allPayments = [],
    targetClass = '',
    year = '',
    fallbackYear = '',
    defaultFee = 200,
    defaultReceiptMandatory = false,
    groupItemModes = new Map(),
    normalizeDateFn = null,
    todayIso = new Date().toISOString().split('T')[0]
} = {}) => {
    const cleanYear = String(year || fallbackYear || '').trim();
    const parseDateSafe = (val = '') => {
        const s = String(val || '').trim();
        if (!s) return '';
        if (typeof normalizeDateFn === 'function') return normalizeDateFn(s) || '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        return '';
    };

    const colByField = {};
    columns.forEach((c) => {
        if (c.mappedField && c.mappedField !== 'none' && !colByField[c.mappedField]) {
            colByField[c.mappedField] = c.id;
        }
    });

    const isEditableField = (mappedField = '') => (
        mappedField.endsWith('::amount') ||
        mappedField.endsWith('::receiptNo') ||
        mappedField.endsWith('::date')
    );

    const activeAll = (Array.isArray(allStudents) ? allStudents : [])
        .filter((s) => isStudentActiveForBulkYear(s, cleanYear, fallbackYear))
        .map((s) => ({
            ...s,
            class: resolveStudentClassForYear(s, cleanYear, fallbackYear) || s.class || ''
        }));

    const rosterStudentPool = (Array.isArray(rosterEntries) ? rosterEntries : []).map((r) => r.student).filter(Boolean);
    const activeById = new Map(activeAll.map((s) => [s.id, s]));

    // Helper: count active members in a group
    const getActiveGroupMembers = (group) => {
        if (!group || !Array.isArray(group.memberIds)) return [];
        return group.memberIds.map((id) => activeById.get(id)).filter(Boolean);
    };

    const itemByKey = new Map(activeFeeItems.map((it) => [it.key, it]));

    // Pass 1: Row identity & raw per-item validation
    const parsedRows = workingRows.map((workingRow, rowIdx) => {
        const rowObj = workingRow || {};
        const hiddenStuId = String(rowObj.__studentId || '').trim();
        const studentIdVal = colByField.studentId ? String(rowObj[colByField.studentId] || '').trim() : '';
        const admVal = colByField.adm ? String(rowObj[colByField.adm] || '').trim() : '';
        const nameVal = colByField.name ? String(rowObj[colByField.name] || '').trim() : '';

        const isSampleRow = studentIdVal === 'SAMPLE-ID-DO-NOT-DELETE' || (
            nameVal.toLowerCase() === 'model student name' &&
            (admVal === '1234' || admVal === '') &&
            !activeAll.some((s) => String(s.name || '').trim().toLowerCase() === 'model student name')
        );

        const cellStatuses = {};
        columns.forEach((c) => {
            if (!c.mappedField || c.mappedField === 'none') {
                cellStatuses[c.id] = { status: 'skip', reason: 'Column skipped' };
            } else if (!isEditableField(c.mappedField)) {
                cellStatuses[c.id] = { status: 'locked', reason: 'Student identity column is read-only' };
            }
        });

        if (isSampleRow) {
            columns.forEach((c) => {
                if (isEditableField(c.mappedField)) {
                    cellStatuses[c.id] = { status: 'sample', reason: 'Sample guide row (automatically skipped)' };
                }
            });
            return {
                rowIdx,
                isSampleRow: true,
                hasFatalError: false,
                matchedStudent: null,
                studentClass: '',
                group: null,
                groupId: '',
                groupName: '',
                groupFee: 0,
                groupMemberCount: 1,
                concessionFee: null,
                displayStudentId: studentIdVal,
                displayAdm: admVal,
                displayName: nameVal || 'Model Student Name',
                candidates: [],
                readyEntries: [],
                readyCount: 0,
                errorCount: 0,
                alreadyPaidCount: 0,
                cellStatuses
            };
        }

        // Match student (check hiddenStuId -> studentIdVal -> roster pool -> full active pool)
        let matchedStudent = null;
        let ambiguousNameError = false;
        const lookupId = hiddenStuId || studentIdVal;
        if (lookupId) {
            matchedStudent = activeById.get(lookupId) || rosterStudentPool.find((s) => s.id === lookupId) || null;
        }
        if (!matchedStudent && admVal) {
            const normAdm = admVal.toUpperCase();
            matchedStudent = rosterStudentPool.find((s) => String(s.adm || '').trim().toUpperCase() === normAdm)
                || activeAll.find((s) => String(s.adm || '').trim().toUpperCase() === normAdm)
                || null;
        }
        if (!matchedStudent && !admVal && nameVal) {
            const normName = nameVal.toLowerCase();
            const rosterMatches = rosterStudentPool.filter((s) => String(s.name || '').trim().toLowerCase() === normName);
            const fallbackMatches = rosterMatches.length > 0
                ? rosterMatches
                : activeAll.filter((s) => String(s.name || '').trim().toLowerCase() === normName);
            if (fallbackMatches.length === 1) {
                matchedStudent = fallbackMatches[0];
            } else if (fallbackMatches.length > 1) {
                ambiguousNameError = true;
            }
        }

        if (!matchedStudent) {
            const fatalReason = ambiguousNameError
                ? `Multiple students named "${nameVal}" — please provide Admission No`
                : (!lookupId && !admVal && !nameVal)
                    ? `Missing Admission No or Student Name`
                    : `Student not found for Academic Year ${cleanYear}`;
            columns.forEach((c) => {
                if (!c.mappedField || c.mappedField === 'none') return;
                cellStatuses[c.id] = { status: 'error', reason: fatalReason };
            });
            return {
                rowIdx,
                isSampleRow: false,
                hasFatalError: true,
                fatalReason,
                matchedStudent: null,
                studentClass: '',
                group: null,
                groupId: '',
                groupName: '',
                groupFee: 0,
                groupMemberCount: 1,
                concessionFee: null,
                displayStudentId: lookupId,
                displayAdm: admVal,
                displayName: nameVal || '--',
                candidates: [],
                readyEntries: [],
                readyCount: 0,
                errorCount: 1,
                alreadyPaidCount: 0,
                cellStatuses
            };
        }

        const studentClass = resolveStudentClassForYear(matchedStudent, cleanYear, fallbackYear) || matchedStudent.class || targetClass;
        const group = getStudentBillingGroupFromList(matchedStudent.id, studentGroups);
        const activeGroupMembers = group ? getActiveGroupMembers(group) : [];
        const hasMultiGroup = Boolean(group && activeGroupMembers.length > 1);
        const concessionFee = resolveStudentConcessionForYear(matchedStudent, cleanYear);

        const candidates = [];
        let errorCount = 0;
        let alreadyPaidCount = 0;

        activeFeeItems.forEach((item) => {
            const amtColId = colByField[`${item.key}::amount`];
            const rcptColId = colByField[`${item.key}::receiptNo`];
            const dateColId = colByField[`${item.key}::date`];
            if (!amtColId && !rcptColId && !dateColId) return;

            const existingPay = findExistingStudentItemPayment({
                student: matchedStudent,
                group: hasMultiGroup ? group : null,
                item,
                year: cleanYear,
                allPayments
            });

            if (existingPay) {
                alreadyPaidCount += 1;
                const rcptTag = existingPay.receiptNo ? ` • Receipt #${existingPay.receiptNo}` : '';
                const paidReason = `Already paid for ${normalizeFeeNameSafe(item.name)} (${cleanYear})${rcptTag}`;
                if (amtColId) cellStatuses[amtColId] = { status: 'paid', reason: paidReason, itemKey: item.key };
                if (rcptColId) cellStatuses[rcptColId] = { status: 'paid', reason: paidReason, itemKey: item.key };
                if (dateColId) cellStatuses[dateColId] = { status: 'paid', reason: paidReason, itemKey: item.key };
                return;
            }

            const feeInfo = resolveExpectedFeeForStudentItem({
                student: matchedStudent,
                studentClass,
                group: hasMultiGroup ? group : null,
                item,
                year: cleanYear,
                defaultFee
            });

            if (!feeInfo.applicable) {
                const naReason = `Not applicable to Class ${studentClass}`;
                if (amtColId) cellStatuses[amtColId] = { status: 'na', reason: naReason, itemKey: item.key };
                if (rcptColId) cellStatuses[rcptColId] = { status: 'na', reason: naReason, itemKey: item.key };
                if (dateColId) cellStatuses[dateColId] = { status: 'na', reason: naReason, itemKey: item.key };
                return;
            }

            const rawAmt = amtColId ? String(rowObj[amtColId] ?? '').trim() : '';
            const rawRcptRaw = rcptColId ? String(rowObj[rcptColId] ?? '').trim() : '';
            const rawDateRaw = dateColId ? String(rowObj[dateColId] ?? '').trim() : '';

            // Treat placeholder 'PAID' or 'N/A' text from an outdated template on an unpaid cell as blank
            const rawRcpt = ['paid', 'n/a', 'na'].includes(rawRcptRaw.toLowerCase()) ? '' : rawRcptRaw;
            const rawDate = ['paid', 'n/a', 'na'].includes(rawDateRaw.toLowerCase()) ? '' : rawDateRaw;

            const hasTrigger = Boolean(rawDate || rawRcpt);
            const parsedAmt = rawAmt !== '' ? parseFloat(rawAmt) : NaN;

            if (!hasTrigger) {
                if (rawAmt !== '' && (Number.isNaN(parsedAmt) || parsedAmt < 0)) {
                    if (amtColId) cellStatuses[amtColId] = { status: 'error', reason: 'Amount must be a valid positive number', itemKey: item.key };
                    if (rcptColId) cellStatuses[rcptColId] = { status: 'blank', reason: '', itemKey: item.key };
                    if (dateColId) cellStatuses[dateColId] = { status: 'blank', reason: '', itemKey: item.key };
                    errorCount += 1;
                } else {
                    if (amtColId) cellStatuses[amtColId] = { status: 'blank', reason: 'Enter Receipt No or Date to collect this fee', itemKey: item.key };
                    if (rcptColId) cellStatuses[rcptColId] = { status: 'blank', reason: 'Enter Receipt No (or Date) to mark ready', itemKey: item.key };
                    if (dateColId) cellStatuses[dateColId] = { status: 'blank', reason: 'Enter Date (or Receipt No) to mark ready', itemKey: item.key };
                }
                return;
            }

            // Trigger present (Date OR Receipt No entered)
            const normalizedDate = rawDate ? parseDateSafe(rawDate) : '';
            const parsedRcptOk = !rawRcpt || (/^\d+$/.test(rawRcpt) && parseInt(rawRcpt, 10) > 0);
            const isRcptMandatory = typeof item.isReceiptMandatory === 'boolean'
                ? item.isReceiptMandatory
                : Boolean(defaultReceiptMandatory);

            let itemHasError = false;

            if (rawDate && !normalizedDate) {
                if (dateColId) cellStatuses[dateColId] = { status: 'error', reason: 'Invalid date (use DD-MM-YYYY or YYYY-MM-DD)', itemKey: item.key };
                itemHasError = true;
                errorCount += 1;
            }

            if (rawRcpt && !parsedRcptOk) {
                if (rcptColId) cellStatuses[rcptColId] = { status: 'error', reason: 'Receipt No must be a positive whole number', itemKey: item.key };
                itemHasError = true;
                errorCount += 1;
            } else if (!rawRcpt && isRcptMandatory) {
                if (rcptColId) cellStatuses[rcptColId] = { status: 'error', reason: 'Receipt No is mandatory for this fee item', itemKey: item.key };
                itemHasError = true;
                errorCount += 1;
            }

            if (rawAmt === '' || Number.isNaN(parsedAmt) || parsedAmt <= 0) {
                if (amtColId) cellStatuses[amtColId] = { status: 'error', reason: 'Amount must be greater than 0', itemKey: item.key };
                itemHasError = true;
                errorCount += 1;
            }

            if (itemHasError) {
                [amtColId, rcptColId, dateColId].forEach((cId) => {
                    if (cId && !cellStatuses[cId]) {
                        cellStatuses[cId] = { status: 'blank', reason: '', itemKey: item.key };
                    }
                });
                return;
            }

            const effectiveDate = normalizedDate || todayIso;
            candidates.push({
                rowIdx,
                studentId: matchedStudent.id,
                studentName: matchedStudent.name || '',
                classLabel: studentClass,
                groupId: hasMultiGroup ? group.id : '',
                groupName: hasMultiGroup ? (group.name || 'Family Group') : '',
                activeGroupMemberCount: hasMultiGroup ? activeGroupMembers.length : 1,
                activeGroupMemberIds: hasMultiGroup ? activeGroupMembers.map((m) => m.id) : [matchedStudent.id],
                itemKey: item.key,
                itemType: item.type || 'month',
                itemName: normalizeFeeNameSafe(item.name || item.key),
                amount: roundMoney(parsedAmt),
                receiptNo: rawRcpt ? parseInt(rawRcpt, 10) : null,
                paymentDate: effectiveDate,
                dateAutoDefaulted: !rawDate,
                amtColId,
                rcptColId,
                dateColId
            });
        });

        return {
            rowIdx,
            isSampleRow: false,
            hasFatalError: false,
            matchedStudent,
            studentClass,
            group: hasMultiGroup ? group : null,
            groupId: hasMultiGroup ? group.id : '',
            groupName: hasMultiGroup ? (group.name || 'Family Group') : '',
            groupFee: hasMultiGroup ? Number(group.fee || group.amount || 0) : 0,
            groupMemberCount: hasMultiGroup ? activeGroupMembers.length : 1,
            concessionFee,
            displayStudentId: matchedStudent.id,
            displayAdm: matchedStudent.adm || admVal,
            displayName: matchedStudent.name || nameVal || '--',
            candidates,
            readyEntries: [],
            readyCount: 0,
            errorCount,
            alreadyPaidCount,
            cellStatuses
        };
    });

    // Pass 2: Resolve Family Group vs Single Payment buckets
    const groupItemBuckets = new Map();
    const standaloneCandidates = [];

    parsedRows.forEach((row) => {
        if (row.isSampleRow || row.hasFatalError) return;
        row.candidates.forEach((cand) => {
            if (cand.groupId) {
                const bucketKey = `${cand.groupId}::${cand.itemKey}`;
                if (!groupItemBuckets.has(bucketKey)) groupItemBuckets.set(bucketKey, []);
                groupItemBuckets.get(bucketKey).push(cand);
            } else {
                standaloneCandidates.push(cand);
            }
        });
    });

    const paymentPlan = [];
    const groupSummaryMap = new Map(); // key: `${groupId}::${itemKey}` -> { modeSetting, resolvedMode, filledCount, totalMembers, totalAmount, hasMismatchError }

    const markCandidateReady = (cand, billingMode, totalAmtForGroup = null, memberCount = 1) => {
        const row = parsedRows[cand.rowIdx];
        const entry = {
            ...cand,
            billingMode,
            resolvedGroupTotal: billingMode === 'group' ? totalAmtForGroup : cand.amount,
            resolvedGroupMemberCount: billingMode === 'group' ? memberCount : 1
        };
        row.readyEntries.push(entry);
        row.readyCount += 1;

        const dateNote = cand.dateAutoDefaulted ? ` (Date auto-set to ${cand.paymentDate})` : '';
        const modeDesc = billingMode === 'group'
            ? `Group Payment: ₹${totalAmtForGroup} total across ${memberCount} members`
            : `Single Payment: ₹${cand.amount}`;
        const okTitle = `Ready to save — ${cand.itemName} • ${modeDesc} on ${cand.paymentDate}${dateNote}`;
        const cellStatus = billingMode === 'group' ? 'ready-group' : 'ready';

        if (cand.amtColId) row.cellStatuses[cand.amtColId] = { status: cellStatus, reason: okTitle, itemKey: cand.itemKey, billingMode };
        if (cand.rcptColId) row.cellStatuses[cand.rcptColId] = { status: cellStatus, reason: okTitle, itemKey: cand.itemKey, billingMode };
        if (cand.dateColId) row.cellStatuses[cand.dateColId] = { status: cellStatus, reason: okTitle, itemKey: cand.itemKey, billingMode };
    };

    // 2a. Standalone (non-grouped) candidates -> always single payment
    standaloneCandidates.forEach((cand) => {
        markCandidateReady(cand, 'single');
        paymentPlan.push({
            billingMode: 'single',
            groupId: null,
            itemKey: cand.itemKey,
            itemType: cand.itemType,
            itemName: cand.itemName,
            effectiveAmount: cand.amount,
            entries: [cand]
        });
    });

    // 2b. Grouped candidates -> resolve per (groupId, itemKey)
    groupItemBuckets.forEach((bucket, bucketKey) => {
        const [groupId, itemKey] = bucketKey.split('::');
        const modeSetting = (groupItemModes instanceof Map ? groupItemModes.get(bucketKey) : groupItemModes?.[bucketKey]) || 'auto';
        const first = bucket[0];
        const totalMembers = first.activeGroupMemberCount || bucket.length;
        const isMonthly = first.itemType === 'month';

        // Deduplicate by studentId just in case uploaded file had duplicate rows
        const uniqueMemberIds = [...new Set(bucket.map((c) => c.studentId))];
        const allMembersFilled = uniqueMemberIds.length >= totalMembers && totalMembers > 1;
        const distinctAmounts = [...new Set(bucket.map((c) => roundMoney(c.amount)))];
        const allAmountsMatch = distinctAmounts.length === 1;

        let resolvedMode = 'single';
        let hasMismatchError = false;

        if (modeSetting === 'single') {
            resolvedMode = 'single';
        } else if (modeSetting === 'group') {
            if (bucket.length >= 2) {
                if (!allAmountsMatch) {
                    hasMismatchError = true;
                } else {
                    resolvedMode = 'group';
                }
            } else {
                // Only 1 member filled in explicit group mode -> save as single member payment without multiplying
                resolvedMode = 'single';
            }
        } else {
            // 'auto' mode:
            // Monthly fee with ALL group members filled and matching amounts -> unified Group Payment (e.g. 500 x 3 -> ₹500 total)
            // Partial group (e.g. 2 of 3 filled with 500, 500 -> ₹1,000) or Custom fee -> Single Payment per filled member
            if (isMonthly && allMembersFilled && allAmountsMatch) {
                resolvedMode = 'group';
            } else {
                resolvedMode = 'single';
            }
        }

        if (hasMismatchError) {
            const errMsg = 'Group Payment requires the same amount for all filled group members (match amounts or switch to Single Payment)';
            bucket.forEach((cand) => {
                const row = parsedRows[cand.rowIdx];
                row.errorCount += 1;
                if (cand.amtColId) row.cellStatuses[cand.amtColId] = { status: 'error', reason: errMsg, itemKey: cand.itemKey };
                if (cand.rcptColId) row.cellStatuses[cand.rcptColId] = { status: 'error', reason: errMsg, itemKey: cand.itemKey };
                if (cand.dateColId) row.cellStatuses[cand.dateColId] = { status: 'error', reason: errMsg, itemKey: cand.itemKey };
            });
            groupSummaryMap.set(bucketKey, {
                groupId,
                itemKey,
                modeSetting,
                resolvedMode: 'error',
                filledCount: bucket.length,
                totalMembers,
                totalAmount: 0,
                hasMismatchError: true
            });
            return;
        }

        if (resolvedMode === 'group') {
            const unifiedAmt = roundMoney(first.amount);
            bucket.forEach((cand) => {
                markCandidateReady(cand, 'group', unifiedAmt, bucket.length);
            });
            paymentPlan.push({
                billingMode: 'group',
                groupId: allMembersFilled ? groupId : null,
                billingGroupId: allMembersFilled ? groupId : null,
                itemKey,
                itemType: first.itemType,
                itemName: first.itemName,
                effectiveAmount: unifiedAmt,
                isFullGroup: allMembersFilled,
                entries: bucket
            });
            groupSummaryMap.set(bucketKey, {
                groupId,
                itemKey,
                modeSetting,
                resolvedMode: 'group',
                filledCount: bucket.length,
                totalMembers,
                totalAmount: unifiedAmt,
                hasMismatchError: false
            });
        } else {
            let sumAmt = 0;
            bucket.forEach((cand) => {
                sumAmt = roundMoney(sumAmt + cand.amount);
                markCandidateReady(cand, 'single');
                paymentPlan.push({
                    billingMode: 'single',
                    groupId: null,
                    billingGroupId: null,
                    itemKey: cand.itemKey,
                    itemType: cand.itemType,
                    itemName: cand.itemName,
                    effectiveAmount: cand.amount,
                    entries: [cand]
                });
            });
            groupSummaryMap.set(bucketKey, {
                groupId,
                itemKey,
                modeSetting,
                resolvedMode: 'single',
                filledCount: bucket.length,
                totalMembers,
                totalAmount: sumAmt,
                hasMismatchError: false
            });
        }
    });

    const totalCollectionAmount = roundMoney(
        paymentPlan.reduce((sum, p) => sum + Number(p.effectiveAmount || 0), 0)
    );
    const groupPaletteMap = buildBulkGroupPaletteIndexMap(parsedRows, 4);

    return {
        parsedRows,
        paymentPlan,
        groupSummaryMap,
        groupPaletteMap,
        totalReadyTransactions: paymentPlan.length,
        totalCollectionAmount
    };
};

/**
 * Assigns a deterministic repeating palette index (0..paletteCount-1) to each distinct
 * family group in order of first appearance so adjacent family groups stay visually distinct.
 */
export const buildBulkGroupPaletteIndexMap = (parsedRows = [], paletteCount = 4) => {
    const map = new Map();
    const safeCount = Math.max(1, Number(paletteCount) || 4);
    let nextIdx = 0;
    (Array.isArray(parsedRows) ? parsedRows : []).forEach((row) => {
        if (!row || row.isSampleRow || !row.groupId) return;
        if (!map.has(row.groupId)) {
            map.set(row.groupId, nextIdx % safeCount);
            nextIdx += 1;
        }
    });
    return map;
};

/**
 * Builds the exact Firestore payment documents to write for a resolved paymentPlan,
 * strictly following the app's Single Family Billing Entity Model (1 primary + mirrors with amount: 0).
 */
export const buildBulkFirestorePaymentPayloads = ({
    paymentPlan = [],
    eligibleRowIndices = null,
    allPayments = [],
    year = '',
    targetClass = '',
    collectorUserKey = '',
    collectorName = '',
    collectorEmail = '',
    collectorUid = '',
    startingAutoReceiptNo = 1,
    description = ''
} = {}) => {
    const cleanYear = String(year || '').trim();
    let autoReceiptNo = Math.max(1, parseInt(startingAutoReceiptNo, 10) || 1);
    const payloads = [];
    let skippedAlreadyPaid = 0;

    paymentPlan.forEach((planItem) => {
        // Filter by eligibleRowIndices (used when "Upload Valid Only" skips rows with errors)
        const eligibleEntries = eligibleRowIndices instanceof Set
            ? planItem.entries.filter((e) => eligibleRowIndices.has(e.rowIdx))
            : planItem.entries;

        if (!eligibleEntries.length) return;

        // If a group plan lost members due to Valid Only filtering and now has <2 members, fall back to single
        const isGroupWrite = planItem.billingMode === 'group' && eligibleEntries.length >= 2;
        const transactionId = `${Date.now()}${Math.random().toString(36).substring(2, 7)}`;

        if (isGroupWrite) {
            const unpaidMembers = eligibleEntries.filter((entry) => !(
                (Array.isArray(allPayments) ? allPayments : []).some((p) => (
                    p.itemKey === entry.itemKey &&
                    (!p.academicYear || p.academicYear === cleanYear) &&
                    (p.studentId === entry.studentId || (planItem.billingGroupId && p.billingGroupId === planItem.billingGroupId))
                ))
            ));

            if (unpaidMembers.length === 0) {
                skippedAlreadyPaid += eligibleEntries.length;
                return;
            }

            const firstEntry = unpaidMembers[0];
            const sharedReceiptNo = unpaidMembers.find((e) => e.receiptNo)?.receiptNo || autoReceiptNo++;
            const sharedDate = firstEntry.paymentDate;
            const unifiedAmt = roundMoney(planItem.effectiveAmount);
            const targetGroupMemberIds = unpaidMembers.map((e) => e.studentId);

            unpaidMembers.forEach((entry, idx) => {
                const isPrimary = idx === 0;
                payloads.push({
                    studentId: entry.studentId,
                    itemKey: entry.itemKey,
                    amount: isPrimary ? unifiedAmt : 0,
                    groupMonthAmount: unifiedAmt,
                    groupPaidAmount: unifiedAmt,
                    billingGroupId: planItem.billingGroupId || null,
                    isGroupPrimary: isPrimary,
                    isGroupMirror: !isPrimary,
                    targetGroupMemberIds,
                    receiptNo: sharedReceiptNo,
                    transactionId,
                    paymentDate: sharedDate,
                    timestamp: new Date(sharedDate).getTime() || Date.now(),
                    description,
                    collectedBy: collectorUserKey,
                    collectedByName: collectorName,
                    ...(collectorEmail ? { collectedByEmail: collectorEmail } : {}),
                    ...(collectorUid ? { collectedByUid: collectorUid } : {}),
                    academicYear: cleanYear,
                    classLabel: entry.classLabel || targetClass
                });
            });
            return;
        }

        // Single payment(s)
        eligibleEntries.forEach((entry) => {
            const alreadyPaid = (Array.isArray(allPayments) ? allPayments : []).some((p) => (
                p.studentId === entry.studentId &&
                p.itemKey === entry.itemKey &&
                (!p.academicYear || p.academicYear === cleanYear)
            ));
            if (alreadyPaid) {
                skippedAlreadyPaid += 1;
                return;
            }
            const finalReceiptNo = entry.receiptNo || autoReceiptNo++;
            payloads.push({
                studentId: entry.studentId,
                itemKey: entry.itemKey,
                amount: roundMoney(entry.amount),
                billingGroupId: null,
                receiptNo: finalReceiptNo,
                transactionId,
                paymentDate: entry.paymentDate,
                timestamp: new Date(entry.paymentDate).getTime() || Date.now(),
                description,
                collectedBy: collectorUserKey,
                collectedByName: collectorName,
                ...(collectorEmail ? { collectedByEmail: collectorEmail } : {}),
                ...(collectorUid ? { collectedByUid: collectorUid } : {}),
                academicYear: cleanYear,
                classLabel: entry.classLabel || targetClass
            });
        });
    });

    return { payloads, skippedAlreadyPaid };
};
