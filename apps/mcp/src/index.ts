#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_URL = process.env.BOTCALL_API_URL || "https://api.botcall.io";
const API_KEY = process.env.BOTCALL_API_KEY;

if (!API_KEY) {
  console.error("BOTCALL_API_KEY environment variable is required");
  process.exit(1);
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json() as { success: boolean; error?: { message: string }; data?: T };

  if (!data.success) {
    throw new Error(data.error?.message || "API request failed");
  }

  return data.data as T;
}

const tools = [
  {
    name: "provision_number",
    description: "Provision a new phone number for receiving SMS. Returns the number details including the E.164 phone number.",
    inputSchema: {
      type: "object" as const,
      properties: {
        areaCode: {
          type: "string",
          description: "Preferred area code (e.g., '206' for Seattle). Optional.",
        },
        country: {
          type: "string",
          description: "ISO country code (default: US)",
        },
      },
    },
  },
  {
    name: "list_numbers",
    description: "List all phone numbers you have provisioned.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "release_number",
    description: "Release a phone number you no longer need.",
    inputSchema: {
      type: "object" as const,
      properties: {
        numberId: {
          type: "string",
          description: "The ID of the phone number to release",
        },
      },
      required: ["numberId"],
    },
  },
  {
    name: "get_inbox",
    description: "Get recent SMS messages received on your numbers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of messages to return (default: 10)",
        },
      },
    },
  },
  {
    name: "get_code",
    description: "Wait for an incoming SMS and extract the verification code. Use this after triggering a verification flow — it long-polls until a message arrives or the timeout expires.",
    inputSchema: {
      type: "object" as const,
      properties: {
        timeout: {
          type: "number",
          description: "Seconds to wait for a message (default: 120, max: 120)",
        },
      },
    },
  },
  {
    name: "get_usage",
    description: "Get your current plan, limits, and usage statistics.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "provision_number": {
      const result = await apiRequest<{
        id: string;
        number: string;
        capabilities: { sms: boolean; voice: boolean; mms: boolean };
        status: string;
        createdAt: string;
      }>("/v1/phone/numbers", {
        method: "POST",
        body: JSON.stringify({
          areaCode: args.areaCode,
          country: args.country,
        }),
      });
      return JSON.stringify(result, null, 2);
    }

    case "list_numbers": {
      const result = await apiRequest<Array<{
        id: string;
        number: string;
        capabilities: { sms: boolean; voice: boolean; mms: boolean };
        status: string;
        createdAt: string;
      }>>("/v1/phone/numbers");

      if (result.length === 0) {
        return "No phone numbers provisioned. Use provision_number to get one.";
      }
      return JSON.stringify(result, null, 2);
    }

    case "release_number": {
      await apiRequest(`/v1/phone/numbers/${args.numberId}`, {
        method: "DELETE",
      });
      return "Phone number released successfully.";
    }

    case "get_inbox": {
      const limit = (args.limit as number) || 10;
      const result = await apiRequest<Array<{
        id: string;
        from: string;
        to: string;
        body: string;
        direction: string;
        receivedAt: string;
        code: string | null;
      }>>(`/v1/phone/messages?limit=${limit}`);

      if (result.length === 0) {
        return "No messages received yet.";
      }
      return JSON.stringify(result, null, 2);
    }

    case "get_code": {
      const timeout = (args.timeout as number) || 120;
      const since = new Date().toISOString();

      const result = await apiRequest<{
        message: { id: string; from: string; to: string; body: string; receivedAt: string };
        code: string | null;
      }>(`/v1/phone/messages/poll?timeout=${timeout}&since=${encodeURIComponent(since)}`);

      if (result.code) {
        return `Verification code: ${result.code}\n\nFull message: ${result.message.body}`;
      }

      return `Message received but no code found.\n\nFrom: ${result.message.from}\nMessage: ${result.message.body}`;
    }

    case "get_usage": {
      const result = await apiRequest<{
        plan: string;
        limits: { phoneNumbers: number; smsPerMonth: number };
        usage: { phoneNumbers: number; smsThisMonth: number };
        canProvision: boolean;
        canReceiveSms: boolean;
      }>("/v1/billing/usage");
      return JSON.stringify(result, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "botcall", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("botcall MCP server running");
