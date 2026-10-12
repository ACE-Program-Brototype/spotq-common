import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, {
	type Algorithm,
	type JwtPayload,
	type VerifyOptions,
} from "jsonwebtoken";
import {
	S2S_AUTH_ERRORS,
	S2S_CONFIG_DEFAULTS,
	S2S_ERROR_CODES,
	S2S_HEADERS,
	S2S_HTTP_STATUS,
	S2S_VERIFIER_ERRORS,
	S2SErrorCode,
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

export { S2SErrorCode };

/**
 * Standardized machine-readable error payload returned on S2S authentication failure.
 */
export interface S2SErrorResponse {
	success: false;
	statusCode: typeof S2S_HTTP_STATUS.UNAUTHORIZED;
	code: S2SErrorCode;
	message: string;
	retryable: false;
}

/**
 * Configuration contract for S2S token verification.
 * Adheres strictly to stateless design principles (no process.env references).
 */
export interface S2SVerifierConfig {
	/**
	 * RSA Public Key in PEM format used for signature verification.
	 */
	publicKey: string;

	/**
	 * Expected audience identifier matching this recipient service (e.g., 'user-service').
	 */
	expectedAudience: string;

	/**
	 * Permitted cryptographic algorithms for verification.
	 * Defaults to ['RS256'].
	 */
	algorithms?: Algorithm[];
}

/**
 * Decoded payload shape for S2S JWTs.
 */
export interface S2STokenPayload extends JwtPayload {
	iss?: string;
	sub?: string;
	aud?: string | string[];
}

/**
 * Express middleware factory that enforces Service-to-Service (S2S) authentication
 * using asymmetric RS256 JWT validation and caller identity header verification.
 *
 * @param config - Configuration containing the public key and expected audience.
 * @returns An Express RequestHandler middleware function.
 */
export function s2sAuthMiddleware(config: S2SVerifierConfig): RequestHandler {
	if (!config) {
		throw new Error(S2S_VERIFIER_ERRORS.CONFIG_REQUIRED);
	}

	if (
		!config.publicKey ||
		typeof config.publicKey !== "string" ||
		!config.publicKey.trim()
	) {
		throw new Error(S2S_VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
	}

	if (
		!config.expectedAudience ||
		typeof config.expectedAudience !== "string" ||
		!config.expectedAudience.trim()
	) {
		throw new Error(S2S_VERIFIER_ERRORS.EXPECTED_AUDIENCE_REQUIRED);
	}

	const normalizedPublicKey = normalizePemKey(config.publicKey);
	const expectedAudience = config.expectedAudience.trim();

	return (req: Request, res: Response, next: NextFunction): void => {
		// 1. Extract Authorization header
		const rawAuthHeader = req.headers[S2S_HEADERS.AUTHORIZATION];
		const authHeader = Array.isArray(rawAuthHeader)
			? rawAuthHeader[0]
			: rawAuthHeader;

		if (!authHeader) {
			const errorPayload: S2SErrorResponse = {
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.UNAUTHORIZED_S2S,
				message: S2S_AUTH_ERRORS.MISSING_AUTH_HEADER,
				retryable: false,
			};
			res.status(S2S_HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		const [scheme, token] = authHeader.split(" ");
		if (scheme?.toLowerCase() !== "bearer" || !token) {
			const errorPayload: S2SErrorResponse = {
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.UNAUTHORIZED_S2S,
				message: S2S_AUTH_ERRORS.MALFORMED_AUTH_HEADER,
				retryable: false,
			};
			res.status(S2S_HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 2. Extract X-Caller-Service header
		const rawCallerHeader = req.headers[S2S_HEADERS.CALLER_SERVICE];
		const callerService = Array.isArray(rawCallerHeader)
			? rawCallerHeader[0]
			: rawCallerHeader;

		if (!callerService?.trim()) {
			const errorPayload: S2SErrorResponse = {
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.UNAUTHORIZED_S2S,
				message: S2S_AUTH_ERRORS.MISSING_CALLER_HEADER,
				retryable: false,
			};
			res.status(S2S_HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 3. Cryptographically verify token and validate claims
		const verifyOptions: VerifyOptions = {
			algorithms: config.algorithms ?? [S2S_CONFIG_DEFAULTS.ALGORITHM],
			audience: expectedAudience,
		};

		let decoded: S2STokenPayload;
		try {
			const verified = jwt.verify(token, normalizedPublicKey, verifyOptions);
			if (typeof verified === "string" || !verified) {
				const errorPayload: S2SErrorResponse = {
					success: false,
					statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
					code: S2S_ERROR_CODES.INVALID_S2S_TOKEN,
					message: S2S_AUTH_ERRORS.INVALID_PAYLOAD,
					retryable: false,
				};
				res.status(S2S_HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
				return;
			}
			decoded = verified as S2STokenPayload;
		} catch (err: unknown) {
			const errorMessage =
				err instanceof Error
					? err.message
					: S2S_AUTH_ERRORS.UNKNOWN_VERIFICATION_ERROR;
			const errorPayload: S2SErrorResponse = {
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.INVALID_S2S_TOKEN,
				message: S2S_AUTH_ERRORS.TOKEN_VERIFICATION_FAILED(errorMessage),
				retryable: false,
			};
			res.status(S2S_HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 4. Verify that caller identity matches token claims (iss / sub)
		const tokenIssuer = decoded.iss ?? decoded.sub ?? "";
		if (tokenIssuer !== callerService.trim()) {
			const errorPayload: S2SErrorResponse = {
				success: false,
				statusCode: S2S_HTTP_STATUS.UNAUTHORIZED,
				code: S2S_ERROR_CODES.INVALID_S2S_TOKEN,
				message: S2S_AUTH_ERRORS.CALLER_MISMATCH(callerService, tokenIssuer),
				retryable: false,
			};
			res.status(S2S_HTTP_STATUS.UNAUTHORIZED).json(errorPayload);
			return;
		}

		// 5. Populate req.callerService and proceed down the middleware pipeline
		req.callerService = callerService.trim();
		next();
	};
}
