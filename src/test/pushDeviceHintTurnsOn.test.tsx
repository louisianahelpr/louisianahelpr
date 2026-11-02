/**
 * A3-90 (lead 11-01; the owner has no push device): in Settings -> Notifications the "allow phone notifications" hint
 * was plain text. It is now a "Turn on phone notifications" button that runs the app's existing push request
 * (useRequestPushPermissionOutcome -> requestPushPermission on the phone, the browser prompt on web) and shows the
 * result: "On", or where to unblock it. "Not now" in our own dialog changes nothing.
 *
 * @mutate src/components/notificationPreferences/PushDeviceHint.tsx |     const outcome = await requestPush(); |     const outcome = "granted" as string;
 * @mutate src/components/notificationPreferences/PushDeviceHint.tsx | outcome === "refused" ? "blocked" : "idle" | outcome === "refused" ? "idle" : "idle"
 * @mutate src/components/notificationPreferences/PushDeviceHint.tsx | {Capacitor.isNativePlatform() ? PUSH_HINT_BLOCKED_PHONE : PUSH_HINT_BLOCKED_BROWSER} | {PUSH_HINT_BLOCKED_BROWSER}
 * @mutate src/components/notificationPreferences/PushDeviceHint.tsx |         <Button variant="primary" size="sm" className="ml-auto" disabled={state === "asking"} onClick={() => { void turnOn(); }}> |         <Button variant="primary" size="sm" className="ml-auto" disabled={state === "asking"}>
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let OUTCOME: "granted" | "refused" | "dismissed" = "granted";
let NATIVE = false;
const request = vi.fn(async () => OUTCOME);
vi.mock("@/lib/nativePush", () => ({ useRequestPushPermissionOutcome: () => request }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => NATIVE } }));

import { PushDeviceHint, PUSH_HINT_BLOCKED_BROWSER, PUSH_HINT_BLOCKED_PHONE } from "@/components/notificationPreferences/PushDeviceHint";

beforeEach(() => {
  request.mockClear();
  NATIVE = false;
});

const tap = () => fireEvent.click(screen.getByRole("button", { name: "Turn on phone notifications" }));

describe("PushDeviceHint: a button that turns push on and says what happened (A3-90)", () => {
  it("granted: the request ran once and the hint says On, with no button left", async () => {
    OUTCOME = "granted";
    render(<PushDeviceHint />);
    tap();
    expect((await screen.findByTestId("push-device-hint-result")).textContent).toBe("On");
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("refused on the phone: where to turn it on in the phone's Settings", async () => {
    OUTCOME = "refused";
    NATIVE = true;
    render(<PushDeviceHint />);
    tap();
    expect((await screen.findByTestId("push-device-hint-result")).textContent).toBe(PUSH_HINT_BLOCKED_PHONE);
    expect(PUSH_HINT_BLOCKED_PHONE).toBe("Blocked in your phone's Settings: open Settings → Louisiana Helpr → Notifications.");
  });

  it("refused in a browser: the browser's words", async () => {
    OUTCOME = "refused";
    render(<PushDeviceHint />);
    tap();
    expect((await screen.findByTestId("push-device-hint-result")).textContent).toBe(PUSH_HINT_BLOCKED_BROWSER);
  });

  it("Not now in our dialog: nothing changes, the button stays", async () => {
    OUTCOME = "dismissed";
    render(<PushDeviceHint />);
    tap();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect((screen.getByRole("button", { name: "Turn on phone notifications" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("push-device-hint-result")).toBeNull();
  });
});
