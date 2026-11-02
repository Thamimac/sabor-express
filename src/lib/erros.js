// Erro com código HTTP (ex.: 404 = não encontrado, 422 = dado inválido)
class HttpError extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

module.exports = { HttpError };