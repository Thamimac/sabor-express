// Testes unitários das regras de domínio e validações (não precisam do servidor rodando)
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const regras = require('../src/services/regras');
const util = require('../src/lib/util');
const { luhnValido, validarCartao } = require('../src/services/pagamentos');
const { hashSenha, verificarSenha } = require('../src/lib/seguranca');

// Cria uma data no horário de São Paulo, ex.: emSaoPaulo('10:59')
const emSaoPaulo = (hhmm) => new Date(`2026-11-27T${hhmm}:00-03:00`);

describe('Regra de domínio 1 — horário de funcionamento (11h às 23h)', () => {
  afterEach(() => regras.salvarConfiguracao('ignorar_horario', '0'));

  test('fechado às 10:59 e aberto às 11:00', () => {
    assert.equal(regras.situacaoFuncionamento(emSaoPaulo('10:59')).aberto, false);
    assert.equal(regras.situacaoFuncionamento(emSaoPaulo('11:00')).aberto, true);
  });
  test('aberto às 22:59 e fechado às 23:00', () => {
    assert.equal(regras.situacaoFuncionamento(emSaoPaulo('22:59')).aberto, true);
    assert.equal(regras.situacaoFuncionamento(emSaoPaulo('23:00')).aberto, false);
  });
  test('pedido fora do horário é recusado com mensagem clara', () => {
    assert.throws(() => regras.exigirRestauranteAberto(emSaoPaulo('03:00')), /restaurante está fechado/);
  });
  test('modo demonstração libera pedidos fora do horário', () => {
    regras.salvarConfiguracao('ignorar_horario', '1');
    assert.equal(regras.situacaoFuncionamento(emSaoPaulo('03:00')).aberto, true);
  });
});

describe('Regras de domínio 2 e 3 — taxa por distância e raio de 8 km', () => {
  test('faixas de taxa: até 3 km, 3–5 km e 5–8 km', () => {
    assert.equal(regras.taxaEntrega(1.6), 500);
    assert.equal(regras.taxaEntrega(3), 500);
    assert.equal(regras.taxaEntrega(3.1), 800);
    assert.equal(regras.taxaEntrega(5), 800);
    assert.equal(regras.taxaEntrega(7.8), 1200);
    assert.equal(regras.taxaEntrega(8), 1200);
  });
  test('endereço acima de 8 km é recusado', () => {
    assert.throws(() => regras.taxaEntrega(8.1), /fora da área de entrega/);
    assert.equal(regras.dentroDoRaio(9.6), false);
  });
});

describe('Regra de domínio 4 — previsão pelo tempo de preparo por categoria', () => {
  test('vale o maior tempo entre as categorias do pedido', () => {
    assert.equal(regras.tempoPreparoMin([10, 2, 5]), 10);   // executivo + bebida + sobremesa
    assert.equal(regras.tempoPreparoMin([30, 10]), 30);     // à la carte domina
  });
  test('previsão de entrega soma preparo + deslocamento (RF14)', () => {
    const e = regras.estimarPrazo({ temposPreparo: [10], modalidade: 'entrega', distanciaKm: 4, inicio: new Date('2026-11-27T15:00:00Z') });
    assert.equal(e.preparoMin, 10);
    assert.equal(e.entregaMin, 22); // 8 + 4 × 3,5
    assert.equal(e.previsaoEm, '2026-11-27T15:32:00.000Z');
  });
  test('retirada e salão não somam tempo de entrega', () => {
    assert.equal(regras.estimarPrazo({ temposPreparo: [15], modalidade: 'retirada' }).entregaMin, 0);
  });
});

describe('Validações de cadastro (RF21) e segurança', () => {
  test('senha forte exige 8 caracteres com letras e números', () => {
    assert.throws(() => util.senhaForte('abc123'), /8 caracteres/);
    assert.throws(() => util.senhaForte('somenteletras'), /letras e números/);
    assert.equal(util.senhaForte('sabor2026'), 'sabor2026');
  });
  test('telefone é validado e formatado', () => {
    assert.equal(util.telefone('11987654321'), '(11) 98765-4321');
    assert.throws(() => util.telefone('1234'), /Telefone inválido/);
  });
  test('e-mail inválido é recusado', () => {
    assert.throws(() => util.email('maria@'), /E-mail inválido/);
    assert.equal(util.email('  Maria@Email.com '), 'maria@email.com');
  });
  test('senha é guardada com hash e salt (nunca em texto puro)', () => {
    const h1 = hashSenha('sabor2026');
    const h2 = hashSenha('sabor2026');
    assert.notEqual(h1, h2); // salt diferente a cada vez
    assert.ok(!h1.includes('sabor2026'));
    assert.equal(verificarSenha('sabor2026', h1), true);
    assert.equal(verificarSenha('errada123', h1), false);
  });
});

describe('Pagamento com cartão (RF16) — validações do gateway', () => {
  test('algoritmo de Luhn', () => {
    assert.equal(luhnValido('4111111111111111'), true);
    assert.equal(luhnValido('4111111111111112'), false);
  });
  test('cartão vencido e CVV inválido são recusados', () => {
    assert.throws(() => validarCartao({ numero: '4111111111111111', nome: 'MARIA', validade: '01/20', cvv: '123' }), /vencido/);
    assert.throws(() => validarCartao({ numero: '4111111111111111', nome: 'MARIA', validade: '12/30', cvv: '1' }), /CVV/);
  });
});