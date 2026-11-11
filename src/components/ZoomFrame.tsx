import { useState, type ReactNode } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Smooth pinch / wheel / double-tap zoom for a document page. At 1x the page
 * scrolls normally; once zoomed, one-finger drag pans. Elements with the
 * `zoom-exclude` class (draggable fields) are never treated as pan handles.
 */
export function ZoomFrame({ children, className }: { children: ReactNode; className?: string }) {
  const [scale, setScale] = useState(1);
  const zoomed = scale > 1.01;
  return (
    <TransformWrapper
      minScale={1}
      maxScale={5}
      initialScale={1}
      centerZoomedOut
      limitToBounds
      wheel={{ step: 0.15, activationKeys: [] }}
      pinch={{ step: 5 }}
      doubleClick={{ mode: zoomed ? "reset" : "zoomIn", step: 1.2, animationTime: 200 }}
      panning={{ disabled: !zoomed, excluded: ["zoom-exclude"], velocityDisabled: false }}
      velocityAnimation={{ animationTime: 300 }}
      onTransform={(_ref: unknown, s: { scale: number }) => setScale(s.scale)}
    >
      {({ zoomIn, zoomOut, resetTransform }) => (
        <div className={`relative ${className ?? ""}`}>
          <TransformComponent wrapperStyle={{ width: "100%", touchAction: zoomed ? "none" : "pan-y" }} contentStyle={{ width: "100%" }}>
            {children}
          </TransformComponent>
          <div className="absolute bottom-2 right-2 z-10 flex gap-1 rounded-full border border-border bg-card/90 p-1 backdrop-blur">
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => zoomOut(0.5)} disabled={!zoomed} aria-label="Zoom out">
              <Minus className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => zoomIn(0.5)} aria-label="Zoom in">
              <Plus className="h-4 w-4" />
            </Button>
            {zoomed && (
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => resetTransform()} aria-label="Fit page">
                <Maximize2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </TransformWrapper>
  );
}
