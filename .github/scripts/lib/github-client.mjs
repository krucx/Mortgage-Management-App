async function getAllPages(request, path) {
  const results = [];
  let next = path;
  while (next) {
    const response = await request(next);
    if (!Array.isArray(response.data)) throw new Error(`Expected a list from ${next}`);
    results.push(...response.data);
    next = response.next;
  }
  return results;
}

export function createGitHubClient(token, repository) {
  const base = `https://api.github.com/repos/${repository}`;
  async function request(path, method = 'GET', body) {
    const response = await fetch(path.startsWith('https://') ? path : `${base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${await response.text()}`);
    const data = response.status === 204 ? undefined : await response.json();
    const link = response.headers.get('link') ?? '';
    const next = link.split(',').find((part) => part.includes('rel="next"'))?.match(/<([^>]+)>/)?.[1];
    return { data, next };
  }

  return {
    request,
    getAllPages: (path) => getAllPages(request, path),
    issuesLabeled(label) {
      return {
        async list() {
          return getAllPages(request, `/issues?state=all&labels=${label}&per_page=100`);
        },
        async create(issue) {
          return (await request('/issues', 'POST', issue)).data;
        },
        async update(number, changes) {
          return (await request(`/issues/${number}`, 'PATCH', changes)).data;
        },
      };
    },
    async ensureLabel({ name, color, description }) {
      try {
        await request(`/labels/${name}`);
      } catch (error) {
        if (!String(error).includes('(404)')) throw error;
        await request('/labels', 'POST', { name, color, description });
      }
    },
  };
}
