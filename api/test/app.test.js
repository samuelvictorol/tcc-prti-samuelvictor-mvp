const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('health e 404 possuem envelope consistente', async () => {
  const app = createApp();
  const health = await request(app).get('/health');
  assert.equal(health.status, 503);
  assert.equal(health.body.data.dependencies.mongodb, 'down');

  const missing = await request(app).get('/rota-inexistente');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.success, false);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});
