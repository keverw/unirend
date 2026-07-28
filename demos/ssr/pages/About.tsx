import { UnirendHead } from '../../../src/client';

export function About() {
  return (
    <>
      <UnirendHead>
        <title>About - Unirend SSR Demo</title>
        <meta
          name="description"
          content="Learn about the Unirend framework and this demo"
        />
        {/*
          The override half of the template-meta baseline fixture, explained on the page
          itself in the card below. Nothing about About needs it: the demo had no page
          overriding a template meta at all, so that reconciliation ran on an empty set and
          looked healthy whether or not it worked.
        */}
        <meta name="robots" content="noindex, nofollow" />
      </UnirendHead>

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
            <li>Minimal configuration with sensible defaults</li>
            <li>Optimized production builds</li>
          </ul>
        </div>

        {/*
          On the page rather than only in a code comment, because this is a thing you do in a
          browser and the instructions are no use in a file you would have to already know to
          open. Someone clicking through the demo is exactly who should find out that this
          page is quietly proving something.
        */}
        <div className="card">
          <h2>🔍 This Page Overrides a Template Meta</h2>
          <p>
            <code>index.html</code> sets <code>robots</code> to{' '}
            <code>index, follow</code> as a site-wide baseline. This page
            declares its own <code>noindex, nofollow</code>, so{' '}
            <code>UnirendHead</code> takes the template's copy out while you are
            here and puts it back when you leave.
          </p>
          <p>
            To watch it, open the elements inspector on{' '}
            <code>&lt;head&gt;</code> and navigate between this page and any
            other. There should be exactly one <code>robots</code> meta at all
            times, never two and never none. Try it both ways round, since
            landing here first and arriving here later take different paths
            through the code: the server strips the tag before sending this
            page, so the client has to rebuild the baseline from scratch rather
            than re-attach a tag it still has.
          </p>
          <p>
            Nothing else in the demo overrides a template meta, which is why
            this is here at all.
          </p>
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
    </>
  );
}
