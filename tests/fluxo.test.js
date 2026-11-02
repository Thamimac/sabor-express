// Testes de integração: o sistema completo rodando, com usuários de cada perfil fazendo requisições reais
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, usuario, equipe, ignorarHorario } = require('./ajuda');

let srv;
let u; // usuários logados: cliente, gerente, atendente, cozinha, logistica, financeiro

before(async () => {
  srv = await iniciarServidor();
  u = await equipe(srv.base);
  ignorarHorario(true);
});
after(() => srv.fechar());

const pedidoEntrega = { itens: [{ item_id: 5, quantidade: 2, observacao: 'sem torresmo' }, { item_id: 12, quantidade: 1 }], modalidade: 'entrega', endereco_id: 1, forma_pagamento: 'pix' };
async function novoPedido(dados = pedidoEntrega) {
  const r = await u.cliente.post('/api/pedidos', dados);
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return r.dados;
}
const mudar = (quem, codigo, status, extra = {}) => quem.post(`/api/equipe/pedidos/${codigo}/status`, { status, ...extra });

describe('Módulo 5 — Cadastro e autenticação', () => {
  test('RF21: cadastro exige consentimento LGPD', async () => {
    const novo = usuario(srv.base);
    const corpo = { nome: 'Teste Silva', email: 'teste@x.com', telefone: '11999990000', senha: 'teste1234', endereco: { logradouro: 'Rua A', numero: '1', bairro_id: 1 } };
    assert.equal((await novo.post('/api/auth/cadastro', corpo)).status, 422);
    const r = await novo.post('/api/auth/cadastro', { ...corpo, consentimento: true });
    assert.equal(r.status, 201);
    assert.equal((await novo.post('/api/auth/cadastro', { ...corpo, consentimento: true })).status, 409, 'e-mail duplicado');
  });

  test('RF22: login com senha errada falha e bloqueia após 5 tentativas', async () => {
    const x = usuario(srv.base);
    for (let i = 0; i < 5; i += 1) assert.equal((await x.post('/api/auth/login', { email: 'teste@x.com', senha: 'errada000' })).status, 401);
    assert.equal((await x.post('/api/auth/login', { email: 'teste@x.com', senha: 'teste1234' })).status, 429);
  });

  test('RF22: rotas protegidas exigem login e perfil', async () => {
    assert.equal((await usuario(srv.base).get('/api/conta')).status, 401);
    assert.equal((await u.cliente.get('/api/equipe/pedidos')).status, 403);
    assert.equal((await u.cozinha.get('/api/financeiro/resumo')).status, 403);
  });

  test('RF24: cliente cadastra vários endereços', async () => {
    const r = await u.cliente.post('/api/conta/enderecos', { apelido: 'Trabalho', logradouro: 'Av. Paulista', numero: '900', bairro_id: 4 });
    assert.equal(r.status, 201);
    assert.equal((await u.cliente.get('/api/conta/enderecos')).dados.length, 2);
  });
});

