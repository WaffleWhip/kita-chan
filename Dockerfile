FROM oven/bun:1 as base

WORKDIR /app

COPY package.json ./

# Install OpenSSH Client (for OpenWrt SSH commands inside container)
run apt-get update && apt-get install -y openssh-client sshpass && rm -rf /var/lib/apt/lists/*
RUN bun install --production

COPY src ./src
COPY kita ./kita
COPY index.ts ./
COPY .env ./

CMD ["bun", "run", "start"]
