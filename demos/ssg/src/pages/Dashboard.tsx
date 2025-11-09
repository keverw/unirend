import { useState, useEffect } from 'react';
import { Header } from '../components/Header';

function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API call for dynamic data
    const timer = setTimeout(() => {
      setData({
        user: 'John Doe',
        stats: {
          views: Math.floor(Math.random() * 10000),
          sales: Math.floor(Math.random() * 500),
          revenue: (Math.random() * 50000).toFixed(2),
        },
        lastLogin: new Date().toLocaleString(),
      });
      setLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div>
      <Header />

      <main className="main-content">
        <h1 className="hero-title">Dashboard</h1>
        <p className="hero-subtitle">
          This is a SPA (Single Page Application) route - it's client-rendered
          with dynamic content
        </p>

        <div className="card">
          <h2>User Analytics</h2>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div
                style={{
                  fontSize: '2rem',
                  animation: 'spin 1s linear infinite',
                }}
              >
                ⏳
              </div>
              <p>Loading dashboard data...</p>
            </div>
          ) : (
            <div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  marginBottom: '2rem',
                }}
              >
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '1rem',
                    borderRadius: '8px',
                  }}
                >
                  <h3>Page Views</h3>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    {data.stats.views.toLocaleString()}
                  </div>
                </div>
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '1rem',
                    borderRadius: '8px',
                  }}
                >
                  <h3>Sales</h3>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    {data.stats.sales}
                  </div>
                </div>
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '1rem',
                    borderRadius: '8px',
                  }}
                >
                  <h3>Revenue</h3>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    ${data.stats.revenue}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'left' }}>
                <p>
                  <strong>Welcome back, {data.user}!</strong>
                </p>
                <p>Last login: {data.lastLogin}</p>
                <p
                  style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    background: 'rgba(76, 175, 80, 0.2)',
                    borderRadius: '8px',
                    borderLeft: '4px solid #4CAF50',
                  }}
                >
                  💡 <strong>SPA Note:</strong> This page loads dynamic data on
                  the client-side. It's perfect for authenticated areas,
                  dashboards, or any content that needs to be personalized or
                  updated frequently.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p>&copy; 2024 Unirend Demo - Dashboard (SPA)</p>
        </div>
      </footer>
    </div>
  );
}

export default Dashboard;
