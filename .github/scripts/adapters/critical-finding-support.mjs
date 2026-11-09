export const label = 'critical-finding';

export function normalizeScanner(scanner) {
  return scanner.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeLocation(location = '') {
  let value = String(location).replace(/^file:\/\//, '').replaceAll('\\', '/').replace(/^\.\//, '');
  value = value.replace(/:(\d+):\d+$/, ':$1');
  return value.replace(/\/{2,}/g, '/');
}

export function fingerprintFor(finding) {
  const scanner = normalizeScanner(finding.scanner);
  if (finding.stableId) return `${scanner}:${finding.stableId}`;
  return `${scanner}:${finding.ruleId}:${normalizeLocation(finding.location)}`;
}

export function markerFromIssue(issue) {
  return issue.body?.match(/<!-- critical-finding fingerprint: (.*?) -->/)?.[1];
}

function originFromIssue(issue) {
  const origin = issue.body?.match(/<!-- critical-finding origin: (.*?) -->/)?.[1];
  return origin === 'none' ? null : origin;
}

function issueBody(finding, fingerprint, originatingRunUrl) {
  const link = (text, url) => url ? `[${text}](${url})` : 'Unavailable';
  return [
    `<!-- critical-finding fingerprint: ${fingerprint} -->`,
    `<!-- critical-finding origin: ${originatingRunUrl ?? 'none'} -->`,
    `## ${finding.summary || finding.ruleId}`,
    '',
    `- **Severity:** Critical`,
    `- **Scanner:** ${finding.scanner}`,
    `- **Rule:** \`${finding.ruleId}\``,
    `- **Affected location:** \`${finding.location || 'Unavailable'}\``,
    `- **Latest run:** ${link('View latest run', finding.latestRunUrl)}`,
    `- **Originating run:** ${link('View originating run', originatingRunUrl)}`,
    ...(finding.sourceUrl ? [`- **Scanner finding:** ${link('View finding', finding.sourceUrl)}`] : []),
    '',
    '### Evidence',
    '',
    finding.evidence || 'The scanner did not provide evidence details.',
    '',
    '### Remediation guidance',
    '',
    finding.remediation || 'Review the linked scanner finding and apply the recommended fix.',
  ].join('\n');
}

export function toFinding(finding, { existingIssue } = {}) {
  const fingerprint = fingerprintFor(finding);
  const previousOrigin = originFromIssue(existingIssue ?? {});
  const originatingRunUrl = previousOrigin !== undefined
    ? previousOrigin
    : finding.originatingRunUrl === null ? undefined : finding.originatingRunUrl || finding.latestRunUrl;
  return {
    marker: fingerprint,
    issue: {
      title: `[Critical] ${finding.summary || finding.ruleId}`,
      body: issueBody(finding, fingerprint, originatingRunUrl),
      labels: [label],
      state: 'open',
    },
  };
}
