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
import { appendFileSync } from 'fs';
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
        description: 'Save important facts (like IPs, user preferences, configurations) to long-term memory for future chats.',
        parameters: Type.Object({
            content: Type.String({ description: 'The text content to store in memory.' })
        })
    },
    {
        name: 'run_command',
        description: 'Execute a bash/CLI command on the host system to help the user. E.g. ping, curl, ls. Warning: run responsibly.',
        parameters: Type.Object({
            command: Type.String({ description: 'The bash command to execute.' })
        })
    }
];

// --- Conversation Memory ---

interface Conversation {
    messages: Message[];
    lastActivity: number;
}

// In-memory conversation store, keyed by session ID
const conversations = new Map<string, Conversation>();

// Limits to prevent unbounded memory growth
const MAX_MESSAGES_PER_SESSION = 50;   // Keep last 50 messages (25 turns)
const SESSION_TTL_MS = 30 * 60 * 1000; // Auto-expire after 30min inactivity

/**
 * Get or create a conversation for a session.
 */
function getConversation(sessionId: string): Conversation {
    let conv = conversations.get(sessionId);
    if (!conv || (Date.now() - conv.lastActivity > SESSION_TTL_MS)) {
        conv = { messages: [], lastActivity: Date.now() };
        conversations.set(sessionId, conv);
    }
    conv.lastActivity = Date.now();
    return conv;
}

/**
 * Trim conversation to stay within limits.
 * Keeps the most recent messages, always maintaining user/assistant pairs.
 */
function trimConversation(conv: Conversation) {
    while (conv.messages.length > MAX_MESSAGES_PER_SESSION) {
        // Remove oldest 2 messages (one user + one assistant turn)
        conv.messages.splice(0, 2);
    }
}

/**
 * Periodically clean up expired sessions
 */
function cleanupSessions() {
    const now = Date.now();
    for (const [id, conv] of conversations) {
        if (now - conv.lastActivity > SESSION_TTL_MS) {
            conversations.delete(id);
        }
    }
}

// Cleanup every 5 minutes
setInterval(cleanupSessions, 5 * 60 * 1000);

// --- Core Chat ---

/**
 * Chat with the AI model, maintaining conversation history per session.
 * 
 * @param sessionId - Unique ID for the conversation (e.g. channel ID, DM user ID)
 * @param prompt - The user's message
 * @returns The AI's text response
 */
// --- Visibility Settings ---
let showThinking = true;
let showExecution = true;

/** Toggle thinking visibility */
export function setThinkingVisibility(visible: boolean) { showThinking = visible; }
/** Toggle tool execution visibility */
export function setExecutionVisibility(visible: boolean) { showExecution = visible; }
export function getThinkingVisibility() { return showThinking; }
export function getExecutionVisibility() { return showExecution; }

/**
 * Structured response block for frontends to render appropriately.
 */
export interface ChatResponseBlock {
    type: 'text' | 'thinking' | 'execution';
    content: string;
    name?: string; // For tool calls
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
            const thought = (block as any).thinking || (block as any).reasoning || '';
            if (thought.trim()) {
                blocks.push({ type: 'thinking', content: thought.trim() });
            }
        } else if (block.type === 'toolCall' && showExecution) {
            const hasArgs = Object.keys(block.arguments || {}).length > 0;
            const argsStr = hasArgs ? JSON.stringify(block.arguments, null, 2) : '';
            blocks.push({ type: 'execution', name: block.name, content: argsStr });
        } else if (block.type === 'text') {
            if (block.text) {
                blocks.push({ type: 'text', content: block.text });
            }
        }
    }

    return blocks;
}

/**
 * Platform-agnostic Chat Service (The Brain).
 */
/**
 * Chat with the AI model, maintaining conversation history per session.
 * 
 * @param sessionId - Unique ID for the conversation (e.g. channel ID, DM user ID)
 * @param prompt - The user's message
 * @param images - Optional list of images (base64 data and mimeType)
 * @param onUpdate - Callback for streaming updates
 * @returns Final text and all response blocks
 */
