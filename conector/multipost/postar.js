// DuoLive · Postador — publica em UMA conta (bom para testar)
//
// Por padrão é ENSAIO: faz tudo, menos o clique final. Para publicar DE VERDADE,
// ponha POSTAR_REAL=1 na frente.
//
// Exemplos (Windows):
//   Testar (não publica):
//     npm run postar -- --conta monaco --video "C:\videos\promo.mp4" --legenda "Chegou novidade #promo"
//   Publicar de verdade:
//     set POSTAR_REAL=1&& npm run postar -- --conta monaco --video "C:\videos\promo.mp4" --legenda "Chegou novidade #promo"

const fs = require('fs');
const { abreNavegador } = require('../navegador.js');
const C = require('./contas-postar.js');
const { postaVideo } = require('./postador-nucleo.js');

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : '';
}

(async () => {
  const conta = C.contaPedida();
  const video = arg('--video');
  let legenda = arg('--legenda');
  const legendaArq = arg('--legenda-arquivo');
  if (!legenda && legendaArq && fs.existsSync(legendaArq)) legenda = fs.readFileSync(legendaArq, 'utf8').trim();
  const real = process.env.POSTAR_REAL === '1';

  if (!video) {
    console.log('\n  Faltou o vídeo. Ex.:  npm run postar -- --conta ' + conta + ' --video "C:\\videos\\promo.mp4" --legenda "sua legenda"\n');
    process.exit(1);
  }

  console.log('');
  console.log('  MultiPost · postagem no TikTok');
  console.log('  Conta:   ' + conta);
  console.log('  Vídeo:   ' + video);
  console.log('  Legenda: ' + (legenda || '(vazia)'));
  console.log('  Modo:    ' + (real ? 'PUBLICAR DE VERDADE' : 'ENSAIO (não publica)'));
  console.log('');

  const browser = await abreNavegador(false); // visível: dá pra acompanhar / resolver verificação
  try {
    const r = await postaVideo({ browser, sessaoArq: C.arquivoSessao(conta), video, legenda, real, conta });
    if (r.ensaio) console.log('\n  Pronto (ensaio). Quando estiver ok, publique com POSTAR_REAL=1.\n');
    else if (r.publicado) console.log('\n  Publicado ✅\n');
    else console.log('\n  ' + (r.aviso || 'Terminei, confira no app.') + '\n');
  } catch (e) {
    console.log('\n  ERRO: ' + e.message + '\n');
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(process.exitCode || 0);
})();
