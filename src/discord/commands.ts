/**
 * Discord Slash Command Definitions & Handlers
 * 
 * All Discord-specific command logic lives here.
 * This module imports the platform-agnostic chat service.
 */

import { MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, type ChatInputCommandInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { chat, listModelsForProvider, currentModel, switchModel, isReady, clearSession, getSessionLength, clearLongTermMemory } from '../chat';
import { authenticateProvider, getAvailableProviders, setActiveProvider, getActiveProvider, getActiveProviderName, isProviderAuthenticated, type ProviderKey } from '../auth';

// Slash command definitions for Discord API registration
export const COMMANDS = [
    {
        name: 'auth',
        description: 'Authenticate with an AI provider'
    },
    {
        name: 'model',
        description: 'Switch AI provider and model'
    },
    {
        name: 'clear',
        description: 'Clear Kita-chan\'s session history and MEMORY.md'
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

// /auth handler — shows provider dropdown
export async function handleAuth(interaction: ChatInputCommandInteraction) {
    const providers = getAvailableProviders();

    const select = new StringSelectMenuBuilder()
        .setCustomId('auth_provider')
        .setPlaceholder('Choose a provider to authenticate...')
        .addOptions(
            providers.map(p => ({
                label: p.name,
                description: p.authenticated ? '✅ Already authenticated' : '🔑 Click to login',
                value: p.id,
                emoji: p.authenticated ? '✅' : '🔐'
            }))
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const statusLines = providers.map(p =>
        `${p.authenticated ? '✅' : '❌'} **${p.name}** — ${p.authenticated ? 'Authenticated' : 'Not connected'}`
    ).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0xF4B8E4)
        .setTitle('🔐 Authentication')
        .setDescription(`Select a provider to authenticate:\n\n${statusLines}`)
        .setFooter({ text: 'Choose a provider from the dropdown to start login' });

    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

// Handle auth provider selection
export async function handleAuthProviderSelect(interaction: StringSelectMenuInteraction) {
    const providerId = interaction.values[0] as ProviderKey;
    const providers = getAvailableProviders();
    const provider = providers.find(p => p.id === providerId);

    await interaction.update({
        content: `Starting **${provider?.name || providerId}** authentication...`,
        embeds: [],
        components: []
    });

    const manualCodePromise = new Promise<string>((resolve) => {
        manualAuthResolver = resolve;
    });

    try {
        await authenticateProvider(
            providerId,
            (url, instructions) => {
                interaction.followUp({
                    content: `**Action Required**: Open this URL in your browser:\n${url}\n\n` +
                        (instructions ? `${instructions}\n\n` : '') +
                        `*After login, if the page shows an error, copy the URL from your browser's address bar and paste it here!*`,
                });
            },
            () => manualCodePromise
        );

        await interaction.followUp({ content: `✅ **${provider?.name || providerId}** authenticated successfully!` });
    } catch (err) {
        console.error('[Auth] Failed:', err);
        manualAuthResolver = null;
        await interaction.followUp({ content: `❌ **${provider?.name || providerId}** authentication failed.` });
    }
}

// /model handler — shows provider dropdown first, then model dropdown
export async function handleModel(interaction: ChatInputCommandInteraction) {
    const providers = getAvailableProviders().filter(p => p.authenticated);

    if (providers.length === 0) {
        await interaction.reply({
            content: 'No providers authenticated. Use `/auth` first.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const activeProvider = getActiveProvider();
    const activeModel = currentModel();

    const providerSelect = new StringSelectMenuBuilder()
        .setCustomId('model_provider')
        .setPlaceholder('Select Provider')
        .addOptions(
            providers.map(p => ({
                label: p.name,
                value: p.id,
                description: p.id === activeProvider ? `Active • Model: ${activeModel}` : 'Switch to this provider',
                default: p.id === activeProvider,
                emoji: p.id === activeProvider ? '🟢' : '⚪'
            }))
        );

    const providerRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(providerSelect);

    // Show models of the active provider
    const models = listModelsForProvider(activeProvider);
    const modelSelect = new StringSelectMenuBuilder()
        .setCustomId('model_select')
        .setPlaceholder('Select Model')
        .addOptions(
            models.slice(0, 25).map(m => ({
                label: m.name || m.id,
                value: m.id,
                description: m.reasoning ? '🧠 Reasoning' : '💬 Standard',
                default: m.id === activeModel
            }))
        );

    const modelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelSelect);

    const embed = new EmbedBuilder()
        .setColor(0xF4B8E4)
        .setTitle('⚙️ Model Selection')
        .setDescription(
            `**Provider**: \`${getActiveProviderName()}\`\n` +
            `**Model**: \`${activeModel}\`\n\n` +
            `Select a provider first, then pick a model.`
        )
        .setFooter({ text: `${models.length} models available • ${providers.length} provider(s) authenticated` });

    await interaction.reply({
        embeds: [embed],
        components: [providerRow, modelRow],
        flags: MessageFlags.Ephemeral
    });
}

// Handle provider selection in /model — updates model dropdown
export async function handleModelProviderSelect(interaction: StringSelectMenuInteraction) {
    const selectedProvider = interaction.values[0] as ProviderKey;
    setActiveProvider(selectedProvider);

    const providers = getAvailableProviders().filter(p => p.authenticated);
    const models = listModelsForProvider(selectedProvider);
    const providerName = providers.find(p => p.id === selectedProvider)?.name || selectedProvider;

    // Default to first model of new provider
    if (models.length > 0) {
        switchModel(models[0].id);
    }

    const providerSelect = new StringSelectMenuBuilder()
        .setCustomId('model_provider')
        .setPlaceholder('Select Provider')
        .addOptions(
            providers.map(p => ({
                label: p.name,
                value: p.id,
                description: p.id === selectedProvider ? `Active • ${models.length} models` : 'Switch to this provider',
                default: p.id === selectedProvider,
                emoji: p.id === selectedProvider ? '🟢' : '⚪'
            }))
        );

    const providerRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(providerSelect);

    const modelSelect = new StringSelectMenuBuilder()
        .setCustomId('model_select')
        .setPlaceholder('Select Model')
        .addOptions(
            models.slice(0, 25).map((m, i) => ({
                label: m.name || m.id,
                value: m.id,
                description: m.reasoning ? '🧠 Reasoning' : '💬 Standard',
                default: i === 0
            }))
        );

    const modelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelSelect);

    const embed = new EmbedBuilder()
        .setColor(0xF4B8E4)
        .setTitle('⚙️ Model Selection')
        .setDescription(
            `**Provider**: \`${providerName}\`\n` +
            `**Model**: \`${models[0]?.id || 'none'}\`\n\n` +
            `Switched to **${providerName}**. Now pick a model below.`
        )
        .setFooter({ text: `${models.length} models available` });

    await interaction.update({ embeds: [embed], components: [providerRow, modelRow] });
}

// Handle model selection
export async function handleModelSelect(interaction: StringSelectMenuInteraction) {
    const selectedModel = interaction.values[0];
    switchModel(selectedModel);

    const providerName = getActiveProviderName();

    await interaction.update({
        content: `✅ Switched to **${providerName}** → \`${selectedModel}\``,
        embeds: [],
        components: []
    });
}

// /clear handler
export async function handleClear(interaction: ChatInputCommandInteraction) {
    clearSession('global');
    clearLongTermMemory();
    await interaction.reply(`All memories cleared! 🌸 Session reset and \`MEMORY.md\` wiped.`);
}
