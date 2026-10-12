import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { S2S_CONFIG_DEFAULTS, S2S_ISSUER_ERRORS } from "../src/constants";
import { generateS2SToken, type S2SIssuerConfig } from "../src/issuer";

describe("S2S Issuer Utility - generateS2SToken", () => {
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
				generateS2SToken("user-service", null as unknown as S2SIssuerConfig),
			).toThrow(S2S_ISSUER_ERRORS.CONFIG_REQUIRED);
		});

		it("should throw when privateKey is missing or empty", () => {
			expect(() =>
				generateS2SToken("user-service", {
					serviceName: "order-service",
					privateKey: "",
				}),
			).toThrow(S2S_ISSUER_ERRORS.PRIVATE_KEY_REQUIRED);

			expect(() =>
				generateS2SToken("user-service", {
					serviceName: "order-service",
					privateKey: "   ",
				}),
			).toThrow(S2S_ISSUER_ERRORS.PRIVATE_KEY_REQUIRED);
		});

		it("should throw when serviceName is missing or empty", () => {
			expect(() =>
				generateS2SToken("user-service", { serviceName: "", privateKey }),
			).toThrow(S2S_ISSUER_ERRORS.SERVICE_NAME_REQUIRED);

			expect(() =>
				generateS2SToken("user-service", { serviceName: "   ", privateKey }),
			).toThrow(S2S_ISSUER_ERRORS.SERVICE_NAME_REQUIRED);
		});

		it("should throw when targetAudience is missing or empty", () => {
			expect(() =>
				generateS2SToken("", { serviceName: "order-service", privateKey }),
			).toThrow(S2S_ISSUER_ERRORS.TARGET_AUDIENCE_REQUIRED);

			expect(() =>
				generateS2SToken("   ", { serviceName: "order-service", privateKey }),
			).toThrow(S2S_ISSUER_ERRORS.TARGET_AUDIENCE_REQUIRED);
		});

		it("should throw when signing fails due to an invalid private key", () => {
			expect(() =>
				generateS2SToken("user-service", {
					serviceName: "order-service",
					privateKey:
						"-----BEGIN RSA PRIVATE KEY-----\nINVALID\n-----END RSA PRIVATE KEY-----",
				}),
			).toThrow(/S2S Issuer Error: Failed to sign token:/);
		});
	});

	describe("Token Generation & Claim Integrity", () => {
		it("should generate a valid RS256 token with default 15m expiration", () => {
			const config: S2SIssuerConfig = {
				serviceName: "order-service",
				privateKey,
			};

			const token = generateS2SToken("user-service", config);
			expect(typeof token).toBe("string");
			expect(token.split(".").length).toBe(3);

			// Verify and decode using public key
			const decoded = jwt.verify(token, publicKey, {
				algorithms: ["RS256"],
				audience: "user-service",
			}) as jwt.JwtPayload;

			expect(decoded.iss).toBe("order-service");
			expect(decoded.sub).toBe("order-service");
			expect(decoded.aud).toBe("user-service");

			// Default expiration should be ~15 minutes (900 seconds)
			const lifespan = (decoded.exp ?? 0) - (decoded.iat ?? 0);
			expect(lifespan).toBe(900);
		});

		it("should support custom expiration and algorithm passed via config", () => {
			const config: S2SIssuerConfig = {
				serviceName: "order-service",
				privateKey,
				algorithm: "RS384",
				expiresIn: "30m",
			};

			const token = generateS2SToken("restaurant-service", config);
			const decodedHeader = jwt.decode(token, { complete: true });
			expect(decodedHeader?.header.alg).toBe("RS384");

			const verified = jwt.verify(token, publicKey, {
				algorithms: ["RS384"],
				audience: "restaurant-service",
			}) as jwt.JwtPayload;

			const lifespan = (verified.exp ?? 0) - (verified.iat ?? 0);
			expect(lifespan).toBe(1800);
		});

		it("should normalize escaped newlines in PEM private keys from env variables", () => {
			// Emulate multiline secret stored in .env with escaped newlines
			const escapedKey = privateKey.replace(/\n/g, "\\n");

			const token = generateS2SToken("user-service", {
				serviceName: "order-service",
				privateKey: escapedKey,
			});

			const decoded = jwt.verify(token, publicKey, {
				algorithms: [S2S_CONFIG_DEFAULTS.ALGORITHM],
				audience: "user-service",
			}) as jwt.JwtPayload;

			expect(decoded.iss).toBe("order-service");
		});
	});
});
