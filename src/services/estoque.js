// Controle de estoque por INGREDIENTES (insumos).
// Cada prato tem uma ficha técnica (quanto de cada ingrediente vai em uma porção).
// A cada pedido o sistema dá baixa nos ingredientes; no cancelamento, devolve.
// Um prato fica "Esgotado" no cardápio quando falta algum ingrediente da ficha dele.
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { agoraISO } = require('../lib/util');
const { publicar } = require('./eventos');

const UNIDADES = ['kg', 'g', 'L', 'ml', 'un'];
const arred = (n) => Math.round(n * 1000) / 1000; // 3 casas: evita 0,30000000004
const qtdTexto = (n, unidade) => `${String(arred(n)).replace('.', ',')} ${unidade}`;

const ingrediente = (id) => um('SELECT * FROM ingredientes WHERE id = ?', id);
const fichaDe = (itemId) => todos(`SELECT f.ingrediente_id, f.quantidade, i.nome, i.unidade, i.quantidade AS em_estoque
                                   FROM fichas_tecnicas f JOIN ingredientes i ON i.id = f.ingrediente_id
                                   WHERE f.item_id = ? ORDER BY i.nome`, itemId);

// Quantas porções do prato dá para fazer com o estoque atual (null = prato sem ficha técnica)
function porcoesDe(ficha) {
  if (!ficha.length) return null;
  return Math.min(...ficha.map((f) => Math.floor(arred(f.em_estoque / f.quantidade))));
}

// Mapa { item_id: { quantidade: porções possíveis } } usado pelo cardápio
function mapa() {
  const linhas = todos(`SELECT f.item_id, f.quantidade, i.quantidade AS em_estoque FROM fichas_tecnicas f
                        JOIN ingredientes i ON i.id = f.ingrediente_id`);
  const porItem = {};
  for (const l of linhas) (porItem[l.item_id] ||= []).push(l);
  return Object.fromEntries(Object.entries(porItem).map(([id, ficha]) => [id, { quantidade: porcoesDe(ficha) }]));
}

// Soma quanto o pedido inteiro precisa de cada ingrediente (pratos diferentes usam o mesmo ingrediente)
function necessidade(itens) {
  const total = new Map(); // ingrediente_id → { quantidade, pratos }
  for (const i of itens) {
    for (const f of fichaDe(i.item_id)) {
      const atual = total.get(f.ingrediente_id) || { ...f, quantidade: 0, pratos: new Set() };
      atual.quantidade = arred(atual.quantidade + f.quantidade * i.quantidade);
      atual.pratos.add(i.nome);
      total.set(f.ingrediente_id, atual);
    }
  }
  return total;
}

// Confere se há ingrediente para o pedido inteiro ANTES de aceitar
function verificar(itens) {
  for (const n of necessidade(itens).values()) {
    if (n.em_estoque >= n.quantidade) continue;
    const pratos = [...n.pratos].map((p) => `"${p}"`).join(' e ');
    if (n.em_estoque <= 0) throw new HttpError(422, `${pratos} esgotou: acabou ${n.nome.toLowerCase()}. Retire do pedido para continuar.`);
    throw new HttpError(422, `Não temos ${n.nome.toLowerCase()} suficiente para ${pratos} nessa quantidade. Diminua a quantidade para continuar.`);
  }
}

