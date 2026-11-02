// Módulo 3 — Controle da logística terceirizada RotaLog (RF11 a RF15) + SLA + integração
const config = require('../config');
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { exigirPerfil } = require('../lib/sessao');
const { texto, telefone, opcao, agoraISO, dataLocal, inicioDiaUTC, fimDiaUTC, minutosEntre } = require('../lib/util');
const { tokenAleatorio } = require('../lib/seguranca');
const pedidos = require('../services/pedidos');
const regras = require('../services/regras');
const sla = require('../services/sla');
const auditoria = require('../services/auditoria');
const notificacoes = require('../services/notificacoes');
const { publicar } = require('../services/eventos');

const TIPOS_OCORRENCIA = ['atraso', 'endereco_nao_encontrado', 'avaria', 'extravio', 'cliente_ausente', 'outro'];
const NOME_OCORRENCIA = {
  atraso: 'Atraso', endereco_nao_encontrado: 'Endereço não encontrado', avaria: 'Avaria',
  extravio: 'Extravio', cliente_ausente: 'Cliente ausente', outro: 'Outro',
};
const exigirLogistica = exigirPerfil('logistica');

// RF15 — Registro de ocorrência (Gestão de Incidentes - ITIL)
function registrarOcorrencia(ctx, pedido, { tipo, descricao, origem = 'sistema' }) {
  if (pedido.modalidade !== 'entrega') throw new HttpError(422, 'Ocorrências de entrega só valem para pedidos de entrega');
  const t = opcao(tipo, 'tipo de ocorrência', TIPOS_OCORRENCIA);
  const desc = texto(descricao, 'descrição', { obrigatorio: false, max: 300 });
  const { id } = executar(`INSERT INTO ocorrencias (pedido_id, tipo, descricao, registrada_por, origem, criado_em)
                           VALUES (?, ?, ?, ?, ?, ?)`, pedido.id, t, desc, ctx.usuario?.id ?? null, origem, agoraISO());
  auditoria.registrar(ctx, 'ocorrencia_registrada', { entidade: 'pedido', id: pedido.codigo, detalhes: { tipo: t, origem } });
  if (pedido.cliente_id) {
    notificacoes.notificar({ destino: 'cliente', usuarioId: pedido.cliente_id, pedido,
      mensagem: `Ocorrência na entrega do pedido ${pedido.codigo}: ${NOME_OCORRENCIA[t]}. Nossa equipe já está cuidando disso.` });
  }
  notificacoes.notificar({ destino: 'logistica', pedido, mensagem: `Ocorrência "${NOME_OCORRENCIA[t]}" no pedido ${pedido.codigo}.` });
  publicar('pedido', { codigo: pedido.codigo, status: pedido.status }, { clienteId: pedido.cliente_id });
  return um('SELECT * FROM ocorrencias WHERE id = ?', id);
}

// Encontra o entregador pelo documento (ou cadastra) — usado pela integração RotaLog
function entregadorDaRotaLog(dados = {}) {
  const nome = texto(dados.nome, 'nome do entregador', { max: 80 });
  const documento = texto(dados.documento, 'documento do entregador', { obrigatorio: false, max: 20 });
  const existente = documento ? um('SELECT * FROM entregadores WHERE documento = ?', documento) : um('SELECT * FROM entregadores WHERE nome = ?', nome);
  if (existente) return existente;
  const { id } = executar('INSERT INTO entregadores (nome, documento, telefone, veiculo, criado_em) VALUES (?, ?, ?, ?, ?)',
    nome, documento, dados.telefone || null, dados.veiculo || null, agoraISO());
  return um('SELECT * FROM entregadores WHERE id = ?', id);
}

