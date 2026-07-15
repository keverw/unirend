import { describe, expect, test } from 'bun:test';
import { ensureSSRAbout } from './ssr-about';
import { ensureSSRFooter } from './ssr-footer';
import { ensureSSRHome, SSR_HOME_CSPELL_WORDS } from './ssr-home';
import { ensureSSRRoutes } from './ssr-routes';
import { ensureSSRServeBuilt } from './ssr-serve-built';
import { ensureSSRServeHMR } from './ssr-serve-hmr';
import { ensureSSRSimulateComponentError } from './ssr-simulate-component-error';
import { ensureSSRThemePlugin } from './ssr-theme-plugin';
import {
  ensureSSRGet500ErrorPage,
  SSR_GET_500_ERROR_PAGE_CSPELL_WORDS,
} from './ssr-get-500-error-page';
import { ensureSSRComponent } from './ssr-component';
import { ensureSSRStart } from './ssr-start';
import type { InMemoryDir } from '../../vfs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect log calls for assertions. */
function makeLogger() {
  const calls: Array<[string, string]> = [];
  const log = (level: string, msg: string) => {
    calls.push([level, msg]);
  };
  return { log, calls };
}

// ---------------------------------------------------------------------------
// ensureSSRAbout
// ---------------------------------------------------------------------------

