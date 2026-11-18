# Firebase Account & Project Migration Guide (Malayalam + English)

ഒരു പുതിയ **Firebase Account / Project**-ലേക്ക് (അല്ലെങ്കിൽ പുതിയൊരു Firestore Database-ലേക്ക്) ഈ ആപ്ലിക്കേഷൻ മാറ്റുമ്പോൾ **Codebase**-ലും **Firebase Console**-ലും ചെയ്യേണ്ട എല്ലാ കാര്യങ്ങളുടെയും സമ്പൂർണ്ണ ഗൈഡ് ആണിത്.

> **പ്രധാന മുന്നറിയിപ്പ് (Critical Note for First-Time Setup):**
> Firestore-ൽ `/institutions/school/settings/adminAuth` എന്ന ഡോക്യുമെന്റിൽ `email: "your-admin@gmail.com"` എന്ന് മാത്രം നൽകിയാൽ **Admin Login പ്രവർത്തിക്കില്ല**. അതിനോടൊപ്പം താഴെ പറയുന്ന 4 കാര്യങ്ങൾ കൂടി നിർബന്ധമായും ചെയ്തിരിക്കണം:
> 1. **Firebase Console -> Authentication -> Sign-in method**-ൽ **Email/Password**, **Anonymous** എന്നിവ Enable ചെയ്യണം.
> 2. **Firebase Console -> Authentication -> Users**-ൽ അതേ ഇമെയിലും പാസ്‌വേഡും ഉപയോഗിച്ച് ഒരു User Account (**Add user**) നിർമ്മിക്കണം.
> 3. **Firestore Database -> Rules**-ൽ ഈ പ്രോജക്റ്റിലെ `firestore.rules` പേസ്റ്റ് ചെയ്ത് **Publish** ചെയ്യണം (`storage.rules`-ഉം Storage-ൽ Publish ചെയ്യണം).
> 4. **Authentication -> Settings -> Authorized domains**-ൽ നിങ്ങളുടെ ഡൊമെയ്നുകൾ (`localhost`, Vercel domain മുതലായവ) ചേർക്കണം.

---

## Quick Master Checklist (ഒറ്റനോട്ടത്തിൽ)

- [ ] **Step 1:** പുതിയ Firebase പ്രോജക്റ്റ് നിർമ്മിച്ച് Web App (`</>`) രജിസ്റ്റർ ചെയ്യുക, `firebaseConfig` കോപ്പി ചെയ്യുക.
- [ ] **Step 2:** **Authentication**-ൽ **Email/Password** ഉം **Anonymous** ഉം Enable ചെയ്യുക.
- [ ] **Step 3:** **Firestore Database** നിർമ്മിക്കുക (`(default)` അല്ലെങ്കിൽ Custom Named DB).
- [ ] **Step 4:** **Cloud Storage** Enable ചെയ്യുക (ഫോട്ടോ/ഫയൽ അപ്‌ലോഡിന്).
- [ ] **Step 5:** **Authorized domains**-ൽ `localhost`, live Vercel/Custom domain എന്നിവ ചേർക്കുക.
- [ ] **Step 6:** കോഡ്ബേസിലെ `config/firebase-config.js`, `firebase-applet-config.json`, `.firebaserc`, `sw.js` എന്നിവ അപ്‌ഡേറ്റ് ചെയ്യുക.
- [ ] **Step 7:** `firestore.rules`, `storage.rules` എന്നിവ Firebase Console-ൽ പേസ്റ്റ് ചെയ്ത് **Publish** ചെയ്യുക.
- [ ] **Step 8:** **Authentication -> Users**-ൽ Company Owner ഇമെയിൽ + പാസ്‌വേഡ് Add ചെയ്യുക.
- [ ] **Step 9:** Firestore-ൽ `company/config` ഡോക്യുമെന്റ് നിർമ്മിക്കുക (`email`, `companyName`, `ownersIndex`, `owners`). തുടർന്ന് `/` വഴി ലോഗിൻ ചെയ്ത് `/company` പേജിൽ നിന്ന് സ്ഥാപനങ്ങൾ Add ചെയ്യുക (`institutions/{slug}/settings/adminAuth` ഓട്ടോമാറ്റിക്കായി സൃഷ്ടിക്കപ്പെടും).
- [ ] **Step 10:** (പഴയ ഡാറ്റ വേണമെങ്കിൽ) Admin Panel-ൽ Backup Restore ചെയ്യുക + Staff Management-ൽ ഓരോ Staff-ന്റെയും Credentials വീണ്ടും Save ചെയ്യുക.
- [ ] **Step 11:** `npm run lint`, `npm run build` റൺ ചെയ്ത് GitHub / Vercel വഴി Publish ചെയ്യുക.

