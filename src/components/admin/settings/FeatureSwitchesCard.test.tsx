import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (reason: string) => requireBiometricMock(reason),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "admin-1" }, isReady: true }) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

let audience = "testers";
const rpc = vi.fn(async (fn: string, args?: { p_key?: string; p_audience?: string }) => {
  if (fn === "admin_list_feature_switches") {
    return { data: [{ key: "switch_canary", audience, description: "Gates no feature.", created_at: "", updated_at: "" }], error: null };
  }
  if (fn === "admin_set_feature_switch") {
    audience = args!.p_audience!;
    return { data: audience, error: null };
  }
  if (fn === "feature_enabled_for") return { data: audience !== "off", error: null };
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

describe("FeatureSwitchesCard", () => {
  it("lists each switch with its audience; the current one is pressed and disabled", async () => {
    render(wrap(<FeatureSwitchesCard />));
    expect(await screen.findByText("switch_canary")).toBeTruthy();
    const current = screen.getByRole("button", { name: "Testers only" });
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect((current as HTMLButtonElement).disabled).toBe(true);
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
