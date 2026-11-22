// Shared Student Field Schema & Helpers
// Single source of truth for Admin, Student, Official/Worksheet, and Collection portals.

export const CUSTOM_STUDENT_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'phone', label: 'Phone Number (Login Enabled)' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'textarea', label: 'Long Text / Address' },
  { value: 'select', label: 'Dropdown (Select)' }
];

const ALLOWED_CUSTOM_TYPES = new Set(CUSTOM_STUDENT_FIELD_TYPES.map((t) => t.value));

export const DEFAULT_STUDENT_FIELDS = [
  {
    key: 'photo',
    label: 'Student Profile Photo',
    type: 'photo',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 1,
    loginEligible: false
  },
  {
    key: 'class',
    label: 'Class',
    type: 'select',
    system: true,
    alwaysVisible: true,
    alwaysRequired: true,
    visible: true,
    required: true,
    order: 2,
    loginEligible: false
  },
  {
    key: 'uid',
    label: 'ID/UID',
    type: 'text',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 3,
    loginEligible: false
  },
  {
    key: 'name',
    label: 'Student Name',
    type: 'text',
    system: true,
    alwaysVisible: true,
    alwaysRequired: true,
    visible: true,
    required: true,
    order: 4,
    loginEligible: false
  },
  {
    key: 'father',
    label: "Father's Name",
    type: 'text',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 5,
    loginEligible: false
  },
  {
    key: 'mother',
    label: "Mother's Name",
    type: 'text',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 6,
    loginEligible: false
  },
  {
    key: 'gender',
    label: 'Gender',
    type: 'select',
    system: true,
    alwaysVisible: true,
    alwaysRequired: true,
    visible: true,
    required: true,
    order: 7,
    loginEligible: false
  },
  {
    key: 'adm',
    label: 'Admission Number (Adm. No.)',
    type: 'text',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 8,
    loginEligible: false
  },
  {
    key: 'dob',
    label: 'Date of Birth',
    type: 'date',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 9,
    loginEligible: false
  },
  {
    key: 'admDate',
    label: 'Date of Admission',
    type: 'date',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 10,
    loginEligible: false
  },
  {
    key: 'status',
    label: 'Student Status',
    type: 'select',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 11,
    loginEligible: false
  },
  {
    key: 'adhaar',
    label: 'Aadhaar Number',
    type: 'text',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 12,
    loginEligible: false
  },
  {
    key: 'mobile',
    label: "Father's Phone Number",
    type: 'phone',
    system: true,
    alwaysVisible: true,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 13,
    loginEligible: true
  },
  {
    key: 'motherMobile',
    label: "Mother's Phone Number",
    type: 'phone',
    system: true,
    alwaysVisible: true,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 14,
    loginEligible: true
  },
  {
    key: 'address',
    label: 'Permanent Address',
    type: 'textarea',
    system: true,
    alwaysVisible: false,
    alwaysRequired: false,
    visible: true,
    required: false,
    order: 15,
    loginEligible: false
  }
];

const DEFAULT_SYSTEM_MAP = new Map(DEFAULT_STUDENT_FIELDS.map((f) => [f.key, f]));

