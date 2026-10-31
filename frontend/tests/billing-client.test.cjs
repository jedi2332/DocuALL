const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('src/lib/billing.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
function load({platform='android',ownership='standalone',mode='test',key='test_example',verify=async()=>({pro:false}),purchase=async()=>({customerInfo:{entitlements:{active:{docuall_pro:{}}}}})}={}){
 const exports={}; const calls=[];
 const sdk={configure:options=>calls.push(options),purchasePackage:purchase,restorePurchases:async()=>({}),getOfferings:async()=>({current:{availablePackages:[]}})};
 vm.runInNewContext(source,{exports,require:name=>{
  if(name==='expo-constants')return {__esModule:true,default:{appOwnership:ownership,expoConfig:{extra:{billingMode:mode,revenueCatAndroidKey:key}}}};
  if(name==='react-native')return {Platform:{OS:platform}};
  if(name==='react-native-purchases')return {__esModule:true,default:sdk};
  if(name==='./api')return {api:{billingStatus:verify}};
  throw Error(name);
 }});return {...exports,calls};
}
const status={mode:'test',pro:false,customer_id:'opaque-server-issued-id'};
test('concurrent initialization configures SDK once with server identity',async()=>{const c=load(); await Promise.all([c.billingClient(status),c.billingClient(status)]);assert.equal(c.calls.length,1);assert.equal(c.calls[0].appUserID,status.customer_id);});
test('web and Expo Go cannot launch native purchase',async()=>{for(const options of [{platform:'web'},{ownership:'expo'}]){const c=load(options);await assert.rejects(c.billingClient(status),/Android app/);assert.equal(c.calls.length,0);}});
test('mismatched environment cannot launch purchase',async()=>{const c=load({key:'goog_real'});await assert.rejects(c.billingClient(status),/not available/);assert.equal(c.calls.length,0);});
test('native success does not override server rejection',async()=>{const c=load();const result=await c.purchasePlan(status,{});assert.equal(result.pro,false);});
test('verification failure propagates without granting Pro',async()=>{const c=load({verify:async()=>{throw Error('verification unavailable');}});await assert.rejects(c.purchasePlan(status,{}),/verification unavailable/);});
test('restore uses server verification',async()=>{let checked=0;const c=load({verify:async()=>{checked++;return {pro:true};}});assert.equal((await c.restorePlan(status)).pro,true);assert.equal(checked,1);});
test('changing billing identity requires restart',async()=>{const c=load();await c.billingClient(status);await assert.rejects(c.billingClient({...status,customer_id:'another-id'}),/Restart/);});
