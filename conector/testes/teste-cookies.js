// Testa o entendimento do que você cola da aba Network do Chrome.
// Os exemplos abaixo são no formato REAL que o Chrome gera (Windows e Linux).
const C = require(require('path').join(__dirname, '..', 'cookies.js'));

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}
const acha = (cs, n) => (cs.find((c) => c.name === n) || {}).value;

// ---------- 1. cURL do Chrome no WINDOWS (aspas duplas, ^ no fim da linha) ----------
const curlWin = [
  'curl "https://shop.tiktok.com/api/v1/streamer/detail_performance/list" ^',
  '  -H "accept: application/json, text/plain, */*" ^',
  '  -H "content-type: application/json" ^',
  '  -H "cookie: sessionid=ABC123; tt_ticket=XYZ789; store_idc=alisg" ^',
  '  -H "referer: https://shop.tiktok.com/streamer/compass" ^',
  '  --data-raw "{\\"page_size\\":20}"',
].join('\n');

let r = C.entende(curlWin, 'console');
afirma('Windows: achou os 3 cookies', r.cookies.length === 3, JSON.stringify(r.cookies));
afirma('Windows: sessionid certo', acha(r.cookies, 'sessionid') === 'ABC123', acha(r.cookies, 'sessionid'));
afirma('Windows: tt_ticket certo', acha(r.cookies, 'tt_ticket') === 'XYZ789');
afirma('Windows: pegou a URL', r.url === 'https://shop.tiktok.com/api/v1/streamer/detail_performance/list', r.url);
afirma('Windows: virou POST (tem corpo)', r.metodo === 'POST', r.metodo);
afirma('Windows: guardou o content-type', r.cabecalhos['content-type'] === 'application/json');
afirma('Windows: NAO guardou o cookie nos cabecalhos', !r.cabecalhos.cookie);

// ---------- 1b. "Copy as cURL (cmd)" do Windows — TUDO escapado com ^ ----------
// Este e' o formato que travou de verdade: as aspas viram ^" e as de dentro ^\^".
const curlCmd = [
  'curl ^"https://shop.tiktok.com/streamer/live/product/dashboard^" ^',
  '  -H ^"accept: text/html,application/xhtml+xml^" ^',
  '  -H ^"cookie: sessionid=CMD_ABC; tt_ticket=CMD_TICKET; store_idc=alisg^" ^',
  '  -H ^"sec-ch-ua-platform: ^\\^"Windows^\\^"^" ^',
  '  -H ^"sec-fetch-dest: document^" ^',
  '  -H ^"sec-fetch-mode: navigate^" ^',
  '  -H ^"user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0^"',
].join('\n');

r = C.entende(curlCmd, 'console');
afirma('cmd: achou os 3 cookies', r.cookies.length === 3, JSON.stringify(r.cookies));
afirma('cmd: sessionid certo', acha(r.cookies, 'sessionid') === 'CMD_ABC', acha(r.cookies, 'sessionid'));
afirma('cmd: tt_ticket certo', acha(r.cookies, 'tt_ticket') === 'CMD_TICKET');
afirma('cmd: pegou a URL do streamer',
  r.url === 'https://shop.tiktok.com/streamer/live/product/dashboard', r.url);
afirma('cmd: o ^\\^" de dentro nao atrapalhou os outros cabecalhos',
  (r.cabecalhos['sec-fetch-dest'] || '') === 'document', JSON.stringify(r.cabecalhos['sec-fetch-dest']));
afirma('cmd: passa na conferencia do console', (function(){ try { C.confere(r, 'console'); return true; } catch (e) { return e.message; } })() === true);
const sessaoCmd = C.paraSessao(r, 'console');
afirma('cmd: dominio .tiktok.com', sessaoCmd.cookies[0].domain === '.tiktok.com', sessaoCmd.cookies[0].domain);

// ---------- 2. cURL do Chrome no LINUX/MAC (aspas simples, \ no fim) ----------
const curlNix = [
  "curl 'https://seller.shopee.com.br/api/v3/order/get_order_list' \\",
  "  -H 'accept: application/json' \\",
  "  -H 'cookie: SPC_ST=abc-def; SPC_U=12345; SPC_R_T_ID=zzz' \\",
  "  -H 'x-requested-with: XMLHttpRequest'",
].join('\n');

