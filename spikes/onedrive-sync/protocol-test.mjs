// Spike-3: OneDrive App Folder 同步协议最小闭环
// 验证（附录 D）：上传 ReviewLog 分片、eTag/If-Match 乐观并发、create-only 冲突、delta 增量
// 用法: node protocol-test.mjs <access_token 文件路径>
import { readFileSync } from "node:fs";

const token = readFileSync(process.argv[2], "utf8").trim();
const G = "https://graph.microsoft.com/v1.0";

async function req(method, path, { body, headers = {} } = {}) {
  const t0 = performance.now();
  const res = await fetch(G + path, {
    method,
    headers: { Authorization: "Bearer " + token, ...headers },
    body,
  });
  const ms = Math.round(performance.now() - t0);
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, ms, data };
}
const j = (o) => ({ body: JSON.stringify(o), headers: { "Content-Type": "application/json" } });
const shard = (n) => JSON.stringify({ session: n, entries: [{ card: "card-1", ts: Date.now(), grade: "fluent", latencyMs: 1234 }] });

console.log("=== Spike-3: OneDrive App Folder 协议测试 ===\n");

// [1] 账户与盘类型（确认是个人 OneDrive）
{
  const r = await req("GET", "/me/drive?$select=driveType,owner,quota");
  console.log("[1] /me/drive (%dms, %d): driveType=%s used=%sMB",
    r.ms, r.status, r.data.driveType, Math.round((r.data.quota?.used || 0) / 1048576));
}

// [2] App Folder 创建/定位
let approotId;
{
  const r = await req("GET", "/me/drive/special/approot");
  approotId = r.data.id;
  console.log("[2] approot (%dms, %d): name=%j id=%s...", r.ms, r.status, r.data.name, String(approotId).slice(0, 12));
}

// [3] 上传分片 v1 → eTag/cTag
let etag1;
{
  const r = await req("PUT", "/me/drive/special/approot:/spike3-s1.json:/content", {
    body: shard(1), headers: { "Content-Type": "application/json" } });
  etag1 = r.data.eTag;
  console.log("[3] 上传 s1.json (%dms, %d): size=%d eTag=%s cTag 存在=%s",
    r.ms, r.status, r.data.size, String(etag1).slice(0, 20) + "...", !!r.data.cTag);
}

// [4] If-Match 正确 eTag 的条件更新 → 应成功
let etag2;
{
  const r = await req("PUT", "/me/drive/special/approot:/spike3-s1.json:/content", {
    body: shard(1) + "\n", headers: { "Content-Type": "application/json", "If-Match": etag1 } });
  etag2 = r.data.eTag;
  console.log("[4] If-Match(当前 eTag) 更新 (%dms, %d): %s，新 eTag 变化=%s",
    r.ms, r.status, r.status === 200 ? "成功 ✓" : "❌ " + JSON.stringify(r.data).slice(0, 120), etag1 !== etag2);
}

// [5] If-Match 过期 eTag 的条件更新 → 关键问题：是否返回 412
{
  const r = await req("PUT", "/me/drive/special/approot:/spike3-s1.json:/content", {
    body: shard(99), headers: { "Content-Type": "application/json", "If-Match": etag1 } });
  console.log("[5] If-Match(过期 eTag) 更新 (%dms, %d): %s", r.ms, r.status,
    r.status === 412 ? "412 Precondition Failed —— 乐观并发可用 ✓✓" :
    "⚠️ 预期 412 实得 " + r.status + " " + JSON.stringify(r.data).slice(0, 160));
}

// [6] create-only（分片只创建不覆盖）：conflictBehavior=fail
{
  const r1 = await req("PUT", "/me/drive/special/approot:/spike3-s2.json:/content?@microsoft.graph.conflictBehavior=fail", {
    body: shard(2), headers: { "Content-Type": "application/json" } });
  const r2 = await req("PUT", "/me/drive/special/approot:/spike3-s2.json:/content?@microsoft.graph.conflictBehavior=fail", {
    body: shard(2), headers: { "Content-Type": "application/json" } });
  console.log("[6] create-only 首次 (%d) / 重复 (%d): %s", r1.status, r2.status,
    (r1.status === 201 || r1.status === 200) && r2.status === 409
      ? "重复创建被拒 409 —— 追加型分片的无锁写入可用 ✓✓"
      : "⚠️ 预期 201/409，实得 " + r1.status + "/" + r2.status + " " + JSON.stringify(r2.data).slice(0, 120));
}

// [7] delta 初始全量 + deltaLink
let deltaLink;
{
  const r = await req("GET", `/me/drive/items/${approotId}/delta`);
  let page = r.data, items = page.value?.length ?? 0;
  while (page["@odata.nextLink"]) {
    const n = await fetch(page["@odata.nextLink"], { headers: { Authorization: "Bearer " + token } });
    page = await n.json(); items += page.value?.length ?? 0;
  }
  deltaLink = page["@odata.deltaLink"];
  console.log("[7] delta 初始 (%dms, %d): 条目 %d，deltaLink 获得=%s", r.ms, r.status, items, !!deltaLink);
}

// [8] 增量：新上传 s3 后用 deltaLink 拉取 → 应只见新变化
{
  await req("PUT", "/me/drive/special/approot:/spike3-s3.json:/content", {
    body: shard(3), headers: { "Content-Type": "application/json" } });
  await new Promise((r) => setTimeout(r, 3000)); // 给服务端索引一点时间
  const res = await fetch(deltaLink, { headers: { Authorization: "Bearer " + token } });
  const data = await res.json();
  const names = (data.value || []).map((v) => v.name);
  console.log("[8] deltaLink 增量 (%d): 变化条目 = %j %s", res.status, names,
    names.includes("spike3-s3.json") ? "—— 增量检测可用 ✓✓" : "⚠️ 未见 s3（可能需要更长索引延迟）");
}

// [9] 清理
{
  for (const f of ["spike3-s1.json", "spike3-s2.json", "spike3-s3.json"]) {
    const r = await req("DELETE", "/me/drive/special/approot:/" + f + ":");
    console.log("[9] 删除 %s: %d", f, r.status);
  }
}
console.log("\n完成。");
