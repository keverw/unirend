import React from "react";
import { Link } from "react-router";
import { Helmet } from "react-helmet-async";

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

      <header className="header">
        <div className="header-content">
          <Link to="/" className="logo">
            Unirend
          </Link>
          <nav>
            <ul className="nav">
              <li>
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/about">About</Link>
              </li>
              <li>
                <Link to="/contact">Contact</Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>

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
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p>Built with ❤️ and modern web technologies</p>
        </div>
      </footer>
    </>
  );
};

export default Home;
