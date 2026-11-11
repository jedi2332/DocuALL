import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, LockOpen, Undo2, Download, FolderPlus, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sortFiles, suggestPattern, relatedGroups, addAlias, editAlias, removeAlias, UNSORTED, type OrgFile, type OrgFolder, type Suggestion, type AliasCandidate } from "@/lib/organize";
import { clueProblem } from "@/lib/fuzzy-match";
import {
  getOrganizeSettings, saveOrganizeSettings, listVaults, createVault, updateVault, deleteVault,
  readFiles, buildZip, logRun, listRuns, preparedZips,
} from "@/lib/organize-api";
import { downloadBytes } from "@/lib/image-utils";

export const Route = createFileRoute("/_authenticated/organize")({
  head: () => ({
    meta: [
      { title: "Organize — DocuALL" },
      { name: "description", content: "Sort messy photos and files into clean folders, with protected project vaults." },
      { property: "og:title", content: "Organize — DocuALL" },
      { property: "og:description", content: "Sort messy photos and files into clean folders, with protected project vaults." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrganizePage,
});

type Tab = "sort" | "vaults" | "folders";
interface Item { file: File; meta: OrgFile }

function OrganizePage() {
  const [tab, setTab] = useState<Tab>("sort");
  return (
    <AppShell title="Organize">
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-card p-1">
        {(["sort", "vaults", "folders"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("h-11 rounded-lg text-sm font-medium", tab === t ? "bg-primary text-primary-foreground" : "text-foreground")}
          >
            {t === "sort" ? "Sort" : t === "vaults" ? "Vaults" : "Folders & rules"}
          </button>
        ))}
      </div>
      {tab === "sort" && <SortTab />}
      {tab === "vaults" && <VaultsTab />}
      {tab === "folders" && <FoldersTab />}
    </AppShell>
  );
}

function useIsGuest() {
  const [guest, setGuest] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setGuest(!!data.user?.is_anonymous));
  }, []);
  return guest;
}

function useFolderPicking() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const el = document.createElement("input");
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    setOk("webkitdirectory" in el && !mobile);
  }, []);
  return ok;
}

function GuestNote({ what }: { what: string }) {
  if (!useIsGuest()) return null;
  return (
    <div className="rounded-xl border border-primary/60 bg-card p-3 text-sm text-foreground">
      You're using DocuALL as a guest. Your {what} are tied to this browser — clearing browser data, private browsing, or switching phones loses them.{" "}
      <Link to="/settings" className="font-medium text-primary underline">Save your account</Link> (just email + password) to keep access anywhere.
    </div>
  );
}

function useSettings() {
  return useQuery({ queryKey: ["organize-settings"], queryFn: getOrganizeSettings });
}

