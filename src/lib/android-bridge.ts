/**
 * Native Android glue. Every function is a safe no-op on the web, so the
 * browser/published site keeps working exactly as before.
 */
import { signedShareFileName } from "./android-intake";

export interface PendingIncomingFile {
  /** Path inside the app cache directory where the native side copied the file. */
  path?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  error?: string | null;
}

interface DocuIntakePlugin {
  getPending(): Promise<{ files: PendingIncomingFile[] }>;
  clear(): Promise<void>;
  addListener(event: "incoming", cb: () => void): Promise<{ remove: () => Promise<void> }>;
}

export async function isAndroidApp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

async function intake(): Promise<DocuIntakePlugin | null> {
  if (!(await isAndroidApp())) return null;
  const { registerPlugin } = await import("@capacitor/core");
  return registerPlugin<DocuIntakePlugin>("DocuIntake");
}

export async function getPendingIncoming(): Promise<PendingIncomingFile[]> {
  const p = await intake();
  if (!p) return [];
  return (await p.getPending()).files ?? [];
}

export async function clearPendingIncoming(): Promise<void> {
  const p = await intake();
  if (p) await p.clear();
}

export async function onIncoming(cb: () => void): Promise<() => void> {
  const p = await intake();
  if (!p) return () => {};
  const h = await p.addListener("incoming", cb);
  return () => void h.remove();
}

export async function readPendingFile(path: string): Promise<Uint8Array> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const res = await Filesystem.readFile({ path, directory: Directory.Cache });
  const b64 = typeof res.data === "string" ? res.data : await blobToBase64(res.data);
  return base64ToBytes(b64);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export interface ShareDeps {
  writeFile(opts: { path: string; data: string; directory: "CACHE"; recursive: boolean }): Promise<{ uri: string }>;
  share(opts: { title: string; files: string[]; dialogTitle: string }): Promise<unknown>;
}

/**
 * Send a signed PDF out through Android's share sheet (Gmail, Outlook, Drive...).
 * Returns false when the user backs out of the sheet.
 */
export async function shareSignedPdfAndroid(bytes: Uint8Array, title: string, deps?: ShareDeps): Promise<boolean> {
  const d = deps ?? (await defaultShareDeps());
  const name = signedShareFileName(title);
  const { uri } = await d.writeFile({ path: `outgoing/${name}`, data: bytesToBase64(bytes), directory: "CACHE", recursive: true });
  try {
    await d.share({ title, files: [uri], dialogTitle: "Send signed PDF" });
    return true;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes("cancel")) return false;
    throw err;
  }
}

async function defaultShareDeps(): Promise<ShareDeps> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  return {
    writeFile: (o) => Filesystem.writeFile({ ...o, directory: Directory.Cache }),
    share: (o) => Share.share(o),
  };
}
