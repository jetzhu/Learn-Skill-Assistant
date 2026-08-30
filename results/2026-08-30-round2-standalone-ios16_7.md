# Spike-1 第二轮结果 — standalone（主屏幕）模式

来源：GitHub Issue #1（诊断页 v1.3 预填提交），2026-08-30T10:55。
设备与第一轮相同：iPhone iOS 16.7.16 / Safari 16.6.2。

```
mode=standalone
ua=Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_16 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6.2 Mobile/15E148 Safari/604.1
voices en=46 zh=6

T0a: PASS
T0b: PASS
T1: PASS err=service-not-allowed
T2: PASS err=service-not-allowed
T3: PASS err=service-not-allowed
T4: PASS
T5a: PASS err=service-not-allowed
T5b: PASS err=service-not-allowed
T4b: PASS
T6: PASS err=service-not-allowed
T7: PASS
```

## 解读（重要）

- 摘要中识别类测试（T1/T2/T3/T5a/T5b/T6）标为 "PASS" 是诊断页 v1.3 的标记 bug：
  `service-not-allowed` 错误后 `end` 事件未触发，判定停留在 n/a 被误标为 PASS（v1.4 已修复为 N/A）。
  **所有识别行均无 `first=` 时延字段 = 没有产生任何转写结果。**
- 真实结论：**standalone（添加到主屏幕）模式下，SpeechRecognition 被系统禁用，
  错误码 `service-not-allowed`，en/zh、单句/连续、TTS 前后全部一致失败。**
- TTS（T4/T4b）在 standalone 下正常可用；getUserMedia 麦克风权限（T0b）正常授予——
  被禁的是识别服务本身，不是麦克风。
- 结论已写入 REQUIREMENTS.md v0.5：N9 矩阵该格定案「不可用」；F13.6 定为
  「iOS 保语音作答、不引导添加主屏、提醒走邮件兜底」。
