/**
 * /holidays/hire-a-helpr (Louisiana Holiday Hub, owner-approved 2026-11-20): the holiday jobs a local Helpr can do
 * (lights, decorating, cleaning, party setup and cleanup, gift wrapping, hauling, yard prep), each opening Post a job
 * filled in with its category and title (the matchmaker link, every value re-checked on read), plus Post a job and Find
 * work. For everyone (never role-based). No ID prompt here (owner 11-20: ID only at an offer, a hire or a payout).
 * Guard: src/test/holidayHub.test.tsx.
 */
import { Link } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { MATCHMAKER_PARAM } from "@/lib/matchmakerLink";
import { browseDestinationFor } from "@/lib/browseDestination";
import { HIRE_STEPS } from "@/components/landing/hireSteps";
import { HOLIDAY_HELP, HOLIDAY_HUB_PATH, HOLIDAY_WORDS as W } from "@/content/holidayHub/holidayHub.mjs";
import { HUB_COLUMN, HUB_HEADER_COLUMN, useHolidayPageView } from "./holidayParts";

/** Post a job, filled in when a holiday job was picked; a visitor signs up first and lands back on the form. */
function holidayPostLink(signedIn: boolean, job?: { category: string; title: string }): string {
  const form = job ? `/post-job?${new URLSearchParams({ [MATCHMAKER_PARAM]: "1", cat: job.category, t: job.title }).toString()}` : "/post-job";
  return signedIn ? form : `/signup?redirect=${encodeURIComponent(form)}`;
}

export default function HolidayHire() {
  usePageMeta(PUBLIC_PAGE_META["/holidays/hire-a-helpr"]);
  useHolidayPageView("holidays_hire");
  const { user } = useCurrentUser();
  const signedIn = Boolean(user);
  return (
    <PublicHeaderPage title={W.hireTitle} backTo={HOLIDAY_HUB_PATH} wrapTitle bottomPaddingClassName="pb-12 md:pb-16" headerWrapperClassName={HUB_HEADER_COLUMN}>
      <div className={`${HUB_COLUMN} space-y-section font-sans`} data-holiday-page="hire">
        <section className="space-y-4">
          <p className="max-w-[68ch] text-ds-17 text-foreground">
            The holidays are busy. A neighbor can hang the lights, get the house ready and clean up after the party, so you
            get to enjoy it. Post the job for free and name your price, or find holiday work near you.
          </p>
          {/* Train 11-18 rule (buttonPairsPrimaryRight): the green primary on the right of the pair. */}
          <div className="flex flex-wrap gap-3" data-holiday-ctas="">
            <Button asChild variant="outline" className="rounded-full">
              <Link to={browseDestinationFor(user)} data-holiday-find-work="">Find work</Link>
            </Button>
            <Button asChild className="rounded-full">
              <Link to={holidayPostLink(signedIn)} data-holiday-post="">Post a job</Link>
            </Button>
          </div>
        </section>
        <section aria-labelledby="holiday-help" className="space-y-3">
          <h2 id="holiday-help" className="text-ds-20 font-semibold text-foreground">What a Helpr can do</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {HOLIDAY_HELP.map((h) => (
              <li key={h.title} className="flex min-w-0 flex-col rounded-[20px] border border-border bg-card p-5" data-holiday-help={h.category}>
                <h3 className="text-ds-17 font-semibold text-foreground">{h.title}</h3>
                <p className="mt-1 text-ds-15 text-muted-foreground">{h.body}</p>
                <div className="mt-auto pt-4">
                  <Button asChild variant="outline" size="sm" className="rounded-full">
                    <Link to={holidayPostLink(signedIn, h)} data-holiday-help-post={h.title}>
                      Post this job<span className="sr-only">: {h.title}</span>
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="holiday-how" className="space-y-3">
          <h2 id="holiday-how" className="text-ds-20 font-semibold text-foreground">How it works</h2>
          {/* The landing's own three steps, word for word (hireSteps.ts), as the /hire town pages show them. */}
          <ol className="list-decimal space-y-1.5 pl-5 text-ds-15 text-foreground">
            {HIRE_STEPS.map((s) => <li key={s.title}><span className="font-semibold">{s.title}.</span> {s.desc}</li>)}
          </ol>
        </section>
        <nav aria-label="More from the Holiday Hub" className="flex flex-wrap gap-x-6 gap-y-2 text-ds-15">
          <Link to={HOLIDAY_HUB_PATH} className="link-standard inline-flex min-h-11 items-center">Christmas lights and holiday events</Link>
        </nav>
      </div>
    </PublicHeaderPage>
  );
}
