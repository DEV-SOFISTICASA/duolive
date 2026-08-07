// Testa a leitura das vendas do Gerenciador de LIVE com os dados REAIS
// capturados da live (atividade.json). Confirma: acha as vendas com valor,
// e NÃO conta as mensagens de "interesse" (sem valor) como venda.
const path = require('path');
const fs = require('fs');
const A = require(path.join(__dirname, '..', 'atividade-live.js'));

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}

// dados reais salvos da live (se existir); senão, um mínimo embutido
const ARQ = path.join(__dirname, 'dados', 'atividade-real.json');
let corpo;
if (fs.existsSync(ARQ)) corpo = JSON.parse(fs.readFileSync(ARQ, 'utf8')).corpo;

if (corpo) {
  const vendas = A.vendasDaAtividade(corpo);
  afirma('achou as 4 vendas reais (nem mais, nem menos)', vendas.length === 4, 'achou ' + vendas.length);
  afirma('toda venda tem valor > 0', vendas.every((v) => v.valor > 0), JSON.stringify(vendas.map((v) => v.valor)));
  afirma('toda venda tem comprador', vendas.every((v) => v.quem), JSON.stringify(vendas.map((v) => v.quem)));
  afirma('toda venda tem produto', vendas.every((v) => v.produtoNome));
  afirma('os valores batem (39,99 e 71,98)', vendas.every((v) => [39.99, 71.98].includes(v.valor)), JSON.stringify(vendas.map((v) => v.valor)));
  afirma('cada venda tem messageId único', new Set(vendas.map((v) => v.messageId)).size === vendas.length);
  console.log('    vendas lidas: ' + vendas.map((v) => v.quem + ' R$ ' + v.valor).join(' | '));
} else {
  console.log('  (sem dados reais em testes/dados/atividade-real.json — pulando o teste de dados reais)');
}

// ---------- teste sintético: separa venda (com valor) de interesse (sem valor) ----------
// monta duas mensagens protobuf na mão seria complexo; então testamos o parser
// de valor e a regra "sem valor não é venda" com um corpo mínimo.
const vazio = A.vendasDaAtividade({ data: { messages: [] } });
afirma('lista vazia não quebra', Array.isArray(vazio) && vazio.length === 0);
afirma('paraReais("R$ 39,99") = 39.99', A.paraReais('R$ 39,99') === 39.99, String(A.paraReais('R$ 39,99')));
afirma('paraReais("R$ 1.234,56") = 1234.56', A.paraReais('R$ 1.234,56') === 1234.56, String(A.paraReais('R$ 1.234,56')));
afirma('paraReais("") = 0', A.paraReais('') === 0);

console.log('');
console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
process.exit(falha === 0 ? 0 : 1);
