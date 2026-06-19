import { Link } from "react-router-dom";
import { MapPin, ArrowRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageTitle } from "@/hooks/usePageTitle";

const PARISHES = [
  { slug: "orleans", name: "Orleans" },
  { slug: "jefferson", name: "Jefferson" },
  { slug: "east-baton-rouge", name: "East Baton Rouge" },
  { slug: "st-tammany", name: "St. Tammany" },
  { slug: "caddo", name: "Caddo" },
  { slug: "calcasieu", name: "Calcasieu" },
  { slug: "lafayette", name: "Lafayette" },
  { slug: "ouachita", name: "Ouachita" },
];

const ParishesPage = () => {
  usePageTitle("Louisiana Parishes — Helpr Community");

  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Louisiana Helpr Community"
        title="Browse by Parish"
        meta="Find local jobs and helpers in your corner of Louisiana"
      />

      <main className="container mx-auto px-5 py-6 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PARISHES.map(({ slug, name }) => (
            <Link
              key={slug}
              to={`/parish/${slug}`}
              className="flex items-center gap-3 rounded-ds-md liquid-glass p-4 hover:ring-1 hover:ring-primary/20 transition-all group"
              aria-label={`Browse ${name} Parish`}
            >
              <div
                className="w-9 h-9 rounded-ds-sm flex items-center justify-center shrink-0"
                style={{
                  background: "hsl(var(--burnt-sienna) / 0.08)",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.18)",
                }}
              >
                <MapPin className="w-4 h-4" style={{ color: "hsl(var(--burnt-sienna))" }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                  {name} Parish
                </p>
              </div>
              <ArrowRight
                className="w-4 h-4 shrink-0 opacity-40 group-hover:opacity-70 transition-opacity"
                style={{ color: "hsl(var(--olivewood))" }}
              />
            </Link>
          ))}
        </div>
      </main>
    </PublicLayout>
  );
};

export default ParishesPage;
