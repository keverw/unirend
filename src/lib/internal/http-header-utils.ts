import type { FastifyReply } from 'fastify';

/**
 * Add one or more values to the Vary header without duplicates.
 */
export function addToVaryHeader(
  reply: FastifyReply,
  ...values: string[]
): void {
  const existing = reply.getHeader('Vary');
  const current = Array.isArray(existing)
    ? existing.join(', ')
    : ((existing ?? '') as string);

  const vary = new Set(
    current
      .split(',')
      .map((header) => header.trim())
      .filter(Boolean),
  );

  for (const value of values) {
    vary.add(value);
  }

  reply.header('Vary', Array.from(vary).join(', '));
}
