// Painel financeiro: resumo, faturamento (RF18), pagamentos e estorno (RF19), conciliação (RF20) e fiscal (regra 7)
(async function () {
  const usuario = await Layout.exigirEquipe('financeiro');
  if (!usuario) return;

  const PAGAMENTO = { pendente: ['Pendente', 'alerta'], aprovado: ['Aprovado', 'sucesso'], recusado: ['Recusado', 'erro'], estornado: ['Estornado', 'info'], cancelado: ['Cancelado', ''] };
  const seloPg = (s) => `<span class="selo ${PAGAMENTO[s]?.[1] || ''}">${esc(PAGAMENTO[s]?.[0] || s)}</span>`;
  const NF = { pendente_emissao: ['Pendente de emissão', 'alerta'], emitida: ['Emitida', 'sucesso'], cancelada: ['Cancelada', 'erro'] };
  const indicador = (rotulo, valor, classe = '') => `<div class="indicador ${classe}"><span>${rotulo}</span><strong>${valor}</strong></div>`;
  const hoje = new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD no fuso do navegador
  const diasAtras = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA');
  const consulta = (form) => new URLSearchParams(Object.entries(lerFormulario(form)).filter(([, v]) => v)).toString();

  // Datas padrão dos filtros
  $('#f-inicio').value = diasAtras(29); $('#f-fim').value = hoje;
  $('#p-inicio').value = diasAtras(6); $('#p-fim').value = hoje;
  $('#c-inicio').value = diasAtras(6); $('#c-fim').value = hoje;

  // ---- Abas ----
  const carregadores = { resumo: carregarResumo, faturamento: carregarFaturamento, pagamentos: carregarPagamentos, conciliacao: carregarConciliacao, fiscal: carregarFiscal };
  let abaAtual = 'resumo';
  function abrirAba(nome) {
    abaAtual = nome;
    $$('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
    $$('[role="tabpanel"]').forEach((s) => s.classList.toggle('oculto', s.id !== `aba-${nome}`));
    carregadores[nome]();
  }
  $$('.abas button').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));

  // ---- Resumo do dia ----
  async function carregarResumo() {
    const r = await api.get('/api/financeiro/resumo');
    const h = r.hoje;
    $('#ind-resumo').innerHTML = [
      indicador('Faturamento líquido hoje', formatar.reais(h.liquido)),
      indicador('Pagamentos aprovados', h.pedidos - h.estornos),
      indicador('Ticket médio', formatar.reais(h.ticketMedio)),
      indicador('Estornado hoje', formatar.reais(h.estornado), h.estornado ? 'alerta' : ''),
      indicador('A receber (pendentes)', `${r.pendentes.n} · ${formatar.reais(r.pendentes.v)}`),
      indicador('Divergências hoje', r.conciliacaoHoje.divergentes, r.conciliacaoHoje.divergentes ? 'alerta' : ''),
      indicador('Notas pendentes', r.fiscalPendente),
    ].join('');
    const linhas = (obj, rotulos) => {
      const total = Object.values(obj).reduce((s, v) => s + v, 0);
      return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(rotulos[k] || k)}</td>
        <td class="num">${formatar.reais(v)}</td><td class="num">${total ? Math.round((v / total) * 100) : 0}%</td></tr>`).join('')
        || '<tr><td class="vazio">Sem pagamentos hoje.</td></tr>';
    };
    $('#por-forma').innerHTML = linhas(h.porForma, FORMA_PAGAMENTO);
    $('#por-modalidade').innerHTML = linhas(h.porModalidade, MODALIDADE);
  }

  // ---- RF18: faturamento diário, semanal e mensal ----
  const ROTULO_PERIODO = {
    diario: (p) => new Date(`${p}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
    semanal: (p) => `Semana de ${new Date(`${p}T12:00:00`).toLocaleDateString('pt-BR')}`,
    mensal: (p) => new Date(`${p}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
  async function carregarFaturamento() {
    const q = consulta($('#form-faturamento'));
    $('#exportar-faturamento').href = `/api/financeiro/relatorio?${q}&formato=csv`;
    const r = await api.get(`/api/financeiro/relatorio?${q}`);
    const linha = (rotulo, g, tag = 'td') => `<tr><${tag}>${rotulo}</${tag}><${tag} class="num">${g.pedidos}</${tag}><${tag} class="num">${formatar.reais(g.bruto)}</${tag}>
      <${tag} class="num">${formatar.reais(g.estornado)}</${tag}><${tag} class="num"><strong>${formatar.reais(g.liquido)}</strong></${tag}><${tag} class="num">${formatar.reais(g.ticketMedio)}</${tag}></tr>`;
    $('#tabela-faturamento').innerHTML = r.linhas.map((l) => linha(esc(ROTULO_PERIODO[r.agrupamento](l.periodo)), l)).join('')
      || '<tr><td colspan="6" class="vazio">Nenhum pagamento no período.</td></tr>';
    $('#total-faturamento').innerHTML = linha('<strong>Total</strong>', r.total, 'th');
  }
  $('#form-faturamento').addEventListener('submit', (e) => { e.preventDefault(); carregarFaturamento(); });

  // ---- RF19: pagamentos ----
  async function carregarPagamentos() {
    const lista = await api.get(`/api/financeiro/pagamentos?${consulta($('#form-pagamentos'))}`);
    $('#tabela-pagamentos').innerHTML = lista.map((p) => `<tr>
      <td><a href="/pedido?codigo=${encodeURIComponent(p.codigo)}">${esc(p.codigo)}</a></td><td>${formatar.dataHora(p.criado_em)}</td>
      <td>${esc(p.cliente_nome)}</td><td>${esc(FORMA_PAGAMENTO[p.forma])}${p.cartao_final ? ` · final ${esc(p.cartao_final)}` : ''}</td>
      <td class="num">${formatar.reais(p.valor_centavos)}</td>
      <td>${seloPg(p.status)}${p.motivo ? `<br><small class="suave">${esc(p.motivo)}</small>` : ''}</td><td>${seloStatus(p.pedido_status)}</td>
      <td>${p.status === 'aprovado' ? `<button class="botao neutro pequeno" data-estornar="${p.codigo}">Estornar</button>` : ''}
          ${['pendente', 'recusado'].includes(p.status) && p.pedido_status !== 'cancelado' ? `<button class="botao neutro pequeno" data-receber="${p.codigo}">Registrar recebimento</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="8" class="vazio">Nenhum pagamento encontrado.</td></tr>';
  }
  $('#form-pagamentos').addEventListener('submit', (e) => { e.preventDefault(); carregarPagamentos(); });

  // ---- RF20: conciliação ----
  async function carregarConciliacao() {
    const r = await api.get(`/api/financeiro/conciliacao?${consulta($('#form-conciliacao'))}`);
    const s = r.resumo;
    $('#ind-conciliacao').innerHTML = [
      indicador('Pedidos no período', s.pedidos),
      indicador('Conciliados', s.conciliados),
      indicador('Divergentes', s.divergentes, s.divergentes ? 'alerta' : ''),
      indicador('Em andamento', s.emAndamento),
      indicador('Vendido (entregues)', formatar.reais(s.vendidoEntregue)),
      indicador('Recebido (entregues)', formatar.reais(s.recebidoDeEntregues)),
      indicador('Diferença', formatar.reais(s.diferenca), s.diferenca ? 'alerta' : ''),
      indicador('Recebido antecipado', formatar.reais(s.recebidoAntecipado)),
    ].join('');
    $('#tabela-divergencias').innerHTML = r.divergencias.map((d) => `<tr>
      <td><a href="/pedido?codigo=${encodeURIComponent(d.codigo)}">${esc(d.codigo)}</a></td><td>${formatar.dataHora(d.criado_em)}</td><td>${esc(d.cliente_nome)}</td>
      <td class="num">${formatar.reais(d.total_centavos)}</td><td>${seloStatus(d.pedido_status)}</td><td>${seloPg(d.pagamento_status)}</td>
      <td><strong>${esc(d.problema)}</strong></td>
      <td>${d.pedido_status === 'cancelado' ? `<button class="botao neutro pequeno" data-estornar="${d.codigo}">Estornar</button>`
        : `<button class="botao neutro pequeno" data-receber="${d.codigo}">Registrar recebimento</button>`}</td></tr>`).join('')
      || '<tr><td colspan="8" class="vazio">✓ Nenhuma divergência: pedidos e pagamentos conferem.</td></tr>';
  }
  $('#form-conciliacao').addEventListener('submit', (e) => { e.preventDefault(); carregarConciliacao(); });

  // ---- Regra de domínio 7: fiscal ----
  async function carregarFiscal() {
    const lista = await api.get('/api/financeiro/fiscal');
    $('#tabela-fiscal').innerHTML = lista.map((t) => `<tr>
      <td>${formatar.dataHora(t.criado_em)}</td><td>${esc(t.codigo)}</td><td>${esc(t.cliente_nome)}</td><td>${esc(FORMA_PAGAMENTO[t.forma])}</td>
      <td class="num">${formatar.reais(t.valor_centavos)}</td><td><span class="selo ${NF[t.status_nf][1]}">${NF[t.status_nf][0]}</span></td>
      <td>${esc(t.numero_nf || '—')}</td>
      <td>${t.status_nf === 'pendente_emissao' ? `<button class="botao neutro pequeno" data-nf="${t.id}">Registrar nota</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="8" class="vazio">Nenhuma transação no período.</td></tr>';
  }

  // ---- Ações ----
  $('main').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.estornar) {
        const motivo = prompt(`Motivo do estorno do pedido ${b.dataset.estornar}:`);
        if (!motivo) return;
        await api.post(`/api/financeiro/pagamentos/${b.dataset.estornar}/estornar`, { motivo });
        avisar('Pagamento estornado');
      } else if (b.dataset.receber) {
        if (!confirm(`Registrar o recebimento presencial do pedido ${b.dataset.receber}?`)) return;
        await api.post(`/api/financeiro/pagamentos/${b.dataset.receber}/receber`);
        avisar('Recebimento registrado');
      } else if (b.dataset.nf) {
        const numero = prompt('Número da nota fiscal emitida pela contabilidade:', 'NFC-e ');
        if (!numero) return;
        await api.post(`/api/financeiro/fiscal/${b.dataset.nf}/emitida`, { numero_nf: numero });
        avisar('Nota registrada');
      } else return;
      carregadores[abaAtual]();
    } catch (err) { avisar(err.message, 'erro'); }
  });

  Layout.aoEvento('pagamento', () => carregadores[abaAtual]());
  carregarResumo();
})();