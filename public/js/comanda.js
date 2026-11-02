// Comanda da cozinha: layout para impressora térmica de 80 mm (abre a janela de impressão automaticamente)
(async function () {
  const usuario = await Layout.exigirEquipe();
  if (!usuario) return;
  const params = new URLSearchParams(location.search);
  $('#imprimir').addEventListener('click', () => window.print());
  try {
    const p = await api.get(`/api/equipe/pedidos/${encodeURIComponent(params.get('codigo'))}`);
    const destino = { entrega: `ENTREGA — ${p.endereco_texto || ''}`, retirada: 'RETIRADA NO BALCÃO', salao: `SALÃO — MESA ${p.mesa}` }[p.modalidade];
    document.title = `Comanda ${p.codigo}`;
    $('#comanda').innerHTML = `
      <div class="centro"><strong>SABOR EXPRESS</strong><br>COMANDA DE COZINHA</div>
      <hr>
      <div class="comanda-codigo">${esc(p.codigo)}</div>
      <div class="centro">${formatar.dataHora(p.criado_em)}</div>
      <div class="comanda-destino">${esc(destino)}</div>
      <div>Cliente: ${esc(p.cliente_nome)}</div>
      <hr>
      ${p.itens.map((i) => `<div class="comanda-item"><strong>${i.quantidade}x</strong> ${esc(i.nome)}
        ${i.observacao ? `<div class="comanda-obs">&gt;&gt; ${esc(i.observacao)}</div>` : ''}</div>`).join('')}
      ${p.observacoes ? `<hr><div class="comanda-obs">OBS: ${esc(p.observacoes)}</div>` : ''}
      <hr>
      <div>Preparo previsto: ${p.preparo_estimado_min} min</div>
      ${p.modalidade === 'entrega' ? `<div>Pagamento: ${esc(FORMA_PAGAMENTO[p.forma_pagamento])} (${esc(p.pagamento?.status || '')})</div>
        ${p.forma_pagamento === 'dinheiro' && p.pagamento?.status !== 'aprovado' ? `<div><strong>COBRAR: ${formatar.reais(p.total_centavos)}</strong>${p.troco_para_centavos ? ` — troco p/ ${formatar.reais(p.troco_para_centavos)}` : ''}</div>` : ''}` : ''}
      <hr><div class="centro pequeno">Impresso em ${formatar.dataHora(new Date().toISOString())}</div>`;
    if (params.has('imprimir')) setTimeout(() => window.print(), 300);
  } catch (e) {
    $('#comanda').innerHTML = `<p>${esc(e.message)}</p>`;
  }
})();