import { Helmet } from "react-helmet-async";
import AppLayout from "./AppLayout";

interface CustomNotFoundProps {
  error?: unknown;
}

/**
 * Custom 404 component for the SSR demo
 * This shows how to create a branded NotFound component
 */
export default function CustomNotFound({ error: _error }: CustomNotFoundProps) {
  return (
    <>
      <Helmet>
        <title>404 - Page Not Found | Unirend SSR Demo</title>
      </Helmet>
      <AppLayout>
        <main
          className="main-content"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "calc(100vh - 200px)", // Account for header/footer height
          }}
        >
          <div className="card">
            <h1
              style={{
                fontSize: "4rem",
                fontWeight: "800",
                margin: "0 0 1rem 0",
                color: "#ffffff",
              }}
            >
              404
            </h1>
            <h2 style={{ marginBottom: "1rem" }}>Page Not Found</h2>
            <p
              style={{
                color: "rgba(255, 255, 255, 0.9)",
                marginBottom: "2rem",
                fontSize: "1.1rem",
              }}
            >
              Oops! The page you're looking for seems to have wandered off. The
              page doesn't exist or has been moved. Let's get you back on track!
            </p>

            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <a
                href="/"
                style={{
                  display: "inline-block",
                  padding: "0.75rem 1.5rem",
                  background: "rgba(255, 255, 255, 0.2)",
                  color: "#ffffff",
                  textDecoration: "none",
                  borderRadius: "8px",
                  fontWeight: "600",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  transition: "all 0.3s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.3)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                🏠 Go Home
              </a>

              <a
                href="/about"
                style={{
                  display: "inline-block",
                  padding: "0.75rem 1.5rem",
                  background: "transparent",
                  color: "rgba(255, 255, 255, 0.9)",
                  textDecoration: "none",
                  borderRadius: "8px",
                  fontWeight: "500",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  transition: "all 0.3s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                  e.currentTarget.style.color = "#ffffff";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "rgba(255, 255, 255, 0.9)";
                }}
              >
                About
              </a>

              <a
                href="/contact"
                style={{
                  display: "inline-block",
                  padding: "0.75rem 1.5rem",
                  background: "transparent",
                  color: "rgba(255, 255, 255, 0.9)",
                  textDecoration: "none",
                  borderRadius: "8px",
                  fontWeight: "500",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  transition: "all 0.3s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                  e.currentTarget.style.color = "#ffffff";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "rgba(255, 255, 255, 0.9)";
                }}
              >
                Contact
              </a>
            </div>
          </div>
        </main>
      </AppLayout>
    </>
  );
}
