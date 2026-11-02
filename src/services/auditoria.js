// Registro das principais operações para rastreamento (RNF Auditabilidade)
const { executar } = require('../db/database');
const { agoraISO } = require('../lib/util');

function registrar(ctx, acao, { entidade = null, id = null, detalhes = null, usuario = null } = {}) {
  const u = usuario || ctx?.usuario || null;
  executar(
    `INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, ip, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    u?.id ?? null,
    u?.nome ?? null,
    acao,
    entidade,
    id == null ? null : String(id),
    detalhes == null ? null : typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes),
    ctx?.ip ?? null,
    agoraISO(),
  );
}

module.exports = { registrar };