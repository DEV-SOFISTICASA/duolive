// DuoLive · Conector de alertas do streamer
//
// Capta os eventos da sua live no TikTok (mensagens, seguidores, presentes,
// entradas, espectadores) e alimenta o dock de alertas dentro do OBS.
//
// Como usar:
//   1. npm install            (só na primeira vez)
//   2. npm start -- @seuusuario
//   3. No OBS: Docks -> Docks personalizados do navegador -> URL http://127.0.0.1:9797
//
// Modo de teste (sem estar ao vivo):  DUOLIVE_TESTE=1 npm start
//
// Compras e Shopee: as plataformas nao liberam eventos de compra para fora —
// acompanhe os pedidos pelos docks Shopee Creator / TikTok Seller Center (ver guia).

const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('./lojas.js');
const COOKIES = require('./cookies.js');
const AUTH = require('./auth.js');
const SB = require('./supabase.js');
const CONTAS = require('./contas.js');
const LD = require('./livedash.js');   // espelho do LiveDash (fonte do histórico)
const OFERTAS = require('./ofertas.js');

// PORT e' o padrao da nuvem (Render/Railway); DUOLIVE_PORTA e' o local
const PORTA = +(process.env.PORT || process.env.DUOLIVE_PORTA || 9797);
const NA_NUVEM = !!process.env.PORT; // Render define PORT
const TESTE = process.env.DUOLIVE_TESTE === '1';
// usuario do TikTok: so' quando passado na mao (npm start -- @conta). Na nuvem
// ninguem entra sozinho em conta nenhuma — o painel escolhe a loja (pedido do
// usuario, 10/08). e' 'let' porque o seletor de lojas troca a conta em tempo real.
let usuario = (process.argv[2] || '').replace(/^@/, '');

// ---------- servidor: multichat + vendas anotadas + WebSocket ----------
let vendasAnotadas = [];        // manuais (o multichat manda a lista)
let vendasAuto = [];            // automaticas (o robo de vendas por cookies)
const vendasAutoIds = new Set(); // evita contar o mesmo pedido duas vezes
// sistema de vendedoras: quem esta' vendendo agora e quando a live atual comecou.
// O grafico do historico agrupa as vendas POR LIVE (horario = inicio da live).
let siglaAtiva = '';            // sigla da vendedora logada que esta' na live
let siglaAtivaTs = 0;           // quando foi marcada (expira sozinha)
let liveAtualInicio = 0;        // horario que a live atual comecou
let ultimaVendaTs = 0;          // ultima venda vista (para detectar quando comeca outra live)

// ---------- VARIAS lojas AO MESMO TEMPO: um chat POR loja ----------
// Cada loja aberta no painel tem a SUA conexao (chats[loja]) — abrir a Fast nao
// mexe na Monaco. Os eventos saem carimbados com a loja e cada painel mostra so'
// o que e' da loja dele (pedido do usuario, 10/08). A conta local antiga
// (npm start -- @conta) vive na chave '' e os eventos dela saem SEM carimbo.
const chats = {}; // loja -> { usuario, conexao, geracao, aoVivo, liveEstado, sigla, siglaTs }
function chatDe(loja) {
  const k = String(loja || '');
  if (!chats[k]) chats[k] = { usuario: '', conexao: null, geracao: 0, aoVivo: false, liveEstado: { espectadores: 0, likes: 0, inicio: 0, roomId: '' }, sigla: '', siglaTs: 0, curtiram: new Map() };
  return chats[k];
}
// carimba a loja no evento (a chave '' nao carimba — evento "de todos")
function comLoja(k, ev) { if (k) ev.loja = k; return ev; }
// numeros oficiais do console de lives (Compass) por loja, lidos por cookies como no LiveDash
const compassPorLoja = {}; // { loja: { gmv, orders, views, ts } }
let lojaAtual = '';        // ultima loja escolhida (reserva p/ chamadas antigas sem ?loja)

// horario da LIVE atual (o grafico usa isto): a 1a venda, ou a volta depois de
// +40 min parado, abre uma live nova. Se o chat da loja estiver conectado, usa o inicio dele.
function inicioDaLiveAtual(loja) {
  const agora = Date.now();
  const c = chats[String(loja || '')];
  if (c && c.liveEstado.inicio) { ultimaVendaTs = agora; return c.liveEstado.inicio; }
  if (!liveAtualInicio || (ultimaVendaTs && agora - ultimaVendaTs > 40 * 60000)) {
    liveAtualInicio = agora;
  }
  ultimaVendaTs = agora;
  return liveAtualInicio;
}
// siglas conhecidas (cache 5 min, do Supabase) — usadas pelo leitor de título E
// pelo espelho do LiveDash. Fica AQUI EM CIMA porque o modo teste dá `return`
// antes da parte do TikTok, e as rotas precisam disto nos dois modos.
let _siglas = null, _siglasTs = 0;
async function siglasConhecidas() {
  if (_siglas && Date.now() - _siglasTs < 300000) return _siglas;
  try {
    const us = await SB.seleciona('usuarios', 'select=sigla&papel=eq.vendedora');
    _siglas = (us || []).map((u) => String(u.sigla || '').trim()).filter(Boolean);
    _siglasTs = Date.now();
  } catch (e) {}
  return _siglas || [];
}
// grava a venda no historico (Supabase). Nao trava o fluxo se der erro/estiver off.
function gravaVendaHistorico(v) {
  if (!SB.ativo()) return;
  // sigla POR LOJA: o titulo da live de CADA loja marca a vendedora dela — a
  // venda da Fast sai no nome de quem esta' na Fast, mesmo com a Monaco aberta.
  // Sem sigla no titulo, cai na sigla do login (fluxo antigo) so' se a venda for
  // da loja do painel — melhor sem sigla do que com a sigla errada.
  const lj = v.loja || '';
  const c = lj ? chats[lj] : null;
  let sigla = (c && c.sigla && (Date.now() - c.siglaTs < 12 * 3600000)) ? c.sigla : null;
  if (!sigla) {
    const mesmaLoja = !lj || !lojaAtual || lj === lojaAtual;
    sigla = (mesmaLoja && siglaAtiva && (Date.now() - siglaAtivaTs < 12 * 3600000)) ? siglaAtiva : null;
  }
  const ts = new Date(inicioDaLiveAtual(lj)).toISOString();
  const linha = {
    order_id: String(v.orderId || v.id || ('m' + Date.now() + Math.round(Math.random() * 1e6))),
    sigla: sigla, quem: v.quem || null, produto: v.produto || null,
    valor: (+v.valor || 0) || null, plataforma: v.plataforma || 'tiktok',
    loja: (lj || lojaAtual) || null, ts: ts,
  };
  SB.upsert('vendas', [linha], 'order_id').catch(() => {}); // upsert = nao conta 2x
}
// ofertas relampago NO AR (varias ao mesmo tempo), transmitidas para todos os aparelhos
let ofertas = [];
// automacao da ⚡ ligada por loja (o robo da oferta no PC le isto e dispara sozinho)
let ofertaAuto = {};
// VARIAS lojas; cada loja junta as DUAS contas (TikTok + Shopee) com os produtos
// de cada uma:  lojas['bellini'] = { nome, contas:{tiktok,shopee}, produtos:{tiktok:[],shopee:[]}, ts:{} }
const lojas = {};
// O nome da loja passa SEMPRE pela mesma limpeza (a de lojas.js, que tambem
// batiza os arquivos de login). Sem isso, "Petit Store" digitado no painel e
// "petit-store" gravado pelo login virariam duas lojas diferentes na lista.
function achaLoja(nome) {
  const n = L.limpaNome(nome);
  if (!lojas[n]) lojas[n] = { nome: n, contas: { tiktok: '', shopee: '' }, produtos: { tiktok: [], shopee: [] }, ts: {} };
  return lojas[n];
}
// Reserva do AO VIVO: quando o robo de vendas esta' calado e o console tambem,
// os pedidos/GMV da live atual vem do LiveDash (o worker antigo segue coletando
// 24/7). Casa pela SALA (room_id): o chat sabe em qual sala esta', e o LiveDash
// guarda o room_id de cada live — so' usa se for exatamente A MESMA live. Sem
// sala conhecida, nao chuta (mostrar a live errada e' pior que mostrar zero).
async function liveAtualDoLiveDash(loja, sala) {
  try {
    sala = String(sala || '');
    if (!sala) return null;
    const d = await LD.dados();
    const lives = d.porLoja[String(loja || '').toLowerCase()] || [];
    const l = lives.find((x) => String(x.room_id) === sala);
    if (!l) return null; // o LiveDash ainda nao registrou esta live
    return { gmv: +l.gmv || 0, pedidos: +l.pedidos || 0 };
  } catch (e) { return null; }
}

// qual loja o painel esta mostrando (lojaAtual) — cai na primeira se nao escolheram.
// Nao cria loja nenhuma aqui: senao aparece uma loja vazia na lista.
const LOJA_VAZIA = { nome: '', contas: { tiktok: '', shopee: '' }, produtos: { tiktok: [], shopee: [] }, ts: {} };
function lojaDoPainel() {
  if (lojas[lojaAtual]) return lojas[lojaAtual];
  const nomes = Object.keys(lojas);
  return nomes.length ? lojas[nomes[0]] : LOJA_VAZIA;
}

