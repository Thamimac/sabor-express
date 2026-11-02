// Módulo 4 — Financeiro: pagamento pelo cliente (RF16), recibo (RF17), relatórios (RF18),
// status de pagamento (RF19), conciliação (RF20) e transações fiscais (regra de domínio 7)
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { exigirLogin, exigirPerfil } = require('../lib/sessao');
const { texto, opcao, agoraISO, dataLocal, inicioDiaUTC, fimDiaUTC, partesLocais } = require('../lib/util');
const pedidos = require('../services/pedidos');
const pagamentos = require('../services/pagamentos');
const auditoria = require('../services/auditoria');

const exigirFinanceiro = exigirPerfil('financeiro');

// Período informado na consulta (padrão: últimos 30 dias)
function periodo(query, diasPadrao = 30) {
  const fim = query.fim || dataLocal();
  const inicio = query.inicio || dataLocal(new Date(new Date(inicioDiaUTC(fim)).getTime() - (diasPadrao - 1) * 86400000));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio > fim) throw new HttpError(422, 'Período inválido');
  return { inicio, fim, inicioUTC: inicioDiaUTC(inicio), fimUTC: fimDiaUTC(fim) };
}

// Chave do agrupamento: dia (AAAA-MM-DD), semana (segunda-feira da semana) ou mês (AAAA-MM)
function chaveGrupo(iso, agrupamento) {
  const dia = dataLocal(iso);
  if (agrupamento === 'mensal') return dia.slice(0, 7);
  if (agrupamento === 'semanal') {
    const d = new Date(`${dia}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // volta até a segunda-feira
    return d.toISOString().slice(0, 10);
  }
  return dia;
}

// Envia um arquivo CSV (abre no Excel) em vez de JSON
function enviarCsv(ctx, nomeArquivo, cabecalho, linhas) {
  const celula = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const conteudo = '\uFEFF' + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nomeArquivo}"` });
  ctx.res.end(conteudo);
  ctx.encerrado = true;
}
const valorCsv = (c) => (c / 100).toFixed(2).replace('.', ',');

// Ticket médio = valor líquido ÷ pagamentos que não foram estornados
const ticket = (g) => (g.pedidos - g.estornos ? Math.round(g.liquido / (g.pedidos - g.estornos)) : 0);

function relatorio(query) {
  const agrupamento = opcao(query.agrupamento || 'diario', 'agrupamento', ['diario', 'semanal', 'mensal']);
  const p = periodo(query, agrupamento === 'mensal' ? 365 : agrupamento === 'semanal' ? 90 : 30);
  const pagos = todos(`SELECT pg.*, pe.modalidade, pe.codigo FROM pagamentos pg JOIN pedidos pe ON pe.id = pg.pedido_id
                       WHERE pg.aprovado_em >= ? AND pg.aprovado_em < ? AND pg.status IN ('aprovado','estornado')`, p.inicioUTC, p.fimUTC);
  const grupos = new Map();
  const vazio = () => ({ pedidos: 0, estornos: 0, bruto: 0, estornado: 0, liquido: 0, porForma: {}, porModalidade: {} });
  const total = vazio();
  for (const pg of pagos) {
    const chave = chaveGrupo(pg.aprovado_em, agrupamento);
    if (!grupos.has(chave)) grupos.set(chave, vazio());
    for (const g of [grupos.get(chave), total]) {
      g.pedidos += 1;
      g.bruto += pg.valor_centavos;
      if (pg.status === 'estornado') { g.estornado += pg.valor_centavos; g.estornos += 1; }
      else {
        g.porForma[pg.forma] = (g.porForma[pg.forma] || 0) + pg.valor_centavos;
        g.porModalidade[pg.modalidade] = (g.porModalidade[pg.modalidade] || 0) + pg.valor_centavos;
      }
      g.liquido = g.bruto - g.estornado;
    }
  }
  const linhas = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, g]) => ({ periodo: chave, ...g, ticketMedio: ticket(g) }));
  return { agrupamento, inicio: p.inicio, fim: p.fim, linhas, total: { ...total, ticketMedio: ticket(total) } };
}

