const crypto = require('crypto');
const { getSetting, setSetting } = require('../config');

function getOrCreateKey(name) {
  let hexKey = getSetting(name);
  if (!hexKey) {
    hexKey = crypto.randomBytes(32).toString('hex');
    setSetting(name, hexKey);
  }
  return Buffer.from(hexKey, 'hex');
}

function encrypt(obj) {
  const key = getOrCreateKey('encryption_key');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decrypt(encoded) {
  const key = getOrCreateKey('encryption_key');
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { getOrCreateKey, encrypt, decrypt };
