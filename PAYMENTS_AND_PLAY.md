# Payments and Android release

This branch prepares native Google Play subscriptions using RevenueCat. It does not activate billing, create store products, deploy the backend, or submit an app. Expo SDK 54 / React Native 0.81 replaces SDK 51; Capacitor is unnecessary for this React Native app.

## Product behavior

Scanning, importing, viewing, self-signing and PDF sharing remain core features. When billing is enabled, OCR and creating signature requests require the server-verified `docuall_pro` entitlement. Existing signature recipients do not need Pro. Billing defaults to disabled, preserving existing access until launch. Membership shows store-provided monthly/annual prices, restore, status retry, management and legal links.

The server derives a RevenueCat customer ID with HMAC; the document bearer credential is never sent to the purchase SDK. Keep the HMAC secret stable and private: rotation changes purchase identities. Native purchase success alone never unlocks Pro. The backend verifies the entitlement, configured product, expiry/grace period, refund state and sandbox status against RevenueCat on each protected request.

## Environments

Both app `EXPO_PUBLIC_BILLING_MODE` and server `DOCUALL_BILLING_MODE` must match.

| Mode | Public SDK key | Backend accepts | Purpose |
| --- | --- | --- | --- |
| disabled | none | billing gates off | Default deployment; no checkout |
| test | test_... | sandbox subscriptions only | RevenueCat simulated Test Store |
| play-test | goog_... | sandbox subscriptions only | Separate staging server, Google Play license testers |
| live | goog_... | non-sandbox subscriptions only | Production after validation |

The production EAS profile rejects test and play-test modes. A staging Google key is not itself a guarantee of free checkout: use an enrolled Play license tester, install through the test track, and confirm the checkout states test payment. Keep staging data and credentials separate. Never disable production sandbox rejection to test.

Backend variables (server environment only):

- `DOCUALL_BILLING_MODE`
- `REVENUECAT_SECRET_API_KEY`: RevenueCat server API credential.
- `DOCUALL_BILLING_ID_SECRET`: random secret of at least 32 characters; back it up securely.
- `DOCUALL_BILLING_PRODUCT_IDS`: comma-separated exact product identifiers returned by RevenueCat. Include base-plan suffixes if the provider returns them.

App/build variables (public, bundled; never put server credentials here):

- `EXPO_PUBLIC_BILLING_MODE`
- `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`
- `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`: hosted HTTPS pages describing actual practices.
- `EAS_PROJECT_ID`: Expo project ID.
- `EXPO_PUBLIC_API_URL`: optional deployment override; production requires HTTPS.

## Account setup still required

1. Verify ownership/availability of Android package `com.docuall.app`, create/link the Expo project and configure signing credentials.
2. Configure a RevenueCat Android app and its Google Play service account integration. Create the `docuall_pro` entitlement and default offering with monthly and annual subscription packages. Choose actual prices, markets and base plans in Play Console; no prices have been chosen or activated by this code.
3. Map both products to that entitlement. Set the backend allowlist to their exact provider identifiers. Select and test RevenueCat restore/transfer behavior for reinstall and multiple devices. Purchase restoration does not recover documents: existing identity is installation-based, not an account.
4. Publish accurate privacy/terms pages, support contact and Play Data safety declarations. Disclose server-stored documents, optional AI processing, and RevenueCat/Google purchase processing. Do not claim end-to-end encryption. Resolve authentication/storage limitations in VALIDATION.md before a broad commercial rollout.
5. Configure a separate staging backend and EAS `play-test` build. Upload its signed AAB to an internal track and enroll license testers. Verify purchase, cancellation, renewal, grace, expiry, refund/revocation, reinstall/restore and outages. Confirm test purchases cannot unlock production.
6. Build a release AAB, inspect merged permissions and Billing Library version, verify 16 KB native library compatibility, and run Play pre-launch testing. Test camera, photo picker, document import, signing gestures, sharing and keyboard/back behavior on physical Android devices.
7. Only after these checks, change the production profile's explicit disabled mode to live and configure the production backend live mode. Release to a limited rollout and monitor purchase verification failures.

## Build and validation commands

From frontend:

```
npm ci
npm test
npm run typecheck
npx expo install --check
npx expo prebuild --platform android --no-install
npx expo export --platform android --output-dir dist-android
npx eas-cli build --platform android --profile production
```

The final command requires the owner's Expo project/account and signing configuration and has not been run. Native purchase testing needs a development/release build; Expo Go cannot validate the purchase SDK. Generated android/ios directories are excluded so EAS regenerates native settings from app.config.js/app.json.

From backend:

```
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Automated provider tests use mocks. Passing them or producing a JavaScript bundle is not evidence of a working Play checkout or a signed, installable AAB.
