FROM node:20-slim

# Install LibreOffice (headless) for DOCX → PDF conversion.
# The full libreoffice-writer package is ~300MB but includes all the
# filters needed for high-fidelity document conversion.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first (layer is cached until package*.json change).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy everything else.
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
