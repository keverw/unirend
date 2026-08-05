import { describe, expect, it } from 'bun:test';
import {
  renderContextDataElements,
  serializeContextData,
  UNIREND_BOOTSTRAP_SCRIPT,
  UNIREND_BOOTSTRAP_SCRIPT_HASH,
  UNIREND_DATA_BLOCK_ID,
  type UnirendContextData,
} from './context-data-block';
import { hashInlineContentForCSP } from '../csp-hash';

const BASE: UnirendContextData = {
  isDev: false,
  cdnBaseURL: '',
  domainInfo: null,
  templateAttrs: { html: {}, body: {} },
  templateMetas: [],
};

/**
 * Run the real bootstrap source against a stub of the two DOM APIs it touches,
 * and report the globals it assigned.
 *
 * A stub rather than a DOM library because the point is not to exercise a
 * parser: it is to prove that this exact string of JavaScript, the one whose
 * hash gets published, actually assigns what the client expects. Handing it a
 * fake `document` keeps the test pinned to the shipped source rather than to a
 * restatement of it.
 */
function runBootstrap(
  blockContent: string | null,
): Record<string, unknown> & { globalThisValue?: unknown } {
  const assigned: Record<string, unknown> = {};

  const windowStub = new Proxy(
    {},
    {
      set(_target, property, value) {
        assigned[String(property)] = value;
        return true;
      },
      get() {
        return undefined;
      },
      has() {
        return false;
      },
    },
  );

  const lookUpElement = (id: string) => {
    if (id !== UNIREND_DATA_BLOCK_ID || blockContent === null) {
      return null;
    }

    return { textContent: blockContent };
  };

  // Assigned rather than declared inline: the name is the browser's, and an
  // object literal key would be held to this repo's naming convention.
  const documentStub: Record<string, typeof lookUpElement> = {};
  documentStub.getElementById = lookUpElement;

  const globalThisStub = new Proxy(
    {},
    {
      set(_target, property, value) {
        assigned[String(property)] = value;
        return true;
      },
      get() {
        return undefined;
      },
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(
    'document',
    'window',
    'globalThis',
    UNIREND_BOOTSTRAP_SCRIPT,
  );

  run(documentStub, windowStub, globalThisStub);

  return assigned;
}

describe('serializeContextData', () => {
  it('escapes every < so a value cannot close the script element', () => {
    const json = serializeContextData({
      ...BASE,
      appConfig: { note: '</script><script>alert(1)</script>' },
    });

    expect(json).not.toContain('<');
    expect(json).toContain('\\u003c');
  });

  it('round-trips through JSON.parse with the original characters', () => {
    const data: UnirendContextData = {
      ...BASE,
      appConfig: { note: '<b>bold</b>' },
    };

    expect(JSON.parse(serializeContextData(data))).toEqual(data);
  });

  it('omits members the server did not provide', () => {
    // Absent and present-but-empty are different: an app can legitimately pass
    // an empty request context, and the client has to be able to tell.
    const parsed = JSON.parse(serializeContextData(BASE)) as Record<
      string,
      unknown
    >;

    expect(parsed).not.toHaveProperty('requestContext');
    expect(parsed).not.toHaveProperty('appConfig');

    const withEmpty = JSON.parse(
      serializeContextData({ ...BASE, requestContext: {} }),
    ) as Record<string, unknown>;

    expect(withEmpty).toHaveProperty('requestContext');
  });
});

describe('renderContextDataElements', () => {
  it('emits the data block before the bootstrap that reads it', () => {
    const [first, second] = renderContextDataElements(BASE);

    expect(first).toContain('type="application/json"');
    expect(second).toContain(UNIREND_BOOTSTRAP_SCRIPT);
  });

  it('marks the data block with a non-JavaScript type', () => {
    // This is the whole mechanism. A script element whose type is not a
    // JavaScript MIME type is never executed, so script-src does not govern it
    // and the per-request bytes need no hash and no nonce.
    const [block] = renderContextDataElements(BASE);

    expect(block).toStartWith(
      `<script type="application/json" id="${UNIREND_DATA_BLOCK_ID}">`,
    );
  });

  it('publishes a bootstrap hash matching the delivered script content', () => {
    const [, bootstrap] = renderContextDataElements(BASE);
    const match = /<script>([\s\S]*)<\/script>/.exec(bootstrap);

    expect(match).not.toBeNull();
    expect(hashInlineContentForCSP(match?.[1] ?? '')).toBe(
      UNIREND_BOOTSTRAP_SCRIPT_HASH,
    );
  });
});

describe('the bootstrap script', () => {
  it('assigns every global from the data block', () => {
    const data: UnirendContextData = {
      isDev: true,
      requestContext: { themePreference: 'dark' },
      appConfig: { apiURL: 'https://api.example.com' },
      cdnBaseURL: 'https://cdn.example.com',
      domainInfo: { hostname: 'example.com', rootDomain: 'example.com' },
      templateAttrs: { html: { lang: 'en' }, body: { class: 'app' } },
      templateMetas: [{ name: 'viewport', content: 'width=device-width' }],
    };

    const assigned = runBootstrap(serializeContextData(data));

    expect(assigned.__lifecycleion_is_dev__).toBe(true);
    expect(assigned.__FRONTEND_REQUEST_CONTEXT__).toEqual({
      themePreference: 'dark',
    });
    expect(assigned.__PUBLIC_APP_CONFIG__).toEqual({
      apiURL: 'https://api.example.com',
    });
    expect(assigned.__CDN_BASE_URL__).toBe('https://cdn.example.com');
    expect(assigned.__DOMAIN_INFO__).toEqual({
      hostname: 'example.com',
      rootDomain: 'example.com',
    });
    expect(assigned.__UNIREND_TEMPLATE_ATTRS__).toEqual({
      html: { lang: 'en' },
      body: { class: 'app' },
    });
    expect(assigned.__UNIREND_TEMPLATE_METAS__).toEqual([
      { name: 'viewport', content: 'width=device-width' },
    ]);
  });

  it('decodes escaped < back to the original character', () => {
    const assigned = runBootstrap(
      serializeContextData({ ...BASE, appConfig: { note: '<b>hi</b>' } }),
    );

    expect(assigned.__PUBLIC_APP_CONFIG__).toEqual({ note: '<b>hi</b>' });
  });

  it('leaves optional globals unset when the server omitted them', () => {
    const assigned = runBootstrap(serializeContextData(BASE));

    expect(assigned).not.toHaveProperty('__FRONTEND_REQUEST_CONTEXT__');
    expect(assigned).not.toHaveProperty('__PUBLIC_APP_CONFIG__');
  });

  it('falls back to safe defaults when the block is missing', () => {
    // Head parsing is still in progress here, so a throw would take out every
    // script after it and leave a blank page. Defaults keep client code that
    // reads these unconditionally working.
    const assigned = runBootstrap(null);

    expect(assigned.__lifecycleion_is_dev__).toBe(false);
    expect(assigned.__CDN_BASE_URL__).toBe('');
    expect(assigned.__DOMAIN_INFO__).toBeNull();
    expect(assigned.__UNIREND_TEMPLATE_ATTRS__).toEqual({ html: {}, body: {} });
    expect(assigned.__UNIREND_TEMPLATE_METAS__).toEqual([]);
  });

  it('falls back to safe defaults when the block is malformed', () => {
    const assigned = runBootstrap('{ not json');

    expect(assigned.__CDN_BASE_URL__).toBe('');
    expect(assigned.__UNIREND_TEMPLATE_METAS__).toEqual([]);
  });
});
