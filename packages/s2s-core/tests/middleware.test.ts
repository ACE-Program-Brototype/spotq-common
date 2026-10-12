import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
	AUTH_ERRORS,
	ERROR_CODES,
	HTTP_STATUS,
	VERIFIER_ERRORS,
} from "../src/constants";
import { generateToken } from "../src/issuer";
import { authMiddleware, type TokenVerifierConfig } from "../src/middleware";

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

describe("Auth Middleware - authMiddleware", () => {
	let nextFn: NextFunction;

	beforeEach(() => {
		nextFn = jest.fn();
	});

	describe("Configuration Validation", () => {
		it("should throw when config is null or undefined", () => {
			expect(() =>
				authMiddleware(null as unknown as TokenVerifierConfig),
			).toThrow(VERIFIER_ERRORS.CONFIG_REQUIRED);
		});

		it("should throw when publicKey is missing or empty", () => {
			expect(() =>
				authMiddleware({ publicKey: "", expectedAudience: "user-service" }),
			).toThrow(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);

			expect(() =>
				authMiddleware({
					publicKey: "   ",
					expectedAudience: "user-service",
				}),
			).toThrow(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		});

		it("should throw when expectedAudience is missing or empty", () => {
			expect(() => authMiddleware({ publicKey, expectedAudience: "" })).toThrow(
				VERIFIER_ERRORS.EXPECTED_AUDIENCE_REQUIRED,
			);

			expect(() =>
				authMiddleware({ publicKey, expectedAudience: "   " }),
			).toThrow(VERIFIER_ERRORS.EXPECTED_AUDIENCE_REQUIRED);
		});
	});

	describe("Header Validation", () => {
		const middleware = authMiddleware({
			publicKey,
			expectedAudience: "user-service",
		});

		it("should return 401 UNAUTHORIZED when Authorization header is missing", () => {
			const req = { headers: {} } as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.MISSING_AUTH_HEADER,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 UNAUTHORIZED when Authorization header is not Bearer schema", () => {
			const req = {
				headers: { authorization: "Basic dXNlcjpwYXNz" },
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.MALFORMED_AUTH_HEADER,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 UNAUTHORIZED when X-Caller-Service header is missing", () => {
			const token = generateToken("user-service", {
				serviceName: "order-service",
				privateKey,
			});
			const req = {
				headers: { authorization: `Bearer ${token}` },
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.MISSING_CALLER_HEADER,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});
	});

	describe("Cryptographic Verification & Claim Checks", () => {
		const middleware = authMiddleware({
			publicKey,
			expectedAudience: "user-service",
		});

		it("should return 401 INVALID_TOKEN when token signature is invalid", () => {
			// Sign with a different private key
			const forgedToken = generateToken("user-service", {
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

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toMatchObject({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.INVALID_TOKEN,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 INVALID_TOKEN when token has expired", () => {
			const expiredToken = generateToken("user-service", {
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

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toMatchObject({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.INVALID_TOKEN,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 INVALID_TOKEN when target audience does not match expectedAudience", () => {
			// Mint token intended for 'restaurant-service'
			const tokenForRestaurant = generateToken("restaurant-service", {
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

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toMatchObject({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.INVALID_TOKEN,
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 INVALID_TOKEN when X-Caller-Service does not match token issuer", () => {
			const token = generateToken("user-service", {
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

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.INVALID_TOKEN,
				message: AUTH_ERRORS.CALLER_MISMATCH(
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
			const middleware = authMiddleware({
				publicKey,
				expectedAudience: "user-service",
			});

			const token = generateToken("user-service", {
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
			const middleware = authMiddleware({
				publicKey,
				expectedAudience: "user-service",
				algorithms: ["RS384"],
			});

			const token = generateToken("user-service", {
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
