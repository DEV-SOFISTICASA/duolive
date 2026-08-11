# DuoLive · Robô de vendas na nuvem (precisa de um navegador de verdade)
#
# A imagem oficial do Playwright já vem com o Chromium e todas as bibliotecas
# que ele precisa — por isso não instalamos navegador nenhum aqui. A versão
# (v1.48.0) casa com a do playwright-core no package.json.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# instala só as dependências primeiro (aproveita o cache entre deploys)
COPY package.json ./
RUN npm install --omit=dev

# copia o resto do código (o .dockerignore evita levar logins e segredos)
COPY . .

# na nuvem é sempre: só o Gerenciador de LIVE + o Chromium do contêiner
ENV DUOLIVE_SO_CONSOLE=1 \
    DUOLIVE_CHROMIUM_NUVEM=1

# O TikTok recusa navegador invisível. Então rodamos o robô com um navegador DE
# VERDADE (headed) numa TELA VIRTUAL (Xvfb) — que a imagem do Playwright já traz.
# O xvfb-run cria o DISPLAY; o navegador.js vê o DISPLAY e abre headed. Sem isso,
# o Chromium sobe invisível e o TikTok bloqueia (era a causa do "nao captura").
# Qual robô roscar: DUOLIVE_ROBO_ENTRADA (padrão robo-nuvem.js = vendas).
CMD ["sh", "-c", "xvfb-run -a --server-args='-screen 0 1280x720x24' node ${DUOLIVE_ROBO_ENTRADA:-robo-nuvem.js}"]
