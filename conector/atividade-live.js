// DuoLive · Vendas do Gerenciador de LIVE (o painel que mostra na hora)
//
// O painel de LIVE (shop.tiktok.com/streamer) mostra cada venda no instante da
// compra, com valor. Elas chegam pela chamada `user_activity_history`: cada
// evento é uma mensagem codificada (protobuf). A gente decodifica e pega as que
// são VENDA de verdade (têm valor) — separando das mensagens de "fulano está
// interessado no produto", que NÃO têm valor e não podem virar venda falsa.
//
// Por que é robusto: é uma chamada GET simples, dá para repetir à vontade — sem
// a assinatura que vence do Seller Center, sem depender de WebSocket binário.
//
// Estrutura confirmada nos dados reais (2026-08-06):
//   venda (tem valor):   .3.1.3 = comprador · .3.2.1 = produto ·
//                        .3.2.3.1 = "R$ 39,99" · .3.2.4 = id do produto · .3.3 = qtd
//   só interesse (pular): .8.x com .8.5=1, comprador + produto mas SEM valor

// ---------- parser protobuf leve (sem schema) ----------
function lerVarint(buf, i) {
  let v = 0, sh = 0;
  while (i.p < buf.length) { const b = buf[i.p++]; v += (b & 127) * Math.pow(2, sh); if (!(b & 128)) break; sh += 7; }
  return v;
}
function percorre(buf, caminho, saida, prof) {
  if (prof > 9) return;
  const i = { p: 0 };
  while (i.p < buf.length) {
    const key = buf[i.p++]; if (key === undefined) break;
    const campo = key >> 3, tipo = key & 7;
    const cam = caminho + '.' + campo;
    if (tipo === 0) { const v = lerVarint(buf, i); if (saida.ints[cam] === undefined) saida.ints[cam] = v; }
    else if (tipo === 2) {
      const len = lerVarint(buf, i);
      if (i.p + len > buf.length) break;
      const sub = buf.slice(i.p, i.p + len); i.p += len;
      const s = sub.toString('utf8');
      const imprimivel = /^[\x20-\x7e -￿]*$/.test(s) && !/�/.test(s);
      if (imprimivel && s.length >= 1 && s.length < 200) { if (saida.strs[cam] === undefined) saida.strs[cam] = s; }
      else percorre(sub, cam, saida, prof + 1);
    } else if (tipo === 5) { i.p += 4; } else if (tipo === 1) { i.p += 8; } else break;
  }
}
function decodifica(b64) {
  let buf; try { buf = Buffer.from(String(b64 || ''), 'base64'); } catch (e) { return null; }
  const saida = { strs: {}, ints: {} };
  percorre(buf, '', saida, 0);
  return saida;
}

// "R$ 39,99" | "39,99" | "1.234,56" -> número
function paraReais(v) {
  if (v == null) return 0;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return +s || 0;
}

// ---------- as VENDAS do feed de atividade ----------
// Só conta as que têm valor (.3.2.3.1). As de "interesse" (.8.x) são ignoradas.
function vendasDaAtividade(json) {
  const msgs = (json && json.data && json.data.messages) || [];
  const vendas = [];
  for (const m of msgs) {
    const d = decodifica(m.oec_live_manager_message_body_raw);
    if (!d) continue;
    const valorTxt = d.strs['.3.2.3.1'];
    if (!valorTxt) continue;            // sem valor = não é venda confirmada
    const valor = paraReais(valorTxt);
    if (!valor) continue;
    const produtoId = d.strs['.3.2.4'] || '';
    const quem = d.strs['.3.1.3'] || '';
    vendas.push({
      // id único da venda para não contar duas vezes; usa o id da mensagem
      messageId: String(m.message_id || (produtoId + ':' + quem + ':' + (m.timestamp || ''))),
      ts: +m.timestamp || 0,
      quem: quem,
      produtoId: String(produtoId),
      produtoNome: d.strs['.3.2.1'] || '',
      valor: valor,
      qtd: d.ints['.3.3'] || 1,
    });
  }
  return vendas;
}

module.exports = { vendasDaAtividade, decodifica, paraReais };
