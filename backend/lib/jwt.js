'use strict';

// Minimal JWT implementation for Node.js (no external dependencies)
const crypto = require('node:crypto');

/**
 * Create a JWT token
 */
function sign(payload, secret, options = {}) {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: now,
  };

  if (options.expiresIn) {
    const expiresIn = parseExpiration(options.expiresIn);
    claims.exp = now + expiresIn;
  }

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(claims));
  const message = `${headerEncoded}.${payloadEncoded}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${message}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
function verify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [headerEncoded, payloadEncoded, signatureProvided] = parts;
  const message = `${headerEncoded}.${payloadEncoded}`;

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  if (signatureProvided !== expectedSignature) {
    throw new Error('Invalid signature');
  }

  // Decode and verify payload
  const payload = JSON.parse(base64UrlDecode(payloadEncoded));

  // Check expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

/**
 * Parse expiration time string (e.g., "7d", "24h", "3600" in seconds)
 */
function parseExpiration(expiresIn) {
  if (typeof expiresIn === 'number') return expiresIn;
  if (typeof expiresIn !== 'string') return 3600; // default 1 hour

  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return 3600;

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case 'd': return num * 86400; // days
    case 'h': return num * 3600; // hours
    case 'm': return num * 60; // minutes
    case 's': return num; // seconds
    default: return 3600;
  }
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

module.exports = { sign, verify };
