// Módulo 1 — Cardápio e pedidos (RF01 a RF06) + canal de tempo real
const { HttpError } = require('../lib/erros');
const { exigirLogin } = require('../lib/sessao');
const pedidos = require('../services/pedidos');
const regras = require('../services/regras');
const { conectar } = require('../services/eventos');

module.exports = (app) => {
  // RF01 — Cardápio digital por categorias (público)
  app.get('/api/cardapio', () => ({
    funcionamento: regras.situacaoFuncionamento(),
    categorias: pedidos.cardapio(),
  }));

  // RF03 — Prévia do pedido: subtotal, taxa de entrega, total e previsão
  app.post('/api/pedidos/simular', exigirLogin, (ctx) => pedidos.resumoSimulacao(pedidos.montar(ctx.usuario, ctx.body)));

  // RF02, RF04, RF05 — Enviar o pedido
  app.post('/api/pedidos', exigirLogin, (ctx) => {
    ctx.status = 201;
    return pedidos.criar(ctx, ctx.body);
  });

  // RF05 — Confirmação / acompanhamento do pedido
  app.get('/api/pedidos/:codigo', exigirLogin, (ctx) => pedidos.obterPermitido(ctx.usuario, ctx.params.codigo));

  // RF06 — Cancelamento pelo cliente enquanto "aguardando confirmação"
  app.post('/api/pedidos/:codigo/cancelar', exigirLogin, (ctx) => {
    const p = pedidos.obterPermitido(ctx.usuario, ctx.params.codigo);
    if (p.status === 'cancelado') throw new HttpError(422, 'Este pedido já foi cancelado');
    if (!ctx.usuario.equipe && p.status !== 'aguardando_confirmacao') {
      throw new HttpError(422, 'O pedido já foi confirmado pelo restaurante e não pode mais ser cancelado pelo site. Ligue para nós.');
    }
    return pedidos.mudarStatus(ctx, p.id, 'cancelado', { motivo: ctx.body.motivo });
  });

  // Tempo real: o navegador fica "ouvindo" mudanças de status
  app.get('/api/eventos', exigirLogin, (ctx) => conectar(ctx));
};