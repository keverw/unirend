import React from 'react';
import { UnirendHead } from '../../../../src/client';

const Home: React.FC = () => {
  return (
    <>
      <UnirendHead>
        <title>Home - Unirend SSG Demo</title>
        <meta
          name="description"
          content="Welcome to the Unirend SSG demo homepage"
        />
      </UnirendHead>
      <main className="main-content">
        <div className="hero">
          <h1>Welcome to Unirend SSG Demo</h1>
          <p className="hero-subtitle">
            This demo shows how to use custom providers with the rootProviders
            option. Try the theme toggle in the header to see it in action!
          </p>
        </div>

        <div className="card">
          <h2>✨ Key Features</h2>
          <ul>
            <li>React Router for seamless client-side routing</li>
            <li>UnirendHead for built-in SEO meta management</li>
            <li>Vite for lightning-fast development and building</li>
            <li>Full TypeScript support out of the box</li>
            <li>Modern build tooling and optimizations</li>
            <li>Unified approach to SSG and SSR</li>
            <li>🎨 Custom providers via rootProviders option</li>
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
    </>
  );
};

export default Home;
