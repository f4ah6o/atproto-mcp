# atproto-mcp

A small, stateless Remote MCP server for posting to Bluesky / AT Protocol from Cloudflare Workers.

## Current tools

- `account_status` — verifies the configured account and returns its DID/handle.
- `post_create` — creates an `app.bsky.feed.post` record.
- `post_delete` — deletes a post created by the configured account using its `at://` URI.

The MCP endpoint is `/mcp` and uses Streamable HTTP through Cloudflare's stateless `createMcpHandler`.

## Security model

The Worker requires a static bearer token in `MCP_API_TOKEN`. Requests to `/mcp` without the matching `Authorization: Bearer ...` header are rejected.

Bluesky credentials are never stored in source or Wrangler vars. Use a Bluesky App Password, not the account's primary password.

## Setup

```bash
npm install

npx wrangler secret put ATPROTO_IDENTIFIER
npx wrangler secret put ATPROTO_APP_PASSWORD
npx wrangler secret put MCP_API_TOKEN
```

`ATPROTO_SERVICE` defaults to `https://bsky.social` in `wrangler.jsonc`. Change it if the account is hosted on another PDS.

Run locally:

```bash
npm run dev
```

Validate:

```bash
npm run check
npm run build
```

Deploy:

```bash
npm run deploy
```

Then configure an MCP client with:

- URL: `https://<worker-host>/mcp`
- Header: `Authorization: Bearer <MCP_API_TOKEN>`

Health check:

```text
GET https://<worker-host>/health
```

## Design

This server intentionally keeps the first slice stateless:

- no D1
- no KV
- no Durable Object
- a fresh AT Protocol password session per tool call
- no long-lived Bluesky access token persisted by the Worker

The AT Protocol integration uses the XRPC endpoints directly, keeping the Worker dependency surface small. The MCP transport uses Cloudflare Agents' current stateless handler and MCP SDK v2.

## Next slices

Likely additions:

- reply and quote-post tools
- image/blob upload with required alt text
- rich-text facets for links and mentions
- AT Protocol OAuth for multi-user deployments
- MCP OAuth instead of a static bearer token for clients that require OAuth discovery
