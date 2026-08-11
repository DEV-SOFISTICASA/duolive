// DuoLive · Observador da ⚡ Oferta Relâmpago (SÓ OBSERVA — quem cria é você)
//
// Abre o Console de LIVE numa janela. VOCÊ cria uma ⚡ Oferta Relâmpago num
// produto de TESTE nesta janela; o script registra as chamadas de API — tanto a
// que carrega as VARIAÇÕES/SKUs (com foto + preço) quanto a que CRIA a oferta.
// Eu não crio/edito nada: você controla tudo. Serve para dois objetivos de uma vez:
//   (1) pegar as VARIAÇÕES com foto (que o dashboard não entrega sozinho);
//   (2) mapear a criação da ⚡ nativa, para o robô automatizar depois.
//
// Uso:  npm run observa-flash              (monaco)
//       npm run observa-flash -- bellini   (outra loja)
// Sai:  feche a janela quando terminar. Tudo fica em flash-sale-capturado.json

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');

const loja = String(process.argv[2] || 'monaco').trim();
const SESS = path.join(__dirname, 'sessao-console-' + loja + '.json');
const OUT = path.join(__dirname, 'flash-sale-capturado.json');

// o que interessa: criação/edição de flash sale, promoção, e as telas que
// carregam SKUs/detalhe do produto. Fora ruído (config, tradução, logs).
const interessa = (u) => /flash.?sale|promotion|activity|\bdeal\b|discount|sku|product.?detail/i.test(u)
  && !/config|starling|monitor|\blog\b|slardar|report|category_tree|\/list(\?|$)/i.test(u);

(async () => {
  if (!fs.existsSync(SESS)) { console.log('  sem sessao-console-' + loja + '.json — puxe do LiveDash primeiro'); process.exit(1); }
  const browser = await abreNavegador(false); // headed: você vai usar esta janela
  const ctx = await browser.newContext({ storageState: SESS, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  const capturas = [];
  const salva = () => { try { fs.writeFileSync(OUT, JSON.stringify(capturas, null, 1)); } catch (e) {} };

  page.on('request', (req) => {
    try {
      if (!interessa(req.url())) return;
      const c = { quando: new Date().toISOString(), metodo: req.method(), url: req.url(), corpo: (req.postData() || '').slice(0, 6000), resposta: '' };
      capturas.push(c); salva();
      console.log('\n>>> ' + c.metodo + '  ' + req.url().split('?')[0]);
      if (c.corpo) console.log('    corpo: ' + c.corpo.slice(0, 260));
    } catch (e) {}
  });
  page.on('response', async (res) => {
    try {
      if (!interessa(res.url())) return;
      const t = await res.text().catch(() => '');
      const alvo = capturas.filter((c) => c.url === res.url()).pop();
      if (alvo) { alvo.resposta = t.slice(0, 8000); salva(); }
      const marca = /sku|sale_prop|spec|cover|image/i.test(t) ? '   (tem sku/foto!)' : '';
      console.log('    <<< [' + res.status() + '] ' + t.length + 'b' + marca);
    } catch (e) {}
  });

  console.log('\n  DuoLive · Observador da ⚡ Oferta Relâmpago — loja: ' + loja);
  console.log('  Abrindo o Console de LIVE...');
  try { await page.goto('https://shop.tiktok.com/streamer/live/product/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }); }
  catch (e) { console.log('  nao abriu:', e.message); }
  if (/login|passport/i.test(page.url())) { console.log('  SESSAO EXPIROU — puxe fresca do LiveDash'); await browser.close(); process.exit(1); }
  console.log('\n  👀 OBSERVANDO. Agora, NESTA janela:');
  console.log('     1) clique na ⚡ de um produto de TESTE (de preferência um sem oferta ativa)');
  console.log('     2) monte a oferta como você faz e confirme');
  console.log('  Eu registro as APIs (variações com foto + criação) em flash-sale-capturado.json.');
  console.log('  Não interfiro em nada — quem cria é você. Feche a janela quando terminar.\n');
  page.on('close', () => { salva(); console.log('\n  janela fechada. Capturei ' + capturas.length + ' chamada(s) em flash-sale-capturado.json.'); process.exit(0); });
  browser.on('disconnected', () => process.exit(0));
  await new Promise(() => {}); // fica vivo observando
})().catch((e) => { console.log('ERRO', e.message); process.exit(1); });
