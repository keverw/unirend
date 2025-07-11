import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

/**
 * Result type indicating how the app was mounted
 * - "hydrated": App was hydrated over existing SSR/SSG content
 * - "rendered": App was rendered fresh (SPA mode)
 * - "not_found": Container element was not found in the DOM
 */
export type MountAppResult = "hydrated" | "rendered" | "not_found";

/**
 * Intelligently mounts a React app by detecting whether to hydrate or render.
 *
 * This function provides a unified API for mounting React apps that works seamlessly
 * across different rendering contexts:
 * - SSR/SSG: Hydrates pre-rendered HTML content
 * - SPA: Creates a fresh root and renders the app
 *
 * The detection is based on whether the container already has child elements,
 * which indicates pre-rendered content that should be hydrated rather than replaced.
 *
 * @param containerId - The ID of the root DOM element (e.g., "root", "app")
 * @param appElement - Your complete React app element, including providers, router, etc.
 * @returns MountAppResult indicating the mounting strategy used or if it failed
 *
 * @example
 * ```typescript
 * import { mountApp } from 'unirend';
 * import App from './App';
 *
 * const result = mountApp('root', <App />);
 *
 * if (result === 'hydrated') {
 *   console.log('Hydrated SSR content');
 * } else if (result === 'rendered') {
 *   console.log('Rendered as SPA');
 * } else {
 *   console.error('Failed to mount app');
 * }
 * ```
 */
export function mountApp(
  containerId: string,
  appElement: React.ReactElement,
): MountAppResult {
  // Attempt to find the container element in the DOM
  const container = document.getElementById(containerId);

  // Early return if container doesn't exist
  if (!container) {
    console.error(`[Unirend] Container with id "${containerId}" not found.`);
    return "not_found";
  }

  // Check if container has existing content (indicates SSR/SSG)
  // firstElementChild is more reliable than innerHTML for detecting pre-rendered content
  if (container.firstElementChild) {
    // Container has existing elements - this is likely SSR/SSG content
    // Use hydrateRoot to preserve the existing DOM and attach React event handlers
    hydrateRoot(container, appElement);

    return "hydrated";
  } else {
    // Container is empty - this is SPA mode or development
    // Use createRoot to render the app from scratch
    const root = createRoot(container);
    root.render(appElement);

    return "rendered";
  }
}
