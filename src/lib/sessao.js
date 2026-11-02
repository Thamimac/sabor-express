// Sessões de login (cookie HttpOnly) e controle de acesso por perfil
const config = require('../config');
const { um, executar } = require('../db/database');
const { sha256, tokenAleatorio } = require('./seguranca');
const { HttpError } = require('./erros');
const { agora, agoraISO } = require('./util');

const PERFIS_EQUIPE = ['atendente', 'cozinha', 'logistica', 'financeiro', 'gerente'];

function montarCookie(valor, maxAgeSeg) {
  return `sid=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}${config.cookieSeguro ? '; Secure' : ''}`;
}

// O navegador recebe um token aleatório; o banco guarda apenas o hash dele
function criarSessao(ctx, usuario) {
  const token = tokenAleatorio();
  const expira = new Date(agora().getTime() + config.sessaoHoras * 3600000).toISOString();
  executar('INSERT INTO sessoes (id, usuario_id, expira_em, criado_em) VALUES (?, ?, ?, ?)', sha256(token), usuario.id, expira, agoraISO());
  ctx.res.setHeader('Set-Cookie', montarCookie(token, config.sessaoHoras * 3600));
}

// Middleware: identifica o usuário logado em cada requisição
function carregarSessao(ctx) {
  const token = ctx.cookies.sid;
  if (!token) return;
  const s = um(`SELECT s.id AS sessao_id, s.expira_em, u.id, u.nome, u.email, u.telefone, u.perfil, u.ativo
                FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = ?`, sha256(token));
  if (!s) return;
  if (s.expira_em <= agoraISO() || !s.ativo) {
    executar('DELETE FROM sessoes WHERE id = ?', s.sessao_id);
    return;
  }
  ctx.sessaoId = s.sessao_id;
  ctx.usuario = {
    id: s.id, nome: s.nome, email: s.email, telefone: s.telefone, perfil: s.perfil,
    equipe: PERFIS_EQUIPE.includes(s.perfil),
  };
}

function encerrarSessao(ctx) {
  if (ctx.sessaoId) executar('DELETE FROM sessoes WHERE id = ?', ctx.sessaoId);
  ctx.res.setHeader('Set-Cookie', montarCookie('', 0));
}

const encerrarTodasAsSessoes = (usuarioId) => executar('DELETE FROM sessoes WHERE usuario_id = ?', usuarioId);

// ---- Guardas usadas nas rotas ----
function exigirLogin(ctx) {
  if (!ctx.usuario) throw new HttpError(401, 'Faça login para continuar');
}

// O gerente (proprietários) tem acesso a todas as áreas
const exigirPerfil = (...perfis) => (ctx) => {
  exigirLogin(ctx);
  if (ctx.usuario.perfil === 'gerente') return;
  if (!perfis.includes(ctx.usuario.perfil)) throw new HttpError(403, 'Você não tem permissão para esta ação');
};

const exigirEquipe = exigirPerfil(...PERFIS_EQUIPE);

module.exports = {
  PERFIS_EQUIPE, criarSessao, carregarSessao, encerrarSessao, encerrarTodasAsSessoes,
  exigirLogin, exigirPerfil, exigirEquipe,
};