// SQLite + Sequelize bootstrap.
// DB stores metadata indices (canvases, nodes, hotspots) for fast queries
// (gallery list, spatial dedup). The filesystem under data/canvases/<id>/
// remains the source of truth for tree.json / nodes/<hash>.json / images/.
import { Sequelize, DataTypes } from 'sequelize';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { log } from '../lib/log.js';

let sequelize = null;

function getDbPath() {
  return process.env.DB_PATH || path.join(config.dataDir, 'flipbook.sqlite');
}

export function getSequelize() {
  if (sequelize) return sequelize;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: process.env.DEBUG_SQL ? (msg) => log.debug('[sql]', msg) : false,
  });
  return sequelize;
}

// --- Models ---

export function defineModels(s = getSequelize()) {
  const Canvas = s.define('Canvas', {
    canvasId: { type: DataTypes.STRING(64), primaryKey: true },
    topic:    { type: DataTypes.TEXT, allowNull: false },
    slug:     { type: DataTypes.STRING(120), allowNull: false },
    branches: { type: DataTypes.INTEGER, defaultValue: 5 },
    rootHash: { type: DataTypes.STRING(12), allowNull: true },
    coverImage: { type: DataTypes.STRING(255), allowNull: true }, // server-relative URL
    nodeCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    lastRunAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: 'canvases',
    timestamps: false,
    indexes: [{ fields: ['lastRunAt'] }],
  });

  const Node = s.define('Node', {
    canvasId:   { type: DataTypes.STRING(64), allowNull: false },
    hash:       { type: DataTypes.STRING(12), allowNull: false },
    parentHash: { type: DataTypes.STRING(12), allowNull: true },
    depth:      { type: DataTypes.INTEGER, allowNull: false },
    title:      { type: DataTypes.TEXT, allowNull: false },
    imageRel:   { type: DataTypes.STRING(255), allowNull: true }, // "images/<hash>.png"
    createdAt:  { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: 'nodes',
    timestamps: false,
    indexes: [
      { fields: ['canvasId'] },
      { fields: ['canvasId', 'parentHash'] },
      { fields: ['canvasId', 'hash'], unique: true },
    ],
  });

  // Spatial hotspot index: each row is one place the user clicked on a parent
  // image and got back a child node. We use this for spatial dedup queries.
  const Hotspot = s.define('Hotspot', {
    id:         { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    canvasId:   { type: DataTypes.STRING(64), allowNull: false },
    parentHash: { type: DataTypes.STRING(12), allowNull: false },
    childHash:  { type: DataTypes.STRING(12), allowNull: true }, // null until generation succeeds
    label:      { type: DataTypes.TEXT, allowNull: false },
    anchorX:    { type: DataTypes.FLOAT, allowNull: false }, // 0..1
    anchorY:    { type: DataTypes.FLOAT, allowNull: false },
    leaderX:    { type: DataTypes.FLOAT, allowNull: false },
    leaderY:    { type: DataTypes.FLOAT, allowNull: false },
    createdAt:  { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: 'hotspots',
    timestamps: false,
    indexes: [
      { fields: ['canvasId', 'parentHash'] },
      { fields: ['childHash'] },
    ],
  });

  // Read-only share tokens. Anyone with the token can subscribe to live SSE
  // and view the canvas, but cannot trigger new clicks.
  const ShareLink = s.define('ShareLink', {
    token:     { type: DataTypes.STRING(32), primaryKey: true },
    canvasId:  { type: DataTypes.STRING(64), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'share_links',
    timestamps: false,
    indexes: [{ fields: ['canvasId'] }],
  });

  // Web-search source records. One row per node × external link.
  const Source = s.define('Source', {
    id:        { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    canvasId:  { type: DataTypes.STRING(64), allowNull: false },
    nodeHash:  { type: DataTypes.STRING(12), allowNull: false },
    position:  { type: DataTypes.INTEGER, allowNull: false }, // ordering within a node
    title:     { type: DataTypes.TEXT, allowNull: false },
    url:       { type: DataTypes.TEXT, allowNull: false },
    snippet:   { type: DataTypes.TEXT, allowNull: true },
    source:    { type: DataTypes.STRING(120), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: 'sources',
    timestamps: false,
    indexes: [
      { fields: ['canvasId', 'nodeHash'] },
    ],
  });

  return { Canvas, Node, Hotspot, ShareLink, Source };
}

let cachedModels = null;
export function models() {
  if (!cachedModels) cachedModels = defineModels();
  return cachedModels;
}

export async function initDb() {
  const s = getSequelize();
  defineModels(s);
  await s.authenticate();
  await s.sync(); // creates tables if missing
  log.info(`[db] ready at ${getDbPath()}`);
}

export async function closeDb() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
    cachedModels = null;
  }
}
