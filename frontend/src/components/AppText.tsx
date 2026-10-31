import React from "react";
import { Text, TextProps, TextStyle } from "react-native";
import { colors, fontSizes } from "@/src/theme/theme";

type Weight = "regular" | "medium" | "semibold" | "bold";
type Size = keyof typeof fontSizes | number;

interface AppTextProps extends TextProps {
  weight?: Weight;
  size?: Size;
  color?: string;
  mono?: boolean;
  children?: React.ReactNode;
}

const weightMap: Record<Weight, TextStyle["fontWeight"]> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

export function AppText({ weight = "regular", size = "md", color, mono, style, children, ...rest }: AppTextProps) {
  const fontSize = typeof size === "number" ? size : fontSizes[size];
  return (
    <Text
      {...rest}
      style={[
        {
          fontSize,
          fontWeight: weightMap[weight],
          color: color ?? colors.onSurface,
          fontVariant: mono ? ["tabular-nums"] : undefined,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
