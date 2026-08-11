# iMedipedia — Medical Research Platform

An advanced medical news and scientific research compilation platform built with [Astro](https://astro.build/) and [TinaCMS](https://tina.io/). Provides evidence-based summaries, clinical updates, case reports, and board review content for medical practitioners worldwide.

## Features

- **Research Digest** — Browse medical articles by subject and topic
- **Clinical Advances** — Latest breakthroughs in clinical medicine
- **Case Reports** — Peer-reviewed clinical case database
- **CME & Learning** — Board preparation questions and educational content
- **Contributor Portal** — Author profiles, application system, and contributor dashboard
- **Dark/Light Theme** — System-aware theme with no flash-of-wrong-theme on navigation
- **AI-Powered Summaries** — Automated TL;DR generation for articles

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Astro 4](https://astro.build/) (Hybrid mode) |
| CMS | [TinaCMS](https://tina.io/) |
| Deployment | [Cloudflare Pages](https://pages.cloudflare.com/) |
| Styling | Scoped CSS with CSS custom properties |
| Fonts | Outfit + Plus Jakarta Sans (Google Fonts) |
| Comments | [Cusdis](https://cusdis.com/) |
| Email | AWS SES |

## Project Structure

```
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro      # Shared layout (nav, footer, theme, fonts)
│   ├── pages/
│   │   ├── index.astro           # Home — article grid with search/filter/sort
│   │   ├── general.astro         # Research Digest — two-panel browse
│   │   ├── cases.astro           # Case Reports
│   │   ├── update.astro          # Clinical Advances
│   │   ├── education.astro       # CME & Learning
│   │   ├── contributors.astro    # Contributor portal + application modal
│   │   ├── contributors/
│   │   │   ├── [id].astro        # Individual contributor profile
│   │   │   └── dashboard.astro   # Author dashboard (tabs, upload, forms)
│   │   ├── blog/
│   │   │   └── [...slug].astro   # Individual blog article
│   │   └── api/                  # API routes (auth, AI generation, Tina backend)
│   └── content/
│       └── blog/                 # Markdown/MDX articles managed by TinaCMS
├── public/                       # Static assets (images, admin panel)
├── astro.config.mjs              # Astro config (hybrid + Cloudflare adapter)
└── package.json
```

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

| Variable | Purpose |
|----------|---------|
| `AWS_ACCESS_KEY_ID` | AWS SES email sending |
| `AWS_SECRET_ACCESS_KEY` | AWS SES email sending |
| `AWS_REGION` | AWS SES region |

## Deployment

The site is configured for **Cloudflare Pages** via the `@astrojs/cloudflare` adapter in **hybrid** output mode. Static pages are prerendered; dynamic pages (search, filtering) are server-rendered on Cloudflare Workers.

## License

MIT
