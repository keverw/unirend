import { usePublicAppConfig, useDomainInfo } from '../../../src/client';

const APP_OPTIONS = [
  { value: 'app-a', label: 'App A (indigo)' },
  { value: 'app-b', label: 'App B (green)' },
  { value: 'app-c', label: 'App C ⚠️ (does not exist — triggers error)' },
];

// Shared by all apps. Lives in commons/ so each app's Vite build picks it up
// from the same source file without needing a runtime shared module.
export default function AppSwitcher() {
  const config = usePublicAppConfig() as { appKey?: string } | null;
  // useDomainInfo() gives the root domain so the cookie spans subdomains
  // (e.g. app.example.com and marketing.example.com share the same cookie).
  // Returns null on localhost/IP — cookie is then host-only, which is correct.
  const domainInfo = useDomainInfo();
  const current = config?.appKey ?? 'app-a';

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    document.cookie = [
      `selected_app=${value}`,
      'path=/',
      `max-age=${365 * 24 * 60 * 60}`,
      domainInfo?.rootDomain ? `domain=.${domainInfo.rootDomain}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    window.location.href = '/';
  }

  return (
    <div className="app-switcher">
      <span>Switch app:</span>
      <select value={current} onChange={handleChange}>
        {APP_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
