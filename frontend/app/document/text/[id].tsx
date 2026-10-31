import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { api, ApiError, DocumentDTO } from '@/src/lib/api';
import { AppText } from '@/src/components/AppText';
import { Button } from '@/src/components/Button';
import { colors, spacing } from '@/src/theme/theme';

export default function DocumentText() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [doc, setDoc] = useState<DocumentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const load = async () => {
    setLoading(true); setError('');
    try { setDoc(await api.getDocument(id)); }
    catch (e: any) { setError(e?.message ?? 'Could not open this document.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);
  const extract = async () => {
    if (!doc || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await api.runOcr(doc.id);
      setDoc(result.document);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) Alert.alert('DocuALL Pro', 'Text extraction is a Pro feature.', [
        { text: 'Not now', style: 'cancel' }, { text: 'View plans', onPress: () => router.push('/membership') },
      ]);
      else setError(e?.message ?? 'Text extraction failed. Your saved text is unchanged.');
    } finally { lock.current = false; setBusy(false); }
  };
  const share = async () => {
    if (!doc?.ocr_text || lock.current) return;
    lock.current = true; setBusy(true);
    let path: string | undefined;
    try {
      if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) throw Error('Text-file sharing is unavailable on this device.');
      path = FileSystem.cacheDirectory + doc.id + '-text.txt';
      const notes = [
        'Extracted text from ' + doc.title,
        doc.ocr_unread_pages?.length ? 'Pages without extracted text: ' + doc.ocr_unread_pages.join(', ') : '',
        doc.ocr_truncated ? 'Text was shortened by the extraction limit.' : '',
        'Check important details against the original document.',
      ].filter(Boolean).join('\n');
      await FileSystem.writeAsStringAsync(path, notes + '\n\n' + doc.ocr_text);
      await Sharing.shareAsync(path, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: 'Share extracted text' });
    } catch (e: any) { setError(e?.message ?? 'Could not share text.'); }
    finally {
      if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      lock.current = false; setBusy(false);
    }
  };
  return <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom }}>
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <Button title="Back to document" variant="ghost" onPress={() => router.back()} disabled={busy} />
      <AppText size="2xl" weight="bold">Your document, in words.</AppText>
      <AppText>{doc?.title}</AppText>
      <AppText size="sm" color={colors.onSurfaceSecondary}>Read, select, and share the text. Check names and numbers against the original.</AppText>
      {error ? <AppText accessibilityRole="alert">{error}</AppText> : null}
      {doc?.ocr_unread_pages?.length ? <AppText accessibilityRole="alert">No text extracted from pages {doc.ocr_unread_pages.join(', ')}. They may be blank or unreadable, or processing may have reached its limit.</AppText> : null}
      {doc?.ocr_truncated ? <AppText accessibilityRole="alert">This extraction was shortened. Use a smaller set of pages for the remaining text.</AppText> : null}
    </View>
    {loading ? <ActivityIndicator /> : <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <AppText selectable>{doc?.ocr_text || 'Tap Extract text to begin. Processing happens on your DocuALL server.'}</AppText>
    </ScrollView>}
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      {!doc && !loading ? <Button title="Retry" onPress={load} /> : null}
      <Button title={doc?.ocr_text ? 'Extract again' : 'Extract text'} onPress={extract} disabled={loading || busy || !doc} loading={busy} />
      <Button title="Share text file" variant="secondary" onPress={share} disabled={busy || !doc?.ocr_text} />
    </View>
  </View>;
}
