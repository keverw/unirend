import { useEffect } from 'react';
import { UnirendHead } from '../../../../../src/client';
import { getDevMode } from 'lifecycleion/dev-mode';

interface ApplicationErrorProps {
  error: unknown;
}

export default function ApplicationError({ error }: ApplicationErrorProps) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  const isDev = getDevMode();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <>
      <UnirendHead>
        <title>Error | App B</title>
      </UnirendHead>
      <main className="main-content">
        <h1 className="page-title">Something went wrong</h1>
        <p className="page-subtitle">
          An unexpected error occurred while rendering this page.
        </p>
        {isDev && <pre>{message}</pre>}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button className="btn" onClick={() => window.location.reload()}>
            Try Again
          </button>
          <a href="/" className="btn">
            Back to Dashboard
          </a>
        </div>
      </main>
    </>
  );
}
