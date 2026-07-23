/**
 * 架构看板取数 hook (I10-C architect-board-viz task 4.1)
 *
 * 经受限桥 getArchitectBoard 取后端投影的看板视图（时间线轴/情节线/人设集）。
 * 看板数据全部来自后端（已排序/投影），Renderer 只呈现，MUST NOT 自行计算——见 architect-board spec。
 */

import { useCallback, useState } from 'react';
import type { ArchitectBoardDto } from '../../shared/ipc/index.js';

export interface UseArchitectBoardResult {
  board: ArchitectBoardDto | undefined;
  loading: boolean;
  error: string | undefined;
  refresh(): void;
}

export function useArchitectBoard(): UseArchitectBoardResult {
  const [board, setBoard] = useState<ArchitectBoardDto | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(undefined);
    window.novelAgent
      .getArchitectBoard()
      .then((dto) => {
        setBoard(dto);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  return { board, loading, error, refresh };
}
