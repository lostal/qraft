# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run dev      # Dev server with hot reload
pnpm run build    # Static build to dist/
pnpm run preview  # Preview production build
```

No linting, testing, or formatting scripts are configured.

## Architecture

**Qraft** is a static, fully client-side QR code generator that extracts brand colors and favicon from any URL and applies them to the generated QR code. No backend, no persistence.

**Stack:** Astro 4 (static output) + React 18 (single client-only island) + TypeScript strict + Tailwind CSS.

**Key libraries:**

- `qrcode-generator` — QR matrix generation (error correction level H, 30% capacity)
- `qr-code-styling` — Canvas/SVG rendering for "center favicon" mode (dynamically imported)
- `colorthief` — Palette extraction from favicon image (dynamically imported)

**Entry flow:**

1. `src/pages/index.astro` renders a single `<QRGenerator client:only="react" />` island
2. On submit, favicon is fetched via Google's favicon API + wsrv.nl CORS proxy (8s timeout)
3. ColorThief extracts 8 colors; luminance filtering keeps ≤4 high-contrast options
4. QR renders in one of two modes:

| Mode                         | Implementation                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Center favicon               | `qr-code-styling` library draws QR with favicon centered                                                                                                                                                                                             |
| Artistic (favicon-as-points) | Custom canvas in `src/lib/generateArtisticQR.ts`: Otsu threshold binarizes a 64×64 favicon, overlays dots only in center zone (~13% of QR area, within H-level's 30% EC budget). Finder patterns and alignment markers are protected from overwrite. |

Export supports PNG (multiple resolutions) and SVG.

## Conventions

- **Language:** All UI text, comments, and variable names are in Spanish.
- **Section separators:** `/* ─── section name ──────── */` style comments inside TSX/TS files.
- **Design tokens:** Custom Tailwind palettes `ink` (grayscale, 50–950) and `caoba` (brown accent). Custom utility classes (`.input-field`, `.btn-primary`, `.btn-secondary`, `.color-swatch`) are defined in `src/styles/global.css` via `@layer components`.
- **Dynamic imports:** `qr-code-styling` and `colorthief` are imported dynamically inside callbacks to keep the initial bundle small.
