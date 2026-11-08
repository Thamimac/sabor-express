// Pagamento online na página do pedido (RF16): cartão de crédito/débito ou Pix — gateway SIMULADO
// Este arquivo completa a tela do pedido: é chamado sempre que o pedido é desenhado.
document.addEventListener('pedido-desenhado', (e) => {
  const p = e.detail;
  const pg = p.pagamento;
  const area = $('#area-pagamento');
  if (!area || !pg) return;
  const codigo = encodeURIComponent(p.codigo);
  const linkRecibo = `<a class="botao secundario bloco" href="/recibo?codigo=${codigo}" target="_blank">Ver recibo</a>`;

  if (pg.status === 'aprovado') {
    area.innerHTML = `<div class="mensagem sucesso">✓ Pagamento aprovado${pg.cartao_final ? ` · ${esc(pg.cartao_bandeira)} final ${esc(pg.cartao_final)}` : ''}</div>${linkRecibo}`;
    return;
  }
  if (pg.status === 'estornado') {
    area.innerHTML = `<div class="mensagem info">Pagamento estornado. ${esc(pg.motivo || '')}</div>${linkRecibo}`;
    return;
  }
  if (p.status === 'cancelado' || Layout.usuario?.equipe) { area.innerHTML = ''; return; }
  if (pg.forma === 'dinheiro') {
    area.innerHTML = '<div class="mensagem info">Pagamento em dinheiro na entrega/retirada.</div>';
    return;
  }

  const recusado = pg.status === 'recusado' ? `<div class="mensagem erro">Pagamento recusado: ${esc(pg.motivo || '')} Tente outro cartão ou pague com Pix.</div>` : '';
  const usarPix = pg.forma === 'pix';
  area.innerHTML = `
    ${recusado}
    <div class="abas abas-pequenas" role="tablist">
      <button type="button" role="tab" aria-selected="${usarPix}" data-forma-aba="pix">Pix</button>
      <button type="button" role="tab" aria-selected="${!usarPix}" data-forma-aba="cartao">Cartão ou Vale Refeição</button>
    </div>
    <div id="pg-pix" class="${usarPix ? '' : 'oculto'}">
      ${pg.pix_copia_cola ? `
        <label for="pix-codigo">Pix copia e cola</label>
        <textarea id="pix-codigo" rows="3" readonly>${esc(pg.pix_copia_cola)}</textarea>
        <button type="button" class="botao neutro bloco" id="pix-copiar">Copiar código</button>
        <p class="ajuda">Ambiente de testes: o botão abaixo simula o banco confirmando o pagamento.</p>
        <button type="button" class="botao bloco" id="pix-confirmar">Simular pagamento do Pix</button>`
      : `<button type="button" class="botao bloco" id="pix-gerar">Gerar código Pix · ${formatar.reais(pg.valor_centavos)}</button>`}
    </div>
    <form id="pg-cartao" class="${usarPix ? 'oculto' : ''}" novalidate>
      <div class="mensagem oculto" role="alert"></div>
            <div class="campos">
        <div class="campo"><label for="c-forma">Tipo</label>
          <select id="c-forma" name="forma"><option value="credito" ${pg.forma === 'credito' ? 'selected' : ''}>Crédito</option>
            <option value="debito" ${pg.forma === 'debito' ? 'selected' : ''}>Débito</option>
            <option value="voucher" ${pg.forma === 'voucher' ? 'selected' : ''}>Vale-refeição</option></select></div>
        <div class="campo ${pg.forma === 'voucher' ? '' : 'oculto'}" id="bloco-bandeira"><label for="c-bandeira">Bandeira do vale</label>
          <select id="c-bandeira" name="bandeira" ${pg.forma === 'voucher' ? '' : 'disabled'}>
            ${['Alelo', 'Pluxee', 'Ticket', 'VR'].map((b) => `<option value="${b}">${b}</option>`).join('')}</select></div>
      </div>
        <select id="c-forma" name="forma"><option value="credito" ${pg.forma === 'credito' ? 'selected' : ''}>Crédito</option>
          <option value="debito" ${pg.forma === 'debito' ? 'selected' : ''}>Débito</option></select></div>
      <div class="campo"><label for="c-numero">Número do cartão</label><input id="c-numero" name="numero" inputmode="numeric" autocomplete="cc-number" maxlength="23"></div>
      <div class="campo"><label for="c-nome">Nome impresso</label><input id="c-nome" name="nome" autocomplete="cc-name"></div>
      <div class="campos">
        <div class="campo"><label for="c-validade">Validade</label><input id="c-validade" name="validade" placeholder="MM/AA" autocomplete="cc-exp" maxlength="5"></div>
        <div class="campo"><label for="c-cvv">CVV</label><input id="c-cvv" name="cvv" inputmode="numeric" autocomplete="cc-csc" maxlength="4"></div>
      </div>
      <button type="submit" class="botao bloco">Pagar ${formatar.reais(pg.valor_centavos)}</button>
      <p class="ajuda">🔒 Ambiente de testes. Cartão aprovado: 4111 1111 1111 1111 · recusado: 4000 0000 0000 0002 (qualquer validade futura e CVV).</p>
    </form>`;

  $$('[data-forma-aba]', area).forEach((b) => b.addEventListener('click', () => {
    $$('[data-forma-aba]', area).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('#pg-pix').classList.toggle('oculto', b.dataset.formaAba !== 'pix');
    $('#pg-cartao').classList.toggle('oculto', b.dataset.formaAba !== 'cartao');
  }));

    // Vale-refeição: mostra a escolha da bandeira (Alelo, Pluxee, Ticket ou VR)
  $('#c-forma')?.addEventListener('change', (ev) => {
  const vale = ev.target.value === 'voucher';
  $('#bloco-bandeira').classList.toggle('oculto', !vale);
  $('#c-bandeira').disabled = !vale; // campo desativado não é enviado
  });

  // Formata o número do cartão em blocos de 4 e a validade como MM/AA
  $('#c-numero')?.addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '); });
  $('#c-validade')?.addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 4).replace(/^(\d{2})(\d)/, '$1/$2'); });

  const recarregar = () => location.reload();
  $('#pg-cartao').addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviarFormulario(ev.target, async (dados) => {
      await api.post(`/api/pedidos/${codigo}/pagar/cartao`, dados);
      avisar('Pagamento aprovado!');
      recarregar();
    });
  });
  $('#pix-gerar')?.addEventListener('click', async () => {
    try { await api.post(`/api/pedidos/${codigo}/pagar/pix`); recarregar(); } catch (err) { avisar(err.message, 'erro'); }
  });
  $('#pix-copiar')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#pix-codigo').value); avisar('Código copiado'); } catch { $('#pix-codigo').select(); }
  });
  $('#pix-confirmar')?.addEventListener('click', async () => {
    try { await api.post(`/api/pedidos/${codigo}/pagar/pix/confirmar`); avisar('Pix confirmado!'); recarregar(); } catch (err) { avisar(err.message, 'erro'); }
  });
});