// DuoLive · Postador — núcleo (abre o TikTok e publica o vídeo)
//
// É a parte "delicada": depende da tela de upload do TikTok, que muda de vez em
// quando. Por isso:
//   • os SELETORES ficam todos juntos aqui embaixo (fácil de ajustar);
//   • por padrão é ENSAIO (faz tudo, menos o clique final de publicar);
//   • quando algo falha, salva um print em postar-logs/ pra gente ver o que mudou.
//
// Só publica de verdade com a variável POSTAR_REAL=1 (igual à sua oferta relâmpago).

const fs = require('fs');
const path = require('path');

const PASTA_LOGS = path.join(__dirname, 'postar-logs');

// -------------------------------------------------------------- SELETORES
// (se o TikTok mudar a tela, é aqui que se conserta)
const SELETORES = {
  inputArquivo: 'input[type="file"]',
  // botão que revela o seletor de arquivo, se o input não estiver logo no DOM
  botaoSelecionar: [
    'button:has-text("Selecionar vídeos")',
    'button:has-text("Selecionar vídeo")',
    'button:has-text("Select video")',
    'button:has-text("Carregar")',
    '[data-e2e="select_video_button"]',
  ],
  legenda: [
    'div[contenteditable="true"][role="textbox"]',
    'div.public-DraftEditor-content',
    'div.notranslate[contenteditable="true"]',
    'div[contenteditable="true"]',
  ],
  botaoPostar: [
    '[data-e2e="post_video_button"]',
    'button:has-text("Publicar")',
    'button:has-text("Post")',
    'button:has-text("Postar")',
  ],
  sucesso: [
    'text=/enviad|publicad|posted|sucesso|your video|foi enviado/i',
    '[data-e2e="upload-success"]',
  ],
};

// garante que a pasta de prints existe
function garantePasta() {
  try { fs.mkdirSync(PASTA_LOGS, { recursive: true }); } catch (e) {}
  return PASTA_LOGS;
}

