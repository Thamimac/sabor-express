// Sabor Express - ponto de entrada do servidor web
const http = require('node:http');
const config = require('./config');
const { App } = require('./lib/http');
const { getDb } = require('./db/database');

function criarApp() {
  const app = new App({ publicDir: config.publicDir });

  // Rotas de cada módulo (novas linhas serão adicionadas nas próximas partes)
  require('./rotas/geral')(app);

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