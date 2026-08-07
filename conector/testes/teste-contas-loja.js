// Testa que cada loja guarda DUAS contas separadas (TikTok e Shopee), e que
// o nome digitado no painel não cria uma loja duplicada em relação ao login.
// Precisa do conector no ar (porta 9797).
const http = require('http');

// nunca a 9797 (a de verdade) — veja o comentário em teste-ofertas-loja.js
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

(async () => {
  console.log('\n  Cenario: a loja tem @ do TikTok e usuario da Shopee DIFERENTES.\n');

  // é assim que o painel salva as contas da loja
  await chama('/minha-loja', 'POST', { loja: 'Petit Store', nome: 'Petit Store', tiktok: 'petitstore.br', shopee: 'petit_decor_oficial' });

  let l = await chama('/minha-loja?loja=petit-store');
  afirma('guardou o @ do TikTok', l.contas.tiktok === 'petitstore.br', JSON.stringify(l.contas));
  afirma('guardou o usuario da Shopee (diferente)', l.contas.shopee === 'petit_decor_oficial', JSON.stringify(l.contas));
  afirma('os dois convivem sem se sobrescrever', l.contas.tiktok !== l.contas.shopee);

  const todas = await chama('/lojas');
  const nomes = todas.lojas.map((x) => x.nome);
  afirma('"Petit Store" virou "petit-store" (mesmo nome do arquivo de login)',
    nomes.indexOf('petit-store') >= 0, JSON.stringify(nomes));
  afirma('NAO criou loja duplicada com o nome cru',
    nomes.indexOf('Petit Store') < 0, JSON.stringify(nomes));

  // trocar de loja pelo seletor também precisa cair no mesmo nome
  await chama('/conta', 'POST', { loja: 'Petit Store', tiktok: 'petitstore.br' });
  const depois = await chama('/lojas');
  afirma('o seletor aponta para o mesmo nome padronizado',
    depois.selecionada === 'petit-store', JSON.stringify(depois.selecionada));

  // só o @ da Shopee muda: o do TikTok tem que continuar lá
  await chama('/minha-loja', 'POST', { loja: 'petit-store', shopee: 'outro_usuario_shopee' });
  l = await chama('/minha-loja?loja=petit-store');
  afirma('trocar so a Shopee nao apaga o TikTok', l.contas.tiktok === 'petitstore.br', JSON.stringify(l.contas));
  afirma('a Shopee foi atualizada', l.contas.shopee === 'outro_usuario_shopee', JSON.stringify(l.contas));

  console.log('');
  console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
  process.exit(falha === 0 ? 0 : 1);
})().catch((e) => { console.log('  ❌ erro no teste: ' + e.message); process.exit(1); });
