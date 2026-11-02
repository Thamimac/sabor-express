// Recuperação de senha por e-mail (RF23): telas "esqueci" e "redefinir"
$('#form-esqueci')?.addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (dados) => {
    const r = await api.post('/api/auth/esqueci-senha', dados);
    mostrarMensagem(e.target.querySelector('.mensagem'), r.mensagem, 'sucesso');
    e.target.reset();
  });
});

$('#form-redefinir')?.addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (dados) => {
    if (dados.senha !== $('#confirmar').value) throw new Error('As senhas não conferem');
    const token = new URLSearchParams(location.search).get('token');
    if (!token) throw new Error('Link inválido. Abra o link recebido por e-mail.');
    const r = await api.post('/api/auth/redefinir-senha', { token, senha: dados.senha });
    e.target.innerHTML = `<div class="mensagem sucesso">${esc(r.mensagem)}</div><a class="botao bloco" href="/entrar">Ir para o login</a>`;
  });
});