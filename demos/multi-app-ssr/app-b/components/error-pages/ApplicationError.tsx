import { useEffect } from 'react';
import { UnirendHead, useIsDevelopment } from '../../../../../src/client';

interface ApplicationErrorProps {
  error: unknown;
}

export function ApplicationError({ error }: ApplicationErrorProps) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  const isDevelopment = useIsDevelopment();

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
        {isDevelopment && (
          <div
            style={{
              marginBottom: '2rem',
              marginTop: '1.5rem',
              textAlign: 'left',
            }}
          >
            <h3
              style={{
                fontWeight: '600',
                marginBottom: '0.5rem',
                fontSize: '1.1rem',
              }}
            >
              Development Error Details:
            </h3>
            <div
              style={{
                fontSize: '0.9rem',
                color: '#e2e8f0',
                fontFamily: 'monospace',
                background: '#0f172a',
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid #1e293b',
                overflowX: 'auto',
                maxHeight: '250px',
                overflowY: 'auto',
              }}
            >
              {message}
              {error instanceof Error && error.stack && (
                <pre
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.8rem',
                    color: '#94a3b8',
                    whiteSpace: 'pre-wrap',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    margin: 0,
                  }}
                >
                  {error.stack}
                </pre>
              )}
            </div>
          </div>
        )}
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
