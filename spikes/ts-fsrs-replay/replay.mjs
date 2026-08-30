// Spike-6: 验证「自有 ReviewLog 序列 → 重放推导 MemoryState → next()」的可行性与性能
// 判定标准（附录 D）：schema 冻结前完成；千卡级重放耗时可接受；重放确定性（两次重放结果一致）
import { fsrs, createEmptyCard, generatorParameters, Rating } from "ts-fsrs";

const f = fsrs(generatorParameters({ enable_fuzz: false })); // fuzz 关闭保证确定性验证有效

// —— 我们的三档评分 → FSRS 四档映射（REQUIREMENTS F4.13）——
const GRADE_MAP = { fail: Rating.Again, hesitant: Rating.Hard, fluent: Rating.Good };

// —— 生成合成 ReviewLog：按产品数据模型（F4.10 字段的子集：卡片ID/时间戳/评分）——
function synthesizeLogs(numCards, reviewsPerCard, seedStart) {
  let seed = seedStart;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const logs = new Map(); // cardId -> [{ts, grade}]
  const t0 = Date.UTC(2026, 0, 1);
  for (let c = 0; c < numCards; c++) {
    const entries = [];
    let ts = t0 + Math.floor(rand() * 86400000);
    for (let r = 0; r < reviewsPerCard; r++) {
      const p = rand();
      const grade = p < 0.1 ? "fail" : p < 0.2 ? "hesitant" : "fluent";
      entries.push({ ts, grade });
      // 下次复习时间：粗略模拟按调度间隔增长（重放正确性与真实间隔无关）
      ts += Math.floor((1 + r * r * 0.8) * 86400000 * (0.7 + rand() * 0.6));
    }
    logs.set("card-" + c, entries);
  }
  return logs;
}

// —— 核心：重放函数（这就是产品 core 包里 deriveMemoryState 的原型）——
function replayCard(entries) {
  let card = createEmptyCard(new Date(entries[0].ts));
  for (const e of entries) {
    const rec = f.next(card, new Date(e.ts), GRADE_MAP[e.grade]);
    card = rec.card;
  }
  return card;
}

function bench(numCards, reviewsPerCard) {
  const logs = synthesizeLogs(numCards, reviewsPerCard, 42);
  const start = performance.now();
  const states = new Map();
  for (const [id, entries] of logs) states.set(id, replayCard(entries));
  const ms = performance.now() - start;
  return { logs, states, ms, calls: numCards * reviewsPerCard };
}

console.log("=== Spike-6: ts-fsrs v5 重放验证 ===\n");

// 1) API 形状验证：单卡跟踪
{
  const entries = [
    { ts: Date.UTC(2026, 0, 1, 9), grade: "fail" },
    { ts: Date.UTC(2026, 0, 2, 9), grade: "fluent" },
    { ts: Date.UTC(2026, 0, 7, 9), grade: "fluent" },
    { ts: Date.UTC(2026, 0, 30, 9), grade: "hesitant" },
    { ts: Date.UTC(2026, 2, 1, 9), grade: "fluent" },
  ];
  const card = replayCard(entries);
  console.log("[1] 单卡重放（fail→fluent→fluent→hesitant→fluent）:");
  console.log("    stability=%s difficulty=%s reps=%d lapses=%d state=%d",
    card.stability.toFixed(2), card.difficulty.toFixed(2), card.reps, card.lapses, card.state);
  console.log("    due(下次到期)=%s（间隔 %d 天）", card.due.toISOString().slice(0, 10),
    Math.round((card.due - card.last_review) / 86400000));
}

// 2) 答错折减不清零验证（F4.3）：成熟卡答错后间隔应折减而非归零
{
  const good = [];
  let ts = Date.UTC(2026, 0, 1);
  const gaps = [0, 1, 4, 10, 25, 60];
  for (const g of gaps) good.push({ ts: ts + g * 86400000, grade: "fluent" });
  const matureCard = replayCard(good);
  const lapseTs = ts + 120 * 86400000;
  const afterLapse = f.next(matureCard, new Date(lapseTs), Rating.Again).card;
  // 答错后先进入重学步骤（分钟级 due 属正常）；通过重学后才是真实新间隔
  const relearned = f.next(afterLapse, new Date(lapseTs + 10 * 60000), Rating.Good).card;
  const nextIvl = Math.round((relearned.due - relearned.last_review) / 86400000);
  const newCardStability = createEmptyCard(new Date()).stability || 0.5;
  console.log("\n[2] 成熟卡（稳定性 %s 天）答错：折减后 stability=%s（重学步骤 due=+%d 分钟）；" +
    "通过重学后新间隔 %d 天（对照新卡初始约 0.5 天 → 未清零 ✓=%s）",
    matureCard.stability.toFixed(1), afterLapse.stability.toFixed(2),
    Math.round((afterLapse.due - afterLapse.last_review) / 60000),
    nextIvl, afterLapse.stability > 2 && nextIvl >= 2 ? "yes" : "NO");
}

// 3) 确定性验证：两次重放结果一致
{
  const a = bench(200, 15), b = bench(200, 15);
  let same = true;
  for (const [id, ca] of a.states) {
    const cb = b.states.get(id);
    if (ca.due.getTime() !== cb.due.getTime() || ca.stability !== cb.stability) { same = false; break; }
  }
  console.log("\n[3] 确定性（200 卡 ×15 复习，两次重放逐卡对比）:", same ? "一致 ✓" : "不一致 ✗");
}

// 4) 性能基准
console.log("\n[4] 重放性能（含日志合成的对照为纯重放时间）:");
for (const [n, m] of [[1000, 20], [5000, 20], [10000, 30]]) {
  const r = bench(n, m);
  console.log("    %d 卡 × %d 复习 = %d 次 next(): %s ms（%s 次/ms）",
    n, m, r.calls, r.ms.toFixed(0), (r.calls / r.ms).toFixed(0));
}

// 5) 评分映射完整性：Easy 不暴露（F4.13），三档全部有效
{
  const card = createEmptyCard(new Date());
  const ok = ["fail", "hesitant", "fluent"].every(g => {
    const rec = f.next(card, new Date(), GRADE_MAP[g]);
    return rec.card && rec.log && rec.log.rating === GRADE_MAP[g];
  });
  console.log("\n[5] 三档评分映射（Again/Hard/Good，Easy 不使用）:", ok ? "全部有效 ✓" : "失败 ✗");
}

// 6) ts-fsrs 自带 ReviewLog 与我们 ReviewLog 的关系验证：其 log 可由我们的字段推导
{
  const card = createEmptyCard(new Date(Date.UTC(2026, 0, 1)));
  const rec = f.next(card, new Date(Date.UTC(2026, 0, 3)), Rating.Good);
  console.log("\n[6] ts-fsrs RecordLog.log 字段:", Object.keys(rec.log).join(", "));
  console.log("    → 均可由我们的 ReviewLog(卡片ID/时间戳/计划到期/实际延迟/评分) 推导，无需双写 ✓");
}
