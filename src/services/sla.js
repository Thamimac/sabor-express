// Indicadores do SLA acordado com a RotaLog Entregas (item 3.2.4 e regra de domínio 6)
const config = require('../config');
const { todos, um } = require('../db/database');
const { minutosEntre, agoraISO } = require('../lib/util');

const media = (lista) => (lista.length ? lista.reduce((s, v) => s + v, 0) / lista.length : null);
const percentual = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : null);
const arred = (v) => (v == null ? null : Math.round(v * 10) / 10);

function calcular(inicioISO, fimISO) {
  const meta = config.sla;
  const pedidos = todos(`SELECT * FROM pedidos WHERE modalidade = 'entrega' AND criado_em >= ? AND criado_em < ?`, inicioISO, fimISO);

  // 1) Tempo de aceite pelo entregador (despacho → aceite): meta até 3 min
  const aceites = pedidos.filter((p) => p.despachado_em && p.aceite_em).map((p) => minutosEntre(p.despachado_em, p.aceite_em));

  // 2) Tempo de entrega (pedido pronto → entregue): meta até 40 min (raio de 8 km)
  const entregas = pedidos.filter((p) => p.pronto_em && p.entregue_em).map((p) => minutosEntre(p.pronto_em, p.entregue_em));

  // 3) Disponibilidade de entregadores: despachos aceitos ÷ despachos feitos (recusas voltam para "pronto")
  const despachos = um(`SELECT COUNT(*) AS n FROM historico_status h JOIN pedidos p ON p.id = h.pedido_id
                        WHERE h.status = 'despachado' AND p.criado_em >= ? AND p.criado_em < ?`, inicioISO, fimISO).n;
  const aceitos = pedidos.filter((p) => p.aceite_em).length;

  // 4) Extravio/avaria sobre pedidos entregues: meta menor que 1%
  const entregues = pedidos.filter((p) => p.status === 'entregue').length;
  const ocorrencias = todos(`SELECT o.* FROM ocorrencias o JOIN pedidos p ON p.id = o.pedido_id
                             WHERE p.criado_em >= ? AND p.criado_em < ?`, inicioISO, fimISO);
  const perdas = ocorrencias.filter((o) => ['extravio', 'avaria'].includes(o.tipo)).length;

  // 5) Tempo de resposta a incidentes (abertura → resolução): meta até 15 min
  const respostas = ocorrencias.filter((o) => o.resolvida_em).map((o) => minutosEntre(o.criado_em, o.resolvida_em));
  const abertas = ocorrencias.filter((o) => !o.resolvida_em);
  const abertasEstouradas = abertas.filter((o) => minutosEntre(o.criado_em, agoraISO()) > meta.respostaIncidenteMin).length;

  const indicadores = [
    {
      chave: 'aceite', nome: 'Tempo de aceite do pedido pelo entregador', meta: `Até ${meta.aceiteMin} min após o despacho`,
      valor: arred(media(aceites)), unidade: 'min', amostra: aceites.length,
      dentro: percentual(aceites.filter((m) => m <= meta.aceiteMin).length, aceites.length),
    },
    {
      chave: 'entrega', nome: 'Tempo médio de entrega (raio de até 8 km)', meta: `Até ${meta.entregaMin} min após o pedido pronto`,
      valor: arred(media(entregas)), unidade: 'min', amostra: entregas.length,
      dentro: percentual(entregas.filter((m) => m <= meta.entregaMin).length, entregas.length),
    },
    {
      chave: 'disponibilidade', nome: 'Disponibilidade de entregadores', meta: 'Mínimo de 90% da demanda atendida',
      valor: percentual(Math.min(aceitos, despachos), despachos), unidade: '%', amostra: despachos,
    },
    {
      chave: 'perdas', nome: 'Taxa de extravio/avaria de pedidos', meta: 'Menor que 1% dos pedidos entregues',
      valor: entregues ? percentual(perdas, entregues) : null, unidade: '%', amostra: entregues,
    },
    {
      chave: 'incidentes', nome: 'Tempo de resposta a incidentes', meta: `Até ${meta.respostaIncidenteMin} min`,
      valor: arred(media(respostas)), unidade: 'min', amostra: respostas.length, abertas: abertas.length, abertasForaDoPrazo: abertasEstouradas,
    },
  ];

  // Situação de cada indicador: cumprido, descumprido ou sem dados no período
  const cumpre = {
    aceite: (v) => v <= meta.aceiteMin,
    entrega: (v) => v <= meta.entregaMin,
    disponibilidade: (v) => v >= 90,
    perdas: (v) => v < meta.taxaExtravioMax * 100,
    incidentes: (v) => v <= meta.respostaIncidenteMin,
  };
  for (const i of indicadores) {
    i.situacao = i.valor == null ? 'sem_dados' : cumpre[i.chave](i.valor) ? 'cumprido' : 'descumprido';
    if (i.chave === 'incidentes' && i.abertasForaDoPrazo) i.situacao = 'descumprido';
  }

  return {
    periodo: { inicio: inicioISO, fim: fimISO },
    pedidosDeEntrega: pedidos.length,
    indicadores,
    resumo: {
      cumpridos: indicadores.filter((i) => i.situacao === 'cumprido').length,
      descumpridos: indicadores.filter((i) => i.situacao === 'descumprido').length,
    },
    penalidade: 'O descumprimento das metas por dois meses consecutivos prevê desconto no valor pago à RotaLog e, se reincidente, rescisão.',
  };
}

module.exports = { calcular };