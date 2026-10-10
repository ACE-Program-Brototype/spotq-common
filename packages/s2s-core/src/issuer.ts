import jwt, { Algorithm, SignOptions } from 'jsonwebtoken';
import { S2S_CONFIG_DEFAULTS, S2S_ISSUER_ERRORS } from './constants';

/**
 * Configuration contract for generating Service-to-Service (S2S) JWTs.
 * Adheres strictly to stateless design principles (no process.env references).
 */
export interface S2SIssuerConfig {
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
   * Defaults to 'RS256'.
   */
  algorithm?: Algorithm;

  /**
   * Token lifetime expression (e.g., '15m', '1h', or numeric seconds).
   * Defaults to '15m'.
   */
  expiresIn?: SignOptions['expiresIn'];
}

/**
 * Normalizes PEM formatted keys by resolving escaped newline characters
 * often introduced when storing multiline secrets in environment variables or key vaults.
 */
function normalizePemKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('\\n')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return trimmed;
}

/**
 * Generates an asymmetric RS256 signed Service-to-Service JWT with a 15-minute expiration.
 *
 * @param targetAudience - Identifier of the recipient service (e.g., 'user-service').
 * @param config - Configuration containing the caller's private key and service identifier.
 * @returns An RS256-signed JWT string.
 * @throws {Error} When parameters or private keys are missing or invalid.
 */
export function generateS2SToken(targetAudience: string, config: S2SIssuerConfig): string {
  if (!config) {
    throw new Error(S2S_ISSUER_ERRORS.CONFIG_REQUIRED);
  }

  if (!config.privateKey || typeof config.privateKey !== 'string' || !config.privateKey.trim()) {
    throw new Error(S2S_ISSUER_ERRORS.PRIVATE_KEY_REQUIRED);
  }

  if (!config.serviceName || typeof config.serviceName !== 'string' || !config.serviceName.trim()) {
    throw new Error(S2S_ISSUER_ERRORS.SERVICE_NAME_REQUIRED);
  }

  if (!targetAudience || typeof targetAudience !== 'string' || !targetAudience.trim()) {
    throw new Error(S2S_ISSUER_ERRORS.TARGET_AUDIENCE_REQUIRED);
  }

  const normalizedPrivateKey = normalizePemKey(config.privateKey);

  const signOptions: SignOptions = {
    algorithm: config.algorithm ?? S2S_CONFIG_DEFAULTS.ALGORITHM,
    expiresIn: config.expiresIn ?? S2S_CONFIG_DEFAULTS.TOKEN_EXPIRATION,
    issuer: config.serviceName.trim(),
    subject: config.serviceName.trim(),
    audience: targetAudience.trim(),
  };

  try {
    return jwt.sign({}, normalizedPrivateKey, signOptions);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : S2S_ISSUER_ERRORS.UNKNOWN_SIGNING_ERROR;
    throw new Error(S2S_ISSUER_ERRORS.SIGNING_FAILED(message));
  }
}
