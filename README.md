# botcall

Phone numbers for AI agents. Dead simple.

```bash
npm install -g botcall
botcall setup --api-key YOUR_KEY
```

## Why

AI agents need phone numbers for verification codes, 2FA, and SMS. Setting this up yourself means dealing with Twilio/SignalWire complexity, webhook infrastructure, and message storage.

botcall handles all of that. Get an API key, get a number, receive codes.

## Install

```bash
npm install -g botcall
```

## Quick Start

The `setup` command does everything in one step: saves your key, configures Claude Desktop and Cursor MCP integration, provisions a number, and confirms SMS works.

```bash
botcall setup --api-key bs_live_xxxxx
```

Or manually:

```bash
# Authenticate
botcall auth login --api-key bs_live_xxxxx

# Get a phone number
botcall provision --area-code 206

# Wait for a verification code (max 30s)
botcall get-code

# View inbox
botcall inbox
```

## Commands

### `setup --api-key <key>`

One-command setup: saves your API key, configures MCP clients (Claude Desktop, Cursor, Claude Code), provisions a number, and confirms SMS delivery.

```bash
botcall setup --api-key bs_live_xxxxx
```

### `auth login --api-key <key>`

Authenticate with your API key.

```bash
botcall auth login --api-key bs_live_xxxxx
```

### `provision`

Get a new phone number.

```bash
botcall provision                    # Any available number
botcall provision --area-code 206    # Seattle area code
botcall provision --country CA       # Canadian number
```

### `list`

List your phone numbers.

```bash
botcall list
botcall list --json
```

### `inbox`

View received messages.

```bash
botcall inbox
botcall inbox --limit 50
botcall inbox --json
botcall inbox --number-id <id>   # Filter by specific number
```

### `get-code`

Wait for an SMS and extract the verification code. Blocks until a code arrives or timeout (max 30 seconds).

```bash
botcall get-code                      # Wait up to 30s
botcall get-code --timeout 15         # Shorter timeout
botcall get-code --number-id <id>     # Target a specific number
```

Returns just the code on stdout for easy scripting:

```bash
CODE=$(botcall get-code)
echo "Got code: $CODE"
```

### `release`

Release a phone number.

```bash
botcall list --json              # Get the number ID
botcall release <number-id>
```

### `usage`

Show current plan and usage.

```bash
botcall usage
```

### `billing`

Open the Stripe billing portal in your browser.

```bash
botcall billing
```

## Environment Variables

Instead of `auth login`, you can set:

```bash
export BOTCALL_API_KEY=bs_live_xxxxx
```

## Pricing

See [botcall.io](https://botcall.io) for current pricing.

## License

MIT