export function escapeFieldHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseSelectOptions(raw) {
  if (Array.isArray(raw)) {
    return raw.map((o) => String(o || '').trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function sanitizeCustomFieldKey(label, existingKeys = []) {
  const taken = new Set(
    [...DEFAULT_SYSTEM_MAP.keys(), ...(Array.isArray(existingKeys) ? existingKeys : [])].map((k) =>
      String(k || '').toLowerCase()
    )
  );
  const baseSlug = String(label || 'custom_field')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'field';

  let candidate = `cf_${baseSlug}`;
  let idx = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `cf_${baseSlug}_${idx}`;
    idx += 1;
  }
  return candidate;
}

export function normalizeStudentFieldSchema(rawList) {
  const input = Array.isArray(rawList) ? rawList : [];
  const rawByKey = new Map();
  const customItems = [];

  input.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const key = String(item.key || '').trim();
    if (!key) return;
    if (DEFAULT_SYSTEM_MAP.has(key)) {
      rawByKey.set(key, { ...item, _rawIdx: idx });
    } else if (item.system !== true) {
      customItems.push({ ...item, key, _rawIdx: idx });
    }
  });

  const merged = [];

  // 1. Always preserve every system field (cannot be deleted)
  DEFAULT_STUDENT_FIELDS.forEach((def) => {
    const saved = rawByKey.get(def.key);
    const label = String(saved?.label || def.label).trim() || def.label;
    const visible = def.alwaysVisible ? true : saved?.visible !== false;
    const required = def.alwaysRequired ? true : visible ? saved?.required === true : false;
    const parsedOrder = Number(saved?.order);
    const order = Number.isFinite(parsedOrder) && parsedOrder > 0 ? parsedOrder : def.order;

    merged.push({
      key: def.key,
      label,
      type: def.type,
      system: true,
      isCustom: false,
      alwaysVisible: Boolean(def.alwaysVisible),
      alwaysRequired: Boolean(def.alwaysRequired),
      visible,
      required,
      order,
      loginEligible: Boolean(def.loginEligible),
      options: []
    });
  });

  // 2. Preserve custom fields (deduplicated by key)
  const seenCustomKeys = new Set(DEFAULT_SYSTEM_MAP.keys());
  customItems.forEach((item, idx) => {
    const key = String(item.key || '').trim();
    if (!key || seenCustomKeys.has(key)) return;
    seenCustomKeys.add(key);

    const rawType = String(item.type || 'text').trim().toLowerCase();
    const type = ALLOWED_CUSTOM_TYPES.has(rawType) ? rawType : 'text';
    const label = String(item.label || key).trim() || key;
    const visible = item.visible !== false;
    const required = visible ? item.required === true : false;
    const parsedOrder = Number(item.order);
    const order = Number.isFinite(parsedOrder) && parsedOrder > 0
      ? parsedOrder
      : DEFAULT_STUDENT_FIELDS.length + idx + 1;

    merged.push({
      key,
      label,
      type,
      system: false,
      isCustom: true,
      alwaysVisible: false,
      alwaysRequired: false,
      visible,
      required,
      order,
      loginEligible: type === 'phone',
      options: type === 'select' ? parseSelectOptions(item.options) : []
    });
  });

  // 3. Sort deterministically and re-number 1..N
  merged.sort((a, b) => (a.order - b.order) || String(a.key).localeCompare(String(b.key)));
  return merged.map((field, index) => ({
    ...field,
    order: index + 1
  }));
}

export function serializeStudentFieldSchema(schema) {
  return normalizeStudentFieldSchema(schema).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    system: Boolean(f.system),
    visible: Boolean(f.visible),
    required: Boolean(f.required),
    order: f.order,
    ...(f.type === 'select' && !f.system ? { options: parseSelectOptions(f.options) } : {})
  }));
}

export function getVisibleStudentFields(schema) {
  return normalizeStudentFieldSchema(schema).filter((f) => f.visible !== false);
}

export function getCustomStudentFields(schema, { onlyVisible = false } = {}) {
  return normalizeStudentFieldSchema(schema).filter(
    (f) => !f.system && (!onlyVisible || f.visible !== false)
  );
}

export function getCustomPhoneFieldKeys(schema) {
  return normalizeStudentFieldSchema(schema)
    .filter((f) => !f.system && f.type === 'phone')
    .map((f) => f.key);
}

export function getStudentFieldByKey(schema, key) {
  return normalizeStudentFieldSchema(schema).find((f) => f.key === key) || null;
}

export function getStudentFieldLabel(schema, key, fallback = '') {
  const f = getStudentFieldByKey(schema, key);
  return f ? f.label : (fallback || key);
}

export function isStudentFieldVisible(schema, key) {
  const f = getStudentFieldByKey(schema, key);
  return f ? f.visible !== false : true;
}

export function getStudentCustomValuesMap(student = {}) {
  const top = (student?.customFields && typeof student.customFields === 'object') ? student.customFields : {};
  const prof = (student?.profile?.customFields && typeof student.profile.customFields === 'object')
    ? student.profile.customFields
    : {};
  return { ...prof, ...top };
}

