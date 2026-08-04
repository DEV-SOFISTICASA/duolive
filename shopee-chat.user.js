// ==UserScript==
// @name         DuoLive · Chat da Shopee
// @namespace    duolive
// @version      1.0
// @description  Lê o chat da sua live da Shopee (na página aberta no seu navegador) e manda para o Multichat do DuoLive.
// @match        https://live.shopee.com.br/*
// @match        https://creator.shopee.com.br/*
// @match        https://live.shopee.com/*
// @grant        none
// ==/UserScript==

// Como funciona (bem simples): durante a live, deixe aberta a página da sua live na
// Shopee. Este script observa a caixa de chat que a própria página mostra e repassa
// cada mensagem nova para o conector do DuoLive no seu PC (http://127.0.0.1:9797).
// Nada de senha, nada sai do seu computador.

(function () {
  'use strict';
  // Endereco do conector. No PC deixe como esta. Na nuvem, troque pela URL do
  // Render, ex.:  var BASE = 'https://duolive-xxxx.onrender.com';
  var BASE = 'http://127.0.0.1:9797';
  var CONECTOR = BASE.replace(/\/+$/, '') + '/eventos';
  var escolhido = null;          // a caixa de chat detectada
  var contagem = new Map();      // quantas mensagens novas cada caixa recebeu
  var vistos = [];               // últimas mensagens já enviadas (evita repetir)

  function avisa(txt, cor) {
    var b = document.getElementById('duolive-aviso');
    if (!b) {
      b = document.createElement('div');
      b.id = 'duolive-aviso';
      b.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:999999;font:11px sans-serif;' +
        'padding:4px 10px;border-radius:99px;background:rgba(0,0,0,.75);color:#fff;pointer-events:none';
      document.documentElement.appendChild(b);
    }
    b.textContent = txt;
    b.style.color = cor || '#fff';
  }

  function manda(quem, texto) {
    var chave = quem + '|' + texto;
    if (vistos.indexOf(chave) >= 0) return;
    vistos.push(chave); if (vistos.length > 80) vistos.shift();
    try {
      fetch(CONECTOR, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quem: quem, texto: texto }) })
        .then(function(){ avisa('DuoLive ✓ chat da Shopee conectado', '#4ade80'); })
        .catch(function(){ avisa('DuoLive: ligue o conector no PC (npm start)', '#fbbf24'); });
    } catch (e) {}
  }

  function relay(no) {
    var t = (no.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 300) return;
    // tenta separar "usuário" do "texto": linha de cima, primeiro elemento, ou "nome:"
    var quem = '', texto = t;
    var partes = (no.innerText || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    if (partes.length >= 2 && partes[0].length <= 30) { quem = partes[0]; texto = partes.slice(1).join(' '); }
    else {
      var f = no.firstElementChild;
      var qn = f ? (f.innerText || '').replace(/\s+/g, ' ').trim() : '';
      if (qn && qn.length <= 30 && t.length > qn.length && t.indexOf(qn) === 0) {
        quem = qn; texto = t.slice(qn.length).trim().replace(/^[:\-–]\s*/, '');
      } else {
        var i = t.indexOf(':');
        if (i > 0 && i <= 30) { quem = t.slice(0, i).trim(); texto = t.slice(i + 1).trim(); }
      }
    }
    if (texto) manda(quem, texto);
  }

  var mo = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.type !== 'childList' || !m.addedNodes.length) return;
      for (var i = 0; i < m.addedNodes.length; i++) {
        var n = m.addedNodes[i];
        if (n.nodeType !== 1) continue;
        var t = (n.innerText || '').trim();
        if (!t || t.length > 300) continue;
        contagem.set(m.target, (contagem.get(m.target) || 0) + 1);
        if (m.target === escolhido) relay(n);
      }
    });
  });

  function comeca() {
    if (!document.body) { setTimeout(comeca, 500); return; }
    mo.observe(document.body, { childList: true, subtree: true });
    avisa('DuoLive: procurando o chat da live…');
    setInterval(function () {
      // a caixa de chat é a que mais recebe mensagens novas — eleita sozinha
      var melhor = null, max = 0;
      contagem.forEach(function (c, el) {
        if (c > max && document.contains(el)) { max = c; melhor = el; }
      });
      if (melhor && max >= 5 && melhor !== escolhido) {
        escolhido = melhor;
        avisa('DuoLive ✓ chat encontrado — mandando para o Multichat', '#4ade80');
      }
      contagem.clear();
    }, 5000);
  }
  comeca();
})();