module.exports = (app) => {
  // ---- Painel da logística ----
  app.get('/api/logistica/painel', exigirLogistica, () => {
    const agora = agoraISO();
    const hoje = inicioDiaUTC(dataLocal());
    const lista = todos(`SELECT p.*, e.nome AS entregador_nome, e.telefone AS entregador_telefone, e.veiculo AS entregador_veiculo
                         FROM pedidos p LEFT JOIN entregadores e ON e.id = p.entregador_id
                         WHERE p.modalidade = 'entrega' AND (p.status IN ('em_preparo','pronto','despachado','a_caminho') OR (p.status = 'entregue' AND p.entregue_em >= ?))
                         ORDER BY p.pronto_em, p.criado_em`, hoje);
    const abertas = todos(`SELECT o.*, p.codigo FROM ocorrencias o JOIN pedidos p ON p.id = o.pedido_id
                           WHERE o.resolvida_em IS NULL ORDER BY o.criado_em`);
    for (const p of lista) {
      p.itens_qtd = um('SELECT SUM(quantidade) AS n FROM itens_pedido WHERE pedido_id = ?', p.id).n;
      p.minutos_desde_pronto = p.pronto_em ? Math.floor(minutosEntre(p.pronto_em, p.entregue_em || agora)) : null;
      p.minutos_desde_despacho = p.despachado_em ? Math.floor(minutosEntre(p.despachado_em, p.aceite_em || agora)) : null;
      p.ocorrencias_abertas = abertas.filter((o) => o.pedido_id === p.id).length;
    }
    const ocupados = new Set(lista.filter((p) => ['despachado', 'a_caminho'].includes(p.status)).map((p) => p.entregador_id));
    return {
      sla: config.sla,
      em_preparo: lista.filter((p) => p.status === 'em_preparo'),
      prontos: lista.filter((p) => p.status === 'pronto'),               // RF11: disponíveis para despacho
      despachados: lista.filter((p) => p.status === 'despachado'),
      a_caminho: lista.filter((p) => p.status === 'a_caminho'),
      entregues: lista.filter((p) => p.status === 'entregue').reverse(),
      ocorrencias: abertas,
      entregadores: todos('SELECT * FROM entregadores WHERE ativo = 1 ORDER BY nome').map((e) => ({ ...e, ocupado: ocupados.has(e.id) })),
    };
  });

  // RF12 — Despacho: identifica o entregador responsável pelo pedido
  app.post('/api/logistica/pedidos/:codigo/despachar', exigirLogistica, (ctx) =>
    pedidos.mudarStatus(ctx, ctx.params.codigo, 'despachado', { entregadorId: ctx.body.entregador_id }));

  // RF13 — Atualizações de status da entrega
  app.post('/api/logistica/pedidos/:codigo/a-caminho', exigirLogistica, (ctx) =>
    pedidos.mudarStatus(ctx, ctx.params.codigo, 'a_caminho', { observacao: 'Entregador aceitou e coletou o pedido' }));
  app.post('/api/logistica/pedidos/:codigo/entregue', exigirLogistica, (ctx) =>
    pedidos.mudarStatus(ctx, ctx.params.codigo, 'entregue'));
  app.post('/api/logistica/pedidos/:codigo/devolver', exigirLogistica, (ctx) =>
    pedidos.mudarStatus(ctx, ctx.params.codigo, 'pronto', { observacao: 'Entregador recusou/não respondeu — voltou para a fila de despacho' }));

  // RF14 — Estimativa de entrega com base no endereço (bairro → distância → tempo)
  app.get('/api/logistica/estimativa/:bairroId', exigirLogistica, (ctx) => {
    const b = regras.bairroPorId(ctx.params.bairroId);
    if (!regras.dentroDoRaio(b.distancia_km)) throw new HttpError(422, `${b.nome} está fora do raio de entrega`);
    return { bairro: b.nome, distancia_km: b.distancia_km, minutos: regras.tempoDeslocamentoMin(b.distancia_km), taxa_centavos: regras.taxaEntrega(b.distancia_km) };
  });

  // RF15 — Ocorrências na entrega
  app.post('/api/logistica/pedidos/:codigo/ocorrencias', exigirLogistica, (ctx) => {
    ctx.status = 201;
    return registrarOcorrencia(ctx, pedidos.obter(ctx.params.codigo), ctx.body);
  });
  app.post('/api/logistica/ocorrencias/:id/resolver', exigirLogistica, (ctx) => {
    const o = um('SELECT * FROM ocorrencias WHERE id = ?', Number(ctx.params.id));
    if (!o) throw new HttpError(404, 'Ocorrência não encontrada');
    if (o.resolvida_em) throw new HttpError(422, 'Ocorrência já resolvida');
    executar('UPDATE ocorrencias SET resolucao = ?, resolvida_em = ? WHERE id = ?',
      texto(ctx.body.resolucao, 'resolução', { max: 300 }), agoraISO(), o.id);
    auditoria.registrar(ctx, 'ocorrencia_resolvida', { entidade: 'ocorrencia', id: o.id });
    return um('SELECT * FROM ocorrencias WHERE id = ?', o.id);
  });

  // ---- Cadastro de entregadores da RotaLog (RF12) ----
  app.get('/api/logistica/entregadores', exigirLogistica, () => todos('SELECT * FROM entregadores ORDER BY ativo DESC, nome'));
  app.post('/api/logistica/entregadores', exigirLogistica, (ctx) => {
    const b = ctx.body;
    const { id } = executar('INSERT INTO entregadores (nome, documento, telefone, veiculo, empresa, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      texto(b.nome, 'nome', { min: 3, max: 80 }), texto(b.documento, 'documento', { obrigatorio: false, max: 20 }),
      telefone(b.telefone), texto(b.veiculo, 'veículo', { obrigatorio: false, max: 40 }),
      texto(b.empresa, 'empresa', { obrigatorio: false, max: 60 }) || 'RotaLog Entregas', agoraISO());
    auditoria.registrar(ctx, 'entregador_cadastrado', { entidade: 'entregador', id });
    ctx.status = 201;
    return um('SELECT * FROM entregadores WHERE id = ?', id);
  });
  app.post('/api/logistica/entregadores/:id/ativo', exigirLogistica, (ctx) => {
    executar('UPDATE entregadores SET ativo = ? WHERE id = ?', ctx.body.ativo ? 1 : 0, Number(ctx.params.id));
    auditoria.registrar(ctx, ctx.body.ativo ? 'entregador_ativado' : 'entregador_desativado', { entidade: 'entregador', id: ctx.params.id });
    return { ok: true };
  });

  // ---- SLA da RotaLog (regra de domínio 6) ----
  app.get('/api/logistica/sla', exigirLogistica, (ctx) => {
    const dias = Math.min(Math.max(Number(ctx.query.dias) || 1, 1), 90);
    const fim = fimDiaUTC(dataLocal());
    const inicio = new Date(new Date(fim).getTime() - dias * 86400000).toISOString();
    return { dias, ...sla.calcular(inicio, fim) };
  });

  // ---- Integração: a RotaLog envia atualizações automaticamente (RF12 e RF13 "receber") ----
  app.get('/api/logistica/integracao', exigirPerfil(), (ctx) => {
    const chave = um("SELECT valor FROM configuracoes WHERE chave = 'rotalog_api_key'")?.valor;
    return { endpoint: `http://${ctx.req.headers.host}/api/integracao/rotalog`, cabecalho: 'X-Api-Key', chave };
  });
  app.post('/api/logistica/integracao/nova-chave', exigirPerfil(), (ctx) => {
    executar("UPDATE configuracoes SET valor = ? WHERE chave = 'rotalog_api_key'", tokenAleatorio(24));
    auditoria.registrar(ctx, 'rotalog_chave_renovada');
    return { ok: true };
  });

  app.post('/api/integracao/rotalog', (ctx) => {
    const chave = um("SELECT valor FROM configuracoes WHERE chave = 'rotalog_api_key'")?.valor;
    if (!chave || ctx.req.headers['x-api-key'] !== chave) throw new HttpError(401, 'Chave de integração inválida');
    // A integração age como um usuário técnico do perfil logística
    const ctxIntegracao = { ...ctx, usuario: { id: null, nome: 'Integração RotaLog', perfil: 'logistica', equipe: true } };
    const pedido = pedidos.obter(texto(ctx.body.pedido, 'pedido', { max: 20 }));
    const evento = opcao(ctx.body.evento, 'evento', ['aceito', 'entregue', 'ocorrencia']);

    if (evento === 'aceito') {
      if (pedido.status === 'pronto') {
        const ent = entregadorDaRotaLog(ctx.body.entregador);
        pedidos.mudarStatus(ctxIntegracao, pedido.id, 'despachado', { entregadorId: ent.id, observacao: 'Recebido da RotaLog' });
      }
      return pedidos.mudarStatus(ctxIntegracao, pedido.id, 'a_caminho', { observacao: 'Recebido da RotaLog' });
    }
    if (evento === 'entregue') return pedidos.mudarStatus(ctxIntegracao, pedido.id, 'entregue', { observacao: 'Recebido da RotaLog' });
    return registrarOcorrencia(ctxIntegracao, pedido, { tipo: ctx.body.tipo, descricao: ctx.body.descricao, origem: 'rotalog' });
  });
};