import { UnirendHead } from '../../../../../src/client';

interface NotFoundProps {
  error?: unknown;
}

export function NotFound({ error: _error }: NotFoundProps) {
  return (
    <>
      <UnirendHead>
        <title>404 - Page Not Found | App B</title>
        <meta
          name="description"
          content="The page you are looking for does not exist."
        />
      </UnirendHead>
      <main className="main-content">
        <h1 className="page-title">404</h1>
        <p className="page-subtitle">This page doesn't exist.</p>
        <a href="/" className="btn">
          Back to Dashboard
        </a>
      </main>
    </>
  );
}
