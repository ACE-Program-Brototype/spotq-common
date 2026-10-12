import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
	S2S_AUTH_ERRORS,
	S2S_ERROR_CODES,
	S2S_HTTP_STATUS,
	S2S_VERIFIER_ERRORS,
} from "../src/constants";
import { generateS2SToken } from "../src/issuer";
import { type S2SVerifierConfig, s2sAuthMiddleware } from "../src/middleware";

interface MockResponse {
	statusCode: number;
	body: unknown;
	status: jest.Mock;
	json: jest.Mock;
}

function createMockResponse(): MockResponse {
	const res: Partial<MockResponse> = {};
	res.status = jest.fn().mockImplementation((code: number) => {
		res.statusCode = code;
		return res;
	});
	res.json = jest.fn().mockImplementation((data: unknown) => {
		res.body = data;
		return res;
	});
	return res as MockResponse;
}

const pair1 = crypto.generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const privateKey = pair1.privateKey;
const publicKey = pair1.publicKey;

const pair2 = crypto.generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const otherPrivateKey = pair2.privateKey;

describe("S2S Auth Middleware - s2sAuthMiddleware", () => {
	let nextFn: NextFunction;

	beforeEach(() => {
		nextFn = jest.fn();
	});

	describe("Configuration Validation", () => {
		it("should throw when config is null or undefined", () => {
			expect(() =>
				s2sAuthMiddleware(null as unknown as S2SVerifierConfig),
			).toThrow(S2S_VERIFIER_ERRORS.CONFIG_REQUIRED);
		});

		it("should throw when publicKey is missing or empty", () => {
			expect(() =>
				s2sAuthMiddleware({ publicKey: "", expectedAudience: "user-service" }),
			).toThrow(S2S_VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);

			expect(() =>
				s2sAuthMiddleware({
					publicKey: "   ",
					expectedAudience: "user-service",
				}),
			).toThrow(S2S_VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		});

		it("should throw when expectedAudience is missing or empty", () => {
			expect(() =>
				s2sAuthMiddleware({ publicKey, expectedAudience: "" }),
			).toThrow(S2S_VERIFIER_ERRORS.EXPECTED_AUDIENCE_REQUIRED);

			expect(() =>
				s2sAuthMiddleware({ publicKey, expectedAudience: "   " }),
			).toThrow(S2S_VERIFIER_ERRORS.EXPECTED_AUDIENCE_REQUIRED);
		});
	});

	describe("Header Validation", () => {
		const middleware = s2sAuthMiddleware({
			publicKey,
			expectedAudience: "user-service",
		});

		it("should return 401 UNAUTHORIZED_S2S when Authorization header is missing", () => {
			const req = { headers: {} } as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(S2S_HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.UNAUTHORIZED_S2S,
				message: S2S_AUTH_ERRORS.MISSING_AUTH_HEADER,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 UNAUTHORIZED_S2S when Authorization header is not Bearer schema", () => {
			const req = {
				headers: { authorization: "Basic dXNlcjpwYXNz" },
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(S2S_HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.UNAUTHORIZED_S2S,
				message: S2S_AUTH_ERRORS.MALFORMED_AUTH_HEADER,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 UNAUTHORIZED_S2S when X-Caller-Service header is missing", () => {
			const token = generateS2SToken("user-service", {
				serviceName: "order-service",
				privateKey,
			});
			const req = {
				headers: { authorization: `Bearer ${token}` },
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(S2S_HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.UNAUTHORIZED_S2S,
				message: S2S_AUTH_ERRORS.MISSING_CALLER_HEADER,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});
	});

	describe("Cryptographic Verification & Claim Checks", () => {
		const middleware = s2sAuthMiddleware({
			publicKey,
			expectedAudience: "user-service",
		});

		it("should return 401 INVALID_S2S_TOKEN when token signature is invalid", () => {
			// Sign with a different private key
			const forgedToken = generateS2SToken("user-service", {
				serviceName: "order-service",
				privateKey: otherPrivateKey,
			});

			const req = {
				headers: {
					authorization: `Bearer ${forgedToken}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(S2S_HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toMatchObject({
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.INVALID_S2S_TOKEN,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 INVALID_S2S_TOKEN when token has expired", () => {
			const expiredToken = generateS2SToken("user-service", {
				serviceName: "order-service",
				privateKey,
				expiresIn: -1, // Expired immediately
			});

			const req = {
				headers: {
					authorization: `Bearer ${expiredToken}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(S2S_HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toMatchObject({
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.INVALID_S2S_TOKEN,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 INVALID_S2S_TOKEN when target audience does not match expectedAudience", () => {
			// Mint token intended for 'restaurant-service'
			const tokenForRestaurant = generateS2SToken("restaurant-service", {
				serviceName: "order-service",
				privateKey,
			});

			const req = {
				headers: {
					authorization: `Bearer ${tokenForRestaurant}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(S2S_HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toMatchObject({
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.INVALID_S2S_TOKEN,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 INVALID_S2S_TOKEN when X-Caller-Service does not match token issuer", () => {
			const token = generateS2SToken("user-service", {
				serviceName: "order-service",
				privateKey,
			});

			const req = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-caller-service": "imposter-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(S2S_HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.INVALID_S2S_TOKEN,
				message: S2S_AUTH_ERRORS.CALLER_MISMATCH(
					"imposter-service",
					"order-service",
				),
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});
	});

	describe("Successful Authentication", () => {
		it("should successfully verify request and populate req.callerService", () => {
			const middleware = s2sAuthMiddleware({
				publicKey,
				expectedAudience: "user-service",
			});

			const token = generateS2SToken("user-service", {
				serviceName: "order-service",
				privateKey,
			});

			const req = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("order-service");
		});

		it("should support custom algorithms when configured in verifier", () => {
			const middleware = s2sAuthMiddleware({
				publicKey,
				expectedAudience: "user-service",
				algorithms: ["RS384"],
			});

			const token = generateS2SToken("user-service", {
				serviceName: "restaurant-service",
				privateKey,
				algorithm: "RS384",
			});

			const req = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-caller-service": "restaurant-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("restaurant-service");
		});
	});
});
