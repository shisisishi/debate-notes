/** preload：仅暴露一个白名单 invoke 通道，渲染进程拿不到 Node 能力。 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type RendererApi } from '@shared/ipc'

const allowed = new Set<string>(IPC_CHANNELS)

/** Electron 会把主进程异常包成 "Error invoking remote method 'x': Error: 真正原因"，这里剥掉前缀 */
function cleanError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  const marker = 'Error: '
  const idx = raw.lastIndexOf(marker)
  const message = idx >= 0 ? raw.slice(idx + marker.length) : raw
  return new Error(message.trim() || '操作失败')
}

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  if (!allowed.has(channel)) {
    throw new Error(`不允许的 IPC 通道：${channel}`)
  }
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (err) {
    throw cleanError(err)
  }
}

const api: RendererApi = { invoke: invoke as RendererApi['invoke'] }

contextBridge.exposeInMainWorld('api', api)
