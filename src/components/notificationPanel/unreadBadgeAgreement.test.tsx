/**
 * The bell badge and the notification panel's Unread segment show the same
 * count, and both must abbreviate it the same way. The bell printed "99+"
 * while the segment printed the true total (OPEN.md, "Bell abbreviates at
 * '99+' while panel chip prints the true total"); the count is the server's
 * unread total, so counts over 99 are reachable.
 *
 * @mutate src/components/ui/anchoredPanel.tsx | countText: o.count === undefined ? undefined : formatUnreadBadge(o.count), | countText: undefined,
 * @mutate src/components/notificationPanel/NotificationTrigger.tsx | {formatUnreadBadge(unreadCount)} | {unreadCount}
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NotificationTrigger } from "./NotificationTrigger";
import { AnchoredPanelSegmented } from "@/components/ui/anchoredPanel";

const bellText = (n: number) => {
  const { container, unmount } = render(<NotificationTrigger unreadCount={n} />);
  const t = container.querySelector("span")?.textContent ?? "";
  unmount();
  return t;
};

const segmentText = (n: number) => {
  const { getByRole, unmount } = render(
    <AnchoredPanelSegmented
      label="Filter"
      value="all"
      options={[{ key: "all", label: "All" }, { key: "unread", label: "Unread", count: n }]}
      onChange={() => {}}
    />,
  );
  const t = getByRole("radio", { name: /Unread/ }).textContent?.replace("Unread", "") ?? "";
  unmount();
  return t;
};

describe("bell badge and Unread segment agree on the count text", () => {
  // 150: past the abbreviation threshold, the original disagreement.
  // 99 and 100: either side of it. 7: an ordinary count.
  it.each([7, 99, 100, 150])("at %i", (n) => {
    expect(segmentText(n)).toBe(bellText(n));
  });

  it("abbreviates past 99", () => {
    expect(bellText(150)).toBe("99+");
  });
});
