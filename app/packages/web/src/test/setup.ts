import { wireWebPlatform } from '@/lib/wiring'

// 测试环境与运行时同源装配（M5-T2）：ApiNotifier(sonner) 与 SpeechAdapter(speechSynthesis) 注入 core。
wireWebPlatform()
