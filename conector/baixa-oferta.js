// DuoLive · Baixa a versão MAIS NOVA do robô da ⚡ direto da nuvem (o conector) e
// salva por cima do arquivo local. Serve pra QUALQUER PC ficar sempre com a mesma
// versão, sem ninguém copiar arquivo na mão. É chamado pelo liga-oferta-nuvem.bat
// antes de ligar o robô. NUNCA trava: se a nuvem estiver fora, usa a versão local.
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const linhas = (() => { try { return fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8').split('\n').map((s) => s.trim()); } catch (e) { return []; } })();
const base = (linhas[0] || process.env.DUOLIVE_CONECTOR || '').replace(/\/+$/, '');
const token = linhas[1] || process.env.DUOLIVE_TOKEN || '';
const destino = path.join(__dirname, 'robo-oferta-relampago.js');

if (!base) { console.log('  (sem conector.txt — uso a versão que já está aqui)'); process.exit(0); }

const url = new URL(base + '/robo-oferta-relampago.js');
const lib = url.protocol === 'https:' ? https : http;
lib.get(url, { headers: token ? { 'x-duolive-token': token } : {} }, (r) => {
  if (r.statusCode !== 200) { console.log('  (nuvem respondeu ' + r.statusCode + ' — uso a versão local)'); r.resume(); return; }
  let c = ''; r.on('data', (d) => { c += d; });
  r.on('end', () => {
    // só sobrescreve se veio um arquivo com cara de robô de verdade (nunca gravo lixo/HTML de login)
    if (c.length > 2000 && c.indexOf('reporOfertas') >= 0 && c.indexOf('montaCorpo') >= 0) {
      try { fs.writeFileSync(destino, c); console.log('  ✅ robô da ⚡ atualizado da nuvem (' + c.length + ' bytes).'); }
      catch (e) { console.log('  (não consegui gravar — uso a versão local: ' + e.message + ')'); }
    } else {
      console.log('  (resposta da nuvem não parece o robô — uso a versão local)');
    }
  });
}).on('error', () => { console.log('  (sem internet/conector fora — uso a versão local)'); });
