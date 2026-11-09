export function dependabotFinding(alert) {
  const security = alert.security_vulnerability ?? {};
  const advisory = alert.security_advisory ?? {};
  const dependency = alert.dependency ?? {};
  const packageName = dependency.package?.name ?? 'Unknown package';
  const file = dependency.manifest_path ?? 'Unknown manifest';
  const patched = security.first_patched_version?.identifier;
  return {
    scanner: 'Dependabot',
    stableId: String(alert.number),
    severity: security.severity ?? advisory.severity ?? '',
    ruleId: advisory.ghsa_id ?? `dependabot-alert-${alert.number}`,
    location: `${file}:${packageName}`,
    summary: `${packageName}: ${advisory.summary ?? advisory.description ?? 'Vulnerable dependency'}`,
    evidence: `${packageName} is affected by ${advisory.ghsa_id ?? 'a security advisory'} in ${file}.`,
    remediation: patched ? `Upgrade to version ${patched} or later.` : 'Upgrade to a version that is no longer affected by this advisory.',
    latestRunUrl: null,
    originatingRunUrl: null,
    sourceUrl: alert.html_url,
  };
}
