import { useLoaderData, useParams } from 'react-router';
import { UnirendHead } from '../../../src/client';

// Component to display page data JSON with proper layout and SEO
export function PageDataDisplay() {
  const data: {
    meta?: {
      page?: {
        title?: string;
        description?: string;
      };
      app?: {
        environment?: string;
      };
    };
  } = useLoaderData();

  const params = useParams();

  // Extract meta information for document title and description
  const title = data?.meta?.page?.title || 'Test Page Data';
  const description =
    data?.meta?.page?.description || 'Test page response data';

  return (
    <>
      <UnirendHead>
        <title>{title}</title>
        <meta name="description" content={description} />
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
