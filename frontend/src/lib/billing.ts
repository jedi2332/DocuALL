import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { api } from './api';

export type BillingStatus = { mode: 'disabled' | 'test' | 'play-test' | 'live'; pro: boolean; expires_at: string | null; customer_id: string | null };
let initialized: Promise<typeof import('react-native-purchases').default> | null = null;
let configuredIdentity: string | null = null;

export async function billingClient(status: BillingStatus) {
  if (Platform.OS !== 'android' || Constants.appOwnership === 'expo') throw new Error('Purchases are available in the DocuALL Android app.');
  const config = Constants.expoConfig?.extra ?? {};
  const key = config.revenueCatAndroidKey as string | undefined;
  if (!status.customer_id || status.mode === 'disabled' || config.billingMode !== status.mode || !key ||
      !(status.mode === 'test' ? key.startsWith('test_') : key.startsWith('goog_'))) {
    throw new Error('Purchases are not available yet. Your documents are still accessible.');
  }
  if (configuredIdentity && configuredIdentity !== status.customer_id) throw new Error('Restart DocuALL after changing servers before managing purchases.');
  if (!initialized) {
    configuredIdentity = status.customer_id;
    initialized = (async () => {
      const Purchases = (await import('react-native-purchases')).default;
      Purchases.configure({ apiKey: key, appUserID: status.customer_id! });
      configuredIdentity = status.customer_id;
      return Purchases;
    })().catch(error => { initialized = null; configuredIdentity = null; throw error; });
  }
  return initialized;
}

export async function getPlans(status: BillingStatus) {
  const client = await billingClient(status);
  const offerings = await client.getOfferings();
  // Launch uses simple monthly/yearly subscriptions; no trial or introductory-price claims.
  return (offerings.current?.availablePackages ?? []).filter(p =>
    (p.packageType === 'MONTHLY' || p.packageType === 'ANNUAL') && p.product.price > 0);
}

export async function purchasePlan(status: BillingStatus, plan: PurchasesPackage) {
  const client = await billingClient(status);
  await client.purchasePackage(plan);
  return api.billingStatus(); // Native success alone never unlocks server features.
}

export async function restorePlan(status: BillingStatus) {
  const client = await billingClient(status);
  await client.restorePurchases();
  return api.billingStatus();
}
