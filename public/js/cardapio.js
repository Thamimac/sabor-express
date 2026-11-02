// Página do cardápio (RF01) com carrinho (RF02), fotos dos pratos e pedido pela mesa (QR Code)
(async function () {
  const itensPorId = {};

  // QR Code da mesa: /cardapio?mesa=7 → guarda a mesa para o checkout escolher "Salão" automaticamente
  const mesa = new URLSearchParams(location.search).get('mesa');
  if (mesa && /^\d{1,2}$/.test(mesa)) {
    try { sessionStorage.setItem('sabor-express-mesa', mesa); } catch { /* sem armazenamento */ }
  }
  let mesaAtual = null;
  try { mesaAtual = sessionStorage.getItem('sabor-express-mesa'); } catch { /* sem armazenamento */ }
  if (mesaAtual) {
    const aviso = $('#aviso-mesa');
    aviso.innerHTML = `🍽️ Você está na <strong>mesa ${esc(mesaAtual)}</strong>. Escolha os pratos e finalize: levamos até você.
      <button type="button" class="botao neutro pequeno" id="sair-mesa">Não estou no restaurante</button>`;
    aviso.classList.remove('oculto');
    $('#carrinho-dica').textContent = `Pedido para a mesa ${mesaAtual}, sem taxa de entrega.`;
    $('#sair-mesa').addEventListener('click', () => {
      try { sessionStorage.removeItem('sabor-express-mesa'); } catch { /* sem armazenamento */ }
      location.href = '/cardapio';
    });
  }

  function controleQuantidade(item) {
    const qtd = Carrinho.quantidadeDe(item.id);
    if (!qtd) return `<button type="button" class="botao pequeno" data-adicionar="${item.id}">Adicionar</button>`;
    return `<div class="contador" role="group" aria-label="Quantidade de ${esc(item.nome)}">
      <button type="button" data-menos="${item.id}" aria-label="Diminuir">−</button>
      <span>${qtd}</span>
      <button type="button" data-mais="${item.id}" aria-label="Aumentar">+</button></div>`;
  }
  function desenharControles() {
    $$('[data-controle]').forEach((el) => { el.innerHTML = controleQuantidade(itensPorId[el.dataset.controle]); });
  }

  try {
    const { funcionamento: f, categorias } = await api.get('/api/cardapio');
    $('#situacao').innerHTML = f.dentroDoHorario ? '<span class="selo sucesso">Aberto agora</span>'
      : f.modoDemonstracao ? '<span class="selo alerta">Modo demonstração</span>'
        : `<span class="selo erro">Fechado · abrimos às ${esc(f.abertura)}</span>`;
    categorias.forEach((c) => c.itens.forEach((i) => { itensPorId[i.id] = { ...i, icone: c.icone }; }));
    $('#chips').innerHTML = categorias.map((c) => `<a href="#cat-${c.id}">${esc(c.icone || '')} ${esc(c.nome)}</a>`).join('');
    $('#categorias').innerHTML = categorias.map((c) => `
      <section class="categoria" id="cat-${c.id}">
        <h2>${esc(c.icone || '')} ${esc(c.nome)} <span class="suave pequeno">· preparo médio ${c.tempo_preparo_min} min</span></h2>
        <div class="grade-itens">
          ${c.itens.map((i) => `
            <article class="item-cardapio ${i.foto ? 'com-foto' : ''}">
              ${i.foto ? `<img class="item-foto" src="${esc(i.foto)}" alt="${esc(i.nome)}" loading="lazy">`
                : `<div class="item-icone" aria-hidden="true">${esc(c.icone || '🍽️')}</div>`}
              <div class="item-corpo">
                <h3>${esc(i.nome)} ${i.destaque ? '<span class="selo alerta sem-ponto">Mais pedido</span>' : ''}</h3>
                <p class="suave pequeno">${esc(i.descricao || '')}</p>
                <div class="linha entre">
                  <strong class="preco">${formatar.reais(i.preco_centavos)}</strong>
                  <div data-controle="${i.id}"></div>
                </div>
              </div>
            </article>`).join('')}
        </div>
      </section>`).join('');
    desenharControles();
  } catch (e) {
    $('#categorias').innerHTML = `<div class="mensagem erro">Não foi possível carregar o cardápio: ${esc(e.message)}</div>`;
  }

  $('#categorias').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.adicionar) { Carrinho.adicionar(itensPorId[b.dataset.adicionar]); avisar('Item adicionado ao pedido'); }
    if (b.dataset.mais) Carrinho.alterar(Number(b.dataset.mais), +1);
    if (b.dataset.menos) Carrinho.alterar(Number(b.dataset.menos), -1);
  });

  function desenharCarrinho() {
    const itens = Carrinho.ler();
    const total = Carrinho.total();
    const qtd = Carrinho.contar();
    $('#carrinho-itens').innerHTML = itens.length
      ? itens.map((i) => `<li><span>${i.quantidade}× ${esc(i.nome)}</span><span>${formatar.reais(i.preco_centavos * i.quantidade)}</span></li>`).join('')
      : '<li class="suave">Seu pedido está vazio. Escolha os itens no cardápio.</li>';
    $('#carrinho-subtotal').textContent = formatar.reais(total);
    $('#botao-finalizar').classList.toggle('desativado', !itens.length);
    $('#barra-carrinho').classList.toggle('oculto', !itens.length);
    $('#barra-qtd').textContent = `${qtd} ${qtd === 1 ? 'item' : 'itens'}`;
    $('#barra-total').textContent = formatar.reais(total);
    if (Object.keys(itensPorId).length) desenharControles();
  }
  document.addEventListener('carrinho', desenharCarrinho);
  desenharCarrinho();
})();