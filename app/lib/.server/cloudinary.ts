import crypto from 'node:crypto';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function getCloudinaryConfig(envOverride?: Record<string, string | undefined>): CloudinaryConfig | null {
  const rawUrl = process.env.CLOUDINARY_URL || envOverride?.CLOUDINARY_URL || '';

  if (rawUrl.startsWith('cloudinary://')) {
    try {
      const parsed = new URL(rawUrl);
      const cloudName = parsed.hostname;
      const apiKey = decodeURIComponent(parsed.username);
      const apiSecret = decodeURIComponent(parsed.password);

      if (cloudName && apiKey && apiSecret) {
        return { cloudName, apiKey, apiSecret };
      }
    } catch {
      // fall through to individual env vars
    }
  }

  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || envOverride?.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || envOverride?.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || envOverride?.CLOUDINARY_API_SECRET || '').trim();

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  return { cloudName, apiKey, apiSecret };
}

export function isCloudinaryConfigured(envOverride?: Record<string, string | undefined>): boolean {
  return getCloudinaryConfig(envOverride) !== null;
}

function signCloudinaryParams(params: Record<string, string>, apiSecret: string): string {
  const sortedKeys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort();
  const paramString = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');

  return crypto.createHash('sha1').update(`${paramString}${apiSecret}`).digest('hex');
}

function sanitizePublicId(rawPath: string): string {
  const cleaned = rawPath
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._/-]/g, '_')
    .replace(/\/+/g, '/');

  return cleaned
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith('.') ? `_dot_${segment.slice(1)}` : segment))
    .join('/')
    .slice(0, 180);
}

export interface UploadToCloudinaryInput {
  path: string;
  userId: string;
  chatId?: string;
  contentBase64?: string;
  contentText?: string;
  mimeType?: string;
  resourceType?: 'image' | 'raw' | 'video' | 'auto';
}

export interface UploadToCloudinaryResult {
  secureUrl: string;
  publicId: string;
  resourceType: string;
  bytes: number;
  format?: string;
  version?: number;
}

export async function uploadToCloudinary(
  input: UploadToCloudinaryInput,
  envOverride?: Record<string, string | undefined>,
): Promise<UploadToCloudinaryResult> {
  const config = getCloudinaryConfig(envOverride);

  if (!config) {
    throw new Error(
      'Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not configured.',
    );
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = `bolt_projects/${sanitizePublicId(input.userId)}${input.chatId ? `/${sanitizePublicId(input.chatId)}` : ''}`;
  const publicId = sanitizePublicId(input.path) || `file_${timestamp}`;
  const resourceType = input.resourceType || (input.mimeType?.startsWith('image/') ? 'image' : 'raw');

  const paramsToSign: Record<string, string> = {
    folder,
    overwrite: 'true',
    public_id: publicId,
    timestamp,
  };

  const signature = signCloudinaryParams(paramsToSign, config.apiSecret);

  const formData = new FormData();

  if (input.contentBase64) {
    const cleanBase64 = input.contentBase64.includes(',')
      ? input.contentBase64.split(',')[1]
      : input.contentBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    const blob = new Blob([buffer], { type: input.mimeType || 'application/octet-stream' });
    formData.append('file', blob, input.path.split('/').pop() || 'upload.bin');
  } else if (typeof input.contentText === 'string') {
    const blob = new Blob([input.contentText], { type: input.mimeType || 'text/plain;charset=utf-8' });
    formData.append('file', blob, input.path.split('/').pop() || 'code.txt');
  } else {
    throw new Error('Either contentBase64 or contentText is required.');
  }

  formData.append('api_key', config.apiKey);
  formData.append('timestamp', timestamp);
  formData.append('folder', folder);
  formData.append('public_id', publicId);
  formData.append('overwrite', 'true');
  formData.append('signature', signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/upload`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  const payload = (await response.json()) as {
    secure_url?: string;
    public_id?: string;
    resource_type?: string;
    bytes?: number;
    format?: string;
    version?: number;
    error?: { message?: string };
  };

  if (!response.ok || !payload.secure_url) {
    throw new Error(payload.error?.message || `Cloudinary upload failed with HTTP ${response.status}`);
  }

  return {
    secureUrl: payload.secure_url,
    publicId: payload.public_id || `${folder}/${publicId}`,
    resourceType: payload.resource_type || resourceType,
    bytes: payload.bytes ?? 0,
    format: payload.format,
    version: payload.version,
  };
}
