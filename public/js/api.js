// Funções compartilhadas por todas as telas: chamadas à API, formatação e avisos
const api = {
  async requisicao(metodo, url, dados) {
    const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
    if (dados !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(dados);
    }
    const resposta = await fetch(url, opcoes);
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = new Error(corpo.erro || `Erro ${resposta.status}`);
      erro.status = resposta.status;
      throw erro;
    }
    return corpo;
  },
  get: (url) => api.requisicao('GET', url),
  post: (url, dados = {}) => api.requisicao('POST', url, dados),
  put: (url, dados = {}) => api.requisicao('PUT', url, dados),
  patch: (url, dados = {}) => api.requisicao('PATCH', url, dados),
  delete: (url) => api.requisicao('DELETE', url),
};

const formatar = {
  reais: (centavos) => (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  km: (valor) => `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`,
  dataHora: (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'),
  hora: (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'),
  data: (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'),
};

// Escapa texto antes de inserir em HTML (evita XSS)
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

function avisar(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = `aviso-flutuante ${tipo}`;
  el.setAttribute('role', 'status');
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}