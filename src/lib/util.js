// Funções utilitárias: relógio, datas no fuso de São Paulo, validação e formatação
const config = require('../config');
const { HttpError } = require('./erros');

// ---- Relógio (substituível nos testes) ----
let relogio = () => new Date();
const agora = () => relogio();
const agoraISO = () => agora().toISOString();
function definirRelogio(fn) { relogio = fn || (() => new Date()); }

// ---- Datas no fuso America/Sao_Paulo ----
const fmtPartes = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.fusoHorario,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function partesLocais(data = agora()) {
  const p = Object.fromEntries(fmtPartes.formatToParts(new Date(data)).map((x) => [x.type, x.value]));
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour, minuto: +p.minute, data: `${p.year}-${p.month}-${p.day}` };
}
const dataLocal = (d) => partesLocais(d).data; // 'AAAA-MM-DD'

// Início (UTC) de um dia local 'AAAA-MM-DD' — o Brasil não usa horário de verão desde 2019 (UTC-3)
function inicioDiaUTC(dataStr) { return new Date(`${dataStr}T00:00:00-03:00`).toISOString(); }
function fimDiaUTC(dataStr) { return new Date(new Date(`${dataStr}T00:00:00-03:00`).getTime() + 86400000).toISOString(); }

function minutosEntre(a, b) {
  if (!a || !b) return null;
  return (new Date(b) - new Date(a)) / 60000;
}

// ---- Validação ----
function texto(valor, campo, { min = 1, max = 200, obrigatorio = true } = {}) {
  const v = typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
  if (!v) {
    if (obrigatorio) throw new HttpError(422, `O campo "${campo}" é obrigatório`);
    return null;
  }
  if (v.length < min) throw new HttpError(422, `O campo "${campo}" deve ter pelo menos ${min} caracteres`);
  if (v.length > max) throw new HttpError(422, `O campo "${campo}" deve ter no máximo ${max} caracteres`);
  return v;
}

function email(valor) {
  const v = texto(valor, 'e-mail', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw new HttpError(422, 'E-mail inválido');
  return v;
}

function telefone(valor, obrigatorio = true) {
  const v = texto(valor, 'telefone', { obrigatorio, max: 20 });
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  if (d.length < 10 || d.length > 11) throw new HttpError(422, 'Telefone inválido (informe DDD + número)');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

function senhaForte(valor) {
  const v = typeof valor === 'string' ? valor : '';
  if (v.length < 8 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) {
    throw new HttpError(422, 'A senha deve ter pelo menos 8 caracteres, com letras e números');
  }
  if (v.length > 100) throw new HttpError(422, 'Senha muito longa');
  return v;
}

function inteiro(valor, campo, { min = -Infinity, max = Infinity, obrigatorio = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) throw new HttpError(422, `O campo "${campo}" é obrigatório`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(422, `Valor inválido para "${campo}"`);
  return n;
}

function opcao(valor, campo, opcoes) {
  if (!opcoes.includes(valor)) throw new HttpError(422, `Valor inválido para "${campo}". Opções: ${opcoes.join(', ')}`);
  return valor;
}

const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

module.exports = {
  agora, agoraISO, definirRelogio, partesLocais, dataLocal, inicioDiaUTC, fimDiaUTC, minutosEntre,
  texto, email, telefone, senhaForte, inteiro, opcao, reais,
};