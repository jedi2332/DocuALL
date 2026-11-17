import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/src/components/AppText";
import { Button } from "@/src/components/Button";
import { api } from "@/src/lib/api";
import { getDeviceId } from "@/src/lib/device-id";
import { colors, radius, spacing } from "@/src/theme/theme";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [apiUrl, setApiUrlText] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({ full_name: "", email: "", phone: "", address: "", city: "", state: "", zip_code: "", employer: "" });
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    api.getApiUrl().then(setApiUrlText);
    getDeviceId().then(setDeviceId);
    api.getProfile().then(setProfile).catch(() => undefined);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.testApiUrl(apiUrl);
      await api.setApiUrl(apiUrl);
      Alert.alert("Saved", "Connected to the DocuALL server.");
    } catch (e: any) {
      Alert.alert("Not saved", e?.message ?? "Check the URL and that the backend is running. Your previous server address is unchanged.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl }}>
      <AppText weight="bold" size="2xl" style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.lg }}>
        Settings
      </AppText>

      <Section title="Server">
        <AppText size="sm" color={colors.onSurfaceTertiary} style={{ marginBottom: spacing.sm }}>
          The address of your DocuALL backend. On a physical device this needs to be your computer's LAN IP, not
          "localhost".
        </AppText>
        <TextInput
          value={apiUrl}
          onChangeText={setApiUrlText}
          placeholder="http://192.168.1.10:8000"
          placeholderTextColor={colors.onSurfaceTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Button title="Save & test connection" onPress={save} loading={saving} style={{ marginTop: spacing.md }} testID="save-api-url-btn" />
      </Section>

      <Section title="Saved profile">
        <AppText size="sm" color={colors.onSurfaceTertiary} style={{ marginBottom: spacing.sm }}>
          Save your details once, then use them to fill matching form fields.
        </AppText>
        {([
          ["full_name", "Full name"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"],
          ["city", "City"], ["state", "State"], ["zip_code", "ZIP code"], ["employer", "Employer"],
        ] as const).map(([key, label]) => (
          <TextInput key={key} value={profile[key]} onChangeText={(v) => setProfile((p) => ({ ...p, [key]: v }))} placeholder={label} placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { marginBottom: spacing.sm }]} autoCapitalize="words" />
        ))}
        <Button title="Save profile" onPress={async () => { setProfileSaving(true); try { setProfile(await api.saveProfile(profile)); Alert.alert("Saved", "Your profile is ready for matching form fields."); } catch (e: any) { Alert.alert("Couldn't save profile", e?.message ?? "Try again."); } finally { setProfileSaving(false); } }} loading={profileSaving} />
      </Section>

      <Section title="About">
        <Row icon="phone-portrait-outline" label="Device ID" value={deviceId.slice(0, 8)} />
        <Row icon="information-circle-outline" label="Version" value="1.0.0" />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.xl }}>
      <AppText weight="semibold" size="sm" color={colors.onSurfaceTertiary} style={{ marginBottom: spacing.sm, textTransform: "uppercase" }}>
        {title}
      </AppText>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.onSurfaceSecondary} />
      <AppText style={{ flex: 1, marginLeft: spacing.md }}>{label}</AppText>
      <AppText color={colors.onSurfaceTertiary}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.onSurface,
  },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
});
