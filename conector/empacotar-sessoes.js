// DuoLive · Empacota os seus logins num arquivo sessoes.cofre para a nuvem
//
// Junta todos os sessao-*.json desta pasta num único arquivo embaralhado
// (sessoes.cofre), protegido por uma senha. Depois você sobe ESSE arquivo no
// Render como "Secret File" e usa a MESMA senha na variável DUOLIVE_SENHA.
// Assim o robô da nuvem entra nas suas lojas sem você digitar login nenhum.
//
// Como usar:  npm run empacotar-sessoes   (numa janela de terminal, para digitar a senha)

const fs = require('fs');
const path = require('path');
const C = require('./cofre.js');

(async () => {
  console.log('\n  DuoLive · Empacotar os logins para a nuvem\n');
  const arquivos = C.sessoesDaPasta(__dirname);
  if (!arquivos.length) {
    console.log('  Não achei nenhum login (sessao-*.json) aqui. Faça os logins primeiro.\n');
    process.exit(1);
  }
  console.log('  Vou empacotar ' + arquivos.length + ' login(s):');
  arquivos.forEach((a) => console.log('    · ' + a));

  const senha = await C.pedeSenha('\n  Crie uma senha para o cofre (guarde bem): ');
  if (!senha || senha.length < 4) { console.log('\n  Use uma senha com pelo menos 4 caracteres.\n'); process.exit(1); }
  const conf = await C.pedeSenha('  Digite a senha de novo: ');
  if (conf !== senha) { console.log('\n  As senhas não bateram. Tente de novo.\n'); process.exit(1); }

  const sessoes = {};
  arquivos.forEach((a) => { sessoes[a] = JSON.parse(fs.readFileSync(path.join(__dirname, a), 'utf8')); });
  const cofre = C.fecha({ sessoes: sessoes }, senha);
  const destino = path.join(__dirname, C.ARQ_COFRE); // sessoes.cofre
  fs.writeFileSync(destino, JSON.stringify(cofre));

  console.log('\n  ✅ Pronto! Criei o arquivo:');
  console.log('     ' + destino);
  console.log('\n  Agora, no Render:');
  console.log('   1) no serviço do robô, aba Environment > Secret Files, suba esse arquivo');
  console.log('      com o nome:  ' + C.ARQ_COFRE);
  console.log('   2) na variável DUOLIVE_SENHA, ponha a MESMA senha que você acabou de criar.\n');
  process.exit(0);
})().catch((e) => { console.log('\n  Deu erro: ' + (e && e.message ? e.message : e) + '\n'); process.exit(1); });
