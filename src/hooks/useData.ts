import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as client from '../api/client';
import { EMPTY_DATA } from '../lib/defaults';
import { useSettings } from '../store/settings';
import type { Config, Entity, EntityName, Registro } from '../types';

export function useData() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<client.Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setAccount(null); setError(null);
    void client.getAccount({ url: settings.url, token: settings.token, isDemo: settings.isDemo }).then(value => {
      if (active) setAccount(value);
    }).catch(() => { if (active) setError('No pudimos abrir el almacenamiento seguro de este dispositivo.'); });
    return () => { active = false; };
  }, [settings.url, settings.token, settings.isDemo]);
  const namespace = account?.namespace ?? 'loading';
  const queryKey = useMemo(() => ['drip-data', namespace], [namespace]);
  const query = useQuery({ queryKey, queryFn: () => client.readCache(account!), enabled: !!account, staleTime: Infinity, retry: 1 });
  const mutation = useMutation({
    mutationKey: ['drip-sync', namespace],
    mutationFn: async () => { if (account) await client.syncAccount(account); },
    onSuccess: () => { setError(null); },
    onError: (reason: Error) => { setError(reason.message); },
  });
  const syncing = useIsMutating({ mutationKey: ['drip-sync', namespace] }) > 0;
  const sync = mutation.mutateAsync;

  useEffect(() => client.subscribeCache(changed => {
    if (changed === namespace) void queryClient.invalidateQueries({ queryKey });
  }), [namespace, queryClient, queryKey]);

  useEffect(() => {
    if (!account || account.settings.isDemo || !account.settings.url || !account.settings.token) return;
    const run = () => { if (navigator.onLine) void sync().catch(() => undefined); };
    run();
    window.addEventListener('online', run);
    const visible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('online', run); document.removeEventListener('visibilitychange', visible); };
  }, [account, sync]);

  const requireAccount = useCallback(() => {
    if (!account) throw new Error('El almacenamiento todavía se está abriendo. Inténtalo de nuevo.');
    return account;
  }, [account]);
  const afterLocalWrite = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    if (account && !account.settings.isDemo && account.settings.url && account.settings.token && navigator.onLine) void sync().catch(() => undefined);
  }, [account, queryClient, queryKey, sync]);
  const saveRegistro = useCallback(async (registro: Registro) => {
    await client.saveRegistro(requireAccount(), registro); await afterLocalWrite();
  }, [requireAccount, afterLocalWrite]);
  const deleteRegistro = useCallback(async (id: string) => {
    await client.deleteRegistro(requireAccount(), id); await afterLocalWrite();
  }, [requireAccount, afterLocalWrite]);
  const saveEntity = useCallback(async (entity: EntityName, value: Entity) => {
    await client.saveEntity(requireAccount(), entity, value); await queryClient.invalidateQueries({ queryKey });
  }, [requireAccount, queryClient, queryKey]);
  const saveConfig = useCallback(async (config: Config) => {
    await client.saveConfig(requireAccount(), config); await queryClient.invalidateQueries({ queryKey });
  }, [requireAccount, queryClient, queryKey]);
  const materialize = useCallback(async () => {
    await client.materialize(requireAccount()); await queryClient.invalidateQueries({ queryKey });
  }, [requireAccount, queryClient, queryKey]);
  const importLocalRecords = useCallback(async () => {
    const count = await client.importLocalRecords(requireAccount()); await afterLocalWrite(); return count;
  }, [requireAccount, afterLocalWrite]);
  const ids = useMemo(() => query.data ? client.pendingIds(query.data) : new Set<string>(), [query.data]);
  return {
    data: query.data?.data ?? EMPTY_DATA,
    loading: !account || query.isLoading,
    pending: query.data?.queue.length ?? 0,
    pendingIds: ids,
    syncing,
    error: error ?? (query.error instanceof Error ? query.error.message : null),
    saveRegistro, deleteRegistro, saveEntity, saveConfig, sync, materialize, importLocalRecords,
    isDemo: settings.isDemo, setDemo: settings.setDemo,
  };
}

export type DataContext = ReturnType<typeof useData>;
