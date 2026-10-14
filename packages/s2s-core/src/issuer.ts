import jwt, { type SignOptions } from "jsonwebtoken";
import {
	CONFIG_DEFAULTS,
	ISSUER_ERRORS,
	SUPPORTED_ASYMMETRIC_ALGORITHMS,
	type SupportedAlgorithm,
} from "./constants";
import { normalizePemKey } from "./utils";

/**
 * Configuration contract for generating Service-to-Service JWTs.
 * Adheres strictly to stateless design principles (no process.env references).
 */
export interface TokenIssuerConfig {
	/**
	 * RSA Private Key in PEM format (PKCS#1 or PKCS#8) used for signature generation.
	 */
	privateKey: string;

	/**
	 * Unique identifier of the initiating microservice (e.g., 'order-service').
	 */
	serviceName: string;

	/**
	 * Asymmetric cryptographic signing algorithm.
	 * Only asymmetric algorithms (RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512) are permitted.
	 * Defaults to 'RS256'.
	 */
	algorithm?: SupportedAlgorithm;

	/**
	 * Token lifetime expression (e.g., '15m', '1h', or numeric seconds).
	 * Defaults to '15m'.
	 */
	expiresIn?: SignOptions["expiresIn"];
}

/**
 * Generates an asymmetric RS256 signed Service-to-Service JWT with a 15-minute expiration.
 *
 * @param targetAudience - Identifier of the recipient service (e.g., 'user-service').
 * @param config - Configuration containing the caller's private key and service identifier.
 * @returns An RS256-signed JWT string.
 * @throws {Error} When parameters or private keys are missing or invalid.
 */
export function generateToken(
	targetAudience: string,
	config: TokenIssuerConfig,
): string {
	if (!config) {
		throw new Error(ISSUER_ERRORS.CONFIG_REQUIRED);
	}

	if (
		!config.privateKey ||
		typeof config.privateKey !== "string" ||
		!config.privateKey.trim()
	) {
		throw new Error(ISSUER_ERRORS.PRIVATE_KEY_REQUIRED);
	}

	if (
		!config.serviceName ||
		typeof config.serviceName !== "string" ||
		!config.serviceName.trim()
	) {
		throw new Error(ISSUER_ERRORS.SERVICE_NAME_REQUIRED);
	}

	if (
		!targetAudience ||
		typeof targetAudience !== "string" ||
		!targetAudience.trim()
	) {
		throw new Error(ISSUER_ERRORS.TARGET_AUDIENCE_REQUIRED);
	}

	if (config.algorithm !== undefined) {
		if (
			!SUPPORTED_ASYMMETRIC_ALGORITHMS.includes(
				config.algorithm as SupportedAlgorithm,
			)
		) {
			throw new Error(
				ISSUER_ERRORS.INVALID_ALGORITHM(String(config.algorithm)),
			);
		}
	}

	const normalizedPrivateKey = normalizePemKey(config.privateKey);

	const signOptions: SignOptions = {
		algorithm: config.algorithm ?? CONFIG_DEFAULTS.ALGORITHM,
		expiresIn: config.expiresIn ?? CONFIG_DEFAULTS.TOKEN_EXPIRATION,
		issuer: config.serviceName.trim(),
		subject: config.serviceName.trim(),
		audience: targetAudience.trim(),
	};

	try {
		return jwt.sign({}, normalizedPrivateKey, signOptions);
	} catch (error: unknown) {
		const message =
			error instanceof Error
				? error.message
				: ISSUER_ERRORS.UNKNOWN_SIGNING_ERROR;
		throw new Error(ISSUER_ERRORS.SIGNING_FAILED(message));
	}
}
