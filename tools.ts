import { tool } from 'ai';
import { z } from 'zod';
import ms from 'ms';
import { LinearClient } from '@linear/sdk';

function normalizeDuration(timeStr: string): string {
    const clean = timeStr.toLowerCase().trim();
    const match = clean.match(/(?:past\s+)?(\d+)\s*(sec|min|hour|day)s?/);
    if (match) {
        const num = match[1];
        const unit = match[2];
        const unitMap: Record<string, string> = {
            sec: 's',
            min: 'm',
            hour: 'h',
            day: 'd'
        };
        return `${num}${unitMap[unit]}`;
    }
    return timeStr;
}

function parseTimestamp(val: string | undefined, defaultMs: number): number {
    if (!val) return defaultMs;

    const clean = val.trim();

    // 1. Try to parse as relative duration (e.g. "past 2 hours", "15m", "3h")
    try {
        const normalized = normalizeDuration(clean);
        const msVal = ms(normalized);
        if (typeof msVal === 'number') {
            return Date.now() - msVal;
        }
    } catch {
        // Fall through
    }

    // 2. Check if it's a raw Unix timestamp (unix ms or ns)
    if (/^\d+$/.test(clean)) {
        const num = Number(clean);
        return num > 1e12 ? Math.floor(num / 1000000) : num;
    }

    // 3. Parse as ISO-8601 string
    const parsed = Date.parse(clean);
    return isNaN(parsed) ? defaultMs : parsed;
}

export const post_issue_comment = tool({
    description: 'Post a comment on a Linear issue to update users or publish diagnostics.',
    parameters: z.object({
        issue_id: z.string().describe('The ID of the Linear issue to comment on.'),
        comment_body: z.string().describe('The markdown content of the comment to post.'),
    }),
    execute: async ({ issue_id, comment_body }) => {
        console.log(`[Tool: post_issue_comment] Executing on issue [${issue_id}]`);
        console.log(`[Tool: post_issue_comment] Body snippet: "${comment_body.substring(0, 150)}..."`);
        
        const apiKey = process.env.LINEAR_API_KEY?.trim();
        if (!apiKey) {
            console.error("[Tool: post_issue_comment] Error: LINEAR_API_KEY env is not configured.");
            return { error: "LINEAR_API_KEY environment variable is not configured." };
        }

        try {
            const linear = new LinearClient({ apiKey });
            const agentHeader = `### 🤖 DevOps Agent\n*Automated response*\n\n`;
            
            const payload = await linear.createComment({
                issueId: issue_id,
                body: agentHeader + comment_body
            });
            const comment = await payload.comment;

            console.log(`[Tool: post_issue_comment] Success. Created comment ID: [${comment?.id}]`);
            return {
                status: "success",
                commentId: comment?.id
            };

        } catch (error: any) {
            console.error(`[Tool: post_issue_comment] SDK Mutation Failed:`, error);
            return { error: `Failed to post comment via Linear SDK: ${error.message}` };
        }
    }
});

