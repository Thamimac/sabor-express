// Módulo 5 — Cadastro e autenticação (RF21, RF22, RF23)
const { um, executar, transacao } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { hashSenha, verificarSenha, tokenAleatorio, sha256 } = require('../lib/seguranca');
const { criarSessao, encerrarSessao, encerrarTodasAsSessoes } = require('../lib/sessao');
const { texto, email, telefone, senhaForte, agora, agoraISO } = require('../lib/util');
const enderecos = require('../services/enderecos');
const auditoria = require('../services/auditoria');
const { enviarEmail } = require('../services/email');

// Proteção contra força bruta: 5 erros seguidos bloqueiam por 5 minutos
const falhas = new Map();
function verificarBloqueio(chave) {
  const f = falhas.get(chave);
  if (f?.bloqueadoAte > Date.now()) throw new HttpError(429, 'Muitas tentativas. Aguarde 5 minutos e tente novamente.');
}
function registrarFalha(chave) {
  const f = falhas.get(chave) || { n: 0 };
  f.n += 1;
  if (f.n >= 5) { f.bloqueadoAte = Date.now() + 5 * 60000; f.n = 0; }
  falhas.set(chave, f);
}

const dadosPublicos = (u) => ({
  id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, perfil: u.perfil,
  equipe: u.perfil !== 'cliente',
});

module.exports = (app) => {
  // RF21 — Cadastro de cliente com nome, e-mail, telefone, endereço e senha
  app.post('/api/auth/cadastro', (ctx) => {
    const b = ctx.body;
    const dados = {
      nome: texto(b.nome, 'nome', { min: 3, max: 80 }),
      email: email(b.email),
      telefone: telefone(b.telefone),
      senha: senhaForte(b.senha),
    };
    // Regra de domínio 5 (LGPD): consentimento obrigatório
    if (b.consentimento !== true) {
      throw new HttpError(422, 'É preciso aceitar a Política de Privacidade para criar a conta');
    }
    enderecos.validar(b.endereco); // valida antes de gravar qualquer coisa
    if (um('SELECT id FROM usuarios WHERE email = ?', dados.email)) {
      throw new HttpError(409, 'Já existe uma conta com este e-mail');
    }

    const usuario = transacao(() => {
      const agoraTxt = agoraISO();
      const { id } = executar(
        `INSERT INTO usuarios (nome, email, telefone, senha_hash, perfil, consentimento_lgpd_em, criado_em)
         VALUES (?, ?, ?, ?, 'cliente', ?, ?)`,
        dados.nome, dados.email, dados.telefone, hashSenha(dados.senha), agoraTxt, agoraTxt,
      );
      enderecos.criar(id, { ...b.endereco, principal: true });
      return um('SELECT * FROM usuarios WHERE id = ?', id);
    });

    criarSessao(ctx, usuario);
    auditoria.registrar(ctx, 'cliente_cadastrado', { entidade: 'usuario', id: usuario.id, usuario });
    enviarEmail(usuario.email, 'Bem-vindo(a) ao Sabor Express!',
      `Olá, ${usuario.nome}! Sua conta foi criada com sucesso.\nAgora você já pode fazer pedidos pelo site.`);
    ctx.status = 201;
    return { usuario: dadosPublicos(usuario) };
  });

  // RF22 — Login seguro
  app.post('/api/auth/login', (ctx) => {
    const emailInformado = String(ctx.body.email || '').trim().toLowerCase();
    const chave = `${emailInformado}|${ctx.ip}`;
    verificarBloqueio(chave);
    const usuario = um('SELECT * FROM usuarios WHERE email = ? AND ativo = 1', emailInformado);
    if (!usuario || !verificarSenha(String(ctx.body.senha || ''), usuario.senha_hash)) {
      registrarFalha(chave);
      auditoria.registrar(ctx, 'login_falhou', { entidade: 'usuario', detalhes: { email: emailInformado } });
      throw new HttpError(401, 'E-mail ou senha incorretos'); // mensagem genérica de propósito
    }
    falhas.delete(chave);
    criarSessao(ctx, usuario);
    auditoria.registrar(ctx, 'login', { entidade: 'usuario', id: usuario.id, usuario });
    return { usuario: dadosPublicos(usuario) };
  });

  // RF22 — Logout
  app.post('/api/auth/logout', (ctx) => {
    if (ctx.usuario) auditoria.registrar(ctx, 'logout', { entidade: 'usuario', id: ctx.usuario.id });
    encerrarSessao(ctx);
    return { ok: true };
  });

  // Quem está logado (usado pelas telas)
  app.get('/api/auth/eu', (ctx) => ({ usuario: ctx.usuario }));

  // RF23 — Recuperação de senha por e-mail (link válido por 1 hora, uso único)
  app.post('/api/auth/esqueci-senha', (ctx) => {
    const emailInformado = email(ctx.body.email);
    const usuario = um('SELECT * FROM usuarios WHERE email = ? AND ativo = 1', emailInformado);
    if (usuario) {
      const token = tokenAleatorio();
      const expira = new Date(agora().getTime() + 3600000).toISOString();
      executar('INSERT INTO tokens_senha (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)', sha256(token), usuario.id, expira);
      const origem = `http://${ctx.req.headers.host || 'localhost:3000'}`;
      enviarEmail(usuario.email, 'Sabor Express — Redefinição de senha',
        `Olá, ${usuario.nome}.\nPara criar uma nova senha, acesse o link abaixo (válido por 1 hora):\n${origem}/redefinir-senha?token=${token}\nSe você não pediu a troca, ignore este e-mail.`);
      auditoria.registrar(ctx, 'senha_recuperacao_solicitada', { entidade: 'usuario', id: usuario.id, usuario });
    }
    // Mesma resposta exista ou não a conta (não revela quais e-mails estão cadastrados)
    return { mensagem: 'Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.' };
  });

  app.post('/api/auth/redefinir-senha', (ctx) => {
    const token = texto(ctx.body.token, 'token', { max: 200 });
    const novaSenha = senhaForte(ctx.body.senha);
    const registro = um('SELECT * FROM tokens_senha WHERE token_hash = ?', sha256(token));
    if (!registro || registro.usado_em || registro.expira_em <= agoraISO()) {
      throw new HttpError(400, 'Link inválido ou expirado. Solicite uma nova recuperação de senha.');
    }
    transacao(() => {
      executar('UPDATE usuarios SET senha_hash = ? WHERE id = ?', hashSenha(novaSenha), registro.usuario_id);
      executar('UPDATE tokens_senha SET usado_em = ? WHERE token_hash = ?', agoraISO(), registro.token_hash);
    });
    encerrarTodasAsSessoes(registro.usuario_id); // desconecta outros dispositivos
    auditoria.registrar(ctx, 'senha_redefinida', { entidade: 'usuario', id: registro.usuario_id });
    return { mensagem: 'Senha alterada! Faça login com a nova senha.' };
  });
};

module.exports.dadosPublicos = dadosPublicos;