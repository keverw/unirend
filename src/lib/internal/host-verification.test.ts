import { describe, it, expect } from 'bun:test';
import type { FastifyRequest } from 'fastify';
import { isHostUnverified } from './host-verification';

interface RequestShape {
  isRegistered?: boolean;
  wasChecked?: boolean;
  wasRejected?: boolean;
}

/**
 * The three signals the helper reads, with `server` present only when the
 * plugin registered, which is how a real instance looks.
 */
function requestWith({
  isRegistered,
  wasChecked,
  wasRejected,
}: RequestShape): FastifyRequest {
  return {
    server: { domainValidationRegistered: isRegistered },
    domainValidationChecked: wasChecked,
    domainValidationRejected: wasRejected,
  } as unknown as FastifyRequest;
}

describe('isHostUnverified', () => {
  it('returns false when domainValidation is not registered', () => {
    // The case that makes the registration flag necessary. Without it, every
    // server that does not validate hosts would look permanently unverified,
    // and every error page would degrade for no reason at all.
    expect(isHostUnverified(requestWith({}))).toBe(false);
    expect(isHostUnverified(requestWith({ isRegistered: false }))).toBe(false);
  });

  it('returns true when the gate never ran on a server that validates', () => {
    // A plugin above domainValidation threw, so the request ended before the
    // host was looked at. This is the case the helper exists for.
    expect(isHostUnverified(requestWith({ isRegistered: true }))).toBe(true);
  });

  it('returns false when the host was checked and passed', () => {
    expect(
      isHostUnverified(requestWith({ isRegistered: true, wasChecked: true })),
    ).toBe(false);
  });

  it('returns true when the host was checked and disclaimed', () => {
    // Reached when the validator itself failed: the gate ran, so `checked` is
    // set, but it could not confirm the domain, so the host is still not one
    // this server has claimed.
    expect(
      isHostUnverified(
        requestWith({
          isRegistered: true,
          wasChecked: true,
          wasRejected: true,
        }),
      ),
    ).toBe(true);
  });

  it('does not throw on a request with no server property', () => {
    // Error-path helpers get called from error pages, which are sometimes
    // exercised with hand-built request objects. Throwing there would replace
    // the error being reported with one from the reporting code.
    expect(() =>
      isHostUnverified({} as unknown as FastifyRequest),
    ).not.toThrow();

    expect(isHostUnverified({} as unknown as FastifyRequest)).toBe(false);
  });
});
