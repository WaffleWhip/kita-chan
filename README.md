# 🎸 Kita-chan: The Sparkly Discord AI Assistant ✨

Welcome to the **Kita-chan** template! This is a high-energy, cheerful Discord AI bot inspired by Ikuyo Kita from *Bocchi the Rock!*. It's built with modern tech like Bun, TypeScript, and the `@mariozechner/pi-ai` library for advanced agentic capabilities.

## ✨ Features

- **Kita-chan Persona**: A bubbly, expressive, and social-media-savvy personality. She uses emojis liberally and has her signature catchphrase: "Kita-n! ✨".
- **Dynamic Model Selection**: Use `/model` to switch between AI models via a sleek Discord Select Menu.
- **Unified Telemetry**: Control "Thinking" (reasoning) and "Execution" (tool calls) visibility with the `/telemetry` command.
- **Agent Skills System**: Easily extendable functionality through a folder-based skill system.
- **Multimodal Support**: She can see images and read text-based file attachments (txt, md, json, code).
- **Final Answer Guard**: Ensures the bot always provides a friendly concluding message, even after complex tool loops.

## 🚀 Quick Start

### 1. Prerequisites
- [Bun](https://bun.sh/) installed on your system.
- A Discord Bot Token (from [Discord Developer Portal](https://discord.com/developers/applications)).
- Gemini API access (via OAuth or API Key).

### 2. Setup
1. Clone this repo.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Create a `.env` file in the root:
   ```env
   DISCORD_TOKEN=your_token_here
   CLIENT_ID=your_bot_client_id_here
   ```
4. Place your `auth.json` (Gemini CLI tokens) in the root or run the authentication command if implemented.

### 3. Run
```bash
bun start
```

## 🛠️ How to Add Skills

Adding a skill is as easy as creating a folder!

1. Go to `kita/skills/`.
2. Create a new folder (e.g., `calculate-tax`).
3. Inside that folder, create a `SKILL.md`.
4. Define your skill instructions in `SKILL.md` using the template found in `kita/skills/_template/SKILL.md`.
5. Kita-chan will automatically discover the skill and use it when relevant!

## 🎮 Slash Commands

- `/auth`: Start the Gemini authentication process.
- `/model`: Open the model selection menu.
- `/telemetry [thinking] [execution]`: Toggle visibility of AI reasoning and tool steps.
- `/clear`: Clear the conversation memory for the current channel.

## 🎸 Contributing

Feel free to fork this template and add your own "Kita-Aura"! If you find any bugs or have feature requests, please open an issue.

---
*Kita-chan is living in your screen to help you solve anything! Kita-n! ✨🎸📸*
