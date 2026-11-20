# Firebase Setup, Login Architecture & Migration Guide (Malayalam + English)

ഈ ആപ്ലിക്കേഷന്റെ (**Institution Manage**) നിലവിലെ സമ്പൂർണ്ണ **Firebase Authentication, Custom Username Auth (Cloud Functions Gen 2), Cloud Firestore, Firebase Storage (Smart WebP), Security Rules, GitHub Actions Auto-Deploy** എന്നിവയുടെ പൂർണ്ണ ഗൈഡ് ആണിത്.

പുതിയൊരു **Firebase Project / Account**-ലേക്ക് മാറ്റുമ്പോഴും, ഡാറ്റാബേസ് ക്ലീൻ ചെയ്ത ശേഷം **ആദ്യം മുതൽ (From Scratch)** സെറ്റ് ചെയ്യുമ്പോഴും താഴെ പറയുന്ന ക്രമത്തിൽ എല്ലാം കൃത്യമായി ചെയ്യാം.

---

## 1. നിലവിലെ ലോഗിൻ സംവിധാനവും അനുവദനീയമായ അധികാരങ്ങളും (Complete Login & Permissions Matrix)

ഈ ആപ്ലിക്കേഷനിൽ **5 തരം യൂസർ റോളുകളാണ്** ഉള്ളത്. ഓരോ റോളിനും എങ്ങനെ ലോഗിൻ ചെയ്യാം, അവരുടെ ക്രെഡൻഷ്യലുകൾ എവിടെയാണ് സൂക്ഷിക്കുന്നത്, എന്തെല്ലാം അനുവദനീയമാണ് എന്ന് താഴെ കൃത്യമായി നൽകിയിരിക്കുന്നു:

