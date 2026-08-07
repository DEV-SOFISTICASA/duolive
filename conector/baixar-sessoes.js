// DuoLive · Baixar as sessões da nuvem
//
// Pega o cofre no seu repositório privado, abre com a SUA senha e devolve os
// arquivos sessao-*.json para esta pasta — aí os robôs funcionam neste
// computador como funcionavam no outro.
//
// Como usar:  npm run baixar-sessoes
// Antes disso: cole o endereço do repositório privado em conector/cofre.txt
//
// Se já houver um login aqui com o mesmo nome, ele NÃO é perdido: vira uma
// cópia .anterior antes de ser substituído.

const fs = require('fs');
const path = require('path');
const C = require('./cofre.js');
const G = require('./git-cofre.js');

(async () => {
  console.log('\n  DuoLive · Baixar as sessões da nuvem\n');

  const pasta = G.pastaDoCofre(__dirname);
  const arquivo = path.join(pasta, C.ARQ_COFRE);
  if (!fs.existsSync(arquivo)) {
    console.log('  Não achei o cofre (' + C.ARQ_COFRE + ').');
    if (pasta === __dirname) console.log('  Configure o repositório privado em conector/cofre.txt.');
    else console.log('  Suba as sessões primeiro no outro computador: npm run subir-sessoes');
    console.log('');
    process.exit(1);
  }

  const cofre = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (cofre.guardadoEm) console.log('  Cofre guardado em: ' + new Date(cofre.guardadoEm).toLocaleString('pt-BR'));

  const senha = await C.pedeSenha('  Senha do cofre: ');
  let dentro;
  try {
    dentro = C.abre(cofre, senha);
  } catch (e) {
    if (e.message === 'SENHA_ERRADA') {
      console.log('\n  Senha errada (ou o arquivo foi alterado). Tente de novo.\n');
      process.exit(1);
    }
    throw e;
  }

  const nomes = Object.keys(dentro.sessoes || {});
  if (!nomes.length) { console.log('\n  O cofre está vazio.\n'); process.exit(1); }

  console.log('\n  🔓 Cofre aberto. Devolvendo ' + nomes.length + ' login(s):');
  nomes.forEach((nome) => {
    const destino = path.join(__dirname, nome);
    if (fs.existsSync(destino)) {
      fs.copyFileSync(destino, destino + '.anterior');
      console.log('    · ' + nome + '  (o que estava aqui virou ' + nome + '.anterior)');
    } else {
      console.log('    · ' + nome);
    }
    fs.writeFileSync(destino, JSON.stringify(dentro.sessoes[nome]));
  });

  console.log('\n  ✅ Pronto! Os robôs já podem rodar neste computador.\n');
  process.exit(0);
})().catch((e) => {
  console.log('\n  Deu erro: ' + (e && e.message ? e.message : e) + '\n');
  process.exit(1);
});
