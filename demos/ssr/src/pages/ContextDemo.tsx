import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import {
  useIsSSR,
  useIsSSG,
  useRenderMode,
  useIsDevelopment,
  useFetchRequest,
  useIsServer,
  useFrontendAppConfig,
} from "../../../../src/client";

const ContextDemo: React.FC = () => {
  // State to track if we're hydrated (client-side)
  const [isHydrated, setIsHydrated] = useState(false);

  // State to hold context values (populated after hydration)
  const [contextSnapshot, setContextSnapshot] = useState<{
    renderMode: string;
    isDevelopment: boolean;
    hasRequest: boolean;
    requestUrl?: string;
    requestMethod?: string;
    requestIp?: string;
    userAgent?: string;
    isServer: boolean;
    hasFrontendConfig: boolean;
  } | null>(null);

  // Get hooks (but don't render directly to avoid hydration mismatch)
  const isSSR = useIsSSR();
  const isSSG = useIsSSG();
  const renderMode = useRenderMode();
  const isDevelopment = useIsDevelopment();
  const fetchRequest = useFetchRequest();
  const isServer = useIsServer();
  const frontendAppConfig = useFrontendAppConfig();

  // Populate context snapshot after hydration
  useEffect(() => {
    setIsHydrated(true);
    setContextSnapshot({
      renderMode,
      isDevelopment,
      hasRequest: !!fetchRequest,
      requestUrl: fetchRequest?.url,
      requestMethod: fetchRequest?.method,
      requestIp: undefined, // Not available in Fetch Request
      userAgent: fetchRequest?.headers.get("user-agent") || undefined,
      isServer,
      hasFrontendConfig: !!frontendAppConfig,
    });
  }, [renderMode, isDevelopment, fetchRequest, isServer, frontendAppConfig]);

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
                backgroundColor: "rgba(0, 0, 0, 0.2)",
                padding: "1.5rem",
                borderRadius: "8px",
                marginTop: "1rem",
                textAlign: "center",
              }}
            >
              <p style={{ margin: 0, color: "rgba(255, 255, 255, 0.8)" }}>
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
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "1.5rem",
                  borderRadius: "8px",
                  marginTop: "1rem",
                  fontFamily: "monospace",
                }}
              >
                <div style={{ marginBottom: "1rem" }}>
                  <strong>Context Snapshot (Client-side):</strong>
                  <pre
                    style={{
                      backgroundColor: "rgba(0, 0, 0, 0.3)",
                      padding: "1rem",
                      borderRadius: "4px",
                      overflow: "auto",
                      marginTop: "0.5rem",
                      color: "#fff",
                      fontFamily: "monospace",
                      textAlign: "left",
                    }}
                  >
                    {JSON.stringify(
                      {
                        renderMode: contextSnapshot?.renderMode,
                        isDevelopment: contextSnapshot?.isDevelopment,
                        fetchRequest: contextSnapshot?.hasRequest
                          ? {
                              url: contextSnapshot.requestUrl,
                              method: contextSnapshot.requestMethod,
                              userAgent: contextSnapshot.userAgent,
                            }
                          : undefined,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    fontSize: "0.95rem",
                  }}
                >
                  <div>
                    <strong>useRenderMode():</strong>{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.3)",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        color: "#fff",
                      }}
                    >
                      "{contextSnapshot?.renderMode}"
                    </code>
                  </div>
                  <div>
                    <strong>useIsSSR():</strong>{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.3)",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        color: "#fff",
                      }}
                    >
                      {String(isSSR)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsSSG():</strong>{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.3)",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        color: "#fff",
                      }}
                    >
                      {String(isSSG)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsDevelopment():</strong>{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.3)",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        color: "#fff",
                      }}
                    >
                      {String(contextSnapshot?.isDevelopment)}
                    </code>
                  </div>
                  <div>
                    <strong>useIsServer():</strong>{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.3)",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        color: "#fff",
                      }}
                    >
                      {String(contextSnapshot?.isServer)} (client-side now)
                    </code>
                  </div>
                  <div>
                    <strong>useFetchRequest():</strong>{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.3)",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        color: "#fff",
                      }}
                    >
                      {contextSnapshot?.hasRequest
                        ? "undefined (client-side)"
                        : "undefined"}
                    </code>
                  </div>
                  <div>
                    <strong>useFrontendAppConfig():</strong>{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.3)",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        color: "#fff",
                      }}
                    >
                      {contextSnapshot?.hasFrontendConfig
                        ? "Config Object"
                        : "undefined"}
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
                backgroundColor: "rgba(0, 0, 0, 0.2)",
                padding: "1.5rem",
                borderRadius: "8px",
                marginTop: "1rem",
                textAlign: "center",
              }}
            >
              <p style={{ margin: 0, color: "rgba(255, 255, 255, 0.8)" }}>
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
                    backgroundColor: "rgba(0, 0, 0, 0.3)",
                    padding: "1rem",
                    borderRadius: "4px",
                    overflow: "auto",
                    marginTop: "1rem",
                    color: "#fff",
                    fontFamily: "monospace",
                    textAlign: "left",
                  }}
                >
                  {JSON.stringify(frontendAppConfig, null, 2)}
                </pre>
              ) : (
                <p style={{ marginTop: "1rem", fontStyle: "italic" }}>
                  No frontend config was provided to the server.
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2>📚 About SSR Context</h2>
          <p>
            In Server-Side Rendering (SSR) mode, the context changes between
            server and client:
          </p>

          <h3 style={{ marginTop: "1.5rem", marginBottom: "0.75rem" }}>
            Server-Side (Initial Render):
          </h3>
          <ul>
            <li>
              <strong>renderMode:</strong> "ssr"
            </li>
            <li>
              <strong>isDevelopment:</strong> Based on server mode
              (dev/production)
            </li>
            <li>
              <strong>fetchRequest:</strong> Fetch API Request object with URL,
              headers, method, etc.
            </li>
            <li>
              <strong>isServer:</strong> true (running on server)
            </li>
          </ul>

          <h3 style={{ marginTop: "1.5rem", marginBottom: "0.75rem" }}>
            Client-Side (After Hydration):
          </h3>
          <ul>
            <li>
              <strong>renderMode:</strong> "client" (changes to "client" after
              hydration)
            </li>
            <li>
              <strong>isDevelopment:</strong> Based on Vite environment
            </li>
            <li>
              <strong>fetchRequest:</strong> undefined (no server request on
              client)
            </li>
            <li>
              <strong>isServer:</strong> false (running on client)
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>⚠️ Hydration Safety</h2>
          <p>
            To avoid hydration mismatches in SSR, this demo uses{" "}
            <code
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.2)",
                padding: "0.25rem 0.5rem",
                borderRadius: "4px",
                color: "#fff",
              }}
            >
              useEffect
            </code>{" "}
            to populate context values only after the component hydrates on the
            client.
          </p>
          <p style={{ marginTop: "1rem" }}>
            This ensures the server-rendered HTML doesn't contain
            client-specific values that would differ during hydration.
          </p>
        </div>

        <div className="card">
          <h2>🎯 Hook Reference</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div>
              <code
                style={{
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  color: "#fff",
                }}
              >
                useUnirendContext()
              </code>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Returns the complete context object with renderMode,
                isDevelopment, and fetchRequest.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  color: "#fff",
                }}
              >
                useRenderMode()
              </code>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Returns "ssr" or "ssg" based on the rendering mode.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  color: "#fff",
                }}
              >
                useIsSSR() / useIsSSG() / useIsClient()
              </code>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Boolean checks for the current rendering mode.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  color: "#fff",
                }}
              >
                useIsDevelopment()
              </code>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Returns true if running in development mode.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  color: "#fff",
                }}
              >
                useIsServer()
              </code>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Returns true if code is running on the SSR server (has SSRHelper
                attached to fetchRequest).
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  color: "#fff",
                }}
              >
                useFetchRequest()
              </code>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Returns the Fetch API Request object during SSR and SSG
                generation, undefined on client after hydration. Use{" "}
                <code>useIsServer()</code> to check for SSR specifically.
              </p>
            </div>
            <div>
              <code
                style={{
                  backgroundColor: "rgba(0, 0, 0, 0.2)",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  color: "#fff",
                }}
              >
                useFrontendAppConfig()
              </code>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Returns the frontend application configuration object (frozen
                and immutable). Available on both server and client.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
};

export default ContextDemo;
