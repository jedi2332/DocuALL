# Validation and remaining work

Run backend regression checks from `backend`:

```
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Run frontend checks from `frontend`:

```
npm ci
npx tsc --noEmit
npm test
```

This pass verifies revoked/expired/completed signing-link access, active-file ownership, document deletion, corrupt-database preservation, and concurrent device-identity initialization. Eight backend tests and three identity tests passed; TypeScript checking passed.

Native device interaction and production deployment have not been verified. Test scanning, repeated signature dragging, returning from signing, sharing/emailing a PDF, and revoking a link on a real device before release.

Follow-up work: replace the device-ID bearer credential with account/session authentication; handle concurrent signing/cancellation atomically; track and clean up old signed-file revisions; report and retry filesystem deletion failures; add multiprocess-safe database storage. Old unreferenced files are denied by the file endpoint, but this change does not erase legacy orphan files from disk. Do not describe the current storage as end-to-end encrypted or guaranteed secure erasure.

## Billing and SDK 54 pass

21 backend tests and 17 frontend tests passed, including expiry, cancellation,
refund, sandbox separation, forged client entitlement, provider outage,
concurrent SDK initialization, restore verification and production configuration guards.
TypeScript and Expo dependency compatibility checks passed. Android native
prebuild and Android JavaScript/Hermes bundle export passed. Generated manifest
disables backup/cleartext traffic and removes microphone, broad storage/media,
and overlay permissions; generated compile/target SDK is 36.

No native Gradle/AAB build, physical-device UI check, live provider call or actual
store purchase was performed. Account/product provisioning and hosted legal
pages remain required. See PAYMENTS_AND_PLAY.md for the staged rollout procedure.
Billing remains disabled by default.

## PDF page tools pass

Added a home-screen PDF tools workflow to combine up to 10 documents / 100 pages,
extract selected pages, reorder, rotate, remove and undo. Saves a separate PDF;
source files and signing requests remain unchanged. Text remains selectable.
Rotated output is normalized so subsequent signing uses consistent coordinates.
Interactive forms are rejected rather than silently breaking their fields.
Page tools are not a redaction or metadata-sanitization feature and do not
preserve digital-signature certification.

31 backend tests and 17 frontend tests pass. The new integration tests cover
page order/text, rotation, extraction, cross-owner/deleted-source denial,
invalid selections, source size limits, corrupt/encrypted PDFs, failed-write
cleanup and private output access. PDF imports now validate before writing.
TypeScript and Android JavaScript export pass. Physical-device UI testing
remains outstanding; this is source work, not a deployed release.
