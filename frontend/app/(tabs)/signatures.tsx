import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/src/components/AppText";
import { Button } from "@/src/components/Button";
import { SignaturePad, SignaturePadHandle } from "@/src/components/SignaturePad";
import { api, SignatureDTO } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/theme";

export default function SignaturesScreen() {
  const insets = useSafeAreaInsets();
  const [signatures, setSignatures] = useState<SignatureDTO[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const sigs = await api.listSignatures();
      setSignatures(sigs);
      const entries = await Promise.all(sigs.map(async (s) => [s.id, await api.fileUrl(s.image_path)] as const));
      setThumbUrls(Object.fromEntries(entries));
    } catch {
      // shown as an empty list; the home tab surfaces the connection error
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const remove = (sig: SignatureDTO) => {
    Alert.alert("Delete signature?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.deleteSignature(sig.id);
          load();
        },
      },
    ]);
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <AppText weight="bold" size="2xl">
          Signatures
        </AppText>
        <Pressable testID="add-signature-btn" onPress={() => setCreateOpen(true)} hitSlop={10}>
          <Ionicons name="add-circle" size={30} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {!loading && signatures.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="create-outline" size={40} color={colors.onSurfaceTertiary} />
          <AppText weight="semibold" style={{ marginTop: spacing.md }}>
            No saved signatures
          </AppText>
          <AppText size="sm" color={colors.onSurfaceTertiary} style={{ marginTop: spacing.xs, textAlign: "center" }}>
            Create one so it's ready whenever you need to sign a document.
          </AppText>
          <Button title="New signature" icon="add" onPress={() => setCreateOpen(true)} style={{ marginTop: spacing.lg }} />
        </View>
      ) : (
        <FlatList
          data={signatures}
          keyExtractor={(s) => s.id}
          numColumns={2}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          columnWrapperStyle={{ gap: spacing.md }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              {thumbUrls[item.id] ? (
                <Image source={{ uri: thumbUrls[item.id] }} style={styles.cardImg} contentFit="contain" />
              ) : null}
              <Pressable style={styles.deleteBtn} onPress={() => remove(item)} hitSlop={10}>
                <Ionicons name="trash-outline" size={16} color={colors.error} />
              </Pressable>
            </View>
          )}
        />
      )}

      <CreateSignatureModal visible={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </View>
  );
}

function CreateSignatureModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedText, setTypedText] = useState("");
  const [saving, setSaving] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (visible) {
      setMode("draw");
      setTypedText("");
    }
  }, [visible]);

  const save = async () => {
    setSaving(true);
    try {
      if (mode === "draw") {
        const strokes = padRef.current?.getStrokes() ?? [];
        if (!strokes.length) {
          Alert.alert("Draw your signature first");
          setSaving(false);
          return;
        }
        await api.createDrawnSignature(strokes, 2.5, 6);
      } else {
        if (!typedText.trim()) {
          Alert.alert("Type your name first");
          setSaving(false);
          return;
        }
        await api.createTypedSignature(typedText.trim());
      }
      onCreated();
      onClose();
    } catch (e: any) {
      Alert.alert("Couldn't save signature", e?.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <AppText weight="bold" size="xl">
              New signature
            </AppText>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.segment}>
            <SegmentButton label="Draw" active={mode === "draw"} onPress={() => setMode("draw")} />
            <SegmentButton label="Type" active={mode === "type"} onPress={() => setMode("type")} />
          </View>

          {mode === "draw" ? (
            <>
              <SignaturePad ref={padRef} aspect={2.5} strokeWidth={4} />
              <Pressable onPress={() => padRef.current?.clear()} style={{ alignSelf: "flex-end", marginTop: spacing.sm }}>
                <AppText size="sm" color={colors.brandPrimary} weight="semibold">
                  Clear
                </AppText>
              </Pressable>
            </>
          ) : (
            <TextInput
              value={typedText}
              onChangeText={setTypedText}
              placeholder="Type your name"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.typedInput}
              autoFocus
            />
          )}

          <Button title="Save signature" onPress={save} loading={saving} style={{ marginTop: spacing.xl }} testID="save-signature-btn" />
        </View>
      </View>
    </Modal>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segmentBtn, active && styles.segmentBtnActive]}>
      <AppText weight="semibold" size="sm" color={active ? colors.onBrandPrimary : colors.onSurface}>
        {label}
      </AppText>
    </Pressable>
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
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, marginTop: -60 },
  card: {
    flex: 1,
    aspectRatio: 1.6,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  cardImg: { width: "100%", height: "100%" },
  deleteBtn: { position: "absolute", top: spacing.sm, right: spacing.sm },
  modalScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg },
  segmentBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: "center" },
  segmentBtnActive: { backgroundColor: colors.brandPrimary },
  typedInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: 24,
    fontStyle: "italic",
    color: colors.onSurface,
  },
});
