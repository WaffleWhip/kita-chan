/**
 * Entry Point
 * 
 * Minimal bootstrap: loads environment, starts the Discord bot.
 * To add other services (Telegram, Web API, etc.), import and start them here.
 */

import 'dotenv/config';
import { createDiscordBot } from './src/discord';

const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('[Error] Missing DISCORD_TOKEN in .env');
    process.exit(1);
}

// Start Discord bot
createDiscordBot(token);

// Future integrations:
// import { createTelegramBot } from './src/telegram';
// createTelegramBot(process.env.TELEGRAM_TOKEN);
