// Dependency submission API: POST /repos/{owner}/{repo}/dependency-graph/snapshots
export async function submitSnapshot({ snapshot, repository, token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const res = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}/repos/${repository}/dependency-graph/snapshots`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(snapshot),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 404
      ? '\nThe job needs `permissions: contents: write` and the dependency graph must be enabled.'
      : '';
    throw new Error(`Dependency submission failed (HTTP ${res.status}): ${text}${hint}`);
  }
  return JSON.parse(text);
}
