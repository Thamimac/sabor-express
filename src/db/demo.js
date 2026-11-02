// Gera dados de demonstração: 30 dias de pedidos + pedidos "ao vivo" de hoje em todas as etapas.
// Uso: npm run demo   (ATENÇÃO: apaga o banco atual e recria tudo)
const fs = require('node:fs');
const config = require('../config');

for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + sufixo, { force: true });
const { getDb } = require('./database');
const { hashSenha } = require('../lib/seguranca');
const regras = require('../services/regras');
const { inicioDiaUTC, dataLocal } = require('../lib/util');

const db = getDb();
const run = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);

// Números "aleatórios" sempre iguais a cada execução (os relatórios ficam iguais em todas as apresentações)
let semente = 20261128;
const aleatorio = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const entre = (a, b) => a + Math.floor(aleatorio() * (b - a + 1));
const sortear = (lista) => lista[Math.floor(aleatorio() * lista.length)];
const comPeso = (pesos) => { let r = aleatorio() * Object.values(pesos).reduce((s, v) => s + v, 0); for (const [k, v] of Object.entries(pesos)) { r -= v; if (r <= 0) return k; } return Object.keys(pesos)[0]; };
const mais = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();

db.exec('BEGIN');

// ---- Clientes de demonstração (com consentimento LGPD) ----
const nomes = ['João Pereira', 'Ana Souza', 'Carlos Lima', 'Fernanda Rocha', 'Lucas Martins', 'Patrícia Alves', 'Rafael Gomes', 'Juliana Castro', 'Marcos Silva', 'Beatriz Nunes'];
const bairrosAtendidos = all('SELECT * FROM bairros WHERE distancia_km <= ?', config.restaurante.raioKm);
const senhaHash = hashSenha('cliente2026');
const agora = new Date().toISOString();
const clientes = [get("SELECT * FROM usuarios WHERE email = 'maria@email.com'")];
nomes.forEach((nome, i) => {
  const id = run(`INSERT INTO usuarios (nome, email, telefone, senha_hash, perfil, consentimento_lgpd_em, criado_em) VALUES (?, ?, ?, ?, 'cliente', ?, ?)`,
    nome, `${nome.split(' ')[0].toLowerCase()}@email.com`, `(11) 9${String(80000000 + i * 1234567).slice(0, 4)}-${String(1000 + i * 37)}`, senhaHash, agora, agora);
  const b = bairrosAtendidos[(i * 3) % bairrosAtendidos.length];
  run(`INSERT INTO enderecos (usuario_id, apelido, logradouro, numero, bairro_id, principal, criado_em) VALUES (?, 'Casa', ?, ?, ?, 1, ?)`,
    id, sortear(['Rua Augusta', 'Av. Liberdade', 'Rua Vergueiro', 'Rua da Consolação', 'Av. Paulista', 'Rua Teodoro Sampaio']), String(entre(10, 1900)), b.id, agora);
  clientes.push(get('SELECT * FROM usuarios WHERE id = ?', id));
});
const enderecoDe = (cli) => get('SELECT e.*, b.nome AS bairro, b.distancia_km FROM enderecos e JOIN bairros b ON b.id = e.bairro_id WHERE e.usuario_id = ? AND e.principal = 1', cli.id);

const itens = all('SELECT i.*, c.nome AS categoria, c.tempo_preparo_min FROM itens i JOIN categorias c ON c.id = i.categoria_id');
const equipe = Object.fromEntries(all("SELECT id, perfil FROM usuarios WHERE perfil <> 'cliente'").map((u) => [u.perfil, u.id]));
const entregadores = all('SELECT id FROM entregadores');

