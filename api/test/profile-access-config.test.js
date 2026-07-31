const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const profileManager = require('../src/managers/profile.manager');
const settingsManager = require('../src/managers/settings.manager');
const { createApp } = require('../src/app');

test('configuracao publica de acesso expoe somente a URL segura de login', async (context) => {
  const original = settingsManager.getValue;
  context.after(() => { settingsManager.getValue = original; });
  settingsManager.getValue = async (key) => {
    assert.equal(key, 'WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER');
    return '+55 (11) 98888-7777';
  };

  const result = await profileManager.publicAccessConfig();

  assert.deepEqual(Object.keys(result), ['profilePath', 'whatsapp']);
  assert.deepEqual(Object.keys(result.whatsapp), ['configured', 'loginUrl']);
  assert.equal(result.profilePath, '/meu-perfil');
  assert.equal(result.whatsapp.configured, true);
  const url = new URL(result.whatsapp.loginUrl);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'wa.me');
  assert.equal(url.pathname, '/5511988887777');
  assert.equal(url.searchParams.get('text'), '/login');
  assert.doesNotMatch(JSON.stringify(result), /TOKEN|SECRET|PHONE_NUMBER_ID|BUSINESS_ACCOUNT/i);
});

test('configuracao publica desabilita WhatsApp quando o numero nao e valido', async (context) => {
  const original = settingsManager.getValue;
  context.after(() => { settingsManager.getValue = original; });
  settingsManager.getValue = async () => 'numero-invalido';

  const result = await profileManager.publicAccessConfig();

  assert.deepEqual(result, {
    profilePath: '/meu-perfil',
    whatsapp: { configured: false, loginUrl: null }
  });
});

test('rota de configuracao de acesso e publica e impede cache do navegador', async (context) => {
  const original = profileManager.publicAccessConfig;
  context.after(() => { profileManager.publicAccessConfig = original; });
  profileManager.publicAccessConfig = async () => ({
    profilePath: '/meu-perfil',
    whatsapp: {
      configured: true,
      loginUrl: 'https://wa.me/5511988887777?text=%2Flogin'
    }
  });

  const response = await request(createApp()).get('/api/my-profile/access-config');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.profilePath, '/meu-perfil');
  assert.equal(response.body.data.whatsapp.configured, true);
  assert.match(response.headers['cache-control'], /no-store/);
  assert.equal(response.headers.pragma, 'no-cache');
});
