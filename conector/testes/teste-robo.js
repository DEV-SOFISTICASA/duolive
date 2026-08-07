// Teste do leitor de pedidos do robô de vendas (sem ligar o robô)
// Usa as funções exportadas por robo-vendas.js: parsePedido, garimpa, achaValor
const { parsePedido, garimpa, achaValor } = require('C:/Users/PC2/Desktop/Claude/duolive/conector/robo-vendas.js');

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}

// ---------- 1. pedido estilo TikTok (main_order_id + grand_total aninhado) ----------
const tiktok = {
  code: 0,
  data: {
    main_order_list: [{
      main_order_id: '576501234567890123',
      buyer_username: 'maria.silva',
      grand_total: { price_val: '89.90' },
      create_time: Math.floor(Date.now() / 1000),
    }],
  },
};
let achados = [];
garimpa(tiktok, achados);
afirma('TikTok: encontra 1 pedido', achados.length === 1, 'achou ' + achados.length);
afirma('TikTok: id do pedido', achados[0] && achados[0].orderId === '576501234567890123', JSON.stringify(achados[0]));
afirma('TikTok: comprador', achados[0] && achados[0].quem === 'maria.silva');
afirma('TikTok: valor R$ 89,90', achados[0] && Math.abs(achados[0].valor - 89.9) < 0.001, 'valor=' + (achados[0] && achados[0].valor));
afirma('TikTok: data em ms', achados[0] && achados[0].criado > 1e12);

// ---------- 2. pedido estilo Shopee (card_header + valor nos pacotes) ----------
const shopee = {
  error: 0,
  data: {
    cards: [{
      card_header: { order_sn: '250806ABCXYZ123', buyer_name: 'joao123' },
      package_list: [{ total_amount: 8990000 }], // micros (89,90 x 100000) — convertido depois pelo processa()
    }],
  },
};
achados = [];
garimpa(shopee, achados);
afirma('Shopee: encontra 1 pedido', achados.length === 1, 'achou ' + achados.length);
afirma('Shopee: id no card_header', achados[0] && achados[0].orderId === '250806ABCXYZ123', JSON.stringify(achados[0]));
afirma('Shopee: comprador', achados[0] && achados[0].quem === 'joao123');
afirma('Shopee: valor em micros lido', achados[0] && achados[0].valor === 8990000, 'valor=' + (achados[0] && achados[0].valor));

// ---------- 3. valores em formato brasileiro e objetinhos de preço ----------
afirma('Valor "R$ 1.234,56"', Math.abs(achaValor({ grand_total: { format_price: 'R$ 1.234,56' } }) - 1234.56) < 0.001,
  'deu ' + achaValor({ grand_total: { format_price: 'R$ 1.234,56' } }));
afirma('Valor aninhado em payment', Math.abs(achaValor({ payment_info: { total_amount: '59,90' } }) - 59.9) < 0.001,
  'deu ' + achaValor({ payment_info: { total_amount: '59,90' } }));

// ---------- 4. coisas que NÃO são pedido (não pode inventar venda) ----------
afirma('Id curto não vira pedido', parsePedido({ order_id: '123' }) === null);
afirma('Objeto sem id não vira pedido', parsePedido({ nome: 'tapete', preco: 10 }) === null);
achados = [];
garimpa({ data: { banners: [{ id: 1, titulo: 'promo' }], config: { x: 1 } } }, achados);
afirma('JSON sem pedidos: nada encontrado', achados.length === 0, 'achou ' + achados.length);

// ---------- 5. vários pedidos misturados ----------
achados = [];
garimpa({
  data: {
    lista: [
      { order_sn: 'AAA111222333', buyer_username: 'ana', pay_amount: 10 },
      { order_sn: 'BBB444555666', buyer_username: 'bia', pay_amount: 20 },
    ],
  },
}, achados);
afirma('Dois pedidos na mesma resposta', achados.length === 2, 'achou ' + achados.length);

console.log('');
console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + ' testes.'));
process.exit(falha === 0 ? 0 : 1);
