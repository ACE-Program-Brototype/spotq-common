import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, { type JwtPayload, type VerifyOptions } from "jsonwebtoken";
import {
	AUTH_ERRORS,
	type AuthErrorCode,
	BEARER_TOKEN_REGEX,
	CONFIG_DEFAULTS,
	ERROR_CODES,
	HEADERS,
	HTTP_STATUS,
	SUPPORTED_ASYMMETRIC_ALGORITHMS,
	type SupportedAlgorithm,
	VERIFIER_ERRORS,
} from "./constants";
import { normalizePemKey } from "./utils";

/**
 * Ambient type augmentation for Express Request to append the verified calling service name.
 */
declare global {
	namespace Express {
		interface Request {
			callerService: string;
		}
	}
}

/**
 * Standardized machine-readable error payload returned on authentication failure.
 */
export interface AuthErrorResponse {
	success: false;
	statusCode: typeof HTTP_STATUS.UNAUTHORIZED;
	code: AuthErrorCode;
	message: string;
	retryable: false;
}

/**
 * Dynamic resolver function to look up an RSA Public Key based on caller service identity.
 */
export type PublicKeyResolver = (
	callerService: string,
) => string | undefined | null;

/**
 * Configuration contract for token verification.
 * Supports a single public key, a map of per-service public keys, or a dynamic key resolver.
 * Adheres strictly to stateless design principles (no process.env references).
 */
export interface TokenVerifierConfig {
	/**
	 * RSA Public Key in PEM format used for signature verification,
	 * a key map of service names to public keys, or a dynamic key resolver.
	 */
	publicKey?: string | Record<string, string> | PublicKeyResolver;

	/**
	 * Map of caller service names to their respective RSA Public Keys in PEM format.
	 * Enables per-service asymmetric key verification when multiple microservices invoke this service.
	 */
	publicKeys?: Record<string, string>;

	/**
	 * Dynamic resolver function returning the RSA Public Key for a given caller service.
	 */
	getPublicKey?: PublicKeyResolver;

	/**
	 * Expected audience identifier matching this recipient service (e.g., 'user-service').
	 */
	expectedAudience: string;

	/**
	 * Permitted asymmetric cryptographic algorithms for verification.
	 * Only asymmetric algorithms (RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512) are permitted.
	 * Defaults to ['RS256'].
	 */
	algorithms?: SupportedAlgorithm[];
}

/**
 * Decoded payload shape for JWTs.
 */
export interface TokenPayload extends JwtPayload {
	iss?: string;
	sub?: string;
	aud?: string | string[];
}

/**
 * Express middleware factory that enforces Service-to-Service authentication
 * using asymmetric RS256 JWT validation and caller identity header verification.
 *
 * @param config - Configuration containing public keys and expected audience.
 * @returns An Express RequestHandler middleware function.
 */
