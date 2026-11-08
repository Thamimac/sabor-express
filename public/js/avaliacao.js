// Avaliação do pedido pelo cliente (nota de 1 a 5 e comentário), exibida na tela do pedido depois da entrega
document.addEventListener('pedido-desenhado', (e) => {
  const p = e.detail;
  if (p.status !== 'entregue' || Layout.usuario?.equipe || p.cliente_id !== Layout.usuario?.id) return;
  const estrelas = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const secao = document.createElement('section');
  secao.className = 'cartao avaliacao';
  $('#conteudo').appendChild(secao);

  if (p.avaliacao) {
    secao.innerHTML = `<h3>Sua avaliação</h3><p class="estrelas-fixas" aria-label="${p.avaliacao.nota} de 5">${estrelas(p.avaliacao.nota)}</p>
      ${p.avaliacao.comentario ? `<p class="suave">“${esc(p.avaliacao.comentario)}”</p>` : ''}<p class="pequeno suave">Obrigado pela sua opinião!</p>`;
    return;
  }

  secao.innerHTML = `
    <form id="form-avaliacao" novalidate>
      <h3>Como foi o seu pedido?</h3>
      <div class="mensagem oculto" role="alert"></div>
      <fieldset class="estrelas" aria-label="Nota de 1 a 5">
        ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="nota-${n}" name="nota" value="${n}"><label for="nota-${n}" title="${n} de 5">★<span class="leitor">${n} de 5 estrelas</span></label>`).join('')}
      </fieldset>
      <div class="campo"><label for="comentario">Comentário <span class="suave">(opcional)</span></label>
        <textarea id="comentario" name="comentario" rows="2" maxlength="300" placeholder="Conte o que achou da comida e da entrega"></textarea></div>
      <button type="submit" class="botao">Enviar avaliação</button>
    </form>`;
  $('#form-avaliacao').addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviarFormulario(ev.target, async (dados) => {
      if (!dados.nota) throw new Error('Escolha de 1 a 5 estrelas');
      await api.post(`/api/pedidos/${encodeURIComponent(p.codigo)}/avaliacao`, dados);
      avisar('Obrigado pela avaliação!');
      location.reload();
    });
  });
});