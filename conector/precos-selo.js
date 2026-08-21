// DuoLive · SELO DE PREÇOS — a trava de segurança das ofertas ⚡.
//
// POR QUÊ: em 2026-08 uma mexida errada nos valores (por fora do painel) fez as
// ofertas saírem com preço errado na live = prejuízo real. Este selo garante que
// isso NUNCA mais passa despercebido:
//
//   1. Quando o ADM salva um preço PELO PAINEL (única porta legítima), o conector
//      tira um "retrato" da lista mestre inteira (produto+variação+valor) e SELA.
//   2. Antes de cada ⚡, o robô confere a lista atual contra o retrato selado.
//   3. Qualquer diferença (valor mudado por fora, produto a mais/a menos) =
//      ⚡ BLOQUEADA + alarme, até o ADM aprovar de novo no painel.
//
// Tabela (rode uma vez no SQL do Supabase):
//   create table if not exists precos_selo (
//     id int primary key,
//     selo jsonb not null,
//     atualizado_em timestamptz not null default now()
//   );
//
// Sem a tabela, selar/conferir falham em silêncio e nada quebra (mas a trava
// não protege — rode o SQL!).

const crypto = require('crypto');
const SB = require('./supabase.js');
const OFERTAS = require('./ofertas.js');

const MASTER = (process.env.DUOLIVE_OFERTA_MASTER || 'mania').toLowerCase();

// o "retrato" canônico da lista mestre: só o que define preço (produto|sku|valor),
// ordenado. O nome vai junto só pra mensagem de alarme ficar legível (fora do hash).
async function retrato() {
  const rows = (await OFERTAS.listar(MASTER)) || [];
  const itens = rows
    .filter((r) => r.valor_desconto != null)
    .map((r) => ({ p: String(r.produto_id), s: r.sku ? String(r.sku) : '', v: +r.valor_desconto, n: (r.nome || '') + (r.variacao_nome ? (' · ' + r.variacao_nome) : '') }))
    .sort((a, b) => (a.p + '|' + a.s).localeCompare(b.p + '|' + b.s));
  const hash = crypto.createHash('sha256').update(itens.map((i) => i.p + '|' + i.s + '|' + i.v.toFixed(2)).join('\n')).digest('hex');
  return { itens, hash };
}

// SELA o estado atual (só chamar das portas do ADM: salvar/remover/aprovar)
async function selar(quem) {
  if (!SB.ativo()) return false;
  const r = await retrato();
  await SB.upsert('precos_selo', [{ id: 1, selo: { hash: r.hash, itens: r.itens, quem: String(quem || 'ADM') }, atualizado_em: new Date().toISOString() }], 'id');
  return true;
}

// CONFERE o estado atual contra o selo. Devolve:
//   { temSelo, confere, divergencias:[{nome, aprovado, atual}], seladoAgora }
// Sem selo ainda (primeira vez): sela sozinho o estado atual como ponto de partida.
async function conferir() {
  if (!SB.ativo()) return { temSelo: false, confere: true, divergencias: [] };
  let linha = null;
  try { const r = await SB.seleciona('precos_selo', 'id=eq.1&select=selo&limit=1'); linha = (r && r[0] && r[0].selo) || null; } catch (e) { return { temSelo: false, confere: true, divergencias: [] }; }
  const atual = await retrato();
  if (!linha || !linha.hash) {
    try { await selar('inicial (auto)'); } catch (e) {}
    return { temSelo: false, confere: true, divergencias: [], seladoAgora: true };
  }
  if (linha.hash === atual.hash) return { temSelo: true, confere: true, divergencias: [] };
  // montou a lista das diferenças, legível, pro alarme e pro painel
  const chave = (i) => i.p + '|' + i.s;
  const aprovados = new Map((linha.itens || []).map((i) => [chave(i), i]));
  const atuais = new Map(atual.itens.map((i) => [chave(i), i]));
  const divergencias = [];
  aprovados.forEach((a, k) => {
    const b = atuais.get(k);
    if (!b) divergencias.push({ nome: a.n || k, aprovado: a.v, atual: null });          // sumiu
    else if (b.v !== a.v) divergencias.push({ nome: a.n || k, aprovado: a.v, atual: b.v }); // valor mudou
  });
  atuais.forEach((b, k) => { if (!aprovados.has(k)) divergencias.push({ nome: b.n || k, aprovado: null, atual: b.v }); }); // apareceu
  return { temSelo: true, confere: false, divergencias: divergencias.slice(0, 40) };
}

module.exports = { selar, conferir, MASTER };
