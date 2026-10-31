import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";

/**
 * We lean on the system font for UI text and just make sure the icon font
 * is ready before the first render, so icons never flash-in blank.
 *
 * Want a cursive "typed signature" look? Drop a .ttf (e.g. a Google Fonts
 * signature-style font) into frontend/assets/fonts and add it here, e.g.:
 *   useFonts({ ...Ionicons.font, Signature: require("../../assets/fonts/Signature.ttf") })
 */
export function useAppFonts() {
  const [loaded] = useFonts({
    ...Ionicons.font,
  });
  return loaded;
}
