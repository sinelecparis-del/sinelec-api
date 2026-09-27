FROM node:20-slim

# Installer Python3 + pip + reportlab + Pillow (compression des photos des
# rapports d'intervention avant intégration au PDF — voir server.js)
RUN apt-get update && apt-get install -y python3 python3-pip python3-reportlab python3-pil && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
