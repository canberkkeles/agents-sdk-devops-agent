import crypto from 'node:crypto';
import { runAgent } from '../index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config();

const redisClient = createClient({
    url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.error('[Redis Client Error]', err));

let isRedisConnected = false;
async function getRedisClient() {
    if (!isRedisConnected) {
        await redisClient.connect();
        isRedisConnected = true;
    }
    return redisClient;
}

async function getRedisKey(key: string): Promise<string | null> {
    if (!process.env.REDIS_URL) return null;
    try {
        const client = await getRedisClient();
        return await client.get(key);
    } catch (e) {
        console.error("[Redis GET failed]", e);
        return null;
    }
}

async function setRedisKey(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!process.env.REDIS_URL) return false;
    try {
        const client = await getRedisClient();
        await client.set(key, value, {
            EX: ttlSeconds
        });
        return true;
    } catch (e) {
        console.error("[Redis SET failed]", e);
        return false;
    }
}

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
        const deliveryId = request.headers.get('linear-delivery');

        if (!verifySignature(signatureHeader, rawBody)) {
            console.warn(`[Webhook] Invalid signature. Header: ${signatureHeader}`);
            return Response.json({ error: 'Unauthorized', message: 'Invalid signature' }, { status: 401 });
        }

        // Deduplicate events using Redis
        if (deliveryId) {
            const isProcessed = await getRedisKey(`linear-delivery:${deliveryId}`);
            if (isProcessed) {
                console.log(`[Webhook] Duplicate delivery detected: ${deliveryId}. Ignoring request.`);
                return Response.json({ status: 'ignored', reason: 'Duplicate delivery' }, { status: 200 });
            }
            // Mark as processed immediately with a 5-minute TTL
            await setRedisKey(`linear-delivery:${deliveryId}`, 'processed', 300);
        }

        const payload = JSON.parse(rawBody);
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
