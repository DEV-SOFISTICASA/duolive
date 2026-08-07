// DuoLive · Subir as sessões para a nuvem (embaralhadas)
//
// Junta todos os sessao-*.json num arquivo só (sessoes.cofre), embaralha com a
// SUA senha e manda para o seu repositório PRIVADO. Sem a senha, o arquivo lá
// na nuvem não serve para nada.
//
// Como usar:  npm run subir-sessoes
// Antes disso: cole o endereço do repositório privado em conector/cofre.txt

const fs = require('fs');
const path = require('path');
const C = require('./cofre.js');
const G = require('./git-cofre.js');

(async () => {
  const sessoes = C.sessoesDaPasta(__dirname);
  console.log('\n  DuoLive · Subir as sessões para a nuvem\n');

  if (!sessoes.length) {
    console.log('  Não achei nenhum login guardado nesta pasta.');
    console.log('  Faça os logins primeiro (npm run login-tiktok / login-shopee / login-console).\n');
    process.exit(1);
  }

  console.log('  Vou guardar ' + sessoes.length + ' login(s):');
  sessoes.forEach((s) => console.log('    · ' + s));
  console.log('');

  const senha = await C.pedeSenha('  Crie uma senha para o cofre: ');
  if (senha.length < 8) {
    console.log('\n  A senha precisa ter pelo menos 8 letras/números. Tente de novo.\n');
    process.exit(1);
  }
  const confere = await C.pedeSenha('  Repita a senha:              ');
  if (senha !== confere) {
    console.log('\n  As duas senhas não bateram. Rode de novo.\n');
    process.exit(1);
  }

  // o cofre leva o conteúdo de cada sessão, com o nome do arquivo
  const conteudo = {};
  sessoes.forEach((s) => { conteudo[s] = JSON.parse(fs.readFileSync(path.join(__dirname, s), 'utf8')); });

  const cofre = C.fecha({ sessoes: conteudo, de: 'duolive' }, senha);
  const destino = G.pastaDoCofre(__dirname);   // clona/atualiza o repo privado se houver
  const arquivo = path.join(destino, C.ARQ_COFRE);
  fs.writeFileSync(arquivo, JSON.stringify(cofre, null, 1));

  const tamanho = Math.round(fs.statSync(arquivo).size / 1024);
  console.log('\n  🔒 Cofre fechado (' + tamanho + ' KB) — o conteúdo virou código embaralhado.');

  if (destino === __dirname) {
    console.log('\n  Ele ficou aqui: ' + arquivo);
    console.log('  (nenhum repositório na nuvem configurado — veja conector/cofre.txt)\n');
    process.exit(0);
  }

  G.enviar(destino, 'sessoes do DuoLive · ' + sessoes.length + ' login(s)');
  console.log('\n  ✅ Pronto! As sessões estão na nuvem, embaralhadas.');
  console.log('     Em outro computador, use:  npm run baixar-sessoes\n');
  console.log('  ⚠️  Guarde bem a senha — sem ela ninguém abre o cofre, nem eu.\n');
  process.exit(0);
})().catch((e) => {
  console.log('\n  Deu erro: ' + (e && e.message ? e.message : e) + '\n');
  process.exit(1);
});
