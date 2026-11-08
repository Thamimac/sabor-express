// Programa de fidelidade: a cada 10 pedidos entregues, o cliente ganha uma entrega grátis.
// Se o pedido que usou a entrega grátis for cancelado, o benefício volta para o cliente.
const config = require('../config');
const { um, executar } = require('../db/database');
const { agoraISO } = require('../lib/util');

function situacao(clienteId) {
  const meta = config.fidelidade.pedidosPorPremio;
  const entregues = um("SELECT COUNT(*) AS n FROM pedidos WHERE cliente_id = ? AND status = 'entregue'", clienteId).n;
  const usadas = um(`SELECT COUNT(*) AS n FROM fidelidade_usos f JOIN pedidos p ON p.id = f.pedido_id
                     WHERE f.cliente_id = ? AND p.status <> 'cancelado'`, clienteId).n;
  const ganhas = Math.floor(entregues / meta);
  const progresso = entregues % meta;
  return { meta, entregues, ganhas, usadas, disponiveis: Math.max(0, ganhas - usadas), progresso, faltam: meta - progresso };
}

function registrarUso(pedidoId, clienteId, valorCentavos) {
  executar('INSERT INTO fidelidade_usos (pedido_id, cliente_id, valor_centavos, criado_em) VALUES (?, ?, ?, ?)',
    pedidoId, clienteId, valorCentavos, agoraISO());
}

const usouNoPedido = (pedidoId) => !!um('SELECT 1 AS sim FROM fidelidade_usos WHERE pedido_id = ?', pedidoId);

module.exports = { situacao, registrarUso, usouNoPedido };