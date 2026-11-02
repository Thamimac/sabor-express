// Confere se o banco foi criado corretamente: node scripts/verificar-banco.js
const { getDb, todos } = require('../src/db/database');
const config = require('../src/config');

getDb();
const tabelas = todos("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
console.log(`Banco: ${config.dbPath}`);
console.log(`${tabelas.length} tabelas criadas:`);
tabelas.forEach((t) => console.log(`  - ${t.name}`));
