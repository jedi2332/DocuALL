import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import type { PurchasesPackage } from 'react-native-purchases';
import { AppText } from '@/src/components/AppText';
import { Button } from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { BillingStatus, getPlans, purchasePlan, restorePlan } from '@/src/lib/billing';
import { colors, radius, spacing } from '@/src/theme/theme';

const httpsUrl = (value: unknown): string | null => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
};

export default function Membership() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState('');
  const config = Constants.expoConfig?.extra ?? {};
  const privacy = httpsUrl(config.privacyUrl);
  const terms = httpsUrl(config.termsUrl);
  const available = status && status.mode !== 'disabled' && status.mode === config.billingMode;

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    setPlans([]);
    setStatus(null);
    try {
      const next = await api.billingStatus();
      setStatus(next);
      if (next.mode !== 'disabled' && !next.pro) {
        const offered = await getPlans(next);
        setPlans(offered);
        if (!offered.length) setMessage('Plans are not available yet. Please try again later.');
      }
    } catch (e: any) {
      setMessage(e?.message ?? 'Could not check your plan. Please try again.');
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const transact = async (plan?: PurchasesPackage) => {
    if (!status || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      const next = plan ? await purchasePlan(status, plan) : await restorePlan(status);
      setStatus(next);
      setMessage(next.pro ? 'DocuALL Pro is ready.' : plan
        ? 'Your purchase is still being verified. Tap Check status shortly; do not purchase again.'
        : 'No active Pro subscription was found. Check that you are using the original store account.');
    } catch (e: any) {
      if (!e?.userCancelled) setMessage(e?.message ?? 'The purchase could not be verified. Check status before trying again.');
    } finally { locked.current = false; setBusy(false); }
  };
  const open = async (url: string) => {
    try { await Linking.openURL(url); } catch { setMessage('Could not open this page. Please try again.'); }
  };

  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }}>
    <Button title="Back to documents" variant="ghost" onPress={() => router.back()} disabled={busy} />
    <AppText size="2xl" weight="bold">DocuALL Pro</AppText>
    <AppText color={colors.onSurfaceSecondary}>Scan, import, sign your own documents, and share PDFs with the core app. Pro adds text extraction and sending documents to others for signature.</AppText>
    {loading ? <ActivityIndicator color={colors.brandPrimary} /> : <>
      <AppText weight="bold">{status?.pro ? 'Pro active' : status?.mode === 'disabled' ? 'Core access · Pro coming soon' : 'Choose your plan'}</AppText>
      {status?.mode === 'disabled' ? <AppText>Purchases are not enabled yet. You can keep using your documents.</AppText> : null}
      {status?.mode === 'play-test' ? <AppText>Google Play staging · use a configured license tester account only.</AppText> : null}
      {status?.mode === 'test' ? <AppText>Test checkout · no real payment</AppText> : null}
      {!status?.pro && available ? plans.map(plan => <View key={plan.identifier} style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
        <AppText size="lg" weight="bold">{plan.packageType === 'ANNUAL' ? 'Annual Pro' : 'Monthly Pro'}</AppText>
        <AppText>{plan.product.priceString} / {plan.packageType === 'ANNUAL' ? 'year' : 'month'}</AppText>
        <AppText size="sm">Automatically renews until cancelled. Manage or cancel in Google Play. Review the exact charge and any offer in checkout.</AppText>
        <Button title={`Continue · ${plan.product.priceString}`} disabled={busy || !privacy || !terms} onPress={() => transact(plan)} />
      </View>) : null}
      {available && (!privacy || !terms) ? <AppText>Checkout is not available yet.</AppText> : null}
    </>}
    {message ? <AppText accessibilityRole="alert">{message}</AppText> : null}
    <Button title="Check status" variant="secondary" onPress={load} disabled={busy || loading} />
    {available ? <Button title="Restore purchases" variant="secondary" onPress={() => transact()} disabled={loading || busy} loading={busy} /> : null}
    <Button title="Manage Google Play subscriptions" variant="ghost" onPress={() => open('https://play.google.com/store/account/subscriptions')} disabled={busy} />
    {privacy ? <Button title="Privacy policy" variant="ghost" onPress={() => open(privacy)} /> : null}
    {terms ? <Button title="Terms of use" variant="ghost" onPress={() => open(terms)} /> : null}
    <AppText size="sm" color={colors.onSurfaceTertiary}>Restoring a purchase restores subscription access. It does not recover documents from a previous installation.</AppText>
  </ScrollView>;
}
