import React from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router";

const Home: React.FC = () => {
  return (
    <>
      <Helmet>
        <title>Home - Unirend SSR Demo</title>
        <meta
          name="description"
          content="Welcome to the Unirend SSR demo homepage"
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
          <h2>🧪 Test Route Error Boundary</h2>
          <p>
            Test the custom error boundary system with client-side navigation:
          </p>
          <div
            style={{
              display: "flex",
              gap: "1rem",
              marginTop: "1rem",
              justifyContent: "center",
            }}
          >
            <Link
              to="/nonexistent-page"
              style={{
                display: "inline-block",
                padding: "0.75rem 1.5rem",
                backgroundColor: "#ff6b6b",
                color: "white",
                textDecoration: "none",
                borderRadius: "0.5rem",
                fontWeight: "500",
                transition: "background-color 0.2s",
              }}
            >
              Test 404 Error
            </Link>
            <Link
              to="/test-error-thrown"
              style={{
                display: "inline-block",
                padding: "0.75rem 1.5rem",
                backgroundColor: "#ffa500",
                color: "white",
                textDecoration: "none",
                borderRadius: "0.5rem",
                fontWeight: "500",
                transition: "background-color 0.2s",
              }}
            >
              Test Application Error
            </Link>
          </div>
          <p
            style={{
              fontSize: "0.875rem",
              color: "rgba(255, 255, 255, 0.8)",
              marginTop: "0.5rem",
              textAlign: "center",
            }}
          >
            These links use client-side navigation to test error boundaries.
          </p>
        </div>
      </main>
    </>
  );
};

export default Home;
