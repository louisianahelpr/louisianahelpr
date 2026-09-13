import { describe, it, expect } from "vitest";
import { contactLeakFieldError, contactLeakRejectionMessage } from "./contactLeakField";

describe("contactLeakFieldError — the pre-submit guard for job title/description and bio", () => {
  it("names the class, the field and the match, plus the fix", () => {
    const msg = contactLeakFieldError("Reach me at 504-555-0100", "job description");
    expect(msg).toMatch(/^Phone number detected in the job description \("504-555-0100"\)\./);
    expect(msg).toMatch(/off the post/);
  });
  it("uses profile wording for the bio", () => {
    expect(contactLeakFieldError("venmo me", "bio")).toMatch(/in your bio .*off your profile/);
  });
  it("catches the hyphenated-domain email the old server missed", () => {
    expect(contactLeakFieldError("jane@my-domain.com", "job title")).toMatch(/Email address detected/);
  });
  it("passes clean text and a base36 run marker", () => {
    expect(contactLeakFieldError("Mow and edge the yard, bags at the curb. r1k2j3m4", "job title")).toBeNull();
    expect(contactLeakFieldError("", "bio")).toBeNull();
  });
});

describe("contactLeakRejectionMessage — only the trigger's own 23514 text is shown verbatim", () => {
  const serverMsg = "Phone number detected in the job title. Keep contact details and payment off the post; hiring and payment happen in the app.";
  it("returns the server message for the contact-leak check_violation", () => {
    expect(contactLeakRejectionMessage({ code: "23514", message: serverMsg })).toBe(serverMsg);
    expect(contactLeakRejectionMessage({ code: "23514", message: "Email address detected in your bio. Keep it off." })).toMatch(/your bio/);
  });
  it("returns null for any other error, including other check_violations", () => {
    expect(contactLeakRejectionMessage({ code: "23514", message: 'new row for relation "jobs" violates check constraint "jobs_budget_check"' })).toBeNull();
    expect(contactLeakRejectionMessage({ code: "42501", message: "new row violates row-level security policy" })).toBeNull();
    expect(contactLeakRejectionMessage(null)).toBeNull();
    expect(contactLeakRejectionMessage(new Error("x"))).toBeNull();
  });
});
