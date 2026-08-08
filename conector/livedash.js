// DuoLive · Espelho do LiveDash — o histórico REFLETE o LiveDash em vez de
// manter contagem própria (decisão do usuário, 2026-08-08).
//
// O LiveDash coleta as lives 24/7 (worker livedash-robo no Render) e guarda no
// Supabase ANTIGO: tabela livedash_state, chaves tts_lives:<loja>, cada uma com
// data.lives[] = { room_id, title, started_at, gmv, orders, ... }.
//
// Este módulo lê de lá (cache de 3 min; se a leitura falhar, serve o último
// resultado bom) e transforma cada live numa "venda" no formato do histórico:
//   valor = GMV da live · ts = início da live · sigla = detectada no TÍTULO
//   (2+ siglas no título = dupla → divide igual entre elas)
//
// URL e chave (service_role do projeto ANTIGO) vêm de:
//   1º variáveis LIVEDASH_URL / LIVEDASH_KEY (é assim no Render)
//   2º arquivo chave-livedash.txt (linha 1 = URL, linha 2 = chave), fora do git

const fs = require('fs');
const path = require('path');

// nomes de loja do LiveDash ≠ nomes do DuoLive — normaliza pra não duplicar loja
const NOME_LOJA = { 'mania-d-casa': 'mania' };

// Exceções por live (room_id → siglas): a LIVE 10K (07/08) foi dividida TS/AL
// por decisão do usuário; "LIVE 10K" no produto a mantém FORA da aba "Total"
// (o historico.html filtra por esse marcador).
const EXCECOES = {
  '7671242944791300872': { siglas: ['TS', 'AL'], produto: 'LIVE 10K' },
  '7671358885671783188': { siglas: ['TS', 'AL'], produto: 'LIVE 10K' },
};

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

// mesma regra do leitor de título do conector: sigla só vale como PALAVRA
// ISOLADA (senão "AL" casaria dentro de "NATAL")
function siglasNoTitulo(titulo, siglas) {
  const T = ' ' + String(titulo || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
  const achadas = [];
  (siglas || []).forEach((sig) => { const s = String(sig).toUpperCase(); if (s && T.indexOf(' ' + s + ' ') >= 0) achadas.push(sig); });
  return achadas;
}

let _lives = null, _livesTs = 0;
async function lives() {
  if (_lives && Date.now() - _livesTs < 180000) return _lives; // cache 3 min
  const c = config();
  const r = await fetch(c.url + '/rest/v1/livedash_state?key=like.tts_lives:*&select=key,data', {
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key },
  });
  if (!r.ok) throw new Error('livedash ' + r.status);
  const rows = await r.json();
  const todas = [];
  rows.forEach((row) => {
    let loja = String((row.data && row.data.loja) || String(row.key).replace('tts_lives:', '')).toLowerCase().trim();
    loja = NOME_LOJA[loja] || loja;
    ((row.data && row.data.lives) || []).forEach((l) => {
      const ini = Date.parse(l.started_at || 0);
      if (!ini || isNaN(ini)) return;
      todas.push({
        loja: loja, room_id: String(l.room_id || ''), titulo: String(l.title || ''),
        ts: new Date(ini).toISOString(), gmv: +l.gmv || 0, pedidos: +l.orders || 0,
      });
    });
  });
  _lives = todas; _livesTs = Date.now();
  return todas;
}

// cada live vira 1 "venda" (ou N, se o título tem N siglas — divide igual).
// Mesmo formato que o banco devolvia: {sigla,quem,produto,valor,plataforma,loja,ts}
async function comoVendas(siglasConhecidas) {
  const ls = await lives();
  const vendas = [];
  ls.forEach((l) => {
    if (l.gmv <= 0) return; // live sem venda não entra no histórico
    const exc = EXCECOES[l.room_id];
    const sg = exc ? exc.siglas : siglasNoTitulo(l.titulo, siglasConhecidas);
    const produto = exc ? exc.produto : ((l.titulo || 'LIVE') + ' · ' + l.pedidos + ' pedido(s)');
    const base = { quem: null, produto: produto, plataforma: 'tiktok', loja: l.loja, ts: l.ts };
    if (sg.length <= 1) {
      vendas.push(Object.assign({ sigla: sg[0] || null, valor: +l.gmv.toFixed(2) }, base));
    } else {
      const parte = Math.floor((l.gmv / sg.length) * 100) / 100;
      sg.forEach((s, i) => {
        const v = (i === sg.length - 1) ? +(l.gmv - parte * (sg.length - 1)).toFixed(2) : parte;
        vendas.push(Object.assign({ sigla: s, valor: v }, base));
      });
    }
  });
  vendas.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // mais novas primeiro, como o banco
  return vendas;
}

module.exports = { config, ativo, lives, comoVendas, siglasNoTitulo };
