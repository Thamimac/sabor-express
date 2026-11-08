// Página inicial: banner rotativo, pratos da casa com foto, situação do restaurante, contato e consulta de taxa por bairro
(async function () {
  // Foto que não existe (ainda não foi colocada em public/img): esconde e mostra a cor de fundo da marca
  $$('img.foto-fundo').forEach((img) => {
    const esconder = () => img.classList.add('oculto');
    img.addEventListener('error', esconder);
    if (img.complete && !img.naturalWidth) esconder();
  });

  // ---- Banner rotativo (troca sozinho a cada 6 segundos; para quando o mouse está em cima) ----
  const slides = $$('.banner .slide');
  const pontos = $('.banner-pontos');
  let atual = 0;
  pontos.innerHTML = slides.map((_, i) => `<button type="button" aria-label="Destaque ${i + 1}"></button>`).join('');
  function mostrar(n) {
    atual = (n + slides.length) % slides.length;
    slides.forEach((s, i) => { s.classList.toggle('ativo', i === atual); s.setAttribute('aria-hidden', String(i !== atual)); });
    $$('button', pontos).forEach((b, i) => b.setAttribute('aria-current', String(i === atual)));
  }
  $('.banner-seta.anterior').addEventListener('click', () => mostrar(atual - 1));
  $('.banner-seta.proximo').addEventListener('click', () => mostrar(atual + 1));
  $$('button', pontos).forEach((b, i) => b.addEventListener('click', () => mostrar(i)));
  mostrar(0);
    const semAnimacao = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pausado = false;      // mouse ou teclado em cima do banner
  let parado = semAnimacao; // a pessoa clicou em "Pausar" (ou pediu menos animação no sistema)
  const botaoPausa = $('.banner-pausa');
  function atualizarPausa() {
    botaoPausa.textContent = parado ? 'Continuar' : 'Pausar';
    botaoPausa.setAttribute('aria-pressed', String(parado));
    botaoPausa.setAttribute('aria-label', parado ? 'Continuar a troca automática dos destaques' : 'Pausar a troca automática dos destaques');
  }
  botaoPausa.addEventListener('click', () => { parado = !parado; atualizarPausa(); });
  atualizarPausa();
  $('.banner').addEventListener('mouseenter', () => { pausado = true; });
  $('.banner').addEventListener('mouseleave', () => { pausado = false; });
  $('.banner').addEventListener('focusin', () => { pausado = true; });
  $('.banner').addEventListener('focusout', () => { pausado = false; });
  setInterval(() => { if (!pausado && !parado && !document.hidden) mostrar(atual + 1); }, 6000);
  // ---- Pratos da casa: primeiro os que têm foto e os mais pedidos (até 6) ----
  
  api.get('/api/cardapio').then(({ categorias }) => {
    const todos = categorias.flatMap((c) => c.itens);
    const pontos = (i) => (i.foto ? 2 : 0) + (i.destaque ? 1 : 0);
    const escolhidos = [...todos].sort((a, b) => pontos(b) - pontos(a)).slice(0, 6);
    $('#pratos').innerHTML = escolhidos.map((i) => `
      <a class="prato" href="/cardapio">
        <div class="prato-foto">${i.foto ? `<img src="${esc(i.foto)}" alt="${esc(i.nome)}" loading="lazy">` : '<img class="sem-foto" src="/img/logo.svg" alt="">'}</div>
        <div class="prato-info"><strong>${esc(i.nome)}</strong><span>${formatar.reais(i.preco_centavos)}</span></div>
      </a>`).join('');
  }).catch(() => { $('#pratos').innerHTML = '<p class="suave">Não foi possível carregar os pratos agora.</p>'; });

  // ---- Situação, contato e taxa de entrega ----
  try {
    const status = await api.get('/api/status');
    const f = status.funcionamento;
    let selo;
    if (f.dentroDoHorario) selo = '<span class="selo sucesso">Aberto agora</span>';
    else if (f.modoDemonstracao) selo = '<span class="selo alerta">Modo demonstração</span>';
    else selo = '<span class="selo erro">Fechado agora</span>';
    $('#situacao').innerHTML = `${selo} Funcionamos todos os dias, das ${esc(f.abertura)} às ${esc(f.fechamento)}.`;
    $('#horario').textContent = `${f.abertura} às ${f.fechamento}`;
    $('#endereco').textContent = status.restaurante.endereco;
    $('#telefone').textContent = status.restaurante.telefone;
    $('#rodape-endereco').innerHTML = `${esc(status.restaurante.endereco)}<br>${esc(status.restaurante.telefone)}`;

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
        caixa.textContent = `${b.nome} fica a ${formatar.km(b.distancia_km)}, fora da nossa área de entrega. Você pode retirar no balcão.`;
      }
    });
  } catch (e) {
    $('#situacao').innerHTML = '<span class="selo erro">Sem conexão com o servidor</span>';
    console.error(e);
  }
})();