// Painel do atendimento: confirmar/cancelar pedidos, entregar no balcão/salão e registrar pedidos de telefone
(async function () {
  const usuario = await Layout.exigirEquipe('atendente');
  if (!usuario) return;

  const PAGAMENTO = { pendente: ['Pendente', 'alerta'], aprovado: ['Pago', 'sucesso'], recusado: ['Recusado', 'erro'], estornado: ['Estornado', 'info'], cancelado: ['Cancelado', ''] };
  const seloPagamento = (s) => `<span class="selo ${PAGAMENTO[s]?.[1] || ''}">${esc(PAGAMENTO[s]?.[0] || s || '—')}</span>`;
  const destino = (p) => (p.modalidade === 'salao' ? `Mesa ${p.mesa}` : p.modalidade === 'retirada' ? 'Retirada' : `Entrega · ${esc(p.endereco_texto || '')}`);

  function cartao(p, acoes = '') {
    return `
      <article class="cartao-pedido ${p.status === 'aguardando_confirmacao' ? 'novo' : ''}">
        <div class="linha entre">
          <strong>${esc(p.codigo)}</strong>
          <span class="suave pequeno">${formatar.hora(p.criado_em)}</span>
        </div>
        <div class="linha">${seloStatus(p.status)} ${seloPagamento(p.pagamento_status)} <span class="selo sem-ponto">${esc(FORMA_PAGAMENTO[p.forma_pagamento])}</span></div>
        <p class="pequeno"><strong>${esc(p.cliente_nome)}</strong>${p.cliente_telefone ? ` · ${esc(p.cliente_telefone)}` : ''}<br>${destino(p)}</p>
        <ul class="itens-compactos">${p.itens.map((i) => `<li>${i.quantidade}× ${esc(i.nome)}${i.observacao ? ` <em>(${esc(i.observacao)})</em>` : ''}</li>`).join('')}</ul>
        ${p.observacoes ? `<p class="pequeno"><strong>Obs.:</strong> ${esc(p.observacoes)}</p>` : ''}
        ${p.entregador_nome ? `<p class="pequeno">🛵 ${esc(p.entregador_nome)}</p>` : ''}
        <div class="linha entre"><strong>${formatar.reais(p.total_centavos)}</strong><div class="linha">${acoes}</div></div>
      </article>`;
  }

  async function carregar() {
    const lista = await api.get('/api/equipe/pedidos');
    const grupo = (...st) => lista.filter((p) => st.includes(p.status));
    const aguardando = grupo('aguardando_confirmacao');
    const cozinha = grupo('recebido', 'em_preparo');
    const prontos = grupo('pronto', 'despachado', 'a_caminho');
    const finalizados = grupo('entregue', 'cancelado').reverse();

    $('#col-aguardando').innerHTML = aguardando.map((p) => cartao(p, `
      <button class="botao pequeno neutro" data-acao="cancelado" data-codigo="${p.codigo}">Recusar</button>
      <button class="botao pequeno sucesso" data-acao="recebido" data-codigo="${p.codigo}">Confirmar</button>`)).join('') || '<p class="vazio">Nenhum pedido aguardando.</p>';
    $('#col-cozinha').innerHTML = cozinha.map((p) => cartao(p)).join('') || '<p class="vazio">Cozinha livre.</p>';
    $('#col-prontos').innerHTML = prontos.map((p) => cartao(p,
      p.status === 'pronto' && p.modalidade !== 'entrega'
        ? `<button class="botao pequeno sucesso" data-acao="entregue" data-codigo="${p.codigo}">${p.modalidade === 'salao' ? 'Servido' : 'Retirado'}</button>`
        : p.status === 'pronto' ? '<span class="pequeno suave">Aguardando despacho</span>' : '')).join('') || '<p class="vazio">Nada por aqui.</p>';
    $('#finalizados').innerHTML = finalizados.map((p) => `<tr>
      <td>${esc(p.codigo)}</td><td>${esc(p.cliente_nome)}</td><td>${esc(MODALIDADE[p.modalidade])}</td>
      <td>${seloStatus(p.status)}</td><td>${seloPagamento(p.pagamento_status)}</td>
      <td class="num">${formatar.reais(p.total_centavos)}</td><td>${formatar.hora(p.entregue_em || p.cancelado_em)}</td></tr>`).join('')
      || '<tr><td colspan="7" class="vazio">Nenhum pedido finalizado hoje.</td></tr>';

    $('#n-aguardando').textContent = aguardando.length;
    $('#n-cozinha').textContent = cozinha.length;
    $('#n-prontos').textContent = prontos.length;
    const vendido = grupo('entregue').reduce((s, p) => s + p.total_centavos, 0);
    $('#indicadores').innerHTML = `<span class="selo info sem-ponto">${grupo('entregue').length} entregues hoje</span>
      <span class="selo sucesso sem-ponto">${formatar.reais(vendido)} em pedidos entregues</span>`;
    document.title = aguardando.length ? `(${aguardando.length}) Atendimento — Sabor Express` : 'Atendimento — Sabor Express';
  }

  // Ações dos botões dos cartões
  $('main').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const corpo = { status: b.dataset.acao };
    if (corpo.status === 'cancelado') {
      corpo.motivo = prompt('Motivo da recusa/cancelamento (o cliente verá esta mensagem):', 'Item indisponível no momento');
      if (corpo.motivo === null) return;
    }
    b.disabled = true;
    try {
      await api.post(`/api/equipe/pedidos/${b.dataset.codigo}/status`, corpo);
      avisar(`Pedido ${b.dataset.codigo} atualizado`);
      carregar();
    } catch (err) { avisar(err.message, 'erro'); b.disabled = false; }
  });

  // ---- Novo pedido (telefone/balcão) ----
  const dialogo = $('#dialogo-pedido');
  const form = $('#form-novo');
  let itensNovo = [];
  const { categorias } = await api.get('/api/cardapio');
  const cardapio = categorias.flatMap((c) => c.itens);
  $('#n-item').innerHTML = categorias.map((c) => `<optgroup label="${esc(c.nome)}">${c.itens.map((i) =>
    `<option value="${i.id}">${esc(i.nome)} — ${formatar.reais(i.preco_centavos)}</option>`).join('')}</optgroup>`).join('');
  await preencherBairros($('#n-bairro'));

  const modalidade = () => form.querySelector('[name="modalidade"]:checked').value;
  function corpoNovo() {
    const d = lerFormulario(form);
    if (modalidade() !== 'entrega') delete d.endereco;
    if (modalidade() !== 'salao') delete d.mesa;
    if (d.forma_pagamento !== 'dinheiro') delete d.troco_para;
    return { ...d, itens: itensNovo };
  }
  async function atualizarNovo() {
    $('#n-bloco-mesa').classList.toggle('oculto', modalidade() !== 'salao');
    $('#n-bloco-endereco').classList.toggle('oculto', modalidade() !== 'entrega');
    $('#n-itens').innerHTML = itensNovo.map((i, idx) => {
      const item = cardapio.find((c) => c.id === i.item_id);
      return `<li><div class="linha entre"><span>${i.quantidade}× ${esc(item.nome)}${i.observacao ? ` <em class="suave">(${esc(i.observacao)})</em>` : ''}</span>
        <span>${formatar.reais(item.preco_centavos * i.quantidade)} <button type="button" class="botao neutro pequeno" data-remover="${idx}">Remover</button></span></div></li>`;
    }).join('') || '<li class="suave">Nenhum item adicionado.</li>';
    if (!itensNovo.length) { $('#n-total').textContent = 'Total: —'; return; }
    try {
      const corpo = corpoNovo();
      if (modalidade() === 'salao' && !corpo.mesa) corpo.mesa = 1;
      const r = await api.post('/api/pedidos/simular', corpo);
      $('#n-total').textContent = `Total: ${formatar.reais(r.total_centavos)}${r.taxa_entrega_centavos ? ` (taxa ${formatar.reais(r.taxa_entrega_centavos)})` : ''}`;
    } catch (err) { $('#n-total').textContent = err.message; }
  }

  $('#novo-pedido').addEventListener('click', () => { form.reset(); itensNovo = []; atualizarNovo(); dialogo.showModal(); });
  dialogo.querySelector('[data-fechar]').addEventListener('click', () => dialogo.close());
  $('#n-adicionar').addEventListener('click', () => {
    itensNovo.push({ item_id: Number($('#n-item').value), quantidade: Number($('#n-qtd').value) || 1, observacao: $('#n-obs').value });
    $('#n-qtd').value = 1; $('#n-obs').value = '';
    atualizarNovo();
  });
  $('#n-itens').addEventListener('click', (e) => {
    if (e.target.dataset.remover) { itensNovo.splice(Number(e.target.dataset.remover), 1); atualizarNovo(); }
  });
  form.addEventListener('change', (e) => { if (!['n-item', 'n-qtd', 'n-obs'].includes(e.target.id)) atualizarNovo(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(form, async () => {
      const p = await api.post('/api/equipe/pedidos', corpoNovo());
      dialogo.close();
      avisar(`Pedido ${p.codigo} registrado`);
      carregar();
    });
  });

  // Tempo real: qualquer mudança em pedidos atualiza o quadro
  Layout.aoEvento('pedido', (d) => { if (d.novo) avisar(`🔔 Novo pedido ${d.codigo}`); carregar(); });
  setInterval(carregar, 60000); // segurança caso a conexão em tempo real caia
  carregar();
})();