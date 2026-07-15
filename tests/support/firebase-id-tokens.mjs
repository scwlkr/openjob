function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function generateSigningKey(kid) {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: { ...publicKey, alg: "RS256", kid, use: "sig" },
  };
}

export async function createTestFirebaseAuthority({
  now = "2026-07-15T12:00:00.000Z",
  projectId = "openjob-dev",
} = {}) {
  const trusted = await generateSigningKey("trusted-test-key");
  const rogue = await generateSigningKey("rogue-test-key");
  const keyRequests = [];
  const nowSeconds = Math.floor(Date.parse(now) / 1000);

  return Object.freeze({
    keyRequests,
    async issue({ claims = {}, header = {}, signer = "trusted", uid }) {
      const protectedHeader = {
        alg: "RS256",
        kid: "trusted-test-key",
        typ: "JWT",
        ...header,
      };
      const payload = {
        aud: projectId,
        auth_time: nowSeconds - 60,
        email: `${uid || "empty"}@example.test`,
        exp: nowSeconds + 3600,
        firebase: { sign_in_provider: "google.com" },
        iat: nowSeconds - 60,
        iss: `https://securetoken.google.com/${projectId}`,
        name: "Ignored Google Name",
        sub: uid,
        user_id: uid,
        ...claims,
      };
      const encodedHeader = base64Url(JSON.stringify(protectedHeader));
      const encodedPayload = base64Url(JSON.stringify(payload));
      const input = `${encodedHeader}.${encodedPayload}`;
      const key = signer === "rogue" ? rogue.privateKey : trusted.privateKey;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(input),
      );
      return `${input}.${base64Url(signature)}`;
    },
    async fetch(input, init = {}) {
      keyRequests.push({
        headers: Object.fromEntries(new Headers(init.headers)),
        url: String(input),
      });
      return Response.json(
        { keys: [trusted.publicKey] },
        { headers: { "cache-control": "public, max-age=3600" } },
      );
    },
  });
}
