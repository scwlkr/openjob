FROM node:24-bookworm-slim
WORKDIR /opt/openjob
COPY dist/npm/ ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && mkdir /state && chown node:node /state
USER node
ENV NODE_ENV=production OPENJOB_NO_UPDATE_CHECK=1
CMD ["node", "openjob.mjs", "server", "--host", "0.0.0.0"]
