import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapCutVaultMedia,
  CapCutVaultShare,
} from "@/components/CapCutVaultShare";
import type { CapCutMedia } from "@/lib/capcut-share";

const mocks = vi.hoisted(() => ({
  getCapCutBridge: vi.fn(),
  currentVaultOwner: vi.fn(),
  syncCapCutReceipt: vi.fn(),
  useCapCutVaultTags: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/capcut-share", () => ({
  ...mocks,
  capCutFileKey: (path: string, hash: string) => JSON.stringify([path, hash]),
  capCutTagQueryKey: (id: string) => ["capcut-vault-tags", id],
}));
vi.mock("@/hooks/use-capcut-share", () => ({
  useCapCutVaultTags: mocks.useCapCutVaultTags,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const vaultId = "reel-vault";
const ownerId = "owner";
const files: CapCutMedia[] = [
  { name: "intro.mp4", size: 1024, type: "video/mp4", hash: "a".repeat(64) },
  { name: "outro.mp4", size: 2048, type: "video/mp4", hash: "b".repeat(64) },
];
const receipt = {
  ownerId,
  vaultId,
  id: "selection",
  files,
  sharedAtMs: 1794387600000,
};
const native = {
  pickMedia: vi.fn(),
  discardSelection: vi.fn(),
  sendToCapCut: vi.fn(),
};

function renderControls() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CapCutVaultShare vaultId={vaultId} />
    </QueryClientProvider>,
  );
}

function renderVaultMedia() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CapCutVaultMedia
        vault={{
          id: vaultId,
          name: "Reel",
          locked: true,
          isCapCut: true,
          files: [
            { ...files[0]!, path: "intro.mp4" },
            { ...files[0]!, path: "intro.mp4", hash: "c".repeat(64) },
            { ...files[1]!, path: "outro.mp4" },
          ],
        }}
      />
    </QueryClientProvider>,
  );
}

async function pick() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Pick media for CapCut" }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCapCutBridge.mockReturnValue(native);
  mocks.currentVaultOwner.mockResolvedValue(ownerId);
  mocks.syncCapCutReceipt.mockResolvedValue("saved");
  mocks.useCapCutVaultTags.mockReturnValue(new Set());
  native.pickMedia.mockResolvedValue({
    status: "ready",
    selectionId: "selection",
    files,
  });
  native.sendToCapCut.mockResolvedValue({ receipt, queued: true });
});

describe("CapCut Vault media list", () => {
  it("labels the exact file that was shared, even when another file has the same name", async () => {
    mocks.useCapCutVaultTags.mockReturnValue(
      new Set([JSON.stringify(["intro.mp4", files[0]!.hash])]),
    );
    renderVaultMedia();
    const [shared, different] = within(
      screen.getByRole("list", { name: "CapCut Vault files" }),
    ).getAllByRole("listitem");
    expect(within(shared!).getByText("Shared to CapCut")).toBeInTheDocument();
    expect(
      within(different!).queryByText("Shared to CapCut"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Pick media for CapCut" }),
    ).toBeInTheDocument();
  });

  it("shows the Android requirement when the native bridge is unavailable", async () => {
    mocks.getCapCutBridge.mockReturnValue(null);
    renderVaultMedia();
    expect(
      await screen.findByText(
        "Send media to CapCut from the updated DocuALL Android app.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pick media for CapCut" }),
    ).not.toBeInTheDocument();
  });
});

describe("CapCut handoff controls", () => {
  it("shares the reviewed selection with CapCut and tags it in the chosen Vault", async () => {
    renderControls();
    await pick();
    expect(await screen.findByText("intro.mp4")).toBeInTheDocument();
    expect(screen.getByText("outro.mp4")).toBeInTheDocument();
    expect(native.sendToCapCut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send to CapCut" }));
    await waitFor(() =>
      expect(mocks.syncCapCutReceipt).toHaveBeenCalledExactlyOnceWith(
        native,
        ownerId,
        receipt,
      ),
    );
    expect(native.pickMedia).toHaveBeenCalledExactlyOnceWith({
      ownerId,
      vaultId,
    });
    expect(native.sendToCapCut).toHaveBeenCalledExactlyOnceWith({
      ownerId,
      vaultId,
      selectionId: "selection",
    });
  });

  it("does not send or tag a cancelled pick", async () => {
    native.pickMedia.mockResolvedValue({ status: "cancelled" });
    renderControls();
    await pick();
    await screen.findByRole("button", { name: "Pick media for CapCut" });
    expect(native.sendToCapCut).not.toHaveBeenCalled();
    expect(mocks.syncCapCutReceipt).not.toHaveBeenCalled();
  });

  it("does not tag a batch Android refused to share", async () => {
    native.sendToCapCut.mockRejectedValue({
      code: "CAPCUT_UNAVAILABLE",
      message: "CapCut cannot receive this selection.",
    });
    renderControls();
    await pick();
    fireEvent.click(
      await screen.findByRole("button", { name: "Send to CapCut" }),
    );
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "CapCut cannot receive this selection.",
      ),
    );
    expect(mocks.syncCapCutReceipt).not.toHaveBeenCalled();
  });

  it("cannot send the previous account's selection after a session change", async () => {
    mocks.currentVaultOwner
      .mockResolvedValueOnce(ownerId)
      .mockResolvedValueOnce("different-owner");
    renderControls();
    await pick();
    fireEvent.click(
      await screen.findByRole("button", { name: "Send to CapCut" }),
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(native.sendToCapCut).not.toHaveBeenCalled();
    expect(mocks.syncCapCutReceipt).not.toHaveBeenCalled();
  });

  it("retries a failed tag save without reopening CapCut", async () => {
    native.sendToCapCut.mockResolvedValue({ receipt, queued: false });
    mocks.syncCapCutReceipt.mockRejectedValueOnce(new Error("offline"));
    renderControls();
    await pick();
    fireEvent.click(
      await screen.findByRole("button", { name: "Send to CapCut" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry saving Vault tag" }),
    );
    await waitFor(() =>
      expect(mocks.syncCapCutReceipt).toHaveBeenCalledTimes(2),
    );
    expect(native.sendToCapCut).toHaveBeenCalledTimes(1);
  });
});
