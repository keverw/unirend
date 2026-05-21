import { mountApp } from '../../src/client';

import './index.css';

import { routes } from './Routes';

const result = mountApp('root', routes, { strictMode: true });

if (result === 'hydrated') {
  // eslint-disable-next-line no-console
  console.log('✅ Hydrated SSR content');
} else if (result === 'rendered') {
  // eslint-disable-next-line no-console
  console.log('✅ Rendered as SPA');
} else {
  // eslint-disable-next-line no-console
  console.error('❌ Container not found');
}
