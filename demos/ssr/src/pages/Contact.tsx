import React from "react";
import { Link } from "react-router";
import { Helmet } from "react-helmet-async";

const Contact: React.FC = () => {
  return (
    <>
      <Helmet>
        <title>Contact - Unirend SSR Demo</title>
        <meta name="description" content="Get in touch with the Unirend team" />
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
        <h1 className="hero-title">Get in Touch</h1>
        <p className="hero-subtitle">
          Have questions about Unirend? Want to contribute? We'd love to hear
          from you and help you get started.
        </p>

        <div className="card">
          <h2>🚀 GitHub Repository</h2>
          <p>
            Find our source code, report issues, or contribute to the project on
            GitHub.
          </p>
          <p>
            <a
              href="https://github.com/keverw/unirend"
              target="_blank"
              rel="noopener noreferrer"
            >
              🔗 github.com/keverw/unirend
            </a>
          </p>
        </div>

        <div className="card">
          <h2>💬 Community</h2>
          <ul>
            <li>🐛 Report bugs and request features via GitHub Issues</li>
            <li>💡 Join discussions and share ideas</li>
            <li>🤝 Contribute code and documentation</li>
            <li>📚 Help improve our documentation</li>
            <li>🌟 Star the project to show your support</li>
          </ul>
        </div>

        <div className="card">
          <h2>🛠️ Contributing</h2>
          <p>
            We welcome contributions of all kinds! Whether it's bug fixes, new
            features, documentation improvements, or just feedback - every
            contribution helps make Unirend better for everyone.
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

export default Contact;
