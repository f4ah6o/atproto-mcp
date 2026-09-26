import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPostWebUrl,
  normalizeServiceUrl,
  parsePostUri,
} from "../src/atproto";

test("parsePostUri parses Bluesky post URIs", () => {
  assert.deepEqual(
    parsePostUri("at://did:plc:abc/app.bsky.feed.post/3xyz"),
    { repo: "did:plc:abc", rkey: "3xyz" },
  );
});

test("parsePostUri rejects non-post collections", () => {
  assert.throws(
    () => parsePostUri("at://did:plc:abc/app.bsky.feed.like/3xyz"),
    /app\.bsky\.feed\.post/,
  );
});

test("buildPostWebUrl uses the authenticated handle", () => {
  assert.equal(
    buildPostWebUrl("example.bsky.social", "at://did:plc:abc/app.bsky.feed.post/3xyz"),
    "https://bsky.app/profile/example.bsky.social/post/3xyz",
  );
});

test("normalizeServiceUrl strips paths and trailing slashes", () => {
  assert.equal(
    normalizeServiceUrl("https://bsky.social/anything"),
    "https://bsky.social",
  );
});

test("normalizeServiceUrl rejects insecure remote services", () => {
  assert.throws(
    () => normalizeServiceUrl("http://example.com"),
    /must use https/,
  );
});

test("normalizeServiceUrl allows localhost over http for development", () => {
  assert.equal(
    normalizeServiceUrl("http://127.0.0.1:2583/x"),
    "http://127.0.0.1:2583",
  );
});
