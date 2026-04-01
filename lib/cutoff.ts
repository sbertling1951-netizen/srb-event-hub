export function getCutoffLabel(cutoffIso: string, now = new Date()) {
  const cutoff = new Date(cutoffIso);
  const diffMs = cutoff.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    return { label: `Closed ${cutoff.toLocaleString()}`, kind: 'warn' as const };
  }
  if (diffDays <= 3) {
    return { label: `Closing soon: ${cutoff.toLocaleString()}`, kind: 'accent' as const };
  }
  return { label: `Open until ${cutoff.toLocaleString()}`, kind: 'ok' as const };
}
