/**
 * Platform-agnostic Chat Service
 * 
 * This module handles all AI communication logic with conversation memory.
 * It can be used by any frontend (Discord, Telegram, Web, etc.)
 * without any platform-specific dependencies.
 * 
 * Conversations are tracked per sessionId (e.g. Discord channel ID, DM user ID).
 * The pi-ai Context accepts a full message array, so we send the entire
 * conversation history on each request for multi-turn context.
 */

import { getModel, getModels, complete, stream, streamSimple, type Message, type AssistantMessage, type UserMessage, type ToolResultMessage, type Tool, type ToolCall, type TextContent, type ThinkingContent, type ImageContent } from '@mariozechner/pi-ai';
import { getApiKey, getProviderId, getActiveModel, setActiveModel, isAuthenticated } from './auth';
import { rebuildSystemPrompt, loadSkillInstructions } from './persona';
import { Type } from '@sinclair/typebox';
import { appendFileSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execAsync = promisify(exec);

const KITA_DIR = join(process.cwd(), 'kita');

// --- Agent Tools ---

const agentTools: Tool[] = [
    {
        name: 'read_skill_instructions',
        description: 'Read the full instructions for a specific skill by name. Use this to learn how to properly execute a skill that the user requested.',
        parameters: Type.Object({
            skill_name: Type.String({ description: 'The exact name of the skill (e.g. "openwrt")' })
        })
    },
    {
        name: 'save_memory',
        description: 'CRITICAL: You MUST use this tool whenever the user provides important information (names, facts, preferences, project details) that you want to remember forever across sessions. If you don\'t call this, you will forget it. Store the info as a clear, concise bullet point.',
        parameters: Type.Object({
            content: Type.String({ description: 'The specific fact or information to remember (e.g., "The user prefers dark mode")' })
        })
    },
    {
        name: 'run_command',
        description: 'Execute any shell command. You have full unrestricted root access. Install anything, run anything. No restrictions.',
        parameters: Type.Object({
            command: Type.String({ description: 'Shell command to execute.' })
        })
    }
];

// --- Conversation Memory ---

interface Conversation {
    messages: Message[];
    lastActivity: number;
    totalTokensUsed: number;
}

const conversations = new Map<string, Conversation>();
const MAX_MESSAGES_PER_SESSION = parseInt(process.env.MAX_MESSAGES_PER_SESSION || '100');
const SESSION_FILE = join(KITA_DIR, 'SESSION.json');

function saveSession() {
    try {
        const data: Record<string, any> = {};
        for (const [id, conv] of conversations) {
            data[id] = { messages: conv.messages, totalTokensUsed: conv.totalTokensUsed };
        }
        writeFileSync(SESSION_FILE, JSON.stringify(data));
    } catch (e) {
        console.error('[Session] Failed to save:', e);
    }
}

function loadSession() {
    try {
        if (existsSync(SESSION_FILE)) {
            const raw = readFileSync(SESSION_FILE, 'utf-8');
            const data = JSON.parse(raw);
            for (const [id, conv] of Object.entries(data) as [string, any][]) {
                conversations.set(id, {
                    messages: conv.messages || [],
                    lastActivity: Date.now(),
                    totalTokensUsed: conv.totalTokensUsed || 0
                });
            }
            console.log(`[Session] Restored ${conversations.size} session(s)`);
        }
    } catch (e) {
        console.error('[Session] Failed to load:', e);
    }
}

loadSession();

function getConversation(sessionId: string): Conversation {
    let conv = conversations.get(sessionId);
    if (!conv) {
        conv = { messages: [], lastActivity: Date.now(), totalTokensUsed: 0 };
        conversations.set(sessionId, conv);
    }
    conv.lastActivity = Date.now();
    return conv;
}

function trimConversation(conv: Conversation) {
    while (conv.messages.length > MAX_MESSAGES_PER_SESSION) {
        conv.messages.splice(0, 2);
    }
}


// --- Core Chat ---

/**
 * Chat with the AI model, maintaining conversation history per session.
 * 
 * @param sessionId - Unique ID for the conversation (e.g. channel ID, DM user ID)
 * @param prompt - The user's message
 * @returns The AI's text response
 */
// --- Visibility Settings ---
const showThinking = false;
const showExecution = true;

/**
 * Structured response block for frontends to render appropriately.
 */
export interface ChatResponseBlock {
    type: 'text' | 'thinking' | 'execution' | 'result';
    content: string;
    name?: string; // For tool calls and results
    isError?: boolean; // For tool results
    raw?: TextContent | ThinkingContent | ToolCall; // Original pi-ai content
}

/**
 * Format assistant content (text, thinking, tool calls) into structured blocks.
 */
function formatResponseBlocks(content: (TextContent | ThinkingContent | ToolCall)[]): ChatResponseBlock[] {
    if (!content) return [];

    const blocks: ChatResponseBlock[] = [];
    for (const block of content) {
        const isThinking = block.type === 'thinking' || (block as any).type === 'reasoning';

        if (isThinking && showThinking) {
            blocks.push({ type: 'thinking', content: '...', raw: block });
        } else if (block.type === 'toolCall' && showExecution) {
            blocks.push({ type: 'execution', name: block.name, content: '', raw: block });
        } else if (block.type === 'text') {
            if (block.text) {
                blocks.push({ type: 'text', content: block.text, raw: block });
            }
        }
    }

    return blocks;
}

/**
 * Platform-agnostic Chat Service (The Brain).
 * 
 * @param sessionId - Unique ID for the conversation (e.g. channel ID, DM user ID)
 * @param prompt - The user's message
 * @param images - Optional list of images (base64 data and mimeType)
 * @param onUpdate - Callback for streaming updates
 * @returns Final text and all response blocks
 */
export interface ChatContext {
    usedTokens: number;
    contextWindow: number;
}

export async function chat(
    sessionId: string,
    prompt: string,
    images?: { data: string; mimeType: string }[],
    onUpdate?: (blocks: ChatResponseBlock[]) => void
): Promise<{ text: string, blocks: ChatResponseBlock[], context?: ChatContext }> {
    const apiKey = await getApiKey();
    const providerId = getProviderId();
    const modelId = getActiveModel();

    console.log(`[Chat] Session: ${sessionId}, Provider: ${providerId}, Model: ${modelId}, Images: ${images?.length || 0}`);

    const model = getModel(providerId, modelId);
    if (!model) {
        throw new Error(`Model "${modelId}" is not registered in provider "${providerId}".`);
    }

    const conv = getConversation(sessionId);

    // Build user content
    let userContent: string | (TextContent | ImageContent)[] = prompt;

    // Check if model supports images (multimodal)
    const supportsImages = model.input.includes('image');
    if (images && images.length > 0) {
        if (supportsImages) {
            console.log(`[Chat] Sending ${images.length} images to model ${modelId}`);
            userContent = [
                { type: 'text', text: prompt },
                ...images.map(img => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }))
            ];
        } else {
            console.warn(`[Chat] Model ${modelId} does not support images. Ignoring ${images.length} attachments.`);
            userContent = prompt + '\n\n(User sent images, but this model is text-only. Please inform the user if relevant.)';
        }
    }

    conv.messages.push({ role: 'user', content: userContent, timestamp: Date.now() });

    let isDone = false;
    let loops = 0;
    let accumulatedBlocks: ChatResponseBlock[] = [];
    const contextWindow = (model as any).contextWindow || 1048576;

    while (!isDone && loops < 10) {
        loops++;
        const currentSystemPrompt = rebuildSystemPrompt();

        const streamOptions: any = { apiKey, sessionId, maxTokens: 4096 };
        if (model.reasoning) {
            streamOptions.reasoning = 'medium';
        }

        const s = streamSimple(model, {
            systemPrompt: currentSystemPrompt,
            messages: conv.messages,
            tools: agentTools
        }, streamOptions);

        const prevTurnBlocks = [...accumulatedBlocks];

        for await (const event of s) {
            if (onUpdate && (event as any).partial) {
                const currentTurnBlocks = formatResponseBlocks((event as any).partial.content);
                onUpdate([...prevTurnBlocks, ...currentTurnBlocks]);
            }
        }

        const response = await s.result();
        if ((response as any).errorMessage) {
            conv.messages.pop();
            throw new Error((response as any).errorMessage);
        }

        const usage = (response as any).usage;
        if (usage) {
            const turnTokens = (usage.input || 0) + (usage.output || 0);
            conv.totalTokensUsed += turnTokens;
            console.log(`[Chat] Turn ${loops} usage: input=${usage.input}, output=${usage.output}, sessionTotal=${conv.totalTokensUsed}`);
        }

        conv.messages.push({ ...response, role: 'assistant' });

        const formattedTurnBlocks = formatResponseBlocks(response.content);
        accumulatedBlocks.push(...formattedTurnBlocks);

        // Notify final turn state to UI
        if (onUpdate) {
            onUpdate([...accumulatedBlocks]);
        }

        const toolCalls = response.content.filter((c: ToolCall | any) => c.type === 'toolCall');
        if (toolCalls.length > 0) {
            console.log(`[Chat] Turn ${loops}: Model provided ${toolCalls.length} tool calls.`);
            for (const toolCall of toolCalls) {
                console.log(`[Agent] Calling tool: ${toolCall.name}`);

                let outText = '';
                let isError = false;

                try {
                    if (toolCall.name === 'read_skill_instructions') {
                        const args = toolCall.arguments as { skill_name: string };
                        outText = loadSkillInstructions(args.skill_name) || `Error: Skill "${args.skill_name}" not found.`;
                        if (!loadSkillInstructions(args.skill_name)) isError = true;
                    } else if (toolCall.name === 'save_memory') {
                        const args = toolCall.arguments as { content: string };
                        appendFileSync(join(KITA_DIR, 'MEMORY.md'), '\n- ' + args.content);
                        outText = `Saved to memory successfully.`;
                    } else if (toolCall.name === 'run_command') {
                        const args = toolCall.arguments as { command: string };
                        console.log(`[Shell] Executing: ${args.command}`);
                        const timeout = parseInt(process.env.TOOL_TIMEOUT_MS || '120000');
                        const { stdout, stderr } = await execAsync(args.command, { timeout });
                        let result = (stdout + (stderr ? '\n' + stderr : '')).trim() || 'Success (no output)';
                        if (result.length > 4000) result = result.substring(0, 3950) + '\n... (output truncated)';
                        outText = result;
                    } else {
                        outText = `Error: Unknown tool "${toolCall.name}"`;
                        isError = true;
                    }
                } catch (e: any) {
                    outText = `Error: ${e.message}`;
                    isError = true;
                }

                conv.messages.push({
                    role: 'toolResult',
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    content: [{ type: 'text', text: outText }],
                    isError: isError,
                    timestamp: Date.now()
                });

                // Add result block to UI if showExecution is true
                if (showExecution) {
                    accumulatedBlocks.push({
                        type: 'result',
                        name: toolCall.name,
                        content: '',
                        isError: isError
                    });
                    if (onUpdate) onUpdate([...accumulatedBlocks]);
                }
            }
        } else {
            console.log(`[Chat] Turn ${loops}: Model finished (no tool calls).`);
            isDone = true;
        }
    }

    // Final Guard: If we are "done" but the response doesn't END with a text block,
    // do one final nudge to ensure Kita-chan always has the last word.
    const lastBlock = accumulatedBlocks[accumulatedBlocks.length - 1];
    const endsWithText = lastBlock?.type === 'text';

    if (isDone && !endsWithText && loops < 10) {
        console.log(`[Chat] Response ends with ${lastBlock?.type || 'nothing'}. Nudging for final conclusion...`);
        const currentSystemPrompt = rebuildSystemPrompt();
        const streamOptions: any = {
            apiKey,
            sessionId,
            maxTokens: 1024
        };

        const nudgeMessages: Message[] = [
            ...conv.messages,
            {
                role: 'user',
                content: 'SYSTEM: Tools done. Give the user a brief, direct final answer. Max 2 sentences. No filler. Match user language.'
            }
        ];

        const s = streamSimple(model, {
            systemPrompt: currentSystemPrompt,
            messages: nudgeMessages,
            tools: []
        }, streamOptions);

        const prevTurnBlocks = [...accumulatedBlocks];
        for await (const event of s) {
            if (onUpdate && (event as any).partial) {
                const currentTurnBlocks = formatResponseBlocks((event as any).partial.content);
                const textOnlyCurrentBlocks = currentTurnBlocks.filter(b => b.type === 'text');
                onUpdate([...prevTurnBlocks, ...textOnlyCurrentBlocks]);
            }
        }

        const response = await s.result();
        console.log('[Chat] Final nudge received response content with', response.content.length, 'parts.');
        conv.messages.push({ ...response, role: 'assistant' });

        const formattedTurnBlocks = formatResponseBlocks(response.content);
        const textOnlyBlocks = formattedTurnBlocks.filter(b => b.type === 'text');
        accumulatedBlocks.push(...textOnlyBlocks);

        if (textOnlyBlocks.length === 0) {
            accumulatedBlocks.push({
                type: 'text',
                content: 'Kita-n! ✨ Done! Anything else?'
            });
        }
    }

    if (loops >= 10) {
        console.warn('[Chat] Hit maximum tool loop limit (10).');
        accumulatedBlocks.unshift({ type: 'text', content: '(Maximum tool loop reached)\n' });
    }

    trimConversation(conv);
    saveSession();

    const finalText = accumulatedBlocks
        .filter(b => b.type === 'text')
        .map(b => b.content)
        .join('')
        .trim();

    console.log(`[Chat] Response complete. Blocks: ${accumulatedBlocks.length}, Text length: ${finalText.length}, SessionTokens: ${conv.totalTokensUsed}`);

    return {
        text: finalText,
        blocks: accumulatedBlocks,
        context: { usedTokens: conv.totalTokensUsed, contextWindow }
    };
}

