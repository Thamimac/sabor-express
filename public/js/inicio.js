// Página inicial: situação do restaurante, faixas de entrega e consulta de taxa por bairro
(async function () {
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
    $('#situacao').innerHTML = `<span class="selo erro">Não foi possível conectar ao servidor</span>`;
    console.error(e);
  }
})();