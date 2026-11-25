import { useMemo, useState } from 'react';
import type { MatchConfidence, MatchResult } from '@syncsound/shared';
import type { MigrationStreamState } from '../hooks/useMigrationStream';

type FilterMode = 'all' | 'matched' | 'low' | 'not_found';

const CONFIDENCE_BADGE: Record<MatchConfidence, { label: string; className: string }> = {
  exact: {
    label: 'Exato',
    className: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  },
  high: {
    label: 'Alta',
    className: 'bg-sky-500/20 text-sky-200 border-sky-500/40',
  },
  low: {
    label: 'Baixa',
    className: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  },
  not_found: {
    label: 'Não encontrada',
    className: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  },
};

export function MigrationProgressPanel({ stream }: { stream: MigrationStreamState }) {
  const [filter, setFilter] = useState<FilterMode>('all');

  const counts = useMemo(() => {
    let exact = 0;
    let high = 0;
    let low = 0;
    let notFound = 0;
    for (const item of stream.results) {
      if (item.confidence === 'exact') exact += 1;
      else if (item.confidence === 'high') high += 1;
      else if (item.confidence === 'low') low += 1;
      else notFound += 1;
    }
    return { exact, high, low, notFound };
  }, [stream.results]);

  const filteredResults = useMemo(() => {
    if (filter === 'all') return stream.results;
    if (filter === 'matched') {
      return stream.results.filter((r) => r.confidence === 'exact' || r.confidence === 'high');
    }
    if (filter === 'low') {
      return stream.results.filter((r) => r.confidence === 'low');
    }
    return stream.results.filter((r) => r.confidence === 'not_found');
  }, [filter, stream.results]);

  if (stream.status === 'idle') {
    return null;
  }

  const processed = stream.results.length;
  const isDeterminate = stream.totalTracks > 0;
  const percent = isDeterminate ? Math.round((processed / stream.totalTracks) * 100) : 0;

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportNotFoundCsv = () => {
    const missing = stream.results.filter((r) => r.confidence === 'not_found');
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      ['Titulo', 'Artistas', 'Album', 'ISRC', 'Motivo'].join(','),
      ...missing.map((item) =>
        [
          escapeCsv(item.sourceTrack.title),
          escapeCsv(item.sourceTrack.artists.join('; ')),
          escapeCsv(item.sourceTrack.album ?? ''),
          escapeCsv(item.sourceTrack.isrc ?? ''),
          escapeCsv(item.reason ?? ''),
        ].join(','),
      ),
    ];
    downloadBlob(rows.join('\n'), 'syncsound-nao-encontradas.csv', 'text/csv;charset=utf-8');
  };

  const exportJsonReport = () => {
    const payload = {
      playlistName: stream.playlistName,
      dryRun: stream.dryRun,
      summary: stream.summary,
      results: stream.results,
    };
    downloadBlob(
      JSON.stringify(payload, null, 2),
      'syncsound-relatorio.json',
      'application/json;charset=utf-8',
    );
  };

  return (
    <section
      aria-labelledby="migration-progress-heading"
      className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="migration-progress-heading" className="text-xl font-semibold text-white">
            {stream.playlistName ? `Progresso: ${stream.playlistName}` : 'Progresso da Migração'}
          </h2>
          <p role="status" aria-live="polite" className="mt-1 text-sm text-slate-300">
            {stream.status === 'running' &&
              (isDeterminate
                ? `Processando ${processed} de ${stream.totalTracks} faixas (${percent}%)...`
                : 'Carregando faixas da playlist de origem...')}
            {stream.status === 'completed' &&
              `Concluído (${stream.dryRun ? 'simulação' : 'migração aplicada'}): ${processed} faixas analisadas.`}
            {stream.status === 'failed' && `Falha na migração: ${stream.error ?? 'erro desconhecido'}`}
          </p>
        </div>

        {stream.summary?.targetPlaylistUrl && (
          <a
            href={stream.summary.targetPlaylistUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30"
          >
            Abrir playlist criada
          </a>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <label htmlFor="migration-progress">Progresso geral</label>
          <span>{isDeterminate ? `${percent}%` : 'Aguardando...'}</span>
        </div>
        {isDeterminate ? (
          <progress
            id="migration-progress"
            className="syncsound-progress"
            max={stream.totalTracks}
            value={processed}
          />
        ) : (
          <progress id="migration-progress" className="syncsound-progress" />
        )}
      </div>

      {stream.error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {stream.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <span className="text-xs text-slate-400">Exato (Cache / ISRC)</span>
          <p className="mt-1 text-2xl font-bold text-emerald-300">{counts.exact}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <span className="text-xs text-slate-400">Alta confiança</span>
          <p className="mt-1 text-2xl font-bold text-sky-300">{counts.high}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <span className="text-xs text-slate-400">Baixa confiança</span>
          <p className="mt-1 text-2xl font-bold text-amber-300">{counts.low}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <span className="text-xs text-slate-400">Não encontradas</span>
          <p className="mt-1 text-2xl font-bold text-rose-300">{counts.notFound}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar resultados">
          {(
            [
              ['all', `Todas (${stream.results.length})`],
              ['matched', `Exato/Alta (${counts.exact + counts.high})`],
              ['low', `Baixa confiança (${counts.low})`],
              ['not_found', `Não encontradas (${counts.notFound})`],
            ] as Array<[FilterMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={filter === mode}
              onClick={() => setFilter(mode)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === mode
                  ? 'bg-indigo-500 text-white'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {stream.results.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportNotFoundCsv}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Exportar não encontradas (CSV)
            </button>
            <button
              type="button"
              onClick={exportJsonReport}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Exportar relatório completo (JSON)
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <caption className="sr-only">Resultados do matching por faixa</caption>
          <thead className="bg-slate-950/90 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-3">
                Faixa de Origem
              </th>
              <th scope="col" className="px-4 py-3">
                Correspondência no Destino
              </th>
              <th scope="col" className="px-4 py-3">
                Estratégia
              </th>
              <th scope="col" className="px-4 py-3">
                Confiança
              </th>
              <th scope="col" className="px-4 py-3">
                Score
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
            {filteredResults.map((item: MatchResult) => {
              const badge = CONFIDENCE_BADGE[item.confidence];
              return (
                <tr key={item.sourceTrack.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">{item.sourceTrack.title}</div>
                    <div className="text-xs text-slate-400">
                      {item.sourceTrack.artists.join(', ')}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {item.targetTrack ? (
                      <>
                        <div className="font-medium text-slate-100">{item.targetTrack.title}</div>
                        <div className="text-xs text-slate-400">
                          {item.targetTrack.artists.join(', ')}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-rose-300">
                        {item.reason ?? 'Sem correspondência'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs uppercase text-slate-300">{item.strategy}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-200">
                    {Math.round(item.score * 100)}%
                  </td>
                </tr>
              );
            })}
            {filteredResults.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                  Nenhuma faixa corresponde ao filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
