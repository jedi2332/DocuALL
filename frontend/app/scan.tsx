import React, { useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/src/components/AppText";
import { Button } from "@/src/components/Button";
import { api } from "@/src/lib/api";
import { useDocs } from "@/src/lib/docs-context";
import { colors, radius, spacing } from "@/src/theme/theme";

interface Page {
  uri: string;
  base64: string;
}

async function processUri(uri: string): Promise<Page | null> {
  try {
    const saved = await manipulateAsync(uri, [{ resize: { width: 1600 } }], {
      format: SaveFormat.JPEG,
      base64: true,
      compress: 0.7,
    });
    if (!saved.base64) return null;
    return { uri: saved.uri, base64: saved.base64 };
  } catch {
    return null;
  }
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { template } = useLocalSearchParams<{ template?: string }>();
  const { refresh } = useDocs();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [pages, setPages] = useState<Page[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [torchOn, setTorchOn] = useState(true);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [saving, setSaving] = useState(false);

  const capture = async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) {
        const p = await processUri(photo.uri);
        if (p) setPages((prev) => [...prev, p]);
      }
    } finally {
      setCapturing(false);
    }
  };

  const importFromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (res.canceled) return;
    const processed: Page[] = [];
    for (const asset of res.assets) {
      const p = await processUri(asset.uri);
      if (p) processed.push(p);
    }
    if (processed.length) {
      setPages((prev) => [...prev, ...processed]);
      setReviewing(true);
    }
  };

  const save = async () => {
    if (!pages.length) return;
    setSaving(true);
    try {
      const doc = await api.createDocument(pages.map((p) => ({ base64: p.base64, enhance: true })), template);
      await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/document/${doc.id}`);
    } catch (e: any) {
      setSaving(false);
      Alert.alert(
        "Couldn't save scan",
        e?.message ?? "Check the server connection and try again. Your captured pages are still here."
      );
    }
  };

  // ---- Permission gate ----
  if (!permission) {
    return <View style={[styles.permWrap, { paddingTop: insets.top }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.permWrap, { paddingTop: insets.top }]}>
        <Pressable testID="scan-close" onPress={() => router.back()} style={styles.permClose}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.permBody}>
          <View style={styles.permIcon}>
            <Ionicons name="camera" size={44} color={colors.brandPrimary} />
          </View>
          <AppText weight="bold" size="2xl" style={{ marginTop: spacing.lg, textAlign: "center" }}>
            Scan with your camera
          </AppText>
          <AppText
            weight="medium"
            color={colors.onSurfaceTertiary}
            style={{ marginTop: spacing.sm, textAlign: "center", lineHeight: 22 }}
          >
            DocuALL needs the camera to capture crisp, auto-enhanced document scans.
          </AppText>
          <View style={{ height: spacing.xl }} />
          {permission.canAskAgain ? (
            <Button testID="grant-camera" title="Allow Camera" icon="camera" onPress={requestPermission} size="lg" />
          ) : (
            <Button
              testID="open-settings"
              title="Open Settings"
              icon="settings-outline"
              onPress={() => Linking.openSettings()}
              size="lg"
            />
          )}
          <Pressable onPress={importFromGallery} style={{ marginTop: spacing.lg }}>
            <AppText weight="semibold" color={colors.brandPrimary}>
              Import from gallery instead
            </AppText>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- Review mode ----
  if (reviewing) {
    return (
      <View style={styles.reviewWrap}>
        <View style={[styles.reviewHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable testID="review-back" onPress={() => setReviewing(false)} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <AppText weight="bold" size="lg">
            {pages.length} {pages.length === 1 ? "page" : "pages"} captured
          </AppText>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 }}>
          {pages.map((p, i) => (
            <View key={i} style={styles.reviewPage}>
              <Image source={{ uri: p.uri }} style={styles.reviewImg} contentFit="contain" />
              <Pressable
                testID={`remove-page-${i}`}
                onPress={() => setPages((prev) => prev.filter((_, idx) => idx !== i))}
                style={styles.removeBtn}
              >
                <Ionicons name="trash" size={16} color={colors.onError} />
              </Pressable>
              <View style={styles.pageNum}>
                <AppText mono weight="bold" size="sm" color={colors.onBrandPrimary}>
                  {i + 1}
                </AppText>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.reviewActions, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            title="Retake"
            variant="secondary"
            icon="refresh"
            onPress={() => {
              setPages((prev) => prev.slice(0, -1));
              setReviewing(false);
            }}
            style={{ flex: 1 }}
            testID="retake-btn"
          />
          <Button
            title="Add Page"
            variant="secondary"
            icon="add"
            onPress={() => setReviewing(false)}
            style={{ flex: 1 }}
            testID="add-page-btn"
          />
          <Button title="Save" icon="checkmark" onPress={save} loading={saving} style={{ flex: 1.3 }} testID="save-process-btn" />
        </View>

        {saving ? <ProcessingOverlay /> : null}
      </View>
    );
  }

  // ---- Camera capture mode ----
  return (
    <View style={styles.cameraWrap}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} enableTorch={facing === "back" && torchOn} />

      {/* edge guide overlay */}
      <View pointerEvents="none" style={styles.guideOverlay}>
        <View style={styles.guideFrame} />
        <AppText weight="semibold" color="#FFFFFF" style={styles.guideHint}>
          Fit the document inside the frame
        </AppText>
      </View>

      {/* top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="scan-close" onPress={() => router.back()} style={styles.topBtn}>
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <Pressable
          testID="flip-camera"
          onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
          style={styles.topBtn}
        >
          <Ionicons name="camera-reverse" size={22} color="#FFFFFF" />
        </Pressable>
        <Pressable
          testID="flash-toggle"
          onPress={() => setTorchOn((t) => !t)}
          style={[styles.topBtn, torchOn && styles.topBtnActive]}
        >
          <Ionicons name={torchOn ? "flashlight" : "flashlight-outline"} size={22} color={torchOn ? colors.brandPrimary : "#FFFFFF"} />
        </Pressable>
      </View>

      {/* bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.lg }]}>
        {pages.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.lg }}
          >
            {pages.map((p, i) => (
              <Image key={i} source={{ uri: p.uri }} style={styles.stripThumb} contentFit="cover" />
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.controlsRow}>
          <Pressable testID="gallery-import" onPress={importFromGallery} style={styles.sideBtn}>
            <Ionicons name="images" size={26} color="#FFFFFF" />
          </Pressable>

          <Pressable testID="shutter-btn" onPress={capture} style={styles.shutterOuter}>
            <View style={styles.shutterInner}>{capturing ? <ActivityIndicator color={colors.brandPrimary} /> : null}</View>
          </Pressable>

          <Pressable
            testID="done-btn"
            onPress={() => pages.length && setReviewing(true)}
            style={[styles.sideBtn, pages.length === 0 && { opacity: 0.4 }]}
            disabled={pages.length === 0}
          >
            <View style={styles.doneBadge}>
              <Ionicons name="checkmark" size={22} color={colors.onBrandPrimary} />
              {pages.length > 0 ? (
                <View style={styles.doneCount}>
                  <AppText mono weight="bold" size={11} color={colors.onBrandPrimary}>
                    {pages.length}
                  </AppText>
                </View>
              ) : null}
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ProcessingOverlay() {
  return (
    <View style={styles.processing} testID="processing-overlay">
      <View style={styles.processingCard}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        <AppText weight="bold" size="lg" style={{ marginTop: spacing.lg, textAlign: "center" }}>
          Enhancing & saving…
        </AppText>
        <AppText weight="medium" color={colors.onSurfaceTertiary} style={{ marginTop: 4, textAlign: "center" }}>
          Building your PDF
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  permWrap: { flex: 1, backgroundColor: colors.surface },
  permClose: { padding: spacing.lg },
  permBody: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, marginTop: -60 },
  permIcon: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraWrap: { flex: 1, backgroundColor: "#000" },
  guideOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  guideFrame: {
    width: "82%",
    height: "58%",
    borderRadius: radius.lg,
    borderWidth: 2.5,
    borderColor: colors.brandPrimary,
    borderStyle: "dashed",
  },
  guideHint: { position: "absolute", bottom: "18%", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  topBtnActive: { backgroundColor: "#FFFFFF" },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, gap: spacing.md },
  strip: { maxHeight: 72 },
  stripThumb: { width: 54, height: 72, borderRadius: 8, borderWidth: 2, borderColor: "#FFFFFF" },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  sideBtn: { width: 54, height: 54, alignItems: "center", justifyContent: "center" },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  doneBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  doneCount: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.onSurface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: "#000",
  },
  reviewWrap: { flex: 1, backgroundColor: colors.surfaceSecondary },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewPage: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewImg: { width: "100%", height: 420, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  removeBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  pageNum: {
    position: "absolute",
    bottom: spacing.md,
    left: spacing.md,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  reviewActions: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  processing: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  processingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing["2xl"],
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
  },
});
