import { useEffect } from 'react';
import { UnirendHead, useIsDevelopment } from '../../../../src/client';

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
