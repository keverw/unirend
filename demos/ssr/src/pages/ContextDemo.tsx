import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  useIsSSR,
  useIsSSG,
  useIsClient,
  useRenderMode,
  useIsDevelopment,
  useIsServer,
  useFrontendAppConfig,
  useRequestContext,
  useRequestContextValue,
  useRequestContextObjectRaw,
} from '../../../../src/client';

const ContextDemo: React.FC = () => {
  // State to track if we're hydrated (client-side)
  const [isHydrated, setIsHydrated] = useState(false);

  // State to hold context values (populated after hydration)
  const [contextSnapshot, setContextSnapshot] = useState<{
    renderMode: string;
    isDevelopment: boolean;
    isServer: boolean;
    hasFrontendConfig: boolean;
  } | null>(null);

  // Get hooks (but don't render directly to avoid hydration mismatch)
  const isSSR = useIsSSR();
  const isSSG = useIsSSG();
  const isClient = useIsClient();
  const renderMode = useRenderMode();
  const isDevelopment = useIsDevelopment();
  const isServer = useIsServer();
  const frontendAppConfig = useFrontendAppConfig();
  const requestContext = useRequestContext();
  const rawRequestContext = useRequestContextObjectRaw();

  // Store initial render values in request context (for debugging)
  // This runs on both server and client, storing what was seen at render time
  if (!requestContext.has('__debug_initialRenderMode')) {
    requestContext.set('__debug_initialRenderMode', renderMode);
    requestContext.set('__debug_initialIsDevelopment', isDevelopment);
  }

  // Populate context snapshot after hydration
  // This is an intentional pattern for hydration detection in SSR/SSG apps
  useEffect(() => {
    setIsHydrated(true);
    setContextSnapshot({
      renderMode,
      isDevelopment,
      isServer,
      hasFrontendConfig: !!frontendAppConfig,
    });
  }, [renderMode, isDevelopment, isServer, frontendAppConfig]);

  // Cleanup: Clear debug values when navigating away
  useEffect(() => {
    return () => {
      requestContext.delete('__debug_initialRenderMode');
      requestContext.delete('__debug_initialIsDevelopment');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: cleanup should only run on unmount, and requestContext methods are stable
  }, []);

  return (
    <>
      <Helmet>
        <title>Unirend Context Demo - SSR</title>
        <meta
          name="description"
          content="Demonstration of Unirend Context hooks in SSR mode"
        />
      </Helmet>

      <main className="main-content">
        <h1 className="hero-title">Unirend Context Hooks</h1>
        <p className="hero-subtitle">
          Explore the Unirend Context API in Server-Side Rendering mode
        </p>

        <div className="card">
          <h2>📦 Current Unirend Context</h2>
          {!isHydrated ? (
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1rem',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
                Hydrating... Context will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                The Unirend Context provides information about the rendering
                environment. In SSR mode, context values change between server
                and client.
              </p>

              <div
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  marginTop: '1rem',
                  fontFamily: 'monospace',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: '0.75rem',
                    fontSize: '0.95rem',
                    textAlign: 'left',
                  }}
                >
                  <div>
                    <strong>useRenderMode():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      "{contextSnapshot?.renderMode}"
                    </code>
                  </div>
                  <div>
                    <strong>useIsSSR():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(isSSR)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsSSG():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(isSSG)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsClient():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(isClient)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsDevelopment():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(contextSnapshot?.isDevelopment)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsServer():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(contextSnapshot?.isServer)} (client-side now)
                    </code>
                  </div>
                  <div>
                    <strong>useFrontendAppConfig():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {contextSnapshot?.hasFrontendConfig
                        ? 'Populated'
                        : 'undefined'}
                    </code>
                  </div>
                  <div>
                    <strong>useRequestContext():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      Available
                    </code>
                  </div>
                  <div>
                    <strong>useRequestContextValue():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      Available
                    </code>
                  </div>
                  <div>
                    <strong>useRequestContextObjectRaw():</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
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
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1rem',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
                Hydrating... Initial values will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                These values were captured during the initial page load (on the
                server if SSR, or on client if navigated from another page) and
                stored in the request context. They show what the environment
                was when this page was first rendered.
              </p>
              <div
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  marginTop: '1rem',
                  fontFamily: 'monospace',
                }}
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
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(requestContext.get('__debug_initialRenderMode'))}
                    </code>
                  </div>
                  <div>
                    <strong>Initial isDevelopment:</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(
                        requestContext.get('__debug_initialIsDevelopment'),
                      )}
                    </code>
                  </div>
                  <div>
                    <strong>Current Render Mode:</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(renderMode)}
                    </code>
                  </div>
                  <div>
                    <strong>Current isDevelopment:</strong>{' '}
                    <code
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        color: '#fff',
                      }}
                    >
                      {String(isDevelopment)}
                    </code>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>⚙️ Frontend App Config</h2>
          {!isHydrated ? (
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1rem',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
                Hydrating... Config will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                The frontend app config is passed from the server and available
                via the <code>useFrontendAppConfig()</code> hook. It's cloned
                and frozen to ensure immutability for each request.
              </p>
              {frontendAppConfig ? (
                <pre
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    padding: '1rem',
                    borderRadius: '4px',
                    overflow: 'auto',
                    marginTop: '1rem',
                    color: '#fff',
                    fontFamily: 'monospace',
                    textAlign: 'left',
                  }}
                >
                  {JSON.stringify(frontendAppConfig, null, 2)}
                </pre>
              ) : (
                <p style={{ marginTop: '1rem', fontStyle: 'italic' }}>
                  No frontend config was provided to the server.
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2>🔍 Raw Request Context (Debug)</h2>
          {!isHydrated ? (
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1rem',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
                Hydrating... Raw context will populate on client-side.
              </p>
            </div>
          ) : (
            <>
              <p>
                The raw request context object for debugging purposes via the{' '}
                <code>useRequestContextObjectRaw()</code> hook. This returns a
                cloned, immutable copy of the entire context.
              </p>
              <p
                style={{
                  marginTop: '1rem',
                  fontStyle: 'italic',
                  fontSize: '0.9rem',
                }}
              >
                <strong>Note:</strong> This is primarily for debugging. Use{' '}
                <code>useRequestContextValue()</code> or{' '}
                <code>useRequestContext()</code> for production code.
              </p>
              {rawRequestContext ? (
                <pre
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    padding: '1rem',
                    borderRadius: '4px',
                    overflow: 'auto',
                    marginTop: '1rem',
                    color: '#fff',
                    fontFamily: 'monospace',
                    textAlign: 'left',
                    maxHeight: '300px',
                  }}
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
            To avoid hydration mismatches in SSR, this demo uses{' '}
            <code
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                color: '#fff',
              }}
            >
              useEffect
            </code>{' '}
            to populate context values only after the component hydrates on the
            client.
          </p>
          <p style={{ marginTop: '1rem' }}>
            This ensures the server-rendered HTML doesn't contain
            client-specific values that would differ during hydration.
          </p>
        </div>

        <div className="card">
          <h2>🎯 Hook Reference</h2>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                useRenderMode()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns "ssr", "ssg", or "client" based on the current rendering
                environment.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                useIsSSR() / useIsSSG() / useIsClient()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Boolean checks for specific rendering modes. useIsSSR() returns
                true during server-side rendering.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                useIsDevelopment()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns true if running in development mode. Authoritative on
                server, derived on client.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                useIsServer()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns true if code is running on the SSR server (has
                SSRHelpers attached to fetchRequest).
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                useFrontendAppConfig()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns the frontend application configuration object (frozen
                and immutable).
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                useRequestContext()
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns a manager object with methods to get, set, has, delete,
                clear, keys, and size for request context.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                useRequestContextValue(key)
              </code>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Returns [value, setValue] tuple for a reactive value stored in
                request context by key.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
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
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1rem',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
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
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1rem',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
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
    const exists = requestContext.has(key);
    setOutput(`❓ Has "${key}" = ${exists}`);
  };

  const handleDelete = () => {
    if (!key.trim()) {
      setOutput('❌ Key cannot be empty');
      return;
    }
    const existed = requestContext.delete(key);
    setOutput(`🗑️ Delete "${key}" = ${existed ? 'deleted' : 'not found'}`);
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
        Test the <code>useRequestContext()</code> hook methods. Values persist
        across the entire request lifecycle.
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
              style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontSize: '0.9rem',
              }}
            >
              Key:
            </label>
            <input
              type="text"
              placeholder="Key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={{
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                color: '#fff',
                minWidth: '120px',
              }}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontSize: '0.9rem',
              }}
            >
              Value:
            </label>
            <input
              type="text"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                color: '#fff',
                minWidth: '120px',
              }}
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
          <button onClick={handleSet} style={buttonStyle}>
            Set
          </button>
          <button onClick={handleGet} style={buttonStyle}>
            Get
          </button>
          <button onClick={handleHas} style={buttonStyle}>
            Has
          </button>
          <button onClick={handleDelete} style={buttonStyle}>
            Delete
          </button>
          <button onClick={handleClear} style={buttonStyle}>
            Clear All
          </button>
          <button onClick={handleKeys} style={buttonStyle}>
            List Keys
          </button>
          <button onClick={handleSize} style={buttonStyle}>
            Size
          </button>
        </div>

        {output && (
          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              padding: '1rem',
              borderRadius: '4px',
              fontFamily: 'monospace',
              color: '#fff',
            }}
          >
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
        Test the <code>useRequestContextValue()</code> hook. This creates a
        reactive value that persists in the request context.
      </p>

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Your Name:
          </label>
          <input
            type="text"
            value={name || ''}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            style={{
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              color: '#fff',
              width: '200px',
            }}
          />
        </div>

        <div
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            padding: '1rem',
            borderRadius: '4px',
            fontFamily: 'monospace',
          }}
        >
          <div>
            <strong>Current Value:</strong> <code>"{name || ''}"</code>
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.9em', opacity: 0.8 }}>
            This value is stored in request context with key "demo_name"
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'rgba(0, 100, 200, 0.2)',
            padding: '1rem',
            borderRadius: '4px',
            border: '1px solid rgba(0, 100, 200, 0.3)',
          }}
        >
          <strong>Hello, {displayName}! 👋</strong>
          <div style={{ marginTop: '0.5rem', fontSize: '0.9em', opacity: 0.8 }}>
            This greeting updates reactively as you type!
          </div>
        </div>
      </div>
    </div>
  );
};

const buttonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '4px',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  backgroundColor: 'rgba(0, 0, 0, 0.2)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.9rem',
};

export default ContextDemo;
