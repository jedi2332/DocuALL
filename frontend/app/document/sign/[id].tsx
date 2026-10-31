import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
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
import { api, DocumentDTO, FieldPlacement, FieldType, SignatureDTO } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/theme";

interface PlacedField extends FieldPlacement {
  id: string;
}

const DEFAULT_IMAGE_W = 0.34;
const DEFAULT_TEXT_H = 0.028;
const IMAGE_ASPECT = 2.5; // preview approximation; the server uses each signature's real aspect ratio

const FIELD_KINDS: { type: FieldType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: "signature", label: "Signature", icon: "create-outline" },
  { type: "initials", label: "Initials", icon: "text-outline" },
  { type: "date", label: "Date", icon: "calendar-outline" },
  { type: "text", label: "Text", icon: "reader-outline" },
];

function today(): string {
  return new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function localId(): string {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function SignPlacementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [doc, setDoc] = useState<DocumentDTO | null>(null);
  const [signatures, setSignatures] = useState<SignatureDTO[]>([]);
  const [sigThumbs, setSigThumbs] = useState<Record<string, string>>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSource, setPageSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  const [fields, setFields] = useState<PlacedField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [sigPickerFor, setSigPickerFor] = useState<"signature" | "initials" | null>(null);
  const [editingField, setEditingField] = useState<PlacedField | null>(null);
  const [editText, setEditText] = useState("");

  const containerSize = useRef({ width: 0, height: 0 });
  const [containerReady, setContainerReady] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [d, sigs] = await Promise.all([api.getDocument(id), api.listSignatures()]);
      setDoc(d);
      setSignatures(sigs);
      const thumbs = await Promise.all(sigs.map(async (s) => [s.id, await api.fileUrl(s.image_path)] as const));
      setSigThumbs(Object.fromEntries(thumbs));
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
    if (type === "signature" || type === "initials") {
      if (!signatures.length) {
        Alert.alert("No saved signatures", "Create one from the Signatures tab first.");
        return;
      }
      if (signatures.length > 1) {
        setSigPickerFor(type);
        return;
      }
      placeField(type, signatures[0].id);
      return;
    }
    placeField(type);
  };

  const placeField = (type: FieldType, signatureId?: string) => {
    const isImage = type === "signature" || type === "initials";
    const field: PlacedField = {
      id: localId(),
      type,
      page_index: pageIndex,
      x: 0.3,
      y: 0.4,
      w: isImage ? (type === "initials" ? DEFAULT_IMAGE_W * 0.5 : DEFAULT_IMAGE_W) : DEFAULT_TEXT_H,
      signature_id: signatureId,
      text: type === "date" ? today() : type === "text" ? "" : undefined,
    };
    setFields((prev) => [...prev, field]);
    setSelectedId(field.id);
    setSigPickerFor(null);
    if (type === "text") {
      setEditingField(field);
      setEditText("");
    }
  };

  const resizeSelected = (delta: number) => {
    if (!selectedField) return;
    const isImage = selectedField.type === "signature" || selectedField.type === "initials";
    const min = isImage ? 0.12 : 0.016;
    const max = isImage ? 0.6 : 0.06;
    updateField(selectedField.id, { w: clamp(selectedField.w + delta, min, max) });
  };

  const openEditor = (field: PlacedField) => {
    setEditingField(field);
    setEditText(field.text ?? "");
  };

  const saveEditor = () => {
    if (editingField) updateField(editingField.id, { text: editText });
    setEditingField(null);
  };

  const autoFillProfile = async () => {
    setProfileLoading(true);
    try {
      const profile = await api.getProfile();
      const values = [profile.full_name, profile.email, profile.phone, profile.address, profile.city, profile.state, profile.zip_code, profile.employer].filter(Boolean);
      let index = 0;
      setFields((prev) => prev.map((field) => {
        if (field.type !== "text" || field.text?.trim() || index >= values.length) return field;
        return { ...field, text: values[index++] };
      }));
      Alert.alert("Profile applied", "Saved details were placed into empty text fields in order.");
    } catch (e: any) {
      Alert.alert("Couldn't load profile", e?.message ?? "Save your profile in Settings first.");
    } finally {
      setProfileLoading(false);
    }
  };

  const apply = async () => {
    if (!doc) return;
    if (!fields.length) {
      Alert.alert("Add at least one field", "Tap Signature, Initials, Date, or Text below to place one.");
      return;
    }
    const incomplete = fields.find((f) => (f.type === "text" && !f.text?.trim()) || (f.type === "date" && !f.text?.trim()));
    if (incomplete) {
      Alert.alert("Empty field", "Fill in every text field before applying, or remove it.");
      return;
    }
    setApplying(true);
    try {
      await api.applyFields(
        doc.id,
        fields.map(({ id: _id, ...f }) => f)
      );
      router.back();
    } catch (e: any) {
      Alert.alert("Couldn't apply fields", e?.message ?? "Something went wrong");
    } finally {
      setApplying(false);
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
          Prepare & sign
        </AppText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Pressable onPress={autoFillProfile} disabled={profileLoading} style={styles.profileBtn}>
            {profileLoading ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="person-add-outline" size={18} color={colors.brandPrimary} />}
            <AppText size="xs" weight="semibold" color={colors.brandPrimary} style={{ marginLeft: 4 }}>Profile</AppText>
          </Pressable>
          <View style={styles.fieldCount}>
            <AppText size="xs" weight="bold" color={colors.onBrandPrimary}>
              {fields.length}
            </AppText>
          </View>
        </View>
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
            <DraggableField
              key={field.id}
              field={field}
              containerSize={containerSize}
              selected={field.id === selectedId}
              sigThumbUri={field.signature_id ? sigThumbs[field.signature_id] : undefined}
              onSelect={() => setSelectedId(field.id)}
              onMove={(x, y) => updateField(field.id, { x, y })}
              onEditText={() => openEditor(field)}
            />
          ))}
      </Pressable>

      {selectedField ? (
        <View style={styles.selectionBar}>
          <AppText size="sm" weight="semibold" style={{ textTransform: "capitalize" }}>
            {selectedField.type}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {selectedField.type === "text" || selectedField.type === "date" ? (
              <Pressable onPress={() => openEditor(selectedField)} style={styles.sizeBtn}>
                <Ionicons name="pencil" size={16} color={colors.onSurface} />
              </Pressable>
            ) : null}
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
            Tap a field type below to drop it on the page, then drag it into place
          </AppText>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fieldToolbar}>
        {FIELD_KINDS.map((kind) => (
          <Pressable key={kind.type} onPress={() => addField(kind.type)} style={styles.fieldKindBtn} testID={`add-field-${kind.type}`}>
            <Ionicons name={kind.icon} size={20} color={colors.brandPrimary} />
            <AppText size="xs" weight="semibold" style={{ marginTop: 4 }}>
              {kind.label}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          title={`Apply ${fields.length || ""} field${fields.length === 1 ? "" : "s"}`.trim()}
          icon="checkmark"
          onPress={apply}
          loading={applying}
          testID="apply-fields-btn"
        />
      </View>

      {/* Pick which saved signature/initials to use, when there's more than one */}
      <Modal visible={!!sigPickerFor} transparent animationType="fade" onRequestClose={() => setSigPickerFor(null)}>
        <Pressable style={styles.modalScrim} onPress={() => setSigPickerFor(null)}>
          <View style={styles.pickerCard}>
            <AppText weight="bold" size="lg" style={{ marginBottom: spacing.md }}>
              Choose a {sigPickerFor}
            </AppText>
            <ScrollView horizontal contentContainerStyle={{ gap: spacing.sm }}>
              {signatures.map((s) => (
                <Pressable key={s.id} style={styles.pickerOption} onPress={() => sigPickerFor && placeField(sigPickerFor, s.id)}>
                  {sigThumbs[s.id] ? (
                    <Image source={{ uri: sigThumbs[s.id] }} style={{ width: "100%", height: "100%" }} contentFit="contain" />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Edit text/date field content */}
      <Modal visible={!!editingField} transparent animationType="fade" onRequestClose={() => setEditingField(null)}>
        <Pressable style={styles.modalScrim} onPress={() => setEditingField(null)}>
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <AppText weight="bold" size="lg" style={{ marginBottom: spacing.md }}>
              {editingField?.type === "date" ? "Edit date" : "Edit text"}
            </AppText>
            <TextInput
              value={editText}
              onChangeText={setEditText}
              placeholder={editingField?.type === "date" ? "e.g. Jan 5, 2027" : "Type here"}
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.textEditorInput}
              autoFocus
              onSubmitEditing={saveEditor}
            />
            <Button title="Done" onPress={saveEditor} style={{ marginTop: spacing.lg }} testID="save-field-text-btn" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function DraggableField({
  field,
  containerSize,
  selected,
  sigThumbUri,
  onSelect,
  onMove,
  onEditText,
}: {
  field: PlacedField;
  containerSize: React.MutableRefObject<{ width: number; height: number }>;
  selected: boolean;
  sigThumbUri?: string;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onEditText: () => void;
}) {
  const start = useRef({ x: field.x, y: field.y });
  const latest = useRef({ field, onSelect, onMove });
  latest.current = { field, onSelect, onMove };
  const isImage = field.type === "signature" || field.type === "initials";

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        latest.current.onSelect();
        start.current = { x: latest.current.field.x, y: latest.current.field.y };
      },
      onPanResponderMove: (_evt, gesture) => {
        const { width, height } = containerSize.current;
        if (!width || !height) return;
        const nextX = clamp(start.current.x + gesture.dx / width, 0, 0.96);
        const nextY = clamp(start.current.y + gesture.dy / height, 0, 0.96);
        latest.current.onMove(nextX, nextY);
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ).current;

  const { width } = containerSize.current;
  const boxWidth = field.w * width;
  const boxHeight = isImage ? boxWidth / IMAGE_ASPECT : field.w * containerSize.current.height * 1.6;

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.field,
        selected && styles.fieldSelected,
        { left: field.x * width, top: field.y * containerSize.current.height, width: boxWidth, height: boxHeight },
      ]}
    >
      {isImage ? (
        sigThumbUri ? <Image source={{ uri: sigThumbUri }} style={{ width: "100%", height: "100%" }} contentFit="contain" /> : null
      ) : (
        <Pressable style={styles.textFieldInner} onPress={onEditText}>
          <AppText size="sm" numberOfLines={1} color={colors.onSurface}>
            {field.text?.trim() ? field.text : field.type === "date" ? "Date" : "Tap to type"}
          </AppText>
        </Pressable>
      )}
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
  profileBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surfaceSecondary },
  fieldCount: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
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
  },
  fieldSelected: { borderColor: colors.brandPrimary, borderStyle: "solid", backgroundColor: "rgba(212,175,55,0.12)" },
  textFieldInner: { flex: 1, justifyContent: "center", paddingHorizontal: 4 },
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
  modalScrim: { flex: 1, backgroundColor: colors.scrim, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  pickerCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: "100%" },
  pickerOption: {
    width: 110,
    height: 66,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    padding: 6,
  },
  textEditorInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.onSurface,
  },
});

