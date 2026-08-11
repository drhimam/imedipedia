# iMedipedia — Medical Research Platform

An advanced medical news and scientific research compilation platform built with [Astro](https://astro.build/) and [TinaCMS](https://tina.io/). Provides evidence-based summaries, clinical updates, case reports, and board review content for medical practitioners worldwide.

## Features

- **Research Digest** — Browse medical articles by subject and topic
- **Clinical Guidelines** — Evidence-based clinical practice protocols
- **Case Reports** — Peer-reviewed clinical case database
- **CME & Learning** — Board preparation questions and educational content
- **Contributor Portal** — Application system, author profiles, dashboard with article submissions
- **Admin Dashboard** — Application review, submission management, article publishing, image management
- **Authentication** — PBKDF2 password hashing, TOTP MFA, HttpOnly session cookies
- **R2 Image Storage** — Cover images and in-text images with admin management
- **Branded HTML Emails** — SES transactional emails (welcome, rejection, password reset)
- **Dark/Light Theme** — System-aware theme with no flash-of-wrong-theme on navigation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Astro 4](https://astro.build/) (Hybrid mode) |
| CMS | [TinaCMS](https://tina.io/) |
| Deployment | [Cloudflare Pages](https://pages.cloudflare.com/) |
| Database | Cloudflare D1 (SQLite at edge) |
| Object Storage | Cloudflare R2 |
| Email | AWS SES |
| Styling | Scoped CSS with CSS custom properties |
| Fonts | Outfit + Plus Jakarta Sans (Google Fonts) |
| Comments | [Cusdis](https://cusdis.com/) |

## Project Structure

```
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro      # Shared layout (nav, footer, theme, fonts)
│   ├── pages/
│   │   ├── index.astro           # Home — article grid with search/filter/sort
│   │   ├── general.astro         # Research Digest — two-panel browse
│   │   ├── cases.astro           # Case Reports
│   │   ├── education.astro       # CME & Learning
│   │   ├── clinical-guidelines.astro  # Clinical Guidelines
│   │   ├── contributors.astro    # Contributor portal + application modal
│   │   ├── contributors/
│   │   │   ├── [id].astro        # Individual contributor profile
│   │   │   ├── dashboard.astro   # Author dashboard (tabs, upload, forms)
│   │   │   └── settings.astro    # Account settings (profile, password, MFA)
│   │   ├── admin.astro           # Admin dashboard (SSR auth-protected)
│   │   ├── admin/
│   │   │   └── login.astro       # Admin login page
│   │   ├── blog/
│   │   │   └── [...slug].astro   # Individual blog article
│   │   └── api/                  # API routes (auth, admin, submissions, images)
│   └── content/
│       └── blog/                 # Markdown/MDX articles managed by TinaCMS
├── scripts/
│   └── seed-db.js                # Database seeding script
├── docs/
│   └── WALKTHROUGH.md            # Full implementation documentation
├── schema.sql                    # D1 database schema
├── wrangler.toml                 # Cloudflare bindings (D1, R2, vars)
├── public/                       # Static assets
├── astro.config.mjs              # Astro config (hybrid + Cloudflare adapter)
└── package.json
```

## Documentation

See **[docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)** for the complete implementation walkthrough covering:

- Architecture & tech stack details
- Database schema (7 tables)
- Authentication & authorization (PBKDF2 + TOTP MFA + session cookies)
- All API routes reference (20+ endpoints)
- Pages reference with features
- Email system (SES + branded HTML templates)
- Image storage (R2 + upload flow)
- Theme system implementation
- Environment variables reference
- Deployment configuration
- Known issues and resolved bugs
- Development guide

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/drhimam/imedipedia.git
cd imedipedia

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### TinaCMS

To run with the TinaCMS admin panel:

```bash
npm run tina:dev
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `AWS_ACCESS_KEY_ID` | Yes (SES) | AWS SES email sending |
| `AWS_SECRET_ACCESS_KEY` | Yes (SES) | AWS SES email sending |
| `AWS_REGION` | Yes (SES) | AWS SES region (e.g., `ca-central-1`) |
| `SES_FROM_EMAIL` | Yes (SES) | Verified SES sender email |
| `R2_PUBLIC_URL` | Yes | Public R2 bucket URL |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Optional | S3-compatible R2 key (local dev) |
| `R2_SECRET_ACCESS_KEY` | Optional | S3-compatible R2 secret (local dev) |
| `GITHUB_TOKEN` | Optional | GitHub PAT for admin publish |
| `GITHUB_REPO` | Optional | Repo name (default: `drhimam/imedipedia`) |

Copy `.env.example` to `.dev.vars` for local development with wrangler.

## Deployment

The site is configured for **Cloudflare Pages** via the `@astrojs/cloudflare` adapter in **hybrid** output mode. Static pages are prerendered; dynamic pages (search, filtering) are server-rendered on Cloudflare Workers.

## License

MIT
