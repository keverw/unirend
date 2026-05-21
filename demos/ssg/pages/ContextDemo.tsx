import React, { useState, useEffect } from 'react';
import {
  UnirendHead,
  useIsSSR,
  useIsSSG,
  useIsClient,
  useRenderMode,
  useIsDevelopment,
  useIsServer,
  usePublicAppConfig,
  useCDNBaseURL,
  useDomainInfo,
  useRequestContext,
  useRequestContextValue,
  useRequestContextObjectRaw,
} from '../../../src/client';

const ContextDemo: React.FC = () => {
  // State to track if we're hydrated (client-side)
  const [isHydrated, setIsHydrated] = useState(false);

  // State to hold context values (populated after hydration)
  const [contextSnapshot, setContextSnapshot] = useState<{
    renderMode: string;
    isDevelopment: boolean;
    isServer: boolean;
    hasPublicConfig: boolean;
    cdnBaseURL: string;
    domainInfo: { hostname: string; rootDomain: string } | null;
  } | null>(null);

  // Get hooks (but don't render directly to avoid hydration mismatch)
  const isSSR = useIsSSR();
  const isSSG = useIsSSG();
  const isClient = useIsClient();
  const renderMode = useRenderMode();
  const isDevelopment = useIsDevelopment();
  const isServer = useIsServer();
  const publicAppConfig = usePublicAppConfig();
  const cdnBaseURL = useCDNBaseURL();
  const domainInfo = useDomainInfo();
  const requestContext = useRequestContext();
  const rawRequestContext = useRequestContextObjectRaw();

  // Store initial render values in request context (for debugging)
  // This runs on both server and client, storing what was seen at render time
  if (!requestContext.has('__debug_initialRenderMode')) {
    requestContext.set('__debug_initialRenderMode', renderMode);
    requestContext.set('__debug_initialIsDevelopment', isDevelopment);
    requestContext.set('__debug_initialCdnBaseURL', cdnBaseURL);
    requestContext.set('__debug_initialDomainInfo', JSON.stringify(domainInfo));
  }

  // Populate context snapshot after hydration
  // This is an intentional pattern for hydration detection in SSR/SSG apps
  useEffect(() => {
    setIsHydrated(true);
    setContextSnapshot({
      renderMode,
      isDevelopment,
      isServer,
      hasPublicConfig: !!publicAppConfig,
      cdnBaseURL,
      domainInfo,
    });
  }, [
    renderMode,
    isDevelopment,
    isServer,
    publicAppConfig,
    cdnBaseURL,
    domainInfo,
  ]);

  // Cleanup: Clear debug values when navigating away
  useEffect(() => {
    return () => {
      requestContext.delete('__debug_initialRenderMode');
      requestContext.delete('__debug_initialIsDevelopment');
      requestContext.delete('__debug_initialCdnBaseURL');
      requestContext.delete('__debug_initialDomainInfo');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: cleanup should only run on unmount, and requestContext methods are stable
  }, []);

  return (
    <>
      <UnirendHead>
        <title>Unirend Context Demo - SSG</title>
        <meta
          name="description"
          content="Demonstration of Unirend Context hooks in SSG mode"
        />
      </UnirendHead>
      <main className="main-content">
        <h1 className="hero-title">Unirend Context Hooks</h1>
        <p className="hero-subtitle">
          Explore the Unirend Context API in Static Site Generation mode
        </p>

        <div className="card">
          <h2>📦 Current Unirend Context</h2>
          {!isHydrated ? (
            <div className="context-panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0 }}>
                Hydrating... Context will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                The Unirend Context provides information about the rendering
                environment. In SSG mode, the render mode ("ssg") is set at
                build time, but the values shown here are populated on the
                client-side after hydration.
              </p>

              <div
                className="context-panel"
                style={{ fontFamily: 'monospace', textAlign: 'left' }}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: '0.75rem',
                    fontSize: '0.95rem',
                  }}
                >
                  <div>
                    <strong>useRenderMode():</strong>{' '}
                    <code className="context-badge">
                      "{contextSnapshot?.renderMode}"
                    </code>
                  </div>
                  <div>
                    <strong>useIsSSR():</strong>{' '}
                    <code className="context-badge">{String(isSSR)}</code>
                  </div>
                  <div>
                    <strong>useIsSSG():</strong>{' '}
                    <code className="context-badge">{String(isSSG)}</code>
                  </div>
                  <div>
                    <strong>useIsClient():</strong>{' '}
                    <code className="context-badge">{String(isClient)}</code>
                  </div>
                  <div>
                    <strong>useIsDevelopment():</strong>{' '}
                    <code className="context-badge">
                      {String(contextSnapshot?.isDevelopment)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsServer():</strong>{' '}
                    <code className="context-badge">
                      {String(contextSnapshot?.isServer)}
                    </code>
                  </div>
                  <div>
                    <strong>usePublicAppConfig():</strong>{' '}
                    <code className="context-badge">
                      {contextSnapshot?.hasPublicConfig
                        ? 'Populated'
                        : 'undefined'}
                    </code>
                  </div>
                  <div>
                    <strong>useCDNBaseURL():</strong>{' '}
                    <code className="context-badge">
                      {contextSnapshot?.cdnBaseURL
                        ? `"${contextSnapshot.cdnBaseURL}"`
                        : '(not configured)'}
                    </code>
                  </div>
                  <div>
                    <strong>useDomainInfo():</strong>{' '}
                    <code className="context-badge">
                      {JSON.stringify(contextSnapshot?.domainInfo ?? null)}
                    </code>
                  </div>
                  <div>
                    <strong>useRequestContext():</strong>{' '}
                    <code className="context-badge">Available</code>
                  </div>
                  <div>
                    <strong>useRequestContextValue():</strong>{' '}
                    <code className="context-badge">Available</code>
                  </div>
                  <div>
                    <strong>useRequestContextObjectRaw():</strong>{' '}
                    <code className="context-badge">
                      {rawRequestContext ? 'Populated' : 'undefined'}
                    </code>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>🔍 Initial Render Values (Debug)</h2>
          {!isHydrated ? (
            <div className="context-panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0 }}>
                Hydrating... Initial values will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                These values were captured during the initial page load (at
                build time if SSG, or on client if navigated from another page)
                and stored in the request context. They show what the
                environment was when this page was first rendered.
              </p>
              <div
                className="context-panel"
                style={{ fontFamily: 'monospace' }}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: '0.75rem',
                    fontSize: '0.95rem',
                  }}
                >
                  <div>
                    <strong>Initial Render Mode:</strong>{' '}
                    <code className="context-badge">
                      {String(requestContext.get('__debug_initialRenderMode'))}
                    </code>
                  </div>
                  <div>
                    <strong>Initial isDevelopment:</strong>{' '}
                    <code className="context-badge">
                      {String(
                        requestContext.get('__debug_initialIsDevelopment'),
                      )}
                    </code>
                  </div>
                  <div>
                    <strong>Initial CDN Base URL:</strong>{' '}
                    <code className="context-badge">
                      {String(
                        (requestContext.get('__debug_initialCdnBaseURL') as
                          | string
                          | undefined) ?? '(not configured)',
                      )}
                    </code>
                  </div>
                  <div>
                    <strong>Initial Domain Info:</strong>{' '}
                    <code className="context-badge">
                      {String(
                        (requestContext.get('__debug_initialDomainInfo') as
                          | string
                          | undefined) ?? 'null',
                      )}
                    </code>
                  </div>
                  <div>
                    <strong>Current Render Mode:</strong>{' '}
                    <code className="context-badge">{String(renderMode)}</code>
                  </div>
                  <div>
                    <strong>Current isDevelopment:</strong>{' '}
                    <code className="context-badge">
                      {String(isDevelopment)}
                    </code>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>⚙️ Public App Config</h2>
          {!isHydrated ? (
            <div className="context-panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0 }}>
                Hydrating... Config will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                The public app config is passed from the server and available
                via the{' '}
                <code className="context-badge">usePublicAppConfig()</code>{' '}
                hook. It's cloned and frozen to ensure immutability.
              </p>
              {publicAppConfig ? (
                <pre className="context-code-block">
                  {JSON.stringify(publicAppConfig, null, 2)}
                </pre>
              ) : (
                <p style={{ marginTop: '1rem', fontStyle: 'italic' }}>
                  No public config was provided to the server.
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2>🔍 Raw Request Context (Debug)</h2>
          {!isHydrated ? (
            <div className="context-panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0 }}>
                Hydrating... Raw context will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                The raw request context object for debugging purposes via the{' '}
                <code className="context-badge">
                  useRequestContextObjectRaw()
                </code>{' '}
                hook. This returns a cloned, immutable copy of the entire
                context.
              </p>
              <p
                style={{
                  marginTop: '1rem',
                  fontStyle: 'italic',
                  fontSize: '0.9rem',
                }}
              >
                <strong>Note:</strong> This is primarily for debugging. Use{' '}
                <code className="context-badge">useRequestContextValue()</code>{' '}
                or <code className="context-badge">useRequestContext()</code>{' '}
                for production code.
              </p>
              {rawRequestContext ? (
                <pre
                  className="context-code-block"
                  style={{ maxHeight: '300px' }}
                >
                  {JSON.stringify(rawRequestContext, null, 2)}
                </pre>
              ) : (
                <p style={{ marginTop: '1rem', fontStyle: 'italic' }}>
                  Request context not populated.
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2>⚠️ Hydration Safety</h2>
          <p>
            To avoid hydration mismatches, this demo uses{' '}
            <code className="context-badge">useEffect</code> to populate context
            values only after the component hydrates on the client.
          </p>
          <p style={{ marginTop: '1rem' }}>
            This ensures the server-rendered HTML doesn't contain values that
            might differ during client-side hydration.
          </p>
        </div>

        <div className="card">
          <h2>🎯 Hook Reference</h2>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <code className="context-badge">useRenderMode()</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns "ssr", "ssg", or "client" based on the current rendering
                environment.
              </p>
            </div>
            <div>
              <code className="context-badge">
                useIsSSR() / useIsSSG() / useIsClient()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Boolean checks for specific rendering modes. useIsSSG() returns
                true during static site generation.
              </p>
            </div>
            <div>
              <code className="context-badge">useIsDevelopment()</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns true if running in development mode. Always false during
                SSG (build-time).
              </p>
            </div>
            <div>
              <code className="context-badge">useIsServer()</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns true if code is running on the SSR server (has
                SSRHelpers attached to fetchRequest).
              </p>
            </div>
            <div>
              <code className="context-badge">usePublicAppConfig()</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns the public application configuration object (frozen and
                immutable).
              </p>
            </div>
            <div>
              <code className="context-badge">useCDNBaseURL()</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns the effective CDN base URL (configured via SSG options).
                Empty string when not configured.
              </p>
            </div>
            <div>
              <code className="context-badge">useDomainInfo()</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns{' '}
                <code className="context-badge">
                  {'{ hostname, rootDomain }'}
                </code>{' '}
                when a <code className="context-badge">hostname</code> option is
                provided to the SSG generator.
                <code className="context-badge">rootDomain</code> is empty for
                localhost or IP addresses. Returns{' '}
                <code className="context-badge">null</code> when no hostname is
                configured.
              </p>
            </div>
            <div>
              <code className="context-badge">useRequestContext()</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns a manager object with methods to get, set, has, delete,
                clear, keys, and size for request context.
              </p>
            </div>
            <div>
              <code className="context-badge">useRequestContextValue(key)</code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns [value, setValue] tuple for a reactive value stored in
                request context by key.
              </p>
            </div>
            <div>
              <code className="context-badge">
                useRequestContextObjectRaw()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns a cloned, immutable copy of the entire request context
                object for debugging purposes.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>🎮 Interactive Demo: useRequestContext()</h2>
          {!isHydrated ? (
            <div className="context-panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0 }}>
                Hydrating... Interactive demo will be available on client-side.
              </p>
            </div>
          ) : (
            <RequestContextDemo />
          )}
        </div>

        <div className="card">
          <h2>🎯 Interactive Demo: useRequestContextValue()</h2>
          {!isHydrated ? (
            <div className="context-panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0 }}>
                Hydrating... Interactive demo will be available on client-side.
              </p>
            </div>
          ) : (
            <RequestContextValueDemo />
          )}
        </div>
      </main>
    </>
  );
};

// Interactive demo component for useRequestContext()
const RequestContextDemo: React.FC = () => {
  const requestContext = useRequestContext();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [output, setOutput] = useState('');

  const handleSet = () => {
    if (!key.trim()) {
      setOutput('❌ Key cannot be empty');
      return;
    }
    requestContext.set(key, value);
    setOutput(`✅ Set "${key}" = "${value}"`);
  };

  const handleGet = () => {
    if (!key.trim()) {
      setOutput('❌ Key cannot be empty');
      return;
    }
    const result = requestContext.get(key);
    setOutput(`🔍 Get "${key}" = ${JSON.stringify(result)}`);
  };

  const handleHas = () => {
    if (!key.trim()) {
      setOutput('❌ Key cannot be empty');
      return;
    }
    const hasKey = requestContext.has(key);
    setOutput(`❓ Has "${key}" = ${hasKey}`);
  };

  const handleDelete = () => {
    if (!key.trim()) {
      setOutput('❌ Key cannot be empty');
      return;
    }
    const didDelete = requestContext.delete(key);
    setOutput(`🗑️ Delete "${key}" = ${didDelete ? 'deleted' : 'not found'}`);
  };

  const handleClear = () => {
    const count = requestContext.clear();
    setOutput(`🧹 Cleared ${count} keys`);
  };

  const handleKeys = () => {
    const keys = requestContext.keys();
    setOutput(`🔑 Keys: [${keys.map((k) => `"${k}"`).join(', ')}]`);
  };

  const handleSize = () => {
    const size = requestContext.size();
    setOutput(`📊 Size: ${size}`);
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <p>
        Test the <code className="context-badge">useRequestContext()</code> hook
        methods. Values persist across the entire request lifecycle.
      </p>

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'end',
            justifyContent: 'center',
          }}
        >
          <div>
            <label
              htmlFor="request-context-key"
              style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontSize: '0.9rem',
              }}
            >
              Key:
            </label>
            <input
              id="request-context-key"
              type="text"
              placeholder="Key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={{ minWidth: '120px' }}
            />
          </div>
          <div>
            <label
              htmlFor="request-context-value"
              style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontSize: '0.9rem',
              }}
            >
              Value:
            </label>
            <input
              id="request-context-value"
              type="text"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ minWidth: '120px' }}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <button onClick={handleSet}>Set</button>
          <button onClick={handleGet}>Get</button>
          <button onClick={handleHas}>Has</button>
          <button onClick={handleDelete}>Delete</button>
          <button onClick={handleClear}>Clear All</button>
          <button onClick={handleKeys}>List Keys</button>
          <button onClick={handleSize}>Size</button>
        </div>

        {output && (
          <div className="context-code-block" style={{ marginTop: 0 }}>
            {output}
          </div>
        )}
      </div>
    </div>
  );
};

// Interactive demo component for useRequestContextValue()
const RequestContextValueDemo: React.FC = () => {
  const [name, setName] = useRequestContextValue<string>('demo_name');
  const displayName = name || 'Anonymous';

  return (
    <div style={{ marginTop: '1rem' }}>
      <p>
        Test the <code className="context-badge">useRequestContextValue()</code>{' '}
        hook. This creates a reactive value that persists in the request
        context.
      </p>

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <label
            htmlFor="request-context-name"
            style={{ display: 'block', marginBottom: '0.5rem' }}
          >
            Your Name:
          </label>
          <input
            id="request-context-name"
            type="text"
            value={name || ''}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            style={{ width: '200px' }}
          />
        </div>

        <div
          className="context-panel"
          style={{ fontFamily: 'monospace', textAlign: 'left' }}
        >
          <div>
            <strong>Current Value:</strong>{' '}
            <code className="context-badge">"{name || ''}"</code>
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.9em' }}>
            This value is stored in request context with key "demo_name"
          </div>
        </div>

        <div className="context-highlight">
          <strong>Hello, {displayName}! 👋</strong>
          <div style={{ marginTop: '0.5rem', fontSize: '0.9em' }}>
            This greeting updates reactively as you type!
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContextDemo;
