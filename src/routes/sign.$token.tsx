import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BrandHomeLink, BrandIcon } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPublicSigningRequest, completeSigningRequest } from "@/lib/signing.functions";
import { renderPdfPages } from "@/lib/pdf-render";
import { strokesToPngDataUrl, typedSignaturePngDataUrl, type StrokePoint } from "@/lib/signature-render";
import { FIELD_COLORS, FIELD_LABELS, type FieldType } from "@/lib/docuall-types";
import { cn } from "@/lib/utils";
import { ZoomFrame } from "@/components/ZoomFrame";

interface PendingField {
  id: string;
  type: FieldType;
  page_index: number;
  x: number;
  y: number;
  w: number;
  label?: string;
}

export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [
      { title: "Sign document — DocuALL" },
      { name: "description", content: "You've been asked to sign a document." },
      { property: "og:title", content: "Sign document — DocuALL" },
      { property: "og:description", content: "You've been asked to sign a document." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicSignPage,
});

function PublicSignPage() {
  const { token } = Route.useParams();
  const fetchRequest = useServerFn(getPublicSigningRequest);
  const submitRequest = useServerFn(completeSigningRequest);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [signerName, setSignerName] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [fields, setFields] = useState<PendingField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeField, setActiveField] = useState<PendingField | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchRequest({ data: { token } });
        if (res.status === "completed") {
          setDone(true);
          setLoading(false);
          return;
        }
        setDocTitle(res.docTitle);
        setSignerName(res.signerName);
        setFields(res.fields);
        if (res.pageUrls.length > 0) {
          setPages(res.pageUrls);
        } else if (res.pdfUrl) {
          const bytes = new Uint8Array(await (await fetch(res.pdfUrl)).arrayBuffer());
          setPages((await renderPdfPages(bytes)).map((p) => p.dataUrl));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load this signing link");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, fetchRequest]);

  const filledCount = fields.filter((f) => values[f.id]).length;

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitRequest({
        data: { token, fields: fields.map((f) => ({ id: f.id, value: values[f.id]! })) },
      });
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Loading…</div>;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-semibold text-foreground">Link unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center space-y-2">
          <BrandIcon className="mx-auto mb-4 h-16 w-16 shadow-[0_0_24px_var(--primary)]" />
          <h1 className="font-display text-2xl font-bold text-foreground">All signed!</h1>
          <p className="text-sm text-muted-foreground">
            Thanks{signerName ? `, ${signerName}` : ""} — your signed document has been sent back. You can close this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen studio-screen pb-32">
      <header className="studio-header sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <BrandHomeLink iconClassName="h-9 w-9 shrink-0 shadow-[0_0_16px_var(--primary)]" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">DocuALL signing request</p>
            <h1 className="truncate font-display font-semibold text-foreground">{docTitle}</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <p className="text-sm text-muted-foreground">
          Hi {signerName} — tap each highlighted field to fill it in, then submit at the bottom.
        </p>

        {pages.map((url, pageIdx) => (
          <ZoomFrame key={pageIdx} className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="relative bg-white">
            <img src={url} alt={`Page ${pageIdx + 1}`} className="block w-full" draggable={false} />
            {fields
              .filter((f) => f.page_index === pageIdx)
              .map((f) => {
                const isImage = f.type === "signature" || f.type === "initials";
                const filled = values[f.id];
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActiveField(f)}
                    className={cn(
                      "absolute flex items-center justify-center overflow-hidden rounded border-2 px-1",
                      filled ? "border-solid border-transparent" : "border-dashed",
                    )}
                    style={{
                      left: `${f.x * 100}%`,
                      top: `${f.y * 100}%`,
                      width: isImage ? `${f.w * 100}%` : undefined,
                      minWidth: isImage ? undefined : "15%",
                      minHeight: 28,
                      borderColor: filled ? "transparent" : FIELD_COLORS[f.type],
                      backgroundColor: filled ? "transparent" : `${FIELD_COLORS[f.type]}22`,
                    }}
                  >
                    {filled ? (
                      isImage ? (
                        <img src={filled} alt="Signed" className="max-h-16 w-full object-contain" />
                      ) : (
                        <span className="text-sm font-medium text-black">{filled}</span>
                      )
                    ) : (
                      <span className="truncate text-[10px] font-semibold" style={{ color: FIELD_COLORS[f.type] }}>
                        {f.label || FIELD_LABELS[f.type]}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
          </ZoomFrame>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <Button className="w-full" size="lg" disabled={filledCount < fields.length || submitting} onClick={submit}>
            {submitting ? "Submitting…" : filledCount < fields.length ? `Fill all fields (${filledCount}/${fields.length})` : "Submit signed document"}
          </Button>
        </div>
      </div>

      {activeField && (
        <FillFieldDialog
          field={activeField}
          onDone={(value) => {
            setValues((v) => ({ ...v, [activeField.id]: value }));
            setActiveField(null);
          }}
          onClose={() => setActiveField(null)}
        />
      )}
    </div>
  );
}

function FillFieldDialog({
  field,
  onDone,
  onClose,
}: {
  field: PendingField;
  onDone: (value: string) => void;
  onClose: () => void;
}) {
  const isImage = field.type === "signature" || field.type === "initials";
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [text, setText] = useState(field.type === "date" ? new Date().toLocaleDateString("en-US") : "");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<StrokePoint[][]>([]);
  const drawing = useRef(false);
  const [, forceRedraw] = useState(0);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes.current) {
      if (!stroke.length) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0]!.x * canvas.width, stroke[0]!.y * canvas.height);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i]!.x * canvas.width, stroke[i]!.y * canvas.height);
      if (stroke.length === 1) ctx.lineTo(stroke[0]!.x * canvas.width + 0.5, stroke[0]!.y * canvas.height + 0.5);
      ctx.stroke();
    }
  };

  useEffect(() => {
    redraw();
  }, []);

  const pointFromEvent = (e: React.PointerEvent): StrokePoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const canDone = isImage ? (mode === "draw" ? strokes.current.length > 0 : typed.trim().length > 0) : text.trim().length > 0;

  const finish = () => {
    if (isImage) {
      if (mode === "draw") {
        onDone(strokesToPngDataUrl(strokes.current, field.type === "initials" ? 1.6 : 2.5, 8));
      } else {
        onDone(typedSignaturePngDataUrl(typed.trim()).dataUrl);
      }
    } else {
      onDone(text.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-t-2xl border border-border bg-card p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display font-semibold text-foreground">{field.label || FIELD_LABELS[field.type]}</h2>

        {isImage ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={mode === "draw" ? "default" : "secondary"} onClick={() => setMode("draw")}>Draw</Button>
              <Button type="button" variant={mode === "type" ? "default" : "secondary"} onClick={() => setMode("type")}>Type</Button>
            </div>
            {mode === "draw" ? (
              <canvas
                ref={canvasRef}
                width={600}
                height={240}
                className="h-44 w-full touch-none rounded-xl border border-border bg-secondary"
                onPointerDown={(e) => {
                  drawing.current = true;
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  strokes.current = [...strokes.current, [pointFromEvent(e)]];
                  redraw();
                }}
                onPointerMove={(e) => {
                  if (!drawing.current) return;
                  const p = pointFromEvent(e);
                  const next = [...strokes.current];
                  next[next.length - 1] = [...next[next.length - 1]!, p];
                  strokes.current = next;
                  redraw();
                }}
                onPointerUp={() => {
                  drawing.current = false;
                  forceRedraw((n) => n + 1);
                }}
              />
            ) : (
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your name" maxLength={40} />
            )}
          </>
        ) : (
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={field.type === "date" ? "Date" : field.label || "Text"}
            maxLength={120}
            autoFocus
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!canDone} onClick={finish}>Done</Button>
        </div>
      </div>
    </div>
  );
}
