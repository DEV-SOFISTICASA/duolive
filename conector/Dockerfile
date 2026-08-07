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

CMD ["node", "robo-nuvem.js"]
