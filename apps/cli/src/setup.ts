import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const BOTCALL_MCP_CONFIG = {
  command: 'npx',
  args: ['-y', 'botcall-mcp'],
};

export function getMcpClientPaths(): Record<string, string> {
  const home = homedir();
  return {
    'Claude Desktop': join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    'Cursor': join(home, '.cursor', 'mcp.json'),
  };
}

export function configureMcpFile(filePath: string, apiKey: string): { configured: boolean; created: boolean; error?: string } {
  try {
    let config: Record<string, any> = {};
    const existed = existsSync(filePath);
    if (existed) {
      config = JSON.parse(readFileSync(filePath, 'utf8'));
    }

    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.botcall = {
      ...BOTCALL_MCP_CONFIG,
      env: { BOTCALL_API_KEY: apiKey },
    };

    writeFileSync(filePath, JSON.stringify(config, null, 2));
    return { configured: true, created: !existed };
  } catch (error) {
    return { configured: false, created: false, error: (error as Error).message };
  }
}

export async function configureClaudeCode(apiKey: string): Promise<{ configured: boolean; error?: string }> {
  try {
    await execAsync('claude mcp add botcall -- npx -y botcall-mcp', {
      env: { ...process.env, BOTCALL_API_KEY: apiKey },
    });
    return { configured: true };
  } catch (error) {
    return { configured: false, error: (error as Error).message };
  }
}
