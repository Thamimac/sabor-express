// Tela de cadastro de cliente (RF21) com consentimento LGPD
(async function () {
  const bairros = await preencherBairros($('#bairro'));

  $('#bairro').addEventListener('change', (e) => {
    const b = bairros.find((x) => String(x.id) === e.target.value);
    const aviso = $('#aviso-bairro');
    if (b && !b.atende) {
      mostrarMensagem(aviso, `${b.nome} está fora da nossa área de entrega. Você poderá pedir para retirar no balcão.`, 'info');
    } else aviso.classList.add('oculto');
  });

  $('#form-cadastro').addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(e.target, async (dados) => {
      if (dados.senha !== $('#confirmar').value) throw new Error('As senhas não conferem');
      await api.post('/api/auth/cadastro', dados);
      location.href = '/conta?bemvindo=1';
    });
  });
})();