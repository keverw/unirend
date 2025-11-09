import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

interface CustomApplicationErrorProps {
  error: unknown;
}

/**
 * Custom application error component for the SSR demo
 * This shows how to create a branded error page that's standalone (not wrapped in AppLayout)
 */
export default function CustomApplicationError({
  error,
}: CustomApplicationErrorProps) {
  const errorMessage =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Scroll to top when error component mounts
  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: 'instant',
    });
  }, []);

  return (
    <>
      <Helmet>
        <title>500 - Application Error | Unirend SSR Demo</title>
      </Helmet>
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div
              style={{
                width: '80px',
                height: '80px',
                background: 'rgba(255, 255, 255, 0.2)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.5rem auto',
                fontSize: '2.5rem',
              }}
            >
              💥
            </div>
            <h1
              style={{
                fontSize: '2.5rem',
                fontWeight: '800',
                margin: '0 0 1rem 0',
                color: '#ffffff',
              }}
            >
              Oops! Something went wrong
            </h1>
            <p
              style={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '1.1rem',
                marginBottom: '2rem',
              }}
            >
              We're sorry, but our app encountered an unexpected error. Our team
              has been notified and we're working on a fix.
            </p>
          </div>

          {isDevelopment && (
            <div style={{ marginBottom: '2rem' }}>
              <h3
                style={{
                  fontWeight: '600',
                  color: '#ffffff',
                  marginBottom: '1rem',
                }}
              >
                Development Error Details:
              </h3>
              <div
                style={{
                  fontSize: '0.9rem',
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontFamily: 'monospace',
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  overflowX: 'auto',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}
              >
                {errorMessage}
                {error instanceof Error && error.stack && (
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      fontSize: '0.8rem',
                      color: 'rgba(255, 255, 255, 0.7)',
                      whiteSpace: 'pre-wrap',
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
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={() => window.location.reload()}
              style={{
                display: 'inline-block',
                padding: '0.75rem 1.5rem',
                background: 'rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '1rem',
                transition: 'all 0.3s ease',
                border: '1px solid rgba(255, 255, 255, 0.3)',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              🔄 Try Again
            </button>

            <a
              href="/"
              style={{
                display: 'inline-block',
                padding: '0.75rem 1.5rem',
                background: 'transparent',
                color: 'rgba(255, 255, 255, 0.9)',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: '500',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                transition: 'all 0.3s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
              }}
            >
              🏠 Go Home
            </a>
          </div>

          <div
            style={{
              marginTop: '2rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.2)',
              textAlign: 'center',
              fontSize: '0.9rem',
              color: 'rgba(255, 255, 255, 0.8)',
            }}
          >
            <p>
              If this problem persists, please{' '}
              <a
                href="/contact"
                style={{
                  color: 'rgba(255, 255, 255, 0.9)',
                  textDecoration: 'underline',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
                }}
              >
                contact our support team
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
