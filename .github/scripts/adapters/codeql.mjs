export function codeScanningFinding(alert, scanner, runUrl) {
  const instance = alert.most_recent_instance ?? {};
  const location = instance.location ?? {};
  const rule = alert.rule ?? {};
  return {
    scanner,
    stableId: alert.number === undefined ? undefined : String(alert.number),
    severity: rule.security_severity_level ?? rule.severity ?? '',
    ruleId: rule.id ?? 'unknown-rule',
    location: [location.path, location.start_line].filter(Boolean).join(':'),
    summary: instance.message?.text ?? rule.description ?? rule.name ?? rule.id,
    evidence: instance.message?.text ?? rule.description,
    remediation: rule.help ?? 'Review the scanner finding and apply its recommended fix.',
    latestRunUrl: runUrl,
    originatingRunUrl: runUrl,
    sourceUrl: alert.html_url,
  };
}
