import { normalizePemKey } from "../src/utils";

describe("S2S Utilities - normalizePemKey", () => {
	it("should trim surrounding whitespace from a key", () => {
		const rawKey =
			"   -----BEGIN PUBLIC KEY-----\nMIIB...-----END PUBLIC KEY-----   ";
		expect(normalizePemKey(rawKey)).toBe(
			"-----BEGIN PUBLIC KEY-----\nMIIB...-----END PUBLIC KEY-----",
		);
	});

	it("should replace literal escaped newlines with actual line breaks", () => {
		const escapedKey =
			"-----BEGIN RSA PRIVATE KEY-----\\nMIIE...\\n-----END RSA PRIVATE KEY-----";
		const expectedKey =
			"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
		expect(normalizePemKey(escapedKey)).toBe(expectedKey);
	});

	it("should leave normal multiline keys with actual line breaks untouched", () => {
		const multilineKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y
-----END RSA PRIVATE KEY-----`;
		expect(normalizePemKey(multilineKey)).toBe(multilineKey);
	});
});
