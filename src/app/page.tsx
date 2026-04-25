import { listGenerations, listPresets, listSources } from "@/lib/db";
import Dashboard from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [sources, generations, presets] = await Promise.all([
    listSources(),
    listGenerations(),
    listPresets(),
  ]);

  return (
    <Dashboard
      initialSources={sources}
      initialGenerations={generations}
      presets={presets}
    />
  );
}
