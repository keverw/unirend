import { mountApp } from "../../../src";
import { ThemeProvider } from "./providers/ThemeProvider";
import "./index.css";

// Import shared routes
import { routes } from "./routes";

// Custom wrapper function to add ThemeProvider
const wrapWithTheme = (node: React.ReactNode) => (
  <ThemeProvider>{node}</ThemeProvider>
);

// Mount the app with custom provider and log the result
const result = mountApp("root", routes, { wrapApp: wrapWithTheme });

if (result === "hydrated") {
  console.log("✅ Hydrated SSR/SSG content");
} else if (result === "rendered") {
  console.log("✅ Rendered as SPA");
} else {
  console.error("❌ Container not found");
}
