import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Admin -> Settings: Hidden Feature Switches. Changing an audience goes through
 * a confirmation AND the biometric gate; a refused gate changes nothing (the
 * RPC is never called). The RPC is what writes admin_audit_log, so "no RPC"
 * is also "no audit row and no change".
 */
// @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |     if (!ok) {\n      setPending(null);\n      return;\n    } |     if (false) {\n      setPending(null);\n      return;\n    }
// @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |       if (stored !== change.to) throw | if (false) throw

const requireBiometricMock = vi.fn<(reason: string) => Promise<boolean>>();
// The Declutter cards (and their shared "Show test listings" switch, D2-4) moved to AdminDeclutter (design audit
// area 10 #2); that test is src/components/admin/AdminDeclutter.test.tsx.
vi.mock("./CategorySuggestionsCard", () => ({ CategorySuggestionsCard: () => null }));
vi.mock("./RentalsOwnershipCard", () => ({ RentalsOwnershipCard: () => null }));
vi.mock("./HomesListingsCard", () => ({ HomesListingsCard: () => null }));
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (reason: string) => requireBiometricMock(reason),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "admin-1" }, isReady: true }) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) }) }));

let audience = "testers";
let withDeclutter = false;
let withPaypal = false;
let declutterOn = false;
const rpc = vi.fn(async (fn: string, args?: { p_key?: string; p_audience?: string; p_keys?: string[] }) => {
  if (fn === "admin_list_feature_switches") {
    const rows = [{ key: "switch_canary", audience, description: "Gates no feature.", created_at: "", updated_at: "" }];
    if (withPaypal) rows.push({ key: "paypal_payments", audience: "off", description: "PayPal.", created_at: "", updated_at: "" });
    if (withDeclutter) rows.push({ key: "declutter", audience: "off", description: "Declutter.", created_at: "", updated_at: "" });
    return { data: rows, error: null };
  }
  if (fn === "admin_set_feature_switch") {
    audience = args!.p_audience!;
    return { data: audience, error: null };
  }
  if (fn === "feature_switches_for_me") {
    // useFeature reads every switch in one call (nightly-red #2601).
    const on = (k: string) => (k === "declutter" ? declutterOn : audience !== "off");
    return { data: Object.fromEntries((args?.p_keys ?? []).map((k) => [k, on(k)])), error: null };
  }
  return { data: null, error: { message: `unexpected ${fn}` } };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string, args?: never) => rpc(fn, args) } }));

import { FeatureSwitchesCard } from "./FeatureSwitchesCard";

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);
const setCalls = () => rpc.mock.calls.filter(([fn]) => fn === "admin_set_feature_switch");

beforeEach(() => {
  audience = "testers";
  withDeclutter = false;
  withPaypal = false;
  declutterOn = false;
  rpc.mockClear();
  requireBiometricMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

async function askForEveryone() {
  render(wrap(<FeatureSwitchesCard />));
  fireEvent.click(await screen.findByRole("button", { name: "Everyone" }));
  fireEvent.click(await screen.findByRole("button", { name: "Set to Everyone" }));
}

// The confirm dialog's Radix FocusScope schedules a 0 ms focus event on
// unmount; under a loaded full run it could fire after jsdom was torn down
// ("dispatchEvent ... parameter 1 is not of type 'Event'", an unhandled error
// that fails land.sh). Unmount here and let that timer run while jsdom lives.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("FeatureSwitchesCard", () => {
  // @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |     declutter: useFeature("declutter"), |     declutter: canaryReachesMe,
  it("says, per switch, what the SERVER answers for this account (declutter off, canary on)", async () => {
    withDeclutter = true;
    render(wrap(<FeatureSwitchesCard />));
    expect(await screen.findByText("declutter")).toBeTruthy();
    const declutterItem = screen.getByText("declutter").closest("li")!;
    const canaryItem = screen.getByText("switch_canary").closest("li")!;
    await waitFor(() => expect(canaryItem.textContent).toContain("On for this account."));
    expect(declutterItem.textContent).toContain("Off for this account.");
    expect(rpc.mock.calls.some(([fn, a]) => fn === "feature_switches_for_me" && a?.p_keys?.includes("declutter"))).toBe(true);
  });

  // Design audit area 10 #4: the current audience is full-strength (not a faded disabled button), with a check, and
  // pressing it again opens no confirmation.
  // @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |                       disabled={saving}\n | disabled={saving \|\| selected}\n
  // @mutate src/components/admin/settings/FeatureSwitchesCard.tsx | onClick={() => { if (!selected) setPending( | onClick={() => { setPending(
  it("lists each switch with its audience; the current one is pressed, full-strength and inert", async () => {
    render(wrap(<FeatureSwitchesCard />));
    expect(await screen.findByText("switch_canary")).toBeTruthy();
    const current = screen.getByRole("button", { name: "Testers only" });
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(current.getAttribute("aria-disabled")).toBe("true");
    expect((current as HTMLButtonElement).disabled).toBe(false);
    expect(current.querySelector("svg")).toBeTruthy();
    fireEvent.click(current);
    expect(screen.queryByRole("button", { name: "Set to Testers only" })).toBeNull();
    expect(screen.getByRole("button", { name: "Everyone" }).getAttribute("aria-pressed")).toBe("false");
  });

  // Design audit area 10 #12: a plain title leads; the retired PayPal switch is not listed (nothing flips it).
  // @mutate src/config/featureSwitches.ts | = ["paypal_payments"]; | = [];
  it("shows a plain title and hides the retired paypal_payments switch", async () => {
    withPaypal = true;
    render(wrap(<FeatureSwitchesCard />));
    expect(await screen.findByText("Switch canary")).toBeTruthy();
    expect(screen.getByText("switch_canary")).toBeTruthy();
    expect(screen.queryByText("paypal_payments")).toBeNull();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("a refused biometric prompt changes nothing: the RPC is never called", async () => {
    requireBiometricMock.mockResolvedValue(false);
    await askForEveryone();
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    expect(setCalls()).toHaveLength(0);
    expect(audience).toBe("testers");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("a passed confirmation calls admin_set_feature_switch once and re-reads the list", async () => {
    requireBiometricMock.mockResolvedValue(true);
    await askForEveryone();
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    expect(setCalls()[0][1]).toEqual({ p_key: "switch_canary", p_audience: "everyone" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Everyone" }).getAttribute("aria-pressed")).toBe("true"));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("an answer that is not the audience asked for is reported as a failure, not a success", async () => {
    requireBiometricMock.mockResolvedValue(true);
    rpc.mockImplementationOnce(async () => ({ data: [{ key: "switch_canary", audience, description: "x", created_at: "", updated_at: "" }], error: null }));
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (fn, args) => (fn === "admin_set_feature_switch" ? { data: "testers", error: null } : original(fn, args)));
    await askForEveryone();
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    rpc.mockImplementation(original);
  });
});
