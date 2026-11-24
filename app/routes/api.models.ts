import { json, type LoaderFunctionArgs } from '@remix-run/node';
import { getProvidersCatalog } from '~/lib/.server/llm/providers';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';

  const catalog = await getProvidersCatalog(forceRefresh);

  return json(catalog, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
