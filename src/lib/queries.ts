import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, type ClipPayload } from "./api";
import type {
  AppSettings,
  AttemptRow,
  CacheStats,
  CardRow,
  ClipRow,
  DueCard,
  PitchContoursResponse,
  SegmentBest,
  SettingPair,
} from "./types";
import { settingsFromPairs } from "./settings";

export const QK = {
  clips: ["clips"] as const,
  clip: (id: number) => ["clip", id] as const,
  health: ["health"] as const,
  attempts: (clipId: number, segmentIndex: number) =>
    ["attempts", clipId, segmentIndex] as const,
  segmentBestScores: (clipId: number) =>
    ["segment-best-scores", clipId] as const,
  savedSegments: (clipId: number) =>
    ["saved-segments", clipId] as const,
  dueCards: ["due-cards"] as const,
  dueCardsCount: ["due-cards-count"] as const,
  settings: ["settings"] as const,
  cacheStats: ["cache-stats"] as const,
};

export function useClips() {
  return useQuery({
    queryKey: QK.clips,
    queryFn: api.listClips,
    staleTime: 5_000,
  });
}

export function useClip(id: number | null) {
  return useQuery<ClipPayload>({
    queryKey: id != null ? QK.clip(id) : ["clip", "none"],
    queryFn: () => api.getClip(id!),
    enabled: id != null,
    staleTime: 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: QK.health,
    queryFn: api.health,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useIngestUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      url,
      maxDurationS,
      modelName,
    }: { url: string; maxDurationS?: number; modelName?: string }) =>
      api.ingestUrl(url, maxDurationS, modelName),
    onSuccess: (_clip) => {
      qc.invalidateQueries({ queryKey: QK.clips });
    },
  });
}

export function useIngestFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      filePath,
      maxDurationS,
      modelName,
    }: { filePath: string; maxDurationS?: number; modelName?: string }) =>
      api.ingestFile(filePath, maxDurationS, modelName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.clips });
    },
  });
}

export function useProbeUrl() {
  return useMutation({
    mutationFn: (url: string) => api.probeUrl(url),
  });
}

export function useIngestUrlTrimmed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      url: string;
      trimStartS: number;
      trimEndS: number;
      maxDurationS?: number;
      modelName?: string;
    }) =>
      api.ingestUrlTrimmed(
        args.url,
        args.trimStartS,
        args.trimEndS,
        args.maxDurationS,
        args.modelName,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.clips });
    },
  });
}

export function useScoreAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      clipId: number;
      segmentIndex: number;
      attemptAudioPath: string;
    }) => api.scoreAttempt(args.clipId, args.segmentIndex, args.attemptAudioPath),
    onSuccess: (_score, vars) => {
      qc.invalidateQueries({
        queryKey: QK.attempts(vars.clipId, vars.segmentIndex),
      });
      qc.invalidateQueries({
        queryKey: QK.segmentBestScores(vars.clipId),
      });
    },
  });
}

export function usePitchContour(
  clipId: number | null,
  segmentIndex: number | null,
  attemptAudioPath: string | null,
  enabled = true,
) {
  return useQuery<PitchContoursResponse>({
    queryKey:
      clipId != null && segmentIndex != null && attemptAudioPath
        ? ["pitch", clipId, segmentIndex, attemptAudioPath]
        : ["pitch", "none"],
    queryFn: () =>
      api.pitchContour(clipId!, segmentIndex!, attemptAudioPath!),
    enabled:
      enabled &&
      clipId != null &&
      segmentIndex != null &&
      !!attemptAudioPath,
    staleTime: 60_000,
  });
}

export function useSegmentBestScores(clipId: number | null) {
  return useQuery<SegmentBest[]>({
    queryKey:
      clipId != null
        ? QK.segmentBestScores(clipId)
        : ["segment-best-scores", "none"],
    queryFn: () => api.listSegmentBestScores(clipId!),
    enabled: clipId != null,
    staleTime: 5_000,
  });
}

export function useAttempts(
  clipId: number | null,
  segmentIndex: number | null,
  limit = 10,
) {
  return useQuery<AttemptRow[]>({
    queryKey:
      clipId != null && segmentIndex != null
        ? QK.attempts(clipId, segmentIndex)
        : ["attempts", "none"],
    queryFn: () => api.listAttempts(clipId!, segmentIndex!, limit),
    enabled: clipId != null && segmentIndex != null,
    staleTime: 5_000,
  });
}

export function useDeleteClip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clipId: number) => api.deleteClip(clipId),
    onSuccess: (_void, clipId) => {
      // Drop the per-clip detail cache so a stale clip can't be re-rendered.
      qc.removeQueries({ queryKey: QK.clip(clipId) });
      qc.invalidateQueries({ queryKey: QK.clips });
    },
  });
}

