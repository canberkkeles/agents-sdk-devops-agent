import crypto from 'node:crypto';
import { runAgent } from '../index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config();

function verifySignature(headerSignatureString: string | null, rawBody: string): boolean {
    const signingKey = process.env.LINEAR_WEBHOOK_SIGNING_KEY;
    if (!headerSignatureString || !signingKey) {
        return false;
    }
    try {
        const headerSignature = Buffer.from(headerSignatureString, 'hex');
        const computedSignature = crypto
            .createHmac('sha256', signingKey)
            .update(rawBody)
            .digest();

        if (headerSignature.length !== computedSignature.length) {
            return false;
        }

        return crypto.timingSafeEqual(computedSignature, headerSignature);
    } catch {
        return false;
    }
}

export async function POST(request: Request) {
    console.log(`[Webhook] Incoming request - Method: ${request.method}, Path: ${request.url}`);

    try {
        const rawBody = await request.text();
        const signatureHeader = request.headers.get('linear-signature');

        if (!verifySignature(signatureHeader, rawBody)) {
            console.warn(`[Webhook] Invalid signature. Header: ${signatureHeader}`);
            return Response.json({ error: 'Unauthorized', message: 'Invalid signature' }, { status: 401 });
        }

        const payload = JSON.parse(rawBody);
        console.log("[Webhook] Received Payload Body:", JSON.stringify(payload, null, 2));

        const action = payload.action;
        const data = payload.data;

        // Prevent feedback loops:
        // 1. Only run on 'create' or 'update' events.
        // 2. For 'update' events, only run if the title or description actually changed.
        //    Since the agent uses a Personal API Key, any actions it performs (like posting comments)
        //    are authenticated as the key's owner (a human user) and trigger an 'update' webhook.
        //    Checking 'updatedFrom' prevents comment additions from causing infinite loops.
        const isDetailsUpdated = data.updatedFrom && ('description' in data.updatedFrom || 'title' in data.updatedFrom);
        const shouldTrigger = action === 'create' || (action === 'update' && isDetailsUpdated);

        if (payload.type === 'Issue' && shouldTrigger) {
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

            return Response.json({
                status: 'success',
                message: 'Autonomous diagnostic run completed successfully',
                issue: {
                    id: issueId,
                    title
                },
                resolution
            }, { status: 200 });
        }

        console.log(`[Webhook] Ignored event - Type: ${payload.type}, Action: ${action}`);
        return Response.json({
            status: 'ignored',
            reason: 'Not a relevant Issue create or update action'
        }, { status: 200 });

    } catch (error: any) {
        console.error("[Webhook] Processing failure:", error);
        return Response.json({
            error: 'Internal Server Error',
            message: error.message
        }, { status: 500 });
    }
}