export const list_services = tool({
    description: 'Retrieve the list of active services/applications in the production infrastructure.',
    parameters: z.object({
        start: z.string().optional().describe('The start time to query active services (e.g. "past 24 hours", "24h", "2d"). Defaults to "24h".'),
        end: z.string().optional().describe('The end time to query active services. Defaults to "0m" (now).'),
    }),
    execute: async (args: any) => {
        console.log(`[Tool: list_services] Executing with args:`, args);
        const username = process.env.GRAFANA_USER_ID!.trim();
        const tokenSecret = process.env.GRAFANA_API_KEY!.trim();
        const basicAuthString = Buffer.from(`${username}:${tokenSecret}`).toString('base64');

        const label = 'service_name';
        let services: string[] = [];

        // Parse start and end times using the unified helper
        const startMs = parseTimestamp(args.start || args.time_range || args.duration, Date.now() - 24 * 60 * 60 * 1000);
        const endMs = parseTimestamp(args.end, Date.now());

        // Apply a safety clock skew offset (10 minutes) to keep queries in the server's past
        const skewOffsetMs = 10 * 60 * 1000;
        const finalStartNs = String((startMs - skewOffsetMs) * 1000000);
        const finalEndNs = String((endMs - skewOffsetMs) * 1000000);

        const queryBaseUrl = process.env.GRAFANA_LOKI_PUSH_URL!.replace('/push', `/label/${label}/values`);
        const targetUrl = `${queryBaseUrl}?start=${finalStartNs}&end=${finalEndNs}`;

        console.log(`[Tool: list_services] Query Window: ${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()}`);
        console.log(`[Tool: list_services] Query URL: ${targetUrl}`);

        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${basicAuthString}`,
                    'Accept': 'application/json'
                }
            });

            console.log(`[Tool: list_services] Loki API Response status: ${response.status}`);

            if (response.ok) {
                const json = await response.json();
                console.log("[Tool: list_services] Loki raw response:", JSON.stringify(json));
                if (json.data && json.data.length > 0) {
                    services = json.data;
                }
            } else {
                const errText = await response.text();
                console.error(`[Tool: list_services] Loki API Error:`, errText);
            }
        } catch (error) {
            console.error("[Tool: list_services] Network failure:", error);
        }

        console.log(`[Tool: list_services] Completed. Found active services:`, services);
        return {
            status: "success",
            services
        };
    }
});

export const get_logs = tool({
    description: 'Query live application logs from Grafana Loki for a specific service.',
    parameters: z.object({
        service: z.string().optional().describe('The name of the service to retrieve logs for, e.g. "vercel-storefront".'),
        filter: z.string().optional().describe('An optional text filter to search for inside the logs (case-sensitive), e.g. "error", "ConnectionTimeoutError", or "500".'),
        limit: z.number().max(20).default(10).describe('Limit the number of log lines returned to save context window space.'),
        start: z.string().optional().describe('The start time. Can be ISO-8601 string, Unix timestamp, or a relative duration (e.g. "past 1 hour", "15m").'),
        end: z.string().optional().describe('The end time. Can be ISO-8601 string, Unix timestamp, or a relative duration.'),
    }),
    execute: async (args: any) => {
        const { service, filter, limit, start, end } = args;
        console.log("[Tool: get_logs] Executing with args:", args);
        
        const username = process.env.GRAFANA_USER_ID!.trim();
        const tokenSecret = process.env.GRAFANA_API_KEY!.trim();
        const basicAuthString = Buffer.from(`${username}:${tokenSecret}`).toString('base64');

        // Construct LogQL query from service and filter parameters using service_name label
        let finalLogQL = '';
        const rawService = service || args.service_name || args.app_name || args.app || 'vercel-storefront';
        if (rawService) {
            finalLogQL = `{service_name="${rawService.trim()}"}`;
        }

        // Apply text filter if provided
        if (filter) {
            finalLogQL += ` |= "${filter.trim()}"`;
        } else if (args.logQL || args.query) {
            // Fallback if model generated a raw query containing app or service
            const rawQuery = args.logQL || args.query;
            finalLogQL = rawQuery
                .replace(/\{app=/g, '{service_name=')
                .replace(/,app=/g, ',service_name=')
                .replace(/\{service=/g, '{service_name=')
                .replace(/,service=/g, ',service_name=');
        }

        // Parse start and end times using the unified helper
        const startMs = parseTimestamp(start || args.time_range || args.duration, Date.now() - 15 * 60 * 1000);
        const endMs = parseTimestamp(end, Date.now());

        // Apply a safety clock skew offset (10 minutes) to keep queries in the server's past
        const skewOffsetMs = 10 * 60 * 1000;
        const finalStartNs = String((startMs - skewOffsetMs) * 1000000);
        const finalEndNs = String((endMs - skewOffsetMs) * 1000000);

        const finalLimit = (limit !== undefined && limit !== null) ? limit : 10;
        
        const queryBaseUrl = process.env.GRAFANA_LOKI_PUSH_URL!.replace('/push', '/query_range');
        const targetUrl = `${queryBaseUrl}?query=${encodeURIComponent(finalLogQL)}&limit=${finalLimit}&start=${finalStartNs}&end=${finalEndNs}`;

        console.log(`[Tool: get_logs] LogQL query: ${finalLogQL}`);
        console.log(`[Tool: get_logs] Query Window: ${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()}`);
        console.log(`[Tool: get_logs] Target Request URL: ${targetUrl}`);

        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${basicAuthString}`,
                    'Accept': 'application/json'
                }
            });

            console.log(`[Tool: get_logs] Loki API response status: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Tool: get_logs] Loki API Error:`, errorText);
                return { error: `Grafana Loki Query Failed: ${response.status} - ${errorText}` };
            }

            const json = await response.json();
            const logStreams = json.data?.result || [];

            const plainLines = logStreams.flatMap((streamObj: any) =>
                streamObj.values.map((valArr: string[]) => {
                    return `[${new Date(Number(valArr[0]) / 1000000).toISOString()}] ${valArr[1]}`;
                })
            );

            console.log(`[Tool: get_logs] Completed. Retrieved ${plainLines.length} lines.`);
            return {
                status: "success",
                linesFound: plainLines.length,
                logs: plainLines
            };

        } catch (error: any) {
            console.error(`[Tool: get_logs] Fetch failed:`, error);
            return { error: `Network failure connecting to Grafana Loki: ${error.message}` };
        }
    }
});