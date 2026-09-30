#!/usr/bin/env node
/**
 * 机器识别 —— 打印「这台机器是谁」的一行指纹，供验收记录标注执行机。
 *
 * 为什么要有这个脚本：本仓库在两台 Windows 机器上跑（一台带模拟器、一台不带），
 * 出包 / adb / 数据库状态都是**分机器**的事实。写在文档里的任何「盘上有几个包、
 * 代理通不通」结论，如果不标机器就无法复盘。约定：**用主机名当机器标识**，
 * 每台机器只需 `pnpm machine:id` 一次，把输出的 Host 值抄进状态表。
 *
 * 只读脚本：不写文件、不发网络请求（AVD 判定读的是本机用户目录）。
 * 判据口径：Windows 10 与 11 的 os.release() 主版本都是 10.0，只能靠 build 号区分
 * （build >= 22000 为 Win 11）；「有没有模拟器」按 AVD 配置存在与否判，不猜内存。
 */
import { cpus, homedir, release, totalmem, arch } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'

/** AVD 配置目录：ANDROID_AVD_HOME 优先，否则默认 `~/.android/avd`。 */
function avdList() {
  const dir = process.env.ANDROID_AVD_HOME || join(homedir(), '.android', 'avd')
  if (!existsSync(dir)) return { dir, names: [] }
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.ini') && !f.includes('.avd'))
    .map((f) => f.replace(/\.ini$/, ''))
  return { dir, names }
}

/** Windows 版本名：build 号是唯一能区分 10/11 的公开信号。 */
function windowsName(rel) {
  const m = /^10\.0\.(\d+)/.exec(rel)
  if (!m) return `非 Windows NT10 内核（release=${rel}）`
  const build = Number(m[1])
  return `${build >= 22000 ? 'Windows 11' : 'Windows 10'} (build ${build})`
}

const avd = avdList()
const cpu = cpus()[0]?.model ?? '未知 CPU'
const ramGB = (totalmem() / 1024 ** 3).toFixed(1)

console.log(`Host        = ${hostname()}      ← 抄进状态表的机器标识`)
console.log(`User        = ${process.env.USERNAME ?? process.env.USER ?? '未知'}`)
console.log(`OS          = ${windowsName(release())} / ${arch()}`)
console.log(`RAM         = ${ramGB} GB`)
console.log(`CPU         = ${cpu} / ${cpus().length} 线程`)
console.log(`模拟器(AVD) = ${avd.names.length ? avd.names.join(', ') : '无'}   [查的是 ${avd.dir}]`)
console.log(`ANDROID_HOME= ${process.env.ANDROID_HOME ?? '(未设，看机器级环境变量)'}`)
