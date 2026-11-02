// Sabor Express - ponto de entrada do servidor web
const http = require('node:http');
const config = require('./config');
const { App } = require('./lib/http');
const { getDb } = require('./db/database');
const { carregarSessao } = require('./lib/sessao');

function criarApp() {
  const app = new App({ publicDir: config.publicDir });

  // Identifica o usuário logado em todas as requisições à API
  app.use(carregarSessao);

  // Rotas de cada módulo (novas linhas serão adicionadas nas próximas partes)
  require('./rotas/geral')(app);
  require('./rotas/autenticacao')(app);   // Módulo 5
  require('./rotas/conta')(app);          // Módulo 5

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
  });
  return servidor;
}

if (require.main === module) iniciar();

module.exports = { criarApp, iniciar };