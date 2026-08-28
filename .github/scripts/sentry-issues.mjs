import { fileURLToPath } from "node:url";

const defaultSentryOrigin = "https://de.sentry.io";
const githubOrigin = "https://api.github.com";
const requestTimeoutMs = 15_000;

export async function syncSentryIssues({
  githubRepository,
  githubToken,
  sentryOrganization,
  sentryProject,
  sentryToken,
  request = fetch,
  sentryOrigin = defaultSentryOrigin,
}) {
  const issues = await listSentryIssues({
    organization: sentryOrganization,
    project: sentryProject,
    request,
    sentryOrigin,
    token: sentryToken,
  });
  const created = [];

  for (const issue of issues) {
    const marker = `<!-- sentry-issue:${issue.id} -->`;
    if (
      await githubIssueExists({
        marker,
        repository: githubRepository,
        request,
        token: githubToken,
      })
    ) {
      continue;
    }

    await createGithubIssue({
      issue,
      marker,
      project: sentryProject,
      repository: githubRepository,
      request,
      token: githubToken,
    });
    created.push(issue.id);
  }

  return created;
}

export function githubIssueTitle(issue) {
  const title = inlineText(issue.title, "Untitled Sentry error");
  const shortId = inlineText(issue.shortId, "SENTRY");
  return `[Sentry] ${shortId}: ${title}`.slice(0, 256);
}

export function githubIssueBody(issue, marker, project) {
  const lines = [
    "## Sentry error",
    "",
    `[Open ${inlineText(issue.shortId, "the issue")} in Sentry](${issue.permalink})`,
    "",
    `- First seen: ${issue.firstSeen}`,
    `- Last seen: ${issue.lastSeen}`,
    `- Events: ${issue.count}`,
    `- Level: ${inlineText(issue.level, "unknown")}`,
  ];
  const culprit = inlineText(issue.culprit, "");
  if (culprit) lines.push(`- Culprit: \`${culprit.replaceAll("`", "\\`")}\``);
  lines.push(
    "",
    `Created automatically from a new error in the Sentry \`${project}\` project.`,
    "",
    marker,
  );
  return lines.join("\n");
}

async function listSentryIssues({
  organization,
  project,
  request,
  sentryOrigin,
  token,
}) {
  const url = new URL(
    `/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/issues/`,
    sentryOrigin,
  );
  url.searchParams.set("query", "is:unresolved issue.category:error");
  url.searchParams.set("sort", "new");
  url.searchParams.set("statsPeriod", "");
  url.searchParams.set("limit", "100");
  const body = await requestJson(
    request,
    url,
    { headers: { authorization: `Bearer ${token}` } },
    "Sentry issues",
  );
  if (!Array.isArray(body))
    throw new Error("Sentry returned an invalid issue list");
  return body.map(parseSentryIssue);
}

async function githubIssueExists({ marker, repository, request, token }) {
  const url = new URL("/search/issues", githubOrigin);
  url.searchParams.set(
    "q",
    `repo:${repository} is:issue in:body \"${marker}\"`,
  );
  const body = await requestJson(
    request,
    url,
    { headers: githubHeaders(token) },
    "GitHub issue search",
  );
  if (!isRecord(body) || typeof body.total_count !== "number") {
    throw new Error("GitHub returned an invalid issue search result");
  }
  return body.total_count > 0;
}

async function createGithubIssue({
  issue,
  marker,
  project,
  repository,
  request,
  token,
}) {
  const body = await requestJson(
    request,
    new URL(`/repos/${repository}/issues`, githubOrigin),
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({
        title: githubIssueTitle(issue),
        body: githubIssueBody(issue, marker, project),
        labels: ["sentry"],
      }),
    },
    "GitHub issue creation",
  );
  if (!isRecord(body) || typeof body.html_url !== "string") {
    throw new Error("GitHub returned an invalid created issue");
  }
  console.log(`Created ${body.html_url}`);
}

async function requestJson(request, url, init, label) {
  const response = await request(url, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`${label} returned ${response.status}: ${detail}`);
  }
  return response.json();
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

function parseSentryIssue(value) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.permalink !== "string" ||
    typeof value.firstSeen !== "string" ||
    typeof value.lastSeen !== "string" ||
    typeof value.count !== "string"
  ) {
    throw new Error("Sentry returned an invalid issue");
  }
  return value;
}

function inlineText(value, fallback) {
  if (typeof value !== "string") return fallback;
  return value.replaceAll(/\s+/g, " ").trim() || fallback;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const created = await syncSentryIssues({
    githubRepository: requiredEnvironment("GITHUB_REPOSITORY"),
    githubToken: requiredEnvironment("GITHUB_TOKEN"),
    sentryOrganization: requiredEnvironment("SENTRY_ORG"),
    sentryProject: requiredEnvironment("SENTRY_PROJECT"),
    sentryToken: requiredEnvironment("SENTRY_AUTH_TOKEN"),
  });
  console.log(
    created.length === 0
      ? "No new Sentry issues."
      : `Created ${created.length} GitHub issue${created.length === 1 ? "" : "s"}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
