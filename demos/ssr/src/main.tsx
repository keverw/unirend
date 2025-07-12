import { createBrowserRouter } from "react-router";
import { mountApp } from "../../../src";
import "./index.css";

// Import shared routes
import { routes } from "./routes";

// Create the router instance (used by client-side)
const router = createBrowserRouter(routes);

// Mount the app and log the result
const result = mountApp("root", router);

if (result === "hydrated") {
  console.log("✅ Hydrated SSR/SSG content");
} else if (result === "rendered") {
  console.log("✅ Rendered as SPA");
} else {
  console.error("❌ Container not found");
}
