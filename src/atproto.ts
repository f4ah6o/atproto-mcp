export interface AtprotoCredentials {
  identifier: string;
  appPassword: string;
  service?: string;
}

export interface AtprotoSession {
  accessJwt: string;
  did: string;
  handle: string;
}

export interface CreatedPost {
  uri: string;
  cid: string;
  url: string;
}

interface XrpcErrorBody {
  error?: string;
  message?: string;
}

interface CreateRecordResponse {
  uri: string;
  cid: string;
}

export class AtprotoError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AtprotoError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeServiceUrl(service = "https://bsky.social"): string {
  const url = new URL(service);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
    throw new Error("ATPROTO_SERVICE must use https (http is allowed only for localhost)");
  }
  return url.origin;
}

export function parsePostUri(uri: string): { repo: string; rkey: string } {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(uri);
  if (!match) {
    throw new Error("Expected an app.bsky.feed.post AT URI");
  }
  return { repo: match[1], rkey: match[2] };
}

export function buildPostWebUrl(handle: string, uri: string): string {
  const { rkey } = parsePostUri(uri);
  return `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`;
}

export async function createSession(credentials: AtprotoCredentials): Promise<AtprotoSession> {
  return xrpcPost<AtprotoSession>(
    credentials,
    "com.atproto.server.createSession",
    {
      identifier: credentials.identifier,
      password: credentials.appPassword,
    },
  );
}

export async function createPost(
  credentials: AtprotoCredentials,
  input: { text: string; langs?: string[] },
): Promise<CreatedPost> {
  const session = await createSession(credentials);
  const createdAt = new Date().toISOString();

  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: input.text,
    createdAt,
  };
  if (input.langs?.length) {
    record.langs = input.langs;
  }

  const result = await xrpcPost<CreateRecordResponse>(
    credentials,
    "com.atproto.repo.createRecord",
    {
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    },
    session.accessJwt,
  );

  return {
    ...result,
    url: buildPostWebUrl(session.handle, result.uri),
  };
}

export async function deletePost(
  credentials: AtprotoCredentials,
  uri: string,
): Promise<{ uri: string; deleted: true }> {
  const parsed = parsePostUri(uri);
  const session = await createSession(credentials);

  if (parsed.repo !== session.did) {
    throw new Error("Refusing to delete a post that is not owned by the configured account");
  }

  await xrpcPost<unknown>(
    credentials,
    "com.atproto.repo.deleteRecord",
    {
      repo: session.did,
      collection: "app.bsky.feed.post",
      rkey: parsed.rkey,
    },
    session.accessJwt,
  );

  return { uri, deleted: true };
}

async function xrpcPost<T>(
  credentials: AtprotoCredentials,
  nsid: string,
  body: unknown,
  accessJwt?: string,
): Promise<T> {
  const base = normalizeServiceUrl(credentials.service);
  const headers = new Headers({ "content-type": "application/json" });
  if (accessJwt) {
    headers.set("authorization", `Bearer ${accessJwt}`);
  }

  const response = await fetch(`${base}/xrpc/${nsid}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    const parsed = parseErrorBody(raw);
    throw new AtprotoError(
      parsed.message ?? parsed.error ?? `AT Protocol request failed with HTTP ${response.status}`,
      response.status,
      parsed.error,
    );
  }

  if (!raw) {
    return undefined as T;
  }

  return JSON.parse(raw) as T;
}

function parseErrorBody(raw: string): XrpcErrorBody {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as XrpcErrorBody;
  } catch {
    return { message: raw.slice(0, 500) };
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
