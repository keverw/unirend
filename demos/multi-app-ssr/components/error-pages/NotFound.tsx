import { UnirendHead } from '../../../../src/client';

interface NotFoundProps {
  error?: unknown;
}

export function NotFound({ error: _error }: NotFoundProps) {
  return (
    <>
      <UnirendHead>
        <title>404 - Page Not Found | Multi-App SSR Demo</title>
        <meta
          name="description"
          content="The page you are looking for does not exist."
        />
      </UnirendHead>
      <main
        className="main-content"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="card" style={{ textAlign: 'center' }}>
          <h1
            style={{ fontSize: '4rem', fontWeight: 800, margin: '0 0 0.5rem' }}
          >
            404
          </h1>
          <h2 style={{ margin: '0 0 1rem' }}>Page Not Found</h2>
          <p>The page you're looking for doesn't exist.</p>
          <a
            href="/"
            className="btn"
            style={{ marginTop: '1.5rem', display: 'inline-block' }}
          >
            Go Home
          </a>
        </div>
      </main>
    </>
  );
}
