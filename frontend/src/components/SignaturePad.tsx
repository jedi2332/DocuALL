import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { LayoutChangeEvent, PanResponder, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors, radius } from "@/src/theme/theme";

export interface Point {
  x: number;
  y: number;
}

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** Strokes as points normalized to 0-1 of the pad's width/height. */
  getStrokes: () => Point[][];
}

interface SignaturePadProps {
  aspect?: number; // width / height
  strokeWidth?: number;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  ({ aspect = 2.5, strokeWidth = 4 }, ref) => {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [strokes, setStrokes] = useState<Point[][]>([]);
    const currentStroke = useRef<Point[]>([]);

    const onLayout = (e: LayoutChangeEvent) => {
      const { width } = e.nativeEvent.layout;
      setSize({ width, height: width / aspect });
    };

    const toPoint = (x: number, y: number): Point => ({
      x: size.width ? x / size.width : 0,
      y: size.height ? y / size.height : 0,
    });

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentStroke.current = [toPoint(locationX, locationY)];
          setStrokes((prev) => [...prev, currentStroke.current]);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentStroke.current = [...currentStroke.current, toPoint(locationX, locationY)];
          setStrokes((prev) => {
            const next = prev.slice(0, -1);
            next.push(currentStroke.current);
            return next;
          });
        },
        onPanResponderRelease: () => {
          currentStroke.current = [];
        },
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ).current;

    useImperativeHandle(ref, () => ({
      clear: () => setStrokes([]),
      isEmpty: () => strokes.length === 0,
      getStrokes: () => strokes,
    }));

    const toPath = (stroke: Point[]) => {
      if (!stroke.length) return "";
      const [first, ...rest] = stroke;
      const start = `M ${first.x * size.width} ${first.y * size.height}`;
      const lines = rest.map((p) => `L ${p.x * size.width} ${p.y * size.height}`).join(" ");
      return `${start} ${lines}`;
    };

    return (
      <View style={styles.wrap} onLayout={onLayout} {...panResponder.panHandlers}>
        {size.width > 0 ? (
          <Svg width={size.width} height={size.height}>
            {strokes.map((stroke, i) =>
              stroke.length === 1 ? (
                <Path
                  key={i}
                  d={`M ${stroke[0].x * size.width} ${stroke[0].y * size.height} l 0.1 0`}
                  stroke={colors.onSurface}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                />
              ) : (
                <Path
                  key={i}
                  d={toPath(stroke)}
                  stroke={colors.onSurface}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )
            )}
          </Svg>
        ) : null}
      </View>
    );
  }
);

SignaturePad.displayName = "SignaturePad";

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
});
