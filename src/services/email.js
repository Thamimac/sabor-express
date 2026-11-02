// Envio de e-mails SIMULADO: grava na tabela "emails" e mostra no terminal do servidor.
// Em produção, este é o único arquivo a trocar por um serviço SMTP real.
const { executar } = require('../db/database');
const { agoraISO } = require('../lib/util');

function enviarEmail(para, assunto, corpo) {
  executar('INSERT INTO emails (para, assunto, corpo, criado_em) VALUES (?, ?, ?, ?)', para, assunto, corpo, agoraISO());
  if (process.env.NODE_ENV !== 'test') {
    console.log(`\n📧 E-mail (simulado) para ${para}\n   Assunto: ${assunto}\n   ${corpo.split('\n').join('\n   ')}\n`);
  }
}

module.exports = { enviarEmail };