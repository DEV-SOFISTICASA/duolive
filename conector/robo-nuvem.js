// DuoLive · Robô de vendas na NUVEM (Render / Docker)
//
// O que ele faz ao ligar:
//   1) abre o "cofre" (sessoes.cofre — mandado ao Render como Secret File) com a
//      senha DUOLIVE_SENHA e devolve os arquivos sessao-*.json para esta pasta;
//   2) liga o robô de vendas no modo leve (só o Gerenciador de LIVE), usando o
//      Chromium que vem no contêiner. As vendas vão para o painel (web service).
//
// Variáveis no serviço do Render:
//   DUOLIVE_CONECTOR = https://SEU-web-service.onrender.com   (para onde vão as vendas)
//   DUOLIVE_TOKEN    = o MESMO crachá do web service
//   DUOLIVE_SENHA    = a senha do cofre (a de: npm run empacotar-sessoes)
//   (DUOLIVE_SO_CONSOLE e DUOLIVE_CHROMIUM_NUVEM já entram sozinhos aqui)

const fs = require('fs');
const path = require('path');
const C = require('./cofre.js');
const L = require('./lojas.js');

// devolve os sessao-*.json a partir do cofre; retorna quantos logins voltaram
function restauraSessoes() {
  const candidatos = [
    process.env.DUOLIVE_COFRE_ARQUIVO,        // caminho manual (opcional)
    '/etc/secrets/' + C.ARQ_COFRE,            // Secret File do Render
    path.join(__dirname, C.ARQ_COFRE),        // ao lado do código
  ].filter(Boolean);
  const arq = candidatos.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!arq) { console.log('  ⚠️  Não achei ' + C.ARQ_COFRE + '. Suba-o no Render como Secret File (nome: ' + C.ARQ_COFRE + ').'); return 0; }
  const senha = process.env.DUOLIVE_SENHA || '';
  if (!senha) { console.log('  ⚠️  Falta a senha do cofre em DUOLIVE_SENHA.'); return 0; }
  let dentro;
  try {
    dentro = C.abre(JSON.parse(fs.readFileSync(arq, 'utf8')), senha);
  } catch (e) {
    console.log('  ⚠️  Não consegui abrir o cofre (' + (e.message === 'SENHA_ERRADA' ? 'senha errada' : (e.message || e)) + ').');
    return 0;
  }
  const nomes = Object.keys((dentro && dentro.sessoes) || {});
  nomes.forEach((n) => { try { fs.writeFileSync(path.join(__dirname, n), JSON.stringify(dentro.sessoes[n])); } catch (e) {} });
  console.log('  🔓 ' + nomes.length + ' login(s) restaurado(s) do cofre.');
  return nomes.length;
}

