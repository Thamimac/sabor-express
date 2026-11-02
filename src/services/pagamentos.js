// Módulo 4 — Pagamentos (RF16, RF17, RF19), estorno e registro fiscal (regra de domínio 7)
// O "gateway" é SIMULADO (ambiente de testes): nenhum dado real de cartão é processado.
const config = require('../config');
const { um, executar, transacao } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { texto, opcao, agoraISO, agora, reais } = require('../lib/util');
const { tokenAleatorio } = require('../lib/seguranca');
const auditoria = require('./auditoria');
const { enviarEmail } = require('./email');
const { barramento, publicar } = require('./eventos');

// ---- Cartão: validações feitas antes de "enviar ao gateway" ----
function luhnValido(numero) {
  let soma = 0;
  let dobrar = false;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    let d = Number(numero[i]);
    if (dobrar) { d *= 2; if (d > 9) d -= 9; }
    soma += d;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

function bandeira(numero) {
  if (/^4/.test(numero)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(numero)) return 'Mastercard';
  if (/^3[47]/.test(numero)) return 'American Express';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(numero)) return 'Elo';
  return 'Outra';
}

function validarCartao(dados = {}) {
  const numero = String(dados.numero || '').replace(/\D/g, '');
  if (numero.length < 13 || numero.length > 19 || !luhnValido(numero)) throw new HttpError(422, 'Número do cartão inválido');
  const nome = texto(dados.nome, 'nome impresso no cartão', { min: 3, max: 60 });
  const validade = String(dados.validade || '').trim();
  const m = /^(\d{2})\/(\d{2})$/.exec(validade);
  if (!m || +m[1] < 1 || +m[1] > 12) throw new HttpError(422, 'Validade inválida (use MM/AA)');
  const fimDoMes = new Date(Date.UTC(2000 + +m[2], +m[1], 1));
  if (fimDoMes <= agora()) throw new HttpError(422, 'Cartão vencido');
  if (!/^\d{3,4}$/.test(String(dados.cvv || ''))) throw new HttpError(422, 'Código de segurança (CVV) inválido');
  return { numero, nome };
}

// Gateway simulado: cartões terminados em 0002 são recusados (para demonstrar o RF19)
function gatewaySimulado(numero) {
  if (numero.endsWith('0002')) return { aprovado: false, motivo: 'Transação recusada pela operadora (saldo ou limite insuficiente)' };
  return { aprovado: true, referencia: `GW-${tokenAleatorio(6).toUpperCase()}` };
}

// ---- Situação do pagamento ----
function doPedido(pedido) {
  const pg = um('SELECT * FROM pagamentos WHERE pedido_id = ?', pedido.id);
  if (!pg) throw new HttpError(404, 'Pagamento não encontrado');
  return pg;
}

function exigirPagavel(pedido, pg) {
  if (pedido.status === 'cancelado') throw new HttpError(422, 'Pedido cancelado não pode ser pago');
  if (pg.status === 'aprovado') throw new HttpError(422, 'Este pedido já está pago');
  if (!['pendente', 'recusado'].includes(pg.status)) throw new HttpError(422, `Pagamento ${pg.status}`);
}

