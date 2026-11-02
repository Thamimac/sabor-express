// Ferramentas dos testes: sobe o sistema com um banco em memória e simula usuários com login
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const http = require('node:http');
const { criarApp } = require('../src/server');
const { getDb } = require('../src/db/database');

async function iniciarServidor() {
  getDb(); // cria o banco em memória com os dados iniciais
  const servidor = http.createServer(criarApp().handler());
  await new Promise((ok) => servidor.listen(0, ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { base, fechar: () => new Promise((ok) => { servidor.closeAllConnections(); servidor.close(ok); }) };
}

// Cliente HTTP que guarda o cookie de sessão (como um navegador)
function usuario(base) {
  let cookie = '';
  async function chamar(metodo, caminho, corpo, cabecalhos = {}) {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...cabecalhos },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    const setCookie = r.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const texto = await r.text();
    let dados;
    try { dados = JSON.parse(texto); } catch { dados = texto; }
    return { status: r.status, dados };
  }
  return {
    get: (c, h) => chamar('GET', c, undefined, h),
    post: (c, b = {}, h) => chamar('POST', c, b, h),
    put: (c, b = {}) => chamar('PUT', c, b),
    delete: (c, b) => chamar('DELETE', c, b),
    async entrar(email, senha) {
      const r = await chamar('POST', '/api/auth/login', { email, senha });
      if (r.status !== 200) throw new Error(`Login falhou: ${email}`);
      return this;
    },
  };
}

const SENHA_EQUIPE = 'sabor2026';
async function equipe(base) {
  return {
    cliente: await usuario(base).entrar('maria@email.com', 'cliente2026'),
    gerente: await usuario(base).entrar('gerente@saborexpress.com.br', SENHA_EQUIPE),
    atendente: await usuario(base).entrar('atendimento@saborexpress.com.br', SENHA_EQUIPE),
    cozinha: await usuario(base).entrar('cozinha@saborexpress.com.br', SENHA_EQUIPE),
    logistica: await usuario(base).entrar('logistica@saborexpress.com.br', SENHA_EQUIPE),
    financeiro: await usuario(base).entrar('financeiro@saborexpress.com.br', SENHA_EQUIPE),
  };
}

// Liga o modo demonstração para os testes não dependerem do horário em que rodam
function ignorarHorario(ligado = true) {
  getDb().prepare("UPDATE configuracoes SET valor = ? WHERE chave = 'ignorar_horario'").run(ligado ? '1' : '0');
}

module.exports = { iniciarServidor, usuario, equipe, ignorarHorario };