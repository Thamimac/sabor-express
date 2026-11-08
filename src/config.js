// Configurações gerais do sistema (podem ser alteradas por variáveis de ambiente)
const path = require('node:path');

const raiz = path.join(__dirname, '..');

module.exports = {
  raiz,
  porta: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(raiz, 'data', 'sabor-express.db'),
  backupDir: process.env.BACKUP_DIR || path.join(raiz, 'backups'),
  backupsMantidos: 7,
  publicDir: path.join(raiz, 'public'),
  sessaoHoras: 8,
  cookieSeguro: process.env.COOKIE_SECURE === '1', // ative em produção (HTTPS)
  fusoHorario: 'America/Sao_Paulo',
  restaurante: {
    nome: 'Sabor Express',
    endereco: 'Rua Barão de Paranapiacaba, 100 - Sé, São Paulo/SP',
    cnpj: '12.345.678/0001-90',
    telefone: '(11) 3333-4444',
    raioKm: 8,
    lat: -23.5512, // localização do restaurante no mapa (Sé)
    lng: -46.6339,
  },

    // Programa de fidelidade: entrega grátis a cada N pedidos entregues
  fidelidade: { pedidosPorPremio: 10 },

  // SLA acordado com a RotaLog Entregas (item 3.2.4 da documentação)
  sla: {
    aceiteMin: 3,
    entregaMin: 40,
    respostaIncidenteMin: 15,
    taxaExtravioMax: 0.01,
  },
};