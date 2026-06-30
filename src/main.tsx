// i18n must initialize before anything renders so the cached language is
// active from the first paint (no English flash for Bulgarian users).
import "@/i18n";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
