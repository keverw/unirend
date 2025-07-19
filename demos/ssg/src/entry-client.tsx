import { mountApp } from "../../../src/lib/mountApp";
import { ThemeProvider } from "./providers/ThemeProvider";
import "./index.css";

// Import shared routes
import { routes } from "./routes";

// Mount the app with ThemeProvider
const result = mountApp("root", routes, {
  wrapProviders: ThemeProvider,
});

if (result === "hydrated") {
  console.log("✅ Hydrated SSR/SSG content");
} else if (result === "rendered") {
  console.log("✅ Rendered as SPA");
} else {
  console.error("❌ Container not found");
}
