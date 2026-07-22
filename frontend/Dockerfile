FROM node:22.12.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --package-lock-only --ignore-scripts && npm ci; fi
COPY index.html vite.config.js /app/
COPY src /app/src
COPY public /app/public
RUN npm test && npm run build

FROM nginx:1.27.3-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
