export async function reconcileFindings(issueStore, {
  findings, markerFromIssue, closeUnseen = false, matchesScope = () => true, log = console.warn,
  existingIssues,
}) {
  existingIssues ??= await issueStore.list();
  const byMarker = new Map(existingIssues.map((issue) => [markerFromIssue(issue), issue]));
  const seen = new Set();

  for (const finding of findings) {
    seen.add(finding.marker);
    const existing = byMarker.get(finding.marker);
    if (!existing && finding.issue.state !== 'open') continue;
    try {
      if (existing) await issueStore.update(existing.number, finding.issue);
      else await issueStore.create(finding.issue);
    } catch {
      log(`Could not reconcile finding ${finding.marker}; continuing with remaining findings.`);
    }
  }

  if (!closeUnseen) return;
  for (const issue of existingIssues) {
    const markerValue = markerFromIssue(issue);
    if (markerValue && matchesScope(markerValue) && !seen.has(markerValue) && issue.state === 'open') {
      try {
        await issueStore.update(issue.number, { state: 'closed' });
      } catch {
        log(`Could not close issue #${issue.number}; continuing with remaining issues.`);
      }
    }
  }
}
