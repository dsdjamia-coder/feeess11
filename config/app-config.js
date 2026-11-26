const RESERVED_PATH_SEGMENTS = new Set([
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

const sanitizeInstitutionSlug = (value = '') => {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean || RESERVED_PATH_SEGMENTS.has(clean)) return '';
  return /^[a-z0-9][a-z0-9-_]{0,63}$/.test(clean) ? clean : '';
};

export const resolveExplicitInstitutionSlugFromLocation = () => {
  if (typeof window === 'undefined') return '';
  try {
    const segments = String(window.location.pathname || '')
      .split('/')
      .filter(Boolean);
    if (segments.length > 0 && !segments[0].includes('.')) {
      const fromPath = sanitizeInstitutionSlug(segments[0]);
      if (fromPath) return fromPath;
    }
    const params = new URLSearchParams(window.location.search || '');
    const fromQuery = sanitizeInstitutionSlug(params.get('inst') || params.get('institution') || '');
    if (fromQuery) return fromQuery;
  } catch (_) {}
  return '';
};

export const resolveInstitutionIdFromLocation = () => {
  if (typeof window === 'undefined') return 'school';
  if (window.AppSession?.getInstitutionId) {
    return window.AppSession.getInstitutionId() || 'school';
  }
  return resolveExplicitInstitutionSlugFromLocation() || 'school';
};

export const isRootGatewayLocation = () => {
  if (typeof window === 'undefined') return false;
  const segments = String(window.location.pathname || '').split('/').filter(Boolean);
  const explicitSlug = resolveExplicitInstitutionSlugFromLocation();
  if (explicitSlug) return false;
  return segments.length === 0 || segments[0] === 'index.html' || segments[0] === 'index';
};

export const INSTITUTION_ID = resolveInstitutionIdFromLocation();
export const SINGLE_ADMIN_MODE = true;
export const BASE_PATH = `institutions/${INSTITUTION_ID}`;
export const ADMIN_AUTH_DOC_ID = 'adminAuth';
export const STAFF_ACCESS_COLLECTION = `${BASE_PATH}/staffAccess`;
export const INTERNAL_AUTH_DOMAIN = `${INSTITUTION_ID}.internal`;
export const COMPANY_COLLECTION = 'company';
export const COMPANY_CONFIG_DOC_ID = 'config';
export const COMPANY_PUBLIC_CATALOG_DOC_ID = 'publicCatalog';
export const COMPANY_SHOWCASES_SUBCOLLECTION = 'showcases';
export const INSTITUTIONS_COLLECTION = 'institutions';
export const GLOBAL_USERS_COLLECTION = 'globalUsers';
export const UPGRADE_REQUESTS_COLLECTION = 'upgradeRequests';
export const RESERVED_INSTITUTION_SLUGS = RESERVED_PATH_SEGMENTS;
export const DEFAULT_COMPANY_ALLOWED_PAGES = {
  admin: true,
  official: true,
  student: true,
  collection: true,
  result: true,
  attendance: true,
  worksheet: true,
  academicPlan: true,
  studentActivity: true,
  classroomEvaluation: true
};

export const DEFAULT_TRIAL_DAYS = 3;

export const FREE_PLAN_ALLOWED_PAGES = {
  admin: true,
  official: true,
  student: true,
  collection: true,
  result: true,
  attendance: false,
  worksheet: false,
  academicPlan: false,
  studentActivity: false,
  classroomEvaluation: false
};

export const STANDARD_PLAN_ALLOWED_PAGES = {
  admin: true,
  official: true,
  student: true,
  collection: true,
  result: true,
  attendance: true,
  worksheet: true,
  academicPlan: true,
  studentActivity: false,
  classroomEvaluation: false
};

export const ELITE_PLAN_ALLOWED_PAGES = { ...DEFAULT_COMPANY_ALLOWED_PAGES };

// Backward-compatible alias
export const BASIC_PLAN_ALLOWED_PAGES = FREE_PLAN_ALLOWED_PAGES;

export const DEFAULT_FREE_PLAN_LIMITS = {
  maxStudents: 150,
  maxStaff: 6,
  maxClasses: 12,
  maxAcademicYears: 1,
  maxFeeItems: 4,
  maxNotices: 5,
  maxGalleryPhotos: 6,
  maxExamsPerYear: 1,
  maxDirectoryEntries: 10
};

export const DEFAULT_STANDARD_PLAN_LIMITS = {
  maxStudents: 500,
  maxStaff: 25,
  maxClasses: 30,
  maxAcademicYears: 5,
  maxFeeItems: 12,
  maxNotices: 20,
  maxGalleryPhotos: 15,
  maxExamsPerYear: 4,
  maxDirectoryEntries: 40
};

export const DEFAULT_ELITE_PLAN_LIMITS = {
  maxStudents: 0,
  maxStaff: 0,
  maxClasses: 0,
  maxAcademicYears: 0,
  maxFeeItems: 0,
  maxNotices: 0,
  maxGalleryPhotos: 24,
  maxExamsPerYear: 0,
  maxDirectoryEntries: 0
};

// Backward-compatible aliases
export const DEFAULT_BASIC_PLAN_LIMITS = DEFAULT_FREE_PLAN_LIMITS;
export const DEFAULT_PREMIUM_PLAN_LIMITS = DEFAULT_ELITE_PLAN_LIMITS;

export const FREE_PLAN_FEATURES = {
  excelBulkImport: false,
  excelExport: false,
  blankSheets: false,
  multiAcademicYears: false,
  batchPromotion: false,
  alumniManagement: false,
  studentContinuity: false,
  studentGroups: false,
  feeConcessions: false,
  transferCertificates: false,
  customStudentFields: false,
  customDirectoryCategories: false,
  backupAndAudit: false,
  workflowOverrides: false,
  masterLedger: false,
  advancedFeeReports: false,
  donations: false,
  bulkWhatsappReminders: false,
  bulkReportCards: false,
  resultPromotionEngine: false,
  studentSelfEdit: false,
  siblingSwitcher: false
};

export const STANDARD_PLAN_FEATURES = {
  ...FREE_PLAN_FEATURES,
  multiAcademicYears: true
};

export const ELITE_PLAN_FEATURES = Object.keys(FREE_PLAN_FEATURES).reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {});

