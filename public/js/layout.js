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
    // Atalho de teclado: "Pular para o conteúdo" (aparece ao apertar Tab)
  const principal = $('main');
  if (principal && !$('.pular')) {
    principal.id ||= 'principal';
    principal.tabIndex = -1;
    el.insertAdjacentHTML('beforebegin', `<a class="pular" href="#${principal.id}">Pular para o conteúdo</a>`);
  }
  const u = Layout.usuario;
  const links = u?.equipe ? [['/cardapio', 'Cardápio']] : [['/', 'Início'], ['/cardapio', 'Cardápio']];
  if (!u) links.push(['/entrar', 'Entrar'], ['/cadastro', 'Criar conta']);
  else if (u.equipe) links.push(...paineisDo(u).map(([href, nome]) => [href, nome]));
  else links.push(['/conta', 'Minha conta']);
  const atual = location.pathname.replace(/\.html$/, '');
  el.innerHTML = `
    <div class="container">
      <a class="marca" href="/"><img src="/img/logo.svg" alt="Sabor Express" width="112" height="54"></a>      <nav class="menu" aria-label="Menu principal">
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
    const textoOriginal = botao?.textContent;
  if (botao) { botao.disabled = true; botao.textContent = 'Aguarde…'; botao.setAttribute('aria-busy', 'true'); }
   try {
    if (!validarFormulario(form)) {
      const n = $$('[aria-invalid="true"]', form).length;
      const unico = $('[aria-invalid="true"]', form);
      // Com caixa de mensagem no formulário, o detalhe já está embaixo do campo; sem caixa, o aviso traz o detalhe
      throw new Error(n > 1 ? `Corrija os ${n} campos destacados em vermelho.`
        : (!caixa && erroDoCampo(unico)) || 'Corrija o campo destacado em vermelho.');
    }
    await acao(lerFormulario(form));
  } catch (e) {
    if (caixa) mostrarMensagem(caixa, e.message);
    else avisar(e.message, 'erro');
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = textoOriginal; botao.removeAttribute('aria-busy'); }
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
const FORMA_PAGAMENTO = { credito: 'Cartão de crédito', debito: 'Cartão de débito', pix: 'Pix', dinheiro: 'Dinheiro', voucher: 'Vale-refeição' };

function seloStatus(status) {
  const [rotulo, tipo] = STATUS_PEDIDO[status] || [status, ''];
  return `<span class="selo ${tipo}">${esc(rotulo)}</span>`;
}


// ---------------------------------------------------------------------------
// Validação dos formulários na própria tela (antes de enviar ao servidor)
// O servidor valida tudo de novo: esta parte só ajuda o usuário a corrigir na hora.
// ---------------------------------------------------------------------------
const REGRA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Nome do campo como aparece na tela (texto do <label>, sem "(opcional)")
function rotuloDo(campo) {
  const label = campo.id && $(`label[for="${campo.id}"]`);
  return (label?.textContent || campo.name || 'campo').replace(/\(opcional\)/i, '').trim();
}

// Campo de senha nova: precisa seguir a regra de senha forte
const ehSenha = (c) => c.type === 'password' || c.dataset.senha === '1'; // continua senha mesmo com "Mostrar" ativado
const ehSenhaNova = (c) => c.dataset.forte === '1' || (ehSenha(c) && !!c.name &&
  (c.autocomplete === 'new-password' || !!c.closest('.campo')?.querySelector('.ajuda')));

// Devolve a mensagem de erro do campo, ou '' se estiver certo
function erroDoCampo(campo) {
  const v = campo.type === 'checkbox' ? campo.checked : String(campo.value || '').trim();
  if (campo.required && !v) {
    if (campo.dataset.msgObrigatorio) return campo.dataset.msgObrigatorio;
    if (campo.name === 'consentimento') return 'Para criar a conta, é preciso aceitar a Política de Privacidade (LGPD).';
    if (campo.type === 'checkbox') return 'É preciso marcar esta opção para continuar.';
    if (campo.tagName === 'SELECT') return `Escolha uma opção em "${rotuloDo(campo)}".`;
    return `Preencha o campo "${rotuloDo(campo)}".`;
  }
  if (!v || campo.type === 'checkbox') return '';

  if (campo.type === 'email' && !REGRA_EMAIL.test(v)) return 'Digite um e-mail válido, por exemplo: nome@email.com';
  if (campo.type === 'tel') {
    const d = v.replace(/\D/g, '');
    if (d.length < 10 || d.length > 11) return 'Informe o número com DDD, por exemplo: (11) 91234-5678';
  }
  if (/(^|\.)cep$/.test(campo.name) && v.replace(/\D/g, '').length !== 8) return 'O CEP deve ter 8 números, por exemplo: 01001-000';
  if (campo.name === 'nome' || campo.name === 'cliente_nome') {
    if (v.length < 3) return 'O nome deve ter pelo menos 3 letras.';
  }
  if (campo.type === 'number') {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n)) return 'Digite apenas números.';
    if (campo.min !== '' && n < Number(campo.min)) return `O valor mínimo é ${campo.min}.`;
    if (campo.max !== '' && n > Number(campo.max)) return `O valor máximo é ${campo.max}.`;
    if (campo.step !== 'any' && !campo.step.includes('.') && !Number.isInteger(n)) return 'Use um número inteiro, sem vírgula.';
  }
  if (campo.minLength > 0 && v.length < campo.minLength) return `Use pelo menos ${campo.minLength} caracteres.`;

  if (ehSenhaNova(campo)) {
    const falta = requisitosSenha(campo.value).filter((r) => !r.ok).map((r) => r.texto.toLowerCase());
    if (falta.length) return `A senha precisa ter: ${falta.join(', ')}.`;
  }
  // "Confirme a senha": campo de senha sem name, comparado com a senha nova do mesmo formulário
  if (ehSenha(campo) && !campo.name) {
    const original = [...campo.form.elements].find(ehSenhaNova);
    if (original && campo.value !== original.value) return 'As senhas não conferem. Digite a mesma senha nos dois campos.';
  }
  return '';
}

function requisitosSenha(senha = '') {
  return [
    { texto: 'Pelo menos 8 caracteres', ok: senha.length >= 8 },
    { texto: 'Uma letra', ok: /[A-Za-z]/.test(senha) },
    { texto: 'Um número', ok: /\d/.test(senha) },
  ];
}

// Mostra (ou apaga) a mensagem embaixo do campo, avisando também leitores de tela
function marcarCampo(campo, mensagem) {
  if (!campo.id) campo.id = `campo-${Math.random().toString(36).slice(2, 8)}`;
  const idErro = `${campo.id}-erro`;
  let el = document.getElementById(idErro);
  if (!mensagem) {
    campo.removeAttribute('aria-invalid');
    el?.remove();
    campo.setAttribute('aria-describedby', (campo.getAttribute('aria-describedby') || '').replace(idErro, '').trim());
    if (!campo.getAttribute('aria-describedby')) campo.removeAttribute('aria-describedby');
    return true;
  }
  if (!el) {
    el = document.createElement('p');
    el.id = idErro;
    el.className = 'erro-campo';
    const ancora = document.getElementById(`${campo.id}-requisitos`) || campo.closest('.caixa-checagem') || campo.closest('.senha-caixa') || campo;
    ancora.insertAdjacentElement('afterend', el);
    const desc = new Set((campo.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    desc.add(idErro);
    campo.setAttribute('aria-describedby', [...desc].join(' '));
  }
  el.textContent = mensagem;
  campo.setAttribute('aria-invalid', 'true');
  return false;
}

// Só valida campos que estão visíveis e habilitados
const campoVisivel = (c) => !c.disabled && c.type !== 'hidden' && c.getClientRects().length > 0;

function validarCampo(campo) { return marcarCampo(campo, erroDoCampo(campo)); }

// Valida o formulário inteiro e leva o cursor até o primeiro campo com erro
function validarFormulario(form) {
  ativarValidacao(form);
  const campos = [...form.elements].filter((c) => /INPUT|SELECT|TEXTAREA/.test(c.tagName) && campoVisivel(c));
  const invalidos = campos.filter((c) => !validarCampo(c));
  invalidos[0]?.focus();
  return invalidos.length === 0;
}

// Máscaras: o telefone e o CEP ganham a formatação enquanto a pessoa digita
function mascaraTelefone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function mascaraCep(v) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

// Liga a validação em tempo real num formulário (pode ser chamada mais de uma vez)
function ativarValidacao(form) {
  if (form.dataset.validacao) return;
  form.dataset.validacao = '1';
  form.noValidate = true; // usamos as nossas mensagens, em português, no lugar das do navegador

  for (const campo of form.elements) {
    if (!/INPUT|SELECT|TEXTAREA/.test(campo.tagName)) continue;

    if (campo.type === 'tel') campo.addEventListener('input', () => { campo.value = mascaraTelefone(campo.value); });
    if (/(^|\.)cep$/.test(campo.name)) campo.addEventListener('input', () => { campo.value = mascaraCep(campo.value); });

    if (campo.type === 'password') { campo.dataset.senha = '1'; adicionarMostrarSenha(campo); }
    if (ehSenhaNova(campo)) { campo.dataset.forte = '1'; adicionarRequisitosSenha(campo); }

    // Valida ao sair do campo; depois do primeiro erro, revalida a cada tecla para o erro sumir na hora
    campo.addEventListener('blur', (e) => {
      // Se a pessoa clicou em "Enviar", o envio já valida tudo (evita a tela "pular" e o clique se perder)
      if (e.relatedTarget?.type === 'submit') return;
      if (campo.value || campo.dataset.tocado) validarCampo(campo);
    });
    campo.addEventListener('input', () => {
      campo.dataset.tocado = '1';
      if (campo.getAttribute('aria-invalid')) validarCampo(campo);
      // Ao mudar a senha, a confirmação também é conferida de novo
      if (ehSenhaNova(campo)) {
        [...form.elements].filter((c) => ehSenha(c) && !c.name && c.value).forEach(validarCampo);
      }
    });
    campo.addEventListener('change', () => { if (campo.getAttribute('aria-invalid')) validarCampo(campo); });
  }
}

// Botão "Mostrar" / "Ocultar" ao lado dos campos de senha
function adicionarMostrarSenha(campo) {
  const caixa = document.createElement('span');
  caixa.className = 'senha-caixa';
  campo.replaceWith(caixa);
  caixa.appendChild(campo);
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'mostrar-senha';
  botao.textContent = 'Mostrar';
  botao.setAttribute('aria-label', `Mostrar ${rotuloDo(campo).toLowerCase()}`);
  botao.addEventListener('click', () => {
    const visivel = campo.type === 'text';
    campo.type = visivel ? 'password' : 'text';
    botao.textContent = visivel ? 'Mostrar' : 'Ocultar';
    botao.setAttribute('aria-label', `${visivel ? 'Mostrar' : 'Ocultar'} ${rotuloDo(campo).toLowerCase()}`);
    campo.focus();
  });
  caixa.appendChild(botao);
}

// Lista "8 caracteres / uma letra / um número" que vai ficando verde enquanto a pessoa digita
function adicionarRequisitosSenha(campo) {
  const ajuda = campo.closest('.campo')?.querySelector('.ajuda');
  const lista = document.createElement('ul');
  lista.className = 'requisitos-senha';
  lista.id = `${campo.id}-requisitos`;
  const desenhar = () => {
    lista.innerHTML = requisitosSenha(campo.value).map((r) =>
      `<li class="${r.ok ? 'ok' : ''}"><span aria-hidden="true">${r.ok ? '✓' : '•'}</span> ${r.texto}<span class="leitor">${r.ok ? ' — atendido' : ' — pendente'}</span></li>`).join('');
  };
  desenhar();
  campo.addEventListener('input', desenhar);
  if (ajuda) ajuda.replaceWith(lista);
  else campo.closest('.senha-caixa').insertAdjacentElement('afterend', lista);
  campo.setAttribute('aria-describedby', `${campo.getAttribute('aria-describedby') || ''} ${lista.id}`.trim());
}

// Ativa automaticamente em todos os formulários da página
document.addEventListener('DOMContentLoaded', () => $$('form').forEach(ativarValidacao));