# botcall

Give your AI agent a real phone number for SMS verification. Dead simple.

```bash
npm install -g botcall
botcall auth login --api-key bs_live_xxxxx
botcall provision
botcall get-code
# → 847291
```

## Installation

```bash
npm install -g botcall
```

Requires Node.js 18+.

## Authentication

Get an API key at [botcall.io](https://botcall.io) — sign up, choose a plan, and your key is on the dashboard.

```bash
botcall auth login --api-key bs_live_xxxxx
```

Your key is stored locally in `~/.config/botcall/config.json` (or `%APPDATA%\botcall\config.json` on Windows).

You can also use an environment variable instead of logging in:

```bash
export BOTCALL_API_KEY=bs_live_xxxxx
```

## Commands

### `botcall provision`

Provision a new phone number. Numbers are billed monthly — release when you're done.

```bash
botcall provision                    # any US number
botcall provision --area-code 206    # specific area code (Seattle)
botcall provision --country US       # specific country (default: US)
```

**Options:**

| Flag | Description |
|------|-------------|
| `-a, --area-code <code>` | Request a number in a specific area code |
| `-c, --country <code>` | Country code (default: `US`) |

### `botcall get-code`

Wait for an incoming SMS and extract the verification code. Call this *after* triggering the verification flow on the target service. Returns just the code — nothing else — so it's easy to use in scripts.

```bash
botcall get-code              # waits up to 30 seconds
botcall get-code --timeout 20 # custom timeout (max 30)
```

**Options:**

| Flag | Description |
|------|-------------|
| `-t, --timeout <seconds>` | Seconds to wait (default: 30, max: 30) |

**Exit codes:**
- `0` — code found, printed to stdout
- `1` — timeout or error

**Scripting example:**

```bash
# Trigger verification on some service, then:
CODE=$(botcall get-code)
echo "Got code: $CODE"
```

### `botcall list`

List your provisioned phone numbers.

```bash
botcall list
botcall ls           # alias
botcall list --json  # machine-readable output
```

### `botcall inbox`

View recent incoming messages.

```bash
botcall inbox              # last 10 messages
botcall inbox --limit 50   # more messages
botcall inbox --json       # machine-readable
```

### `botcall release <number-id>`

Release a phone number. Stops billing for that number immediately. Get the ID from `botcall list --json`.

```bash
botcall list --json
# copy the "id" field, then:
botcall release abc123
```

### `botcall usage`

Show your current plan and usage.

```bash
botcall usage
```

```
Plan: STARTER

Limits:
  Phone numbers: 1/1
  SMS this month: 3/100
```

### `botcall billing`

Open the Stripe billing portal in your browser to manage or cancel your subscription.

```bash
botcall billing
```

### `botcall auth`

Manage authentication.

```bash
botcall auth login --api-key bs_live_xxxxx   # save API key
botcall auth status                           # check current auth
botcall auth logout                           # clear saved key
```

**Options for `auth login`:**

| Flag | Description |
|------|-------------|
| `--api-key <key>` | Your botcall API key |
| `--api-url <url>` | Custom API URL (self-hosted only) |

## MCP Server

botcall also ships an MCP server for use with Claude Desktop and other MCP-compatible AI tools.

```bash
npm install -g botcall-mcp
```

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "botcall": {
      "command": "npx",
      "args": ["-y", "botcall-mcp"],
      "env": {
        "BOTCALL_API_KEY": "bs_live_xxxxx"
      }
    }
  }
}
```

MCP tools: `provision_number`, `list_numbers`, `release_number`, `get_inbox`, `get_code`, `get_usage`.

## Plans

| Plan | Price | Numbers | SMS/month |
|------|-------|---------|-----------|
| Starter | $9/mo | 1 | 100 |
| Pro | $29/mo | 5 | 500 |

Sign up at [botcall.io](https://botcall.io).

## License

MIT
