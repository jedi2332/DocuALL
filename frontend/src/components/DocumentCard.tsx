import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./AppText";
import { api, DocumentDTO } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/theme";

interface DocumentCardProps {
  doc: DocumentDTO;
  onPress: () => void;
}

export function DocumentCard({ doc, onPress }: DocumentCardProps) {
  const [thumbUri, setThumbUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (doc.thumbnail_path) {
      api.fileUrl(doc.thumbnail_path).then((url) => {
        if (!cancelled) setThumbUri(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [doc.thumbnail_path]);

  const subtitle = [doc.vendor, doc.doc_date, doc.amount].filter(Boolean).join(" \u00b7 ");

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={styles.thumbWrap}>
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.thumb} contentFit="cover" />
        ) : (
          <Ionicons name="document-text-outline" size={26} color={colors.onSurfaceTertiary} />
        )}
        {doc.kind === "imported" ? (
          <View style={styles.badge}>
            <Ionicons name="download" size={10} color={colors.onBrandPrimary} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <AppText weight="semibold" size="md" numberOfLines={1}>
          {doc.title}
        </AppText>
        <AppText size="sm" color={colors.onSurfaceTertiary} numberOfLines={1} style={{ marginTop: 2 }}>
          {subtitle || `${doc.page_count} ${doc.page_count === 1 ? "page" : "pages"}`}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  thumbWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
  },
  badge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
