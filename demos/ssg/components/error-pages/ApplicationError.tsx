import { useEffect } from 'react';
import { UnirendHead } from '../../../../src/client';
import { getDevMode } from 'lifecycleion/dev-mode';

interface ApplicationErrorProps {
  error: unknown;
}

export default function ApplicationError({ error }: ApplicationErrorProps) {
  const errorMessage =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  const isDevelopment = getDevMode();

  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: 'instant',
    });
  }, []);

  return (
    <>
      <UnirendHead>
        <title>500 - Application Error | Unirend SSG Demo</title>
      </UnirendHead>
      <main className="main-content">
        <div className="card" style={{ maxWidth: '720px', margin: '0 auto' }}>
          <h1 className="hero-title">Application Error</h1>
          <p className="hero-subtitle">
            The app encountered an unexpected error while rendering this route.
          </p>

          {isDevelopment && (
            <pre
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.875rem',
                overflow: 'auto',
                padding: '1rem',
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
              }}
            >
              {errorMessage}
              {error instanceof Error && error.stack
                ? `\n\n${error.stack}`
                : ''}
            </pre>
          )}
        </div>
      </main>
    </>
  );
}
