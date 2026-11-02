-- Sabor Express - Modelo físico do banco de dados (SQLite)
-- Valores monetários armazenados em centavos (INTEGER) para evitar erros de arredondamento.
-- Datas armazenadas em ISO 8601 (UTC).

CREATE TABLE IF NOT EXISTS usuarios (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nome             TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telefone         TEXT,
  senha_hash       TEXT NOT NULL,
  perfil           TEXT NOT NULL DEFAULT 'cliente'
                   CHECK (perfil IN ('cliente','atendente','cozinha','logistica','financeiro','gerente')),
  consentimento_lgpd_em TEXT,
  ativo            INTEGER NOT NULL DEFAULT 1,
  criado_em        TEXT NOT NULL,
  excluido_em      TEXT
);

CREATE TABLE IF NOT EXISTS bairros (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL UNIQUE,
  distancia_km  REAL NOT NULL  -- distância até o restaurante (substitui a geolocalização)
);

CREATE TABLE IF NOT EXISTS enderecos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  apelido      TEXT NOT NULL DEFAULT 'Casa',
  cep          TEXT,
  logradouro   TEXT NOT NULL,
  numero       TEXT NOT NULL,
  complemento  TEXT,
  bairro_id    INTEGER NOT NULL REFERENCES bairros(id),
  referencia   TEXT,
  principal    INTEGER NOT NULL DEFAULT 0,
  criado_em    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  nome               TEXT NOT NULL UNIQUE,
  ordem              INTEGER NOT NULL DEFAULT 0,
  tempo_preparo_min  INTEGER NOT NULL DEFAULT 15,  -- regra de domínio 4
  icone              TEXT
);

CREATE TABLE IF NOT EXISTS itens (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id     INTEGER NOT NULL REFERENCES categorias(id),
  nome             TEXT NOT NULL,
  descricao        TEXT,
  preco_centavos   INTEGER NOT NULL CHECK (preco_centavos > 0),
  disponivel       INTEGER NOT NULL DEFAULT 1,
  destaque         INTEGER NOT NULL DEFAULT 0,
  criado_em        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entregadores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  documento  TEXT,
  telefone   TEXT,
  veiculo    TEXT,
  empresa    TEXT NOT NULL DEFAULT 'RotaLog Entregas',
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pedidos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo               TEXT UNIQUE,
  cliente_id           INTEGER REFERENCES usuarios(id),
  criado_por_id        INTEGER REFERENCES usuarios(id),
  cliente_nome         TEXT NOT NULL,
  cliente_telefone     TEXT,
  modalidade           TEXT NOT NULL CHECK (modalidade IN ('entrega','retirada','salao')),
  mesa                 INTEGER,
  endereco_texto       TEXT,
  bairro_id            INTEGER REFERENCES bairros(id),
  distancia_km         REAL,
  observacoes          TEXT,
  subtotal_centavos    INTEGER NOT NULL,
  taxa_entrega_centavos INTEGER NOT NULL DEFAULT 0,
  total_centavos       INTEGER NOT NULL,
  forma_pagamento      TEXT NOT NULL CHECK (forma_pagamento IN ('credito','debito','pix','dinheiro')),
  troco_para_centavos  INTEGER,
  status               TEXT NOT NULL DEFAULT 'aguardando_confirmacao'
                       CHECK (status IN ('aguardando_confirmacao','recebido','em_preparo','pronto',
                                         'despachado','a_caminho','entregue','cancelado')),
  motivo_cancelamento  TEXT,
  entregador_id        INTEGER REFERENCES entregadores(id),
  preparo_estimado_min INTEGER,
  entrega_estimada_min INTEGER,
  previsao_em          TEXT,
  tempo_preparo_seg    INTEGER,           -- RF10
  criado_em            TEXT NOT NULL,
  confirmado_em        TEXT,
  preparo_inicio_em    TEXT,
  pronto_em            TEXT,
  despachado_em        TEXT,
  aceite_em            TEXT,
  entregue_em          TEXT,
  cancelado_em         TEXT
);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos(criado_em);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id             INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  item_id               INTEGER REFERENCES itens(id),
  nome                  TEXT NOT NULL,
  categoria             TEXT,
  preco_unit_centavos   INTEGER NOT NULL,
  quantidade            INTEGER NOT NULL CHECK (quantidade > 0),
  observacao            TEXT
);

