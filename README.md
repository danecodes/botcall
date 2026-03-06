# botcall

Phone numbers for AI agents. Dead simple.

```bash
npm install -g botcall
botcall auth login --api-key YOUR_KEY
botcall get-code --timeout 120
```

## Why

AI agents need phone numbers for verification codes, 2FA, and SMS. Setting this up yourself means dealing with Twilio/Signalwire complexity, webhook infrastructure, and message storage.

botcall handles all of that. Get an API key, get a number, receive codes.

## Install

```bash
npm install -g botcall
```

## Quick Start

```bash
# Authenticate
botcall auth login --api-key bs_live_xxxxx

# Get a phone number
botcall provision --area-code 206

# Wait for a verification code
botcall get-code

# View inbox
botcall inbox
```

## Commands

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
```

### `get-code`

Wait for an SMS and extract the verification code. Blocks until a code arrives or timeout.

```bash
botcall get-code                 # Wait up to 120s (default)
botcall get-code --timeout 60    # Custom timeout
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

## Environment Variables

Instead of `auth login`, you can set:

```bash
export BOTCALL_API_KEY=bs_live_xxxxx
```

## Pricing

See [botcall.io](https://botcall.io) for current pricing.

## License

MIT
