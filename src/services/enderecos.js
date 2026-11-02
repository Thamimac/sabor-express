// Endereços de entrega dos clientes (RF21 e RF24)
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { texto, inteiro, agoraISO } = require('../lib/util');
const regras = require('./regras');

const LIMITE_ENDERECOS = 10;

function validar(dados = {}) {
  const cep = texto(dados.cep, 'CEP', { obrigatorio: false, max: 9 });
  if (cep && !/^\d{5}-?\d{3}$/.test(cep)) throw new HttpError(422, 'CEP inválido (use 00000-000)');
  const bairroId = inteiro(dados.bairro_id, 'bairro', { min: 1 });
  regras.bairroPorId(bairroId); // garante que o bairro existe
  return {
    apelido: texto(dados.apelido, 'apelido', { obrigatorio: false, max: 30 }) || 'Casa',
    cep: cep ? cep.replace(/^(\d{5})-?(\d{3})$/, '$1-$2') : null,
    logradouro: texto(dados.logradouro, 'rua/avenida', { min: 3, max: 120 }),
    numero: texto(dados.numero, 'número', { max: 10 }),
    complemento: texto(dados.complemento, 'complemento', { obrigatorio: false, max: 60 }),
    bairro_id: bairroId,
    referencia: texto(dados.referencia, 'ponto de referência', { obrigatorio: false, max: 120 }),
  };
}

// Acrescenta distância, taxa e se o endereço está dentro da área de entrega
function comEntrega(e) {
  const atende = regras.dentroDoRaio(e.distancia_km);
  return {
    ...e,
    principal: !!e.principal,
    atende,
    taxa_centavos: atende ? regras.taxaEntrega(e.distancia_km) : null,
    texto: formatar(e),
  };
}

function formatar(e) {
  return `${e.logradouro}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''} - ${e.bairro}${e.cep ? ` - CEP ${e.cep}` : ''}`;
}

const SELECT = `SELECT e.*, b.nome AS bairro, b.distancia_km FROM enderecos e JOIN bairros b ON b.id = e.bairro_id`;

function listar(usuarioId) {
  return todos(`${SELECT} WHERE e.usuario_id = ? ORDER BY e.principal DESC, e.id`, usuarioId).map(comEntrega);
}

function obter(usuarioId, id) {
  const e = um(`${SELECT} WHERE e.usuario_id = ? AND e.id = ?`, usuarioId, Number(id));
  if (!e) throw new HttpError(404, 'Endereço não encontrado');
  return comEntrega(e);
}

function criar(usuarioId, dados) {
  const d = validar(dados);
  const { n } = um('SELECT COUNT(*) AS n FROM enderecos WHERE usuario_id = ?', usuarioId);
  if (n >= LIMITE_ENDERECOS) throw new HttpError(422, `Limite de ${LIMITE_ENDERECOS} endereços atingido`);
  const principal = n === 0 || dados.principal ? 1 : 0;
  if (principal) executar('UPDATE enderecos SET principal = 0 WHERE usuario_id = ?', usuarioId);
  const { id } = executar(
    `INSERT INTO enderecos (usuario_id, apelido, cep, logradouro, numero, complemento, bairro_id, referencia, principal, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    usuarioId, d.apelido, d.cep, d.logradouro, d.numero, d.complemento, d.bairro_id, d.referencia, principal, agoraISO(),
  );
  return obter(usuarioId, id);
}

function atualizar(usuarioId, id, dados) {
  obter(usuarioId, id);
  const d = validar(dados);
  executar(
    `UPDATE enderecos SET apelido = ?, cep = ?, logradouro = ?, numero = ?, complemento = ?, bairro_id = ?, referencia = ?
     WHERE id = ? AND usuario_id = ?`,
    d.apelido, d.cep, d.logradouro, d.numero, d.complemento, d.bairro_id, d.referencia, Number(id), usuarioId,
  );
  return obter(usuarioId, id);
}

function definirPrincipal(usuarioId, id) {
  obter(usuarioId, id);
  executar('UPDATE enderecos SET principal = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE usuario_id = ?', Number(id), usuarioId);
}

function remover(usuarioId, id) {
  const e = obter(usuarioId, id);
  executar('DELETE FROM enderecos WHERE id = ? AND usuario_id = ?', Number(id), usuarioId);
  if (e.principal) {
    executar(`UPDATE enderecos SET principal = 1 WHERE id = (SELECT MIN(id) FROM enderecos WHERE usuario_id = ?)`, usuarioId);
  }
}

module.exports = { validar, listar, obter, criar, atualizar, definirPrincipal, remover, formatar, comEntrega };