// DuoLive · Espelho do LiveDash — o histórico REFLETE o LiveDash em vez de
// manter contagem própria (decisão do usuário, 2026-08-08).
//
// O LiveDash coleta as lives 24/7 (worker livedash-robo no Render) e guarda no
// Supabase ANTIGO: tabela livedash_state, chaves tts_lives:<loja> (lives) e
// 'shared' (estado do app: responsáveis, apelidos e ajustes manuais por live).
//
// A ATRIBUIÇÃO replica a regra do próprio LiveDash (resolveRespMulti):
//   1º ajuste MANUAL da live (overrides; 'al+tc' = dupla, divide igual)
//   2º marca de GRAVADA no título (ex. "GR") → replay, não é de ninguém
//   3º APELIDO no título, palavra inteira (TS/TC→Taciana, LUA→Luana...);
//      2+ pessoas no título = dupla (divide igual); só a dona → ninguém
//   4º live sem nome herda da VIZINHA do mesmo dia/loja (a das 9h é da AL →
//      a das 10h sem título é dela; vale também pra sem-título que vem antes)
//   5º até a "data de virada" (viraISO): cai na dona da loja (lojaFallback)
//   6º senão → bucket "Gravadas" (igual ao painel do LiveDash)
//
// Cada live vira UMA linha do histórico com `qtd` = nº de PEDIDOS da live
// (a página soma qtd — venda é pedido, não live). Valor = GMV da live.
//
// URL e chave (service_role do projeto ANTIGO) vêm de:
//   1º variáveis LIVEDASH_URL / LIVEDASH_KEY (é assim no Render)
//   2º arquivo chave-livedash.txt (linha 1 = URL, linha 2 = chave), fora do git

const fs = require('fs');
const path = require('path');

// nomes de loja do LiveDash ≠ nomes do DuoLive — normaliza pra não duplicar loja
const NOME_LOJA = { 'mania-d-casa': 'mania' };
const GRAVADA = 'GRAVADA';

// Ajustes NOSSOS por live (mesmo formato dos overrides do LiveDash), decididos
// com o usuário nesta base: a LIVE 10K (07/08) divide TS/AL e fica FORA do
// "Total" (o historico.html filtra produto==='LIVE 10K'); a live de 07/08 à
// noite foi da Taciana (o robô capturou as 4 vendas dela, usuário confirmou).
const EXCECOES = {
  '7671242944791300872': { ov: 'al+tc', produto: 'LIVE 10K' },
  '7671358885671783188': { ov: 'al+tc', produto: 'LIVE 10K' },
  '7671442687194598165': { ov: 'tc' },
};

// Pessoas APAGADAS do histórico a pedido do usuário (2026-08-08): as lives
// atribuídas a elas não aparecem nem contam. Numa dupla, só a parte dela some.
// Luana (id do LiveDash: p_1785537102138_6823).
const APAGADAS = { 'p_1785537102138_6823': true };

