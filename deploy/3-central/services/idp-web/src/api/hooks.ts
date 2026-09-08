/* Hooks de datos (TanStack Query). Cadencias:
   · KPIs en vivo: 15 s — el write-back publica cada 30 s y las vistas gold son
     horarias; más rápido sería martillear la API sin ver nada nuevo.
   · Alarmas / salud / tópicos: 30 s.
   Un fallo no rompe la vista: cada sección pinta su propio estado de error. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as api from './client';
import type { BizParamIn, KpiIn, Severity, TimeParams } from './types';

export function useKpiCatalog() {
  return useQuery({
    queryKey: ['kpi-catalog'],
    queryFn: api.getKpiCatalog,
    staleTime: 5 * 60_000,
  });
}

export function useKpiLive(name: string) {
  return useQuery({
    queryKey: ['kpi-live', name],
    queryFn: () => api.getKpiLive(name),
    refetchInterval: 15_000,
  });
}

export function useKpiSeries(name: string, p: TimeParams, enabled = true) {
  return useQuery({
    queryKey: ['kpi-series', name, p],
    queryFn: () => api.getKpiSeries(name, p),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useAlerts(p: TimeParams & { severity?: Severity; limit?: number }) {
  return useQuery({
    queryKey: ['alerts', p],
    queryFn: () => api.getAlerts(p),
    refetchInterval: 30_000,
  });
}

export function useUnsTopics() {
  return useQuery({
    queryKey: ['uns-topics'],
    queryFn: () => api.getUnsTopics(),
    refetchInterval: 30_000,
  });
}

export function useUnsLatest(topic: string | null) {
  return useQuery({
    queryKey: ['uns-latest', topic],
    queryFn: () => api.getUnsLatest(topic!),
    enabled: topic != null,
    refetchInterval: 10_000,
  });
}

/* ── Consola (Familia 4) ── */

export function useAdminKpis() {
  return useQuery({ queryKey: ['admin-kpis'], queryFn: api.adminListKpis });
}

export function usePutKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, body }: { name: string; body: KpiIn }) =>
      api.adminPutKpi(name, body),
    onSuccess: () => {
      // El write-back relee el catálogo en ≤30 s; la consola, ya mismo.
      void qc.invalidateQueries({ queryKey: ['admin-kpis'] });
      void qc.invalidateQueries({ queryKey: ['kpi-catalog'] });
    },
  });
}

export function useDeleteKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.adminDeleteKpi(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-kpis'] });
      void qc.invalidateQueries({ queryKey: ['kpi-catalog'] });
    },
  });
}

export function useAssetTags(src?: string) {
  return useQuery({
    queryKey: ['asset-tags', src ?? ''],
    queryFn: () => api.adminListTags(src),
  });
}

export function useBusinessParams() {
  return useQuery({
    queryKey: ['business-params'],
    queryFn: api.getBusinessParams,
    staleTime: 60_000,
  });
}

export function usePutBusinessParam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ param, body }: { param: string; body: BizParamIn }) =>
      api.adminPutBusinessParam(param, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['business-params'] });
      // El dinero se recalcula en la vista gold: refrescar las series business.
      void qc.invalidateQueries({ queryKey: ['kpi-series', 'business'] });
      void qc.invalidateQueries({ queryKey: ['kpi-live', 'business'] });
    },
  });
}

export function useAdminHealth(silenceMin: number) {
  return useQuery({
    queryKey: ['admin-health', silenceMin],
    queryFn: () => api.adminHealth(silenceMin),
    refetchInterval: 30_000,
  });
}

export function useAdminServices() {
  return useQuery({
    queryKey: ['admin-services'],
    queryFn: api.adminServices,
    staleTime: Infinity,
  });
}