// Sessões SEMPRE FRESCAS do LiveDash: o LiveDash mantém 24/7 as sessões do
// Console de LIVE (tabela tts_sessions no Supabase antigo). Em vez de um cofre
// que vence, o robô puxa de lá as sessões das MINHAS lojas a cada vez que liga.
// Precisa de LIVEDASH_URL + LIVEDASH_KEY (as MESMAS do web service duolive).
async function puxaSessoesDoLiveDash() {
  const url = (process.env.LIVEDASH_URL || '').replace(/\/+$/, '');
  const key = process.env.LIVEDASH_KEY || '';
  if (!url || !key) { console.log('  (LIVEDASH_URL/KEY não configurados — pulei o LiveDash, uso o cofre)'); return 0; }
  const NOME_LOJA = { 'mania-d-casa': 'mania' }; // normaliza (igual livedash.js)
  // TRAVA DE SEGURANÇA: nunca vigiar as 14 lojas do LiveDash na nuvem (estoura a
  // memória). Usa minhas-lojas.txt; se ele faltar no contêiner, cai nas 4 fixas.
  const PADRAO = ['monaco', 'fast', 'bellini', 'mania'];
  let minhas;
  try { const m = L.minhasLojas(); minhas = new Set(m.length ? m : PADRAO); }
  catch (e) { minhas = new Set(PADRAO); }
  try {
    const r = await fetch(url + '/rest/v1/tts_sessions?select=loja,storage_state,ativo&ativo=eq.true', {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (r.status >= 300) { console.log('  ⚠️  LiveDash tts_sessions HTTP ' + r.status + ' — uso o cofre.'); return 0; }
    const rows = await r.json();
    let n = 0;
    for (const row of rows) {
      const loja = NOME_LOJA[String(row.loja).toLowerCase()] || String(row.loja).toLowerCase();
      if (minhas && !minhas.has(loja)) continue; // só as MINHAS lojas (leve na nuvem)
      const st = row.storage_state;
      const cookies = (st && st.cookies) || [];
      if (!cookies.some((c) => /^(sessionid|sid_guard)$/i.test(c.name))) continue; // sem login, pula
      fs.writeFileSync(path.join(__dirname, 'sessao-console-' + loja + '.json'), JSON.stringify(st));
      n++;
    }
    console.log('  🔓 ' + n + ' sessão(ões) do Console puxada(s) do LiveDash (sempre frescas).');
    return n;
  } catch (e) { console.log('  ⚠️  não consegui puxar do LiveDash (' + ((e && e.message) || e) + ') — uso o cofre.'); return 0; }
}

// o modo nuvem é sempre: só o Gerenciador de LIVE + Chromium do contêiner.
// (definido ANTES de exigir o robô, que lê essas variáveis ao carregar)
process.env.DUOLIVE_SO_CONSOLE = process.env.DUOLIVE_SO_CONSOLE || '1';
process.env.DUOLIVE_CHROMIUM_NUVEM = '1';

console.log('\n  DuoLive · Robô de vendas NA NUVEM');
console.log('  Mandando as vendas para: ' + (process.env.DUOLIVE_CONECTOR || '(defina DUOLIVE_CONECTOR)'));
restauraSessoes(); // cofre (reserva); o LiveDash abaixo sobrescreve com sessões frescas

// AUTOTESTE na largada: o painel existe? o crachá é aceito? Sem isso, uma
// variável errada faz as vendas serem recusadas em silêncio (bug de 2026-08-07:
// o web service estava com DUOLIVE_CONECTOR no lugar de DUOLIVE_TOKEN).
(async function testaConector() {
  const url = (process.env.DUOLIVE_CONECTOR || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) {
    console.log('  🚨 DUOLIVE_CONECTOR não parece um endereço (' + (url ? url.slice(0, 28) + '…' : 'vazio') + ').');
    console.log('     Deveria ser a URL do painel, ex.: https://duolive-conector-jipn.onrender.com');
    return;
  }
  try {
    const r = await fetch(url + '/ao-vivo', { headers: { 'x-duolive-token': process.env.DUOLIVE_TOKEN || '' } });
    if (r.status === 200) console.log('  ✅ Painel encontrado e crachá (DUOLIVE_TOKEN) ACEITO — as vendas vão entrar.');
    else console.log('  🚨 O painel RECUSOU o crachá (HTTP ' + r.status + ') — as vendas NÃO vão entrar! O DUOLIVE_TOKEN daqui tem que ser IGUAL ao do web service.');
  } catch (e) {
    console.log('  🚨 Não consegui falar com o painel em ' + url + ' (' + ((e && e.message) || e) + ') — confira o DUOLIVE_CONECTOR.');
  }
})();

// liga o robô: puxa as sessões frescas do LiveDash e vigia TODAS as lojas com
// login AO MESMO TEMPO — cada venda sai carimbada com a loja dela e so' aparece
// no painel dela. (DUOLIVE_LOJA ainda limita a UMA loja, se um dia precisar.)
(async () => {
  await puxaSessoesDoLiveDash();
  const quantas = (() => { try { return L.resumoDasLojas().filter((x) => x.console || x.tiktok || x.shopee).map((x) => x.loja); } catch (e) { return []; } })();
  console.log('  🏪 Lojas com login: ' + (quantas.join(', ') || '(nenhuma!)'));
  await require('./robo-vendas.js').principal();
})().catch((e) => { console.log('  Deu erro ao ligar o robô: ' + ((e && e.message) || e)); process.exit(1); });
