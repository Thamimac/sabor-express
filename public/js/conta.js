// Tela "Minha conta": histórico (RF25), endereços (RF24), dados e LGPD
(async function () {
  const usuario = await Layout.exigirLogin();
  if (!usuario) return;
  if (new URLSearchParams(location.search).has('bemvindo')) $('#boas-vindas').classList.remove('oculto');

  // ---- Abas ----
  function abrirAba(nome) {
    if (!$(`#aba-${nome}`)) nome = 'pedidos';
    $$('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
    $$('[role="tabpanel"]').forEach((s) => s.classList.toggle('oculto', s.id !== `aba-${nome}`));
    history.replaceState(null, '', `#${nome}`);
  }
  $$('.abas button').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));
  if (location.hash) abrirAba(location.hash.slice(1));
  window.addEventListener('hashchange', () => abrirAba(location.hash.slice(1) || 'pedidos'));

  // ---- Histórico de pedidos (RF25) ----
  async function carregarPedidos() {
    const pedidos = await api.get('/api/conta/pedidos');
    $('#lista-pedidos').innerHTML = pedidos.length ? pedidos.map((p) => `
      <li>
        <div class="linha entre">
          <strong>Pedido ${esc(p.codigo)}</strong>
          ${seloStatus(p.status)}
        </div>
        <p class="suave pequeno">${formatar.dataHora(p.criado_em)} · ${esc(MODALIDADE[p.modalidade])} · ${esc(FORMA_PAGAMENTO[p.forma_pagamento])}</p>
        <p>${p.itens.map((i) => `${i.quantidade}× ${esc(i.nome)}`).join(', ')}</p>
        <div class="linha entre">
          <strong>${formatar.reais(p.total_centavos)}</strong>
          <a class="botao neutro pequeno" href="/pedido?codigo=${encodeURIComponent(p.codigo)}">Ver detalhes</a>
        </div>
      </li>`).join('')
      : '<li class="vazio">Você ainda não fez nenhum pedido.<br><br><a class="botao" href="/cardapio">Ver o cardápio</a></li>';
  }

    // ---- Programa de fidelidade: a cada 10 pedidos entregues, uma entrega grátis ----
  async function carregarFidelidade() {
    const f = await api.get('/api/conta/fidelidade');
    const selos = Array.from({ length: f.meta }, (_, i) => `<span class="selo-fidelidade ${i < f.progresso ? 'cheio' : ''}" aria-hidden="true"></span>`).join('');
    $('#fidelidade').innerHTML = `
      <div><strong>Cartão fidelidade</strong>
        <p>${f.disponiveis ? `Você tem <strong>${f.disponiveis} entrega${f.disponiveis > 1 ? 's' : ''} grátis</strong> para usar no próximo pedido de entrega.`
          : `Faltam <strong>${f.faltam} pedido${f.faltam > 1 ? 's' : ''}</strong> para você ganhar uma entrega grátis.`}</p></div>
      <div class="selos-fidelidade" role="img" aria-label="${f.progresso} de ${f.meta} pedidos">${selos}</div>`;
    $('#fidelidade').classList.remove('oculto');
  }

  // ---- Endereços (RF24) ----
  async function carregarEnderecos() {
    const lista = await api.get('/api/conta/enderecos');
    $('#lista-enderecos').innerHTML = lista.length ? lista.map((e) => `
      <li>
        <div class="linha entre">
          <strong>${esc(e.apelido)} ${e.principal ? '<span class="selo info sem-ponto">Principal</span>' : ''}</strong>
          ${e.atende ? `<span class="selo sucesso">Entrega: ${formatar.reais(e.taxa_centavos)}</span>`
                     : '<span class="selo erro">Fora da área de entrega</span>'}
        </div>
        <p>${esc(e.texto)}${e.referencia ? `<br><span class="suave pequeno">Ref.: ${esc(e.referencia)}</span>` : ''}</p>
        <div class="linha">
          <button class="botao neutro pequeno" data-editar="${e.id}">Editar</button>
          ${e.principal ? '' : `<button class="botao neutro pequeno" data-principal="${e.id}">Tornar principal</button>`}
          <button class="botao neutro pequeno" data-remover="${e.id}">Remover</button>
        </div>
      </li>`).join('') : '<li class="vazio">Nenhum endereço cadastrado.</li>';

    $$('[data-editar]').forEach((b) => b.addEventListener('click', () => abrirFormEndereco(lista.find((e) => e.id == b.dataset.editar))));
    $$('[data-principal]').forEach((b) => b.addEventListener('click', async () => {
      await api.post(`/api/conta/enderecos/${b.dataset.principal}/principal`);
      carregarEnderecos();
    }));
    $$('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remover este endereço?')) return;
      await api.delete(`/api/conta/enderecos/${b.dataset.remover}`);
      avisar('Endereço removido');
      carregarEnderecos();
    }));
  }

  const formEnd = $('#form-endereco');
  async function abrirFormEndereco(e = null) {
    formEnd.reset();
    $('#endereco-id').value = e?.id || '';
    $('#titulo-endereco').textContent = e ? 'Editar endereço' : 'Novo endereço';
    for (const campo of ['apelido', 'cep', 'logradouro', 'numero', 'complemento', 'referencia']) {
      $(`#e-${campo}`).value = e?.[campo] || '';
    }
    await preencherBairros($('#e-bairro'), e?.bairro_id);
    formEnd.classList.remove('oculto');
    $('#e-apelido').focus();
  }
  $('#novo-endereco').addEventListener('click', () => abrirFormEndereco());
  $('#cancelar-endereco').addEventListener('click', () => formEnd.classList.add('oculto'));
  formEnd.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviarFormulario(formEnd, async (dados) => {
      const id = $('#endereco-id').value;
      if (id) await api.put(`/api/conta/enderecos/${id}`, dados);
      else await api.post('/api/conta/enderecos', dados);
      formEnd.classList.add('oculto');
      avisar('Endereço salvo');
      carregarEnderecos();
    });
  });

  // ---- Dados pessoais e senha ----
  const conta = await api.get('/api/conta');
  $('#d-nome').value = conta.nome;
  $('#d-email').value = conta.email;
  $('#d-telefone').value = conta.telefone || '';
  $('#consentimento').textContent = conta.consentimento_lgpd_em
    ? `Consentimento LGPD registrado em ${formatar.dataHora(conta.consentimento_lgpd_em)}.` : '';

  $('#form-dados').addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviarFormulario(ev.target, async (dados) => {
      await api.put('/api/conta', dados);
      avisar('Dados atualizados');
    });
  });
  $('#form-senha').addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviarFormulario(ev.target, async (dados) => {
      await api.put('/api/conta/senha', dados);
      ev.target.reset();
      avisar('Senha alterada');
    });
  });

  // ---- Exclusão da conta (LGPD) ----
  $('#form-excluir').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita.')) return;
    enviarFormulario(ev.target, async (dados) => {
      await api.requisicao('DELETE', '/api/conta', dados);
      alert('Sua conta foi excluída.');
      location.href = '/';
    });
  });

  carregarPedidos();
  carregarEnderecos();
  carregarFidelidade();
})();