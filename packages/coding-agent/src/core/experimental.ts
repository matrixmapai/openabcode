export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.OPENABCODE_EXPERIMENTAL === "1";
}
