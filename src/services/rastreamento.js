// Acompanhamento do entregador (RF13/RF14): posição no trajeto e previsão de chegada.
// Sem GPS real, a posição é ESTIMADA pelo tempo decorrido desde a saída do entregador.
// Quando a RotaLog envia a posição pela integração, o sistema usa o dado recebido.
const config = require('../config');
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { agora, agoraISO, minutosEntre } = require('../lib/util');
const { tempoDeslocamentoMin } = require('./regras');

// Localização aproximada (centro) de cada bairro atendido, para o mapa real (latitude, longitude)
const LOCAIS = {
  'Sé': [-23.5468, -46.6362], 'República': [-23.5443, -46.6425], 'Liberdade': [-23.5587, -46.6350], 'Bela Vista': [-23.5614, -46.6474],
  'Bom Retiro': [-23.5272, -46.6370], 'Santa Cecília': [-23.5370, -46.6510], 'Consolação': [-23.5536, -46.6590], 'Brás': [-23.5440, -46.6160],
  'Cambuci': [-23.5680, -46.6230], 'Higienópolis': [-23.5440, -46.6600], 'Aclimação': [-23.5720, -46.6330], 'Barra Funda': [-23.5270, -46.6680],
  'Mooca': [-23.5600, -46.5990], 'Paraíso': [-23.5760, -46.6420], 'Perdizes': [-23.5370, -46.6800], 'Vila Mariana': [-23.5890, -46.6350],
  'Pari': [-23.5280, -46.6150], 'Santana': [-23.5020, -46.6250], 'Pinheiros': [-23.5660, -46.6900], 'Ipiranga': [-23.5870, -46.6100],
  'Tatuapé': [-23.5400, -46.5760], 'Moema': [-23.6000, -46.6640], 'Butantã': [-23.5720, -46.7100], 'Santo Amaro': [-23.6540, -46.7100],
  'Itaquera': [-23.5400, -46.4560],
};

// Coordenadas do bairro. Bairro cadastrado depois (sem localização conhecida): posição calculada pela
// distância cadastrada, numa direção fixa derivada do nome.
function coordenadas(nomeBairro, distanciaKm) {
  if (LOCAIS[nomeBairro]) return { lat: LOCAIS[nomeBairro][0], lng: LOCAIS[nomeBairro][1] };
  const graus = [...nomeBairro].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const rad = (graus * Math.PI) / 180;
  const { lat, lng } = config.restaurante;
  return {
    lat: +(lat + (Math.cos(rad) * distanciaKm) / 111.32).toFixed(5),
    lng: +(lng + (Math.sin(rad) * distanciaKm) / (111.32 * Math.cos((lat * Math.PI) / 180))).toFixed(5),
  };
}

// Ponto no caminho entre o restaurante e o destino (fração de 0 a 1) — trajeto aproximado em linha reta
function pontoNoCaminho(destino, fracao) {
  const { lat, lng } = config.restaurante;
  return { lat: +(lat + (destino.lat - lat) * fracao).toFixed(5), lng: +(lng + (destino.lng - lng) * fracao).toFixed(5) };
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
    return { ...base, progresso: 0, posicao: pontoNoCaminho(destino, 0), origem: 'aguardando', minutos_restantes: config.sla.aceiteMin + deslocamento,
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
    posicao: pontoNoCaminho(destino, progresso),
    km_restantes: Math.round(p.distancia_km * (1 - progresso) * 10) / 10,
    minutos_em_rota: Math.floor(decorrido), minutos_restantes: restantes, chegada_prevista: chegada,
    atrasado: prazoSla ? chegada > prazoSla : false,
  };
}

// Visão geral para o mapa da logística
function painel() {
  const { nome, endereco, raioKm, lat, lng } = config.restaurante;
  const restaurante = { nome, endereco, raioKm, lat, lng };
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

module.exports = { coordenadas, estadoDaEntrega, painel, registrarPosicao, LOCAIS };