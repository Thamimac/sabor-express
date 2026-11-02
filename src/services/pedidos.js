// Módulo 1 — Regras de negócio dos pedidos (RF01 a RF06) e ciclo de vida do status
const config = require('../config');
const { um, todos, executar, transacao } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { texto, telefone, inteiro, opcao, agora, agoraISO } = require('../lib/util');
const regras = require('./regras');
const enderecos = require('./enderecos');
const auditoria = require('./auditoria');
const { barramento, publicar } = require('./eventos');

const MODALIDADES = ['entrega', 'retirada', 'salao'];
const FORMAS_PAGAMENTO = ['credito', 'debito', 'pix', 'dinheiro'];
const STATUS_ATIVOS = ['aguardando_confirmacao', 'recebido', 'em_preparo', 'pronto', 'despachado', 'a_caminho'];

// Quem pode mover o pedido de um status para outro ("cliente" = o dono do pedido).
// O gerente pode fazer qualquer transição.
const TRANSICOES = {
  aguardando_confirmacao: { recebido: ['atendente'], cancelado: ['cliente', 'atendente'] },
  recebido: { em_preparo: ['cozinha'], cancelado: ['atendente'] },
  em_preparo: { pronto: ['cozinha'] },
  pronto: { despachado: ['logistica'], entregue: ['atendente'] },
  despachado: { a_caminho: ['logistica'], pronto: ['logistica'] },
  a_caminho: { entregue: ['logistica'] },
};

// Data/hora registrada em cada mudança de status (base para RF10 e para o SLA)
const CAMPO_DATA = {
  recebido: 'confirmado_em',
  em_preparo: 'preparo_inicio_em',
  pronto: 'pronto_em',
  despachado: 'despachado_em',
  a_caminho: 'aceite_em',
  entregue: 'entregue_em',
  cancelado: 'cancelado_em',
};

// ---------------------------------------------------------------- RF01: cardápio
function cardapio({ incluirIndisponiveis = false } = {}) {
  const categorias = todos('SELECT * FROM categorias ORDER BY ordem, nome');
  const itens = todos(`SELECT * FROM itens ${incluirIndisponiveis ? '' : 'WHERE disponivel = 1'} ORDER BY nome`);
  return categorias.map((c) => ({
    ...c,
    itens: itens.filter((i) => i.categoria_id === c.id).map((i) => ({ ...i, disponivel: !!i.disponivel, destaque: !!i.destaque })),
  })).filter((c) => c.itens.length || incluirIndisponiveis);
}

// ---------------------------------------------------------------- RF02 a RF04: montar e calcular
function montar(usuario, dados) {
  const linhas = Array.isArray(dados.itens) ? dados.itens : [];
  if (!linhas.length) throw new HttpError(422, 'Adicione pelo menos um item ao pedido');
  if (linhas.length > 30) throw new HttpError(422, 'Pedido com itens demais');

  const itens = linhas.map((l) => {
    const item = um(`SELECT i.*, c.nome AS categoria, c.tempo_preparo_min FROM itens i
                     JOIN categorias c ON c.id = i.categoria_id WHERE i.id = ?`, Number(l.item_id));
    if (!item) throw new HttpError(422, 'Item não encontrado no cardápio');
    if (!item.disponivel) throw new HttpError(422, `"${item.nome}" não está disponível no momento`);
    return {
      item_id: item.id,
      nome: item.nome,
      categoria: item.categoria,
      tempo_preparo_min: item.tempo_preparo_min,
      preco_unit_centavos: item.preco_centavos,
      quantidade: inteiro(l.quantidade, 'quantidade', { min: 1, max: 20 }),
      observacao: texto(l.observacao, 'observação do item', { obrigatorio: false, max: 140 }),
    };
  });

  const modalidade = opcao(dados.modalidade, 'modalidade', MODALIDADES);
  const r = { itens, modalidade, mesa: null, endereco: null, distanciaKm: null, bairroId: null, taxa: 0 };

  if (modalidade === 'entrega') {
    if (dados.endereco_id) {
      r.endereco = enderecos.obter(usuario.id, dados.endereco_id); // só endereços do próprio cliente
    } else if (usuario.equipe && dados.endereco) {
      const e = enderecos.validar(dados.endereco); // pedido feito pelo atendente (telefone/WhatsApp)
      const b = regras.bairroPorId(e.bairro_id);
      r.endereco = { ...e, bairro: b.nome, distancia_km: b.distancia_km };
      r.endereco.texto = enderecos.formatar(r.endereco);
    } else {
      throw new HttpError(422, 'Escolha o endereço de entrega');
    }
    r.distanciaKm = r.endereco.distancia_km;
    r.bairroId = r.endereco.bairro_id;
    r.taxa = regras.taxaEntrega(r.distanciaKm); // regras de domínio 2 e 3
  }
  if (modalidade === 'salao') r.mesa = inteiro(dados.mesa, 'número da mesa', { min: 1, max: 40 });

  // RF03: total calculado no servidor (o navegador nunca define preços)
  r.subtotal = itens.reduce((s, i) => s + i.preco_unit_centavos * i.quantidade, 0);
  r.total = r.subtotal + r.taxa;
  // Regra de domínio 4: previsão pelo tempo de preparo de cada categoria
  r.estimativa = regras.estimarPrazo({
    temposPreparo: itens.map((i) => i.tempo_preparo_min), modalidade, distanciaKm: r.distanciaKm,
  });
  return r;
}

