const test = require('node:test');
const assert = require('node:assert/strict');
const ApiError = require('../src/utils/api-error');
const { errorHandler } = require('../src/middlewares/error');

test('erro de provedor registra requestId pesquisavel sem corpo ou Authorization', (context) => {
  const originalConsoleError = console.error;
  const originalNodeEnv = process.env.NODE_ENV;
  context.after(() => {
    console.error = originalConsoleError;
    process.env.NODE_ENV = originalNodeEnv;
  });
  process.env.NODE_ENV = 'production';
  const entries = [];
  console.error = (...args) => entries.push(args);
  const response = {
    statusCode: null,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
  const error = new ApiError(
    502,
    'Access token da Meta invalido',
    { providerErrorCode: 190 },
    'WHATSAPP_CLOUD_ERROR'
  );
  error.expose = true;

  errorHandler(error, {
    id: 'request-safe-id',
    method: 'POST',
    originalUrl: '/api/whatsapp-cloud/send?hub.verify_token=nao-deve-aparecer',
    body: { accessToken: 'nao-deve-aparecer' },
    headers: { authorization: 'Bearer nao-deve-aparecer' }
  }, response, () => {});

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error.requestId, 'request-safe-id');
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], '[api:error]');
  assert.deepEqual(entries[0][1], {
    requestId: 'request-safe-id',
    method: 'POST',
    path: '/api/whatsapp-cloud/send',
    status: 502,
    code: 'WHATSAPP_CLOUD_ERROR',
    message: 'Access token da Meta invalido'
  });
  assert.doesNotMatch(JSON.stringify(entries), /nao-deve-aparecer/);
});