r = C.entende(curlNix, 'shopee');
afirma('Linux: achou os 3 cookies', r.cookies.length === 3, JSON.stringify(r.cookies));
afirma('Linux: SPC_ST certo', acha(r.cookies, 'SPC_ST') === 'abc-def');
afirma('Linux: metodo GET (sem corpo)', r.metodo === 'GET');

let s = C.paraSessao(r, 'shopee');
afirma('Shopee: dominio virou .shopee.com.br', s.cookies[0].domain === '.shopee.com.br', s.cookies[0].domain);

// ---------- 3. só a linha do cookie ----------
r = C.entende('cookie: sessionid=SO_A_LINHA; outro=2', 'tiktok');
afirma('Linha de cookie: entendeu', r.cookies.length === 2, JSON.stringify(r.cookies));
afirma('Linha de cookie: valor certo', acha(r.cookies, 'sessionid') === 'SO_A_LINHA');

// ---------- 4. colando só "a=1; b=2" ----------
r = C.entende('sessionid=CRU; tt_ticket=CRU2', 'tiktok');
afirma('Pares crus: entendeu', r.cookies.length === 2, JSON.stringify(r.cookies));

// ---------- 5. JSON do Cookie-Editor (formato REAL da extensao) ----------
// A extensao exporta com expirationDate (segundos), hostOnly, sameSite, secure...
const cookieEditor = JSON.stringify([
  { name: 'sessionid', value: 'DO_EDITOR', domain: '.tiktok.com', hostOnly: false, path: '/',
    secure: true, httpOnly: true, sameSite: 'no_restriction', session: false, expirationDate: 1799999999.5 },
  { name: 'tt_ticket', value: 'EDITOR2', domain: '.tiktok.com', path: '/tt', secure: false,
    httpOnly: false, sameSite: 'lax', session: true },
]);
r = C.entende(cookieEditor, 'tiktok');
afirma('Cookie-Editor: entendeu os 2', r.cookies.length === 2, JSON.stringify(r.cookies));
afirma('Cookie-Editor: valor certo', acha(r.cookies, 'sessionid') === 'DO_EDITOR');
s = C.paraSessao(r, 'tiktok');
afirma('Cookie-Editor: manteve o dominio dele', s.cookies[0].domain === '.tiktok.com', s.cookies[0].domain);
afirma('Cookie-Editor: expirationDate virou expires (arredondado)',
  s.cookies[0].expires === 1800000000, String(s.cookies[0].expires));
afirma('Cookie-Editor: guardou o httpOnly de verdade', s.cookies[0].httpOnly === true, String(s.cookies[0].httpOnly));
afirma('Cookie-Editor: "no_restriction" virou "None"', s.cookies[0].sameSite === 'None', s.cookies[0].sameSite);
afirma('Cookie-Editor: respeitou secure=false do 2o', s.cookies[1].secure === false, String(s.cookies[1].secure));
afirma('Cookie-Editor: respeitou o path /tt do 2o', s.cookies[1].path === '/tt', s.cookies[1].path);
afirma('Cookie-Editor: cookie de sessao fica com expires -1', s.cookies[1].expires === -1, String(s.cookies[1].expires));
afirma('Cookie-Editor: "lax" virou "Lax"', s.cookies[1].sameSite === 'Lax', s.cookies[1].sameSite);
// tem que passar na conferencia (sessionid e' cookie de login do tiktok)
afirma('Cookie-Editor: passa na conferencia', (function(){ try { C.confere(r, 'tiktok'); return true; } catch (e) { return e.message; } })() === true);

// ---------- 6. o formato da sessão tem que servir para o Playwright ----------
r = C.entende(curlWin, 'console');
s = C.paraSessao(r, 'console');
afirma('Sessao: tem cookies e origins', Array.isArray(s.cookies) && Array.isArray(s.origins));
afirma('Sessao: dominio do console veio da URL', s.cookies[0].domain === '.tiktok.com', s.cookies[0].domain);
afirma('Sessao: cada cookie tem os campos do Playwright',
  s.cookies.every((c) => c.name && 'value' in c && c.domain && c.path && 'expires' in c && 'httpOnly' in c && 'secure' in c && c.sameSite),
  JSON.stringify(s.cookies[0]));