function resumoSimulacao(m) {
  return {
    subtotal_centavos: m.subtotal,
    taxa_entrega_centavos: m.taxa,
    total_centavos: m.total,
    distancia_km: m.distanciaKm,
    estimativa: m.estimativa,
    itens: m.itens.map(({ tempo_preparo_min, ...i }) => i),
  };
}

// ---------------------------------------------------------------- RF05: registrar o pedido
function criar(ctx, dados) {
  regras.exigirRestauranteAberto(); // regra de domínio 1
  const usuario = ctx.usuario;
  const m = montar(usuario, dados);
  const forma = opcao(dados.forma_pagamento, 'forma de pagamento', FORMAS_PAGAMENTO);
  const observacoes = texto(dados.observacoes, 'observações', { obrigatorio: false, max: 200 });

  let trocoPara = null;
  if (forma === 'dinheiro' && dados.troco_para) {
    trocoPara = Math.round(Number(String(dados.troco_para).replace(',', '.')) * 100);
    if (!Number.isFinite(trocoPara) || trocoPara < m.total) throw new HttpError(422, 'O valor para troco deve ser maior que o total');
  }

  // Cliente pede para si; a equipe pode registrar pedidos de balcão/telefone em nome de alguém
  let clienteId = null;
  let nome = usuario.nome;
  let tel = usuario.telefone;
  if (usuario.equipe) {
    nome = texto(dados.cliente_nome, 'nome do cliente', { min: 2, max: 80 });
    tel = telefone(dados.cliente_telefone, m.modalidade === 'entrega');
  } else {
    clienteId = usuario.id;
  }

  const agoraTxt = agoraISO();
  const pedidoId = transacao(() => {
    const { id } = executar(
      `INSERT INTO pedidos (cliente_id, criado_por_id, cliente_nome, cliente_telefone, modalidade, mesa, endereco_texto,
         bairro_id, distancia_km, observacoes, subtotal_centavos, taxa_entrega_centavos, total_centavos, forma_pagamento,
         troco_para_centavos, preparo_estimado_min, entrega_estimada_min, previsao_em, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clienteId, usuario.id, nome, tel, m.modalidade, m.mesa, m.endereco?.texto ?? null,
      m.bairroId, m.distanciaKm, observacoes, m.subtotal, m.taxa, m.total, forma,
      trocoPara, m.estimativa.preparoMin, m.estimativa.entregaMin, m.estimativa.previsaoEm, agoraTxt,
    );
    // RF05: número único e legível do pedido
    executar('UPDATE pedidos SET codigo = ? WHERE id = ?', `SE${String(id).padStart(5, '0')}`, id);
    for (const i of m.itens) {
      executar(`INSERT INTO itens_pedido (pedido_id, item_id, nome, categoria, preco_unit_centavos, quantidade, observacao)
                VALUES (?, ?, ?, ?, ?, ?, ?)`, id, i.item_id, i.nome, i.categoria, i.preco_unit_centavos, i.quantidade, i.observacao);
    }
    executar('INSERT INTO historico_status (pedido_id, status, usuario_id, em) VALUES (?, ?, ?, ?)', id, 'aguardando_confirmacao', usuario.id, agoraTxt);
    executar(`INSERT INTO pagamentos (pedido_id, forma, valor_centavos, status, criado_em, atualizado_em)
              VALUES (?, ?, ?, 'pendente', ?, ?)`, id, forma, m.total, agoraTxt, agoraTxt);
    return id;
  });

  const pedido = obter(pedidoId);
  auditoria.registrar(ctx, 'pedido_criado', { entidade: 'pedido', id: pedido.codigo, detalhes: { total: pedido.total_centavos, modalidade: pedido.modalidade } });
  publicar('pedido', { codigo: pedido.codigo, status: pedido.status, novo: true }, { clienteId });
  barramento.emit('pedido:criado', { pedido, ctx });
  return pedido;
}

// ---------------------------------------------------------------- consulta
function obter(idOuCodigo) {
  const p = um('SELECT * FROM pedidos WHERE id = ? OR codigo = ?', Number(idOuCodigo) || -1, String(idOuCodigo));
  if (!p) throw new HttpError(404, 'Pedido não encontrado');
  p.itens = todos('SELECT * FROM itens_pedido WHERE pedido_id = ? ORDER BY id', p.id);
  p.historico = todos(`SELECT h.status, h.em, h.observacao, u.nome AS usuario FROM historico_status h
                       LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.pedido_id = ? ORDER BY h.id`, p.id);
  p.pagamento = um('SELECT * FROM pagamentos WHERE pedido_id = ?', p.id);
  p.entregador = p.entregador_id ? um('SELECT id, nome, telefone, veiculo, empresa FROM entregadores WHERE id = ?', p.entregador_id) : null;
  p.ocorrencias = todos('SELECT * FROM ocorrencias WHERE pedido_id = ? ORDER BY id', p.id);
  return p;
}

function obterPermitido(usuario, codigo) {
  const p = obter(codigo);
  if (!usuario.equipe && p.cliente_id !== usuario.id) throw new HttpError(404, 'Pedido não encontrado');
  return p;
}

// ---------------------------------------------------------------- mudança de status
function podeTransicionar(usuario, pedido, novo) {
  const permitidos = TRANSICOES[pedido.status]?.[novo];
  if (!permitidos) return false;
  if (usuario.perfil === 'gerente') return true;
  if (permitidos.includes('cliente') && pedido.cliente_id === usuario.id) return true;
  return permitidos.includes(usuario.perfil);
}

function mudarStatus(ctx, idOuCodigo, novo, { motivo = null, entregadorId = null, observacao = null } = {}) {
  const pedido = obter(idOuCodigo);
  if (!TRANSICOES[pedido.status]?.[novo]) {
    throw new HttpError(422, `Não é possível mudar de "${pedido.status}" para "${novo}"`);
  }
  if (!podeTransicionar(ctx.usuario, pedido, novo)) throw new HttpError(403, 'Você não tem permissão para esta ação');
  if (novo === 'despachado' && pedido.modalidade !== 'entrega') throw new HttpError(422, 'Apenas pedidos de entrega são despachados');
  if (novo === 'entregue' && pedido.status === 'pronto' && pedido.modalidade === 'entrega') {
    throw new HttpError(422, 'Pedidos de entrega precisam ser despachados para um entregador');
  }

  const agoraTxt = agoraISO();
  const campos = { status: novo };
  if (CAMPO_DATA[novo]) campos[CAMPO_DATA[novo]] = agoraTxt;
  if (novo === 'recebido') {
    // Recalcula a previsão a partir da confirmação
    const inicio = agora().getTime();
    campos.previsao_em = new Date(inicio + (pedido.preparo_estimado_min + (pedido.entrega_estimada_min || 0)) * 60000).toISOString();
  }
  if (novo === 'pronto' && pedido.preparo_inicio_em) {
    campos.tempo_preparo_seg = Math.round((new Date(agoraTxt) - new Date(pedido.preparo_inicio_em)) / 1000); // RF10
  }
  if (novo === 'despachado') {
    if (!entregadorId) throw new HttpError(422, 'Informe o entregador');
    const ent = um('SELECT * FROM entregadores WHERE id = ? AND ativo = 1', Number(entregadorId));
    if (!ent) throw new HttpError(422, 'Entregador não encontrado ou inativo');
    campos.entregador_id = ent.id;
  }
  if (novo === 'pronto' && pedido.status === 'despachado') {
    campos.entregador_id = null; // entregador não aceitou: volta para a fila de despacho
    campos.despachado_em = null;
  }
  if (novo === 'cancelado') campos.motivo_cancelamento = texto(motivo, 'motivo', { obrigatorio: false, max: 200 }) || 'Cancelado pelo cliente';

  transacao(() => {
    const sets = Object.keys(campos).map((c) => `${c} = ?`).join(', ');
    executar(`UPDATE pedidos SET ${sets} WHERE id = ?`, ...Object.values(campos), pedido.id);
    executar('INSERT INTO historico_status (pedido_id, status, usuario_id, observacao, em) VALUES (?, ?, ?, ?, ?)',
      pedido.id, novo, ctx.usuario.id, observacao || (novo === 'cancelado' ? campos.motivo_cancelamento : null), agoraTxt);
    if (novo === 'cancelado') {
      executar("UPDATE pagamentos SET status = 'cancelado', atualizado_em = ? WHERE pedido_id = ? AND status IN ('pendente','recusado')", agoraTxt, pedido.id);
    }
  });

  const atualizado = obter(pedido.id);
  auditoria.registrar(ctx, 'pedido_status', { entidade: 'pedido', id: pedido.codigo, detalhes: { de: pedido.status, para: novo } });
  publicar('pedido', { codigo: atualizado.codigo, status: novo }, { clienteId: atualizado.cliente_id });
  barramento.emit('pedido:status', { pedido: atualizado, anterior: pedido.status, ctx });
  return atualizado;
}

module.exports = {
  MODALIDADES, FORMAS_PAGAMENTO, STATUS_ATIVOS, TRANSICOES,
  cardapio, montar, resumoSimulacao, criar, obter, obterPermitido, podeTransicionar, mudarStatus,
};