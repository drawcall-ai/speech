import assert from "node:assert/strict";
import test from "node:test";
import {
  githubIssueBody,
  githubIssueTitle,
  syncSentryIssues,
} from "./sentry-issues.mjs";

const sentryIssue = {
  id: "4512345",
  shortId: "DESIGN-1",
  title: "TypeError: Canvas failed",
  culprit: "ProjectCanvas in render",
  permalink: "https://drawcallai.sentry.io/issues/4512345/",
  firstSeen: "2026-08-25T10:00:00Z",
  lastSeen: "2026-08-25T10:00:00Z",
  count: "1",
  level: "error",
};

test("creates one labeled GitHub issue for each untracked Sentry error", async () => {
  const requests = [];
  const request = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("sentry.io")) {
      return Response.json([sentryIssue]);
    }
    if (String(url).includes("/search/issues")) {
      return Response.json({ total_count: 0 });
    }
    return Response.json(
      { html_url: "https://github.com/drawcall-ai/cloud-design/issues/42" },
      { status: 201 },
    );
  };

  assert.deepEqual(
    await syncSentryIssues({
      githubRepository: "drawcall-ai/cloud-design",
      githubToken: "github-token",
      sentryOrganization: "drawcallai",
      sentryProject: "design",
      sentryToken: "sentry-token",
      request,
    }),
    [sentryIssue.id],
  );

  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /issue\.category%3Aerror/);
  assert.equal(requests[0].init.headers.authorization, "Bearer sentry-token");
  const created = JSON.parse(requests[2].init.body);
  assert.equal(created.title, "[Sentry] DESIGN-1: TypeError: Canvas failed");
  assert.deepEqual(created.labels, ["sentry"]);
  assert.match(created.body, /<!-- sentry-issue:4512345 -->/);
  assert.equal(requests[2].init.headers.authorization, "Bearer github-token");
});

test("does not recreate an issue whose Sentry marker is already on GitHub", async () => {
  let requests = 0;
  const created = await syncSentryIssues({
    githubRepository: "drawcall-ai/cloud-design",
    githubToken: "github-token",
    sentryOrganization: "drawcallai",
    sentryProject: "design",
    sentryToken: "sentry-token",
    request: async (url) => {
      requests += 1;
      return String(url).includes("sentry.io")
        ? Response.json([sentryIssue])
        : Response.json({ total_count: 1 });
    },
  });

  assert.deepEqual(created, []);
  assert.equal(requests, 2);
});

test("formats safe, bounded GitHub issue content", () => {
  assert.equal(
    githubIssueTitle({
      ...sentryIssue,
      title: `  failure\n${"x".repeat(300)}  `,
    }).length,
    256,
  );
  assert.match(
    githubIssueBody(
      { ...sentryIssue, culprit: "render`frame" },
      "<!-- sentry-issue:4512345 -->",
      "design",
    ),
    /Culprit: `render\\`frame`/,
  );
  assert.match(
    githubIssueBody(sentryIssue, "<!-- sentry-issue:4512345 -->", "design"),
    /Sentry `design` project/,
  );
});

test("surfaces malformed and failed upstream responses", async () => {
  const input = {
    githubRepository: "drawcall-ai/cloud-design",
    githubToken: "github-token",
    sentryOrganization: "drawcallai",
    sentryProject: "design",
    sentryToken: "sentry-token",
  };
  await assert.rejects(
    syncSentryIssues({
      ...input,
      request: async () => Response.json({ issues: [] }),
    }),
    /invalid issue list/,
  );
  await assert.rejects(
    syncSentryIssues({
      ...input,
      request: async () => new Response("forbidden", { status: 403 }),
    }),
    /403: forbidden/,
  );
});
