// Painel do gerente (proprietários): visão geral, cardápio, equipe, configurações, auditoria, e-mails e backup
const { um, todos, executar } = require('../db/database');
const { HttpError } = require('../lib/erros');
const { exigirPerfil } = require('../lib/sessao');
const { hashSenha } = require('../lib/seguranca');
const { texto, email, telefone, senhaForte, inteiro, opcao, agoraISO, dataLocal, inicioDiaUTC, fimDiaUTC } = require('../lib/util');
const pedidos = require('../services/pedidos');
const regras = require('../services/regras');
const sla = require('../services/sla');
const backup = require('../services/backup');
const auditoria = require('../services/auditoria');
const { relatorio } = require('./financeiro');

const exigirGerente = exigirPerfil(); // sem perfis listados: somente o gerente
const PERFIS_EQUIPE = ['atendente', 'cozinha', 'logistica', 'financeiro', 'gerente'];
const reais = (v) => Math.round(Number(String(v).replace(',', '.')) * 100);

function validarItem(b) {
  const preco = reais(b.preco);
  if (!Number.isInteger(preco) || preco <= 0 || preco > 100000) throw new HttpError(422, 'Preço inválido');
  const categoria = inteiro(b.categoria_id, 'categoria', { min: 1 });
  if (!um('SELECT id FROM categorias WHERE id = ?', categoria)) throw new HttpError(422, 'Categoria não encontrada');
  return {
    nome: texto(b.nome, 'nome', { min: 3, max: 80 }),
    descricao: texto(b.descricao, 'descrição', { obrigatorio: false, max: 200 }),
    preco, categoria,
    disponivel: b.disponivel === false ? 0 : 1,
    destaque: b.destaque ? 1 : 0,
  };
}

