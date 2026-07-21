function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function pageResult(items, total, page, limit) {
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

module.exports = { parsePagination, pageResult };
