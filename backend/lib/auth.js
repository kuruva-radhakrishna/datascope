'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const jwt = require('./jwt.js');

const scrypt = promisify(crypto.scrypt);
const randomBytes = promisify(crypto.randomBytes);

/**
 * Hash a password with a random salt
 */
async function hashPassword(password) {
  const salt = await randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

/**
 * Verify a password against a hash
 */
async function verifyPassword(password, hashedPassword) {
  const [saltHex, hashHex] = hashedPassword.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const hash = await scrypt(password, salt, 64);
  return hash.toString('hex') === hashHex;
}

/**
 * Generate a JWT token for a user
 */
function generateToken(userId, email) {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET || 'dev-secret-change-in-production',
    { expiresIn: '7d' }
  );
}

/**
 * Verify a JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(
      token,
      process.env.JWT_SECRET || 'dev-secret-change-in-production'
    );
  } catch (err) {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  extractToken,
};
