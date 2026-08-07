-- DuoLive · Tabelas do sistema de vendedoras (rode no SQL Editor do Supabase)
-- Cria as 3 tabelas: usuarios, vendas, ofertas. Pode rodar de novo sem problema.

-- ========== USUÁRIOS (ADM + vendedoras) ==========
create table if not exists usuarios (
  id         bigint generated always as identity primary key,
  nome       text not null,          -- aparece no login (Alessandra, Giovana...)
  sigla      text,                   -- aparece no gráfico (AL, GC, LORE...)
  papel      text not null default 'vendedora',  -- 'adm' ou 'vendedora'
  turno      text,                   -- 'manha' ou 'tarde'
  cor        text,                   -- cor da sigla no gráfico
  senha_hash text,                   -- null = primeiro acesso (ela define)
  criado_em  timestamptz default now()
);

-- ========== VENDAS (histórico, com sigla e horário) ==========
create table if not exists vendas (
  id         bigint generated always as identity primary key,
  order_id   text unique,            -- id da venda (evita contar 2x)
  sigla      text,                   -- de quem foi a venda
  quem       text,                   -- nome do comprador
  produto    text,
  valor      numeric,
  plataforma text,                   -- 'tiktok' ou 'shopee'
  loja       text,
  ts         timestamptz,            -- horário da venda (para o gráfico)
  criado_em  timestamptz default now()
);
create index if not exists vendas_ts_idx on vendas (ts);
create index if not exists vendas_sigla_idx on vendas (sigla);

-- ========== OFERTAS (desconto fixo, definido pelo ADM) ==========
create table if not exists ofertas (
  id            bigint generated always as identity primary key,
  produto_id    text,
  nome          text,
  imagem        text,
  valor_normal  numeric,             -- detectado do catálogo
  valor_desconto numeric,            -- fixo, o ADM define
  plataforma    text,
  loja          text,
  ativa         boolean default true,
  atualizado_em timestamptz default now()
);

-- Segurança: sem a chave secreta (que só o servidor tem), ninguém acessa.
alter table usuarios enable row level security;
alter table vendas   enable row level security;
alter table ofertas  enable row level security;
