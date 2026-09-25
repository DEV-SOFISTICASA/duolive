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

  _dados = { porLoja, porLojaShopee, resp, aliasMap, tags, overrides, viraISO: premio.viraISO || '', cronograma: premio.cronograma || null };
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
  // junta os INTERVALOS de live de cada pessoa (TikTok + Shopee) e faz a UNIÃO —
  // assim, quando a menina está nas DUAS plataformas AO MESMO TEMPO não conta em
  // dobro; e a live SÓ da Shopee (sem TikTok junto) passa a contar. Dupla continua
  // sem dividir (as duas levam o intervalo cheio).
  const ivId = {}; // id -> [[iniMs, fimMs], ...]
  function coletaIntervalos(mapa) {
    resolveTodas(d, mapa).forEach((x) => {
      if (x.live.ts < desde) return;                      // fora do período (pelo início da live)
      const iniMs = Date.parse(x.live.ts); if (isNaN(iniMs)) return;
      const fimMs = iniMs + (x.live.duracao || 0) * 60000;
      x.pids.forEach((pid) => {
        if (pid === '__sem__' || !porId[pid] || APAGADAS[pid]) return;
        (ivId[pid] = ivId[pid] || []).push([iniMs, fimMs]);
      });
    });
  }
  coletaIntervalos(d.porLoja);        // TikTok
  coletaIntervalos(d.porLojaShopee);  // Shopee (só-Shopee entra; simultânea não dobra)
  const minId = {}; // id da pessoa -> minutos de live no período (união dos intervalos)
  Object.keys(ivId).forEach((pid) => {
    const ivs = ivId[pid].sort((a, b) => a[0] - b[0]);
    let tot = 0, ini = null, fim = null;
    ivs.forEach((iv) => {
      if (fim === null || iv[0] > fim) { if (fim !== null) tot += fim - ini; ini = iv[0]; fim = iv[1]; } // bloco novo
      else if (iv[1] > fim) { fim = iv[1]; }                                                             // sobrepõe → estende
    });
    if (fim !== null) tot += fim - ini;
    minId[pid] = Math.round(tot / 60000);
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

// quem esta AO VIVO em cada loja (pela sigla do TITULO da live mais recente de cada loja).
// Usado pelo painel do ADM pra mostrar "Monaco · TS" nos botoes das meninas ao vivo.
async function aoVivoPorLoja(siglasNossas) {
  const d = await dados();
  const porId = {}; d.resp.forEach((p) => { porId[p.id] = p; });
  const res = {}; // { loja: {sigla, nome, ts} } — a live MAIS RECENTE de cada loja
  resolveTodas(d).forEach((x) => {
    const l = x.live;
    if (res[x.loja] && l.ts <= res[x.loja].ts) return; // fica com a mais recente
    const pid = (x.pids && x.pids[0]) || '__sem__';
    const p = (pid !== '__sem__') ? porId[pid] : null;
    res[x.loja] = { ts: l.ts, sigla: p ? (SIGLA_EXIBE[p.id] || siglaDe(p, siglasNossas)) : '', nome: p ? p.nome : '' };
  });
  return res;
}
// ---------- CRONOGRAMA DE LIVES (espelho do LiveDash: planejado × real) ----------
// Portado do frontend do LiveDash. O cronograma padrao e' a "Folha de 21/09/2026".
// Avalia cada bloco planejado contra as lives REAIS que ja espelhamos (mesma
// atribuicao do historico). Bloco: {i,f,t:'live'|'gravada'|'pausa', shp, l}.
const CRONO_V = 2;
function cronoDefault() {
  const L = (i, f, shp) => ({ i, f, t: 'live', shp: shp || '' }),
        G = (i, f) => ({ i, f, t: 'gravada' }),
        P = (i, f, l) => ({ i, f, t: 'pausa', l: l || '' });
  return { _v: CRONO_V, tol: 10, dias: [1, 2, 3, 4, 5, 6], turnos: [
    { nome: 'Giovanna',   blocos: [G('07:00', '08:00'), L('08:00', '09:00', 'monaco'), P('09:00', '09:30'), L('09:30', '11:00', 'monaco'), P('11:00', '12:00', 'Almoço'), L('12:00', '13:30', 'monaco'), P('13:30', '14:30'), L('14:30', '15:30'), P('15:30', '16:00')] },
    { nome: 'Alessandra', blocos: [G('09:00', '10:00'), P('10:00', '11:00'), L('11:00', '12:00', 'monaco'), P('12:00', '13:00', 'Almoço'), L('13:00', '14:00'), P('14:00', '14:30'), L('14:30', '16:00', 'monaco'), P('16:00', '16:30'), L('16:30', '18:00', 'monaco')] },
    { nome: 'Taciana',    blocos: [G('12:30', '13:30'), L('18:00', '21:00', 'monaco')] },
  ] };
}
const cronoNorm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cronoCap = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const cronoMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const cronoHHMM = (min) => { min = Math.max(0, Math.round(min || 0)); return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); };
function cronoUniao(ivs) { const s = ivs.filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]); let tot = 0, cur = null; s.forEach((x) => { if (!cur || x[0] > cur[1]) { if (cur) tot += cur[1] - cur[0]; cur = [x[0], x[1]]; } else if (x[1] > cur[1]) cur[1] = x[1]; }); if (cur) tot += cur[1] - cur[0]; return tot; }
const minDiaBRT = (ts) => { const d = new Date(Date.parse(ts) - 3 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
// responsavel do turno: pid gravado (edicao no LiveDash) senao casa pelo comeco do nome (Giov->Giovanna)
function cronoPidDe(resp, t) { if (t && t.pid && (resp || []).some((p) => p.id === t.pid)) return t.pid; const n = cronoNorm((t && t.nome) || '').slice(0, 4); if (!n) return ''; const p = (resp || []).find((p) => cronoNorm(p.nome).slice(0, 4) === n); return p ? p.id : ''; }
// config do cronograma: espelha o PREMIO.cronograma do LiveDash; sem ele (ou versao antiga) usa o padrao
function cronoConf(saved) {
  if (!saved || !Array.isArray(saved.turnos)) return cronoDefault();
  if ((+saved._v || 0) < CRONO_V) { // folha nova: troca os horarios, preserva tolerancia/dias/pessoa do LiveDash
    const n = cronoDefault();
    if (saved.tol != null) n.tol = saved.tol;
    if (Array.isArray(saved.dias) && saved.dias.length) n.dias = saved.dias.slice();
    n.turnos.forEach((t) => { const v = saved.turnos.find((x) => cronoNorm(x.nome).slice(0, 4) === cronoNorm(t.nome).slice(0, 4)); if (v && v.pid) t.pid = v.pid; });
    return n;
  }
  return saved;
}

// avalia UM dia (YYYY-MM-DD BRT). vivosRoomIds = room_ids que estao AO VIVO agora (do conector).
async function cronograma(siglasNossas, dia, vivosRoomIds) {
  const d = await dados();
  const porId = {}; d.resp.forEach((p) => { porId[p.id] = p; });
  const conf = cronoConf(d.cronograma); // espelha o cronograma editado no LiveDash; senao o padrao
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  dia = dia || hoje;
  const ehHoje = dia === hoje;
  const nb = new Date(Date.now() - 3 * 3600000);
  const agora = ehHoje ? (nb.getUTCHours() * 60 + nb.getUTCMinutes()) : (dia < hoje ? 24 * 60 + 1 : -1);
  const tol = (conf.tol == null || !isFinite(+conf.tol)) ? 10 : Math.max(0, +conf.tol);
  const vivos = new Set((vivosRoomIds || []).map(String));
  // lives reais do dia (TikTok + Shopee), atribuicao ja resolvida (mesma do historico)
  const lives = [];
  const add = (mapa, mk) => resolveTodas(d, mapa).forEach((x) => {
    const r = x.live; if (r.dia !== dia) return;
    const ini = minDiaBRT(r.ts); if (ini == null) return;
    const vivo = ehHoje && vivos.has(String(r.room_id));
    let fim = ini + (r.duracao || 0); if (vivo && agora > fim) fim = agora;
    lives.push({ r, s: { name: x.loja }, ini, fim, vivo, pids: x.pids, mk, loja: cronoNorm(x.loja) });
  });
  add(d.porLoja, 'tt'); add(d.porLojaShopee, 'shp');
  const dow = new Date(dia + 'T12:00:00').getDay();
  const ativo = (conf.dias || [1, 2, 3, 4, 5, 6]).indexOf(dow) >= 0;
  const semDono = (l) => !l.pids.some((x) => x !== '__semshp__' && x !== '__sem__');
  const monBlocks = []; (conf.turnos || []).forEach((t2) => (t2.blocos || []).forEach((b2) => { if (b2.t === 'live' && b2.shp) { const i2 = cronoMin(b2.i), f2 = cronoMin(b2.f); if (i2 != null && f2 != null) monBlocks.push({ t: t2, ini: i2, fim: f2, loja: cronoNorm(b2.shp) }); } }));
  const turnos = (conf.turnos || []).map((t) => {
    const pid = cronoPidDe(d.resp, t);
    const blocos = (t.blocos || []).map((b) => {
      const ini = cronoMin(b.i), fim = cronoMin(b.f);
      const o = { i: b.i, f: b.f, t: b.t, shp: b.shp || '', l: b.l || '', ini, fim, st: 'neutro', cover: 0, shpCover: 0, nota: '', semShp: false, real: '' };
      if (ini == null || fim == null || fim <= ini || b.t === 'pausa' || b.t === 'ajuste' || b.t === 'gravada') return o;
      const len = fim - ini;
      const quem = (l) => !!pid && l.pids.indexOf(pid) >= 0;
      o._tt = lives.filter((l) => l.mk === 'tt' && quem(l) && l.fim > ini && l.ini < fim);
      o.cover = cronoUniao(o._tt.map((l) => [Math.max(l.ini, ini), Math.min(l.fim, fim)]));
      { // Shopee da pessoa: pela sigla; sem sigla -> loja marcada (Monaco) ou outra Shopee livre
        const shpAll = lives.filter((l) => l.mk === 'shp' && l.fim > ini && l.ini < fim);
        let cand = shpAll.filter((l) => !!pid && l.pids.indexOf(pid) >= 0);
        if (!cand.length) {
          if (b.shp) cand = shpAll.filter((l) => l.loja.indexOf(cronoNorm(b.shp)) >= 0 && semDono(l));
          else { const presas = monBlocks.filter((m) => m.t !== t && m.fim > ini && m.ini < fim).map((m) => m.loja); cand = shpAll.filter((l) => semDono(l) && !presas.some((n) => l.loja.indexOf(n) >= 0)); }
        }
        o._shp = cand; o.shpCover = cronoUniao(cand.map((l) => [Math.max(l.ini, ini), Math.min(l.fim, fim)]));
        if (b.shp && cand.length && !cand.some((l) => l.loja.indexOf(cronoNorm(b.shp)) >= 0)) o.shpOutra = cand.map((l) => l.s.name).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      }
      const primeiro = o._tt.length ? Math.min.apply(null, o._tt.map((l) => l.ini)) : null;
      const ultimo = o._tt.length ? Math.max.apply(null, o._tt.map((l) => l.fim)) : null;
      const vivo = o._tt.some((l) => l.vivo);
      const atr = (primeiro != null && primeiro > ini + tol) ? (primeiro - ini) : 0;
      if (o._tt.length) { const lj = o._tt.map((l) => l.s.name).filter((v, i, a) => a.indexOf(v) === i).join(', '); o.real = 'no ar ' + cronoHHMM(primeiro) + '–' + (vivo ? 'agora' : cronoHHMM(ultimo)) + ' · ' + lj; }
      if (agora < ini) o.st = 'futuro';
      else if (!o._tt.length) {
        o.st = agora < ini + tol ? 'aguardando' : (agora < fim ? 'fora' : 'faltou');
        if (o.st === 'fora') o.nota = 'nada no ar desde ' + cronoHHMM(ini);
        if (o.st === 'faltou') o.nota = 'nenhuma live dela nesse horário';
      } else if (agora < fim) {
        if (vivo || ultimo >= agora - tol) { o.st = 'aovivo'; if (atr) o.nota = 'começou ' + cronoHHMM(primeiro) + ' (' + atr + ' min atrasada)'; }
        else { o.st = 'fora'; o.nota = 'saiu do ar às ' + cronoHHMM(ultimo); }
      } else {
        const pct = o.cover / len, pctTxt = Math.round(pct * 100) + '%';
        if (atr) { o.st = 'atrasou'; o.nota = 'começou ' + cronoHHMM(primeiro) + ' (' + atr + ' min atrasada)' + (pct < 0.8 ? ' · cobriu ' + pctTxt : ''); }
        else if (pct >= 0.8) o.st = 'ok';
        else { o.st = 'parcial'; o.nota = 'cobriu ' + pctTxt + ' (' + cronoHHMM(primeiro) + '–' + cronoHHMM(Math.min(ultimo, fim)) + ')'; }
      }
      if (b.t === 'live' && o.st !== 'futuro' && o.st !== 'aguardando') {
        const shpOk = agora < fim ? o._shp.some((l) => l.vivo || l.fim >= agora - tol) : (o.cover > 0 ? o.shpCover >= 0.6 * o.cover : o.shpCover / len >= 0.5);
        if (!shpOk && agora >= ini + tol) o.semShp = true;
      }
      delete o._tt; delete o._shp;
      return o;
    });
    const lb = blocos.filter((b) => b.t === 'live');
    const feitos = lb.filter((b) => ['ok', 'atrasou', 'aovivo'].indexOf(b.st) >= 0).length; // igual ao LiveDash: parcial NAO conta
    const sig = SIGLA_EXIBE[pid] || (porId[pid] ? siglaDe(porId[pid], siglasNossas) : '');
    // barras do REAL (o que aconteceu): lives dela no TikTok + o Shopee dela/da loja que segura
    const shpLojas = (t.blocos || []).filter((b) => b.shp && b.t === 'live').map((b) => cronoNorm(b.shp));
    const realTT = lives.filter((l) => l.mk === 'tt' && !!pid && l.pids.indexOf(pid) >= 0).map((l) => ({ ini: l.ini, fim: l.fim, loja: l.s.name }));
    const realSHP = lives.filter((l) => l.mk === 'shp' && ((!!pid && l.pids.indexOf(pid) >= 0) || (shpLojas.length && shpLojas.some((n) => l.loja.indexOf(n) >= 0) && semDono(l)))).map((l) => ({ ini: l.ini, fim: l.fim, loja: l.s.name }));
    return { nome: t.nome || '?', sigla: sig, cor: (porId[pid] || {}).cor || '#7c5cff', pid, feitos, totalLive: lb.length, blocos, real: { tt: realTT, shp: realSHP } };
  });
  // resumo (conta blocos de live de todos os turnos)
  const resumo = { cumpridos: 0, atraso: 0, faltaram: 0, aovivo: 0, ainda: 0 };
  if (ativo) turnos.forEach((t) => t.blocos.forEach((b) => {
    if (b.t !== 'live') return;
    if (b.st === 'ok') resumo.cumpridos++;
    else if (b.st === 'atrasou' || b.st === 'parcial') resumo.atraso++;
    else if (b.st === 'faltou' || b.st === 'fora') resumo.faltaram++;
    else if (b.st === 'aovivo') resumo.aovivo++;
    else if (b.st === 'futuro' || b.st === 'aguardando') resumo.ainda++;
  }));
  return { ok: true, dia, ehHoje, agora, tol, ativo, resumo, turnos, problemas: cronoProblemas(turnos, ativo) };
}
// lista de problemas em ordem de gravidade (igual ao LiveDash)
function cronoProblemas(turnos, ativo) {
  const out = []; if (!ativo) return out;
  turnos.forEach((t) => t.blocos.forEach((o) => {
    const b = o, faixa = cronoHHMM(o.ini) + '–' + cronoHHMM(o.fim);
    const alvo = 'ao vivo no TikTok + Shopee' + (b.shp ? ' (Shopee na ' + cronoCap(b.shp) + ')' : '');
    const add = (g, st, msg) => out.push({ g, st, nome: t.nome, faixa, msg, txt: t.nome + ' ' + msg });
    if (o.st === 'fora') add(0, 'fora', 'fora do ar: deveria estar ' + alvo + ' desde ' + cronoHHMM(o.ini) + ((o.nota && o.nota.indexOf('nada no ar') < 0) ? ' · ' + o.nota : ''));
    else if (o.st === 'faltou' && b.t === 'live') add(1, 'faltou', 'não fez o bloco das ' + faixa);
    else if (o.semShp && o.st === 'aovivo') add(2, 'shp', 'está no TikTok, mas o Shopee' + (b.shp ? ' (' + cronoCap(b.shp) + ')' : '') + ' não está no ar (' + faixa + ')');
    else if (o.semShp) add(3, 'shp', 'fez a live das ' + faixa + ' sem o Shopee' + (b.shp ? ' (' + cronoCap(b.shp) + ')' : ''));
    else if (o.st === 'atrasou' || o.st === 'parcial') add(3, o.st, faixa + ': ' + o.nota);
    else if (o.shpOutra) add(4, 'shp', 'fez a live das ' + faixa + ' com o Shopee na ' + o.shpOutra + ' (era pra ser ' + cronoCap(b.shp) + ')');
  }));
  return out.sort((a, b) => a.g - b.g || 0);
}

module.exports = { config, ativo, dados, espelho, horasHoje, horasPeriodo, aoVivoPorLoja, cronograma, cronoDefault, resolveTodas };