describe('Módulo 1 — Cardápio e pedidos', () => {
  test('RF01: cardápio por categorias', async () => {
    const r = await usuario(srv.base).get('/api/cardapio');
    assert.deepEqual(r.dados.categorias.map((c) => c.nome), ['Entradas', 'Pratos Executivos', 'Pratos à la Carte', 'Bebidas', 'Sobremesas']);
  });

  test('RF02–RF05: pedido com observação, taxa de entrega e número único', async () => {
    const p = await novoPedido();
    assert.match(p.codigo, /^SE\d{5}$/);
    assert.equal(p.subtotal_centavos, 3490 * 2 + 650);
    assert.equal(p.taxa_entrega_centavos, 500); // Liberdade, 1,6 km
    assert.equal(p.total_centavos, 3490 * 2 + 650 + 500);
    assert.equal(p.itens[0].observacao, 'sem torresmo');
    assert.equal(p.status, 'aguardando_confirmacao');
  });

  test('RF03: o preço vem do servidor, não do navegador', async () => {
    const p = await novoPedido({ ...pedidoEntrega, itens: [{ item_id: 5, quantidade: 1, preco_centavos: 1 }] });
    assert.equal(p.subtotal_centavos, 3490);
  });

  test('Regra 3: endereço fora do raio de 8 km é recusado', async () => {
    const e = await u.cliente.post('/api/conta/enderecos', { logradouro: 'Rua Longe', numero: '1', bairro_id: 23 });
    const r = await u.cliente.post('/api/pedidos', { ...pedidoEntrega, endereco_id: e.dados.id });
    assert.equal(r.status, 422);
    assert.match(r.dados.erro, /fora da área/);
  });

  test('Regra 1: pedido fora do horário é recusado', async () => {
    ignorarHorario(false);
    const { getDb } = require('../src/db/database');
    getDb().prepare("UPDATE configuracoes SET valor = '00:00' WHERE chave = 'horario_abertura'").run();
    getDb().prepare("UPDATE configuracoes SET valor = '00:01' WHERE chave = 'horario_fechamento'").run();
    const r = await u.cliente.post('/api/pedidos', pedidoEntrega);
    assert.equal(r.status, 422);
    getDb().prepare("UPDATE configuracoes SET valor = '11:00' WHERE chave = 'horario_abertura'").run();
    getDb().prepare("UPDATE configuracoes SET valor = '23:00' WHERE chave = 'horario_fechamento'").run();
    ignorarHorario(true);
  });

  test('RF06: cliente cancela apenas enquanto aguarda confirmação', async () => {
    const p1 = await novoPedido();
    assert.equal((await u.cliente.post(`/api/pedidos/${p1.codigo}/cancelar`)).dados.status, 'cancelado');
    const p2 = await novoPedido();
    await mudar(u.atendente, p2.codigo, 'recebido');
    assert.equal((await u.cliente.post(`/api/pedidos/${p2.codigo}/cancelar`)).status, 422);
  });

  test('cliente não vê pedido de outra pessoa', async () => {
    const p = await novoPedido();
    const outro = usuario(srv.base);
    await outro.post('/api/auth/cadastro', { nome: 'Outra Pessoa', email: 'outra@x.com', telefone: '11988887777', senha: 'outra1234', consentimento: true,
      endereco: { logradouro: 'Rua B', numero: '2', bairro_id: 1 } });
    assert.equal((await outro.get(`/api/pedidos/${p.codigo}`)).status, 404);
  });
});