| യൂസർ റോൾ (Role) | ലോഗിൻ രീതി (Auth Method) | ലോഗിൻ ഐഡി (Identifier) | ക്രെഡൻഷ്യൽ സൂക്ഷിക്കുന്നത് | അനുവദനീയമായവ (Allowed) | നിരോധിച്ചവ (Not Allowed) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Company Owner (കമ്പനി മാനേജർ)** | Firebase **Email/Password** | **ഇഷ്ടമുള്ള ഏത് ഇമെയിലും** *(ഉദാ: `dsdjamia@gmail.com` അല്ലെങ്കിൽ നിങ്ങൾ ആഡ് ചെയ്യുന്ന ഏത് ഇമെയിലും)* | **Firebase Auth -> Users** + Firestore-ലെ **`company/config`** | `/company` Master Console, പുതിയ സ്ഥാപനങ്ങൾ സൃഷ്ടിക്കൽ/പോസ് ചെയ്യൽ/പ്ലാൻ മാറ്റൽ, Super Admin യൂസർനെയിം & പാസ്‌വേഡ് സെറ്റ് ചെയ്യൽ, Public Catalog (Plans/Offers/Contact), Platform Screenshots അപ്‌ലോഡ് (`company/showcases`), ഏത് സ്ഥാപനത്തിന്റെയും അഡ്മിൻ ആക്‌സസ് | `authCredentials` ക്ലയന്റിൽ നിന്ന് നേരിട്ട് റീഡ്/റൈറ്റ് ചെയ്യാൻ കഴിയില്ല (Cloud Function വഴി മാത്രം). |
| **2. Institution Super Admin** | **Custom Username Auth** *(Cloud Function -> Custom Auth Token, UID: `sa_<slug>`)* | **ഇമെയിൽ ഫോർമാറ്റ് നിർബന്ധമില്ല!** *(ഇഷ്ടമുള്ള കസ്റ്റം യൂസർനെയിം, 3–60 അക്ഷരം, സ്പേസ് പാടില്ല; ഗ്ലോബലി യുണീക്ക് ആയിരിക്കണം)* | സെർവർ-ഒൺലി **`authCredentials`** (scrypt hash) + `institutions/{slug}/settings/adminAuth` | സ്വന്തം സ്ഥാപനത്തിലെ മുഴുവൻ ഡാറ്റയും, Staff സൃഷ്ടിക്കലും ലോഗിൻ/പാസ്‌വേഡ് നിയന്ത്രണവും, Students, Fees, Results, Attendance, Academic Plan, Activity, Evaluation, Worksheet, Notices, Gallery, Logo/Photo അപ്‌ലോഡ് (Storage), സ്വന്തം പാസ്‌വേഡ് മാറ്റൽ | `/company` Console-ലേക്ക് പ്രവേശനമില്ല; മറ്റു സ്ഥാപനങ്ങളുടെ ഡാറ്റയോ Storage ഫയലുകളോ കാണാനോ മാറ്റാനോ കഴിയില്ല; സബ്‌സ്ക്രിപ്ഷൻ കാലാവധി കഴിഞ്ഞാലോ സ്ഥാപനം Pause ചെയ്താലോ ലോഗിൻ ബ്ലോക്ക് ആകും. |
| **3. Staff / Staff Manager** | **Custom Username Auth** *(Cloud Function -> Custom Auth Token, UID: `st_<slug>_<staffId>`)* | **ഇഷ്ടമുള്ള കസ്റ്റം യൂസർനെയിം** *(3–60 അക്ഷരം, സ്പേസ് പാടില്ല; ഗ്ലോബലി യുണീക്ക്)* | സെർവർ-ഒൺലി **`authCredentials`** (scrypt hash) + `institutions/{slug}/staffAccess/{uid}` | `staffAccess`-ൽ അഡ്മിൻ അനുവദിച്ച മോഡ്യൂളുകൾ മാത്രം (`canAccessAdmin` / `actLikeSuperAdmin`, `canCollect`, `canManageResults`, `canAccessAttendance`, `canAccessAcademicPlan`, `canAccessActivity`, `canAccessEvaluation`, `canAccessWorksheet`), സ്വന്തം ID ഫോട്ടോ അപ്‌ഡേറ്റ്, സ്വന്തം പാസ്‌വേഡ് മാറ്റൽ | അനുവദിക്കാത്ത മോഡ്യൂളുകളിലേക്കും മറ്റു സ്ഥാപനങ്ങളിലേക്കും `/company`-യിലേക്കും പ്രവേശനമില്ല; അക്കൗണ്ട് Deactivate (`isActive: false`) ചെയ്താൽ ഉടൻ ലോഗിൻ ബ്ലോക്ക് ആകും. |
| **4. Students** | **Anonymous Auth** + Admission Number Lookup | സ്ഥാപനത്തിന്റെ പേജിൽ (`/<slug>`) **Admission Number** + Student Password/DOB | `institutions/{slug}/studentAuthLookup` + `students/{id}` | സ്വന്തം ഫീസ്/റിസൾട്ട്/അറ്റൻഡൻസ്/പ്രൊഫൈൽ കാണൽ; **Admin Settings-ൽ Enable ചെയ്താൽ മാത്രം** സ്വന്തം പ്രൊഫൈൽ ഫോട്ടോ (150 KB വരെ Storage-ൽ `students/submissions`) അല്ലെങ്കിൽ അനുവദിച്ച ഡീറ്റെയിൽസ് എഡിറ്റ് ചെയ്യൽ | മറ്റു വിദ്യാർത്ഥികളുടെ ഡാറ്റ മാറ്റാനോ, Admin/Staff പേജുകളിലേക്കോ Storage ഫയലുകൾ ഡിലീറ്റ് ചെയ്യാനോ അനുവാദമില്ല. |
| **5. Public Directory Members** | **Anonymous Auth** + Category Auth | സ്ഥാപനത്തിന്റെ പേജിൽ (`/<slug>`) Category Username | `institutions/{slug}/directoryEntries` | അനുവദിച്ച പ്രൊഫൈൽ കാണൽ, ID കാർഡ് ഫോട്ടോ അപ്‌ഡേറ്റ് (150 KB വരെ Storage-ൽ `public/directory`) | മറ്റ് ഡാറ്റ മാറ്റാനോ Storage ഫയലുകൾ ഡിലീറ്റ് ചെയ്യാനോ അനുവാദമില്ല. |

