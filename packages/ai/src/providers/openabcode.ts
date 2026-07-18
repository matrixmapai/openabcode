import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENABCODE_MODELS, openabcodeGatewayBaseUrl } from "./openabcode.models.ts";

export const OPENABCODE_PROVIDER_ID = "openabcode";
export const OPENABCODE_ROUTING_DECISION_HEADER = "x-openabcode-routing-decision-id";

export function openabcodeProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: OPENABCODE_PROVIDER_ID,
		name: "OpenABCode Gateway",
		baseUrl: openabcodeGatewayBaseUrl(),
		auth: { apiKey: envApiKeyAuth("OpenABCode API key", ["OPENABCODE_API_KEY"]) },
		models: Object.values(OPENABCODE_MODELS),
		api: openAICompletionsApi(),
	});
}
