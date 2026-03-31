import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');
vi.mock('os', () => ({ homedir: () => '/home/testuser' }));

import { getMcpClientPaths, configureMcpFile } from './setup.js';
import * as fs from 'fs';

describe('getMcpClientPaths', () => {
  it('returns Claude Desktop and Cursor paths', () => {
    const paths = getMcpClientPaths();
    expect(paths['Claude Desktop']).toContain('claude_desktop_config.json');
    expect(paths['Cursor']).toContain('.cursor/mcp.json');
  });

  it('paths are under the home directory', () => {
    const paths = getMcpClientPaths();
    for (const p of Object.values(paths)) {
      expect(p).toContain('/home/testuser');
    }
  });
});

describe('configureMcpFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates a new config file when none exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const result = configureMcpFile('/tmp/mcp.json', 'bs_live_test123');

    expect(result.configured).toBe(true);
    expect(result.created).toBe(true);

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written.mcpServers.botcall.command).toBe('npx');
    expect(written.mcpServers.botcall.args).toEqual(['-y', 'botcall-mcp']);
    expect(written.mcpServers.botcall.env.BOTCALL_API_KEY).toBe('bs_live_test123');
  });

  it('merges into an existing config without clobbering other servers', () => {
    const existing = { mcpServers: { 'other-tool': { command: 'other' } } };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const result = configureMcpFile('/tmp/mcp.json', 'bs_live_test123');

    expect(result.configured).toBe(true);
    expect(result.created).toBe(false);

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written.mcpServers['other-tool']).toEqual({ command: 'other' });
    expect(written.mcpServers.botcall.env.BOTCALL_API_KEY).toBe('bs_live_test123');
  });

  it('returns error when write fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => { throw new Error('permission denied'); });

    const result = configureMcpFile('/tmp/mcp.json', 'bs_live_test123');

    expect(result.configured).toBe(false);
    expect(result.error).toBe('permission denied');
  });
});