export function useSaveAttempt() {
  return useMutation({
    mutationFn: (args: {
      clipId: number;
      segmentIndex: number;
      audioBase64: string;
      extension: string;
    }) =>
      api.saveAttempt(
        args.clipId,
        args.segmentIndex,
        args.audioBase64,
        args.extension,
      ),
  });
}

// User settings: read once on mount, updates write-through.
export function useSettings(): AppSettings {
  const { data } = useQuery<SettingPair[]>({
    queryKey: QK.settings,
    queryFn: api.listSettings,
    staleTime: Infinity,
  });
  return settingsFromPairs(data ?? []);
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { key: string; value: string | null }) =>
      api.setSetting(args.key, args.value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.settings });
    },
  });
}

export function useCacheStats() {
  return useQuery<CacheStats>({
    queryKey: QK.cacheStats,
    queryFn: api.cacheStats,
    staleTime: 5_000,
  });
}

export function useClearAllClips() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearAllClips(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.clips });
      qc.invalidateQueries({ queryKey: QK.cacheStats });
    },
  });
}

// SRS / FSRS hooks. The scheduler itself runs in TS (lib/fsrs.ts); these
// hooks just plumb persistence + invalidation.

export function useSavedSegments(clipId: number | null) {
  return useQuery<number[]>({
    queryKey:
      clipId != null
        ? QK.savedSegments(clipId)
        : ["saved-segments", "none"],
    queryFn: () => api.listSavedSegments(clipId!),
    enabled: clipId != null,
    staleTime: 5_000,
  });
}

export function useSaveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { clipId: number; segmentIndex: number }) =>
      api.saveCard(args.clipId, args.segmentIndex),
    onSuccess: (_card, vars) => {
      qc.invalidateQueries({ queryKey: QK.savedSegments(vars.clipId) });
      qc.invalidateQueries({ queryKey: QK.dueCardsCount });
      qc.invalidateQueries({
        queryKey: ["card", vars.clipId, vars.segmentIndex],
      });
    },
  });
}

export function useUnsaveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { clipId: number; segmentIndex: number }) =>
      api.unsaveCard(args.clipId, args.segmentIndex),
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: QK.savedSegments(vars.clipId) });
      qc.invalidateQueries({ queryKey: QK.dueCardsCount });
      qc.invalidateQueries({ queryKey: QK.dueCards });
      qc.invalidateQueries({
        queryKey: ["card", vars.clipId, vars.segmentIndex],
      });
    },
  });
}

export function useDueCardsCount() {
  return useQuery<number>({
    queryKey: QK.dueCardsCount,
    queryFn: api.countDueCards,
    staleTime: 30_000,
    // Refresh quietly so the badge updates as cards become due over time.
    refetchInterval: 60_000,
  });
}

export function useDueCards(limit = 50) {
  return useQuery<DueCard[]>({
    queryKey: QK.dueCards,
    queryFn: () => api.listDueCards(limit),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useRecordReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      cardId: number;
      dueAt: string;
      stability: number;
      difficulty: number;
      reps: number;
      lapses: number;
      cardState: string;
    }) =>
      api.recordReview(
        args.cardId,
        args.dueAt,
        args.stability,
        args.difficulty,
        args.reps,
        args.lapses,
        args.cardState,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.dueCardsCount });
      qc.invalidateQueries({ queryKey: QK.dueCards });
    },
  });
}

export function useCard(clipId: number | null, segmentIndex: number | null) {
  return useQuery<CardRow | null>({
    queryKey:
      clipId != null && segmentIndex != null
        ? ["card", clipId, segmentIndex]
        : ["card", "none"],
    queryFn: () => api.getCard(clipId!, segmentIndex!),
    enabled: clipId != null && segmentIndex != null,
    staleTime: 5_000,
  });
}

export function useExportToObsidian() {
  return useMutation({
    mutationFn: (vaultPath: string) => api.exportToObsidian(vaultPath),
  });
}

export function useCaptureChunk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.captureChunk(text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.clips });
      qc.invalidateQueries({ queryKey: QK.dueCardsCount });
    },
  });
}

export function useSetCardCloze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      clipId: number;
      segmentIndex: number;
      indices: number[];
    }) => api.setCardCloze(args.clipId, args.segmentIndex, args.indices),
    onSuccess: (_card, vars) => {
      qc.invalidateQueries({ queryKey: ["card", vars.clipId, vars.segmentIndex] });
      qc.invalidateQueries({ queryKey: QK.dueCards });
    },
  });
}

export type { CardRow };

// Optimistic helper: a "most recent first" sorted clips list (the sidebar
// already orders DESC on created_at server-side, but useful for UI sort
// guarantees if needed).
export function sortedClips(clips: ClipRow[] | undefined): ClipRow[] {
  if (!clips) return [];
  return [...clips].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}