// Backward-compatible aliases
export const BASIC_PLAN_FEATURES = FREE_PLAN_FEATURES;
export const PREMIUM_PLAN_FEATURES = ELITE_PLAN_FEATURES;

export const PLAN_CATALOG_FEATURE_PRESETS = [
  'Dedicated Public Institution Website',
  'Single Academic Year Control (1 Year)',
  'Multi-Academic Year Progression',
  'Unlimited Academic Years & Full Archive',
  'Up to 150 Students, 6 Staff & 12 Classes',
  'Up to 500 Students, 25 Staff & 30 Classes',
  'Unlimited Students, Staff & Classes',
  'Admin, Fee Collection & Student Portal',
  'Manual Result Publishing (1 Exam / Year)',
  'Manual Result System (Multi-Exam)',
  'Daily Attendance Register & Monthly Logs',
  'Academic Planning (Timetable & Syllabus)',
  'Worksheet Hub & Custom Registers',
  'Activity & Rewards + Classroom Evaluation',
  'Excel Bulk Upload, Export & Blank Sheets',
  'Master Fee Ledger, Donations & PDF Reports',
  'Bulk Report Cards, Rank Lists & Promotion Engine',
  'Batch Promotion, Alumni, TC & Fee Concessions',
  'Full Backup, Restore, Audit Logs & Sibling Switcher'
];

export const DEFAULT_SUBSCRIPTION_PLANS = [
  {
    id: 'tier_free',
    tierKey: 'free',
    isDefaultTier: true,
    name: 'Free',
    tagline: 'Minimal 1-year setup to launch your institution online.',
    currency: '₹',
    mrpPrice: 0,
    offerPrice: 0,
    billingCycle: 'Free Forever',
    discountBadge: '3-Day Standard Trial Included',
    isPopular: false,
    isActive: true,
    displayOrder: 1,
    features: [
      'Dedicated Public Institution Website',
      'Single Academic Year Control (1 Year)',
      'Up to 150 Students, 6 Staff & 12 Classes',
      'Admin, Fee Collection & Student Portal',
      'Manual Result Publishing (1 Exam / Year)'
    ],
    includedModules: ['admin', 'official', 'student', 'collection', 'result']
  },
  {
    id: 'tier_standard',
    tierKey: 'standard',
    isDefaultTier: true,
    name: 'Standard',
    tagline: 'Complete daily academic operations & multi-year growth.',
    currency: '₹',
    mrpPrice: 7999,
    offerPrice: 4999,
    billingCycle: 'Per Year',
    discountBadge: 'Save 38%',
    isPopular: true,
    isActive: true,
    displayOrder: 2,
    features: [
      'Multi-Academic Year Progression',
      'Up to 500 Students, 25 Staff & 30 Classes',
      'Daily Attendance Register & Monthly Logs',
      'Academic Planning (Timetable & Syllabus)',
      'Worksheet Hub & Custom Registers',
      'Manual Result System (Multi-Exam)'
    ],
    includedModules: ['admin', 'official', 'student', 'collection', 'result', 'attendance', 'academicPlan', 'worksheet']
  },
  {
    id: 'tier_elite',
    tierKey: 'elite',
    isDefaultTier: true,
    name: 'ELITE',
    tagline: 'Full potential with Excel bulk tools, automation & all 10 modules.',
    currency: '₹',
    mrpPrice: 14999,
    offerPrice: 9999,
    billingCycle: 'Per Year',
    discountBadge: 'All-Inclusive',
    isPopular: false,
    isActive: true,
    displayOrder: 3,
    features: [
      'Unlimited Students, Staff, Classes & Years',
      'Activity & Rewards + Classroom Evaluation',
      'Excel Bulk Upload, Export & Blank Sheets',
      'Master Fee Ledger, Donations & PDF Reports',
      'Bulk Report Cards, Rank Lists & Promotion Engine',
      'Batch Promotion, Alumni, TC, Concessions & Backup'
    ],
    includedModules: [
      'admin', 'official', 'student', 'collection', 'result',
      'attendance', 'academicPlan', 'worksheet', 'studentActivity', 'classroomEvaluation'
    ]
  }
];


