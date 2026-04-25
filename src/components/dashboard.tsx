"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Generation,
  ImageModelId,
  ImageQuality,
  Preset,
  Source,
  SizeProfileId,
} from "@/lib/types";
import { SIZE_PROFILES } from "@/lib/types";
import type {
  GenerationPhase,
  StreamEvent,
} from "@/app/api/generations/route";

type ProgressPhase = GenerationPhase | "queued" | "done" | "error";

interface ProgressState {
  phase: ProgressPhase;
  percent: number;
  status: string;
  queuePosition?: number;
}

const PHASE_BASE_PERCENT: Record<ProgressPhase, number> = {
  fetching_source: 5,
  constructing_prompt: 18,
  queued: 30,
  calling_fal: 40,
  saving_output: 92,
  done: 100,
  error: 0,
};

const PHASE_LABEL: Record<ProgressPhase, string> = {
  fetching_source: "Reading source image",
  constructing_prompt: "Composing prompt with Claude",
  queued: "Queued at fal",
  calling_fal: "Generating image",
  saving_output: "Saving output",
  done: "Done",
  error: "Failed",
};

interface TestProduct {
  filename: string;
  url: string;
}

interface Props {
  initialSources: Source[];
  initialGenerations: Generation[];
  presets: Preset[];
}

const MODELS: { id: ImageModelId; label: string }[] = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2 — sharpest · auto-falls back if filter rejects",
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2 (Gemini) — permissive on apparel",
  },
  {
    id: "flux-kontext",
    label: "FLUX Kontext (BFL) — most permissive",
  },
];

