const fs = require('node:fs');
const path = require('node:path');

function loadRoutes(app, directory = __dirname) {
  const files = fs.readdirSync(directory)
    .filter((file) => file.endsWith('.routes.js'))
    .sort();

  for (const file of files) {
    const routeModule = require(path.join(directory, file));
    const routes = Array.isArray(routeModule) ? routeModule : [routeModule];
    for (const route of routes) {
      if (!route?.basePath || !route?.router) throw new Error('Modulo de rota invalido: ' + file);
      app.use(route.basePath, route.router);
    }
  }
  return files;
}

module.exports = loadRoutes;
