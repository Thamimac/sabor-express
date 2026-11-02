// Backup manual do banco de dados: npm run backup
// Para restaurar: pare o servidor e copie o arquivo desejado da pasta "backups" para "data/sabor-express.db".
const backup = require('../src/services/backup');

const b = backup.fazerBackup('manual');
console.log(`✔ Backup criado: backups/${b.arquivo} (${b.tamanho_kb} KB)`);
console.log('Backups disponíveis:');
backup.listar().forEach((x) => console.log(`  - ${x.arquivo}`));