// Aprovação: registra a transação fiscal (regra de domínio 7) e envia o recibo (RF17)
function aprovar(ctx, pedido, pg, campos) {
  const agoraTxt = agoraISO();
  transacao(() => {
    executar(`UPDATE pagamentos SET status = 'aprovado', aprovado_em = ?, atualizado_em = ?, motivo = NULL,
              forma = ?, transacao_ref = ?, cartao_final = ?, cartao_bandeira = ?, tentativas = tentativas + ? WHERE id = ?`,
      agoraTxt, agoraTxt, campos.forma || pg.forma, campos.referencia, campos.final ?? pg.cartao_final, campos.bandeira ?? pg.cartao_bandeira,
      campos.tentativa ? 1 : 0, pg.id);
    if (campos.forma && campos.forma !== pedido.forma_pagamento) executar('UPDATE pedidos SET forma_pagamento = ? WHERE id = ?', campos.forma, pedido.id);
    executar(`INSERT INTO transacoes_fiscais (pedido_id, pagamento_id, valor_centavos, criado_em) VALUES (?, ?, ?, ?)`,
      pedido.id, pg.id, pg.valor_centavos, agoraTxt);
  });
  auditoria.registrar(ctx, 'pagamento_aprovado', { entidade: 'pedido', id: pedido.codigo, detalhes: { forma: campos.forma || pg.forma, valor: pg.valor_centavos } });
  if (pedido.cliente_id) {
    const cliente = um('SELECT nome, email FROM usuarios WHERE id = ? AND ativo = 1', pedido.cliente_id);
    if (cliente) {
      enviarEmail(cliente.email, `Sabor Express — Recibo do pedido ${pedido.codigo}`,
        `Olá, ${cliente.nome}! Recebemos o pagamento de ${reais(pg.valor_centavos)} do pedido ${pedido.codigo}.\nRecibo: http://localhost:${config.porta}/recibo?codigo=${pedido.codigo}`);
    }
  }
  publicar('pagamento', { codigo: pedido.codigo, status: 'aprovado' }, { clienteId: pedido.cliente_id });
  return um('SELECT * FROM pagamentos WHERE id = ?', pg.id);
}

// RF16 — Cartão de crédito ou débito (pago pelo cliente no site)
function pagarComCartao(ctx, pedido, dados) {
  const pg = doPedido(pedido);
  exigirPagavel(pedido, pg);
  const forma = opcao(dados.forma || pg.forma, 'forma de pagamento', ['credito', 'debito']);
  const { numero } = validarCartao(dados);
  const resposta = gatewaySimulado(numero);
  const final = numero.slice(-4); // só os 4 últimos dígitos são guardados
  if (!resposta.aprovado) {
    executar(`UPDATE pagamentos SET status = 'recusado', motivo = ?, forma = ?, cartao_final = ?, cartao_bandeira = ?,
              tentativas = tentativas + 1, atualizado_em = ? WHERE id = ?`, resposta.motivo, forma, final, bandeira(numero), agoraISO(), pg.id);
    auditoria.registrar(ctx, 'pagamento_recusado', { entidade: 'pedido', id: pedido.codigo, detalhes: { forma, final } });
    publicar('pagamento', { codigo: pedido.codigo, status: 'recusado' }, { perfis: ['financeiro'] }); // o cliente vê o erro na própria tela
    throw new HttpError(402, resposta.motivo);
  }
  return aprovar(ctx, pedido, pg, { forma, referencia: resposta.referencia, final, bandeira: bandeira(numero), tentativa: true });
}

