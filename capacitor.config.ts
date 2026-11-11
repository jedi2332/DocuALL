import type { CapacitorConfig } from "@capacitor/cli";

// The Android shell loads the published DocuALL web app. Publish web changes
// before testing them in the installed app.
const config: CapacitorConfig = {
  appId: "com.docuall.app",
  appName: "DocuALL",
  webDir: "android-shell",
  server: {
    url: "https://docuall-visual-studio.lovable.app",
    androidScheme: "https",
  },
  android: { backgroundColor: "#090A0F" },
};

export default config;
