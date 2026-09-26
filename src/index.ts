import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import { authorizeClient } from "./access";

import {
  AtprotoError,
  createPost,
  createSession,
  deletePost,
  type AtprotoCredentials,
} from "./atproto";

interface Env {
  ATPROTO_IDENTIFIER?: string;
  ATPROTO_APP_PASSWORD?: string;
  ATPROTO_SERVICE?: string;
  MCP_API_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUDIENCE?: string;
  ACCESS_ALLOWED_EMAILS?: string;
}

function credentialsFromEnv(env: Env): AtprotoCredentials {
  if (!env.ATPROTO_IDENTIFIER || !env.ATPROTO_APP_PASSWORD) {
    throw new Error("ATPROTO_IDENTIFIER and ATPROTO_APP_PASSWORD must be configured");
  }

  return {
    identifier: env.ATPROTO_IDENTIFIER,
    appPassword: env.ATPROTO_APP_PASSWORD,
    service: env.ATPROTO_SERVICE,
  };
}

function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "atproto-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "account_status",
    {
      description:
        "Verify the configured AT Protocol credentials and return the authenticated account identity without creating a post.",
      inputSchema: {},
    },
    async () => {
      try {
        const session = await createSession(credentialsFromEnv(env));
        return jsonResult({
          did: session.did,
          handle: session.handle,
          service: env.ATPROTO_SERVICE ?? "https://bsky.social",
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "post_create",
    {
      description:
        "Create a Bluesky post as the configured account. Use langs for BCP-47 language tags when known.",
      inputSchema: {
        text: z.string().min(1).describe("Post text"),
        langs: z
          .array(z.string().min(2))
          .max(3)
          .optional()
          .describe("Optional BCP-47 language tags, for example ['ja'] or ['ja', 'en']"),
      },
    },
    async ({ text, langs }) => {
      try {
        const result = await createPost(credentialsFromEnv(env), { text, langs });
        return jsonResult(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "post_delete",
    {
      description:
        "Delete a Bluesky post owned by the configured account using its at:// URI. This refuses cross-account deletes.",
      inputSchema: {
        uri: z
          .string()
          .startsWith("at://")
          .describe("AT URI returned by post_create, e.g. at://did:plc:.../app.bsky.feed.post/..."),
      },
    },
    async ({ uri }) => {
      try {
        const result = await deletePost(credentialsFromEnv(env), uri);
        return jsonResult(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolError(error: unknown) {
  const message =
    error instanceof AtprotoError
      ? `${error.message}${error.code ? ` (${error.code})` : ""}`
      : error instanceof Error
        ? error.message
        : "Unknown error";

  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "atproto-mcp",
        version: "0.1.0",
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    const identity = await authorizeClient(request, env);
    if (!identity) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer realm="atproto-mcp"',
          "cache-control": "no-store",
        },
      });
    }

    const handler = createMcpHandler(() => createServer(env));
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
