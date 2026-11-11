/** Render drawn strokes or typed names into transparent PNG signatures. */

export interface StrokePoint {
  x: number;
  y: number;
}

const INK = "#10131c";

export function strokesToPngDataUrl(
  strokes: StrokePoint[][],
  aspect = 2.5,
  strokeWidth = 6,
): string {
  const W = 600;
  const H = Math.round(W / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Strokes arrive normalized 0..1 against the pad; scale to the PNG.
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0]!.x * W, stroke[0]!.y * H);
    if (stroke.length === 1) {
      ctx.lineTo(stroke[0]!.x * W + 0.5, stroke[0]!.y * H + 0.5);
    }
    for (let i = 1; i < stroke.length; i++) {
      const p = stroke[i]!;
      ctx.lineTo(p.x * W, p.y * H);
    }
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

export function typedSignaturePngDataUrl(text: string): { dataUrl: string; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontStack = '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive';
  ctx.font = `italic 600 72px ${fontStack}`;
  const metrics = ctx.measureText(text);
  const W = Math.max(120, Math.ceil(metrics.width) + 40);
  const H = 120;
  canvas.width = W;
  canvas.height = H;
  const ctx2 = canvas.getContext("2d")!;
  ctx2.font = `italic 600 72px ${fontStack}`;
  ctx2.fillStyle = INK;
  ctx2.textBaseline = "middle";
  ctx2.fillText(text, 20, H / 2 + 8);
  return { dataUrl: canvas.toDataURL("image/png"), aspect: W / H };
}
