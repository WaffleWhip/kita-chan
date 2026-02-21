/**
 * Discord Slash Command Definitions & Handlers
 * 
 * All Discord-specific command logic lives here.
 * This module imports the platform-agnostic chat service.
 */

import { ApplicationCommandOptionType, MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, type ChatInputCommandInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { chat, listModels, currentModel, switchModel, isReady, clearSession, getSessionLength, setThinkingVisibility, setExecutionVisibility, getThinkingVisibility, getExecutionVisibility } from '../chat';
import { authenticate } from '../auth';

// Slash command definitions for Discord API registration
export const COMMANDS = [
    {
        name: 'auth',
        description: 'Start the Gemini CLI authentication process'
    },
    {
        name: 'model',
        description: 'Change the active AI model via a dropdown menu'
    },
    {
        name: 'telemetry',
        description: 'Toggle AI reasoning (Thinking) and Tool Execution visibility',
        options: [
            {
                name: 'thinking',
                type: ApplicationCommandOptionType.Boolean,
                description: 'Show or hide AI reasoning steps',
                required: false
            },
            {
                name: 'execution',
                type: ApplicationCommandOptionType.Boolean,
                description: 'Show or hide tool execution details',
                required: false
            }
        ]
    },
    {
        name: 'clear',
        description: 'Clear conversation memory for this channel'
    }
];

// State for manual OAuth callback capture
let manualAuthResolver: ((url: string) => void) | null = null;

export function isWaitingForAuthCallback(): boolean {
    return manualAuthResolver !== null;
}

export function resolveAuthCallback(url: string): void {
    if (manualAuthResolver) {
        manualAuthResolver(url);
        manualAuthResolver = null;
    }
}

// /telemetry handler
export async function handleTelemetry(interaction: ChatInputCommandInteraction) {
    const thinking = interaction.options.getBoolean('thinking', false);
    const execution = interaction.options.getBoolean('execution', false);

    // Check if at least one option was provided
    const thinkingProvided = interaction.options.get('thinking') !== null;
    const executionProvided = interaction.options.get('execution') !== null;

    if (!thinkingProvided && !executionProvided) {
        // Just show current status
        const tStatus = getThinkingVisibility() ? 'Visible' : 'Hidden';
        const eStatus = getExecutionVisibility() ? 'Shown' : 'Hidden';
        await interaction.reply({
            content: `**Current Telemetry Settings**:\n- Thinking: \`${tStatus}\`\n- Execution Detail: \`${eStatus}\` \n\n*Use options (\`thinking:\`, \`execution:\`) to change these.*`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    let msg = 'Telemetry updated:\n';
    if (thinkingProvided) {
        setThinkingVisibility(thinking!);
        msg += `- Thinking: **${thinking ? 'Visible' : 'Hidden'}**\n`;
    }
    if (executionProvided) {
        setExecutionVisibility(execution!);
        msg += `- Execution Detail: **${execution ? 'Shown' : 'Hidden'}**\n`;
    }

    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
}

// /auth handler
export async function handleAuth(interaction: ChatInputCommandInteraction) {
    await interaction.reply('Starting Gemini CLI authentication process...');

    const manualCodePromise = new Promise<string>((resolve) => {
        manualAuthResolver = resolve;
    });

    try {
        await authenticate(
            (url, _instructions) => {
                interaction.channel?.send(
                    `**Action Required**: Open this URL in your browser to login:\n${url}\n\n` +
                    `*After login, if the page shows an error, copy the URL from your browser's address bar (\`http://localhost:8085...\`) and paste it here!*`
                );
            },
            () => manualCodePromise
        );

        await interaction.channel?.send('Authentication successful!');
    } catch (err) {
        console.error('[Auth] Failed:', err);
        manualAuthResolver = null;
        await interaction.channel?.send('Authentication failed or was interrupted.');
    }
}

// /model handler
export async function handleModel(interaction: ChatInputCommandInteraction) {
    if (!isReady()) {
        await interaction.reply({ content: 'Not authenticated. Use `/auth` first.', flags: MessageFlags.Ephemeral });
        return;
    }

    try {
        const models = listModels();
        const active = currentModel();

        // Build the Select Menu
        const select = new StringSelectMenuBuilder()
            .setCustomId('select_model')
            .setPlaceholder('Choose a model to use...')
            .addOptions(
                models.slice(0, 25).map(m => ({
                    label: m.name || m.id,
                    description: m.reasoning ? 'Supports reasoning/thinking' : 'Standard text model',
                    value: m.id,
                    default: m.id === active
                }))
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(select);

        const embed = new EmbedBuilder()
            .setColor(0xF4B8E4)
            .setTitle('Select AI Model')
            .setDescription(`**Active Model**: \`${active}\`\n\nChoose a model from the list below to switch.`)
            .setFooter({ text: `Showing ${Math.min(models.length, 25)} of ${models.length} available models` });

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    } catch (err: any) {
        console.error('[Model] Error:', err);
        await interaction.reply({ content: 'Failed to list models.', flags: MessageFlags.Ephemeral });
    }
}

/**
 * Handle select menu interactions for model switching.
 */
export async function handleModelSelect(interaction: StringSelectMenuInteraction) {
    const selectedModel = interaction.values[0];
    switchModel(selectedModel);

    await interaction.update({
        content: `Model successfully switched to: **${selectedModel}**`,
        embeds: [],
        components: []
    });
}

// /clear handler
export async function handleClear(interaction: ChatInputCommandInteraction) {
    const sessionId = interaction.channelId;
    const msgCount = getSessionLength(sessionId);
    clearSession(sessionId);
    await interaction.reply(`Conversation cleared! (${msgCount} messages removed)`);
}
