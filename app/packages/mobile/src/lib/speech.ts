import * as Speech from "expo-speech";
import {
  DEFAULT_SPEAK_OPTIONS,
  type SpeakOptions,
  type SpeechAdapter,
} from "@anxin/core";

/**
 * 语音合成（TTS）的 mobile 实现（M5-T7d；接缝与降级语义在 @anxin/core）。
 * 参数以 core 的 DEFAULT_SPEAK_OPTIONS 为基线（zh-CN / rate 0.92，照 web 与 ReminderModal 实测值）。
 * Android 侧没有同步的「能力查询」：isSupported 返回 true，真正不可用时靠 onError 复位播放态
 * ——播报只是增强，失败不阻塞主流程（spec §T4.3）。
 * 每次播报前先 stop，避免叠音；stop/onDone/onStopped/onError 四条路径都会复位 UI。
 */
export const mobileSpeechAdapter: SpeechAdapter = {
  isSupported: () => true,
  speak(text: string, options: SpeakOptions = {}) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const {
      lang = DEFAULT_SPEAK_OPTIONS.lang,
      rate = DEFAULT_SPEAK_OPTIONS.rate,
      pitch = DEFAULT_SPEAK_OPTIONS.pitch,
      volume = DEFAULT_SPEAK_OPTIONS.volume,
      onStart,
      onEnd,
    } = options;
    void Speech.stop();
    try {
      Speech.speak(trimmed, {
        language: lang,
        rate,
        pitch,
        volume,
        onStart: () => onStart?.(),
        onDone: () => onEnd?.(),
        onStopped: () => onEnd?.(),
        onError: () => onEnd?.(),
      });
    } catch {
      onEnd?.();
    }
  },
  stopSpeaking() {
    void Speech.stop();
  },
};
