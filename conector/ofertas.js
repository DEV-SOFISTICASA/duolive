// DuoLive · Ofertas da live (descontos fixos, salvos no Supabase)
//
// Modelo conjunto + exceção:
//   - Uma linha com sku VAZIO = o desconto do CONJUNTO (vale para todas as estampas).
//   - Uma linha com sku PREENCHIDO = a exceção de UMA estampa (sobrepõe o conjunto).
//
// Na hora da venda, o desconto de uma estampa X é: a exceção de X, se houver;
// senão, o desconto do conjunto. Tudo fica salvo até o ADM mudar.

const SB = require('./supabase.js');

// todas as ofertas de uma loja (conjuntos + exceções)
async function listar(loja) {
  if (!SB.ativo()) return [];
  return SB.seleciona('ofertas', 'loja=eq.' + encodeURIComponent(loja) + '&order=nome,sku.nullsfirst') || [];
}

// filtro que identifica UMA oferta (conjunto = sku nulo; exceção = sku preenchido)
function filtroDe(o) {
  let f = 'loja=eq.' + encodeURIComponent(o.loja) + '&produto_id=eq.' + encodeURIComponent(o.produto_id);
  f += '&sku=' + (o.sku ? 'eq.' + encodeURIComponent(o.sku) : 'is.null');
  return f;
}

// salva/atualiza o desconto (do conjunto ou de uma estampa). Só o ADM chama isto.
async function salvar(o) {
  const existe = await SB.seleciona('ofertas', filtroDe(o) + '&select=id&limit=1');
  const campos = {
    loja: o.loja, plataforma: o.plataforma || 'tiktok', produto_id: String(o.produto_id),
    sku: o.sku || null, nome: o.nome || null, imagem: o.imagem || null,
    variacao_nome: o.variacao_nome || null,
    valor_normal: o.valor_normal != null ? o.valor_normal : null,
    valor_desconto: o.valor_desconto != null ? o.valor_desconto : null,
    ativa_na_live: o.ativa_na_live != null ? !!o.ativa_na_live : undefined,
    atualizado_em: new Date().toISOString(),
  };
  Object.keys(campos).forEach((k) => { if (campos[k] === undefined) delete campos[k]; });
  if (existe && existe[0]) return SB.atualiza('ofertas', 'id=eq.' + existe[0].id, campos);
  return SB.insere('ofertas', [campos]);
}

// tira uma oferta (o ADM removeu o produto/estampa da live)
async function remover(o) {
  return SB.req('DELETE', 'ofertas?' + filtroDe(o));
}

// o desconto de uma venda: a exceção da estampa, senão o do conjunto
async function descontoDe(loja, produto_id, sku) {
  const rows = await SB.seleciona('ofertas', 'loja=eq.' + encodeURIComponent(loja)
    + '&produto_id=eq.' + encodeURIComponent(produto_id) + '&select=sku,valor_desconto,nome');
  if (!rows || !rows.length) return null;
  const daEstampa = sku ? rows.find((r) => r.sku === sku) : null;
  if (daEstampa && daEstampa.valor_desconto != null) return daEstampa;
  const doConjunto = rows.find((r) => !r.sku);
  return doConjunto && doConjunto.valor_desconto != null ? doConjunto : null;
}

module.exports = { listar, salvar, remover, descontoDe, filtroDe };
