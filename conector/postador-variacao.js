// DuoLive · Postador — variação de legenda por conta
//
// Vídeo IGUAL em muitas contas perde alcance (as plataformas cortam a entrega de
// duplicado). Aqui a gente varia a legenda de um jeito que NÃO muda o sentido:
// ordem das hashtags, um emoji na frente e (se você der várias) rodízio de legendas.
//
// É uma ajuda pequena: o que mais protege o alcance é variar a CAPA e o CORTE do
// vídeo (isso vem numa próxima etapa, com o ffmpeg). Mas já ajuda e não custa nada.
//
// Uso como biblioteca:
//   const { variaLegenda } = require('./postador-variacao.js');
//   variaLegenda({ legenda: 'Chegou novidade', hashtags: ['#promo','#achadinhos'], conta: 'monaco', i: 0 })
//
// Autoteste:  node postador-variacao.js

const crypto = require('crypto');

const LIMITE_TIKTOK = 2200; // a legenda do TikTok cabe ~2200 caracteres

// pool de emojis "neutros" de loja — não mudam o sentido, só dão uma cara diferente
const EMOJIS = ['🛍️', '✨', '💖', '🔥', '🛒', '💫', '🎀', '⭐', ''];

// número estável a partir de um texto (mesma conta => mesma variação, sempre)
function semente(txt) {
  return parseInt(crypto.createHash('md5').update(String(txt)).digest('hex').slice(0, 8), 16) >>> 0;
}

// gerador de números "aleatórios" mas repetíveis (LCG) a partir de uma semente
function gerador(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// embaralha uma cópia da lista usando o gerador repetível
function embaralha(lista, rand) {
  const a = lista.slice();
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a;
}

// normaliza hashtags: aceita "#promo" ou "promo", tira repetidas e vazias
function limpaHashtags(hashtags) {
  const vistas = new Set();
  const saida = [];
  (hashtags || []).forEach((h) => {
    let t = String(h || '').trim().replace(/\s+/g, '');
    if (!t) return;
    if (t[0] !== '#') t = '#' + t;
    const chave = t.toLowerCase();
    if (vistas.has(chave)) return;
    vistas.add(chave);
    saida.push(t);
  });
  return saida;
}

// monta a legenda final para UMA conta
//   opts.legenda    texto base (ou use opts.legendas para rodízio)
//   opts.legendas   lista de textos base; a conta pega um por rodízio
//   opts.hashtags   lista de hashtags (com ou sem #)
//   opts.conta      apelido da conta (ex.: 'monaco') — dá a variação estável
//   opts.i          índice da conta na fila (ajuda a espalhar o rodízio)
//   opts.emoji      false = não põe emoji na frente (padrão: põe)
function variaLegenda(opts) {
  opts = opts || {};
  const conta = opts.conta || 'conta';
  const i = Number.isFinite(opts.i) ? opts.i : 0;
  const rand = gerador(semente(conta + '|' + (opts.legenda || '') + '|' + i));

  // 1) escolhe a legenda base (rodízio se você deu várias)
  let base;
  const bases = Array.isArray(opts.legendas) ? opts.legendas.filter((x) => String(x || '').trim()) : [];
  if (bases.length) base = bases[(semente(conta) + i) % bases.length];
  else base = String(opts.legenda || '').trim();

  // 2) hashtags em ordem embaralhada (estável por conta)
  const tags = embaralha(limpaHashtags(opts.hashtags), rand);

  // 3) um emoji na frente (ou nenhum)
  let prefixo = '';
  if (opts.emoji !== false) {
    const e = EMOJIS[Math.floor(rand() * EMOJIS.length)];
    if (e) prefixo = e + ' ';
  }

  // monta e respeita o limite do TikTok (sem cortar hashtag no meio)
  let texto = (prefixo + base).trim();
  for (const t of tags) {
    if ((texto + ' ' + t).length > LIMITE_TIKTOK) break;
    texto = texto ? texto + ' ' + t : t;
  }
  return { legenda: texto.slice(0, LIMITE_TIKTOK) };
}

module.exports = { variaLegenda, limpaHashtags };

// ---------------------------------------------------------------- autoteste
if (require.main === module) {
  const contas = ['monaco', 'bellini', 'vend-ana', 'vend-lore', 'monaco'];
  const base = 'Chegou coisa linda na loja hoje';
  const hashtags = ['#achadinhos', '#promo', '#decor', '#casa', '#tiktokmefezcomprar'];
  console.log('\n  Variação de legenda (mesma conta = mesma legenda, sempre):\n');
  contas.forEach((c, i) => {
    const r = variaLegenda({ legenda: base, hashtags, conta: c, i });
    console.log('  [' + c + ']  ' + r.legenda);
  });
  // a conta "monaco" aparece 2x com o MESMO texto? (tem que ser estável)
  const a = variaLegenda({ legenda: base, hashtags, conta: 'monaco', i: 0 }).legenda;
  const b = variaLegenda({ legenda: base, hashtags, conta: 'monaco', i: 0 }).legenda;
  console.log('\n  Estável para a mesma conta? ' + (a === b ? 'SIM ✅' : 'NÃO ❌'));
  console.log('  Cabe no limite do TikTok? ' + (a.length <= LIMITE_TIKTOK ? 'SIM ✅' : 'NÃO ❌'));
  console.log('');
}
