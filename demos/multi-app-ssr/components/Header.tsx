import { Link } from 'react-router';
import { usePublicAppConfig } from '../../../src/client';
import { AppSwitcher } from '../commons/AppSwitcher';

export function Header() {
  const config = usePublicAppConfig() as { appName?: string } | null;
  const appName = config?.appName ?? 'App A';

  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="logo">
          Multi-App SSR Demo
        </Link>
        <span className="app-badge">{appName}</span>
        <AppSwitcher />
      </div>
    </header>
  );
}
