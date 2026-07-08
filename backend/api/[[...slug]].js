'use strict';

// Vercel serverless wrapper for backend API
const { route } = require('../lib/handlers.js');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let body = req.body;
    // Vercel pre-parses JSON bodies; normalize strings just in case
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* keep raw */ }
    }
    const query = Object.fromEntries(url.searchParams);
    const out = await route(req.method, url.pathname, body || null, query);
    if (out.raw !== undefined) {
      res.statusCode = out.status;
      res.setHeader('content-type', out.contentType || 'text/plain');
      if (out.filename) res.setHeader('content-disposition', `attachment; filename="${out.filename}"`);
      res.end(out.raw);
      return;
    }
    res.statusCode = out.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out.body));
  } catch (err) {
    console.error('function error:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'internal error: ' + err.message }));
  }
};
