/**
 * A Radix overlay's unmount timer fires while jsdom is still alive.
 *
 * Radix FocusScope (inside every Dialog, Popover, Sheet and AlertDialog) runs
 * `setTimeout(() => container.dispatchEvent(new CustomEvent("focusScope.autoFocusOnUnmount")))`
 * when it unmounts. The global cleanup in setup.ts unmounts after each test; when
 * that was a file's last test, the timer could fire after vitest had torn jsdom
 * down, and the run failed with "Failed to execute 'dispatchEvent' on
 * 'EventTarget': parameter 1 is not of type 'Event'" as an unhandled error while
 * every test passed (land-vitest-changed 2026-10-15, chunk 1/10, from
 * src/components/NotificationPanel.failedLoad.test.tsx; the session before, the
 * same exit-1-with-all-passing on chunk 3). It shows only under load, so this
 * test pins the mechanism instead: by the time the next test starts, the
 * previous test's unmount timer has already run.
 *
 * @mutate src/test/setup.ts |   if (!vi.isFakeTimers()) await new Promise((r) => setTimeout(r, 0)); |
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render } from "@testing-library/react";
import { FocusScope } from "@radix-ui/react-focus-scope";

const UNMOUNT_EVENT = "focusScope.autoFocusOnUnmount";
const seen: string[] = [];
const original = EventTarget.prototype.dispatchEvent;

describe("Radix FocusScope's unmount timer drains in afterEach", () => {
  beforeAll(() => {
    EventTarget.prototype.dispatchEvent = function (this: EventTarget, e: Event) {
      seen.push(e.type);
      return original.call(this, e);
    };
  });
  afterAll(() => {
    EventTarget.prototype.dispatchEvent = original;
  });

  it("mounts a trapped focus scope and leaves it for the global cleanup", () => {
    render(
      <FocusScope trapped loop>
        <button type="button">inside</button>
      </FocusScope>,
    );
    expect(seen).not.toContain(UNMOUNT_EVENT);
  });

  it("the previous test's unmount event was dispatched before this test began", () => {
    expect(seen).toContain(UNMOUNT_EVENT);
  });
});
