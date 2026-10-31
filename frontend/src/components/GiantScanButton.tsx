import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./AppText";
import { colors, radius, spacing } from "@/src/theme/theme";

interface GiantScanButtonProps {
  onPress: () => void;
  testID?: string;
}

export function GiantScanButton({ onPress, testID }: GiantScanButtonProps) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.9 }]}>
      <Ionicons name="scan" size={22} color={colors.onBrandPrimary} />
      <AppText weight="bold" size="lg" color={colors.onBrandPrimary} style={{ marginLeft: spacing.sm }}>
        Scan a document
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
});
