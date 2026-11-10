/**
 * OPS-4 (owner approved 10-29): a town + service page for Google, /hire/<service>/<town> ("Handyman in Baton Rouge").
 * What Louisiana Helpr does for that job in that town, in the landing's own true words, one way to post the job, and
 * links to the same service in the other towns and the other services in this town. No counts, so nothing reads "0"
 * in a town with no Helprs yet (lead 10-31: nothing shown at zero). Data: src/lib/townPages.mjs.
 * Guard: src/pages/info/hireTownPage.test.tsx.
 */
import { Link, Navigate, useParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import NotFound from "@/pages/info/NotFound";
import { JOB_CATEGORY_VALUES } from "@/lib/jobCategories";
import { HIRE_STEPS } from "@/components/landing/hireSteps";
import { TOWN_PAGE_SERVICES, TOWN_PAGE_TOWNS, findTownPage, townPageMeta, townPagePath, type TownPageService, type TownPageTown } from "@/lib/townPages.mjs";

/** F063: the town page's column, and its header's (the column plus the shell's side padding at each breakpoint). */
const TOWN_COLUMN = "max-w-[760px]";
const TOWN_HEADER_COLUMN = "mx-auto max-w-[calc(760px+2.5rem)] sm:max-w-[calc(760px+4rem)] lg:max-w-[calc(760px+6rem)]";


export default function HireTownPage() {
  const { service: serviceSlug, town: townSlug } = useParams();
  const page = findTownPage(serviceSlug, townSlug);
  // F065 (owner UI audit 11-09; lead decision 11-09): a service/town pair with no page, for a real job category
  // (/hire/plumbing/natchitoches), opens Browse filtered to that category instead of the 404. Licensed trades still
  // get no town page of their own. Anything else is still the 404.
  const category = page ? null : unknownComboCategory(serviceSlug);
  if (category) return <Navigate replace to={`/browse?cat=${category}`} />;
  if (!page) return <NotFound />;
  return <TownPage service={page.service} town={page.town} />;
}

/** The job category a /hire/<service> slug names ("auto-repair" -> auto_repair), or null. */
function unknownComboCategory(serviceSlug: string | undefined): string | null {
  const value = (serviceSlug ?? "").toLowerCase().replace(/-/g, "_");
  return (JOB_CATEGORY_VALUES as readonly string[]).includes(value) ? value : null;
}

function TownPage({ service, town }: { service: TownPageService; town: TownPageTown }) {
  usePageMeta(townPageMeta(service, town));
  const { user } = useCurrentUser();
  // Under 18 (Q1586(c)): the link greys out and says why instead of opening the form. It stays a real link, so
  // search engines and signed-out visitors still follow it.
  const { underAge, explain, gatedProps } = useAgeGate();
  const post = user ? "/post-job" : `/signup?redirect=${encodeURIComponent("/post-job")}`;
  const ink = { color: "hsl(var(--ink-deep))" };
  return (
    // F063 (owner UI audit 11-09): the page is a ~760px column, centred, title included (the header's max width is the
    // column plus the shell's own side padding at each breakpoint, px-5 / sm:px-8 / lg:px-12, so their left edges meet).
    <PublicHeaderPage title={`${service.pageLabel ?? service.label} in ${town.name}`} width="public" wrapTitle bottomPaddingClassName="pb-12 md:pb-16"
      headerWrapperClassName={TOWN_HEADER_COLUMN}>
      <div className={`mx-auto ${TOWN_COLUMN} space-y-section font-sans`} data-town-page={`${service.slug}/${town.slug}`}>
        <section className="space-y-4">
          <p className="text-ds-17" style={ink}>
            Need {service.phrase} in {town.name}? Post the job on Louisiana Helpr and a local Helpr can take it.
          </p>
          <Button asChild size="wrap" className="rounded-full">
            <Link
              to={post}
              onClick={(e) => {
                if (!underAge) return;
                e.preventDefault();
                explain("post");
              }}
              {...gatedProps("post")}
            >
              Post a job
            </Link>
          </Button>
          {/* L014: the page named no Helprs; the directory, filtered to this town, is one tap away. */}
          <p className="text-ds-15">
            <Link to={`/helprs?town=${encodeURIComponent(town.name)}`} className="link-standard font-semibold" data-town-helprs="" style={ink}>
              See Helprs in {town.name}
            </Link>
          </p>
        </section>
        <section aria-labelledby="town-how" className="space-y-3">
          <h2 id="town-how" className="text-ds-17 font-semibold" style={ink}>How it works</h2>
          <ol className="space-y-3">
            {/* L014 (landing audit 11-09): the landing's own three steps, word for word (hireSteps.ts). */}
            {HIRE_STEPS.map((s) => (
              <li key={s.title} className="rounded-2xl liquid-glass p-card">
                <p className="font-semibold" style={ink}>{s.title}</p>
                <p className="text-ds-15 text-muted-foreground">{s.desc}</p>
              </li>
            ))}
          </ol>
        </section>
        <nav aria-labelledby="town-more" className="space-y-3">
          <h2 id="town-more" className="text-ds-17 font-semibold" style={ink}>More near you</h2>
          {/* F063: chips, not a run-on line of small links. */}
          <ul className="flex flex-wrap gap-2" data-town-more="towns">
            {TOWN_PAGE_TOWNS.filter((t) => t.slug !== town.slug).map((t) => (
              <li key={t.slug}><Button asChild variant="outline" size="sm" className="font-semibold tracking-normal"><Link to={townPagePath(service, t)}>{service.pageLabel ?? service.label} in {t.name}</Link></Button></li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-2" data-town-more="services">
            {TOWN_PAGE_SERVICES.filter((s) => s.slug !== service.slug).map((s) => (
              <li key={s.slug}><Button asChild variant="outline" size="sm" className="font-semibold tracking-normal"><Link to={townPagePath(s, town)}>{s.pageLabel ?? s.label} in {town.name}</Link></Button></li>
            ))}
          </ul>
        </nav>
      </div>
    </PublicHeaderPage>
  );
}
