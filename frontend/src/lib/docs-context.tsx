import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const docs = await api.listDocuments();
      setDocuments(docs);
    } catch (e: any) {
      setError(e?.message || "Couldn't reach the DocuALL server");
    } finally {
      setLoading(false);
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
