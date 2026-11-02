// Painel da logística: despacho (RF11, RF12), status da entrega (RF13), estimativa (RF14), ocorrências (RF15) e SLA
(async function () {
  const usuario = await Layout.exigirEquipe('logistica');
  if (!usuario) return;

  const NOME_OCORRENCIA = { atraso: 'Atraso', endereco_nao_encontrado: 'Endereço não encontrado', avaria: 'Avaria',
    extravio: 'Extravio', cliente_ausente: 'Cliente ausente', outro: 'Outro' };
  let painel = null;
  let previsoes = {}; // previsão de chegada de cada entrega (RF14)

  // ---- Abas ----
  function abrirAba(nome) {
    $$('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
    $$('[role="tabpanel"]').forEach((s) => s.classList.toggle('oculto', s.id !== `aba-${nome}`));
    if (nome === 'sla') carregarSla();
    if (nome === 'mapa') carregarMapa();
    if (nome === 'entregadores') carregarEntregadores();
  }
  $$('.abas button').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));

  // Cronômetro com cor conforme o limite do SLA
  const cronometro = (desde, limiteMin, rotulo) =>
    `<div class="cronometro" data-inicio="${desde}" data-estimado="${limiteMin}"><span class="tempo">00:00</span>
       <span class="suave pequeno"> ${rotulo} (meta ${limiteMin} min)</span><div class="barra"><div></div></div></div>`;

  function cartao(p, conteudo) {
    return `
      <article class="cartao-pedido ${p.ocorrencias_abertas ? 'atrasado' : ''}">
        <div class="linha entre"><strong class="codigo-grande">${esc(p.codigo)}</strong>
          <span class="selo sem-ponto">${formatar.km(p.distancia_km)} · ~${p.entrega_estimada_min} min</span></div>
        <p class="pequeno"><strong>${esc(p.cliente_nome)}</strong> · ${esc(p.cliente_telefone || '')}<br>${esc(p.endereco_texto || '')}</p>
        <p class="pequeno suave">${p.itens_qtd} ${p.itens_qtd === 1 ? 'item' : 'itens'} · ${esc(FORMA_PAGAMENTO[p.forma_pagamento])}
          ${p.forma_pagamento === 'dinheiro' ? ` · cobrar ${formatar.reais(p.total_centavos)}${p.troco_para_centavos ? ` (troco p/ ${formatar.reais(p.troco_para_centavos)})` : ''}` : ''}</p>
        ${p.ocorrencias_abertas ? `<span class="selo erro">${p.ocorrencias_abertas} ocorrência(s) aberta(s)</span>` : ''}
        ${conteudo}
      </article>`;
  }

  async function carregar() {
    const [p, r] = await Promise.all([api.get('/api/logistica/painel'), api.get('/api/logistica/rastreamento')]);
    painel = p;
    previsoes = Object.fromEntries(r.entregas.map((e) => [e.codigo, e]));
    const { sla } = painel;
    $('#meta-aceite').textContent = sla.aceiteMin;
    $('#meta-entrega').textContent = sla.entregaMin;
    const livres = painel.entregadores.filter((e) => !e.ocupado);
    const ordenados = [...livres, ...painel.entregadores.filter((e) => e.ocupado)]; // livres primeiro
    const opcoes = ordenados.map((e) => `<option value="${e.id}">${esc(e.nome)}${e.ocupado ? ' (em entrega)' : ''} · ${esc(e.veiculo || '')}</option>`).join('');

    $('#col-prontos').innerHTML = painel.prontos.map((p) => cartao(p, `
      ${cronometro(p.pronto_em, sla.entregaMin, 'desde que ficou pronto')}
      ${previsao(p.codigo, 'Se despachar agora, chega por volta de')}
      <div class="linha">
        <select data-entregador="${p.codigo}" aria-label="Entregador" style="flex:1">${opcoes}</select>
        <button class="botao pequeno" data-despachar="${p.codigo}">Despachar</button>
      </div>`)).join('') || '<p class="vazio">Nenhum pedido pronto para entrega.</p>';
    $('#col-preparo').innerHTML = painel.em_preparo.length
      ? `<p class="pequeno suave" style="margin:.75rem .25rem 0">Em preparo na cozinha: ${painel.em_preparo.map((p) => esc(p.codigo)).join(', ')}</p>` : '';

    $('#col-despachados').innerHTML = painel.despachados.map((p) => cartao(p, `
      <p class="pequeno">🛵 <strong>${esc(p.entregador_nome)}</strong> · ${esc(p.entregador_telefone || '')}</p>
      ${cronometro(p.despachado_em, sla.aceiteMin, 'aguardando aceite')}
      <div class="linha">
        <button class="botao pequeno neutro" data-devolver="${p.codigo}">Recusou</button>
        <button class="botao pequeno" data-caminho="${p.codigo}">Aceitou e coletou</button>
      </div>`)).join('') || '<p class="vazio">Nenhum despacho aguardando aceite.</p>';

    $('#col-rota').innerHTML = painel.a_caminho.map((p) => cartao(p, `
      <p class="pequeno">🛵 <strong>${esc(p.entregador_nome)}</strong> saiu às ${formatar.hora(p.aceite_em)}</p>
      ${previsao(p.codigo, 'Chegada prevista')}
      ${cronometro(p.pronto_em, sla.entregaMin, 'desde que ficou pronto')}
      <div class="linha">
        <button class="botao pequeno neutro" data-ocorrencia="${p.codigo}">Ocorrência</button>
        <button class="botao pequeno sucesso" data-entregue="${p.codigo}">Entregue</button>
      </div>`)).join('') || '<p class="vazio">Nenhuma entrega em rota.</p>';

    $('#entregues').innerHTML = painel.entregues.map((p) => `<tr>
      <td>${esc(p.codigo)}</td><td>${esc(p.endereco_texto || '')}</td><td>${esc(p.entregador_nome || '—')}</td>
      <td class="num">${p.minutos_desde_pronto} min</td>
      <td>${p.minutos_desde_pronto <= sla.entregaMin ? '<span class="selo sucesso">Dentro</span>' : '<span class="selo erro">Fora</span>'}</td></tr>`).join('')
      || '<tr><td colspan="5" class="vazio">Nenhuma entrega concluída hoje.</td></tr>';

    $('#n-prontos').textContent = painel.prontos.length;
    $('#n-despachados').textContent = painel.despachados.length;
    $('#n-rota').textContent = painel.a_caminho.length;
    $('#n-ocorrencias').textContent = painel.ocorrencias.length;
    $('#resumo-topo').innerHTML = `<span class="selo info sem-ponto">${livres.length} de ${painel.entregadores.length} entregadores livres</span>
      ${painel.ocorrencias.length ? `<span class="selo erro">${painel.ocorrencias.length} ocorrência(s) aberta(s)</span>` : ''}`;

    // Ocorrências abertas (resposta em até 15 min pelo SLA)
    $('#lista-ocorrencias').innerHTML = painel.ocorrencias.map((o) => `
      <li>
        <div class="linha entre"><strong>${esc(o.codigo)} · ${esc(NOME_OCORRENCIA[o.tipo])}</strong>
          <span class="pequeno suave">aberta às ${formatar.hora(o.criado_em)} · origem: ${esc(o.origem)}</span></div>
        <p>${esc(o.descricao || '')}</p>
        ${cronometro(o.criado_em, sla.respostaIncidenteMin, 'em aberto')}
        <div class="linha"><input data-resolucao="${o.id}" placeholder="Como foi resolvida?" style="flex:1">
          <button class="botao pequeno" data-resolver="${o.id}">Resolver</button></div>
      </li>`).join('') || '<li class="vazio">Nenhuma ocorrência aberta.</li>';
    atualizarCronometros();
  }

  function atualizarCronometros() {
    const agora = Date.now();
    $$('.cronometro').forEach((c) => {
      const seg = Math.max(0, (agora - new Date(c.dataset.inicio)) / 1000);
      const limite = Number(c.dataset.estimado) * 60;
      c.querySelector('.tempo').textContent = `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(Math.floor(seg % 60)).padStart(2, '0')}`;
      c.querySelector('.barra div').style.width = `${Math.min(100, (seg / limite) * 100)}%`;
      c.classList.toggle('atrasado', seg > limite);
    });
  }
  setInterval(atualizarCronometros, 1000);

  // Linha com a previsão de chegada e a barra do trajeto
  function previsao(codigo, rotulo) {
    const e = previsoes[codigo];
    if (!e) return '';
    return `<div class="previsao ${e.atrasado ? 'atrasado' : ''}">
      <div class="linha entre pequeno"><span>${rotulo} <strong>${formatar.hora(e.chegada_prevista)}</strong></span>
        <span>${e.status === 'a_caminho' ? `faltam ~${e.minutos_restantes} min` : `~${e.minutos_restantes} min`}</span></div>
      ${e.status === 'a_caminho' ? `<div class="trajeto"><div style="width:${Math.round(e.progresso * 100)}%"></div></div>` : ''}
      ${e.atrasado ? '<span class="pequeno">⚠ Pode passar do prazo do SLA</span>' : ''}</div>`;
  }

  // ---- Acompanhamento no mapa (RF13 e RF14) ----
  const ESCALA = 48; // pixels por km no mapa
  const pt = (c) => ({ x: c.x * ESCALA, y: -c.y * ESCALA }); // norte para cima
  const corDe = (e) => (e.status !== 'a_caminho' ? 'aguardando' : e.atrasado ? 'atrasado' : 'no-prazo');

  async function carregarMapa() {
    const d = await api.get('/api/logistica/rastreamento');
    const taxas = { 3: 'R$ 5', 5: 'R$ 8', 8: 'R$ 12' };
    const aneis = [...d.faixas].reverse().map((km, i) => `
      <circle class="anel anel-${i}" r="${km * ESCALA}"></circle>
      <text class="rotulo-anel" x="0" y="${-km * ESCALA + 16}" text-anchor="middle">${km} km · ${taxas[km] || ''}</text>`).join('');
    const bairros = d.bairros.filter((b) => b.atende).map((b) => {
      const p = pt(b);
      return `<g class="bairro"><circle cx="${p.x}" cy="${p.y}" r="3"></circle><text x="${p.x + 6}" y="${p.y + 4}">${esc(b.nome)}</text></g>`;
    }).join('');
    const entregas = d.entregas.map((e) => {
      const destino = pt(e.destino);
      const pos = pt(e.posicao);
      const classe = corDe(e);
      return `<g class="entrega ${classe}">
        <line class="rota" x1="0" y1="0" x2="${destino.x}" y2="${destino.y}"></line>
        <line class="rota-feita" x1="0" y1="0" x2="${pos.x}" y2="${pos.y}"></line>
        <circle class="destino" cx="${destino.x}" cy="${destino.y}" r="7"></circle>
        <text class="rotulo-destino" x="${destino.x + 10}" y="${destino.y - 8}">${esc(e.codigo)}</text>
        ${e.status === 'a_caminho' ? `<g class="moto" transform="translate(${pos.x} ${pos.y})">
          <circle r="15"></circle><text y="6" text-anchor="middle">🛵</text>
          <title>${esc(e.codigo)} — ${esc(e.entregador?.nome || '')}: chega ${formatar.hora(e.chegada_prevista)}</title></g>` : ''}
      </g>`;
    }).join('');
    $('#mapa').innerHTML = `<rect x="-420" y="-420" width="840" height="840" class="fundo-mapa"></rect>
      ${aneis}${bairros}${entregas}
      <g class="restaurante"><circle r="18"></circle><text y="6" text-anchor="middle">🍽️</text></g>
      <text class="norte" x="390" y="-390" text-anchor="middle">N ↑</text>`;
    $('#mapa-atualizado').textContent = `Atualizado às ${formatar.hora(d.atualizado_em)}`;

    $('#lista-rastreamento').innerHTML = d.entregas.map((e) => `
      <article class="cartao-pedido ${e.atrasado ? 'atrasado' : ''}">
        <div class="linha entre"><strong class="codigo-grande">${esc(e.codigo)}</strong><span class="selo ${corDe(e) === 'atrasado' ? 'erro' : corDe(e) === 'no-prazo' ? 'sucesso' : ''}">
          ${e.status === 'a_caminho' ? 'Em rota' : e.status === 'despachado' ? 'Aguardando aceite' : 'Pronto no restaurante'}</span></div>
        <p class="pequeno">${e.entregador ? `🛵 <strong>${esc(e.entregador.nome)}</strong> · ${esc(e.entregador.telefone || '')} · ${esc(e.entregador.veiculo || '')}<br>` : ''}
          📍 ${esc(e.endereco || e.bairro)} (${formatar.km(e.distancia_km)})</p>
        ${e.status === 'a_caminho' ? `<div class="trajeto grande"><div style="width:${Math.round(e.progresso * 100)}%"></div></div>
          <div class="linha entre pequeno"><span>${Math.round(e.progresso * 100)}% do trajeto · ${formatar.km(e.km_restantes)} restantes</span>
            <span>${e.origem === 'rotalog' ? '📡 posição da RotaLog' : '⏱ posição estimada'}</span></div>` : ''}
        <div class="linha entre"><span>Chegada prevista: <strong>${formatar.hora(e.chegada_prevista)}</strong> (~${e.minutos_restantes} min)</span>
          <span class="pequeno ${e.atrasado ? 'texto-erro' : 'suave'}">Prazo SLA: ${formatar.hora(e.prazo_sla)}</span></div>
      </article>`).join('') || '<p class="vazio">Nenhuma entrega em andamento.</p>';
  }
  // Enquanto o mapa estiver aberto, atualiza a cada 10 segundos
  setInterval(() => { if (!$('#aba-mapa').classList.contains('oculto')) carregarMapa(); }, 10000);
  Layout.aoEvento('rastreamento', () => { if (!$('#aba-mapa').classList.contains('oculto')) carregarMapa(); carregar(); });

  // ---- Ações ----
  async function executarAcao(botao, url, corpo, mensagem) {
    botao.disabled = true;
    try { await api.post(url, corpo); avisar(mensagem); carregar(); } catch (e) { avisar(e.message, 'erro'); botao.disabled = false; }
  }
  const dialogo = $('#dialogo-ocorrencia');
  $('main').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.despachar) {
      const entregador = $(`[data-entregador="${d.despachar}"]`).value;
      executarAcao(b, `/api/logistica/pedidos/${d.despachar}/despachar`, { entregador_id: entregador }, `Pedido ${d.despachar} despachado`);
    }
    if (d.caminho) executarAcao(b, `/api/logistica/pedidos/${d.caminho}/a-caminho`, {}, `Pedido ${d.caminho} saiu para entrega`);
    if (d.devolver) executarAcao(b, `/api/logistica/pedidos/${d.devolver}/devolver`, {}, `Pedido ${d.devolver} voltou para a fila`);
    if (d.entregue) executarAcao(b, `/api/logistica/pedidos/${d.entregue}/entregue`, {}, `Pedido ${d.entregue} entregue`);
    if (d.resolver) {
      const resolucao = $(`[data-resolucao="${d.resolver}"]`).value;
      executarAcao(b, `/api/logistica/ocorrencias/${d.resolver}/resolver`, { resolucao }, 'Ocorrência resolvida');
    }
    if (d.ocorrencia) {
      $('#form-ocorrencia').reset();
      $('#oc-codigo').textContent = d.ocorrencia;
      dialogo.showModal();
    }
    if (d.ativo !== undefined) executarAcao(b, `/api/logistica/entregadores/${d.id}/ativo`, { ativo: d.ativo === '1' }, 'Entregador atualizado').then(carregarEntregadores);
  });
  dialogo.querySelector('[data-fechar]').addEventListener('click', () => dialogo.close());
  $('#form-ocorrencia').addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(e.target, async (dados) => {
      await api.post(`/api/logistica/pedidos/${$('#oc-codigo').textContent}/ocorrencias`, dados);
      dialogo.close();
      avisar('Ocorrência registrada — cliente avisado');
      carregar();
    });
  });

  // ---- Entregadores ----
  async function carregarEntregadores() {
    const lista = await api.get('/api/logistica/entregadores');
    $('#tabela-entregadores').innerHTML = lista.map((e) => `<tr class="${e.ativo ? '' : 'suave'}">
      <td>${esc(e.nome)}</td><td>${esc(e.documento || '')}</td><td>${esc(e.telefone || '')}</td><td>${esc(e.veiculo || '')}</td><td>${esc(e.empresa)}</td>
      <td><button class="botao neutro pequeno" data-id="${e.id}" data-ativo="${e.ativo ? 0 : 1}">${e.ativo ? 'Desativar' : 'Ativar'}</button></td></tr>`).join('');
  }
  $('#form-entregador').addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(e.target, async (dados) => {
      await api.post('/api/logistica/entregadores', dados);
      e.target.reset();
      avisar('Entregador cadastrado');
      carregarEntregadores();
      carregar();
    });
  });

  // ---- SLA ----
  const SITUACAO = { cumprido: '<span class="selo sucesso">Cumprido</span>', descumprido: '<span class="selo erro">Descumprido</span>', sem_dados: '<span class="selo">Sem dados</span>' };
  async function carregarSla() {
    const r = await api.get(`/api/logistica/sla?dias=${$('#periodo').value}`);
    $('#tabela-sla').innerHTML = r.indicadores.map((i) => `<tr>
      <td><strong>${esc(i.nome)}</strong>${i.abertas ? `<br><span class="pequeno suave">${i.abertas} em aberto</span>` : ''}</td>
      <td>${esc(i.meta)}</td>
      <td class="num">${i.valor == null ? '—' : `${String(i.valor).replace('.', ',')}${i.unidade === '%' ? '%' : ` ${i.unidade}`}`}</td>
      <td class="num">${i.dentro == null ? '—' : `${String(i.dentro).replace('.', ',')}%`}</td>
      <td class="num">${i.amostra}</td><td>${SITUACAO[i.situacao]}</td></tr>`).join('');
    $('#penalidade').textContent = `${r.pedidosDeEntrega} pedidos de entrega no período. ${r.penalidade}`;
    if (usuario.perfil === 'gerente') {
      const int = await api.get('/api/logistica/integracao');
      $('#integracao').classList.remove('oculto');
      $('#integracao').innerHTML = `<h3>Integração com a RotaLog</h3>
        <p class="pequeno">A RotaLog pode enviar as atualizações automaticamente (aceite, entrega e ocorrências) para:</p>
        <p class="pequeno"><code>POST ${esc(int.endpoint)}</code> com o cabeçalho <code>${esc(int.cabecalho)}: ${esc(int.chave)}</code></p>`;
    }
  }
  $('#periodo').addEventListener('change', carregarSla);

  Layout.aoEvento('pedido', () => { carregar(); if (!$('#aba-mapa').classList.contains('oculto')) carregarMapa(); });
  setInterval(carregar, 60000);
  carregar();
})();