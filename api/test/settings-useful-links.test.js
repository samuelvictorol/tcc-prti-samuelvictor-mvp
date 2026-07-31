const test = require('node:test');
const assert = require('node:assert/strict');
const Setting = require('../src/models/setting.model');
const { decrypt } = require('../src/services/crypto.service');
const { usefulLinksSchema, bulkSettingsSchema } = require('../src/dtos/settings.dto');
const settingsManager = require('../src/managers/settings.manager');

function queryResult(value) {
  const query = {
    select() { return query; },
    async lean() { return value; }
  };
  return query;
}

test('links uteis aceitam ate cinco destinos externos e normalizam aliases amigaveis', () => {
  const links = Array.from({ length: 5 }, (_item, index) => ({
    title: `Documento ${index + 1}`,
    description: index === 0 ? 'Guia de uso' : undefined,
    url: index === 0 ? 'http://docs.example.com' : `https://example.com/guia-${index + 1}`,
    icon: index === 0 ? 'mdi-book-open-page-variant' : 'mdi-open-in-new'
  }));
  const parsed = usefulLinksSchema.safeParse(links);

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data[0], {
    title: 'Documento 1',
    caption: 'Guia de uso',
    url: 'http://docs.example.com/',
    iconName: 'mdi-book-open-page-variant'
  });
  assert.equal(parsed.data.length, 5);
  assert.equal(bulkSettingsSchema.safeParse({ body: { usefulLinks: [] } }).success, true);
});

test('links uteis rejeitam excesso, duplicatas, icones invalidos e URLs nao publicas', () => {
  const valid = (overrides = {}) => ({
    title: 'Documentacao',
    caption: 'Ajuda externa',
    url: 'https://docs.example.com/notify',
    iconName: 'mdi-book-open-outline',
    ...overrides
  });

  assert.equal(usefulLinksSchema.safeParse(Array.from(
    { length: 6 },
    (_item, index) => valid({
      title: `Link ${index}`,
      url: `https://example.com/${index}`
    })
  )).success, false);
  assert.equal(usefulLinksSchema.safeParse([
    valid(),
    valid({ title: ' documentacao ', url: 'https://example.com/outro' })
  ]).success, false);
  assert.equal(usefulLinksSchema.safeParse([
    valid(),
    valid({ title: 'Outro', url: 'https://docs.example.com/notify' })
  ]).success, false);
  assert.equal(usefulLinksSchema.safeParse([valid({ iconName: 'javascript' })]).success, false);

  for (const url of [
    'javascript:alert(1)',
    'data:text/html,teste',
    'https://localhost/admin',
    'http://127.0.0.1/private',
    'http://192.168.1.20/painel',
    'https://usuario:senha@example.com'
  ]) {
    assert.equal(usefulLinksSchema.safeParse([valid({ url })]).success, false, url);
  }
});

test('settings persiste links criptografados e os devolve no contrato estruturado sem segredo', async (context) => {
  const originals = {
    updateOne: Setting.updateOne,
    find: Setting.find,
    findOne: Setting.findOne
  };
  context.after(() => {
    Setting.updateOne = originals.updateOne;
    Setting.find = originals.find;
    Setting.findOne = originals.findOne;
  });

  const stored = new Map();
  Setting.updateOne = async ({ key }, update) => {
    stored.set(key, { key, ...update.$set });
    return { acknowledged: true };
  };
  Setting.find = () => queryResult([...stored.values()]);
  Setting.findOne = ({ key }) => queryResult(stored.get(key) || null);

  const result = await settingsManager.setBulk({
    usefulLinks: [{
      title: 'Central MDI',
      caption: 'Catalogo de icones',
      url: 'https://pictogrammers.com/library/mdi/',
      iconName: 'mdi-palette-outline'
    }]
  }, '507f1f77bcf86cd799439011');

  const storedSetting = stored.get('USEFUL_LINKS');
  assert.ok(storedSetting);
  assert.equal(storedSetting.sensitive, false);
  assert.match(storedSetting.valueEncrypted, /^enc:v1:/);
  assert.doesNotMatch(storedSetting.valueEncrypted, /pictogrammers|Central MDI/);
  assert.deepEqual(JSON.parse(decrypt(storedSetting.valueEncrypted)), result.configuration.usefulLinks);
  assert.deepEqual(result.updated, ['USEFUL_LINKS']);
  assert.deepEqual(result.configuration.usefulLinks, [{
    title: 'Central MDI',
    caption: 'Catalogo de icones',
    url: 'https://pictogrammers.com/library/mdi/',
    iconName: 'mdi-palette-outline'
  }]);
  const item = result.configuration.items.find(({ key }) => key === 'USEFUL_LINKS');
  assert.deepEqual(item.value, result.configuration.usefulLinks);
  assert.equal(item.preview, null);
});

test('validacao do manager ocorre antes de qualquer escrita e permite limpar links', async (context) => {
  const originalUpdateOne = Setting.updateOne;
  const originalFind = Setting.find;
  const originalFindOne = Setting.findOne;
  let writes = 0;
  context.after(() => {
    Setting.updateOne = originalUpdateOne;
    Setting.find = originalFind;
    Setting.findOne = originalFindOne;
  });
  Setting.updateOne = async () => {
    writes += 1;
    return { acknowledged: true };
  };
  Setting.find = () => queryResult([]);
  Setting.findOne = () => queryResult(null);

  await assert.rejects(
    settingsManager.setBulk({
      email: { fromName: 'Notify Flow' },
      usefulLinks: [{
        title: 'Painel interno',
        url: 'http://10.0.0.8/admin',
        iconName: 'mdi-lock'
      }]
    }, '507f1f77bcf86cd799439011'),
    (error) => error.statusCode === 422 && error.code === 'USEFUL_LINKS_INVALID'
  );
  assert.equal(writes, 0);

  const cleared = await settingsManager.setBulk(
    { usefulLinks: [] },
    '507f1f77bcf86cd799439011'
  );
  assert.deepEqual(cleared.updated, ['USEFUL_LINKS']);
  assert.deepEqual(cleared.configuration.usefulLinks, []);
  assert.equal(writes, 1);
});
