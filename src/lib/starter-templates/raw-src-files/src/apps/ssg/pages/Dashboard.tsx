import { useState } from 'react';

// This page is rendered as a SPA (Single Page Application) page because it is registered
// as { type: 'spa', filename: 'dashboard.html', ... } in generate-ssg.ts.
//
// That registration is what determines the rendering mode — not anything in this component.
// The static server serves a minimal HTML shell with no pre-rendered content, and React
// renders everything on the client.
//
// Contrast with SSG pages (like Home), which are registered as { type: 'ssg', path: '/', ... }
// and are fully pre-rendered to HTML at build time, then hydrated on the client.
//
// SPA pages are useful for:
//  - Authenticated areas (content that differs per user)
//  - Dashboards with real-time or personalized data
//  - Any page where pre-rendering would be wasteful or impossible

export function Dashboard() {
  // Lazy initializer — runs once on first render.
  // Since this is a SPA page, it only ever runs on the client.
  const [renderTime] = useState(() => new Date().toLocaleTimeString());

  return (
    <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
      <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
        Dashboard (SPA)
      </h1>

      <p className="mb-4 text-gray-600 dark:text-gray-400">
        This page is a <strong>client-rendered SPA page</strong>. The server
        serves a minimal HTML shell with no pre-rendered content. React takes
        over entirely on the client.
      </p>

      <p className="mb-4 text-gray-600 dark:text-gray-400">
        <strong>Rendered at:</strong> {renderTime}
      </p>

      <p className="mb-4 text-gray-600 dark:text-gray-400">
        Because this page is SPA-mode, the timestamp above is always set on the
        client, so it will never appear in the static HTML source. View the page
        source to confirm: you will see the empty shell, not this content.
      </p>

      <p className="text-gray-600 dark:text-gray-400">
        The title and meta description for this page were set in{' '}
        <code>generate-ssg.ts</code> as static options on the SPA page
        definition, not rendered by a React component.
      </p>
    </div>
  );
}
