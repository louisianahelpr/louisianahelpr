import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNative } from "./lib/nativeInit";
import { installGlobalErrorHandlers } from "./lib/errorLogger";

// Catch unhandled errors + promise rejections and ship to error_logs.
installGlobalErrorHandlers();

createRoot(document.getElementById("root")!).render(<App />);

// Fire-and-forget native setup (status bar, splash hide). Web = no-op.
initNative();