// ---- Cria um pedido completo, com histórico, pagamento, fiscal e ocorrências ----
// etapa: até onde o pedido chegou ('entregue', 'cancelado', ou um status em andamento)
function criarPedido(criadoEm, etapa, opcoes = {}) {
  const modalidade = opcoes.modalidade || comPeso({ entrega: 55, salao: 30, retirada: 15 }); // mesmo perfil do faturamento (3.1.8)
  const balcao = modalidade !== 'entrega' && aleatorio() < 0.4;
  const cliente = balcao ? null : sortear(clientes);
  const linhas = Array.from({ length: entre(1, 3) }, () => ({ item: sortear(itens), qtd: entre(1, 2) }));
  const subtotal = linhas.reduce((s, l) => s + l.item.preco_centavos * l.qtd, 0);
  const end = modalidade === 'entrega' ? enderecoDe(cliente) : null;
  const taxa = end ? regras.taxaEntrega(end.distancia_km) : 0;
  const total = subtotal + taxa;
  const forma = opcoes.forma || comPeso({ pix: 35, credito: 30, debito: 15, dinheiro: 20 });
  const preparoMin = regras.tempoPreparoMin(linhas.map((l) => l.item.tempo_preparo_min));
  const entregaMin = end ? regras.tempoDeslocamentoMin(end.distancia_km) : 0;

  const t = { aguardando_confirmacao: criadoEm };
  t.recebido = mais(t.aguardando_confirmacao, entre(1, 3));
  t.em_preparo = mais(t.recebido, entre(1, 5));
  const preparoReal = Math.max(3, preparoMin + entre(-3, 7));
  t.pronto = mais(t.em_preparo, preparoReal);
  if (end) {
    t.despachado = mais(t.pronto, entre(1, 6));
    t.a_caminho = mais(t.despachado, aleatorio() < 0.85 ? entre(1, 3) : entre(4, 7)); // a maioria dentro do SLA de 3 min
    t.entregue = mais(t.a_caminho, Math.max(5, entregaMin + entre(-6, aleatorio() < 0.9 ? 6 : 25)));
  } else {
    t.entregue = mais(t.pronto, entre(2, 15));
  }
  const ordem = ['aguardando_confirmacao', 'recebido', 'em_preparo', 'pronto', ...(end ? ['despachado', 'a_caminho'] : []), 'entregue'];
  const ate = etapa === 'cancelado' ? 'recebido' : etapa;
  const passos = ordem.slice(0, ordem.indexOf(ate) + 1);
  const ts = (s) => (passos.includes(s) ? t[s] : null);

  const id = run(`INSERT INTO pedidos (cliente_id, criado_por_id, cliente_nome, cliente_telefone, modalidade, mesa, endereco_texto, bairro_id, distancia_km,
      subtotal_centavos, taxa_entrega_centavos, total_centavos, forma_pagamento, status, entregador_id, preparo_estimado_min, entrega_estimada_min,
      previsao_em, tempo_preparo_seg, criado_em, confirmado_em, preparo_inicio_em, pronto_em, despachado_em, aceite_em, entregue_em, cancelado_em, motivo_cancelamento)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    cliente?.id ?? null, cliente ? cliente.id : equipe.atendente, cliente ? cliente.nome : sortear(['Cliente balcão', 'Sr. Antônio', 'Dona Lúcia', 'Mesa do Pedro']),
    cliente?.telefone ?? null, modalidade, modalidade === 'salao' ? entre(1, 20) : null,
    end ? `${end.logradouro}, ${end.numero} - ${end.bairro}` : null, end?.bairro_id ?? null, end?.distancia_km ?? null,
    subtotal, taxa, total, forma, etapa, end && ts('despachado') ? sortear(entregadores).id : null, preparoMin, entregaMin,
    mais(criadoEm, preparoMin + entregaMin), ts('pronto') ? preparoReal * 60 : null,
    t.aguardando_confirmacao, ts('recebido'), ts('em_preparo'), ts('pronto'), ts('despachado'), ts('a_caminho'), ts('entregue'),
    etapa === 'cancelado' ? mais(t.recebido, 2) : null, etapa === 'cancelado' ? sortear(['Item indisponível no momento', 'Cliente desistiu']) : null);
  run('UPDATE pedidos SET codigo = ? WHERE id = ?', `SE${String(id).padStart(5, '0')}`, id);
  for (const l of linhas) {
    run('INSERT INTO itens_pedido (pedido_id, item_id, nome, categoria, preco_unit_centavos, quantidade, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, l.item.id, l.item.nome, l.item.categoria, l.item.preco_centavos, l.qtd, aleatorio() < 0.15 ? sortear(['sem cebola', 'bem passado', 'sem gelo', 'molho à parte']) : null);
  }
  const quem = { aguardando_confirmacao: cliente?.id ?? equipe.atendente, recebido: equipe.atendente, em_preparo: equipe.cozinha, pronto: equipe.cozinha,
    despachado: equipe.logistica, a_caminho: equipe.logistica, entregue: end ? equipe.logistica : equipe.atendente };
  for (const s of passos) run('INSERT INTO historico_status (pedido_id, status, usuario_id, em) VALUES (?, ?, ?, ?)', id, s, quem[s], t[s]);
  if (etapa === 'cancelado') run('INSERT INTO historico_status (pedido_id, status, usuario_id, em) VALUES (?, ?, ?, ?)', id, 'cancelado', equipe.atendente, mais(t.recebido, 2));

  // Pagamento: online é pago na hora do pedido; presencial, na entrega/retirada
  const online = ['pix', 'credito', 'debito'].includes(forma) && cliente;
  let status = 'pendente';
  let aprovadoEm = null;
  if (online) { status = 'aprovado'; aprovadoEm = mais(criadoEm, 1); }
  else if (etapa === 'entregue' && !opcoes.semReceber) { status = 'aprovado'; aprovadoEm = t.entregue; }
  if (etapa === 'cancelado') status = status === 'aprovado' ? 'estornado' : 'cancelado';
  const pgId = run(`INSERT INTO pagamentos (pedido_id, forma, valor_centavos, status, transacao_ref, cartao_final, cartao_bandeira, tentativas, motivo, criado_em, aprovado_em, atualizado_em)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, forma, total, status, aprovadoEm ? `GW-DEMO${id}` : null,
  ['credito', 'debito'].includes(forma) && online ? '1111' : null, ['credito', 'debito'].includes(forma) && online ? 'Visa' : null, online ? 1 : 0,
  status === 'estornado' ? 'Estorno automático: pedido cancelado' : null, criadoEm, aprovadoEm, aprovadoEm || criadoEm);

  // Regra de domínio 7: transação fiscal para todo pagamento aprovado
  if (aprovadoEm) {
    const antiga = new Date(criadoEm) < new Date(Date.now() - 3 * 86400000);
    const nf = status === 'estornado' ? 'cancelada' : antiga ? 'emitida' : 'pendente_emissao';
    run('INSERT INTO transacoes_fiscais (pedido_id, pagamento_id, valor_centavos, status_nf, numero_nf, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      id, pgId, total, nf, nf === 'emitida' ? `NFC-e ${String(1000 + id)}` : null, aprovadoEm);
  }

  // Ocorrências de entrega (RF15) em alguns pedidos
  if (end && etapa === 'entregue' && aleatorio() < 0.06) {
    const aberta = mais(t.a_caminho, entre(5, 15));
    run(`INSERT INTO ocorrencias (pedido_id, tipo, descricao, registrada_por, origem, resolucao, criado_em, resolvida_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, comPeso({ atraso: 70, cliente_ausente: 15, endereco_nao_encontrado: 10, avaria: 5 }), 'Registrado durante a entrega', equipe.logistica,
      aleatorio() < 0.5 ? 'rotalog' : 'sistema', 'Cliente contatado e entrega concluída', aberta, mais(aberta, entre(4, 18)));
  }

    // Avaliação do cliente: entregas atrasadas tendem a receber notas menores
  if (cliente && etapa === 'entregue' && aleatorio() < 0.6) {
    const atrasou = end && (new Date(t.entregue) - new Date(t.pronto)) / 60000 > config.sla.entregaMin;
    const nota = atrasou ? comPeso({ 1: 15, 2: 30, 3: 35, 4: 15, 5: 5 }) : comPeso({ 3: 8, 4: 32, 5: 60 });
    const comentarios = {
      1: ['Demorou demais e chegou frio.'], 2: ['Atrasou bastante.', 'Comida boa, mas a entrega demorou.'],
      3: ['Ok, mas poderia ser mais rápido.', 'Razoável.'], 4: ['Muito bom!', 'Gostei, voltarei a pedir.', 'Chegou certinho.'],
      5: ['Perfeito, chegou quentinho!', 'A feijoada é a melhor da região!', 'Entrega super rápida.', 'Excelente atendimento.'],
    };
    run('INSERT INTO avaliacoes (pedido_id, cliente_id, nota, comentario, criado_em) VALUES (?, ?, ?, ?, ?)',
      id, cliente.id, Number(nota), aleatorio() < 0.7 ? sortear(comentarios[nota]) : null, mais(t.entregue, entre(5, 90)));
  }

  return id;
}

// ---- 30 dias de histórico ----
let total = 0;
const hojeStr = dataLocal();
for (let d = 30; d >= 1; d -= 1) {
  const dia = dataLocal(new Date(Date.now() - d * 86400000));
  const semana = new Date(`${dia}T12:00:00-03:00`).getUTCDay();
  const qtd = [5, 6].includes(semana) || semana === 0 ? entre(14, 22) : entre(8, 15); // mais movimento no fim de semana
  for (let i = 0; i < qtd; i += 1) {
    const almoco = aleatorio() < 0.55;
    const minuto = almoco ? entre(11 * 60 + 15, 14 * 60 + 30) : entre(18 * 60 + 30, 22 * 60 + 15);
    const criado = new Date(new Date(inicioDiaUTC(dia)).getTime() + minuto * 60000).toISOString();
    criarPedido(criado, aleatorio() < 0.05 ? 'cancelado' : 'entregue');
    total += 1;
  }
}

// ---- Hoje: pedidos "ao vivo" em todas as etapas, para a apresentação ----
const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
const aoVivo = [
  [ha(95), 'entregue', { modalidade: 'retirada', forma: 'dinheiro' }],
  [ha(80), 'entregue', { modalidade: 'salao', forma: 'credito' }],
  [ha(70), 'entregue', { modalidade: 'retirada', forma: 'dinheiro', semReceber: true }], // divergência para a conciliação (RF20)
  [ha(38), 'a_caminho', { modalidade: 'entrega', forma: 'pix' }],
  [ha(33), 'a_caminho', { modalidade: 'entrega', forma: 'credito' }],
  [ha(30), 'despachado', { modalidade: 'entrega', forma: 'credito' }],
  [ha(26), 'pronto', { modalidade: 'entrega', forma: 'dinheiro' }],
  [ha(22), 'pronto', { modalidade: 'entrega', forma: 'pix' }],
  [ha(12), 'em_preparo', { modalidade: 'salao', forma: 'debito' }],
  [ha(9), 'em_preparo', { modalidade: 'entrega', forma: 'pix' }],
  [ha(5), 'recebido', { modalidade: 'retirada', forma: 'pix' }],
  [ha(3), 'aguardando_confirmacao', { modalidade: 'entrega', forma: 'credito' }],
  [ha(1), 'aguardando_confirmacao', { modalidade: 'salao', forma: 'dinheiro' }],
];
for (const [criado, etapa, op] of aoVivo) criarPedido(criado, etapa, op);

// Ajusta os tempos dos pedidos ativos para ficarem coerentes com "agora"
db.prepare("UPDATE pedidos SET preparo_inicio_em = ?, pronto_em = NULL, tempo_preparo_seg = NULL WHERE status = 'em_preparo' AND criado_em >= ?").run(ha(4), inicioDiaUTC(hojeStr));
db.prepare("UPDATE pedidos SET despachado_em = ? WHERE status = 'despachado' AND criado_em >= ?").run(ha(1), inicioDiaUTC(hojeStr));

// Entregadores em rota: um saiu há pouco e outro já está na metade do caminho (aparecem andando no mapa)
all("SELECT id FROM pedidos WHERE status = 'a_caminho' AND criado_em >= ? ORDER BY id", inicioDiaUTC(hojeStr)).forEach((p, i) => {
  db.prepare('UPDATE pedidos SET pronto_em = ?, despachado_em = ?, aceite_em = ? WHERE id = ?').run(ha(9 + i * 8), ha(7 + i * 8), ha(5 + i * 8), p.id);
});

run("UPDATE configuracoes SET valor = '1' WHERE chave = 'ignorar_horario'"); // modo demonstração ligado
run("INSERT INTO auditoria (usuario_nome, acao, detalhes, criado_em) VALUES ('Sistema', 'dados_demonstracao_gerados', ?, ?)",
  JSON.stringify({ pedidos: total + aoVivo.length }), new Date().toISOString());
db.exec('COMMIT');

console.log(`✔ Dados de demonstração criados: ${total} pedidos nos últimos 30 dias + ${aoVivo.length} pedidos de hoje em andamento.`);
console.log(`  Clientes: maria@email.com e mais ${nomes.length} (ex.: joao@email.com) — senha cliente2026`);
console.log('  Equipe: gerente@ | atendimento@ | cozinha@ | logistica@ | financeiro@saborexpress.com.br — senha sabor2026');
console.log('  Modo demonstração LIGADO (aceita pedidos fora do horário). Desligue em Gestão → Configurações.');