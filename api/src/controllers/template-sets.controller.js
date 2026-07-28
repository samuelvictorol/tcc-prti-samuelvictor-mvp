const templateSetsManager = require('../managers/template-sets.manager');

async function create(req, res) {
  res.status(201).json({
    success: true,
    data: await templateSetsManager.create(req.validated.body, req.admin.id)
  });
}

async function list(req, res) {
  res.json({ success: true, data: await templateSetsManager.list(req.validated.query) });
}

async function get(req, res) {
  res.json({ success: true, data: await templateSetsManager.getById(req.validated.params.id) });
}

async function update(req, res) {
  res.json({
    success: true,
    data: await templateSetsManager.update(req.validated.params.id, req.validated.body, req.admin.id)
  });
}

async function remove(req, res) {
  res.json({
    success: true,
    data: await templateSetsManager.remove(req.validated.params.id, req.admin.id)
  });
}

module.exports = { create, list, get, update, remove };
