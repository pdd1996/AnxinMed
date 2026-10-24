import { useEffect, useRef, useState } from "react";
import { Pressable } from "react-native";
import { Volume2, VolumeX } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { isSpeechSupported, speak, stopSpeaking } from "@anxin/core";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * 中文语音播报按钮（照 web `components/domain/voice/SpeakButton.tsx`）。
 * 播放/停止切换；3 秒看门狗（部分系统引擎静默不回调）复位；卸载即停。
 * RN 的时间回调可能跨轮次迟到，用 playToken 让旧一轮的 onEnd 不会把新一轮的播放态打回停止。
 */
export interface SpeakButtonProps {
  text: string;
  label?: string;
  unsupportedHint?: string;
  disabled?: boolean;
  variant?: "outline" | "ghost";
  className?: string;
}

export function SpeakButton({
  text,
  label = "播放回答",
  unsupportedHint = "当前设备不支持语音播报。",
  disabled = false,
  variant = "outline",
  className,
}: SpeakButtonProps) {
  const [supported] = useState<boolean>(() => isSpeechSupported());
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const playToken = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primary = useUnstableNativeVariable("--primary");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");

  useEffect(() => {
    return () => {
      playToken.current += 1;
      if (playingRef.current) stopSpeaking();
      if (watchdogRef.current != null) clearTimeout(watchdogRef.current);
    };
  }, []);

  const hasText = Boolean(text.trim());
  const isDisabled = !supported || disabled || !hasText;

  const resetPlaying = () => {
    if (watchdogRef.current != null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    playingRef.current = false;
    setPlaying(false);
  };

  const handleClick = () => {
    if (!supported || !hasText) return;
    if (playing) {
      stopSpeaking();
      resetPlaying();
      return;
    }
    const token = ++playToken.current;
    playingRef.current = true;
    setPlaying(true);
    let started = false;
    watchdogRef.current = setTimeout(() => {
      if (!started && playingRef.current && playToken.current === token) resetPlaying();
    }, 3000);
    speak(text, {
      onStart: () => {
        started = true;
      },
      onEnd: () => {
        if (playToken.current === token) resetPlaying();
      },
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? "停止播放" : label}
      accessibilityHint={!supported ? unsupportedHint : undefined}
      accessibilityState={{ disabled: isDisabled, selected: playing }}
      disabled={isDisabled}
      onPress={handleClick}
      className={cn(
        "size-11 items-center justify-center rounded-xl active:opacity-80",
        variant === "outline" && "border border-border bg-background",
        isDisabled && "opacity-50",
        className,
      )}
    >
      <Icon
        as={playing ? VolumeX : Volume2}
        size={20}
        color={playing ? primary : mutedForeground}
      />
    </Pressable>
  );
}
