// Finalização do pedido: itens e observações (RF02), total com taxa (RF03), modalidade (RF04) e envio (RF05)
(async function () {
  const usuario = await Layout.exigirLogin();
  if (!usuario) return;
  const form = $('#form-pedido');

  if (usuario.equipe) {
    mostrarMensagem($('#aviso-geral'), 'Você está logado como equipe. Para registrar pedidos de clientes, use o painel de atendimento.', 'info');
  }

  // Endereços do cliente: os fora da área de entrega aparecem desativados
  const enderecos = usuario.equipe ? [] : await api.get('/api/conta/enderecos');
  $('#endereco').innerHTML = enderecos.length
    ? enderecos.map((e) => `<option value="${e.id}" ${e.atende ? '' : 'disabled'} ${e.principal && e.atende ? 'selected' : ''}>
        ${esc(e.apelido)} — ${esc(e.texto)} ${e.atende ? `(taxa ${formatar.reais(e.taxa_centavos)})` : '(fora da área de entrega)'}</option>`).join('')
    : '<option value="">Nenhum endereço cadastrado</option>';

  const valor = (nome) => form.querySelector(`[name="${nome}"]:checked`)?.value;
  
  // Veio pelo QR Code da mesa: já escolhe "Salão" com o número da mesa
  let mesaQr = null;
  try { mesaQr = sessionStorage.getItem('sabor-express-mesa'); } catch { /* sem armazenamento */ }
  if (mesaQr) {
    form.querySelector('[name="modalidade"][value="salao"]').checked = true;
    $('#mesa').value = mesaQr;
  }

  // ---- Itens (quantidade e observação por item) ----
  function desenharLinhas() {
    const itens = Carrinho.ler();
    if (!itens.length) {
      $('#linhas').innerHTML = '<li class="vazio">Seu pedido está vazio.<br><br><a class="botao" href="/cardapio">Ver o cardápio</a></li>';
      return;
    }
    $('#linhas').innerHTML = itens.map((i) => `
      <li>
        <div class="linha entre">
          <strong>${esc(i.nome)}</strong>
          <span>${formatar.reais(i.preco_centavos * i.quantidade)}</span>
        </div>
        <div class="linha entre">
          <div class="contador">
            <button type="button" data-menos="${i.item_id}" aria-label="Diminuir">−</button>
            <span>${i.quantidade}</span>
            <button type="button" data-mais="${i.item_id}" aria-label="Aumentar">+</button>
          </div>
          <input class="obs-item" data-obs="${i.item_id}" value="${esc(i.observacao)}" maxlength="140"
                 placeholder="Observação (ex.: sem cebola)" aria-label="Observação para ${esc(i.nome)}">
        </div>
      </li>`).join('');
  }

  $('#linhas').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.mais) Carrinho.alterar(Number(b.dataset.mais), +1);
    if (b?.dataset.menos) Carrinho.alterar(Number(b.dataset.menos), -1);
  });
  $('#linhas').addEventListener('change', (e) => {
    if (e.target.dataset.obs) Carrinho.observar(Number(e.target.dataset.obs), e.target.value);
  });

  // ---- Monta o corpo enviado à API ----
  function montarPedido() {
    const modalidade = valor('modalidade');
    return {
      itens: Carrinho.ler().map(({ item_id, quantidade, observacao }) => ({ item_id, quantidade, observacao })),
      modalidade,
      endereco_id: modalidade === 'entrega' ? $('#endereco').value : undefined,
      mesa: modalidade === 'salao' ? $('#mesa').value : undefined,
      forma_pagamento: valor('forma_pagamento'),
      troco_para: valor('forma_pagamento') === 'dinheiro' ? $('#troco').value : undefined,
      observacoes: $('#observacoes').value,
      usar_fidelidade: $('#usar-fidelidade').checked,
    };
  }

  // ---- RF03: resumo calculado pelo servidor ----
  let simulacao = 0;
  async function atualizarResumo() {
    const modalidade = valor('modalidade');
    $('#bloco-entrega').classList.toggle('oculto', modalidade !== 'entrega');
    $('#bloco-salao').classList.toggle('oculto', modalidade !== 'salao');
    $('#bloco-retirada').classList.toggle('oculto', modalidade !== 'retirada');
    $('#bloco-troco').classList.toggle('oculto', valor('forma_pagamento') !== 'dinheiro');
    $('#r-erro').classList.add('oculto');

    const corpo = montarPedido();
    const vazio = !corpo.itens.length;
    $('#botao-confirmar').disabled = vazio || usuario.equipe;
    if (vazio) { $('#r-subtotal').textContent = $('#r-taxa').textContent = $('#r-total').textContent = '—'; $('#r-previsao').textContent = ''; return; }
    if (modalidade === 'salao' && !corpo.mesa) corpo.mesa = 1; // só para a prévia

    const minha = ++simulacao;
    try {
      const r = await api.post('/api/pedidos/simular', corpo);
      if (minha !== simulacao) return; // ignora respostas antigas
      $('#r-subtotal').textContent = formatar.reais(r.subtotal_centavos);
            if (r.fidelidade_desconto_centavos) {
        $('#r-taxa').innerHTML = `<s class="suave">${formatar.reais(r.fidelidade_desconto_centavos)}</s> <strong>Grátis</strong>`;
      } else {
        $('#r-taxa').textContent = modalidade === 'entrega' ? formatar.reais(r.taxa_entrega_centavos) : 'Grátis';
      }
      $('#bloco-fidelidade').classList.toggle('oculto', !(modalidade === 'entrega' && r.fidelidade_disponivel > 0));
      $('#r-total').textContent = formatar.reais(r.total_centavos);
      $('#r-previsao').textContent = `Previsão: cerca de ${r.estimativa.totalMin} min (preparo ${r.estimativa.preparoMin} min`
        + (r.estimativa.entregaMin ? ` + entrega ${r.estimativa.entregaMin} min)` : ')');
    } catch (e) {
      if (minha !== simulacao) return;
      $('#r-total').textContent = '—';
      mostrarMensagem($('#r-erro'), e.message);
    }
  }

  form.addEventListener('change', (e) => { if (!e.target.dataset.obs) atualizarResumo(); });
  document.addEventListener('carrinho', () => { desenharLinhas(); atualizarResumo(); });

  // ---- RF05: confirmar o pedido ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $$('.obs-item').forEach((i) => Carrinho.observar(Number(i.dataset.obs), i.value));
    const botao = $('#botao-confirmar');
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    try {
      const pedido = await api.post('/api/pedidos', montarPedido());
      Carrinho.limpar();
      location.href = `/pedido?codigo=${encodeURIComponent(pedido.codigo)}&novo=1`;
    } catch (err) {
      mostrarMensagem($('#r-erro'), err.message);
      botao.disabled = false;
      botao.textContent = 'Confirmar pedido';
    }
  });

  desenharLinhas();
  atualizarResumo();
})();