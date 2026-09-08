import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { report } from "@/lib/errorLogger";

interface AdminRouteProps {
  children: React.ReactNode;
}

/**
 * Admin gate. Three outcomes, because the role lookup has three answers —
 * see `AdminStatus` in useCurrentUser.
 *
 * This component used to read only `isAdmin`, and `isAdmin === false` meant
 * BOTH "we asked and you are not an admin" and "we could not ask". So a real
 * admin on a slow connection — anything that pushed the `user_roles` read past
 * the hook's 10s timeout — was silently redirected to /dashboard, with nothing
 * on screen to say a lookup had failed and no way to retry short of a reload
 * that would race the same timeout again. Reproduced against prod on
 * 2026-08-31 with the role row present and the response body confirmed
 * `[{"role":"admin"}]`. Two lanes lost the admin surfaces to exactly this.
 *
 * The privilege check is NOT weakened by the fix. `unknown` grants nothing —
 * it renders a retry card, which is a *denial* with an explanation, not an
 * admission. Only a CONFIRMED `admin` renders `children`; a confirmed
 * `not_admin` still redirects, because for them the redirect is correct and a
 * "we couldn't verify" card would be a lie in the other direction.
 */
const AdminRoute = ({ children }: AdminRouteProps) => {
  const { adminStatus, isLoading, refresh } = useCurrentUser();
  const [retrying, setRetrying] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // AR-012 (lh-authz-rls 2026-09-04): this used to call report() directly in
  // the render body. React can render a component multiple times for one
  // commit (StrictMode double-invoke, a state update during render from a
  // sibling, etc.), and errorLogger batches same-tick calls into one INSERT
  // (src/lib/errorLogger.ts) — so `error_logs` showed 2 rows per incident
  // with identical microsecond timestamps, inflating any alert threshold on
  // this signal. Effect + dependency array reports exactly once per actual
  // transition into "unknown". `location.search` is included so the `?view=`
  // being opened is recoverable from the log — previously only `pathname`
  // was recorded, which is why a locked-out admin's exact destination
  // couldn't be reconstructed after the fact.
  useEffect(() => {
    if (adminStatus !== "unknown") return;
    report(new Error("AdminRoute: admin role indeterminate (access denied, retryable)"), {
      severity: "warning",
      tags: { source: "AdminRoute.adminStatusUnknown" },
      context: { path: location.pathname, search: location.search },
    });
  }, [adminStatus, location.pathname, location.search]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
        <HelprSpinner size={36} />
      </div>
    );
  }

  // Could not determine the role. Deny access — but say so, and offer the
  // retry, instead of bouncing an admin to /dashboard as if we had checked.
  if (adminStatus === "unknown") {
    // Reporting moved to the effect above (AR-012) — this branch only renders.
    return (
      <div className="min-h-screen flex bg-premium-page">
        <ErrorState
          eyebrow="Hiccup on our end"
          title="We couldn't verify your access."
          body="Your admin role didn't come back this time — you're still signed in. Tap Try again."
          retryDisabled={retrying}
          retryLabel={retrying ? "Trying again…" : "Try again"}
          onRetry={() => {
            setRetrying(true);
            void refresh().finally(() => setRetrying(false));
          }}
          secondaryAction={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/dashboard")}
              className="text-ds-13"
            >
              Go to dashboard
            </Button>
          }
        />
      </div>
    );
  }

  // Confirmed non-admin. The redirect is still the right answer here.
  if (adminStatus !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
