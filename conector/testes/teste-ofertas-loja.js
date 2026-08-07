// Testa se as ofertas relâmpago ficam presas à loja certa.
// O perigo real: o painel manda a lista INTEIRA; sem separar por loja,
// a loja A apagaria as ofertas da loja B (ou pior, o robô mexeria no
// preço do produto da loja errada).
const http = require('http');

// NUNCA na porta 9797: essa é a do conector de verdade, que fica no ar durante a
// live. Estes testes lançam ofertas falsas — se batessem lá, apareceriam na tela
// de quem está transmitindo. Use "node testes/rodar-tudo.js", que sobe um
// conector isolado só para os testes.
const PORTA = +(process.env.DUOLIVE_TESTE_PORTA || 9799);

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}

function chama(caminho, metodo, corpo) {
  return new Promise((ok2, erro) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORTA, path: caminho, method: metodo || 'GET', timeout: 5000,
      headers: dados ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } : {},
    }, (r) => {
      let c = ''; r.on('data', (d) => { c += d; });
      r.on('end', () => { try { ok2(c ? JSON.parse(c) : null); } catch (e) { ok2(c); } });
    });
    req.on('error', erro);
    req.on('timeout', () => { req.destroy(); erro(new Error('timeout')); });
    req.end(dados);
  });
}

const daquiA1h = Date.now() + 3600000;
const ofertaA = { id: 'A1', nome: 'Tapete Sala', de: 120, por: 89.9, fim: daquiA1h, real: true, plat: 'shopee', prodId: 'PROD-DA-LOJA-A' };
const ofertaB = { id: 'B1', nome: 'Almofada', de: 60, por: 39.9, fim: daquiA1h, real: true, plat: 'shopee', prodId: 'PROD-DA-LOJA-B' };

(async () => {
  console.log('\n  Cenario: duas lojas, cada uma com a sua oferta no ar.\n');

  // loja A entra e lança a oferta dela
  await chama('/conta', 'POST', { loja: 'petit', tiktok: '' });
  await chama('/oferta', 'POST', [ofertaA]);
  let lista = await chama('/ofertas');
  afirma('loja A ve a oferta dela', lista.length === 1 && lista[0].id === 'A1', JSON.stringify(lista));
  afirma('a oferta ficou carimbada com a loja A', lista[0].loja === 'petit', JSON.stringify(lista[0]));

  // painel troca para a loja B e lança outra oferta
  await chama('/conta', 'POST', { loja: 'monaco', tiktok: '' });
  lista = await chama('/ofertas');
  afirma('loja B NAO ve a oferta da loja A', lista.length === 0, JSON.stringify(lista));

  await chama('/oferta', 'POST', [ofertaB]);
  lista = await chama('/ofertas');
  afirma('loja B ve so a oferta dela', lista.length === 1 && lista[0].id === 'B1', JSON.stringify(lista));

  // a oferta da loja A sobreviveu?
  lista = await chama('/ofertas?loja=petit');
  afirma('a oferta da loja A NAO foi apagada', lista.length === 1 && lista[0].id === 'A1', JSON.stringify(lista));

  // volta para a loja A
  await chama('/conta', 'POST', { loja: 'petit', tiktok: '' });
  lista = await chama('/ofertas');
  afirma('voltando p/ loja A, a oferta dela reaparece', lista.length === 1 && lista[0].id === 'A1', JSON.stringify(lista));
  afirma('e continua com o produto certo', lista[0].prodId === 'PROD-DA-LOJA-A', JSON.stringify(lista[0]));

  // a loja A tira a oferta do ar: a da loja B nao pode sumir junto
  await chama('/oferta', 'POST', []);
  lista = await chama('/ofertas');
  afirma('loja A tirou a oferta dela do ar', lista.length === 0, JSON.stringify(lista));
  lista = await chama('/ofertas?loja=monaco');
  afirma('a oferta da loja B continua no ar', lista.length === 1 && lista[0].id === 'B1', JSON.stringify(lista));

  console.log('');
  console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
  process.exit(falha === 0 ? 0 : 1);
})().catch((e) => { console.log('  ❌ erro no teste: ' + e.message); process.exit(1); });
