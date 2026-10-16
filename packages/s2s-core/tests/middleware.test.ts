import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
	AUTH_ERRORS,
	ERROR_CODES,
	HTTP_STATUS,
	type SupportedAlgorithm,
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

		it("should throw when publicKeys is an empty object", () => {
			expect(() =>
				authMiddleware({ publicKeys: {}, expectedAudience: "user-service" }),
			).toThrow(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		});

		it("should throw when algorithms list is empty", () => {
			expect(() =>
				authMiddleware({
					publicKey,
					expectedAudience: "user-service",
					algorithms: [],
				}),
			).toThrow(VERIFIER_ERRORS.EMPTY_ALGORITHMS);
		});

		it("should throw when algorithms contains symmetric or none algorithms", () => {
			expect(() =>
				authMiddleware({
					publicKey,
					expectedAudience: "user-service",
					algorithms: ["HS256" as unknown as SupportedAlgorithm],
				}),
			).toThrow(VERIFIER_ERRORS.INVALID_ALGORITHM("HS256"));

			expect(() =>
				authMiddleware({
					publicKey,
					expectedAudience: "user-service",
					algorithms: ["none" as unknown as SupportedAlgorithm],
				}),
			).toThrow(VERIFIER_ERRORS.INVALID_ALGORITHM("none"));
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

		it("should fallback to decoded.sub when decoded.iss is an empty string", () => {
			const tokenWithEmptyIss = jwt.sign(
				{ iss: "", sub: "order-service", aud: "user-service" },
				privateKey,
				{ algorithm: "RS256", expiresIn: "15m" },
			);

			const req = {
				headers: {
					authorization: `Bearer ${tokenWithEmptyIss}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("order-service");
		});

		it("should fallback to decoded.sub when decoded.iss is whitespace-only", () => {
			const tokenWithWhitespaceIss = jwt.sign(
				{ iss: "   ", sub: "order-service", aud: "user-service" },
				privateKey,
				{ algorithm: "RS256", expiresIn: "15m" },
			);

			const req = {
				headers: {
					authorization: `Bearer ${tokenWithWhitespaceIss}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("order-service");
		});

		it("should return 401 INVALID_TOKEN when both iss and sub are empty strings", () => {
			const tokenEmptyIssSub = jwt.sign(
				{ iss: "", sub: "", aud: "user-service" },
				privateKey,
				{ algorithm: "RS256", expiresIn: "15m" },
			);

			const req = {
				headers: {
					authorization: `Bearer ${tokenEmptyIssSub}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.INVALID_TOKEN,
				message: AUTH_ERRORS.CALLER_MISMATCH("order-service", ""),
				retryable: false,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should return 401 UNAUTHORIZED when caller service has no configured public key", () => {
			const multiKeyMiddleware = authMiddleware({
				expectedAudience: "user-service",
				publicKeys: {
					"order-service": publicKey,
				},
			});

			const token = generateToken("user-service", {
				serviceName: "restaurant-service",
				privateKey,
			});

			const req = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-caller-service": "restaurant-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			multiKeyMiddleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toEqual({
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.PUBLIC_KEY_NOT_FOUND("restaurant-service"),
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

		it("should tolerate leading whitespace and multiple spaces in Bearer token header", () => {
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
					authorization: `   Bearer    ${token}   `,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("order-service");
		});

		it("should trim surrounding whitespace from X-Caller-Service header", () => {
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
					"x-caller-service": "   order-service   ",
				},
			} as unknown as Request;
			const res = createMockResponse();

			middleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("order-service");
		});
	});

	describe("Per-Service Asymmetric Key Verification", () => {
		const orderKeyPair = pair1;
		const restaurantKeyPair = pair2;

		const multiServiceMiddleware = authMiddleware({
			expectedAudience: "user-service",
			publicKeys: {
				"order-service": orderKeyPair.publicKey,
				"restaurant-service": restaurantKeyPair.publicKey,
			},
		});

		it("should verify requests from multiple caller services using their respective public keys", () => {
			// 1. Request from order-service signed with order-service private key
			const orderToken = generateToken("user-service", {
				serviceName: "order-service",
				privateKey: orderKeyPair.privateKey,
			});
			const orderReq = {
				headers: {
					authorization: `Bearer ${orderToken}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const orderRes = createMockResponse();
			multiServiceMiddleware(orderReq, orderRes as unknown as Response, nextFn);
			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(orderReq.callerService).toBe("order-service");

			// 2. Request from restaurant-service signed with restaurant-service private key
			const restaurantToken = generateToken("user-service", {
				serviceName: "restaurant-service",
				privateKey: restaurantKeyPair.privateKey,
			});
			const restaurantReq = {
				headers: {
					authorization: `Bearer ${restaurantToken}`,
					"x-caller-service": "restaurant-service",
				},
			} as unknown as Request;
			const restaurantRes = createMockResponse();
			multiServiceMiddleware(
				restaurantReq,
				restaurantRes as unknown as Response,
				nextFn,
			);
			expect(nextFn).toHaveBeenCalledTimes(2);
			expect(restaurantReq.callerService).toBe("restaurant-service");
		});

		it("should reject when service A signs token but X-Caller-Service claims service B", () => {
			// Token signed by restaurant-service, but header claims order-service
			const imposterToken = generateToken("user-service", {
				serviceName: "order-service",
				privateKey: restaurantKeyPair.privateKey, // Signed with restaurant's key!
			});
			const req = {
				headers: {
					authorization: `Bearer ${imposterToken}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			multiServiceMiddleware(req, res as unknown as Response, nextFn);

			expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
			expect(res.body).toMatchObject({
				code: ERROR_CODES.INVALID_TOKEN,
			});
			expect(nextFn).not.toHaveBeenCalled();
		});

		it("should support dynamic getPublicKey resolver", () => {
			const dynamicMiddleware = authMiddleware({
				expectedAudience: "user-service",
				getPublicKey: (caller) => {
					if (caller === "order-service") return orderKeyPair.publicKey;
					return undefined;
				},
			});

			const token = generateToken("user-service", {
				serviceName: "order-service",
				privateKey: orderKeyPair.privateKey,
			});
			const req = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			dynamicMiddleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("order-service");
		});

		it("should support publicKey provided as an object mapping", () => {
			const mapMiddleware = authMiddleware({
				expectedAudience: "user-service",
				publicKey: {
					"order-service": orderKeyPair.publicKey,
				},
			});

			const token = generateToken("user-service", {
				serviceName: "order-service",
				privateKey: orderKeyPair.privateKey,
			});
			const req = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-caller-service": "order-service",
				},
			} as unknown as Request;
			const res = createMockResponse();

			mapMiddleware(req, res as unknown as Response, nextFn);

			expect(nextFn).toHaveBeenCalledTimes(1);
			expect(req.callerService).toBe("order-service");
		});
	});
});
