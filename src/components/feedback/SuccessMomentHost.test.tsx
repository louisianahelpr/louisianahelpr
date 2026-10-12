/**
 * Q1356: SuccessMomentHost mounts on every route but fetches SuccessMoment
 * (framer-motion) only for a signed-in user once the page has settled; a fire
 * before it has arrived is skipped, never shown late (it would cover the Q997
 * payment-held dialog), and a failed fetch never throws into render.
 *
 * @mutate src/components/feedback/SuccessMomentHost.tsx | if (!signedIn) return; | if (false) return;
 * @mutate src/components/feedback/SuccessMomentHost.tsx | moment.start();\n        return; | moment.start();
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
const load = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: auth.user, isReady: true }) }));
vi.mock("@/lib/routePrefetch", () => ({ whenPageSettled: (cb: () => void) => { cb(); return () => {}; } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("SuccessMomentHost loads the beat only for signed-in users (Q1356)", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.user = null;
    load.fail = false;
    load.calls = 0;
  });

  async function mountHost() {
    vi.doMock("./SuccessMoment", () => {
      load.calls++;
      if (load.fail) throw new Error("chunk 404");
      return { default: ({ label }: { label: string }) => <p data-testid="moment">{label}</p> };
    });
    const { default: Host } = await import("./SuccessMomentHost");
    const { fireSuccessMoment: fire } = await import("@/lib/successMoment");
    render(<Host />);
    await flush();
    return fire;
  }

  it("a guest never fetches it", async () => {
    await mountHost();
    expect(load.calls).toBe(0);
  });

  it("a signed-in user has it after settle, and a fire shows it", async () => {
    auth.user = { id: "u1" };
    const fire = await mountHost();
    expect(load.calls).toBe(1);
    act(() => fire({ label: "Hired" }));
    expect(screen.getByTestId("moment").textContent).toBe("Hired");
  });

  it("a fire before the chunk has arrived is skipped, not shown late", async () => {
    const fire = await mountHost();
    act(() => fire({ label: "Hired" }));
    await flush();
    expect(load.calls).toBe(1);
    expect(screen.queryByTestId("moment")).toBeNull();
  });

  it("a failed fetch renders nothing and throws nothing", async () => {
    auth.user = { id: "u1" };
    load.fail = true;
    const fire = await mountHost();
    expect(() => act(() => fire({ label: "Hired" }))).not.toThrow();
    await flush();
    expect(screen.queryByTestId("moment")).toBeNull();
  });
});

