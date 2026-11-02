// Tela da cozinha: fila em tempo real (RF07), mudança de status (RF08) e tempo de preparo (RF10)
(async function () {
  const usuario = await Layout.exigirEquipe('cozinha', 'atendente');
  if (!usuario) return;
  const podeAlterar = ['cozinha', 'gerente'].includes(usuario.perfil); // o atendente só acompanha

  const ICONE = { entrega: '🛵', retirada: '🥡', salao: '🍽️' };
  const mmss = (seg) => `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(Math.floor(seg % 60)).padStart(2, '0')}`;
  let dados = { fila: [] };

  function cartao(p, botao) {
    return `
      <article class="cartao-pedido cozinha-cartao" data-pedido="${p.codigo}">
        <div class="linha entre">
          <strong class="codigo-grande">${esc(p.codigo)}</strong>
          <span class="selo sem-ponto">${ICONE[p.modalidade]} ${esc(p.modalidade === 'salao' ? `Mesa ${p.mesa}` : MODALIDADE[p.modalidade])}</span>
        </div>
        ${p.status === 'em_preparo' ? `
          <div class="cronometro" data-inicio="${p.preparo_inicio_em}" data-estimado="${p.preparo_estimado_min}">
            <span class="tempo">00:00</span><span class="suave pequeno"> / previsto ${p.preparo_estimado_min} min</span>
            <div class="barra"><div></div></div>
          </div>` : `<p class="suave pequeno">Confirmado às ${formatar.hora(p.confirmado_em)} · previsto ${p.preparo_estimado_min} min</p>`}
        <ul class="itens-cozinha">
          ${p.itens.map((i) => `<li><span class="qtd">${i.quantidade}×</span> ${esc(i.nome)}
            ${i.observacao ? `<div class="obs">⚠ ${esc(i.observacao)}</div>` : ''}</li>`).join('')}
        </ul>
        ${p.observacoes ? `<p class="obs">📝 ${esc(p.observacoes)}</p>` : ''}
        ${podeAlterar ? botao : ''}
      </article>`;
  }

  async function carregar() {
    dados = await api.get('/api/equipe/cozinha');
    const fila = dados.fila.filter((p) => p.status === 'recebido');
    const preparo = dados.fila.filter((p) => p.status === 'em_preparo');
    $('#col-fila').innerHTML = fila.map((p) => cartao(p,
      `<button class="botao bloco" data-acao="em_preparo" data-codigo="${p.codigo}">▶ Iniciar preparo</button>`)).join('')
      || '<p class="vazio">Nenhum pedido na fila.</p>';
    $('#col-preparo').innerHTML = preparo.map((p) => cartao(p,
      `<button class="botao bloco sucesso" data-acao="pronto" data-codigo="${p.codigo}">✓ Pedido pronto</button>`)).join('')
      || '<p class="vazio">Nada em preparo.</p>';
    $('#col-prontos').innerHTML = dados.prontos.map((p) => `
      <div class="cartao-pedido compacto">
        <div class="linha entre"><strong>${esc(p.codigo)}</strong><span class="pequeno suave">${formatar.hora(p.pronto_em)}</span></div>
        <span class="pequeno">${p.tempo_preparo_seg != null ? `Preparo: ${mmss(p.tempo_preparo_seg)}` : ''}
          ${p.tempo_preparo_seg > p.preparo_estimado_min * 60 ? '<span class="selo erro sem-ponto">acima do previsto</span>' : ''}</span>
      </div>`).join('') || '<p class="vazio">Nenhum pedido pronto hoje.</p>';
    $('#n-fila').textContent = fila.length;
    $('#n-preparo').textContent = preparo.length;

    const ind = dados.indicadores;
    $('#indicadores').innerHTML = `
      <div class="indicador"><span>A preparar</span><strong>${ind.aguardando}</strong></div>
      <div class="indicador"><span>Em preparo</span><strong>${ind.em_preparo}</strong></div>
      <div class="indicador"><span>Preparados hoje</span><strong>${ind.preparados_hoje}</strong></div>
      <div class="indicador"><span>Tempo médio de preparo</span><strong>${ind.tempo_medio_min != null ? `${String(ind.tempo_medio_min).replace('.', ',')} min` : '—'}</strong></div>
      <div class="indicador ${ind.fora_do_prazo ? 'alerta' : ''}"><span>Acima do previsto</span><strong>${ind.fora_do_prazo}</strong></div>`;
    atualizarCronometros();
  }

  // Cronômetro de cada pedido em preparo (fica vermelho quando passa do tempo previsto)
  function atualizarCronometros() {
    const agora = Date.now();
    $$('.cronometro').forEach((c) => {
      const seg = Math.max(0, (agora - new Date(c.dataset.inicio)) / 1000);
      const limite = Number(c.dataset.estimado) * 60;
      c.querySelector('.tempo').textContent = mmss(seg);
      c.querySelector('.barra div').style.width = `${Math.min(100, (seg / limite) * 100)}%`;
      c.classList.toggle('atrasado', seg > limite);
      c.closest('.cartao-pedido').classList.toggle('atrasado', seg > limite);
    });
    $('#relogio').textContent = new Date().toLocaleTimeString('pt-BR');
  }
  setInterval(atualizarCronometros, 1000);

  // RF08: alterar status (recebido → em preparo → pronto)
  $('main').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    b.disabled = true;
    try {
      await api.post(`/api/equipe/pedidos/${b.dataset.codigo}/status`, { status: b.dataset.acao });
      avisar(b.dataset.acao === 'pronto' ? `Pedido ${b.dataset.codigo} pronto — cliente notificado` : `Preparo do ${b.dataset.codigo} iniciado`);
      carregar();
    } catch (err) { avisar(err.message, 'erro'); b.disabled = false; }
  });

  Layout.aoEvento('pedido', () => carregar());
  setInterval(carregar, 60000);
  carregar();
})();