// Registra um movimento e atualiza o saldo do ingrediente (chamado dentro de uma transação)
function movimentar(ingredienteId, quantidade, tipo, { pedidoId = null, usuarioId = null, observacao = null } = {}) {
  const ing = ingrediente(ingredienteId);
  if (!ing) throw new HttpError(404, 'Ingrediente não encontrado');
  const saldo = arred(ing.quantidade + quantidade);
  if (saldo < 0) throw new HttpError(422, `Estoque insuficiente de ${ing.nome}`);
  const em = agoraISO();
  executar('UPDATE ingredientes SET quantidade = ?, atualizado_em = ? WHERE id = ?', saldo, em, ingredienteId);
  executar(`INSERT INTO movimentos_estoque (ingrediente_id, tipo, quantidade, saldo, pedido_id, usuario_id, observacao, em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ingredienteId, tipo, arred(quantidade), saldo, pedidoId, usuarioId, observacao, em);
  return { ...ing, quantidade: saldo };
}

// Pedido criado: baixa automática dos ingredientes de todos os pratos
function baixar(pedidoId, itens, usuarioId) {
  verificar(itens); // confere de novo dentro da transação
  const baixos = [];
  for (const [ingredienteId, n] of necessidade(itens)) {
    const ing = movimentar(ingredienteId, -n.quantidade, 'venda', { pedidoId, usuarioId });
    if (ing.quantidade <= ing.minimo) baixos.push(ing);
  }
  return baixos;
}

// Pedido cancelado: devolve ao estoque os ingredientes que foram baixados (uma única vez)
function devolver(pedidoId, usuarioId) {
  if (um("SELECT 1 AS ok FROM movimentos_estoque WHERE pedido_id = ? AND tipo = 'devolucao'", pedidoId)) return;
  const vendas = todos(`SELECT ingrediente_id, -SUM(quantidade) AS qtd FROM movimentos_estoque
                        WHERE pedido_id = ? AND tipo = 'venda' GROUP BY ingrediente_id`, pedidoId);
  for (const v of vendas) movimentar(v.ingrediente_id, v.qtd, 'devolucao', { pedidoId, usuarioId, observacao: 'Pedido cancelado' });
}

// Aviso para a cozinha e a gerência quando um ingrediente chega no mínimo (ou acaba)
function avisarEstoqueBaixo(baixos) {
  const { notificar } = require('./notificacoes'); // carregado aqui para evitar dependência circular
  for (const i of baixos) {
    const mensagem = i.quantidade <= 0
      ? `Estoque: acabou ${i.nome}. Os pratos que usam esse ingrediente aparecem como esgotados no cardápio.`
      : `Estoque baixo: restam ${qtdTexto(i.quantidade, i.unidade)} de ${i.nome} (mínimo ${qtdTexto(i.minimo, i.unidade)}).`;
    notificar({ destino: 'cozinha', mensagem });
  }
  if (baixos.length) publicar('estoque', { ingredientes: baixos.map((i) => i.id) }, { perfis: ['cozinha'] });
}

// ---- Telas da gestão ----
const situacao = (i) => (i.quantidade <= 0 ? 'esgotado' : i.quantidade <= i.minimo ? 'baixo' : 'ok');

function painel() {
  const ingredientes = todos('SELECT * FROM ingredientes ORDER BY nome').map((i) => ({
    ...i, situacao: situacao(i),
    usado_em: todos('SELECT it.nome FROM fichas_tecnicas f JOIN itens it ON it.id = f.item_id WHERE f.ingrediente_id = ? ORDER BY it.nome', i.id).map((x) => x.nome),
  }));
  const pratos = todos(`SELECT it.id AS item_id, it.nome, c.nome AS categoria FROM itens it
                        JOIN categorias c ON c.id = it.categoria_id ORDER BY c.ordem, it.nome`).map((p) => {
    const ficha = fichaDe(p.item_id);
    return { ...p, ficha, porcoes: porcoesDe(ficha) };
  });
  const movimentos = todos(`SELECT m.*, i.nome, i.unidade, u.nome AS usuario, p.codigo AS pedido FROM movimentos_estoque m
                            JOIN ingredientes i ON i.id = m.ingrediente_id LEFT JOIN usuarios u ON u.id = m.usuario_id
                            LEFT JOIN pedidos p ON p.id = m.pedido_id ORDER BY m.id DESC LIMIT 40`);
  return { unidades: UNIDADES, ingredientes, pratos, movimentos };
}

function criarIngrediente({ nome, unidade, quantidade, minimo }, usuarioId) {
  if (!UNIDADES.includes(unidade)) throw new HttpError(422, `Unidade inválida. Use: ${UNIDADES.join(', ')}`);
  if (um('SELECT id FROM ingredientes WHERE lower(nome) = lower(?)', nome)) throw new HttpError(409, 'Já existe um ingrediente com esse nome');
  const em = agoraISO();
  const { id } = executar('INSERT INTO ingredientes (nome, unidade, quantidade, minimo, atualizado_em) VALUES (?, ?, ?, ?, ?)',
    nome, unidade, arred(quantidade), arred(minimo), em);
  executar(`INSERT INTO movimentos_estoque (ingrediente_id, tipo, quantidade, saldo, usuario_id, observacao, em)
            VALUES (?, 'ajuste', ?, ?, ?, 'Cadastro do ingrediente', ?)`, id, arred(quantidade), arred(quantidade), usuarioId, em);
  return ingrediente(id);
}

// Correção depois de contar o estoque (a diferença fica registrada como ajuste) e mudança do mínimo
function corrigir(id, { quantidade, minimo }, usuarioId) {
  const atual = ingrediente(id);
  if (!atual) throw new HttpError(404, 'Ingrediente não encontrado');
  executar('UPDATE ingredientes SET minimo = ?, atualizado_em = ? WHERE id = ?', arred(minimo), agoraISO(), id);
  if (arred(quantidade) !== atual.quantidade) {
    movimentar(id, quantidade - atual.quantidade, 'ajuste', { usuarioId, observacao: 'Correção após contagem' });
  }
  return ingrediente(id);
}

function entrada(id, quantidade, usuarioId, observacao) {
  return movimentar(id, quantidade, 'entrada', { usuarioId, observacao: observacao || 'Compra / reposição' });
}

// Troca a ficha técnica inteira do prato (lista vazia = prato sem controle de estoque)
function salvarFicha(itemId, linhas) {
  if (!um('SELECT id FROM itens WHERE id = ?', itemId)) throw new HttpError(404, 'Prato não encontrado');
  const vistos = new Set();
  for (const l of linhas) {
    if (!ingrediente(l.ingrediente_id)) throw new HttpError(422, 'Ingrediente não encontrado');
    if (vistos.has(l.ingrediente_id)) throw new HttpError(422, 'O mesmo ingrediente aparece duas vezes na ficha');
    vistos.add(l.ingrediente_id);
  }
  executar('DELETE FROM fichas_tecnicas WHERE item_id = ?', itemId);
  for (const l of linhas) {
    executar('INSERT INTO fichas_tecnicas (item_id, ingrediente_id, quantidade) VALUES (?, ?, ?)', itemId, l.ingrediente_id, arred(l.quantidade));
  }
  return fichaDe(itemId);
}

module.exports = {
  UNIDADES, mapa, verificar, baixar, devolver, avisarEstoqueBaixo,
  painel, criarIngrediente, corrigir, entrada, salvarFicha, fichaDe, porcoesDe,
};