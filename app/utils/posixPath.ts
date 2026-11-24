function splitSegments(rawPath: string): string[] {
  const parts = rawPath.replace(/\\/g, '/').split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else if (!rawPath.startsWith('/')) {
        resolved.push('..');
      }
      continue;
    }
    resolved.push(part);
  }

  return resolved;
}

export function posixNormalize(rawPath: string): string {
  if (!rawPath) {
    return '.';
  }
  const isAbs = rawPath.startsWith('/');
  const joined = splitSegments(rawPath).join('/');
  if (isAbs) {
    return `/${joined}`;
  }
  return joined || '.';
}

export function posixDirname(rawPath: string): string {
  if (!rawPath) {
    return '.';
  }
  const cleaned = rawPath.replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!cleaned) {
    return rawPath.startsWith('/') ? '/' : '.';
  }
  const idx = cleaned.lastIndexOf('/');
  if (idx === -1) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return cleaned.slice(0, idx);
}

export function posixBasename(rawPath: string, ext?: string): string {
  if (!rawPath) {
    return '';
  }
  const cleaned = rawPath.replace(/\\/g, '/').replace(/\/+$/g, '');
  const idx = cleaned.lastIndexOf('/');
  const base = idx === -1 ? cleaned : cleaned.slice(idx + 1);
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
}

export function posixExtname(rawPath: string): string {
  const base = posixBasename(rawPath);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) {
    return '';
  }
  return base.slice(idx);
}

export function posixJoin(...segments: string[]): string {
  const nonEmpty = segments.filter((s) => typeof s === 'string' && s.length > 0);
  if (nonEmpty.length === 0) {
    return '.';
  }
  return posixNormalize(nonEmpty.join('/'));
}

export function posixResolve(...segments: string[]): string {
  let resolved = '';
  let resolvedAbsolute = false;

  for (let i = segments.length - 1; i >= 0 && !resolvedAbsolute; i--) {
    const seg = segments[i];
    if (!seg) {
      continue;
    }
    resolved = resolved ? `${seg}/${resolved}` : seg;
    resolvedAbsolute = seg.startsWith('/');
  }

  const normalized = splitSegments(resolved).join('/');
  return resolvedAbsolute ? `/${normalized}` : normalized || '.';
}

export function posixRelative(from: string, to: string): string {
  const fromParts = splitSegments(posixResolve('/', from));
  const toParts = splitSegments(posixResolve('/', to));

  let common = 0;
  const max = Math.min(fromParts.length, toParts.length);
  while (common < max && fromParts[common] === toParts[common]) {
    common++;
  }

  const up = new Array(fromParts.length - common).fill('..');
  const down = toParts.slice(common);
  return [...up, ...down].join('/');
}

export function normalizeWorkspaceRelPath(filePath: string): string {
  return filePath
    .replace(/^\/home\/project\/?/, '')
    .replace(/^\/home\/daytona\/project\/?/, '')
    .replace(/^\/workspace\/?/, '')
    .replace(/^\/+/, '');
}

export const sep = '/';
export const delimiter = ':';
export const dirname = posixDirname;
export const basename = posixBasename;
export const extname = posixExtname;
export const normalize = posixNormalize;
export const join = posixJoin;
export const resolve = posixResolve;
export const relative = posixRelative;

export const posix = {
  sep,
  delimiter,
  dirname,
  basename,
  extname,
  normalize,
  join,
  resolve,
  relative,
};

export default {
  ...posix,
  posix,
};
