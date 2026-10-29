/**
 * Masks the password in an AMQP or AMQPS connection URL.
 * Example: `amqp://user:secret@localhost:5672` -> `amqp://user:******@localhost:5672`
 *
 * @param url - Raw connection URL.
 * @returns Sanitized URL with password masked.
 */
export function sanitizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) {
			parsed.password = "******";
		}
		return parsed.toString();
	} catch {
		// Fallback regex matching amqp://user:pass@host
		return url.replace(/(amqps?:\/\/[^:]+:)([^@]+)(@)/g, "$1******$3");
	}
}

/**
 * Sanitizes error objects and strings by replacing plain-text passwords in AMQP URLs.
 * Prevents credentials from leaking into log files or monitoring systems (CWE-532).
 *
 * @param error - The caught error object or message.
 * @returns Sanitized error object with masked credentials.
 */
export function sanitizeError(error: unknown): unknown {
	const maskPassword = (str: string): string =>
		str.replace(/(amqps?:\/\/[^:]+:)([^@]+)(@)/g, "$1******$3");

	if (error instanceof Error) {
		const sanitized = new Error(maskPassword(error.message));
		sanitized.name = error.name;
		if (error.stack) {
			sanitized.stack = maskPassword(error.stack);
		}
		return sanitized;
	}

	if (typeof error === "string") {
		return maskPassword(error);
	}

	return error;
}
