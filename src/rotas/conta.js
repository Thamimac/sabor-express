// Módulo 5 — Área do cliente: dados, endereços (RF24), histórico (RF25) e direitos LGPD
const { um, todos, executar, transacao } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { hashSenha, verificarSenha, tokenAleatorio } = require('../lib/seguranca');
const { exigirLogin, encerrarSessao, encerrarTodasAsSessoes } = require('../lib/sessao');
const { texto, telefone, senhaForte, agoraISO } = require('../lib/util');
const enderecos = require('../services/enderecos');
const auditoria = require('../services/auditoria');
const fidelidade = require('../services/fidelidade');

const STATUS_EM_ANDAMENTO = ['aguardando_confirmacao', 'recebido', 'em_preparo', 'pronto', 'despachado', 'a_caminho'];

function historicoDePedidos(usuarioId) {
  const pedidos = todos(
    `SELECT p.id, p.codigo, p.status, p.modalidade, p.total_centavos, p.forma_pagamento, p.criado_em, p.entregue_em,
            pg.status AS pagamento_status
     FROM pedidos p LEFT JOIN pagamentos pg ON pg.pedido_id = p.id
     WHERE p.cliente_id = ? ORDER BY p.criado_em DESC`, usuarioId);
  for (const p of pedidos) {
    p.itens = todos('SELECT nome, quantidade FROM itens_pedido WHERE pedido_id = ?', p.id);
  }
  return pedidos;
}

module.exports = (app) => {
  app.get('/api/conta', exigirLogin, (ctx) => {
    const u = um('SELECT id, nome, email, telefone, perfil, consentimento_lgpd_em, criado_em FROM usuarios WHERE id = ?', ctx.usuario.id);
    return { ...u, enderecos: enderecos.listar(u.id) };
  });

  app.put('/api/conta', exigirLogin, (ctx) => {
    const nome = texto(ctx.body.nome, 'nome', { min: 3, max: 80 });
    const tel = telefone(ctx.body.telefone);
    executar('UPDATE usuarios SET nome = ?, telefone = ? WHERE id = ?', nome, tel, ctx.usuario.id);
    auditoria.registrar(ctx, 'dados_atualizados', { entidade: 'usuario', id: ctx.usuario.id });
    return { mensagem: 'Dados atualizados' };
  });

  app.put('/api/conta/senha', exigirLogin, (ctx) => {
    const u = um('SELECT senha_hash FROM usuarios WHERE id = ?', ctx.usuario.id);
    if (!verificarSenha(String(ctx.body.senhaAtual || ''), u.senha_hash)) throw new HttpError(422, 'Senha atual incorreta');
    executar('UPDATE usuarios SET senha_hash = ? WHERE id = ?', hashSenha(senhaForte(ctx.body.novaSenha)), ctx.usuario.id);
    executar('DELETE FROM sessoes WHERE usuario_id = ? AND id <> ?', ctx.usuario.id, ctx.sessaoId);
    auditoria.registrar(ctx, 'senha_alterada', { entidade: 'usuario', id: ctx.usuario.id });
    return { mensagem: 'Senha alterada' };
  });

  // ---- RF24: múltiplos endereços de entrega ----
  app.get('/api/conta/enderecos', exigirLogin, (ctx) => enderecos.listar(ctx.usuario.id));

  app.post('/api/conta/enderecos', exigirLogin, (ctx) => {
    ctx.status = 201;
    return enderecos.criar(ctx.usuario.id, ctx.body);
  });

  app.put('/api/conta/enderecos/:id', exigirLogin, (ctx) => enderecos.atualizar(ctx.usuario.id, ctx.params.id, ctx.body));

  app.post('/api/conta/enderecos/:id/principal', exigirLogin, (ctx) => {
    enderecos.definirPrincipal(ctx.usuario.id, ctx.params.id);
    return { ok: true };
  });

  app.delete('/api/conta/enderecos/:id', exigirLogin, (ctx) => {
    enderecos.remover(ctx.usuario.id, ctx.params.id);
    return { ok: true };
  });

  // ---- RF25: histórico de pedidos do próprio cliente ----
  app.get('/api/conta/pedidos', exigirLogin, (ctx) => historicoDePedidos(ctx.usuario.id));

  
  // Programa de fidelidade: progresso e entregas grátis disponíveis
  app.get('/api/conta/fidelidade', exigirLogin, (ctx) => fidelidade.situacao(ctx.usuario.id));

  // ---- LGPD: portabilidade (baixar meus dados) ----
  app.get('/api/conta/meus-dados', exigirLogin, (ctx) => {
    auditoria.registrar(ctx, 'lgpd_exportacao_dados', { entidade: 'usuario', id: ctx.usuario.id });
    const u = um('SELECT nome, email, telefone, consentimento_lgpd_em, criado_em FROM usuarios WHERE id = ?', ctx.usuario.id);
    ctx.res.setHeader('Content-Disposition', 'attachment; filename="meus-dados-sabor-express.json"');
    return {
      gerado_em: agoraISO(),
      controlador: 'Sabor Express',
      titular: u,
      enderecos: enderecos.listar(ctx.usuario.id).map(({ apelido, texto: t }) => ({ apelido, endereco: t })),
      pedidos: historicoDePedidos(ctx.usuario.id),
    };
  });

  // ---- LGPD (regra de domínio 5): exclusão da conta ----
  // Os dados pessoais são anonimizados; os pedidos permanecem para fins fiscais (regra 7).
  app.delete('/api/conta', exigirLogin, (ctx) => {
    if (ctx.usuario.perfil !== 'cliente') throw new HttpError(403, 'Contas da equipe são desativadas pelo gerente');
    const u = um('SELECT senha_hash FROM usuarios WHERE id = ?', ctx.usuario.id);
    if (!verificarSenha(String(ctx.body.senha || ''), u.senha_hash)) throw new HttpError(422, 'Senha incorreta');
    const abertos = um(`SELECT COUNT(*) AS n FROM pedidos WHERE cliente_id = ? AND status IN (${STATUS_EM_ANDAMENTO.map(() => '?').join(',')})`,
      ctx.usuario.id, ...STATUS_EM_ANDAMENTO).n;
    if (abertos) throw new HttpError(422, 'Você tem pedido em andamento. Aguarde a conclusão para excluir a conta.');

    const id = ctx.usuario.id;
    transacao(() => {
      executar(`UPDATE usuarios SET nome = 'Cliente removido', email = ?, telefone = NULL, senha_hash = ?, ativo = 0, excluido_em = ?
                WHERE id = ?`, `removido-${id}@anonimo.invalid`, hashSenha(tokenAleatorio()), agoraISO(), id);
      executar('DELETE FROM enderecos WHERE usuario_id = ?', id);
      executar(`UPDATE pedidos SET cliente_nome = 'Cliente removido', cliente_telefone = NULL,
                endereco_texto = CASE WHEN endereco_texto IS NULL THEN NULL ELSE '[removido - LGPD]' END WHERE cliente_id = ?`, id);
      executar('DELETE FROM notificacoes WHERE usuario_id = ?', id);
    });
    auditoria.registrar(ctx, 'lgpd_conta_excluida', { entidade: 'usuario', id });
    encerrarTodasAsSessoes(id);
    encerrarSessao(ctx);
    return { mensagem: 'Sua conta foi excluída e seus dados pessoais foram anonimizados.' };
  });
};