export default function Dashboard({
  initialSources,
  initialGenerations,
  presets,
}: Props) {
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [generations, setGenerations] =
    useState<Generation[]>(initialGenerations);

  const [presetId, setPresetId] = useState<string>(presets[0]?.id ?? "");
  const [model, setModel] = useState<ImageModelId>("gpt-image-2");
  const [quality, setQuality] = useState<ImageQuality>("low");
  const [sizeProfile, setSizeProfile] =
    useState<SizeProfileId>("square-1024");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [inspectImage, setInspectImage] = useState<string | null>(null);
  const [testProducts, setTestProducts] = useState<TestProduct[] | null>(null);
  const [showTestProducts, setShowTestProducts] = useState(false);
  const [selectedTestProducts, setSelectedTestProducts] = useState<Set<string>>(
    new Set(),
  );
  const [progress, setProgress] = useState<Map<string, ProgressState>>(
    new Map(),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setProgressFor = useCallback(
    (id: string, updater: (cur?: ProgressState) => ProgressState) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(id, updater(next.get(id)));
        return next;
      });
    },
    [],
  );

  const applyStreamEvent = useCallback(
    (event: StreamEvent, currentId: string | null) => {
      if (event.type === "started") {
        const g = event.generation;
        setGenerations((prev) => {
          const without = prev.filter((x) => x.id !== g.id);
          return [g, ...without];
        });
        setProgressFor(g.id, () => ({
          phase: "fetching_source",
          percent: 1,
          status: "Starting…",
        }));
        return;
      }
      if (!currentId) return;
      if (event.type === "phase") {
        setProgressFor(currentId, () => ({
          phase: event.phase,
          percent: PHASE_BASE_PERCENT[event.phase],
          status: PHASE_LABEL[event.phase],
        }));
        return;
      }
      if (event.type === "fal_queued") {
        setProgressFor(currentId, () => ({
          phase: "queued",
          percent: PHASE_BASE_PERCENT.queued,
          status:
            event.position !== undefined
              ? `Queued at fal (position ${event.position})`
              : "Queued at fal",
          queuePosition: event.position,
        }));
        return;
      }
      if (event.type === "fal_log") {
        setProgressFor(currentId, (cur) => ({
          phase: "calling_fal",
          percent: Math.min(90, (cur?.percent ?? 40) + 4),
          status: event.message.slice(0, 80) || PHASE_LABEL.calling_fal,
        }));
        return;
      }
      if (event.type === "fal_fallback") {
        setProgressFor(currentId, () => ({
          phase: "calling_fal",
          percent: PHASE_BASE_PERCENT.calling_fal,
          status: `Filter rejected ${event.fromModel} — retrying with ${event.toModel}…`,
        }));
        setGenerations((prev) =>
          prev.map((g) =>
            g.id === currentId ? { ...g, model: event.toModel } : g,
          ),
        );
        return;
      }
      if (event.type === "model_routed") {
        setProgressFor(currentId, () => ({
          phase: "calling_fal",
          percent: PHASE_BASE_PERCENT.calling_fal - 5,
          status: `Auto-routed to ${event.toModel} (${event.matched.slice(0, 3).join(", ")})`,
        }));
        setGenerations((prev) =>
          prev.map((g) =>
            g.id === currentId ? { ...g, model: event.toModel } : g,
          ),
        );
        return;
      }
      if (event.type === "done") {
        const g = event.generation;
        setGenerations((prev) => {
          const without = prev.filter((x) => x.id !== g.id);
          return [g, ...without];
        });
        setProgressFor(g.id, () => ({
          phase: "done",
          percent: 100,
          status: "Done",
        }));
        window.setTimeout(() => {
          setProgress((prev) => {
            const next = new Map(prev);
            next.delete(g.id);
            return next;
          });
        }, 1500);
        return;
      }
      if (event.type === "error") {
        const g = event.generation;
        if (g) {
          setGenerations((prev) => {
            const without = prev.filter((x) => x.id !== g.id);
            return [g, ...without];
          });
          setProgressFor(g.id, () => ({
            phase: "error",
            percent: 0,
            status: event.message,
          }));
        }
      }
    },
    [setProgressFor],
  );

  useEffect(() => {
    if (testProducts !== null || !showTestProducts) return;
    fetch("/api/test-products")
      .then((r) => r.json())
      .then((j) => setTestProducts(j.products ?? []))
      .catch(() => setTestProducts([]));
  }, [showTestProducts, testProducts]);

  const toggleTestProduct = useCallback((filename: string) => {
    setSelectedTestProducts((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const toggleSource = useCallback((id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRef = useCallback((url: string) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const activePreset = presets.find((p) => p.id === presetId);

  // When user switches preset, drop any selected refs that don't belong to the new preset.
  useEffect(() => {
    if (!activePreset) return;
    const allowed = new Set(activePreset.referenceImageUrls);
    setSelectedRefs((prev) => {
      const next = new Set<string>();
      for (const u of prev) if (allowed.has(u)) next.add(u);
      return next;
    });
  }, [activePreset]);

  const refresh = useCallback(async () => {
    const [sRes, gRes] = await Promise.all([
      fetch("/api/sources").then((r) => r.json()),
      fetch("/api/generations").then((r) => r.json()),
    ]);
    setSources(sRes.sources ?? []);
    setGenerations(gRes.generations ?? []);
  }, []);

  // Streaming events keep generations fresh, so polling is no longer needed.

  const onUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/sources", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const { source } = (await res.json()) as { source: Source };
      setSources((prev) => [source, ...prev]);
      setSelectedSourceIds((prev) => new Set(prev).add(source.id));
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const runGeneration = useCallback(
    async (
      sourceId: string,
      referenceUrls: string[],
      overrides?: {
        quality?: ImageQuality;
        sizeProfile?: SizeProfileId;
        reusePromptFromGenerationId?: string;
        seed?: number;
      },
    ) => {
      const tempKey = `${sourceId}:${Date.now()}:${Math.random()}`;
      setPending((prev) => new Set(prev).add(tempKey));
      let generationId: string | null = null;
      try {
        const res = await fetch("/api/generations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/x-ndjson",
          },
          body: JSON.stringify({
            sourceId,
            presetId,
            model,
            referenceUrls,
            quality: overrides?.quality ?? quality,
            sizeProfile: overrides?.sizeProfile ?? sizeProfile,
            seed: overrides?.seed,
            reusePromptFromGenerationId: overrides?.reusePromptFromGenerationId,
          }),
        });
        if (!res.body) throw new Error("no response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const event = JSON.parse(line) as StreamEvent;
              if (event.type === "started") generationId = event.generation.id;
              applyStreamEvent(event, generationId);
            } catch (err) {
              console.warn("bad ndjson line:", line, err);
            }
          }
        }
      } catch (err) {
        console.error(`generation request failed for ${sourceId}:`, err);
        if (generationId) {
          setProgress((prev) => {
            const next = new Map(prev);
            next.set(generationId!, {
              phase: "error",
              percent: 0,
              status: err instanceof Error ? err.message : "stream failed",
            });
            return next;
          });
        }
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(tempKey);
          return next;
        });
      }
    },
    [presetId, model, quality, sizeProfile, applyStreamEvent],
  );

  const onRegenerateNewSeed = useCallback(
    async (gen: Generation) => {
      await runGeneration(gen.sourceId, [], {
        quality: gen.quality,
        sizeProfile: gen.sizeProfile,
        reusePromptFromGenerationId: gen.id,
        // omit seed → server generates a fresh random one
      });
    },
    [runGeneration],
  );

  const onGenerateBatch = useCallback(async () => {
    if (!presetId) return;
    const refs = Array.from(selectedRefs);
    if (refs.length === 0) return;

    const importedFromTest = await Promise.all(
      Array.from(selectedTestProducts).map(async (filename) => {
        try {
          const res = await fetch("/api/sources", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ testProductFilename: filename }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
          return json.source as Source;
        } catch (err) {
          console.error(`failed to import ${filename}:`, err);
          return null;
        }
      }),
    );
    const newSources = importedFromTest.filter((s): s is Source => !!s);
    if (newSources.length > 0) {
      setSources((prev) => [...newSources, ...prev]);
    }
    const sourceIds = [
      ...Array.from(selectedSourceIds),
      ...newSources.map((s) => s.id),
    ];
    if (sourceIds.length === 0) return;
    setSelectedTestProducts(new Set());
    await Promise.all(sourceIds.map((id) => runGeneration(id, refs)));
  }, [
    presetId,
    selectedSourceIds,
    selectedRefs,
    selectedTestProducts,
    runGeneration,
  ]);

  const grouped = useMemo(() => {
    const map = new Map<string, Generation[]>();
    for (const g of generations) {
      const arr = map.get(g.sourceId) ?? [];
      arr.push(g);
      map.set(g.sourceId, arr);
    }
    return map;
  }, [generations]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-10 flex items-end justify-between gap-6 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sceneify</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Upload a flat product photo. Pick a preset. Generate a premium
            lifestyle image with the same garment.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-zinc-500">
          <span>{sources.length} sources · {generations.length} generations</span>
        </div>
      </header>

      <section className="mb-12 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6">
          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Preset
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {presets.map((p) => {
              const isActive = p.id === presetId;
              return (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  type="button"
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                    isActive
                      ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-100"
                      : "border-zinc-300 bg-white hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
                  }`}
                >
                  {isActive && (
                    <svg
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    >
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z" />
                    </svg>
                  )}
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[11px] text-zinc-500">
                    · {p.referenceImageUrls.length}
                  </span>
                </button>
              );
            })}
          </div>
          {activePreset && (
            <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {activePreset.name} — Reference images
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>{activePreset.referenceImageUrls.length} total</span>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    {selectedRefs.size} selected
                  </span>
                  {selectedRefs.size > 0 && (
                    <button
                      onClick={() => setSelectedRefs(new Set())}
                      className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                      clear
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setSelectedRefs(
                        new Set(activePreset.referenceImageUrls),
                      )
                    }
                    className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    select all
                  </button>
                </div>
              </div>
              {activePreset.referenceImageUrls.length === 0 ? (
                <div className="rounded border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  No images. Drop them in{" "}
                  <code className="font-mono">
                    public/presets/{activePreset.id}/
                  </code>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                  {activePreset.referenceImageUrls.map((u) => {
                    const isSel = selectedRefs.has(u);
                    return (
                      <div
                        key={u}
                        className={`group relative aspect-square overflow-hidden rounded border-2 transition ${
                          isSel
                            ? "border-emerald-500 ring-2 ring-emerald-500/40"
                            : "border-zinc-200 hover:border-zinc-500 dark:border-zinc-800 dark:hover:border-zinc-500"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleRef(u)}
                          aria-pressed={isSel}
                          title={u.split("/").pop()}
                          className="absolute inset-0 h-full w-full"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={u}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover transition group-hover:scale-105"
                          />
                        </button>
                        {isSel && (
                          <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                            <svg
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="h-3 w-3"
                              aria-hidden="true"
                            >
                              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z" />
                            </svg>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectImage(u);
                          }}
                          aria-label="View image prompt"
                          title="View image prompt"
                          className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/85 text-zinc-700 opacity-0 shadow transition group-hover:opacity-100 hover:bg-white dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        >
                          <svg
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M8 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-1.25 3.5h2v6h-2v-6z" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-4 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <div className="min-w-[200px]">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ImageModelId)}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[140px]">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Quality
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as ImageQuality)}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="low">Preview · low (~$0.01)</option>
              <option value="medium">Standard · medium (~$0.04)</option>
              <option value="high">Final · high (~$0.17)</option>
              <option value="auto">Auto</option>
            </select>
          </div>

          <div className="min-w-[280px]">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Size
            </label>
            <select
              value={sizeProfile}
              onChange={(e) => setSizeProfile(e.target.value as SizeProfileId)}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {Array.from(
                SIZE_PROFILES.reduce((acc, p) => {
                  if (!acc.has(p.marketplace)) acc.set(p.marketplace, []);
                  acc.get(p.marketplace)!.push(p);
                  return acc;
                }, new Map<string, typeof SIZE_PROFILES>()),
              ).map(([marketplace, items]) => (
                <optgroup key={marketplace} label={marketplace}>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} — {p.hint}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {uploading ? "Uploading…" : "Upload source"}
          </button>
          <button
            onClick={() => setShowTestProducts((v) => !v)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {showTestProducts ? "Hide test products" : "Select test products"}
            {selectedTestProducts.size > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {selectedTestProducts.size}
              </span>
            )}
          </button>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-xs text-zinc-500">
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {selectedSourceIds.size + selectedTestProducts.size}
              </span>{" "}
              source
              {selectedSourceIds.size + selectedTestProducts.size === 1
                ? ""
                : "s"}{" "}
              ×{" "}
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {selectedRefs.size}
              </span>{" "}
              ref{selectedRefs.size === 1 ? "" : "s"} ={" "}
              <span className="font-medium">
                {selectedSourceIds.size + selectedTestProducts.size}
              </span>{" "}
              generation
              {selectedSourceIds.size + selectedTestProducts.size === 1
                ? ""
                : "s"}
            </div>
            <button
              onClick={onGenerateBatch}
              disabled={
                !presetId ||
                selectedSourceIds.size + selectedTestProducts.size === 0 ||
                selectedRefs.size === 0 ||
                pending.size > 0
              }
              className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600"
            >
              {pending.size > 0
                ? `Generating ${pending.size}…`
                : "Generate"}
            </button>
          </div>
        </div>

        {showTestProducts && (
          <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Test products — from{" "}
                <code className="font-mono">test-sources/</code>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <span>{testProducts?.length ?? "…"} files</span>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  {selectedTestProducts.size} selected
                </span>
                {selectedTestProducts.size > 0 && (
                  <button
                    onClick={() => setSelectedTestProducts(new Set())}
                    className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    clear
                  </button>
                )}
                {testProducts && testProducts.length > 0 && (
                  <button
                    onClick={() =>
                      setSelectedTestProducts(
                        new Set(testProducts.map((p) => p.filename)),
                      )
                    }
                    className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    select all
                  </button>
                )}
              </div>
            </div>
            {testProducts === null ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                Loading…
              </div>
            ) : testProducts.length === 0 ? (
              <div className="rounded border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                No images. Drop them in{" "}
                <code className="font-mono">test-sources/</code> at the repo
                root.
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {testProducts.map((p) => {
                  const isSel = selectedTestProducts.has(p.filename);
                  return (
                    <button
                      key={p.filename}
                      type="button"
                      onClick={() => toggleTestProduct(p.filename)}
                      aria-pressed={isSel}
                      title={p.filename}
                      className={`group relative aspect-square overflow-hidden rounded border-2 transition ${
                        isSel
                          ? "border-emerald-500 ring-2 ring-emerald-500/40"
                          : "border-zinc-200 hover:border-zinc-500 dark:border-zinc-800 dark:hover:border-zinc-500"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                      {isSel && (
                        <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                          <svg
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="h-3 w-3"
                            aria-hidden="true"
                          >
                            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z" />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {sources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No sources yet. Upload a flat product photo to get started.
        </div>
      ) : (
        <div className="space-y-10">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Sources ({sources.length})
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-zinc-500">
              {selectedSourceIds.size > 0 && (
                <button
                  onClick={() => setSelectedSourceIds(new Set())}
                  className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  clear selection
                </button>
              )}
              <button
                onClick={() =>
                  setSelectedSourceIds(new Set(sources.map((s) => s.id)))
                }
                className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                select all
              </button>
            </div>
          </div>
          {sources.map((source) => {
            const sourceGens = grouped.get(source.id) ?? [];
            const isSelected = selectedSourceIds.has(source.id);
            return (
              <div
                key={source.id}
                className={`rounded-xl border-2 bg-white p-5 transition dark:bg-zinc-900 ${
                  isSelected
                    ? "border-emerald-500 ring-2 ring-emerald-500/30 dark:border-emerald-400 dark:ring-emerald-400/30"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="grid gap-6 md:grid-cols-[260px_1fr]">
                  <div>
                    <button
                      onClick={() => toggleSource(source.id)}
                      aria-pressed={isSelected}
                      className="relative block w-full overflow-hidden rounded-lg border border-zinc-200 transition hover:border-zinc-500 dark:border-zinc-800 dark:hover:border-zinc-500"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={source.url}
                        alt={source.filename}
                        className="aspect-square w-full object-cover"
                      />
                      {isSelected && (
                        <span className="absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                          <svg
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z" />
                          </svg>
                        </span>
                      )}
                    </button>
                    <div className="mt-2 truncate text-xs text-zinc-500">
                      {source.filename}
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Generations ({sourceGens.length})
                    </h3>
                    {sourceGens.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
                        No generations yet for this source.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {sourceGens.map((g) => (
                          <GenerationCard
                            key={g.id}
                            gen={g}
                            preset={presets.find((p) => p.id === g.presetId)}
                            progress={progress.get(g.id) ?? null}
                            onRegenerateNewSeed={onRegenerateNewSeed}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {inspectImage && (
        <ReferenceImageModal
          imageUrl={inspectImage}
          onClose={() => setInspectImage(null)}
        />
      )}
    </div>
  );
}

function ReferenceImageModal({
  imageUrl,
  onClose,
}: {
  imageUrl: string;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const fetchPrompt = useCallback(
    async (force: boolean) => {
      if (force) setRegenerating(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ path: imageUrl });
        if (force) params.set("force", "1");
        const res = await fetch(`/api/preset-image-prompt?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        setPrompt(json.prompt as string);
        setCached(Boolean(json.cached));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRegenerating(false);
      }
    },
    [imageUrl],
  );

  useEffect(() => {
    fetchPrompt(false);
  }, [fetchPrompt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="grid max-h-[92vh] w-full max-w-6xl grid-cols-1 overflow-hidden rounded-xl bg-white shadow-2xl md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-zinc-100 dark:bg-zinc-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="h-full max-h-[92vh] w-full object-contain"
          />
        </div>
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                Reference image prompt
              </div>
              <div className="mt-1 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
                {imageUrl}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Close"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 1 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06z" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-auto px-5 py-4 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
            {loading ? (
              <div className="text-zinc-500">
                Generating descriptive prompt with Claude…
              </div>
            ) : error ? (
              <div className="rounded border border-rose-300 bg-rose-50 p-3 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
                {error}
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{prompt}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <div className="text-[11px] text-zinc-500">
              {loading
                ? ""
                : cached
                  ? "From cache"
                  : "Freshly generated · cached for next time"}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (prompt) navigator.clipboard.writeText(prompt);
                }}
                disabled={!prompt}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Copy
              </button>
              <button
                onClick={() => fetchPrompt(true)}
                disabled={loading || regenerating}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenerationCard({
  gen,
  preset,
  progress,
  onRegenerateNewSeed,
}: {
  gen: Generation;
  preset?: Preset;
  progress: ProgressState | null;
  onRegenerateNewSeed: (gen: Generation) => void;
}) {
  const [open, setOpen] = useState(false);
  const isLive = progress && progress.phase !== "done" && progress.phase !== "error";
  const profileMeta = SIZE_PROFILES.find((p) => p.id === gen.sizeProfile);
  const aspectStyle = profileMeta
    ? {
        aspectRatio: `${profileMeta.target.width} / ${profileMeta.target.height}`,
      }
    : undefined;
  const fallbackAspect = !profileMeta
    ? gen.size === "1024x1536"
      ? "aspect-[2/3]"
      : gen.size === "1536x1024"
        ? "aspect-[3/2]"
        : "aspect-square"
    : "";
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div
        className={`relative ${fallbackAspect} w-full overflow-hidden bg-zinc-100 dark:bg-zinc-950`}
        style={aspectStyle}
      >
        {gen.outputUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gen.outputUrl}
            alt="generated"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-zinc-500">
            {progress && progress.phase === "error" ? (
              <>
                <StatusBadge status="failed" />
                <span className="line-clamp-3 text-rose-600">
                  {progress.status}
                </span>
              </>
            ) : isLive ? (
              <PhaseSpinner />
            ) : (
              <>
                <StatusBadge status={gen.status} />
                {gen.error && (
                  <span className="line-clamp-3 text-rose-600">{gen.error}</span>
                )}
              </>
            )}
          </div>
        )}
        {isLive && progress && (
          <div className="absolute inset-x-0 bottom-0 bg-zinc-900/80 px-3 pb-2 pt-1.5 text-white backdrop-blur">
            <ProgressBar percent={progress.percent} />
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate">{progress.status}</span>
              <span className="font-mono tabular-nums opacity-80">
                {Math.round(progress.percent)}%
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="px-3 py-2 text-[11px] text-zinc-500">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
            {preset?.name ?? gen.presetId}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <ModelBadge model={gen.model} />
          {gen.requestedModel && gen.requestedModel !== gen.model && (
            <RoutedBadge from={gen.requestedModel} />
          )}
          <QualityBadge quality={gen.quality} />
          <SizeBadge size={gen.size} profile={gen.sizeProfile} />
          {typeof gen.seed === "number" && (
            <SeedBadge
              seed={gen.seed}
              onRoll={
                gen.status === "succeeded" && gen.constructedPrompt
                  ? () => onRegenerateNewSeed(gen)
                  : undefined
              }
            />
          )}
        </div>
        {gen.constructedPrompt && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-2 text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            {open ? "Hide prompt" : "Show prompt"}
          </button>
        )}
        {open && gen.constructedPrompt && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            {gen.constructedPrompt}
          </pre>
        )}
      </div>
    </div>
  );
}

const MODEL_DISPLAY: Record<ImageModelId, { short: string; cls: string }> = {
  "gpt-image-2": {
    short: "GPT Image 2",
    cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  },
  "nano-banana-2": {
    short: "Nano Banana 2",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  },
  "flux-kontext": {
    short: "FLUX Kontext",
    cls: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200",
  },
};

function ModelBadge({ model }: { model: ImageModelId }) {
  const meta = MODEL_DISPLAY[model] ?? {
    short: model,
    cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.cls}`}
      title={`Rendered by ${meta.short}`}
    >
      {meta.short}
    </span>
  );
}

function SeedBadge({
  seed,
  onRoll,
}: {
  seed: number;
  onRoll?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      <span className="font-mono">seed {seed}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(String(seed));
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        title="Copy seed"
        className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {copied ? "✓" : "⧉"}
      </button>
      {onRoll && (
        <button
          type="button"
          onClick={onRoll}
          title="Re-render with a fresh random seed (same prompt)"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ↻
        </button>
      )}
    </span>
  );
}

function RoutedBadge({ from }: { from: ImageModelId }) {
  const meta = MODEL_DISPLAY[from] ?? { short: from, cls: "" };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      title={`Originally requested ${meta.short}; auto-routed or fell back to a more permissive model`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M3 8a.75.75 0 0 1 .75-.75h7.69L9.22 5.03a.75.75 0 1 1 1.06-1.06l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 1 1-1.06-1.06l2.22-2.22H3.75A.75.75 0 0 1 3 8z" />
      </svg>
      from {meta.short}
    </span>
  );
}

function QualityBadge({ quality }: { quality?: Generation["quality"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    low: {
      label: "Preview",
      cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    },
    medium: {
      label: "Standard",
      cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    },
    high: {
      label: "Final · high",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    },
    auto: {
      label: "Auto",
      cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    },
  };
  const v = map[quality ?? ""] ?? {
    label: "—",
    cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${v.cls}`}
    >
      {v.label}
    </span>
  );
}

function SizeBadge({
  size,
  profile,
}: {
  size?: Generation["size"];
  profile?: Generation["sizeProfile"];
}) {
  if (!size && !profile) return null;
  const profileMeta = SIZE_PROFILES.find((p) => p.id === profile);
  if (profileMeta) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        title={`${profileMeta.marketplace} · ${profileMeta.hint} · rendered at ${profileMeta.nativeSize}`}
      >
        {profileMeta.marketplace} · {profileMeta.target.width}×
        {profileMeta.target.height}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {size}
    </span>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/15">
      <div
        className="h-full rounded-full bg-emerald-400 transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 animate-[shimmer_1.6s_linear_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent"
        style={{ mixBlendMode: "screen" }}
      />
    </div>
  );
}

function PhaseSpinner() {
  return (
    <span
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200"
      aria-hidden="true"
    />
  );
}

function PresetThumbStrip({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-zinc-100 text-[11px] text-zinc-500 dark:bg-zinc-950">
        no reference images
      </div>
    );
  }
  const display = urls.slice(0, 3);
  return (
    <div className="grid aspect-[4/3] grid-cols-3 gap-px bg-zinc-200 dark:bg-zinc-800">
      {display.map((u, i) => (
        <div
          key={u}
          className={`overflow-hidden bg-zinc-100 dark:bg-zinc-950 ${
            display.length === 1 ? "col-span-3" : i === 0 && display.length === 2 ? "col-span-2" : ""
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" className="h-full w-full object-cover" />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Generation["status"] }) {
  const map: Record<Generation["status"], string> = {
    pending: "bg-zinc-200 text-zinc-700",
    running: "bg-amber-100 text-amber-800",
    succeeded: "bg-emerald-100 text-emerald-800",
    failed: "bg-rose-100 text-rose-800",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status]}`}
    >
      {status}
    </span>
  );
}
