FROM node:20-alpine

RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    build-base \
  && pip install --break-system-packages --no-cache-dir streamlink yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY package.json ./

EXPOSE 7373

CMD ["node", "src/index.js"]