// RF16 — Pix: gera o código "copia e cola" (simulado)
function gerarPix(ctx, pedido) {
  const pg = doPedido(pedido);
  exigirPagavel(pedido, pg);
  const txid = `SE${pedido.id}${tokenAleatorio(6).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 25);
  const valor = (pg.valor_centavos / 100).toFixed(2);
  const codigo = `00020126580014br.gov.bcb.pix0136pix@saborexpress.com.br5204000053039865406${valor}`
    + `5802BR5913SABOR EXPRESS6009SAO PAULO62${String(txid.length + 4).padStart(2, '0')}05${String(txid.length).padStart(2, '0')}${txid}6304`;
  executar(`UPDATE pagamentos SET forma = 'pix', pix_copia_cola = ?, transacao_ref = ?, status = 'pendente', atualizado_em = ? WHERE id = ?`,
    codigo, txid, agoraISO(), pg.id);
  if (pedido.forma_pagamento !== 'pix') executar("UPDATE pedidos SET forma_pagamento = 'pix' WHERE id = ?", pedido.id);
  return um('SELECT * FROM pagamentos WHERE id = ?', pg.id);
}

// Confirmação do Pix (no mundo real viria do banco; aqui é simulada pelo botão de testes)
function confirmarPix(ctx, pedido) {
  const pg = doPedido(pedido);
  exigirPagavel(pedido, pg);
  if (!pg.pix_copia_cola) throw new HttpError(422, 'Gere o código Pix primeiro');
  return aprovar(ctx, pedido, pg, { forma: 'pix', referencia: pg.transacao_ref });
}

// Pagamento presencial: dinheiro na entrega/balcão ou maquininha no salão
function receberPresencial(ctx, pedido, forma) {
  const pg = doPedido(pedido);
  exigirPagavel(pedido, pg);
  const f = opcao(forma || pg.forma, 'forma de pagamento', ['credito', 'debito', 'pix', 'dinheiro']);
  return aprovar(ctx, pedido, pg, { forma: f, referencia: `PRESENCIAL-${tokenAleatorio(4).toUpperCase()}` });
}

// RF19 — Estorno (status "estornado") e cancelamento da transação fiscal
function estornar(ctx, pedido, motivo) {
  const pg = doPedido(pedido);
  if (pg.status !== 'aprovado') throw new HttpError(422, 'Só é possível estornar pagamentos aprovados');
  const m = texto(motivo, 'motivo do estorno', { max: 200 });
  transacao(() => {
    executar("UPDATE pagamentos SET status = 'estornado', motivo = ?, atualizado_em = ? WHERE id = ?", m, agoraISO(), pg.id);
    executar("UPDATE transacoes_fiscais SET status_nf = 'cancelada', atualizado_em = ? WHERE pagamento_id = ?", agoraISO(), pg.id);
  });
  auditoria.registrar(ctx, 'pagamento_estornado', { entidade: 'pedido', id: pedido.codigo, detalhes: { motivo: m, valor: pg.valor_centavos } });
  publicar('pagamento', { codigo: pedido.codigo, status: 'estornado' }, { clienteId: pedido.cliente_id });
  if (pedido.cliente_id) {
    require('./notificacoes').notificar({ destino: 'cliente', usuarioId: pedido.cliente_id, pedido,
      mensagem: `O pagamento de ${reais(pg.valor_centavos)} do pedido ${pedido.codigo} foi estornado. ${m}` });
  }
  return um('SELECT * FROM pagamentos WHERE id = ?', pg.id);
}

// Pedido cancelado depois de pago → estorno automático
barramento.on('pedido:status', ({ pedido, ctx }) => {
  if (pedido.status === 'cancelado' && pedido.pagamento?.status === 'aprovado') {
    estornar(ctx, pedido, `Estorno automático: ${pedido.motivo_cancelamento || 'pedido cancelado'}`);
  }
});

// RF17 — Dados do comprovante/recibo
function recibo(pedido) {
  const pg = doPedido(pedido);
  if (!['aprovado', 'estornado'].includes(pg.status)) throw new HttpError(422, 'O recibo fica disponível após a aprovação do pagamento');
  return {
    numero: `R-${String(pg.id).padStart(6, '0')}`,
    restaurante: config.restaurante,
    pedido: {
      codigo: pedido.codigo, criado_em: pedido.criado_em, modalidade: pedido.modalidade, cliente: pedido.cliente_nome,
      itens: pedido.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, unitario: i.preco_unit_centavos, total: i.preco_unit_centavos * i.quantidade })),
      subtotal: pedido.subtotal_centavos, taxa_entrega: pedido.taxa_entrega_centavos, total: pedido.total_centavos,
    },
    pagamento: {
      forma: pg.forma, status: pg.status, valor: pg.valor_centavos, aprovado_em: pg.aprovado_em, referencia: pg.transacao_ref,
      cartao: pg.cartao_final ? `${pg.cartao_bandeira} final ${pg.cartao_final}` : null, motivo: pg.motivo,
    },
    fiscal: um('SELECT status_nf, numero_nf FROM transacoes_fiscais WHERE pagamento_id = ? ORDER BY id DESC', pg.id),
  };
}

module.exports = { validarCartao, luhnValido, pagarComCartao, gerarPix, confirmarPix, receberPresencial, estornar, recibo };