// RF20 — Conciliação: compara o que foi vendido (pedidos) com o que foi recebido (pagamentos)
function conciliacao(query) {
  const p = periodo(query, 7);
  const lista = todos(`SELECT pe.codigo, pe.status AS pedido_status, pe.total_centavos, pe.forma_pagamento, pe.criado_em, pe.cliente_nome,
                         pg.status AS pagamento_status, pg.valor_centavos AS pago_centavos, pg.forma AS pagamento_forma
                       FROM pedidos pe LEFT JOIN pagamentos pg ON pg.pedido_id = pe.id
                       WHERE pe.criado_em >= ? AND pe.criado_em < ? ORDER BY pe.criado_em`, p.inicioUTC, p.fimUTC);
  const divergencias = [];
  let vendido = 0; let recebido = 0; let antecipado = 0; let emAndamento = 0;
  for (const x of lista) {
    const pago = x.pagamento_status === 'aprovado';
    const andamento = !['entregue', 'cancelado'].includes(x.pedido_status);
    if (x.pedido_status === 'entregue') vendido += x.total_centavos;
    if (pago && x.pedido_status === 'entregue') recebido += x.pago_centavos;
    if (pago && andamento) antecipado += x.pago_centavos; // pago pelo site, ainda não entregue
    if (andamento) emAndamento += 1;

    let problema = null;
    if (x.pedido_status === 'entregue' && !pago) problema = 'Pedido entregue sem pagamento aprovado';
    else if (x.pedido_status === 'cancelado' && pago) problema = 'Pedido cancelado com pagamento aprovado (falta estorno)';
    else if (pago && x.pago_centavos !== x.total_centavos) problema = 'Valor pago diferente do total do pedido';
    if (problema) divergencias.push({ ...x, problema });
  }
  const comProblema = new Set(divergencias.map((d) => d.codigo));
  const conciliados = lista.filter((x) => ['entregue', 'cancelado'].includes(x.pedido_status) && !comProblema.has(x.codigo)).length;
  return {
    inicio: p.inicio, fim: p.fim,
    resumo: {
      pedidos: lista.length, conciliados, divergentes: divergencias.length, emAndamento,
      vendidoEntregue: vendido, recebidoDeEntregues: recebido, diferenca: recebido - vendido, recebidoAntecipado: antecipado,
    },
    divergencias,
  };
}

