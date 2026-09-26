# atproto-mcp

A small Remote MCP server for posting to Bluesky / AT Protocol from Cloudflare Workers.

## Current tools

- `account_status` — verifies the configured account and returns its DID/handle.
- `post_create` — creates an `app.bsky.feed.post` record.
- `post_delete` — deletes a post created by the configured account using its `at://` URI.

The MCP endpoint is `/mcp` and uses Streamable HTTP through Cloudflare's stateless `createMcpHandler`.

## Authentication

The production setup intentionally follows the same model as `f4ah6o/temote-mcp`:

1. put the Worker behind a Cloudflare Access self-hosted application,
2. enable **Managed OAuth** for MCP clients such as ChatGPT,
3. the Worker independently verifies the `cf-access-jwt-assertion` signature, issuer, audience, expiry, and allowed email.

The Worker accepts `MCP_API_TOKEN` as a direct Bearer-token fallback for development/manual clients, analogous to Temote's direct client-token path. Cloudflare Access remains the recommended ChatGPT path.

Configure these Worker variables:

- `ACCESS_TEAM_DOMAIN` — for example `your-team.cloudflareaccess.com`
- `ACCESS_AUDIENCE` — the Access application's AUD tag
- `ACCESS_ALLOWED_EMAILS` — comma-separated email allowlist

`keep_vars: true` is enabled in `wrangler.jsonc` so values configured in the Cloudflare dashboard survive Git-connected Wrangler deploys.

## Bluesky secrets

Bluesky credentials are never stored in source or Wrangler vars. Use a Bluesky App Password, not the account's primary password.

```bash
npx wrangler secret put ATPROTO_IDENTIFIER
npx wrangler secret put ATPROTO_APP_PASSWORD
npx wrangler secret put MCP_API_TOKEN
```

`MCP_API_TOKEN` is optional when all clients go through Cloudflare Access.

`ATPROTO_SERVICE` defaults to `https://bsky.social`.

## Cloudflare / ChatGPT setup

Use a hostname you control, for example:

```text
https://atproto-mcp.f12o.com/mcp
```

In Cloudflare Zero Trust:

1. Access → Applications → add a **Self-hosted** application for the Worker hostname.
2. Add an Allow policy for your identity/email.
3. Enable **Managed OAuth** for the application.
4. Copy the application AUD tag into `ACCESS_AUDIENCE`.
5. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_ALLOWED_EMAILS` on the Worker.

Then add the MCP URL in ChatGPT. Cloudflare Access performs the OAuth exchange; after authorization, Access injects the signed assertion that this Worker verifies.

A bare `workers.dev` URL is useful for initial deployment/testing, but the Access setup should use the dedicated hostname protected by your Access application.

## Development

```bash
npm install
npm run check
npm run build
npm run deploy
```

Health check:

```text
GET https://<worker-host>/health
```

## Design

- no D1
- no KV
- no Durable Object
- a fresh AT Protocol password session per tool call
- no long-lived Bluesky access token persisted by the Worker
- AT Protocol XRPC calls directly, keeping the dependency surface small
- Cloudflare Access JWT validation mirrors the security boundary used by Temote's gateway
