import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/src/components/AppText";
import { Button } from "@/src/components/Button";
import { api, DocumentDTO, FieldType, PendingFieldPlacement } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/theme";

interface PlacedField extends PendingFieldPlacement {
  id: string;
}

const IMAGE_W = 0.34;
const TEXT_H = 0.028;
const IMAGE_ASPECT = 2.5;

const FIELD_KINDS: { type: FieldType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: "signature", label: "Signature", icon: "create-outline" },
  { type: "initials", label: "Initials", icon: "text-outline" },
  { type: "date", label: "Date", icon: "calendar-outline" },
  { type: "text", label: "Text", icon: "reader-outline" },
];

function localId(): string {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function SigningRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [doc, setDoc] = useState<DocumentDTO | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSource, setPageSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [expiryDays, setExpiryDays] = useState(30);

  const [fields, setFields] = useState<PlacedField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const containerSize = useRef({ width: 0, height: 0 });
  const [containerReady, setContainerReady] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await api.getDocument(id);
      setDoc(d);
      setPageSource(await api.pageImageSource(d.id, 0));
    } catch (e: any) {
      Alert.alert("Couldn't load", e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (doc) api.pageImageSource(doc.id, pageIndex).then(setPageSource);
  }, [doc, pageIndex]);

  const onContainerLayout = (e: LayoutChangeEvent) => {
    containerSize.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    setContainerReady(true);
  };

  const fieldsOnPage = useMemo(() => fields.filter((f) => f.page_index === pageIndex), [fields, pageIndex]);
  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  const updateField = (fieldId: string, patch: Partial<PlacedField>) => {
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)));
  };

  const removeField = (fieldId: string) => {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    setSelectedId((cur) => (cur === fieldId ? null : cur));
  };

  const addField = (type: FieldType) => {
    const isImage = type === "signature" || type === "initials";
    const field: PlacedField = {
      id: localId(),
      type,
      page_index: pageIndex,
      x: 0.3,
      y: 0.4,
      w: isImage ? (type === "initials" ? IMAGE_W * 0.5 : IMAGE_W) : TEXT_H,
    };
    setFields((prev) => [...prev, field]);
    setSelectedId(field.id);
  };

  const resizeSelected = (delta: number) => {
    if (!selectedField) return;
    const isImage = selectedField.type === "signature" || selectedField.type === "initials";
    const min = isImage ? 0.12 : 0.016;
    const max = isImage ? 0.6 : 0.06;
    updateField(selectedField.id, { w: clamp(selectedField.w + delta, min, max) });
  };

  const send = async () => {
    if (!doc) return;
    if (!signerName.trim()) {
      Alert.alert("Who's signing?", "Add the recipient's name so they know it's meant for them.");
      return;
    }
    if (!fields.length) {
      Alert.alert("Add at least one field", "Tap Signature, Initials, Date, or Text below to place one for them to fill in.");
      return;
    }
    setSending(true);
    try {
      const req = await api.createSigningRequest(
        doc.id,
        signerName.trim(),
        fields.map(({ id: _id, ...f }) => f),
        expiryDays
      );
      await Share.share({
        message: `Please sign "${doc.title}": ${req.url}`,
        url: req.url,
      });
      router.back();
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message ?? "Something went wrong");
    } finally {
      setSending(false);
    }
  };

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
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <AppText weight="bold" size="lg">
          Send for signature
        </AppText>
        <View style={styles.fieldCount}>
          <AppText size="xs" weight="bold" color={colors.onBrandPrimary}>
            {fields.length}
          </AppText>
        </View>
      </View>

      <View style={styles.nameRow}>
        <Ionicons name="person-outline" size={18} color={colors.onSurfaceTertiary} />
        <TextInput
          value={signerName}
          onChangeText={setSignerName}
          placeholder="Recipient's name"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={styles.nameInput}
        />
      </View>

      <View style={styles.expiryRow}>
        <Ionicons name="time-outline" size={18} color={colors.onSurfaceTertiary} />
        <AppText size="sm" style={{ flex: 1, marginLeft: spacing.sm }}>Link expires in</AppText>
        {[7, 30, 90].map((days) => (
          <Pressable key={days} onPress={() => setExpiryDays(days)} style={[styles.expiryPill, expiryDays === days && styles.expiryPillActive]}>
            <AppText size="xs" weight="semibold" color={expiryDays === days ? colors.onBrandPrimary : colors.onSurface}>{days}d</AppText>
          </Pressable>
        ))}
      </View>

      {doc.page_count > 1 ? (
        <View style={styles.pageNav}>
          <Pressable disabled={pageIndex === 0} onPress={() => setPageIndex((p) => p - 1)} hitSlop={10}>
            <Ionicons name="chevron-back" size={20} color={pageIndex === 0 ? colors.onSurfaceTertiary : colors.onSurface} />
          </Pressable>
          <AppText size="sm" weight="medium">
            Page {pageIndex + 1} of {doc.page_count}
            {fieldsOnPage.length ? ` \u00b7 ${fieldsOnPage.length} field${fieldsOnPage.length > 1 ? "s" : ""}` : ""}
          </AppText>
          <Pressable disabled={pageIndex === doc.page_count - 1} onPress={() => setPageIndex((p) => p + 1)} hitSlop={10}>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={pageIndex === doc.page_count - 1 ? colors.onSurfaceTertiary : colors.onSurface}
            />
          </Pressable>
        </View>
      ) : null}

      <Pressable style={styles.pageWrap} onLayout={onContainerLayout} onPress={() => setSelectedId(null)}>
        {pageSource ? <Image source={pageSource} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        {containerReady &&
          fieldsOnPage.map((field) => (
            <PlaceholderField
              key={field.id}
              field={field}
              containerSize={containerSize}
              selected={field.id === selectedId}
              onSelect={() => setSelectedId(field.id)}
              onMove={(x, y) => updateField(field.id, { x, y })}
            />
          ))}
      </Pressable>

      {selectedField ? (
        <View style={styles.selectionBar}>
          <AppText size="sm" weight="semibold" style={{ textTransform: "capitalize" }}>
            {selectedField.type} placeholder
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Pressable onPress={() => resizeSelected(-0.03)} style={styles.sizeBtn}>
              <Ionicons name="remove" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable onPress={() => resizeSelected(0.03)} style={styles.sizeBtn}>
              <Ionicons name="add" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable onPress={() => removeField(selectedField.id)} style={[styles.sizeBtn, { backgroundColor: colors.error }]}>
              <Ionicons name="trash" size={16} color={colors.onError} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.hintBar}>
          <AppText size="sm" color={colors.onSurfaceTertiary}>
            Drop fields where {signerName.trim() || "they"} should sign, initial, date, or fill in text
          </AppText>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fieldToolbar}>
        {FIELD_KINDS.map((kind) => (
          <Pressable key={kind.type} onPress={() => addField(kind.type)} style={styles.fieldKindBtn} testID={`add-request-field-${kind.type}`}>
            <Ionicons name={kind.icon} size={20} color={colors.brandPrimary} />
            <AppText size="xs" weight="semibold" style={{ marginTop: 4 }}>
              {kind.label}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button title="Send link to sign" icon="send" onPress={send} loading={sending} testID="send-signing-request-btn" />
      </View>
    </View>
  );
}

function PlaceholderField({
  field,
  containerSize,
  selected,
  onSelect,
  onMove,
}: {
  field: PlacedField;
  containerSize: React.MutableRefObject<{ width: number; height: number }>;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const start = useRef({ x: field.x, y: field.y });
  const isImage = field.type === "signature" || field.type === "initials";

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        onSelect();
        start.current = { x: field.x, y: field.y };
      },
      onPanResponderMove: (_evt, gesture) => {
        const { width, height } = containerSize.current;
        if (!width || !height) return;
        const nextX = clamp(start.current.x + gesture.dx / width, 0, 0.96);
        const nextY = clamp(start.current.y + gesture.dy / height, 0, 0.96);
        onMove(nextX, nextY);
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ).current;

  const { width, height } = containerSize.current;
  const boxWidth = field.w * width;
  const boxHeight = isImage ? boxWidth / IMAGE_ASPECT : field.w * height * 1.6;
  const label = field.type === "signature" ? "Sign" : field.type === "initials" ? "Initial" : field.type === "date" ? "Date" : "Text";

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.field,
        selected && styles.fieldSelected,
        { left: field.x * width, top: field.y * height, width: boxWidth, height: boxHeight },
      ]}
    >
      <AppText size="xs" weight="bold" color={colors.brandPrimary} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  fieldCount: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    height: 44,
  },
  nameInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  expiryRow: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.lg, marginBottom: spacing.md },
  expiryPill: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surfaceSecondary, marginLeft: spacing.xs },
  expiryPillActive: { backgroundColor: colors.brandPrimary },
  pageNav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingBottom: spacing.sm },
  pageWrap: {
    flex: 1,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  field: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: colors.brandSecondary,
    borderStyle: "dashed",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(212,175,55,0.12)",
  },
  fieldSelected: { borderColor: colors.brandPrimary, borderStyle: "solid" },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  hintBar: { paddingHorizontal: spacing.lg, marginTop: spacing.sm, minHeight: 20 },
  sizeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldToolbar: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.md },
  fieldKindBtn: {
    width: 78,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
