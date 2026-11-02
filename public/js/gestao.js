// Painel do gerente: visão geral, cardápio, equipe, configurações, auditoria, e-mails e backup
(async function () {
  const usuario = await Layout.exigirEquipe('gerente'); // somente gerente
  if (!usuario) return;

  const PERFIL = { atendente: 'Atendimento/Caixa', cozinha: 'Cozinha', logistica: 'Logística', financeiro: 'Financeiro', gerente: 'Gerente' };
  const indicador = (rotulo, valor, classe = '') => `<div class="indicador ${classe}"><span>${rotulo}</span><strong>${valor}</strong></div>`;
  const precoTexto = (c) => (c / 100).toFixed(2).replace('.', ',');

  const carregadores = { visao: carregarVisao, cardapio: carregarCardapio, avaliacoes: carregarAvaliacoes, mesas: carregarMesas,
    equipe: carregarEquipe, config: carregarConfig,
    auditoria: carregarAuditoria, emails: carregarEmails, backup: carregarBackups };
  let abaAtual = 'visao';
  function abrirAba(nome) {
    abaAtual = nome;
    $$('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
    $$('[role="tabpanel"]').forEach((s) => s.classList.toggle('oculto', s.id !== `aba-${nome}`));
    carregadores[nome]();
  }
  $$('.abas button').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));

  function desenharSituacao(f) {
    $('#situacao').innerHTML = f.dentroDoHorario ? '<span class="selo sucesso">Restaurante aberto</span>'
      : f.modoDemonstracao ? '<span class="selo alerta">Modo demonstração ligado</span>' : '<span class="selo erro">Restaurante fechado</span>';
  }

  // ---- Visão geral ----
  async function carregarVisao() {
    const d = await api.get('/api/gestao/painel');
    desenharSituacao(d.funcionamento);
    $('#ind-visao').innerHTML = [
      indicador('Pedidos hoje', d.hoje.pedidos),
      indicador('Em andamento agora', d.hoje.emAndamento),
      indicador('Faturamento hoje', formatar.reais(d.hoje.faturamento)),
      indicador('Faturamento 7 dias', formatar.reais(d.semana.total.liquido)),
      indicador('Ticket médio (7 dias)', formatar.reais(d.semana.total.ticketMedio)),
      indicador('Tempo médio de preparo', d.hoje.tempoMedioPreparoMin != null ? `${String(d.hoje.tempoMedioPreparoMin).replace('.', ',')} min` : '—'),
      indicador('Metas do SLA cumpridas', `${d.sla.cumpridos} de 5`, d.sla.descumpridos ? 'alerta' : ''),
      indicador('Satisfação (30 dias)', d.satisfacao.total ? `${String(d.satisfacao.media).replace('.', ',')} ★` : '—', d.satisfacao.media && d.satisfacao.media < 4 ? 'alerta' : ''),
      indicador('Clientes cadastrados', d.clientes),
    ].join('');
    $('#semana').innerHTML = d.semana.linhas.map((l) => `<tr><td>${new Date(`${l.periodo}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
      <td class="num">${l.pedidos - l.estornos} pedidos</td><td class="num"><strong>${formatar.reais(l.liquido)}</strong></td></tr>`).join('')
      || '<tr><td class="vazio">Sem vendas no período.</td></tr>';
    $('#mais-vendidos').innerHTML = d.maisVendidos.map((m, i) => `<tr><td>${i + 1}º ${esc(m.nome)}</td><td class="num">${m.quantidade} un.</td>
      <td class="num">${formatar.reais(m.total)}</td></tr>`).join('') || '<tr><td class="vazio">Sem vendas.</td></tr>';
    const SIT = { cumprido: '<span class="selo sucesso">OK</span>', descumprido: '<span class="selo erro">Fora</span>', sem_dados: '<span class="selo">—</span>' };
    $('#sla-resumo').innerHTML = d.sla.indicadores.map((i) => `<tr><td>${esc(i.nome)}</td>
      <td class="num">${i.valor == null ? '—' : `${String(i.valor).replace('.', ',')}${i.unidade === '%' ? '%' : ` ${i.unidade}`}`}</td><td>${SIT[i.situacao]}</td></tr>`).join('');
  }

  // ---- Cardápio ----
  let categorias = [];
  async function carregarCardapio() {
    categorias = await api.get('/api/gestao/cardapio');
    $('#it-cat').innerHTML = categorias.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    $('#lista-cardapio').innerHTML = categorias.map((c) => `
      <section class="cartao" style="margin-bottom:1rem;padding:0">
        <div class="linha entre" style="padding:1rem 1rem .5rem">
          <h3 style="margin:0">${esc(c.icone || '')} ${esc(c.nome)}</h3>
          <div class="linha"><label for="tp-${c.id}" class="pequeno" style="margin:0">Tempo médio de preparo (min)</label>
            <input id="tp-${c.id}" type="number" min="1" max="120" value="${c.tempo_preparo_min}" style="width:90px">
            <button class="botao neutro pequeno" data-tempo="${c.id}">Salvar</button></div>
        </div>
        <div class="tabela-rolagem"><table>
          <thead><tr><th>Item</th><th class="num">Preço</th><th>Situação</th><th></th></tr></thead>
          <tbody>${c.itens.map((i) => `<tr class="${i.disponivel ? '' : 'suave'}">
            <td><div class="linha">${i.foto ? `<img class="miniatura" src="${esc(i.foto)}" alt="">` : ''}<div><strong>${esc(i.nome)}</strong> ${i.destaque ? '<span class="selo alerta sem-ponto">Destaque</span>' : ''}<br><small class="suave">${esc(i.descricao || '')}</small></div></div></td>
            <td class="num">${formatar.reais(i.preco_centavos)}</td>
            <td>${i.disponivel ? '<span class="selo sucesso">Disponível</span>' : '<span class="selo erro">Indisponível</span>'}</td>
            <td><div class="linha"><button class="botao neutro pequeno" data-editar="${i.id}">Editar</button>
              <button class="botao neutro pequeno" data-disponivel="${i.id}" data-valor="${i.disponivel ? 0 : 1}">${i.disponivel ? 'Esgotou' : 'Voltou'}</button></div></td>
          </tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhum item.</td></tr>'}</tbody>
        </table></div>
      </section>`).join('');
  }
  const dialogo = $('#dialogo-item');
  let fotoNova = null;     // foto escolhida (JPEG reduzido, em base64)
  let removerFoto = false; // gerente pediu para tirar a foto atual
  function mostrarPrevia(src) {
    $('#it-previa').src = src || '';
    $('#it-previa').classList.toggle('oculto', !src);
    $('#it-remover-foto').classList.toggle('oculto', !src);
  }
  function abrirItem(item = null) {
    $('#form-item').reset();
    fotoNova = null;
    removerFoto = false;
    mostrarPrevia(item?.foto || null);
    $('#titulo-item').textContent = item ? 'Editar item' : 'Novo item';
    $('#it-id').value = item?.id || '';
    $('#it-nome').value = item?.nome || '';
    $('#it-desc').value = item?.descricao || '';
    $('#it-cat').value = item?.categoria_id || categorias[0]?.id;
    $('#it-preco').value = item ? precoTexto(item.preco_centavos) : '';
    $('#it-disp').checked = item ? item.disponivel : true;
    $('#it-dest').checked = !!item?.destaque;
    dialogo.showModal();
  }
  // Reduz a foto no navegador (máx. 800 px, JPEG) antes de enviar: arquivos leves e cardápio rápido
  function reduzirFoto(arquivo) {
    return new Promise((ok, erro) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, 800 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => erro(new Error('Não foi possível ler esta imagem'));
      const leitor = new FileReader(); // lê como "data:" (permitido pela política de segurança da página)
      leitor.onload = () => { img.src = leitor.result; };
      leitor.onerror = () => erro(new Error('Não foi possível ler o arquivo'));
      leitor.readAsDataURL(arquivo);
    });
  }
  $('#it-foto').addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    try { fotoNova = await reduzirFoto(arquivo); removerFoto = false; mostrarPrevia(fotoNova); } catch (err) { avisar(err.message, 'erro'); }
  });
  $('#it-remover-foto').addEventListener('click', () => { fotoNova = null; removerFoto = true; $('#it-foto').value = ''; mostrarPrevia(null); });
  $('#novo-item').addEventListener('click', () => abrirItem());
  dialogo.querySelector('[data-fechar]').addEventListener('click', () => dialogo.close());
  $('#form-item').addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(e.target, async (dados) => {
      let id = $('#it-id').value;
      if (id) await api.put(`/api/gestao/itens/${id}`, dados); else id = (await api.post('/api/gestao/itens', dados)).id;
      if (fotoNova) await api.post(`/api/gestao/itens/${id}/foto`, { imagem: fotoNova });
      else if (removerFoto) await api.delete(`/api/gestao/itens/${id}/foto`);
      dialogo.close();
      avisar('Cardápio atualizado');
      carregarCardapio();
    });
  });

  // ---- Avaliações dos clientes ----
  async function carregarAvaliacoes() {
    const r = await api.get('/api/gestao/avaliacoes?dias=30');
    const estrelas = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    const noPrazo = r.porPrazo.find((x) => x.prazo === 'no_prazo');
    const atrasado = r.porPrazo.find((x) => x.prazo === 'atrasado');
    $('#ind-avaliacoes').innerHTML = [
      indicador('Nota média (30 dias)', r.total ? `${String(r.media).replace('.', ',')} ★` : '—'),
      indicador('Avaliações recebidas', r.total),
      indicador('Satisfeitos (4 ou 5 ★)', r.total ? `${Math.round(((r.distribuicao[5] + r.distribuicao[4]) / r.total) * 100)}%` : '—'),
      indicador('Insatisfeitos (1 ou 2 ★)', r.total ? `${Math.round(((r.distribuicao[1] + r.distribuicao[2]) / r.total) * 100)}%` : '—',
        r.total && (r.distribuicao[1] + r.distribuicao[2]) / r.total > 0.1 ? 'alerta' : ''),
    ].join('');
    $('#distribuicao').innerHTML = [5, 4, 3, 2, 1].map((n) => {
      const pct = r.total ? Math.round((r.distribuicao[n] / r.total) * 100) : 0;
      return `<tr><td class="estrelas-fixas">${estrelas(n)}</td><td style="width:50%"><div class="trajeto"><div style="width:${pct}%"></div></div></td>
        <td class="num">${r.distribuicao[n]} (${pct}%)</td></tr>`;
    }).join('');
    $('#por-prazo').innerHTML = `
      <tr><td>Entregues no prazo</td><td class="num"><strong>${noPrazo ? String(noPrazo.media).replace('.', ',') : '—'} ★</strong></td><td class="num">${noPrazo?.total || 0} avaliações</td></tr>
      <tr><td>Entregues com atraso</td><td class="num"><strong class="texto-erro">${atrasado ? String(atrasado.media).replace('.', ',') : '—'} ★</strong></td><td class="num">${atrasado?.total || 0} avaliações</td></tr>`;
    $('#lista-avaliacoes').innerHTML = r.ultimas.map((a) => `<li><div class="linha entre">
      <span><span class="estrelas-fixas">${estrelas(a.nota)}</span> <strong>${esc(a.cliente_nome)}</strong> · pedido ${esc(a.codigo)}</span>
      <span class="pequeno suave">${formatar.dataHora(a.criado_em)}</span></div>${a.comentario ? `<p>“${esc(a.comentario)}”</p>` : ''}</li>`).join('')
      || '<li class="vazio">Nenhuma avaliação ainda.</li>';
  }

  // ---- QR Code das mesas ----
  let redeCarregada = false;
  async function carregarMesas() {
    if (!redeCarregada) {
      const r = await api.get('/api/gestao/rede');
      $('#enderecos-rede').innerHTML = [...r.enderecos, r.atual].map((e) => `<option value="${esc(e)}">`).join('');
      $('#mesa-url').value = r.enderecos[0] || r.atual;
      redeCarregada = true;
    }
    const base = $('#mesa-url').value.replace(/\/+$/, '');
    const qtd = Math.min(Math.max(Number($('#mesa-qtd').value) || 1, 1), 40);
    $('#grade-mesas').innerHTML = Array.from({ length: qtd }, (_, i) => {
      const url = `${base}/cardapio?mesa=${i + 1}`;
      return `<div class="cartao-mesa"><strong class="numero-mesa">Mesa ${i + 1}</strong>${QR.svg(url, { tamanho: 180 })}
        <span>Aponte a câmera do celular<br>para ver o cardápio e pedir</span><small>${esc(url)}</small></div>`;
    }).join('');
  }
  $('#form-mesas').addEventListener('submit', (e) => { e.preventDefault(); carregarMesas(); });
  $('#imprimir-mesas').addEventListener('click', () => window.print());

  // ---- Equipe ----
  async function carregarEquipe() {
    const lista = await api.get('/api/gestao/usuarios');
    $('#tabela-equipe').innerHTML = lista.map((f) => `<tr class="${f.ativo ? '' : 'suave'}">
      <td><strong>${esc(f.nome)}</strong><br><small class="suave">${esc(f.telefone || '')}</small></td><td>${esc(f.email)}</td>
      <td><select data-perfil="${f.id}" data-nome="${esc(f.nome)}" data-tel="${esc(f.telefone || '')}" ${f.id === usuario.id ? 'disabled' : ''}>
        ${Object.entries(PERFIL).map(([v, r]) => `<option value="${v}" ${v === f.perfil ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td>${f.ativo ? '<span class="selo sucesso">Ativo</span>' : '<span class="selo">Inativo</span>'}</td>
      <td><div class="linha">${f.id === usuario.id ? '<span class="pequeno suave">você</span>' : `
        <button class="botao neutro pequeno" data-senha="${f.id}">Nova senha</button>
        <button class="botao neutro pequeno" data-ativo="${f.id}" data-valor="${f.ativo ? 0 : 1}">${f.ativo ? 'Desativar' : 'Ativar'}</button>`}</div></td></tr>`).join('');
  }
  $('#tabela-equipe').addEventListener('change', async (e) => {
    const s = e.target.closest('[data-perfil]');
    if (!s) return;
    try {
      await api.put(`/api/gestao/usuarios/${s.dataset.perfil}`, { nome: s.dataset.nome, telefone: s.dataset.tel, perfil: s.value });
      avisar('Perfil alterado');
    } catch (err) { avisar(err.message, 'erro'); carregarEquipe(); }
  });
  $('#form-funcionario').addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(e.target, async (dados) => {
      await api.post('/api/gestao/usuarios', dados);
      e.target.reset();
      avisar('Funcionário cadastrado');
      carregarEquipe();
    });
  });

  // ---- Configurações ----
  async function carregarConfig() {
    const c = await api.get('/api/gestao/configuracoes');
    $('#cf-abre').value = c.horario_abertura;
    $('#cf-fecha').value = c.horario_fechamento;
    $('#cf-demo').checked = c.ignorar_horario;
  }
  $('#form-config').addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(e.target, async (dados) => {
      const r = await api.put('/api/gestao/configuracoes', dados);
      desenharSituacao(r.funcionamento);
      avisar('Configurações salvas');
    });
  });

  // ---- Auditoria ----
  async function carregarAuditoria() {
    const q = new URLSearchParams(Object.entries(lerFormulario($('#form-auditoria'))).filter(([, v]) => v)).toString();
    const lista = await api.get(`/api/gestao/auditoria?${q}`);
    $('#tabela-auditoria').innerHTML = lista.map((a) => `<tr><td>${formatar.dataHora(a.criado_em)}</td><td>${esc(a.usuario_nome || '—')}</td>
      <td><code>${esc(a.acao)}</code></td><td>${esc([a.entidade, a.entidade_id].filter(Boolean).join(' '))}</td>
      <td><small>${esc(a.detalhes || '')}</small></td><td><small>${esc(a.ip || '')}</small></td></tr>`).join('')
      || '<tr><td colspan="6" class="vazio">Nenhum registro.</td></tr>';
  }
  $('#form-auditoria').addEventListener('submit', (e) => { e.preventDefault(); carregarAuditoria(); });

  // ---- E-mails e backup ----
  async function carregarEmails() {
    const lista = await api.get('/api/gestao/emails');
    $('#lista-emails').innerHTML = lista.map((m) => `<li><div class="linha entre"><strong>${esc(m.assunto)}</strong>
      <span class="pequeno suave">${formatar.dataHora(m.criado_em)}</span></div><p class="pequeno">Para: ${esc(m.para)}</p>
      <pre class="email-corpo">${esc(m.corpo)}</pre></li>`).join('') || '<li class="vazio">Nenhum e-mail enviado.</li>';
  }
  async function carregarBackups() {
    const lista = await api.get('/api/gestao/backups');
    $('#tabela-backups').innerHTML = lista.map((b) => `<tr><td><code>${esc(b.arquivo)}</code></td><td class="num">${b.tamanho_kb} KB</td>
      <td>${formatar.dataHora(b.criado_em)}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Nenhum backup ainda.</td></tr>';
  }
  $('#fazer-backup').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api.post('/api/gestao/backups'); avisar('Backup criado'); carregarBackups(); } catch (err) { avisar(err.message, 'erro'); }
    e.target.disabled = false;
  });

  // ---- Ações dos botões ----
  $('main').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    try {
      if (d.editar) abrirItem(categorias.flatMap((c) => c.itens).find((i) => String(i.id) === d.editar));
      else if (d.disponivel) { await api.post(`/api/gestao/itens/${d.disponivel}/disponivel`, { disponivel: d.valor === '1' }); avisar('Cardápio atualizado'); carregarCardapio(); }
      else if (d.tempo) { await api.put(`/api/gestao/categorias/${d.tempo}`, { tempo_preparo_min: $(`#tp-${d.tempo}`).value }); avisar('Tempo de preparo salvo'); }
      else if (d.ativo) { await api.post(`/api/gestao/usuarios/${d.ativo}/ativo`, { ativo: d.valor === '1' }); avisar('Funcionário atualizado'); carregarEquipe(); }
      else if (d.senha) {
        const senha = prompt('Nova senha (mínimo 8 caracteres, com letras e números):');
        if (!senha) return;
        await api.post(`/api/gestao/usuarios/${d.senha}/senha`, { senha });
        avisar('Senha redefinida');
      }
    } catch (err) { avisar(err.message, 'erro'); }
  });

  carregarVisao();
})();