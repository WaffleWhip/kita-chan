FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json ./

# Full shell environment for the AI agent
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client sshpass \
    iputils-ping traceroute dnsutils \
    curl wget nmap netcat-openbsd telnet \
    net-tools iproute2 \
    jq tree file procps htop \
    python3 \
    && rm -rf /var/lib/apt/lists/*

RUN bun install --production

COPY src ./src
COPY kita ./kita
COPY index.ts ./
COPY .env ./

CMD ["bun", "run", "start"]
