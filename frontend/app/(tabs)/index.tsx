import React, { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
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
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/theme";

export default function DocumentsHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { documents, loading, error, refresh } = useDocs();
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => [d.title, d.vendor, d.category, d.doc_date, d.amount, d.ocr_text]
      .some((value) => (value ?? "").toLowerCase().includes(q)));
  }, [documents, query]);

  const importPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      base64: true,
    });
    if (res.canceled || !res.assets.length) return;
    setImporting(true);
    try {
      const pages = res.assets
        .filter((a) => !!a.base64)
        .map((a) => ({ base64: a.base64 as string, enhance: false }));
      if (pages.length !== res.assets.length || !pages.length) {
        throw new Error("One or more photos couldn't be read. Select them again or try a smaller batch.");
      }
      await api.createDocument(pages);
      await refresh();
    } catch (e: any) {
      Alert.alert("Import failed", e?.message ?? "Something went wrong");
    } finally {
      setImporting(false);
    }
  };

  const importPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    setImporting(true);
    try {
      await api.importPdf(asset.uri, asset.name ?? "document.pdf");
      await refresh();
    } catch (e: any) {
      Alert.alert("Import failed", e?.message ?? "Couldn't reach the DocuALL server");
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <AppText weight="bold" size="2xl">
          DocuALL
        </AppText>
        <Pressable testID="settings-shortcut" onPress={() => router.push("/(tabs)/settings")} hitSlop={10}>
          <Ionicons name="person-circle-outline" size={28} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <SearchBar value={query} onChangeText={setQuery} />
        <GiantScanButton testID="scan-fab" onPress={() => router.push("/scan")} />
        <View style={styles.templateHeader}>
          <AppText weight="semibold" size="sm">Form templates</AppText>
          <AppText size="xs" color={colors.onSurfaceTertiary}>Start a scan with a name</AppText>
        </View>
        <View style={styles.templateRow}>
          {["Leave form", "Expense report", "Application"].map((name) => (
            <Pressable key={name} onPress={() => router.push({ pathname: "/scan", params: { template: name } })} style={styles.templateBtn}>
              <Ionicons name="document-text-outline" size={16} color={colors.brandPrimary} />
              <AppText size="xs" weight="semibold" style={{ marginTop: 4 }}>{name}</AppText>
            </Pressable>
          ))}
        </View>

        <View style={styles.importRow}>
          <Pressable testID="import-photos-btn" onPress={importPhotos} style={styles.importBtn} disabled={importing}>
            <Ionicons name="images-outline" size={18} color={colors.onSurface} />
            <AppText weight="medium" size="sm" style={{ marginLeft: spacing.xs }}>
              Import photos
            </AppText>
          </Pressable>
          <Pressable testID="import-pdf-btn" onPress={importPdf} style={styles.importBtn} disabled={importing}>
            <Ionicons name="document-outline" size={18} color={colors.onSurface} />
            <AppText weight="medium" size="sm" style={{ marginLeft: spacing.xs }}>
              Import PDF
            </AppText>
          </Pressable>
        </View>
      </View>

      {error ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.onSurfaceTertiary} />
          <AppText weight="semibold" style={{ marginTop: spacing.md, textAlign: "center" }}>
            Can't reach the DocuALL server
          </AppText>
          <AppText size="sm" color={colors.onSurfaceTertiary} style={{ marginTop: spacing.xs, textAlign: "center" }}>
            Check the API URL in Settings and that the backend is running.
          </AppText>
        </View>
      ) : !loading && filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={40} color={colors.onSurfaceTertiary} />
          <AppText weight="semibold" style={{ marginTop: spacing.md }}>
            {query ? "No matching documents" : "No documents yet"}
          </AppText>
          {!query ? (
            <AppText size="sm" color={colors.onSurfaceTertiary} style={{ marginTop: spacing.xs, textAlign: "center" }}>
              Scan, or import photos and PDFs, to get started.
            </AppText>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => <DocumentCard doc={item} onPress={() => router.push(`/document/${item.id}`)} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
          onRefresh={refresh}
          refreshing={loading}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  templateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  templateRow: { flexDirection: "row", gap: spacing.sm },
  templateBtn: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 58, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  importRow: { flexDirection: "row", gap: spacing.sm },
  importBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg + 52 + spacing.md },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, marginTop: -60 },
});
