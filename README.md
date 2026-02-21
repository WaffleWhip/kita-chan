# Kita-chan Discord Bot ✨

A high-performance personal assistant Discord bot themed after **Ikuyo Kita** (Bocchi the Rock!). Built using **Bun**, **TypeScript**, and the **pi-mono** toolkit (`@mariozechner/pi-ai`).

Kita-chan is designed as an agentic assistant that doesn't just talk, but acts—managing systems, remembering facts, and handling multiple AI providers with a premium, minimalist interface.

## 🚀 Key Features

- **Multi-Provider AI**: Native support for **Google Gemini** and **GitHub Copilot** (via OAuth Device Flow).
- **Dynamic Model Switching**: Switch providers and models on-the-fly via `/model` command with real-time UI updates.
- **Premium Discord UI**: Minimalist, high-quality pink embeds. No technical clutter—JSON outputs and "thinking" states are hidden, showing only clean answers and tool usage lists.
- **Long-Term Memory**: Persistent memory storage in `MEMORY.md`. Kita-chan proactively remembers names, preferences, and facts across restarts.
- **On-Demand Skill System**: Plugin-based architecture. Full skill instructions are loaded only when needed, keeping the system prompt lean and token-efficient.
- **Multimodal Support**: Send images directly to Kita-chan for analysis (supports Gemini Vision models).
- **Dockerized**: Ready for production with a robust Docker setup including SSH client support for system management.

## 🛠️ Commands

- `/auth`: Interactive multi-provider authentication. Select a provider (Gemini/Copilot) and follow the OAuth flow directly in Discord.
- `/model`: Two-step selection for AI Provider and specific Model. Changes are applied instantly to the active session.
- `/clear`: Wipes the current session history and resets the `MEMORY.md` long-term storage.

## 📦 Setup & Installation

### Prerequisites
- [Bun](https://bun.sh/) runtime installed.
- A Discord Bot Token (from [Discord Developer Portal](https://discord.com/developers/applications)).
- Docker (optional, for containerized deployment).

### 1. Installation
```bash
bun install
```

### 2. Configuration (`.env`)
Create a `.env` file in the root directory:
```env
DISCORD_TOKEN=your_discord_token_here

# Optional UI Customization
BOT_COLOR=0xF4B8E4
SESSION_ID=global

# Performance Tuning
UPDATE_INTERVAL_MS=1500
TYPING_INTERVAL_MS=8000
TOOL_TIMEOUT_MS=120000
```

### 3. Running the Bot
```bash
# Development
bun run start

# Production (Docker)
docker build -t kita-chan .
docker run -d --name kita-chan \
  -v $(pwd)/auth.json:/app/auth.json \
  -v $(pwd)/kita:/app/kita \
  kita-chan
```

## 🧠 The `kita/` Directory

The `kita/` folder is the "brain" of the bot:
- **`PERSONA.md`**: Defines Kita-chan's personality and baseline behavior.
- **`RULES.md`**: Global operational constraints and safety guidelines.
- **`MEMORY.md`**: Auto-generated long-term facts stored as bullet points.
- **`skills/`**: Subdirectories containing `SKILL.md` files. These define specialized capabilities (like managing OpenWrt routers) that the AI loads on-demand.

## 📝 License
Personal project. Built on top of the [pi-mono](https://github.com/mariozechner/pi-mono) ecosystem.
