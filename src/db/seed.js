// Dados iniciais: configurações, bairros atendidos, cardápio, equipe e entregadores RotaLog.
// Uso: npm run seed  (apaga o banco e recria tudo do zero)
const fs = require('node:fs');
const { hashSenha, tokenAleatorio } = require('../lib/seguranca');

const SENHA_EQUIPE = 'sabor2026';
const SENHA_CLIENTE = 'cliente2026';

const CONFIGURACOES = {
  horario_abertura: '11:00',      // regra de domínio 1
  horario_fechamento: '23:00',
  ignorar_horario: '0',           // "modo demonstração": permite pedidos fora do horário
  rotalog_api_key: null,          // gerada na hora (integração com a RotaLog)
};

// Distâncias aproximadas até o restaurante (Sé, centro de SP). Regras de domínio 2 e 3.
const BAIRROS = [
  ['Sé', 0.5], ['República', 1.2], ['Liberdade', 1.6], ['Bela Vista', 2.1], ['Bom Retiro', 2.4],
  ['Santa Cecília', 2.7], ['Consolação', 2.9], ['Brás', 3.2], ['Cambuci', 3.5], ['Higienópolis', 3.6],
  ['Aclimação', 3.9], ['Barra Funda', 4.3], ['Mooca', 4.8], ['Paraíso', 4.6], ['Perdizes', 5.4],
  ['Vila Mariana', 5.9], ['Pari', 3.4], ['Santana', 6.3], ['Pinheiros', 6.8], ['Ipiranga', 7.1],
  ['Tatuapé', 7.4], ['Moema', 7.8],
  // Fora do raio de 8 km: o sistema deve recusar entregas
  ['Butantã', 9.6], ['Santo Amaro', 13.5], ['Itaquera', 18.2],
];

// [nome, ordem, tempo médio de preparo em minutos (regra de domínio 4), ícone]
const CATEGORIAS = [
  ['Entradas', 1, 15, '🥟'],
  ['Pratos Executivos', 2, 10, '🍛'],
  ['Pratos à la Carte', 3, 30, '🍽️'],
  ['Bebidas', 4, 2, '🥤'],
  ['Sobremesas', 5, 5, '🍮'],
];

// [categoria, nome, descrição, preço em centavos, destaque]
const ITENS = [
  ['Entradas', 'Pastel de carne (2 un.)', 'Massa crocante com carne moída temperada e azeitona.', 1490, 0],
  ['Entradas', 'Bolinho de bacalhau (6 un.)', 'Receita da casa, servido com limão.', 2490, 1],
  ['Entradas', 'Salada da casa', 'Folhas verdes, tomate, palmito, cenoura e molho de mostarda e mel.', 1990, 0],
  ['Pratos Executivos', 'Frango grelhado', 'Filé de frango grelhado com arroz, feijão, salada e fritas.', 2990, 0],
  ['Pratos Executivos', 'Feijoada executiva', 'Feijoada com arroz, couve refogada, farofa, torresmo e laranja.', 3490, 1],
  ['Pratos Executivos', 'Strogonoff de frango', 'Com arroz branco e batata palha.', 3190, 0],
  ['Pratos Executivos', 'Parmegiana de carne', 'Bife empanado com molho de tomate e queijo, arroz e fritas.', 3690, 0],
  ['Pratos à la Carte', 'Picanha na chapa (2 pessoas)', 'Picanha fatiada com arroz, farofa, vinagrete e mandioca frita.', 11990, 1],
  ['Pratos à la Carte', 'Salmão com legumes', 'Filé de salmão grelhado com legumes salteados e purê de batata.', 6990, 0],
  ['Pratos à la Carte', 'Risoto de cogumelos', 'Arroz arbóreo, mix de cogumelos frescos e parmesão.', 5490, 0],
  ['Pratos à la Carte', 'Moqueca de peixe (2 pessoas)', 'Peixe branco, leite de coco e dendê, com arroz e pirão.', 8990, 0],
  ['Bebidas', 'Refrigerante lata 350 ml', 'Coca-Cola, Guaraná ou Sprite.', 650, 0],
  ['Bebidas', 'Suco natural 500 ml', 'Laranja, limão, maracujá ou abacaxi com hortelã.', 1190, 0],
  ['Bebidas', 'Água mineral 500 ml', 'Com ou sem gás.', 450, 0],
  ['Sobremesas', 'Pudim de leite', 'Fatia do tradicional pudim com calda de caramelo.', 1290, 0],
  ['Sobremesas', 'Mousse de maracujá', 'Leve e cremosa.', 1190, 0],
  ['Sobremesas', 'Petit gâteau', 'Bolinho quente de chocolate com sorvete de creme.', 2290, 1],
];

