import { mountApp } from '../../src/client';

// Import frontend styles
import './index.css';

// Import shared routes
import { routes } from './Routes';

// Import theme provider
import { ThemeProvider } from './components/theme/ThemeProvider';

// Pass routes directly - mountApp handles creating the router
const result = mountApp('root', routes, {
  strictMode: true,
  // Sits above the router — good for themes, modals, toast containers, etc.
  // Keep it stable — errors here bypass React Router's errorElement (SSR: server failure, SSG: page render fails)
  rootProviders: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
});

if (result === 'hydrated') {
  // eslint-disable-next-line no-console
  console.log('✅ Hydrated SSR/SSG content');
} else if (result === 'rendered') {
  // eslint-disable-next-line no-console
  console.log('✅ Rendered as SPA');
} else {
  // eslint-disable-next-line no-console
  console.error('❌ Container not found');
}
