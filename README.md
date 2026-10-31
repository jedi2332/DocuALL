# DocuALL

A document scanner app: scan or import pages/PDFs, auto-build a PDF, sign it,
and share it anywhere. Rebuilt from your uploaded export - see "What changed"
below for why almost everything was rewritten.

## Stack
- **backend/** - FastAPI, stores everything on local disk (no database
  server, no API key required). `data/` is created automatically.
- **frontend/** - Expo (React Native + expo-router).

## Run the backend
```
cd backend
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt
cp .env.example .env                                # AI extraction stays off unless explicitly enabled
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```
Visit http://localhost:8000/api/ - you should see `{"message": "DocuALL backend", "ok": true}`.

Optional: `apt install poppler-utils` (or `brew install poppler` on Mac) so
imported PDFs get a real thumbnail instead of a generic placeholder icon.

## Run the frontend
```
cd frontend
npm install
npx expo install --fix   # aligns native module versions to this Expo SDK - important, don't skip
npx expo start
```
Scan the QR code with Expo Go (or press `i` / `a` for a simulator).

**Important:** on a physical phone, `localhost` in the app points at the
phone itself, not your computer. Open the app's **Settings** tab and set
the server address to your computer's LAN IP, e.g. `http://192.168.1.23:8000`
(find it with `ipconfig getifaddr en0` on Mac or `ipconfig` on Windows).

## Privacy defaults

Documents, signatures, and profile details are stored on the DocuALL server in its local data directory. The app does not send document images to an AI service by default. To opt in to AI field extraction, set both `OPENAI_API_KEY` and `DOCUALL_ENABLE_AI_EXTRACTION=true` in the backend environment; the first page of a scanned image is then sent to OpenAI for title/vendor/date/amount suggestions. Keep the flag unset or false to keep that processing off.

The API limits PDF uploads to 25 MB and rejects invalid device IDs before they are used as storage paths.

## Features
- **Scan**: camera capture with a **flashlight/torch** that's **on by default**
  when you open the scanner (tap the bolt icon top-right to turn it off) -
  it stays lit continuously while you frame the shot, which reads more
  evenly than a single flash pop on glossy paper.
- **Import**: photos from your library, or an existing PDF file, from the
  Documents tab.
- **Export / Share**: every document has Share and Export buttons that open
  the native iOS/Android share sheet - AirDrop, Messages, Mail, Drive,
  WhatsApp, "Save to Files", etc. all show up there automatically; that's
  also how you save a PDF to your device.
- **Signatures**: draw with your finger or type your name, save multiple,
  reuse them.
- **Prepare & sign (DocuSign-style)**: drop any mix of **Signature,
  Initials, Date, and Text** fields anywhere on any page, drag each into
  place, resize with +/-, edit text/date fields by tapping them, then
  apply everything in one pass. For imported PDFs the fields are stamped
  directly into the PDF; for scans they're composited onto the page image
  and the PDF is rebuilt.
- **Send for signature**: place the same kind of fields as blank
  placeholders for someone else, name them, and hit "Send link to sign" -
  it creates a link and opens the native share sheet so you can send it
  however you like (text, email, whatever). They open the link in any
  browser (no app install needed), fill in each field - drawing or typing
  their signature, same as the app itself - and submit; the fields land on
  your document automatically and the document screen shows the request's
  status (pending/completed).

## What changed from your upload, and why

The zip you sent had two separate problems:

1. **Missing files.** `Button.tsx`, `api.ts`, `docs-context.tsx`, and
   `theme.ts` were imported by your screens but not present in the zip, and
   there was no `package.json`, `app.json`, `tsconfig.json`,
   `requirements.txt`, or asset folder at all - so nothing in it could
   actually be installed or run as-is.
2. **Corrupted text.** In every `.tsx` file, virtually all JSX closing tags
   (`</View>`, `</Pressable>`, etc.) and comment markers had been stripped
   out, and the Python file had stray spaces breaking strings, routes, and
   `__file__`. Whatever produced this export mangled the source badly.

On top of that, the original backend was wired to a proprietary
Emergent.sh storage/AI proxy (`EMERGENT_LLM_KEY`, `integrations.emergentagent.com`)
that only works inside that platform - not something you could deploy
yourself.

Given that, patching the original file-by-file wasn't realistic, so I
rebuilt the app clean: same feature set (scan, import, sign, share/export),
plus the flashlight toggle you asked for, but self-hostable with your own
backend and no third-party dependency required to run it.

## Known limitations / next steps
- **Since you asked me to push further without a live run, here's exactly what I found and fixed on this pass, so you know what changed:**
  - `expo-image-picker`'s gallery-import calls were using the newer
    `mediaTypes: ["images"]` array syntax, which doesn't exist in the
    `~15.0.7` version pinned for this Expo SDK - that would have thrown at
    runtime the first time someone tapped "Import photos" or "Import from
    gallery". Fixed to `ImagePicker.MediaTypeOptions.Images`, the correct
    call for this version.
  - Removed a couple of dead/unused variables and imports (harmless, but
    worth tidying).
  - Added `.gitignore` files for both halves so `node_modules`, `venv`,
    and the local `data/` folder don't end up committed.
  - Added the `npx expo install --fix` step above - it corrects any
    native-module version drift against your installed Expo SDK
    automatically, which is the single most common source of "it crashed
    immediately" on a first Expo run.
- **No email sending.** "Send for signature" generates the link and hands
  it to the OS share sheet - there's no SMTP/SendGrid wired up, so you
  choose how it goes out (text, email app, whatever). Add a mail
  provider in the backend later if you want it sent automatically.
- **The link only works where your backend is reachable.** Since this is
  your own self-hosted server (not a public cloud service), the recipient
  needs network access to whatever host/IP the link points at - fine on
  your home network or over a tunnel (ngrok, Tailscale, etc.), but it
  won't work if you email it to someone across the internet unless your
  backend is actually deployed somewhere reachable.
- The signing-link page has no identity verification beyond "whoever has
  the link" - same model DocuSign's email links use, but worth knowing.
- Initials fields (in your own "Sign" flow) reuse your saved signatures
  (pick a small one) rather than having their own separate creation flow.
- App icons in `frontend/assets/` are simple placeholders I generated -
  swap in real artwork whenever you like.
- Typed signatures use the system font in italic. Drop a cursive `.ttf`
  into `frontend/assets/fonts` and `backend/assets/` and wire it up (see
  the comment in `src/hooks/use-app-fonts.ts` and `render_typed_signature`
  in `backend/pdf_utils.py`) for a more natural signature look.
- I wasn't able to `npm install` or run a simulator/device in the sandbox
  this was built in (no network access), so this hasn't been through a
  live end-to-end test run yet. What I *could* do without that - and did
  on this pass - was a full manual read-through of every file against the
  exact package versions pinned in `package.json` (which is how the
  `mediaTypes` bug above was found), plus re-running the Python/JS syntax
  checks. That's a real step up in confidence, but it's not a substitute
  for actually launching it. Please run through the core flows (scan →
  save → sign → share, and send-for-signature end to end) once on your
  machine - if anything else breaks, send me the exact error and I'll fix
  it immediately, that's normal for a first run of a project this size.
