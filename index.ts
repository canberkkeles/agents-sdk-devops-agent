import { generateText, isStepCount } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import dotenv from 'dotenv';
import { get_logs, list_services, post_issue_comment } from './tools.js';
import { SYSTEM_PROMPT } from './prompts.js';
import { experimental_createSkillTool as createSkillTool } from 'bash-tool';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env.local') });
dotenv.config();

// Ensure Bedrock API key is populated
const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY || '';
if (apiKey) {
    process.env.BEDROCK_API_KEY = apiKey;
}

// Create Amazon Bedrock provider instance default to us-east-1
const bedrockProvider = createAmazonBedrock({
    region: 'us-east-1',
    apiKey: apiKey
});

// Export the core agent execution function. Stateless and webhook-friendly.
export async function runAgent(promptText: string): Promise<string> {
    console.log(`[Agent] Starting runAgent with Amazon Bedrock Claude Haiku 4.5:\n${promptText}`);

    const { skill, files, instructions } = await createSkillTool({
        skillsDirectory: path.resolve(__dirname, './skills'),
    });

    console.log(`[Agent] Skills loaded successfully. System prompt size: ${instructions?.length || 0} chars.`);

    const modelId = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

    const result = await generateText({
        model: bedrockProvider(modelId),
        system: `${SYSTEM_PROMPT}\n\n${instructions}`,
        tools: {
            get_logs,
            list_services,
            post_issue_comment,
            skill
        },
        stopWhen: isStepCount(10),
        prompt: promptText,
    });

    console.log(`[Agent] Diagnostic execution complete. Steps run: ${result.steps?.length || 0}. Text output length: ${result.text?.length || 0} chars.`);
    return result.text;
}