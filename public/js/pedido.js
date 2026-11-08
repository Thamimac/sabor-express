// Confirmação (RF05), acompanhamento em tempo real e cancelamento (RF06) do pedido
(async function () {
  const usuario = await Layout.exigirLogin();
  if (!usuario) return;
  const params = new URLSearchParams(location.search);
  const codigo = params.get('codigo');

  // Etapas exibidas ao cliente conforme a modalidade
  function etapas(p) {
    const final = { entrega: 'Entregue', retirada: 'Retirado', salao: 'Servido' }[p.modalidade];
    const lista = [['aguardando_confirmacao', 'Pedido enviado'], ['recebido', 'Confirmado'], ['em_preparo', 'Em preparo'],
      ['pronto', p.modalidade === 'entrega' ? 'Pronto' : p.modalidade === 'retirada' ? 'Pronto para retirar' : 'Pronto para servir']];
    if (p.modalidade === 'entrega') lista.push(['a_caminho', 'Saiu para entrega']);
    lista.push(['entregue', final]);
    return lista;
  }

  function desenhar(p) {
    document.title = `Pedido ${p.codigo} — Sabor Express`;
    const lista = etapas(p);
    const atual = p.status === 'despachado' ? 'pronto' : p.status;
    const indice = lista.findIndex(([s]) => s === atual);
    const dataDe = (s) => p.historico.filter((h) => h.status === s).at(-1)?.em;

    const trilha = p.status === 'cancelado'
      ? `<div class="mensagem erro"><strong>Pedido cancelado.</strong> ${esc(p.motivo_cancelamento || '')}</div>`
      : `<ol class="etapas">${lista.map(([s, rotulo], i) => `
          <li class="${i < indice ? 'feita' : i === indice ? 'atual' : ''}">
            <span class="marcador" aria-hidden="true">${i < indice ? '✓' : i + 1}</span>
            <span>${esc(rotulo)}<small>${i <= indice && dataDe(s) ? formatar.hora(dataDe(s)) : ''}</small></span>
          </li>`).join('')}</ol>`;

    const destino = {
      entrega: `<strong>Entrega em:</strong> ${esc(p.endereco_texto || '')}`,
      retirada: '<strong>Retirada no balcão</strong> — Rua Barão de Paranapiacaba, 100 - Sé',
      salao: `<strong>Consumo no salão</strong> — Mesa ${esc(p.mesa)}`,
    }[p.modalidade];

    const ativo = !['entregue', 'cancelado'].includes(p.status);
    $('#conteudo').innerHTML = `
      <div class="linha entre">
        <h1>Pedido ${esc(p.codigo)}</h1>
        ${seloStatus(p.status)}
      </div>
      <p class="suave">Feito em ${formatar.dataHora(p.criado_em)}${ativo && p.previsao_em ? ` · <strong>Previsão: ${formatar.hora(p.previsao_em)}</strong>` : ''}</p>
      ${trilha}
      ${p.status === 'despachado' ? '<p class="mensagem info">Aguardando o entregador parceiro aceitar a corrida.</p>' : ''}
      ${p.entregador && ['despachado', 'a_caminho'].includes(p.status) ? `<p class="mensagem info">🛵 Entregador: <strong>${esc(p.entregador.nome)}</strong> (${esc(p.entregador.empresa)}) · ${esc(p.entregador.veiculo || '')}</p>` : ''}

      <div class="layout-checkout">
        <section class="cartao">
          <h3>Itens</h3>
          <ul class="linhas-pedido">
            ${p.itens.map((i) => `<li><div class="linha entre"><span>${i.quantidade}× ${esc(i.nome)}</span>
              <span>${formatar.reais(i.preco_unit_centavos * i.quantidade)}</span></div>
              ${i.observacao ? `<small class="suave">Obs.: ${esc(i.observacao)}</small>` : ''}</li>`).join('')}
          </ul>
          ${p.observacoes ? `<p class="pequeno"><strong>Observações:</strong> ${esc(p.observacoes)}</p>` : ''}
          <p class="pequeno">${destino}</p>
        </section>
        <aside class="cartao resumo">
          <div class="linha entre"><span>Subtotal</span><span>${formatar.reais(p.subtotal_centavos)}</span></div>
          <div class="linha entre"><span>Taxa de entrega</span><span>${p.taxa_entrega_centavos ? formatar.reais(p.taxa_entrega_centavos) : p.fidelidade ? 'Grátis (fidelidade)' : 'Grátis'}</span></div>
          <hr class="separador">
          <div class="linha entre total"><span>Total</span><strong>${formatar.reais(p.total_centavos)}</strong></div>
          <p class="pequeno">Pagamento: ${esc(FORMA_PAGAMENTO[p.forma_pagamento])} · <strong>${esc(p.pagamento?.status || '')}</strong>
            ${p.troco_para_centavos ? `<br>Troco para ${formatar.reais(p.troco_para_centavos)}` : ''}</p>
          <div id="area-pagamento"></div>
          ${p.status === 'aguardando_confirmacao' && !usuario.equipe
            ? '<button type="button" class="botao secundario bloco" id="botao-cancelar">Cancelar pedido</button><p class="ajuda">Você pode cancelar enquanto o restaurante não confirmar.</p>' : ''}
        </aside>
      </div>`;

    $('#botao-cancelar')?.addEventListener('click', async () => {
      if (!confirm('Deseja realmente cancelar este pedido?')) return;
      try {
        desenhar(await api.post(`/api/pedidos/${encodeURIComponent(p.codigo)}/cancelar`, { motivo: 'Cancelado pelo cliente pelo site' }));
        avisar('Pedido cancelado');
      } catch (e) { avisar(e.message, 'erro'); }
    });
    document.dispatchEvent(new CustomEvent('pedido-desenhado', { detail: p }));
  }

  async function carregar() {
    try {
      desenhar(await api.get(`/api/pedidos/${encodeURIComponent(codigo)}`));
    } catch (e) {
      $('#conteudo').innerHTML = `<div class="mensagem erro">${esc(e.message)}</div><a class="botao" href="/conta">Meus pedidos</a>`;
    }
  }

  if (params.has('novo')) {
    const caixa = $('#confirmacao');
    caixa.innerHTML = `<strong>Pedido ${esc(codigo)} enviado!</strong> Guarde este número. Você acompanha tudo por esta página.`;
    caixa.classList.remove('oculto');
  }
  await carregar();

  // Tempo real: atualiza a tela quando o status muda (sem recarregar a página)
  const fonte = new EventSource('/api/eventos');
  fonte.addEventListener('pedido', (ev) => {
    const dados = JSON.parse(ev.data);
    if (dados.codigo === codigo) { carregar(); avisar(`Pedido atualizado: ${STATUS_PEDIDO[dados.status]?.[0] || dados.status}`); }
  });
  fonte.addEventListener('pagamento', (ev) => { if (JSON.parse(ev.data).codigo === codigo) carregar(); });
})();