// ---------- 7. erros claros quando o usuario cola a coisa errada ----------
function erroDe(txt) { try { C.entende(txt, 'tiktok'); return ''; } catch (e) { return e.message; } }
afirma('Vazio: avisa', /nao colei nada/i.test(erroDe('')), erroDe(''));
// cURL sem cookie: precisa DIZER o que leu, senao a gente fica no escuro
const semCk = erroDe('curl "https://x.com" -H "accept: */*" -H "user-agent: Chrome"');
afirma('cURL sem cookie: conta quantos cabecalhos leu', /li 2 cabecalhos/i.test(semCk), semCk);
afirma('cURL sem cookie: lista quais eram', /accept, user-agent/i.test(semCk), semCk);
afirma('cURL sem cookie: sugere o Cookie-Editor', /Cookie-Editor/i.test(semCk), semCk);
afirma('Texto solto sem cookie: avisa generico', /nao achei nenhum cookie/i.test(erroDe('bla bla bla')),
  erroDe('bla bla bla'));
afirma('JSON quebrado: avisa', /nao consegui ler|nao tem uma lista/i.test(erroDe('[{quebrado')), erroDe('[{quebrado'));

// ---------- 8. cookie com "=" dentro do valor (acontece em base64) ----------
r = C.entende('cookie: token=YWJjZA==; x=1', 'tiktok');
afirma('Valor com "=" dentro nao quebra', acha(r.cookies, 'token') === 'YWJjZA==', acha(r.cookies, 'token'));

// ---------- 9. avisa quando voce copia a requisicao ERRADA ----------
function conferindo(txt, plat) {
  try { C.confere(C.entende(txt, plat), plat); return ''; } catch (e) { return e.message; }
}
// requisicao de qualquer pagina que nao e' a loja
const deOutroSite = 'curl "https://www.google.com/gen_204" -H "cookie: NID=123; SID=abc"';
afirma('Requisicao de outro site: recusa', /nao e a TikTok Seller/i.test(conferindo(deOutroSite, 'tiktok')),
  conferindo(deOutroSite, 'tiktok'));

// copiou da Shopee mas escolheu TikTok na tela
const daShopee = 'curl "https://seller.shopee.com.br/api/v3/order" -H "cookie: SPC_ST=abc; SPC_U=1"';
afirma('Plataforma trocada: diz qual e a certa', /Parece ser da Shopee/i.test(conferindo(daShopee, 'tiktok')),
  conferindo(daShopee, 'tiktok'));

// dominio certo, mas sem cookie de login (ex.: aba anonima)
const semLogin = 'curl "https://seller-br.tiktok.com/order" -H "cookie: _ga=GA1.2.99; lang=pt"';
afirma('Sem cookie de login: recusa', /nenhum e de login/i.test(conferindo(semLogin, 'tiktok')),
  conferindo(semLogin, 'tiktok'));

// e o caminho feliz continua passando
afirma('Requisicao boa do TikTok: aceita', conferindo(curlWin, 'console') === '', conferindo(curlWin, 'console'));
afirma('Requisicao boa da Shopee: aceita', conferindo(curlNix, 'shopee') === '', conferindo(curlNix, 'shopee'));
// so' a linha de cookie (sem URL) tambem tem que passar
afirma('Linha de cookie com sessionid: aceita', conferindo('cookie: sessionid=abc; x=1', 'tiktok') === '',
  conferindo('cookie: sessionid=abc; x=1', 'tiktok'));

// ---------- 10. a linha de telemetria (o erro que aconteceu de verdade) ----------
// O usuario copiou uma chamada do SDK_SLARDAR_WEB, que nao carrega cookie nenhum.
const slardar = 'curl "https://mon-va.byteoversea.com/monitor_browser/collect/batch/?bid=slardar_tiktok"'
  + ' -H "content-type: text/plain;charset=UTF-8"'
  + ' --data-raw "{\\"sdk_name\\":\\"SDK_SLARDAR_WEB\\",\\"url\\":\\"https://seller-br.tiktok.com/order\\"}"';
afirma('Telemetria: explica que ela nao tem cookie',
  /telemetria/i.test(erroDe(slardar)), erroDe(slardar));
afirma('Telemetria: manda usar o botao Doc', /Doc/.test(erroDe(slardar)), erroDe(slardar));

// requisicao normal do site, mas sem cabecalho cookie
const semCookie = 'curl "https://seller-br.tiktok.com/api/v1/algo" -H "accept: application/json"';
afirma('Sem cookie: diz que o Chrome nao mandou o cookie',
  /Chrome NAO incluiu o cookie/i.test(erroDe(semCookie)), erroDe(semCookie));
afirma('Sem cookie: NAO chama de telemetria', !/telemetria/i.test(erroDe(semCookie)), erroDe(semCookie));

console.log('');
console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
process.exit(falha === 0 ? 0 : 1);
