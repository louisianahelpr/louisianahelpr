/**
 * BOARD 175, You › Security's gaps (owner 2026-10-25: "build the gaps"), behind 'account_security':
 *  - SIGNED IN ON: one row per real signed-in device (my_auth_sessions), this device first and
 *    marked, a Sign out on every OTHER row (revoke_my_session), and "Sign out everywhere else";
 *  - Change password in the app: current password checked on the server (verify_my_password,
 *    rate limited), the shared password rules while typing, then auth.updateUser.
 * Server behaviour: src/test/pglite/accountSecurityDevicesPassword.pglite.mjs (3x replay).
 *
 * @mutate src/components/profile/security/SignedInDevicesCard.tsx |                 {!r.is_current && ( |                 {true && (
 * @mutate src/components/profile/security/SignedInDevicesCard.tsx |   const rows = [...(sessions.data ?? [])].sort((a, b) => Number(b.is_current) - Number(a.is_current)); |   const rows = [...(sessions.data ?? [])];
 * @mutate src/components/profile/security/SignedInDevicesCard.tsx |       {others.length > 0 && ( |       {false && (
 * @mutate src/components/profile/SecurityTab.tsx |       {securityV2 ? <SignedInDevicesCard /> : ( |       {false ? <SignedInDevicesCard /> : (
 * @mutate src/components/profile/security/ChangePasswordDialog.tsx |       if (check.data !== true) return setError(changePasswordError("wrong_current")); |       if (false) return setError(changePasswordError("wrong_current"));
 * @mutate src/components/profile/security/ChangePasswordDialog.tsx |     const problem = passwordProblem(next); |     const problem = null;
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { SignedInDevicesCard, AUTH_SESSIONS_KEY, lastActiveLabel, type AuthSessionRow } from "@/components/profile/security/SignedInDevicesCard";
import { changePasswordError } from "@/components/profile/security/ChangePasswordDialog";

afterEach(cleanup);
const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));
const MIG = "supabase/migrations/20261026021601_account_security_devices_password.sql";
const NOW = Date.now();
const row = (id: string, ua: string, current: boolean, hoursAgo = 0): AuthSessionRow => ({
  session_id: id, user_agent: ua, is_current: current, signed_in_at: new Date(NOW - 86_400_000).toISOString(), last_active_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
});
const card = (rows: AuthSessionRow[]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(AUTH_SESSIONS_KEY, rows);
  return render(<QueryClientProvider client={qc}><SignedInDevicesCard /></QueryClientProvider>);
};

describe("board 175: signed in on", () => {
  it("this device first and marked with no Sign out; every other device has its own; Sign out everywhere else", () => {
    const { container } = card([row("p", "Mozilla/5.0 (iPhone) Safari", false, 26), row("m", "Mozilla/5.0 (Macintosh) Chrome/130", true)]);
    const rows = [...container.querySelectorAll("[data-device-row]")];
    expect(rows.map((r) => r.getAttribute("data-device-row"))).toEqual(["current", "other"]);
    expect(rows[0].textContent).toContain("this device");
    expect(rows[0].querySelector("button")).toBeNull();
    expect(rows[1].textContent).toContain("iPhone");
    expect(rows[1].textContent).toContain("Last active 1d ago");
    expect(rows[1].querySelector("button")?.textContent).toBe("Sign out");
    expect(screen.getByRole("button", { name: "Sign out everywhere else" })).toBeTruthy();
  });

  it("with only this device there is nothing else to sign out", () => {
    card([row("m", "Mozilla/5.0 (Macintosh) Chrome/130", true)]);
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
  });

  it("last active reads now / minutes / hours / days / a date", () => {
    const at = (m: number) => new Date(NOW - m * 60_000).toISOString();
    expect([lastActiveLabel(at(1), NOW), lastActiveLabel(at(12), NOW), lastActiveLabel(at(180), NOW), lastActiveLabel(at(60 * 49), NOW)]).toEqual(["now", "12m ago", "3h ago", "2d ago"]);
    expect(lastActiveLabel(at(60 * 24 * 10), NOW)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
});

describe("board 175: change password", () => {
  it("each refusal says what to do, one sentence, no jargon", () => {
    expect(changePasswordError("wrong_current")).toBe("That isn't your current password.");
    expect(changePasswordError("too_many")).toMatch(/^Too many tries\. Wait 15 minutes/);
    expect(changePasswordError("reauth")).toMatch(/reset link/);
    for (const k of ["wrong_current", "mismatch", "same", "too_many", "reauth", "other"] as const) expect(changePasswordError(k)).not.toMatch(/error|invalid|422|token/i);
  });

  it("checks the current password on the server first, uses the shared rules, then signs out other devices", () => {
    const src = read("components/profile/security/ChangePasswordDialog.tsx");
    const verify = src.indexOf('supabase.rpc("verify_my_password"');
    const update = src.indexOf("supabase.auth.updateUser({ password: next, current_password: current })");
    expect(verify).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(verify);
    expect(src.indexOf("await signOutOtherDevices()")).toBeGreaterThan(update);
    expect(src).toContain("PASSWORD_RULES.map(");
  });

  it("SecurityTab shows both only behind the switch, keeping Reset by email", () => {
    const tab = read("components/profile/SecurityTab.tsx");
    expect(tab).toContain('const securityV2 = useFeature("account_security");');
    expect(tab).toContain("onChange={securityV2 ? () => setChangePwOpen(true) : undefined}");
    expect(tab).toMatch(/\{securityV2 \? <SignedInDevicesCard \/> : \(/);
    expect(read("components/profile/PasswordResetCard.tsx")).toContain('aria-label="Email me a password reset link"');
  });

  it("the server: own rows only, never this session, the switch first, signed-in members only", () => {
    const sql = blankSqlComments(readFileSync(resolve(__dirname, "../..", MIG), "utf8"));
    expect(sql).toContain("WHERE s.user_id = v_uid");
    expect(sql).toContain("DELETE FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = v_uid;");
    expect(sql).toContain("RAISE EXCEPTION 'this_session'");
    expect(sql).toContain("RETURN v_hash = extensions.crypt(p_password, v_hash);");
    expect(sql.match(/PERFORM public\.require_feature\('account_security'\);/g)?.length).toBe(3);
    for (const fn of ["my_auth_sessions()", "revoke_my_session(uuid)", "verify_my_password(text)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated, service_role;`);
    }
  });
});
