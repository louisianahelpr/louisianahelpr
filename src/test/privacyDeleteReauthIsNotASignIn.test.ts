/**
 * privacy-journey 41792903580 (11-04): "signIns 2 is over its budget 0". The two password grants were the delete
 * step's "is it really you?" password (A3-I5, owner 2026-10-29, cd90d9339b), a re-auth the app asks for. The budget
 * is not raised (owner rule): the journey declares those grants a RE-AUTH through the context hook
 * `__requestMeterReauth`, which the meter counts in total and reAuths, never in signIns. Any other password grant
 * still counts as a sign-in, so the budget stays 0 for anything unexpected.
 *
 * @mutate e2e/requestMeter.mjs |       this.record(req.url(), req.method(), Date.now(), seen, { reauth: !!context.__requestMeterReauth?.(req) }); |       this.record(req.url(), req.method(), Date.now(), seen);
 * @mutate e2e/requestMeter.mjs |       if (reauth) this.reAuths++; |       if (reauth) this.signIns++;
 * @mutate e2e/privacy/privacy-requests.spec.ts |     const reauth = countDeletePasswordAsReauth(page);\n    await page | const reauth = { off() {} };\n    await page
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RequestMeter } from "../../e2e/requestMeter.mjs";

const ROOT = resolve(__dirname, "..", "..");
const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const grant = { url: () => `${BASE}/auth/v1/token?grant_type=password`, method: () => "POST" };

function meterWith(hook: ((req: typeof grant) => boolean) | null) {
  const meter = new RequestMeter("privacy");
  const listeners: ((req: unknown) => void)[] = [];
  const ctx: Record<string, unknown> = { on: (ev: string, fn: (req: unknown) => void) => { if (ev === "request") listeners.push(fn); }, pages: () => [] };
  meter.attach(ctx as never);
  if (hook) ctx.__requestMeterReauth = hook;
  const send = () => { for (const fn of listeners) fn(grant); };
  return { meter, ctx, send };
}

describe("privacy journey: the delete step's password is a re-auth, not a sign-in", () => {
  it("a grant the context declares a re-auth counts in total and reAuths, not signIns", () => {
    const { meter, send } = meterWith((req) => req.method() === "POST" && /grant_type=password/.test(req.url()));
    send(); send();
    expect(meter.signIns).toBe(0);
    expect(meter.reAuths).toBe(2);
    expect(meter.total).toBe(2);
    expect(meter.toJSON().reAuths).toBe(2);
  });

  it("without the hook (or once it is off) a password grant is still a sign-in", () => {
    const { meter, ctx, send } = meterWith((req) => /grant_type=password/.test(req.url()));
    send();
    delete ctx.__requestMeterReauth;
    send();
    expect(meter.signIns).toBe(1);
    expect(meter.reAuths).toBe(1);
    const plain = meterWith(null);
    plain.send();
    expect(plain.meter.signIns).toBe(1);
  });

  it("the journey turns it on only around both delete presses", () => {
    const spec = readFileSync(resolve(ROOT, "e2e/privacy/privacy-requests.spec.ts"), "utf8");
    expect(spec.match(/const reauth = countDeletePasswordAsReauth\(page\);\n\s*await page\.getByLabel\("Your password"\)\.fill\(PASSWORD\);/g)?.length).toBe(2);
    expect(spec.match(/page\.getByRole\("button", \{ name: "Delete my account" \}\)\.click\(\),\n\s*\]\);\n\s*reauth\.off\(\);/g)?.length).toBe(2);
    // The hook matches a password grant only.
    expect(spec).toMatch(/__requestMeterReauth = \(req\) => req\.method\(\) === "POST" && \/\\\/auth\\\/v1\\\/token\\\?\(\?:\.\*&\)\?grant_type=password\\b\/\.test\(req\.url\(\)\);/);
  });
});
