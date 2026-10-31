DocuALL upgrade package

Included upgrades

1. Saved profile autofill
Settings now stores name, email, phone, address, city, state, ZIP code, and employer on the DocuALL server. The signing screen has a Profile button that fills empty text fields in order from the saved profile.

2. Form templates
The home screen has quick starts for Leave form, Expense report, and Application. Each starts a scan with the selected document name.

3. Email finished PDF
The document screen has an Email button. On iOS and Android it opens the native mail composer with the finished PDF attached. On web, Share remains the correct route because web browsers cannot attach a local file through the native composer.

4. Real app icon
The placeholder artwork was replaced with a DocuALL gold document and scan frame icon on charcoal.

5. OCR
The document screen has an OCR button. Searchable PDFs use built in PDF text extraction. Image scans use pytesseract when the server has both pytesseract and the system tesseract OCR package installed. The endpoint returns a clear setup error when OCR is not installed.

6. Signing link expiry
Signing links now default to 30 days and can be set to 7, 30, or 90 days. Expired links return a clear expired response and cannot be completed.

Validation

The frontend TypeScript check passed. The backend syntax check passed. A backend smoke test passed for the saved profile endpoint.

Deployment note

For image scan OCR on the server, install tesseract OCR at the operating system level in addition to the Python requirements. The native APK still needs an Expo account and token for the EAS build route.
