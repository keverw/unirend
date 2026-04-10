import { describe, expect, it } from 'bun:test';
import type { FastifyReply } from 'fastify';
import { addToVaryHeader } from './http-header-utils';

function createMockReply(
  initialHeaders: Record<string, string> = {},
): FastifyReply {
  const headers = { ...initialHeaders };
  const reply = {
    getHeader: (name: string) => headers[name],
    header: (name: string, value: string) => {
      headers[name] = value;
      return reply as FastifyReply;
    },
  };

  return reply as unknown as FastifyReply;
}

describe('addToVaryHeader', () => {
  it('adds values to an empty Vary header', () => {
    const reply = createMockReply();

    addToVaryHeader(reply, 'Origin', 'Accept-Encoding');

    expect(reply.getHeader('Vary')).toBe('Origin, Accept-Encoding');
  });

  it('deduplicates values and preserves existing entries', () => {
    const reply = createMockReply({
      Vary: 'Origin, Accept-Encoding',
    });

    addToVaryHeader(reply, 'Accept-Encoding', 'Accept-Language');

    expect(reply.getHeader('Vary')).toBe(
      'Origin, Accept-Encoding, Accept-Language',
    );
  });
});
