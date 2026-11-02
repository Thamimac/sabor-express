// Eventos em tempo real (Server-Sent Events) e barramento interno entre módulos
const { EventEmitter } = require('node:events');

// Barramento interno: um módulo avisa ("pedido mudou de status") e outros reagem
// (notificações, pagamentos...) sem que um precise conhecer o código do outro.
const barramento = new EventEmitter();
barramento.setMaxListeners(50);

// Conexões abertas pelos navegadores para receber atualizações sem recarregar a página
const conexoes = new Set();

function conectar(ctx) {
  const { req, res } = ctx;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  const conexao = { res, usuario: ctx.usuario };
  conexoes.add(conexao);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000); // mantém a conexão viva
  req.on('close', () => {
    clearInterval(ping);
    conexoes.delete(conexao);
  });
  ctx.encerrado = true; // a resposta continua aberta
}

// Envia o evento para a equipe (opcionalmente só alguns perfis) e para o cliente dono do pedido
function publicar(tipo, dados, { clienteId = null, perfis = null } = {}) {
  const mensagem = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const { res, usuario } of conexoes) {
    const paraEquipe = usuario.equipe && (!perfis || usuario.perfil === 'gerente' || perfis.includes(usuario.perfil));
    const paraCliente = clienteId && usuario.id === clienteId;
    if (paraEquipe || paraCliente) res.write(mensagem);
  }
}

module.exports = { barramento, conectar, publicar };