/**
 * /api/intake 路由（M2-T6，薄）：detect / prescription / drug 三入口。
 *
 * 图片以 dataURL 传入（vJson 已按正则校验），parseDataUrlImage 拆成 ImageInput。
 * AI 客户端经 lib/ai/registry 的注入接缝取得（生产真实实现；测试/E2E 注入 mock/fixture）。
 * 409 LAYER_MISMATCH / 422 UNSUPPORTED_OBJECT / 503 AI_UNAVAILABLE 由 service/管线抛 ApiError，app.onError 统一转。
 */
import { Hono } from 'hono'
import { IntakeDetectSchema, IntakeDrugSchema, IntakePrescriptionSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { okJson, vJson } from '../lib/http.js'
import { getAiClients } from '../lib/ai/registry.js'
import { parseDataUrlImage } from '../lib/util.js'
import * as intakeService from '../services/intake.service.js'

export const intakeRoute = new Hono<AppEnv>()
  .post('/detect', vJson(IntakeDetectSchema), async (c) => {
    const { image, entry } = c.req.valid('json')
    const result = await intakeService.detect(parseDataUrlImage(image), getAiClients(), entry)
    return okJson(c, result)
  })
  .post('/prescription', vJson(IntakePrescriptionSchema), async (c) => {
    const { image } = c.req.valid('json')
    const result = await intakeService.intakePrescription(c.get('user').id, parseDataUrlImage(image), getAiClients())
    return okJson(c, result, 201)
  })
  .post('/drug', vJson(IntakeDrugSchema), async (c) => {
    const { image } = c.req.valid('json')
    const result = await intakeService.intakeDrug(c.get('user').id, parseDataUrlImage(image), getAiClients())
    return okJson(c, result, 201)
  })
