const {test}=require('node:test');
const assert=require('node:assert/strict');
const config=require('../app.config');
function withEnv(values,fn){const original={...process.env}; for(const name of ['EXPO_PUBLIC_BILLING_MODE','EXPO_PUBLIC_REVENUECAT_ANDROID_KEY','EXPO_PUBLIC_PRIVACY_URL','EXPO_PUBLIC_TERMS_URL','EAS_BUILD_PROFILE']) delete process.env[name]; Object.assign(process.env,values); try{fn();}finally{process.env=original;}}
test('billing defaults disabled',()=>withEnv({},()=>assert.equal(config().extra.billingMode,'disabled')));
test('production rejects Test Store',()=>withEnv({EAS_BUILD_PROFILE:'production',EXPO_PUBLIC_BILLING_MODE:'test',EXPO_PUBLIC_REVENUECAT_ANDROID_KEY:'test_example'},()=>assert.throws(config,/cannot ship/)));
test('test mode rejects real store key',()=>withEnv({EXPO_PUBLIC_BILLING_MODE:'test',EXPO_PUBLIC_REVENUECAT_ANDROID_KEY:'goog_example'},()=>assert.throws(config,/Test Store/)));
test('live mode requires public Google key and policies',()=>withEnv({EXPO_PUBLIC_BILLING_MODE:'live',EXPO_PUBLIC_REVENUECAT_ANDROID_KEY:'goog_example'},()=>assert.throws(config,/privacy/)));
test('server secret cannot be bundled as SDK key',()=>withEnv({EXPO_PUBLIC_BILLING_MODE:'live',EXPO_PUBLIC_REVENUECAT_ANDROID_KEY:'sk_secret'},()=>assert.throws(config,/public key/)));
test('production rejects Play staging',()=>withEnv({EAS_BUILD_PROFILE:'production',EXPO_PUBLIC_BILLING_MODE:'play-test',EXPO_PUBLIC_REVENUECAT_ANDROID_KEY:'goog_example'},()=>assert.throws(config,/cannot ship/)));
test('Play staging uses Google SDK key',()=>withEnv({EXPO_PUBLIC_BILLING_MODE:'play-test',EXPO_PUBLIC_REVENUECAT_ANDROID_KEY:'goog_example'},()=>assert.equal(config().extra.billingMode,'play-test')));
