import type { ReactNode } from "react";
import PublicLayout from "@/components/marketing/PublicLayout";
import { PUBLIC_CONTAINER } from "@/lib/publicContainer";

/**
 * Q2784 + Q2785: the frame a guest's app page wears on the web (useGuestPublicFrame): PublicLayout's header and footer,
 * document scroll, and the 78rem public container with the public gutters, the same geometry as PublicHeaderPage
 * (F017), so the logo, the page's title and its content share one left edge with /, /browse, /help and /hire.
 * AppPage and SectionScreen draw it in place of AppShell; the page inside keeps its own title row and body.
 * Guard: src/test/guestPagesWearPublicFrame.test.tsx.
 */
export function GuestPublicFrame({ children }: { children: ReactNode }) {
  return (
    <PublicLayout>
      <div data-public-container="" data-guest-public-frame="" className={PUBLIC_CONTAINER}>
        <div className="px-5 sm:px-8 lg:px-12 pb-12 md:pb-16">{children}</div>
      </div>
    </PublicLayout>
  );
}
