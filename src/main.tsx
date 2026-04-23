import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNative } from "./lib/nativeInit";
import { installGlobalErrorHandlers } from "./lib/errorLogger";
import { initShakeToReport } from "./lib/shakeToReport";
import { initPostHog, identifyUser, resetUser } from "./lib/posthog";
import { supabase } from "./integrations/supabase/client";

// Catch unhandled errors + promise rejections and ship to error_logs.
installGlobalErrorHandlers();

// Product analytics. Loads the PostHog SDK and starts capturing pageviews.
initPostHog();

// Tie analytics identity to Supabase auth state so events attribute correctly.
supabase.auth.getSession().then(({ data }) => {
  if (data.session?.user) {
    identifyUser(data.session.user.id, { email: data.session.user.email });
  }
});
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session?.user) {
    identifyUser(session.user.id, { email: session.user.email });
  } else if (event === "SIGNED_OUT") {
    resetUser();
  }
});

createRoot(document.getElementById("root")!).render(<App />);

// Fire-and-forget native setup (status bar, splash hide). Web = no-op.
initNative();

// Shake-to-report: navigate to support pre-tagged as a bug report.
// Works on iOS/Android via DeviceMotion; silent no-op when unsupported.
initShakeToReport(() => {
  if (typeof window !== "undefined") {
    window.location.href = "/support?from=shake";
  }
});
