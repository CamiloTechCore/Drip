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
    const run = () => {
      // Recover offline writes only. Returning to a tab must not poll Sheets.
      void client.readCache(account).then(state => {
        if (active && navigator.onLine && state.queue.length) return mutateSync({ pendingOnly: true });
      }).catch(() => undefined);
    };
    // Every login rehydrates the complete history, even with an old device cursor.
    if (navigator.onLine) {
      setHydrating(true);
      void sync().catch(() => undefined).finally(() => { if (active) setHydrating(false); });
    }
    window.addEventListener('online', run);
    return () => {
      active = false;
      setHydrating(false);
      window.removeEventListener('online', run);
    };
  }, [account, sync, mutateSync, user?.id]);

  const requireAccount = useCallback(() => {
    if (!account) throw new Error('El almacenamiento todavía se está abriendo. Inténtalo de nuevo.');
    return account;
  }, [account]);
  const afterLocalWrite = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    if (account && !account.settings.isDemo && account.settings.url && user && navigator.onLine) void mutateSync({ pendingOnly: true }).catch(() => undefined);
  }, [account, queryClient, queryKey, mutateSync, user?.id]);
  const saveRegistro = useCallback(async (registro: Registro) => {
    // Conserva quién lo creó originalmente; solo atribuye registros nuevos sin usuario_id.
    if (!user) throw new Error('Ingresa a tu cuenta para registrar movimientos.');
    if (registro.usuario_id && registro.usuario_id !== user.id) throw new Error('Este movimiento pertenece a otro usuario.');
    const owned = { ...registro, usuario_id: user.id };
    await client.saveRegistro(requireAccount(), owned); await afterLocalWrite();
  }, [requireAccount, afterLocalWrite, user]);
  const deleteRegistro = useCallback(async (id: string) => {
    if (!user || !query.data?.data.registros.some(row => row.id === id && row.usuario_id === user.id)) throw new Error('Este movimiento no pertenece a tu cuenta.');
    await client.deleteRegistro(requireAccount(), id); await afterLocalWrite();
  }, [requireAccount, afterLocalWrite, user, query.data]);
  const saveEntity = useCallback(async (entity: EntityName, value: Entity) => {
    if (!user) throw new Error('Ingresa a tu cuenta para guardar.');
    if (entity !== 'categoria' && 'usuario_id' in value && value.usuario_id && value.usuario_id !== user.id) throw new Error('Este registro pertenece a otro usuario.');
    const owned = entity === 'categoria' ? value : { ...value, usuario_id: user.id };
    await client.saveEntity(requireAccount(), entity, owned); await queryClient.invalidateQueries({ queryKey });
  }, [requireAccount, queryClient, queryKey, user]);
  const saveConfig = useCallback(async (config: Config) => {
    await client.saveConfig(requireAccount(), config); await queryClient.invalidateQueries({ queryKey });
  }, [requireAccount, queryClient, queryKey]);
  const materialize = useCallback(async () => {
    await client.materialize(requireAccount(), undefined, user?.id); await queryClient.invalidateQueries({ queryKey });
  }, [requireAccount, queryClient, queryKey, user]);
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
    unavailable: !settings.isDemo && !!user && !query.data?.cursor && !query.data?.data.registros.length,
    pending: query.data?.queue.length ?? 0,
    pendingIds: ids,
    syncing,
    error: error ?? (query.error instanceof Error ? query.error.message : null),
    saveRegistro, deleteRegistro, saveEntity, saveConfig, sync, materialize, importLocalRecords,
    isDemo: settings.isDemo, setDemo: settings.setDemo,
  };
}

export type DataContext = ReturnType<typeof useData>;