export const PLATFORM_SHOWCASE_PAGES = [
  {
    key: 'public',
    label: 'Public Website',
    icon: 'fa-globe',
    accent: 'blue',
    desc: 'Institution homepage, notices, gallery, faculty & public directories'
  },
  {
    key: 'admin',
    label: 'Admin Dashboard',
    icon: 'fa-sliders',
    accent: 'indigo',
    desc: 'Admissions, class promotions, staff access, fee setup & governance'
  },
  {
    key: 'official',
    label: 'Official Hub',
    icon: 'fa-compass',
    accent: 'sky',
    desc: 'Central staff & admin command portal with live KPIs and module launcher'
  },
  {
    key: 'collection',
    label: 'Fee & Receipt',
    icon: 'fa-receipt',
    accent: 'emerald',
    desc: 'Cashier counter, instant receipts, arrears tracking & financial ledger'
  },
  {
    key: 'student',
    label: 'Student Portal',
    icon: 'fa-user-graduate',
    accent: 'blue',
    desc: '24/7 parent & student self-service, digital receipts & sibling switcher'
  },
  {
    key: 'result',
    label: 'Exam & Rank Card',
    icon: 'fa-award',
    accent: 'violet',
    desc: 'Term mark entry, automated grading, class ranks & progress cards'
  },
  {
    key: 'attendance',
    label: 'Daily Attendance',
    icon: 'fa-calendar-check',
    accent: 'amber',
    desc: 'Mobile roll call, session attendance & monthly analytics'
  },
  {
    key: 'academicPlan',
    label: 'Academic Plan',
    icon: 'fa-book-open-reader',
    accent: 'teal',
    desc: 'Curriculum planning, syllabus milestones & master class timetables'
  },
  {
    key: 'worksheet',
    label: 'Worksheets',
    icon: 'fa-file-lines',
    accent: 'cyan',
    desc: 'Digital registers, custom printable sheets, ID cards & study resources'
  },
  {
    key: 'studentActivity',
    label: 'Activity & Merit',
    icon: 'fa-medal',
    accent: 'rose',
    desc: 'Co-curricular logs, competitions, student tasks & merit points'
  },
  {
    key: 'classroomEvaluation',
    label: 'Classroom Evaluation',
    icon: 'fa-clipboard-check',
    accent: 'slate',
    desc: 'Inspection rubrics, behaviour tracking & class quality audits'
  }
];

export const normalizeGlobalUserKey = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[\\/\s]+/g, '_');

export const buildInternalStaffEmail = (username = '', institutionId = INSTITUTION_ID) => {
  const cleanUser = String(username || '').trim().toLowerCase();
  if (!cleanUser) return '';
  if (cleanUser.includes('@')) return cleanUser;
  const cleanInst = sanitizeInstitutionSlug(institutionId) || 'school';
  return `${cleanUser}@${cleanInst}.internal`;
};

export const isInternalStaffEmail = (email = '') => {
  const clean = String(email || '').trim().toLowerCase();
  return /@[a-z0-9-_]+\.internal$/.test(clean);
};

export const extractInternalUsername = (email = '') => {
  const clean = String(email || '').trim().toLowerCase();
  if (!isInternalStaffEmail(clean)) return '';
  return clean.split('@')[0] || '';
};
