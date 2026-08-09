import { Link } from 'react-router';
import { useRequestContextValue } from '../../../src/client';

type AssetRequestPathsAudit = {
  tenantSelections: number;
  userSessionsResolved: number;
  userSessionsSkipped: number;
  lastSelectedApp: string;
  lastSessionAction: string;
};

export function Home() {
  const [audit] = useRequestContextValue<AssetRequestPathsAudit>(
    'assetRequestPathsAudit',
  );

  const fetchStaticAssetAndRefresh = async () => {
    await fetch('/present.txt?asset-demo-probe=1', { cache: 'no-store' });
    location.reload();
  };

  return (
    <section>
      <h1>Asset Request Paths</h1>
      <p>
        App A is the default built app. App B is a separately registered built
        app, selected by the request cookie before static routing runs.
      </p>
      <p>
        That selection always runs. Session work may skip only requests
        classified by <code>staticRequestPaths</code>.
      </p>
      <section className="request-audit" aria-live="polite">
        <h2>Server Request Audit</h2>
        <p>
          The counters are held by this demo server. Fetch the selected static
          asset, then refresh to make the static request visible here.
        </p>
        <ul>
          <li>Tenant/app selection runs: {audit?.tenantSelections ?? 0}</li>
          <li>User sessions resolved: {audit?.userSessionsResolved ?? 0}</li>
          <li>User sessions skipped: {audit?.userSessionsSkipped ?? 0}</li>
          <li>Last selected app: {audit?.lastSelectedApp ?? 'none'}</li>
          <li>Last session action: {audit?.lastSessionAction ?? 'none'}</li>
        </ul>
        <button onClick={() => void fetchStaticAssetAndRefresh()}>
          Fetch Selected Static Asset and Refresh Audit
        </button>
      </section>
      <ul>
        <li>
          <a href="/present.txt">
            Present selected-app asset, which identifies App A or App B
          </a>
        </li>
        <li>
          <a href="/assets/missing-demo.js">
            Mapped missing asset, selected-app standalone static 404
          </a>
        </li>
        <li>
          <Link to="/unknown-route">Normal React 404</Link>
        </li>
        <li>
          <a href="/api/missing">API envelope 404</a>
        </li>
      </ul>
    </section>
  );
}
