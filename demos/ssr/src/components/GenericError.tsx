import React from 'react';
import type { PageErrorResponse } from '../../../../src/lib/api-envelope/api-envelope-types';
import { Helmet } from 'react-helmet-async';

interface GenericErrorProps {
  data: PageErrorResponse | null;
}

const GenericError: React.FC<GenericErrorProps> = ({ data }) => {
  const title = data?.meta?.page?.title || 'Error - Unirend SSR Demo';
  const description = data?.meta?.page?.description || 'An error occurred.';
  const message =
    data?.error?.message || 'Something went wrong. Please try again later.';
  const requestID = data?.request_id;

  // Show stack trace if available (upstream data loader already gates details on isDevelopment)
  const detailsToShow =
    data?.error?.details &&
    typeof data.error.details === 'object' &&
    !Array.isArray(data.error.details) &&
    'stack' in data.error.details
      ? (data.error.details.stack as string)
      : null;

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
      </Helmet>

      <main
        className="main-content"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 200px)', // Account for header/footer height
        }}
      >
        <div className="card">
          <div style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                fontSize: '4rem',
                fontWeight: '800',
                margin: '0 0 1rem 0',
                color: '#ffffff',
              }}
            >
              ⚠️
            </div>
          </div>

          <h1
            style={{
              fontSize: '2rem',
              fontWeight: '800',
              color: '#ffffff',
              marginBottom: '1rem',
            }}
          >
            Error Code: {data?.error?.code?.toUpperCase() || 'UNKNOWN'}
          </h1>

          <p
            style={{
              color: 'rgba(255, 255, 255, 0.9)',
              marginBottom: '0.75rem',
              fontSize: '1.1rem',
            }}
          >
            {message}
          </p>

          <p
            style={{
              color: 'rgba(255, 255, 255, 0.8)',
              marginBottom: '2rem',
              fontSize: '1rem',
            }}
          >
            Please try again later or contact support if the problem persists.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <a
              href="/"
              style={{
                display: 'inline-block',
                padding: '0.75rem 1.5rem',
                background: 'rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: '600',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                transition: 'all 0.3s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              🏠 Go Home
            </a>

            <a
              href="/about"
              style={{
                display: 'inline-block',
                padding: '0.75rem 1.5rem',
                background: 'transparent',
                color: 'rgba(255, 255, 255, 0.9)',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: '500',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                transition: 'all 0.3s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
              }}
            >
              About
            </a>

            <a
              href="/contact"
              style={{
                display: 'inline-block',
                padding: '0.75rem 1.5rem',
                background: 'transparent',
                color: 'rgba(255, 255, 255, 0.9)',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: '500',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                transition: 'all 0.3s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
              }}
            >
              Contact
            </a>
          </div>

          {/* Display details (stack trace) in development mode if available */}
          {detailsToShow && (
            <div
              style={{
                marginTop: '1.5rem',
                textAlign: 'left',
                padding: '1rem',
                background: 'rgba(0, 0, 0, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px',
                overflow: 'auto',
                maxHeight: '200px',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'rgba(255, 255, 255, 0.9)',
              }}
            >
              {detailsToShow}
            </div>
          )}

          {/* Display request ID inside the container */}
          {requestID && (
            <div
              style={{
                marginTop: '2rem',
                fontSize: '0.875rem',
                color: 'rgba(255, 255, 255, 0.7)',
              }}
            >
              Request ID: {requestID}
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default GenericError;