### പ്രധാന വ്യക്തതകൾ (Important Clarifications)
- **Authentication -> Users-ൽ ഏത് ഇമെയിലും ചേർക്കാമോ?**
  - **അതെ!** Firebase പ്രൊജക്റ്റ് ഉടമസ്ഥതയിലുള്ള Google അക്കൗണ്ടും (ഉദാ: `dsdjamia@gmail.com`) ആപ്പിൽ Company Owner ലോഗിൻ ചെയ്യാനായി **Authentication -> Users**-ൽ ചേർക്കുന്ന ഇമെയിലും വെവ്വേറെയാണ്.
  - നിങ്ങൾക്ക് **`dsdjamia@gmail.com`** തന്നെയോ, അല്ലെങ്കിൽ നിങ്ങൾക്കിഷ്ടമുള്ള **മറ്റേത് ഇമെയിലും** (ഉദാ: `admin@mybrand.com`) **Authentication -> Users**-ൽ ചേർക്കാം. അതേ ഇമെയിൽ Firestore-ലെ **`company/config`**-ലും നൽകിയാൽ മതി.
  - ആദ്യമായി `/company` തുറക്കുമ്പോൾ `syncCompanyOwnerClaims` എന്ന Cloud Function സ്വയം പ്രവർത്തിച്ച് ആ അക്കൗണ്ടിന് `companyOwner: true` ടോക്കൺ നൽകും — അതിനാൽ **ഏത് Company Owner ഇമെയിലിനും Firebase Storage അപ്‌ലോഡ്/ഡിലീറ്റ് (Platform Screenshots ഉൾപ്പെടെ) സ്വയം പ്രവർത്തിക്കും**, `storage.rules` വീണ്ടും എഡിറ്റ് ചെയ്യേണ്ടതില്ല!
- **Super Admin / Staff അക്കൗണ്ടുകൾ Firebase Authentication -> Users-ൽ ആഡ് ചെയ്യണോ?**
  - **വേണ്ട!** പുതിയ Custom Username Auth സിസ്റ്റത്തിൽ Super Admin-നെയും Staff-നെയും **Firebase Authentication -> Users-ൽ മാനുവലായി ചേർക്കേണ്ടതില്ല**. അവ `/company` (Super Admin), `/admin` (Staff Management) എന്നിവിടങ്ങളിൽ നിന്ന് സേവ് ചെയ്യുമ്പോൾ Cloud Functions വഴി സുരക്ഷിതമായി `authCredentials` (scrypt hash) കളക്ഷനിൽ സൂക്ഷിക്കപ്പെടുന്നു.
- **Brute-Force സുരക്ഷ:** തുടർച്ചയായി **5 തവണ** തെറ്റായ പാസ്‌വേഡ് നൽകിയാൽ ആ കസ്റ്റം യൂസർനെയിം **5 മിനിറ്റത്തേക്ക്** ഓട്ടോമാറ്റിക്കായി ലോക്ക് ആകും.

---

## 2. Quick Master Checklist (ആദ്യം മുതൽ സെറ്റ് ചെയ്യാൻ)

