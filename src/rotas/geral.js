// Rotas gerais: situação do restaurante e lista de bairros atendidos
const config = require('../config');
const { todos, um } = require('../db/database');
const regras = require('../services/regras');

module.exports = (app) => {
  // Situação do sistema e do restaurante (aberto/fechado)
  app.get('/api/status', () => ({
    sistema: 'Sabor Express',
    versao: require('../../package.json').version,
    restaurante: config.restaurante,
    funcionamento: regras.situacaoFuncionamento(),
    faixasEntrega: regras.FAIXAS_ENTREGA,
    totais: {
      itensNoCardapio: um('SELECT COUNT(*) AS n FROM itens WHERE disponivel = 1').n,
      bairrosAtendidos: um('SELECT COUNT(*) AS n FROM bairros WHERE distancia_km <= ?', config.restaurante.raioKm).n,
    },
  }));

  // Bairros com distância, taxa e se estão dentro do raio de entrega
  app.get('/api/bairros', () =>
    todos('SELECT id, nome, distancia_km FROM bairros ORDER BY nome').map((b) => {
      const atende = regras.dentroDoRaio(b.distancia_km);
      return { ...b, atende, taxa_centavos: atende ? regras.taxaEntrega(b.distancia_km) : null };
    }));
};