import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, ChevronRight } from "lucide-react";
import { fetchReadyTurnovers } from "@/pages/post-job/turnoverPrefill";
import { todayYmd } from "@/lib/jobDate";
import { formatShortDate } from "@/lib/format";
import { ErrorState } from "@/components/ui/ErrorState";
import { cardStyle } from "./strSettingsHelpers";
import { useAgeGate } from "@/hooks/useAgeGate";

/**
 * Q1521: "Ready to post" on /str-settings. Every imported guest checkout that
 * is today or later and not yet posted (the same funded rule as Post a Job,
 * isTurnoverPosted), each opening Post a Job pre-filled. Before this the
 * sync's one notice was the only way in, and a deleted notice lost the
 * checkout. Nothing to post draws nothing; a failed read says so.
 */
export function ReadyTurnovers() {
  // Q1586(c): each row starts a post; greyed out under 18, a tap says why.
  const { underAge, explain: explainAgeGate, gatedProps: ageGatedProps } = useAgeGate();
  const { data, isError, refetch } = useQuery({
    queryKey: ["str-ready-turnovers"],
    queryFn: () => fetchReadyTurnovers(todayYmd()),
    staleTime: 60_000,
  });

  if (isError) {
    return (
      <ErrorState
        variant="inline"
        title="We couldn't load the checkouts waiting to be posted."
        onRetry={() => refetch()}
      />
    );
  }
  if (!data || data.length === 0) return null;

  return (
    <section className="rounded-ds-md overflow-hidden" style={cardStyle} aria-labelledby="ready-turnovers-title">
      <h2
        id="ready-turnovers-title"
        className="px-4 pt-3.5 pb-1 font-display italic font-semibold text-ds-14"
        style={{ color: "hsl(var(--ink-deep))" }}
      >
        Ready to Post
      </h2>
      <p className="px-4 pb-2 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Guest checkouts from your calendars that don't have a cleaning job yet.
      </p>
      <ul>
        {data.map((t) => (
          <li key={t.id} className="border-t" style={{ borderColor: "hsl(var(--bark) / 0.12)" }}>
            <Link
              to={`/post-job?turnover=${t.id}`}
              className="flex items-center gap-3 px-4 py-3 min-h-[44px]"
              data-testid="ready-turnover"
              onClick={(e) => {
                if (!underAge) return;
                e.preventDefault();
                explainAgeGate("post");
              }}
              {...ageGatedProps("post")}
              aria-label={`Post the cleaning for ${t.propertyName}, checkout ${formatShortDate(t.checkoutDate)}`}
            >
              <CalendarCheck className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ds-14 font-medium" style={{ color: "hsl(var(--ink-deep))" }} title={t.propertyName}>
                  {t.propertyName}
                </span>
                <span className="block text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Checkout {formatShortDate(t.checkoutDate)}
                </span>
              </span>
              <span className="shrink-0 text-ds-12 font-semibold" style={{ color: "hsl(var(--bark))" }}>
                Post
              </span>
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