function config() {
  let url = process.env.LIVEDASH_URL || '';
  let key = process.env.LIVEDASH_KEY || '';
  if (!url || !key) {
    try {
      const linhas = fs.readFileSync(path.join(__dirname, 'chave-livedash.txt'), 'utf8')
        .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      url = url || linhas[0] || '';
      key = key || linhas[1] || '';
    } catch (e) {}
  }
  return { url: url.replace(/\/+$/, ''), key: key };
}
function ativo() { const c = config(); return !!(c.url && c.key && /^https?:\/\//.test(c.url)); }

const limpa = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const palavras = (t) => String(t || '').match(/[A-Za-z0-9À-ÿ]+/g) || [];

// ---------- leitura (cache 3 min; erro mantém o último resultado bom) ----------
let _dados = null, _dadosTs = 0;
async function dados() {
  if (_dados && Date.now() - _dadosTs < 180000) return _dados;
  const c = config();
  const r = await fetch(c.url + '/rest/v1/livedash_state?or=(key.like.tts_lives:*,key.eq.shared)&select=key,data', {
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key },
  });
  if (!r.ok) { if (_dados) return _dados; throw new Error('livedash ' + r.status); }
  const rows = await r.json();

  // estado do app (responsáveis/apelidos/ajustes) — com padrões se faltar
  let premio = {};
  const shared = rows.find((x) => x.key === 'shared');
  try { premio = JSON.parse((shared.data || {})['la-premio']) || {}; } catch (e) {}
  const resp = Array.isArray(premio.responsaveis) && premio.responsaveis.length ? premio.responsaveis : [
    { id: 'al', nome: 'Alessandra', cor: '#7c5cff', aliases: ['AL'], lojaFallback: 'Monaco', dona: false },
    { id: 'tc', nome: 'Taciana', cor: '#3ecf8e', aliases: ['TC', 'TS'], lojaFallback: 'Bellini', dona: false },
  ];
  const aliasMap = {};
  resp.forEach((p) => (p.aliases || []).forEach((a) => {
    const k = limpa(a); if (!k) return;
    if (!aliasMap[k]) aliasMap[k] = [];
    if (aliasMap[k].indexOf(p.id) < 0) aliasMap[k].push(p.id);
  }));
  const tags = (premio.tagsGravada || ['GR']).map(limpa).filter(Boolean);
  const overrides = Object.assign({}, premio.overrides || {});
  Object.keys(EXCECOES).forEach((id) => { overrides[id] = EXCECOES[id].ov; });

  // lives de todas as lojas
  const porLoja = {};
  rows.forEach((row) => {
    if (!String(row.key).startsWith('tts_lives:')) return;
    const lojaLD = String((row.data && row.data.loja) || String(row.key).replace('tts_lives:', '')).toLowerCase().trim();
    const loja = NOME_LOJA[lojaLD] || lojaLD;
    const lista = porLoja[loja] = porLoja[loja] || [];
    ((row.data && row.data.lives) || []).forEach((l) => {
      const ini = Date.parse(l.started_at || 0);
      if (!ini || isNaN(ini)) return;
      lista.push({
        room_id: String(l.room_id || ''), titulo: String(l.title || ''),
        ts: new Date(ini).toISOString(), dia: new Date(ini - 3 * 3600000).toISOString().slice(0, 10),
        gmv: +l.gmv || 0, pedidos: +l.orders || 0,
      });
    });
  });

  _dados = { porLoja, resp, aliasMap, tags, overrides, viraISO: premio.viraISO || '' };
  _dadosTs = Date.now();
  return _dados;
}

// ---------- atribuição (réplica fiel do resolveRespMulti do LiveDash) ----------
function analisaTitulo(titulo, aliasMap, tags) {
  const ids = []; let grav = false;
  for (const w of palavras(titulo)) {
    const k = limpa(w);
    if (k && tags.indexOf(k) >= 0) { grav = true; break; }
    if (k && aliasMap[k]) aliasMap[k].forEach((id) => { if (ids.indexOf(id) < 0) ids.push(id); });
  }
  return { ids, grav };
}
function resolveTodas(d) {
  const ehDona = {}; d.resp.forEach((p) => { ehDona[p.id] = !!p.dona; });
  const out = []; // {loja, live, pids[]}  (pids = ids de pessoas, ou ['__sem__'])
  Object.keys(d.porLoja).forEach((loja) => {
    const regs = d.porLoja[loja].slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
    // herança da vizinha do mesmo dia/loja (o _vizMap do LiveDash)
    const ultimo = {}, pend = {}, viz = {};
    regs.forEach((r) => {
      const a = analisaTitulo(r.titulo, d.aliasMap, d.tags);
      if (a.grav) return;
      const vivos = a.ids.filter((id) => !ehDona[id]);
      if (vivos.length) {
        ultimo[r.dia] = vivos;
        if (pend[r.dia]) { pend[r.dia].forEach((rid) => { viz[rid] = vivos; }); delete pend[r.dia]; }
      } else if (!a.ids.length && r.room_id) {
        if (ultimo[r.dia]) viz[r.room_id] = ultimo[r.dia];
        else (pend[r.dia] = pend[r.dia] || []).push(r.room_id);
      }
    });
    regs.forEach((r) => {
      let pids = null;
      const ov = d.overrides[r.room_id];
      if (ov != null) pids = String(ov).indexOf('+') > 0 ? String(ov).split('+') : [String(ov)];
      else {
        const a = analisaTitulo(r.titulo, d.aliasMap, d.tags);
        if (a.grav) pids = ['__sem__'];
        else if (a.ids.length) { const vivos = a.ids.filter((id) => !ehDona[id]); pids = vivos.length ? vivos : ['__sem__']; }
        else if (viz[r.room_id]) pids = viz[r.room_id].slice();
        else if (r.dia <= (d.viraISO || '')) {
          const lojaUp = String(loja).toUpperCase();
          const p = d.resp.find((pp) => pp.lojaFallback && limpa(pp.lojaFallback) === limpa(lojaUp));
          pids = p ? [p.dona ? '__sem__' : p.id] : ['__sem__'];
        } else pids = ['__sem__'];
      }
      out.push({ loja, live: r, pids });
    });
  });
  return out;
}

// sigla de exibição de cada pessoa: o apelido que já existe no NOSSO sistema
// (usuarios) ganha; senão o 1º apelido; senão o nome.
function siglaDe(p, siglasNossas) {
  const nossas = (siglasNossas || []).map(limpa);
  for (const a of (p.aliases || [])) { if (nossas.indexOf(limpa(a)) >= 0) return String(a).toUpperCase(); }
  if ((p.aliases || []).length) return String(p.aliases[0]).toUpperCase();
  return limpa(p.nome) || p.id;
}

// ---------- o espelho: {vendas, cores} no formato do /vendas-historico ----------
async function espelho(siglasNossas) {
  const d = await dados();
  const porId = {}; d.resp.forEach((p) => { porId[p.id] = p; });
  const cores = {}; cores[GRAVADA] = { nome: 'Gravadas', cor: '#9aa0aa' };
  d.resp.forEach((p) => { if (!APAGADAS[p.id]) cores[siglaDe(p, siglasNossas)] = { nome: p.nome, cor: p.cor || '#8b8b95' }; });

  const vendas = [];
  resolveTodas(d).forEach((x) => {
    const l = x.live;
    if (l.gmv <= 0) return; // live sem venda não vira linha
    const exc = EXCECOES[l.room_id];
    const produto = (exc && exc.produto) || l.titulo || 'LIVE';
    const base = { quem: null, produto: produto, plataforma: 'tiktok', loja: x.loja, ts: l.ts };
    const siglas = x.pids.map((pid) => ({
      apagada: !!APAGADAS[pid],
      sigla: (pid === '__sem__' || !porId[pid]) ? GRAVADA : siglaDe(porId[pid], siglasNossas),
    }));
    const n = siglas.length; // a divisão usa TODOS (a parte de quem foi apagada só não é emitida)
    const parteG = Math.floor((l.gmv / n) * 100) / 100;
    const parteQ = Math.floor(l.pedidos / n);
    siglas.forEach((s, i) => {
      if (s.apagada) return;
      const fim = i === n - 1;
      vendas.push(Object.assign({
        sigla: s.sigla,
        valor: fim ? +(l.gmv - parteG * (n - 1)).toFixed(2) : parteG,
        qtd: fim ? (l.pedidos - parteQ * (n - 1)) : parteQ,
      }, base));
    });
  });
  vendas.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // mais novas primeiro, como o banco
  return { vendas: vendas, cores: cores };
}

module.exports = { config, ativo, dados, espelho };