// --- Session Management (exposed for Discord commands) ---

/** Clear conversation history for a session */
export function clearSession(sessionId: string): void {
    conversations.delete(sessionId);
    saveSession();
}

/** Clear long-term memory file (MEMORY.md) */
export function clearLongTermMemory(): void {
    const memoryPath = join(KITA_DIR, 'MEMORY.md');
    const initialContent = `# Kita's Memory\n\nLong-term storage for facts, preferences, and important information.\n\n## Stored Knowledge\n\n*(This is where Kita-chan stores information between sessions. Keep this file locally to maintain memory across restarts.)*\n`;
    writeFileSync(memoryPath, initialContent);
}

/** Get how many messages are in a session's history */
export function getSessionLength(sessionId: string): number {
    return conversations.get(sessionId)?.messages.length ?? 0;
}

// --- Model & Auth helpers (pass-through) ---

export function listModels(): { id: string; name: string; reasoning: boolean }[] {
    const providerId = getProviderId();
    return listModelsForProvider(providerId);
}

export function listModelsForProvider(providerId: string): { id: string; name: string; reasoning: boolean }[] {
    const models = getModels(providerId);
    return models.map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        reasoning: !!m.reasoning
    }));
}

export function currentModel(): string {
    return getActiveModel();
}

export function switchModel(modelId: string): void {
    setActiveModel(modelId);
}

export function isReady(): boolean {
    return isAuthenticated();
}

