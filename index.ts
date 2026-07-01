import { ModelMessage, generateText, isStepCount } from 'ai';
import { google } from "@ai-sdk/google";
import dotenv from 'dotenv';
import { get_logs, list_services } from './tools';
import { SYSTEM_PROMPT } from './prompts';
import { experimental_createSkillTool as createSkillTool } from 'bash-tool';

dotenv.config({ path: '.env.local' });
dotenv.config();
import * as readline from 'node:readline/promises';

const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const messages: ModelMessage[] = [];

async function main() {
    // Discover and load skills using the official Vercel Labs bash-tool package
    const { skill, files, instructions } = await createSkillTool({
        skillsDirectory: './skills',
    });

    while (true) {
        const userInput = await terminal.question('You: ');

        messages.push({ role: 'user', content: userInput });

        const result = await generateText({
            model: google("gemini-3.1-flash-lite"),
            system: `${SYSTEM_PROMPT}\n\n${instructions}`,
            tools: {
                get_logs,
                list_services,
                skill
            },
            stopWhen: isStepCount(5),
            messages,
        });

        process.stdout.write(`\nAssistant: ${result.text}\n\n`);

        messages.push({ role: 'assistant', content: result.text });
    }
}

main().catch(console.error);