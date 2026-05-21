import { useEffect } from 'react';
import { UnirendHead } from '../../../../src/client';
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
        <title>Error | Multi-App SSR Demo</title>
      </UnirendHead>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div
          className="card"
          style={{ maxWidth: '560px', width: '100%', textAlign: 'center' }}
        >
          <h1 style={{ fontSize: '2rem', margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>
          <p>An unexpected error occurred while rendering this page.</p>
          {isDev && (
            <pre style={{ textAlign: 'left', marginTop: '1rem' }}>
              {message}
            </pre>
          )}
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'center',
              marginTop: '1.5rem',
            }}
          >
            <button className="btn" onClick={() => window.location.reload()}>
              Try Again
            </button>
            <a href="/" className="btn">
              Go Home
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
