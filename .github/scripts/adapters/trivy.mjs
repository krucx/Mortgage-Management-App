export function trivyFindingsFromSarif(sarif, runUrl) {
  if (!sarif || !Array.isArray(sarif.runs) || sarif.runs.length === 0) {
    throw new Error('Trivy SARIF has no completed scan runs.');
  }
  const findings = [];
  for (const run of sarif.runs) {
    const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));
    for (const result of run.results ?? []) {
      const rule = rules.get(result.ruleId) ?? {};
      const tags = rule.properties?.tags ?? [];
      if (!tags.some((tag) => String(tag).toLowerCase() === 'critical')) continue;
      const location = result.locations?.[0] ?? {};
      const physical = location.physicalLocation ?? {};
      const artifact = physical.artifactLocation?.uri ?? '';
      const locationMessage = location.message?.text;
      const line = physical.region?.startLine;
      const partialFingerprints = result.partialFingerprints ?? result.fingerprints ?? {};
      const scannerId = Object.values(partialFingerprints).find(Boolean);
      findings.push({
        scanner: 'Trivy',
        stableId: scannerId ? `${result.ruleId}:${scannerId}` : undefined,
        severity: 'critical',
        ruleId: result.ruleId ?? 'unknown-rule',
        location: [artifact, locationMessage, line ? `line ${line}` : ''].filter(Boolean).join(' — '),
        summary: rule.shortDescription?.text ?? rule.fullDescription?.text ?? result.ruleId ?? 'Trivy finding',
        evidence: result.message?.text ?? rule.fullDescription?.text,
        remediation: rule.help?.markdown ?? rule.help?.text ?? 'Review the Trivy finding and apply the recommended package update.',
        latestRunUrl: runUrl,
        originatingRunUrl: runUrl,
        sourceUrl: rule.helpUri,
      });
    }
  }
  return findings;
}
