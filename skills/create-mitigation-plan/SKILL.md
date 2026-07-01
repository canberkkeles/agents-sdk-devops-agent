---
name: Create Mitigation Plan
description: Generate a structured incident mitigation and recovery plan for any production outage, service degradation, or system failure.
---

# Create Mitigation Plan Skill

Use this skill to compile a structured recovery, containment, and long-term mitigation plan for active production incidents or outages.

## Analysis Instructions:
1. **Locate the Incident Logs:**
   - **Reuse Chat History:** If the relevant logs or error details have already been retrieved or summarized earlier in the conversation history, use them directly. **Do not call the log tools again.**
   - Otherwise, use the \`list_services\` tool to check the registry of active service names, and use the \`get_logs\` tool to fetch the logs.
2. **Assess the Incident:** Inspect the retrieved/existing application logs and stack traces to identify the impacted component and scope of failure.
3. **Determine Containment:** Formulate immediate, time-critical steps to restore baseline service availability (e.g. restarting pods, scaling instances, failovers, blocking bad traffic).
4. **Identify Preventive Actions:** Formulate short-term fixes (config tweaks, log filters) and long-term structural changes (architectural upgrades, capacity planning) to prevent recurrence.

## Mitigation Plan Structure:
Your final output must contain:

### 1. Incident Overview
A summary of the target service, the error logs/symptoms found, and the active blast radius or impact.

### 2. Immediate Containment & Recovery
Step-by-step instructions to mitigate the active outage right now.

### 3. Preventive & Root Cause Corrective Measures
- **Short-Term Actions:** Monitoring alerts, configuration adjustments, code fixes.
- **Long-Term Actions:** Architectural upgrades, redundancy planning, or proxy configurations.
