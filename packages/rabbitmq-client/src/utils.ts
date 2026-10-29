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
