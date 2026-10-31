/**
 * OPS-4 (owner approved 10-29): a town + service page for Google, /hire/<service>/<town> ("Handyman in Baton Rouge").
 * What Louisiana Helpr does for that job in that town, in the landing's own true words, one way to post the job, and
 * links to the same service in the other towns and the other services in this town. No counts, so nothing reads "0"
 * in a town with no Helprs yet (lead 10-31: nothing shown at zero). Data: src/lib/townPages.ts.
 * Guard: src/pages/info/hireTownPage.test.tsx.
 */
import { Link, useParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import NotFound from "@/pages/info/NotFound";
import { TOWN_PAGE_SERVICES, TOWN_PAGE_TOWNS, findTownPage, townPageMeta, townPagePath, type TownPageService, type TownPageTown } from "@/lib/townPages";

const STEPS = [
  { title: "You name the price", body: "Say what you need done and what you'll pay." },
  { title: "Local Helprs apply", body: "People nearby see your job and apply. You pick who does it." },
  { title: "Pay when it's done", body: "Your money is held safely until you approve the work." },
] as const;

export default function HireTownPage() {
  const { service: serviceSlug, town: townSlug } = useParams();
  const page = findTownPage(serviceSlug, townSlug);
  if (!page) return <NotFound />;
  return <TownPage service={page.service} town={page.town} />;
}

function TownPage({ service, town }: { service: TownPageService; town: TownPageTown }) {
  usePageMeta(townPageMeta(service, town));
  const { user } = useCurrentUser();
  const post = user ? "/post-job" : `/signup?redirect=${encodeURIComponent("/post-job")}`;
  const ink = { color: "hsl(var(--ink-deep))" };
  return (
    <PublicHeaderPage title={`${service.label} in ${town.name}`} width="public" wrapTitle bottomPaddingClassName="pb-12 md:pb-16">
      <div className="mx-auto page-measure space-y-section font-sans" data-town-page={`${service.slug}/${town.slug}`}>
        <section className="space-y-4">
          <p className="text-ds-17" style={ink}>
            Need {service.phrase} in {town.name}? Post the job on Louisiana Helpr and a local Helpr can take it.
          </p>
          <Button asChild size="wrap" className="rounded-full">
            <Link to={post}>Post a job</Link>
          </Button>
        </section>
        <section aria-labelledby="town-how" className="space-y-3">
          <h2 id="town-how" className="text-ds-17 font-semibold" style={ink}>How it works</h2>
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li key={s.title} className="rounded-2xl liquid-glass p-4">
                <p className="font-semibold" style={ink}>{s.title}</p>
                <p className="text-ds-15 text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <nav aria-labelledby="town-more" className="space-y-3">
          <h2 id="town-more" className="text-ds-17 font-semibold" style={ink}>More near you</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {TOWN_PAGE_TOWNS.filter((t) => t.slug !== town.slug).map((t) => (
              <li key={t.slug}><Link className="link-standard text-ds-15" to={townPagePath(service, t)}>{service.label} in {t.name}</Link></li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {TOWN_PAGE_SERVICES.filter((s) => s.slug !== service.slug).map((s) => (
              <li key={s.slug}><Link className="link-standard text-ds-15" to={townPagePath(s, town)}>{s.label} in {town.name}</Link></li>
            ))}
          </ul>
        </nav>
      </div>
    </PublicHeaderPage>
  );
}
