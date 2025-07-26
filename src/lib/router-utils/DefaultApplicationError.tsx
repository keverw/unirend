import React from "react";
import { Helmet } from "react-helmet-async";

export interface DefaultApplicationErrorProps {
  /** The error object */
  error: unknown;
}

/**
 * Default application error component with clean, unbranded styling
 * Designed to be standalone (not wrapped in app layout) to avoid infinite error loops
 */
export default function DefaultApplicationError({
  error,
}: DefaultApplicationErrorProps) {
  const errorMessage =
    error instanceof Error ? error.message : "An unexpected error occurred";
  const errorStack = error instanceof Error ? error.stack : undefined;

  const isDevelopment = process.env.NODE_ENV === "development";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, Arial, sans-serif",
        background: "#f7f7f8",
      }}
    >
      <Helmet>
        <title>500 - Internal Server Error</title>
      </Helmet>
      <main
        style={{
          background: "#fff",
          borderRadius: "14px",
          boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
          maxWidth: "440px",
          width: "100%",
          margin: "32px",
          padding: "32px 28px 24px 28px",
          textAlign: "center",
          boxSizing: "content-box",
        }}
      >
        <div
          style={{
            color: "#e53935",
            fontSize: "2rem",
            fontWeight: "600",
            marginBottom: "12px",
            letterSpacing: "0.01em",
          }}
        >
          500 - Internal Server Error
        </div>

        <div
          style={{
            fontSize: "1.1rem",
            fontWeight: "500",
            marginBottom: "24px",
            color: "#222",
          }}
        >
          {isDevelopment
            ? "Error Details (Development Mode)"
            : "We're sorry, something went wrong."}
        </div>

        {isDevelopment ? (
          <>
            <div style={{ marginBottom: "18px", textAlign: "left" }}>
              <div
                style={{
                  fontSize: "1rem",
                  fontWeight: "600",
                  color: "#444",
                  marginBottom: "2px",
                }}
              >
                Message:
              </div>
              <div
                style={{
                  background: "#f1f1f3",
                  borderRadius: "6px",
                  padding: "12px 14px",
                  fontSize: "0.98rem",
                  color: "#222",
                  wordBreak: "break-all",
                  overflowX: "auto",
                }}
              >
                {errorMessage}
              </div>
            </div>
            {errorStack && (
              <div style={{ marginBottom: "18px", textAlign: "left" }}>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: "600",
                    color: "#444",
                    marginBottom: "2px",
                  }}
                >
                  Stack Trace:
                </div>
                <div
                  style={{
                    background: "#f1f1f3",
                    borderRadius: "6px",
                    padding: "12px 14px",
                    fontSize: "0.92rem",
                    color: "#222",
                    whiteSpace: "pre-wrap",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
                    maxHeight: "300px",
                    overflowY: "auto",
                    wordBreak: "break-all",
                    overflowX: "auto",
                  }}
                >
                  {errorStack}
                </div>
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              background: "#f1f1f3",
              borderRadius: "6px",
              padding: "12px 14px",
              fontSize: "0.98rem",
              color: "#222",
              marginBottom: "18px",
            }}
          >
            An unexpected error occurred. Please try again later.
          </div>
        )}

        <button
          onClick={() => window.location.reload()}
          type="button"
          style={{
            margin: "18px auto 0 auto",
            display: "block",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "10px 22px",
            fontSize: "1rem",
            fontWeight: "500",
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#1d4ed8";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#2563eb";
          }}
        >
          Refresh Page
        </button>

        {isDevelopment && (
          <div
            style={{
              marginTop: "30px",
              fontSize: "0.97rem",
              color: "#888",
            }}
          >
            <b>Note:</b> Detailed error information is only shown in development
            mode.
          </div>
        )}
      </main>
    </div>
  );
}
