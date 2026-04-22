import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNative } from "./lib/nativeInit";
import { installGlobalErrorHandlers } from "./lib/errorLogger";
import { initShakeToReport } from "./lib/shakeToReport";

// Catch unhandled errors + promise rejections and ship to error_logs.
installGlobalErrorHandlers();

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
