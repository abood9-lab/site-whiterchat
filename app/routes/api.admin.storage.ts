import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/node';
import { getCloudinaryConfig } from '~/lib/.server/cloudinary';
import {
  deleteDaytonaSandbox,
  getDaytonaAdminOverview,
  listCachedProjectBindings,
  stopProjectSandbox,
} from '~/lib/.server/daytona/client';
import { getPresenceAdminSnapshot } from '~/lib/.server/daytona/lifecycle';
import {
  getMigrationJobStatus,
  pauseCloudinaryMigration,
  startCloudinaryMigration,
} from '~/lib/.server/migration/cloudinaryToDaytona';
import { HttpAuthError, requireAuthenticatedUser } from '~/lib/.server/security/auth';

async function requireAdmin(request: Request) {
  const requester = await requireAuthenticatedUser(request);
  if (!requester.isAdmin) {
    throw new HttpAuthError(403, 'Administrator privileges required to access storage diagnostics.');
  }
  return requester;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await requireAdmin(request);

    const [daytonaOverview, presence, migration] = await Promise.all([
      getDaytonaAdminOverview(process.env),
      Promise.resolve(getPresenceAdminSnapshot()),
      Promise.resolve(getMigrationJobStatus()),
    ]);

    const cloudinaryConfig = getCloudinaryConfig(process.env);

    return json({
      ok: true,
      daytona: daytonaOverview,
      projectBindings: listCachedProjectBindings(),
      presence,
      migration,
      cloudinaryConfigured: Boolean(cloudinaryConfig),
      cloudinaryCloudName: cloudinaryConfig?.cloudName || null,
    });
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to load admin storage dashboard';
    return json({ error: message }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const admin = await requireAdmin(request);
    const body = (await request.json()) as {
      action?: 'startMigration' | 'pauseMigration' | 'retryFailedMigration' | 'stopSandbox' | 'testDeleteSandbox';
      sandboxId?: string;
    };

    switch (body.action) {
      case 'startMigration': {
        const job = await startCloudinaryMigration({
          startedByUid: admin.uid,
          idToken: admin.idToken,
          onlyFailedRetry: false,
          env: process.env,
        });
        return json({ ok: true, migration: job });
      }

      case 'retryFailedMigration': {
        const job = await startCloudinaryMigration({
          startedByUid: admin.uid,
          idToken: admin.idToken,
          onlyFailedRetry: true,
          env: process.env,
        });
        return json({ ok: true, migration: job });
      }

      case 'pauseMigration': {
        const job = pauseCloudinaryMigration();
        return json({ ok: true, migration: job });
      }

      case 'stopSandbox': {
        if (!body.sandboxId) {
          return json({ error: 'Missing sandboxId' }, { status: 400 });
        }
        const res = await stopProjectSandbox(body.sandboxId, { env: process.env });
        return json({ ok: true, ...res });
      }

      case 'testDeleteSandbox': {
        if (!body.sandboxId) {
          return json({ error: 'Missing sandboxId' }, { status: 400 });
        }
        await deleteDaytonaSandbox(body.sandboxId, process.env);
        return json({ ok: true, deletedSandboxId: body.sandboxId });
      }

      default:
        return json({ error: 'Unsupported admin action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Admin storage action failed';
    return json({ error: message }, { status: 500 });
  }
}
