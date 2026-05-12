import { createHash, randomBytes } from 'node:crypto';

// 40 random bytes encoded as hex → 80-char opaque token. Far beyond the entropy
// needed to be unguessable; SHA-256 truncation/collision is not a concern at
// this size, but the hash also gives us preimage resistance if the DB leaks.
const REFRESH_TOKEN_BYTES = 40;

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
