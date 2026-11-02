// Fotos dos pratos: enviadas pelo gerente e guardadas em public/fotos/item-<id>.jpg
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { HttpError } = require('../lib/erros');

const pasta = path.join(config.publicDir, 'fotos');
const arquivo = (itemId) => path.join(pasta, `item-${Number(itemId)}.jpg`);

// Endereço da foto (com a data no final para o navegador não mostrar uma versão antiga)
function urlDaFoto(itemId) {
  try {
    const st = fs.statSync(arquivo(itemId));
    return `/fotos/item-${Number(itemId)}.jpg?v=${Math.floor(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

// Recebe a imagem em base64 (data URL). O navegador já reduz e converte para JPEG antes de enviar.
function salvar(itemId, dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(422, 'Envie a foto em formato JPEG');
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > 600 * 1024) throw new HttpError(413, 'Foto muito grande (máximo 600 KB)');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(422, 'Arquivo não é uma imagem JPEG válida');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(arquivo(itemId), bytes);
  return urlDaFoto(itemId);
}

function remover(itemId) {
  fs.rmSync(arquivo(itemId), { force: true });
}

module.exports = { urlDaFoto, salvar, remover };