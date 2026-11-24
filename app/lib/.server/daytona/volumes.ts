import type { Daytona } from '@daytona/sdk';
import { assertValidIdentifier } from '~/lib/.server/security/auth';

export const DEFAULT_PROJECT_VOLUME_NAME = 'whiterchat-project-storage';
export const VOLUME_READY_POLL_INTERVAL_MS = 1500;
export const VOLUME_READY_TIMEOUT_MS = 90_000;

export interface CentralVolumeInfo {
  id: string;
  name: string;
  status: string;
  sizeGib?: number;
  usedBytes?: number;
}

export function getProjectVolumeName(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DAYTONA_PROJECT_VOLUME_NAME?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_PROJECT_VOLUME_NAME;
}

export function buildIsolatedProjectSubpath(userId: string, projectId: string): string {
  const safeUid = assertValidIdentifier(userId, 'userId');
  const safeProjectId = assertValidIdentifier(projectId, 'projectId');
  return `users/${safeUid}/projects/${safeProjectId}`;
}

export function buildUserProfileSubpath(userId: string): string {
  const safeUid = assertValidIdentifier(userId, 'userId');
  return `users/${safeUid}/_profile`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureCentralProjectVolume(
  daytona: Daytona,
  useV0: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CentralVolumeInfo> {
  const volumeName = getProjectVolumeName(env);
  const deadline = Date.now() + VOLUME_READY_TIMEOUT_MS;

  if (useV0) {
    let volume = await daytona.v0.volume.get(volumeName, true);

    while (volume.state !== 'ready') {
      if (volume.state === 'error' || volume.state === 'deleted' || volume.state === 'deleting') {
        throw new Error(`Daytona Volume "${volumeName}" is in terminal state "${volume.state}"${volume.errorReason ? `: ${volume.errorReason}` : ''}.`);
      }

      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for Daytona Volume "${volumeName}" to reach ready state (last state: ${volume.state}).`);
      }

      await sleep(VOLUME_READY_POLL_INTERVAL_MS);
      volume = await daytona.v0.volume.get(volumeName, false);
    }

    return {
      id: volume.id,
      name: volume.name,
      status: volume.state,
    };
  }

  let volume = await daytona.v2.volumes.get(volumeName, { create: true });

  while (volume.status !== 'ready') {
    if (volume.status === 'error' || volume.status === 'deleted' || volume.status === 'deleting') {
      throw new Error(`Daytona Volume "${volumeName}" entered state "${volume.status}"${volume.error ? `: ${volume.error}` : ''}.`);
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for Daytona Volume "${volumeName}" to reach ready state (last status: ${volume.status}).`);
    }

    await sleep(VOLUME_READY_POLL_INTERVAL_MS);
    volume = await daytona.v2.volumes.get(volumeName, { create: false });
  }

  return {
    id: volume.id,
    name: volume.name,
    status: volume.status,
    sizeGib: volume.sizeGib,
    usedBytes: volume.usedBytes,
  };
}

export async function inspectCentralProjectVolume(
  daytona: Daytona,
  useV0: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<(CentralVolumeInfo & { exists: boolean }) | { exists: false; name: string; status: string }> {
  const volumeName = getProjectVolumeName(env);

  try {
    if (useV0) {
      const vol = await daytona.v0.volume.get(volumeName, false);
      return {
        exists: true,
        id: vol.id,
        name: vol.name,
        status: vol.state,
      };
    }

    const vol = await daytona.v2.volumes.get(volumeName, { create: false });
    return {
      exists: true,
      id: vol.id,
      name: vol.name,
      status: vol.status,
      sizeGib: vol.sizeGib,
      usedBytes: vol.usedBytes,
    };
  } catch {
    return {
      exists: false,
      name: volumeName,
      status: 'not_created',
    };
  }
}
