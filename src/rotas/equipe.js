// Painéis da equipe: atendimento (confirmação e pedidos de balcão/telefone) e cozinha (Módulo 2: RF07, RF08, RF10)
const { todos, um } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { exigirLogin, exigirEquipe, exigirPerfil } = require('../lib/sessao');
const { opcao, dataLocal, inicioDiaUTC, fimDiaUTC, minutosEntre, agoraISO } = require('../lib/util');
const pedidos = require('../services/pedidos');
const notificacoes = require('../services/notificacoes');

const STATUS = ['aguardando_confirmacao', 'recebido', 'em_preparo', 'pronto', 'despachado', 'a_caminho', 'entregue', 'cancelado'];

// Busca pedidos com itens e pagamento (uma consulta para os itens de todos os pedidos)
function listarPedidos(where, ...params) {
  const lista = todos(`SELECT p.*, pg.status AS pagamento_status, e.nome AS entregador_nome
                       FROM pedidos p LEFT JOIN pagamentos pg ON pg.pedido_id = p.id
                       LEFT JOIN entregadores e ON e.id = p.entregador_id
                       WHERE ${where} ORDER BY p.criado_em`, ...params);
  if (!lista.length) return lista;
  const itens = todos(`SELECT * FROM itens_pedido WHERE pedido_id IN (${lista.map(() => '?').join(',')}) ORDER BY id`, ...lista.map((p) => p.id));
  for (const p of lista) p.itens = itens.filter((i) => i.pedido_id === p.id);
  return lista;
}

module.exports = (app) => {
  // ---- Atendimento: pedidos ativos + concluídos/cancelados do dia ----
  app.get('/api/equipe/pedidos', exigirEquipe, (ctx) => {
    const dia = ctx.query.data || dataLocal();
    const ativos = pedidos.STATUS_ATIVOS;
    return listarPedidos(
      `(p.status IN (${ativos.map(() => '?').join(',')}) OR (p.criado_em >= ? AND p.criado_em < ?))`,
      ...ativos, inicioDiaUTC(dia), fimDiaUTC(dia),
    );
  });

  // Mudança de status pela equipe (as permissões de cada perfil estão em services/pedidos.js)
  app.post('/api/equipe/pedidos/:codigo/status', exigirEquipe, (ctx) => {
    const novo = opcao(ctx.body.status, 'status', STATUS);
    return pedidos.mudarStatus(ctx, ctx.params.codigo, novo, {
      motivo: ctx.body.motivo, entregadorId: ctx.body.entregador_id, observacao: ctx.body.observacao,
    });
  });

  // Pedido registrado pelo atendente (telefone, WhatsApp ou balcão) — substitui as anotações em papel
  app.post('/api/equipe/pedidos', exigirPerfil('atendente'), (ctx) => {
    ctx.status = 201;
    return pedidos.criar(ctx, ctx.body);
  });

  // ---- Cozinha (RF07): fila de preparo em tempo real + indicadores de desempenho (RF10) ----
  app.get('/api/equipe/cozinha', exigirPerfil('cozinha', 'atendente'), () => {
    const agora = agoraISO();
    const fila = listarPedidos("p.status IN ('recebido','em_preparo')").map((p) => {
      const decorrido = minutosEntre(p.preparo_inicio_em || p.confirmado_em, agora);
      return { ...p, minutos_decorridos: Math.floor(decorrido), atrasado: p.status === 'em_preparo' && decorrido > p.preparo_estimado_min };
    });
    const prontos = listarPedidos("p.status = 'pronto' OR (p.pronto_em >= ? AND p.status <> 'cancelado')", inicioDiaUTC(dataLocal()))
      .sort((a, b) => (b.pronto_em || '').localeCompare(a.pronto_em || '')).slice(0, 8);

    // RF10: tempo de preparo registrado em cada pedido → média do dia
    const hoje = um(`SELECT COUNT(*) AS pedidos, AVG(tempo_preparo_seg) AS media_seg,
                      SUM(CASE WHEN tempo_preparo_seg > preparo_estimado_min * 60 THEN 1 ELSE 0 END) AS fora_do_prazo
                     FROM pedidos WHERE tempo_preparo_seg IS NOT NULL AND pronto_em >= ?`, inicioDiaUTC(dataLocal()));
    return {
      fila,
      prontos,
      indicadores: {
        preparados_hoje: hoje.pedidos,
        tempo_medio_min: hoje.media_seg ? Math.round(hoje.media_seg / 6) / 10 : null,
        fora_do_prazo: hoje.fora_do_prazo || 0,
        em_preparo: fila.filter((p) => p.status === 'em_preparo').length,
        aguardando: fila.filter((p) => p.status === 'recebido').length,
      },
    };
  });

  // ---- Notificações (cliente e equipe) ----
  app.get('/api/notificacoes', exigirLogin, (ctx) => {
    const lista = notificacoes.listar(ctx.usuario);
    return { naoLidas: lista.filter((n) => !n.lida).length, lista };
  });
  app.post('/api/notificacoes/lidas', exigirLogin, (ctx) => {
    notificacoes.marcarLidas(ctx.usuario);
    return { ok: true };
  });

  // Entregadores ativos (usados no despacho — Módulo 3)
  app.get('/api/equipe/entregadores', exigirEquipe, () => todos('SELECT * FROM entregadores WHERE ativo = 1 ORDER BY nome'));

  app.get('/api/equipe/pedidos/:codigo', exigirEquipe, (ctx) => {
    const p = pedidos.obter(ctx.params.codigo);
    if (!p) throw new HttpError(404, 'Pedido não encontrado');
    return p;
  });
};