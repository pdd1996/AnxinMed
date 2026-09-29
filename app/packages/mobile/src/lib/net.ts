import { CLIENT_ERR_CODES, type Settled } from "@anxin/core";

/**
 * 传输层包装（M5-T4）：core 的 `settle()` 只处理「服务端回了但业务失败」，
 * 而真机最常见的是**根本没回**（Wi-Fi 不同网段、电脑防火墙拦 8787、服务器地址填错、请求挂死）。
 * 本层把这些异常收敛成与 `Settled` 失败分支同形的结构，交给 core 的 `mapIntakeFailure` 出卡
 * ——禁止在平台层自行拼文案，文案真相在 core。
 */

/** 层检测是轻请求；识别管线含两次模型调用，超时给到 3 分钟（火山公网 + 手机 4G 实测口径待补）。 */
export const TIMEOUT_MS = { detect: 30_000, intake: 180_000 } as const;

const TIMEOUT = Symbol("timeout");

async function waitFor(run: () => Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function failureMessage(reason: "timeout" | "error", ms: number, detail: string): string {
  return reason === "timeout"
    ? `等了 ${Math.round(ms / 1000)} 秒服务器没有回音（${detail || "请求超时"}）。请确认手机与服务器在同一网络后重试。`
    : `请求没能到达服务器（${detail || "网络不可达"}）。请确认手机与电脑连同一个 Wi-Fi，且地址填写无误。`;
}

/**
 * 跑一次 core 调用：网络层异常/超时 → 收敛为失败分支（status 0 + 客户端合成码）。
 * 服务端返回的业务失败原样透传，不重复包装。
 */
export async function callTransport<T>(
  run: () => Promise<Settled<T>>,
  ms: number,
): Promise<Settled<T>> {
  let settled: unknown;
  try {
    settled = await waitFor(run, ms);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      code: CLIENT_ERR_CODES.NETWORK_ERROR,
      message: failureMessage("error", ms, detail),
      details: {},
    };
  }
  if (settled === TIMEOUT) {
    return {
      ok: false,
      status: 0,
      code: CLIENT_ERR_CODES.TIMEOUT,
      message: failureMessage("timeout", ms, ""),
      details: {},
    };
  }
  return settled as Settled<T>;
}
