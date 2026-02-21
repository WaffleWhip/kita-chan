/**
 * GitHub Copilot Authentication Provider
 * 
 * Uses pi-ai's GitHub Copilot OAuth device flow.
 * Token is auto-refreshed via getOAuthApiKey.
 */

import { loginGitHubCopilot, getOAuthApiKey, getGitHubCopilotBaseUrl, type OAuthCredentials } from '@mariozechner/pi-ai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const AUTH_FILE = join(process.cwd(), 'auth.json');
const PROVIDER_ID = 'github-copilot';

function loadCredentialStore(): Record<string, any> {
    if (existsSync(AUTH_FILE)) {
        try { return JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch { return {}; }
    }
    return {};
}

function saveCredentialStore(store: Record<string, any>) {
    writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
}

/**
 * Run GitHub Copilot OAuth device code flow.
 * Uses github.com by default (no enterprise prompt).
 */
export async function authenticate(
    onAuthUrl: (url: string, instructions?: string) => void,
    _onManualCodeInput: () => Promise<string>
): Promise<boolean> {
    const credentials = await loginGitHubCopilot({
        onAuth: (url: string, instructions?: string) => onAuthUrl(url, instructions),
        onPrompt: async () => '', // Default to github.com (empty = no enterprise)
        onProgress: (msg: string) => console.log(`[GitHub OAuth] ${msg}`),
    });

    const store = loadCredentialStore();
    const existing = store[PROVIDER_ID] || {};
    store[PROVIDER_ID] = { ...existing, type: 'oauth', ...credentials };
    saveCredentialStore(store);
    return true;
}

/**
 * Get API key (auto-refreshes token if expired).
 */
export async function getApiKey(): Promise<string> {
    const store = loadCredentialStore();
    const creds = store[PROVIDER_ID];
    if (!creds?.refresh) throw new Error('GitHub Copilot not authenticated. Use /auth to login.');

    const result = await getOAuthApiKey(PROVIDER_ID, store);
    if (!result) throw new Error('Failed to get GitHub Copilot API key.');

    store[PROVIDER_ID] = { ...store[PROVIDER_ID], ...result.newCredentials };
    saveCredentialStore(store);
    return result.apiKey;
}

/**
 * Get the base URL for API calls (extracted from Copilot token).
 */
export function getBaseUrl(): string {
    const store = loadCredentialStore();
    const creds = store[PROVIDER_ID];
    return getGitHubCopilotBaseUrl(creds?.access, creds?.enterpriseUrl);
}

export function isAuthenticated(): boolean {
    const store = loadCredentialStore();
    return !!store[PROVIDER_ID]?.refresh;
}

export function getProviderId(): string {
    return PROVIDER_ID;
}

export function getActiveModel(): string {
    const store = loadCredentialStore();
    return store[PROVIDER_ID]?.selectedModel || 'gpt-4o';
}

export function setActiveModel(modelId: string) {
    const store = loadCredentialStore();
    if (!store[PROVIDER_ID]) store[PROVIDER_ID] = {} as any;
    store[PROVIDER_ID].selectedModel = modelId;
    saveCredentialStore(store);
}
