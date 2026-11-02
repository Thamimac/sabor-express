// Notificações automáticas (RF09): reage às mudanças de status dos pedidos
const { um, todos, executar } = require('../db/database');
const { agoraISO } = require('../lib/util');
const { barramento, publicar } = require('./eventos');
const { enviarEmail } = require('./email');

// destino: 'cliente' (usa usuarioId) ou o perfil da equipe que deve ser avisado
function notificar({ destino, usuarioId = null, pedido, mensagem }) {
  executar('INSERT INTO notificacoes (usuario_id, destino, pedido_id, mensagem, criado_em) VALUES (?, ?, ?, ?, ?)',
    usuarioId, destino, pedido?.id ?? null, mensagem, agoraISO());
  const dados = { mensagem, codigo: pedido?.codigo ?? null, destino };
  if (destino === 'cliente') publicar('notificacao', dados, { clienteId: usuarioId, perfis: [] });
  else publicar('notificacao', dados, { perfis: [destino] });
}

function mensagemParaCliente(p) {
  switch (p.status) {
    case 'recebido': return `Seu pedido ${p.codigo} foi confirmado pelo restaurante.`;
    case 'em_preparo': return `Seu pedido ${p.codigo} está sendo preparado.`;
    case 'pronto':
      if (p.modalidade === 'retirada') return `Seu pedido ${p.codigo} está pronto! Pode retirar no balcão.`;
      if (p.modalidade === 'salao') return `Seu pedido ${p.codigo} está pronto e já vai para a mesa ${p.mesa}.`;
      return `Seu pedido ${p.codigo} está pronto e aguarda o entregador.`;
    case 'a_caminho': return `Seu pedido ${p.codigo} saiu para entrega${p.entregador ? ` com ${p.entregador.nome}` : ''}.`;
    case 'entregue': return `Pedido ${p.codigo} entregue. Bom apetite!`;
    case 'cancelado': return `Seu pedido ${p.codigo} foi cancelado. ${p.motivo_cancelamento || ''}`.trim();
    default: return null;
  }
}

// Novo pedido: avisa o atendimento
barramento.on('pedido:criado', ({ pedido }) => {
  const onde = { entrega: 'entrega', retirada: 'retirada', salao: `mesa ${pedido.mesa}` }[pedido.modalidade];
  notificar({ destino: 'atendente', pedido, mensagem: `Novo pedido ${pedido.codigo} (${onde}) aguardando confirmação.` });
});

barramento.on('pedido:status', ({ pedido, anterior, ctx }) => {
  // Cliente acompanha cada etapa (se o pedido tiver um cliente cadastrado e não foi ele quem fez a ação)
  const msg = mensagemParaCliente(pedido);
  const voltouParaFila = pedido.status === 'pronto' && anterior === 'despachado'; // entregador recusou: não repete o aviso
  if (msg && pedido.cliente_id && ctx?.usuario?.id !== pedido.cliente_id && !voltouParaFila) {    notificar({ destino: 'cliente', usuarioId: pedido.cliente_id, pedido, mensagem: msg });
  }
  if (pedido.status === 'cancelado' && ctx?.usuario?.id === pedido.cliente_id) {
    notificar({ destino: 'atendente', pedido, mensagem: `O cliente cancelou o pedido ${pedido.codigo}.` });
  }

  // Pedido confirmado: entra na fila da cozinha
  if (pedido.status === 'recebido') {
    notificar({ destino: 'cozinha', pedido, mensagem: `Novo pedido ${pedido.codigo} na fila de preparo.` });
  }

  // RF09: pedido pronto → avisa automaticamente o cliente (também por e-mail) e a logística
  if (pedido.status === 'pronto' && anterior === 'em_preparo') {
    if (pedido.cliente_id) {
      const cliente = um('SELECT email, nome FROM usuarios WHERE id = ? AND ativo = 1', pedido.cliente_id);
      if (cliente) enviarEmail(cliente.email, `Sabor Express — Pedido ${pedido.codigo} pronto`, `Olá, ${cliente.nome}! ${msg}`);
    }
    if (pedido.modalidade === 'entrega') {
      notificar({ destino: 'logistica', pedido, mensagem: `Pedido ${pedido.codigo} pronto para despacho (${pedido.endereco_texto}).` });
    } else {
      notificar({ destino: 'atendente', pedido, mensagem: `Pedido ${pedido.codigo} pronto para ${pedido.modalidade === 'salao' ? `servir na mesa ${pedido.mesa}` : 'retirada no balcão'}.` });
    }
  }
});

// Lista as notificações visíveis para o usuário logado
function listar(usuario, limite = 20) {
  if (!usuario.equipe) {
    return todos('SELECT * FROM notificacoes WHERE usuario_id = ? ORDER BY id DESC LIMIT ?', usuario.id, limite);
  }
  if (usuario.perfil === 'gerente') {
    return todos("SELECT * FROM notificacoes WHERE destino <> 'cliente' ORDER BY id DESC LIMIT ?", limite);
  }
  return todos('SELECT * FROM notificacoes WHERE destino = ? ORDER BY id DESC LIMIT ?', usuario.perfil, limite);
}

function marcarLidas(usuario) {
  if (!usuario.equipe) executar('UPDATE notificacoes SET lida = 1 WHERE usuario_id = ?', usuario.id);
  else if (usuario.perfil === 'gerente') executar("UPDATE notificacoes SET lida = 1 WHERE destino <> 'cliente'");
  else executar('UPDATE notificacoes SET lida = 1 WHERE destino = ?', usuario.perfil);
}



module.exports = { notificar, listar, marcarLidas };