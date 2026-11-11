export type FieldType = "signature" | "initials" | "date" | "text";

/** A field placed on a document page. x/y are fractions of page size (top-left
 * anchored). w is a fraction of page width for image fields, and a fraction of
 * page height (font size) for text/date fields — same model as the original app. */
export interface FieldPlacement {
  id: string;
  type: FieldType;
  page_index: number;
  x: number;
  y: number;
  w: number;
  signatureId?: string;
  text?: string | undefined;
  label?: string;
}

/** A field ready to be stamped into a PDF. */
export interface ResolvedField {
  type: FieldType;
  page_index: number;
  x: number;
  y: number;
  w: number;
  imageBytes?: Uint8Array;
  text?: string | undefined;
}

export interface ScannedPage {
  bytes: Uint8Array;
  previewUrl: string;
}

export const FIELD_COLORS: Record<FieldType, string> = {
  signature: "#3B82F6",
  initials: "#8B5CF6",
  date: "#06B6D4",
  text: "#94A3B8",
};

export const FIELD_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  text: "Text",
};
