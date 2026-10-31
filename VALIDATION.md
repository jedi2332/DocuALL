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
node --test tests/device-id.test.cjs
```

This pass verifies revoked/expired/completed signing-link access, active-file ownership, document deletion, corrupt-database preservation, and concurrent device-identity initialization. Eight backend tests and three identity tests passed; TypeScript checking passed.

Native device interaction and production deployment have not been verified. Test scanning, repeated signature dragging, returning from signing, sharing/emailing a PDF, and revoking a link on a real device before release.

Follow-up work: replace the device-ID bearer credential with account/session authentication; handle concurrent signing/cancellation atomically; track and clean up old signed-file revisions; report and retry filesystem deletion failures; add multiprocess-safe database storage. Old unreferenced files are denied by the file endpoint, but this change does not erase legacy orphan files from disk. Do not describe the current storage as end-to-end encrypted or guaranteed secure erasure.
