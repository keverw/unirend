import { Link } from 'react-router';
import { UnirendHead, usePublicAppConfig } from '../../../src/client';

export default function Home() {
  const config = usePublicAppConfig() as {
    appName?: string;
    appKey?: string;
    accentColor?: string;
  } | null;

  return (
    <>
      <UnirendHead>
        <title>{config?.appName ?? 'App A'} | Multi-App SSR Demo</title>
        <meta
          name="description"
          content="Unirend multi-app SSR demo — cookie-based routing between independently-built React apps"
        />
      </UnirendHead>

      <main className="main-content">
        <h1 className="hero-title">You are on {config?.appName ?? 'App A'}</h1>
        <p className="hero-subtitle">
          Use the <strong>Switch app</strong> dropdown in the header to switch
          between apps. Each app is a separate Vite bundle served by the same
          SSR server process, routed by a cookie.
        </p>

        <div className="card">
          <h2>How it works</h2>
          <p>
            The server reads a <code>selected_app</code> cookie on every request
            and calls <code>request.setActiveSSRApp()</code> to select the
            matching app. Each app has its own HTML template, client bundle,
            server entry, and <code>publicAppConfig</code>.
          </p>
          <p>
            Switching to <strong>App C</strong> sets a cookie for an app key
            that is not registered on the server. The server catches the
            resulting error and returns a raw 500 HTML page with a button to
            clear the cookie and return here.
          </p>
        </div>

        <div className="card">
          <h2>Real-world use cases</h2>
          <p>
            Multi-app SSR is useful when you want shared server infrastructure
            without running a separate process per app. Common examples:
          </p>
          <p>
            <strong>SaaS products</strong> — serve a public marketing site and
            the authenticated dashboard workspace from one server. Auth plugins,
            API handlers, and rate limiting register once and apply to all apps.
          </p>
          <p>
            <strong>Multiple customer sites</strong> — host several
            independently-branded frontends on the same backend. Shared concerns
            (auth, analytics, logging) live in server plugins. Per-app concerns
            (UI bundle, public config, CDN URL) are isolated per app
            registration.
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
              marginTop: '1rem',
              textAlign: 'left',
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
              <p
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  color: 'rgba(255,255,255,0.7)',
                }}
              >
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
              <p
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  color: 'rgba(255,255,255,0.7)',
                }}
              >
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
            <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: '0.75rem' }}>
              No config injected — running in SPA-only Vite dev mode
            </p>
          )}
        </div>
      </main>
    </>
  );
}
