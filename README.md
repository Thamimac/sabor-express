# 🍽️ Sabor Express

Sistema web de pedidos e delivery para restaurante, desenvolvido para a disciplina de **Laboratório de Engenharia de Software** da **FATEC São Paulo** (Grupo 4).

O sistema reúne em um só lugar o cardápio e os pedidos, a cozinha, as entregas com a parceira RotaLog, o financeiro e o cadastro de clientes.

## Funcionalidades

- **Cliente:** cardápio com fotos, pedido para entrega, retirada ou salão, pagamento por Pix ou cartão, acompanhamento em tempo real e avaliação do pedido.
- **Cozinha:** fila de pedidos com cronômetro de preparo e impressão da comanda.
- **Logística:** despacho para os entregadores, mapa com a previsão de chegada, ocorrências e controle do SLA da RotaLog.
- **Financeiro:** pagamentos, estornos, relatórios, conciliação e controle fiscal.
- **Gestão:** indicadores, cardápio, equipe, avaliações, QR Code das mesas, auditoria e backup.

## Tecnologias

- Node.js
- SQLite
- HTML, CSS e JavaScript

O projeto não usa bibliotecas externas, então não é preciso rodar `npm install`.

## Como executar

1. Instale o [Node.js](https://nodejs.org) versão **22.13 ou mais recente**.
2. Baixe o projeto:
   ```bash
   git clone https://github.com/Thamimac/sabor-express.git
   cd sabor-express
   ```
3. Gere os dados de demonstração:
   ```bash
   npm run demo
   ```
4. Inicie o sistema:
   ```bash
   npm start
   ```
5. Abra **http://localhost:3000** no navegador.

### Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Inicia o sistema |
| `npm run demo` | Apaga o banco e cria dados de demonstração |
| `npm run seed` | Apaga o banco e cria só os dados iniciais |
| `npm test` | Roda os testes automatizados |
| `npm run backup` | Faz um backup do banco |

## Acessos para teste

| Perfil | E-mail | Senha |
|---|---|---|
| Cliente | `maria@email.com` | `cliente2026` |
| Gerente | `gerente@saborexpress.com.br` | `sabor2026` |
| Atendimento | `atendimento@saborexpress.com.br` | `sabor2026` |
| Cozinha | `cozinha@saborexpress.com.br` | `sabor2026` |
| Logística | `logistica@saborexpress.com.br` | `sabor2026` |
| Financeiro | `financeiro@saborexpress.com.br` | `sabor2026` |

**Cartão de teste:** `4111 1111 1111 1111` (aprovado) ou `4000 0000 0000 0002` (recusado), com qualquer validade futura e qualquer CVV.

**Horário:** o restaurante aceita pedidos das 11h às 23h. Para testar fora desse horário, o gerente liga o *modo demonstração* em **Gestão → Configurações**. O `npm run demo` já deixa esse modo ligado.

## Estrutura do projeto

```
sabor-express/
├── src/        Servidor: rotas, regras de negócio e banco de dados
├── public/     Telas do sistema (cliente e painéis da equipe)
├── tests/      Testes automatizados
└── scripts/    Backup e simulador da RotaLog
```

## Observações

- Os pagamentos, os e-mails e a integração com a RotaLog são **simulados**, por ser um projeto acadêmico.
- A distância de entrega é calculada pelo bairro do cliente.

## Equipe

Grupo 4 — FATEC São Paulo

- Beatriz Diniz Ferreira — RA: 1110482312009
- Camille França dos Santos — RA: 20216660
- Cauê Alexandre Moreira Barbosa — RA: 22210131
- Murilo Domingos Nogueira — RA: 0020482511041
- Thamires Martins de Araújo Cavalcante — RA: 0020482623081