module.exports = (app) => {
  // ---- Visão geral do negócio ----
  app.get('/api/gestao/painel', exigirGerente, () => {
    const hoje = dataLocal();
    const iniHoje = inicioDiaUTC(hoje);
    const porStatus = Object.fromEntries(todos('SELECT status, COUNT(*) AS n FROM pedidos WHERE criado_em >= ? GROUP BY status', iniHoje).map((r) => [r.status, r.n]));
    const preparo = um('SELECT AVG(tempo_preparo_seg) AS s FROM pedidos WHERE pronto_em >= ?', iniHoje).s;
    const inicio7 = dataLocal(new Date(Date.now() - 6 * 86400000));
    const semana = relatorio({ agrupamento: 'diario', inicio: inicio7, fim: hoje });
    const slaSemana = sla.calcular(inicioDiaUTC(inicio7), fimDiaUTC(hoje));
    const maisVendidos = todos(`SELECT ip.nome, SUM(ip.quantidade) AS quantidade, SUM(ip.quantidade * ip.preco_unit_centavos) AS total
                                FROM itens_pedido ip JOIN pedidos p ON p.id = ip.pedido_id
                                WHERE p.status <> 'cancelado' AND p.criado_em >= ?
                                GROUP BY ip.nome ORDER BY quantidade DESC LIMIT 5`, inicioDiaUTC(dataLocal(new Date(Date.now() - 29 * 86400000))));
    return {
      funcionamento: regras.situacaoFuncionamento(),
      hoje: {
        pedidos: Object.values(porStatus).reduce((s, n) => s + n, 0),
        porStatus,
        emAndamento: pedidos.STATUS_ATIVOS.reduce((s, st) => s + (porStatus[st] || 0), 0),
        faturamento: semana.linhas.find((l) => l.periodo === hoje)?.liquido || 0,
        tempoMedioPreparoMin: preparo ? Math.round(preparo / 6) / 10 : null,
      },
      semana: { linhas: semana.linhas, total: semana.total },
      sla: { cumpridos: slaSemana.resumo.cumpridos, descumpridos: slaSemana.resumo.descumpridos, indicadores: slaSemana.indicadores },
      maisVendidos,
      clientes: um("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'cliente' AND ativo = 1").n,
      backups: backup.listar().slice(0, 1),
    };
  });

  // ---- Cardápio ----
  app.get('/api/gestao/cardapio', exigirGerente, () => pedidos.cardapio({ incluirIndisponiveis: true }));

  app.post('/api/gestao/itens', exigirGerente, (ctx) => {
    const i = validarItem(ctx.body);
    const { id } = executar(`INSERT INTO itens (categoria_id, nome, descricao, preco_centavos, disponivel, destaque, criado_em)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`, i.categoria, i.nome, i.descricao, i.preco, i.disponivel, i.destaque, agoraISO());
    auditoria.registrar(ctx, 'item_criado', { entidade: 'item', id, detalhes: { nome: i.nome, preco: i.preco } });
    ctx.status = 201;
    return um('SELECT * FROM itens WHERE id = ?', id);
  });

  app.put('/api/gestao/itens/:id', exigirGerente, (ctx) => {
    const atual = um('SELECT * FROM itens WHERE id = ?', Number(ctx.params.id));
    if (!atual) throw new HttpError(404, 'Item não encontrado');
    const i = validarItem(ctx.body);
    executar('UPDATE itens SET categoria_id = ?, nome = ?, descricao = ?, preco_centavos = ?, disponivel = ?, destaque = ? WHERE id = ?',
      i.categoria, i.nome, i.descricao, i.preco, i.disponivel, i.destaque, atual.id);
    auditoria.registrar(ctx, 'item_alterado', { entidade: 'item', id: atual.id,
      detalhes: { nome: i.nome, preco_anterior: atual.preco_centavos, preco_novo: i.preco } });
    return um('SELECT * FROM itens WHERE id = ?', atual.id);
  });

  // Item esgotado: some do cardápio do cliente na hora
  app.post('/api/gestao/itens/:id/disponivel', exigirGerente, (ctx) => {
    const { alterados } = executar('UPDATE itens SET disponivel = ? WHERE id = ?', ctx.body.disponivel ? 1 : 0, Number(ctx.params.id));
    if (!alterados) throw new HttpError(404, 'Item não encontrado');
    auditoria.registrar(ctx, ctx.body.disponivel ? 'item_disponivel' : 'item_indisponivel', { entidade: 'item', id: ctx.params.id });
    return { ok: true };
  });

  // Regra de domínio 4: tempo médio de preparo por categoria
  app.put('/api/gestao/categorias/:id', exigirGerente, (ctx) => {
    const tempo = inteiro(ctx.body.tempo_preparo_min, 'tempo de preparo', { min: 1, max: 120 });
    const { alterados } = executar('UPDATE categorias SET tempo_preparo_min = ? WHERE id = ?', tempo, Number(ctx.params.id));
    if (!alterados) throw new HttpError(404, 'Categoria não encontrada');
    auditoria.registrar(ctx, 'categoria_tempo_alterado', { entidade: 'categoria', id: ctx.params.id, detalhes: { tempo } });
    return { ok: true };
  });

  // ---- Equipe (usuários internos) ----
  app.get('/api/gestao/usuarios', exigirGerente, () => todos(
    `SELECT id, nome, email, telefone, perfil, ativo, criado_em FROM usuarios WHERE perfil <> 'cliente' ORDER BY ativo DESC, perfil, nome`));

  app.post('/api/gestao/usuarios', exigirGerente, (ctx) => {
    const b = ctx.body;
    const dados = { nome: texto(b.nome, 'nome', { min: 3, max: 80 }), email: email(b.email), telefone: telefone(b.telefone, false),
      perfil: opcao(b.perfil, 'perfil', PERFIS_EQUIPE), senha: senhaForte(b.senha) };
    if (um('SELECT id FROM usuarios WHERE email = ?', dados.email)) throw new HttpError(409, 'Já existe um usuário com este e-mail');
    const { id } = executar('INSERT INTO usuarios (nome, email, telefone, senha_hash, perfil, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      dados.nome, dados.email, dados.telefone, hashSenha(dados.senha), dados.perfil, agoraISO());
    auditoria.registrar(ctx, 'funcionario_cadastrado', { entidade: 'usuario', id, detalhes: { perfil: dados.perfil } });
    ctx.status = 201;
    return um('SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = ?', id);
  });

  app.put('/api/gestao/usuarios/:id', exigirGerente, (ctx) => {
    const u = um("SELECT * FROM usuarios WHERE id = ? AND perfil <> 'cliente'", Number(ctx.params.id));
    if (!u) throw new HttpError(404, 'Funcionário não encontrado');
    const perfil = opcao(ctx.body.perfil, 'perfil', PERFIS_EQUIPE);
    if (u.id === ctx.usuario.id && perfil !== 'gerente') throw new HttpError(422, 'Você não pode tirar o seu próprio acesso de gerente');
    executar('UPDATE usuarios SET nome = ?, telefone = ?, perfil = ? WHERE id = ?',
      texto(ctx.body.nome, 'nome', { min: 3, max: 80 }), telefone(ctx.body.telefone, false), perfil, u.id);
    auditoria.registrar(ctx, 'funcionario_alterado', { entidade: 'usuario', id: u.id, detalhes: { perfil_anterior: u.perfil, perfil } });
    return { ok: true };
  });

  app.post('/api/gestao/usuarios/:id/ativo', exigirGerente, (ctx) => {
    const id = Number(ctx.params.id);
    if (id === ctx.usuario.id) throw new HttpError(422, 'Você não pode desativar a sua própria conta');
    executar("UPDATE usuarios SET ativo = ? WHERE id = ? AND perfil <> 'cliente'", ctx.body.ativo ? 1 : 0, id);
    if (!ctx.body.ativo) executar('DELETE FROM sessoes WHERE usuario_id = ?', id); // desconecta na hora
    auditoria.registrar(ctx, ctx.body.ativo ? 'funcionario_ativado' : 'funcionario_desativado', { entidade: 'usuario', id });
    return { ok: true };
  });

  app.post('/api/gestao/usuarios/:id/senha', exigirGerente, (ctx) => {
    const id = Number(ctx.params.id);
    executar("UPDATE usuarios SET senha_hash = ? WHERE id = ? AND perfil <> 'cliente'", hashSenha(senhaForte(ctx.body.senha)), id);
    executar('DELETE FROM sessoes WHERE usuario_id = ?', id);
    auditoria.registrar(ctx, 'funcionario_senha_redefinida', { entidade: 'usuario', id });
    return { ok: true };
  });

  // ---- Configurações (horário e modo demonstração) ----
  app.get('/api/gestao/configuracoes', exigirGerente, () => {
    const c = regras.lerConfiguracoes();
    return { horario_abertura: c.horario_abertura, horario_fechamento: c.horario_fechamento, ignorar_horario: c.ignorar_horario === '1' };
  });

  app.put('/api/gestao/configuracoes', exigirGerente, (ctx) => {
    const hora = (v, campo) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw new HttpError(422, `Horário inválido em "${campo}" (use HH:MM)`); return v; };
    const abertura = hora(ctx.body.horario_abertura, 'abertura');
    const fechamento = hora(ctx.body.horario_fechamento, 'fechamento');
    if (abertura >= fechamento) throw new HttpError(422, 'O horário de abertura deve ser antes do fechamento');
    regras.salvarConfiguracao('horario_abertura', abertura);
    regras.salvarConfiguracao('horario_fechamento', fechamento);
    regras.salvarConfiguracao('ignorar_horario', ctx.body.ignorar_horario ? '1' : '0');
    auditoria.registrar(ctx, 'configuracoes_alteradas', { detalhes: { abertura, fechamento, modo_demonstracao: !!ctx.body.ignorar_horario } });
    return { ok: true, funcionamento: regras.situacaoFuncionamento() };
  });

  // ---- Auditoria (RNF Auditabilidade) ----
  app.get('/api/gestao/auditoria', exigirGerente, (ctx) => {
    const q = ctx.query;
    const filtros = [];
    const params = [];
    if (q.acao) { filtros.push('acao LIKE ?'); params.push(`%${q.acao}%`); }
    if (q.usuario) { filtros.push('usuario_nome LIKE ?'); params.push(`%${q.usuario}%`); }
    if (q.inicio) { filtros.push('criado_em >= ?'); params.push(inicioDiaUTC(q.inicio)); }
    if (q.fim) { filtros.push('criado_em < ?'); params.push(fimDiaUTC(q.fim)); }
    const limite = Math.min(Number(q.limite) || 200, 1000);
    return todos(`SELECT * FROM auditoria ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, ...params, limite);
  });

  // ---- Caixa de saída de e-mails (envio simulado) ----
  app.get('/api/gestao/emails', exigirGerente, () => todos('SELECT * FROM emails ORDER BY id DESC LIMIT 50'));

  // ---- Backup (RNF Confiabilidade) ----
  app.get('/api/gestao/backups', exigirGerente, () => backup.listar());
  app.post('/api/gestao/backups', exigirGerente, (ctx) => {
    const b = backup.fazerBackup('manual');
    if (!b) throw new HttpError(422, 'Backup indisponível neste modo');
    auditoria.registrar(ctx, 'backup_manual', { detalhes: { arquivo: b.arquivo } });
    ctx.status = 201;
    return b;
  });
};