import { Outlet } from 'react-router';
import { usePublicAppConfig } from '../../../src/client';

export function Layout() {
  const app = usePublicAppConfig() as { appKey: string; appName: string };
  const select = (appKey: string) => {
    document.cookie = `asset_demo_app=${appKey}; path=/; max-age=3600`;
    location.href = '/';
  };

  return (
    <main>
      <header>
        <strong>Advanced Asset Request Paths</strong>
        <span>Selected app: {app.appName}</span>
        <button onClick={() => select('a')}>Use Default App A</button>
        <button onClick={() => select('b')}>Use Registered App B</button>
      </header>
      <Outlet />
    </main>
  );
}
