import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getDeviceId } from "./device-id";

const API_URL_KEY = "docuall.api_url";
const DEFAULT_API_URL = (Constants.expoConfig?.extra?.apiUrl as string) || "http://localhost:8000";

let cachedBaseUrl: string | null = null;

export async function getApiUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const stored = await AsyncStorage.getItem(API_URL_KEY);
  cachedBaseUrl = stored || DEFAULT_API_URL;
  return cachedBaseUrl;
}

export async function setApiUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, "");
  cachedBaseUrl = trimmed;
  await AsyncStorage.setItem(API_URL_KEY, trimmed);
}

export interface DocPage {
  base64: string;
  enhance?: boolean;
  grayscale?: boolean;
}

export interface DocumentDTO {
  id: string;
  title: string;
  kind: "scanned" | "imported";
  vendor?: string;
  doc_date?: string;
  amount?: string;
  category?: string;
  page_count: number;
  pdf_path?: string;
  thumbnail_path?: string;
  created_at: string;
  updated_at: string;
}

export interface SignatureDTO {
  id: string;
  kind: "draw" | "type";
  image_path: string;
  created_at: string;
}

export type FieldType = "signature" | "initials" | "date" | "text";

export interface FieldPlacement {
  type: FieldType;
  page_index: number;
  x: number;
  y: number;
  w: number;
  signature_id?: string;
  text?: string;
}

export interface PendingFieldPlacement {
  type: FieldType;
  page_index: number;
  x: number;
  y: number;
  w: number;
  label?: string;
}

export interface ProfileDTO {
  full_name: string; email: string; phone: string; address: string; city: string; state: string; zip_code: string; employer: string;
}

export interface SigningRequestDTO {
  id: string;
  doc_id: string;
  signer_name: string;
  status: "pending" | "completed" | "cancelled" | "expired";
  created_at: string;
  completed_at?: string;
  expires_at?: string;
  url: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [base, deviceId] = await Promise.all([getApiUrl(), getDeviceId()]);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(`${base}/api${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      "X-Device-Id": deviceId,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  getApiUrl,
  setApiUrl,

  listDocuments: () => request<DocumentDTO[]>("/documents"),
  getDocument: (id: string) => request<DocumentDTO>(`/documents/${id}`),
  createDocument: (pages: DocPage[], title?: string) =>
    request<DocumentDTO>("/documents", { method: "POST", body: JSON.stringify({ pages, title }) }),
  renameDocument: (id: string, title: string) =>
    request<DocumentDTO>(`/documents/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/documents/${id}`, { method: "DELETE" }),

  importPdf: async (fileUri: string, filename: string, title?: string) => {
    const form = new FormData();
    // @ts-expect-error - React Native's fetch accepts this file-like shape
    form.append("file", { uri: fileUri, name: filename, type: "application/pdf" });
    if (title) form.append("title", title);
    return request<DocumentDTO>("/documents/import-pdf", { method: "POST", body: form });
  },

  signDocument: (id: string, placement: { signature_id: string; page_index: number; x: number; y: number; w: number }) =>
    request<DocumentDTO>(`/documents/${id}/sign`, { method: "POST", body: JSON.stringify(placement) }),

  applyFields: (id: string, fields: FieldPlacement[]) =>
    request<DocumentDTO>(`/documents/${id}/apply-fields`, { method: "POST", body: JSON.stringify({ fields }) }),

  getProfile: () => request<ProfileDTO>("/profile"),
  saveProfile: (profile: ProfileDTO) => request<ProfileDTO>("/profile", { method: "PATCH", body: JSON.stringify(profile) }),
  runOcr: (docId: string) => request<{ text: string; document: DocumentDTO }>(`/documents/${docId}/ocr`, { method: "POST" }),
  autoFillProfile: (docId: string, fields: FieldPlacement[]) => request<DocumentDTO>(`/documents/${docId}/auto-fill-profile`, { method: "POST", body: JSON.stringify({ fields }) }),

  createSigningRequest: (docId: string, signerName: string, fields: PendingFieldPlacement[], expiryDays = 30) =>
    request<SigningRequestDTO>(`/documents/${docId}/signing-requests`, {
      method: "POST",
      body: JSON.stringify({ signer_name: signerName, fields, expiry_days: expiryDays }),
    }),
  listSigningRequests: (docId: string) => request<SigningRequestDTO[]>(`/documents/${docId}/signing-requests`),
  cancelSigningRequest: (reqId: string) => request<{ ok: boolean }>(`/signing-requests/${reqId}`, { method: "DELETE" }),

  listSignatures: () => request<SignatureDTO[]>("/signatures"),
  createDrawnSignature: (strokes: { x: number; y: number }[][], aspect: number, strokeWidth: number) =>
    request<SignatureDTO>("/signatures", {
      method: "POST",
      body: JSON.stringify({ kind: "draw", strokes, aspect, stroke_width: strokeWidth }),
    }),
  createTypedSignature: (text: string) =>
    request<SignatureDTO>("/signatures", { method: "POST", body: JSON.stringify({ kind: "type", text }) }),
  deleteSignature: (id: string) => request<{ ok: boolean }>(`/signatures/${id}`, { method: "DELETE" }),

  fileUrl: async (relPath: string) => {
    const [base, deviceId] = await Promise.all([getApiUrl(), getDeviceId()]);
    return `${base}/api/files/${relPath}?device=${encodeURIComponent(deviceId)}`;
  },
  // expo-image accepts { uri, headers } as its `source` - the page-image
  // route needs the X-Device-Id header (not a query param) like every
  // other document route, so callers should spread this into <Image source>.
  pageImageSource: async (docId: string, pageIndex: number) => {
    const [base, deviceId] = await Promise.all([getApiUrl(), getDeviceId()]);
    return { uri: `${base}/api/documents/${docId}/page/${pageIndex}`, headers: { "X-Device-Id": deviceId } };
  },
};