export function getStudentFieldValue(student = {}, fieldOrKey) {
  if (!student || typeof student !== 'object') return '';
  const key = typeof fieldOrKey === 'string' ? fieldOrKey : String(fieldOrKey?.key || '');
  if (!key) return '';
  const prof = (student.profile && typeof student.profile === 'object') ? student.profile : {};

  switch (key) {
    case 'photo':
      return String(student.photo || prof.photo || '').trim();
    case 'class':
      return String(student.class || prof.class || '').trim();
    case 'uid':
      return String(student.uid || student.studentUid || prof.uid || '').trim();
    case 'name':
      return String(student.name || prof.name || '').trim();
    case 'father':
      return String(student.father || student.fatherName || prof.father || prof.fatherName || '').trim();
    case 'mother':
      return String(student.mother || student.motherName || prof.mother || prof.motherName || '').trim();
    case 'gender':
      return String(student.gender || prof.gender || '').trim();
    case 'adm':
      return String(student.adm || student.admissionNo || prof.adm || prof.admissionNo || '').trim();
    case 'dob':
      return String(student.dob || prof.dob || '').trim();
    case 'admDate':
      return String(student.admDate || student.admissionDate || prof.admDate || '').trim();
    case 'status':
      return String(student.status || prof.status || 'Active').trim();
    case 'adhaar':
      return String(student.adhaar || student.aadhaar || prof.adhaar || prof.aadhaar || '').trim();
    case 'mobile':
      return String(student.mobile || student.phone || prof.mobile || prof.phone || '').trim();
    case 'motherMobile':
      return String(student.motherMobile || student.mother_mobile || prof.motherMobile || '').trim();
    case 'address':
      return String(student.address || student.addr || prof.address || prof.addr || '').trim();
    default: {
      const customMap = getStudentCustomValuesMap(student);
      const val = customMap[key];
      return val === undefined || val === null ? '' : String(val).trim();
    }
  }
}

export function formatDateForDisplay(rawVal) {
  const s = String(rawVal || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

export function formatStudentFieldDisplayValue(student, field, emptyPlaceholder = '-') {
  const val = getStudentFieldValue(student, field);
  if (!val) return emptyPlaceholder;
  if (field?.type === 'date') return formatDateForDisplay(val);
  return val;
}

const defaultNormalizePhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10 && digits.startsWith('0')) return digits.replace(/^0+/, '');
  return digits;
};

export function extractAllStudentPhones(student = {}, schema = DEFAULT_STUDENT_FIELDS, normalizePhoneFn = defaultNormalizePhone) {
  const norm = typeof normalizePhoneFn === 'function' ? normalizePhoneFn : defaultNormalizePhone;
  const prof = (student?.profile && typeof student.profile === 'object') ? student.profile : {};
  const customMap = getStudentCustomValuesMap(student);
  const customPhoneKeys = getCustomPhoneFieldKeys(schema);

  const rawCandidates = [
    student.mobile,
    student.phone,
    student.motherMobile,
    student.mother_mobile,
    student.fatherPhone,
    student.fatherMobile,
    student.motherPhone,
    prof.mobile,
    prof.phone,
    prof.motherMobile,
    ...(Array.isArray(student.phones) ? student.phones : [])
  ];

  customPhoneKeys.forEach((k) => {
    if (customMap[k]) rawCandidates.push(customMap[k]);
  });

  const unique = [];
  const seen = new Set();
  rawCandidates.forEach((cand) => {
    const cleaned = norm(cand);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      unique.push(cleaned);
    }
  });
  return unique;
}

export function getFieldTypeDisplayLabel(type) {
  const found = CUSTOM_STUDENT_FIELD_TYPES.find((t) => t.value === type);
  if (found) return found.label;
  if (type === 'photo') return 'Profile Photo';
  return String(type || 'Text');
}

