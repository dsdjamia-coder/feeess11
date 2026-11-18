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
export const INSTITUTIONS_COLLECTION = 'institutions';
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
