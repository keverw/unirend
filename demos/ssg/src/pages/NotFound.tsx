import { Header } from "../components/Header";
import { Link } from "react-router";

function NotFound() {
  return (
    <div>
      <Header />

      <main className="main-content">
        <div
          style={{ textAlign: "center", maxWidth: "600px", margin: "0 auto" }}
        >
          <div style={{ fontSize: "8rem", marginBottom: "1rem" }}>🔍</div>
          <h1
            className="hero-title"
            style={{ fontSize: "3rem", marginBottom: "1rem" }}
          >
            404
          </h1>
          <h2
            style={{ fontSize: "1.5rem", marginBottom: "2rem", opacity: 0.8 }}
          >
            Page Not Found
          </h2>
          <p className="hero-subtitle" style={{ marginBottom: "3rem" }}>
            Oops! The page you're looking for doesn't exist. It might have been
            moved, deleted, or you entered the wrong URL.
          </p>

          <div className="card" style={{ textAlign: "left" }}>
            <h3>What can you do?</h3>
            <ul style={{ marginBottom: "2rem" }}>
              <li style={{ marginBottom: "0.5rem" }}>
                Check the URL for typos
              </li>
              <li style={{ marginBottom: "0.5rem" }}>
                Go back to the{" "}
                <Link
                  to="/"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  homepage
                </Link>
              </li>
              <li style={{ marginBottom: "0.5rem" }}>
                Browse our available pages below
              </li>
            </ul>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1rem",
              }}
            >
              <Link
                to="/"
                style={{
                  display: "block",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  textDecoration: "none",
                  color: "inherit",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <strong>🏠 Home</strong>
                <div
                  style={{
                    fontSize: "0.9rem",
                    opacity: 0.8,
                    marginTop: "0.5rem",
                  }}
                >
                  Welcome page with SSG demo
                </div>
              </Link>

              <Link
                to="/about"
                style={{
                  display: "block",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  textDecoration: "none",
                  color: "inherit",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <strong>📖 About</strong>
                <div
                  style={{
                    fontSize: "0.9rem",
                    opacity: 0.8,
                    marginTop: "0.5rem",
                  }}
                >
                  Learn about this project
                </div>
              </Link>

              <Link
                to="/contact"
                style={{
                  display: "block",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  textDecoration: "none",
                  color: "inherit",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <strong>📧 Contact</strong>
                <div
                  style={{
                    fontSize: "0.9rem",
                    opacity: 0.8,
                    marginTop: "0.5rem",
                  }}
                >
                  Get in touch with us
                </div>
              </Link>

              <Link
                to="/dashboard"
                style={{
                  display: "block",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  textDecoration: "none",
                  color: "inherit",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <strong>📊 Dashboard</strong>
                <div
                  style={{
                    fontSize: "0.9rem",
                    opacity: 0.8,
                    marginTop: "0.5rem",
                  }}
                >
                  SPA with dynamic content
                </div>
              </Link>
            </div>
          </div>

          <div
            style={{
              marginTop: "2rem",
              padding: "1rem",
              background: "rgba(255, 193, 7, 0.2)",
              borderRadius: "8px",
              borderLeft: "4px solid #FFC107",
            }}
          >
            <p>
              <strong>💡 Demo Note:</strong> This 404 page is server-side
              rendered using SSG, meaning it loads instantly and is
              SEO-friendly. Perfect for handling broken links while maintaining
              good user experience!
            </p>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p>&copy; 2024 Unirend Demo - 404 Not Found (SSG)</p>
        </div>
      </footer>
    </div>
  );
}

export default NotFound;
