'use strict';

// Framework-free request handling. route() is called by both the plain
// node:http server (local/Docker) and the Vercel serverless wrapper, so
// the exact same logic runs in every deployment.

const store = require('./store.js');
const { parseCSV } = require('./csv.js');
const { buildProfile } = require('./profile.js');
const { runIntent } = require('./analysis.js');
const { answerQuestion, llmConfigured, templateInterpretation } = require('./chat.js');
const { generateSeedCSV } = require('./seedgen.js');
const { buildReport } = require('./report.js');
const { buildXlsx } = require('./xlsx.js');
const { headSheets, resultSheets } = require('./export.js');
const { hashPassword, verifyPassword, generateToken, verifyToken, extractToken } = require('./auth.js');

const MAX_CSV_BYTES = 4 * 1024 * 1024; // Vercel serverless body limit

// Generate suggested questions based on dataset columns
function generateSuggestedQuestions(profile) {
  const suggestions = [];
  const numericCols = profile.columns.filter(c => c.type === 'number').map(c => c.name);
  const categoricalCols = profile.columns.filter(c => c.type === 'string').map(c => c.name);

  if (numericCols.length >= 2) {
    suggestions.push(`Is ${numericCols[0]} correlated with ${numericCols[1]}?`);
    suggestions.push(`Compare ${numericCols[0]} across different ${categoricalCols[0] || 'groups'}`);
  }
  if (categoricalCols.length >= 2) {
    suggestions.push(`Is ${categoricalCols[0]} related to ${categoricalCols[1]}?`);
  }
  if (numericCols.length > 0 && categoricalCols.length > 0) {
    suggestions.push(`Average ${numericCols[0]} by ${categoricalCols[0]}`);
  }
  if (numericCols.length > 0) {
    suggestions.push(`What are the outliers in ${numericCols[0]}?`);
  }

  return suggestions.slice(0, 4);
}

// Demo conversation: the full analyst toolkit, one question per test type.
const DEMO_QA = [
  { q: 'Is return rate different between couriers?', intent: { action: 'chisq', col1: 'courier', col2: 'returned' } },
  { q: 'Compare price between Karnataka and Maharashtra', intent: { action: 'ttest', metric: 'price', groupCol: 'state', groups: ['Karnataka', 'Maharashtra'], trim: true } },
  { q: 'Does price differ across product categories?', intent: { action: 'anova', metric: 'price', groupCol: 'category', trim: true } },
  { q: 'Is shipping fee related to price?', intent: { action: 'correlation', col1: 'price', col2: 'shipping_fee', trim: true } },
  { q: 'Top 5 states by average price', intent: { action: 'aggregate', groupBy: 'state', agg: 'mean', metric: 'price', topN: 5, trim: true } },
];

// Fixed id (not random) so seeding is safe under concurrent serverless cold
// starts: every instance tries the same insert, MongoDB's unique _id index
// lets exactly one succeed, and the rest see a harmless duplicate-key error.
// A random id here previously let two racing instances each seed their own
// copy, leaving the frontend holding a dataset id that lost the race and was
// never actually the one left in the "current" list — a 404 on first load.
const SEED_ID = 'seed-meesho-orders-demo';

let seedPromise = null;
function ensureSeed() {
  if (!seedPromise) {
    seedPromise = (async () => {
      if (process.env.SEED_DEMO === '0') return;
      const csv = generateSeedCSV();
      const { headers, rows } = parseCSV(csv);
      const profile = buildProfile(headers, rows);
      const ds = await store.createDatasetIfAbsent(SEED_ID, { name: 'meesho_orders.csv (demo)', headers, rows, profile });
      if (!ds) return; // another instance already seeded it — nothing to do
      const now = new Date().toISOString();
      const messages = [];
      for (const { q, intent } of DEMO_QA) {
        const result = runIntent(headers, rows, intent);
        if (result.error) continue;
        messages.push(
          { role: 'user', content: q, at: now },
          { role: 'assistant', content: templateInterpretation(result), intent, result, mode: 'demo', at: now },
        );
      }
      await store.appendChat(ds.id, messages);
      console.log(`Seeded demo dataset meesho_orders.csv with ${messages.length / 2} worked analyses`);
    })().catch((err) => {
      console.error('Seeding failed:', err.message);
      seedPromise = null; // allow retry on next request
    });
  }
  return seedPromise;
}