- [ ] **Step 1:** Firebase Project **Blaze Plan**-ലേക്ക് അപ്‌ഗ്രേഡ് ചെയ്യുക *(Cloud Functions Gen 2-ന് നിർബന്ധം)*.
- [ ] **Step 2:** **Authentication -> Sign-in method**-ൽ **Email/Password** ഉം **Anonymous** ഉം **Enable** ചെയ്യുക.
- [ ] **Step 3:** **Authentication -> Settings -> Authorized domains**-ൽ `localhost` ഉം നിങ്ങളുടെ live ഡൊമെയ്നും (ഉദാ: Vercel / Custom domain) ചേർക്കുക.
- [ ] **Step 4:** **Firestore Database** നിർമ്മിക്കുക *(നിലവിലെ പ്രൊജക്റ്റിൽ Named Database ID: **`default`** ആണ്; പുതിയ പ്രൊജക്റ്റിൽ `(default)` ആണെങ്കിൽ `config/firebase-config.js`, `firebase.json`, `functions/index.js` എന്നിവ അതിനനുസരിച്ച് പൊരുത്തപ്പെടുത്തണം)*.
- [ ] **Step 5:** **Firebase Storage** Enable ചെയ്യുക.
- [ ] **Step 6:** **Google Cloud IAM**-ൽ Service Account-ന് ആവശ്യമായ 6 റോളുകൾ നൽകുക + GitHub Secrets-ൽ `FIREBASE_SERVICE_ACCOUNT` ചേർക്കുക.
- [ ] **Step 7:** GitHub-ലേക്ക് Push ചെയ്ത് **Actions (`Deploy Firebase Functions & Security Rules`)** വഴി Cloud Functions (Node.js 22, `asia-south1`), `firestore.rules`, `storage.rules` എന്നിവ ഡിപ്ലോയ് ചെയ്യുക (പച്ച ടിക്ക് ✔ ഉറപ്പാക്കുക).
- [ ] **Step 8:** **Authentication -> Users**-ൽ നിങ്ങൾക്കിഷ്ടമുള്ള Company Owner ഇമെയിൽ + പാസ്‌വേഡ് **Add user** വഴി ചേർക്കുക.
- [ ] **Step 9:** **Firestore Database (`default`)**-ൽ **`company/config`** എന്ന ഒറ്റ ഡോക്യുമെന്റ് നിർമ്മിക്കുക.
- [ ] **Step 10:** ഹോം പേജ് (`/`) വഴി Company Owner ആയി ലോഗിൻ ചെയ്ത് **`/company`**-ൽ നിന്ന് സ്ഥാപനങ്ങളും Super Admin അക്കൗണ്ടുകളും നിർമ്മിക്കുക.

---

## 3. Phase 1: പുതിയ / ക്ലീൻ ചെയ്ത Firebase Project-ൽ ആദ്യ Company Owner Bootstrap ചെയ്യുന്ന വിധം

