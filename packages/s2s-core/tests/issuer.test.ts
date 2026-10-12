import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { CONFIG_DEFAULTS, ISSUER_ERRORS } from "../src/constants";
import { generateToken, type TokenIssuerConfig } from "../src/issuer";

describe("Issuer Utility - generateToken", () => {
	let privateKey: string;
	let publicKey: string;

	beforeAll(() => {
		const pair = crypto.generateKeyPairSync("rsa", {
			modulusLength: 2048,
			publicKeyEncoding: { type: "spki", format: "pem" },
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
		});
		privateKey = pair.privateKey;
		publicKey = pair.publicKey;
	});

	describe("Validation & Error Handling", () => {
		it("should throw when config is null or undefined", () => {
			expect(() =>
				generateToken("user-service", null as unknown as TokenIssuerConfig),
			).toThrow(ISSUER_ERRORS.CONFIG_REQUIRED);
		});

		it("should throw when privateKey is missing or empty", () => {
			expect(() =>
				generateToken("user-service", {
					serviceName: "order-service",
					privateKey: "",
				}),
			).toThrow(ISSUER_ERRORS.PRIVATE_KEY_REQUIRED);

			expect(() =>
				generateToken("user-service", {
					serviceName: "order-service",
					privateKey: "   ",
				}),
			).toThrow(ISSUER_ERRORS.PRIVATE_KEY_REQUIRED);
		});

		it("should throw when serviceName is missing or empty", () => {
			expect(() =>
				generateToken("user-service", { serviceName: "", privateKey }),
			).toThrow(ISSUER_ERRORS.SERVICE_NAME_REQUIRED);

			expect(() =>
				generateToken("user-service", { serviceName: "   ", privateKey }),
			).toThrow(ISSUER_ERRORS.SERVICE_NAME_REQUIRED);
		});

		it("should throw when targetAudience is missing or empty", () => {
			expect(() =>
				generateToken("", { serviceName: "order-service", privateKey }),
			).toThrow(ISSUER_ERRORS.TARGET_AUDIENCE_REQUIRED);

			expect(() =>
				generateToken("   ", { serviceName: "order-service", privateKey }),
			).toThrow(ISSUER_ERRORS.TARGET_AUDIENCE_REQUIRED);
		});

		it("should throw when signing fails due to an invalid private key", () => {
			expect(() =>
				generateToken("user-service", {
					serviceName: "order-service",
					privateKey:
						"-----BEGIN RSA PRIVATE KEY-----\nINVALID\n-----END RSA PRIVATE KEY-----",
				}),
			).toThrow(/Failed to sign token:/);
		});
	});

	describe("Token Generation & Claim Integrity", () => {
		it("should generate a valid RS256 token with default 15m expiration", () => {
			const targetAudience = "user-service";
			const serviceName = "order-service";

			const token = generateToken(targetAudience, {
				serviceName,
				privateKey,
			});

			expect(typeof token).toBe("string");
			expect(token.split(".").length).toBe(3);

			const decoded = jwt.verify(token, publicKey, {
				algorithms: [CONFIG_DEFAULTS.ALGORITHM],
				audience: targetAudience,
			}) as jwt.JwtPayload;

			expect(decoded.iss).toBe(serviceName);
			expect(decoded.sub).toBe(serviceName);
			expect(decoded.aud).toBe(targetAudience);
			expect(decoded.exp).toBeDefined();
			expect(decoded.iat).toBeDefined();

			const expectedExpirySeconds = 15 * 60;
			const actualLifetime = (decoded.exp ?? 0) - (decoded.iat ?? 0);
			expect(actualLifetime).toBe(expectedExpirySeconds);
		});

		it("should support custom expiration and algorithm passed via config", () => {
			const token = generateToken("restaurant-service", {
				serviceName: "queue-service",
				privateKey,
				expiresIn: "30m",
				algorithm: "RS256",
			});

			const decoded = jwt.verify(token, publicKey, {
				algorithms: ["RS256"],
				audience: "restaurant-service",
			}) as jwt.JwtPayload;

			expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(30 * 60);
		});

		it("should normalize escaped newlines in PEM private keys from env variables", () => {
			const keyWithEscapedNewlines = privateKey.replace(/\n/g, "\\n");

			const token = generateToken("user-service", {
				serviceName: "order-service",
				privateKey: keyWithEscapedNewlines,
			});

			expect(() =>
				jwt.verify(token, publicKey, {
					algorithms: ["RS256"],
					audience: "user-service",
				}),
			).not.toThrow();
		});
	});
});
