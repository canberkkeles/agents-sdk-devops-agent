import { tool } from 'ai';
import { z } from 'zod';
import ms from 'ms';

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

export const list_services = tool({
    description: 'Retrieve the list of active services/applications in the production infrastructure.',
    parameters: z.object({
        start: z.string().optional().describe('The start time to query active services (e.g. "past 24 hours", "24h", "2d"). Defaults to "24h".'),
        end: z.string().optional().describe('The end time to query active services. Defaults to "0m" (now).'),
    }),
    execute: async (args: any) => {
        const { start, end } = args;
        console.log(`🤖 Agent executing list_services...`, args);
        const username = process.env.GRAFANA_USER_ID!.trim();
        const tokenSecret = process.env.GRAFANA_API_KEY!.trim();
        const basicAuthString = Buffer.from(`${username}:${tokenSecret}`).toString('base64');

        const label = 'service_name';
        let services: string[] = [];

        // Parse start and end relative durations using the ms library with normalizeDuration fallback
        const startDuration = start || args.time_range || args.duration || '24h';
        const endDuration = end || '0m';

        const normalizedStart = normalizeDuration(startDuration);
        const normalizedEnd = normalizeDuration(endDuration);

        const startMs = Date.now() - (ms(normalizedStart) || 24 * 60 * 60 * 1000);
        const endMs = Date.now() - (ms(normalizedEnd) || 0);

        // Apply a safety clock skew offset (10 minutes) to keep queries in the server's past
        const skewOffsetMs = 10 * 60 * 1000;
        const finalStartNs = String((startMs - skewOffsetMs) * 1000000);
        const finalEndNs = String((endMs - skewOffsetMs) * 1000000);

        const queryBaseUrl = process.env.GRAFANA_LOKI_PUSH_URL!.replace('/push', `/label/${label}/values`);
        const targetUrl = `${queryBaseUrl}?start=${finalStartNs}&end=${finalEndNs}`;

        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${basicAuthString}`,
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const json = await response.json();
                console.log("DEBUG: list_services json response:", json);
                if (json.data && json.data.length > 0) {
                    services = json.data;
                }
            }
        } catch (error) {
            console.error("Failed to fetch label values:", error);
        }

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
        console.log("DEBUG: Raw execute args received from model:", args);
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

        // Parse start and end relative durations using the ms library with normalizeDuration fallback
        const startDuration = start || args.time_range || args.duration || '15m';
        const endDuration = end || '0m';

        const normalizedStart = normalizeDuration(startDuration);
        const normalizedEnd = normalizeDuration(endDuration);

        const startMs = Date.now() - (ms(normalizedStart) || 15 * 60 * 1000);
        const endMs = Date.now() - (ms(normalizedEnd) || 0);

        // Apply a safety clock skew offset (10 minutes) to keep queries in the server's past
        const skewOffsetMs = 10 * 60 * 1000;
        const finalStartNs = String((startMs - skewOffsetMs) * 1000000);
        const finalEndNs = String((endMs - skewOffsetMs) * 1000000);

        const finalLimit = (limit !== undefined && limit !== null) ? limit : 10;
        console.log(`🤖 Agent executing Loki query: ${finalLogQL}`);
        const queryBaseUrl = process.env.GRAFANA_LOKI_PUSH_URL!.replace('/push', '/query_range');
        const targetUrl = `${queryBaseUrl}?query=${encodeURIComponent(finalLogQL)}&limit=${finalLimit}&start=${finalStartNs}&end=${finalEndNs}`;

        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${basicAuthString}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { error: `Grafana Loki Query Failed: ${response.status} - ${errorText}` };
            }

            const json = await response.json();
            const logStreams = json.data?.result || [];

            const plainLines = logStreams.flatMap((streamObj: any) =>
                streamObj.values.map((valArr: string[]) => {
                    return `[${new Date(Number(valArr[0]) / 1000000).toISOString()}] ${valArr[1]}`;
                })
            );

            return {
                status: "success",
                linesFound: plainLines.length,
                logs: plainLines
            };

        } catch (error: any) {
            return { error: `Network failure connecting to Grafana Loki: ${error.message}` };
        }
    }
});