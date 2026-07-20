import { tool } from 'ai';
import { z } from 'zod';
import { LinearClient } from '@linear/sdk';

export const post_issue_comment = tool({
    description: 'Post a comment on a Linear issue to update users or publish diagnostics.',
    parameters: z.object({
        issue_id: z.string().describe('The ID of the Linear issue to comment on.'),
        comment_body: z.string().describe('The markdown content of the comment to post.'),
    }),
    execute: async ({ issue_id, comment_body }) => {
        console.log(`[Tool: post_issue_comment] Executing on issue [${issue_id}]`);
        console.log(comment_body);
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
    parameters: z.object({}),
    execute: async () => {
        console.log(`[Tool: list_services] Executing list_services...`);
        const username = process.env.GRAFANA_USER_ID!.trim();
        const tokenSecret = process.env.GRAFANA_API_KEY!.trim();
        const basicAuthString = Buffer.from(`${username}:${tokenSecret}`).toString('base64');

        const label = 'service_name';
        let services: string[] = [];

        // Hardcoded past 24 hours query window
        const endMs = Date.now();
        const startMs = endMs - 24 * 60 * 60 * 1000;

        const finalStartNs = String(startMs * 1000000);
        const finalEndNs = String(endMs * 1000000);

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
    description: 'Query live application logs from Grafana Loki for a specific service. You MUST specify the target "service" parameter (e.g. "vercel-storefront" or "billing-worker"). Do NOT call this tool without the service parameter.',
    parameters: z.object({
        service: z.string().describe('REQUIRED. The target service name to retrieve logs for, e.g. "vercel-storefront" or "billing-worker".'),
        filter: z.string().optional().describe('An optional text filter to search for inside the logs (case-sensitive), e.g. "error", "ConnectionTimeoutError", or "500".'),
        limit: z.number().max(20).default(10).describe('Limit the number of log lines returned to save context window space.'),
    }),
    execute: async (args: any) => {
        const { service, filter, limit } = args;
        console.log("[Tool: get_logs] Executing with args:", args);

        const username = process.env.GRAFANA_USER_ID!.trim();
        const tokenSecret = process.env.GRAFANA_API_KEY!.trim();
        const basicAuthString = Buffer.from(`${username}:${tokenSecret}`).toString('base64');

        // Construct LogQL query from service parameter
        const rawService = service || args.service_name || args.app_name || args.app;
        if (!rawService) {
            console.error("[Tool: get_logs] Error: 'service' argument is missing.");
            return { error: "Missing required parameter 'service'. You must specify the service name (e.g. 'vercel-storefront' or 'billing-worker') to query logs for." };
        }
        let finalLogQL = `{service_name="${rawService.trim()}"}`;

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

        // Hardcoded past 24 hours query window
        const endMs = Date.now();
        const startMs = endMs - 24 * 60 * 60 * 1000;

        const finalStartNs = String(startMs * 1000000);
        const finalEndNs = String(endMs * 1000000);

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