const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('controllers dependem somente de managers entre camadas de dominio', () => {
  const directory = path.resolve(__dirname, '../src/controllers');
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\.\/(models|services|controllers)\//, file);
    assert.match(source, /require\(['"]\.\.\/managers\//, file);
  }
});

test('todos os modulos de rota exportam basePath e router', () => {
  const directory = path.resolve(__dirname, '../src/routes');
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.routes.js'))) {
    const exported = require(path.join(directory, file));
    const modules = Array.isArray(exported) ? exported : [exported];
    assert.ok(modules.length > 0, file);
    for (const route of modules) {
      assert.equal(typeof route.basePath, 'string', file);
      assert.equal(typeof route.router, 'function', file);
    }
  }
});
