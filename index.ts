// Felix検査App 管理用 Edge Function「felix-admin」
// 目的：写真の「完全削除」など、秘密のキー（service role key）が必要な操作を、画面側に秘密を置かずに行う。
// ・秘密のキーはSupabaseが自動で用意（SUPABASE_SERVICE_ROLE_KEY）。画面側には一切出ない。
// ・合言葉（ADMIN_PIN）は、Supabaseの Secrets に登録した値とサーバー側で照合する。
// ・「ゴミ箱に入っているデータ」しか完全削除できない（誤って現役のデータを消せない作りにしている）。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const env = (k: string): string =>
  // deno-lint-ignore no-explicit-any
  ((globalThis as any).Deno?.env.get(k)) ?? ((globalThis as any).process?.env?.[k]) ?? "";

const BASE = () => env("SUPABASE_URL");
const KEY = () => env("SUPABASE_SERVICE_ROLE_KEY");
const authHeaders = (extra: Record<string, string> = {}) => ({
  apikey: KEY(),
  Authorization: `Bearer ${KEY()}`,
  ...extra,
});

const PHOTO_COLS = ["issue_photo_url", "fix_photo_url", "issue_photo_thumb_url", "fix_photo_thumb_url"];

function fileName(url: unknown): string | null {
  if (!url) return null;
  const n = String(url).split("?")[0].split("/").pop();
  return n ? decodeURIComponent(n) : null;
}

// 合言葉の照合（文字数に関わらず同じ時間で比較）
function samePin(a: string, b: string): boolean {
  if (!b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ---- REST（1000件の上限を超えても全件取る）----
async function restAll(path: string): Promise<any[]> {
  const out: any[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const r = await fetch(`${BASE()}/rest/v1/${path}`, {
      headers: authHeaders({ Range: `${from}-${from + size - 1}`, "Range-Unit": "items" }),
    });
    if (!r.ok && r.status !== 206) throw new Error(`DB取得失敗 ${path} (${r.status})`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
async function restDelete(path: string) {
  const r = await fetch(`${BASE()}/rest/v1/${path}`, { method: "DELETE", headers: authHeaders({ Prefer: "return=minimal" }) });
  if (!r.ok) throw new Error(`DB削除失敗 ${path} (${r.status})`);
}

// ---- Storage ----
async function storageRemove(names: string[]): Promise<{ total: number; success: number }> {
  const uniq = [...new Set(names.filter(Boolean))];
  let success = 0;
  for (let i = 0; i < uniq.length; i += 100) {
    const batch = uniq.slice(i, i + 100);
    const r = await fetch(`${BASE()}/storage/v1/object/photos`, {
      method: "DELETE",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: batch }),
    });
    if (r.ok) success += batch.length; // 既に無いファイルも「消えている」ので成功扱い
  }
  return { total: uniq.length, success };
}
async function storageList(): Promise<{ name: string; size: number; created: number }[]> {
  const out: { name: string; size: number; created: number }[] = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const r = await fetch(`${BASE()}/storage/v1/object/list/photos`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: "", limit, offset }),
    });
    if (!r.ok) throw new Error(`Storage一覧取得失敗 (${r.status})`);
    const items = await r.json();
    for (const it of items) if (it && it.name && it.id) out.push({ name: it.name, size: Number(it.metadata?.size || 0), created: Date.parse(it.created_at || it.updated_at || "") || 0 });
    if (items.length < limit) break;
  }
  return out;
}

function namesFromRecords(rows: any[]): string[] {
  const s: string[] = [];
  for (const r of rows) for (const c of PHOTO_COLS) { const n = fileName(r[c]); if (n) s.push(n); }
  return s;
}

