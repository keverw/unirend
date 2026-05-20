import { mountApp } from '../../../src/client';
import { ThemeProvider } from './components/theme/ThemeProvider';

// Import frontend styles
import './index.css';

// Import shared routes
import { routes } from './Routes';

// Pass routes directly - mountApp handles creating the router
const result = mountApp('root', routes, {
  strictMode: true,
  wrapProviders: ThemeProvider,
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
