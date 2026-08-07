// Testa se o robô de vendas segue o seletor 🏪 do painel.
// Não abre navegador de verdade: confere a parte que decide QUAL login usar.
const path = require('path');
const DIR = 'C:/Users/PC2/Desktop/Claude/duolive/conector';
const L = require(DIR + '/lojas.js');

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}

// 1. o conector precisa dizer qual loja está selecionada
const http = require('http');
// nunca a 9797 (a de verdade) — veja o comentário em teste-ofertas-loja.js
const PORTA = +(process.env.DUOLIVE_TESTE_PORTA || 9799);
function pergunta(caminho) {
  return new Promise((ok2, erro) => {
    http.get({ hostname: '127.0.0.1', port: PORTA, path: caminho, timeout: 5000 }, (r) => {
      let c = ''; r.on('data', (d) => { c += d; }); r.on('end', () => { try { ok2(JSON.parse(c)); } catch (e) { erro(e); } });
    }).on('error', erro);
  });
}
function trocaLoja(nome) {
  return new Promise((ok2, erro) => {
    const corpo = JSON.stringify({ loja: nome, tiktok: '' });
    const req = http.request({ hostname: '127.0.0.1', port: PORTA, path: '/conta', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo) } },
      (r) => { let c = ''; r.on('data', (d) => { c += d; }); r.on('end', () => ok2(c)); });
    req.on('error', erro);
    req.end(corpo);
  });
}

(async () => {
  console.log('\n  1) O conector conta qual loja o painel escolheu?');
  let r = await pergunta('/lojas');
  afirma('/lojas responde com o campo "selecionada"', 'selecionada' in r, JSON.stringify(r));

  // o painel manda o nome como voce digitou; o conector padroniza para o mesmo
  // formato dos arquivos de login (senao viravam duas lojas diferentes)
  await trocaLoja('Petit Store');
  r = await pergunta('/lojas');
  afirma('painel trocou p/ "Petit Store" -> conector avisa "petit-store"', r.selecionada === 'petit-store', JSON.stringify(r.selecionada));

  await trocaLoja('monaco');
  r = await pergunta('/lojas');
  afirma('painel trocou p/ "monaco" e o conector avisa', r.selecionada === 'monaco', JSON.stringify(r));

  console.log('\n  2) O nome do painel vira o arquivo de login certo?');
  // o painel pode mandar "Petit Store"; o arquivo é sessao-tiktok-petit-store.json
  afirma('"Petit Store" -> petit-store', L.limpaNome('Petit Store') === 'petit-store', L.limpaNome('Petit Store'));
  afirma('"Mônaco Decore" -> monaco-decore', L.limpaNome('Mônaco Decore') === 'monaco-decore', L.limpaNome('Mônaco Decore'));
  afirma('vazio -> principal', L.limpaNome('') === 'principal');

  const arq = L.arquivoSessao('tiktok', L.limpaNome('Petit Store'));
  afirma('login da loja "Petit Store" aponta p/ o arquivo certo',
    path.basename(arq) === 'sessao-tiktok-petit-store.json', path.basename(arq));

  console.log('');
  console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
  process.exit(falha === 0 ? 0 : 1);
})().catch((e) => { console.log('  ❌ erro no teste: ' + e.message); process.exit(1); });
