export const label = 'secret-scanning-alert';

export function markerFromIssue(issue) {
  return issue.body?.match(/<!-- secret-scanning-alert: (\d+) -->/)?.[1];
}

export function alertFinding(alert, locations = alert.locations ?? []) {
  const name = alert.secret_type_display_name || alert.secret_type || 'Secret';
  const location = locations.map(({ details = {} }) => {
    const path = details.path;
    if (!path) return undefined;
    const start = details.start_line;
    const end = details.end_line;
    const line = start ? `:${start}${end && end !== start ? `-${end}` : ''}` : '';
    return `${path}${line}`;
  }).filter(Boolean).join(', ') || 'Unavailable';

  // Keep this an allowlist: GitHub's alert payload also contains `secret`.
  return {
    number: Number(alert.number),
    state: alert.state,
    type: name,
    location,
    url: alert.html_url,
    createdAt: alert.created_at,
    updatedAt: alert.updated_at,
    resolution: alert.resolution,
    resolvedAt: alert.resolved_at,
  };
}

function issueFor(finding) {
  const state = finding.state === 'open' ? 'open' : 'closed';
  return {
    title: `[Secret scanning] ${finding.type} (#${finding.number})`,
    body: [
      `<!-- secret-scanning-alert: ${finding.number} -->`,
      '## GitHub Secret scanning alert',
      '',
      `- **Alert:** [#${finding.number}](${finding.url})`,
      `- **Type:** ${finding.type}`,
      `- **State:** ${state}${finding.resolution ? ` (${finding.resolution})` : ''}`,
      `- **Created:** ${finding.createdAt || 'Unavailable'}`,
      `- **Last updated:** ${finding.updatedAt || 'Unavailable'}`,
      `- **Resolved:** ${finding.resolvedAt || 'Not resolved'}`,
      `- **Location:** ${finding.location}`,
      '',
      '### Remediation guidance',
      '',
      'Rotate or revoke the exposed credential, remove it from the affected location, and update any dependent services. Review repository history and follow the provider’s recovery guidance. Do not copy the secret value into this issue.',
    ].join('\n'),
    labels: [label],
    state,
  };
}

export function toFinding(finding) {
  return { marker: String(finding.number), issue: issueFor(finding) };
}

export async function secretScanningFindings(alerts, { locations }) {
  const findings = [];
  for (const alert of alerts) {
    const alertLocations = alert.state === 'open' ? (alert.locations ?? await locations(alert.locations_url)) : [];
    findings.push(toFinding(alertFinding(alert, alertLocations)));
  }
  return findings;
}