describe('ensureSSRAbout', () => {
  test('creates About.tsx when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRAbout(mem, 'src/apps/my-app');
    expect(typeof mem['src/apps/my-app/pages/About.tsx']).toBe('string');
    expect(mem['src/apps/my-app/pages/About.tsx'] as string).toContain('About');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRAbout(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('About.tsx');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'src/apps/my-app/pages/About.tsx': existing };
    await ensureSSRAbout(mem, 'src/apps/my-app');
    expect(mem['src/apps/my-app/pages/About.tsx']).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const mem: InMemoryDir = { 'src/apps/my-app/pages/About.tsx': 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRAbout(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRFooter
// ---------------------------------------------------------------------------

describe('ensureSSRFooter', () => {
  test('creates Footer.tsx when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRFooter(mem, 'src/apps/my-app');
    expect(typeof mem['src/apps/my-app/components/Footer.tsx']).toBe('string');
    expect(mem['src/apps/my-app/components/Footer.tsx'] as string).toContain(
      'Footer',
    );
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRFooter(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('Footer.tsx');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = {
      'src/apps/my-app/components/Footer.tsx': existing,
    };
    await ensureSSRFooter(mem, 'src/apps/my-app');
    expect(mem['src/apps/my-app/components/Footer.tsx']).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const mem: InMemoryDir = {
      'src/apps/my-app/components/Footer.tsx': 'existing',
    };
    const { log, calls } = makeLogger();
    await ensureSSRFooter(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRHome
// ---------------------------------------------------------------------------

describe('SSR_HOME_CSPELL_WORDS', () => {
  test('is a non-empty array of strings', () => {
    expect(Array.isArray(SSR_HOME_CSPELL_WORDS)).toBe(true);
    expect(SSR_HOME_CSPELL_WORDS.length).toBeGreaterThan(0);
    expect(SSR_HOME_CSPELL_WORDS.every((w) => typeof w === 'string')).toBe(
      true,
    );
  });

  test('contains noreferrer', () => {
    expect(SSR_HOME_CSPELL_WORDS).toContain('noreferrer');
  });
});

describe('ensureSSRHome', () => {
  test('creates Home.tsx when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRHome(mem, 'src/apps/my-app');
    expect(typeof mem['src/apps/my-app/pages/Home.tsx']).toBe('string');
    expect(mem['src/apps/my-app/pages/Home.tsx'] as string).toContain('Home');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRHome(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('Home.tsx');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'src/apps/my-app/pages/Home.tsx': existing };
    await ensureSSRHome(mem, 'src/apps/my-app');
    expect(mem['src/apps/my-app/pages/Home.tsx']).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const mem: InMemoryDir = { 'src/apps/my-app/pages/Home.tsx': 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRHome(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRRoutes
// ---------------------------------------------------------------------------

describe('ensureSSRRoutes', () => {
  test('creates Routes.tsx when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRRoutes(mem, 'src/apps/my-app');
    expect(typeof mem['src/apps/my-app/Routes.tsx']).toBe('string');
    expect(mem['src/apps/my-app/Routes.tsx'] as string).toContain('routes');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRRoutes(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('Routes.tsx');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'src/apps/my-app/Routes.tsx': existing };
    await ensureSSRRoutes(mem, 'src/apps/my-app');
    expect(mem['src/apps/my-app/Routes.tsx']).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const mem: InMemoryDir = { 'src/apps/my-app/Routes.tsx': 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRRoutes(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRServeBuilt
// ---------------------------------------------------------------------------

describe('ensureSSRServeBuilt', () => {
  test('creates serve-built.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRServeBuilt(mem, 'src/apps/my-app');
    expect(typeof mem['src/apps/my-app/serve-built.ts']).toBe('string');
    expect(mem['src/apps/my-app/serve-built.ts'] as string).toContain('built');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRServeBuilt(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('serve-built.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'src/apps/my-app/serve-built.ts': existing };
    await ensureSSRServeBuilt(mem, 'src/apps/my-app');
    expect(mem['src/apps/my-app/serve-built.ts']).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const mem: InMemoryDir = { 'src/apps/my-app/serve-built.ts': 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRServeBuilt(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRServeHMR
// ---------------------------------------------------------------------------

describe('ensureSSRServeHMR', () => {
  test('creates serve-hmr.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRServeHMR(mem, 'src/apps/my-app');
    expect(typeof mem['src/apps/my-app/serve-hmr.ts']).toBe('string');
    expect(mem['src/apps/my-app/serve-hmr.ts'] as string).toContain('hmr');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRServeHMR(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('serve-hmr.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'src/apps/my-app/serve-hmr.ts': existing };
    await ensureSSRServeHMR(mem, 'src/apps/my-app');
    expect(mem['src/apps/my-app/serve-hmr.ts']).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const mem: InMemoryDir = { 'src/apps/my-app/serve-hmr.ts': 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRServeHMR(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRSimulateComponentError
// ---------------------------------------------------------------------------

describe('ensureSSRSimulateComponentError', () => {
  test('creates SimulateComponentError.tsx when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRSimulateComponentError(mem, 'src/apps/my-app');
    const key = 'src/apps/my-app/pages/SimulateComponentError.tsx';
    expect(typeof mem[key]).toBe('string');
    expect(mem[key] as string).toContain('SimulateComponentError');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRSimulateComponentError(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('SimulateComponentError.tsx');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'src/apps/my-app/pages/SimulateComponentError.tsx';
    const mem: InMemoryDir = { [key]: existing };
    await ensureSSRSimulateComponentError(mem, 'src/apps/my-app');
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'src/apps/my-app/pages/SimulateComponentError.tsx';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRSimulateComponentError(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRThemePlugin
// ---------------------------------------------------------------------------

describe('ensureSSRThemePlugin', () => {
  test('creates theme.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRThemePlugin(mem, 'src/apps/my-app');
    const key = 'src/apps/my-app/server/plugins/theme.ts';
    expect(typeof mem[key]).toBe('string');
    expect(mem[key] as string).toContain('themePlugin');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRThemePlugin(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('theme.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'src/apps/my-app/server/plugins/theme.ts';
    const mem: InMemoryDir = { [key]: existing };
    await ensureSSRThemePlugin(mem, 'src/apps/my-app');
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'src/apps/my-app/server/plugins/theme.ts';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRThemePlugin(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRGet500ErrorPage
// ---------------------------------------------------------------------------

describe('SSR_GET_500_ERROR_PAGE_CSPELL_WORDS', () => {
  test('is a non-empty array of strings', () => {
    expect(Array.isArray(SSR_GET_500_ERROR_PAGE_CSPELL_WORDS)).toBe(true);
    expect(SSR_GET_500_ERROR_PAGE_CSPELL_WORDS.length).toBeGreaterThan(0);
    expect(
      SSR_GET_500_ERROR_PAGE_CSPELL_WORDS.every((w) => typeof w === 'string'),
    ).toBe(true);
  });
});

describe('ensureSSRGet500ErrorPage', () => {
  test('creates get-500-error-page.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRGet500ErrorPage(mem, 'src/apps/my-app');
    const key = 'src/apps/my-app/server/get-500-error-page.ts';
    expect(typeof mem[key]).toBe('string');
    expect(mem[key] as string).toContain('get500ErrorPage');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRGet500ErrorPage(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('get-500-error-page.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'src/apps/my-app/server/get-500-error-page.ts';
    const mem: InMemoryDir = { [key]: existing };
    await ensureSSRGet500ErrorPage(mem, 'src/apps/my-app');
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'src/apps/my-app/server/get-500-error-page.ts';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRGet500ErrorPage(mem, 'src/apps/my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRComponent
// ---------------------------------------------------------------------------

describe('ensureSSRComponent', () => {
  test('creates ssr-component.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRComponent(mem, 'src/apps/my-app', 'my-app');
    const key = 'src/apps/my-app/server/ssr-component.ts';
    expect(typeof mem[key]).toBe('string');
    expect(mem[key] as string).toContain('SSRServerComponent');
  });

  test('interpolates appName-derived env var names into the source', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRComponent(mem, 'src/apps/my-app', 'my-app');
    const src = mem['src/apps/my-app/server/ssr-component.ts'] as string;
    // buildAppEnvVarName('my-app', 'PORT') → 'MY_APP_PORT'
    expect(src).toContain('MY_APP_PORT');
    expect(src).toContain('MY_APP_SRC_DIR');
    expect(src).toContain('MY_APP_DIST_DIR');
  });

  test('uses the correct projectPath prefix in the file path', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRComponent(mem, 'src/apps/other', 'other');
    expect('src/apps/other/server/ssr-component.ts' in mem).toBe(true);
  });

  test('wires PUBLIC_FILES into the built-mode server config', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRComponent(mem, 'src/apps/my-app', 'my-app');
    const src = mem['src/apps/my-app/server/ssr-component.ts'] as string;
    expect(src).toContain(
      "import { ENABLE_TEST_ROUTES, PUBLIC_FILES, PUBLIC_FOLDERS } from '../consts';",
    );
    expect(src).toContain('publicFiles: PUBLIC_FILES,');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRComponent(mem, 'src/apps/my-app', 'my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('ssr-component.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'src/apps/my-app/server/ssr-component.ts';
    const mem: InMemoryDir = { [key]: existing };
    await ensureSSRComponent(mem, 'src/apps/my-app', 'my-app');
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'src/apps/my-app/server/ssr-component.ts';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRComponent(mem, 'src/apps/my-app', 'my-app', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSSRStart
// ---------------------------------------------------------------------------

describe('ensureSSRStart', () => {
  test('creates start.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRStart(mem, 'src/apps/my-app', 'my-app');
    const key = 'src/apps/my-app/server/start.ts';
    expect(typeof mem[key]).toBe('string');
    expect(mem[key] as string).toContain('startApp');
  });

  test('interpolates appName into the LifecycleManager name', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRStart(mem, 'src/apps/my-app', 'my-app');
    const src = mem['src/apps/my-app/server/start.ts'] as string;
    expect(src).toContain('my-app-ssr-server');
  });

  test('uses the correct projectPath prefix in the file path', async () => {
    const mem: InMemoryDir = {};
    await ensureSSRStart(mem, 'src/apps/other', 'other');
    expect('src/apps/other/server/start.ts' in mem).toBe(true);
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureSSRStart(mem, 'src/apps/my-app', 'my-app', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('start.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'src/apps/my-app/server/start.ts';
    const mem: InMemoryDir = { [key]: existing };
    await ensureSSRStart(mem, 'src/apps/my-app', 'my-app');
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'src/apps/my-app/server/start.ts';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureSSRStart(mem, 'src/apps/my-app', 'my-app', log);
    expect(calls).toHaveLength(0);
  });
});
