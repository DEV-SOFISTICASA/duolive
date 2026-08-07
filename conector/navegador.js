// DuoLive · Navegador dos robôs (uso comum de todos os robôs e logins)
//
// Abre um navegador que já exista no seu PC: Google Chrome, Microsoft Edge
// ou Brave — o primeiro que encontrar. O Playwright só conhece Chrome e Edge
// pelo "canal"; o Brave a gente acha pelo caminho do brave.exe.
//
// Uso:  const { abreNavegador } = require('./navegador.js');
//       const browser = await abreNavegador(true);    // true = invisível

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

// onde o Brave costuma ficar instalado
function achaBrave() {
  const lugares = [];
  if (process.env.ProgramFiles) lugares.push(path.join(process.env.ProgramFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  if (process.env['ProgramFiles(x86)']) lugares.push(path.join(process.env['ProgramFiles(x86)'], 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  if (process.env.LOCALAPPDATA) lugares.push(path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  lugares.push('/usr/bin/brave-browser', '/usr/bin/brave', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  for (const p of lugares) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return '';
}

// tenta Chrome, depois Edge, depois Brave. Se não tiver nenhum, explica e encerra.
// Diz na tela qual abriu — quando algo dá errado, essa é a primeira pergunta.
async function abreNavegador(invisivel) {
  try {
    const b = await chromium.launch({ headless: invisivel, channel: 'chrome' });
    console.log('  (usando o Google Chrome)');
    return b;
  } catch (e) {}
  try {
    const b = await chromium.launch({ headless: invisivel, channel: 'msedge' });
    console.log('  (usando o Microsoft Edge)');
    return b;
  } catch (e) {}
  const brave = achaBrave();
  if (brave) {
    try {
      const b = await chromium.launch({ headless: invisivel, executablePath: brave });
      console.log('  (usando o Brave)');
      return b;
    } catch (e) {}
  }
  console.log('  Nao achei nenhum navegador. Instale o Google Chrome, o Edge ou o Brave e tente de novo.');
  process.exit(1);
}

module.exports = { abreNavegador: abreNavegador, achaBrave: achaBrave };