export function authMiddleware(config: TokenVerifierConfig): RequestHandler {
	if (!config) {
		throw new Error(VERIFIER_ERRORS.CONFIG_REQUIRED);
	}

	if (
		!config.expectedAudience ||
		typeof config.expectedAudience !== "string" ||
		!config.expectedAudience.trim()
	) {
		throw new Error(VERIFIER_ERRORS.EXPECTED_AUDIENCE_REQUIRED);
	}

	if (config.algorithms !== undefined) {
		if (!Array.isArray(config.algorithms) || config.algorithms.length === 0) {
			throw new Error(VERIFIER_ERRORS.EMPTY_ALGORITHMS);
		}
		for (const alg of config.algorithms) {
			if (!SUPPORTED_ASYMMETRIC_ALGORITHMS.includes(alg)) {
				throw new Error(VERIFIER_ERRORS.INVALID_ALGORITHM(String(alg)));
			}
		}
	}

	let staticPublicKey: string | undefined;
	let publicKeysMap: Record<string, string> | undefined;
	let resolverFn: PublicKeyResolver | undefined;

	if (typeof config.getPublicKey === "function") {
		resolverFn = config.getPublicKey;
	}

	if (typeof config.publicKey === "function") {
		resolverFn = config.publicKey as PublicKeyResolver;
	} else if (typeof config.publicKey === "string") {
		if (config.publicKey.trim()) {
			staticPublicKey = normalizePemKey(config.publicKey);
		} else {
			throw new Error(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		}
	} else if (config.publicKey && typeof config.publicKey === "object") {
		const entries = Object.entries(config.publicKey);
		if (entries.length === 0) {
			throw new Error(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		}
		publicKeysMap = {};
		for (const [svc, key] of entries) {
			if (typeof key === "string" && key.trim()) {
				publicKeysMap[svc.trim()] = normalizePemKey(key);
			}
		}
		if (Object.keys(publicKeysMap).length === 0) {
			throw new Error(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		}
	}

	if (config.publicKeys && typeof config.publicKeys === "object") {
		const entries = Object.entries(config.publicKeys);
		if (entries.length === 0) {
			throw new Error(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		}
		if (!publicKeysMap) {
			publicKeysMap = {};
		}
		for (const [svc, key] of entries) {
			if (typeof key === "string" && key.trim()) {
				publicKeysMap[svc.trim()] = normalizePemKey(key);
			}
		}
		if (Object.keys(publicKeysMap).length === 0) {
			throw new Error(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
		}
	}

	if (!staticPublicKey && !publicKeysMap && !resolverFn) {
		throw new Error(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
	}

	const expectedAudience = config.expectedAudience.trim();
	const permittedAlgorithms = config.algorithms ?? [CONFIG_DEFAULTS.ALGORITHM];

	return (req: Request, res: Response, next: NextFunction): void => {
		// 1. Extract Authorization header
		const rawAuthHeader = req.headers[HEADERS.AUTHORIZATION];
		const authHeader = Array.isArray(rawAuthHeader)
			? rawAuthHeader[0]
			: rawAuthHeader;

		if (!authHeader) {
			const errorPayload: AuthErrorResponse = {
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.MISSING_AUTH_HEADER,
				retryable: false,
			};
			res.status(HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		const authMatch = authHeader.match(BEARER_TOKEN_REGEX);
		if (!authMatch) {
			const errorPayload: AuthErrorResponse = {
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.MALFORMED_AUTH_HEADER,
				retryable: false,
			};
			res.status(HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		const token = authMatch[1];

		// 2. Extract X-Caller-Service header
		const rawCallerHeader = req.headers[HEADERS.CALLER_SERVICE];
		const rawCaller = Array.isArray(rawCallerHeader)
			? rawCallerHeader[0]
			: rawCallerHeader;
		const callerService = rawCaller?.trim();

		if (!callerService) {
			const errorPayload: AuthErrorResponse = {
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.MISSING_CALLER_HEADER,
				retryable: false,
			};
			res.status(HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 3. Resolve caller-specific public key
		let callerPublicKey: string | undefined;

		if (resolverFn) {
			const resolved = resolverFn(callerService);
			if (resolved && typeof resolved === "string" && resolved.trim()) {
				callerPublicKey = normalizePemKey(resolved);
			}
		}

		if (!callerPublicKey && publicKeysMap) {
			callerPublicKey = publicKeysMap[callerService];
		}

		if (!callerPublicKey && staticPublicKey) {
			callerPublicKey = staticPublicKey;
		}

		if (!callerPublicKey) {
			const errorPayload: AuthErrorResponse = {
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.UNAUTHORIZED,
				message: AUTH_ERRORS.PUBLIC_KEY_NOT_FOUND(callerService),
				retryable: false,
			};
			res.status(HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 4. Cryptographically verify token and validate claims
		const verifyOptions: VerifyOptions = {
			algorithms: permittedAlgorithms,
			audience: expectedAudience,
		};

		let decoded: TokenPayload;
		try {
			const verified = jwt.verify(token, callerPublicKey, verifyOptions);
			if (typeof verified === "string" || !verified) {
				const errorPayload: AuthErrorResponse = {
					success: false,
					statusCode: HTTP_STATUS.UNAUTHORIZED,
					code: ERROR_CODES.INVALID_TOKEN,
					message: AUTH_ERRORS.INVALID_PAYLOAD,
					retryable: false,
				};
				res.status(HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
				return;
			}
			decoded = verified as TokenPayload;
		} catch (err: unknown) {
			const errorMessage =
				err instanceof Error
					? err.message
					: AUTH_ERRORS.UNKNOWN_VERIFICATION_ERROR;
			const errorPayload: AuthErrorResponse = {
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.INVALID_TOKEN,
				message: AUTH_ERRORS.TOKEN_VERIFICATION_FAILED(errorMessage),
				retryable: false,
			};
			res.status(HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 5. Verify that caller identity matches token claims (iss / sub)
		const iss = typeof decoded.iss === "string" ? decoded.iss.trim() : "";
		const sub = typeof decoded.sub === "string" ? decoded.sub.trim() : "";
		const tokenIssuer = iss.length > 0 ? iss : sub;

		if (!tokenIssuer || tokenIssuer !== callerService) {
			const errorPayload: AuthErrorResponse = {
				success: false,
				statusCode: HTTP_STATUS.UNAUTHORIZED,
				code: ERROR_CODES.INVALID_TOKEN,
				message: AUTH_ERRORS.CALLER_MISMATCH(callerService, tokenIssuer),
				retryable: false,
			};
			res.status(HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 6. Populate req.callerService and proceed down the middleware pipeline
		req.callerService = callerService;
		next();
	};
}
