// Sabor Express - ponto de entrada do servidor web
const http = require('node:http');
const config = require('./config');
const { App } = require('./lib/http');
const { getDb } = require('./db/database');
const { carregarSessao } = require('./lib/sessao');

// Serviços que reagem a eventos dos pedidos (precisam ser carregados uma vez)
require('./services/notificacoes');
require('./services/pagamentos');

function criarApp() {
  const app = new App({ publicDir: config.publicDir });

  // Identifica o usuário logado em todas as requisições à API
  app.use(carregarSessao);

  // Rotas de cada módulo
  require('./rotas/geral')(app);
  require('./rotas/autenticacao')(app);   // Módulo 5
  require('./rotas/conta')(app);          // Módulo 5
  require('./rotas/pedidos')(app);        // Módulo 1
  require('./rotas/equipe')(app);         // Atendimento e Módulo 2 (cozinha)
  require('./rotas/logistica')(app);      // Módulo 3
  require('./rotas/financeiro')(app);     // Módulo 4
  require('./rotas/gestao')(app);         // Gerente

  return app;
}

function iniciar(porta = config.porta) {
  getDb(); // abre o banco e cria os dados iniciais na primeira vez
  const servidor = http.createServer(criarApp().handler());
  servidor.listen(porta, () => {
    console.log('');
    console.log('  🍽️  Sabor Express rodando!');
    console.log(`  ➜  Acesse: http://localhost:${porta}`);
    console.log('  ➜  Para parar: Ctrl + C');
    console.log('');
    require('./services/backup').agendarBackupDiario(); // RNF Confiabilidade
  });
  return servidor;
}

if (require.main === module) iniciar();

module.exports = { criarApp, iniciar };