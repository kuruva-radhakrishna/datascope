'use strict';

// Storage: MongoDB Atlas when MONGODB_URI is set and reachable,
// otherwise an in-memory fallback so the app always works.
// Collections: datasets (metadata + profile), rows (batched), chats.

const crypto = require('node:crypto');

const ROW_BATCH = 500;

let client = null;
let db = null;
let mode = 'memory';
let initPromise = null;

// in-memory fallback
const mem = { datasets: new Map(), rows: new Map(), chats: new Map() };

async function tryConnect(uri) {
  const { MongoClient } = require('mongodb');
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 6000 });
  await c.connect();
  const d = c.db(process.env.MONGODB_DB || 'datascope');
  await d.command({ ping: 1 });
  await d.collection('rows').createIndex({ datasetId: 1, batch: 1 });
  await d.collection('chats').createIndex({ datasetId: 1 });
  return { c, d };
}

async function connectMongo() {
  // MONGODB_URI_FALLBACK: standard (non-SRV) URI for networks where Node's
  // DNS SRV lookups are blocked (common on office VPNs).
  const uris = [process.env.MONGODB_URI, process.env.MONGODB_URI_FALLBACK].filter(Boolean);
  for (const uri of uris) {
    try {
      const { c, d } = await tryConnect(uri);
      client = c; db = d; mode = 'mongodb';
      return true;
    } catch (err) {
      console.error(`MongoDB connect failed (${uri.slice(0, 20)}…):`, err.message);
    }
  }
  if (uris.length) console.error('All MongoDB URIs failed — using in-memory storage');
  client = null; db = null; mode = 'memory';
  return false;
}

function init() {
  if (!initPromise) initPromise = connectMongo();
  return initPromise;
}

function storageMode() { return mode; }

async function listDatasets() {
  await init();
  if (mode === 'mongodb') {
    const docs = await db.collection('datasets')
      .find({}, { projection: { name: 1, createdAt: 1, rowCount: 1, columnCount: 1, quality: 1 } })
      .sort({ createdAt: -1 }).toArray();
    return docs.map((d) => ({ id: d._id, name: d.name, createdAt: d.createdAt, rowCount: d.rowCount, columnCount: d.columnCount, qualityScore: d.quality }));
  }
  return [...mem.datasets.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, rowCount: d.rowCount, columnCount: d.columnCount, qualityScore: d.profile.quality.score }));
}

async function getDataset(id) {
  await init();
  if (mode === 'mongodb') {
    const d = await db.collection('datasets').findOne({ _id: id });
    if (!d) return null;
    return { id: d._id, name: d.name, createdAt: d.createdAt, headers: d.headers, rowCount: d.rowCount, columnCount: d.columnCount, profile: d.profile };
  }
  const d = mem.datasets.get(id);
  return d ? { ...d } : null;
}

async function insertDataset(id, { name, headers, rows, profile }) {
  const createdAt = new Date().toISOString();
  const meta = { name, createdAt, headers, rowCount: rows.length, columnCount: headers.length, profile };
  if (mode === 'mongodb') {
    await db.collection('datasets').insertOne({ _id: id, ...meta, quality: profile.quality.score });
    const batches = [];
    for (let i = 0; i < rows.length; i += ROW_BATCH) {
      batches.push({ datasetId: id, batch: i / ROW_BATCH, rows: rows.slice(i, i + ROW_BATCH) });
    }
    if (batches.length) await db.collection('rows').insertMany(batches);
  } else {
    mem.datasets.set(id, { id, ...meta });
    mem.rows.set(id, rows);
  }
  return { id, ...meta };
}

async function createDataset(fields) {
  await init();
  return insertDataset(crypto.randomUUID(), fields);
}

// Atomic "insert if this id doesn't exist yet" — used for seeding a fixed-id
// demo dataset safely across concurrent serverless cold starts. Two instances
// racing to seed at once will both attempt the same insert; MongoDB's unique
// _id index lets exactly one succeed, and the loser gets a duplicate-key
// error (code 11000) here, which we treat as "already seeded" rather than
// a real failure. Returns the created dataset, or null if it already existed.
async function createDatasetIfAbsent(id, fields) {
  await init();
  if (mode === 'mongodb') {
    try {
      return await insertDataset(id, fields);
    } catch (err) {
      if (err && err.code === 11000) return null;
      throw err;
    }
  }
  if (mem.datasets.has(id)) return null;
  return insertDataset(id, fields);
}

async function getRows(id) {
  await init();
  if (mode === 'mongodb') {
    const batches = await db.collection('rows').find({ datasetId: id }).sort({ batch: 1 }).toArray();
    return batches.flatMap((b) => b.rows);
  }
  return mem.rows.get(id) || [];
}

async function deleteDataset(id) {
  await init();
  if (mode === 'mongodb') {
    await db.collection('datasets').deleteOne({ _id: id });
    await db.collection('rows').deleteMany({ datasetId: id });
    await db.collection('chats').deleteMany({ datasetId: id });
    return;
  }
  mem.datasets.delete(id); mem.rows.delete(id); mem.chats.delete(id);
}

async function getChat(id) {
  await init();
  if (mode === 'mongodb') {
    const doc = await db.collection('chats').findOne({ datasetId: id });
    return doc ? doc.messages : [];
  }
  return mem.chats.get(id) || [];
}

async function appendChat(id, newMessages) {
  await init();
  if (mode === 'mongodb') {
    await db.collection('chats').updateOne(
      { datasetId: id },
      { $push: { messages: { $each: newMessages, $slice: -60 } } },
      { upsert: true },
    );
    return;
  }
  const msgs = mem.chats.get(id) || [];
  msgs.push(...newMessages);
  mem.chats.set(id, msgs.slice(-60));
}

async function countDatasets() {
  await init();
  if (mode === 'mongodb') return db.collection('datasets').countDocuments();
  return mem.datasets.size;
}

module.exports = { init, storageMode, listDatasets, getDataset, createDataset, createDatasetIfAbsent, getRows, deleteDataset, getChat, appendChat, countDatasets };
