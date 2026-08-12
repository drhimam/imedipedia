# iMedipedia — Implementation Walkthrough

> **Last Updated:** 2026-08-12
> **Platform:** Medical Research & Education Platform
> **Live URL:** https://imedipedia.pages.dev

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Tech Stack](#2-architecture--tech-stack)
3. [Project Structure](#3-project-structure)
4. [Database Schema (D1)](#4-database-schema-d1)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [API Routes Reference](#6-api-routes-reference)
7. [Pages Reference](#7-pages-reference)
8. [Email System (SES)](#8-email-system-ses)
9. [Image Storage (R2)](#9-image-storage-r2)
10. [Theme System](#10-theme-system)
11. [Environment Variables](#11-environment-variables)
12. [Deployment (Cloudflare Pages)](#12-deployment-cloudflare-pages)
13. [Database Migration & Seeding](#13-database-migration--seeding)
14. [Known Issues & Resolved Bugs](#14-known-issues--resolved-bugs)
15. [Development Guide](#15-development-guide)

---

## 1. Project Overview

iMedipedia is a medical research platform built with Astro 4 (hybrid SSR/static mode), deployed on Cloudflare Pages. It provides:

- **Research Digest** — Medical articles by subject and topic
- **Clinical Guidelines** — Evidence-based clinical practice protocols
- **Case Reports** — Peer-reviewed clinical case database
- **CME & Learning** — Board preparation questions and educational content
- **Contributor Portal** — Application system, author dashboard, article submissions
- **Admin Dashboard** — Application review, submission review, article publishing, image management
- **Dark/Light Theme** — System-aware theme toggle with no flash-of-wrong-theme

---

## 2. Architecture & Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro 4 (Hybrid mode: `output: 'hybrid'`) |
| Adapter | `@astrojs/cloudflare` v11.2 (Cloudflare Pages + Workers) |
| CMS | TinaCMS v2.2 |
| Database | Cloudflare D1 (SQLite at edge) — Binding: `DB` |
| Object Storage | Cloudflare R2 — Binding: `IMAGES`, Bucket: `imedipedia-images` |
| Email | AWS SES (`@aws-sdk/client-ses` v3.600) |
| Auth | PBKDF2 password hashing + TOTP MFA + HttpOnly session cookies |
| Fonts | Outfit + Plus Jakarta Sans (Google Fonts) |

### How SSR Works

Pages that need server-side logic (auth checks, API routes, dynamic content) declare `export const prerender = false;`. The Cloudflare adapter routes these through Workers, which have access to D1 bindings and environment variables via `locals.runtime.env`.

### Session Cookie Pattern

- Login creates a session in D1 `sessions` table (random hex ID, 7-day expiry)
- `Set-Cookie: session_id=...; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
- SSR pages read the cookie, verify against D1, redirect to login if invalid
- Client-side (contributor dashboard) uses `sessionStorage` for non-sensitive user data (username, role)

---

## 3. Project Structure

```
├── astro.config.mjs              # Astro config (hybrid + Cloudflare)
├── wrangler.toml                 # Cloudflare bindings (D1, R2, vars)
├── schema.sql                    # D1 database schema
├── package.json                  # Dependencies
├── .env.example                  # Environment variables template
├── scripts/
│   └── seed-db.js                # Database seed script
├── docs/
│   └── WALKTHROUGH.md            # This document
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro      # Shared layout (nav, footer, theme, fonts)
│   ├── pages/
│   │   ├── index.astro           # Home — article grid with search/filter/sort
│   │   ├── general.astro         # Research Digest
│   │   ├── cases.astro           # Case Reports
│   │   ├── education.astro       # CME & Learning
│   │   ├── clinical-guidelines.astro  # Clinical Guidelines (placeholder)
│   │   ├── contributors.astro    # Contributor portal + application modal
│   │   ├── contributors/
│   │   │   ├── [id].astro        # Individual contributor profile (SSR)
│   │   │   ├── dashboard.astro   # Author dashboard (tabs, upload, forms)
│   │   │   ├── settings.astro    # Account settings (profile, password, MFA)
│   │   │   └── reset-password.astro  # Password reset page
│   │   ├── admin.astro           # Admin dashboard (SSR, auth-protected)
│   │   ├── admin/
│   │   │   └── login.astro       # Admin login page
│   │   ├── blog/
│   │   │   └── [...slug].astro   # Individual blog article
│   │   └── api/
│   │       ├── _email-template.js    # Branded HTML email builder
│   │       ├── auth/
│   │       │   ├── login.js          # POST — login + MFA flow
│   │       │   ├── register.js       # POST — self-registration
│   │       │   ├── forgot-password.js # POST — SES password reset
│   │       │   ├── change-password.js # POST — authenticated password change
│   │       │   ├── setup-totp.js     # POST — generate TOTP secret
│   │       │   └── verify-totp.js    # POST — verify & enable TOTP
│   │       ├── profile/
│   │       │   ├── get.js            # GET — fetch user profile
│   │       │   └── update.js         # POST — update profile fields
│   │       ├── applications/
│   │       │   └── submit.js         # POST — submit contributor application
│   │       ├── submissions/
│   │       │   ├── create.js         # POST — create article submission
│   │       │   ├── [id].js           # GET/PUT/DELETE — single submission CRUD
│   │       │   └── list.js           # GET — list user's submissions
│   │       ├── contributors/
│   │       │   └── list.js           # GET — public contributor listing
│   │       ├── images/
│   │       │   └── upload.js         # POST — upload image to R2
│   │       └── admin/
│   │           ├── applications.js    # GET — list applications (paginated)
│   │           ├── application-review.js # POST — accept/reject application
│   │           ├── submissions.js     # GET — list submissions (paginated)
│   │           ├── review.js          # POST — approve/reject submission
│   │           ├── publish.js         # POST — publish to GitHub markdown
│   │           ├── update-article.js  # POST — update published article
│   │           ├── articles.js        # GET — list published articles (GitHub)
│   │           └── images.js          # GET/DELETE — manage uploaded images
│   └── content/
│       └── blog/                 # Markdown articles (published, Git-managed)
└── public/                       # Static assets
```

---

## 4. Database Schema (D1)

Database: `imedipedia-db` (ID: `8aeee120-4b92-44e1-b9d2-5f8b1566a52b`)

### 4.1 `users` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | 16-byte random hex |
| `username` | TEXT NOT NULL UNIQUE | Login identifier |
| `password_hash` | TEXT NOT NULL | PBKDF2: `salt:hash` (hex) |
| `role` | TEXT DEFAULT 'editor' | `admin`, `co-admin`, `contributor`, `editor` |
| `full_name` | TEXT | Display name |
| `email` | TEXT | Email address |
| `affiliation` | TEXT DEFAULT '[]' | JSON array of institutions/hospitals |
| `specialty` | TEXT DEFAULT '[]' | JSON array of medical specialties |
| `experience` | TEXT DEFAULT '[]' | JSON array of experience entries |
| `bio` | TEXT | Short biography |
| `avatar_url` | TEXT | Profile image URL |
| `force_password_change` | INTEGER DEFAULT 0 | Flag for first-login reset |
| `mfa_enabled` | INTEGER DEFAULT 0 | TOTP MFA status |

> **⚠️ Multi-Value Fields:** `affiliation`, `specialty`, and `experience` are stored as JSON arrays (e.g., `["Cardiology","Internal Medicine"]`). All API endpoints use `parseArrayField()` / `normalizeArrayField()` helpers for backward compatibility with legacy plain-string values stored by earlier versions.

### 4.2 `sessions` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | 20-byte random hex |
| `user_id` | TEXT NOT NULL | FK → users.id |
| `expires_at` | INTEGER | Unix timestamp (7 days from login) |

### 4.3 `password_reset_tokens` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Token string |
| `user_id` | TEXT NOT NULL | FK → users.id |
| `expires_at` | INTEGER | Unix timestamp (15 min from request) |

### 4.4 `submissions` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `user_id` | TEXT NOT NULL | FK → users.id |
| `title` | TEXT NOT NULL | Article title |
| `slug` | TEXT NOT NULL | URL-friendly slug |
| `description` | TEXT NOT NULL | Short summary |
| `author` | TEXT NOT NULL | Author display name |
| `tag` | TEXT DEFAULT '' | JSON array of tags |
| `type` | TEXT DEFAULT 'general' | `general`, `update`, `case`, `education` |
| `subject` | TEXT | Subject area |
| `topic` | TEXT | Specific topic |
| `exams` | TEXT DEFAULT '[]' | JSON array of exam names |
| `image` | TEXT DEFAULT '' | Cover image R2 URL |
| `body` | TEXT NOT NULL | Markdown content |
| `status` | TEXT DEFAULT 'pending' | `pending`, `approved`, `rejected`, `published` |
| `admin_notes` | TEXT | Reviewer feedback |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |

### 4.5 `applications` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `name` | TEXT NOT NULL | Applicant's full name |
| `email` | TEXT NOT NULL | Applicant's email |
| `about_me` | TEXT NOT NULL | Personal statement |
| `writing_experience` | TEXT NOT NULL | Writing background |
| `portfolio_links` | TEXT DEFAULT '' | Links to past work |
| `status` | TEXT DEFAULT 'pending' | `pending`, `approved`, `rejected` |
| `admin_notes` | TEXT | Reviewer notes |
| `created_at` | INTEGER | Unix timestamp |
| `reviewed_at` | INTEGER | When reviewed |
| `reviewed_by` | TEXT | FK → users.id |

### 4.6 `images` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `key` | TEXT NOT NULL | R2 object key |
| `url` | TEXT NOT NULL | Public R2 URL |
| `name` | TEXT DEFAULT '' | Display name / alt text |
| `description` | TEXT DEFAULT '' | Caption |
| `folder` | TEXT DEFAULT 'uploads' | `covers`, `inline`, `uploads` |
| `content_type` | TEXT DEFAULT 'image/png' | MIME type |
| `size_bytes` | INTEGER DEFAULT 0 | File size |
| `uploaded_by` | TEXT | FK → users.id |
| `created_at` | INTEGER | Unix timestamp |

### 4.7 `totp_secrets` Table

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | TEXT PRIMARY KEY | FK → users.id |
| `secret` | TEXT NOT NULL | Base32-encoded TOTP secret |
| `enabled` | INTEGER DEFAULT 0 | Whether MFA is active |
| `created_at` | INTEGER | Unix timestamp |

---

## 5. Authentication & Authorization

### 5.1 Password Hashing

- **Algorithm:** PBKDF2 (SHA-256, 100,000 iterations, 32-byte output)
- **Salt:** 16 random bytes, generated per-user
- **Storage format:** `saltHex:hashHex` stored in `users.password_hash`

### 5.2 Login Flow

1. `POST /api/auth/login` with `{ username, password }`
2. Server verifies password against stored PBKDF2 hash
3. If MFA is enabled: creates a temporary session (`mfa_` prefix, 5-minute expiry), returns `{ mfaRequired: true, tempSessionId }`
4. If MFA is not enabled: creates a real session (7-day expiry), sets `session_id` cookie, returns `{ success: true, user: { username, role, force_password_change } }`

### 5.3 MFA Flow (TOTP)

1. `POST /api/auth/setup-totp` — generates a 20-byte secret, base32-encoded, returns `{ secret, otpauthUrl }`
2. User scans QR / enters key into authenticator app
3. `POST /api/auth/verify-totp` with `{ code }` — verifies 6-digit TOTP, enables MFA on account
4. On subsequent logins with MFA enabled: password step succeeds → temp session → `POST /api/auth/login` with `{ totpCode, tempSessionId }` → real session

### 5.4 Session Verification (SSR Pattern)

All SSR-protected pages use the same pattern:

```javascript
export const prerender = false;

const cookieHeader = Astro.request.headers.get("cookie") || "";
const match = cookieHeader.match(/session_id=([^;]+)/);
const sessionId = match ? match[1] : null;
if (!sessionId) return Astro.redirect("/login");

const session = await db.prepare(
  "SELECT * FROM sessions WHERE id = ? AND expires_at > ?"
).bind(sessionId, Math.floor(Date.now() / 1000)).first();
if (!session) return Astro.redirect("/login");

const user = await db.prepare("SELECT * FROM users WHERE id = ?")
  .bind(session.user_id).first();
if (!user || !isAdmin(user)) return Astro.redirect("/login");
```

### 5.5 Role-Based Access

| Role | Permissions |
|------|------------|
| `admin` | Full access: review applications, review submissions, publish articles, manage images, access admin dashboard |
| `co-admin` | Same as admin |
| `contributor` | Submit articles, view own submissions, access contributor dashboard |
| `editor` | Default role for manually-created users (minimal permissions) |

### 5.6 Client-Side Auth (Contributor Dashboard)

The contributor dashboard uses `sessionStorage` for non-sensitive UI data:
```javascript
var userData = sessionStorage.getItem('user');
if (!userData) { window.location.href = '/contributors'; }
var user = JSON.parse(userData);
// user.username, user.role, user.full_name, user.force_password_change
```

This is set client-side after login by writing `user` to `sessionStorage` from the login API response.

---

## 6. API Routes Reference

### 6.1 Authentication Endpoints

#### `POST /api/auth/login`
- **Auth:** Public
- **Body:** `{ username, password }` or `{ totpCode, tempSessionId }` (MFA step 2)
- **Response:** `{ success: true, user: { username, role, force_password_change } }` or `{ mfaRequired: true, tempSessionId }`
- **Cookie:** Sets `session_id` on successful authentication

#### `POST /api/auth/register`
- **Auth:** Public
- **Body:** `{ username, email, password, full_name }`
- **Response:** `{ success: true, message }`
- **Notes:** Creates user with `role='contributor'`. Username defaults to email if not provided.

#### `POST /api/auth/forgot-password`
- **Auth:** Public
- **Body:** `{ username }` (or `{ identifier }`)
- **Response:** `{ success: true, message: "If this account exists, a reset link will be sent." }` (prevents user enumeration)
- **Notes:** Sends branded HTML email via SES with 15-minute reset token

#### `POST /api/auth/change-password`
- **Auth:** Session required
- **Body:** `{ currentPassword, newPassword }`
- **Response:** `{ success: true, message }`
- **Notes:** Clears `force_password_change` flag on success

#### `POST /api/auth/setup-totp`
- **Auth:** Session required
- **Body:** None
- **Response:** `{ success: true, secret, otpauthUrl }`
- **Notes:** Generates 20-byte secret, base32-encoded. Upserts into `totp_secrets`.

#### `POST /api/auth/verify-totp`
- **Auth:** Session required
- **Body:** `{ code }` (6-digit TOTP)
- **Response:** `{ success: true, message: "MFA enabled successfully." }`
- **Notes:** Updates `totp_secrets.enabled = 1` and `users.mfa_enabled = 1`

### 6.2 Profile Endpoints

#### `GET /api/profile/get`
- **Auth:** Session required
- **Response:** `{ success: true, profile: { id, username, email, full_name, specialty, bio, affiliation, avatar_url, role, force_password_change, mfa_enabled } }`

#### `POST /api/profile/update`
- **Auth:** Session required
- **Body:** `{ full_name, email, specialty, bio, affiliation, avatar_url }` (all optional)
- **Response:** `{ success: true, message: "Profile updated." }`

### 6.3 Contributor Application Endpoints

#### `POST /api/applications/submit`
- **Auth:** Public
- **Body:** `{ name, email, about_me, writing_experience, portfolio_links? }`
- **Response:** `{ success: true, message }`
- **Validation:** All fields required except `portfolio_links`. Email format validated. Duplicate pending applications rejected.
- **⚠️ IMPORTANT:** Use `snake_case` keys (`about_me`, `writing_experience`, `portfolio_links`) — NOT camelCase.

### 6.4 Submission Endpoints

#### `POST /api/submissions/create`
- **Auth:** Session required, contributor/admin/co-admin role
- **Body:**
  ```json
  {
    "title": "Article Title",
    "description": "Summary (optional)",
    "body": "Markdown content",
    "tags": "Oncology, CRISPR" or ["Oncology", "CRISPR"],
    "type": "general",
    "subject": "Oncology",
    "topic": "Cancer Vaccines",
    "exams": "USMLE, FRCP" or ["USMLE", "FRCP"],
    "image": "https://pub-xxx.r2.dev/covers/...",
    "intextImages": [{ "url": "...", "name": "Fig 1", "description": "..." }]
  }
  ```
- **Response:** `{ success: true, id, slug, message, emailSent }`
- **Notes:** Author auto-set to `user.full_name`. Tags and exams accept JSON arrays or comma-separated strings. **Description is now optional.** All text inputs are sanitized (HTML tags stripped, truncated to max lengths: title 500, description 1000, subject/topic 200, body 100k). A branded confirmation email is sent to the contributor via SES after successful submission (non-blocking — submission succeeds even if email fails).

#### `GET /api/submissions/list`
- **Auth:** Session required
- **Query:** `?status=pending&page=1&limit=20`
- **Response:** `{ submissions: [...], total, page, limit, totalPages }`
- **Notes:** Contributors see only their own submissions. Admins see all.

#### `GET /api/submissions/[id]`
- **Auth:** Session required (owner or admin)
- **Response:** `{ success: true, submission: { ... } }`
- **Notes:** Returns 403 if user is not the owner and not an admin. Returns 404 if not found.

#### `PUT /api/submissions/[id]`
- **Auth:** Session required (owner or admin)
- **Body:** `{ title?, description?, body?, tags?, type?, subject?, topic?, exams?, image?, intextImages? }` (all optional — only send what changed)
- **Response:** `{ success: true, message, statusChanged, newStatus }`
- **Behavior:** If the submission is `published`, editing reverts status to `pending` so admin must re-approve. Description is optional. All text inputs are sanitized (HTML tags stripped, trimmed, truncated).

#### `DELETE /api/submissions/[id]`
- **Auth:** Session required (owner or admin)
- **Response:** `{ success: true, message: "Submission deleted." }`
- **Restrictions:** Contributors cannot delete published articles (returns 400). Admins can delete any submission regardless of status.

### 6.5 Public Contributor Endpoint

#### `GET /api/contributors/list`
- **Auth:** Public
- **Response:** `{ contributors: [{ id, full_name, email, specialty, bio, avatar_url, affiliation, slug, initial }] }`
- **Notes:** Returns all users with `role='contributor'` and non-empty `full_name`.

### 6.6 Image Upload Endpoint

#### `POST /api/images/upload`
- **Auth:** Session required
- **Body:** `{ file: "data:image/png;base64,...", name: "Image name", description: "Caption", folder: "covers"|"inline"|"uploads" }`
- **Response:** `{ success: true, id, key, url, name, storageUsed: "r2"|"none" }`
- **Validation:** Max 1MB. Allowed types: JPEG, PNG, WebP, GIF, AVIF.
- **Upload priority:** Native R2 binding → S3 SDK fallback → skip (track in D1 only)

### 6.7 Admin Endpoints

All admin endpoints require session + admin/co-admin role.

#### `GET /api/admin/applications`
- **Query:** `?status=pending&page=1`
- **Response:** `{ applications: [...], total, page, limit, totalPages }`

#### `POST /api/admin/application-review`
- **Body:** `{ applicationId, action: "accept"|"reject", reason? }`
- **Accept:** Creates user with username=email, auto-generated 12-char password, role='contributor', sends branded HTML welcome email via SES
- **Reject:** Updates status, sends branded HTML rejection email via SES
- **Response:** `{ success: true, message, username? }`
- **⚠️ Note:** SES response parsing may throw `DOMParser` error in Cloudflare Workers — email errors are caught and don't fail the operation.

#### `GET /api/admin/submissions`
- **Query:** `?status=pending&page=1`
- **Response:** `{ submissions: [...], total, page, limit, totalPages }`

#### `POST /api/admin/review`
- **Body:** `{ submissionId, action: "approve"|"reject", notes? }`
- **Response:** `{ success: true, message, emailSent }`
- **Notes:** Sends branded HTML email notification to contributor on decision:
  - **Approve:** Green success box, "queued for publishing" message, dashboard link
  - **Reject:** Warning box with admin feedback notes, edit & resubmit button
  - Email uses JOIN to fetch `users.email` and `users.full_name` from the submission owner
  - Email sending is non-blocking (caught and logged) — review succeeds even if email fails

#### `POST /api/admin/publish`
- **Body:** `{ submissionId }`
- **Action:** Validates submission status is `approved` (400 error otherwise). Generates markdown file with YAML frontmatter, pushes to GitHub repo via Contents API (base64-encoded). Updates submission status to `published` on success.
- **Response:** `{ success: true, message, filePath, repoUrl }`
- **Error Handling:** Early-fail with clear message if `GITHUB_TOKEN` is missing (500). Detailed error messages for common GitHub API failures (403, 401, 404, 409) with actionable guidance. Content encoding uses a safe byte-by-byte loop (not spread operator) to avoid `String.fromCharCode` argument limits with large articles.
- **⚠️ Ongoing Issue:** Classic `repo`-scoped tokens may still receive 403 from GitHub on the GET check (file existence). Investigation in progress — suspected causes: branch protection on `master`, token permissions, or repo access configuration. Switching to a **fine-grained token** with "Contents: Read and Write" permission on the specific repository is the recommended fix.

#### `GET /api/admin/articles`
- **Response:** `{ articles: [{ name, path, sha, url }] }`
- **Notes:** Fetches published articles from GitHub API (`src/content/blog/`)

#### `GET /api/admin/images`
- **Query:** `?folder=covers&page=1&limit=50`
- **Response:** `{ images: [...], total, page, limit, totalPages }`

#### `DELETE /api/admin/images`
- **Body:** `{ id, key }`
- **Action:** Deletes from both R2 and D1
- **Response:** `{ success: true, message }`

---

## 7. Pages Reference

### 7.1 Public Pages

| Page | Route | Prerender | Description |
|------|-------|-----------|-------------|
| Home | `/` | Static | Article grid with search, filter, sort |
| Research Digest | `/general` | Static | Two-panel browse |
| Case Reports | `/cases` | Static | Case report listing |
| CME & Learning | `/education` | Static | Board prep content |
| Clinical Guidelines | `/clinical-guidelines` | Static | Placeholder |
| Contributor Portal | `/contributors` | Static | Contributor listing + application modal |
| Contributor Profile | `/contributors/[id]` | SSR | Individual profile + published articles |
| Password Reset | `/contributors/reset-password` | Static | Token-based password reset form |
| Blog Article | `/blog/[...slug]` | Static | Individual article page |

### 7.2 Contributor Pages

| Page | Route | Prerender | Auth | Description |
|------|-------|-----------|------|-------------|
| Dashboard | `/contributors/dashboard` | Static | sessionStorage | Tabs: Overview, Submit Article, My Submissions |
| Settings | `/contributors/settings` | Static | sessionStorage | Profile form, password change, MFA setup |

#### Dashboard Features:
- **Overview tab:** Stats (total/pending/published), editorial guidelines
- **Submit Article tab:** Full form with cover image upload, in-text images (up to 5), markdown content, tags, exams
- **My Submissions tab:** Table of submitted articles with status badges
- **Sidebar:** Avatar initial, username, role badge, Settings link, Logout

### 7.3 Admin Pages

| Page | Route | Prerender | Auth | Description |
|------|-------|-----------|------|-------------|
| Admin Login | `/admin/login` | Static | None | Username + password login form |
| Admin Dashboard | `/admin` | SSR (auth check) | admin/co-admin | 4 tabs: Applications, Submissions, Articles, Images |

#### Admin Dashboard Features:
- **Sticky top bar:** Logo, admin badge, user name, Settings button (⚙️), Logout button (↪️)
- **Settings drawer (right panel):** Profile form, password change, MFA setup, theme toggle (Dark/Light/System)
- **Applications tab:** Table with Accept/Reject buttons for pending applications
- **Submissions tab:** Table with Approve/Reject/Publish buttons
- **Articles tab:** List of published articles on GitHub
- **Images tab:** Image grid with folder filter, copy URL, delete, admin upload form
- **Responsive:** Mobile breakpoint at 640px hides labels, shows icon-only buttons

---

## 8. Email System (SES)

### 8.1 Email Template (`_email-template.js`)

Centralized branded HTML email builder with:

- **Theme:** Indigo (#6366f1 primary, #4f46e5 dark)
- **Layout:** Gradient header → white body → gray footer
- **All inline CSS** (email client compatible)
- **Components:**
  - `buildEmail({ subject, preview, content })` — Full HTML document wrapper
  - `buildButton(text, href)` — CTA button styled with brand color
  - `buildInfoBox(content, type)` — Info/success/warning/danger boxes
  - `escapeHTML(str)` — HTML entity escaping

### 8.2 Email Templates

| Template | Trigger | Subject |
|----------|---------|---------|
| `buildAcceptanceEmail` | Admin accepts application | "Welcome to iMedipedia — Your Contributor Account is Ready" |
| `buildRejectionEmail` | Admin rejects application | "Update on Your iMedipedia Contributor Application" |
| `buildPasswordResetEmail` | User requests forgot password | "Reset Your iMedipedia Password" |
| `buildSubmissionReceivedEmail` | Contributor submits article | "We've Received Your Article Submission: "[title]"" |
| `buildSubmissionApprovedEmail` | Admin approves submission | "Your Article Has Been Approved: "[title]"" |
| `buildSubmissionRejectedEmail` | Admin rejects submission | "Update on Your Article Submission: "[title]"" |

### 8.3 SES Configuration

- **SDK:** `@aws-sdk/client-ses` v3.600.0
- **Region:** `AWS_REGION` env var (default: `ca-central-1`)
- **Credentials:** `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
- **From:** `SES_FROM_EMAIL` env var

### 8.4 Known SES Issue

`@aws-sdk/client-ses` v3.600.0 triggers `DOMParser` during response deserialization in Cloudflare Workers. The email IS sent successfully (AWS processes `SendEmailCommand`), but parsing the XML/response fails. Email sending is wrapped in try/catch in all endpoints to prevent this from breaking the API response.

---

## 9. Image Storage (R2)

### 9.1 R2 Configuration

- **Bucket:** `imedipedia-images`
- **Public URL:** `https://pub-de453f39846f4eaaad0901e220a5894f.r2.dev`
- **Binding:** `IMAGES` (native Cloudflare Workers binding)
- **Fallback:** S3-compatible API via `@aws-sdk/client-s3` (for local dev without wrangler)

### 9.2 Upload Flow

1. Client converts image to base64 data URI (`FileReader.readAsDataURL()`)
2. `POST /api/images/upload` with `{ file: "data:image/...;base64,...", name, description, folder }`
3. Server validates type (JPEG/PNG/WebP/GIF) and size (max 1MB)
4. Decodes base64 to `Uint8Array`
5. Generates key: `{folder}/{yyyy}/{mm}/{uuid}-{slug}.{ext}`
6. Uploads to R2 (native binding preferred, S3 fallback)
7. Tracks in D1 `images` table

### 9.3 Image Folders

| Folder | Purpose |
|--------|---------|
| `covers` | Article cover/featured images |
| `inline` | In-text article images |
| `uploads` | General/admin uploads |

### 9.4 Admin Image Management

- **List:** Paginated, filterable by folder
- **Copy URL:** Copies R2 public URL to clipboard
- **Delete:** Removes from both R2 and D1
- **Upload:** Admin can upload directly from dashboard

### 9.5 Article Submission Image Workflow

1. Contributor selects cover image → preview shown
2. Contributor adds in-text images (up to 5 slots)
3. On form submit → images uploaded to R2 first
4. R2 URLs returned → embedded in submission payload
5. Cover image: stored in `submissions.image`
6. In-text URLs shown in slot for copy/paste into markdown body

---

## 10. Theme System

### 10.1 Implementation

- **Dark theme** is default (`:root` CSS custom properties)
- **Light theme** overrides with `[data-theme="light"]` selector
- **System mode:** No `data-theme` attribute on `<html>`, relies on `prefers-color-scheme` media query

### 10.2 Theme-Blocking Script

In `BaseLayout.astro`, a synchronous `<script is:inline>` runs before page paint:
```javascript
(function(){
  var t = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
```

This prevents the "flash of wrong theme" on page navigation.

### 10.3 Theme Toggle

- **Admin settings:** Dark/Light/System buttons, updates `localStorage.theme` + `documentElement.data-theme`
- **Site navbar:** Toggle button updates theme and stores preference

---

## 11. Environment Variables

### 11.1 Cloudflare Pages / Workers

Set in Cloudflare Dashboard → Pages → Settings → Environment variables:

| Variable | Required | Purpose |
|----------|----------|---------|
| `AWS_REGION` | Yes (for SES) | AWS SES region (e.g., `ca-central-1`) |
| `AWS_ACCESS_KEY_ID` | Yes (for SES) | AWS IAM access key |
| `AWS_SECRET_ACCESS_KEY` | Yes (for SES) | AWS IAM secret key |
| `SES_FROM_EMAIL` | Yes (for SES) | Verified sender email |
| `R2_PUBLIC_URL` | Yes | Public R2 bucket URL |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Optional | S3-compatible R2 access key (for local dev) |
| `R2_SECRET_ACCESS_KEY` | Optional | S3-compatible R2 secret key (for local dev) |
| `R2_BUCKET_NAME` | Optional | Bucket name (default: `imedipedia-images`) |
| `GITHUB_TOKEN` | Optional | GitHub PAT for admin publish |
| `GITHUB_REPO` | Optional | Repo name (default: `drhimam/imedipedia`) |
| `AI_API_BASE_URL` | Optional | AI API endpoint |
| `AI_MODEL_NAME` | Optional | AI model name |

### 11.2 Local Development (`.dev.vars`)

Copy `.env.example` → `.dev.vars` and fill in values. Wrangler loads this automatically.

### 11.3 `wrangler.toml` Bindings

```toml
[[d1_databases]]
binding = "DB"
database_name = "imedipedia-db"
database_id = "8aeee120-4b92-44e1-b9d2-5f8b1566a52b"

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "imedipedia-images"
```

---

## 12. Deployment (Cloudflare Pages)

### 12.1 Configuration

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Git connected:** Pushes to `master` auto-deploy

### 12.2 Cross-Platform Build Fix

Windows-specific packages (`@cloudflare/workerd-windows-64`, `@esbuild/win32-x64`, `@rollup/rollup-win32-x64-msvc`) must NOT be in `dependencies` or `devDependencies`. They are transitive `optionalDependencies` and will fail `npm ci` on Linux (Cloudflare Pages build environment).

### 12.3 Astro Configuration

```javascript
// astro.config.mjs
export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare(),
  vite: {
    ssr: {
      external: ['sharp', 'node:fs/promises', 'node:path', 'node:fs']
    }
  }
});
```

---

## 13. Database Migration & Seeding

### 13.1 Applying Schema to Production

```bash
# Apply all CREATE TABLE IF NOT EXISTS statements
npx wrangler@latest d1 execute imedipedia-db --remote --file=schema.sql

# Seed admin user
node scripts/seed-db.js
npx wrangler@latest d1 execute imedipedia-db --remote --file=scripts/seed-output.sql
```

### 13.2 Default Admin Credentials

- **Username:** `admin`
- **Password:** `admin123`
- **Role:** `admin`
- **Email:** `admin@imedipedia.org`

> ⚠️ Change the default password immediately after first login via Settings → Change Password.

### 13.3 Important D1 Notes

- Use `npx wrangler@latest` (v4+) — older v3 has authentication issues (error 7403)
- `compatibility_flags = ["nodejs_compat"]` is required in `wrangler.toml`
- In API routes, access D1 via: `locals.runtime?.env?.DB` (Cloudflare Pages) or `locals.runtime?.env?.D1_DB`

---

## 14. Known Issues & Resolved Bugs

### 14.1 Astro Script Scoping (RESOLVED)

**Symptom:** Buttons with inline `onclick` handlers not responding to clicks (admin settings, logout, accept, reject; contributor MFA setup).

**Root Cause:** Astro bundles `<script>` tags by default (wrapping functions in module scope). Inline `onclick="functionName()"` looks for `functionName` in global scope, but bundled scripts put functions in an IIFE/module.

**Fix:** Add `is:inline` to `<script>` tags where functions are called via inline `onclick`. Pages affected:
- `src/pages/admin.astro` — line 327: `<script is:inline>`
- `src/pages/contributors/settings.astro` — line 69: `<script is:inline>`
- `src/pages/contributors/dashboard.astro` — line 231: already had `is:inline` ✅

**Commit:** `379cacf`, `682fe61`

### 14.2 Contributor Application Form — camelCase vs snake_case (RESOLVED)

**Symptom:** "Name, email, about_me, and writing_experience are required." error despite filling all fields.

**Root Cause:** Form JS sent `{ aboutMe, writingExperience, portfolioLinks }` (camelCase) but API `/api/applications/submit` destructures `{ about_me, writing_experience, portfolio_links }` (snake_case).

**Fix:** Changed JS payload keys to snake_case in `src/pages/contributors.astro`.

**Commit:** `f723163`

### 14.3 SES DOMParser Error on Application Review (RESOLVED)

**Symptom:** "Review failed: DOMParser is not defined" on accepting/rejecting applications. Email sent, user created, but error response returned.

**Root Cause:** `@aws-sdk/client-ses` v3.600.0 calls `DOMParser` during response deserialization in Cloudflare Workers. Email IS sent (AWS processes `SendEmailCommand`), but response parsing throws.

**Fix:** Wrapped `sendSESEmail()` in try/catch in `src/pages/api/admin/application-review.js`. Email failures are logged but don't fail the operation. Accept path returns `{ success: true, message: "...${emailResult}" }` where `emailResult` indicates if email was sent cleanly.

**Commit:** `f6b113b`

### 14.4 Admin Page — No Auth Protection (RESOLVED)

**Symptom:** `/admin/` directly landed on dashboard without login.

**Fix:** Added `export const prerender = false;` and SSR session/role verification in `src/pages/admin.astro`. Server reads `session_id` cookie, checks D1, verifies admin/co-admin role, redirects to `/admin/login` if unauthorized.

**Commit:** `295b368`

### 14.5 Admin Settings/Logout — Not Responsive / Grouped Together (RESOLVED)

**Symptom:** Logout was inside the Settings drawer. No mobile-friendly layout.

**Fix:** Separated Settings (⚙️) and Logout (↪️) into distinct top-bar buttons with a vertical divider. Logout styled red. Mobile breakpoint at 640px shows icon-only buttons without labels.

**Commit:** `e672a4c`

### 14.6 Dashboard Tab Buttons — Settings Link Error (RESOLVED)

**Symptom:** "Submit Article" and "My Submissions" tabs sometimes unresponsive.

**Root Cause:** Settings link (`<a href="/contributors/settings" class="tab-btn">`) was selected by `document.querySelectorAll('.tab-btn')`. Click handler tried `document.getElementById('settingsPanel')` which doesn't exist, causing `null` error.

**Fix:** Tab click handler now checks `btn.getAttribute('data-tab')` — if null (Settings link), returns early. Also null-checks `document.getElementById(panelId)` before adding class.

**Commit:** `682fe61`

### 14.7 Windows Build Packages (RESOLVED)

**Symptom:** Cloudflare Pages build failed — `@cloudflare/workerd-windows-64` couldn't install on Linux.

**Fix:** Marked as `optionalDependencies` in `package.json`. Regenerated `package-lock.json` with `npm install --package-lock-only`. Both top-level and nested `workerd` entries for `workerd-windows-64` have `"optional": true` in the lock file. The root `optionalDependencies` block provides an additional safety net.

**Commit:** `ba9f6fe`, `82c7ddd`, `27e4b4e`

### 14.8 GitHub Publishing 403 (INVESTIGATING)

**Symptom:** Admin publish returns "GitHub authentication failed (403)" when checking file existence (GET) on `https://api.github.com/repos/drhimam/imedipedia/contents/...`. The `GITHUB_TOKEN` (classic, `repo` scope) works locally but fails in Cloudflare Pages runtime.

**Troubleshooting Steps Taken:**
1. Verified token is classic with full `repo` scope, expires Nov 2026, no SSO required
2. Token works for GET requests from local machine (curl returns 200)
3. Both `GITHUB_TOKEN` and `GITHUB_REPO` environment variables are set in Cloudflare Pages dashboard
4. Base64 encoding improved: switched from `String.fromCharCode(...encoded)` spread operator (which hits argument limits with large content) to a safe byte-by-byte loop
5. Error messages now include GitHub's raw error response body for debugging

**Current Hypothesis:** Classic token may have a permission gap that the Cloudflare Pages runtime exposes. The GET check fails before ever reaching the PUT — so the token can't read the repository from Cloudflare's IP range, even though it works locally.

**Recommended Fix:** Switch to a **fine-grained personal access token**:
1. Go to https://github.com/settings/tokens?type=beta
2. Create token with "Only select repositories" → `drhimam/imedipedia`
3. Permission: "Contents" → "Read and Write"
4. Update `GITHUB_TOKEN` in Cloudflare Pages dashboard

**Related Commits:** `6cbd435`, `831a54e`

### 14.9 Submission Edit → Status Reversion (RESOLVED)

**Symptom:** When a contributor edits a published article, the admin approve button needs to re-activate for re-review.

**Fix:** `PUT /api/submissions/[id]` checks if `existing.status === 'published'` and reverts to `'pending'`. Admin sees the reverted submission in the pending queue with Approve/Reject buttons. On approval, the contributor receives a new approval email. On publish, the GitHub file is updated (SHA-based update, not duplicate).

**Commit:** `1bafa62`, `831a54e`

---

## 15. Development Guide

### 15.1 Local Setup

```bash
git clone https://github.com/drhimam/imedipedia.git
cd imedipedia
npm install

# Create .dev.vars from .env.example
cp .env.example .dev.vars
# Fill in required values

# Start dev server
npm run dev
```

### 15.2 Building

```bash
npm run build    # Production build
npm run preview  # Preview production build
```

### 15.3 D1 Operations

```bash
# Remote database queries
npx wrangler@latest d1 execute imedipedia-db --remote --command "SELECT * FROM users LIMIT 5"

# Apply schema
npx wrangler@latest d1 execute imedipedia-db --remote --file=schema.sql

# Interactive shell (local)
npx wrangler@latest d1 execute imedipedia-db --local
```

### 15.4 Important Conventions

1. **All API routes** must declare `export const prerender = false;`
2. **Inline onclick handlers** require `<script is:inline>` — without it, Astro bundles the script and functions aren't global
3. **Session cookie pattern:** Read `session_id` cookie → check D1 `sessions` table → get user → verify role
4. **D1 binding access:** `locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB` (supports both naming conventions)
5. **R2 upload:** Try native `env.IMAGES.put()` first, fall back to S3 SDK `PutObjectCommand`
6. **SES email sending:** Always wrap in try/catch — response parsing may fail in Workers runtime
7. **API keys in form payloads:** Use `snake_case` for all JSON keys (matches API expectations)
8. **Cross-platform compatibility:** Never add `@cloudflare/workerd-*`, `@esbuild/*`, or `@rollup/*` to direct dependencies

### 15.5 Adding a New API Route

```javascript
// src/pages/api/my-endpoint.js
export const prerender = false;

async function getSessionUser(db, request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(/session_id=([^;]+)/);
  if (!match) return null;
  const sessionId = match[1];
  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare(
    "SELECT * FROM sessions WHERE id = ? AND expires_at > ?"
  ).bind(sessionId, now).first();
  if (!session) return null;
  return await db.prepare("SELECT * FROM users WHERE id = ?")
    .bind(session.user_id).first();
}

export async function GET({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "DB unavailable" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const user = await getSessionUser(db, request);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  // ... your logic ...

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}

export async function POST({ request, locals }) {
  // ... similar pattern ...
}
```

---

> **Document maintained by:** Claude Code
> **Repository:** https://github.com/drhimam/imedipedia
> **Production:** https://imedipedia.pages.dev