function limpaOfertas() { // tira do ar as que ja venceram
  const agora = Date.now();
  const antes = ofertas.length;
  ofertas = ofertas.filter((o) => o && o.fim > agora);
  return antes !== ofertas.length;
}

// ---------- registro das lives da Shopee (fica salvo no seu PC) ----------
const ARQ_SHOPEE = path.join(__dirname, 'historico-shopee.json');
let shopeeLives = [];
try { shopeeLives = JSON.parse(fs.readFileSync(ARQ_SHOPEE, 'utf8')); } catch (e) {}
let salvaAgendado = null;
function salvaShopee() {
  if (salvaAgendado) return;
  salvaAgendado = setTimeout(() => {
    salvaAgendado = null;
    fs.writeFile(ARQ_SHOPEE, JSON.stringify(shopeeLives), () => {});
  }, 3000);
}
function liveShopeeAtual() {
  const agora = Date.now();
  let l = shopeeLives[shopeeLives.length - 1];
  // mais de 2h sem nada = live nova
  if (!l || agora - l.fim > 2 * 3600 * 1000) {
    l = { inicio: agora, fim: agora, mensagens: 0 };
    shopeeLives.push(l);
    if (shopeeLives.length > 200) shopeeLives.shift();
  }
  l.fim = agora;
  salvaShopee();
  return l;
}

// Rotas que o ROBÔ usa (mandam dados de máquina). Não têm cookie de navegador;
// quando há senha na nuvem, elas se protegem pelo token (DUOLIVE_TOKEN).
const ROTAS_MAQUINA = ['/venda-auto', '/numeros-tiktok', '/eventos', '/produtos', '/oferta-estado', '/sacolinha'];
// Rotas liberadas sem login (a própria tela de senha e o que ela precisa).
const ROTAS_LIVRES = ['/login', '/entrar', '/favicon.ico'];

