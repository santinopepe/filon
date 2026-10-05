FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PUERTO=3000 RUTA_BD=/datos/filon.db
RUN mkdir -p /datos && chown node:node /datos
VOLUME ["/datos"]
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "servidor/index.js"]
