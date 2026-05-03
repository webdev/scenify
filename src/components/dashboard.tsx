"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Generation,
  ImageModelId,
  ImageQuality,
  Preset,
  RegisterId,
  Source,
  SizeProfileId,
} from "@/lib/types";
import { REGISTERS, SIZE_PROFILES } from "@/lib/types";
import type { PackPlatform } from "@/lib/listing-packs";
import ReferenceImageGrid from "@/components/reference-image-grid";
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
  id: string;
  url: string;
  filename: string;
  collection: string;
}

interface Props {
  initialSources: Source[];
  initialGenerations: Generation[];
  presets: Preset[];
}

const REFS_PER_PAGE = 40;
const TEST_PRODUCTS_PER_PAGE = 40;

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
  {
    id: "flux-2",
    label: "FLUX 2 (BFL) — fast, multi-reference, separate pipeline",
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
  const [packPlatform, setPackPlatform] = useState<PackPlatform>("amazon");
  const [refsPage, setRefsPage] = useState(0);
  const [testProductsPage, setTestProductsPage] = useState(0);
  const [dropTargetPresetId, setDropTargetPresetId] = useState<string | null>(
    null,
  );
  const [dropToast, setDropToast] = useState<string | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [regeneratingNames, setRegeneratingNames] = useState(false);
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

  const reloadTestProducts = useCallback(async () => {
    try {
      const r = await fetch("/api/test-products", { cache: "no-store" });
      const j = await r.json();
      setTestProducts(j.products ?? []);
    } catch {
      setTestProducts([]);
    }
  }, []);

  useEffect(() => {
    if (testProducts !== null || !showTestProducts) return;
    void reloadTestProducts();
  }, [showTestProducts, testProducts, reloadTestProducts]);

  const toggleTestProduct = useCallback((id: string) => {
    setSelectedTestProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
    setRefsPage(0);
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
        packId?: string;
        packPlatform?: PackPlatform;
        packRole?: string;
        packShotIndex?: number;
        shotFraming?: string;
        parentGenerationId?: string;
        prebuiltPrompt?: string;
        model?: ImageModelId;
        presetIdOverride?: string;
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
            presetId: overrides?.presetIdOverride ?? presetId,
            model: overrides?.model ?? model,
            referenceUrls,
            quality: overrides?.quality ?? quality,
            sizeProfile: overrides?.sizeProfile ?? sizeProfile,
            seed: overrides?.seed,
            reusePromptFromGenerationId: overrides?.reusePromptFromGenerationId,
            packId: overrides?.packId,
            packPlatform: overrides?.packPlatform,
            packRole: overrides?.packRole,
            packShotIndex: overrides?.packShotIndex,
            shotFraming: overrides?.shotFraming,
            parentGenerationId: overrides?.parentGenerationId,
            prebuiltPrompt: overrides?.prebuiltPrompt,
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

  const onGeneratePackForSource = useCallback(
    async (sourceId: string) => {
      if (!presetId) return;
      try {
        const res = await fetch("/api/listing-packs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceId,
            presetId,
            platform: packPlatform,
            model,
            quality,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        const plan = json as {
          packId: string;
          platform: PackPlatform;
          seed: number;
          shots: Array<{
            packId: string;
            packPlatform: PackPlatform;
            packRole: string;
            packShotIndex: number;
            shotFraming: string;
            sizeProfile: string;
            seed: number;
            label: string;
          }>;
        };
        // Fire all shots in parallel. Each one runs its own constructPrompt
        // (the shotFraming overrides the framing block) and renders.
        await Promise.all(
          plan.shots.map((shot) =>
            runGeneration(sourceId, [], {
              quality,
              sizeProfile: shot.sizeProfile as SizeProfileId,
              seed: shot.seed,
              packId: shot.packId,
              packPlatform: shot.packPlatform,
              packRole: shot.packRole,
              packShotIndex: shot.packShotIndex,
              shotFraming: shot.shotFraming,
            }),
          ),
        );
        await refresh();
      } catch (err) {
        console.error("pack generation failed:", err);
        alert(
          `Pack generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [presetId, packPlatform, model, quality, runGeneration, refresh],
  );

  const router = useRouter();
  const onAddImageToPreset = useCallback(
    async (presetDbId: string, presetName: string, imageUrl: string) => {
      try {
        const res = await fetch(
          `/api/admin/presets/${presetDbId}/images`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceUrl: imageUrl }),
          },
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        setDropToast(`Added to ${presetName}`);
        window.setTimeout(() => setDropToast(null), 2500);
        router.refresh();
      } catch (err) {
        alert(
          `Couldn't add to preset: ${err instanceof Error ? err.message : err}`,
        );
      }
    },
    [router],
  );

  const onCompleteLook = useCallback(
    async (gen: Generation, platform: PackPlatform) => {
      if (!gen.outputUrl || gen.status !== "succeeded") return;
      try {
        const res = await fetch("/api/complete-look", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            generationId: gen.id,
            platform,
            model: "flux-kontext",
            quality: gen.quality,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        const plan = json as {
          packId: string;
          platform: PackPlatform;
          seed: number;
          parentGenerationId: string;
          sourceId: string;
          presetId: string;
          model: ImageModelId;
          shots: Array<{
            packId: string;
            packPlatform: PackPlatform;
            packRole: string;
            packShotIndex: number;
            shotFraming: string;
            sizeProfile: string;
            seed: number;
            label: string;
            prompt: string;
          }>;
        };
        await Promise.all(
          plan.shots.map((shot) =>
            runGeneration(plan.sourceId, [], {
              quality: gen.quality,
              sizeProfile: shot.sizeProfile as SizeProfileId,
              seed: shot.seed,
              packId: shot.packId,
              packPlatform: shot.packPlatform,
              packRole: shot.packRole,
              packShotIndex: shot.packShotIndex,
              shotFraming: shot.shotFraming,
              parentGenerationId: plan.parentGenerationId,
              prebuiltPrompt: shot.prompt,
              model: plan.model,
              presetIdOverride: plan.presetId,
            }),
          ),
        );
        await refresh();
      } catch (err) {
        console.error("complete-look failed:", err);
        alert(
          `Complete look failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [runGeneration, refresh],
  );

  const onRetry = useCallback(
    async (gen: Generation) => {
      // Re-run with the SAME source and prompt (no Claude pass) and a NEW
      // seed so we don't immediately hit the same fal failure pattern. Used
      // to recover failed rows without losing the prompt work.
      await runGeneration(gen.sourceId, [], {
        quality: gen.quality,
        sizeProfile: gen.sizeProfile,
        reusePromptFromGenerationId: gen.id,
      });
    },
    [runGeneration],
  );

  const onGenerateBatch = useCallback(async () => {
    if (!presetId) return;
    const refs = Array.from(selectedRefs);
    if (refs.length === 0) return;

    const importedFromTest = await Promise.all(
      Array.from(selectedTestProducts).map(async (id) => {
        try {
          const res = await fetch("/api/sources", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ testProductId: id }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
          return json.source as Source;
        } catch (err) {
          console.error(`failed to import test product ${id}:`, err);
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
      <header className="mb-8 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Generate</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Upload or pick a product photo, choose a preset, generate.
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          {sources.length} sources · {generations.length} generations
        </div>
      </header>

      <section className="mb-12 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Preset
            </label>
            <button
              type="button"
              disabled={regeneratingNames}
              onClick={async () => {
                if (
                  !confirm(
                    "Regenerate creative names + taglines for all presets that don't have a tagline yet? You can edit each one after.",
                  )
                )
                  return;
                setRegeneratingNames(true);
                try {
                  const res = await fetch(
                    "/api/admin/presets/regenerate-names",
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({}),
                    },
                  );
                  const json = await res.json();
                  if (!res.ok)
                    throw new Error(json?.error ?? `HTTP ${res.status}`);
                  setDropToast(
                    `Renamed ${json.updated} preset${json.updated === 1 ? "" : "s"}`,
                  );
                  window.setTimeout(() => setDropToast(null), 2500);
                  router.refresh();
                } catch (err) {
                  alert(
                    `Couldn't regenerate names: ${err instanceof Error ? err.message : err}`,
                  );
                } finally {
                  setRegeneratingNames(false);
                }
              }}
              className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
              title="Use AI to write a creative name + uppercase tagline for any preset that doesn't have a tagline yet"
            >
              {regeneratingNames ? "Renaming…" : "Regenerate names"}
            </button>
          </div>
          <div
            className="sticky top-0 z-40 -mx-6 mt-3 grid auto-cols-[minmax(144px,1fr)] grid-flow-col grid-rows-2 gap-3 overflow-x-auto bg-white/95 px-6 pb-3 pt-3 backdrop-blur dark:bg-zinc-900/95"
          >
            <button
              type="button"
              onClick={async () => {
                const name = window.prompt("New preset name:");
                if (!name) return;
                try {
                  const res = await fetch("/api/admin/presets", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ name }),
                  });
                  const json = await res.json();
                  if (!res.ok)
                    throw new Error(json?.error ?? `HTTP ${res.status}`);
                  router.refresh();
                } catch (err) {
                  alert(
                    `Couldn't create: ${err instanceof Error ? err.message : err}`,
                  );
                }
              }}
              className="flex shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50/50 text-xs text-zinc-500 transition hover:border-emerald-500 hover:bg-emerald-50/50 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300"
              style={{ height: 198 }}
              title="Create a new preset"
            >
              <span className="text-2xl">+</span>
              <span className="mt-1 font-medium">New preset</span>
            </button>
            {presets.map((p) => {
              const isActive = p.id === presetId;
              const previewUrl = p.heroImageUrl ?? p.referenceImageUrls[0];
              const isDropTarget = dropTargetPresetId === p.dbId;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPresetId(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPresetId(p.id);
                    }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDropTargetPresetId(p.dbId);
                  }}
                  onDragOver={(e) => {
                    // Always preventDefault so the browser permits the drop.
                    // Data MIME types are sometimes hidden during dragover
                    // for cross-origin security; we inspect them at drop.
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    if (dropTargetPresetId !== p.dbId)
                      setDropTargetPresetId(p.dbId);
                  }}
                  onDragLeave={() => {
                    if (dropTargetPresetId === p.dbId)
                      setDropTargetPresetId(null);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDropTargetPresetId(null);
                    console.log(
                      "[drop] target preset:",
                      p.dbId,
                      p.name,
                      "types:",
                      Array.from(e.dataTransfer.types),
                    );
                    // Move flow: dragged from another preset's reference grid.
                    // Try the custom MIME first; if missing (Safari strips
                    // some custom MIMEs), fall back to the prefix-encoded
                    // payload smuggled through text/plain.
                    let moveData = e.dataTransfer.getData(
                      "application/x-sceneify-image-ids",
                    );
                    if (!moveData) {
                      const plain = e.dataTransfer.getData("text/plain");
                      if (plain.startsWith("__sceneify-move__")) {
                        moveData = plain.slice("__sceneify-move__".length);
                      }
                    }
                    console.log("[drop] moveData:", moveData);
                    if (moveData) {
                      try {
                        const parsed = JSON.parse(moveData) as {
                          ids: string[];
                          sourcePresetDbId: string | null;
                        };
                        console.log(
                          "[drop] parsed move:",
                          parsed,
                          "same preset?",
                          parsed.sourcePresetDbId === p.dbId,
                        );
                        if (parsed.sourcePresetDbId === p.dbId) {
                          setDropToast(
                            "Already in this preset — pick a different one",
                          );
                          window.setTimeout(() => setDropToast(null), 2000);
                          return;
                        }
                        const res = await fetch(
                          "/api/admin/preset-images/move",
                          {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              imageIds: parsed.ids,
                              targetPresetId: p.dbId,
                            }),
                          },
                        );
                        const json = await res.json();
                        console.log(
                          "[drop] move response:",
                          res.status,
                          json,
                        );
                        if (!res.ok)
                          throw new Error(json?.error ?? `HTTP ${res.status}`);
                        setDropToast(
                          `Moved ${parsed.ids.length} ${
                            parsed.ids.length === 1 ? "image" : "images"
                          } to ${p.name}`,
                        );
                        window.setTimeout(() => setDropToast(null), 2500);
                        router.refresh();
                      } catch (err) {
                        alert(
                          `Move failed: ${err instanceof Error ? err.message : err}`,
                        );
                      }
                      return;
                    }
                    // Clone flow: dragged from a generation card (or any URL).
                    // Handles multi-line uri-list by cloning each. Skip
                    // text/plain if it carries the move sentinel.
                    const uriList = e.dataTransfer.getData("text/uri-list");
                    const plainText = e.dataTransfer.getData("text/plain");
                    const raw =
                      uriList ||
                      (plainText.startsWith("__sceneify-move__")
                        ? ""
                        : plainText);
                    if (!raw) return;
                    const urls = raw
                      .split(/[\r\n]+/)
                      .map((u) => u.trim())
                      .filter((u) => u && !u.startsWith("#"));
                    for (const url of urls) {
                      await onAddImageToPreset(p.dbId, p.name, url);
                    }
                  }}
                  aria-pressed={isActive}
                  className={`group relative shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${
                    isDropTarget
                      ? "border-violet-500 ring-2 ring-violet-500/40"
                      : isActive
                        ? "border-emerald-500 ring-2 ring-emerald-500/30"
                        : "border-zinc-200 hover:border-zinc-500 dark:border-zinc-800 dark:hover:border-zinc-500"
                  }`}
                >
                  <div className="relative aspect-square w-full bg-zinc-100 dark:bg-zinc-950">
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">
                        no thumb
                      </div>
                    )}
                    {isActive && (
                      <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
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
                  </div>
                  <div className="px-2 py-1.5">
                    <div
                      className="truncate font-serif text-sm italic leading-tight text-zinc-900 dark:text-zinc-50"
                      title={p.name}
                    >
                      {p.name}
                    </div>
                    {p.description ? (
                      <div
                        className="mt-0.5 truncate text-[9px] uppercase tracking-[0.14em] text-zinc-500"
                        title={p.description}
                      >
                        {p.description}
                      </div>
                    ) : null}
                    <div className="mt-1 text-[10px] text-zinc-400">
                      {p.referenceImageUrls.length} ref
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPresetId(p.dbId);
                    }}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/85 text-zinc-700 opacity-0 shadow-sm backdrop-blur transition hover:bg-white hover:text-zinc-900 group-hover:opacity-100 dark:bg-zinc-900/85 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    title="Edit name & tagline"
                    aria-label="Edit preset"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    >
                      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.082-.286.235-.547.445-.758l8.61-8.61Z" />
                    </svg>
                  </button>
                </div>
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
                  <span>{activePreset.referenceImages.length} total</span>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    {selectedRefs.size} selected
                  </span>
                  {selectedRefs.size > 0 && (
                    <>
                      <button
                        onClick={() => setSelectedRefs(new Set())}
                        className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        clear
                      </button>
                      <button
                        onClick={async () => {
                          const count = selectedRefs.size;
                          if (
                            !confirm(
                              `Remove ${count} reference image${count === 1 ? "" : "s"} from this preset?`,
                            )
                          )
                            return;
                          const ids = activePreset.referenceImages
                            .filter((r) => selectedRefs.has(r.url))
                            .map((r) => r.id);
                          try {
                            const res = await fetch(
                              "/api/admin/preset-images/delete-batch",
                              {
                                method: "POST",
                                headers: {
                                  "content-type": "application/json",
                                },
                                body: JSON.stringify({ imageIds: ids }),
                              },
                            );
                            const json = await res.json();
                            if (!res.ok)
                              throw new Error(
                                json?.error ?? `HTTP ${res.status}`,
                              );
                            setSelectedRefs(new Set());
                            setDropToast(
                              `Deleted ${json.deleted} image${json.deleted === 1 ? "" : "s"}`,
                            );
                            window.setTimeout(() => setDropToast(null), 2500);
                            router.refresh();
                          } catch (err) {
                            alert(
                              `Bulk delete failed: ${err instanceof Error ? err.message : err}`,
                            );
                          }
                        }}
                        className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-rose-500"
                      >
                        Delete {selectedRefs.size}
                      </button>
                    </>
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
                  {activePreset.referenceImages.length === 0 && (
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            `Delete preset "${activePreset.name}"? It's empty so no images are lost.`,
                          )
                        )
                          return;
                        try {
                          const res = await fetch(
                            `/api/admin/presets/${activePreset.dbId}`,
                            { method: "DELETE" },
                          );
                          if (!res.ok) throw new Error(await res.text());
                          // Pick a sibling preset to view if any remain.
                          const remaining = presets.filter(
                            (p) => p.id !== activePreset.id,
                          );
                          if (remaining[0]) setPresetId(remaining[0].id);
                          setDropToast(
                            `Deleted preset "${activePreset.name}"`,
                          );
                          window.setTimeout(() => setDropToast(null), 2500);
                          router.refresh();
                        } catch (err) {
                          alert(
                            `Delete failed: ${err instanceof Error ? err.message : err}`,
                          );
                        }
                      }}
                      className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-rose-500"
                      title="Delete this empty preset"
                    >
                      Delete preset
                    </button>
                  )}
                </div>
              </div>
              {activePreset.referenceImages.length === 0 ? (
                <div className="rounded border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  No images yet for this preset. Add some in{" "}
                  <a
                    href={`/admin/presets/${activePreset.id}`}
                    className="underline underline-offset-2"
                  >
                    /admin/presets/{activePreset.id}
                  </a>
                  .
                </div>
              ) : (
                <>
                  {(() => {
                    const favorites = activePreset.referenceImages.filter(
                      (r) => r.favorited,
                    );
                    if (favorites.length === 0) return null;
                    return (
                      <div className="mb-4 rounded-md border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
                        <div className="mb-2 flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-1.5 font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
                            <svg
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6.5 5.5 5.5 0 0 1 21.5 12c-2.5 4.5-9.5 9-9.5 9z" />
                            </svg>
                            Favorites · {favorites.length}
                          </div>
                          <button
                            onClick={() =>
                              setSelectedRefs(
                                new Set(favorites.map((f) => f.url)),
                              )
                            }
                            className="text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                          >
                            select all favorites
                          </button>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-2">
                          {favorites.map((f) => {
                            const isSel = selectedRefs.has(f.url);
                            const aspect =
                              (f.width || 1) / (f.height || 1);
                            const ROW_H = 260;
                            const w = Math.round(ROW_H * aspect);
                            return (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => toggleRef(f.url)}
                                title={f.filename}
                                className={`relative shrink-0 overflow-hidden rounded-md border-2 transition ${
                                  isSel
                                    ? "border-emerald-500 ring-2 ring-emerald-500/40"
                                    : "border-zinc-200 hover:border-zinc-500 dark:border-zinc-800 dark:hover:border-zinc-500"
                                }`}
                                style={{ width: w, height: ROW_H }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={f.url}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                                {isSel && (
                                  <span className="pointer-events-none absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                                    <svg
                                      viewBox="0 0 16 16"
                                      fill="currentColor"
                                      className="h-2.5 w-2.5"
                                      aria-hidden="true"
                                    >
                                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z" />
                                    </svg>
                                  </span>
                                )}
                                <span
                                  role="button"
                                  aria-label="Unfavorite"
                                  title="Unfavorite"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    try {
                                      const res = await fetch(
                                        `/api/admin/preset-images/${f.id}/favorite`,
                                        {
                                          method: "POST",
                                          headers: {
                                            "content-type": "application/json",
                                          },
                                          body: JSON.stringify({
                                            favorited: false,
                                          }),
                                        },
                                      );
                                      if (!res.ok)
                                        throw new Error(await res.text());
                                      router.refresh();
                                    } catch (err) {
                                      alert(
                                        `Unfavorite failed: ${err instanceof Error ? err.message : err}`,
                                      );
                                    }
                                  }}
                                  className="absolute bottom-1 left-1 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-rose-500 text-white shadow"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  >
                                    <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6.5 5.5 5.5 0 0 1 21.5 12c-2.5 4.5-9.5 9-9.5 9z" />
                                  </svg>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  <Pagination
                    page={refsPage}
                    pageSize={REFS_PER_PAGE}
                    total={activePreset.referenceImages.length}
                    onPageChange={setRefsPage}
                  />
                  <div className="mt-3">
                    <ReferenceImageGrid
                      items={activePreset.referenceImages.slice(
                        refsPage * REFS_PER_PAGE,
                        (refsPage + 1) * REFS_PER_PAGE,
                      )}
                      selectedUrls={selectedRefs}
                      onToggleSelect={toggleRef}
                      onInspect={setInspectImage}
                      enableFavorite
                      enableDelete
                      enableHero
                      heroImageUrl={activePreset.heroImageUrl}
                      sourcePresetDbId={activePreset.dbId}
                    />
                  </div>
                  <Pagination
                    page={refsPage}
                    pageSize={REFS_PER_PAGE}
                    total={activePreset.referenceImages.length}
                    onPageChange={setRefsPage}
                  />
                </>
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

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Listing pack
            </label>
            <select
              value={packPlatform}
              onChange={(e) => setPackPlatform(e.target.value as PackPlatform)}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="amazon">Amazon — 6 shots</option>
              <option value="shopify">Shopify — 4 shots</option>
              <option value="instagram">Instagram — 4 carousel</option>
              <option value="tiktok">TikTok — 3 vertical</option>
            </select>
          </div>
          <p className="max-w-md text-[11px] text-zinc-500">
            One source → a full marketplace shot list with locked seed across
            shots so it&apos;s the same model in the same scene. Hero,
            three-quarter, profile, full body, detail crops — auto-framed.
          </p>
          <button
            onClick={async () => {
              // Same flow as onGenerateBatch: import any selected test
              // products into Sources first, then run a pack per source.
              const importedFromTest = await Promise.all(
                Array.from(selectedTestProducts).map(async (id) => {
                  try {
                    const res = await fetch("/api/sources", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ testProductId: id }),
                    });
                    const json = await res.json();
                    if (!res.ok)
                      throw new Error(json?.error ?? `HTTP ${res.status}`);
                    return json.source as Source;
                  } catch (err) {
                    console.error(`failed to import ${id}:`, err);
                    return null;
                  }
                }),
              );
              const newSources = importedFromTest.filter(
                (s): s is Source => !!s,
              );
              if (newSources.length > 0) {
                setSources((prev) => [...newSources, ...prev]);
              }
              const sourceIds = [
                ...Array.from(selectedSourceIds),
                ...newSources.map((s) => s.id),
              ];
              if (sourceIds.length === 0) {
                alert(
                  "Pick at least one source (uploaded or test product).",
                );
                return;
              }
              setSelectedTestProducts(new Set());
              for (const id of sourceIds) {
                await onGeneratePackForSource(id);
              }
            }}
            disabled={
              !presetId ||
              selectedSourceIds.size + selectedTestProducts.size === 0 ||
              pending.size > 0
            }
            className="ml-auto rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600"
            title="Generate the full listing pack for each selected source / test product"
          >
            Generate pack
          </button>
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
                        new Set(testProducts.map((p) => p.id)),
                      )
                    }
                    className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    select all
                  </button>
                )}
                <button
                  onClick={reloadTestProducts}
                  className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                  title="Reload from DB"
                >
                  refresh
                </button>
              </div>
            </div>
            {testProducts === null ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                Loading…
              </div>
            ) : testProducts.length === 0 ? (
              <div className="rounded border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                No test products in the DB yet. Run{" "}
                <code className="font-mono">pnpm db:migrate-test-products</code>
                {" "}to import from the local{" "}
                <code className="font-mono">test-sources/</code> directory.
              </div>
            ) : (() => {
              const totalPages = Math.max(
                1,
                Math.ceil(testProducts.length / TEST_PRODUCTS_PER_PAGE),
              );
              const safePage = Math.min(testProductsPage, totalPages - 1);
              const paged = testProducts.slice(
                safePage * TEST_PRODUCTS_PER_PAGE,
                (safePage + 1) * TEST_PRODUCTS_PER_PAGE,
              );
              return (
                <>
                  <Pagination
                    page={safePage}
                    pageSize={TEST_PRODUCTS_PER_PAGE}
                    total={testProducts.length}
                    onPageChange={setTestProductsPage}
                  />
                  <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {paged.map((p) => {
                  const isSel = selectedTestProducts.has(p.id);
                  const label = p.collection
                    ? `${p.collection}/${p.filename}`
                    : p.filename;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleTestProduct(p.id)}
                      aria-pressed={isSel}
                      title={label}
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
                  <Pagination
                    page={safePage}
                    pageSize={TEST_PRODUCTS_PER_PAGE}
                    total={testProducts.length}
                    onPageChange={setTestProductsPage}
                  />
                </>
              );
            })()}
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
                      <SourceGenerations
                        gens={sourceGens}
                        presets={presets}
                        progress={progress}
                        onRegenerateNewSeed={onRegenerateNewSeed}
                        onRetry={onRetry}
                        onAddToPreset={onAddImageToPreset}
                        onCompleteLook={onCompleteLook}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dropToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {dropToast}
        </div>
      )}
      {inspectImage && (
        <ReferenceImageModal
          imageUrl={inspectImage}
          onClose={() => setInspectImage(null)}
        />
      )}
      {editingPresetId && (
        <EditPresetModal
          preset={
            presets.find((p) => p.dbId === editingPresetId) ?? null
          }
          onClose={() => setEditingPresetId(null)}
          onSaved={() => {
            setEditingPresetId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EditPresetModal({
  preset,
  onClose,
  onSaved,
}: {
  preset: Preset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(preset?.name ?? "");
  const [description, setDescription] = useState(preset?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!preset) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/presets/${preset.dbId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const reroll = async () => {
    setRerolling(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/presets/regenerate-names`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ presetIds: [preset.dbId], force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const result = json.results?.[0];
      if (result) {
        setName(result.name);
        setDescription(result.description);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerolling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Edit preset
            </div>
            <div className="mt-1 font-mono text-xs text-zinc-500">
              {preset.id}
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

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Studio Athletic"
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-serif text-base italic dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Tagline
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="STUDIO · SOFT STROBE"
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs uppercase tracking-[0.14em] dark:border-zinc-700 dark:bg-zinc-950"
            />
            <div className="mt-1 text-[10px] text-zinc-500">
              Two or three uppercase words separated by &nbsp;·&nbsp;
            </div>
          </div>
          {error && (
            <div className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={reroll}
            disabled={rerolling || saving}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
            title="Re-roll the name + tagline using AI"
          >
            {rerolling ? "Re-rolling…" : "Re-roll with AI"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || rerolling || !name.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
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

function SourceGenerations({
  gens,
  presets,
  progress,
  onRegenerateNewSeed,
  onRetry,
  onAddToPreset,
  onCompleteLook,
}: {
  gens: Generation[];
  presets: Preset[];
  progress: Map<string, ProgressState>;
  onRegenerateNewSeed: (gen: Generation) => void;
  onRetry: (gen: Generation) => void;
  onAddToPreset: (
    presetDbId: string,
    presetName: string,
    imageUrl: string,
  ) => Promise<void>;
  onCompleteLook: (gen: Generation, platform: PackPlatform) => Promise<void>;
}) {
  // Group by packId. Standalones (no packId) end up in `singletons`.
  const packs = new Map<string, Generation[]>();
  const singletons: Generation[] = [];
  for (const g of gens) {
    if (g.packId) {
      const arr = packs.get(g.packId) ?? [];
      arr.push(g);
      packs.set(g.packId, arr);
    } else {
      singletons.push(g);
    }
  }
  const packEntries = Array.from(packs.entries()).map(([packId, items]) => {
    const sorted = [...items].sort(
      (a, b) => (a.packShotIndex ?? 0) - (b.packShotIndex ?? 0),
    );
    return { packId, items: sorted };
  });
  // Sort packs by their newest generation's createdAt desc.
  packEntries.sort((a, b) => {
    const ta = Math.max(
      ...a.items.map((g) => new Date(g.createdAt).getTime()),
    );
    const tb = Math.max(
      ...b.items.map((g) => new Date(g.createdAt).getTime()),
    );
    return tb - ta;
  });

  return (
    <div className="space-y-5">
      {packEntries.map(({ packId, items }) => {
        const platform = items[0]?.packPlatform ?? "pack";
        const seed = items[0]?.seed;
        return (
          <div
            key={packId}
            className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/60 dark:bg-violet-950/20"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
                <span>{platform} pack</span>
                <span className="text-zinc-400">·</span>
                <span>{items.length} shots</span>
                {typeof seed === "number" && (
                  <>
                    <span className="text-zinc-400">·</span>
                    <span className="font-mono normal-case text-zinc-500">
                      seed {seed}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="columns-2 gap-3 sm:columns-3">
              {items.map((g) => (
                <div key={g.id} className="mb-3 break-inside-avoid">
                  <GenerationCard
                    gen={g}
                    preset={presets.find((p) => p.id === g.presetId)}
                    progress={progress.get(g.id) ?? null}
                    onRegenerateNewSeed={onRegenerateNewSeed}
                    onRetry={onRetry}
                    presets={presets}
                    onAddToPreset={onAddToPreset}
                    onCompleteLook={onCompleteLook}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {singletons.length > 0 && (
        <div className="columns-2 gap-3 sm:columns-3">
          {singletons.map((g) => (
            <div key={g.id} className="mb-3 break-inside-avoid">
              <GenerationCard
                gen={g}
                preset={presets.find((p) => p.id === g.presetId)}
                progress={progress.get(g.id) ?? null}
                onRegenerateNewSeed={onRegenerateNewSeed}
                onRetry={onRetry}
                presets={presets}
                onAddToPreset={onAddToPreset}
                onCompleteLook={onCompleteLook}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GenerationCard({
  gen,
  preset,
  progress,
  onRegenerateNewSeed,
  onRetry,
  presets,
  onAddToPreset,
  onCompleteLook,
}: {
  gen: Generation;
  preset?: Preset;
  progress: ProgressState | null;
  onRegenerateNewSeed: (gen: Generation) => void;
  onRetry: (gen: Generation) => void;
  presets: Preset[];
  onAddToPreset: (
    presetDbId: string,
    presetName: string,
    imageUrl: string,
  ) => Promise<void>;
  onCompleteLook: (gen: Generation, platform: PackPlatform) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [completePlatformOpen, setCompletePlatformOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const completeBtnRef = useRef<HTMLButtonElement>(null);
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
          <div
            role="button"
            tabIndex={0}
            onClick={() => setLightboxOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setLightboxOpen(true);
              }
            }}
            onContextMenu={(e) => {
              if (!gen.outputUrl) return;
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            draggable
            onDragStart={(e) => {
              if (gen.outputUrl) {
                e.dataTransfer.setData("text/uri-list", gen.outputUrl);
                e.dataTransfer.setData("text/plain", gen.outputUrl);
                e.dataTransfer.effectAllowed = "copy";
              }
            }}
            className="block h-full w-full cursor-zoom-in"
            aria-label="Open larger version (or drag, or right-click to add to a preset)"
            title="Click to enlarge · drag onto a preset chip · right-click to add to a preset"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gen.outputUrl}
              alt="generated"
              draggable={false}
              onContextMenu={(e) => {
                if (!gen.outputUrl) return;
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY });
              }}
              className="h-full w-full object-cover"
            />
          </div>
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
          {gen.register && <RegisterBadge register={gen.register} />}
          {gen.packRole && (
            <span
              className="inline-flex items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
              title={gen.shotFraming ?? ""}
            >
              {gen.packRole}
            </span>
          )}
          {typeof gen.colorMaxDeltaE === "number" &&
            gen.status === "succeeded" && (
              <ColorDriftBadge
                maxDeltaE={gen.colorMaxDeltaE}
                avgDeltaE={gen.colorAvgDeltaE ?? 0}
                source={gen.sourceColors ?? []}
                output={gen.outputColors ?? []}
              />
            )}
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
          <LatencyBadge
            createdAt={gen.createdAt}
            completedAt={gen.completedAt}
            live={Boolean(isLive)}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {gen.status === "failed" && !isLive && (
            <button
              onClick={() => onRetry(gen)}
              className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
              title="Retry with the same prompt + a fresh seed"
            >
              ↻ Regenerate
            </button>
          )}
          {gen.status === "succeeded" && gen.outputUrl && (
            <button
              ref={completeBtnRef}
              onClick={() => setCompletePlatformOpen((o) => !o)}
              disabled={completing}
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              title="Generate matching shots that continue this look (same model, same garment)"
            >
              {completing ? "Planning…" : "✨ Complete look"}
            </button>
          )}
          {completePlatformOpen && completeBtnRef.current && (
            <CompleteLookPlatformMenu
              anchor={completeBtnRef.current}
              onPick={async (platform) => {
                setCompletePlatformOpen(false);
                setCompleting(true);
                try {
                  await onCompleteLook(gen, platform);
                } finally {
                  setCompleting(false);
                }
              }}
              onClose={() => setCompletePlatformOpen(false)}
            />
          )}
          {gen.constructedPrompt && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {open ? "Hide prompt" : "Show prompt"}
            </button>
          )}
          {Boolean(
            gen.falEndpoint || gen.falInput || gen.falResponse,
          ) && (
            <button
              onClick={() => setDebugOpen((o) => !o)}
              className="text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {debugOpen ? "Hide fal request" : "Show fal request"}
            </button>
          )}
        </div>
        {open && gen.constructedPrompt && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            {gen.constructedPrompt}
          </pre>
        )}
        {debugOpen && (
          <FalRequestDetails gen={gen} />
        )}
      </div>
      {lightboxOpen && gen.outputUrl && (
        <ImageLightbox
          imageUrl={gen.outputUrl}
          caption={`${gen.model}${
            gen.packRole ? ` · ${gen.packRole}` : ""
          } · ${gen.size}${
            typeof gen.seed === "number" ? ` · seed ${gen.seed}` : ""
          }`}
          onClose={() => setLightboxOpen(false)}
        />
      )}
      {menu && gen.outputUrl && (
        <AddToPresetMenu
          x={menu.x}
          y={menu.y}
          presets={presets}
          onPick={async (p) => {
            setMenu(null);
            await onAddToPreset(p.dbId, p.name, gen.outputUrl!);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function AddToPresetMenu({
  x,
  y,
  presets,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  presets: Preset[];
  onPick: (p: Preset) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const filtered = query.trim()
    ? presets.filter((p) =>
        p.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : presets;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const W = 240;
  const H = 320;
  const left = Math.min(x, vw - W - 8);
  const top = Math.min(y, vh - H - 8);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: W, zIndex: 1000 }}
      className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add to preset…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-zinc-400"
        />
      </div>
      <div className="max-h-72 overflow-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-zinc-500">No matches</div>
        ) : (
          filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {p.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const COMPLETE_LOOK_PLATFORMS: Array<{
  id: PackPlatform;
  label: string;
  hint: string;
}> = [
  { id: "amazon", label: "Amazon", hint: "6 shots · hero + lifestyle + details" },
  { id: "shopify", label: "Shopify", hint: "4 shots · hero + supporting" },
  { id: "instagram", label: "Instagram", hint: "4 frames · 4:5 carousel" },
  { id: "tiktok", label: "TikTok", hint: "3 vertical · 9:16" },
];

function CompleteLookPlatformMenu({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  onPick: (platform: PackPlatform) => void | Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !anchor.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchor]);

  const rect = anchor.getBoundingClientRect();
  const W = 224;
  const H = 220;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const left = Math.min(Math.max(8, rect.left), vw - W - 8);
  const top = rect.bottom + H + 8 < vh ? rect.bottom + 4 : rect.top - H - 4;

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: W, zIndex: 1000 }}
      className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="border-b border-zinc-200 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
        Complete look as…
      </div>
      <div className="py-1">
        {COMPLETE_LOOK_PLATFORMS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <div className="font-medium text-zinc-800 dark:text-zinc-100">
              {p.label}
            </div>
            <div className="text-[10px] text-zinc-500">{p.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ImageLightbox({
  imageUrl,
  caption,
  onClose,
}: {
  imageUrl: string;
  caption?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 backdrop-blur"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] cursor-zoom-out rounded-md object-contain shadow-2xl"
      />
      <div className="flex items-center gap-4 text-xs text-white/80">
        {caption && <span>{caption}</span>}
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded border border-white/30 px-2 py-1 hover:bg-white/10"
        >
          Open original
        </a>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-white/30 px-2 py-1 hover:bg-white/10"
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}

function FalRequestDetails({ gen }: { gen: Generation }) {
  const sections: { label: string; value: unknown }[] = [
    { label: "endpoint", value: gen.falEndpoint },
    { label: "request_id", value: gen.falRequestId },
    { label: "model used", value: gen.model },
    { label: "requested model", value: gen.requestedModel },
    { label: "size profile → native", value: `${gen.sizeProfile} → ${gen.size}` },
    { label: "quality", value: gen.quality },
    { label: "seed", value: gen.seed },
    { label: "fal input", value: gen.falInput },
    { label: "fal response", value: gen.falResponse },
  ];
  return (
    <div className="mt-2 space-y-2 rounded bg-zinc-50 p-2 text-[11px] leading-relaxed dark:bg-zinc-950">
      {sections
        .filter((s) => s.value !== undefined && s.value !== null)
        .map((s) => (
          <div key={s.label}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {s.label}
            </div>
            {typeof s.value === "string" || typeof s.value === "number" ? (
              <div className="break-all font-mono text-zinc-800 dark:text-zinc-200">
                {String(s.value)}
              </div>
            ) : (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {JSON.stringify(s.value, null, 2)}
              </pre>
            )}
          </div>
        ))}
      <button
        onClick={() => {
          navigator.clipboard.writeText(
            JSON.stringify(
              {
                endpoint: gen.falEndpoint,
                request_id: gen.falRequestId,
                input: gen.falInput,
                response: gen.falResponse,
              },
              null,
              2,
            ),
          );
        }}
        className="rounded border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Copy debug JSON
      </button>
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
  "flux-2": {
    short: "FLUX 2",
    cls: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200",
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

function formatLatency(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m${r.toString().padStart(2, "0")}s`;
}

function LatencyBadge({
  createdAt,
  completedAt,
  live,
}: {
  createdAt: string;
  completedAt?: string;
  live: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [live]);
  const start = new Date(createdAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : live ? now : start;
  const ms = Math.max(0, end - start);
  const cls = live
    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${cls}`}
      title={live ? "Elapsed time" : "Total render time (created → completed)"}
    >
      {live ? "⏱" : "⏱"} {formatLatency(ms)}
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

function ColorDriftBadge({
  maxDeltaE,
  avgDeltaE,
  source,
  output,
}: {
  maxDeltaE: number;
  avgDeltaE: number;
  source: { hex: string; label: string }[];
  output: { hex: string; label: string }[];
}) {
  const status =
    maxDeltaE < 12 ? "ok" : maxDeltaE < 25 ? "drift" : "severe";
  const cls =
    status === "ok"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : status === "drift"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  const label =
    status === "ok"
      ? "color ok"
      : status === "drift"
        ? "color drift"
        : "severe drift";
  const tooltipLines = [
    `max ΔE ${maxDeltaE.toFixed(1)} · avg ΔE ${avgDeltaE.toFixed(1)}`,
    `source: ${source.map((s) => s.hex).join(", ")}`,
    `output: ${output.map((o) => o.hex).join(", ")}`,
  ].join("\n");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={tooltipLines}
    >
      <span>{label}</span>
      <span className="font-mono">ΔE {maxDeltaE.toFixed(0)}</span>
      {source.slice(0, 2).map((s, i) => (
        <span key={i} className="flex items-center gap-0.5">
          <span
            className="inline-block h-2 w-2 rounded-sm border border-black/10"
            style={{ backgroundColor: s.hex }}
          />
          <span
            className="inline-block h-2 w-2 rounded-sm border border-black/10"
            style={{ backgroundColor: output[i]?.hex ?? "#000" }}
          />
        </span>
      ))}
    </span>
  );
}

function RegisterBadge({ register }: { register: RegisterId }) {
  const meta = REGISTERS.find((r) => r.id === register);
  if (!meta) return null;
  const cls: Record<RegisterId, string> = {
    "catalog-dtc":
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    "editorial-fashion":
      "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    "sun-drenched-lifestyle":
      "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
    "studio-glamour":
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls[register]}`}
      title={meta.hint}
    >
      {meta.label}
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

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
      <span>
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ‹ Prev
        </button>
        <span>
          Page {page + 1} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Next ›
        </button>
      </div>
    </div>
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
