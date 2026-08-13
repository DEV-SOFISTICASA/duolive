// DuoLive · Catálogo de produtos por loja, espelhado no Supabase.
//
// Os produtos ficam na memória (lojas[x].produtos) para o painel ler rápido, mas
// isso se perde a cada deploy/reinício. Aqui a gente guarda uma cópia durável no
// banco (tabela 'catalogo'), e carrega de volta quando o conector sobe — assim o
// seletor de ofertas não zera mais sozinho.
//
// Tabela (rode uma vez no SQL do Supabase):
//   create table if not exists catalogo (
//     loja text not null,
//     plataforma text not null,
//     produtos jsonb not null default '[]',
//     atualizado_em timestamptz not null default now(),
//     primary key (loja, plataforma)
//   );
//
// Se a tabela ainda não existir, salvar/carregar apenas falham em silêncio e o
// conector segue com o catálogo em memória (nada quebra).

const SB = require('./supabase.js');

// grava (ou atualiza) o catálogo de UMA loja+plataforma
async function salvar(loja, plataforma, produtos) {
  if (!SB.ativo()) return;
  await SB.upsert('catalogo',
    [{ loja: String(loja || ''), plataforma: String(plataforma || 'tiktok'), produtos: produtos || [], atualizado_em: new Date().toISOString() }],
    'loja,plataforma');
}

// lê tudo que está salvo -> [{loja, plataforma, produtos}]
async function carregar() {
  if (!SB.ativo()) return [];
  return (await SB.seleciona('catalogo', 'select=loja,plataforma,produtos')) || [];
}

module.exports = { salvar, carregar };
