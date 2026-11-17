import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, DocumentDTO } from "./api";

interface DocsContextValue {
  documents: DocumentDTO[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DocsContext = createContext<DocsContextValue | null>(null);

export function DocsProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<DocumentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    try {
      setError(null);
      const docs = await api.listDocuments();
      // An earlier slow request cannot overwrite a later successful refresh.
      if (requestId === latestRequest.current) setDocuments(docs);
    } catch (e: any) {
      if (requestId === latestRequest.current) {
        setError(e?.message || "Couldn't reach the DocuALL server");
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ documents, loading, error, refresh }), [documents, loading, error, refresh]);

  return <DocsContext.Provider value={value}>{children}</DocsContext.Provider>;
}

export function useDocs(): DocsContextValue {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error("useDocs must be used inside <DocsProvider>");
  return ctx;
}
