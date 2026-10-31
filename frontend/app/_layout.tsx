import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { DocsProvider } from "@/src/lib/docs-context";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { colors } from "@/src/theme/theme";

export default function RootLayout() {
  const fontsLoaded = useAppFonts();

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DocsProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="scan" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="document/[id]" />
            <Stack.Screen name="document/sign/[id]" options={{ presentation: "modal" }} />
            <Stack.Screen name="document/request/[id]" options={{ presentation: "modal" }} />
          </Stack>
        </DocsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
