import { json } from '@remix-run/node';
import { isCloudinaryConfigured } from '~/lib/.server/cloudinary';

export async function loader() {
  return json({
    configured: isCloudinaryConfigured(),
    requiredKeys: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  });
}
