import Conf from 'conf';

interface BotcallConfig {
  // New API mode (recommended)
  apiKey?: string;
  apiUrl?: string;
  
  // Legacy Signalwire mode (deprecated)
  projectId?: string;
  apiToken?: string;
  spaceUrl?: string;
  
  defaultNumber?: string;
}

const config = new Conf<BotcallConfig>({
  projectName: 'botcall',
  schema: {
    apiKey: { type: 'string' },
    apiUrl: { type: 'string' },
    projectId: { type: 'string' },
    apiToken: { type: 'string' },
    spaceUrl: { type: 'string' },
    defaultNumber: { type: 'string' },
  },
});

export function getConfig(): BotcallConfig {
  // Check env vars first, then stored config
  return {
    // API mode
    apiKey: process.env.BOTCALL_API_KEY || config.get('apiKey'),
    apiUrl: process.env.BOTCALL_API_URL || config.get('apiUrl'),
    
    // Legacy Signalwire mode
    projectId: process.env.BOTCALL_PROJECT_ID || config.get('projectId'),
    apiToken: process.env.BOTCALL_API_TOKEN || config.get('apiToken'),
    spaceUrl: process.env.BOTCALL_SPACE_URL || config.get('spaceUrl'),
    
    defaultNumber: config.get('defaultNumber'),
  };
}

export function setApiKey(apiKey: string, apiUrl?: string): void {
  config.set('apiKey', apiKey);
  if (apiUrl) {
    config.set('apiUrl', apiUrl);
  }
  // Clear legacy config
  config.delete('projectId');
  config.delete('apiToken');
  config.delete('spaceUrl');
}

// Legacy function for backwards compat
export function setCredentials(projectId: string, apiToken: string, spaceUrl: string): void {
  config.set('projectId', projectId);
  config.set('apiToken', apiToken);
  config.set('spaceUrl', spaceUrl);
}

export function getDefaultNumber(): string | undefined {
  return config.get('defaultNumber');
}

export function setDefaultNumber(number: string): void {
  config.set('defaultNumber', number);
}

export function clearConfig(): void {
  config.clear();
}

export function isConfigured(): boolean {
  const cfg = getConfig();
  // API mode takes precedence
  if (cfg.apiKey) return true;
  // Legacy mode
  return !!(cfg.projectId && cfg.apiToken && cfg.spaceUrl);
}

export function isApiMode(): boolean {
  const cfg = getConfig();
  return !!cfg.apiKey;
}

export { config };