describe('Módulos 2 e 3 — Cozinha e logística (fluxo completo de entrega)', () => {
  test('RF07–RF15: do pedido à entrega, com notificação, tempo de preparo e ocorrência', async () => {
    const p = await novoPedido();
    assert.equal((await mudar(u.cozinha, p.codigo, 'recebido')).status, 403, 'cozinha não confirma pedido');
    await mudar(u.atendente, p.codigo, 'recebido');

    const fila = await u.cozinha.get('/api/equipe/cozinha'); // RF07
    assert.ok(fila.dados.fila.some((x) => x.codigo === p.codigo));
    await mudar(u.cozinha, p.codigo, 'em_preparo'); // RF08
    const pronto = await mudar(u.cozinha, p.codigo, 'pronto');
    assert.ok(pronto.dados.tempo_preparo_seg >= 0, 'RF10: tempo de preparo registrado');

    const notif = await u.cliente.get('/api/notificacoes'); // RF09
    assert.ok(notif.dados.lista.some((n) => n.mensagem.includes(`${p.codigo} está pronto`)));
    const notifLog = await u.logistica.get('/api/notificacoes');
    assert.ok(notifLog.dados.lista.some((n) => n.mensagem.includes(`${p.codigo} pronto para despacho`)));

    const painel = await u.logistica.get('/api/logistica/painel'); // RF11
    assert.ok(painel.dados.prontos.some((x) => x.codigo === p.codigo));
    const desp = await u.logistica.post(`/api/logistica/pedidos/${p.codigo}/despachar`, { entregador_id: 1 }); // RF12
    assert.equal(desp.dados.entregador.id, 1);
    await u.logistica.post(`/api/logistica/pedidos/${p.codigo}/a-caminho`); // RF13
    const oc = await u.logistica.post(`/api/logistica/pedidos/${p.codigo}/ocorrencias`, { tipo: 'atraso', descricao: 'Trânsito' }); // RF15
    assert.equal(oc.status, 201);
    await u.logistica.post(`/api/logistica/ocorrencias/${oc.dados.id}/resolver`, { resolucao: 'Cliente avisado' });
    const fim = await u.logistica.post(`/api/logistica/pedidos/${p.codigo}/entregue`);
    assert.equal(fim.dados.status, 'entregue');
    assert.deepEqual(fim.dados.historico.map((h) => h.status),
      ['aguardando_confirmacao', 'recebido', 'em_preparo', 'pronto', 'despachado', 'a_caminho', 'entregue']);
  });

  test('não é possível pular etapas do pedido', async () => {
    const p = await novoPedido();
    assert.equal((await mudar(u.gerente, p.codigo, 'entregue')).status, 422);
  });

  test('RF14: estimativa de entrega por bairro', async () => {
    const r = await u.logistica.get('/api/logistica/estimativa/19'); // Pinheiros
    assert.equal(r.dados.taxa_centavos, 1200);
    assert.ok(r.dados.minutos > 0);
  });

  test('Regra 6: SLA da RotaLog calculado', async () => {
    const r = await u.logistica.get('/api/logistica/sla?dias=1');
    assert.equal(r.dados.indicadores.length, 5);
    assert.ok(r.dados.indicadores.every((i) => ['cumprido', 'descumprido', 'sem_dados'].includes(i.situacao)));
  });

  test('integração RotaLog exige chave válida', async () => {
    const r = await usuario(srv.base).post('/api/integracao/rotalog', { pedido: 'SE00001', evento: 'entregue' }, { 'X-Api-Key': 'errada' });
    assert.equal(r.status, 401);
  });
});

describe('Módulo 4 — Financeiro e pagamentos', () => {
  test('RF16 e RF19: cartão recusado e depois aprovado; só os 4 últimos dígitos são guardados', async () => {
    const p = await novoPedido({ ...pedidoEntrega, forma_pagamento: 'credito' });
    const cartao = { nome: 'MARIA CLIENTE', validade: '12/30', cvv: '123' };
    const recusa = await u.cliente.post(`/api/pedidos/${p.codigo}/pagar/cartao`, { ...cartao, numero: '4000000000000002' });
    assert.equal(recusa.status, 402);
    const ok = await u.cliente.post(`/api/pedidos/${p.codigo}/pagar/cartao`, { ...cartao, numero: '4111111111111111' });
    assert.equal(ok.dados.status, 'aprovado');
    assert.equal(ok.dados.cartao_final, '1111');
    assert.ok(!JSON.stringify(ok.dados).includes('4111111111111111'));
    assert.equal((await u.cliente.post(`/api/pedidos/${p.codigo}/pagar/cartao`, { ...cartao, numero: '4111111111111111' })).status, 422, 'não paga duas vezes');
  });

  test('RF16 e RF17: Pix e recibo', async () => {
    const p = await novoPedido();
    assert.equal((await u.cliente.get(`/api/pedidos/${p.codigo}/recibo`)).status, 422, 'sem recibo antes de pagar');
    const pix = await u.cliente.post(`/api/pedidos/${p.codigo}/pagar/pix`);
    assert.match(pix.dados.pix_copia_cola, /^000201/);
    await u.cliente.post(`/api/pedidos/${p.codigo}/pagar/pix/confirmar`);
    const recibo = await u.cliente.get(`/api/pedidos/${p.codigo}/recibo`);
    assert.equal(recibo.dados.pagamento.valor, p.total_centavos);
    assert.equal(recibo.dados.fiscal.status_nf, 'pendente_emissao', 'regra 7: transação fiscal criada');
  });

  test('estorno automático ao cancelar pedido já pago', async () => {
    const p = await novoPedido();
    await u.cliente.post(`/api/pedidos/${p.codigo}/pagar/pix`);
    await u.cliente.post(`/api/pedidos/${p.codigo}/pagar/pix/confirmar`);
    await mudar(u.atendente, p.codigo, 'cancelado', { motivo: 'Item indisponível' });
    const depois = await u.cliente.get(`/api/pedidos/${p.codigo}`);
    assert.equal(depois.dados.pagamento.status, 'estornado');
  });

  test('RF20: conciliação aponta pedido entregue sem pagamento', async () => {
    const p = await novoPedido({ itens: [{ item_id: 1, quantidade: 1 }], modalidade: 'retirada', forma_pagamento: 'dinheiro' });
    for (const [quem, st] of [[u.atendente, 'recebido'], [u.cozinha, 'em_preparo'], [u.cozinha, 'pronto'], [u.atendente, 'entregue']]) await mudar(quem, p.codigo, st);
    let c = await u.financeiro.get('/api/financeiro/conciliacao');
    assert.ok(c.dados.divergencias.some((d) => d.codigo === p.codigo));
    await u.atendente.post(`/api/financeiro/pagamentos/${p.codigo}/receber`);
    c = await u.financeiro.get('/api/financeiro/conciliacao');
    assert.ok(!c.dados.divergencias.some((d) => d.codigo === p.codigo));
  });

  test('RF18: relatórios diário, semanal e mensal', async () => {
    for (const agrupamento of ['diario', 'semanal', 'mensal']) {
      const r = await u.financeiro.get(`/api/financeiro/relatorio?agrupamento=${agrupamento}`);
      assert.equal(r.status, 200);
      assert.ok(r.dados.total.liquido > 0);
    }
    const csv = await u.financeiro.get('/api/financeiro/relatorio?formato=csv');
    assert.match(csv.dados, /"Período";"Pagamentos"/);
  });
});