// ---- 完全削除：物件 ----
async function purgeProperty(pid: string) {
  const props = await restAll(`properties?property_id=eq.${encodeURIComponent(pid)}&select=property_id,is_deleted`);
  if (!props.length) return { total: 0, success: 0, note: "対象の物件が見つかりません（すでに削除済み）" };
  if (props[0].is_deleted !== true) throw new Error("ゴミ箱に入っていない物件は完全削除できません");
  const ins = await restAll(`inspections?property_id=eq.${encodeURIComponent(pid)}&select=inspection_id`);
  const ids = ins.map((i) => i.inspection_id).filter(Boolean);
  let recs: any[] = await restAll(`inspection_records?property_id=eq.${encodeURIComponent(pid)}&select=record_id,${PHOTO_COLS.join(",")}`);
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50).map(encodeURIComponent).join(",");
    recs = recs.concat(await restAll(`inspection_records?inspection_id=in.(${part})&select=record_id,${PHOTO_COLS.join(",")}`));
  }
  const result = await storageRemove(namesFromRecords(recs));
  if (result.success < result.total) return { ...result, note: "写真の一部が消せなかったため、データは残しています。もう一度お試しください" };
  await restDelete(`inspection_records?property_id=eq.${encodeURIComponent(pid)}`);
  for (let i = 0; i < ids.length; i += 50) {
    await restDelete(`inspection_records?inspection_id=in.(${ids.slice(i, i + 50).map(encodeURIComponent).join(",")})`);
  }
  await restDelete(`inspections?property_id=eq.${encodeURIComponent(pid)}`);
  await restDelete(`properties?property_id=eq.${encodeURIComponent(pid)}`);
  return result;
}

// ---- 完全削除：検査 ----
async function purgeInspection(iid: string) {
  const ins = await restAll(`inspections?inspection_id=eq.${encodeURIComponent(iid)}&select=inspection_id,is_deleted`);
  if (!ins.length) return { total: 0, success: 0, note: "対象の検査が見つかりません（すでに削除済み）" };
  if (ins[0].is_deleted !== true) throw new Error("ゴミ箱に入っていない検査は完全削除できません");
  const recs = await restAll(`inspection_records?inspection_id=eq.${encodeURIComponent(iid)}&select=record_id,${PHOTO_COLS.join(",")}`);
  const result = await storageRemove(namesFromRecords(recs));
  if (result.success < result.total) return { ...result, note: "写真の一部が消せなかったため、データは残しています。もう一度お試しください" };
  await restDelete(`inspection_records?inspection_id=eq.${encodeURIComponent(iid)}`);
  await restDelete(`inspections?inspection_id=eq.${encodeURIComponent(iid)}`);
  return result;
}

// ---- 容量と、どこにも使われていない写真の照合 ----
async function scan() {
  const files = await storageList();
  const used = new Set(namesFromRecords(await restAll(`inspection_records?select=${PHOTO_COLS.join(",")}`)));
  // 24時間以内にアップされた写真は「送信の途中」の可能性があるため、使われていない写真には数えない
  const limit = Date.now() - 24 * 3600 * 1000;
  const unused = files.filter((f) => !used.has(f.name));
  const orphans = unused.filter((f) => !f.created || f.created < limit);
  const totalBytes = files.reduce((a, f) => a + f.size, 0);
  return {
    files: files.length,
    bytes: totalBytes,
    used_names: used.size,
    orphans: orphans.map((o) => o.name),
    orphan_bytes: orphans.reduce((a, f) => a + f.size, 0),
    recent_skipped: unused.length - orphans.length,
  };
}
async function deleteOrphans(names: string[]) {
  // 画面から渡された名前をそのまま信用せず、削除の直前にもう一度「どこにも使われていない」ことを確認する
  const now = await scan();
  const ok = new Set(now.orphans);
  const target = (names || []).filter((n) => ok.has(n));
  return { ...(await storageRemove(target)), skipped: (names || []).length - target.length };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POSTのみ" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "不正なリクエスト" }, 400); }

  const pin = String(body.pin ?? "");
  if (!samePin(pin, env("ADMIN_PIN"))) {
    await new Promise((r) => setTimeout(r, 800)); // 総当たり対策に少し待たせる
    return json({ error: "合言葉が違います" }, 401);
  }
  try {
    switch (body.action) {
      case "ping": return json({ ok: true });
      case "purge_property": return json(await purgeProperty(String(body.id)));
      case "purge_inspection": return json(await purgeInspection(String(body.id)));
      case "scan": return json(await scan());
      case "delete_orphans": return json(await deleteOrphans(body.names));
      default: return json({ error: "不明な操作です" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(handler);
