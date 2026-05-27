import { NavLink } from 'react-router';
import { usePublicAppConfig } from '../../../../src/client';
import { AppSwitcher } from '../../commons/AppSwitcher';

export function Sidebar() {
  const config = usePublicAppConfig() as { appName?: string } | null;
  const appName = config?.appName ?? 'App B';

  return (
    <aside className="sidebar">
      <a href="/" className="sidebar-logo">
        Multi-App SSR Demo
      </a>
      <div className="sidebar-app-name">{appName}</div>

      <nav>
        <ul className="sidebar-nav">
          <li>
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              Dashboard
            </NavLink>
          </li>
        </ul>
      </nav>

      <div className="sidebar-spacer" />

      <AppSwitcher />
    </aside>
  );
}
