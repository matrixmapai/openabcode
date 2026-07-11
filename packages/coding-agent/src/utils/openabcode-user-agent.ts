export function getOpenABCodeUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `openabcode/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
