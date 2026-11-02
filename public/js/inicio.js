// Página inicial: situação do restaurante, cardápio (RF01), carrinho (RF02) e taxas de entrega
(async function () {
  let itensPorId = {};

  // ---- Situação, faixas de entrega e consulta por bairro ----
  try {
    const status = await api.get('/api/status');
    const f = status.funcionamento;
    let selo;
    if (f.dentroDoHorario) selo = '<span class="selo sucesso">Aberto agora</span>';
    else if (f.modoDemonstracao) selo = '<span class="selo alerta">Modo demonstração (fora do horário)</span>';
    else selo = '<span class="selo erro">Fechado no momento</span>';
    $('#situacao').innerHTML = `${selo}<span class="suave">Funcionamos das ${esc(f.abertura)} às ${esc(f.fechamento)}</span>`;
    $('#rodape-endereco').textContent = `${status.restaurante.nome} · ${status.restaurante.endereco} · ${status.restaurante.telefone}`;

    $('#faixas').innerHTML = status.faixasEntrega
      .map((x) => `<tr><td>${esc(x.rotulo)}</td><td class="num">${formatar.reais(x.taxaCentavos)}</td></tr>`)
      .join('') + `<tr><td>Acima de ${status.restaurante.raioKm} km</td><td class="num">Não entregamos</td></tr>`;

    const bairros = await api.get('/api/bairros');
    $('#bairro').innerHTML += bairros.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join('');
    $('#bairro').addEventListener('change', (e) => {
      const b = bairros.find((x) => String(x.id) === e.target.value);
      const caixa = $('#resultado-taxa');
      if (!b) { caixa.classList.add('oculto'); return; }
      caixa.classList.remove('oculto', 'erro', 'info', 'sucesso');
      if (b.atende) {
        caixa.classList.add('sucesso');
        caixa.textContent = `Entregamos em ${b.nome} (${formatar.km(b.distancia_km)}). Taxa: ${formatar.reais(b.taxa_centavos)}.`;
      } else {
        caixa.classList.add('erro');
        caixa.textContent = `${b.nome} fica a ${formatar.km(b.distancia_km)}, fora da nossa área de entrega. Você pode retirar no balcão!`;
      }
    });
  } catch (e) {
    $('#situacao').innerHTML = '<span class="selo erro">Não foi possível conectar ao servidor</span>';
    console.error(e);
  }

  // ---- Cardápio ----
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
    const { categorias } = await api.get('/api/cardapio');
    categorias.forEach((c) => c.itens.forEach((i) => { itensPorId[i.id] = { ...i, icone: c.icone }; }));
    $('#chips').innerHTML = categorias.map((c) => `<a href="#cat-${c.id}">${esc(c.icone || '')} ${esc(c.nome)}</a>`).join('');
    $('#categorias').innerHTML = categorias.map((c) => `
      <section class="categoria" id="cat-${c.id}">
        <h3>${esc(c.icone || '')} ${esc(c.nome)} <span class="suave pequeno">· preparo médio ${c.tempo_preparo_min} min</span></h3>
        <div class="grade-itens">
          ${c.itens.map((i) => `
            <article class="item-cardapio">
              <div class="item-icone" aria-hidden="true">${esc(c.icone || '🍽️')}</div>
              <div class="item-corpo">
                <h4>${esc(i.nome)} ${i.destaque ? '<span class="selo alerta sem-ponto">Mais pedido</span>' : ''}</h4>
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

  // Delegação de cliques nos botões de quantidade
  $('#categorias').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.adicionar) { Carrinho.adicionar(itensPorId[b.dataset.adicionar]); avisar('Item adicionado ao pedido'); }
    if (b.dataset.mais) Carrinho.alterar(Number(b.dataset.mais), +1);
    if (b.dataset.menos) Carrinho.alterar(Number(b.dataset.menos), -1);
  });

  // ---- Resumo do carrinho ----
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