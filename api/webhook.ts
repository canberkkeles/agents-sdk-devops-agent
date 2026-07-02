import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runAgent } from '../index';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    console.log(`[Webhook] Incoming request - Method: ${req.method}, Path: ${req.url}`);
    
    if (req.method !== 'POST') {
        console.warn(`[Webhook] Method ${req.method} not allowed`);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const payload = req.body;
        console.log("[Webhook] Received Payload Body:", JSON.stringify(payload, null, 2));

        const action = payload.action;
        const data = payload.data;

        if (payload.type === 'Issue' && (action === 'create' || action === 'update')) {
            const issueId = data.id;
            const title = data.title || 'No Title';
            const description = data.description || 'No Description';

            console.log(`[Webhook] Processing Issue [${issueId}] - Title: "${title}"`);

            // Construct the autonomous request payload
            const prompt = `There is a service issue reported in Linear. Help the oncall engineer by investigating the details
            Linear Issue ID: ${issueId}
            Title: ${title}
            Description: ${description}`;

            console.log(`🤖 Starting autonomous diagnostic run for Linear Issue [${issueId}]...`);
            
            // Execute the agent autonomously
            const resolution = await runAgent(prompt);

            console.log(`✅ Run complete for Linear Issue [${issueId}]. Resolution:`, resolution);

            return res.status(200).json({
                status: 'success',
                message: 'Autonomous diagnostic run completed successfully',
                issue: {
                    id: issueId,
                    title
                },
                resolution
            });
        }

        console.log(`[Webhook] Ignored event - Type: ${payload.type}, Action: ${action}`);
        return res.status(200).json({
            status: 'ignored',
            reason: 'Not a relevant Issue create or update action'
        });

    } catch (error: any) {
        console.error("[Webhook] Processing failure:", error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
}
