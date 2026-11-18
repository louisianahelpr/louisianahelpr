import { ChevronRight } from "lucide-react";
import { AdminCard, AdminViewShell } from "./AdminViewShell";

/**
 * Design audit area 10 #3 (11-18): the four stage previews were reached from stray buttons on Reports (two) and
 * Jobs (one), and from a card at the bottom of Settings. One "Stage previews" row under System lists all four.
 * Each is a plain link (a fresh page), so the preview's fetch layer starts on a clean page.
 * Guard: src/test/adminStagePreviewsAndSponsorsEntry.test.ts.
 */
export const STAGE_PREVIEWS: ReadonlyArray<{ href: string; title: string; body: string }> = [
  { href: "/admin/preview/job", title: "Job page", body: "Every job stage, as the poster or the Helpr sees it." },
  { href: "/admin/preview/declutter", title: "Declutter orders", body: "Every order stage, as the buyer or the seller sees it." },
  { href: "/admin/preview/messages", title: "Messages", body: "The Messages page and its job notices." },
  { href: "/admin/preview/onboarding", title: "Sign-up", body: "Each sign-up step a new member walks through." },
];

export default function AdminStagePreviews() {
  return (
    <AdminViewShell>
      <AdminCard subtitle="Made-up data. Nothing is saved or sent.">
        <ul className="divide-y divide-border">
          {STAGE_PREVIEWS.map((p) => (
            <li key={p.href}>
              <a href={p.href} data-stage-preview-link="" className="flex min-h-[44px] items-center gap-3 py-3 hover:bg-muted/40 rounded-ds-md px-2 -mx-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-ds-14 font-semibold text-foreground">{p.title}</span>
                  <span className="block text-ds-12 text-muted-foreground">{p.body}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </AdminCard>
    </AdminViewShell>
  );
}
