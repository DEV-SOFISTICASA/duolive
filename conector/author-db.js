// DuoLive · author_id (o "dono da live") por loja, espelhado no Supabase.
//
// O author_id é capturado 1x (de uma ⚡ ativa que o vendedor cria na mão) e o robô
// guarda num arquivo local (author-ids.json). Mas esse arquivo SOME quando o robô
// reinicia/atualiza (ainda mais na nuvem), e aí a loja precisa de uma ⚡ manual DE
// NOVO. Aqui a gente guarda uma cópia durável no banco (tabela 'author_ids'), pra
// UMA ⚡ manual por loja valer PRA SEMPRE — mesmo depois de restart/deploy.
//
// Tabela (rode uma vez no SQL do Supabase):
//   create table if not exists author_ids (
//     loja text primary key,
//     author_id text not null,
//     atualizado_em timestamptz not null default now()
//   );
//
// Se a tabela ainda não existir, salvar/carregar apenas falham em silêncio e o
// conector segue com o author_id em memória (nada quebra).

const SB = require('./supabase.js');

// grava (ou atualiza) o author_id de UMA loja
async function salvar(loja, id) {
  if (!SB.ativo()) return;
  await SB.upsert('author_ids',
    [{ loja: String(loja || ''), author_id: String(id || ''), atualizado_em: new Date().toISOString() }],
    'loja');
}

// lê tudo que está salvo -> [{loja, author_id}]
async function carregar() {
  if (!SB.ativo()) return [];
  return (await SB.seleciona('author_ids', 'select=loja,author_id')) || [];
}

module.exports = { salvar, carregar };
