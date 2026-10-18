import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ClipboardList, Briefcase, MessageSquare, UserRound } from "lucide-react";
import AppPage from "@/components/AppPage";
import { SectionHeaderActions } from "@/components/mobileNav/SectionHeaderActions";
import { useVisibleSections } from "@/components/mobileNav/sectionNav";
import { useAgeGate } from "@/hooks/useAgeGate";

/** One line under each section's name on the hub (plain words, U3). */
const SECTION_BLURB: Record<string, string> = {
  jobs: "Hire a Helpr or find local work near you.",
  declutter: "Buy and sell used household items near you.",
  shops: "Local shops and businesses: order, book or rent.",
  homes: "Homes to rent, and repairs for the one you rent or own.",
};

/**
 * HOME HUB v1 (owner, 2026-10-18 ~00:20Z): the first tab. A brief preview of
 * every section the viewer can see (the SAME list as the bottom bar and the
 * rail, sectionNav.ts), each row ending in 'See all'; a 'Your stuff' card with
 * your posts, your jobs, Messages and you; and Home's '+', which opens a
 * chooser of what to post in each section.
 *
 * Not yet here (later slices, Q-tracked in docs/OPEN.md): three preview cards
 * per section, per-section unread counts, For you / favorites / do-it-again.
 */
export default function HomeHubPage() {
  const navigate = useNavigate();
  const sections = useVisibleSections();
  const rows = sections.filter((s) => s.key !== "home");
  const [choosing, setChoosing] = useState(false);
  // Q1586(c): posting a job greys out under 18; a tap says why.
  const { gate } = useAgeGate();
  const postable = rows.filter((s) => s.post);

  return (
    <AppPage
      title="Home"
      hideBack
      titleActions={
        <SectionHeaderActions
          section="home"
          post={{ label: "New", onClick: () => setChoosing((v) => !v) }}
        />
      }
    >
      {choosing && (
        <section aria-label="What do you want to post?" className="rounded-2xl border border-border bg-card p-2" data-testid="hub-chooser">
          <ul className="flex flex-col">
            {postable.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={s.key === "jobs" ? gate("post", () => navigate(s.post!.path)) : () => navigate(s.post!.path)}
                  className="flex w-full min-h-11 items-center gap-3 rounded-ds-md px-3 py-2 text-left ctl-tint"
                >
                  <s.icon className="h-5 w-5 shrink-0" aria-hidden style={{ color: "hsl(var(--brand))" }} />
                  <span className="flex-1 text-ds-15 font-semibold">
                    {s.post!.label} <span className="font-normal text-muted-foreground">in {s.label}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="hub-your-stuff" className="rounded-2xl border border-border bg-card p-4">
        <h2 id="hub-your-stuff" className="text-ds-17 font-semibold">Your stuff</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2">
          {[
            { to: "/posts", label: "My posts", icon: ClipboardList },
            { to: "/jobs", label: "My jobs", icon: Briefcase },
            { to: "/messages", label: "Messages", icon: MessageSquare },
            { to: "/profile", label: "Profile", icon: UserRound },
          ].map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <button
                type="button"
                onClick={() => navigate(to)}
                className="flex w-full min-h-11 items-center gap-2 rounded-ds-md px-3 py-2 text-left ctl-tint"
                style={{ background: "hsl(var(--brand) / 0.06)" }}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden style={{ color: "hsl(var(--brand))" }} />
                <span className="text-ds-14 font-medium">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {rows.map((s) => (
        <section key={s.key} aria-labelledby={`hub-${s.key}`} className="rounded-2xl border border-border bg-card p-4" data-hub-section={s.key}>
          <div className="flex items-center gap-3">
            <s.icon className="h-6 w-6 shrink-0" aria-hidden style={{ color: "hsl(var(--brand))" }} />
            <div className="min-w-0 flex-1">
              <h2 id={`hub-${s.key}`} className="text-ds-17 font-semibold">{s.label}</h2>
              <p className="text-ds-13 text-muted-foreground">{SECTION_BLURB[s.key]}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate(s.path)}
              aria-label={`See all in ${s.label}`}
              className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-full px-3 text-ds-14 font-semibold ctl-tint"
              style={{ color: "hsl(var(--brand))" }}
            >
              See all
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </section>
      ))}
    </AppPage>
  );
}
