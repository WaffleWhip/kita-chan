# Kita-chan Discord Bot

A personal assistant Discord bot based on the character Ikuyo Kita from Kessoku Band. This is a personal project created for fun and experimentation with agentic AI.

## Overview

This project implements a Discord bot using Bun, TypeScript, and the `@mariozechner/pi-ai` library. It focuses on maintaining a specific character persona while providing useful tools and AI interactions.

## Features

- **Character Persona**: Implementation of the Kita-chan persona through system prompts.
- **Model Management**: Interactive selection of AI models using Discord components.
- **Telemetry Control**: Toggle visibility for reasoning and tool execution steps.
- **Skill System**: Plugin-based architecture for adding new functionalities.
- **Attachment Support**: Ability to process images and various text file types.

## Prerequisites

- Bun runtime
- Discord Bot Token
- Gemini API access (OAuth or API Key)

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```
2. Configure environment variables in a `.env` file:
   ```env
   DISCORD_TOKEN=your_token
   CLIENT_ID=your_client_id
   ```
3. Ensure authentication credentials (e.g., `auth.json`) are present in the project root.

## Usage

Run the bot:
```bash
bun start
```

### Commands

- `/auth`: Handles Gemini authentication.
- `/model`: Opens the model selection interface.
- `/telemetry`: Configures display settings for thinking and execution blocks.
- `/clear`: Resets channel conversation history.

## Skill Development

To add a new skill, create a directory in `kita/skills/` with a `SKILL.md` file following the provided template. The system dynamically discovers and integrates these instructions into the AI context.
