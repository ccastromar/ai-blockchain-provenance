FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm ci --only=production

# Copiar código fuente
COPY . .

# Build TypeScript
RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start:prod"]