### ഘട്ടം A: Firebase Authentication-ൽ Company Owner User ചേർക്കുക
1. [Firebase Console](https://console.firebase.google.com/) -> നിങ്ങളുടെ പ്രൊജക്റ്റ് (`test-noorulislam`) -> **Build -> Authentication** തുറക്കുക.
2. **Sign-in method** ടാബിൽ ഇവ രണ്ടും **Enable** ചെയ്യുക:
   - **Email/Password** -> Enable *(Company Owner ലോഗിന് നിർബന്ധം)*
   - **Anonymous** -> Enable *(Students & Public Directory ലോഗിന് നിർബന്ധം)*
3. **Users** ടാബിൽ പോയി **Add user** ക്ലിക്ക് ചെയ്യുക:
   - **Email:** നിങ്ങൾക്കിഷ്ടമുള്ള Company Owner ഇമെയിൽ നൽകുക (ഉദാ: `dsdjamia@gmail.com` അല്ലെങ്കിൽ `owner@yourbrand.com` — **ചെറിയക്ഷരത്തിൽ / lowercase**).
   - **Password:** കുറഞ്ഞത് 6 അക്ഷരമുള്ള ശക്തമായ പാസ്‌വേഡ് നൽകുക.
   - **Add user** ക്ലിക്ക് ചെയ്യുക.

### ഘട്ടം B: Firestore-ൽ `company/config` ഡോക്യുമെന്റ് നിർമ്മിക്കുക
1. **Build -> Firestore Database -> Data** തുറക്കുക.
2. **വളരെ പ്രധാനം:** മുകളിലെ ഡാറ്റാബേസ് സെലക്ടറിൽ ശരിയായ ഡാറ്റാബേസ് (`default` — ബ്രാക്കറ്റില്ലാത്തത്) ആണെന്ന് ഉറപ്പുവരുത്തുക.
3. **+ Start collection** -> Collection ID: **`company`** -> **Next**.
4. **Document ID:** **`config`** *(Auto-ID ഉപയോഗിക്കരുത്! കൃത്യമായി `config` എന്ന് ടൈപ്പ് ചെയ്യുക)*.
5. **Document Root-ൽ** താഴെ കാണുന്ന ഫീൽഡുകൾ ചേർത്ത് **Save** ചെയ്യുക:

```text
✅ ശരിയായ ഘടന (Document Root-ൽ നേരിട്ട് ഫീൽഡുകൾ):     ❌ തെറ്റായ ഘടന (ഇങ്ങനെ ചെയ്താൽ Login ആകില്ല!):
company/config                                         company/config
├── companyName (string) : "Institution Manage"        └── email (map)  <-- email ഒരു map ആകരുത്!
├── email (string)       : "dsdjamia@gmail.com"            ├── owners (map)
├── name (string)        : "Company Owner"                 └── ownersIndex (map)
├── ownersIndex (map)
│   └── dsdjamia@gmail.com (boolean) : true
└── owners (array)
    └── 0 (map)
        ├── email (string)     : "dsdjamia@gmail.com"
        ├── name (string)      : "Company Owner"
        ├── role (string)      : "company_owner"
        └── isActive (boolean) : true
```

*(ചുരുക്കത്തിൽ: `email` (string), `companyName` (string), `name` (string) എന്നീ 3 ഫീൽഡുകൾ മാത്രം നൽകിയാലും ലോഗിൻ പ്രവർത്തിക്കും; ഒന്നിലധികം Company Owners വേണമെങ്കിൽ `ownersIndex` (map) + `owners` (array) കൂടി ചേർക്കുക.)*

### ഘട്ടം C: ആദ്യ ലോഗിനും സ്ഥാപനങ്ങൾ നിർമ്മിക്കലും
1. നിങ്ങളുടെ സൈറ്റിന്റെ ഹോം പേജ് (`https://your-domain/`) തുറന്ന് **Login** ക്ലിക്ക് ചെയ്യുക.
2. **Step 1:** നിങ്ങൾ ചേർത്ത Company Owner ഇമെയിൽ നൽകുക -> **"Company Console Account"** എന്ന് കാണിക്കും.
3. **Step 2:** Authentication-ൽ നൽകിയ പാസ്‌വേഡ് അടിച്ച് **Sign In** ചെയ്യുക.
4. ഉടൻ **`/company` (Company Master Portal)** തുറക്കും — ഒപ്പം Storage അനുമതിക്കുള്ള `companyOwner: true` ക്ലെയിം ഓട്ടോമാറ്റിക്കായി സിങ്ക് ആകും.
5. ഇനി **Add Institution** വഴി ഏത് സ്ഥാപനവും (`slug`, `plan`, `allowedPages`, **Super Admin Custom Username & Password**) നേരിട്ട് നിർമ്മിക്കാം (`https://your-domain/<slug>`).

---

## 4. Phase 2: കോഡ്ബേസിൽ പ്രൊജക്റ്റ് മാറ്റുമ്പോൾ അപ്‌ഡേറ്റ് ചെയ്യേണ്ട ഫയലുകൾ

മറ്റൊരു പുതിയ Firebase Project-ലേക്ക് മാറുമ്പോൾ മാത്രം താഴെ പറയുന്ന ഫയലുകൾ അപ്‌ഡേറ്റ് ചെയ്യുക:

1. **`config/firebase-config.js`:**
   - പുതിയ `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`.
   - `firestoreDatabaseId`: Named DB ആണെങ്കിൽ അതിന്റെ പേര് (`"default"`), Standard `(default)` DB ആണെങ്കിൽ `"(default)"` അല്ലെങ്കിൽ ഒഴിവാക്കുക.
   - `getFunctions(app, 'asia-south1')` & `getStorage(app)` നിലനിർത്തുക.
2. **`functions/index.js` (വരി 18):**
   - Named DB `default` ആണെങ്കിൽ: `const db = getFirestore(app, 'default');`
   - Standard `(default)` DB ആണെങ്കിൽ: `const db = getFirestore(app);`
3. **`firebase.json`:**
   - `firestore.database`: Named DB ആണെങ്കിൽ `"default"`, Standard ആണെങ്കിൽ `"(default)"`.
   - `firestore.rules`: `"firestore.rules"`, `storage.rules`: `"storage.rules"`, `functions[0].source`: `"functions"`.
4. **`.firebaserc` & `.github/workflows/firebase-deploy.yml`:**
   - പ്രൊജക്റ്റ് ID (`test-noorulislam` -> പുതിയ പ്രൊജക്റ്റ് ID) അപ്‌ഡേറ്റ് ചെയ്യുക.
5. **`firebase-applet-config.json`:** പുതിയ പ്രൊജക്റ്റ് വിവരങ്ങൾ അപ്‌ഡേറ്റ് ചെയ്യുക.
6. **`storage.rules`:** `isCompanyOwner()` ഫംഗ്ഷനിലെ fallback ഇമെയിൽ ആവശ്യമുണ്ടെങ്കിൽ പുതിയ പ്രൊജക്റ്റ് ഉടമയുടെ ഇമെയിലിലേക്ക് മാറ്റുക (ഡൈനാമിക് `companyOwner == true` ക്ലെയിം എല്ലാ `company/config` ഓണർമാർക്കും സ്വയം പ്രവർത്തിക്കും).
7. **`sw.js`:** PWA ക്യാഷ് പുതുക്കാൻ `CACHE_NAME` നമ്പർ ഉയർത്തുക.

---

## 5. Phase 3: Cloud Functions (Gen 2, Node.js 22) & GitHub Actions Auto-Deploy

നമ്മുടെ പ്രൊജക്റ്റിൽ 6 Cloud Functions (`asia-south1`, Node.js 22) ആണ് ഉള്ളത്:
1. `verifyLoginIdentifier` — Step-1 കസ്റ്റം യൂസർനെയിം പരിശോധന (Public)
2. `loginWithCustomUsername` — Step-2 scrypt പാസ്‌വേഡ് പരിശോധന + Brute-force ലോക്കൗട്ട് + Firebase Custom Auth Token (Public)
3. `upsertInstitutionSuperAdminCredential` — Super Admin യൂസർനെയിം/പാസ്‌വേഡ് സൃഷ്ടിക്കലും മാറ്റലും (Company Owner only)
4. `manageStaffCredential` — Staff യൂസർനെയിം/പാസ്‌വേഡ്/സ്റ്റാറ്റസ്/ഡിലീറ്റ് (Admin / Staff Manager / Company Owner)
5. `changeOwnPassword` — ലോഗിൻ ചെയ്ത Super Admin / Staff-ന് സ്വന്തം പാസ്‌വേഡ് മാറ്റൽ (Self-service)
6. `syncCompanyOwnerClaims` — `company/config` പ്രകാരം വെരിഫൈഡ് Company Owner-ക്ക് `companyOwner: true` JWT ക്ലെയിം നൽകൽ (Company Owner only)

### GitHub Actions ഓട്ടോ-ഡിപ്ലോയ് സെറ്റപ്പ് (ഒരിക്കൽ മാത്രം):
1. **Firebase Service Account JSON:** Firebase Console -> **Project settings -> Service accounts -> Generate new private key** വഴി JSON ഡൗൺലോഡ് ചെയ്യുക *(ഈ ഫയൽ ഒരിക്കലും GitHub കോഡിൽ കമ്മിറ്റ് ചെയ്യരുത്!)*.
2. **Google Cloud IAM Permissions:** `https://console.cloud.google.com/iam-admin/iam?project=<PROJECT_ID>` തുറന്ന് `firebase-adminsdk-...` അക്കൗണ്ടിന് താഴെ പറയുന്ന റോളുകൾ നൽകുക:
   - `Firebase Admin`
   - `Service Usage Admin`
   - `Cloud Functions Developer`
   - `Service Account User`
   - `Artifact Registry Writer`
   - `Service Account Token Creator` *(Custom Auth Token സൈനിംഗിന്)*
   - `Firebase Authentication Admin` & `Storage Admin`
3. **GitHub Repository Secret:** GitHub Repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**:
   - **Name:** `FIREBASE_SERVICE_ACCOUNT`
   - **Secret:** ഡൗൺലോഡ് ചെയ്ത JSON ഫയലിന്റെ മുഴുവൻ ഉള്ളടക്കം.
4. **Auto-Deploy:** ഇനി മുതൽ `functions/**`, `firestore.rules`, `storage.rules`, `firebase.json` എന്നിവയിൽ മാറ്റം വരുത്തി `main` ബ്രാഞ്ചിലേക്ക് പുഷ് ചെയ്യുമ്പോഴെല്ലാം `.github/workflows/firebase-deploy.yml` സ്വയം എല്ലാം Firebase-ലേക്ക് ഡിപ്ലോയ് ചെയ്യും (അല്ലെങ്കിൽ **Actions -> Run workflow** വഴി മാനുവലായും റൺ ചെയ്യാം).

---

## 6. Phase 4: Firebase Storage (Smart WebP Media Architecture)

എല്ലാ ഇമേജ് അപ്‌ലോഡുകളും Base64-ന് പകരം **Firebase Storage** വഴിയാണ് പ്രവർത്തിക്കുന്നത് (`scripts/shared/storage-media-service.js`):
- **കംപ്രഷൻ & സൈസ് പരിധികൾ (Smart WebP + Automatic JPEG Fallback):**
  - **Profile / ID Card Photos & Institution Logo:** പരമാവധി **150 KB** (`storage.rules` പരിധി: 250 KB)
  - **Gallery, Notices, Academic Plan Attachments, Platform Showcases:** പരമാവധി **500 KB** (`storage.rules` പരിധി: 600 KB)
- **പഴയ ഫയൽ ഓട്ടോ-ഡിലീറ്റ്:** ഫോട്ടോ മാറ്റുകയോ റെക്കോർഡ് ഡിലീറ്റ് ചെയ്യുകയോ ചെയ്യുമ്പോൾ പഴയ Storage ഫയൽ സ്വയം ഡിലീറ്റ് ആകും (`deleteStorageUrlIfManaged`).
- **പഴയ Base64 പിന്തുണ:** മുമ്പ് സേവ് ചെയ്ത Base64 ഫോട്ടോകൾ ഉണ്ടെങ്കിൽ അവ തകരാറില്ലാതെ തുടർന്നും ദൃശ്യമാകും.
- **Storage പാതകൾ (`storage.rules`):**
  - `company/showcases/**` — Read: Public | Write/Delete: Company Owner only
  - `institutions/{id}/public/directory/**` — Read: Public | Write: Signed-in (max 250KB) | Delete: Institution Member / Company Owner
  - `institutions/{id}/public/**` — Read: Public | Write/Delete: Institution Member / Company Owner (max 600KB)
  - `institutions/{id}/staff/**` & `students/photos/**` — Read: Public | Write/Delete: Institution Member / Company Owner (max 250KB)
  - `institutions/{id}/students/submissions/**` — Read: Public | Write: Signed-in (max 250KB) | Delete: Institution Member / Company Owner
  - `institutions/{id}/academic/**` — Read: Public | Write/Delete: Institution Member / Company Owner (max 600KB)
- **CSP ഹെഡറുകൾ:** `vercel.json`-ലും എല്ലാ ആക്ടീവ് HTML പേജുകളിലും `connect-src`-ൽ `https://*.firebasestorage.app` ഉൾപ്പെടുത്തിയിട്ടുണ്ട്.

---

## 7. Phase 5: Backup & Restore (പുതിയ Custom Auth നിയമം)

1. **Backup Export:** Admin Panel -> **Security Settings -> Institutional Backup & Recovery Center** -> **Export Backup**.
2. **Backup Restore:** പുതിയ പ്രൊജക്റ്റിൽ Super Admin ആയി ലോഗിൻ ചെയ്ത് JSON ഫയൽ അപ്‌ലോഡ് ചെയ്ത് **Restore** ചെയ്യുക (`studentAuthLookup` ഓട്ടോമാറ്റിക്കായി സിങ്ക് ആകും).
3. **വളരെ പ്രധാനം (Credentials Restore):**
   - സുരക്ഷയ്ക്കായി `authCredentials` (scrypt password hashes) ക്ലയന്റ് JSON Backup-ൽ ഉൾപ്പെടുത്തില്ല.
   - അതിനാൽ Restore-ന് ശേഷം, പോർട്ടൽ ആക്സസ് ഉള്ള ഓരോ Staff-ന്റെയും **Admin Panel -> Staff Management**-ൽ പോയി Username + Password ഒന്നുകൂടി **Save** ചെയ്യുക (അപ്പോൾ `manageStaffCredential` Cloud Function വഴി പുതിയ `authCredentials` സൃഷ്ടിക്കപ്പെടും).

---

## 8. Phase 6: Troubleshooting (പതിവായി വരുന്ന പ്രശ്നങ്ങളും പരിഹാരങ്ങളും)

| പ്രശ്നം (Symptom) | കാരണം (Root Cause) | പരിഹാരം (Fix) |
| :--- | :--- | :--- |
| **Company Owner ലോഗിനിൽ `Account is not authorized as a Company Console Owner`** | Firestore-ലെ `company/config` ഡോക്യുമെന്റ് ഇല്ല, അല്ലെങ്കിൽ തെറ്റായ DB (`(default)` vs `default`) ആണ്, അല്ലെങ്കിൽ `email` ഫീൽഡ് `string` അല്ലാതെ `map` ആയിപ്പോയി. | `default` DB-യിൽ `company/config` Root-ൽ `email` (`string`) കൃത്യമായി Authentication-ലെ അതേ ചെറിയക്ഷര ഇമെയിൽ നൽകുക. |
| **Platform Screenshots Storage-ൽ അപ്‌ലോഡ് ചെയ്യുമ്പോൾ `permission-denied`** | പുതിയ `syncCompanyOwnerClaims` ഫംഗ്ഷനും പുതിയ `storage.rules`-ഉം ഡിപ്ലോയ് ചെയ്തിട്ടില്ല, അല്ലെങ്കിൽ പേജ് ഒരിക്കൽ റീലോഡ് ചെയ്യണം. | GitHub Actions പച്ച ടിക്ക് (✔) ഉറപ്പാക്കി `/company` പേജ് ഒരിക്കൽ റിഫ്രഷ് ചെയ്യുക (`companyOwner: true` ക്ലെയിം ഓട്ടോ-സിങ്ക് ആകും). |
| **Super Admin / Staff ലോഗിനിൽ `iam.serviceAccounts.signBlob` അല്ലെങ്കിൽ `internal` എറർ** | Cloud Functions Gen 2 പ്രവർത്തിക്കുന്ന Compute Engine Default Service Account-ന് Custom Token സൈൻ ചെയ്യാനുള്ള IAM റോൾ ഇല്ല. | Google Cloud IAM-ൽ `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` അക്കൗണ്ടിന് **`Service Account Token Creator`** റോൾ നൽകുക. |
| **GitHub Actions-ൽ `HTTP Error: 403 Permission denied to get service`** | `firebase-adminsdk` Service Account-ന് IAM റോളുകൾ കുറവാണ്. | Phase 3-ൽ പറഞ്ഞ 6+ IAM റോളുകൾ ചേർത്ത് 2 മിനിറ്റ് കഴിഞ്ഞ് workflow **Re-run** ചെയ്യുക. |
| **GitHub Actions-ൽ `Runtime Node.js XX was decommissioned`** | `functions/package.json`-ലെ Node.js വേർഷൻ പഴയതാണ്. | `functions/package.json`-ലെ `engines.node`-ഉം `.github/workflows/firebase-deploy.yml`-ലെ `node-version`-ഉം പുതിയ LTS (ഉദാ: `22`) ആക്കി അപ്‌ഡേറ്റ് ചെയ്യുക. |
| **Student Portal ലോഗിനിൽ `Missing or insufficient permissions`** | Firebase Authentication-ൽ **Anonymous** sign-in provider Enable ചെയ്തിട്ടില്ല, അല്ലെങ്കിൽ `firestore.rules` ഡിപ്ലോയ് ചെയ്തിട്ടില്ല. | Authentication -> Sign-in method-ൽ **Anonymous** Enable ചെയ്യുക. |
| **Vercel / Live ഡൊമെയ്നിൽ `auth/unauthorized-domain`** | ലൈവ് ഡൊമെയ്ൻ Authorized domains ലിസ്റ്റിൽ ഇല്ല. | Firebase Console -> Authentication -> Settings -> Authorized domains-ൽ ഡൊമെയ്ൻ ചേർക്കുക. |
| **പുതിയ മാറ്റങ്ങൾ ബ്രൗസറിൽ വരുന്നില്ല** | PWA Service Worker പഴയ ഫയലുകൾ ക്യാഷ് ചെയ്തിരിക്കുന്നു. | `sw.js`-ൽ `CACHE_NAME` ഉയർത്തുക, ബ്രൗസർ Hard Refresh (`Ctrl+Shift+R`) ചെയ്യുക. |
