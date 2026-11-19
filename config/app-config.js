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
