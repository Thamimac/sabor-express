// Acompanhamento do entregador (RF13/RF14): posição no trajeto e previsão de chegada.
// Sem GPS real, a posição é ESTIMADA pelo tempo decorrido desde a saída do entregador.
// Quando a RotaLog envia a posição pela integração, o sistema usa o dado recebido.
const config = require('../config');
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { agora, agoraISO, minutosEntre } = require('../lib/util');
const { tempoDeslocamentoMin } = require('./regras');

// Direção aproximada de cada bairro a partir do restaurante (Sé), em graus (0 = norte, 90 = leste)
const DIRECAO = {
  'Sé': 30, 'República': 290, 'Liberdade': 175, 'Bela Vista': 220, 'Bom Retiro': 335, 'Santa Cecília': 305, 'Consolação': 250,
  'Brás': 80, 'Cambuci': 150, 'Higienópolis': 285, 'Aclimação': 165, 'Barra Funda': 305, 'Mooca': 110, 'Paraíso': 200,
  'Perdizes': 290, 'Vila Mariana': 195, 'Pari': 45, 'Santana': 5, 'Pinheiros': 255, 'Ipiranga': 160, 'Tatuapé': 85,
  'Moema': 205, 'Butantã': 250, 'Santo Amaro': 200, 'Itaquera': 80,
};
function direcao(nome) {
  if (DIRECAO[nome] != null) return DIRECAO[nome];
  return [...nome].reduce((s, c) => s + c.charCodeAt(0), 0) % 360; // bairro novo: direção fixa calculada pelo nome
}

// Coordenadas em km (x = leste, y = norte) com o restaurante em (0, 0)
function coordenadas(nomeBairro, distanciaKm) {
  const rad = (direcao(nomeBairro) * Math.PI) / 180;
  return { x: Math.round(Math.sin(rad) * distanciaKm * 100) / 100, y: Math.round(Math.cos(rad) * distanciaKm * 100) / 100 };
}

// Estado da entrega: progresso, posição, tempo restante, previsão de chegada e situação do SLA
function estadoDaEntrega(p, bairro, referencia = agora()) {
  const destino = coordenadas(bairro.nome, p.distancia_km);
  const prazoSla = p.pronto_em ? new Date(new Date(p.pronto_em).getTime() + config.sla.entregaMin * 60000).toISOString() : null;
  const deslocamento = p.entrega_estimada_min || tempoDeslocamentoMin(p.distancia_km);
  const base = { codigo: p.codigo, status: p.status, bairro: bairro.nome, distancia_km: p.distancia_km, destino, prazo_sla: prazoSla, deslocamento_min: deslocamento };

  if (p.status === 'despachado' || p.status === 'pronto') {
    // Ainda no restaurante: estima a chegada se o entregador sair agora (aceite em até 3 min + deslocamento)
    const chegada = new Date(referencia.getTime() + (config.sla.aceiteMin + deslocamento) * 60000).toISOString();
    return { ...base, progresso: 0, posicao: { x: 0, y: 0 }, origem: 'aguardando', minutos_restantes: config.sla.aceiteMin + deslocamento,
      chegada_prevista: chegada, atrasado: prazoSla ? chegada > prazoSla : false };
  }

  // Em rota: usa a última posição enviada pela RotaLog (até 5 min atrás) ou estima pelo tempo
  const real = um('SELECT * FROM rastreamento WHERE pedido_id = ? ORDER BY id DESC LIMIT 1', p.id);
  const decorrido = Math.max(0, minutosEntre(p.aceite_em, referencia.toISOString()));
  let progresso;
  let origem;
  if (real && minutosEntre(real.em, referencia.toISOString()) <= 5) {
    progresso = real.progresso;
    origem = 'rotalog';
  } else {
    progresso = Math.min(0.97, decorrido / deslocamento); // nunca marca 100% sem a confirmação de entrega
    origem = 'estimativa';
  }
  const restantes = Math.max(1, Math.ceil(deslocamento * (1 - progresso)));
  const chegada = new Date(referencia.getTime() + restantes * 60000).toISOString();
  return {
    ...base, progresso: Math.round(progresso * 100) / 100, origem,
    posicao: { x: Math.round(destino.x * progresso * 100) / 100, y: Math.round(destino.y * progresso * 100) / 100 },
    km_restantes: Math.round(p.distancia_km * (1 - progresso) * 10) / 10,
    minutos_em_rota: Math.floor(decorrido), minutos_restantes: restantes, chegada_prevista: chegada,
    atrasado: prazoSla ? chegada > prazoSla : false,
  };
}

// Visão geral para o mapa da logística
function painel() {
  const restaurante = { nome: config.restaurante.nome, endereco: config.restaurante.endereco, raioKm: config.restaurante.raioKm };
  const bairros = todos('SELECT * FROM bairros ORDER BY nome').map((b) => ({ id: b.id, nome: b.nome, distancia_km: b.distancia_km,
    atende: b.distancia_km <= config.restaurante.raioKm, ...coordenadas(b.nome, b.distancia_km) }));
  const pedidos = todos(`SELECT p.*, e.nome AS entregador_nome, e.telefone AS entregador_telefone, e.veiculo AS entregador_veiculo,
                           b.nome AS bairro_nome
                         FROM pedidos p JOIN bairros b ON b.id = p.bairro_id LEFT JOIN entregadores e ON e.id = p.entregador_id
                         WHERE p.modalidade = 'entrega' AND p.status IN ('pronto', 'despachado', 'a_caminho') ORDER BY p.pronto_em`);
  const entregas = pedidos.map((p) => ({
    ...estadoDaEntrega(p, { nome: p.bairro_nome }),
    cliente: p.cliente_nome, endereco: p.endereco_texto, saiu_em: p.aceite_em,
    entregador: p.entregador_id ? { nome: p.entregador_nome, telefone: p.entregador_telefone, veiculo: p.entregador_veiculo } : null,
  }));
  return { restaurante, faixas: [3, 5, config.restaurante.raioKm], bairros, entregas, atualizado_em: agoraISO() };
}

// Posição recebida da RotaLog: progresso (0–100%) ou km restantes até o cliente
function registrarPosicao(pedido, { progresso, km_restantes: kmRestantes }) {
  if (pedido.status !== 'a_caminho') throw new HttpError(422, 'Só é possível rastrear pedidos em rota');
  let fracao;
  if (progresso != null) fracao = Number(progresso) / 100;
  else if (kmRestantes != null) fracao = 1 - Number(kmRestantes) / pedido.distancia_km;
  if (!Number.isFinite(fracao)) throw new HttpError(422, 'Informe o progresso (0 a 100) ou os km restantes');
  fracao = Math.min(1, Math.max(0, fracao));
  executar('INSERT INTO rastreamento (pedido_id, progresso, origem, em) VALUES (?, ?, ?, ?)', pedido.id, fracao, 'rotalog', agoraISO());
  return fracao;
}

module.exports = { coordenadas, estadoDaEntrega, painel, registrarPosicao, DIRECAO };