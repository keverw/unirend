import React from "react";
import { Helmet } from "react-helmet-async";
import { Header } from "../components/Header";

const About: React.FC = () => {
  return (
    <>
      <Helmet>
        <title>About - Unirend SSG Demo</title>
        <meta
          name="description"
          content="Learn about the Unirend framework and this demo"
        />
      </Helmet>

      <Header />

      <main className="main-content">
        <h1 className="hero-title">About Unirend</h1>
        <p className="hero-subtitle">
          Discover the power of modern web development with our lightweight
          toolkit designed for both Static Site Generation and Server-Side
          Rendering.
        </p>

        <div className="card">
          <h2>🎯 Our Mission</h2>
          <p>
            Unirend bridges the gap between static site generation and
            server-side rendering, providing developers with a unified, powerful
            toolkit built on modern web standards.
          </p>
        </div>

        <div className="card">
          <h2>💎 Key Benefits</h2>
          <ul>
            <li>Unified approach to SSG and SSR workflows</li>
            <li>Built on top of Vite for lightning-fast development</li>
            <li>Seamless React ecosystem compatibility</li>
            <li>TypeScript-first development experience</li>
            <li>Zero-config setup with sensible defaults</li>
            <li>Optimized production builds</li>
          </ul>
        </div>

        <div className="card">
          <h2>🏗️ Architecture</h2>
          <p>
            Unirend leverages the best of modern web development tools,
            combining Vite's incredible development experience with React's
            component model and adding powerful static generation capabilities
            on top.
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

export default About;