export async function chat(
    sessionId: string,
    prompt: string,
    images?: { data: string; mimeType: string }[],
    onUpdate?: (blocks: ChatResponseBlock[]) => void
): Promise<{ text: string, blocks: ChatResponseBlock[] }> {
    const apiKey = await getApiKey();
    const providerId = getProviderId();
    const modelId = getActiveModel();

    console.log(`[Chat] Session: ${sessionId}, Provider: ${providerId}, Model: ${modelId}, Images: ${images?.length || 0}`);

    const model = getModel(providerId as 'google-gemini-cli', modelId as any);
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

        conv.messages.push({ ...response, role: 'assistant' });

        const formattedTurnBlocks = formatResponseBlocks(response.content);
        accumulatedBlocks.push(...formattedTurnBlocks);

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
                        const { stdout, stderr } = await execAsync(args.command, { timeout: 15000 });
                        outText = (stdout + (stderr ? '\n' + stderr : '')).trim() || "Success (no output)";
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
            }
        } else {
            console.log(`[Chat] Turn ${loops}: Model finished (no tool calls).`);
            isDone = true;
        }
    }

    // Final Guard: If we are "done" but haven't provided any text blocks to the user,
    // do one final tiny non-tool turn to force a summary/answer.
    const hasText = accumulatedBlocks.some(b => b.type === 'text');
    if (isDone && !hasText && loops < 10) {
        console.log('[Chat] Model finished without text blocks. Nudging for final answer...');
        const currentSystemPrompt = rebuildSystemPrompt();
        const streamOptions: any = {
            apiKey,
            sessionId,
            maxTokens: 1024
        };

        // For the final nudge, we try to disable reasoning if it's a reasoning model
        // to avoid another long "thinking" loop without text.
        const nudgeMessages: Message[] = [
            ...conv.messages,
            {
                role: 'user',
                content: 'SYSTEM NOTICE: You have completed your tools and reasoning. Now, respond to the user as Kita-chan. You MUST provide a final text response with your bubbly personality and emojis. Match the language used by the user in the latest message. Do not reason anymore, just answer.'
            }
        ];

        const s = streamSimple(model, {
            systemPrompt: currentSystemPrompt,
            messages: nudgeMessages,
            tools: [] // No tools for final nudge
        }, streamOptions);

        const prevTurnBlocks = [...accumulatedBlocks];
        for await (const event of s) {
            if (onUpdate && (event as any).partial) {
                const currentTurnBlocks = formatResponseBlocks((event as any).partial.content);
                onUpdate([...prevTurnBlocks, ...currentTurnBlocks]);
            }
        }

        const response = await s.result();
        console.log('[Chat] Final nudge received response content with', response.content.length, 'parts.');
        conv.messages.push({ ...response, role: 'assistant' });
        const formattedTurnBlocks = formatResponseBlocks(response.content);
        accumulatedBlocks.push(...formattedTurnBlocks);
    }

    if (loops >= 10) {
        console.warn('[Chat] Hit maximum tool loop limit (10).');
        accumulatedBlocks.unshift({ type: 'text', content: '(Maximum tool loop reached)\n' });
    }

    trimConversation(conv);

    const finalText = accumulatedBlocks
        .filter(b => b.type === 'text')
        .map(b => b.content)
        .join('')
        .trim();

    console.log(`[Chat] Response complete. Blocks: ${accumulatedBlocks.length}, Text length: ${finalText.length}`);

    return {
        text: finalText,
        blocks: accumulatedBlocks
    };
}

// --- Session Management (exposed for Discord commands) ---

/** Clear conversation history for a session */
export function clearSession(sessionId: string): void {
    conversations.delete(sessionId);
}

/** Get how many messages are in a session's history */
export function getSessionLength(sessionId: string): number {
    return conversations.get(sessionId)?.messages.length ?? 0;
}

// --- Model & Auth helpers (pass-through) ---

export function listModels(): { id: string; name: string; reasoning: boolean }[] {
    const providerId = getProviderId();
    const models = getModels(providerId as 'google-gemini-cli');
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
