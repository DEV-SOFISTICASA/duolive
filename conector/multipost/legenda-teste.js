// MultiPost · testar o cérebro num vídeo (a IA lê e escreve a legenda)
//
//   npm run legenda-teste -- --video "C:\videos\x.mp4"
//   npm run legenda-teste -- --video "C:\videos\x.mp4" --loja "loja de decoração"
//
// Não publica nada — só mostra a legenda e as hashtags que a IA sugeriu.

const { legendaDoVideo } = require('./legenda-ia.js');

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : ''; }

(async () => {
  const video = arg('--video');
  if (!video) {
    console.log('\n  Faltou o vídeo. Ex.:  npm run legenda-teste -- --video "C:\\videos\\x.mp4"\n');
    process.exit(1);
  }
  console.log('');
  console.log('  MultiPost · cérebro (a IA lê o vídeo)');
  console.log('  Vídeo: ' + video);
  console.log('  Pensando...');
  console.log('');
  try {
    const r = await legendaDoVideo(video, { loja: arg('--loja') || 'uma loja' });
    console.log('  Legenda:  ' + r.legenda);
    console.log('  Hashtags: ' + r.hashtags.join(' '));
    console.log('  (modelo: ' + r.modelo + ')');
    console.log('');
  } catch (e) {
    console.log('  ' + e.message + '\n');
    process.exitCode = 1;
  }
  // sem process.exit() aqui: a IA do Google ainda fecha conexões por baixo
  // dos panos, e sair na marra fazia o Node reclamar feio no Windows.
})();
