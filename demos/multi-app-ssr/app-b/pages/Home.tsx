import { Link } from 'react-router';
import { UnirendHead, usePublicAppConfig } from '../../../../src/client';

export function Home() {
  const config = usePublicAppConfig() as {
    appName?: string;
    appKey?: string;
    accentColor?: string;
  } | null;

  return (
    <>
      <UnirendHead>
        <title>Dashboard | {config?.appName ?? 'App B'}</title>
        <meta
          name="description"
          content="App B workspace — multi-app SSR demo"
        />
      </UnirendHead>

      <main className="main-content">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          You are on <strong>{config?.appName ?? 'App B'}</strong>. Notice the
          sidebar layout, serif font, and flat card style — this is a completely
          different component tree and CSS bundle from App A, served by the same
          SSR process.
        </p>

        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Active Apps</div>
            <div className="stat-value">2</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Server Processes</div>
            <div className="stat-value">1</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Shared Plugins</div>
            <div className="stat-value">3</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Cookie Routing</div>
            <div className="stat-value">On</div>
          </div>
        </div>

        <div className="card">
          <h2>What's different here</h2>
          <p>
            App B uses a <strong>sidebar layout</strong> instead of a top
            header, a <strong>serif font</strong> instead of sans-serif,{' '}
            <strong>flat bordered cards</strong> on a light background instead
            of App A's gradient + glassmorphism, and a{' '}
            <strong>dashboard-style home page</strong> instead of a marketing
            hero layout.
          </p>
          <p>
            These aren't theme variables — they're different HTML structure,
            different CSS files, different component trees. Each app is built by
            its own Vite config into a separate output directory.
          </p>
        </div>

        <div className="card">
          <h2>Test error paths</h2>
          <p>
            Both buttons hit the same route — a component that throws during
            render. The path taken depends on how you get there:
          </p>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              marginTop: '0.75rem',
            }}
          >
            <div>
              <a
                href="/test-app-throw"
                className="btn"
                style={{ display: 'inline-block', marginBottom: '0.4rem' }}
              >
                Hard link — SSR crash
              </a>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                Full page request → server renders the component → it throws →
                SSR catches it → returns raw <code>get500ErrorPage</code> HTML
                (outside React entirely).
              </p>
            </div>
            <div>
              <Link
                to="/test-app-throw"
                className="btn"
                style={{ display: 'inline-block', marginBottom: '0.4rem' }}
              >
                Client nav — error boundary
              </Link>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                Client-side navigation after hydration → React renders the
                component in the browser → it throws → React Router's{' '}
                <code>RouteErrorBoundary</code> catches it → renders the{' '}
                <code>ApplicationError</code> component.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Public app config (this app)</h2>
          {config ? (
            <pre>{JSON.stringify(config, null, 2)}</pre>
          ) : (
            <p style={{ color: '#94a3b8', marginTop: '0.75rem' }}>
              No config injected — running in SPA-only Vite dev mode
            </p>
          )}
        </div>
      </main>
    </>
  );
}
