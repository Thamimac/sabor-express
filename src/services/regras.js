// Regras de domínio do negócio (item 3.3.6 da documentação)
const config = require('../config');
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { agora, partesLocais } = require('../lib/util');

// ---- Configurações editáveis pelo gerente ----
function lerConfiguracoes() {
  return Object.fromEntries(todos('SELECT chave, valor FROM configuracoes').map((c) => [c.chave, c.valor]));
}
function salvarConfiguracao(chave, valor) {
  executar('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', chave, String(valor));
}

const paraMinutos = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

// Regra 1: pedidos somente no horário de funcionamento (11h às 23h)
function situacaoFuncionamento(data = agora()) {
  const cfg = lerConfiguracoes();
  const abertura = cfg.horario_abertura || '11:00';
  const fechamento = cfg.horario_fechamento || '23:00';
  const modoDemonstracao = cfg.ignorar_horario === '1' || process.env.IGNORAR_HORARIO === '1';
  const { hora, minuto } = partesLocais(data);
  const minutoAtual = hora * 60 + minuto;
  const dentroDoHorario = minutoAtual >= paraMinutos(abertura) && minutoAtual < paraMinutos(fechamento);
  return { aberto: dentroDoHorario || modoDemonstracao, dentroDoHorario, modoDemonstracao, abertura, fechamento };
}

function exigirRestauranteAberto(data = agora()) {
  const s = situacaoFuncionamento(data);
  if (!s.aberto) {
    throw new HttpError(422, `O restaurante está fechado. Recebemos pedidos das ${s.abertura} às ${s.fechamento}.`);
  }
  return s;
}

// Regras 2 e 3: taxa por faixa de distância e raio máximo de 8 km
const FAIXAS_ENTREGA = [
  { ateKm: 3, taxaCentavos: 500, rotulo: 'Até 3 km' },
  { ateKm: 5, taxaCentavos: 800, rotulo: 'De 3 a 5 km' },
  { ateKm: config.restaurante.raioKm, taxaCentavos: 1200, rotulo: 'De 5 a 8 km' },
];

function taxaEntrega(distanciaKm) {
  const faixa = FAIXAS_ENTREGA.find((f) => distanciaKm <= f.ateKm);
  if (!faixa) {
    throw new HttpError(422, `Endereço fora da área de entrega (${distanciaKm.toString().replace('.', ',')} km). Entregamos em até ${config.restaurante.raioKm} km.`);
  }
  return faixa.taxaCentavos;
}

function bairroPorId(id) {
  const b = um('SELECT * FROM bairros WHERE id = ?', Number(id));
  if (!b) throw new HttpError(422, 'Bairro não encontrado');
  return b;
}

const dentroDoRaio = (distanciaKm) => distanciaKm <= config.restaurante.raioKm;

// Regra 4: estimativa considerando o tempo de preparo por categoria
// Os itens são preparados em paralelo, então vale o maior tempo entre eles.
function tempoPreparoMin(temposDasCategorias) {
  return Math.max(5, ...temposDasCategorias.filter(Number.isFinite));
}

// Deslocamento estimado do entregador (urbano, ~3,5 min/km + 8 min de coleta)
function tempoDeslocamentoMin(distanciaKm) {
  return Math.ceil(8 + distanciaKm * 3.5);
}

function estimarPrazo({ temposPreparo, modalidade, distanciaKm, inicio = agora() }) {
  const preparo = tempoPreparoMin(temposPreparo);
  const entrega = modalidade === 'entrega' ? tempoDeslocamentoMin(distanciaKm) : 0;
  const previsao = new Date(new Date(inicio).getTime() + (preparo + entrega) * 60000);
  return { preparoMin: preparo, entregaMin: entrega, totalMin: preparo + entrega, previsaoEm: previsao.toISOString() };
}

module.exports = {
  lerConfiguracoes, salvarConfiguracao, situacaoFuncionamento, exigirRestauranteAberto,
  FAIXAS_ENTREGA, taxaEntrega, bairroPorId, dentroDoRaio, tempoPreparoMin, tempoDeslocamentoMin, estimarPrazo,
};