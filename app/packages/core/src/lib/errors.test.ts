/**
 * 异常 → 中文用户文案归类（G8）单测。
 *
 * 覆盖 specs/13 §9.8 的返工点：断网冷启动不得把英文技术异常展示给用户；
 * 同时守住「服务端中文优先、失败可见（有兜底）、任何分支不返回纯英文技术串」三条。
 */
import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../api/client'
import {
  AUTH_LOCKED_MESSAGE,
  AUTH_SESSION_MESSAGE,
  BAD_RESPONSE_ERROR_MESSAGE,
  DEFAULT_USER_MESSAGE,
  FORBIDDEN_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  NOT_FOUND_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SERVER_UNAVAILABLE_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  VALIDATION_MESSAGE,
  toUserMessage,
} from './errors'

const CJK = /[\u3400-\u9fff]/

/** 模拟浏览器 / RN / Node 三端在各网络栈下的原始异常。 */
function errorWith(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

describe('toUserMessage · 服务端中文优先（原样透传）', () => {
  it('ApiRequestError 中文 message 逐字透传，不被客户端归类覆盖', () => {
    expect(toUserMessage(new ApiRequestError('账号或密码错误', 'AUTH_INVALID', 401))).toBe('账号或密码错误')
    expect(
      toUserMessage(new ApiRequestError('登录尝试次数过多，请 15 分钟后再试', 'AUTH_LOCKED', 429)),
    ).toBe('登录尝试次数过多，请 15 分钟后再试')
  })

  it('非 ApiRequestError 的中文 message（平台层合成）同样透传', () => {
    expect(toUserMessage(new Error('识别服务未就绪，请稍后重试'))).toBe('识别服务未就绪，请稍后重试')
  })
})

describe('toUserMessage · 英文 ApiRequestError 按 code/status 归类', () => {
  it('401（AUTH_INVALID / 无 code）→ 登录已失效，请重新登录', () => {
    expect(toUserMessage(new ApiRequestError('Unauthorized', 'AUTH_INVALID', 401))).toBe(AUTH_SESSION_MESSAGE)
    expect(toUserMessage(new ApiRequestError('Unauthorized', undefined, 401))).toBe(AUTH_SESSION_MESSAGE)
    expect(toUserMessage(new ApiRequestError('AUTH_REQUIRED', 'AUTH_REQUIRED', 401))).toBe(AUTH_SESSION_MESSAGE)
  })

  it('429（AUTH_LOCKED / 通用限流）→ 中文可操作文案', () => {
    expect(toUserMessage(new ApiRequestError('Too Many Requests', 'AUTH_LOCKED', 429))).toBe(AUTH_LOCKED_MESSAGE)
    expect(toUserMessage(new ApiRequestError('Rate limit exceeded', undefined, 429))).toBe(RATE_LIMITED_MESSAGE)
  })

  it('5xx / AI_UNAVAILABLE → 服务暂时不可用', () => {
    expect(toUserMessage(new ApiRequestError('Internal Server Error', undefined, 500))).toBe(
      SERVER_UNAVAILABLE_MESSAGE,
    )
    expect(toUserMessage(new ApiRequestError('Bad Gateway', undefined, 502))).toBe(SERVER_UNAVAILABLE_MESSAGE)
    expect(toUserMessage(new ApiRequestError('AI down', 'AI_UNAVAILABLE', 503))).toBe(
      SERVER_UNAVAILABLE_MESSAGE,
    )
  })

  it('400 / VALIDATION、403、404、408 各有中文语义', () => {
    expect(toUserMessage(new ApiRequestError('Validation failed', 'VALIDATION', 400))).toBe(VALIDATION_MESSAGE)
    expect(toUserMessage(new ApiRequestError('Forbidden', undefined, 403))).toBe(FORBIDDEN_MESSAGE)
    expect(toUserMessage(new ApiRequestError('Not Found', 'NOT_FOUND', 404))).toBe(NOT_FOUND_MESSAGE)
    expect(toUserMessage(new ApiRequestError('Request Timeout', undefined, 408))).toBe(TIMEOUT_ERROR_MESSAGE)
  })

  it('status 0（平台层合成的断网失败）→ 网络连接失败', () => {
    expect(toUserMessage(new ApiRequestError('boom', 'NETWORK_ERROR', 0))).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('英文 message 本身是网络异常 → 归到网络失败（不看状态码）', () => {
    expect(toUserMessage(new ApiRequestError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('无法归类的英文 ApiRequestError → 中文 fallback（不猜错语义）', () => {
    expect(toUserMessage(new ApiRequestError('teapot', undefined, 418), '登录状态检查失败，请重试')).toBe(
      '登录状态检查失败，请重试',
    )
  })
})

describe('toUserMessage · 网络类异常', () => {
  it('浏览器 TypeError: Failed to fetch', () => {
    expect(toUserMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('RN TypeError: Network request failed', () => {
    expect(toUserMessage(new TypeError('Network request failed'))).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('Node / Java 网络栈：ENOTFOUND / ECONNREFUSED / socket / ConnectException', () => {
    expect(toUserMessage(new Error('fetch failed: getaddrinfo ENOTFOUND api.example.com'))).toBe(
      NETWORK_ERROR_MESSAGE,
    )
    expect(toUserMessage(new Error('connect ECONNREFUSED 127.0.0.1:8787'))).toBe(NETWORK_ERROR_MESSAGE)
    expect(toUserMessage(new Error('socket hang up'))).toBe(NETWORK_ERROR_MESSAGE)
    expect(
      toUserMessage(errorWith('TypeError', 'fetch failed: java.net.ConnectException: Failed to connect to /10.0.0.2')),
    ).toBe(NETWORK_ERROR_MESSAGE)
    expect(toUserMessage(new Error('java.net.UnknownHostException: Unable to resolve host'))).toBe(
      NETWORK_ERROR_MESSAGE,
    )
  })

  it('网络异常优先于 fallback（fallback 只在无法归类时使用）', () => {
    expect(toUserMessage(new TypeError('Network request failed'), '登录状态检查失败，请重试')).toBe(
      NETWORK_ERROR_MESSAGE,
    )
  })
})

describe('toUserMessage · 超时 / 取消', () => {
  it('AbortError → 请求超时', () => {
    expect(toUserMessage(errorWith('AbortError', 'The operation was aborted.'))).toBe(TIMEOUT_ERROR_MESSAGE)
    expect(toUserMessage(errorWith('TimeoutError', 'The operation timed out.'))).toBe(TIMEOUT_ERROR_MESSAGE)
  })

  it('message 里带 timeout / ETIMEDOUT → 请求超时', () => {
    expect(toUserMessage(new Error('timeout of 10000ms exceeded'))).toBe(TIMEOUT_ERROR_MESSAGE)
    expect(toUserMessage(new Error('connect ETIMEDOUT 10.0.0.2:8787'))).toBe(TIMEOUT_ERROR_MESSAGE)
  })
})

describe('toUserMessage · JSON 解析异常', () => {
  it('Unexpected token / SyntaxError / 非法 JSON → 服务返回异常', () => {
    expect(toUserMessage(new SyntaxError('Unexpected token < in JSON at position 0'))).toBe(
      BAD_RESPONSE_ERROR_MESSAGE,
    )
    expect(toUserMessage(new Error('Unexpected end of JSON input'))).toBe(BAD_RESPONSE_ERROR_MESSAGE)
    expect(toUserMessage(new Error('Unexpected token < in JSON at position 0'))).toBe(
      BAD_RESPONSE_ERROR_MESSAGE,
    )
  })
})

describe('toUserMessage · 未知异常与中文兜底', () => {
  it('无 fallback → 通用中文兜底', () => {
    expect(toUserMessage(new Error('boom'))).toBe(DEFAULT_USER_MESSAGE)
    expect(toUserMessage(undefined)).toBe(DEFAULT_USER_MESSAGE)
    expect(toUserMessage(null)).toBe(DEFAULT_USER_MESSAGE)
    expect(toUserMessage({ code: 'weird' })).toBe(DEFAULT_USER_MESSAGE)
  })

  it('调用方 fallback 中文 → 原样作为兜底', () => {
    expect(toUserMessage(new Error('boom'), '登录状态检查失败，请重试')).toBe('登录状态检查失败，请重试')
  })

  it('调用方 fallback 是英文 → 退回通用中文兜底（不把英文交给用户）', () => {
    expect(toUserMessage(new Error('boom'), 'Something went wrong')).toBe(DEFAULT_USER_MESSAGE)
  })

  it('所有输入分支都返回中文（CJK 检测兜底）', () => {
    const inputs: unknown[] = [
      new ApiRequestError('Unauthorized', 'AUTH_INVALID', 401),
      new ApiRequestError('Internal Server Error', undefined, 500),
      new ApiRequestError('Failed to fetch'),
      new TypeError('Failed to fetch'),
      new TypeError('Network request failed'),
      new Error('fetch failed: getaddrinfo ENOTFOUND x'),
      new Error('socket hang up'),
      errorWith('AbortError', 'aborted'),
      new SyntaxError('Unexpected token < in JSON at position 0'),
      new Error('boom'),
      'plain english failure',
      undefined,
      null,
    ]
    for (const input of inputs) {
      expect(CJK.test(toUserMessage(input))).toBe(true)
      expect(CJK.test(toUserMessage(input, '登录状态检查失败，请重试'))).toBe(true)
    }
  })
})
