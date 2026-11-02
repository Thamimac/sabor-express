// Simula o sistema da RotaLog enviando atualizações de entrega para o Sabor Express.
// Uso (com o servidor rodando, em outro terminal):
//   npm run rotalog -- SE00001 aceito
//   npm run rotalog -- SE00001 posicao 60       
//   npm run rotalog -- SE00001 ocorrencia atraso "Trânsito intenso"
//   npm run rotalog -- SE00001 entregue
const config = require('../src/config');
const { um } = require('../src/db/database');

const [codigo, evento = 'aceito', tipo = 'atraso', descricao = 'Informado pela RotaLog'] = process.argv.slice(2);
if (!codigo) {
  console.log('Informe o pedido. Exemplo: npm run rotalog -- SE00001 aceito');
  process.exit(1);
}

const chave = um("SELECT valor FROM configuracoes WHERE chave = 'rotalog_api_key'").valor;
const corpo = { pedido: codigo, evento };
if (evento === 'aceito') corpo.entregador = { nome: 'Lucas RotaLog', documento: '111.222.333-44', telefone: '(11) 96666-5555', veiculo: 'Moto - ROT4L06' };
if (evento === 'ocorrencia') Object.assign(corpo, { tipo, descricao });
if (evento === 'posicao') corpo.progresso = Number(process.argv[4] || 50);

fetch(`http://localhost:${config.porta}/api/integracao/rotalog`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': chave },
  body: JSON.stringify(corpo),
})
  .then(async (r) => {
    const resposta = await r.json();
    if (!r.ok) throw new Error(resposta.erro);
        console.log(`✔ RotaLog → Sabor Express: pedido ${codigo}, evento "${evento}" recebido (status atual: ${resposta.status || 'ocorrência registrada'}${resposta.progresso != null ? `, ${resposta.progresso}% do trajeto` : ''})`);
  })
  .catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });