/**
 * F259c (audit 11-10): refreshing /signup threw away every typed field. First name, last name and email are now kept
 * in sessionStorage (useSignupDraftField, src/lib/signupDraft.ts) and put back after a reload; the password never is.
 * The draft goes when the account is created, when the page unmounts, and on sign-out.
 *
 * @mutate src/pages/auth/Signup.tsx |   const [email, setEmail] = useSignupDraftField("email"); |   const [email, setEmail] = useState("");
 * @mutate src/pages/auth/Signup.tsx |   const [firstName, setFirstName] = useSignupDraftField("firstName"); // F259c: kept over a reload |   const [firstName, setFirstName] = useState("");
 * @mutate src/lib/signupDraft.ts |     if (value) window.sessionStorage.setItem(signupDraftStorageKey(key), value); |     if (value) void value;
 * @mutate src/pages/auth/signup/useSignupDraftField.ts |   const [value, setValue] = useState(() => readSignupDraft(key)); |   const [value, setValue] = useState("");
 * @mutate src/pages/auth/signup/useSignupDraftField.ts |   useEffect(() => () => clearSignupDraft(key), [key]); |   useEffect(() => () => undefined, [key]);
 * @mutate src/pages/auth/Signup.tsx |       clearSignupDraft(); // F259c: the account exists, so the reload draft goes |
 * @mutate src/lib/authSignOut.ts |   clearSignupDraft();\n |
 * @mutate src/lib/signupDraft.ts |   for (const key of only ? [only] : KEYS) { |   for (const key of only ? [only] : []) {
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { useSignupDraftField } from "@/pages/auth/signup/useSignupDraftField";
import { clearSignupDraft } from "@/lib/signupDraft";

afterEach(() => window.sessionStorage.clear());
const code = (rel: string) => blankComments(readFileSync(resolve(__dirname, "..", rel), "utf8"));

describe("F259c: the sign-up draft survives a reload", () => {
  it("a typed email is kept, comes back on a fresh mount (the reload), and is dropped on unmount", () => {
    const first = renderHook(() => useSignupDraftField("email"));
    act(() => first.result.current[1]("ann@example.com"));
    expect(window.sessionStorage.getItem("lh-signup-draft:email")).toBe("ann@example.com");
    // A reload: the page goes away without React unmounting it, and the storage is still there.
    const reloaded = renderHook(() => useSignupDraftField("email"));
    expect(reloaded.result.current[0]).toBe("ann@example.com");
    first.unmount();
    reloaded.unmount();
    expect(window.sessionStorage.getItem("lh-signup-draft:email")).toBeNull();
  });

  it("clearSignupDraft() drops every field (used on account creation and sign-out)", () => {
    for (const k of ["firstName", "lastName", "email"]) window.sessionStorage.setItem(`lh-signup-draft:${k}`, "x");
    clearSignupDraft();
    for (const k of ["firstName", "lastName", "email"]) expect(window.sessionStorage.getItem(`lh-signup-draft:${k}`)).toBeNull();
  });

  it("Signup keeps first name, last name and email (never the password) and clears them once the account exists", () => {
    const s = code("pages/auth/Signup.tsx");
    expect(s).toContain('const [firstName, setFirstName] = useSignupDraftField("firstName");');
    expect(s).toContain('const [lastName, setLastName] = useSignupDraftField("lastName");');
    expect(s).toContain('const [email, setEmail] = useSignupDraftField("email");');
    expect(s).toContain('const [password, setPassword] = useState("");');
    expect(s).not.toMatch(/useSignupDraftField\("password"/);
    expect(s).toMatch(/if \(!userId\) throw new Error\("Account creation failed"\);\s*clearSignupDraft\(\);/);
  });

  it("sign-out clears the draft", () => {
    const s = code("lib/authSignOut.ts");
    const body = s.slice(s.indexOf("export async function signOutWithPushCleanup"), s.indexOf("export async function signOutOtherDevices"));
    expect(body).toContain("clearSignupDraft();");
  });
});