export function buildCustomFieldInputHtml(field, idPrefix, value = '', displayIndex = null, options = {}) {
  const inputId = `${idPrefix}cf-${field.key}`;
  const isEditGrid = options.gridVariant === 'edit';
  const spanClass = field.type === 'textarea'
    ? (isEditGrid ? 'col-span-1 md:col-span-2 lg:col-span-4' : 'col-span-1 sm:col-span-2 lg:col-span-2')
    : (isEditGrid ? 'col-span-1 lg:col-span-2' : 'col-span-1');
  const numPrefix = displayIndex ? `${displayIndex}. ` : '';
  const reqStar = field.required ? ' <span class="mandatory-star">*</span>' : '';
  const phoneBadge = field.type === 'phone'
    ? ' <span class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold align-middle"><i class="fas fa-key text-[9px]"></i>Login</span>'
    : '';
  const safeVal = escapeFieldHtml(value);
  const safeLabel = escapeFieldHtml(field.label);
  const bgCls = isEditGrid ? ' bg-white' : '';
  const baseInputClass = options.inputClass ? escapeFieldHtml(options.inputClass) : `w-full p-2.5 border rounded-lg${bgCls}`;
  const selectInputClass = options.inputClass ? escapeFieldHtml(options.inputClass) : 'w-full p-2.5 border rounded-lg bg-white';

  let controlHtml = '';
  if (field.type === 'textarea') {
    controlHtml = `<textarea id="${escapeFieldHtml(inputId)}" data-custom-field-key="${escapeFieldHtml(field.key)}" rows="1" class="${baseInputClass}" placeholder="${safeLabel}">${safeVal}</textarea>`;
  } else if (field.type === 'select') {
    const opts = parseSelectOptions(field.options);
    const optsHtml = [
      `<option value="">-- Select ${safeLabel} --</option>`,
      ...opts.map((opt) => {
        const selected = String(value || '') === opt ? ' selected' : '';
        return `<option value="${escapeFieldHtml(opt)}"${selected}>${escapeFieldHtml(opt)}</option>`;
      })
    ].join('');
    // Preserve legacy value if not in current options list
    const hasLegacyVal = value && !opts.includes(String(value));
    const legacyOpt = hasLegacyVal
      ? `<option value="${safeVal}" selected>${safeVal}</option>`
      : '';
    controlHtml = `<select id="${escapeFieldHtml(inputId)}" data-custom-field-key="${escapeFieldHtml(field.key)}" class="${selectInputClass}">${optsHtml}${legacyOpt}</select>`;
  } else {
    const htmlType = field.type === 'phone'
      ? 'tel'
      : (field.type === 'number' || field.type === 'date' || field.type === 'email' ? field.type : 'text');
    controlHtml = `<input type="${htmlType}" id="${escapeFieldHtml(inputId)}" data-custom-field-key="${escapeFieldHtml(field.key)}" value="${safeVal}" class="${baseInputClass}" placeholder="${safeLabel}">`;
  }

  return `<div class="${spanClass}" data-stu-field="${escapeFieldHtml(field.key)}" data-stu-custom-field="true"><label class="block text-sm font-semibold mb-1" for="${escapeFieldHtml(inputId)}">${numPrefix}${safeLabel}${reqStar}${phoneBadge}</label>${controlHtml}</div>`;
}

export function readCustomFieldsFromContainer(containerEl, schema, idPrefix) {
  const customFields = {};
  const missingRequired = [];
  if (!containerEl) return { customFields, missingRequired };

  const visibleCustom = getCustomStudentFields(schema, { onlyVisible: true });
  visibleCustom.forEach((field) => {
    const el = containerEl.querySelector(`#${CSS.escape(`${idPrefix}cf-${field.key}`)}`)
      || containerEl.querySelector(`[data-custom-field-key="${CSS.escape(field.key)}"]`);
    const rawVal = el ? String(el.value || '').trim() : '';
    if (field.required && !rawVal) {
      missingRequired.push(field.label);
    }
    if (rawVal !== '') {
      customFields[field.key] = rawVal;
    } else {
      customFields[field.key] = '';
    }
  });

  return { customFields, missingRequired };
}