---

## Phase 1: പുതിയ Firebase Console-ൽ ചെയ്യേണ്ടവ (New Firebase Project Setup)

1. **[Firebase Console](https://console.firebase.google.com/)** തുറന്ന് പുതിയ പ്രോജക്റ്റ് തിരഞ്ഞെടുക്കുക അല്ലെങ്കിൽ **Add project** വഴി നിർമ്മിക്കുക.
2. **Web App Register ചെയ്യുക:**
   - **Project Settings (⚙️) -> General -> Your apps -> Add app -> Web (`</>`)** ക്ലിക്ക് ചെയ്യുക.
   - ലഭിക്കുന്ന `firebaseConfig` ഒബ്ജക്റ്റ് (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`) സൂക്ഷിക്കുക.
3. **Authentication Providers Enable ചെയ്യുക (`Build -> Authentication -> Sign-in method`):**
   - **Email/Password**: **Enable** ചെയ്യുക *(Super Admin, Staff ലോഗിനുകൾക്ക് നിർബന്ധം)*.
   - **Anonymous**: **Enable** ചെയ്യുക *(Public Landing Page-ലെ പ്രീ-ലോഗിൻ പരിശോധനകൾക്കും Student Portal റീഡുകൾക്കും നിർബന്ധം; ഇത് ഇല്ലെങ്കിൽ Student Login പ്രവർത്തിക്കില്ല)*.
4. **Cloud Firestore നിർമ്മിക്കുക (`Build -> Firestore Database -> Create database`):**
   - അനുയോജ്യമായ Region തിരഞ്ഞെടുക്കുക (ഉദാ: `asia-south1` Mumbai).
   - **Production mode**-ൽ Create ചെയ്യുക *(ഒരിക്കലും Test Mode-ൽ ദീർഘകാലം തുറന്നിടരുത്)*.
   - **ശ്രദ്ധിക്കുക (`(default)` vs Named Database):**
     - സാധാരണ പുതിയ പ്രോജക്റ്റുകളിൽ `(default)` ഡാറ്റാബേസ് ആണ് ഉണ്ടാവുക.
     - നിങ്ങൾ പ്രത്യേകം പേരിട്ടൊരു Database (ഉദാ: `ai-studio-...`) ആണ് ഉപയോഗിക്കുന്നതെങ്കിൽ ആ Database ID പ്രത്യേകം കുറിച്ചുവയ്ക്കുക.
5. **Cloud Storage Enable ചെയ്യുക (`Build -> Storage -> Get started`):**
   - സ്ഥാപനത്തിന്റെ ലോഗോ, സ്റ്റാഫ്/സ്റ്റുഡന്റ് ഫോട്ടോകൾ എന്നിവ അപ്‌ലോഡ് ചെയ്യാൻ Storage ആവശ്യമാണ്.
6. **Authorized Domains ചേർക്കുക (`Build -> Authentication -> Settings -> Authorized domains`):**
   - `localhost` (ലോക്കൽ ടെസ്റ്റിംഗിന്).
   - നിങ്ങളുടെ പ്രൊഡക്ഷൻ ഡൊമെയ്ൻ (ഉദാ: `your-app.vercel.app`, കസ്റ്റം ഡൊമെയ്നുകൾ).

---

## Phase 2: കോഡ്ബേസിൽ മാറ്റം വരുത്തേണ്ട ഫയലുകൾ (Codebase Changes)

നമ്മുടെ ആപ്ലിക്കേഷനിലെ എല്ലാ പേജുകളും ഒറ്റ കേന്ദ്രീകൃത ഫയലിൽ നിന്നാണ് Firebase കണക്ഷൻ എടുക്കുന്നത്. താഴെ പറയുന്ന ഫയലുകൾ മാത്രം അപ്‌ഡേറ്റ് ചെയ്താൽ മതി:

### 1. `config/firebase-config.js`
- `const firebaseConfig = { ... };` എന്ന ഭാഗത്ത് പുതിയ പ്രോജക്റ്റിന്റെ `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId` (optional) എന്നിവ നൽകുക.
- **Database ID ക്രമീകരണം:**
  - **Standard `(default)` database ആണെങ്കിൽ:** `firestoreDatabaseId` പ്രോപ്പർട്ടി ഒഴിവാക്കുക.
  - **Custom Named database ആണെങ്കിൽ:** `firestoreDatabaseId: "YOUR_DATABASE_ID"` ചേർക്കുക.
- `initializeFirestore` ഇനിപ്പറയുന്ന രീതിയിൽ സുരക്ഷിതമായി നിലനിർത്തുക (അപ്പോൾ `(default)` ആയാലും Named DB ആയാലും പിശകില്ലാതെ പ്രവർത്തിക്കും):
  ```js
  const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? initializeFirestore(app, { experimentalForceLongPolling: true }, firebaseConfig.firestoreDatabaseId)
    : initializeFirestore(app, { experimentalForceLongPolling: true });
  ```

### 2. `firebase-applet-config.json`
പുതിയ പ്രോജക്റ്റിന്റെ വിവരങ്ങൾ നൽകുക:
- `projectId`, `appId`, `apiKey`, `authDomain`, `storageBucket`, `messagingSenderId`, `measurementId` എന്നിവ അപ്‌ഡേറ്റ് ചെയ്യുക.
- `firestoreDatabaseId`: Standard ആണെങ്കിൽ `"(default)"`, Named DB ആണെങ്കിൽ അതിന്റെ ID നൽകുക.
- `oAuthClientId`: പഴയ പ്രോജക്റ്റിലെ client ID ഉണ്ടെങ്കിൽ അത് നീക്കം ചെയ്ത് `""` ആക്കുക *(തെറ്റായ പ്രോജക്റ്റ് ID conflict ഒഴിവാക്കാൻ)*.

### 3. `.firebaserc`
Firebase CLI (`firebase deploy`) ഉപയോഗിക്കുമ്പോൾ ശരിയായ പ്രോജക്റ്റ് തിരഞ്ഞെടുക്കാൻ `projects.default` മാറ്റുക:
```json
{
  "projects": {
    "default": "your-new-project-id"
  }
}
```

### 4. `sw.js` (PWA Service Worker Cache Refresh)
- ബ്രൗസറിലും ഇൻസ്റ്റാൾ ചെയ്ത PWA ആപ്പിലും പഴയ Firebase കോൺഫിഗ് ക്യാഷ് ചെയ്ത് കുടുങ്ങാതിരിക്കാൻ `sw.js`-ന്റെ ഒന്നാമത്തെ വരിയിലെ `CACHE_NAME` നമ്പർ വർദ്ധിപ്പിക്കുക (ഉദാ: `institution-tracer-v3-05-01` -> `institution-tracer-v3-05-02`).

### 5. `config/app-config.js` *(Optional - സാധാരണ മാറ്റേണ്ടതില്ല)*
- ഡിഫോൾട്ട് പാത `institutions/school/...` തന്നെയാണെങ്കിൽ `INSTITUTION_ID = 'school'` മാറ്റേണ്ടതില്ല. മറ്റൊരു സ്ഥാപന നാമത്തിൽ വേറിട്ട പാത വേണമെങ്കിൽ മാത്രം മാറ്റുക.

> **ഓട്ടോമാറ്റിക് സെഷൻ ക്ലിയറിംഗ് (`session-guard.js`):**
> `config/firebase-config.js`-ലെ `projectId` മാറുമ്പോൾ `window.AppSession.syncFirebaseProject(firebaseConfig.projectId)` സ്വയമേവ പ്രവർത്തിച്ച് പഴയ പ്രോജക്റ്റിലെ Admin, Staff, Student സെഷനുകൾ ബ്രൗസറിൽ നിന്ന് ക്ലിയർ ചെയ്യും.

---

## Phase 3: Security Rules പബ്ലിഷ് ചെയ്യൽ (Mandatory)

1. **Firestore Security Rules:**
   - ഈ പ്രൊജക്റ്റിലെ `firestore.rules` ഫയലിന്റെ മുഴുവൻ ഉള്ളടക്കവും കോപ്പി ചെയ്യുക.
   - പുതിയ Firebase Console -> **Firestore Database -> Rules** തുറക്കുക *(Named DB ആണെങ്കിൽ മുകളിൽ ശരിയായ DB തിരഞ്ഞെടുത്തിട്ടുണ്ടെന്ന് ഉറപ്പുവരുത്തുക; Standard ആണെങ്കിൽ `(default)`)*.
   - പഴയ default rules മാറ്റി `firestore.rules` മുഴുവൻ പേസ്റ്റ് ചെയ്ത് **Publish** ക്ലിക്ക് ചെയ്യുക.
2. **Storage Security Rules:**
   - ഈ പ്രൊജക്റ്റിലെ `storage.rules` ഫയലിന്റെ മുഴുവൻ ഉള്ളടക്കവും കോപ്പി ചെയ്യുക.
   - Firebase Console -> **Storage -> Rules**-ൽ പേസ്റ്റ് ചെയ്ത് **Publish** ക്ലിക്ക് ചെയ്യുക.

---

## Phase 4: ആദ്യ Company Owner Bootstrap ചെയ്യേണ്ട വിധം

### ഘട്ടം A: Firebase Authentication-ൽ Company Owner User നിർമ്മിക്കുക
1. Firebase Console -> **Build -> Authentication -> Users** തുറക്കുക.
2. **Add user** ക്ലിക്ക് ചെയ്യുക.
3. നിങ്ങളുടെ Company Owner Email-ഉം (ഉദാ: `nimdevathiyal4883@gmail.com` — **ചെറിയക്ഷരത്തിൽ / lowercase**) ശക്തമായ ഒരു Password-ഉം നൽകി Save ചെയ്യുക.

### ഘട്ടം B: Firestore-ൽ `company/config` ഡോക്യുമെന്റ് നിർമ്മിക്കുക
1. Firebase Console -> **Build -> Firestore Database -> Data** തുറക്കുക.
2. കൃത്യമായ ഈ പാതയിൽ ഡോക്യുമെന്റ് നിർമ്മിക്കുക:
   - Collection: `company`
   - Document ID: `config`
   - പൂർണ്ണമായ പാത: **`company/config`** *(ഓരോ സ്ഥാപനത്തിന്റെയും `institutions/{slug}/settings/adminAuth` ഫയലുകൾ പിന്നീട് `/company` പേജിൽ നിന്ന് സ്ഥാപനം Add ചെയ്യുമ്പോൾ ആപ്പ് സ്വയമേവ സൃഷ്ടിക്കും)*.
3. ഡോക്യുമെന്റിൽ താഴെ കാണുന്ന ഘടനയിൽ ഫീൽഡുകൾ ചേർക്കുക:

#### Firebase Console Panel View-ൽ ശരിയായ ഘടനയും സാധാരണ വരുന്ന തെറ്റും:

```text
✅ ശരിയായ ഘടന (Document Root-ൽ 4 ഫീൽഡുകൾ):        ❌ തെറ്റായ ഘടന (ഇങ്ങനെ ചെയ്താൽ Login ആകില്ല!):
company/config                                         company/config
├── companyName (string) : "Noorul Islam Platform"     └── email (map)  <-- email ഒരു map ആയി!
├── email (string) : "nimdevathiyal4883@gmail.com"         ├── owners (map)      <-- Root-ൽ അല്ല!
├── ownersIndex (map)                                      └── ownersIndex (map) <-- Root-ൽ അല്ല!
│   └── nimdevathiyal4883@gmail.com (boolean) : true
└── owners (array)
    └── 0 (map)
        ├── email (string)     : "nimdevathiyal4883@gmail.com"
        ├── name (string)      : "Company Owner"
        ├── role (string)      : "company_owner"
        └── isActive (boolean) : true
```

#### JSON രൂപത്തിലുള്ള റഫറൻസ്:
```json
{
  "companyName": "Noorul Islam Platform",
  "email": "nimdevathiyal4883@gmail.com",
  "ownersIndex": {
    "nimdevathiyal4883@gmail.com": true
  },
  "owners": [
    {
      "name": "Company Owner",
      "email": "nimdevathiyal4883@gmail.com",
      "role": "company_owner",
      "isActive": true
    }
  ]
}
```

### ഘട്ടം C: ആദ്യ ലോഗിൻ & സ്ഥാപനം നിർമ്മിക്കൽ
1. ആപ്ലിക്കേഷന്റെ Root Home Page (`https://domain.com/`) തുറന്ന് **Login** ക്ലിക്ക് ചെയ്യുക.
2. Step 1-ൽ Company Owner Email (ഉദാ: `nimdevathiyal4883@gmail.com`) നൽകുക.
3. Step 2-ൽ Password അടിച്ച് Sign In ചെയ്യുമ്പോൾ നേരെ **Company Master Portal (`/company`)**-ലേക്ക് പ്രവേശിക്കും.
4. അവിടെ നിന്ന് **Add Institution** വഴി പുതിയ സ്ഥാപനവും (`slug`, `plan`, `allowedPages`) അതിന്റെ Super Admin അക്കൗണ്ടും ഒറ്റ ക്ലിക്കിൽ നിർമ്മിക്കാം (`https://domain.com/<slug>`).

---

## Phase 5: പഴയ ഡാറ്റ പുതിയ പ്രോജക്റ്റിലേക്ക് മാറ്റുന്ന വിധം (Optional Backup & Restore)

പഴയ പ്രോജക്റ്റിലെ വിദ്യാർത്ഥികൾ, ഫീസ്, അറ്റൻഡൻസ്, റിസൾട്ട്, സ്റ്റാഫ് വിവരങ്ങൾ എന്നിവ പുതിയ പ്രോജക്റ്റിലേക്ക് കൊണ്ടുവരണമെങ്കിൽ:

1. **പഴയ പ്രോജക്റ്റിൽ നിന്ന് Backup എടുക്കുക:**
   - പഴയ പ്രോജക്റ്റ് കണക്ട് ചെയ്തിരിക്കുമ്പോൾ Admin Panel -> **Security Settings** -> **Institutional Backup & Recovery Center** തുറക്കുക.
   - **Select All Categories (Full System Backup & Recovery)** തിരഞ്ഞെടുത്ത് **Export Backup (Selected / Full)** ക്ലിക്ക് ചെയ്ത് JSON ഫയൽ ഡൗൺലോഡ് ചെയ്യുക.
2. **പുതിയ പ്രോജക്റ്റിലേക്ക് Restore ചെയ്യുക:**
   - പുതിയ പ്രോജക്റ്റിൽ Super Admin ആയി ലോഗിൻ ചെയ്യുക.
   - Admin Panel -> **Security Settings** -> **Institutional Backup & Recovery Center** -> **Upload & Restore Backup File** വഴി JSON ഫയൽ അപ്‌ലോഡ് ചെയ്യുക.
   - Preview പരിശോധിച്ച ശേഷം **Restore All Categories (Full Snapshot)** ക്ലിക്ക് ചെയ്യുക *(ഈ ഘട്ടത്തിൽ Student Portal ലോഗിനു വേണ്ട `studentAuthLookup` ഇൻഡക്സ് ആപ്പ് സ്വയമേവ സിങ്ക് ചെയ്യും)*.
3. **പഴയ Plaintext പാസ്‌വേഡുകൾ നീക്കം ചെയ്യുക:**
   - Admin Panel -> Security Settings-ലെ **Clean Legacy Passwords** ബട്ടൺ ക്ലിക്ക് ചെയ്ത് പഴയ plaintext `password` ഫീൽഡുകൾ വൃത്തിയാക്കുക.
4. **Staff Authentication അക്കൗണ്ടുകൾ പുനർനിർമ്മിക്കുക (CRITICAL!):**
   - **JSON Restore വഴി Firestore-ലെ `staff`, `staffAccess` ഡോക്യുമെന്റുകൾ മാത്രമേ വരുകയുള്ളൂ; Firebase Authentication-ലെ Staff യൂസർ അക്കൗണ്ടുകൾ പുതിയ പ്രോജക്റ്റിലേക്ക് പകർന്നു വരില്ല.**
   - അതിനാൽ **Admin Panel -> Staff Management**-ൽ പോയി, പോർട്ടൽ ആക്സസ് ഉള്ള ഓരോ Staff-ന്റെയും Credentials തുറന്ന് അവരുടെ Username/Email + Password ഒന്നുകൂടി **Save** ചെയ്യുക. അപ്പോൾ മാത്രമേ പുതിയ പ്രോജക്റ്റിലെ Firebase Authentication-ൽ അവരുടെ അക്കൗണ്ട് സൃഷ്ടിക്കപ്പെടുകയുള്ളൂ.

---

## Phase 6: Final Verification & Deployment Checklist

കോഡ് മാറ്റങ്ങൾക്ക് ശേഷം GitHub / Vercel വഴി ലൈവ് ആക്കുന്നതിന് മുമ്പ് ഇവ ഉറപ്പുവരുത്തുക:

1. പ്രൊജക്റ്റിൽ `npm run lint` ഉം `npm run build` ഉം error ഇല്ലാതെ വിജയിക്കുന്നുണ്ടെന്ന് പരിശോധിക്കുക.
2. GitHub-ലേക്ക് Push ചെയ്ത ശേഷം Vercel-ൽ `dist` ബിൽഡ് വിജയിച്ചെന്ന് ഉറപ്പാക്കുക (`vercel.json` ഇതിനകം `vite`, `cleanUrls`, `headers` എന്നിവ സജ്ജീകരിച്ചിട്ടുണ്ട്).
3. Live സൈറ്റിൽ താഴെ പറയുന്നവ ടെസ്റ്റ് ചെയ്യുക:
   - Super Admin ലോഗിൻ (`official.html` / `admin.html`).
   - ഒരു Staff ലോഗിൻ (`attendance.html` / `collection.html` / `result.html`).
   - ഒരു Student Portal ലോഗിൻ (`student.html`).
   - ലോഗിൻ ചെയ്യാതെ `institutions/school/settings/adminAuth` റീഡ് ചെയ്യാൻ ശ്രമിച്ചാൽ `PERMISSION_DENIED` ലഭിക്കുന്നുണ്ടെന്ന് ഉറപ്പുവരുത്തുക.

---

## Phase 7: Troubleshooting (പതിവായി വരുന്ന പ്രശ്നങ്ങളും പരിഹാരങ്ങളും)

| പ്രശ്നം (Symptom) | കാരണം (Root Cause) | പരിഹാരം (Fix) |
| :--- | :--- | :--- |
| **Username verify ആകുന്നു, പക്ഷേ Password അടിക്കുമ്പോൾ `Incorrect credentials or account not active.` കാണിക്കുന്നു** | 1) Firestore-ൽ `adminAuth`-ലെ `email` ഒരു `string`-ന് പകരം **`map`** ആയി പോവുകയും `adminsIndex`/`admins` അതിനുള്ളിൽ nested ആവുകയും ചെയ്തു.<br>2) അല്ലെങ്കിൽ **Authentication -> Users**-ൽ അക്കൗണ്ടില്ല / Password തെറ്റാണ് / Email/Password enable അല്ല. | `adminAuth`-ൽ `email` (`string`), `adminsIndex` (`map` -> `email: true` `boolean`), `admins` (`array`) എന്നിവ **Document Root-ൽ** കൃത്യമായ ടൈപ്പിൽ നൽകുക; Authentication -> Users-ലെ ഇമെയിലും പാസ്‌വേഡും ഉറപ്പുവരുത്തുക. |
| **`Missing or insufficient permissions` (Admin/Staff/Student ലോഗിനിൽ)** | 1) പുതിയ പ്രോജക്റ്റിൽ `firestore.rules` Publish ചെയ്തിട്ടില്ല.<br>2) Student ലോഗിനിന് **Anonymous Auth** Enable ചെയ്തിട്ടില്ല.<br>3) `adminAuth`-ലെ `email` string അല്ലെങ്കിൽ `adminsIndex` Root-ൽ ഇല്ല. | `firestore.rules` Publish ചെയ്യുക; Anonymous Auth Enable ചെയ്യുക; `adminAuth`-ൽ Root-ൽ `email` (`string`) + `adminsIndex` (`map`) ശരിയായി നൽകുക. |
| **`Failed to get document because the client is offline` അല്ലെങ്കിൽ ഡാറ്റ കാണുന്നില്ല** | പുതിയ പ്രോജക്റ്റിൽ `(default)` DB ആണുള്ളത്, പക്ഷേ `firebase-config.js`-ൽ പഴയ Named `firestoreDatabaseId` കിടക്കുന്നു (അല്ലെങ്കിൽ തിരിച്ചും). | `(default)` DB ആണെങ്കിൽ `config/firebase-config.js`-ൽ നിന്ന് `firestoreDatabaseId` ഒഴിവാക്കുക, `firebase-applet-config.json`-ൽ `"(default)"` നൽകുക. |
| **Backup Restore ചെയ്ത ശേഷം Staff-ന് ലോഗിൻ ചെയ്യാൻ കഴിയുന്നില്ല** | JSON Backup വഴി Firestore രേഖകൾ മാത്രം തിരികെ വന്നു; പുതിയ Firebase Authentication-ൽ Staff യൂസർമാർ സൃഷ്ടിക്കപ്പെട്ടിട്ടില്ല. | Admin Panel -> **Staff Management**-ൽ ഓരോ Staff-ന്റെയും Credentials വീണ്ടും Save ചെയ്യുക. |
| **പുതിയ പ്രോജക്റ്റിലേക്ക് മാറിയിട്ടും പഴയ പ്രോജക്റ്റിലെ പേര്/സെഷൻ കാണിക്കുന്നു** | ബ്രൗസർ അല്ലെങ്കിൽ PWA Service Worker പഴയ ഫയലുകൾ ക്യാഷ് ചെയ്തിരിക്കുന്നു. | `sw.js`-ൽ `CACHE_NAME` ഉയർത്തുക, ബ്രൗസർ Hard Refresh (`Ctrl+Shift+R`) / Site Data Clear ചെയ്യുക. |
| **Vercel / Live ഡൊമെയ്നിൽ Auth പിശക് (`auth/unauthorized-domain`)** | ലൈവ് ഡൊമെയ്ൻ പുതിയ Firebase പ്രോജക്റ്റിലെ Authorized domains ലിസ്റ്റിൽ ഇല്ല. | Firebase Console -> Authentication -> Settings -> Authorized domains-ൽ നിങ്ങളുടെ live domain ചേർക്കുക. |
