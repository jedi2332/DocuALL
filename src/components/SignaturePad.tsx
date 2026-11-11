import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eraser } from "lucide-react";
import { strokesToPngDataUrl, typedSignaturePngDataUrl, type StrokePoint } from "@/lib/signature-render";
import { dataUrlToBytes } from "@/lib/image-utils";

export function SignaturePad({
  onSave,
  saving,
}: {
  onSave: (kind: "draw" | "type", pngBytes: Uint8Array) => void;
  saving?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<StrokePoint[][]>([]);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const drawing = useRef(false);

  const redraw = (all: StrokePoint[][]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of all) {
      if (!stroke.length) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0]!.x * canvas.width, stroke[0]!.y * canvas.height);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i]!.x * canvas.width, stroke[i]!.y * canvas.height);
      if (stroke.length === 1) ctx.lineTo(stroke[0]!.x * canvas.width + 0.5, stroke[0]!.y * canvas.height + 0.5);
      ctx.stroke();
    }
  };

  useEffect(() => {
    redraw(strokes);
  }, [strokes]);

  const pointFromEvent = (e: React.PointerEvent): StrokePoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const canSave = mode === "draw" ? strokes.length > 0 : typed.trim().length > 0;

  const handleSave = () => {
    if (mode === "draw") {
      const dataUrl = strokesToPngDataUrl(strokes, 2.5, 8);
      onSave("draw", dataUrlToBytes(dataUrl));
    } else {
      const { dataUrl } = typedSignaturePngDataUrl(typed.trim());
      onSave("type", dataUrlToBytes(dataUrl));
    }
    setStrokes([]);
    setTyped("");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button variant={mode === "draw" ? "default" : "secondary"} onClick={() => setMode("draw")} type="button">
          Draw
        </Button>
        <Button variant={mode === "type" ? "default" : "secondary"} onClick={() => setMode("type")} type="button">
          Type
        </Button>
      </div>

      {mode === "draw" ? (
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={600}
            height={240}
            className="h-48 w-full touch-none rounded-xl border border-border bg-secondary"
            onPointerDown={(e) => {
              drawing.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setStrokes((s) => [...s, [pointFromEvent(e)]]);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const p = pointFromEvent(e);
              setStrokes((s) => {
                const next = [...s];
                next[next.length - 1] = [...next[next.length - 1]!, p];
                return next;
              });
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2"
            onClick={() => setStrokes([])}
            aria-label="Clear"
          >
            <Eraser className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type your full name"
            maxLength={40}
          />
          {typed.trim() && (
            <div className="flex h-24 items-center justify-center rounded-xl border border-border bg-secondary">
              <span className="font-display text-3xl italic text-foreground">{typed}</span>
            </div>
          )}
        </div>
      )}

      <Button className="w-full" disabled={!canSave || saving} onClick={handleSave} type="button">
        {saving ? "Saving…" : "Save signature"}
      </Button>
    </div>
  );
}
