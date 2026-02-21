/**
 * Discord Client Setup & Event Binding
 * 
 * This module is responsible for initializing the Discord client,
 * registering slash commands, and routing events to handlers.
 * All Discord-specific logic is contained within src/discord/.
 */

import { Client, GatewayIntentBits, Partials, Events, EmbedBuilder, type Message, type Interaction } from 'discord.js';
import { Buffer } from 'node:buffer';
import { COMMANDS, handleAuth, handleModel, handleClear, handleTelemetry, handleModelSelect, isWaitingForAuthCallback, resolveAuthCallback } from './commands';
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
                case 'telemetry':
                    await handleTelemetry(interaction);
                    break;
                case 'clear':
                    await handleClear(interaction);
                    break;
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_model') {
                await handleModelSelect(interaction);
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
        if (!isDM && !message.mentions.has(client.user!)) {
            return;
        }

        const prompt = message.content
            .replace(`<@${client.user!.id}>`, '')
            .replace(`<@!${client.user!.id}>`, '')
            .trim();

        // Check if there are any attachments (images or files)
        const hasAttachments = message.attachments.size > 0;

        // Ignore empty messages with no attachments
        if (!prompt && !hasAttachments) return;

        if (!isReady()) {
            await message.reply('Not authenticated. Use /auth first.');
            return;
        }

        // Detect and process image attachments
        const imageAttachments = message.attachments.filter((a: any) =>
            ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(a.contentType || '')
        );

        const images: { data: string; mimeType: string }[] = [];
        for (const attachment of imageAttachments.values()) {
            try {
                const response = await fetch(attachment.url);
                const buffer = await response.arrayBuffer();
                const base64 = Buffer.from(buffer).toString('base64');
                images.push({ data: base64, mimeType: attachment.contentType! });
            } catch (e) {
                console.error(`[Discord] Failed to download image attachment ${attachment.name}:`, e);
            }
        }

        // Detect and process text attachments (txt, json, md, code files)
        const textAttachments = message.attachments.filter((a: any) => {
            const ct = a.contentType || '';
            const fn = a.name.toLowerCase();
            return ct.startsWith('text/') ||
                ct === 'application/json' ||
                ['.json', '.md', '.ts', '.js', '.py', '.txt'].some(ext => fn.endsWith(ext));
        });

        let extraPrompt = '';
        for (const attachment of textAttachments.values()) {
            try {
                const response = await fetch(attachment.url);
                const text = await response.text();
                extraPrompt += `\n\n[File Attached: ${attachment.name}]\n${text}`;
            } catch (e) {
                console.error(`[Discord] Failed to read text attachment ${attachment.name}:`, e);
            }
        }

        const promptWithFiles = prompt + extraPrompt;

        // Use channel ID for servers, user ID for DMs as session key
        const sessionId = isDM ? `dm-${message.author.id}` : message.channelId;

        try {
            await message.channel.sendTyping();

            let replyMsg: any = null;
            let lastEditTime = 0;
            let pendingText = '';
            let timeout: any = null;

            const updateDiscord = async (blocks: chatModule.ChatResponseBlock[], isFinal: boolean = false) => {
                const embeds: EmbedBuilder[] = [];

                if (blocks.length === 0 && !isFinal) {
                    // Initial "Thinking..." state
                    const embed = new EmbedBuilder()
                        .setColor(0xF4B8E4)
                        .setDescription('Thinking...');
                    embeds.push(embed);
                }

                for (let i = 0; i < blocks.length; i++) {
                    const block = blocks[i];
                    let desc = block.content;
                    let color = 0xF4B8E4; // Default Kita Pink
                    let title = undefined;

                    if (block.type === 'thinking') {
                        color = 0x808080; // Gray
                        desc = `> **Thinking:**\n\`\`\`text\n${desc}\n\`\`\``;
                    } else if (block.type === 'execution') {
                        color = 0xFAA61A; // Orange
                        const argsStr = desc ? `\n\`\`\`json\n${desc}\n\`\`\`` : '';
                        desc = `> **Running Command:** \`${block.name}\`${argsStr}`;
                    }

                    // Discord embed description limit is 4096
                    if (desc.length > 4090) {
                        desc = desc.substring(0, 4087) + '...';
                    }

                    const embed = new EmbedBuilder()
                        .setColor(color)
                        .setDescription(desc || '(Empty)');

                    embeds.push(embed);

                    // Discord limit: 10 embeds per message
                    if (embeds.length >= 10) break;
                }

                if (embeds.length > 0) {
                    // Status info on the first embed
                    if (!isFinal) {
                        embeds[0].setAuthor({
                            name: 'Kita is processing...',
                            iconURL: client.user?.displayAvatarURL() || undefined
                        });
                    } else {
                        embeds[0].setAuthor({
                            name: 'Kita finished responding',
                            iconURL: client.user?.displayAvatarURL() || undefined
                        });
                    }

                    // Model/Settings info on the last embed
                    const thinkingStatus = chatModule.getThinkingVisibility() ? 'ON' : 'OFF';
                    const executionStatus = chatModule.getExecutionVisibility() ? 'ON' : 'OFF';
                    embeds[embeds.length - 1].setFooter({
                        text: `Model: ${currentModel()} | Thinking: ${thinkingStatus} | Execution: ${executionStatus}`
                    });
                }

                try {
                    if (!replyMsg) {
                        replyMsg = await message.reply({ content: '', embeds: embeds });
                    } else {
                        await replyMsg.edit({ content: '', embeds: embeds });
                    }
                } catch (e: any) {
                    console.error('[Discord] Update failed:', e.message);
                } finally {
                    lastEditTime = Date.now();
                }
            };

            const onUpdate = (blocks: chatModule.ChatResponseBlock[]) => {
                pendingText = blocks as any; // Re-use pendingText variable for simplicity, mapped to blocks
                const now = Date.now();
                // Throttle updates to ~1.5 seconds to avoid Discord rate limits
                if (now - lastEditTime > 1500 && replyMsg) {
                    if (timeout) clearTimeout(timeout);
                    lastEditTime = now;
                    updateDiscord(blocks, false);
                } else if (!timeout) {
                    timeout = setTimeout(() => {
                        updateDiscord(pendingText as any, false);
                        timeout = null;
                    }, 1500);
                }
            };

            // Initial immediate feedback
            await updateDiscord([], false);

            const { blocks: finalBlocks } = await chat(sessionId, promptWithFiles, images, onUpdate);
            if (timeout) clearTimeout(timeout);

            // Trigger the final update with the 100% complete blocks from the result
            await updateDiscord(finalBlocks, true);
        } catch (err: any) {
            console.error('[AI] Error:', err);
            await message.reply(`${err.message || 'Something went wrong.'}`);
        }
    });

    // Login
    client.login(token);

    return client;
}