function SortTab() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: vaults = [] } = useQuery({ queryKey: ["vaults"], queryFn: listVaults });
  const [items, setItems] = useState<Item[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [rulePrompt, setRulePrompt] = useState<{ pattern: string; folder: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const canPickFolder = useFolderPicking();

  const folders = settings?.folders ?? [];
  const suggestions = useMemo<Suggestion[]>(
    () => (settings ? sortFiles(items.map((i) => i.meta), folders, settings.rules, vaults) : []),
    [items, settings, vaults, folders],
  );
  const byId = new Map(items.map((i) => [i.meta.id, i]));
  const groupsSuggested = useMemo(() => relatedGroups(items.map((i) => i.meta), suggestions), [items, suggestions]);
  const finalFolder = (s: Suggestion) => (s.confidence === "locked" ? s.folder : overrides[s.fileId] ?? s.folder);
  const folderNames = [...folders.map((f) => f.name), ...vaults.map((v) => v.name), UNSORTED];

  const onPick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const read = await readFiles([...list]);
      setItems((prev) => [...prev, ...read]);
    } finally {
      setBusy(false);
    }
  };

  const move = (s: Suggestion, to: string) => {
    setHistory((h) => [...h, overrides]);
    setOverrides((o) => ({ ...o, [s.fileId]: to }));
    const item = byId.get(s.fileId);
    if (item && to !== UNSORTED) setRulePrompt({ pattern: suggestPattern(item.meta.name), folder: to });
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setOverrides(prev);
    setHistory((h) => h.slice(0, -1));
  };

  const teachAlias = async (c: AliasCandidate) => {
    if (!settings) return;
    const res = addAlias(settings.rules, c, c.found);
    if (!res.rules) { toast.error(res.error); return; }
    await saveOrganizeSettings(folders, res.rules);
    qc.invalidateQueries({ queryKey: ["organize-settings"] });
    toast.success(`Saved: “${c.found}” means “${c.clue}”. Edit or remove it in Folders & rules.`);
  };

  const saveRule = async () => {
    if (!rulePrompt || !settings || !rulePrompt.pattern.trim()) return;
    const problem = clueProblem(rulePrompt.pattern);
    if (problem) { toast.error(problem); return; }
    await saveOrganizeSettings(folders, [...settings.rules, { id: crypto.randomUUID(), pattern: rulePrompt.pattern.trim(), folder: rulePrompt.folder }]);
    qc.invalidateQueries({ queryKey: ["organize-settings"] });
    setRulePrompt(null);
    toast.success("Rule saved — edit it any time in Folders & rules");
  };

  const apply = async () => {
    setBusy(true);
    try {
      const entries = suggestions.map((s) => {
        const it = byId.get(s.fileId)!;
        return {
          file: it.file, meta: it.meta, folder: finalFolder(s), locked: s.confidence === "locked",
          duplicateOfName: s.duplicateOf ? byId.get(s.duplicateOf)?.meta.path : undefined,
        };
      });
      const blob = await buildZip(entries);
      const stamp = new Date().toISOString().slice(0, 10);
      const zipName = `DocuALL-organized-${stamp}.zip`;
      const runId = await logRun(entries.map((e) => ({ file: e.meta.path, to: e.duplicateOfName && !e.locked ? "Duplicates to review" : e.folder })));
      preparedZips.set(runId, { blob, name: zipName });
      downloadBytes(new Uint8Array(await blob.arrayBuffer()), zipName, "application/zip");
      qc.invalidateQueries({ queryKey: ["organize-runs"] });
      toast.success("Download started. Your original files were not touched.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const groups = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const k = s.duplicateOf ? "Duplicates to review" : finalFolder(s);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-display font-semibold text-foreground">Sort copies into a ZIP</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your files stay exactly where they are. DocuALL sorts copies and gives you one ZIP download. Nothing is moved or deleted on your device.
        </p>
        <div className={cn("mt-3 grid gap-2", canPickFolder ? "grid-cols-2" : "grid-cols-1")}>
          <Button className="h-12" onClick={() => inputRef.current?.click()} disabled={busy}>Add files</Button>
          {canPickFolder && <Button className="h-12" variant="secondary" onClick={() => folderRef.current?.click()} disabled={busy}>Add a folder</Button>}
        </div>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
        <input
          ref={folderRef} type="file" multiple hidden
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => { onPick(e.target.files); e.target.value = ""; }}
        />
        {busy && <p className="mt-2 text-sm text-muted-foreground">Reading files…</p>}
      </div>

      {rulePrompt && (
        <div className="space-y-2 rounded-xl border border-primary/60 bg-card p-4">
          <p className="text-sm text-foreground">Always use this rule? Files whose name contains:</p>
          <Input value={rulePrompt.pattern} onChange={(e) => setRulePrompt({ ...rulePrompt, pattern: e.target.value })} />
          <p className="text-sm text-foreground">→ go to <strong>{rulePrompt.folder}</strong></p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="h-11" onClick={() => setRulePrompt(null)}>Just this file</Button>
            <Button className="h-11" onClick={saveRule}>Always</Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm text-muted-foreground">{items.length} files · Unsorted ones need your call</p>
            <Button variant="ghost" size="sm" onClick={undo} disabled={!history.length}><Undo2 className="mr-1 h-4 w-4" />Undo</Button>
            <Button variant="ghost" size="sm" onClick={() => { setItems([]); setOverrides({}); setHistory([]); }}>Clear</Button>
          </div>
          {groupsSuggested.length > 0 && (
            <div className="rounded-xl border border-primary/40 bg-card p-4">
              <p className="font-medium text-foreground">Suggested groups</p>
              <p className="mt-1 text-xs text-muted-foreground">Files that seem to belong together. Just a suggestion — compare them yourself.</p>
              <ul className="mt-2 space-y-3">
                {groupsSuggested.map((g) => (
                  <li key={g.title + g.fileIds.join()} className="text-sm">
                    <p className="font-medium text-foreground">{g.title} <Badge variant="secondary">Suggested</Badge></p>
                    <p className="text-xs text-muted-foreground">{g.evidence}</p>
                    <ul className="mt-1 list-disc pl-5 text-foreground">
                      {g.fileIds.map((id) => <li key={id} className="truncate">{byId.get(id)?.meta.path}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {[...groups.entries()].map(([folder, list]) => (
            <div key={folder} className="rounded-xl border border-border bg-card">
              <p className="border-b border-border px-4 py-3 font-medium text-foreground">{folder} <span className="text-muted-foreground">({list.length})</span></p>
              <ul className="divide-y divide-border">
                {list.map((s) => {
                  const it = byId.get(s.fileId)!;
                  return (
                    <li key={s.fileId} className="space-y-2 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm text-foreground">{it.meta.path}</p>
                        {s.confidence === "locked" ? (
                          <Badge className="gap-1"><Lock className="h-3 w-3" />Locked</Badge>
                        ) : overrides[s.fileId] ? (
                          <Badge variant="secondary">You chose</Badge>
                        ) : (
                          <Badge variant={s.confidence === "strong" ? "default" : "secondary"}>{s.confidence === "strong" ? "Strong match" : "Unsure"}</Badge>
                        )}
                      </div>
                      {s.summary && <p className="text-sm text-foreground">{s.summary}</p>}
                      <p className="text-xs text-muted-foreground">
                        {s.duplicateOf && s.duplicateOf !== s.fileId ? `Exact copy of ${byId.get(s.duplicateOf)?.meta.path} — that one is kept. ` : ""}
                        {s.reasons.join(" · ")}
                      </p>
                      {s.confidence !== "locked" && !overrides[s.fileId] && (s.maybe || s.aliasCandidates) && (
                        <div className="flex flex-wrap gap-2">
                          {s.maybe && s.confidence === "low" && (
                            <Button size="sm" className="h-11" onClick={() => move(s, s.maybe!)}>Confirm: {s.maybe}</Button>
                          )}
                          {s.aliasCandidates?.map((c) => (
                            <Button key={c.clue + c.found} size="sm" variant="secondary" className="h-11" onClick={() => teachAlias(c)}>
                              Teach: “{c.found}” = “{c.clue}”
                            </Button>
                          ))}
                        </div>
                      )}
                      {s.confidence !== "locked" && (
                        <select
                          className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                          value={finalFolder(s)}
                          onChange={(e) => move(s, e.target.value)}
                        >
                          {folderNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <GuestNote what="saved rules, vaults and past exports" />
          <Button className="h-12 w-full" size="lg" onClick={apply} disabled={busy}>
            <Download className="mr-2 h-5 w-5" />Download sorted copies (ZIP)
          </Button>
        </>
      )}
      <RunHistory />
    </div>
  );
}

function RunHistory() {
  const { data: runs = [] } = useQuery({ queryKey: ["organize-runs"], queryFn: listRuns });
  if (!runs.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 font-medium text-foreground">Past exports</p>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {runs.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-1">
            <span className="flex-1">{new Date(r.created_at).toLocaleString("en-US")} · {r.file_count} files · Download started</span>
            {preparedZips.has(r.id) ? (
              <Button variant="secondary" size="sm" className="h-11" onClick={async () => {
                const z = preparedZips.get(r.id)!;
                downloadBytes(new Uint8Array(await z.blob.arrayBuffer()), z.name, "application/zip");
              }}><Download className="mr-1 h-4 w-4" />Download again</Button>
            ) : (
              <span className="text-xs">Re-add files to rebuild</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VaultsTab() {
  const qc = useQueryClient();
  const { data: vaults = [] } = useQuery({ queryKey: ["vaults"], queryFn: listVaults });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const vaultFolderRef = useRef<HTMLInputElement>(null);
  const addTo = useRef<string | null>(null);
  const canPickFolder = useFolderPicking();
  const refresh = () => qc.invalidateQueries({ queryKey: ["vaults"] });

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const read = await readFiles([...list]);
      const files = read.map(({ meta }) => ({ path: meta.path, name: meta.name, size: meta.size, hash: meta.hash }));
      if (addTo.current) {
        const v = vaults.find((x) => x.id === addTo.current)!;
        await updateVault(v.id, { files: [...v.files, ...files] });
      } else {
        await createVault(name.trim(), files);
        setName("");
      }
      refresh();
      toast.success(`${files.length} files protected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save vault");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-display font-semibold text-foreground">Project Vaults</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add the files a video project uses (like a CapCut reel). Locked files are never re-sorted or flagged, and exports keep their exact names and folder paths.
        </p>
        <div className="mt-3 flex gap-2">
          <Input placeholder="Project name, e.g. Caleb Commercials & Ads" value={name} onChange={(e) => setName(e.target.value)} className="h-12" />
          <Button
            className="h-12" disabled={!name.trim() || busy}
            onClick={() => { addTo.current = null; pickRef.current?.click(); }}
          >
            <FolderPlus className="mr-1 h-4 w-4" />Files
          </Button>
          {canPickFolder && (
            <Button
              className="h-12" variant="secondary" disabled={!name.trim() || busy}
              onClick={() => { addTo.current = null; vaultFolderRef.current?.click(); }}
            >
              Folder
            </Button>
          )}
        </div>
        <input
          ref={vaultFolderRef} type="file" multiple hidden
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={pickRef} type="file" multiple hidden
          onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
        />
      </div>
      <GuestNote what="vaults" />
      {vaults.map((v) => (
        <div key={v.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <p className="flex-1 font-medium text-foreground">{v.name}</p>
            <Badge variant={v.locked ? "default" : "secondary"}>{v.locked ? "Locked" : "Unlocked"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{v.files.length} protected files</p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" className="h-11" onClick={() => { addTo.current = v.id; pickRef.current?.click(); }}>Add files</Button>
            <Button variant="secondary" className="h-11" onClick={async () => { await updateVault(v.id, { locked: !v.locked }); refresh(); }}>
              {v.locked ? <><LockOpen className="mr-1 h-4 w-4" />Unlock</> : <><Lock className="mr-1 h-4 w-4" />Lock</>}
            </Button>
            <Button
              variant="ghost" className="h-11"
              onClick={async () => { if (confirm(`Remove vault “${v.name}”? Your files are not affected.`)) { await deleteVault(v.id); refresh(); } }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FoldersTab() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [newName, setNewName] = useState("");
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const save = async (folders: OrgFolder[], rules = data.rules) => {
    await saveOrganizeSettings(folders, rules);
    qc.invalidateQueries({ queryKey: ["organize-settings"] });
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-display font-semibold text-foreground">Folders</p>
        <p className="mt-1 text-sm text-muted-foreground">Name clues are comma-separated words or phrases. Small typos and spacing differences are tolerated; more agreeing clues mean a stronger match.</p>
        <div className="mt-3 space-y-3">
          {data.folders.map((f, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2">
                <Input
                  defaultValue={f.name} className="h-11"
                  onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && save(data.folders.map((x, j) => (j === i ? { ...x, name: e.target.value.trim() } : x)))}
                />
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => save(data.folders.filter((_, j) => j !== i))} aria-label="Remove folder">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Input
                defaultValue={f.keywords.join(", ")} className="h-10 text-sm" placeholder="Name clues"
                onBlur={(e) => save(data.folders.map((x, j) => (j === i ? { ...x, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) } : x)))}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Input placeholder="New folder name" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-11" />
            <Button className="h-11" disabled={!newName.trim()} onClick={() => { save([...data.folders, { name: newName.trim(), keywords: [] }]); setNewName(""); }}>Add</Button>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-display font-semibold text-foreground">Learned rules</p>
        {data.rules.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">None yet. When you move a file, DocuALL asks before saving a rule.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {data.rules.map((r) => (
              <li key={r.id} className="space-y-2 py-2 text-sm text-foreground">
                <div className="flex items-center gap-2">
                  <span className="flex-1">Name matches “{r.pattern}” → {r.folder}</span>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Delete rule" onClick={() => save(data.folders, data.rules.filter((x) => x.id !== r.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {(r.aliases ?? []).map((a, i) => (
                  <div key={`${r.id}-${i}-${a}`} className="flex items-center gap-2 pl-3">
                    <span className="text-xs text-muted-foreground">Also means</span>
                    <Input
                      defaultValue={a} className="h-11 flex-1 text-sm" aria-label="Alias"
                      onBlur={(e) => {
                        if (e.target.value.trim() === a) return;
                        const res = editAlias(data.rules, r.id, i, e.target.value);
                        if (!res.rules) { toast.error(res.error); e.target.value = a; return; }
                        save(data.folders, res.rules);
                      }}
                    />
                    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Remove alias" onClick={() => save(data.folders, removeAlias(data.rules, r.id, i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
