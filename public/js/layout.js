// Cabeçalho comum a todas as telas + funções de formulário
// Cada página tem <header class="topo" id="topo"></header> e carrega api.js e layout.js
const Layout = { usuario: null };

Layout.pronto = (async () => {
  try {
    Layout.usuario = (await api.get('/api/auth/eu')).usuario;
  } catch { Layout.usuario = null; }
  desenharTopo();
  return Layout.usuario;
})();

// Painéis da equipe: [endereço, nome, perfis com acesso] (o gerente acessa todos)
const PAINEIS = [
  ['/equipe/gestao', 'Gestão', []],   
  ['/equipe/atendimento', 'Atendimento', ['atendente']],
  ['/equipe/cozinha', 'Cozinha', ['cozinha', 'atendente']],
  ['/equipe/logistica', 'Logística', ['logistica']],
  ['/equipe/financeiro', 'Financeiro', ['financeiro']], 
];
const paineisDo = (u) => PAINEIS.filter(([, , perfis]) => u.perfil === 'gerente' || perfis.includes(u.perfil));

// Página para onde cada perfil vai depois do login
Layout.paginaInicial = (u) => (u.equipe ? (paineisDo(u)[0]?.[0] || '/') : '/conta');

function desenharTopo() {
  const el = $('#topo');
  if (!el) return;
  const u = Layout.usuario;
  const links = [['/', u?.equipe ? 'Cardápio' : 'Início']];
  if (!u) links.push(['/entrar', 'Entrar'], ['/cadastro', 'Criar conta']);
  else if (u.equipe) links.push(...paineisDo(u).map(([href, nome]) => [href, nome]));
  else links.push(['/conta', 'Minha conta']);
  const atual = location.pathname.replace(/\.html$/, '');
  el.innerHTML = `
    <div class="container">
      <a class="marca" href="/">Sabor <span>Express</span></a>
      <nav class="menu" aria-label="Menu principal">
        ${links.map(([href, rotulo]) => `<a href="${href}" class="${atual === href ? 'ativo' : ''}">${rotulo}</a>`).join('')}
        ${u ? `<div class="sino-area">
                 <button type="button" class="sino" id="sino" aria-label="Notificações" aria-expanded="false">🔔<span class="contador-sino oculto" id="contador-sino"></span></button>
                 <div class="painel-notificacoes oculto" id="painel-notificacoes" role="region" aria-label="Notificações"></div>
               </div>
               <span class="suave pequeno">Olá, ${esc(u.nome.split(' ')[0])}</span>
               <button type="button" class="botao neutro pequeno" id="botao-sair">Sair</button>` : ''}
      </nav>
    </div>`;
  $('#botao-sair')?.addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    location.href = '/';
  });
  if (u) iniciarNotificacoes(u);
}

