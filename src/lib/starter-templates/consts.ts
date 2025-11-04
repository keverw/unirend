// Constants for starter templates and monorepo config

export const STARTER_TEMPLATES: Record<
  string,
  { templateID: string; name: string; description: string }
> = {
  ssg: {
    templateID: "ssg",
    name: "Static Site Generation (SSG)",
    description:
      "Pre-rendered static site with React Router and Vite build system",
  },
  ssr: {
    templateID: "ssr",
    name: "Server-Side Rendering (SSR)",
    description:
      "Full-stack React app with server-side rendering, API routes, and plugin support",
  },
  api: {
    templateID: "api",
    name: "API Server",
    description: "Standalone JSON API server with WebSocket and plugin support",
  },
};

export const MONOREPO_CONFIG_FILE = "unirend-monorepo.json";
export const DEFAULT_MONOREPO_NAME = "unirend-project-monorepo";
