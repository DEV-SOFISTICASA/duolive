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
//   🧠 Deixando a IA escrever a legenda (é só não dar --legenda):
//     npm run postar -- --conta monaco --video "C:\videos\promo.mp4" --estilo "loja de decoração"
//   (aqui é --estilo, não --loja, porque --loja neste comando é o apelido da conta)

const fs = require('fs');
const { abrePerfil } = require('../navegador.js');
const C = require('./contas-postar.js');
const { postaVideo } = require('./postador-nucleo.js');
const { legendaDoVideo } = require('./legenda-ia.js');

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
  if (!C.temLogin(conta)) {
    console.log('\n  A conta "' + conta + '" ainda não tem login. Faça uma vez (nasce dentro do robô):');
    console.log('    npm run login-postar -- --conta ' + conta + '\n');
    process.exit(1);
  }

  // 🧠 sem legenda? A IA olha o vídeo e escreve (legenda + hashtags juntas)
  if (!legenda) {
    console.log('\n  🧠 Sem legenda — a IA vai olhar o vídeo e escrever...');
    try {
      const r = await legendaDoVideo(video, { estilo: arg('--estilo'), dica: arg('--dica') });
      legenda = (r.legenda + ' ' + r.hashtags.join(' ')).trim();
    } catch (e) {
      console.log('\n  Não consegui criar a legenda com a IA: ' + e.message);
      console.log('  (Dá pra postar mesmo assim dizendo a legenda você mesmo: --legenda "seu texto")\n');
      // sair "na marra" logo depois de falar com a IA crasha o Node no Windows;
      // então marca o erro, agenda uma saída de segurança e deixa fechar sozinho
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 2000).unref();
      return;
    }
  }

  console.log('');
  console.log('  MultiPost · postagem no TikTok');
  console.log('  Conta:   ' + conta);
  console.log('  Vídeo:   ' + video);
  console.log('  Legenda: ' + (legenda || '(vazia)'));
  console.log('  Modo:    ' + (real ? 'PUBLICAR DE VERDADE' : 'ENSAIO (não publica)'));
  console.log('');

  const context = await abrePerfil(C.pastaPerfil(conta), false); // visível: dá pra acompanhar / resolver verificação
  try {
    const r = await postaVideo({ context, video, legenda, real, conta });
    if (r.ensaio) console.log('\n  Pronto (ensaio). Quando estiver ok, publique com POSTAR_REAL=1.\n');
    else if (r.publicado) console.log('\n  Publicado ✅\n');
    else console.log('\n  ' + (r.aviso || 'Terminei, confira no app.') + '\n');
  } catch (e) {
    console.log('\n  ERRO: ' + e.message + '\n');
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
  // deixa o Node terminar sozinho (a IA e o navegador ainda fecham conexões);
  // se algo ficar preso, o timer abaixo força a saída em 2 segundos.
  setTimeout(() => process.exit(process.exitCode || 0), 2000).unref();
})();
