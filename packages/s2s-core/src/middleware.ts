import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, {
	type Algorithm,
	type JwtPayload,
	type VerifyOptions,
} from "jsonwebtoken";
import {
	AUTH_ERRORS,
	type AuthErrorCode,
	CONFIG_DEFAULTS,
	ERROR_CODES,
	HEADERS,
	HTTP_STATUS,
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
 * Configuration contract for token verification.
 * Adheres strictly to stateless design principles (no process.env references).
 */
export interface TokenVerifierConfig {
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
 * @param config - Configuration containing the public key and expected audience.
 * @returns An Express RequestHandler middleware function.
 */
export function authMiddleware(config: TokenVerifierConfig): RequestHandler {
	if (!config) {
		throw new Error(VERIFIER_ERRORS.CONFIG_REQUIRED);
	}

	if (
		!config.publicKey ||
		typeof config.publicKey !== "string" ||
		!config.publicKey.trim()
	) {
		throw new Error(VERIFIER_ERRORS.PUBLIC_KEY_REQUIRED);
	}

	if (
		!config.expectedAudience ||
		typeof config.expectedAudience !== "string" ||
		!config.expectedAudience.trim()
	) {
		throw new Error(VERIFIER_ERRORS.EXPECTED_AUDIENCE_REQUIRED);
	}

	const normalizedPublicKey = normalizePemKey(config.publicKey);
	const expectedAudience = config.expectedAudience.trim();

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

		const [scheme, token] = authHeader.split(" ");
		if (scheme?.toLowerCase() !== "bearer" || !token) {
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

		// 2. Extract X-Caller-Service header
		const rawCallerHeader = req.headers[HEADERS.CALLER_SERVICE];
		const callerService = Array.isArray(rawCallerHeader)
			? rawCallerHeader[0]
			: rawCallerHeader;

		if (!callerService?.trim()) {
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

		// 3. Cryptographically verify token and validate claims
		const verifyOptions: VerifyOptions = {
			algorithms: config.algorithms ?? [CONFIG_DEFAULTS.ALGORITHM],
			audience: expectedAudience,
		};

		let decoded: TokenPayload;
		try {
			const verified = jwt.verify(token, normalizedPublicKey, verifyOptions);
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

		// 4. Verify that caller identity matches token claims (iss / sub)
		const tokenIssuer = decoded.iss ?? decoded.sub ?? "";
		if (tokenIssuer !== callerService.trim()) {
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

		// 5. Populate req.callerService and proceed down the middleware pipeline
		req.callerService = callerService.trim();
		next();
	};
}