// espera aparecer o PRIMEIRO seletor visível de uma lista (ou devolve null no fim)
async function achaPrimeiro(page, seletores, timeoutMs) {
  const lista = Array.isArray(seletores) ? seletores : [seletores];
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    for (const s of lista) {
      const loc = page.locator(s).first();
      try { if ((await loc.count()) && (await loc.isVisible())) return loc; } catch (e) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// acha o input[type=file] pra soltar o vídeo. Diferente dos outros: o input de
// arquivo do TikTok fica ESCONDIDO atrás do botão "Selecionar vídeos", então NÃO
// dá pra exigir que ele esteja visível (setInputFiles funciona em input oculto).
// Se o input ainda não estiver no DOM, clica no botão pra revelá-lo.
async function achaInputArquivo(page, timeoutMs) {
  const fim = Date.now() + timeoutMs;
  let clicou = false;
  while (Date.now() < fim) {
    const inp = page.locator('input[type="file"]').first();
    try { if (await inp.count()) return inp; } catch (e) {}
    if (!clicou) {
      const botao = await achaPrimeiro(page, SELETORES.botaoSelecionar, 1500);
      if (botao) { try { await botao.click(); clicou = true; } catch (e) {} }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// o TikTok Studio às vezes mostra a tela de login por um instante enquanto
// confirma os cookies, e só então volta pro upload. Esperar "assentar" evita
// desistir cedo demais e acusar sessão expirada à toa.
async function assenta(page, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (!/\/login|\/signup/.test(page.url())) return; // saiu do login (ou nunca esteve)
    await page.waitForTimeout(500);
  }
}

// olha se apareceu algum sinal de "deu certo" depois de clicar em publicar
async function esperaSucesso(page, timeoutMs) {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    if (/\/content|\/tiktokstudio\/content/.test(page.url())) return true;
    for (const s of SELETORES.sucesso) {
      try { if (await page.locator(s).first().count()) return true; } catch (e) {}
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

// publica UM vídeo em UMA conta.
//   context    perfil FIXO já aberto (navegador.js -> abrePerfil), já logado
//   video      caminho do arquivo de vídeo
//   legenda    texto da legenda (já variado)
//   real       true = publica de verdade; false/omitido = ensaio
//   conta      apelido (só para as mensagens e o nome do print)
// devolve { ok, ensaio?, publicado?, aviso? } ou lança erro com mensagem clara.
// Obs.: quem abriu o context é quem fecha; aqui a gente só fecha a aba (page).
async function postaVideo({ context, video, legenda, real, conta }) {
  conta = conta || 'conta';
  if (!context) {
    throw new Error('Faltou abrir o perfil da conta "' + conta + '". Rode:  npm run login-postar -- --conta ' + conta);
  }
  if (!video || !fs.existsSync(video)) {
    throw new Error('Vídeo não encontrado: ' + video);
  }
  const logDir = garantePasta();
  const page = await context.newPage();
  const print = async (nome) => {
    try { await page.screenshot({ path: path.join(logDir, conta + '-' + nome + '.png') }); } catch (e) {}
  };

  try {
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await assenta(page, 12000); // espera o Studio parar de piscar a tela de login
    if (/\/login|\/signup/.test(page.url())) throw new Error('SESSAO_EXPIRADA');

    // acha o campo de arquivo (tenta o Studio; se não achar, o /upload clássico)
    let input = await achaInputArquivo(page, 25000);
    if (!input) {
      await page.goto('https://www.tiktok.com/upload?lang=pt-BR', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await assenta(page, 12000);
      if (/\/login|\/signup/.test(page.url())) throw new Error('SESSAO_EXPIRADA');
      input = await achaInputArquivo(page, 25000);
    }
    if (!input) {
      await print('sem-input');
      throw new Error('Não achei onde soltar o vídeo (o TikTok pode ter mudado a tela ou pedido verificação). Veja o print em ' + logDir);
    }

    await input.setInputFiles(video);
    console.log('  [' + conta + '] vídeo enviado — aguardando o TikTok processar (pode levar um tempo)...');

    // a legenda só aparece quando o upload avança: é o nosso sinal de "subiu"
    const editor = await achaPrimeiro(page, SELETORES.legenda, 180000);
    if (!editor) {
      await print('sem-editor');
      throw new Error('O vídeo não terminou de processar a tempo. Veja o print em ' + logDir);
    }

    // escreve a legenda (limpa o que estiver lá e digita)
    try {
      await editor.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type(legenda || '', { delay: 15 });
      await page.keyboard.press('Escape'); // fecha a lista de sugestão de hashtag, se abrir
    } catch (e) {
      console.log('  [' + conta + '] aviso: não consegui escrever a legenda (' + e.message + ')');
    }

    const botao = await achaPrimeiro(page, SELETORES.botaoPostar, 30000);
    if (!botao) {
      await print('sem-botao');
      throw new Error('Não achei o botão de publicar. Veja o print em ' + logDir);
    }

    // ENSAIO: para aqui, sem publicar
    if (!real) {
      await print('ensaio-pronto');
      console.log('  [' + conta + '] ENSAIO ✅ tudo pronto — NÃO publiquei. Print em ' + logDir);
      await page.close().catch(() => {});
      return { ok: true, ensaio: true };
    }

    // DE VERDADE: espera o botão habilitar (fica travado enquanto processa) e clica
    const limite = Date.now() + 120000;
    while (Date.now() < limite) {
      if (await botao.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await botao.click();
    const publicado = await esperaSucesso(page, 60000);
    await print(publicado ? 'publicado' : 'apos-clique');
    await page.close().catch(() => {});
    return {
      ok: true,
      publicado,
      aviso: publicado ? undefined : 'Cliquei em publicar mas não vi a confirmação na tela — confira no app do TikTok. Print em ' + logDir,
    };
  } catch (e) {
    await print('erro');
    await page.close().catch(() => {});
    if (e.message === 'SESSAO_EXPIRADA') {
      throw new Error('O login da conta "' + conta + '" venceu. Refaça:  npm run login-postar -- --conta ' + conta);
    }
    throw e;
  }
}

module.exports = { postaVideo, SELETORES, PASTA_LOGS };
