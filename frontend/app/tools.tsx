import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/src/components/AppText';
import { Button } from '@/src/components/Button';
import { api, DocumentDTO } from '@/src/lib/api';
import { useDocs } from '@/src/lib/docs-context';
import { colors, radius, spacing } from '@/src/theme/theme';

type Page = { document_id: string; page_index: number; rotation: number; title: string };
const keyOf = (page: Page) => page.document_id + ':' + page.page_index;

function Preview({ page }: { page: Page }) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api.pageImageSource(page.document_id, page.page_index).then(value => { if (active) setSource(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [page.document_id, page.page_index]);
  return <View style={{ width: 76, height: 98, backgroundColor: colors.surface, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {source && !failed ? <Image source={source} cachePolicy="none" contentFit="contain" onError={() => setFailed(true)} style={{ width: 70, height: 90, transform: [{ rotate: page.rotation + 'deg' }] }} /> : <AppText size="xs">Page {page.page_index + 1}</AppText>}
  </View>;
}

export default function DocumentTools() {
  const { documents, loading, error, refresh } = useDocs();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState<Page[]>([]);
  const [history, setHistory] = useState<Page[][]>([]);
  const [title, setTitle] = useState('My organized PDF');
  const [choosing, setChoosing] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  const change = (next: Page[]) => {
    setHistory(previous => [...previous.slice(-19), pages]);
    setPages(next);
  };
  const add = (doc: DocumentDTO) => {
    if (!doc.page_count || doc.page_count > 100) return Alert.alert('Too many pages', 'Choose a document with 1–100 pages.');
    const existing = new Set(pages.map(keyOf));
    const added = Array.from({ length: doc.page_count }, (_, page_index) => ({ document_id: doc.id, page_index, rotation: 0, title: doc.title })).filter(page => !existing.has(keyOf(page)));
    if (pages.length + added.length > 100 || new Set([...pages.map(p => p.document_id), doc.id]).size > 10) return Alert.alert('This PDF is full', 'Use up to 100 pages from 10 documents.');
    change([...pages, ...added]);
    setChoosing(false);
  };
  const move = (index: number, delta: number) => {
    const next = [...pages];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    change(next);
  };
  const save = async () => {
    if (locked.current || !pages.length || !title.trim()) return;
    locked.current = true;
    setBusy(true);
    try {
      const doc = await api.assembleDocument(title.trim(), pages.map(({ title: _, ...page }) => page));
      void refresh();
      router.replace('/document/' + doc.id);
    } catch (e: any) {
      Alert.alert('Could not save your PDF', e?.message ?? 'Please try again. Your originals are unchanged.');
    } finally { locked.current = false; setBusy(false); }
  };
  const leave = () => {
    if (pages.length) Alert.alert('Leave page tools?', 'Your unsaved arrangement will be discarded. Your original documents are unchanged.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Leave', onPress: () => router.back() },
    ]);
    else router.back();
  };
  return <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom }}>
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <Button title="Back" variant="ghost" onPress={leave} disabled={busy} />
      <AppText size="2xl" weight="bold">Make it one PDF.</AppText>
      <AppText color={colors.onSurfaceSecondary}>Combine documents, keep just the pages you need, or put everything in order. Save a new copy.</AppText>
      <TextInput accessibilityLabel="New PDF name" value={title} onChangeText={setTitle} maxLength={160} editable={!busy}
        style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, color: colors.onSurface }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={choosing ? 'Show pages' : 'Add document'} variant="secondary" disabled={busy || (!pages.length && choosing)} onPress={() => setChoosing(!choosing)} />
        <Button title="Undo" variant="ghost" disabled={busy || !history.length} onPress={() => {
          setPages(history[history.length - 1]); setHistory(history.slice(0, -1));
        }} />
      </View>
      <AppText size="sm">{pages.length} / 100 pages · Originals stay unchanged</AppText>
    </View>
    {choosing ? <FlatList data={documents} keyExtractor={doc => doc.id} refreshing={loading} onRefresh={refresh}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }}
      ListEmptyComponent={<AppText>{error || (loading ? 'Loading documents…' : 'Scan or import a PDF first, then come back here.')}</AppText>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={'Add ' + item.title} disabled={busy} onPress={() => add(item)}
        style={{ padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary }}>
        <AppText weight="bold">{item.title}</AppText><AppText size="sm">{item.page_count} pages · Tap to add</AppText>
      </Pressable>} /> :
      <FlatList data={pages} keyExtractor={keyOf} initialNumToRender={4} windowSize={5}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }}
        ListEmptyComponent={<AppText>Add a document to begin.</AppText>}
        renderItem={({ item, index }) => <View style={{ padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Preview page={item} />
            <View style={{ flex: 1 }}><AppText weight="bold">{index + 1}. {item.title}</AppText><AppText size="sm">Original page {item.page_index + 1} · {item.rotation}°</AppText></View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <Button title="Up" variant="ghost" disabled={busy || index === 0} onPress={() => move(index, -1)} />
            <Button title="Down" variant="ghost" disabled={busy || index === pages.length - 1} onPress={() => move(index, 1)} />
            <Button title="Rotate" variant="ghost" disabled={busy} onPress={() => change(pages.map((p, i) => i === index ? { ...p, rotation: (p.rotation + 90) % 360 } : p))} />
            <Button title="Remove" variant="ghost" disabled={busy} onPress={() => change(pages.filter((_, i) => i !== index))} />
          </View>
        </View>} />}
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <AppText size="xs" color={colors.onSurfaceSecondary}>Page edits create a new PDF. Digital signature certification and interactive forms are not preserved; use the original for those.</AppText>
      <Button title={busy ? 'Saving your PDF…' : 'Save new PDF'} loading={busy} disabled={busy || !pages.length || !title.trim()} onPress={save} />
    </View>
  </View>;
}
