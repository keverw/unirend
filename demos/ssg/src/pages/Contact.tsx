import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';

const Contact: React.FC = () => {
  return (
    <>
      <Helmet>
        <title>Contact - Unirend SSG Demo</title>
        <meta name="description" content="Get in touch with the Unirend team" />
      </Helmet>

      <Header />

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
