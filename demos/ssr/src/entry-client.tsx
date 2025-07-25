import { mountApp } from "../../../src/client";
import "./index.css";

// Import shared routes
import { routes } from "./routes";

// Mount the app and log the result
const result = mountApp("root", routes);

if (result === "hydrated") {
  console.log("✅ Hydrated SSR/SSG content");
} else if (result === "rendered") {
  console.log("✅ Rendered as SPA");
} else {
  console.error("❌ Container not found");
}
