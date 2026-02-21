/**
 * Discord Client Setup & Event Binding
 * 
 * This module is responsible for initializing the Discord client,
 * registering slash commands, and routing events to handlers.
 * All Discord-specific logic is contained within src/discord/.
 */

import { Client, GatewayIntentBits, Partials, Events, EmbedBuilder, type Message, type Interaction } from 'discord.js';
import { Buffer } from 'node:buffer';
import { COMMANDS, handleAuth, handleAuthProviderSelect, handleModel, handleModelProviderSelect, handleModelSelect, handleClear, isWaitingForAuthCallback, resolveAuthCallback } from './commands';
import * as chatModule from '../chat';
const { chat, isReady, currentModel } = chatModule;

export function createDiscordBot(token: string): Client {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
        partials: [Partials.Channel]
    });

    // On ready: register commands
    client.once(Events.ClientReady, async (readyClient) => {
        console.log(`[Discord] Logged in as ${readyClient.user.tag}`);

        try {
            await readyClient.application.commands.set(COMMANDS);
            console.log(`[Discord] ${COMMANDS.length} slash commands registered.`);
        } catch (e) {
            console.error('[Discord] Failed to register commands:', e);
        }

        console.log(`[AI] Authenticated: ${isReady() ? 'Yes' : 'No (use /auth)'}`);
    });

    // Slash command & Component routing
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'auth':
                    await handleAuth(interaction);
                    break;
                case 'model':
                    await handleModel(interaction);
                    break;
                case 'clear':
                    await handleClear(interaction);
                    break;
            }
        } else if (interaction.isStringSelectMenu()) {
            switch (interaction.customId) {
                case 'auth_provider':
                    await handleAuthProviderSelect(interaction);
                    break;
                case 'model_provider':
                    await handleModelProviderSelect(interaction);
                    break;
                case 'model_select':
                    await handleModelSelect(interaction);
                    break;
            }
        }
    });

    // Message handling (DM chat + OAuth callback capture)
    client.on(Events.MessageCreate, async (message: Message) => {
        if (message.author.bot) return;

        // Capture OAuth callback URL if we're waiting for one
        if (isWaitingForAuthCallback() && message.content.includes('http://localhost:8085/oauth2callback')) {
            resolveAuthCallback(message.content.trim());
            await message.reply('Callback URL received. Processing...');
            return;
        }

        // In DMs: respond to any message directly
        // In servers: require @mention
        const isDM = !message.guild;
        const isMentioned = message.mentions.has(message.client.user!);

        if (!isDM && !isMentioned) return;

        if (!isReady()) {
            await message.reply('I\'m not authenticated yet. Please use `/auth` first! 🔐');
            return;
        }

        // Clean message
        let prompt = message.content
            .replace(/<@!?\d+>/g, '')
            .trim();

        if (!prompt && (!message.attachments || message.attachments.size === 0)) return;

        // Extract images
        const images: { data: string; mimeType: string }[] = [];
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                const mimeType = attachment.contentType;
                if (mimeType && mimeType.startsWith('image/')) {
                    try {
                        const response = await fetch(attachment.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const base64 = Buffer.from(arrayBuffer).toString('base64');
                        images.push({ data: base64, mimeType });
                    } catch (err) {
                        console.error('[Discord] Failed to fetch image:', err);
                    }
                }
            }
        }

        // Send typing indicator
        await message.channel.sendTyping();
        const typingIntervalMs = parseInt(process.env.TYPING_INTERVAL_MS || '8000');
        const typingInterval = setInterval(() => message.channel.sendTyping(), typingIntervalMs);

        // Track the reply for edits
        let replyMessage: Message | null = null;
        let initialReplySent = false;

        // Throttle function for Discord edits
        let lastUpdate = 0;
        const UPDATE_INTERVAL = parseInt(process.env.UPDATE_INTERVAL_MS || '1500');

        function buildEmbed(blocks: chatModule.ChatResponseBlock[], context?: chatModule.ChatContext): { content: string; embeds: any[] } | null {
            let textContent = '';
            const usedTools = new Set<string>();
            let inMarkdownJson = false;

            for (const block of blocks) {
                if (block.type === 'text') {
                    const lines = block.content.split('\n');
                    let cleanBlockLines: string[] = [];

                    for (const line of lines) {
                        const trimmed = line.trim();

                        // Detect start/end of JSON blocks or tool markers to filter them out
                        if (trimmed.startsWith('```json')) {
                            inMarkdownJson = true;
                            continue;
                        }
                        if (inMarkdownJson && (trimmed.endsWith('```') || trimmed.includes('```'))) {
                            inMarkdownJson = false;
                            continue;
                        }
                        if (inMarkdownJson) continue;

                        // Filter out tool icons and raw JSON that might be narrated
                        if (trimmed.startsWith('📦') ||
                            (trimmed.startsWith('{') && trimmed.includes('"command"')) ||
                            trimmed.includes('"command":')) {
                            continue;
                        }

                        // Also strip the marker if it's inline (keep text before it)
                        const cleanLine = line.split('📦')[0].trim();
                        if (cleanLine) cleanBlockLines.push(cleanLine);
                    }

                    const blockText = cleanBlockLines.join('\n').trim();
                    if (blockText) {
                        textContent += (textContent ? '\n\n' : '') + blockText;
                    }
                } else if (block.type === 'execution' || block.type === 'result') {
                    if (block.name) usedTools.add(block.name);
                }
            }

            // Don't send anything if there's no content to show yet
            if (!textContent.trim() && usedTools.size === 0) return null;

            const botColor = parseInt(process.env.BOT_COLOR || '0xF4B8E4');
            const embed = new EmbedBuilder()
                .setColor(botColor);

            let description = textContent.trim() || '*Awaiting response...*';

            if (usedTools.size > 0) {
                description += `\n\nTools: ${Array.from(usedTools).join(', ')}`;
            }

            embed.setDescription(description.slice(0, 4096));

            if (context) {
                const usedK = (context.usedTokens / 1000).toFixed(1);
                const windowK = (context.contextWindow / 1000).toFixed(1);
                const pct = ((context.usedTokens / context.contextWindow) * 100).toFixed(1);
                embed.setFooter({ text: `${currentModel()} | Context: ${usedK}K / ${windowK}K (${pct}%)` });
            }

            return { content: '', embeds: [embed] };
        }

        async function updateDiscord(blocks: chatModule.ChatResponseBlock[]) {
            const now = Date.now();
            if (now - lastUpdate < UPDATE_INTERVAL) return;
            lastUpdate = now;

            const result = buildEmbed(blocks);
            if (!result) return; // Skip if empty

            try {
                if (!initialReplySent) {
                    initialReplySent = true;
                    replyMessage = await message.reply(result);
                } else if (replyMessage) {
                    await replyMessage.edit(result);
                }
            } catch (err) {
                console.error('[Discord] Update failed:', err);
            }
        }

        try {
            const sessionId = process.env.SESSION_ID || 'global';

            const result = await chat(sessionId, prompt, images.length > 0 ? images : undefined, updateDiscord);

            clearInterval(typingInterval);

            // Final update
            const finalResult = buildEmbed(result.blocks, result.context);

            if (finalResult) {
                if (!initialReplySent) {
                    await message.reply(finalResult);
                } else if (replyMessage) {
                    await replyMessage.edit(finalResult);
                }
            }
        } catch (err: any) {
            clearInterval(typingInterval);
            console.error('[Chat] Error:', err);
            const errorMsg = err.message?.slice(0, 200) || 'Unknown error';
            if (!initialReplySent) {
                await message.reply(`Error: ${errorMsg}`);
            } else if (replyMessage) {
                await replyMessage.edit(`Error: ${errorMsg}`);
            }
        }
    });

    client.login(token);

    return client;
}
