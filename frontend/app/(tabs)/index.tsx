import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/src/components/AppText";
import { SearchBar } from "@/src/components/SearchBar";
import { GiantScanButton } from "@/src/components/GiantScanButton";
import { DocumentCard } from "@/src/components/DocumentCard";
import { useDocs } from "@/src/lib/docs-context";
import { api, DocumentDTO } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/theme";

type Filter = "All" | "Scanned" | "Imported";

export default function DocumentsHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { documents, loading, error, refresh } = useDocs();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((doc) => {
      const matchesFilter = filter === "All" || (filter === "Imported" ? doc.kind === "imported" : doc.kind !== "imported");
      const searchable = [doc.title, doc.vendor, doc.doc_date, doc.amount, doc.category].filter(Boolean).join(" ").toLowerCase();
      return matchesFilter && (!q || searchable.includes(q));
    });
  }, [documents, filter, query]);

  const importPhotos = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: 10,
        base64: true,
      });
      if (res.canceled || !res.assets.length) return;
      setImporting(true);
      const pages = res.assets
        .filter((asset) => !!asset.base64)
        .map((asset) => ({ base64: asset.base64 as string, enhance: false }));
      if (!pages.length) throw new Error("No readable photos were selected. Try choosing them again.");
      await api.createDocument(pages);
      await refresh();
    } catch (e: any) {
      Alert.alert("Import failed", e?.message ?? "Something went wrong");
    } finally {
      setImporting(false);
    }
  };

  const importPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      setImporting(true);
      const asset = res.assets[0];
      await api.importPdf(asset.uri, asset.name ?? "document.pdf");
      await refresh();
    } catch (e: any) {
      Alert.alert("Import failed", e?.message ?? "Couldn't reach the DocuALL server");
    } finally {
      setImporting(false);
    }
  };

  const renderHeader = () => (
    <View style={{ paddingTop: insets.top + spacing.sm }}>
      <View style={styles.header}>
        <View style={styles.brandLockup}>
          <View style={styles.brandMark}>
            <Ionicons name="document-text" size={20} color={colors.onBrandPrimary} />
          </View>
          <View>
            <AppText weight="bold" size="xl" style={{ letterSpacing: -0.5 }}>DocuALL</AppText>
            <AppText size="xs" color={colors.onSurfaceTertiary}>Your paperwork, handled.</AppText>
          </View>
        </View>
        <Pressable testID="settings-shortcut" accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push("/(tabs)/settings")} hitSlop={12} style={styles.iconButton}>
          <Ionicons name="person-circle-outline" size={25} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.intro}>
          <AppText size="3xl" weight="bold" style={{ letterSpacing: -1.1, lineHeight: 36 }}>Paper to done.</AppText>
          <AppText size="sm" color={colors.onSurfaceSecondary} style={{ marginTop: spacing.xs }}>
            Scan, sign, and share your documents in one place.
          </AppText>
        </View>

        <View style={styles.scanCard}>
          <View style={styles.scanCopy}>
            <View style={styles.eyebrow}>
              <View style={styles.liveDot} />
              <AppText size="xs" weight="semibold" color={colors.brandSecondary}>READY WHEN YOU ARE</AppText>
            </View>
            <AppText size="xl" weight="bold" color={colors.onSurface} style={{ marginTop: spacing.sm }}>Capture a document</AppText>
            <AppText size="sm" color={colors.onSurfaceSecondary} style={{ marginTop: spacing.xs }}>Turn paper into a clean, shareable PDF.</AppText>
          </View>
          <GiantScanButton testID="scan-fab" onPress={() => router.push("/scan")} />
        </View>

        <View style={styles.quickActions}>
          <Pressable testID="import-photos-btn" accessibilityRole="button" onPress={importPhotos} disabled={importing} style={({ pressed }) => [styles.actionCard, pressed && styles.pressed, importing && styles.disabled]}>
            <View style={[styles.actionIcon, { backgroundColor: "#20365A" }]}><Ionicons name="images-outline" size={19} color={colors.brandSecondary} /></View>
            <AppText weight="semibold" size="sm" style={{ marginTop: spacing.sm }}>Import photos</AppText>
            <AppText size="xs" color={colors.onSurfaceTertiary} style={{ marginTop: 2 }}>Up to 10 pages</AppText>
          </Pressable>
          <Pressable testID="import-pdf-btn" accessibilityRole="button" onPress={importPdf} disabled={importing} style={({ pressed }) => [styles.actionCard, pressed && styles.pressed, importing && styles.disabled]}>
            <View style={[styles.actionIcon, { backgroundColor: "#27324B" }]}><Ionicons name="document-outline" size={19} color={colors.onSurfaceSecondary} /></View>
            <AppText weight="semibold" size="sm" style={{ marginTop: spacing.sm }}>Import a PDF</AppText>
            <AppText size="xs" color={colors.onSurfaceTertiary} style={{ marginTop: 2 }}>From your device</AppText>
          </Pressable>
        </View>

        <View style={styles.sectionHeading}>
          <View>
            <AppText weight="bold" size="xl">Quick starts</AppText>
            <AppText size="xs" color={colors.onSurfaceTertiary} style={{ marginTop: 3 }}>Start a scan with a useful name</AppText>
          </View>
          <Ionicons name="sparkles-outline" size={20} color={colors.brandSecondary} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templateRow}>
          {[
            { name: "Leave form", icon: "calendar-outline" as const },
            { name: "Expense report", icon: "receipt-outline" as const },
            { name: "Application", icon: "briefcase-outline" as const },
          ].map((template) => (
            <Pressable key={template.name} accessibilityRole="button" onPress={() => router.push({ pathname: "/scan", params: { template: template.name } })} style={({ pressed }) => [styles.templateCard, pressed && styles.pressed]}>
              <Ionicons name={template.icon} size={18} color={colors.brandSecondary} />
              <AppText size="sm" weight="semibold" style={{ marginTop: spacing.sm }}>{template.name}</AppText>
              <AppText size="xs" color={colors.onSurfaceTertiary} style={{ marginTop: 3 }}>Scan to begin</AppText>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.documentsHeading}>
          <View>
            <AppText weight="bold" size="xl">Your documents</AppText>
            <AppText size="xs" color={colors.onSurfaceTertiary} style={{ marginTop: 3 }}>
              {documents.length} {documents.length === 1 ? "document" : "documents"} saved on this device
            </AppText>
          </View>
          {importing ? <ActivityIndicator color={colors.brandSecondary} /> : null}
        </View>

        <SearchBar value={query} onChangeText={setQuery} />
        <View style={styles.filterRow}>
          {(["All", "Scanned", "Imported"] as Filter[]).map((item) => (
            <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} style={[styles.filterChip, filter === item && styles.filterChipActive]}>
              <AppText size="sm" weight="semibold" color={filter === item ? colors.onBrandPrimary : colors.onSurfaceSecondary}>{item}</AppText>
              <AppText size="xs" color={filter === item ? colors.onBrandPrimary : colors.onSurfaceTertiary} style={{ marginLeft: 6 }}>
                {item === "All" ? documents.length : item === "Scanned" ? documents.filter((doc) => doc.kind !== "imported").length : documents.filter((doc) => doc.kind === "imported").length}
              </AppText>
            </Pressable>
          ))}
        </View>

        {error ? (
          <Pressable accessibilityRole="button" onPress={refresh} style={styles.errorBanner}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.error} />
            <AppText size="sm" color={colors.onSurfaceSecondary} style={{ flex: 1, marginLeft: spacing.sm }}>Couldn't connect. Tap to try again.</AppText>
            <Ionicons name="refresh-outline" size={17} color={colors.onSurfaceSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const emptyText = query || filter !== "All"
    ? "No documents match this view"
    : "Scan or import a document to get started";

  return (
    <View style={styles.wrap}>
      <FlatList
        data={filtered}
        keyExtractor={(doc) => doc.id}
        renderItem={({ item }) => <DocumentCard doc={item} onPress={() => router.push(`/document/${item.id}`)} />}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyWrap}><ActivityIndicator size="large" color={colors.brandSecondary} /><AppText size="sm" color={colors.onSurfaceTertiary} style={{ marginTop: spacing.md }}>Loading your documents…</AppText></View>
          ) : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}><Ionicons name={query || filter !== "All" ? "search-outline" : "folder-open-outline"} size={23} color={colors.brandSecondary} /></View>
              <AppText weight="semibold" size="md" style={{ marginTop: spacing.md, textAlign: "center" }}>{emptyText}</AppText>
              {!query && filter === "All" ? <AppText size="sm" color={colors.onSurfaceTertiary} style={{ marginTop: spacing.xs, textAlign: "center" }}>Your saved scans and PDFs will show up here.</AppText> : null}
            </View>
          )
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        onRefresh={refresh}
        refreshing={loading}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
  list: { backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  intro: { marginBottom: spacing.lg },
  scanCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  scanCopy: { marginBottom: spacing.lg },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  quickActions: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xl },
  actionCard: {
    flex: 1,
    minHeight: 112,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  templateRow: { gap: spacing.sm, paddingBottom: spacing.xl },
  templateCard: {
    width: 148,
    minHeight: 100,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  documentsHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  filterRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#241923",
    borderWidth: 1,
    borderColor: "#5B3440",
  },
  emptyWrap: { alignItems: "center", justifyContent: "center", padding: spacing.xl, paddingTop: spacing["3xl"] },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg + 52 + spacing.md },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.55 },
});