// ---- Notificações (RF09) e canal de tempo real compartilhado pelas telas ----
async function iniciarNotificacoes(u) {
  const sino = $('#sino');
  const painel = $('#painel-notificacoes');
  async function carregar() {
    const { naoLidas, lista } = await api.get('/api/notificacoes');
    const contador = $('#contador-sino');
    contador.textContent = naoLidas > 9 ? '9+' : naoLidas;
    contador.classList.toggle('oculto', !naoLidas);
    painel.innerHTML = lista.length
      ? `<ul>${lista.map((n) => `<li class="${n.lida ? '' : 'nao-lida'}">${esc(n.mensagem)}<small>${formatar.dataHora(n.criado_em)}</small></li>`).join('')}</ul>`
      : '<p class="suave pequeno">Nenhuma notificação.</p>';
  }
  sino.addEventListener('click', async () => {
    const abrir = painel.classList.contains('oculto');
    painel.classList.toggle('oculto', !abrir);
    sino.setAttribute('aria-expanded', String(abrir));
    if (abrir) { await api.post('/api/notificacoes/lidas'); await carregar(); $('#contador-sino').classList.add('oculto'); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.sino-area')) painel.classList.add('oculto'); });

  Layout.eventos = new EventSource('/api/eventos');
  Layout.eventos.addEventListener('notificacao', (ev) => {
    const d = JSON.parse(ev.data);
    if (u.equipe && d.destino === 'cliente') return; // notificações de clientes não aparecem para a equipe
    avisar(`🔔 ${d.mensagem}`);
    carregar();
  });
  document.dispatchEvent(new CustomEvent('eventos-prontos'));
  carregar().catch(() => {});
}

// Redireciona para o login se a página exigir usuário logado
Layout.exigirLogin = async () => {
  const u = await Layout.pronto;
  if (!u) location.href = `/entrar?voltar=${encodeURIComponent(location.pathname + location.search)}`;
  return u;
};

// Páginas da equipe: exige login e um dos perfis informados (gerente sempre pode)
Layout.exigirEquipe = async (...perfis) => {
  const u = await Layout.exigirLogin();
  if (!u) return null;
  if (!u.equipe || (perfis.length && u.perfil !== 'gerente' && !perfis.includes(u.perfil))) {
    $('main').innerHTML = '<div class="mensagem erro">Acesso restrito a esta área da equipe.</div>';
    return null;
  }
  return u;
};

// Executa uma função sempre que chegar um evento de tempo real do tipo informado
Layout.aoEvento = (tipo, fn) => {
  const ligar = () => Layout.eventos?.addEventListener(tipo, (ev) => fn(JSON.parse(ev.data)));
  if (Layout.eventos) ligar(); else document.addEventListener('eventos-prontos', ligar, { once: true });
};

// Lê os campos de um <form> (name="endereco.numero" vira { endereco: { numero } })
function lerFormulario(form) {
  const dados = {};
  for (const campo of form.elements) {
    if (!campo.name || campo.disabled) continue;
    if (campo.type === 'radio' && !campo.checked) continue; // só a opção marcada
    const valor = campo.type === 'checkbox' ? campo.checked : campo.value;
    const partes = campo.name.split('.');
    let alvo = dados;
    partes.slice(0, -1).forEach((p) => { alvo = alvo[p] ??= {}; });
    alvo[partes.at(-1)] = valor;
  }
  return dados;
}

function mostrarMensagem(el, texto, tipo = 'erro') {
  el.className = `mensagem ${tipo}`;
  el.textContent = texto;
  el.classList.remove('oculto');
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Envia um formulário tratando botão "carregando" e erros
async function enviarFormulario(form, acao) {
  const botao = form.querySelector('button[type="submit"]');
  const caixa = form.querySelector('.mensagem');
  caixa?.classList.add('oculto');
  if (botao) botao.disabled = true;
  try {
    await acao(lerFormulario(form));
  } catch (e) {
    if (caixa) mostrarMensagem(caixa, e.message);
    else avisar(e.message, 'erro');
  } finally {
    if (botao) botao.disabled = false;
  }
}

// Preenche um <select> com os bairros, indicando distância e se entregamos
async function preencherBairros(select, selecionado) {
  const bairros = await api.get('/api/bairros');
  select.innerHTML = '<option value="">Selecione o bairro…</option>' + bairros.map((b) =>
    `<option value="${b.id}" ${String(b.id) === String(selecionado) ? 'selected' : ''}>
      ${esc(b.nome)} (${formatar.km(b.distancia_km)}${b.atende ? '' : ' — fora da área de entrega'})</option>`).join('');
  return bairros;
}

// Rótulos usados nas telas de pedidos
const STATUS_PEDIDO = {
  aguardando_confirmacao: ['Aguardando confirmação', 'alerta'],
  recebido: ['Recebido', 'info'],
  em_preparo: ['Em preparo', 'info'],
  pronto: ['Pronto', 'sucesso'],
  despachado: ['Aguardando entregador', 'info'],
  a_caminho: ['A caminho', 'info'],
  entregue: ['Entregue', 'sucesso'],
  cancelado: ['Cancelado', 'erro'],
};
const MODALIDADE = { entrega: 'Entrega', retirada: 'Retirada no balcão', salao: 'Consumo no salão' };
const FORMA_PAGAMENTO = { credito: 'Cartão de crédito', debito: 'Cartão de débito', pix: 'Pix', dinheiro: 'Dinheiro' };

function seloStatus(status) {
  const [rotulo, tipo] = STATUS_PEDIDO[status] || [status, ''];
  return `<span class="selo ${tipo}">${esc(rotulo)}</span>`;
}