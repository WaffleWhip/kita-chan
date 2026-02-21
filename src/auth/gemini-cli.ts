/**
 * Gemini CLI Authentication Provider
 * 
 * Handles OAuth login, token refresh, and API key generation
 * by delegating entirely to the pi-ai library's OAuth system.
 * No hardcoded logic — it's a thin wrapper around the library.
 */

import { loginGeminiCli, getOAuthApiKey, getModels, type OAuthCredentials } from '@mariozechner/pi-ai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const AUTH_FILE = join(process.cwd(), 'auth.json');
const PROVIDER_ID = 'google-gemini-cli';

// --- Storage helpers ---

function loadCredentialStore(): Record<string, OAuthCredentials> {
    if (existsSync(AUTH_FILE)) {
        try {
            return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
        } catch {
            return {};
        }
    }
    return {};
}

function saveCredentialStore(store: Record<string, any>) {
    writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
}

// --- Public API ---

/**
 * Run the full Gemini CLI OAuth login flow.
 * The pi-ai library handles: PKCE, local callback server, token exchange,
 * user info lookup, and Cloud Code Assist project discovery.
 * 
 * We just persist the resulting credentials.
 */
export async function authenticate(
    onAuthUrl: (url: string, instructions?: string) => void,
    onManualCodeInput: () => Promise<string>
): Promise<boolean> {
    const credentials = await loginGeminiCli(
        (info) => onAuthUrl(info.url, info.instructions),
        (msg) => console.log(`[OAuth] ${msg}`),
        onManualCodeInput
    );

    // loginGeminiCli returns credentials with projectId already resolved
    console.log(`[Auth] Login succeeded. Raw credentials:`, JSON.stringify(credentials, null, 2));

    const store = loadCredentialStore();
    // Preserve user settings (like selectedModel) across re-auth
    const existingSettings = store[PROVIDER_ID] || {};
    store[PROVIDER_ID] = {
        ...existingSettings,
        type: 'oauth',
        ...credentials
    };
    saveCredentialStore(store);

    return true;
}

/**
 * Get the API key for the current session.
 * The pi-ai library handles token refresh and returns a JSON-encoded
 * API key containing both the access token and project ID.
 */
export async function getApiKey(): Promise<string> {
    const store = loadCredentialStore();
    const creds = store[PROVIDER_ID];

    if (!creds?.refresh) {
        throw new Error('Not authenticated. Use /auth to login.');
    }

    const result = await getOAuthApiKey(PROVIDER_ID, store);
    if (!result) {
        throw new Error('Failed to get API key. Use /auth to re-login.');
    }

    // Save refreshed credentials back
    store[PROVIDER_ID] = {
        ...store[PROVIDER_ID],
        ...result.newCredentials
    };
    saveCredentialStore(store);

    return result.apiKey;
}

export function isAuthenticated(): boolean {
    const store = loadCredentialStore();
    return !!store[PROVIDER_ID]?.refresh;
}

export function getProviderId(): string {
    return PROVIDER_ID;
}

// --- Model selection (user preference, stored alongside credentials) ---

export function getActiveModel(): string {
    const store = loadCredentialStore();
    return store[PROVIDER_ID]?.selectedModel || 'gemini-2.5-flash';
}

export function setActiveModel(modelId: string) {
    const store = loadCredentialStore();
    if (!store[PROVIDER_ID]) store[PROVIDER_ID] = {} as any;
    (store[PROVIDER_ID] as any).selectedModel = modelId;
    saveCredentialStore(store);
}
