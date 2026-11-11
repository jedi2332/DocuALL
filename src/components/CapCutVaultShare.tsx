import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCapCutVaultTags } from "@/hooks/use-capcut-share";
import {
  capCutFileKey,
  capCutTagQueryKey,
  currentVaultOwner,
  getCapCutBridge,
  syncCapCutReceipt,
  type CapCutReceipt,
  type CapCutSelection,
  type DocuCapCutBridge,
} from "@/lib/capcut-share";
import type { VaultProject } from "@/lib/organize";

function errorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

function nativeErrorCode(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}

/** Render in the existing CapCut Vault only. Keep its thumbnail UI and lock actions. */
export function CapCutVaultShare({ vaultId }: { vaultId: string }) {
  const queryClient = useQueryClient();
  const [bridge, setBridge] = useState<DocuCapCutBridge | null>();
  const [selection, setSelection] = useState<CapCutSelection | null>(null);
  const [unsaved, setUnsaved] = useState<CapCutReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => setBridge(getCapCutBridge()), []);
  if (bridge === undefined) return null;
  if (bridge === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Send media to CapCut from the updated DocuALL Android app.
      </p>
    );
  }
  const native = bridge;

  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function pick() {
    try {
      const ownerId = await currentVaultOwner();
      if (!ownerId)
        throw new Error("Open your DocuALL account before sharing.");
      const result = await native.pickMedia({ ownerId, vaultId });
      if (result.status === "ready")
        setSelection({ ownerId, vaultId, ...result });
    } catch (error) {
      toast.error(errorMessage(error, "Could not read the selected media."));
    }
  }

  async function saveTag(receipt: CapCutReceipt, queued: boolean) {
    try {
      const ownerId = await currentVaultOwner();
      const result = ownerId
        ? await syncCapCutReceipt(native, ownerId, receipt)
        : "wrong-account";
      if (result === "wrong-account")
        throw new Error("Reopen the account that owns this Vault.");
      setUnsaved(null);
      if (result === "vault-unavailable") {
        toast.warning(
          "Media was shared to CapCut. This Vault is no longer available.",
        );
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      void queryClient.invalidateQueries({
        queryKey: capCutTagQueryKey(receipt.vaultId),
      });
      toast.success("Shared to CapCut and saved in your Vault.");
    } catch {
      if (queued) {
        toast.info(
          "Shared to CapCut. The Vault tag will retry when DocuALL is open and online.",
        );
      } else {
        setUnsaved(receipt);
        toast.warning(
          "Shared to CapCut. Retry saving the Vault tag in DocuALL.",
        );
      }
    }
  }

  async function send() {
    if (!selection) return;
    try {
      const ownerId = await currentVaultOwner();
      if (ownerId !== selection.ownerId || selection.vaultId !== vaultId) {
        setSelection(null);
        throw new Error("The active Vault changed. Pick the files again.");
      }
      const { receipt, queued } = await native.sendToCapCut({
        ownerId,
        vaultId,
        selectionId: selection.selectionId,
      });
      setSelection(null);
      await saveTag(receipt, queued);
    } catch (error) {
      if (
        ["SELECTION_EXPIRED", "URI_ACCESS_LOST", "NO_ACTIVITY"].includes(
          String(nativeErrorCode(error)),
        )
      ) {
        setSelection(null);
      }
      toast.error(
        errorMessage(error, "Could not open CapCut with the selected media."),
      );
    }
  }

  async function discard() {
    if (!selection) return;
    try {
      await native.discardSelection({ selectionId: selection.selectionId });
      setSelection(null);
    } catch {
      toast.error("Could not clear the selection. Try again.");
    }
  }

  if (unsaved) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          CapCut opened. This Vault tag still needs to be saved.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => saveTag(unsaved, false))}
        >
          Retry saving Vault tag
        </Button>
      </div>
    );
  }

  if (!selection) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={busy}
        onClick={() => void run(pick)}
      >
        {busy ? "Reading selected media…" : "Pick media for CapCut"}
      </Button>
    );
  }

  return (
    <div className="space-y-2" aria-busy={busy}>
      <p className="text-sm">
        Send {selection.files.length} selected{" "}
        {selection.files.length === 1 ? "file" : "files"} to CapCut?
      </p>
      <ul
        className="max-h-28 overflow-y-auto text-xs text-muted-foreground"
        aria-label="Selected media"
      >
        {selection.files.map((file, index) => (
          <li className="break-all" key={index}>
            {file.name}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-11"
          disabled={busy}
          onClick={() => void run(send)}
        >
          {busy ? "Sending…" : "Send to CapCut"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={busy}
          onClick={() => void run(discard)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function CapCutVaultMedia({ vault }: { vault: VaultProject }) {
  const tags = useCapCutVaultTags(vault.id);
  return (
    <div className="space-y-3">
      <CapCutVaultShare vaultId={vault.id} />
      {vault.files.length > 0 && (
        <ul
          className="max-h-56 space-y-1 overflow-y-auto"
          aria-label="CapCut Vault files"
        >
          {vault.files.map((file, index) => {
            const key = capCutFileKey(file.path, file.hash);
            return (
              <li
                key={`${key}:${index}`}
                className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 break-all">{file.name}</span>
                {tags.has(key) && (
                  <Badge variant="secondary">Shared to CapCut</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
