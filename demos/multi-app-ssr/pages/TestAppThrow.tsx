// This component throws during render on purpose.
// Server-side: the SSR render fails and get500ErrorPage is returned as raw HTML.
// Client-side (if reached via client nav): React Router's RouteErrorBoundary catches it.
// Use <a href> links to this route (not <Link>) to always force a server round-trip.
export default function TestAppThrow(): never {
  throw new Error(
    'Intentional SSR crash — thrown inside the component during render to demonstrate get500ErrorPage.',
  );
}
