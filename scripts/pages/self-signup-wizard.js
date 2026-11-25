import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { auth, firebaseConfig } from "../../config/firebase-config.js";
import { DEFAULT_BASIC_PLAN_LIMITS, RESERVED_INSTITUTION_SLUGS } from "../../config/app-config.js";
import {
  checkSelfSignupAvailability,
  normalizePhoneToE164Client,
  selfRegisterInstitutionAndSignIn,
  validateCustomUsername
} from "../shared/custom-auth-service.js";
import { fetchCompanyPublicCatalog } from "../shared/premium-plans-modal.js";

const WIZARD_MODAL_ID = 'self-signup-wizard-modal';

const esc = (val = '') => String(val ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const slugifyName = (raw = '') => String(raw || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, '')
  .trim()
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

let signupOtpAuth = null;
const getSignupOtpAuth = () => {
  if (signupOtpAuth) return signupOtpAuth;
  const existing = getApps().find((a) => a.name === 'self-signup-otp-verifier');
  const secondaryApp = existing || initializeApp(firebaseConfig, 'self-signup-otp-verifier');
  signupOtpAuth = getAuth(secondaryApp);
  return signupOtpAuth;
};

let activeRecaptcha = null;
const clearWizardRecaptcha = () => {
  try {
    activeRecaptcha?.clear?.();
  } catch (_) {}
  activeRecaptcha = null;
  const host = document.getElementById('self-signup-recaptcha-host');
  if (host) host.innerHTML = '';
};

const ensureWizardRecaptcha = async () => {
  clearWizardRecaptcha();
  const host = document.getElementById('self-signup-recaptcha-host');
  if (!host) throw new Error('Verification container is missing.');
  const slot = document.createElement('div');
  slot.id = `signup-rc-${Date.now()}`;
  host.appendChild(slot);
  const otpAuth = getSignupOtpAuth();
  activeRecaptcha = new RecaptchaVerifier(otpAuth, slot, {
    size: 'invisible',
    callback: () => {},
    'expired-callback': () => {
      clearWizardRecaptcha();
    }
  });
  await activeRecaptcha.render();
  return { otpAuth, verifier: activeRecaptcha };
};

export const closeSelfSignupWizard = () => {
  clearWizardRecaptcha();
  const modal = document.getElementById(WIZARD_MODAL_ID);
  if (modal) modal.remove();
  document.body?.classList.remove('overflow-hidden');
};

export const openSelfSignupWizard = async () => {
  if (typeof document === 'undefined') return;
  closeSelfSignupWizard();

  let catalog = null;
  try {
    catalog = await fetchCompanyPublicCatalog({});
  } catch (_) {}

  const selfSignupEnabled = catalog?.selfSignupConfig?.enabled !== false;
  const basicLimits = catalog?.selfSignupConfig?.defaultBasicLimits || DEFAULT_BASIC_PLAN_LIMITS;

  const state = {
    step: 1,
    slugTouched: false,
    slugCheckedValue: '',
    slugAvailable: false,
    usernameCheckedValue: '',
    usernameAvailable: false,
    institutionName: '',
    slug: '',
    place: '',
    phone: '',
    adminName: '',
    username: '',
    password: '',
    confirmPassword: '',
    phoneE164: '',
    confirmationResult: null,
    resendTimer: null,
    resendSeconds: 0,
    result: null
  };

  const modal = document.createElement('div');
  modal.id = WIZARD_MODAL_ID;
  modal.style.zIndex = '1000010';
  modal.className = 'fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Create Free Institution Website');

  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden" style="font-family:'Plus Jakarta Sans',sans-serif;">
      <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <i class="fas fa-rocket text-sm"></i>
          </div>
          <div class="min-w-0">
            <div class="text-[10px] font-extrabold uppercase tracking-wider text-blue-600">Free Forever · Basic Plan</div>
            <h3 class="text-base font-extrabold text-slate-900 truncate">Create Your Institution Website</h3>
          </div>
        </div>
        <button type="button" id="self-signup-close-btn" class="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer transition" aria-label="Close">
          <i class="fas fa-times text-xs"></i>
        </button>
      </div>

      ${selfSignupEnabled ? `
        <div class="px-5 pt-3.5 pb-2 border-b border-slate-100 bg-white shrink-0">
          <div class="grid grid-cols-4 gap-1.5" id="self-signup-stepper">
            <div data-step-pill="1" class="text-center">
              <div class="h-1.5 rounded-full bg-blue-600 mb-1"></div>
              <span class="text-[10px] font-extrabold text-blue-700">1. Institution</span>
            </div>
            <div data-step-pill="2" class="text-center">
              <div class="h-1.5 rounded-full bg-slate-200 mb-1"></div>
              <span class="text-[10px] font-bold text-slate-400">2. Admin</span>
            </div>
            <div data-step-pill="3" class="text-center">
              <div class="h-1.5 rounded-full bg-slate-200 mb-1"></div>
              <span class="text-[10px] font-bold text-slate-400">3. Verify OTP</span>
            </div>
            <div data-step-pill="4" class="text-center">
              <div class="h-1.5 rounded-full bg-slate-200 mb-1"></div>
              <span class="text-[10px] font-bold text-slate-400">4. Live!</span>
            </div>
          </div>
        </div>
      ` : ''}

      <div id="self-signup-body" class="p-5 overflow-y-auto flex-1 space-y-4 text-xs sm:text-sm"></div>
      <div id="self-signup-recaptcha-host" class="hidden"></div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add('overflow-hidden');

  const cleanupAndClose = () => {
    if (state.resendTimer) clearInterval(state.resendTimer);
    document.removeEventListener('keydown', onEscape);
    closeSelfSignupWizard();
  };

  const onEscape = (e) => {
    if (e.key === 'Escape') cleanupAndClose();
  };
  document.addEventListener('keydown', onEscape);
  modal.querySelector('#self-signup-close-btn')?.addEventListener('click', cleanupAndClose);
  modal.addEventListener('click', (e) => {
    if (e.target === modal && state.step !== 4) cleanupAndClose();
  });

  const bodyEl = modal.querySelector('#self-signup-body');
  if (!bodyEl) return;

  if (!selfSignupEnabled) {
    bodyEl.innerHTML = `
      <div class="py-6 text-center space-y-3">
        <div class="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 mx-auto flex items-center justify-center text-xl">
          <i class="fas fa-pause-circle"></i>
        </div>
        <h4 class="text-base font-extrabold text-slate-900">Self-Registration Temporarily Paused</h4>
        <p class="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
          New institution self-registration is currently disabled by the platform administrator. Please contact our support team to get your portal set up.
        </p>
        <button type="button" id="self-signup-disabled-close" class="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold cursor-pointer">
          Close
        </button>
      </div>
    `;
    bodyEl.querySelector('#self-signup-disabled-close')?.addEventListener('click', cleanupAndClose);
    return;
  }

  const updateStepper = () => {
    modal.querySelectorAll('[data-step-pill]').forEach((el) => {
      const n = Number(el.dataset.stepPill || 1);
      const bar = el.querySelector('div');
      const label = el.querySelector('span');
      if (n < state.step) {
        bar.className = 'h-1.5 rounded-full bg-emerald-500 mb-1';
        label.className = 'text-[10px] font-extrabold text-emerald-700';
      } else if (n === state.step) {
        bar.className = 'h-1.5 rounded-full bg-blue-600 mb-1';
        label.className = 'text-[10px] font-extrabold text-blue-700';
      } else {
        bar.className = 'h-1.5 rounded-full bg-slate-200 mb-1';
        label.className = 'text-[10px] font-bold text-slate-400';
      }
    });
  };

  const renderStep1 = () => {
    state.step = 1;
    updateStepper();
    bodyEl.innerHTML = `
      <div class="rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-blue-900">
        <span><i class="fas fa-circle-check text-blue-600 mr-1"></i>Includes Public Website, Admin, Fees, Results &amp; Student Portal</span>
        <span class="px-2 py-0.5 rounded-md bg-white border border-blue-200 text-blue-700">${basicLimits.maxStudents || 150} Students · ${basicLimits.maxStaff || 6} Staff · ${basicLimits.maxClasses || 12} Classes</span>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-inst-name">Institution Name <span class="text-rose-500">*</span></label>
          <input id="ss-inst-name" type="text" maxlength="120" value="${esc(state.institutionName)}" placeholder="e.g. Al-Huda Public Academy" class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 outline-none font-semibold text-xs sm:text-sm">
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-inst-slug">Portal Web Address (Slug) <span class="text-rose-500">*</span></label>
          <div class="flex items-center rounded-xl border border-slate-300 focus-within:border-blue-500 overflow-hidden bg-white">
            <span class="px-3 py-2.5 bg-slate-50 border-r border-slate-200 text-xs font-mono font-bold text-slate-500 select-none shrink-0">${esc(window.location.origin)}/</span>
            <input id="ss-inst-slug" type="text" maxlength="48" value="${esc(state.slug)}" placeholder="al-huda-academy" class="flex-1 px-3 py-2.5 outline-none font-mono font-bold lowercase text-xs sm:text-sm min-w-0">
          </div>
          <div id="ss-slug-status" class="text-[11px] font-semibold text-slate-500 mt-1 min-h-[1rem]">Use lowercase letters, numbers, and hyphens (min 3 characters).</div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-inst-place">City / Place <span class="text-rose-500">*</span></label>
            <input id="ss-inst-place" type="text" maxlength="100" value="${esc(state.place)}" placeholder="e.g. Kozhikode, Kerala" class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 outline-none font-semibold text-xs sm:text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-inst-phone">Mobile Number (for OTP) <span class="text-rose-500">*</span></label>
            <input id="ss-inst-phone" type="tel" maxlength="20" value="${esc(state.phone)}" placeholder="e.g. 9876543210 or +91..." class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 outline-none font-semibold text-xs sm:text-sm">
          </div>
        </div>
      </div>

      <div id="ss-step1-err" class="hidden rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2 text-xs font-bold"></div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button type="button" id="ss-cancel-1" class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer">Cancel</button>
        <button type="button" id="ss-next-1" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-xs cursor-pointer inline-flex items-center gap-1.5">
          <span>Next: Admin Account</span>
          <i class="fas fa-arrow-right text-[11px]"></i>
        </button>
      </div>
    `;

    const nameInput = bodyEl.querySelector('#ss-inst-name');
    const slugInput = bodyEl.querySelector('#ss-inst-slug');
    const placeInput = bodyEl.querySelector('#ss-inst-place');
    const phoneInput = bodyEl.querySelector('#ss-inst-phone');
    const slugStatusEl = bodyEl.querySelector('#ss-slug-status');
    const errEl = bodyEl.querySelector('#ss-step1-err');

    let slugDebounce = null;
    const checkSlugLive = async (rawVal) => {
      const clean = slugifyName(rawVal);
      if (!clean || clean.length < 3) {
        state.slugAvailable = false;
        slugStatusEl.className = 'text-[11px] font-semibold text-slate-500 mt-1';
        slugStatusEl.textContent = 'Enter at least 3 characters for your portal URL.';
        return;
      }
      if (RESERVED_INSTITUTION_SLUGS.has(clean)) {
        state.slugAvailable = false;
        slugStatusEl.className = 'text-[11px] font-bold text-rose-600 mt-1';
        slugStatusEl.textContent = 'This URL is reserved. Please pick another name.';
        return;
      }
      slugStatusEl.className = 'text-[11px] font-semibold text-blue-600 mt-1';
      slugStatusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>Checking availability...';
      try {
        const res = await checkSelfSignupAvailability({ slug: clean });
        if (slugifyName(slugInput.value) !== clean) return;
        state.slugCheckedValue = clean;
        state.slugAvailable = res.slugAvailable === true;
        if (state.slugAvailable) {
          slugStatusEl.className = 'text-[11px] font-bold text-emerald-700 mt-1';
          slugStatusEl.innerHTML = `<i class="fas fa-circle-check mr-1"></i>Available: /${esc(clean)}`;
        } else {
          slugStatusEl.className = 'text-[11px] font-bold text-rose-600 mt-1';
          slugStatusEl.textContent = res.slugReason || 'This portal URL is already taken.';
        }
      } catch (_) {
        slugStatusEl.className = 'text-[11px] font-semibold text-amber-700 mt-1';
        slugStatusEl.textContent = 'Availability will be verified on final step.';
      }
    };

    nameInput.addEventListener('input', () => {
      state.institutionName = nameInput.value;
      if (!state.slugTouched) {
        const generated = slugifyName(nameInput.value);
        slugInput.value = generated;
        state.slug = generated;
        clearTimeout(slugDebounce);
        slugDebounce = setTimeout(() => checkSlugLive(generated), 450);
      }
    });

    slugInput.addEventListener('input', () => {
      state.slugTouched = true;
      const clean = slugifyName(slugInput.value);
      state.slug = clean;
      clearTimeout(slugDebounce);
      slugDebounce = setTimeout(() => checkSlugLive(clean), 400);
    });

    bodyEl.querySelector('#ss-cancel-1')?.addEventListener('click', cleanupAndClose);
    bodyEl.querySelector('#ss-next-1')?.addEventListener('click', async () => {
      errEl.classList.add('hidden');
      const instName = String(nameInput.value || '').trim();
      const slug = slugifyName(slugInput.value || '');
      const place = String(placeInput.value || '').trim();
      const phone = String(phoneInput.value || '').trim();
      const phoneE164 = normalizePhoneToE164Client(phone);

      if (instName.length < 3) {
        errEl.textContent = 'Please enter a valid institution name (at least 3 characters).';
        errEl.classList.remove('hidden');
        return;
      }
      if (!slug || slug.length < 3 || RESERVED_INSTITUTION_SLUGS.has(slug)) {
        errEl.textContent = 'Please choose a valid, non-reserved portal URL slug (at least 3 characters).';
        errEl.classList.remove('hidden');
        return;
      }
      if (!place) {
        errEl.textContent = 'Please enter your institution city or place.';
        errEl.classList.remove('hidden');
        return;
      }
      if (!phoneE164) {
        errEl.textContent = 'Please enter a valid 10-digit or international mobile number for OTP verification.';
        errEl.classList.remove('hidden');
        return;
      }

      const nextBtn = bodyEl.querySelector('#ss-next-1');
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-xs"></i><span>Checking...</span>';

      try {
        if (state.slugCheckedValue !== slug || !state.slugAvailable) {
          const check = await checkSelfSignupAvailability({ slug });
          if (check.selfSignupEnabled === false) {
            throw new Error('Self-service registration is currently paused.');
          }
          if (!check.slugAvailable) {
            throw new Error(check.slugReason || 'This portal URL is already taken. Please choose another.');
          }
          state.slugCheckedValue = slug;
          state.slugAvailable = true;
        }
        state.institutionName = instName;
        state.slug = slug;
        state.place = place;
        state.phone = phone;
        state.phoneE164 = phoneE164;
        renderStep2();
      } catch (err) {
        errEl.textContent = err?.message || 'Unable to verify portal URL.';
        errEl.classList.remove('hidden');
        nextBtn.disabled = false;
        nextBtn.innerHTML = '<span>Next: Admin Account</span><i class="fas fa-arrow-right text-[11px]"></i>';
      }
    });
  };

  const renderStep2 = () => {
    state.step = 2;
    updateStepper();
    bodyEl.innerHTML = `
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-center justify-between gap-2 text-[11px]">
        <span class="font-extrabold text-slate-800 truncate">${esc(state.institutionName)}</span>
        <span class="font-mono font-bold text-blue-700 shrink-0">/${esc(state.slug)}</span>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-admin-name">Super Admin / Principal Name <span class="text-rose-500">*</span></label>
          <input id="ss-admin-name" type="text" maxlength="100" value="${esc(state.adminName)}" placeholder="e.g. Muhammed Rashid" class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 outline-none font-semibold text-xs sm:text-sm">
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-admin-username">Super Admin Username <span class="text-rose-500">*</span></label>
          <input id="ss-admin-username" type="text" maxlength="60" value="${esc(state.username)}" placeholder="e.g. alhuda_admin (no spaces)" autocomplete="username" class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 outline-none font-semibold text-xs sm:text-sm">
          <div id="ss-user-status" class="text-[11px] font-semibold text-slate-500 mt-1 min-h-[1rem]">3–60 characters, letters/numbers/symbols allowed, no spaces.</div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-admin-pass">Password <span class="text-rose-500">*</span></label>
            <input id="ss-admin-pass" type="password" minlength="6" maxlength="64" value="${esc(state.password)}" placeholder="Minimum 6 characters" autocomplete="new-password" class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 outline-none font-semibold text-xs sm:text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1" for="ss-admin-pass2">Confirm Password <span class="text-rose-500">*</span></label>
            <input id="ss-admin-pass2" type="password" minlength="6" maxlength="64" value="${esc(state.confirmPassword)}" placeholder="Re-enter password" autocomplete="new-password" class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 outline-none font-semibold text-xs sm:text-sm">
          </div>
        </div>
      </div>

      <div id="ss-step2-err" class="hidden rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2 text-xs font-bold"></div>

      <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <button type="button" id="ss-back-2" class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer inline-flex items-center gap-1.5">
          <i class="fas fa-arrow-left text-[11px]"></i>
          <span>Back</span>
        </button>
        <button type="button" id="ss-next-2" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-xs cursor-pointer inline-flex items-center gap-1.5">
          <span>Send OTP to ${esc(state.phoneE164)}</span>
          <i class="fas fa-shield-halved text-[11px]"></i>
        </button>
      </div>
    `;

    const adminNameEl = bodyEl.querySelector('#ss-admin-name');
    const userEl = bodyEl.querySelector('#ss-admin-username');
    const passEl = bodyEl.querySelector('#ss-admin-pass');
    const pass2El = bodyEl.querySelector('#ss-admin-pass2');
    const userStatusEl = bodyEl.querySelector('#ss-user-status');
    const errEl = bodyEl.querySelector('#ss-step2-err');

    let userDebounce = null;
    userEl.addEventListener('input', () => {
      const val = String(userEl.value || '').trim();
      clearTimeout(userDebounce);
      const v = validateCustomUsername(val);
      if (!v.valid) {
        state.usernameAvailable = false;
        userStatusEl.className = 'text-[11px] font-semibold text-slate-500 mt-1';
        userStatusEl.textContent = v.error;
        return;
      }
      userDebounce = setTimeout(async () => {
        userStatusEl.className = 'text-[11px] font-semibold text-blue-600 mt-1';
        userStatusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>Checking username...';
        try {
          const res = await checkSelfSignupAvailability({ username: val });
          if (String(userEl.value || '').trim() !== val) return;
          state.usernameCheckedValue = val.toLowerCase();
          state.usernameAvailable = res.usernameAvailable === true;
          if (state.usernameAvailable) {
            userStatusEl.className = 'text-[11px] font-bold text-emerald-700 mt-1';
            userStatusEl.innerHTML = '<i class="fas fa-circle-check mr-1"></i>Username is available';
          } else {
            userStatusEl.className = 'text-[11px] font-bold text-rose-600 mt-1';
            userStatusEl.textContent = res.usernameReason || 'Username is already taken.';
          }
        } catch (_) {
          userStatusEl.className = 'text-[11px] font-semibold text-amber-700 mt-1';
          userStatusEl.textContent = 'Username will be verified when creating account.';
        }
      }, 400);
    });

    bodyEl.querySelector('#ss-back-2')?.addEventListener('click', () => {
      state.adminName = adminNameEl.value;
      state.username = userEl.value;
      state.password = passEl.value;
      state.confirmPassword = pass2El.value;
      renderStep1();
    });

    bodyEl.querySelector('#ss-next-2')?.addEventListener('click', async () => {
      errEl.classList.add('hidden');
      const adminName = String(adminNameEl.value || '').trim();
      const username = String(userEl.value || '').trim();
      const password = String(passEl.value || '');
      const confirmPassword = String(pass2El.value || '');

      if (adminName.length < 2) {
        errEl.textContent = 'Please enter the Super Admin or Principal name.';
        errEl.classList.remove('hidden');
        return;
      }
      const uCheck = validateCustomUsername(username);
      if (!uCheck.valid) {
        errEl.textContent = uCheck.error;
        errEl.classList.remove('hidden');
        return;
      }
      if (password.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters long.';
        errEl.classList.remove('hidden');
        return;
      }
      if (password !== confirmPassword) {
        errEl.textContent = 'Passwords do not match. Please check and re-enter.';
        errEl.classList.remove('hidden');
        return;
      }

      const btn = bodyEl.querySelector('#ss-next-2');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-xs"></i><span>Sending SMS OTP...</span>';

      try {
        if (state.usernameCheckedValue !== uCheck.username || !state.usernameAvailable) {
          const avail = await checkSelfSignupAvailability({ username });
          if (!avail.usernameAvailable) {
            throw new Error(avail.usernameReason || 'This username is already taken.');
          }
          state.usernameCheckedValue = uCheck.username;
          state.usernameAvailable = true;
        }

        state.adminName = adminName;
        state.username = username;
        state.password = password;
        state.confirmPassword = confirmPassword;

        const { otpAuth, verifier } = await ensureWizardRecaptcha();
        state.confirmationResult = await signInWithPhoneNumber(otpAuth, state.phoneE164, verifier);
        renderStep3();
      } catch (err) {
        clearWizardRecaptcha();
        errEl.textContent = err?.message || 'Could not send OTP SMS. Please check the mobile number and try again.';
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = `<span>Send OTP to ${esc(state.phoneE164)}</span><i class="fas fa-shield-halved text-[11px]"></i>`;
      }
    });
  };

  const renderStep3 = () => {
    state.step = 3;
    updateStepper();

    if (state.resendTimer) clearInterval(state.resendTimer);
    state.resendSeconds = 45;

    bodyEl.innerHTML = `
      <div class="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-center space-y-1.5">
        <div class="w-10 h-10 rounded-xl bg-emerald-600 text-white mx-auto flex items-center justify-center text-sm">
          <i class="fas fa-sms"></i>
        </div>
        <h4 class="text-sm font-extrabold text-emerald-950">Verify Your Mobile Number</h4>
        <p class="text-xs text-emerald-800">Enter the 6-digit SMS OTP sent to <span class="font-extrabold">${esc(state.phoneE164)}</span></p>
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-bold text-slate-700 text-center" for="ss-otp-code">6-Digit Verification Code</label>
        <input id="ss-otp-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="------" class="w-full max-w-[220px] mx-auto block text-center tracking-[0.45em] text-xl font-extrabold px-4 py-3 rounded-2xl border-2 border-slate-300 focus:border-blue-600 outline-none">
      </div>

      <div id="ss-step3-err" class="hidden rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2 text-xs font-bold text-center"></div>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <button type="button" id="ss-back-3" class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer">
          <i class="fas fa-arrow-left mr-1"></i>Edit Details
        </button>
        <div class="flex items-center gap-2">
          <button type="button" id="ss-resend-otp" disabled class="px-3 py-2 rounded-xl border border-slate-200 text-slate-400 text-xs font-bold cursor-not-allowed">
            Resend (45s)
          </button>
          <button type="button" id="ss-verify-create" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs cursor-pointer inline-flex items-center gap-1.5">
            <i class="fas fa-check-circle"></i>
            <span>Verify &amp; Launch Website</span>
          </button>
        </div>
      </div>
    `;

    const otpInput = bodyEl.querySelector('#ss-otp-code');
    const errEl = bodyEl.querySelector('#ss-step3-err');
    const resendBtn = bodyEl.querySelector('#ss-resend-otp');
    const verifyBtn = bodyEl.querySelector('#ss-verify-create');
    otpInput?.focus();

    state.resendTimer = setInterval(() => {
      state.resendSeconds -= 1;
      if (state.resendSeconds <= 0) {
        clearInterval(state.resendTimer);
        if (resendBtn) {
          resendBtn.disabled = false;
          resendBtn.className = 'px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold cursor-pointer';
          resendBtn.textContent = 'Resend OTP';
        }
      } else if (resendBtn) {
        resendBtn.textContent = `Resend (${state.resendSeconds}s)`;
      }
    }, 1000);

    bodyEl.querySelector('#ss-back-3')?.addEventListener('click', () => {
      if (state.resendTimer) clearInterval(state.resendTimer);
      renderStep2();
    });

    resendBtn?.addEventListener('click', async () => {
      errEl.classList.add('hidden');
      resendBtn.disabled = true;
      resendBtn.textContent = 'Sending...';
      try {
        const { otpAuth, verifier } = await ensureWizardRecaptcha();
        state.confirmationResult = await signInWithPhoneNumber(otpAuth, state.phoneE164, verifier);
        renderStep3();
      } catch (err) {
        clearWizardRecaptcha();
        errEl.textContent = err?.message || 'Could not resend OTP right now.';
        errEl.classList.remove('hidden');
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend OTP';
      }
    });

    verifyBtn?.addEventListener('click', async () => {
      errEl.classList.add('hidden');
      const code = String(otpInput?.value || '').replace(/\D/g, '').trim();
      if (code.length !== 6) {
        errEl.textContent = 'Please enter the 6-digit OTP code from your SMS.';
        errEl.classList.remove('hidden');
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-xs"></i><span>Creating Workspace...</span>';

      try {
        const phoneCred = await state.confirmationResult.confirm(code);
        const phoneIdToken = await phoneCred.user.getIdToken(true);

        const regResult = await selfRegisterInstitutionAndSignIn(auth, {
          institutionName: state.institutionName,
          slug: state.slug,
          place: state.place,
          phone: state.phone,
          adminName: state.adminName,
          username: state.username,
          password: state.password,
          phoneIdToken
        });

        try {
          await signOut(getSignupOtpAuth());
        } catch (_) {}

        // Save local AppSession so Super Admin can jump directly into Official Hub
        if (window.AppSession) {
          window.AppSession.setInstitutionId?.(regResult.slug);
          window.AppSession.setLastInstitutionId?.(regResult.slug);
          window.AppSession.setOfficialSession?.({
            uid: regResult.profile?.uid,
            role: 'super_admin',
            institutionId: regResult.slug,
            username: regResult.profile?.username,
            displayUsername: regResult.profile?.displayUsername,
            displayName: regResult.profile?.displayName
          });
        }

        state.result = regResult;
        if (state.resendTimer) clearInterval(state.resendTimer);
        renderStep4();
      } catch (err) {
        errEl.textContent = err?.message || 'OTP verification or workspace setup failed. Please try again.';
        errEl.classList.remove('hidden');
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = '<i class="fas fa-check-circle"></i><span>Verify &amp; Launch Website</span>';
      }
    });
  };

  const renderStep4 = () => {
    state.step = 4;
    updateStepper();
    const res = state.result || {};
    const slug = res.slug || state.slug;
    const limits = res.planLimits || basicLimits;
    const publicUrl = `${window.location.origin}/${encodeURIComponent(slug)}`;
    const officialUrl = `/${encodeURIComponent(slug)}/official.html`;

    bodyEl.innerHTML = `
      <div class="text-center space-y-3 py-2">
        <div class="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center text-2xl shadow-xs">
          <i class="fas fa-circle-check"></i>
        </div>
        <div>
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase tracking-wider mb-1">Basic Plan Active · Free Forever</span>
          <h4 class="text-lg font-extrabold text-slate-900">Your Institution Website Is Live!</h4>
          <p class="text-xs text-slate-600 mt-0.5">${esc(state.institutionName)} has been provisioned and you are signed in as Super Admin.</p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-left space-y-2 text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-slate-500">Public Website URL</span>
            <a href="${esc(publicUrl)}" target="_blank" rel="noopener noreferrer" class="font-mono font-extrabold text-blue-600 hover:underline truncate">${esc(publicUrl)}</a>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-slate-500">Admin Username</span>
            <span class="font-mono font-extrabold text-slate-900">${esc(state.username)}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-slate-500">Free Plan Quota</span>
            <span class="font-extrabold text-slate-800">${limits.maxStudents || 150} Students · ${limits.maxStaff || 6} Staff · ${limits.maxClasses || 12} Classes</span>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
          <a href="${esc(publicUrl)}" class="py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-extrabold inline-flex items-center justify-center gap-2 transition">
            <i class="fas fa-globe text-blue-600"></i>
            <span>View Public Website</span>
          </a>
          <a href="${esc(officialUrl)}" class="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 shadow-xs transition">
            <i class="fas fa-compass"></i>
            <span>Open Official Hub</span>
          </a>
        </div>
      </div>
    `;
  };

  renderStep1();
};
