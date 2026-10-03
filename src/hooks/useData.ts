import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as client from '../api/client';
import { EMPTY_DATA } from '../lib/defaults';
import { useSettings } from '../store/settings';
import { useAuth } from '../store/auth';
import type { Config, Entity, EntityName, Registro } from '../types';

export function useData() {
  const settings = useSettings();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<client.Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  useEffect(() => {
    let active = true;
    setAccount(null); setError(null);
    void client.getAccount({ url: settings.url, isDemo: settings.isDemo }).then(value => {
      if (active) setAccount(value);
    }).catch(() => { if (active) setError('No pudimos abrir el almacenamiento seguro de este dispositivo.'); });
    return () => { active = false; };
  }, [settings.url, settings.isDemo]);
  const namespace = account?.namespace ?? 'loading';
  const queryKey = useMemo(() => ['drip-data', namespace], [namespace]);
  const query = useQuery({ queryKey, queryFn: () => client.readCache(account!), enabled: !!account, staleTime: Infinity, retry: 1 });
  const mutation = useMutation({
    mutationKey: ['drip-sync', namespace],
    mutationFn: async (options: client.SyncOptions) => { if (account) await client.syncAccount(account, options); },
    onSuccess: () => { setError(null); },
    onError: (reason: Error) => { setError(reason.message); },
  });
  const syncing = useIsMutating({ mutationKey: ['drip-sync', namespace] }) > 0;
  const mutateSync = mutation.mutateAsync;
  const sync = useCallback(() => mutateSync({ full: true }), [mutateSync]);

  useEffect(() => client.subscribeCache(changed => {
    if (changed === namespace) void queryClient.invalidateQueries({ queryKey });
  }), [namespace, queryClient, queryKey]);

  useEffect(() => {
    if (!account || account.settings.isDemo || !account.settings.url || !user) return;
    let active = true;
    const run = () => { if (navigator.onLine) void sync().catch(() => undefined); };
    // Every login rehydrates the complete history, even with an old device cursor.
    if (navigator.onLine) {
      setHydrating(true);
      void sync().catch(() => undefined).finally(() => { if (active) setHydrating(false); });
    }
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
    const visible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', visible);
    // Reintenta periódicamente para que una cola pendiente no dependa de reabrir la app o recuperar la red.
    const interval = setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') void mutateSync({ full: false }).catch(() => undefined);
    }, 60000);
    return () => {
      active = false;
      setHydrating(false);
      window.removeEventListener('online', run);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', visible);
      clearInterval(interval);
    };
  }, [account, sync, mutateSync, user?.id]);

  const requireAccount = useCallback(() => {
    if (!account) throw new Error('El almacenamiento todavía se está abriendo. Inténtalo de nuevo.');
    return account;
  }, [account]);
  const afterLocalWrite = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    if (account && !account.settings.isDemo && account.settings.url && user && navigator.onLine) void sync().catch(() => undefined);
  }, [account, queryClient, queryKey, sync, user?.id]);
  const saveRegistro = useCallback(async (registro: Registro) => {
    // Conserva quién lo creó originalmente; solo atribuye registros nuevos sin usuario_id.
    const owned = registro.usuario_id ? registro : { ...registro, usuario_id: user?.id ?? '' };
    await client.saveRegistro(requireAccount(), owned); await afterLocalWrite();
  }, [requireAccount, afterLocalWrite, user]);
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
  const filteredData = useMemo(() => {
    if (!query.data) return EMPTY_DATA;
    return client.selectUserData(query.data.data, user?.id, settings.isDemo);
  }, [query.data, user?.id, settings.isDemo]);
  return {
    data: filteredData,
    loading: !account || query.isLoading || hydrating,
    pending: query.data?.queue.length ?? 0,
    pendingIds: ids,
    syncing,
    error: error ?? (query.error instanceof Error ? query.error.message : null),
    saveRegistro, deleteRegistro, saveEntity, saveConfig, sync, materialize, importLocalRecords,
    isDemo: settings.isDemo, setDemo: settings.setDemo,
  };
}

export type DataContext = ReturnType<typeof useData>;
