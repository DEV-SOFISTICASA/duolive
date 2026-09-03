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

// Crédito manual de HORAS por loja+dia: lives SEM nome no título que o usuário
// confirmou serem de alguém. Ex.: em 2026-08-12 a KA (Adriana) fez todas as lives
// da Fast, mas sem se identificar no título ("Lets Go LIVE!"). Formato: 'loja|diaBRT'.
// (é pontual — o certo é a vendedora pôr o apelido no título, aí conta sozinho.)
const CREDITO_LOJA_DIA = {
  'fast|2026-08-12': 'p_1786125236457_1002', // Adriana (KA) — só as lives de hoje na Fast
};

// Ajuste de EXIBIÇÃO de sigla: quando a equipe chama a pessoa por um apelido
// diferente do login do painel. Ex.: Giovana no título é "GC", mas o login é "JK".
const SIGLA_EXIBE = {
  'p_1786125236457_1001': 'GC', // Giovana → mostra GC (não o login JK)
};

// Pessoas APAGADAS do histórico a pedido do usuário: as lives atribuídas a elas
// não aparecem nem contam. Numa dupla, só a parte dela some.
//   Luana (p_1785537102138_6823) — 2026-08-08
//   Isa   (p_1782764934419_8473) — 2026-08-10
const APAGADAS = { 'p_1785537102138_6823': true, 'p_1782764934419_8473': true };

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
  const r = await fetch(c.url + '/rest/v1/livedash_state?or=(key.like.tts_lives:*,key.like.shp_lives:*,key.eq.shared)&select=key,data', {
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

  // lives de todas as lojas, por plataforma. O prefixo da chave diz a plataforma:
  //   tts_lives:<loja> = TikTok      shp_lives:<loja> = Shopee
  // Ficam SEPARADAS pra a herança de vizinha (mesma loja/dia) não misturar as duas.
  function coletaLives(prefixo) {
    const mapa = {};
    rows.forEach((row) => {
      if (!String(row.key).startsWith(prefixo)) return;
      const lojaLD = String((row.data && row.data.loja) || String(row.key).replace(prefixo, '')).toLowerCase().trim();
      const loja = NOME_LOJA[lojaLD] || lojaLD;
      const lista = mapa[loja] = mapa[loja] || [];
      ((row.data && row.data.lives) || []).forEach((l) => {
        const ini = Date.parse(l.started_at || 0);
        if (!ini || isNaN(ini)) return;
        lista.push({
          room_id: String(l.room_id || ''), titulo: String(l.title || ''),
          ts: new Date(ini).toISOString(), dia: new Date(ini - 3 * 3600000).toISOString().slice(0, 10),
          gmv: +l.gmv || 0, pedidos: +l.orders || 0, duracao: +l.duration_min || 0,
        });
      });
    });
    return mapa;
  }
  const porLoja = coletaLives('tts_lives:');        // TikTok
  const porLojaShopee = coletaLives('shp_lives:');  // Shopee (vendas realizadas do LiveDash)

  _dados = { porLoja, porLojaShopee, resp, aliasMap, tags, overrides, viraISO: premio.viraISO || '' };
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
function resolveTodas(d, mapa) {
  mapa = mapa || d.porLoja; // qual plataforma resolver (porLoja = TikTok, porLojaShopee = Shopee)
  const ehDona = {}; d.resp.forEach((p) => { ehDona[p.id] = !!p.dona; });
  const out = []; // {loja, live, pids[]}  (pids = ids de pessoas, ou ['__sem__'])
  Object.keys(mapa).forEach((loja) => {
    const regs = mapa[loja].slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
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
        else if (CREDITO_LOJA_DIA[loja + '|' + r.dia]) pids = [CREDITO_LOJA_DIA[loja + '|' + r.dia]];
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
  function emitir(resolvido, plataforma) {
    resolvido.forEach((x) => {
      const l = x.live;
      if (l.gmv <= 0) return; // live sem venda não vira linha
      const exc = EXCECOES[l.room_id];
      const produto = (exc && exc.produto) || l.titulo || 'LIVE';
      const base = { quem: null, produto: produto, plataforma: plataforma, loja: x.loja, ts: l.ts };
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
  }
  emitir(resolveTodas(d, d.porLoja), 'tiktok');        // TikTok
  emitir(resolveTodas(d, d.porLojaShopee), 'shopee');  // Shopee (realizadas, do LiveDash)
  vendas.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // mais novas primeiro, como o banco
  return { vendas: vendas, cores: cores };
}

// ---------- horas de live por vendedora HOJE (pra meta diária de horas) ----------
// Usa a MESMA atribuição do espelho (resolveTodas). Para HORAS, numa dupla cada
// pessoa leva a duração CHEIA (as duas ficaram ao vivo o tempo todo — não divide).
// periodo: 'hoje' | '7' | 'mes' | 'total'. META = 4h/dia × dias do período.
async function horasPeriodo(siglasNossas, periodo) {
  const d = await dados();
  const porId = {}; d.resp.forEach((p) => { porId[p.id] = p; });
  // "agora" em BRT (UTC-3) pra fechar dia/mês certo no fuso do Brasil
  const agora = new Date(Date.now() - 3 * 3600000);
  const Y = agora.getUTCFullYear(), M = agora.getUTCMonth(), D = agora.getUTCDate();
  const meiaNoiteBRT = (y, m, dd) => new Date(Date.UTC(y, m, dd) + 3 * 3600000).toISOString(); // 00:00 BRT como ISO UTC
  let desde, dias;
  if (periodo === '7') { desde = meiaNoiteBRT(Y, M, D - 6); dias = 7; }
  else if (periodo === 'mes') { desde = meiaNoiteBRT(Y, M, 1); dias = D; }
  else if (periodo === 'total') {
    desde = meiaNoiteBRT(2000, 0, 1);
    let cedo = null; // 1ª live registrada (pra "dias corridos" fazer sentido)
    Object.keys(d.porLoja).forEach((loja) => d.porLoja[loja].forEach((r) => { if (!cedo || r.ts < cedo) cedo = r.ts; }));
    const e = cedo ? new Date(new Date(cedo).getTime() - 3 * 3600000) : agora;
    dias = Math.max(1, Math.round((Date.UTC(Y, M, D) - Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate())) / 86400000) + 1);
  } else { desde = meiaNoiteBRT(Y, M, D); dias = 1; } // hoje
  const minId = {}; // id da pessoa -> minutos de live no período
  resolveTodas(d).forEach((x) => {
    if (x.live.ts < desde) return;                        // fora do período
    x.pids.forEach((pid) => {
      if (pid === '__sem__' || !porId[pid] || APAGADAS[pid]) return;
      minId[pid] = (minId[pid] || 0) + (x.live.duracao || 0); // dupla NÃO divide (as duas ficaram ao vivo)
    });
  });
  const metaDia = Math.round((+(process.env.DUOLIVE_META_HORAS || 4)) * 60);
  const metaMin = metaDia * dias;
  const nossas = new Set((siglasNossas || []).map(limpa)); // apelidos cadastrados no painel
  const vendedoras = [];
  d.resp.forEach((p) => {
    if (APAGADAS[p.id]) return;
    if (!(p.aliases || []).some((a) => nossas.has(limpa(a)))) return; // só quem está no cadastro (Giovana: JK)
    const sig = SIGLA_EXIBE[p.id] || siglaDe(p, siglasNossas);        // exibe GC pra Giovana
    if (vendedoras.some((v) => v.sigla === sig)) return;
    vendedoras.push({ sigla: sig, nome: p.nome, cor: p.cor || '#8b8b95', minutos: minId[p.id] || 0 });
  });
  vendedoras.sort((a, b) => b.minutos - a.minutos);
  return { ok: true, periodo: periodo || 'hoje', dias, metaDia, metaMin, vendedoras };
}
// atalho: só de hoje (usado pelo painel AO VIVO)
async function horasHoje(siglasNossas) { return horasPeriodo(siglasNossas, 'hoje'); }

module.exports = { config, ativo, dados, espelho, horasHoje, horasPeriodo };
