FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PXT_HOME=/tmp/pxt-home

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        python3 \
        python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

COPY src ./src

RUN mkdir -p /tmp/pxt-home

EXPOSE 8090

CMD ["npm", "start"]
