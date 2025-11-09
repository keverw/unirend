import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router';
import { useFrontendAppConfig } from '../../../../src/client';

const Home: React.FC = () => {
  const frontendAppConfig = useFrontendAppConfig();

  return (
    <>
      <Helmet>
        <title>Home - Unirend SSR Demo</title>
        <meta
          name="description"
          content="Welcome to the Unirend SSR demo showcasing server-side rendering capabilities"
        />
      </Helmet>

      <main className="main-content">
        <h1 className="hero-title">Welcome to Unirend</h1>
        <p className="hero-subtitle">
          A modern SSG/SSR framework built with Vite and React. Experience
          blazing-fast development with powerful server-side rendering
          capabilities.
        </p>

        <div className="card">
          <h2>✨ Key Features</h2>
          <ul>
            <li>React Router for seamless client-side routing</li>
            <li>React Helmet for powerful SEO meta management</li>
            <li>Vite for lightning-fast development and building</li>
            <li>Full TypeScript support out of the box</li>
            <li>Modern build tooling and optimizations</li>
            <li>Unified approach to SSG and SSR</li>
          </ul>
        </div>

        <div className="card">
          <h2>🚀 Get Started</h2>
          <p>
            Ready to build amazing server-rendered applications? Check out our
            framework capabilities and start creating today!
          </p>
        </div>

        <div className="card">
          <h2>⚙️ Frontend App Config</h2>
          <p>
            This demonstrates <code>frontendAppConfig</code> working in both dev
            and prod modes:
          </p>
          {frontendAppConfig ? (
            <pre
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                padding: '1rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                overflow: 'auto',
                textAlign: 'left',
                marginTop: '1rem',
              }}
            >
              {JSON.stringify(frontendAppConfig, null, 2)}
            </pre>
          ) : (
            <p style={{ color: 'rgba(255, 255, 255, 0.7)', marginTop: '1rem' }}>
              No config injected (running in SPA-only Vite dev mode)
            </p>
          )}
        </div>

        <div className="card">
          <h2>🧪 Test Route Error Boundary</h2>
          <p>
            Test the custom error boundary system with client-side navigation:
          </p>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              marginTop: '1rem',
              justifyContent: 'center',
            }}
          >
            <Link to="/nonexistent-page" className="demo-button btn-coral">
              Test 404 Error
            </Link>
            <Link to="/test-error-thrown" className="demo-button btn-orange">
              Test Application Error (Thrown to Trigger Error Boundary)
            </Link>
          </div>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'rgba(255, 255, 255, 0.8)',
              marginTop: '0.5rem',
              textAlign: 'center',
            }}
          >
            These links use client-side navigation to test error boundaries.
          </p>
        </div>

        <div className="card">
          <h2>📊 Test Page Data Loaders</h2>
          <p>
            Test the page data loader system with debug information display:
          </p>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              marginTop: '1rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Link to="/test-page-loader" className="demo-button btn-teal">
              Basic Page Loader
            </Link>
            <Link to="/test-page-loader/123" className="demo-button btn-blue">
              With ID Parameter
            </Link>
            <Link
              to="/test-page-loader/456?search=demo&filter=active"
              className="demo-button btn-green"
            >
              With ID + Query Params
            </Link>
            <Link to="/test-local-loader" className="demo-button btn-purple">
              Local Page Loader (no HTTP)
            </Link>
            <Link
              to="/test-local-loader-throws"
              className="demo-button btn-purple"
            >
              Local Loader That Throws
            </Link>
            <Link to="/test-local-nonstd" className="demo-button btn-gray">
              Local Loader (418 Teapot)
            </Link>
          </div>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'rgba(255, 255, 255, 0.8)',
              marginTop: '0.5rem',
              textAlign: 'center',
            }}
          >
            These routes demonstrate page data loading with different parameter
            combinations.
          </p>
        </div>

        {/* Error Handling Demo Section */}
        <div className="card">
          <h2 style={{ color: '#ff6b6b', marginBottom: '1rem' }}>
            🚨 Error Handling Tests
          </h2>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}
          >
            <Link to="/test-500" className="demo-button btn-red">
              500 Error (From API server directly, if already loaded will inline
              the error as a generic one, else will show app error like if it
              was by the boundary)
            </Link>
            <Link to="/test-stacktrace" className="demo-button btn-orange-alt">
              Error with Stacktrace
            </Link>
            <Link to="/test-generic-error" className="demo-button btn-yellow">
              Generic Error (400)
            </Link>
          </div>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'rgba(255, 255, 255, 0.8)',
              marginTop: '0.5rem',
              textAlign: 'center',
            }}
          >
            These routes demonstrate error handling with different error types
            and status codes.
          </p>
        </div>
      </main>
    </>
  );
};

export default Home;
