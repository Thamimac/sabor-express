// Segurança: hash de senhas (scrypt + salt) e geração de tokens
const crypto = require('node:crypto');

// Gera "scrypt$<salt>$<hash>". A senha original nunca é armazenada.
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verificarSenha(senha, armazenado) {
  if (typeof senha !== 'string' || typeof armazenado !== 'string') return false;
  const [algoritmo, saltHex, hashHex] = armazenado.split('$');
  if (algoritmo !== 'scrypt' || !saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado); // comparação em tempo constante
}

const tokenAleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

module.exports = { hashSenha, verificarSenha, tokenAleatorio, sha256 };