import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export interface CapCutMedia {
  name: string;
  size: number;
  type: string;
  hash: string;
}

export interface CapCutShareScope {
  ownerId: string;
  vaultId: string;
}

export interface CapCutSelection extends CapCutShareScope {
  selectionId: string;
  files: CapCutMedia[];
}

export interface CapCutReceipt extends CapCutShareScope {
  id: string;
  sharedAtMs: number;
  files: CapCutMedia[];
}

type PickResult =
  | { status: "cancelled" }
  | {
      status: "ready";
      selectionId: string;
      files: CapCutMedia[];
    };

export interface DocuCapCutBridge {
  pickMedia(scope: CapCutShareScope): Promise<PickResult>;
  discardSelection(input: { selectionId: string }): Promise<void>;
  sendToCapCut(input: CapCutShareScope & { selectionId: string }): Promise<{
    receipt: CapCutReceipt;
    queued: boolean;
  }>;
  listPendingReceipts(input: {
    ownerId: string;
  }): Promise<{ receipts: CapCutReceipt[] }>;
  acknowledgeReceipt(input: { ownerId: string; id: string }): Promise<void>;
}

const bridge = registerPlugin<DocuCapCutBridge>("DocuCapCut");

export function getCapCutBridge(): DocuCapCutBridge | null {
  if (
    typeof window === "undefined" ||
    !Capacitor.isNativePlatform() ||
    Capacitor.getPlatform() !== "android" ||
    !Capacitor.isPluginAvailable("DocuCapCut")
  )
    return null;
  return bridge;
}

export async function currentVaultOwner(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user.id ?? null;
}

type SaveResult = "saved" | "vault-unavailable";
type PersistReceipt = (receipt: CapCutReceipt) => Promise<SaveResult>;
type ReceiptQueue = Pick<
  DocuCapCutBridge,
  "listPendingReceipts" | "acknowledgeReceipt"
>;

async function persistCapCutReceipt(
  receipt: CapCutReceipt,
): Promise<SaveResult> {
  const { data, error } = await supabase.rpc("record_capcut_handoff", {
    p_id: receipt.id,
    p_owner_id: receipt.ownerId,
    p_vault_id: receipt.vaultId,
    p_shared_at: new Date(receipt.sharedAtMs).toISOString(),
    p_files: receipt.files.map(({ name, size, type, hash }) => ({
      name,
      size,
      type,
      hash,
    })),
  });
  if (error) throw error;
  if (data === true) return "saved";
  if (data === false) return "vault-unavailable";
  throw new Error("The Vault did not confirm the tag save.");
}

export async function syncCapCutReceipt(
  queue: Pick<ReceiptQueue, "acknowledgeReceipt">,
  ownerId: string,
  receipt: CapCutReceipt,
  persist: PersistReceipt = persistCapCutReceipt,
): Promise<SaveResult | "wrong-account"> {
  if (receipt.ownerId !== ownerId) return "wrong-account";
  const result = await persist(receipt);
  try {
    await queue.acknowledgeReceipt({ ownerId, id: receipt.id });
  } catch {
    // The server can safely accept the same receipt again after a queue failure.
  }
  return result;
}

export async function syncPendingCapCutReceipts(
  queue: ReceiptQueue,
  ownerId: string,
  persist: PersistReceipt = persistCapCutReceipt,
): Promise<string[]> {
  const { receipts } = await queue.listPendingReceipts({ ownerId });
  const savedVaults = new Set<string>();
  for (const receipt of receipts) {
    try {
      if (
        (await syncCapCutReceipt(queue, ownerId, receipt, persist)) === "saved"
      ) {
        savedVaults.add(receipt.vaultId);
      }
    } catch {
      // Keep the receipt until the same account can save it. Continue other batches.
    }
  }
  return [...savedVaults];
}

export function capCutFileKey(path: string, hash: string): string {
  return JSON.stringify([path, hash]);
}

export const capCutTagQueryKey = (vaultId: string) =>
  ["capcut-vault-tags", vaultId] as const;

export async function listCapCutVaultTags(vaultId: string): Promise<string[]> {
  const keys: string[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .rpc("list_capcut_vault_tags", { p_vault_id: vaultId })
      .order("file_path")
      .order("file_hash")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data)
      keys.push(capCutFileKey(row.file_path, row.file_hash));
    if (data.length < pageSize) return keys;
  }
}
