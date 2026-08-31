/** 轻量 ULID 风格 ID：时间有序 + 随机尾，无外部依赖。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function makeIdFactory(rng: () => number = Math.random, clock: () => number = Date.now) {
  let lastTs = 0;
  let seq = 0;
  return function makeId(): string {
    const ts = clock();
    seq = ts === lastTs ? seq + 1 : 0;
    lastTs = ts;
    let t = ts;
    let time = "";
    for (let i = 0; i < 10; i++) {
      time = ALPHABET[t % 32] + time;
      t = Math.floor(t / 32);
    }
    let rand = "";
    for (let i = 0; i < 8; i++) rand += ALPHABET[Math.floor(rng() * 32)];
    const s = seq.toString(32).padStart(2, "0").toUpperCase();
    return `${time}${s}${rand}`;
  };
}
