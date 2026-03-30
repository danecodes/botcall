# botcall-mcp

Give your AI agent a real phone number for SMS verification.

## Quick Start

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "botcall": {
      "command": "npx",
      "args": ["-y", "botcall-mcp"],
      "env": {
        "BOTCALL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Get your API key at [botcall.io](https://botcall.io) — sign in, go to Dashboard → API Keys.

## Example Workflow

Call `provision_number` to get a phone number. Trigger the verification flow on the target service. Call `get_code` — it waits up to 30 seconds for the SMS to arrive and returns the extracted verification code.

## Available Tools

| Tool | Description |
|------|-------------|
| `provision_number` | Provision a new phone number |
| `list_numbers` | List your phone numbers |
| `release_number` | Release a phone number |
| `get_inbox` | Get recent SMS messages |
| `get_code` | Wait for an SMS and extract the verification code |
| `get_usage` | Get your plan and usage stats |