module.exports = (app) => {
  // ================= Cliente: pagar o próprio pedido (RF16) =================
  app.post('/api/pedidos/:codigo/pagar/cartao', exigirLogin, (ctx) =>
    pagamentos.pagarComCartao(ctx, pedidos.obterPermitido(ctx.usuario, ctx.params.codigo), ctx.body));

  app.post('/api/pedidos/:codigo/pagar/pix', exigirLogin, (ctx) =>
    pagamentos.gerarPix(ctx, pedidos.obterPermitido(ctx.usuario, ctx.params.codigo)));

  // Ambiente de testes: simula o banco confirmando o Pix
  app.post('/api/pedidos/:codigo/pagar/pix/confirmar', exigirLogin, (ctx) =>
    pagamentos.confirmarPix(ctx, pedidos.obterPermitido(ctx.usuario, ctx.params.codigo)));

  // RF17 — Recibo (cliente dono do pedido ou equipe)
  app.get('/api/pedidos/:codigo/recibo', exigirLogin, (ctx) =>
    pagamentos.recibo(pedidos.obterPermitido(ctx.usuario, ctx.params.codigo)));

  // ================= Equipe: pagamento presencial =================
  app.post('/api/financeiro/pagamentos/:codigo/receber', exigirPerfil('atendente', 'logistica', 'financeiro'), (ctx) =>
    pagamentos.receberPresencial(ctx, pedidos.obter(ctx.params.codigo), ctx.body.forma));

  // ================= Financeiro =================
  app.get('/api/financeiro/resumo', exigirFinanceiro, () => {
    const hoje = dataLocal();
    const r = relatorio({ agrupamento: 'diario', inicio: hoje, fim: hoje }).total;
    const pendentes = um(`SELECT COUNT(*) AS n, COALESCE(SUM(pg.valor_centavos),0) AS v FROM pagamentos pg JOIN pedidos pe ON pe.id = pg.pedido_id
                          WHERE pg.status IN ('pendente','recusado') AND pe.status <> 'cancelado'`);
    const fiscal = um("SELECT COUNT(*) AS n FROM transacoes_fiscais WHERE status_nf = 'pendente_emissao'").n;
    return { hoje: r, pendentes, fiscalPendente: fiscal, conciliacaoHoje: conciliacao({ inicio: hoje, fim: hoje }).resumo };
  });

  // RF18 — Faturamento diário, semanal e mensal (JSON ou CSV para o Excel)
  app.get('/api/financeiro/relatorio', exigirFinanceiro, (ctx) => {
    const r = relatorio(ctx.query);
    if (ctx.query.formato !== 'csv') return r;
    auditoria.registrar(ctx, 'relatorio_exportado', { detalhes: { agrupamento: r.agrupamento, inicio: r.inicio, fim: r.fim } });
    return enviarCsv(ctx, `faturamento-${r.agrupamento}-${r.inicio}-a-${r.fim}.csv`,
      ['Período', 'Pagamentos', 'Bruto (R$)', 'Estornado (R$)', 'Líquido (R$)', 'Ticket médio (R$)'],
      [...r.linhas.map((l) => [l.periodo, l.pedidos, valorCsv(l.bruto), valorCsv(l.estornado), valorCsv(l.liquido), valorCsv(l.ticketMedio)]),
        ['TOTAL', r.total.pedidos, valorCsv(r.total.bruto), valorCsv(r.total.estornado), valorCsv(r.total.liquido), valorCsv(r.total.ticketMedio)]]);
  });

  // RF19 — Pagamentos e seus status
  app.get('/api/financeiro/pagamentos', exigirFinanceiro, (ctx) => {
    const p = periodo(ctx.query, 7);
    const status = ctx.query.status ? opcao(ctx.query.status, 'status', ['pendente', 'aprovado', 'recusado', 'estornado', 'cancelado']) : null;
    return todos(`SELECT pg.*, pe.codigo, pe.cliente_nome, pe.status AS pedido_status, pe.modalidade, pe.total_centavos
                  FROM pagamentos pg JOIN pedidos pe ON pe.id = pg.pedido_id
                  WHERE pe.criado_em >= ? AND pe.criado_em < ? ${status ? 'AND pg.status = ?' : ''}
                  ORDER BY pe.criado_em DESC`, p.inicioUTC, p.fimUTC, ...(status ? [status] : []));
  });

  app.post('/api/financeiro/pagamentos/:codigo/estornar', exigirFinanceiro, (ctx) =>
    pagamentos.estornar(ctx, pedidos.obter(ctx.params.codigo), ctx.body.motivo));

  // RF20 — Conciliação
  app.get('/api/financeiro/conciliacao', exigirFinanceiro, (ctx) => conciliacao(ctx.query));

  // Regra de domínio 7 — transações para emissão de nota fiscal (enviadas à contabilidade terceirizada)
  app.get('/api/financeiro/fiscal', exigirFinanceiro, (ctx) => {
    const p = periodo(ctx.query, 30);
    const lista = todos(`SELECT tf.*, pe.codigo, pe.cliente_nome, pg.forma FROM transacoes_fiscais tf
                         JOIN pedidos pe ON pe.id = tf.pedido_id JOIN pagamentos pg ON pg.id = tf.pagamento_id
                         WHERE tf.criado_em >= ? AND tf.criado_em < ? ORDER BY tf.criado_em DESC`, p.inicioUTC, p.fimUTC);
    if (ctx.query.formato !== 'csv') return lista;
    auditoria.registrar(ctx, 'fiscal_exportado', { detalhes: { inicio: p.inicio, fim: p.fim } });
    return enviarCsv(ctx, `transacoes-fiscais-${p.inicio}-a-${p.fim}.csv`,
      ['Data', 'Pedido', 'Cliente', 'Forma', 'Valor (R$)', 'Situação NF', 'Número NF'],
      lista.map((t) => [dataLocal(t.criado_em), t.codigo, t.cliente_nome, t.forma, valorCsv(t.valor_centavos), t.status_nf, t.numero_nf || '']));
  });

  app.post('/api/financeiro/fiscal/:id/emitida', exigirFinanceiro, (ctx) => {
    const t = um('SELECT * FROM transacoes_fiscais WHERE id = ?', Number(ctx.params.id));
    if (!t) throw new HttpError(404, 'Transação não encontrada');
    if (t.status_nf !== 'pendente_emissao') throw new HttpError(422, 'Esta transação não está pendente de emissão');
    const numero = texto(ctx.body.numero_nf, 'número da nota', { max: 30 });
    executar("UPDATE transacoes_fiscais SET status_nf = 'emitida', numero_nf = ?, atualizado_em = ? WHERE id = ?", numero, agoraISO(), t.id);
    auditoria.registrar(ctx, 'nota_fiscal_registrada', { entidade: 'transacao_fiscal', id: t.id, detalhes: { numero } });
    return um('SELECT * FROM transacoes_fiscais WHERE id = ?', t.id);
  });
};

module.exports.relatorio = relatorio;
module.exports.conciliacao = conciliacao;