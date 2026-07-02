import { generateText, isStepCount } from 'ai';
import { google } from "@ai-sdk/google";
import dotenv from 'dotenv';
import { get_logs, list_services, post_issue_comment } from './tools';
import { SYSTEM_PROMPT } from './prompts';
import { experimental_createSkillTool as createSkillTool } from 'bash-tool';

dotenv.config({ path: '.env.local' });
dotenv.config();

// Export the core agent execution function. Stateless and webhook-friendly.
export async function runAgent(promptText: string): Promise<string> {
    console.log(`[Agent] Starting runAgent with prompt:\n${promptText}`);

    const { skill, files, instructions } = await createSkillTool({
        skillsDirectory: './skills',
    });

    console.log(`[Agent] Skills loaded successfully. System prompt size: ${instructions?.length || 0} chars.`);

    const result = await generateText({
        model: google("gemini-3.1-flash-lite"),
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