import React from "react";
import { Helmet } from "react-helmet-async";
import { useTheme } from "../providers/ThemeProvider";
import { Header } from "../components/Header";

const Home: React.FC = () => {
  const { theme } = useTheme();

  return (
    <>
      <Helmet>
        <title>Home - Unirend SSG Demo</title>
        <meta
          name="description"
          content="Welcome to the Unirend SSG demo homepage"
        />
      </Helmet>

      <Header />

      <main className="main-content">
        <div className="hero">
          <h1>Welcome to Unirend SSG Demo</h1>
          <p className="hero-subtitle">
            This demo shows how to use custom providers with the wrapApp option.
            Try the theme toggle in the header to see it in action! Current
            theme: <strong>{theme}</strong>
          </p>
        </div>

        <div className="card">
          <h2>✨ Key Features</h2>
          <ul>
            <li>React Router for seamless client-side routing</li>
            <li>React Helmet for powerful SEO meta management</li>
            <li>Vite for lightning-fast development and building</li>
            <li>Full TypeScript support out of the box</li>
            <li>Modern build tooling and optimizations</li>
            <li>Unified approach to SSG and SSR</li>
            <li>🎨 Custom providers via wrapApp option</li>
          </ul>
        </div>

        <div className="card">
          <h2>🚀 Get Started</h2>
          <p>
            Ready to build amazing static sites? Check out our framework
            capabilities and start creating today!
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
