// Abre uma janela de verdade no Seller Center brasileiro e conta o que aconteceu.
// Serve para descobrir POR QUE um login não funciona: a página abriu? deu erro?
// o site reclamou de automação? Rode pelo atalho "0 TESTAR NAVEGADOR.bat".

const path = require('path');
const { abreNavegador, achaBrave } = require(path.join(__dirname, '..', 'navegador.js'));

const ALVO = 'https://seller-br.tiktok.com';

(async () => {
  console.log('\n  Procurando um navegador...');
  const browser = await abreNavegador(false); // janela visível
  console.log('  Motor: ' + browser.version());
  if (achaBrave()) console.log('  (Brave existe neste PC: ' + achaBrave() + ')');

  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();

  const errosDeRede = [];
  page.on('requestfailed', (r) => {
    if (errosDeRede.length < 8) errosDeRede.push(r.url().slice(0, 70) + ' -> ' + ((r.failure() && r.failure().errorText) || '?'));
  });

  console.log('\n  Abrindo ' + ALVO + ' ...');
  let resposta = null;
  try {
    resposta = await page.goto(ALVO, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log('  ❌ Nao consegui abrir a pagina: ' + String(e.message).slice(0, 120));
  }

  if (resposta) console.log('  Resposta do site: ' + resposta.status() + ' ' + (resposta.statusText() || ''));
  await page.waitForTimeout(4000);

  console.log('  Endereco final: ' + page.url());
  console.log('  Titulo da pagina: ' + ((await page.title().catch(() => '')) || '(sem titulo)'));

  const texto = (await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')) || '';
  console.log('  Tamanho do texto na tela: ' + texto.length + ' caracteres');
  if (texto.trim()) console.log('  Comeco do texto: ' + texto.replace(/\s+/g, ' ').slice(0, 160));
  else console.log('  ⚠️  A pagina veio VAZIA — foi bloqueada ou nao carregou.');

  if (errosDeRede.length) {
    console.log('\n  Coisas que o navegador nao conseguiu carregar:');
    errosDeRede.forEach((e) => console.log('    · ' + e));
  }

  console.log('\n  A janela vai ficar aberta 2 minutos para voce olhar.');
  console.log('  Se der para fazer o login normalmente aqui, o login pelo atalho tambem vai dar.');
  await page.waitForTimeout(120000).catch(() => {});
  await browser.close().catch(() => {});
  console.log('\n  Fim do teste.');
  process.exit(0);
})().catch((e) => {
  console.log('\n  ❌ Erro: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
