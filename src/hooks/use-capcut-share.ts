import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  capCutTagQueryKey,
  currentVaultOwner,
  getCapCutBridge,
  listCapCutVaultTags,
  syncPendingCapCutReceipts,
} from "@/lib/capcut-share";

/** Mount once in the authenticated layout to retry Vault saves on foreground and reconnect. */
export function useCapCutShareRecovery(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const bridge = getCapCutBridge();
    if (!bridge) return;
    let running = false;

    async function recover() {
      if (!bridge || running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const ownerId = await currentVaultOwner();
        if (!ownerId) return;
        const vaultIds = await syncPendingCapCutReceipts(bridge, ownerId);
        if (vaultIds.length) {
          void queryClient.invalidateQueries({ queryKey: ["vaults"] });
          for (const id of vaultIds)
            void queryClient.invalidateQueries({
              queryKey: capCutTagQueryKey(id),
            });
        }
      } catch {
        // Keep the queue for the next foreground or online event.
      } finally {
        running = false;
      }
    }

    const run = () => void recover();
    run();
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    return () => {
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
    };
  }, [queryClient]);
}

export function useCapCutVaultTags(vaultId: string): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: capCutTagQueryKey(vaultId),
    queryFn: () => listCapCutVaultTags(vaultId),
  });
  return useMemo(() => new Set(data), [data]);
}
