import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNative } from "./lib/nativeInit";

createRoot(document.getElementById("root")!).render(<App />);

// Fire-and-forget native setup (status bar, splash hide). Web = no-op.
initNative();
