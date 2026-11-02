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

function desenharTopo() {
  const el = $('#topo');
  if (!el) return;
  const u = Layout.usuario;
  const links = [['/', 'Início']];
  if (!u) links.push(['/entrar', 'Entrar'], ['/cadastro', 'Criar conta']);
  else links.push(['/conta', 'Minha conta']);
  const atual = location.pathname.replace(/\.html$/, '');
  el.innerHTML = `
    <div class="container">
      <a class="marca" href="/">Sabor <span>Express</span></a>
      <nav class="menu" aria-label="Menu principal">
        ${links.map(([href, rotulo]) => `<a href="${href}" class="${atual === href ? 'ativo' : ''}">${rotulo}</a>`).join('')}
        ${u ? `<span class="suave pequeno">Olá, ${esc(u.nome.split(' ')[0])}</span>
               <button type="button" class="botao neutro pequeno" id="botao-sair">Sair</button>` : ''}
      </nav>
    </div>`;
  $('#botao-sair')?.addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    location.href = '/';
  });
}

// Redireciona para o login se a página exigir usuário logado
Layout.exigirLogin = async () => {
  const u = await Layout.pronto;
  if (!u) location.href = `/entrar?voltar=${encodeURIComponent(location.pathname + location.search)}`;
  return u;
};

// Lê os campos de um <form> (name="endereco.numero" vira { endereco: { numero } })
function lerFormulario(form) {
  const dados = {};
  for (const campo of form.elements) {
    if (!campo.name || campo.disabled) continue;
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