import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Zap, ZapOff, Camera, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandHomeLink } from "@/components/BrandLogo";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { createDocumentFromPages } from "@/lib/docs-api";
import { fileToProcessedJpeg, bytesToObjectUrl } from "@/lib/image-utils";
import type { ScannedPage } from "@/lib/docuall-types";

export const Route = createFileRoute("/_authenticated/scan")({
  head: () => ({
    meta: [
      { title: "Scan — DocuALL" },
      { name: "description", content: "Scan pages with your camera." },
      { property: "og:title", content: "Scan — DocuALL" },
      { property: "og:description", content: "Scan pages with your camera." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScanPage,
});

function ScanPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [torchOn, setTorchOn] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [grayscale, setGrayscale] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch && track) {
          setTorchSupported(true);
          // Torch on by default — reads more evenly than a flash pop on glossy paper.
          try {
            await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] });
          } catch {
            setTorchSupported(false);
          }
        }
        setCameraReady(true);
      } catch {
        setCameraError(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleTorch = async (on: boolean) => {
    setTorchOn(on);
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    } catch {
      /* device refused */
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Capture failed"))), "image/jpeg", 0.92),
    );
    const bytes = await fileToProcessedJpeg(blob, { enhance, grayscale });
    setPages((p) => [...p, { bytes, previewUrl: bytesToObjectUrl(bytes) }]);
  };

  const onFilePicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const bytes = await fileToProcessedJpeg(file, { enhance, grayscale });
    setPages((p) => [...p, { bytes, previewUrl: bytesToObjectUrl(bytes) }]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const save = async () => {
    if (!pages.length) return;
    setSaving(true);
    try {
      const doc = await createDocumentFromPages(pages.map((p) => p.bytes));
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document saved");
      navigate({ to: "/document/$id", params: { id: doc.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <BrandHomeLink iconClassName="h-7 w-7 shrink-0 shadow-[0_0_14px_var(--primary)]" />
        <span className="font-medium text-foreground">Scan</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => navigate({ to: "/documents" })}>Cancel</Button>
          {torchSupported ? (
            <Button variant="ghost" size="icon" onClick={() => toggleTorch(!torchOn)} aria-label="Toggle flashlight">
              {torchOn ? <Zap className="h-5 w-5 text-cyan-glow" /> : <ZapOff className="h-5 w-5" />}
            </Button>
          ) : (
            <span className="w-10" />
          )}
        </div>
      </header>

      <div className="relative flex-1 bg-black">
        {!cameraError ? (
          <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-foreground">Camera isn't available here</p>
            <p className="text-sm text-muted-foreground">Take a photo with your camera app, then add it here.</p>
            <Button onClick={() => fileInput.current?.click()}>
              <Camera className="mr-2 h-4 w-4" /> Add a photo
            </Button>
          </div>
        )}
        <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFilePicked(e.target.files)} />

        {cameraReady && !cameraError && (
          <div className="absolute inset-x-0 bottom-6 flex items-center justify-center">
            <button
              type="button"
              onClick={capture}
              aria-label="Capture page"
              className="h-18 w-18 rounded-full border-4 border-white bg-white/20 p-1 backdrop-blur"
            >
              <span className="block h-full w-full rounded-full bg-white" />
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border bg-card p-4">
        <div className="flex items-center justify-center gap-6">
          <div className="flex items-center gap-2">
            <Switch id="enhance" checked={enhance} onCheckedChange={setEnhance} />
            <Label htmlFor="enhance" className="text-sm">Enhance</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="grayscale" checked={grayscale} onCheckedChange={setGrayscale} />
            <Label htmlFor="grayscale" className="text-sm">B&amp;W</Label>
          </div>
        </div>

        {pages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto py-1">
            {pages.map((p, i) => (
              <div key={i} className="relative shrink-0">
                <img src={p.previewUrl} alt={`Page ${i + 1}`} className="h-20 w-14 rounded-md border border-border object-cover" />
                <button
                  type="button"
                  aria-label={`Remove page ${i + 1}`}
                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-1"
                  onClick={() => setPages((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3 w-3 text-destructive-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Button className="w-full" disabled={!pages.length || saving} onClick={save}>
          <Check className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : `Save ${pages.length || ""} ${pages.length === 1 ? "page" : "pages"}`}
        </Button>
      </div>
    </div>
  );
}
