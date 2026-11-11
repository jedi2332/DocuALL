DOCUALL - SOURCE CODE AUDIT PACKAGE
Date: 2026-11-10
App: DocuALL (DocuALL Visual Studio / com.docuall.app)
Owner: Jedediah Pierce / Bad Dad LLC

ABOUT THIS PACKAGE:
This archive contains the full clean source code of DocuALL for technical and security audit.
Dependencies (node_modules) and generated binaries (apk/build artifacts) are excluded.

KEY SYSTEM ARCHITECTURE:
1. Framework: TanStack Start v1 / React 19 / Vite 7 / Tailwind CSS v4.
2. Mobile Shell: Capacitor v7 Android bridge (android/).
   - Native Plugin: DocuIntakePlugin.java handles incoming ACTION_VIEW and ACTION_SEND intents.
   - Zero broad storage permissions: content:// URIs are streamed via scoped cache into app memory.
   - Native Share-Back: shareSignedPdfAndroid streams completed signed docs to Android share sheet.
3. Backend & Storage: Lovable Cloud (Supabase Postgres, Auth, Storage).
   - Owner-scoped RLS policies on all public tables: documents, signatures, signing_requests,
     vault_projects, organize_settings, organize_runs, profiles.
   - Anonymous session onboarding with seamless account upgrade via updateUser.
4. Client-side Document & PDF Engine:
   - PDF rendering and stamping: pdf-lib and pdfjs-dist.
   - Text extraction: pure on-device (PDF text layer, docx/pptx XML, Tesseract OCR for camera scans).
   - Never sends private document contents or customer scans to external AI APIs.
5. Smart Clean & Organize Engine:
   - Pure sorting logic in src/lib/organize.ts and src/lib/fuzzy-match.ts.
   - CapCut / Project Vault & Freeze: protects active project paths, assets, and exact duplicates.
   - Typo-tolerant keyword matching with edit-distance tolerance.
   - Client-side ZIP bundling via JSZip with README.txt and CHANGES.txt manifests.

RUNNING LOCALLY:
1. Install Bun (https://bun.sh).
2. Run: bun install
3. Start dev server: bun run dev (serves on http://localhost:8080)
4. Run test suite: bun run test (39 automated unit & integration tests)
5. Build Android: bunx cap sync android && cd android && ./gradlew assembleDebug

CONTENTS CHECKLIST:
- src/                     Full React/TypeScript source code
  - components/            UI components, zoom frame, signature pad, brand logo, watermark
  - lib/                   Organize engine, fuzzy matcher, OCR reader, android bridge, pdf helpers
  - routes/                TanStack file-based routes (documents, organize, scan, signatures, settings)
  - test/                  Unit and integration test suites
- android/                 Capacitor Android wrapper and native DocuIntakePlugin
- android-shell/           Android webview bootstrap shell
- public/                  Web manifest, branding icons, splash graphics
- supabase/                Database migrations and RLS schema definitions
- drizzle/                 Database schema definitions
- package.json             Project dependencies and scripts
- capacitor.config.ts      Capacitor native app configuration
- tsconfig.json            TypeScript compiler options
- README.txt               This file
- DOCUALL-AUDIT-GUIDE.txt  Detailed audit checklist and security boundary review
