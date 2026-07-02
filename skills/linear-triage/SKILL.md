---
name: Linear Issue Triage
description: Automatically investigate logs for incoming Linear issues representing system incidents, write a structured remediation plan, and publish comments back to the issue.
---

# Linear Issue Triage Skill

Use this skill when you are triaging a Linear issue payload representing a production error, incident, or outage.

## Workflow:
1. **Acknowledge the Ticket:** Immediately call the `post_issue_comment` tool with the incoming Linear `issue_id` to post an initial comment:
   *"🤖 Antigravity DevOps Agent has started investigating this issue. Checking Grafana Loki logs..."*
2. **Collect Evidence:**
   - Call the `list_services` tool to discover the active service names.
   - Use `get_logs` to retrieve the relevant logs for the target service and timeframe (defaulting to the past 3 hours if not specified).
3. **Analyze & Mitigate:**
   - Determine how long the problem has been occurring based on timestamps.
   - Group and count reoccurring log messages to avoid duplicates.
   - Formulate a clear, structured Mitigation Plan (Immediate Containment, Short-Term Fixes, Long-Term Upgrades).
4. **Publish Diagnostics:** Call `post_issue_comment` to post the final comment on the Linear issue containing the report formatted exactly as specified below.

## Final Response Output Format:
Your final comment posted back to the Linear issue must follow this exact markdown structure:

# INCIDENT DIAGNOSTIC & REMEDIATION REPORT

## 🔍 Log Analysis Summary
- **Target Service:** [Detected Service Name, e.g. vercel-storefront]
- **Active Incident Timeline:** [Start Time] to [End Time] (Duration: [Calculated Hours/Minutes])
- **Total Log Volume Scanned:** [Lines found]

### 🚨 Correlation & Error Grouping
*Group similar repeating errors together. For each unique error group, list:*
- **[Error Name / Type]** (Occurred [N] times)
  - First Occurrence: [ISO Timestamp]
  - Last Occurrence: [ISO Timestamp]
  - Sample Trace: `[Raw Error Message]`

---

## 🛠️ Incident Remediation Plan

### Phase 1: Containment & Immediate Recovery (5-15 Minutes)
- Formulate immediate, time-critical stabilization steps to restore baseline service availability based on the incident type (e.g. if memory/resources are exhausted, propose rolling restarts or resource scaling; if there is a traffic surge, propose rate-limiting or auto-scaling; if a recent deploy caused it, propose rolling back).

### Phase 2: Short-Term Corrective Actions (24 Hours)
- Formulate code or configuration modifications to patch the root cause (e.g. adding validation logic, adjusting connection close handlers, tightening query timeouts, or adding alert notifications on critical log filters).

### Phase 3: Long-Term Architectural Mitigation
- Propose structural architectural improvements to prevent this entire class of failures in the future (e.g. implementing proxy/pooling layers, introducing message queues to decouple services, adding CDNs/caching, or configuring secondary replication).
