// Tela de login (RF22)
const voltar = new URLSearchParams(location.search).get('voltar');

$('#form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (dados) => {
    const { usuario } = await api.post('/api/auth/login', dados);
    // Só aceita redirecionar para páginas do próprio site
    if (voltar && voltar.startsWith('/') && !voltar.startsWith('//')) location.href = voltar;
        else location.href = Layout.paginaInicial(usuario);
  });
});

$$('.demo button').forEach((b) => b.addEventListener('click', () => {
  $('#email').value = b.dataset.email;
  $('#senha').value = b.dataset.senha;
}));