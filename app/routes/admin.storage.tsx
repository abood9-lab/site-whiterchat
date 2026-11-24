import type { User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { auth, getFirebaseIdToken, onAuthStateChanged } from '~/lib/firebase';
import { classNames } from '~/utils/classNames';

interface AdminOverviewResponse {
  ok: boolean;
  daytona: {
    configured: boolean;
    volume: {
      exists: boolean;
      name: string;
      volumeId?: string;
      state?: string;
      error?: string;
    };
    sandboxesCount: number;
    sandboxes: Array<{
      id: string;
      state: string;
      labels?: Record<string, string>;
    }>;
  };
  projectBindings: Array<{
    ownerUid?: string;
    userId?: string;
    projectId: string;
    sandboxId: string;
    volumeName: string;
    volumeSubpath: string;
    status: string;
  }>;
  presence: {
    activeSessions: Array<{
      sessionId: string;
      userId: string;
      projectId: string;
      sandboxId: string;
      lastHeartbeatAt: number;
    }>;
    activeOperationProjects: Array<{ projectKey: string; activeCount: number }>;
    pendingShutdownsCount: number;
    recentEvents: Array<{
      timestamp: string;
      event: string;
      projectId: string;
      userId: string;
      sandboxId: string;
      detail?: string;
    }>;
  };
  migration: {
    jobId: string;
    status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
    totalDiscovered: number;
    completedCount: number;
    skippedCount: number;
    failedCount: number;
    startedAt: string;
    updatedAt: string;
    items: Array<{
      itemId: string;
      ownerId: string;
      projectId: string;
      kind: 'project' | 'profile';
      relativePath: string;
      destinationSubpath: string;
      status: string;
      sha256?: string;
      bytes?: number;
      verifiedBytes?: number;
      attempts: number;
      errorMessage?: string;
    }>;
  };
  cloudinaryConfigured: boolean;
  cloudinaryCloudName: string | null;
}

export default function AdminStorageDashboardPage() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminOverviewResponse | null>(null);

  const fetchOverview = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }

    try {
      const idToken = await getFirebaseIdToken();
      if (!idToken) {
        setData(null);
        setError('Authentication required to view storage administration.');
        return;
      }

      const res = await fetch('/api/admin/storage', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      const body = (await res.json()) as AdminOverviewResponse & { error?: string };
      if (!res.ok) {
        setError(body.error || `Request failed with HTTP ${res.status}`);
        setData(null);
        return;
      }

      setError(null);
      setData(body);
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin storage overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (user) {
        void fetchOverview();
      } else {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [fetchOverview]);

  useEffect(() => {
    if (!data || data.migration.status !== 'running') {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchOverview(true);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [data, fetchOverview]);

  const runAdminAction = async (
    action: 'startMigration' | 'pauseMigration' | 'retryFailedMigration' | 'stopSandbox' | 'testDeleteSandbox',
    sandboxId?: string,
  ) => {
    setActionBusy(true);
    try {
      const idToken = await getFirebaseIdToken();
      if (!idToken) {
        toast.error('Please sign in first.');
        return;
      }

      const res = await fetch('/api/admin/storage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action, sandboxId }),
      });

      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Action failed');
      }

      toast.success(`Executed ${action}`);
      await fetchOverview(true);
    } catch (err: any) {
      toast.error(err?.message || 'Admin action failed');
    } finally {
      setActionBusy(false);
    }
  };

  if (!authReady || loading) {
    return (
      <div className="min-h-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-bolt-elements-textSecondary">
          <span className="i-svg-spinners:90-ring-with-bg text-xl text-bolt-elements-item-contentAccent" />
          <span>Loading Daytona Volume &amp; Migration Diagnostics...</span>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary flex items-center justify-center p-6">
        <div className="max-w-md w-full p-6 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 space-y-4 text-center">
          <span className="i-ph:shield-warning text-3xl text-bolt-elements-item-contentAccent block mx-auto" />
          <h1 className="text-lg font-semibold">Sign In Required</h1>
          <p className="text-sm text-bolt-elements-textSecondary">
            Sign in with a verified administrator account to manage Daytona Volumes and run the Cloudinary migration.
          </p>
          <a
            href="/auth?mode=signin"
            className="inline-flex h-10 items-center justify-center px-5 rounded-lg text-sm font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary flex items-center justify-center p-6">
        <div className="max-w-lg w-full p-6 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 space-y-4">
          <div className="flex items-center gap-2.5 text-bolt-elements-icon-error">
            <span className="i-ph:lock-key text-2xl shrink-0" />
            <h1 className="text-lg font-semibold text-bolt-elements-textPrimary">Administrator Access Required</h1>
          </div>
          <p className="text-sm text-bolt-elements-textSecondary">{error || 'Unable to load storage metrics.'}</p>
          <div className="flex items-center gap-3 pt-2">
            <a
              href="/chat/new"
              className="inline-flex h-9 items-center px-4 rounded-lg text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor"
            >
              Back to Workspace
            </a>
            <button
              type="button"
              onClick={() => fetchOverview()}
              className="inline-flex h-9 items-center px-4 rounded-lg text-xs font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const processed = data.migration.completedCount + data.migration.skippedCount;
  const total = data.migration.totalDiscovered;
  const progressPct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div className="min-h-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary p-6 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-bolt-elements-borderColor">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="i-ph:hard-drives text-2xl text-bolt-elements-item-contentAccent" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Daytona Volumes &amp; Storage Migration
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-bolt-elements-textSecondary">
              Central persistent storage inspection, sandbox lifecycle monitoring, and read-only Cloudinary cutover verification.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={loading || actionBusy}
              onClick={() => fetchOverview()}
              className="inline-flex h-9 items-center gap-1.5 px-3.5 rounded-lg text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor cursor-pointer disabled:opacity-50"
            >
              <span className="i-ph:arrows-clockwise text-sm" />
              <span>Refresh</span>
            </button>
            <a
              href="/chat/new"
              className="inline-flex h-9 items-center gap-1.5 px-4 rounded-lg text-xs font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover"
            >
              <span className="i-ph:arrow-left text-sm" />
              <span>Workspace</span>
            </a>
          </div>
        </header>

        {/* KPI Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 space-y-1.5">
            <div className="text-xs text-bolt-elements-textSecondary">Central Daytona Volume</div>
            <div className="text-sm font-mono font-semibold truncate">{data.daytona.volume.name}</div>
            <div className="text-xs flex items-center gap-1.5">
              <span
                className={classNames(
                  'w-2 h-2 rounded-full',
                  data.daytona.volume.exists ? 'bg-emerald-500' : 'bg-amber-500',
                )}
              />
              <span className="text-bolt-elements-textSecondary">
                {data.daytona.volume.exists
                  ? `${data.daytona.volume.state || 'ready'} (${data.daytona.volume.volumeId?.slice(0, 10) || 'bound'})`
                  : data.daytona.volume.error || 'Not provisioned yet'}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 space-y-1.5">
            <div className="text-xs text-bolt-elements-textSecondary">Daytona Sandboxes</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{data.daytona.sandboxesCount}</div>
            <div className="text-xs text-bolt-elements-textSecondary">
              {data.projectBindings.length} cached project binding{data.projectBindings.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 space-y-1.5">
            <div className="text-xs text-bolt-elements-textSecondary">Active Presence Sessions</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{data.presence.activeSessions.length}</div>
            <div className="text-xs text-bolt-elements-textSecondary">
              {data.presence.pendingShutdownsCount} pending grace shutdown{data.presence.pendingShutdownsCount === 1 ? '' : 's'}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 space-y-1.5">
            <div className="text-xs text-bolt-elements-textSecondary">Legacy Cloudinary Status</div>
            <div className="text-sm font-semibold">
              {data.cloudinaryConfigured ? 'Read-Only Migration Source' : 'Not Configured'}
            </div>
            <div className="text-xs text-bolt-elements-textSecondary">
              {data.cloudinaryCloudName ? `Cloud: ${data.cloudinaryCloudName} · Writes Retired (410)` : 'New uploads write to Daytona'}
            </div>
          </div>
        </section>

        {/* Migration Engine Section */}
        <section className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden">
          <div className="px-5 py-4 border-b border-bolt-elements-borderColor flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-base font-semibold">Cloudinary → Daytona Volumes Migration</h2>
              <p className="text-xs text-bolt-elements-textSecondary">
                Idempotent SHA-256 verified transfer. Never deletes source assets on Cloudinary.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={actionBusy || data.migration.status === 'running' || !data.cloudinaryConfigured}
                onClick={() => runAdminAction('startMigration')}
                className="inline-flex h-8 items-center gap-1.5 px-3 rounded-lg text-xs font-semibold bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover cursor-pointer disabled:opacity-45"
              >
                <span className="i-ph:play text-xs" />
                <span>{data.migration.status === 'paused' ? 'Resume Migration' : 'Start Migration'}</span>
              </button>
              <button
                type="button"
                disabled={actionBusy || data.migration.status !== 'running'}
                onClick={() => runAdminAction('pauseMigration')}
                className="inline-flex h-8 items-center gap-1.5 px-3 rounded-lg text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor cursor-pointer disabled:opacity-45"
              >
                <span className="i-ph:pause text-xs" />
                <span>Pause</span>
              </button>
              <button
                type="button"
                disabled={actionBusy || data.migration.failedCount === 0}
                onClick={() => runAdminAction('retryFailedMigration')}
                className="inline-flex h-8 items-center gap-1.5 px-3 rounded-lg text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor cursor-pointer disabled:opacity-45"
              >
                <span className="i-ph:arrow-counter-clockwise text-xs" />
                <span>Retry Failed ({data.migration.failedCount})</span>
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono">
                  Status: <strong className="uppercase">{data.migration.status}</strong> · Processed {processed} / {total} (
                  {data.migration.completedCount} copied, {data.migration.skippedCount} skipped, {data.migration.failedCount} failed)
                </span>
                <span className="font-mono tabular-nums">{progressPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-bolt-elements-background-depth-1 overflow-hidden border border-bolt-elements-borderColor">
                <div
                  className="h-full bg-bolt-elements-item-contentAccent transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {data.migration.items.length > 0 ? (
              <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-lg border border-bolt-elements-borderColor">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bolt-elements-background-depth-1 border-b border-bolt-elements-borderColor text-bolt-elements-textSecondary sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Path</th>
                      <th className="py-2 px-3">Project</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Bytes</th>
                      <th className="py-2 px-3">SHA-256</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bolt-elements-borderColor/70">
                    {data.migration.items.map((item) => (
                      <tr key={item.itemId} className="hover:bg-bolt-elements-background-depth-1/40">
                        <td className="py-2 px-3 font-mono">{item.relativePath}</td>
                        <td className="py-2 px-3 font-mono text-bolt-elements-textSecondary">
                          {item.ownerId.slice(0, 8)}/{item.projectId.slice(0, 14)}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={classNames(
                              'font-mono font-semibold',
                              item.status === 'completed' || item.status === 'skipped'
                                ? 'text-bolt-elements-icon-success'
                                : item.status === 'failed'
                                  ? 'text-bolt-elements-icon-error'
                                  : 'text-bolt-elements-item-contentAccent',
                            )}
                          >
                            {item.status}
                          </span>
                          {item.errorMessage && (
                            <div className="text-[11px] text-bolt-elements-icon-error mt-0.5">{item.errorMessage}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums">{item.verifiedBytes ?? item.bytes ?? '-'}</td>
                        <td className="py-2 px-3 font-mono text-bolt-elements-textTertiary">
                          {item.sha256 ? item.sha256.slice(0, 12) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-bolt-elements-textTertiary">
                Click &quot;Start Migration&quot; to discover legacy assets under bolt_projects/ and verify migration into the central Daytona Volume.
              </p>
            )}
          </div>
        </section>

        {/* Sandboxes & Lifecycle Logs */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-bolt-elements-borderColor">
              <h2 className="text-sm font-semibold">Daytona Sandboxes</h2>
            </div>
            <div className="p-4 space-y-2.5 max-h-80 overflow-y-auto">
              {data.daytona.sandboxes.length === 0 ? (
                <p className="text-xs text-bolt-elements-textTertiary">No sandboxes found in Daytona.</p>
              ) : (
                data.daytona.sandboxes.map((sb) => (
                  <div
                    key={sb.id}
                    className="p-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/50 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs font-mono font-semibold truncate">{sb.id}</div>
                      <div className="text-[11px] text-bolt-elements-textSecondary font-mono">
                        State: {sb.state}
                        {sb.labels?.whiterchat_project ? ` · Project: ${sb.labels.whiterchat_project}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => runAdminAction('stopSandbox', sb.id)}
                        className="px-2.5 py-1 rounded text-[11px] font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor cursor-pointer"
                      >
                        Stop
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => runAdminAction('testDeleteSandbox', sb.id)}
                        className="px-2.5 py-1 rounded text-[11px] font-medium bg-bolt-elements-button-danger-background text-bolt-elements-button-danger-text hover:bg-bolt-elements-button-danger-backgroundHover cursor-pointer"
                      >
                        Delete (Test Volume)
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-bolt-elements-borderColor">
              <h2 className="text-sm font-semibold">Workspace Presence &amp; Shutdown Events</h2>
            </div>
            <div className="p-4 space-y-2 max-h-80 overflow-y-auto text-xs">
              {data.presence.recentEvents.length === 0 ? (
                <p className="text-bolt-elements-textTertiary">No recent session lifecycle events recorded yet.</p>
              ) : (
                data.presence.recentEvents.map((ev, idx) => (
                  <div
                    key={`${ev.timestamp}_${idx}`}
                    className="p-2.5 rounded-lg border border-bolt-elements-borderColor/70 bg-bolt-elements-background-depth-1/40 flex items-start justify-between gap-2"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-mono font-semibold text-bolt-elements-textPrimary">{ev.event}</div>
                      <div className="text-[11px] font-mono text-bolt-elements-textSecondary truncate">
                        proj={ev.projectId} · sandbox={ev.sandboxId ? ev.sandboxId.slice(0, 12) : 'none'}
                        {ev.detail ? ` · ${ev.detail}` : ''}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-bolt-elements-textTertiary shrink-0">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
