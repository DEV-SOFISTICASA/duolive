// DuoLive · Escolha de ofertas por VENDEDORA (perfil), espelhada no Supabase.
//
// Cada vendedora escolhe, ANTES da live, com QUAIS ofertas (da lista que o ADM montou)
// ela vai trabalhar e qual é a FIXADA. O robô lê isso pela sigla dela e cria a ⚡ só
// dessas, fixando a escolhida na tela. PREÇO é sempre do ADM — aqui é só a ESCOLHA
// (quais ofertas + a fixada), nunca valor.
//
// Tabela (rode uma vez no SQL do Supabase):
//   create table if not exists vendedora_ofertas (
//     sigla text primary key,
//     ofertas jsonb not null default '[]',   -- produto_ids escolhidos (subconjunto da lista do ADM)
//     fixada text,                            -- produto_id da fixada
//     atualizado_em timestamptz not null default now()
//   );
//
// Se a tabela não existir, salvar/ler falham em silêncio e o robô segue sem quebrar.

const SB = require('./supabase.js');

// grava a escolha de UMA vendedora (só a escolha; nunca preço)
async function salvar(sigla, ofertas, fixada) {
  if (!SB.ativo() || !sigla) return;
  await SB.upsert('vendedora_ofertas',
    [{ sigla: String(sigla), ofertas: Array.isArray(ofertas) ? ofertas.map(String) : [], fixada: fixada ? String(fixada) : null, atualizado_em: new Date().toISOString() }],
    'sigla');
}

// lê a escolha de UMA vendedora -> { ofertas:[...], fixada } ou null
async function daVendedora(sigla) {
  if (!SB.ativo() || !sigla) return null;
  const r = await SB.seleciona('vendedora_ofertas', 'sigla=eq.' + encodeURIComponent(String(sigla)) + '&select=ofertas,fixada&limit=1');
  return (r && r[0]) || null;
}

module.exports = { salvar, daVendedora };
