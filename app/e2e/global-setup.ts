/** 开跑前先清掉上一轮残留的测试进程，避免数据目录被锁。 */

import { killStrayElectron } from './global-teardown'

export default function globalSetup(): void {
  killStrayElectron()
}
