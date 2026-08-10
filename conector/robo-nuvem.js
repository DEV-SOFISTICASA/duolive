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

// o modo nuvem é sempre: só o Gerenciador de LIVE + Chromium do contêiner.
// (definido ANTES de exigir o robô, que lê essas variáveis ao carregar)
process.env.DUOLIVE_SO_CONSOLE = process.env.DUOLIVE_SO_CONSOLE || '1';
process.env.DUOLIVE_CHROMIUM_NUVEM = '1';

console.log('\n  DuoLive · Robô de vendas NA NUVEM');
console.log('  Mandando as vendas para: ' + (process.env.DUOLIVE_CONECTOR || '(defina DUOLIVE_CONECTOR)'));
restauraSessoes();

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

// liga o robô: ele vigia TODAS as lojas cujo login estiver no cofre, AO MESMO
// TEMPO — cada venda sai carimbada com a loja dela e so' aparece no painel dela.
// (DUOLIVE_LOJA continua valendo para limitar a UMA loja, se um dia precisar.)
const quantas = (() => { try { return L.resumoDasLojas().filter((x) => x.console || x.tiktok || x.shopee).map((x) => x.loja); } catch (e) { return []; } })();
console.log('  🏪 Lojas com login no cofre: ' + (quantas.join(', ') || '(nenhuma!)'));
require('./robo-vendas.js').principal();
