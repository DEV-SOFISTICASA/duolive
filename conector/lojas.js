// DuoLive · Lojas (uso comum de todos os robôs)
//
// Cada LOJA junta as duas contas: a do TikTok e a da Shopee.
// Ex.: a loja "bellini" tem sessao-tiktok-bellini.json, sessao-shopee-bellini.json
// e sessao-console-bellini.json (o Console de LIVE tem login próprio).
//
// Os arquivos antigos sem sufixo (sessao-tiktok.json) continuam valendo: eles
// pertencem à loja "principal", então nada do que já funciona se perde.

const fs = require('fs');
const path = require('path');

const PADRAO = 'principal';

// deixa o nome seguro para virar nome de arquivo (sem acento, sem espaço)
function limpaNome(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || PADRAO;
}

// de onde vem o nome da loja: --loja bellini  |  DUOLIVE_LOJA  |  loja.txt  |  principal
function lojaPedida(argv) {
  const args = argv || process.argv;
  const i = args.indexOf('--loja');
  if (i >= 0 && args[i + 1]) return limpaNome(args[i + 1]);
  if (process.env.DUOLIVE_LOJA) return limpaNome(process.env.DUOLIVE_LOJA);
  try {
    const t = fs.readFileSync(path.join(__dirname, 'loja.txt'), 'utf8').trim();
    if (t) return limpaNome(t.split('\n')[0]);
  } catch (e) {}
  return PADRAO;
}

// caminho da sessão de uma loja numa plataforma ('tiktok' | 'shopee' | 'console')
function arquivoSessao(plataforma, loja) {
  const l = limpaNome(loja);
  const comNome = path.join(__dirname, 'sessao-' + plataforma + '-' + l + '.json');
  if (fs.existsSync(comNome)) return comNome;
  // a loja "principal" também aceita o arquivo antigo, sem sufixo
  if (l === PADRAO) {
    const antigo = path.join(__dirname, 'sessao-' + plataforma + '.json');
    if (fs.existsSync(antigo)) return antigo;
  }
  return comNome; // ainda não existe: é aqui que o login vai gravar
}

// As SUAS lojas, listadas em minhas-lojas.txt (uma por linha).
// É essa lista que os atalhos de login mostram para você escolher — assim o
// nome sai sempre igual e o painel e os robôs se encontram.
function minhasLojas() {
  try {
    const t = fs.readFileSync(path.join(__dirname, 'minhas-lojas.txt'), 'utf8');
    const nomes = t.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(limpaNome);
    return nomes.filter((n, i) => nomes.indexOf(n) === i); // sem repetidas
  } catch (e) { return []; }
}

// todas as lojas que já têm pelo menos um login guardado
function lojasComLogin() {
  const achadas = new Set();
  let arquivos = [];
  try { arquivos = fs.readdirSync(__dirname); } catch (e) {}
  arquivos.forEach((a) => {
    const m = a.match(/^sessao-(tiktok|shopee|console)-(.+)\.json$/);
    if (m) achadas.add(m[2]);
    else if (/^sessao-(tiktok|shopee|console)\.json$/.test(a)) achadas.add(PADRAO);
  });
  return Array.from(achadas).sort();
}

// o que cada loja tem: { loja, tiktok:true/false, shopee:..., console:... }
function resumoDasLojas() {
  return lojasComLogin().map((loja) => ({
    loja: loja,
    tiktok: fs.existsSync(arquivoSessao('tiktok', loja)),
    shopee: fs.existsSync(arquivoSessao('shopee', loja)),
    console: fs.existsSync(arquivoSessao('console', loja)),
  }));
}

module.exports = { PADRAO, limpaNome, lojaPedida, arquivoSessao, lojasComLogin, resumoDasLojas, minhasLojas };
