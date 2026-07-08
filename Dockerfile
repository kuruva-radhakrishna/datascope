# DataScope — single judging image: nginx (9080) + Node backend (8090) + MongoDB Atlas storage.
# Judges run this with a plain `docker run` and no env vars, so connection values are
# baked in at BUILD time via --build-arg (values come from your local .env, never the repo):
#   docker build -t datascope:final \
#     --build-arg MONGODB_URI="..." --build-arg MONGODB_URI_FALLBACK="..." \
#     --build-arg BIFROST_API_KEY="..." .

FROM node:20-bookworm-slim AS fe-build
WORKDIR /app
COPY package.json package-lock.json* vite.config.mjs ./
RUN npm install --no-audit --no-fund
COPY frontend frontend
RUN npm run build

FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backend backend
COPY --from=fe-build /app/frontend/dist frontend/dist
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG MONGODB_URI=""
ARG MONGODB_URI_FALLBACK=""
ARG MONGODB_DB="datascope"
ARG BIFROST_API_KEY=""
ARG BIFROST_URL="https://gateway-buildathon.ltl.sh/v1/chat/completions"
ARG BIFROST_MODEL="gpt-4o"
ENV MONGODB_URI=$MONGODB_URI \
    MONGODB_URI_FALLBACK=$MONGODB_URI_FALLBACK \
    MONGODB_DB=$MONGODB_DB \
    BIFROST_API_KEY=$BIFROST_API_KEY \
    BIFROST_URL=$BIFROST_URL \
    BIFROST_MODEL=$BIFROST_MODEL \
    SEED_DEMO=1 \
    PORT=8090

EXPOSE 9080 8090
CMD ["/entrypoint.sh"]
