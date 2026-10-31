import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/src/components/AppText";
import { api, DocumentDTO, SigningRequestDTO } from "@/src/lib/api";
import { useDocs } from "@/src/lib/docs-context";
import { colors, radius, spacing } from "@/src/theme/theme";

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh } = useDocs();

  const [doc, setDoc] = useState<DocumentDTO | null>(null);
  const [pageSources, setPageSources] = useState<{ uri: string; headers: Record<string, string> }[]>([]);
  const [signingRequests, setSigningRequests] = useState<SigningRequestDTO[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const savingTitle = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [busy, setBusy] = useState<"share" | "export" | "email" | "ocr" | "delete" | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const d = await api.getDocument(id);
      setDoc(d);
      setTitleDraft(d.title);
      const sources = await Promise.all(
        Array.from({ length: d.page_count || 1 }, (_, i) => api.pageImageSource(d.id, i))
      );
      setPageSources(sources.map(source => ({ ...source, uri: `${source.uri}${source.uri.includes("?") ? "&" : "?"}v=${encodeURIComponent(d.updated_at)}` })));
    } catch (e: any) {
      setLoadError(e?.message ?? "Couldn't load document. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadSigningRequests = useCallback(async () => {
    if (!id) return;
    try {
      setSigningRequests(await api.listSigningRequests(id));
    } catch {
      // non-critical - the document itself still loaded fine
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadSigningRequests();
    }, [load, loadSigningRequests])
  );

  const revokeRequest = (request: SigningRequestDTO) => {
    Alert.alert("Revoke signing link?", `${request.signer_name} will no longer be able to open this link.`, [
      { text: "Keep link", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => {
        setRevoking(request.id);
        try {
          await api.cancelSigningRequest(request.id);
          await loadSigningRequests();
        } catch (e: any) {
          Alert.alert("Couldn't revoke link", e?.message ?? "Please try again.");
        } finally {
          setRevoking(null);
        }
      } },
    ]);
  };

  const saveTitle = async () => {
    if (savingTitle.current) return;
    if (!doc || !titleDraft.trim() || titleDraft.trim() === doc.title) {
      setRenaming(false);
      return;
    }
    savingTitle.current = true;
    try {
      const updated = await api.renameDocument(doc.id, titleDraft.trim());
      setDoc(updated);
      setRenaming(false);
      await refresh();
    } catch (e: any) {
      Alert.alert("Couldn't rename document", e?.message ?? "Please try again.");
    } finally {
      savingTitle.current = false;
    }
  };

  const downloadPdfToCache = async (): Promise<string | null> => {
    if (!doc?.pdf_path) return null;
    const url = await api.fileUrl(doc.pdf_path);
    const dest = `${FileSystem.cacheDirectory}${doc.id}_${doc.title.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
    const res = await FileSystem.downloadAsync(url, dest);
    if (res.status < 200 || res.status >= 300) {
      await FileSystem.deleteAsync(dest, { idempotent: true });
      throw new Error("Could not download the PDF. Please try again.");
    }
    return res.uri;
  };

  const share = async () => {
    setBusy("share");
    try {
      const uri = await downloadPdfToCache();
      if (!uri) return;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: doc?.title });
      } else {
        Alert.alert("Sharing isn't available on this device");
      }
    } catch (e: any) {
      Alert.alert("Couldn't share document", e?.message ?? "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const emailPdf = async () => {
    setBusy("email");
    try {
      const uri = await downloadPdfToCache();
      if (!uri) return;
      if (Platform.OS === "web") {
        Alert.alert("Use Share on web", "Email with an attached PDF is available in the native app. Use Share on web to download or send it.");
        return;
      }
      // Native only. Keeping this out of the web path prevents web export from loading the native module.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const MailComposer = require("expo-mail-composer") as typeof import("expo-mail-composer");
      if (!(await MailComposer.isAvailableAsync())) {
        Alert.alert("Email is not available", "Set up a mail account on this device, then try again.");
        return;
      }
      await MailComposer.composeAsync({
        subject: `${doc?.title ?? "DocuALL document"}.pdf`,
        body: `Attached is ${doc?.title ?? "your document"}.`,
        attachments: [uri],
      });
    } catch (e: any) {
      Alert.alert("Couldn't open email", e?.message ?? "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const runOcr = async () => {
    if (!doc) return;
    setBusy("ocr");
    try {
      const result = await api.runOcr(doc.id);
      setDoc(result.document);
      const preview = result.text.length > 900 ? `${result.text.slice(0, 900)}...` : result.text;
      Alert.alert("Text found", preview || "No text found.");
    } catch (e: any) {
      Alert.alert("OCR unavailable", e?.message ?? "Try again after the OCR package is installed on the server.");
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async () => {
    // "Export" and "Share" both funnel through the OS share sheet, which is
    // also how you save a PDF to Files / Drive / iCloud on iOS and Android -
    // there's no separate "download" concept on mobile the way there is on desktop.
    await share();
  };

  const remove = () => {
    Alert.alert("Delete document?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy("delete");
          try {
            if (doc) await api.deleteDocument(doc.id);
            await refresh();
            router.back();
          } catch (e: any) {
            Alert.alert("Couldn't delete document", e?.message ?? "Please try again.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const insets_bottom = insets.bottom;

  if (!loading && (loadError || !doc)) {
    return (
      <View style={[styles.wrap, styles.center, { padding: spacing.lg, gap: spacing.lg }]}>
        <AppText>{loadError ?? "Document not found."}</AppText>
        <Pressable accessibilityRole="button" onPress={load}><AppText>Try again</AppText></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.back()}><AppText>Go back</AppText></Pressable>
      </View>
    );
  }

  if (loading || !doc) {
    return (
      <View style={[styles.wrap, styles.center]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        {renaming ? (
          <TextInput
            value={titleDraft}
            onChangeText={setTitleDraft}
            onSubmitEditing={saveTitle}
            onBlur={saveTitle}
            autoFocus
            style={styles.titleInput}
          />
        ) : (
          <Pressable style={{ flex: 1, marginHorizontal: spacing.md }} onPress={() => setRenaming(true)}>
            <AppText weight="bold" size="lg" numberOfLines={1}>
              {doc.title}
            </AppText>
          </Pressable>
        )}
        <Pressable onPress={remove} hitSlop={10}>
          <Ionicons name="trash-outline" size={22} color={colors.error} />
        </Pressable>
      </View>

      {(doc.vendor || doc.doc_date || doc.amount) ? (
        <View style={styles.metaRow}>
          {doc.vendor ? <MetaChip icon="business-outline" label={doc.vendor} /> : null}
          {doc.doc_date ? <MetaChip icon="calendar-outline" label={doc.doc_date} /> : null}
          {doc.amount ? <MetaChip icon="cash-outline" label={doc.amount} /> : null}
        </View>
      ) : null}

      {signingRequests.length ? (
        <View style={styles.requestsBox}>
          <AppText size="xs" weight="semibold" color={colors.onSurfaceTertiary} style={{ textTransform: "uppercase", marginBottom: spacing.xs }}>
            Sent for signature
          </AppText>
          {signingRequests.map((r) => (
            <View key={r.id} style={styles.requestRow}>
              <Ionicons
                name={r.status === "completed" ? "checkmark-circle" : r.status === "cancelled" ? "close-circle" : "time-outline"}
                size={16}
                color={r.status === "completed" ? colors.success : r.status === "cancelled" ? colors.onSurfaceTertiary : colors.brandSecondary}
              />
              <AppText size="sm" style={{ marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>
                {r.signer_name}
              </AppText>
              <AppText size="xs" color={colors.onSurfaceTertiary} style={{ textTransform: "capitalize" }}>
                {r.status}
              </AppText>
              {r.status === "pending" ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Revoke signing link for ${r.signer_name}`}
                  disabled={revoking !== null} onPress={() => revokeRequest(r)}
                  style={{ padding: spacing.sm, marginLeft: spacing.sm }}>
                  {revoking === r.id ? <ActivityIndicator size="small" color={colors.error} /> :
                    <AppText size="xs" color={colors.error}>Revoke</AppText>}
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 }}>
        {pageSources.map((source, i) => (
          <View key={i} style={styles.pageCard}>
            <Image source={source} style={styles.pageImg} contentFit="contain" />
            <View style={styles.pageBadge}>
              <AppText size="xs" weight="bold" color={colors.onBrandPrimary}>
                {i + 1} / {doc.page_count}
              </AppText>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: insets_bottom + spacing.md }]}>
        <ActionButton icon="create-outline" label="Sign" onPress={() => router.push(`/document/sign/${doc.id}`)} testID="sign-btn" />
        <ActionButton icon="paper-plane-outline" label="Request" onPress={() => router.push(`/document/request/${doc.id}`)} testID="request-signature-btn" />
        <ActionButton icon="share-outline" label="Share" onPress={share} loading={busy === "share"} testID="share-btn" />
        <ActionButton icon="mail-outline" label="Email" onPress={emailPdf} loading={busy === "email"} testID="email-btn" />
        <ActionButton icon="scan-outline" label="OCR" onPress={runOcr} loading={busy === "ocr"} testID="ocr-btn" />
        <ActionButton icon="download-outline" label="Export" onPress={exportPdf} loading={busy === "export"} testID="export-btn" />
      </View>
    </View>
  );
}

function MetaChip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={13} color={colors.onSurfaceSecondary} />
      <AppText size="xs" weight="medium" style={{ marginLeft: 4 }}>
        {label}
      </AppText>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  loading,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.actionBtn} disabled={loading}>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <Ionicons name={icon} size={22} color={colors.brandPrimary} />
      )}
      <AppText size="xs" weight="semibold" style={{ marginTop: 4 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titleInput: {
    flex: 1,
    marginHorizontal: spacing.md,
    fontSize: 17,
    fontWeight: "700",
    color: colors.onSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.brandPrimary,
  },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, padding: spacing.lg, paddingBottom: 0 },
  requestsBox: { marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  requestRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageImg: { width: "100%", height: 460, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  pageBadge: {
    position: "absolute",
    bottom: spacing.md,
    right: spacing.md,
    backgroundColor: colors.scrim,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  actionBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.sm },
});

