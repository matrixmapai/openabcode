import { homedir } from "node:os";
import { join } from "node:path";
import { createModels } from "@openabcode/ai";
import { cloudflareAIGatewayProvider } from "@openabcode/ai/providers/cloudflare-ai-gateway";
import { openaiProvider } from "@openabcode/ai/providers/openai";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { InMemorySessionStorage } from "../../src/harness/session/memory-storage.ts";
import {
	AgentHarness,
	formatSkillsForSystemPrompt,
	loadSourcedPromptTemplates,
	loadSourcedSkills,
	type PromptTemplate,
	Session,
	type Skill,
} from "../../src/index.ts";

type Source = { type: "project" | "user" | "path"; dir: string };
type SourcedSkill = Skill & { source: Source };
type SourcedPromptTemplate = PromptTemplate & { source: Source };

const env = new NodeExecutionEnv({ cwd: process.cwd() });

const source = (type: Source["type"], dir: string) => ({ path: dir, source: { type, dir } });
const { skills: sourcedSkills } = await loadSourcedSkills<Source, SourcedSkill>(
	env,
	[
		source("project", join(env.cwd, ".openabcode/skills")),
		source("user", join(homedir(), ".openabcode/agent/skills")),
		source("path", join(env.cwd, "../../../openabcode-skills")),
	],
	(skill, source) => ({ ...skill, source }),
);
const { promptTemplates: sourcedPromptTemplates } = await loadSourcedPromptTemplates<Source, SourcedPromptTemplate>(
	env,
	[
		source("project", join(env.cwd, ".openabcode/prompts")),
		source("user", join(homedir(), ".openabcode/agent/prompts")),
	],
	(promptTemplate, source) => ({ ...promptTemplate, source }),
);

const models = createModels();
models.setProvider(openaiProvider());
models.setProvider(cloudflareAIGatewayProvider());
const model = models.getModel("openai", "gpt-5.5");
// const model = models.getModel("cloudflare-ai-gateway", "claude-haiku-4-5");
if (!model) {
	console.log("Model not found");
	process.exit(-1);
}

const session = new Session(new InMemorySessionStorage());
const agent = new AgentHarness({
	env,
	session,
	models,
	model,
	thinkingLevel: "low",
	systemPrompt: ({ env, resources }) =>
		[
			"You are a helpful assistant.",
			formatSkillsForSystemPrompt(resources.skills ?? []),
			`Current working directory: ${env.cwd}`,
		]
			.filter((part) => part.length > 0)
			.join("\n\n"),
	resources: {
		promptTemplates: sourcedPromptTemplates.map(({ promptTemplate }) => promptTemplate),
		skills: sourcedSkills.map(({ skill }) => skill),
	},
});

const response = await agent.prompt("What skills do you have? Any duplicates?");
console.log(response);