function json(status, body) { return { status, body }; }
function badRequest(msg) { return json(400, { error: msg }); }
function notFound(msg = 'not found') { return json(404, { error: msg }); }

// method + pathname + parsed JSON body (or raw string for CSV) => {status, body}
async function route(method, pathname, body, query = {}) {
  await store.init();
  await ensureSeed();

  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean); // e.g. ['api','datasets',':id','chat']
  if (parts[0] !== 'api') return notFound();

  // GET /api/health
  if (method === 'GET' && parts[1] === 'health' && parts.length === 2) {
    return json(200, { ok: true, storage: store.storageMode(), llm: llmConfigured() ? 'bifrost' : 'fallback' });
  }

  // POST /api/auth/register { email, password, name }
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'register') {
    if (!body || !body.email || !body.password) return badRequest('email and password required');
    if (body.password.length < 6) return badRequest('password must be at least 6 characters');
    if (!body.email.includes('@')) return badRequest('invalid email');
    try {
      const hash = await hashPassword(body.password);
      const user = await store.createUser(body.email, hash, body.name);
      const token = generateToken(user._id, user.email);
      return json(200, { user, token });
    } catch (err) {
      return badRequest(err.message);
    }
  }

  // POST /api/auth/login { email, password }
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'login') {
    if (!body || !body.email || !body.password) return badRequest('email and password required');
    const user = await store.getUserByEmail(body.email);
    if (!user) return json(401, { error: 'Invalid email or password' });
    const match = await verifyPassword(body.password, user.password);
    if (!match) return json(401, { error: 'Invalid email or password' });
    const token = generateToken(user._id, user.email);
    return json(200, { user: { _id: user._id, email: user.email, name: user.name }, token });
  }

  // GET /api/auth/me — get current user
  if (method === 'GET' && parts[1] === 'auth' && parts[2] === 'me' && parts.length === 3) {
    const authHeader = (query.Authorization || '');
    const token = extractToken(authHeader);
    if (!token) return json(401, { error: 'unauthorized' });
    const payload = verifyToken(token);
    if (!payload) return json(401, { error: 'invalid token' });
    return json(200, { userId: payload.userId, email: payload.email });
  }

  // GET /api/seed.csv — download the bundled demo file
  if (method === 'GET' && parts[1] === 'seed.csv') {
    return { status: 200, raw: generateSeedCSV(), contentType: 'text/csv' };
  }

  // POST /api/export-result.xlsx  { question, result } — no dataset lookup needed,
  // the caller already has the computed result (from chat or the test form).
  if (method === 'POST' && parts[1] === 'export-result.xlsx') {
    if (!body || !body.result || !body.result.test) return badRequest('expected JSON body { question, result }');
    const buf = buildXlsx(resultSheets(body.question, body.result));
    return {
      status: 200, raw: buf,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${body.result.test}-result.xlsx`,
    };
  }

  if (parts[1] !== 'datasets') return notFound();

  // GET /api/datasets
  if (method === 'GET' && parts.length === 2) {
    let userId = null;
    const authHeader = (query.Authorization || '');
    const token = extractToken(authHeader);
    if (token) {
      const payload = verifyToken(token);
      if (payload) userId = payload.userId;
    }
    return json(200, { datasets: await store.listDatasets(userId), storage: store.storageMode(), llm: llmConfigured() ? 'bifrost' : 'fallback' });
  }

  // POST /api/datasets  { name, csv }
  if (method === 'POST' && parts.length === 2) {
    if (!body || typeof body !== 'object') return badRequest('expected JSON body { name, csv }');
    const { name, csv } = body;
    if (typeof csv !== 'string' || csv.trim() === '') return badRequest('missing "csv" text');
    if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
      return json(413, { error: 'CSV is larger than 4MB. The hosted version caps uploads at 4MB — run the Docker image locally for bigger files.' });
    }
    let parsed;
    try {
      parsed = parseCSV(csv);
    } catch (err) {
      return badRequest(`could not parse CSV: ${err.message}`);
    }
    if (parsed.rows.length === 0) return badRequest('CSV has a header but no data rows');
    if (parsed.rows.length > 100000) return badRequest('CSV has more than 100,000 rows — too large for this tool');
    const profile = buildProfile(parsed.headers, parsed.rows);

    let userId = null;
    const authHeader = (query.Authorization || '');
    const token = extractToken(authHeader);
    if (token) {
      const payload = verifyToken(token);
      if (payload) userId = payload.userId;
    }

    const ds = await store.createDataset({
      name: (typeof name === 'string' && name.trim()) || 'uploaded.csv',
      headers: parsed.headers,
      rows: parsed.rows,
      profile,
      userId,
    });
    return json(201, { id: ds.id, name: ds.name, rowCount: ds.rowCount, profile });
  }

  const id = parts[2];
  if (!id) return notFound();
  const dataset = await store.getDataset(id);
  if (!dataset) return notFound('dataset not found');

  // GET /api/datasets/:id
  if (method === 'GET' && parts.length === 3) {
    const suggestions = generateSuggestedQuestions(dataset.profile);
    return json(200, { ...dataset, suggestions });
  }

  // GET /api/datasets/:id/report — downloadable self-contained HTML report
  if (method === 'GET' && parts[3] === 'report') {
    return { status: 200, raw: buildReport(dataset), contentType: 'text/html; charset=utf-8' };
  }

  // GET /api/datasets/:id/head?n=10 — df.head()-style preview
  if (method === 'GET' && parts[3] === 'head') {
    const n = Math.min(50, Math.max(1, Number(query.n) || 10));
    const rows = await store.getRows(id);
    return json(200, { headers: dataset.headers, rows: rows.slice(0, n), totalRows: rows.length, n });
  }

  // GET /api/datasets/:id/export.xlsx?n=10 — head rows as an Excel workbook
  if (method === 'GET' && parts[3] === 'export.xlsx') {
    const n = Math.min(1000, Math.max(1, Number(query.n) || 10));
    const rows = await store.getRows(id);
    const buf = buildXlsx(headSheets(dataset, rows, n));
    return {
      status: 200, raw: buf,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${dataset.name.replace(/[^a-z0-9._-]/gi, '_')}-head.xlsx`,
    };
  }

  // DELETE /api/datasets/:id
  if (method === 'DELETE' && parts.length === 3) {
    await store.deleteDataset(id);
    return json(200, { deleted: id });
  }

  // GET /api/datasets/:id/rows?offset=0&limit=50 — handled via body-less query in pathname? use body {offset,limit} on POST instead
  if (method === 'GET' && parts[3] === 'rows') {
    const all = await store.getRows(id);
    return json(200, { headers: dataset.headers, total: all.length, rows: all.slice(0, 200) });
  }

  // POST /api/datasets/:id/test  { action, metric, groupCol, groups, col1, col2, groupBy, agg, topN }
  if (method === 'POST' && parts[3] === 'test') {
    if (!body || !body.action) return badRequest('expected JSON body with "action"');
    const rows = await store.getRows(id);
    const result = runIntent(dataset.headers, rows, body);
    return json(result.error ? 422 : 200, result);
  }

  // GET /api/datasets/:id/chat
  if (method === 'GET' && parts[3] === 'chat') {
    return json(200, { messages: await store.getChat(id) });
  }

  // POST /api/datasets/:id/chat  { message }
  if (method === 'POST' && parts[3] === 'chat') {
    if (!body || typeof body.message !== 'string' || !body.message.trim()) return badRequest('expected JSON body { message }');
    const question = body.message.trim().slice(0, 2000);
    const history = await store.getChat(id);
    const rows = await store.getRows(id);
    const { answer, intent, result, mode } = await answerQuestion(dataset, rows, question, history);
    const now = new Date().toISOString();
    const userMsg = { role: 'user', content: question, at: now };
    const botMsg = { role: 'assistant', content: answer, intent, result, mode, at: now };
    await store.appendChat(id, [userMsg, botMsg]);
    return json(200, { reply: botMsg });
  }

  return notFound();
}

module.exports = { route, MAX_CSV_BYTES };
