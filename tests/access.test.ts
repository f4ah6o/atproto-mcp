import assert from "node:assert/strict";
import test from "node:test";

import {
  accessEmailAllowed,
  accessKidAllowed,
  normalizeAccessTeamDomain,
  validateAccessJwtShape,
} from "../src/access";

test("normalizes Cloudflare Access team domain", () => {
  assert.equal(
    normalizeAccessTeamDomain("example.cloudflareaccess.com"),
    "https://example.cloudflareaccess.com",
  );
  assert.equal(
    normalizeAccessTeamDomain("https://example.cloudflareaccess.com/"),
    "https://example.cloudflareaccess.com",
  );
});

test("rejects Access team domain paths", () => {
  assert.throws(
    () => normalizeAccessTeamDomain("https://example.cloudflareaccess.com/path"),
    /without a path/,
  );
});

test("matches allowed email case-insensitively", () => {
  assert.equal(
    accessEmailAllowed("one@example.com, Two@Example.com", "two@example.com"),
    true,
  );
  assert.equal(accessEmailAllowed("", "two@example.com"), false);
});

test("validates JWT shape before cryptographic verification", () => {
  assert.deepEqual(validateAccessJwtShape("aaa.bbb.ccc"), ["aaa", "bbb", "ccc"]);
  assert.throws(() => validateAccessJwtShape("aaa.bbb"), /invalid JWT/);
  assert.throws(() => validateAccessJwtShape("aaa.bb!.ccc"), /invalid JWT segment/);
});

test("bounds JWT key ids", () => {
  assert.equal(accessKidAllowed("kid-1"), true);
  assert.equal(accessKidAllowed(""), false);
  assert.equal(accessKidAllowed("x".repeat(257)), false);
});
