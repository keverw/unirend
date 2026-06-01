// Constants for starter templates and repository config

/**
 * Canonical list of template IDs. The `TemplateID` union is derived from this
 * so adding/removing a template requires only one edit; the `STARTER_TEMPLATES`
 * record below must then provide a matching entry.
 */
export const TEMPLATE_IDS = ['ssg', 'ssr', 'api'] as const;

export type TemplateID = (typeof TEMPLATE_IDS)[number];

export const STARTER_TEMPLATES: Record<
  TemplateID,
  { templateID: TemplateID; name: string; description: string }
> = {
  ssg: {
    templateID: 'ssg',
    name: 'Static Site Generation (SSG)',
    description:
      'Pre-rendered static site with React Router and Vite build system',
  },
  ssr: {
    templateID: 'ssr',
    name: 'Server-Side Rendering (SSR)',
    description:
      'Full-stack React app with server-side rendering, API routes, and plugin support',
  },
  api: {
    templateID: 'api',
    name: 'API Server',
    description: 'Standalone JSON API server with WebSocket and plugin support',
  },
};

export const REPO_CONFIG_FILE = 'unirend-repo.json';
export const DEFAULT_REPO_NAME = 'unirend-projects';
