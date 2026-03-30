#!/bin/bash
set -e

# botcall-print installer
# Usage: curl -fsSL https://botcall-api-production.up.railway.app/install.sh | bash -s -- YOUR_API_KEY

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

API_KEY="$1"

if [ -z "$API_KEY" ]; then
    echo -e "${RED}Error: API key required${NC}"
    echo "Usage: curl -fsSL https://botcall-api-production.up.railway.app/install.sh | bash -s -- YOUR_API_KEY"
    exit 1
fi

echo "🖨️  botcall-print installer"
echo ""

# Check if running on Linux
if [ "$(uname)" != "Linux" ]; then
    echo -e "${RED}Error: This installer is for Linux/Raspberry Pi only${NC}"
    exit 1
fi

# Install system dependencies
echo "📦 Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip libusb-1.0-0-dev > /dev/null

# Install botcall-print
echo "📦 Installing botcall-print..."
pip3 install --user --quiet botcall-print

# Add ~/.local/bin to PATH if not already there
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    export PATH="$HOME/.local/bin:$PATH"
fi

# Run install
echo "⚙️  Configuring service..."
"$HOME/.local/bin/botcall-print" install --api-key "$API_KEY"

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo "Your printer daemon is now running. Send a text to your BotCall number to test."
