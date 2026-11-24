import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { requireAuthenticatedUser, HttpAuthError } from '~/lib/.server/security/auth';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    await requireAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    return json({ error: 'Authentication required.' }, { status: 401 });
  }

  return json(
    {
      code: 'CLOUDINARY_RETIRED',
      error:
        'New project-file uploads to Cloudinary are retired. All files and media are stored directly inside persistent Daytona Volumes.',
      migrateTo: '/api/workspace/upload',
    },
    { status: 410 },
  );
}
