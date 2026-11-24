// Acompanhamento da entrega pelo cliente (tela do pedido): mapa real com o entregador a caminho.
// Usa o mesmo mapa do OpenStreetMap da logística: "peças" (tiles) de 256 px + desenho em SVG por cima.
(function () {
  const TILE = 256;
  const codigo = new URLSearchParams(location.search).get('codigo');
  let ultimo = null;   // últimos dados recebidos do servidor
  let fundoAtual = ''; // evita baixar as peças do mapa de novo a cada atualização

  // latitude/longitude → pixel no "mundo" do zoom z (projeção Web Mercator)
  function projetar(lat, lng, z) {
    const total = TILE * 2 ** z;
    const seno = Math.sin((lat * Math.PI) / 180);
    return { x: ((lng + 180) / 360) * total, y: (0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI)) * total };
  }

  // Maior zoom em que o restaurante e o destino cabem juntos na tela, com folga nas bordas
  function escolherZoom(a, b, W, H) {
    for (let z = 16; z > 11; z -= 1) {
      const pa = projetar(a.lat, a.lng, z);
      const pb = projetar(b.lat, b.lng, z);
      if (Math.abs(pa.x - pb.x) < W - 120 && Math.abs(pa.y - pb.y) < H - 120) return z;
    }
    return 11;
  }

  // Cria a área do mapa logo depois das etapas do pedido
  function criarSecao() {
    const sec = document.createElement('section');
    sec.className = 'cartao acompanhar-entrega';
    sec.id = 'acompanhar-entrega';
    sec.setAttribute('aria-labelledby', 'titulo-acompanhar');
    sec.innerHTML = `
      <div class="linha entre">
        <h2 id="titulo-acompanhar">Onde está meu pedido</h2>
        <span class="pequeno suave" id="rastreio-atualizado"></span>
      </div>
      <p id="rastreio-resumo" class="rastreio-resumo" role="status" aria-live="polite"></p>
      <div class="trajeto grande" aria-hidden="true"><div id="rastreio-barra" style="width:0%"></div></div>
      <div class="mapa-real mapa-cliente" id="mapa-cliente" role="img" aria-label="Mapa com o trajeto do restaurante até o seu endereço">
        <div class="mapa-camada" id="mapa-cliente-fundo"></div>
        <svg class="mapa-camada" id="mapa-cliente-desenho"></svg>
        <a class="mapa-creditos" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© colaboradores do OpenStreetMap</a>
      </div>
      <p class="pequeno suave" id="rastreio-origem"></p>`;
    const depois = $('#conteudo .etapas') || $('#conteudo .linha');
    const avisos = [...$$('#conteudo > .mensagem')].at(-1);
    (avisos || depois).insertAdjacentElement('afterend', sec);
    fundoAtual = '';
    return sec;
  }

  function desenharMapa(d) {
    const caixa = $('#mapa-cliente');
    const W = caixa.clientWidth;
    const H = caixa.clientHeight;
    if (!W) return;
    const zoom = escolherZoom(d.restaurante, d.destino, W, H);
    const a = projetar(d.restaurante.lat, d.restaurante.lng, zoom);
    const b = projetar(d.destino.lat, d.destino.lng, zoom);
    const esq = (a.x + b.x) / 2 - W / 2; // centro entre o restaurante e o destino
    const topo = (a.y + b.y) / 2 - H / 2;
    const pt = (c) => { const p = projetar(c.lat, c.lng, zoom); return { x: +(p.x - esq).toFixed(1), y: +(p.y - topo).toFixed(1) }; };

    const chave = `${zoom}|${W}|${H}|${d.destino.lat}`;
    if (chave !== fundoAtual) {
      fundoAtual = chave;
      const n = 2 ** zoom;
      const pecas = [];
      for (let tx = Math.floor(esq / TILE); tx <= Math.floor((esq + W) / TILE); tx += 1) {
        for (let ty = Math.floor(topo / TILE); ty <= Math.floor((topo + H) / TILE); ty += 1) {
          if (ty < 0 || ty >= n) continue;
          pecas.push(`<img src="https://tile.openstreetmap.org/${zoom}/${((tx % n) + n) % n}/${ty}.png" alt="" draggable="false"
            referrerpolicy="strict-origin-when-cross-origin" style="left:${Math.round(tx * TILE - esq)}px;top:${Math.round(ty * TILE - topo)}px">`);
        }
      }
      $('#mapa-cliente-fundo').innerHTML = pecas.join('');
      $$('#mapa-cliente-fundo img').forEach((img) => img.addEventListener('error', () => img.remove())); // sem internet: fica só o desenho
    }

    const r = pt(d.restaurante);
    const destino = pt(d.destino);
    const pos = pt(d.posicao);
    const emRota = d.status === 'a_caminho';
    const svg = $('#mapa-cliente-desenho');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <line class="rota" x1="${r.x}" y1="${r.y}" x2="${destino.x}" y2="${destino.y}"></line>
      ${emRota ? `<line class="rota-feita" x1="${r.x}" y1="${r.y}" x2="${pos.x}" y2="${pos.y}"></line>` : ''}
      <g class="casa" transform="translate(${destino.x} ${destino.y})"><circle r="17"></circle><text y="6" text-anchor="middle">🏠</text>
        <title>Seu endereço (${esc(d.bairro)})</title></g>
      <g class="restaurante" transform="translate(${r.x} ${r.y})"><circle r="17"></circle><text y="6" text-anchor="middle">🍽️</text>
        <title>${esc(d.restaurante.nome)}</title></g>
      ${emRota ? `<g class="moto" transform="translate(${pos.x} ${pos.y})"><circle r="17"></circle><text y="6" text-anchor="middle">🛵</text>
        <title>Entregador a caminho</title></g>` : ''}`;
  }

  function desenhar(d) {
    const sec = $('#acompanhar-entrega') || criarSecao();
    const emRota = d.status === 'a_caminho';
    const pct = Math.round((d.progresso || 0) * 100);
    $('#rastreio-resumo').innerHTML = emRota
      ? `🛵 <strong>${esc(d.entregador?.nome || 'O entregador')}</strong> está a caminho. Chega por volta de
         <strong>${formatar.hora(d.chegada_prevista)}</strong> (cerca de ${d.minutos_restantes} min · ${formatar.km(d.km_restantes)} restantes).`
      : `Seu pedido está no restaurante esperando o entregador. Previsão de chegada: <strong>${formatar.hora(d.chegada_prevista)}</strong>.`;
    $('#rastreio-barra').style.width = `${emRota ? pct : 0}%`;
    $('#rastreio-atualizado').textContent = `Atualizado às ${formatar.hora(d.atualizado_em)}`;
    $('#rastreio-origem').textContent = emRota
      ? (d.origem === 'rotalog' ? '📡 Posição enviada pela empresa de entregas (RotaLog).' : '⏱ Posição estimada pelo tempo desde a saída do entregador.')
        + ' O ponto da casa é aproximado (centro do bairro).'
      : 'O ponto da casa é aproximado (centro do bairro).';
    sec.classList.remove('oculto');
    desenharMapa(d);
  }

  async function atualizar() {
    try {
      const d = await api.get(`/api/pedidos/${encodeURIComponent(codigo)}/rastreio`);
      ultimo = d.ativo ? d : null;
      if (d.ativo) desenhar(d);
      else $('#acompanhar-entrega')?.remove();
    } catch { /* sem conexão: tenta de novo na próxima atualização */ }
  }

  // pedido.js redesenha a tela a cada mudança de status: o mapa volta junto
  document.addEventListener('pedido-desenhado', (ev) => {
    const p = ev.detail;
    if (p.modalidade !== 'entrega' || !['pronto', 'despachado', 'a_caminho'].includes(p.status)) return;
    if (ultimo) desenhar(ultimo); // mostra na hora o último dado, enquanto busca o novo
    atualizar();
  });

  // A posição muda com o tempo: atualiza a cada 15 segundos e quando a RotaLog envia a posição
  setInterval(() => { if ($('#acompanhar-entrega')) atualizar(); }, 15000);
  Layout.aoEvento?.('rastreamento', (dados) => { if (dados.codigo === codigo) atualizar(); });
  let espera;
  window.addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(() => ultimo && desenharMapa(ultimo), 200); });
})();