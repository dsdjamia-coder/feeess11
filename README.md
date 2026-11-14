# Institution Tracer (IMS) - Enterprise Educational & Financial Platform

A comprehensive, production-grade institutional web platform engineered for modern educational institutions (schools, colleges, academies, and institutes). The platform provides an all-in-one suite covering student information management, counter fee collection, academic curriculum planning, dynamic routine and exam timetabling, interactive syllabus tracking, daily session attendance, co-curricular activities, marksheet generation, dynamic classroom spreadsheets, emergency rollback runbooks, and granular administrative controls.

---

## Table of Contents

1. [System Architecture & Tech Stack](#system-architecture--tech-stack)
2. [Application Portals & Core Modules](#application-portals--core-modules)
   - [1. Public Institution Portal (`index.html`)](#1-public-institution-portal-indexhtml)
   - [2. Official Hub & Staff Gateway (`official.html`, `official-dashboard.html`)](#2-official-hub--staff-gateway-officialhtml-official-dashboardhtml)
   - [3. Super Administrative Console (`admin.html`)](#3-super-administrative-console-adminhtml)
   - [4. Academic Planning, Timetable & Syllabus Hub (`academic-plan.html`)](#4-academic-planning-timetable--syllabus-hub-academic-planhtml)
   - [5. Student Information Management System - SIMS (`student.html`)](#5-student-information-management-system---sims-studenthtml)
   - [6. Cashier & Fee Collection Counter (`collection.html`)](#6-cashier--fee-collection-counter-collectionhtml)
   - [7. Student Attendance Register (`attendance.html`)](#7-student-attendance-register-attendancehtml)
   - [8. Student Activities, Clubs & Rewards (`activity.html`)](#8-student-activities-clubs--rewards-activityhtml)
   - [9. Examination & Results Publishing Center (`result.html`)](#9-examination--results-publishing-center-resulthtml)
   - [10. Class Worksheet & Spreadsheet Engine (`worksheet.html`)](#10-class-worksheet--spreadsheet-engine-worksheethtml)
   - [11. Student & Parent Self-Service Portal (`student-fee-system.html`)](#11-student--parent-self-service-portal-student-fee-systemhtml)
3. [Super Admin Setup & Configuration Guide](#super-admin-setup--configuration-guide)
   - [Method 1: Initial Bootstrap via Firebase Console](#method-1-initial-bootstrap-via-firebase-console)
   - [Method 2: Managing Credentials in Admin Console (`admin.html`)](#method-2-managing-credentials-in-admin-console-adminhtml)
   - [Method 3: Multi-Admin Accounts Management](#method-3-multi-admin-accounts-management)
   - [Method 4: Promoting Staff via RBAC (`actLikeSuperAdmin`)](#method-4-promoting-staff-via-rbac-actlikesuperadmin)
4. [Role-Based Access Control (RBAC) & Duty Scoping](#role-based-access-control-rbac--duty-scoping)
5. [Firestore Database Schema & Document Architecture (English + Malayalam)](#firestore-database-schema--document-architecture-english--malayalam)
6. [Firebase Migration & New Database Setup Guide (English + Malayalam)](#firebase-migration--new-database-setup-guide-english--malayalam)
7. [Firebase Security Hardening, App Check & Vercel Deployment](#firebase-security-hardening-app-check--vercel-deployment)
8. [Getting Started & Local Development](#getting-started--local-development)
9. [Official Print Engine & Export Specifications](#official-print-engine--export-specifications)
10. [Emergency Rollback & Disaster Recovery Runbook](#emergency-rollback--disaster-recovery-runbook)
11. [User Acceptance Testing (UAT) Checklist](#user-acceptance-testing-uat-checklist)
12. [Bug Triage Framework & Historical Fixes](#bug-triage-framework--historical-fixes)
13. [Developer Reference & Guidelines](#developer-reference--guidelines)
14. [License & Institutional Information](#license--institutional-information)

---

## System Architecture & Tech Stack

The system is designed as a modular **Multi-Page Application (MPA)** optimized for fast load times, offline resilience, and zero-overhead performance without heavyweight client-side routing frameworks.

- **Frontend Core**: Vanilla JavaScript (ES Modules) & TypeScript Definitions.
- **Styling & Layout**: Tailwind CSS v4 (`@tailwindcss/vite`), FontAwesome 6, Google Fonts (*Plus Jakarta Sans*).
- **Build & Bundler**: Vite 8 with TypeScript type-checking (`tsc && vite build`).
- **Cloud Database**: Google Cloud Firestore (Multi-tenant path scoping with optional custom database ID support).
- **Authentication**: Firebase Authentication (Email/Password for Admin & Staff; Anonymous Auth for Student Portal sessions) + Directory Category Auth (SHA-256 hash).
- **PWA & Offline Support**: Web App Manifest (`manifest.json`), Service Worker (`sw.js`) with asset caching.
- **Document & PDF Generation**: jsPDF, jsPDF-AutoTable, and Native Publication-Grade CSS Print Engine (`@media print`).
- **Image Processing**: Client-side interactive canvas image cropper (`InteractiveCropper`) with automated downscaling.

---

## Application Portals & Core Modules

### 1. Public Institution Portal (`index.html`)
The public-facing digital gateway for parents, prospective students, and community members:
- **Hero & Institutional Statistics**: Live enrolled student tally, active faculty members, and academic milestones.
- **Notice Board & Announcements**: Real-time broadcast alerts, circulars, and exam notifications with lightbox modals.
- **Faculty & Leadership Directory**: Searchable teacher list with direct phone call and WhatsApp contact integration.
- **Managing Committee Directory**: Institutional board members with designations and profiles.
- **Campus Photo Gallery**: Responsive image gallery with full-screen lightbox preview.
- **Direct Login Gateway**: Modals for quick student lookup (by admission number and date of birth) and official staff access.
- **Privacy Hardening**: Public client-side state strips sensitive personal phone numbers and private records from unauthenticated memory.
- **PWA Install Prompt**: Native browser installation prompt integration.

---

### 2. Official Hub & Staff Gateway (`official.html`, `official-dashboard.html`)
A unified authentication and navigation terminal for all institution staff, teachers, clerks, and administrators:
- **Multi-Source Authentication**:
  1. Super Admin email/password verified strictly via **Firebase Authentication** + Firestore `settings/adminAuth`.
  2. Staff accounts verified via **Firebase Authentication** (`email` or `{username}@school.internal`) + Firestore `staffAccess` permissions.
  3. Public directory category users authenticated via SHA-256 hashed category credentials.
- **Official Lockdown System**: When active, restricts system access strictly to Super Admins. Non-admin staff attempting access are blocked with security alerts.
- **Central Navigation Dashboard (`official-dashboard.html`)**:
  - Interactive portal cards with real-time badges for Fee Collection, Students, Worksheets, Results, Attendance, Activities, Academic Planning, and System Administration.
  - User role display, assigned duty classes summary, and quick session termination.

---

### 3. Super Administrative Console (`admin.html`)
The core institutional administration suite with comprehensive management panels:
- **Institution Profile & Branding**: Configure institution name, tagline, registration code, campus address, contact phone, email, and upload high-resolution institutional logo.
- **Academic Year Management**: Create and switch active academic years (e.g., `2026-2027`), set start/end months, and choose between Gregorian and Hijri calendar systems.
- **Fee Structure Setup**: Configure standard monthly tuition fees, admission fees, examination fees, and custom fee categories per class.
- **Faculty & Staff Directory**: Manage staff records, employee IDs, contact details, photos, and assign duty classes.
- **Granular RBAC Permissions**: Toggle access per staff member for Collection, Worksheet, Student Directory, Result Center, Attendance, Academic Plan, and Activity modules.
- **Security & Credentials**: Update Super Admin login credentials, manage multiple co-administrators, and review automated audit logs.
- **System Backup & Restore**: Export full Firestore database state to JSON and restore data snapshots with dry-run diff previews.

---

### 4. Academic Planning, Timetable & Syllabus Hub (`academic-plan.html`)
A unified academic management module divided into specialized sub-tabs:

#### Tab 1: Class Subjects (`#tab-subjects`)
- Visual **Class Cards Grid**: Displays each assigned class with subject counts, assigned teachers, and weekly teaching period ratios.
- **Two-Way Result Sync Wizard**: Discovers and imports subjects configured in Examination Schemas (`resultSchemas`) into the Academic Plan with selective checkboxes.
- Add and edit subjects with full names, subject codes, assigned instructors, and weekly period targets.

#### Tab 2: Class Routine Timetable (`#tab-timetable`)
- **Dynamic Periods & Break Slots**: Configure any number of daily teaching periods (Periods 1 to 7+) and custom break/interval slots.
- **Auto-Timings Calculator**: Set start time and duration in minutes to automatically calculate sequential periods.
- **7-Day Selector with Working Days vs. Weekly Off Sync**: Select active working days (Sunday through Saturday). Unchecked days are marked as Weekly Offs and synchronize with the Attendance Register.

#### Tab 3: Academic Year Plan (`#tab-yearplan` - Annual Overview)
- **12-Month Annual Syllabus Matrix**: Months along rows (configurable academic calendar months, e.g., June to March / April to March) and subjects along columns.
- **Target Portion Indicators**: Displays lesson units, topics, and page ranges planned for each month.
- **Visual Status Badges**: Cells display real-time progress indicators: `Done` (100%), `In Progress` (X%), or `Planned`.
- **Seamless Navigation**: Clicking any cell in View Mode immediately opens the Syllabus Tracker with that class, month, and subject selected.

#### Tab 4: Syllabus Progress Tracker (`#tab-syllabus-tracker` - Daily Checklist)
- **Interactive Checklist Table**: Comprehensive checklist displaying `#`, Month, Day/Session, Subject, Lesson Title, Portions/Pages, Periods, Completion Checkbox, Progress Bar, and Teacher Remarks.
- **One-Click Real-Time Auto-Save**: Ticking the lesson checkbox immediately marks it as Completed (100%), persists to Firestore, updates summary statistics, and synchronizes with the Year Plan matrix.
- **Summary Metrics**: Live counters for Total Lessons, Completed Lessons & Percentage, Total Teaching Periods Tracked, and animated completion progress bar.
- **Add Lesson Tracker Entry Modal (`#modal-st-entry`)**: Add custom daily/session portions or monthly lesson targets.
- **Print Tracker Sheet**: Generates an official A4 Landscape verification ledger with institutional letterhead and signature blocks.

#### Tab 5: Class Exam Timetable (`#tab-exam-schedule`)
- Exam scheduling for individual classes: Exam Date, Paper/Session, Subject, Portions to Study, Exam Hall, and Invigilator.
- Integrated bottom row `+ Add Next Exam Date` action button.

#### Tab 6: Master Timetable (`#tab-master-timetable`)
- Consolidated institution-wide matrix: Classes along rows and Exam Dates along columns.
- Multi-session sub-columns per date (e.g., Paper 1 Morning, Paper 2 Afternoon).

---

### 5. Student Information Management System - SIMS (`student.html`)
Full-lifecycle student record management:
- **Student Profile**: Admission number, roll number, class, division, gender, date of birth, blood group, father/guardian name, address, contact phone numbers.
- **Sibling Relationship Linking**: Connects brothers and sisters to a shared family parent account for consolidated fee management.
- **Memory-Safe Photo Upload**: Zero-copy canvas downscaler and crop tool (`InteractiveCropper`) preventing memory allocation spikes on mobile devices.
- **Class Promotions & Transfers**: Single-click student promotion wizard between academic years, updating class, division, and status atomically.
- **Multi-Field Instant Search**: High-performance instant filtering by Name, Admission Number, UID, Father, Mother, Guardian, Phone, or Aadhaar number.

---

### 6. Cashier & Fee Collection Counter (`collection.html`)
A robust financial collection terminal built for institutional fee counters:
- **Instant Student Lookup**: Search by student name or admission number with auto-complete suggestions.
- **Interactive Fee Matrix**: Monthly fee checklist (June to March cycle) and custom fees (Admission, Books, Exam, Building Fund).
- **Sibling Group Rates**: Automatically recognizes sibling discount groups and bills proportional group rates instead of individual default fees.
- **Atomic Global Receipts**: Guarantees zero duplicate receipt numbers across multiple concurrent counters via Firestore atomic transactions (`receipt-service.js`).
- **Multi-Payment Modes**: Record payments via Cash, UPI (Google Pay, PhonePe), or Bank Transfer.
- **Receipt Printing**: Instant thermal or A4 receipt generation with institution logo, itemized breakdown, and receipt numbering.
- **Duplicate Watermark**: Reprint past receipts with a clear `DUPLICATE RECEIPT` audit watermark.
- **Master Ledger & Defaulters**: View outstanding dues per student/class and export financial ledgers to Excel/CSV.

---

### 7. Student Attendance Register (`attendance.html`)
Session-based student attendance tracking:
- **Morning & Evening Sessions**: Record attendance for morning and afternoon sessions separately.
- **Duty-Class Scoping**: Teachers only access classes assigned to them in their staff profile (Super Admin accesses all classes).
- **Attendance Statuses**: Present, Absent, Half Day, Approved Leave, and Institutional Holiday.
- **Monthly Matrix View**: Full-month calendar grid with auto-synced weekly off days from Timetable configuration.
- **Attendance Statistics**: Monthly percentage calculation, absentee alerts, and official printable attendance sheets.

---

### 8. Student Activities, Clubs & Rewards (`activity.html`)
Co-curricular student engagement tracking:
- **House System**: Group students into institutional houses (e.g., Red, Blue, Green, Yellow).
- **Events & Competitions**: Arts festivals, recitation contests, sports meets, academic exhibitions, and speech competitions.
- **Scoring & Leaderboards**: Real-time house leaderboard, star student ranking, and achievement badge awards.
- **Teacher Scoring Grid**: Class teachers input and edit student event scores with instant cloud persistence.

---

### 9. Examination & Results Publishing Center (`result.html`)
Comprehensive academic evaluation and marksheet portal:
- **Custom Examination Schemas**: Configure maximum marks, passing minimum, and grade cutoffs (A+, A, B+, B, C+, C, D, E) for each exam and class.
- **Score Recording Grid**: Subject-wise mark entry with validation against maximum limits.
- **Automated Grade Computation**: Instantly computes total marks, percentage, class rank, letter grades, and Pass/Fail status.
- **Official Publishing Toggle**: Keep results in draft mode during evaluation, then publish institution-wide with a single toggle.
- **Student Marksheet Printing**: Generates individual progress report cards and consolidated class tabulation sheets.

---

### 10. Class Worksheet & Spreadsheet Engine (`worksheet.html`)
A high-performance **mini Excel workspace** embedded in the Official Portal for classroom teachers and administrative staff. It enables rapid entry, calculation, formatting, and publication of rosters, attendance, marks, fees, and notes:

#### Key Architectural Principles
1. **Excel-like Familiarity**: Familiar ribbon interface, active cell green borders, formula bar, name box, and spreadsheet coordinate indexing (A, B, C... and 1, 2, 3...).
2. **Print-First Architecture**: Live screen-to-print parity on A4 paper with repeat headers and page-break optimization.
3. **Template-Driven Workflow**: Design custom column layouts once and reuse them across different classes or academic years.
4. **Fail-Safe Editing**: Local undo/redo history stack, auto-save state, and unsaved changes confirmation.

#### Interface Specifications
- **Ribbon Tabs**:
  - **Home Tab**: Typography styling (Font family, size +/-), Bold, Italic, Underline, Text color, Cell fill color, Text alignment, Wrap text, Insert/Delete row/column, Undo/Redo.
  - **Data Tab**: Dynamic auto-fill dropdown (Student Name, Admission No, Roll No, Gender, Guardian Name, Phone), Sort (Name A-Z/Z-A, Admission No, Roll No), and Grouping (Mixed, Boys First, Girls First, Separate Pages with forced print page breaks).
  - **Page Layout Tab**: A4 lock, Orientation (Portrait / Landscape), Margins (Normal / Narrow / Wide), Show/Repeat Official Header on all pages, and Page break view toggles.
- **Worksheet Interactions**:
  - Cell click selection with synchronized Formula Bar and Name Box ($A1, B4$).
  - Full column/row selection by clicking headers.
  - Multi-cell clipboard matrix paste from Microsoft Excel and Google Sheets ($\text{Tab} / \text{Newline}$ delimiters).
  - Manual boundary drag-resizing for both columns and rows with width persistence.
  - Fixed columns (S.No, Student Name) with customizable dynamic data columns.
- **Export Engines**:
  - **PDF Export**: Clean vector A4 print with stripped application chrome and embedded institutional letterhead.
  - **Excel Export**: True `.xlsx` binary export via SheetJS with styled header fills, cell borders, and fallback to CSV.

---

### 11. Student & Parent Self-Service Portal (`student-fee-system.html`)
Mobile-optimized portal for students and parents:
- **Sibling Switcher**: Switch between all enrolled children with a single tap on the family device.
- **Fee Ledger**: Clear breakdown of paid vs. pending months with digital receipts.
- **Published Examination Results**: View marks, grades, rankings, and downloadable report cards.
- **Direct WhatsApp Receipts**: Download official receipt copies on demand.

---

## Super Admin Setup & Configuration Guide

Setting up the Super Administrator is required to unlock full access across all modules, configure institutional parameters, and manage staff permissions.

### Method 1: Initial Bootstrap via Firebase Console
When deploying the application to a new Firebase project:

1. **Step 1: Create Admin in Firebase Authentication**
   - Open [Firebase Console](https://console.firebase.google.com).
   - Navigate to **Build > Authentication > Users**.
   - Click **Add User**.
   - Enter your administrator email (e.g., `admin@institute.com`) and a secure password (minimum 6 characters).
   - Click **Add User**.

2. **Step 2: Create Firestore `adminAuth` Document**
   - Navigate to **Build > Firestore Database** (select your configured database ID, or `(default)`).
   - Browse to your institution settings path:
     ```
     institutions/school/settings/adminAuth
     ```
     *(Note: Replace `school` if you modified `INSTITUTION_ID` in `config/app-config.js`. Never store a `password` field in Firestore — authentication is handled solely by Firebase Authentication.)*
   - Create the document `adminAuth` with the following fields:
     ```json
     {
       "email": "admin@institute.com",
       "adminsIndex": {
         "admin@institute.com": true
       },
       "admins": [
         {
           "name": "Primary Super Admin",
           "email": "admin@institute.com",
           "role": "super_admin",
           "isActive": true,
           "createdAt": "2026-01-01T00:00:00.000Z"
         }
       ]
     }
     ```
3. **Step 3: Log In**
   - Navigate to `index.html` (click **Login**) or `official.html` on your web app.
   - Enter `admin@institute.com` and your Firebase Auth password.
   - On first login to a fresh database (even before `settings/config` exists), the system verifies via **Firebase Authentication**, confirms `settings/adminAuth`, automatically initializes `settings/config.adminProfile`, and opens the Admin session.

---

### Method 2: Managing Credentials in Admin Console (`admin.html`)
Once logged in as Super Admin, you can change login credentials directly from the user interface:
1. Navigate to **`admin.html`** and click the **Security Settings** tab.
2. Locate the **Update Super Admin Credentials** card.
3. Enter:
   - **Current Password**: For re-authentication.
   - **New Email**: (Optional, if changing login email).
   - **New Password**: (Optional, minimum 6 characters).
4. Click **Update Login Credentials**.
5. The application re-authenticates with Firebase Auth, updates the credentials in Firebase Auth, and synchronizes `settings/adminAuth` and `settings/config.adminProfile` automatically (without writing any password to Firestore).

---

### Method 3: Multi-Admin Accounts Management
*(Note: By default `SINGLE_ADMIN_MODE = true` is enabled in `config/app-config.js` so only one Super Admin operates. To enable multi-admin support, set `SINGLE_ADMIN_MODE = false` in `config/app-config.js`.)*

To grant Super Admin access to multiple trusted officials without sharing a single password:
1. Open the Firestore document: `institutions/{INSTITUTION_ID}/settings/adminAuth`.
2. Add each administrator email to **both** `adminsIndex` (required by `firestore.rules`) and the `admins` array:
   ```json
   {
     "email": "admin@institute.com",
     "adminsIndex": {
       "admin@institute.com": true,
       "director@institute.com": true,
       "secretary@institute.com": true
     },
     "admins": [
       {
         "name": "Academic Director",
         "email": "director@institute.com",
         "role": "super_admin",
         "isActive": true,
         "createdAt": "2026-01-01T00:00:00.000Z"
       },
       {
         "name": "General Secretary",
         "email": "secretary@institute.com",
         "role": "super_admin",
         "isActive": true,
         "createdAt": "2026-02-01T00:00:00.000Z"
       }
     ]
   }
   ```
3. Create corresponding user accounts in **Firebase Authentication** for each email.
4. Each administrator can now log in using their personal email and password with full Super Admin access.

---

### Method 4: Promoting Staff via RBAC (`actLikeSuperAdmin`)
You can elevate any existing staff member to have complete Super Admin privileges across all pages:
1. Go to **`admin.html` > Staff Management**.
2. Select the staff member and click **Edit Staff**.
3. Under **Access Roles & Permissions**, check **Act Like Super Admin (Full Access)**.
4. Save the profile.
5. In Firestore, this sets:
   ```json
   {
     "actLikeSuperAdmin": true,
     "canAccessAdmin": true,
     "admin": true
   }
   ```
   under `institutions/{INSTITUTION_ID}/staffAccess/{staffDocId}`.
6. The staff member can now log in with their regular staff username/phone and password, and they will receive full Super Admin rights across all modules.

---

## Role-Based Access Control (RBAC) & Duty Scoping

The system employs multi-tier access guards enforced by `scripts/shared/session-guard.js`:

| Role | Target Pages | Capabilities | Scoping Rules |
| :--- | :--- | :--- | :--- |
| **Super Admin** | All Pages | Complete system control, credential management, backups, official lockdown | Unrestricted (Views all classes, subjects, finances) |
| **Class Teacher** | `academic-plan.html`, `attendance.html`, `worksheet.html`, `activity.html`, `result.html` | Record attendance, manage timetables, track syllabus, input exam scores | **Duty-Class Scoped** (Restricted strictly to assigned classes) |
| **Cashier / Clerk** | `collection.html`, `student.html` | Collect fees, generate receipts, manage student admissions, export ledgers | Scoped to financial operations |
| **Result Operator** | `result.html`, `admin.html#results` | Configure exam schemas, record marks, publish marksheets | Scoped to result management |
| **Student / Parent** | `student-fee-system.html` | View fee dues, download receipts, inspect published examination results | Scoped strictly to sibling group |

### Duty-Class Scoping Mechanism
When a teacher is assigned specific classes (e.g., `Class 3`, `Class 5`):
- Dropdown menus across **Academic Plan**, **Attendance**, and **Results** automatically filter to only show `Class 3` and `Class 5`.
- Super Admins always see `All Classes` along with every individual class option.

---

## Firestore Database Schema & Document Architecture (English + Malayalam)

All institutional data resides under a single multi-tenant root path defined in `config/app-config.js`:
```
institutions/{INSTITUTION_ID}/
```
*(Default: `institutions/school/` — സ്ഥാപനത്തിലെ എല്ലാ ഡാറ്റയും `institutions/school/` എന്ന പാത്തിന് കീഴിലുള്ള subcollections-ലാണ് സൂക്ഷിച്ചിരിക്കുന്നത്.)*

### 1. Settings Collection (`institutions/school/settings/{docId}`)
| Document ID | Purpose (English) | ഉപയോഗം (Malayalam) | Access Rule |
| :--- | :--- | :--- | :--- |
| **`adminAuth`** | Super Admin email (`email`), `adminsIndex`, and `admins` array (**never store passwords**) | സൂപ്പർ അഡ്മിൻ ഇമെയിൽ വിവരങ്ങൾ (**പാസ്‌വേഡ് സേവ് ചെയ്യരുത്**) | Admin only (`isAdmin`) |
| **`config`** | Institution name, logo, phone, address, `adminProfile`, student edit/photo flags | സ്ഥാപനത്തിന്റെ പേര്, ലോഗോ, `adminProfile`, പ്രധാന ക്രമീകരണങ്ങൾ | Public Read / Admin Write |
| **`content`** | Homepage about text, announcements/notices, gallery URLs, directory categories | ഹോം പേജ് വിവരങ്ങൾ, നോട്ടീസുകൾ, ഗാലറി | Public Read / Admin Write |
| **`academicYears`** | Academic years list, active year, months, calendar settings | അക്കാദമിക് വർഷങ്ങളുടെ വിവരങ്ങൾ | Public Read / Admin Write |
| **`sessionControl`** | Official Portal lock status (`isLocked`) | ഒഫീഷ്യൽ പോർട്ടൽ ലോക്ക് സ്റ്റാറ്റസ് | Public Read / Admin Write |
| **`sessionRegistry`** | Active device login heartbeat registry | ലോഗിൻ ചെയ്ത ഉപകരണങ്ങളുടെ സെഷൻ വിവരങ്ങൾ | Signed-in Read/Write |
| **`receiptSequence`** | Atomic fee receipt number counter (`lastReceiptNo`) | തനത് രസീത് നമ്പർ ജനറേറ്റ് ചെയ്യാനുള്ള കൗണ്ടർ | Collector / Admin |
| **`categoryAuthConfig`** | Login configuration for Public Directory categories | പബ്ലിക് ഡയറക്ടറി കാറ്റഗറി ലോഗിൻ ക്രമീകരണം | Public Read / Admin Write |
| **`pageAccess`** | Category & entry-level portal page permissions | ഡയറക്ടറി ഉപയോക്താക്കളുടെ പേജ് അനുമതികൾ | Public Read / Admin Write |
| **`resultCenter`** | Result publishing & marksheet display configuration | റിസൾട്ട് സെന്റർ ക്രമീകരണങ്ങൾ | Result Operator / Admin |
| **`attendanceConfig`** & **`timetableStructure`** | Working days, sessions, period timings | ഹാജർ & ടൈംടേബിൾ ക്രമീകരണങ്ങൾ | Attendance / Admin |
| **`yearPlanConfig`** & **`academicPlanningConfig`** | Year plan & syllabus tracker settings | അക്കാദമിക് പ്ലാനിംഗ് ക്രമീകരണങ്ങൾ | Academic Plan / Admin |
| **`activityConfig`** & **`taskDefinitions`** | Co-curricular & Ibadah task definitions | ആക്ടിവിറ്റി & ടാസ്ക് ക്രമീകരണങ്ങൾ | Activity / Admin |
| **`evaluationConfig_{id}`** | Classroom evaluation templates & rubrics | ക്ലാസ്‌റൂം ഇവാലുവേഷൻ ക്രമീകരണങ്ങൾ | Evaluation / Admin |

### 2. Core Top-Level Subcollections under `institutions/school/`
- **`students/{studentId}`**: Master student profiles (name, admission no, class, division, guardian contacts, photo, status, academicYear). *(List restricted to Staff/Admin; single-doc `get` for active Student Portal session).*
- **`studentAuthLookup/{admKey}`**: Minimal lookup index (`adm_{adm}`, `{class}_{adm}`) containing `studentId`, `name`, `class`, `adm`, and `phones` used during Student Portal login verification.
- **`studentGroups/{groupId}`**: Sibling billing groups (`memberIds`, group discount fee rate).
- **`staff/{staffId}`**: Staff profiles displayed in Admin & Public Directory (`name`, `type`, `role`, `phone`, `email`, `username`, `dutyClasses`, `isActive`, `showPublic`, `photo`) — **no plaintext passwords**.
- **`staffAccess/{emailOrUsername}`**: Role & permission flags (`canCollect`, `canAccessWorksheet`, `canManageResults`, `canAccessAttendance`, `canAccessAcademicPlan`, `canAccessActivity`, `canAccessEvaluation`, `canAccessAdmin`, `actLikeSuperAdmin`, `isActive`) read by Firestore Security Rules and portals.
- **`payments/{paymentId}`**: Fee payment receipts (`studentId`, `amount`, `paymentDate`, `paymentMode`, `receiptNo`, `academicYear`, `feeItems`, `timestamp`).
- **`donations/{donationId}`**: Institutional donations & receipts (Admin/Collector only).
- **`systemNotifications/{notifId}`**: Broadcast alerts/notifications for students & staff (Admin/Staff write).
- **`studentNotificationState/{studentId}`**: Read receipts (`readIds`, `lastMarkedAllReadAt`) per student.
- **`studentPhotoSubmissions/{studentId}`**: Student-submitted profile photos awaiting approval or synced.
- **`collectorPreferences/{collectorKey}`**: Saved fee counter preferences per collector.
- **`attendance/{docId}`**: Daily/monthly session-wise attendance logs.
- **`timetables/{docId}`**, **`classSubjects/{docId}`**, **`yearPlans/{docId}`**, **`syllabusDailyLogs/{docId}`**, **`examTimetables/{docId}`**: Academic scheduling, syllabus tracking, and exam schedules.
- **`activities/{docId}`**, **`ibadah/{docId}`**, **`taskCompletions/{docId}`**, **`studentCustomBadges/{docId}`**, **`studentBonusPoints/{docId}`**, **`rewardSettings/{docId}`**, **`prayerSettings/{docId}`**: Student activity, Ibadah, points, badges, and rewards.
- **`evaluations/{docId}`**, **`impositions/{docId}`**: Classroom evaluations and discipline/imposition tracking.
- **`worksheets/{docId}`**, **`worksheetTemplates/{docId}`**: Saved classroom worksheets and reusable column templates.
- **`publicDirectory/{docId}`**, **`directoryAuth/{docId}`**, **`pageAccessOverrides/{docId}`**: Custom public directory categories and access overrides.
- **`resultSchemas/{docId}`**, **`examResults/{docId}`**, **`promotionDecisions/{docId}`**: Exam schemas, marks, grades, rankings, and annual promotion logs.
- **`transferCertificates/{docId}`**: Transfer Certificate (TC) records.
- **`auditLogs/{docId}`**: Append-only security and operation audit trail (Admin read-only).

### 3. Year-Scoped Nested Subcollections
- **`academicYears/{yearId}/classes/{docId}`**: Classes configured per academic year.
- **`academicYears/{yearId}/enrollments/{docId}`**: Year-wise student enrollments.
- **`academicYears/{yearId}/feeItems/{docId}`**: Fee items & monthly structures per academic year.
- **`academicYears/{yearId}/payments/{docId}`** & **`years/{yearId}/payments/{docId}`**: Year-partitioned fee payment records.
- **`academicYears/{yearId}/results/{docId}`**: Year-partitioned exam results.

---

## Firebase Migration & New Database Setup Guide (English + Malayalam)

Follow this exact step-by-step guide whenever you switch this application to a **new Firebase project** or a **different Firestore database**.

*നിലവിലുള്ള ഈ ആപ്ലിക്കേഷൻ പുതിയൊരു Firebase പ്രോജക്റ്റിലേക്കോ മറ്റൊരു Firestore ഡാറ്റാബേസിലേക്കോ മാറ്റുമ്പോൾ താഴെ പറയുന്ന ഘട്ടങ്ങൾ കൃത്യമായി പാലിക്കുക:*

### Step 1: Create & Enable Services in the New Firebase Project
*(പുതിയ Firebase പ്രോജക്റ്റിൽ സൗകര്യങ്ങൾ ഓൺ ആക്കുക)*

1. Go to [Firebase Console](https://console.firebase.google.com) -> **Add project** (or select your target project).
2. Register a **Web App** (`</>` icon) in **Project Settings -> General -> Your apps** and copy the `firebaseConfig` object (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
3. **Firebase Authentication (Build -> Authentication -> Sign-in method):**
   - Enable **Email/Password** (Required for Super Admin and Staff login / അഡ്മിൻ, സ്റ്റാഫ് ലോഗിനുകൾക്ക് നിർബന്ധം).
   - Enable **Anonymous** (Required for Student Portal & Directory logins to authenticate Firestore reads / സ്റ്റുഡന്റ് പോർട്ടൽ പ്രവർത്തിക്കാൻ **Anonymous** നിർബന്ധമായും Enable ചെയ്യണം).
4. **Cloud Firestore (Build -> Firestore Database -> Create database):**
   - Choose your region (e.g., `asia-south1` Mumbai or nearest region) and start in **Production mode**.
   - **Important (`(default)` vs Named Database):**
     - Standard Firebase projects create a database named `(default)`. If you use `(default)`, do **not** set `firestoreDatabaseId` (or remove it from `config/firebase-config.js`).
     - If your project uses a **custom named Firestore database** (like `ai-studio-...`), include `firestoreDatabaseId: "YOUR_DATABASE_ID"` in `firebaseConfig`!
     - *(സാധാരണ പുതിയ ഫയർബേസ് പ്രോജക്റ്റുകളിൽ `(default)` ഡാറ്റാബേസ് ആണ് ഉണ്ടാവുക; അപ്പോൾ `firestoreDatabaseId` നൽകേണ്ടതില്ല. പ്രത്യേകം പേരുള്ള Named Database ആണെങ്കിൽ മാത്രം `firestoreDatabaseId` നൽകുക.)*
5. **Cloud Storage (Build -> Storage -> Get started):** Enable Storage if uploading photos/files.

---

### Step 2: Exact Project Files to Update
*(കോഡിൽ മാറ്റം വരുത്തേണ്ട കൃത്യമായ ഫയലുകൾ)*

| File | What to Edit | എന്താണ് മാറ്റേണ്ടത് |
| :--- | :--- | :--- |
| **`config/firebase-config.js`** | Replace `const firebaseConfig = { ... }` with your new project's credentials. Keep or remove `firestoreDatabaseId` depending on whether you use a named DB or `(default)`. | പുതിയ പ്രോജക്റ്റിന്റെ `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId` എന്നിവ നൽകുക (`(default)` ഡാറ്റാബേസ് ആണെങ്കിൽ `firestoreDatabaseId` ഒഴിവാക്കുക). |
| **`firebase-applet-config.json`** | Update `projectId`, `appId`, `apiKey`, `authDomain`, `storageBucket`, `messagingSenderId`, and `firestoreDatabaseId` (set `"(default)"` or your named DB ID). | Firebase Rules/CLI ഡിപ്ലോയ്മെന്റിനായി ഈ ഫയലും പുതിയ പ്രോജക്റ്റ് വിവരങ്ങളിലേക്ക് മാറ്റുക. |
| **`.firebaserc`** | Update `"default": "your-new-project-id"`. | Firebase CLI (`firebase deploy`) ഉപയോഗിക്കുമ്പോൾ ശരിയായ പ്രോജക്റ്റ് തിരഞ്ഞെടുക്കാൻ പ്രോജക്റ്റ് ID അപ്‌ഡേറ്റ് ചെയ്യുക. |
| **`config/app-config.js`** *(Optional)* | Change `INSTITUTION_ID` only if you want a separate path instead of `institutions/school`. | മറ്റൊരു സ്ഥാപനത്തിനായി പുതിയൊരു പാത്ത് വേണമെങ്കിൽ മാത്രം `INSTITUTION_ID` മാറ്റുക. |

> **Warning:** After changing `projectId` in `config/firebase-config.js`, `window.AppSession.syncFirebaseProject()` automatically clears stale browser sessions from the old Firebase project to prevent cross-project data collisions.

---

### Step 3: Publish Security Rules & Authorized Domains
*(Security Rules പബ്ലിഷ് ചെയ്യലും ഡൊമെയ്ൻ അനുമതി നൽകലും)*

1. **Firestore Security Rules:**
   - Open **`firestore.rules`** from this repository and copy its entire contents.
   - Go to **Firebase Console -> Firestore Database -> Rules** (make sure the correct database is selected if using a named DB), paste the rules, and click **Publish**.
   - *(ഈ പ്രോജക്റ്റിലെ `firestore.rules` പൂർണ്ണമായി കോപ്പി ചെയ്ത് പുതിയ പ്രോജക്റ്റിലെ Firestore -> Rules-ൽ പേസ്റ്റ് ചെയ്ത് Publish ചെയ്യുക. Test Mode തുറന്നിടരുത്!)*
2. **Storage Security Rules:**
   - Open **`storage.rules`** from this repository, copy its contents into **Firebase Console -> Storage -> Rules**, and click **Publish**.
3. **Authorized Domains:**
   - Go to **Firebase Console -> Authentication -> Settings -> Authorized domains**.
   - Ensure `localhost` (for local testing) and your live **Vercel domain** (e.g., `your-app.vercel.app` and any custom domain) are listed.

---

### Step 4: Bootstrap Super Admin on the New Firebase Project
*(പുതിയ പ്രോജക്റ്റിൽ ആദ്യ Super Admin സജ്ജീകരിക്കൽ)*

1. In **Firebase Console -> Authentication -> Users**, click **Add user** and create your Super Admin email and password.
2. In **Firebase Console -> Firestore Database**, create the document at:
   `institutions/school/settings/adminAuth`
   with:
   ```json
   {
     "email": "your-admin@gmail.com",
     "adminsIndex": {
       "your-admin@gmail.com": true
     },
     "admins": [
       {
         "name": "Super Admin",
         "email": "your-admin@gmail.com",
         "role": "super_admin",
         "isActive": true
       }
     ]
   }
   ```
3. Open your app, click **Login**, enter `your-admin@gmail.com` in Step 1, and sign in with your Firebase Auth password in Step 2. The app automatically bootstraps `settings/config.adminProfile`!

---

### Step 5: Migrate Existing Data & Re-sync Auth Indexes
*(പഴയ ഡാറ്റ പുതിയ ഫയർബേസിലേക്ക് മാറ്റുന്ന വിധം)*

If you are moving an existing institution's data from an old Firebase project to a new one:

1. **Export Backup from Old Firebase:**
   - Before switching config files, log in to the **old** Admin Panel -> **Security Settings -> Institutional Backup & Data Recovery Center** and click **Export JSON Backup** to download the full database snapshot.
2. **Switch Config & Restore to New Firebase:**
   - Complete Steps 1–4 for the new Firebase project and log in as Super Admin on the new project.
   - Open **Admin Panel -> Security Settings -> Restore from Backup**, upload your JSON backup file, review the diff preview, and execute the restore.
3. **Clean Any Legacy Plaintext Passwords:**
   - In **Admin Panel -> Security Settings**, click **Clean Legacy Passwords** so no old `password` fields remain in Firestore `staff`, `staffAccess`, or `settings/adminAuth`.
4. **Re-provision Staff Firebase Authentication Accounts (CRITICAL!):**
   - JSON backups restore Firestore documents (`staff`, `staffAccess`) **but do NOT copy Firebase Authentication users** between separate Firebase projects.
   - Open **Admin Panel -> Staff Management**, click the key/credentials icon on each portal-enabled staff member, and save their Username/Email + Password so their account is created in the new project's **Firebase Authentication**.
   - *(JSON ബാക്കപ്പ് വഴി Firestore ഡാറ്റ മാത്രമേ മാറുകയുള്ളൂ; പുതിയ ഫയർബേസ് പ്രോജക്റ്റിലെ Firebase Authentication-ലേക്ക് സ്റ്റാഫ് യൂസർമാർ തനിയെ വരില്ല. അതിനാൽ ഓരോ സ്റ്റാഫിനും Admin Panel വഴി Credentials ഒന്നുകൂടി Save ചെയ്ത് Auth അക്കൗണ്ട് നിർമ്മിക്കണം.)*
5. **Rebuild Student Auth Lookup (`studentAuthLookup`):**
   - After restoring students, ensure the `studentAuthLookup` index is synchronized (via Admin Student Lookup sync / saving student records) so Student Portal admission-number logins work immediately.

---

### Step 6: Build & Deploy to Vercel
*(Vercel-ൽ പ്രൊഡക്ഷൻ പബ്ലിഷ് ചെയ്യുന്ന വിധം)*

1. Run local verification before pushing:
   ```bash
   npm run lint
   npm run build
   ```
2. Push your updated `config/firebase-config.js` (and `firebase-applet-config.json` / `.firebaserc`) to GitHub.
3. Vercel automatically uses `vercel.json`:
   - Framework: `vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Clean URLs (`cleanUrls: true`) + HTTP Security Headers + `sw.js` `no-cache` headers.
4. Once live on Vercel, verify:
   - Unauthenticated `GET` to `institutions/school/settings/adminAuth` returns `PERMISSION_DENIED` (`403`).
   - Super Admin login, Staff login, and Student Portal login all work on the live domain.

---

## Firebase Security Hardening, App Check & Vercel Deployment

To protect sensitive institutional records, student PII, and financial ledgers in production, the following security measures are strictly enforced:

### 1. Firestore & Storage Security Rules
- Configured in `firestore.rules` and `storage.rules`.
- `settings/adminAuth` is isolated strictly to verified Admins (`isAdmin(institutionId)`).
- `students` `list` queries and `staffAccess` `list` queries are restricted to Staff/Admin; Student Portal sessions are capped to single-document `get` and limited `payments` queries (`limit <= 150`).
- Plaintext passwords are never stored in Firestore; Admin/Staff authentication uses Firebase Auth exclusively.
- `systemNotifications` writes require Admin/Staff; `auditLogs` creation requires non-anonymous authenticated users; `storage.rules` closes catch-all paths with `allow read, write: if false;`.

### 2. App Check Enforcement (Optional / Recommended for High-Traffic Production)
Client bootstrap is already prepared in `config/firebase-config.js` (`window.__APP_CHECK_SITE_KEY`):
1. Open **Firebase Console > Build > App Check**.
2. Register **reCAPTCHA v3** for your production Vercel domain.
3. Inject the site key into `window.__APP_CHECK_SITE_KEY` at deployment time.
4. Enable enforcement for **Cloud Firestore** and **Cloud Storage**.

### 3. Vercel Hosting & Authorized Domains Lock
In **Firebase Console > Authentication > Settings > Authorized Domains**, strictly permit:
- Production domain (e.g., `your-institution.vercel.app` or your custom domain)
- `localhost` (exclusively for local development)
- Remove any obsolete or unverified staging hosts.

---

## Getting Started & Local Development

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)
- A Google Firebase project with Cloud Firestore and Firebase Authentication enabled.

### Installation & Commands

1. **Clone the repository**:
   ```bash
   git clone https://github.com/dsdjamia-coder/institution.git
   cd institution
   ```

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Parameters**:
   - Check `config/app-config.js` to adjust `INSTITUTION_ID` if deploying for multiple institutions:
     ```javascript
     export const INSTITUTION_ID = 'school';
     export const BASE_PATH = `institutions/${INSTITUTION_ID}`;
     ```
   - Check `config/firebase-config.js` to ensure your Firebase project credentials match your environment.

4. **Start the local development server**:
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:3000`.

5. **Type Checking & Linting**:
   ```bash
   npm run lint
   ```

6. **Production Build**:
   ```bash
   npm run build
   ```
   The compiled, optimized distribution bundle will be generated in `dist/`.

7. **Preview Production Build**:
   ```bash
   npm run preview
   ```

---

## Official Print Engine & Export Specifications

All printable documents across the platform are engineered for publication-grade A4 printing using custom `@media print` stylesheets:

- **Web Chrome Elimination**: Headers, navigation drawers, control bars, filter selectors, modals, and toasts are automatically suppressed.
- **Boxed Border Structure**: High-contrast black box borders (`border: 1.5px solid #000; border-collapse: collapse;`) ensure crisp clarity on physical laser and inkjet printers.
- **Dynamic Orientation**:
  - **Class Routine Timetable**: Landscape A4.
  - **Academic Year Plan Matrix**: Landscape A4.
  - **Syllabus Progress Tracker**: Landscape A4.
  - **Master Exam Timetable**: Landscape A4.
  - **Class Exam Routine**: Landscape A4.
  - **Student Result Marksheet / Report Card**: Portrait A4.
  - **Class Worksheet Printout**: Configurable Landscape/Portrait A4.
- **Official Letterhead & Signatures**: Every printed sheet includes institutional branding, official logo, document publication date, and dual signature blocks for the **Subject/Class Teacher** and the **Head of Institution / Principal**.

---

## Emergency Rollback & Disaster Recovery Runbook

**Document Code:** QA-RR-01  
**Purpose:** Standard operating procedure to rollback frontend deployments or recover Firestore database state in case of runtime regressions or data inconsistencies.

### 1. Rollback Triggers
- Core fee collection or receipt printing fails in production.
- Database authorization regression preventing staff or students from accessing portals.
- Breaking frontend build error released to clients.

### 2. Code Deployment Rollback Procedure
```bash
# Step 1: Check status
git status

# Step 2: Roll back to last verified stable commit
git log --oneline -n 5
git checkout <LAST_STABLE_COMMIT_HASH>
npm install
npm run lint
npm run build
```

### 3. Service Worker Cache Invalidation
If client devices have cached faulty assets via `sw.js`:
1. Open `sw.js` and increment `CACHE_NAME` (e.g., from `fee-tracker-v26` to `fee-tracker-v27`).
2. Deploy the updated `sw.js`. The browser `activate` event will delete legacy caches and download fresh bundles on client devices immediately.

### 4. Database Snapshot Recovery Procedure
1. **Safety Precaution**: Before any restore, export current state via **Admin Portal > Security Settings > Export JSON Backup**.
2. **Restore from Archive**:
   - Open `admin.html#security-settings`.
   - Under **Restore from Backup**, upload the last verified healthy JSON snapshot.
   - Review the collection diff preview and execute the restore.

---

## User Acceptance Testing (UAT) Checklist

Before clearing any production release, complete the following verification steps:

- [ ] **Public Portal (`index.html`)**:
  - Live student tally loads correctly.
  - Student login operates cleanly with Admission No and Date of Birth / Mobile.
  - Console verifies zero student PII is exposed in unauthenticated memory.
- [ ] **Fee Collection Desk (`collection.html`)**:
  - Student lookup auto-suggests results quickly.
  - Cash, UPI, and Bank Transfer receipts generate correct sequential numbering without collisions.
  - Sibling group discount rates calculate accurately.
- [ ] **Result Management (`result.html`)**:
  - Marks enter cleanly, grades and percentages compute dynamically.
  - Publishing toggle instantly unlocks report cards on the Student Portal.
  - Auto-promotion wizard migrates passed students to the next academic year.
- [ ] **Admin Console (`admin.html`)**:
  - Super Admin authentication functions securely.
  - Academic year switching and fee structure updates persist cleanly.
  - Automated JSON backup export downloads successfully.

---

## Bug Triage Framework & Historical Fixes

*Framework: The Triage Kit*  
*Prioritization Principle: "No new feature until the Red list is empty. Fix blockers first."*

### Historical Resolved Defects:

1. **Photo Upload Base64 OOM Crash on Budget Phones (Red List)**
   - **Root Cause**: `FileReader.readAsDataURL` read 15MB+ camera images directly into string memory without pre-checks.
   - **Fix**: Implemented `safelyPrepareImageForCropping` across `admin-page.js` and `student-page.js`. Rejects $>15\text{MB}$, downscales via offscreen Canvas to $\le 1200\text{px}$, and outputs $\approx 150\text{KB}$ image buffers for `InteractiveCropper`.
   - **Status**: [x] Fixed & Verified

2. **Sibling Group Fee Disparity in Student Ledger vs Counter (Red List)**
   - **Root Cause**: Collection counter billed group rates, but student profile ledger billed standard individual dues.
   - **Fix**: Added `getStudentEffectiveMonthlyFee(student, targetAcademicYear)` to distribute sibling group rates proportionally.
   - **Status**: [x] Fixed & Verified

3. **Student Search Restriction to Name and Admission No (Yellow List)**
   - **Root Cause**: Search function only checked `s.name` and `s.adm`.
   - **Fix**: Created `matchesStudentSearch(s, term)` checking Name, Adm, UID, Father, Mother, Guardian, and 3+ digit matches on mobile/Aadhaar.
   - **Status**: [x] Fixed & Verified

4. **Heavy Initial Audit Log Downloads on Cellular Networks (Yellow List)**
   - **Root Cause**: Unbounded `onSnapshot` query on `auditLogs` downloaded thousands of historical documents.
   - **Fix**: Applied `limit(50)` with `orderBy('createdAt', 'desc')` and a visual Live Sync indicator.
   - **Status**: [x] Fixed & Verified

5. **Inconsistent Currency Formatting (Green List)**
   - **Root Cause**: Raw template strings caused unformatted numbers (`₹1200` vs `₹1,200.00`).
   - **Fix**: Standardized `formatCurrency` in `app-common.js` using `Intl.NumberFormat('en-IN')`.
   - **Status**: [x] Fixed & Verified

6. **Softening of Small Logos on High-DPI Mobile Screens (Green List)**
   - **Root Cause**: Browser interpolation softened small logo badges.
   - **Fix**: Applied `image-rendering: crisp-edges` and `-webkit-optimize-contrast` in `styles/main.css`.
   - **Status**: [x] Fixed & Verified

---

## Developer Reference & Guidelines

For the complete development workflow instructions, approval protocol, and safe editing rules, refer to:
👉 [**DEVELOPER_GUIDELINES.md**](./DEVELOPER_GUIDELINES.md)

---

## License & Institutional Information

This software is an enterprise institutional management and financial platform designed for educational institutions. All rights reserved. Unauthorized reproduction, modification, or distribution without proper authorization is prohibited.
