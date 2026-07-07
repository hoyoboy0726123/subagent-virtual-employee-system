# Subagent Virtual Employee System — production image.
#
# Runs fully offline out of the box (deterministic engine). Set GEMINI_API_KEY
# / TAVILY_API_KEY at runtime to enable the live model and web search.
#
#   docker build -t veemp .
#   docker run -p 3001:3001 -v veemp-data:/app/server/data veemp
#
# The optional MarkItDown Python stage (PDF/DOCX/… ingestion) is off by default
# to keep the image small; build with --build-arg WITH_MARKITDOWN=1 to include it.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-slim AS runtime
ARG WITH_MARKITDOWN=0
WORKDIR /app
ENV NODE_ENV=production PORT=3001

# Optional: MarkItDown for binary document ingestion.
RUN if [ "$WITH_MARKITDOWN" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip && \
      rm -rf /var/lib/apt/lists/*; \
    fi

COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/client/dist ./client/dist
RUN if [ "$WITH_MARKITDOWN" = "1" ]; then node scripts/setup-markitdown.mjs || true; fi

# Persist the SQLite database across container restarts.
VOLUME ["/app/server/data"]
EXPOSE 3001
CMD ["node", "server/src/index.js"]
