// Módulo 1 — Cardápio e pedidos (RF01 a RF06) + canal de tempo real
const { HttpError } = require('../lib/erros');
const { exigirLogin } = require('../lib/sessao');
const { um, executar } = require('../db/database');
const { inteiro, texto, agoraISO } = require('../lib/util');
const auditoria = require('../services/auditoria');
const pedidos = require('../services/pedidos');
const regras = require('../services/regras');
const { conectar } = require('../services/eventos');
const rastreamento = require('../services/rastreamento');
const config = require('../config');

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

    // Acompanhamento da entrega pelo cliente: onde está o entregador e quando chega (mapa na tela do pedido)
  app.get('/api/pedidos/:codigo/rastreio', exigirLogin, (ctx) => {
    const { codigo } = pedidos.obterPermitido(ctx.usuario, ctx.params.codigo); // só o dono do pedido (ou a equipe)
    const p = um(`SELECT p.*, b.nome AS bairro_nome, e.nome AS entregador_nome, e.veiculo AS entregador_veiculo
                  FROM pedidos p LEFT JOIN bairros b ON b.id = p.bairro_id LEFT JOIN entregadores e ON e.id = p.entregador_id
                  WHERE p.codigo = ?`, codigo);
    if (p.modalidade !== 'entrega' || !['pronto', 'despachado', 'a_caminho'].includes(p.status)) return { ativo: false, status: p.status };
    const e = rastreamento.estadoDaEntrega(p, { nome: p.bairro_nome });
    const { nome, endereco, lat, lng } = config.restaurante;
    // Para o cliente vão só os dados da própria entrega (sem prazos internos do SLA)
    return {
      ativo: true, status: p.status, bairro: p.bairro_nome,
      restaurante: { nome, endereco, lat, lng }, destino: e.destino, posicao: e.posicao,
      progresso: e.progresso, origem: e.origem, km_restantes: e.km_restantes ?? p.distancia_km,
      minutos_restantes: e.minutos_restantes, chegada_prevista: e.chegada_prevista,
      entregador: p.entregador_nome ? { nome: p.entregador_nome, veiculo: p.entregador_veiculo } : null,
      atualizado_em: agoraISO(),
    };
  });

  // RF06 — Cancelamento pelo cliente enquanto "aguardando confirmação"
  app.post('/api/pedidos/:codigo/cancelar', exigirLogin, (ctx) => {
    const p = pedidos.obterPermitido(ctx.usuario, ctx.params.codigo);
    if (p.status === 'cancelado') throw new HttpError(422, 'Este pedido já foi cancelado');
    if (!ctx.usuario.equipe && p.status !== 'aguardando_confirmacao') {
      throw new HttpError(422, 'O pedido já foi confirmado pelo restaurante e não pode mais ser cancelado pelo site. Ligue para nós.');
    }
    return pedidos.mudarStatus(ctx, p.id, 'cancelado', { motivo: ctx.body.motivo });
  });

  // Avaliação do pedido pelo cliente depois da entrega (satisfação: nota de 1 a 5)
  app.post('/api/pedidos/:codigo/avaliacao', exigirLogin, (ctx) => {
    const p = pedidos.obterPermitido(ctx.usuario, ctx.params.codigo);
    if (p.cliente_id !== ctx.usuario.id) throw new HttpError(403, 'Somente o cliente do pedido pode avaliá-lo');
    if (p.status !== 'entregue') throw new HttpError(422, 'O pedido só pode ser avaliado depois de entregue');
    if (um('SELECT id FROM avaliacoes WHERE pedido_id = ?', p.id)) throw new HttpError(409, 'Este pedido já foi avaliado');
    const nota = inteiro(ctx.body.nota, 'nota', { min: 1, max: 5 });
    executar('INSERT INTO avaliacoes (pedido_id, cliente_id, nota, comentario, criado_em) VALUES (?, ?, ?, ?, ?)',
      p.id, ctx.usuario.id, nota, texto(ctx.body.comentario, 'comentário', { obrigatorio: false, max: 300 }), agoraISO());
    auditoria.registrar(ctx, 'pedido_avaliado', { entidade: 'pedido', id: p.codigo, detalhes: { nota } });
    ctx.status = 201;
    return pedidos.obter(p.id);
  });

  // Tempo real: o navegador fica "ouvindo" mudanças de status
  app.get('/api/eventos', exigirLogin, (ctx) => conectar(ctx));
};