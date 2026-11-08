/**
 * Shops audit 11-08 #6: the Shops group on the Notifications screen shows one switch row per shops_* kind to a member
 * who has Shops, and nothing to one who does not.
 *
 * @mutate src/components/notificationPreferences/ShopsNotificationGroup.tsx |   if (!shopsOn) return null; |
 * @mutate src/components/notificationPreferences/ShopsNotificationGroup.tsx |       {shopsRows.map((r) => renderRow(r))} |
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const feature = vi.hoisted(() => ({ on: true }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => feature.on }));

import { ShopsNotificationGroup } from "./ShopsNotificationGroup";

describe("the Shops notification group", () => {
  it("shows Orders, Shop messages and Shop updates to a member with Shops", () => {
    feature.on = true;
    render(<ShopsNotificationGroup renderRow={(r) => <p key={r.key}>{r.label}</p>} />);
    expect(screen.getByRole("heading", { name: "Shops" })).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Shop messages")).toBeTruthy();
    expect(screen.getByText("Shop updates")).toBeTruthy();
  });

  it("is not shown without Shops", () => {
    feature.on = false;
    const { container } = render(<ShopsNotificationGroup renderRow={(r) => <p key={r.key}>{r.label}</p>} />);
    expect(container.textContent).toBe("");
  });
});
