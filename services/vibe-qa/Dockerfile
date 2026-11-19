# Vibe Lab quality runner. The Playwright base image already ships Chromium and its system libraries;
# the npm packages mirror the libraries Sandpack offers generated projects (heavy 3D/ML ones excluded:
# their runtime check is reported as skipped rather than slowing every run).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8100 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

EXPOSE 8100
CMD ["node", "src/server.js"]
