/**
 * Auth module — multi-provider router.
 * Active provider is stored in auth.json under "_activeProvider".
 * All provider logic is delegated to individual auth modules.
 */

import * as geminiCli from './auth/gemini-cli';
import * as githubCopilot from './auth/github-copilot';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const AUTH_FILE = join(process.cwd(), 'auth.json');

export type ProviderKey = 'google-gemini-cli' | 'github-copilot';

interface ProviderModule {
    authenticate: (onAuthUrl: (url: string, instructions?: string) => void, onManualCodeInput: () => Promise<string>) => Promise<boolean>;
    getApiKey: () => Promise<string>;
    isAuthenticated: () => boolean;
    getProviderId: () => string;
    getActiveModel: () => string;
    setActiveModel: (modelId: string) => void;
}

const PROVIDERS: { id: ProviderKey; name: string; module: ProviderModule }[] = [
    { id: 'google-gemini-cli', name: 'Gemini CLI (Google)', module: geminiCli },
    { id: 'github-copilot', name: 'GitHub Copilot', module: githubCopilot },
];

function loadStore(): Record<string, any> {
    if (existsSync(AUTH_FILE)) {
        try { return JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch { return {}; }
    }
    return {};
}

function saveStore(store: Record<string, any>) {
    writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
}

// --- Active provider ---

export function getActiveProvider(): ProviderKey {
    const store = loadStore();
    return (store._activeProvider as ProviderKey) || 'google-gemini-cli';
}

export function setActiveProvider(id: ProviderKey) {
    const store = loadStore();
    store._activeProvider = id;
    saveStore(store);
}

export function getActiveProviderName(): string {
    const id = getActiveProvider();
    return PROVIDERS.find(p => p.id === id)?.name || id;
}

export function getAvailableProviders(): { id: ProviderKey; name: string; authenticated: boolean }[] {
    return PROVIDERS.map(p => ({
        id: p.id,
        name: p.name,
        authenticated: p.module.isAuthenticated()
    }));
}

export function isProviderAuthenticated(id: ProviderKey): boolean {
    const provider = PROVIDERS.find(p => p.id === id);
    return provider?.module.isAuthenticated() ?? false;
}

// --- Authenticate a specific provider ---

export function authenticateProvider(
    providerId: ProviderKey,
    onAuthUrl: (url: string, instructions?: string) => void,
    onManualCodeInput: () => Promise<string>
) {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider.module.authenticate(onAuthUrl, onManualCodeInput);
}

// --- Delegated functions (use active provider) ---

function active(): ProviderModule {
    const id = getActiveProvider();
    const provider = PROVIDERS.find(p => p.id === id);
    if (!provider) throw new Error(`Unknown active provider: ${id}`);
    return provider.module;
}

export function authenticate(
    onAuthUrl: (url: string, instructions?: string) => void,
    onManualCodeInput: () => Promise<string>
) {
    return active().authenticate(onAuthUrl, onManualCodeInput);
}

export function getApiKey() {
    return active().getApiKey();
}

export function isAuthenticated(): boolean {
    return active().isAuthenticated();
}

export function getProviderId(): string {
    return active().getProviderId();
}

export function getActiveModel(): string {
    return active().getActiveModel();
}

export function setActiveModel(modelId: string) {
    return active().setActiveModel(modelId);
}

// --- Provider-specific model access ---

export function getProviderApiKey(providerId: ProviderKey): Promise<string> {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider.module.getApiKey();
}