CREATE TABLE IF NOT EXISTS historico_status (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id   INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  usuario_id  INTEGER REFERENCES usuarios(id),
  observacao  TEXT,
  em          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id        INTEGER NOT NULL UNIQUE REFERENCES pedidos(id) ON DELETE CASCADE,
  forma            TEXT NOT NULL CHECK (forma IN ('credito','debito','pix','dinheiro')),
  valor_centavos   INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','aprovado','recusado','estornado','cancelado')),
  transacao_ref    TEXT,
  cartao_final     TEXT,
  cartao_bandeira  TEXT,
  pix_copia_cola   TEXT,
  tentativas       INTEGER NOT NULL DEFAULT 0,
  motivo           TEXT,
  criado_em        TEXT NOT NULL,
  aprovado_em      TEXT,
  atualizado_em    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transacoes_fiscais (   -- regra de domínio 7
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos(id),
  pagamento_id    INTEGER NOT NULL REFERENCES pagamentos(id),
  valor_centavos  INTEGER NOT NULL,
  status_nf       TEXT NOT NULL DEFAULT 'pendente_emissao'
                  CHECK (status_nf IN ('pendente_emissao','emitida','cancelada')),
  numero_nf       TEXT,
  criado_em       TEXT NOT NULL,
  atualizado_em   TEXT
);

CREATE TABLE IF NOT EXISTS ocorrencias (           -- RF15 / Gestão de Incidentes (ITIL)
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id        INTEGER NOT NULL REFERENCES pedidos(id),
  tipo             TEXT NOT NULL CHECK (tipo IN ('atraso','endereco_nao_encontrado','avaria','extravio','cliente_ausente','outro')),
  descricao        TEXT,
  registrada_por   INTEGER REFERENCES usuarios(id),
  origem           TEXT NOT NULL DEFAULT 'sistema',
  resolucao        TEXT,
  criado_em        TEXT NOT NULL,
  resolvida_em     TEXT
);

CREATE TABLE IF NOT EXISTS notificacoes (          -- RF09
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER REFERENCES usuarios(id),
  destino     TEXT NOT NULL,       -- cliente | logistica | cozinha | atendente | financeiro
  pedido_id   INTEGER REFERENCES pedidos(id),
  mensagem    TEXT NOT NULL,
  lida        INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails (                -- caixa de saída (envio simulado)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  para        TEXT NOT NULL,
  assunto     TEXT NOT NULL,
  corpo       TEXT NOT NULL,
  criado_em   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens_senha (          -- RF23
  token_hash  TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   TEXT NOT NULL,
  usado_em    TEXT
);

CREATE TABLE IF NOT EXISTS sessoes (
  id          TEXT PRIMARY KEY,   -- hash SHA-256 do token do cookie
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   TEXT NOT NULL,
  criado_em   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (             -- RNF Auditabilidade
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id   INTEGER,
  usuario_nome TEXT,
  acao         TEXT NOT NULL,
  entidade     TEXT,
  entidade_id  TEXT,
  detalhes     TEXT,
  ip           TEXT,
  criado_em    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auditoria_data ON auditoria(criado_em);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS rastreamento (          -- posição do entregador enviada pela RotaLog
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id    INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  progresso    REAL NOT NULL,     -- 0 a 1 (fração do trajeto percorrida)
  origem       TEXT NOT NULL DEFAULT 'rotalog',
  em           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rastreamento_pedido ON rastreamento(pedido_id, id);

CREATE TABLE IF NOT EXISTS avaliacoes (            -- satisfação do cliente após a entrega
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id    INTEGER NOT NULL UNIQUE REFERENCES pedidos(id) ON DELETE CASCADE,
  cliente_id   INTEGER REFERENCES usuarios(id),
  nota         INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario   TEXT,
  criado_em    TEXT NOT NULL
);