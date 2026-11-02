// Backup automático diário do banco de dados (RNF Confiabilidade)
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { getDb } = require('../db/database');
const { partesLocais } = require('../lib/util');

function listar() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs.readdirSync(config.backupDir)
    .filter((f) => /^sabor-express-.*\.db$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(config.backupDir, f));
      return { arquivo: f, tamanho_kb: Math.round(st.size / 1024), criado_em: st.mtime.toISOString() };
    })
    .sort((a, b) => b.arquivo.localeCompare(a.arquivo));
}

// Cópia consistente do banco, mesmo com o sistema em uso (VACUUM INTO)
function fazerBackup(motivo = 'manual') {
  if (config.dbPath === ':memory:') return null;
  fs.mkdirSync(config.backupDir, { recursive: true });
  const p = partesLocais();
  const carimbo = `${p.data}_${String(p.hora).padStart(2, '0')}-${String(p.minuto).padStart(2, '0')}`;
  const destino = path.join(config.backupDir, `sabor-express-${carimbo}-${motivo}.db`);
  if (fs.existsSync(destino)) fs.rmSync(destino);
  getDb().exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  // Mantém apenas os backups mais recentes
  listar().slice(config.backupsMantidos).forEach((b) => fs.rmSync(path.join(config.backupDir, b.arquivo), { force: true }));
  return listar().find((b) => destino.endsWith(b.arquivo));
}

// Agenda: um backup por dia (verifica a cada hora e na inicialização)
function agendarBackupDiario() {
  const verificar = () => {
    try {
      const hoje = partesLocais().data;
      if (!listar().some((b) => b.arquivo.includes(hoje) && b.arquivo.includes('automatico'))) {
        const b = fazerBackup('automatico');
        if (b) console.log(`  💾 Backup automático criado: backups/${b.arquivo}`);
      }
    } catch (e) {
      console.error('Falha no backup automático:', e.message);
    }
  };
  verificar();
  return setInterval(verificar, 60 * 60 * 1000).unref();
}

module.exports = { listar, fazerBackup, agendarBackupDiario };