function paginaLogin() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DuoLive · Entrar</title>
<style>:root{--bg:#0d0d10;--card:#16161b;--line:#26262e;--text:#ececf1;--accent:#ff5c35;--ok:#4ade80;--flor:#C4738F}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--text);font:14px -apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;overflow:hidden;position:relative}
form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:340px;max-width:92vw;position:relative;z-index:2;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.floresWrap{position:absolute;left:0;right:0;bottom:0;width:100%;z-index:1;pointer-events:none;line-height:0}
h1{font-size:20px;margin-bottom:4px}p{color:#a3a3ad;font-size:12.5px;margin-bottom:8px}
label{display:block;font-size:11px;color:#737373;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px}
select,input{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:11px 13px;font-size:14px;outline:none}
select:focus,input:focus{border-color:var(--accent)}
button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.erro{color:#f87171;font-size:12.5px;margin-top:10px}.aviso{color:var(--ok);font-size:12px;margin-top:8px}</style></head><body>
<form id="f">
<div style="text-align:center;margin-bottom:14px">
<svg viewBox="0 0 200 200" width="104" height="104" role="img" aria-label="DuoLive" style="display:inline-block">
<defs>
<path id="cabeloF" d="M -38,58 C -45,22 -44,-28 -22,-48 C -11,-58 11,-58 22,-48 C 44,-28 45,22 38,58 C 28,66 -28,66 -38,58 Z"/>
<rect id="pescoco" x="-9" y="6" width="18" height="18" rx="6"/>
<ellipse id="rostoF" cx="0" cy="-12" rx="18" ry="23"/>
<path id="corpoF" d="M -35,92 C -37,52 -23,24 0,24 C 23,24 37,52 35,92 Z"/>
<g id="lens"><path d="M0,-80 A80,80 0 0,0 0,80" fill="none" stroke="#FF6B4A" stroke-width="14" stroke-linecap="round"/><path d="M0,-80 A80,80 0 0,1 0,80" fill="none" stroke="#20C4B8" stroke-width="14" stroke-linecap="round"/><circle r="60" fill="none" stroke="#5A5C70" stroke-width="2" opacity="0.6"/></g>
</defs>
<rect x="0" y="0" width="200" height="200" rx="48" fill="#17182B"/>
<use href="#lens" transform="translate(100,100)"/>
<use href="#cabeloF" transform="translate(78,102) scale(0.62)" fill="#D6453C"/><use href="#pescoco" transform="translate(78,102) scale(0.62)" fill="#E8C09A"/><use href="#rostoF" transform="translate(78,102) scale(0.62)" fill="#E8C09A"/><use href="#corpoF" transform="translate(78,102) scale(0.62)" fill="#3B9EA8"/>
<use href="#cabeloF" transform="translate(122,98) scale(0.66)" fill="#CE9E38"/><use href="#pescoco" transform="translate(122,98) scale(0.66)" fill="#E8C09A"/><use href="#rostoF" transform="translate(122,98) scale(0.66)" fill="#E8C09A"/><use href="#corpoF" transform="translate(122,98) scale(0.66)" fill="#C85B8E"/>
<circle cx="156" cy="44" r="12" fill="#FF2E55"/><circle cx="156" cy="44" r="12" fill="none" stroke="#17182B" stroke-width="3"/>
</svg>
<div style="font-size:13px;color:#a3a3ad;margin-top:10px">Seja bem-vinda ao</div>
<div style="font-size:30px;font-weight:700;letter-spacing:-.5px;line-height:1.05">Duo<span style="color:var(--accent)">Live</span></div>
</div>
<p style="text-align:center">Escolha seu nome e entre.</p>
<label>Nome</label><select id="quem"><option>carregando...</option></select>
<label id="lbl">Senha</label>
<input type="password" id="senha" placeholder="Senha" autocomplete="current-password">
<button type="submit">Entrar</button>
<div class="aviso" id="aviso"></div><div class="erro" id="erro"></div></form>
<div class="floresWrap">
<svg viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax meet" width="100%" style="display:block">
<defs>
<g id="daisy"><circle r="7"/><g transform="rotate(0)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g><g transform="rotate(45)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g><g transform="rotate(90)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g><g transform="rotate(135)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g><g transform="rotate(180)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g><g transform="rotate(225)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g><g transform="rotate(270)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g><g transform="rotate(315)"><ellipse cx="0" cy="-15" rx="6" ry="11"/></g></g>
<g id="blossom"><circle r="5"/><g transform="rotate(0)"><circle cx="0" cy="-12" r="8"/></g><g transform="rotate(72)"><circle cx="0" cy="-12" r="8"/></g><g transform="rotate(144)"><circle cx="0" cy="-12" r="8"/></g><g transform="rotate(216)"><circle cx="0" cy="-12" r="8"/></g><g transform="rotate(288)"><circle cx="0" cy="-12" r="8"/></g></g>
<path id="leaf" d="M0,0 C -9,-7 -9,-20 0,-27 C 9,-20 9,-7 0,0 Z"/>
</defs>
<g fill="var(--flor)" opacity="0.28">
<g transform="translate(90,260)"><rect x="-2.5" y="-180" width="5" height="180" rx="2.5"/><use href="#daisy" transform="translate(0,-180) scale(1.1)"/></g>
<g transform="translate(250,260)"><rect x="-2.5" y="-200" width="5" height="200" rx="2.5"/><use href="#blossom" transform="translate(0,-200) scale(1.2)"/></g>
<g transform="translate(430,260)"><rect x="-2.5" y="-185" width="5" height="185" rx="2.5"/><use href="#daisy" transform="translate(0,-185) scale(1.25)"/></g>
<g transform="translate(610,260)"><rect x="-2.5" y="-205" width="5" height="205" rx="2.5"/><use href="#daisy" transform="translate(0,-205) scale(1.15)"/></g>
<g transform="translate(770,260)"><rect x="-2.5" y="-180" width="5" height="180" rx="2.5"/><use href="#blossom" transform="translate(0,-180) scale(1.1)"/></g>
<g transform="translate(940,260)"><rect x="-2.5" y="-200" width="5" height="200" rx="2.5"/><use href="#daisy" transform="translate(0,-200) scale(1.15)"/></g>
<g transform="translate(1110,260)"><rect x="-2.5" y="-185" width="5" height="185" rx="2.5"/><use href="#daisy" transform="translate(0,-185) scale(1.2)"/></g>
</g>
<g fill="var(--flor)" opacity="0.6">
<g transform="translate(170,260)"><rect x="-2.5" y="-150" width="5" height="150" rx="2.5"/><use href="#leaf" transform="translate(0,-85) rotate(38) scale(.85)"/><use href="#blossom" transform="translate(0,-150) scale(1)"/></g>
<g transform="translate(350,260)"><rect x="-2.5" y="-160" width="5" height="160" rx="2.5"/><use href="#daisy" transform="translate(0,-160) scale(1.05)"/></g>
<g transform="translate(520,260)"><rect x="-2.5" y="-140" width="5" height="140" rx="2.5"/><use href="#daisy" transform="translate(0,-140) scale(1)"/></g>
<g transform="translate(690,260)"><rect x="-2.5" y="-155" width="5" height="155" rx="2.5"/><use href="#leaf" transform="translate(0,-90) rotate(-38) scale(.85)"/><use href="#daisy" transform="translate(0,-155) scale(1)"/></g>
<g transform="translate(860,260)"><rect x="-2.5" y="-145" width="5" height="145" rx="2.5"/><use href="#blossom" transform="translate(0,-145) scale(1.05)"/></g>
<g transform="translate(1030,260)"><rect x="-2.5" y="-160" width="5" height="160" rx="2.5"/><use href="#daisy" transform="translate(0,-160) scale(1.05)"/></g>
</g>
<g fill="var(--flor)">
<g transform="translate(40,262)"><rect x="-2" y="-100" width="4" height="100" rx="2"/><use href="#blossom" transform="translate(0,-100) scale(.9)"/></g>
<g transform="translate(110,262)"><rect x="-3" y="-128" width="6" height="128" rx="3"/><use href="#leaf" transform="translate(0,-72) rotate(-36) scale(.85)"/><use href="#daisy" transform="translate(0,-128) scale(1.2)"/></g>
<g transform="translate(210,262)"><rect x="-2" y="-92" width="4" height="92" rx="2"/><use href="#blossom" transform="translate(0,-92) scale(.9)"/></g>
<g transform="translate(290,262)"><rect x="-3" y="-138" width="6" height="138" rx="3"/><use href="#leaf" transform="translate(0,-74) rotate(40) scale(1)"/><use href="#leaf" transform="translate(0,-100) rotate(-36) scale(.85)"/><use href="#daisy" transform="translate(0,-138) scale(1.25)"/></g>
<g transform="translate(390,262)"><rect x="-2" y="-84" width="4" height="84" rx="2"/><use href="#blossom" transform="translate(0,-84) scale(.85)"/></g>
<g transform="translate(470,262)"><rect x="-3" y="-120" width="6" height="120" rx="3"/><use href="#leaf" transform="translate(0,-68) rotate(-40) scale(.9)"/><use href="#daisy" transform="translate(0,-120) scale(1.05)"/></g>
<g transform="translate(560,262)"><rect x="-3" y="-150" width="6" height="150" rx="3"/><use href="#leaf" transform="translate(0,-82) rotate(42) scale(1)"/><use href="#leaf" transform="translate(0,-110) rotate(-38) scale(.85)"/><use href="#daisy" transform="translate(0,-150) scale(1.15)"/></g>
<g transform="translate(640,262)"><rect x="-2" y="-96" width="4" height="96" rx="2"/><use href="#blossom" transform="translate(0,-96) scale(.9)"/></g>
<g transform="translate(730,262)"><rect x="-2" y="-108" width="4" height="108" rx="2"/><use href="#leaf" transform="translate(0,-60) rotate(-34) scale(.8)"/><use href="#blossom" transform="translate(0,-108) scale(.95)"/></g>
<g transform="translate(820,262)"><rect x="-3" y="-134" width="6" height="134" rx="3"/><use href="#leaf" transform="translate(0,-76) rotate(38) scale(.95)"/><use href="#daisy" transform="translate(0,-134) scale(1.15)"/></g>
<g transform="translate(910,262)"><rect x="-2" y="-90" width="4" height="90" rx="2"/><use href="#blossom" transform="translate(0,-90) scale(.85)"/></g>
<g transform="translate(985,262)"><rect x="-3" y="-125" width="6" height="125" rx="3"/><use href="#leaf" transform="translate(0,-70) rotate(-40) scale(.9)"/><use href="#daisy" transform="translate(0,-125) scale(1.05)"/></g>
<g transform="translate(1075,262)"><rect x="-3" y="-142" width="6" height="142" rx="3"/><use href="#leaf" transform="translate(0,-80) rotate(40) scale(.95)"/><use href="#daisy" transform="translate(0,-142) scale(1.15)"/></g>
<g transform="translate(1160,262)"><rect x="-2" y="-98" width="4" height="98" rx="2"/><use href="#blossom" transform="translate(0,-98) scale(.9)"/></g>
</g>
<g fill="var(--flor)" opacity="0.9">
<use href="#leaf" transform="translate(20,262) rotate(-18) scale(.7)"/><use href="#leaf" transform="translate(60,262) rotate(15) scale(.6)"/><use href="#leaf" transform="translate(150,262) rotate(-14) scale(.75)"/><use href="#leaf" transform="translate(240,262) rotate(20) scale(.6)"/><use href="#leaf" transform="translate(330,262) rotate(-20) scale(.7)"/><use href="#leaf" transform="translate(420,262) rotate(16) scale(.65)"/><use href="#leaf" transform="translate(510,262) rotate(-15) scale(.75)"/><use href="#leaf" transform="translate(600,262) rotate(18) scale(.6)"/><use href="#leaf" transform="translate(680,262) rotate(-18) scale(.7)"/><use href="#leaf" transform="translate(770,262) rotate(14) scale(.65)"/><use href="#leaf" transform="translate(860,262) rotate(-16) scale(.75)"/><use href="#leaf" transform="translate(945,262) rotate(20) scale(.6)"/><use href="#leaf" transform="translate(1025,262) rotate(-15) scale(.7)"/><use href="#leaf" transform="translate(1110,262) rotate(17) scale(.65)"/><use href="#leaf" transform="translate(1180,262) rotate(-16) scale(.7)"/>
</g>
<g stroke="var(--flor)" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.8">
<path d="M85,262 C 87,235 82,215 90,198"/><path d="M320,262 C 318,232 324,212 316,194"/><path d="M505,262 C 507,238 502,218 510,202"/><path d="M715,262 C 713,234 719,214 711,198"/><path d="M905,262 C 907,236 902,216 910,200"/><path d="M1055,262 C 1053,232 1059,212 1051,196"/>
</g>
</svg>
</div>
<script>
var pessoas=[];
fetch('/usuarios-login').then(function(r){return r.json();}).then(function(l){
  pessoas=l||[];var s=document.getElementById('quem');s.innerHTML='';
  pessoas.forEach(function(u){var o=document.createElement('option');o.value=u.sigla;o.textContent=u.rotulo;s.appendChild(o);});
  aviso();
}).catch(function(){document.getElementById('erro').textContent='Não consegui carregar os nomes.';});
function achou(){var v=document.getElementById('quem').value;return pessoas.filter(function(u){return u.sigla===v;})[0];}
function aviso(){var u=achou(),a=document.getElementById('aviso'),l=document.getElementById('lbl'),s=document.getElementById('senha');
  if(u&&u.primeiroAcesso){a.textContent='Primeiro acesso — a senha que digitar será a sua a partir de agora.';l.textContent='Crie sua senha';s.placeholder='Nova senha';}
  else{a.textContent='';l.textContent='Senha';s.placeholder='Senha';}}
document.getElementById('quem').onchange=aviso;
document.getElementById('f').onsubmit=function(e){e.preventDefault();document.getElementById('erro').textContent='';
  fetch('/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sigla:document.getElementById('quem').value,senha:document.getElementById('senha').value})})
  .then(function(r){return r.json();}).then(function(v){if(v&&v.ok){location.href='/painel';}else{document.getElementById('erro').textContent=(v&&v.erro)||'Não consegui entrar.';}})
  .catch(function(){document.getElementById('erro').textContent='Erro de conexão.';});};
</script></body></html>`;
}

const server = http.createServer((req, res) => {
  // deixa o analytics (que roda no site) buscar as vendas aqui do seu PC
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-duolive-token');
  if (req.method === 'OPTIONS') { res.end(); return; }

  const caminhoLimpo = req.url.split('?')[0];

  // saúde: o Render bate aqui para saber se o serviço está no ar. Sempre 200, sem senha.
  if (caminhoLimpo === '/saude') { res.setHeader('content-type', 'text/plain'); res.end('ok'); return; }

  // ---- porteiro: com o sistema de contas (Supabase) cada pessoa entra na sua.
  //      Acesso LOCAL (robô, OBS) e o robô com token passam livres. ----
  const usaContas = SB.ativo();
  if (usaContas || AUTH.protegido()) {
    // menu de nomes para a tela de login (livre)
    if (caminhoLimpo === '/usuarios-login') {
      res.setHeader('content-type', 'application/json');
      if (!usaContas) { res.end('[]'); return; }
      CONTAS.listaParaLogin()
        .then((l) => res.end(JSON.stringify(l.map((u) => ({ sigla: u.sigla, rotulo: u.rotulo, primeiroAcesso: u.primeiroAcesso })))))
        .catch(() => { res.statusCode = 500; res.end('[]'); });
      return;
    }
    // login: {sigla, senha} (novo, por conta). Sem contas, cai na senha única antiga.
    if (caminhoLimpo === '/entrar' && req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (usaContas) {
          let b = {}; try { b = JSON.parse(corpo); } catch (e) {}
          CONTAS.entrar(b.sigla, b.senha).then((r) => {
            if (r.ok) {
              res.setHeader('Set-Cookie', AUTH.COOKIE + '=' + encodeURIComponent(CONTAS.criaToken(r.usuario)) + '; Path=/; Max-Age=' + (30 * 86400) + '; HttpOnly; SameSite=Lax');
              res.end(JSON.stringify({ ok: true, primeiroAcesso: !!r.primeiroAcesso }));
            } else { res.statusCode = 200; res.end(JSON.stringify({ ok: false, erro: r.erro })); }
          }).catch(() => { res.statusCode = 500; res.end('{"ok":false,"erro":"erro no servidor"}'); });
        } else {
          const senha = decodeURIComponent(String((corpo.match(/senha=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
          if (AUTH.senhaConfere(senha)) { res.setHeader('Set-Cookie', AUTH.cookieSet()); res.statusCode = 302; res.setHeader('Location', '/painel'); res.end(); }
          else { res.statusCode = 401; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(paginaLogin()); }
        }
      });
      return;
    }
    if (caminhoLimpo === '/login') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(paginaLogin()); return; }
    if (caminhoLimpo === '/sair') {
      res.setHeader('Set-Cookie', AUTH.COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      res.statusCode = 302; res.setHeader('Location', '/login'); res.end(); return;
    }

    // quem está logado (sessão de conta); guarda no req para as rotas saberem o papel
    req.usuario = usaContas ? CONTAS.leToken(AUTH.cookieDoPedido(req)) : null;
    const livre = ['/login', '/usuarios-login', '/entrar', '/sair', '/favicon.ico'].includes(caminhoLimpo);
    const local = !AUTH.veioDeFora(req);           // acesso do próprio PC (robô, OBS)
    const eRobo = AUTH.temTokenValido(req);         // robô mandando dados para a nuvem
    const logado = usaContas ? !!req.usuario : AUTH.autenticado(req);
    if (!livre && !local && !eRobo && !logado) {
      const querPagina = (req.headers.accept || '').includes('text/html');
      if (querPagina) { res.statusCode = 302; res.setHeader('Location', '/login'); res.end(); }
      else { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end('{"erro":"nao autenticado"}'); }
      return;
    }
  }

  // quem esta' logado (o painel mostra o nome + botao Sair). De quebra, marca a
  // sigla da vendedora como "ativa na live" — as vendas do robo saem no nome dela.
  if (req.url.split('?')[0] === '/eu') {
    res.setHeader('content-type', 'application/json');
    const u = req.usuario || null;
    if (!u) { res.end('{}'); return; }
    if (u.papel === 'vendedora' && u.sigla) { siglaAtiva = u.sigla; siglaAtivaTs = Date.now(); }
    // busca o nome ATUAL no banco: o cracha (cookie) pode ter um nome antigo, ex.
    // depois de renomear a vendedora. Assim o painel mostra o nome certo sem relogar.
    if (SB.ativo() && u.sigla) {
      SB.seleciona('usuarios', 'sigla=eq.' + encodeURIComponent(u.sigla) + '&select=nome,papel&limit=1')
        .then((r) => { const a = r && r[0]; res.end(JSON.stringify({ sigla: u.sigla, nome: (a && a.nome) || u.nome, papel: (a && a.papel) || u.papel })); })
        .catch(() => res.end(JSON.stringify({ sigla: u.sigla, nome: u.nome, papel: u.papel })));
      return;
    }
    res.end(JSON.stringify({ sigla: u.sigla, nome: u.nome, papel: u.papel }));
    return;
  }

  // historico de vendas para a pagina /historico — ESPELHO do LiveDash: reflete
  // o que o LiveDash coletou (cada live = uma barra, valor = GMV, sigla pelo
  // titulo). Se o LiveDash estiver fora/nao configurado, cai no nosso banco
  // (Supabase `vendas`) como reserva. Permissoes iguais nas duas fontes:
  // vendedora ve so' as dela; ADM (ou acesso local do PC) ve todas.
  if (req.url.split('?')[0] === '/vendas-historico') {
    res.setHeader('content-type', 'application/json');
    const qs = new URLSearchParams((req.url.split('?')[1] || ''));
    // 'desde' (data ISO) manda: usado por Mês (1º do mês) e Total (desde sempre).
    // Sem ele, cai no 'dias' (janela rolante) para Hoje/7 dias.
    let corte;
    const desdeP = qs.get('desde');
    if (desdeP && !isNaN(Date.parse(desdeP))) corte = new Date(desdeP).toISOString();
    else { const dias = Math.min(400, Math.max(1, +qs.get('dias') || 7)); corte = new Date(Date.now() - dias * 86400000).toISOString(); }
    const u = req.usuario || null;
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(u);
    const soSigla = (u && u.papel === 'vendedora' && u.sigla) ? u.sigla : null;
    (async () => {
      let vendas = null, coresLD = null, fonte = 'livedash';
      if (LD.ativo()) {
        try {
          const siglas = SB.ativo() ? await siglasConhecidas() : [];
          const esp = await LD.espelho(siglas);
          coresLD = esp.cores;
          vendas = esp.vendas.filter((v) => v.ts >= corte && (!soSigla || v.sigla === soSigla));
        } catch (e) { console.log('  (espelho LiveDash falhou: ' + ((e && e.message) || e) + ' — usando o banco proprio)'); vendas = null; }
      }
      if (!vendas) { // reserva: nosso banco proprio
        if (!SB.ativo()) { res.end('{"ok":false,"erro":"livedash e supabase off"}'); return; }
        fonte = 'banco';
        let filtro = 'ts=gte.' + corte + '&select=sigla,quem,produto,valor,plataforma,loja,ts&order=ts.desc&limit=5000';
        if (soSigla) filtro += '&sigla=eq.' + encodeURIComponent(soSigla);
        vendas = (await SB.seleciona('vendas', filtro)) || [];
      }
      // cores: as do LiveDash (pessoas extras: Luana, Isa, Gravadas...) por baixo,
      // as do NOSSO cadastro (usuarios) por cima — os hex que o ADM escolheu ganham.
      const cores = Object.assign({}, coresLD || {});
      if (SB.ativo()) {
        try { (await SB.seleciona('usuarios', 'select=sigla,nome,cor')).forEach((x) => { cores[x.sigla] = { nome: x.nome, cor: x.cor }; }); } catch (e) {}
      }
      res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, minhaSigla: u ? u.sigla : null, papel: u ? u.papel : null, vendas: vendas, cores: cores, fonte: fonte }));
    })().catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    return;
  }

  // ---------- horas de live por vendedora HOJE (meta diária de horas) ----------
  if (req.url.split('?')[0] === '/horas-vendedoras') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    (async () => {
      if (!LD.ativo()) { res.end('{"ok":false,"erro":"livedash off","vendedoras":[]}'); return; }
      const u = req.usuario || null;
      const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(u);
      const soSigla = (!ehAdm && u && u.papel === 'vendedora' && u.sigla) ? u.sigla : null; // vendedora vê só a DELA
      const siglas = SB.ativo() ? await siglasConhecidas() : [];
      const periodo = new URLSearchParams((req.url.split('?')[1] || '')).get('periodo') || 'hoje';
      const r = await LD.horasPeriodo(siglas, periodo);
      // nome/cor do NOSSO cadastro (usuarios) por cima — o que o ADM escolheu ganha
      if (SB.ativo()) {
        try {
          const map = {}; (await SB.seleciona('usuarios', 'select=sigla,nome,cor')).forEach((x) => { map[x.sigla] = x; });
          r.vendedoras.forEach((v) => { const c = map[v.sigla]; if (c) { v.nome = c.nome || v.nome; v.cor = c.cor || v.cor; } });
        } catch (e) {}
      }
      if (soSigla) r.vendedoras = r.vendedoras.filter((v) => v.sigla === soSigla); // vendedora só vê a própria meta
      r.ehAdm = ehAdm;
      res.end(JSON.stringify(r));
    })().catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e), vendedoras: [] })); });
    return;
  }

  // ---------- Lojas fixas (Monaco/Fast/Mania/Bellini + @). Iguais p/ todos; só o ADM edita ----------
  if (req.url.split('?')[0] === '/lojas-fixas' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    const PADRAO = [
      { nome: 'Monaco', tiktok: 'tokdecor12', shopee: null, ordem: 1 },
      { nome: 'Fast', tiktok: 'fasthome46', shopee: null, ordem: 2 },
      { nome: 'Mania', tiktok: 'maniadicasa24', shopee: null, ordem: 3 },
      { nome: 'Bellini', tiktok: 'bellacasa56', shopee: null, ordem: 4 },
    ];
    if (!SB.ativo()) { res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, lojas: PADRAO })); return; }
    SB.seleciona('lojas', 'select=nome,tiktok,shopee,ordem&order=ordem,nome')
      .then((l) => res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, lojas: (l && l.length) ? l : PADRAO })))
      .catch(() => res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, lojas: PADRAO }))); // tabela ainda não criada
    return;
  }
  if ((req.url.startsWith('/lojas-fixas-remover') || req.url.split('?')[0] === '/lojas-fixas') && req.method === 'POST') {
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    if (!ehAdm) { res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"erro":"So o ADM edita as lojas."}'); return; }
    if (!SB.ativo()) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"erro":"Supabase off."}'); return; }
    const remover = req.url.startsWith('/lojas-fixas-remover');
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(corpo); } catch (e) { b = null; }
      res.setHeader('content-type', 'application/json');
      const nome = b && String(b.nome || '').trim();
      if (!nome) { res.statusCode = 400; res.end('{"ok":false,"erro":"faltou o nome da loja"}'); return; }
      const acao = remover
        ? SB.req('DELETE', 'lojas?nome=eq.' + encodeURIComponent(nome))
        : SB.upsert('lojas', [{ nome: nome, tiktok: (b.tiktok || '').trim() || null, shopee: (b.shopee || '').trim() || null }], 'nome');
      acao.then(() => res.end('{"ok":true}')).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    });
    return;
  }

  // recebe as mensagens do chat da Shopee (mandadas pelo espião que roda no navegador)
  if (req.url.startsWith('/eventos') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const ev = JSON.parse(corpo);
        const texto = String(ev.texto || '').slice(0, 300).trim();
        const quem = String(ev.quem || '').slice(0, 60).trim();
        if (texto) {
          emitir({ tipo: 'mensagem', quem: quem, texto: texto, plataforma: 'shopee' });
          liveShopeeAtual().mensagens++;
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // 🛍️ a SACOLINHA: quem esta' de olho num produto (o robo manda). Sai no multichat
  // carimbado com a loja, como "Fulana esta' de olho em [produto]".
  if (req.url.startsWith('/sacolinha') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(corpo);
        const quem = String(b.quem || '').slice(0, 60).trim();
        const produto = String(b.produto || '').slice(0, 80).trim();
        const lj = b.loja ? L.limpaNome(b.loja) : '';
        if (quem) emitir(comLoja(lj, { tipo: 'sacolinha', quem: quem, produto: produto, carrinho: !!b.carrinho }));
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // venda detectada automaticamente pelo robo de vendas (cookies) — POST /venda-auto
  if (req.url.startsWith('/venda-auto') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const v = JSON.parse(corpo);
        const id = String(v.orderId || v.id || '').trim();
        if (id && !vendasAutoIds.has(id)) {
          vendasAutoIds.add(id);
          const plataforma = v.plataforma === 'tiktok' ? 'tiktok' : 'shopee';
          const valor = +v.valor || 0;
          const quem = String(v.quem || '').slice(0, 60).trim();
          const venda = { valor: valor, plataforma: plataforma, quem: quem, ts: Date.now(), auto: true, orderId: id, produto: v.produto || '', loja: (v.loja ? L.limpaNome(v.loja) : lojaAtual) || '' };
          vendasAuto.push(venda);
          gravaVendaHistorico(venda); // salva no historico (Supabase), com a sigla e o inicio da live
          if (plataforma === 'shopee') liveShopeeAtual();
          // aparece no Multichat na hora, com quem comprou e o valor (carimbada
          // com a loja: cada painel mostra so' as vendas da loja dele)
          const prodTxt = String(v.produto || '').replace(/\s+/g, ' ').slice(0, 38).trim();
          emitir(comLoja(venda.loja, { tipo: 'venda', quem: quem || 'Venda', valor: valor, produto: prodTxt, texto: 'comprou' + (prodTxt ? ' ' + prodTxt : '') + (valor ? ' · R$ ' + valor.toFixed(2).replace('.', ',') : ''), plataforma: plataforma }));
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // seletor de lojas: troca a conta do TikTok que o chat esta lendo
  if (req.url.startsWith('/conta')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          const lj = b.loja != null ? L.limpaNome(b.loja || '') : '';
          if (b.loja != null && lj) lojaAtual = lj; // reserva p/ chamadas antigas sem ?loja
          // liga o chat DESTA loja sem mexer nas outras (4 lojas abertas ao mesmo tempo)
          ligarConta(b.tiktok || b.conta || '', lj);
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    const qsc = new URLSearchParams((req.url.split('?')[1] || ''));
    const ljc = qsc.get('loja') != null ? L.limpaNome(qsc.get('loja') || '') : lojaAtual;
    const stc = chatDe(ljc);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ usuario: stc.usuario, aoVivo: stc.aoVivo, loja: ljc || undefined }));
    return;
  }

  // recebe os numeros oficiais do console de lives do TikTok (robo Compass por cookies)
  if (req.url.startsWith('/numeros-tiktok') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(corpo);
        const loja = String(b.loja || lojaAtual || '?');
        compassPorLoja[loja] = { gmv: +b.gmv || 0, orders: +b.orders || 0, views: +b.views || 0, live: !!b.live, ts: Date.now() };
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // quais lojas estao em live agora (o robo do console marca) — o painel usa para focar sozinho
  if (req.url.split('?')[0] === '/lojas-live') {
    const agora = Date.now();
    const lista = Object.keys(compassPorLoja).map((loja) => {
      const c = compassPorLoja[loja];
      const fresco = c.ts && (agora - c.ts < 15 * 60000);
      return { loja: loja, live: !!(fresco && c.live), gmv: c.gmv, orders: c.orders, views: c.views };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(lista));
    return;
  }

  // painel AO VIVO: numeros em tempo real da conta ativa
  // (vendas separadas por app; pedidos e curtidas somados)
  if (req.url.startsWith('/ao-vivo')) {
    // qual loja? o painel manda ?loja=; sem ela, cai na ultima escolhida (fluxo antigo)
    const qsav = new URLSearchParams((req.url.split('?')[1] || ''));
    const lj = qsav.get('loja') != null ? L.limpaNome(qsav.get('loja') || '') : lojaAtual;
    const st = chatDe(lj);
    // so' as vendas desta loja (cada venda automatica vem marcada com a loja)
    const todas = vendasAnotadas.concat(vendasAuto).filter((v) => !v.loja || !lj || v.loja === lj);
    // corte = inicio da live; mas NUNCA esconde uma venda ja capturada desta loja: o
    // robo costuma mandar venda ANTES do chat conectar, entao puxa o corte pra tras
    // ate a venda mais antiga recente (<6h) desta loja.
    let desde = st.liveEstado.inicio || 0;
    if (desde) {
      const limite = Date.now() - 6 * 3600000;
      for (const v of todas) { const t = v.ts || 0; if (t >= limite && t < desde) desde = t; }
    }
    const daLive = todas.filter((v) => !desde || (v.ts || 0) >= desde);
    const tik = { n: 0, t: 0 }, sho = { n: 0, t: 0 };
    daLive.forEach((v) => {
      const d = v.plataforma === 'tiktok' ? tik : sho;
      d.n++; d.t += v.valor || 0;
    });
    // numeros do console (Compass) desta loja, se recentes (<15min): sao os oficiais do TikTok
    const c = compassPorLoja[lj] || null;
    const compassFresco = !!(c && c.ts && (Date.now() - c.ts < 15 * 60000));
    (async () => {
      let totalTiktok = compassFresco ? c.gmv : tik.t;
      let pedidosTiktok = compassFresco ? c.orders : tik.n;
      let fonte = compassFresco ? 'console' : 'chat';
      // robo calado e console mudo? a live atual vem do LiveDash (que segue coletando)
      if (!compassFresco && !tik.n && lj && LD.ativo()) {
        const lv = await liveAtualDoLiveDash(lj, st.liveEstado.roomId);
        if (lv && (lv.pedidos || lv.gmv)) { totalTiktok = lv.gmv; pedidosTiktok = lv.pedidos; fonte = 'livedash'; }
      }
      // espectadores: o do chat; se 0 e o Compass tem views, mostra as views do console
      const espectadores = st.liveEstado.espectadores || (compassFresco ? c.views : 0);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        usuario: st.usuario, aoVivo: st.aoVivo, loja: lj || undefined,
        espectadores: espectadores, likes: st.liveEstado.likes,
        inicio: st.liveEstado.inicio,
        totalTiktok: totalTiktok, totalShopee: sho.t,
        pedidosTiktok: pedidosTiktok, pedidosShopee: sho.n,
        pedidos: pedidosTiktok + sho.n,
        total: totalTiktok + sho.t,
        vendas: pedidosTiktok + sho.n, // compatibilidade com versoes antigas do painel
        fonte: fonte,
      }));
    })().catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String((e && e.message) || e) })); });
    return;
  }

  // produtos das lojas, lidos por cookies pelo robo de produtos
  // POST { plataforma, produtos:[{id,nome,preco,sku,imagem}] }  ·  GET -> {tiktok:[],shopee:[],ts:{}}
  if (req.url.startsWith('/produtos')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4e6) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          const plat = b.plataforma === 'tiktok' ? 'tiktok' : 'shopee';
          // as duas contas pertencem a MESMA loja (ex.: Bellini no TikTok e na Shopee)
          const loja = achaLoja(b.loja);
          if (b.conta) loja.contas[plat] = String(b.conta).slice(0, 60);
          if (Array.isArray(b.produtos)) {
            loja.produtos[plat] = b.produtos.slice(0, 3000);
            loja.ts[plat] = Date.now();
            console.log('  📦 ' + loja.nome + ' · ' + plat + (b.conta ? ' (' + b.conta + ')' : '')
              + ': ' + loja.produtos[plat].length + ' produto(s).');
          }
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    // GET /produtos            -> os da loja que o painel esta mostrando
    // GET /produtos?loja=xxx   -> os de uma loja especifica
    const qs = new URLSearchParams((req.url.split('?')[1] || ''));
    const l = qs.get('loja') ? achaLoja(qs.get('loja')) : lojaDoPainel();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tiktok: l.produtos.tiktok, shopee: l.produtos.shopee, ts: l.ts, loja: l }));
    return;
  }

  // TODAS as lojas: cada uma com as duas contas (TikTok + Shopee) vinculadas.
  // A lista junta duas coisas: as lojas que ja tiveram os produtos lidos e as
  // que tem LOGIN guardado neste PC — assim, assim que voce faz o login de uma
  // loja ela ja aparece no seletor 🏪, sem precisar digitar o nome de novo.
  // caminho EXATO: senao esta rota engoliria /lojas-conectadas e /lojas-live
  if (req.url.split('?')[0] === '/lojas') {
    const mapa = {};
    Object.values(lojas).forEach((l) => {
      mapa[l.nome] = {
        nome: l.nome, contas: l.contas,
        produtos: { tiktok: l.produtos.tiktok.length, shopee: l.produtos.shopee.length },
        login: { tiktok: false, shopee: false, console: false },
      };
    });
    let comLogin = [];
    try { comLogin = L.resumoDasLojas(); } catch (e) {}
    comLogin.forEach((r) => {
      if (!mapa[r.loja]) {
        mapa[r.loja] = {
          nome: r.loja, contas: { tiktok: '', shopee: '' },
          produtos: { tiktok: 0, shopee: 0 }, login: {},
        };
      }
      mapa[r.loja].login = { tiktok: r.tiktok, shopee: r.shopee, console: r.console };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      // 'selecionada' e' o que voce escolheu no seletor 🏪, mesmo que essa loja
      // ainda nao tenha produtos carregados. E' por ela que os robos se guiam.
      selecionada: lojaAtual,
      atual: lojaDoPainel().nome,
      lojas: Object.values(mapa),
    }));
    return;
  }

  // ---------- conectar loja por cookies (a pagina /conectar) ----------
  // Voce ja esta logado nas lojas no SEU Chrome. Em vez de abrir outro navegador
  // e pedir senha, voce copia a requisicao (Copy as cURL) e cola la'. Daqui sai
  // uma sessao no mesmo formato de sempre, entao os robos nao mudam em nada.

  // as lojas do arquivo minhas-lojas.txt (para o seletor da pagina)
  if (req.url.startsWith('/minhas-lojas')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ lojas: L.minhasLojas() }));
    return;
  }

  // o que ja esta conectado, e ha quanto tempo
  if (req.url.startsWith('/lojas-conectadas')) {
    const saida = L.minhasLojas().map((loja) => {
      const item = { loja: loja };
      ['tiktok', 'shopee', 'console'].forEach((p) => {
        const arq = L.arquivoSessao(p, loja);
        try {
          const st = fs.statSync(arq);
          item[p] = { ts: st.mtimeMs };
        } catch (e) { item[p] = null; }
      });
      return item;
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ lojas: saida }));
    return;
  }

  if (req.url.startsWith('/conectar-loja') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 2e6) req.destroy(); });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      try {
        const b = JSON.parse(corpo);
        const plat = ['tiktok', 'shopee', 'console'].includes(b.plataforma) ? b.plataforma : 'tiktok';
        const loja = L.limpaNome(b.loja);
        const lido = COOKIES.entende(b.texto, plat);
        COOKIES.confere(lido, plat); // copiou a requisicao da loja certa?
        const sessao = COOKIES.paraSessao(lido, plat);

        const arq = path.join(__dirname, 'sessao-' + plat + '-' + loja + '.json');
        fs.writeFileSync(arq, JSON.stringify(sessao));

        // guarda tambem a chamada capturada (URL, cabecalhos, corpo). Ainda nao e'
        // usada pelos robos, mas e' o que vai permitir ler os pedidos sem navegador.
        if (lido.url) {
          try {
            fs.writeFileSync(path.join(__dirname, 'chamada-' + plat + '-' + loja + '.json'),
              JSON.stringify({ url: lido.url, metodo: lido.metodo, cabecalhos: lido.cabecalhos, corpo: lido.corpo, ts: Date.now() }, null, 1));
          } catch (e) {}
        }
        console.log('  🔌 ' + loja + ' · ' + plat + ': ' + sessao.cookies.length + ' cookie(s) conectados (' + lido.origem + ').');
        res.end(JSON.stringify({ ok: true, loja: loja, plataforma: plat, cookies: sessao.cookies.length }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, erro: String((e && e.message) || e).slice(0, 200) }));
      }
    });
    return;
  }

  // apagar uma loja da lista (o 🗑 do seletor no painel).
  // So' tira daqui da memoria: os arquivos de login continuam no disco, entao
  // ninguem perde acesso a loja por engano — para sumir de vez, apague o
  // sessao-*-<loja>.json (ou use o proprio painel de novo depois do login).
  if (req.url.startsWith('/apagar-loja') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
    req.on('end', () => {
      let apagada = '';
      try {
        const b = JSON.parse(corpo);
        const n = L.limpaNome(b.loja);
        if (lojas[n]) { delete lojas[n]; apagada = n; }
        if (lojaAtual === n) lojaAtual = '';
        ofertas = ofertas.filter((o) => String(o.loja || '') !== n);
        if (apagada) console.log('  🗑  loja "' + apagada + '" tirada da lista.');
      } catch (e) {}
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, apagada: apagada }));
    });
    return;
  }

  // a loja que o painel esta mostrando (as duas contas vistas como uma coisa so')
  if (req.url.startsWith('/minha-loja')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          const l = achaLoja(b.loja || lojaDoPainel().nome);
          // o nome passa pela mesma limpeza da chave, senao a loja apareceria
          // duas vezes na lista (uma do painel, outra do login)
          if (b.nome != null) l.nome = L.limpaNome(b.nome);
          if (b.tiktok != null) l.contas.tiktok = String(b.tiktok).slice(0, 60);
          if (b.shopee != null) l.contas.shopee = String(b.shopee).slice(0, 60);
          if (b.selecionar) lojaAtual = l.nome;
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    const qs2 = new URLSearchParams((req.url.split('?')[1] || ''));
    const l = qs2.get('loja') ? achaLoja(qs2.get('loja')) : lojaDoPainel();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      nome: l.nome, contas: l.contas,
      produtos: { tiktok: l.produtos.tiktok.length, shopee: l.produtos.shopee.length },
      todas: Object.keys(lojas),
    }));
    return;
  }

  // ---------- Descontos fixos (conjunto + exceção), salvos no Supabase ----------
  // O ADM configura no painel e FICA salvo até mudar. Conjunto (sku vazio) vale para
  // todas as estampas; exceção (com sku) sobrepõe UMA estampa. Vendedora só enxerga.
  if (req.url.startsWith('/descontos') && req.method === 'GET') {
    const qs = new URLSearchParams((req.url.split('?')[1] || ''));
    const loja = qs.get('loja') || lojaAtual || '';
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    res.setHeader('content-type', 'application/json');
    OFERTAS.listar(loja)
      .then((l) => res.end(JSON.stringify({ ok: true, loja: loja, ehAdm: ehAdm, descontos: l })))
      .catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    return;
  }
  if ((req.url.startsWith('/desconto-salvar') || req.url.startsWith('/desconto-remover')) && req.method === 'POST') {
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    if (!ehAdm) { res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"erro":"So o ADM edita os descontos."}'); return; }
    const remover = req.url.startsWith('/desconto-remover');
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(corpo); } catch (e) { b = null; }
      res.setHeader('content-type', 'application/json');
      if (!b || !b.loja || !b.produto_id) { res.statusCode = 400; res.end('{"ok":false,"erro":"faltou loja/produto"}'); return; }
      const acao = remover ? OFERTAS.remover(b) : OFERTAS.salvar(b);
      acao.then(() => res.end('{"ok":true}'))
        .catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    });
    return;
  }

  // interruptor da AUTOMACAO da ⚡ por loja: o ADM liga/desliga no painel; o robo
  // da oferta no PC le isto (GET) e so' dispara quando estiver ligado.
  if (req.url.startsWith('/oferta-auto')) {
    if (req.method === 'POST') {
      const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
      if (!ehAdm) { res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"erro":"So o ADM liga/desliga a automacao."}'); return; }
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        let b; try { b = JSON.parse(corpo); } catch (e) { b = null; }
        res.setHeader('content-type', 'application/json');
        if (!b || !b.loja) { res.statusCode = 400; res.end('{"ok":false,"erro":"faltou a loja"}'); return; }
        ofertaAuto[String(b.loja)] = !!b.ligado;
        emitir({ tipo: 'oferta-auto', loja: String(b.loja), ligado: !!b.ligado });
        console.log('  ⚡ automacao ' + (b.ligado ? 'LIGADA' : 'desligada') + ' na loja ' + b.loja);
        res.end(JSON.stringify({ ok: true, loja: String(b.loja), ligado: !!b.ligado }));
      });
      return;
    }
    const qs = new URLSearchParams((req.url.split('?')[1] || ''));
    const loja = qs.get('loja') || '';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ loja: loja, ligado: !!ofertaAuto[loja] }));
    return;
  }

  // o robo da oferta conta como foi (aplicada / ensaio / erro / restaurada)
  if (req.url.startsWith('/oferta-estado') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(corpo);
        const o = ofertas.find((x) => x.id === b.id);
        if (o) {
          o.estado = String(b.estado || '').slice(0, 20);
          o.erro = String(b.erro || '').slice(0, 120);
          emitir({ tipo: 'oferta', ofertas: ofertas, oferta: ofertas[0] || null });
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // ofertas relampago ao vivo (VARIAS ao mesmo tempo), compartilhadas entre aparelhos.
  // POST aceita uma lista (novo) ou uma oferta so' (painel antigo). GET devolve a lista.
  if (req.url.startsWith('/oferta')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          // Cada oferta pertence a UMA loja (o produto e o preco sao de la').
          // O painel so' conhece as ofertas da loja que ele esta' mostrando, entao
          // trocamos apenas as dessa loja e preservamos as das outras — senao a
          // loja A apagaria as ofertas da loja B ao mandar a lista dela.
          const dono = String(lojaAtual || '');
          const deOutrasLojas = ofertas.filter((o) => String(o.loja || '') !== dono);
          let novas = [];
          if (Array.isArray(b)) novas = b.filter((o) => o && o.nome && o.fim > Date.now());
          else if (b && b.nome) novas = [b];
          novas.forEach((o) => { o.loja = dono; });
          ofertas = deOutrasLojas.concat(novas);
          emitir({ tipo: 'oferta', ofertas: novas, oferta: novas[0] || null, loja: dono });
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    limpaOfertas();
    res.setHeader('content-type', 'application/json');
    // so' as ofertas da loja pedida (?loja=) ou da que o painel esta' mostrando.
    // Sem loja nenhuma escolhida, devolve tudo (uma loja so' funciona como antes).
    const qs3 = new URLSearchParams((req.url.split('?')[1] || ''));
    const pedida = qs3.has('loja') ? qs3.get('loja') : lojaAtual;
    const minhas = pedida ? ofertas.filter((o) => String(o.loja || '') === String(pedida)) : ofertas;
    // /ofertas -> lista (novo)   ·   /oferta -> a primeira (compatibilidade)
    const querLista = req.url.split('?')[0] === '/ofertas';
    res.end(JSON.stringify(querLista ? minhas : (minhas[0] || null)));
    return;
  }

  if (req.url.startsWith('/vendas')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const v = JSON.parse(corpo);
          if (Array.isArray(v)) {
            vendasAnotadas = v;
            // venda da Shopee agorinha = a live da Shopee esta rolando
            const agora = Date.now();
            if (v.some((x) => x.plataforma !== 'tiktok' && agora - (x.ts || 0) < 60000)) liveShopeeAtual();
          }
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    // GET: junta as manuais (do Multichat) com as automaticas (do robo)
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(vendasAnotadas.concat(vendasAuto)));
    return;
  }

  // numeros oficiais capturados pelo robo da Shopee (npm run robo-shopee)
  if (req.url.startsWith('/shopee-oficial')) {
    fs.readFile(path.join(__dirname, 'historico-shopee-oficial.json'), (e, d) => {
      res.setHeader('content-type', 'application/json');
      res.end(e ? '[]' : d);
    });
    return;
  }

  // historico das lives da Shopee para o Analytics (mensagens + vendas anotadas por live)
  if (req.url.startsWith('/shopee-lives')) {
    const folga = 30 * 60 * 1000;
    const todas = vendasAnotadas.concat(vendasAuto);
    const lives = shopeeLives.map((l) => {
      const vs = todas.filter((v) => v.plataforma !== 'tiktok' && v.ts >= l.inicio - folga && v.ts <= l.fim + folga);
      let total = 0; vs.forEach((v) => { total += v.valor || 0; });
      return { inicio: l.inicio, fim: l.fim, mensagens: l.mensagens, vendas: vs.length, total: total };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(lives));
    return;
  }

  // painel completo em UMA URL: /painel mostra Analytics + Ofertas + Multichat juntos
  // (as outras entradas servem os pedacos que o painel usa, tudo do mesmo endereco)
  const ESTATICOS = {
    '/painel': 'index.html',
    '/index.html': 'index.html',
    '/analytics.html': 'analytics.html',
    '/sacolinha-controle.html': 'sacolinha-controle.html',
    '/historico': 'historico.html',
    '/historico.html': 'historico.html',
    '/conectar': 'conectar.html',
    '/conectar.html': 'conectar.html',
    '/lib/xlsx.min.js': 'lib/xlsx.min.js',
  };
  const caminho = req.url.split('?')[0];
  if (ESTATICOS[caminho]) {
    fs.readFile(path.join(__dirname, '..', ESTATICOS[caminho]), (err, corpo) => {
      if (err) { res.statusCode = 404; res.end('arquivo nao encontrado'); return; }
      res.setHeader('content-type', caminho.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache'); // pega sempre a versao nova apos um deploy
      res.end(corpo);
    });
    return;
  }

  const arq = path.join(__dirname, '..', 'multichat.html');
  fs.readFile(arq, (err, html) => {
    if (err) { res.statusCode = 500; res.end('multichat.html nao encontrado ao lado da pasta conector/'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache'); // pega sempre a versao nova apos um deploy
    res.end(html);
  });
});

const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });
const clientes = new Set();
wss.on('connection', (ws) => {
  clientes.add(ws);
  // conta o estado de CADA loja ligada para o painel que acabou de abrir
  const ks = Object.keys(chats);
  if (!ks.length) ws.send(JSON.stringify({ tipo: 'status', conectado: false, usuario: '(teste)' }));
  ks.forEach((k) => {
    const c = chats[k];
    ws.send(JSON.stringify(comLoja(k, { tipo: 'status', conectado: c.aoVivo, usuario: c.usuario || '(teste)', inicio: c.liveEstado.inicio, ts: Date.now() })));
  });
  ws.on('close', () => clientes.delete(ws));
});
function emitir(ev) {
  ev.ts = Date.now();
  if (ev.tipo !== 'status' && ev.tipo !== 'contadores' && !ev.plataforma) ev.plataforma = 'tiktok';
  const msg = JSON.stringify(ev);
  for (const c of clientes) { try { c.send(msg); } catch (e) {} }
}

server.listen(PORTA, '0.0.0.0', () => {
  console.log('');
  console.log('  DuoLive Conector no ar!');
  if (NA_NUVEM) {
    console.log('  Rodando na nuvem, porta ' + PORTA + '. Use a URL publica do servico no painel.');
  } else {
    console.log('  Endereco: http://127.0.0.1:' + PORTA);
  }
  console.log('');
});

// ---------- modo teste: eventos falsos para ajustar o layout ----------
if (TESTE) {
  console.log('  MODO TESTE: gerando eventos falsos a cada 2s (sem conectar no TikTok).');
  const nomes = ['maria.silva', 'joao123', 'ana_compras', 'carlos.br', 'juh.oliveira'];
  const eventos = [
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'tem tamanho grande?' }),
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'quanto ta o frete?' }),
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'onde posso comprar?', plataforma: 'shopee' }),
    (n) => ({ tipo: 'seguidor', quem: n }),
    (n) => ({ tipo: 'presente', quem: n, presente: 'Rosa', qtd: 3, diamantes: 3 }),
    (n) => ({ tipo: 'entrada', quem: n }),
    (n) => ({ tipo: 'venda', quem: n, texto: 'comprou · R$ 89,90 · Tapete Sala', plataforma: 'shopee' }),
  ];
  let v = 42, likes = 130;
  const ct = chatDe(''); ct.usuario = 'teste'; ct.aoVivo = true; ct.liveEstado.inicio = Date.now();
  setInterval(() => {
    const n = nomes[Math.floor(Math.random() * nomes.length)];
    emitir(eventos[Math.floor(Math.random() * eventos.length)](n));
    v += Math.floor(Math.random() * 5) - 1; likes += Math.floor(Math.random() * 9);
    ct.liveEstado.espectadores = Math.max(1, v); ct.liveEstado.likes = likes;
    emitir({ tipo: 'contadores', espectadores: Math.max(1, v), likes: likes });
  }, 2000);
  return;
}

// ---------- conexao real com a live do TikTok (troca de conta em tempo real) ----------
const ttlive = require('tiktok-live-connector');
const { TikTokLiveConnection, WebcastEvent } = ttlive;
// A leitura do chat do TikTok passa por um servico que "assina" o pedido (Euler
// Stream). Pegue a chave gratis em https://www.eulerstream.com.
// De onde ela vem: 1o a variavel DUOLIVE_SIGN_KEY; 2o o arquivo chave-tiktok.txt
// (uma linha so'), que fica de fora do repositorio pelo .gitignore.
function chaveDoTiktok() {
  if (process.env.DUOLIVE_SIGN_KEY) return process.env.DUOLIVE_SIGN_KEY.trim();
  try {
    const t = fs.readFileSync(path.join(__dirname, 'chave-tiktok.txt'), 'utf8');
    const linha = t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0];
    if (linha) return linha;
  } catch (e) {}
  return '';
}
const SIGN_KEY = chaveDoTiktok();
// mostra so' o comecinho: confirma que leu a chave certa sem expor ela no log
if (SIGN_KEY) console.log('  (chave de assinatura do TikTok carregada: ' + SIGN_KEY.slice(0, 10) + '...)');
else console.log('  (sem chave de assinatura — se der erro de "sign", pegue uma gratis em eulerstream.com)');
const opcoes = { fetchRoomInfoOnConnect: true }; // traz o roomInfo (com o título) no connect
if (SIGN_KEY) opcoes.signApiKey = SIGN_KEY;

function nomeDe(d) {
  return (d && ((d.user && (d.user.uniqueId || d.user.nickname)) || d.uniqueId || d.nickname)) || '';
}

// ---------- leitura da SIGLA pelo TÍTULO da live (atribuição automática) ----------
// Pega o título da live, procura as siglas conhecidas como PALAVRA ISOLADA (pra
// "AL" não bater em "NATAL") e marca a sigla ativa — aí as vendas saem no nome dela.
function achaTitulo(o, prof) {
  if (!o || typeof o !== 'object' || (prof || 0) > 5) return '';
  if (typeof o.title === 'string' && o.title.trim()) return o.title.trim();
  for (const v of Object.values(o)) { if (v && typeof v === 'object') { const t = achaTitulo(v, (prof || 0) + 1); if (t) return t; } }
  return '';
}
function siglasNoTitulo(titulo, siglas) {
  const T = ' ' + String(titulo || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
  const achadas = [];
  siglas.forEach((sig) => { const s = String(sig).toUpperCase(); if (T.indexOf(' ' + s + ' ') >= 0) achadas.push(sig); });
  return achadas;
}
async function atualizaSiglaDoTitulo(k) {
  const c = chats[String(k || '')];
  if (!c || !c.conexao) return;
  const rot = '[' + (k || 'local') + '] ';
  try {
    let info = null;
    try { info = await c.conexao.fetchRoomInfo(); } catch (e) { info = c.conexao.roomInfo; }
    const titulo = achaTitulo(info);
    if (!titulo) return;
    const achadas = siglasNoTitulo(titulo, await siglasConhecidas());
    if (achadas.length === 1) {
      c.sigla = achadas[0]; c.siglaTs = Date.now();
      // a global segue alimentando o fluxo antigo (vendas sem loja marcada)
      siglaAtiva = achadas[0]; siglaAtivaTs = Date.now();
      console.log('  🏷️  ' + rot + 'Título: "' + titulo.slice(0, 60) + '" → sigla ' + achadas[0]);
    } else if (achadas.length > 1) {
      console.log('  🏷️  ' + rot + 'Título: "' + titulo.slice(0, 60) + '" → dupla/grupo (' + achadas.join('+') + '), atribuição de grupo a definir');
    } else {
      console.log('  🏷️  ' + rot + 'Título: "' + titulo.slice(0, 60) + '" (nenhuma sigla reconhecida)');
    }
  } catch (e) {}
}
// re-lê o título de vez em quando (a live pode mudar de nome / o robô só ligou depois)
setInterval(() => { Object.keys(chats).forEach((k) => { if (chats[k].aoVivo) atualizaSiglaDoTitulo(k); }); }, 120000);

function criarConexao(k) {
  const c = chatDe(k);
  const cx = c.conexao = new TikTokLiveConnection(c.usuario, opcoes);
  cx.on(WebcastEvent.CHAT, (d) => emitir(comLoja(k, { tipo: 'mensagem', quem: nomeDe(d), texto: (d && (d.content || d.comment)) || '' })));
  cx.on(WebcastEvent.MEMBER, (d) => emitir(comLoja(k, { tipo: 'entrada', quem: nomeDe(d) })));
  cx.on(WebcastEvent.FOLLOW, (d) => emitir(comLoja(k, { tipo: 'seguidor', quem: nomeDe(d) })));
  cx.on(WebcastEvent.SHARE, (d) => emitir(comLoja(k, { tipo: 'share', quem: nomeDe(d) })));
  cx.on(WebcastEvent.SOCIAL, (d) => {
    const t = String((d && d.displayType) || '');
    if (t.includes('follow')) emitir(comLoja(k, { tipo: 'seguidor', quem: nomeDe(d) }));
    else if (t.includes('share')) emitir(comLoja(k, { tipo: 'share', quem: nomeDe(d) }));
  });
  cx.on(WebcastEvent.GIFT, (d) => {
    if (d.giftType === 1 && !d.repeatEnd) return;
    const nome = (d.giftDetails && d.giftDetails.giftName) || d.giftName || (d.gift && d.gift.name) || 'presente';
    emitir(comLoja(k, { tipo: 'presente', quem: nomeDe(d), presente: nome, qtd: d.repeatCount || 1 }));
  });
  cx.on(WebcastEvent.ROOM_USER, (d) => {
    // na v2 o numero de espectadores vem em 'total' (ou 'totalUser'); 'viewerCount' era da v1
    const bruto = d && (d.viewerCount != null ? d.viewerCount : (d.total != null ? d.total : d.totalUser));
    const v = parseInt(bruto, 10);
    if (!isNaN(v)) { c.liveEstado.espectadores = v; emitir(comLoja(k, { tipo: 'contadores', espectadores: v })); }
  });
  cx.on(WebcastEvent.LIKE, (d) => {
    // na v2 o total de curtidas vem em 'total'; 'totalLikeCount' era da v1
    const bruto = d && (d.totalLikeCount != null ? d.totalLikeCount : d.total);
    const t = parseInt(bruto, 10);
    if (!isNaN(t)) { c.liveEstado.likes = t; emitir(comLoja(k, { tipo: 'contadores', likes: t })); }
    const quem = nomeDe(d);            // quem curtiu -> aparece no multichat
    if (!c.curtiram) c.curtiram = new Map();
    // cooldown de 30s por pessoa: a mesma pessoa curte varias vezes (spam), mas
    // "Fulana curtiu a live" so' reaparece 30s depois da ultima (pedido do usuario)
    if (quem) {
      const agora = Date.now();
      if (agora - (c.curtiram.get(quem) || 0) >= 30000) { c.curtiram.set(quem, agora); emitir(comLoja(k, { tipo: 'curtiu', quem: quem })); }
    }
  });
  cx.on(WebcastEvent.STREAM_END, () => {
    const g = c.geracao; c.aoVivo = false; c.liveEstado.inicio = 0;
    console.log('  [' + (k || 'local') + '] A live de @' + c.usuario + ' terminou. Aguardando a proxima...');
    emitir(comLoja(k, { tipo: 'status', conectado: false, usuario: c.usuario }));
    setTimeout(() => { if (g === c.geracao) conectar(k); }, 60000);
  });
  cx.on('disconnected', () => {
    if (!c.aoVivo) return;
    const g = c.geracao; c.aoVivo = false;
    console.log('  [' + (k || 'local') + '] Conexao caiu. Reconectando...');
    emitir(comLoja(k, { tipo: 'status', conectado: false, usuario: c.usuario }));
    setTimeout(() => { if (g === c.geracao) conectar(k); }, 10000);
  });
  cx.on('error', () => { /* nao derruba o conector */ });
}

function conectar(k) {
  const c = chatDe(k);
  if (!c.usuario || !c.conexao) return;
  const g = c.geracao;
  const rot = '[' + (k || 'local') + '] ';
  c.conexao.connect().then((estado) => {
    if (g !== c.geracao) return; // trocaram a conta desta loja enquanto conectava
    c.aoVivo = true;
    if (!c.liveEstado.inicio) c.liveEstado.inicio = Date.now(); // marca o comeco da live
    c.liveEstado.roomId = String((estado && estado.roomId) || ''); // a sala casa a live com o LiveDash
    console.log('  ' + rot + 'Conectado na live de @' + c.usuario + (estado && estado.roomId ? ' (sala ' + estado.roomId + ')' : ''));
    emitir(comLoja(k, { tipo: 'status', conectado: true, usuario: c.usuario, inicio: c.liveEstado.inicio }));
    setTimeout(() => { if (g === c.geracao) atualizaSiglaDoTitulo(k); }, 3000); // lê a sigla do título da live
  }).catch((err) => {
    if (g !== c.geracao) return;
    c.aoVivo = false;
    const txt = String((err && (err.message || err.name)) || err);
    emitir(comLoja(k, { tipo: 'status', conectado: false, usuario: c.usuario }));
    if (/sign|euler|rate.?limit|429|401|403/i.test(txt)) {
      if (/rate.?limit|429/i.test(txt)) console.log('  ATENCAO: ' + rot + 'limite da chave de assinatura (Euler Stream) — com 4 lojas abertas o plano gratis pode nao dar conta. Espere ou suba o plano.');
      else console.log('  ATENCAO: ' + rot + 'assinatura recusada. Confira a DUOLIVE_SIGN_KEY (eulerstream.com). Detalhe: ' + txt.slice(0, 90));
      setTimeout(() => { if (g === c.geracao) conectar(k); }, 60000);
    } else {
      console.log('  ' + rot + 'Sem live no ar para @' + c.usuario + ' (' + txt.slice(0, 80) + '). Tento de novo em 30s...');
      setTimeout(() => { if (g === c.geracao) conectar(k); }, 30000);
    }
  });
}

// liga (ou troca) o chat de UMA loja — sem mexer nas outras. Mandar conta vazia
// desliga so' o chat daquela loja.
function ligarConta(novo, loja) {
  const k = String(loja || '');
  const c = chatDe(k);
  novo = String(novo || '').replace(/^@/, '').trim();
  // painel reabrindo a MESMA conta da loja: nao derruba nada, so' reconta o estado
  if (novo && c.usuario === novo && c.conexao) {
    emitir(comLoja(k, { tipo: 'status', conectado: c.aoVivo, usuario: c.usuario, inicio: c.liveEstado.inicio }));
    return;
  }
  c.geracao++; // invalida timers/pendencias da conta anterior desta loja
  c.aoVivo = false;
  c.liveEstado = { espectadores: 0, likes: 0, inicio: 0, roomId: '' }; // zera os contadores ao trocar a conta
  c.curtiram = new Map(); // live nova: o cooldown de curtidas recomeca
  if (c.conexao) { try { c.conexao.disconnect(); } catch (e) {} c.conexao = null; }
  c.usuario = novo;
  if (!c.usuario) { emitir(comLoja(k, { tipo: 'status', conectado: false, usuario: '' })); return; }
  console.log('  >> [' + (k || 'local') + '] ligando o chat de @' + c.usuario);
  emitir(comLoja(k, { tipo: 'status', conectado: false, usuario: c.usuario }));
  criarConexao(k);
  conectar(k);
}

if (usuario) { const c0 = chatDe(''); c0.usuario = usuario; criarConexao(''); conectar(''); }
else console.log('  Nenhuma conta ainda. Escolha uma loja no painel (ou use: npm start -- @conta).');

module.exports = { ligarConta: ligarConta, contaAtual: () => (chatDe(lojaAtual).usuario || chatDe('').usuario) };
