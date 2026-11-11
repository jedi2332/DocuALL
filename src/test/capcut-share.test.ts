import { describe, expect, it, vi } from "vitest";
import {
  capCutFileKey,
  getCapCutBridge,
  syncCapCutReceipt,
  syncPendingCapCutReceipts,
  type CapCutReceipt,
} from "@/lib/capcut-share";

function receipt(overrides: Partial<CapCutReceipt> = {}): CapCutReceipt {
  return {
    id: "r1",
    ownerId: "owner",
    vaultId: "vault",
    sharedAtMs: 1794387600000,
    files: [
      { name: "clip.mp4", size: 2048, type: "video/mp4", hash: "a".repeat(64) },
    ],
    ...overrides,
  };
}

describe("CapCut Vault receipts", () => {
  it("keeps the Android handoff out of an ordinary browser", () => {
    expect(getCapCutBridge()).toBeNull();
  });

  it("acknowledges a receipt only after the Vault save", async () => {
    const order: string[] = [];
    const acknowledgeReceipt = vi.fn(async () => {
      order.push("acknowledged");
    });
    const persist = vi.fn(async () => {
      order.push("saved");
      return "saved" as const;
    });
    expect(
      await syncCapCutReceipt(
        { acknowledgeReceipt },
        "owner",
        receipt(),
        persist,
      ),
    ).toBe("saved");
    expect(order).toEqual(["saved", "acknowledged"]);
    expect(acknowledgeReceipt).toHaveBeenCalledWith({
      ownerId: "owner",
      id: "r1",
    });
  });

  it("leaves an offline receipt queued", async () => {
    const acknowledgeReceipt = vi.fn();
    const persist = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      syncCapCutReceipt({ acknowledgeReceipt }, "owner", receipt(), persist),
    ).rejects.toThrow("offline");
    expect(acknowledgeReceipt).not.toHaveBeenCalled();
  });

  it("does not save or discard a receipt belonging to a different account", async () => {
    const acknowledgeReceipt = vi.fn();
    const persist = vi.fn();
    expect(
      await syncCapCutReceipt(
        { acknowledgeReceipt },
        "other",
        receipt(),
        persist,
      ),
    ).toBe("wrong-account");
    expect(persist).not.toHaveBeenCalled();
    expect(acknowledgeReceipt).not.toHaveBeenCalled();
  });

  it("can recover other Vault tags even if one receipt fails", async () => {
    const a = receipt();
    const b = receipt({ id: "r2", vaultId: "other-vault" });
    const acknowledgeReceipt = vi.fn();
    const queue = {
      listPendingReceipts: vi.fn().mockResolvedValue({ receipts: [a, b] }),
      acknowledgeReceipt,
    };
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("saved");
    expect(await syncPendingCapCutReceipts(queue, "owner", persist)).toEqual([
      "other-vault",
    ]);
    expect(acknowledgeReceipt).toHaveBeenCalledExactlyOnceWith({
      ownerId: "owner",
      id: "r2",
    });
  });

  it("stops retrying a missing Vault and never applies the tag to a different one", async () => {
    const acknowledgeReceipt = vi.fn();
    const persist = vi.fn().mockResolvedValue("vault-unavailable");
    expect(
      await syncCapCutReceipt(
        { acknowledgeReceipt },
        "owner",
        receipt(),
        persist,
      ),
    ).toBe("vault-unavailable");
    expect(persist).toHaveBeenCalledExactlyOnceWith(receipt());
    expect(acknowledgeReceipt).toHaveBeenCalledExactlyOnceWith({
      ownerId: "owner",
      id: "r1",
    });
  });

  it("keeps a same-name file with different bytes distinct", () => {
    expect(capCutFileKey("clip.mp4", "a".repeat(64))).not.toBe(
      capCutFileKey("clip.mp4", "b".repeat(64)),
    );
    expect(capCutFileKey("clip.mp4", "a".repeat(64))).not.toBe(
      capCutFileKey("other.mp4", "a".repeat(64)),
    );
  });
});