describe('LGPD, auditoria e gestão', () => {
  test('exclusão de conta anonimiza os dados pessoais', async () => {
    const x = usuario(srv.base);
    await x.post('/api/auth/cadastro', { nome: 'Sai Daqui', email: 'sai@x.com', telefone: '11977776666', senha: 'saida1234', consentimento: true,
      endereco: { logradouro: 'Rua C', numero: '3', bairro_id: 1 } });
    assert.equal((await x.delete('/api/conta', { senha: 'saida1234' })).status, 200);
    assert.equal((await usuario(srv.base).post('/api/auth/login', { email: 'sai@x.com', senha: 'saida1234' })).status, 401);
  });

  test('auditoria registra as operações', async () => {
    const r = await u.gerente.get('/api/gestao/auditoria?acao=pedido');
    assert.ok(r.dados.some((a) => a.acao === 'pedido_criado'));
    assert.ok(r.dados.some((a) => a.acao === 'pedido_status'));
  });

  test('gerente altera preço e item indisponível some do cardápio', async () => {
    const item = { categoria_id: 2, nome: 'Frango grelhado', descricao: 'Novo preço', preco: '31,90' };
    await u.gerente.put('/api/gestao/itens/4', item);
    let cardapio = await usuario(srv.base).get('/api/cardapio');
    assert.equal(cardapio.dados.categorias[1].itens.find((i) => i.id === 4).preco_centavos, 3190);
    await u.gerente.post('/api/gestao/itens/4/disponivel', { disponivel: false });
    cardapio = await usuario(srv.base).get('/api/cardapio');
    assert.ok(!cardapio.dados.categorias[1].itens.some((i) => i.id === 4));
    assert.equal((await u.cliente.post('/api/pedidos', { ...pedidoEntrega, itens: [{ item_id: 4, quantidade: 1 }] })).status, 422);
  });

  test('somente o gerente acessa a gestão', async () => {
    assert.equal((await u.atendente.get('/api/gestao/painel')).status, 403);
    assert.equal((await u.gerente.get('/api/gestao/painel')).status, 200);
  });
});


