/**
 * Normalizes PEM formatted keys by resolving escaped newline characters
 * often introduced when storing multiline secrets in environment variables or key vaults.
 *
 * @param key - Raw PEM key string.
 * @returns Normalized PEM key string with actual newline characters.
 */
export function normalizePemKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.includes("\\n")) {
		return trimmed.replace(/\\n/g, "\n");
	}
	return trimmed;
}
