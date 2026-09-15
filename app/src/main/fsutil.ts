/**
 * 文件操作小工具。
 *
 * 重要（本机实测）：Electron 主进程里直接 unlink 一个「只读」文件会让整个进程
 * 立刻死掉（既不抛异常也不触发退出流程，纯 Node 下同样操作是正常的）。
 * 所以本程序内部所有删除/覆盖都会先清掉只读属性再动手；
 * 从外部复制进来的照片也一律去掉只读属性，避免以后删不掉。
 */

import { chmodSync, rmSync } from 'node:fs'

/** 去掉只读属性；文件不存在或没有权限时静默忽略 */
export function makeWritable(target: string): void {
  try {
    chmodSync(target, 0o666)
  } catch {
    /* ignore */
  }
}

/** 安全删除单个文件：先去掉只读属性再删，任何失败都不影响主流程 */
export function removeFileSafe(target: string): void {
  try {
    makeWritable(target)
    rmSync(target, { force: true })
  } catch {
    /* ignore */
  }
}
