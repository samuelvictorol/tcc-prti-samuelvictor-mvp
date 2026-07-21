const test = require('node:test');
const assert = require('node:assert/strict');
const cryptoService = require('../src/services/crypto.service');

test('AES-256-GCM faz round-trip de texto e JSON', () => {
  const encrypted = cryptoService.encrypt('dado sensivel');
  assert.match(encrypted, /^enc:v1:/);
  assert.notEqual(encrypted, 'dado sensivel');
  assert.equal(cryptoService.decrypt(encrypted), 'dado sensivel');

  const object = { phone: '+5511999999999', channels: ['telegram'] };
  assert.deepEqual(cryptoService.decrypt(cryptoService.encrypt(object), { json: true }), object);
});

test('AES-256-GCM rejeita conteudo adulterado', () => {
  const encrypted = cryptoService.encrypt('nao alterar');
  const parts = encrypted.split(':');
  const ciphertext = Buffer.from(parts[4], 'base64url');
  ciphertext[0] ^= 1;
  parts[4] = ciphertext.toString('base64url');
  assert.throws(() => cryptoService.decrypt(parts.join(':')));
});

test('hash de busca e deterministico sem revelar o valor', () => {
  const first = cryptoService.searchHash('user@example.com');
  assert.equal(first, cryptoService.searchHash('user@example.com'));
  assert.notEqual(first, 'user@example.com');
  assert.equal(cryptoService.encrypt(null), null);
});
