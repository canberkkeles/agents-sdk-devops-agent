---
name: Loki Log Analyst
description: Query Grafana Loki logs, check for active service registries, and summarize log streams.
---

# Loki Log Analyst Skill

Use this skill when the user asks to view, check, or summarize application logs, or check active service names.

## Guidelines:
1. **Identify Service:** If the service name is not explicitly clear, use the `list_services` tool first to find all active service names.
2. **Query Logs:** Use `get_logs` with the correct service name and target relative duration (defaulting to the past 15 minutes if not specified) to fetch logs.
3. **Analyze Timeline & Reoccurrence:**
   - **How long the problem has been there:** Determine the duration of the issue by calculating the difference between the earliest and latest timestamps of the errors in the log stream.
   - **Correlate and Group:** Group similar or repeating error logs together. Summarize their frequency (e.g., "occurred 5 times between 11:40 AM and 12:00 PM") to avoid listing repetitive stack traces.
4. **Format Output:** Present a structured summary containing:
   - The active timeline of the issue (how long it has been occurring).
   - Grouped warning/error logs with reoccurrence frequency counts.
   - Key stack traces and details.
