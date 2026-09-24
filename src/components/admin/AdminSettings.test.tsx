import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import AdminSettings from "./AdminSettings";

/**
 * THE BIOMETRIC GATE IN FRONT OF THE PRIVILEGE PRIMITIVE.
 *
 * Granting admin is the escalation that makes every other gate in the console
 * moot: an attacker on a merely-unlocked admin phone would give themselves a
 * durable role that outlives the phone being recovered. Removing admin is the
 * lock-everyone-out half of the same primitive.
 *
 * Both are gated by `requireBiometric()`, and nothing could see that they were:
 * the real module opens with `if (!isNativePlatform) return true;`, so it
 * passes unconditionally under vitest and both `if (!ok)` guards were deletable
 * with the whole suite green. Mocked here with a handle, defaulted to `true`,
 * and driven to `false` in the two refusal cases — which assert the edge
 * function and the DELETE were never reached, not merely that a toast appeared.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

const ADMIN_USER_ID = "admin-user-1";
const ADMIN_ROLE_ID = "role-1";
const CANDIDATE_ID = "candidate-1";

const SETTINGS_ROW = {
  id: "settings-1",
  customer_fee_percent: 10,
  helper_fee_percent: 10,
  social_webhook_url: "",
  min_supported_build: 0,
};

const CANDIDATE = {
  id: "profile-candidate-1",
  user_id: CANDIDATE_ID,
  full_name: "Thibodeaux Landry",
  email: "tl@example.com",
};

const invokeMock = vi.fn();
const roleDeleteMock = vi.fn();
const getUserMock = vi.fn();
// The row's "is this me" comes from useAuthReady (a one-shot getUser() effect
// strands it on a cold token); removeAdmin still re-checks with getUser().
const authUser = vi.hoisted(() => ({ id: "some-other-admin" }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: authUser.id }, isReady: true }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUserMock() },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (table: string) => {
      if (table === "platform_settings") {
        return {
          select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: SETTINGS_ROW, error: null }) }) }),
          update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: SETTINGS_ROW.id }], error: null }) }) }),
        };
      }
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ id: ADMIN_ROLE_ID, user_id: ADMIN_USER_ID, role: "admin" }],
              error: null,
            }),
          }),
          delete: () => ({
            eq: (_col: string, value: string) => ({
              select: async () => {
                roleDeleteMock(value);
                return { data: [{ id: value }], error: null };
              },
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            // The admin-list name lookup.
            in: async () => ({
              data: [{ user_id: ADMIN_USER_ID, full_name: "Camille Boudreaux", email: "cb@example.com" }],
              error: null,
            }),
            // The Add-Admin search.
            or: () => ({ limit: async () => ({ data: [CANDIDATE], error: null }) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

const logAdminActionMock = vi.fn();
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: (...a: unknown[]) => logAdminActionMock(...a) }));

/** Every `admin-user-actions` call that actually grants the role. */
const grantCalls = () =>
  invokeMock.mock.calls.filter(
    ([fn, opts]) =>
      fn === "admin-user-actions" &&
      (opts as { body?: { action?: string } } | undefined)?.body?.action === "grant_admin",
  );

/** Render, wait for settings + admins to load, open Add Admin, search, land on Add. */
async function reachTheAddButton() {
  render(<AdminSettings />);
  fireEvent.click(await screen.findByRole("button", { name: /Add Admin/i }));
  fireEvent.change(await screen.findByLabelText(/Search users by name or email/i), {
    target: { value: "thibodeaux" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Search users/i }));
  return await screen.findByRole("button", { name: /^Add$/ });
}

/** Render, wait for the admin list, open the remove confirmation. */
async function reachTheRemoveButton() {
  render(<AdminSettings />);
  fireEvent.click(await screen.findByRole("button", { name: /Remove admin/i }));
  return await screen.findByRole("button", { name: /^Remove Admin$/ });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  roleDeleteMock.mockReset();
  getUserMock.mockReset();
  // A DIFFERENT admin is signed in, so the self-removal guard never fires and
  // the biometric gate is the only thing standing in the way.
  getUserMock.mockResolvedValue({ data: { user: { id: "some-other-admin" } } });
  authUser.id = "some-other-admin";
  toastError.mockReset();
  toastSuccess.mockReset();
  logAdminActionMock.mockReset();
  requireBiometricMock.mockReset();
  // Default PASS, so the happy paths read as they would with no gate at all.
  requireBiometricMock.mockResolvedValue(true);
});

describe("AdminSettings — granting admin", () => {
  it("a passed confirmation grants the role once", async () => {
    const add = await reachTheAddButton();
    fireEvent.click(add);

    await waitFor(() => expect(grantCalls()).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    expect(grantCalls()[0][1]).toMatchObject({ body: { userId: CANDIDATE_ID } });
  });

  it("a refused Face ID prompt grants nobody — no invoke, the candidate is still listed", async () => {
    requireBiometricMock.mockResolvedValue(false);
    const add = await reachTheAddButton();
    fireEvent.click(add);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    // Drain whatever the handler could still have queued — "not called" the
    // instant the gate resolves passes even with the guard deleted.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN.
    expect(grantCalls()).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // …and the search result is still on screen with a live Add button, not
    // stuck on "Adding…", so the console is usable and the grant is visibly
    // not applied.
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeInTheDocument();
    expect(screen.queryByText(/Adding…/)).not.toBeInTheDocument();
  });
});

describe("AdminSettings — removing admin", () => {
  it("a passed confirmation deletes the role row once", async () => {
    const remove = await reachTheRemoveButton();
    fireEvent.click(remove);

    await waitFor(() => expect(roleDeleteMock).toHaveBeenCalledTimes(1));
    expect(roleDeleteMock).toHaveBeenCalledWith(ADMIN_ROLE_ID);
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(logAdminActionMock).toHaveBeenCalled());
  });

  it("a refused Face ID prompt strips nobody — no delete, no audit row", async () => {
    requireBiometricMock.mockResolvedValue(false);
    const remove = await reachTheRemoveButton();
    fireEvent.click(remove);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN — and crucially no "remove_admin" audit row
    // was written over an account that still holds the console.
    expect(roleDeleteMock).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The admin is still in the list.
    expect(await screen.findByRole("button", { name: /Remove admin/i })).toBeInTheDocument();
  });

  it("the admin's own row offers no Remove at all — a refused action never raises a confirm or an OS sheet (DH-005)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: ADMIN_USER_ID } } });
    authUser.id = ADMIN_USER_ID;
    render(<AdminSettings />);
    const trash = await screen.findByRole("button", { name: /Remove admin/i });
    await waitFor(() => expect(trash).toBeDisabled());
    fireEvent.click(trash);
    expect(screen.queryByRole("button", { name: /^Remove Admin$/ })).toBeNull();

    expect(requireBiometricMock).not.toHaveBeenCalled();
    expect(roleDeleteMock).not.toHaveBeenCalled();
  });
});

// Two gates, two registrations. Each `if (!ok)` is the whole confirmation:
// without it a refused, cancelled or locked-out prompt still grants — or
// strips — the admin role. The real module returns true on web, so only the
// mocked refusals above can see either line go missing.
// @mutate src/components/admin/AdminSettings.tsx | if (!ok) return;\n    setAdding(profile.user_id); | setAdding(profile.user_id);
// @mutate src/components/admin/AdminSettings.tsx | if (!ok) {\n      setConfirmRemove(null);\n      return;\n    }\n\n    setRemoving(admin.role_id); | setRemoving(admin.role_id);
