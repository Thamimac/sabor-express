// Comprovante/recibo do pagamento (RF17) — pronto para imprimir ou salvar em PDF
(async function () {
  const usuario = await Layout.exigirLogin();
  if (!usuario) return;
  const codigo = new URLSearchParams(location.search).get('codigo');
  $('#imprimir').addEventListener('click', () => window.print());
  try {
    const r = await api.get(`/api/pedidos/${encodeURIComponent(codigo)}/recibo`);
    const pg = r.pagamento;
    document.title = `Recibo ${r.numero} — Sabor Express`;
    $('#recibo').innerHTML = `
      <header class="centro">
        <h1>${esc(r.restaurante.nome)}</h1>
        <p class="pequeno">${esc(r.restaurante.endereco)}<br>CNPJ ${esc(r.restaurante.cnpj)} · ${esc(r.restaurante.telefone)}</p>
        <h2>Recibo de pagamento</h2>
        <p class="pequeno">Nº ${esc(r.numero)} · Pedido ${esc(r.pedido.codigo)}</p>
      </header>
      ${pg.status === 'estornado' ? `<div class="mensagem erro centro"><strong>PAGAMENTO ESTORNADO</strong> ${esc(pg.motivo || '')}</div>` : ''}
      <p class="pequeno">Cliente: <strong>${esc(r.pedido.cliente)}</strong><br>
        Data do pedido: ${formatar.dataHora(r.pedido.criado_em)} · ${esc(MODALIDADE[r.pedido.modalidade])}</p>
      <table>
        <thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead>
        <tbody>${r.pedido.itens.map((i) => `<tr><td>${esc(i.nome)}</td><td class="num">${i.quantidade}</td>
          <td class="num">${formatar.reais(i.unitario)}</td><td class="num">${formatar.reais(i.total)}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="3">Subtotal</td><td class="num">${formatar.reais(r.pedido.subtotal)}</td></tr>
          <tr><td colspan="3">Taxa de entrega</td><td class="num">${formatar.reais(r.pedido.taxa_entrega)}</td></tr>
          <tr class="total"><td colspan="3"><strong>Total pago</strong></td><td class="num"><strong>${formatar.reais(pg.valor)}</strong></td></tr>
        </tfoot>
      </table>
      <p class="pequeno">Forma de pagamento: <strong>${esc(FORMA_PAGAMENTO[pg.forma])}</strong>${pg.cartao ? ` (${esc(pg.cartao)})` : ''}<br>
        Aprovado em: ${formatar.dataHora(pg.aprovado_em)} · Autenticação: ${esc(pg.referencia || '—')}<br>
        Nota fiscal: ${r.fiscal?.numero_nf ? esc(r.fiscal.numero_nf) : 'em emissão pela contabilidade'}</p>
      <p class="centro pequeno suave">Obrigado pela preferência!</p>`;
  } catch (e) {
    $('#recibo').innerHTML = `<div class="mensagem erro">${esc(e.message)}</div>`;
  }
})();