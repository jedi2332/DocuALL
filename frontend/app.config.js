const app = require('./app.json').expo;
module.exports = () => {
  const billingMode = process.env.EXPO_PUBLIC_BILLING_MODE || 'disabled';
  const key = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';
  if (!['disabled', 'test', 'play-test', 'live'].includes(billingMode)) throw Error('Invalid billing mode');
  if (billingMode === 'test' && !key.startsWith('test_')) throw Error('Test mode requires a RevenueCat Test Store key');
  if (['live', 'play-test'].includes(billingMode) && !key.startsWith('goog_')) throw Error('Live mode requires a Google RevenueCat public key');
  if (process.env.EAS_BUILD_PROFILE === 'production' && ['test', 'play-test'].includes(billingMode)) throw Error('Test billing cannot ship in production');
  if (key && !/^(test_|goog_)/.test(key)) throw Error('Use only a public key');
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL || '';
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL || '';
  if (billingMode === 'live' && (![privacyUrl, termsUrl].every(url => /^https:\/\/[^\s]+$/.test(url)))) throw Error('Live checkout requires privacy and terms URLs');
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || app.extra.apiUrl;
  if (process.env.EAS_BUILD_PROFILE === 'production' && !/^https:\/\//.test(apiUrl)) throw Error('Production API requires HTTPS');
  return { ...app, extra: { ...app.extra, apiUrl, billingMode, revenueCatAndroidKey: key, privacyUrl, termsUrl,
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}) } };
};
