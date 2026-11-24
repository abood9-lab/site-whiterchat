import { json, type ActionFunctionArgs } from '@remix-run/node';
import {
  isDaytonaConfigured,
  verifyAndGetProjectSandboxContext,
} from '~/lib/.server/daytona/client';
import { runSandboxShell } from '~/lib/.server/daytona/files';
import { beginWorkspaceOperation, endWorkspaceOperation } from '~/lib/.server/daytona/lifecycle';
import {
  assertProjectAccess,
  assertValidIdentifier,
  enforceRateLimit,
  HttpAuthError,
  requireAuthenticatedUser,
} from '~/lib/.server/security/auth';

function quoteShellArg(val: string): string {
  return `'${val.replace(/'/g, `\\''`)}'`;
}

export async function action({ request }: ActionFunctionArgs) {
  if (!isDaytonaConfigured(process.env)) {
    return json({ error: 'DAYTONA_API_KEY is not configured in server secrets.' }, { status: 400 });
  }

  try {
    const requester = await requireAuthenticatedUser(request);
    enforceRateLimit(`github_push:${requester.uid}`, 20, 60_000);

    const body = (await request.json()) as {
      userId?: string;
      projectId?: string;
      sandboxId?: string;
      githubToken?: string;
      repoName?: string;
      commitMessage?: string;
      isPrivate?: boolean;
    };

    const targetUid = body.userId ? assertValidIdentifier(body.userId, 'userId') : requester.uid;
    assertProjectAccess(requester, targetUid);
    const projectId = assertValidIdentifier(body.projectId || 'default_workspace', 'projectId');

    const token = body.githubToken?.trim();
    if (!token) {
      return json({ error: 'GitHub Personal Access Token (PAT) is required.' }, { status: 400 });
    }

    const repoName = (body.repoName || projectId || 'whiterchat-project')
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '-');
    const commitMessage = (body.commitMessage || 'Initial commit from WhiterChat Daytona Workspace').trim();
    const isPrivate = Boolean(body.isPrivate);

    const { ctx } = await verifyAndGetProjectSandboxContext({
      userId: targetUid,
      projectId,
      sandboxId: body.sandboxId,
      env: process.env,
    });

    const opId = `gh_${Date.now().toString(36)}`;
    beginWorkspaceOperation(targetUid, projectId, opId);

    try {
      // 1. Fetch authenticated GitHub username using curl with the token
      const userRes = await runSandboxShell(
        ctx,
        `curl -s -H "Authorization: token ${token}" https://api.github.com/user`,
      );
      if (userRes.exitCode !== 0) {
        throw new Error('Failed to connect to GitHub API using provided token.');
      }

      let githubUsername = '';
      try {
        const userData = JSON.parse(userRes.output);
        githubUsername = userData.login || '';
      } catch {
        // ignore
      }

      if (!githubUsername) {
        throw new Error('Invalid GitHub token or unable to retrieve GitHub username.');
      }

      // 2. Create GitHub repository via API (if it doesn't already exist)
      const createRepoPayload = JSON.stringify({
        name: repoName,
        private: isPrivate,
        description: 'Created by WhiterChat AI Developer Platform with Daytona Persistent Storage',
      });
      const createRes = await runSandboxShell(
        ctx,
        `curl -s -X POST -H "Authorization: token ${token}" -H "Content-Type: application/json" -d ${quoteShellArg(createRepoPayload)} https://api.github.com/user/repos`,
      );

      let remoteUrl = `https://${token}@github.com/${githubUsername}/${repoName}.git`;
      let htmlUrl = `https://github.com/${githubUsername}/${repoName}`;

      try {
        const repoData = JSON.parse(createRes.output);
        if (repoData.clone_url) {
          htmlUrl = repoData.html_url || htmlUrl;
          const parsedClone = new URL(repoData.clone_url);
          remoteUrl = `https://${token}@${parsedClone.host}${parsedClone.pathname}`;
        }
      } catch {
        // proceed with default remoteUrl
      }

      // 3. Configure git user inside /workspace and initialize/commit/push
      const gitCommands = [
        `cd /workspace`,
        `git config --global user.name "${githubUsername}"`,
        `git config --global user.email "${githubUsername}@users.noreply.github.com"`,
        `if [ ! -d .git ]; then git init; fi`,
        `git checkout -B main`,
        `git add -A`,
        `git status`,
        `git commit -m ${quoteShellArg(commitMessage)} || true`,
        `git remote remove origin 2>/dev/null || true`,
        `git remote add origin ${quoteShellArg(remoteUrl)}`,
        `git push -u origin main --force`,
      ].join(' && ');

      const pushRes = await runSandboxShell(ctx, gitCommands);
      if (pushRes.exitCode !== 0) {
        throw new Error(`Git push failed: ${pushRes.output.trim() || 'Unknown error'}`);
      }

      return json({
        ok: true,
        repoName,
        githubUsername,
        htmlUrl,
        output: pushRes.output.slice(-1500),
      });
    } finally {
      endWorkspaceOperation(targetUid, projectId, opId);
    }
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'GitHub export failed';
    return json({ error: message }, { status: 500 });
  }
}
