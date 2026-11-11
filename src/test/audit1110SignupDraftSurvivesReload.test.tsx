/**
 * F259c (audit 11-10): refreshing /signup threw away every typed field. First name, last name and email are now kept
 * in sessionStorage (useSignupDraftField) and put back after a reload; the password never is; the draft goes when the
 * page unmounts (account made, or the member left).
 *
 * @mutate src/pages/auth/Signup.tsx |   const [email, setEmail] = useSignupDraftField("email"); |   const [email, setEmail] = useState("");
 * @mutate src/pages/auth/Signup.tsx |   const [firstName, setFirstName] = useSignupDraftField("firstName"); // F259c: kept over a reload |   const [firstName, setFirstName] = useState("");
 * @mutate src/pages/auth/signup/useSignupDraftField.ts |       if (value) window.sessionStorage.setItem(storageKey(key), value); |       if (value) void value;
 * @mutate src/pages/auth/signup/useSignupDraftField.ts |   const [value, setValue] = useState(() => read(key)); |   const [value, setValue] = useState("");
 * @mutate src/pages/auth/signup/useSignupDraftField.ts |   useEffect(() => () => { |   useEffect(() => () => { return;
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { useSignupDraftField } from "@/pages/auth/signup/useSignupDraftField";

afterEach(() => window.sessionStorage.clear());

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

  it("Signup keeps first name, last name and email in the draft, and never the password", () => {
    const s = blankComments(readFileSync(resolve(__dirname, "../pages/auth/Signup.tsx"), "utf8"));
    expect(s).toContain('const [firstName, setFirstName] = useSignupDraftField("firstName");');
    expect(s).toContain('const [lastName, setLastName] = useSignupDraftField("lastName");');
    expect(s).toContain('const [email, setEmail] = useSignupDraftField("email");');
    expect(s).toContain('const [password, setPassword] = useState("");');
    expect(s).not.toMatch(/useSignupDraftField\("password"/);
  });
});
