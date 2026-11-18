/**
 * Area 06 M11 (11-18): the Helpr delivery card showed two message buttons of different sizes (the order chat's small
 * outline pill and the delivery chat's full-size one). Both are the small outline pill now.
 *
 * @mutate src/components/declutter/DeliveryTalk.tsx |       <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setOpen(true)}>{label}</Button> |       <Button type="button" variant="outline" className="rounded-full" onClick={() => setOpen(true)}>{label}</Button>
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

vi.mock("@/lib/helprTasks/talk", () => ({ fetchDeliveryTalk: async () => [], sendDeliveryMessage: async () => undefined }));

import { DeliveryTalkButton } from "./DeliveryTalk";

describe("the delivery chat button matches the order chat button", () => {
  it("is the small outline pill", () => {
    render(<DeliveryTalkButton taskId="t1" />);
    const b = screen.getByRole("button", { name: "Message about this delivery" });
    const small = cn(buttonVariants({ variant: "outline", size: "sm", className: "rounded-full" })).split(/\s+/).filter(Boolean);
    expect(small.length).toBeGreaterThan(2);
    for (const c of small) expect(b.className.split(/\s+/)).toContain(c);
  });
});
