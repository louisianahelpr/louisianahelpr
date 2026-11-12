/**
 * Audit 11-10 F389: a photo in the Declutter order chat (server 20261112060000, proven in
 * src/test/pglite/declutterOrderTalkPhotos.pglite.mjs: storage lets only the two sides read, never across a block or
 * a ban, and the send takes only the sender's own uploaded photo for this order).
 *
 * What the screen must do, each shown red by the @mutate below it:
 *   1. "Add a photo" in the open chat; a picked photo waits (preview, Remove) and Send is enabled with no words.
 *   2. Send uploads the photo (uploadOrderTalkPhoto, for THIS order) and sends its path with the words.
 *   3. A sent photo shows in its bubble (signed URL of its path); a photo hidden across a block/ban says so.
 *   3b. A refused send removes the uploaded photo (it never stays in storage).
 *   4. The picker and photo are lazy: DeclutterOrderTalk never imports OrderTalkPhotoParts or the upload statically.
 *
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | disabled={send.isPending \|\| (draft.trim().length === 0 && !photo)}> | disabled={send.isPending \|\| draft.trim().length === 0}>
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | .uploadOrderTalkPhoto(orderId, photo) : null; | .uploadOrderTalkPhoto(orderId, photo) && null : null;
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |                     {m.photo_hidden && <p | {false && <p
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |                     {m.photo_path && <Suspense | {false && <Suspense
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |     onSuccess: () => { setDraft(""); setPhoto(null); | onSuccess: () => { setDraft("");
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | if (handover && photoPath) await handover.discardRefusedHandoverPhoto(photoPath); | if (false) await handover.discardRefusedHandoverPhoto(photoPath);
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { OrderTalkFromLink } from "./DeclutterOrderTalk";

const ORDER = "00000000-0000-4000-8000-0000000000c1";
const PATH = `u1/declutter/talk/${ORDER}/p.jpg`;
const state = vi.hoisted(() => ({
  sent: [] as { body: string; photoPath: string | null | undefined }[],
  uploaded: [] as string[],
  messages: [] as Record<string, unknown>[],
  discarded: [] as string[],
  refuse: false,
}));

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/components/declutter/OrderTalkStep", () => ({ default: () => null }));
vi.mock("@/lib/declutter/talkRead", () => ({ markTalkRead: async () => undefined }));
vi.mock("@/lib/declutter/managerMode", () => ({ useManagerLabels: () => ({ data: new Map() }) }));
vi.mock("@/lib/declutter/handover", () => ({
  uploadOrderTalkPhoto: async (orderId: string) => { state.uploaded.push(orderId); return PATH; },
  handoverPhotoUrl: async (path: string) => `/photos-test/${path}`,
  discardRefusedHandoverPhoto: async (path: string) => { state.discarded.push(path); },
}));
vi.mock("@/lib/declutter/orderTalk", () => ({
  MY_ORDER_TALKS_KEY: ["declutter", "my-order-talks"],
  fetchOrderTalk: async (id: string) => ({ order_id: id, side: "buyer", open: true, open_until: null, messages: state.messages }),
  fetchMyOrderTalks: async () => [],
  orderTalkPhotoUrl: () => null,
  sendOrderMessage: async (_id: string, body: string, photoPath?: string | null) => {
    if (state.refuse) throw Object.assign(new Error("message_rate_limited"), { userMessage: "Slow down a little, then send again." });
    state.sent.push({ body, photoPath });
    return "m9";
  },
}));

function renderChat() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/declutter?order_talk=${ORDER}`]}><OrderTalkFromLink /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.sent = [];
  state.uploaded = [];
  state.messages = [];
  state.discarded = [];
  state.refuse = false;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("F389: a photo in the order chat", () => {
  it("a picked photo waits with Remove, Send works with no words, and the photo's path is sent", async () => {
    renderChat();
    const tile = await screen.findByRole("button", { name: /Add a photo/ }, { timeout: 10_000 });
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const input = tile.closest("[data-order-talk-photo-picker]")!.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "dent.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByRole("button", { name: "Remove photo" }, { timeout: 10_000 })).toBeTruthy();
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(state.sent).toEqual([{ body: "", photoPath: PATH }]));
    expect(state.uploaded).toEqual([ORDER]);
    // Sent: the waiting photo is cleared.
    expect(await screen.findByRole("button", { name: /Add a photo/ })).toBeTruthy();
  });

  it("a refused send removes the uploaded photo and keeps it waiting on the device", async () => {
    state.refuse = true;
    renderChat();
    const tile = await screen.findByRole("button", { name: /Add a photo/ }, { timeout: 10_000 });
    const input = tile.closest("[data-order-talk-photo-picker]")!.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "dent.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.discarded).toEqual([PATH]));
    expect(state.sent).toEqual([]);
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeTruthy();
  });

  it("a text message still sends with no photo", async () => {
    renderChat();
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "  Still there? " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.sent).toEqual([{ body: "Still there?", photoPath: null }]));
    expect(state.uploaded).toEqual([]);
  });

  it("a sent photo shows in its bubble; one hidden across a block or ban says Photo hidden", async () => {
    state.messages = [
      { id: "m1", mine: false, body: "", photo_path: PATH, photo_hidden: false, created_at: "2026-11-11T10:00:00Z" },
      { id: "m2", mine: false, body: "", photo_path: null, photo_hidden: true, created_at: "2026-11-11T10:01:00Z" },
    ];
    renderChat();
    const img = await screen.findByAltText("Photo", undefined, { timeout: 10_000 });
    expect(img.getAttribute("src")).toBe(`/photos-test/${PATH}`);
    expect(screen.getByText("Photo hidden")).toBeTruthy();
  });

  it("the picker, the photo and the upload are lazy (the chat chunk does not grow)", () => {
    const src = readFileSync("src/components/declutter/DeclutterOrderTalk.tsx", "utf8");
    expect(src).not.toMatch(/^import[^;]*from "\.\/OrderTalkPhotoParts"/m);
    expect(src).not.toMatch(/^import[^;]*from "@\/lib\/declutter\/handover"/m);
    expect(src).toMatch(/lazy\(\(\) => import\("\.\/OrderTalkPhotoParts"\)/);
  });
});
