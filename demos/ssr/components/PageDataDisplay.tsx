import { useLoaderData, useParams } from 'react-router';
import { UnirendHead } from '../../../src/client';
import type { BaseMeta, PageSuccessResponse } from '../../../src/api-envelope';

// The envelope's second type parameter is its `meta`, which is where an app puts its own fields.
// `page` comes from BaseMeta, where it is `PageMetadata | undefined`. Redeclaring it here with
// looser fields would not satisfy the `M extends BaseMeta` constraint, and it does not need to:
// the field is optional, so the reads below still guard with optional chaining.
interface PageDataMeta extends BaseMeta {
  app?: {
    environment?: string;
  };
}

// Component to display page data JSON with proper layout and SEO
export function PageDataDisplay() {
  // The success member, the same way the starter templates and docs type a page's loader value.
  // A page component only renders when its loader succeeded.
  const data: PageSuccessResponse<unknown, PageDataMeta> | null =
    useLoaderData();

  const params = useParams();

  // Extract meta information for on-page display
  const title = data?.meta?.page?.title || 'Test Page Data';
  const description =
    data?.meta?.page?.description || 'Test page response data';

  return (
    <>
      {/*
        The whole envelope goes in, so every populated meta.page field becomes a tag: title,
        description, keywords, canonical, and og:*. The og:title below overrides just that one
        key, the rest still come from the envelope.
      */}
      <UnirendHead envelope={data}>
        <meta property="og:title" content={`${title} (local override)`} />
      </UnirendHead>

      <main className="main-content">
        <h1 className="hero-title">
          {params.id ? `Test Page Data (ID: ${params.id})` : 'Test Page Data'}
        </h1>
        <p className="hero-subtitle">
          Debug page showing page data loader request and response details
        </p>

        <div className="card">
          <h2>📋 Page Metadata</h2>
          <p>
            <strong>Title:</strong> {title}
          </p>
          <p>
            <strong>Description:</strong> {description}
          </p>
        </div>

        <div className="card">
          <h2>🧭 Environment</h2>
          <p>
            <strong>Mode:</strong> {data?.meta?.app?.environment || 'unknown'}
          </p>
        </div>

        <div className="card">
          <h2>🔍 Full Response Data</h2>
          <pre
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              overflow: 'auto',
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '70vh',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </main>
    </>
  );
}
