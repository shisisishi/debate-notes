/**
 * 收尾/预备：把残留的测试用 Electron 进程清掉。
 * 用例失败（或被中断）时应用可能没被正常关闭，残留进程会锁住 .e2e-data 下的数据目录，
 * 导致下一轮测试整批启动失败（表现为一堆 0ms 的失败）。
 * 只清理「数据目录指向 .e2e-data」或「入口是本项目 out/main/index.js」的进程，不影响别的软件。
 */

import { execFileSync } from 'node:child_process'

export function killStrayElectron(): void {
  const script = [
    `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`,
    `| Where-Object { $_.CommandLine -like '*.e2e-data*' -or $_.CommandLine -like '*out\\main\\index.js*' }`,
    `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  ].join(' ')
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' })
  } catch {
    /* 没有残留进程时也会返回非 0，忽略即可 */
  }
}

export default function globalTeardown(): void {
  killStrayElectron()
}
