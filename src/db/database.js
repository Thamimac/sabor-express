// Conexão com o banco SQLite (módulo nativo node:sqlite, Node.js 22.13+)
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

let db = null;

function abrir(caminho = config.dbPath) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const conexao = new DatabaseSync(caminho);
  conexao.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (caminho !== ':memory:') conexao.exec('PRAGMA journal_mode = WAL;');
  conexao.exec(SCHEMA);
  return conexao;
}

function getDb() {
  if (!db) db = abrir();
  return db;
}

// Usado pelos testes para trocar o banco por um em memória
function usarBanco(conexao) {
  db = conexao;
}

// Executa uma função dentro de uma transação (tudo ou nada)
function transacao(fn) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const r = fn(d);
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

// Converte o resultado do node:sqlite (objetos sem protótipo) em objetos comuns
const um = (sql, ...p) => {
  const r = getDb().prepare(sql).get(...p);
  return r ? { ...r } : null;
};
const todos = (sql, ...p) => getDb().prepare(sql).all(...p).map((r) => ({ ...r }));
const executar = (sql, ...p) => {
  const r = getDb().prepare(sql).run(...p);
  return { alterados: Number(r.changes), id: Number(r.lastInsertRowid) };
};

module.exports = { abrir, getDb, usarBanco, transacao, um, todos, executar };