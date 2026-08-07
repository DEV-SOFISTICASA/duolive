// DuoLive · Cofre das sessões (uso comum do subir/baixar)
//
// Os arquivos sessao-*.json SÃO o seu login: quem tiver um deles entra na sua
// loja sem senha e sem a verificação em duas etapas. Por isso eles nunca vão
// para a nuvem como estão — viram UM arquivo embaralhado (sessoes.cofre) que
// só a sua senha abre.
//
// O embaralhamento é o AES-256-GCM, que além de esconder o conteúdo percebe se
// alguém mexeu no arquivo. A senha não é guardada em lugar nenhum: ela vira a
// chave na hora, pelo scrypt (que é lento de propósito, para atrapalhar quem
// tentar adivinhar no chute).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MARCA = 'cofre-v1';
const SCRYPT = { N: 16384, r: 8, p: 1 }; // ~0,1s por tentativa

function chaveDaSenha(senha, sal) {
  return crypto.scryptSync(senha, sal, 32, SCRYPT);
}

// objeto -> arquivo embaralhado
function fecha(dados, senha) {
  const sal = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chaveDaSenha(senha, sal), iv);
  const corpo = Buffer.concat([cifra.update(JSON.stringify(dados), 'utf8'), cifra.final()]);
  return {
    duolive: MARCA,
    guardadoEm: new Date().toISOString(),
    sal: sal.toString('base64'),
    iv: iv.toString('base64'),
    selo: cifra.getAuthTag().toString('base64'),
    dados: corpo.toString('base64'),
  };
}

// arquivo embaralhado -> objeto (erro claro se a senha estiver errada)
function abre(cofre, senha) {
  if (!cofre || cofre.duolive !== MARCA) throw new Error('este arquivo nao e um cofre do DuoLive');
  const decifra = crypto.createDecipheriv('aes-256-gcm', chaveDaSenha(senha, Buffer.from(cofre.sal, 'base64')), Buffer.from(cofre.iv, 'base64'));
  decifra.setAuthTag(Buffer.from(cofre.selo, 'base64'));
  let texto;
  try {
    texto = Buffer.concat([decifra.update(Buffer.from(cofre.dados, 'base64')), decifra.final()]).toString('utf8');
  } catch (e) {
    throw new Error('SENHA_ERRADA');
  }
  return JSON.parse(texto);
}

// as sessões que existem na pasta (é o que vai para o cofre)
function sessoesDaPasta(dir) {
  return fs.readdirSync(dir || __dirname).filter((a) => /^sessao-.+\.json$/.test(a)).sort();
}

// pergunta a senha sem mostrar na tela (aparecem asteriscos).
// Também aceita a variável DUOLIVE_SENHA (útil para automatizar).
const ENTER = ['\r', '\n'];
const APAGA = ['', '']; // Backspace / Delete
const CANCELA = '';           // Ctrl+C

function pedeSenha(pergunta) {
  if (process.env.DUOLIVE_SENHA) return Promise.resolve(process.env.DUOLIVE_SENHA);
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('Preciso da senha. Rode este comando numa janela de terminal,'
      + '\n  ou defina a senha antes:  set DUOLIVE_SENHA=suasenha'));
  }
  return new Promise((ok) => {
    process.stdout.write(pergunta);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let senha = '';
    const ouve = (bloco) => {
      const c = bloco.toString('utf8');
      if (ENTER.includes(c)) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', ouve);
        process.stdout.write('\n');
        ok(senha);
      } else if (c === CANCELA) {
        process.stdout.write('\n');
        process.exit(1);
      } else if (APAGA.includes(c)) {
        if (senha.length) { senha = senha.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (c >= ' ') {
        senha += c;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', ouve);
  });
}

// onde fica o repositório privado do cofre (uma linha em cofre.txt)
function enderecoNuvem(dir) {
  if (process.env.DUOLIVE_COFRE) return process.env.DUOLIVE_COFRE.trim();
  try {
    const t = fs.readFileSync(path.join(dir || __dirname, 'cofre.txt'), 'utf8');
    const primeira = t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0];
    if (primeira) return primeira;
  } catch (e) {}
  return '';
}

module.exports = {
  MARCA, fecha, abre, sessoesDaPasta, pedeSenha, enderecoNuvem,
  PASTA_NUVEM: (dir) => path.join(dir || __dirname, '.cofre-nuvem'),
  ARQ_COFRE: 'sessoes.cofre',
};