describe('Melhorias — avaliação, fotos, rastreamento e QR Code', () => {
  test('cliente avalia o pedido só depois da entrega, uma única vez', async () => {
    const p = await novoPedido({ itens: [{ item_id: 2, quantidade: 1 }], modalidade: 'retirada', forma_pagamento: 'pix' });
    assert.equal((await u.cliente.post(`/api/pedidos/${p.codigo}/avaliacao`, { nota: 5 })).status, 422, 'antes da entrega');
    for (const [quem, st] of [[u.atendente, 'recebido'], [u.cozinha, 'em_preparo'], [u.cozinha, 'pronto'], [u.atendente, 'entregue']]) await mudar(quem, p.codigo, st);
    assert.equal((await u.cliente.post(`/api/pedidos/${p.codigo}/avaliacao`, { nota: 9 })).status, 422, 'nota fora de 1 a 5');
    const r = await u.cliente.post(`/api/pedidos/${p.codigo}/avaliacao`, { nota: 5, comentario: 'Ótimo!' });
    assert.equal(r.status, 201);
    assert.equal(r.dados.avaliacao.nota, 5);
    assert.equal((await u.cliente.post(`/api/pedidos/${p.codigo}/avaliacao`, { nota: 1 })).status, 409, 'não avalia duas vezes');
    const g = await u.gerente.get('/api/gestao/avaliacoes');
    assert.ok(g.dados.total >= 1 && g.dados.media > 0);
  });

  test('gerente envia foto do prato e ela aparece no cardápio', async () => {
    const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64')}`;
    assert.equal((await u.gerente.post('/api/gestao/itens/3/foto', { imagem: 'data:image/png;base64,AAAA' })).status, 422, 'só JPEG');
    const r = await u.gerente.post('/api/gestao/itens/3/foto', { imagem: jpeg });
    assert.match(r.dados.foto, /^\/fotos\/item-3\.jpg/);
    const cardapio = await usuario(srv.base).get('/api/cardapio');
    assert.ok(cardapio.dados.categorias[0].itens.find((i) => i.id === 3).foto);
    await u.gerente.delete('/api/gestao/itens/3/foto');
    const depois = await usuario(srv.base).get('/api/cardapio');
    assert.equal(depois.dados.categorias[0].itens.find((i) => i.id === 3).foto, null);
  });

  test('acompanhamento do entregador: posição estimada, posição da RotaLog e previsão de chegada', async () => {
    const p = await novoPedido();
    for (const [quem, st] of [[u.atendente, 'recebido'], [u.cozinha, 'em_preparo'], [u.cozinha, 'pronto']]) await mudar(quem, p.codigo, st);
    let r = await u.logistica.get('/api/logistica/rastreamento');
    let e = r.dados.entregas.find((x) => x.codigo === p.codigo);
    assert.equal(e.origem, 'aguardando');
    assert.ok(e.chegada_prevista && e.prazo_sla);
    await u.logistica.post(`/api/logistica/pedidos/${p.codigo}/despachar`, { entregador_id: 2 });
    await u.logistica.post(`/api/logistica/pedidos/${p.codigo}/a-caminho`);
    r = await u.logistica.get('/api/logistica/rastreamento');
    e = r.dados.entregas.find((x) => x.codigo === p.codigo);
    assert.equal(e.origem, 'estimativa');
    assert.ok(e.progresso >= 0 && e.progresso < 1);

    const { getDb } = require('../src/db/database');
    const chave = getDb().prepare("SELECT valor FROM configuracoes WHERE chave = 'rotalog_api_key'").get().valor;
    const pos = await usuario(srv.base).post('/api/integracao/rotalog', { pedido: p.codigo, evento: 'posicao', progresso: 60 }, { 'X-Api-Key': chave });
    assert.equal(pos.dados.progresso, 60);
    r = await u.logistica.get('/api/logistica/rastreamento');
    e = r.dados.entregas.find((x) => x.codigo === p.codigo);
    assert.equal(e.origem, 'rotalog');
    assert.equal(e.progresso, 0.6);
  });

  test('endereços de rede para o QR Code das mesas (somente gerente)', async () => {
    assert.equal((await u.atendente.get('/api/gestao/rede')).status, 403);
    const r = await u.gerente.get('/api/gestao/rede');
    assert.ok(Array.isArray(r.dados.enderecos));
  });
});