// [nome, e-mail, telefone, perfil] — equipe interna (item 3.1.7 da documentação)
const EQUIPE = [
  ['Ana Proprietária', 'gerente@saborexpress.com.br', '(11) 98888-0001', 'gerente'],
  ['Bruno Atendimento', 'atendimento@saborexpress.com.br', '(11) 98888-0002', 'atendente'],
  ['Carla Cozinha', 'cozinha@saborexpress.com.br', '(11) 98888-0003', 'cozinha'],
  ['Diego Operações', 'logistica@saborexpress.com.br', '(11) 98888-0004', 'logistica'],
  ['Elisa Financeiro', 'financeiro@saborexpress.com.br', '(11) 98888-0005', 'financeiro'],
];

// Entregadores da empresa terceirizada (RF12)
const ENTREGADORES = [
  ['Rafael Souza', '123.456.789-00', '(11) 97777-1001', 'Moto - ABC1D23'],
  ['Juliana Lima', '987.654.321-00', '(11) 97777-1002', 'Moto - EFG4H56'],
  ['Marcos Pereira', '456.789.123-00', '(11) 97777-1003', 'Bicicleta elétrica'],
  ['Patrícia Gomes', '321.654.987-00', '(11) 97777-1004', 'Moto - IJK7L89'],
];

function popular(db) {
  const agora = new Date().toISOString();
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  db.exec('BEGIN');
  try {
    for (const [chave, valor] of Object.entries(CONFIGURACOES)) {
      run('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)', chave, valor ?? tokenAleatorio(24));
    }

    for (const [nome, km] of BAIRROS) run('INSERT INTO bairros (nome, distancia_km) VALUES (?, ?)', nome, km);

    const idCategoria = {};
    for (const [nome, ordem, tempo, icone] of CATEGORIAS) {
      idCategoria[nome] = Number(run('INSERT INTO categorias (nome, ordem, tempo_preparo_min, icone) VALUES (?, ?, ?, ?)', nome, ordem, tempo, icone).lastInsertRowid);
    }
    for (const [cat, nome, desc, preco, destaque] of ITENS) {
      run('INSERT INTO itens (categoria_id, nome, descricao, preco_centavos, destaque, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        idCategoria[cat], nome, desc, preco, destaque, agora);
    }

    const hashEquipe = hashSenha(SENHA_EQUIPE);
    for (const [nome, email, tel, perfil] of EQUIPE) {
      run('INSERT INTO usuarios (nome, email, telefone, senha_hash, perfil, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        nome, email, tel, hashEquipe, perfil, agora);
    }

    // Cliente de demonstração, com consentimento LGPD e um endereço cadastrado
    const cliente = run(`INSERT INTO usuarios (nome, email, telefone, senha_hash, perfil, consentimento_lgpd_em, criado_em)
                         VALUES (?, ?, ?, ?, 'cliente', ?, ?)`,
      'Maria Cliente', 'maria@email.com', '(11) 91234-5678', hashSenha(SENHA_CLIENTE), agora, agora);
    const bairroLiberdade = db.prepare("SELECT id FROM bairros WHERE nome = 'Liberdade'").get().id;
    run(`INSERT INTO enderecos (usuario_id, apelido, cep, logradouro, numero, complemento, bairro_id, principal, criado_em)
         VALUES (?, 'Casa', '01503-000', 'Rua da Glória', '250', 'Apto 42', ?, 1, ?)`,
      Number(cliente.lastInsertRowid), bairroLiberdade, agora);

    for (const [nome, doc, tel, veiculo] of ENTREGADORES) {
      run('INSERT INTO entregadores (nome, documento, telefone, veiculo, criado_em) VALUES (?, ?, ?, ?, ?)', nome, doc, tel, veiculo, agora);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Popula apenas na primeira execução (banco vazio)
function popularSeVazio(db) {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get();
  if (total === 0) {
    popular(db);
    if (process.env.NODE_ENV !== 'test') console.log('✔ Banco de dados criado com os dados iniciais.');
  }
}

// Exporta antes do bloco abaixo (o database.js também usa este arquivo)
module.exports = { popular, popularSeVazio, SENHA_EQUIPE, SENHA_CLIENTE };

// Execução direta: npm run seed  → recria o banco do zero
if (require.main === module) {
  const config = require('../config');
  if (process.argv.includes('--reset')) {
    for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + sufixo, { force: true });
  }
  const { getDb } = require('./database');
  getDb();
  console.log(`Banco pronto em ${config.dbPath}`);
  console.log(`Equipe: gerente@ | atendimento@ | cozinha@ | logistica@ | financeiro@saborexpress.com.br  (senha: ${SENHA_EQUIPE})`);
  console.log(`Cliente: maria@email.com  (senha: ${SENHA_CLIENTE})`);
}