/** 设置：背景照片与轮播、可扩展选项、备份与恢复、数据位置与关于。 */

import React, { useMemo, useState } from 'react'
import { OPTION_KIND_LABELS, OPTION_KINDS, THEMES, type BackgroundPhoto, type DataDirInspection, type OptionKind } from '@shared/types'
import { ConfirmDialog } from '../components/Modal'
import { PhotoAdjustModal } from '../components/PhotoAdjustModal'
import { Button, Checkbox, EmptyState, Field, PageHead, Panel, TextInput } from '../components/ui'
import { formatBytes, formatDateTime, formatInterval } from '../lib/format'
import { hasCustomAdjust } from '../lib/photoFrame'
import { useStore } from '../store'

const MINUTE = 60_000

export function SettingsPage(): React.ReactElement {
  const {
    settings,
    updateSettings,
    info,
    photos,
    addPhotos,
    removePhoto,
    removeAllPhotos,
    setActivePhoto,
    cyclePhoto,
    reorderPhotos,
    options,
    addOption,
    removeOption,
    backups,
    createBackupNow,
    exportBackup,
    restoreFromFile,
    restoreBackup,
    removeBackup,
    sampleStatus,
    removeSamples,
    reseedSamples,
    chooseDataDir,
    inspectDataDir,
    relocateDataDir,
    resetDataDir,
    relaunchApp,
    toast
  } = useStore()

  const [pendingRestore, setPendingRestore] = useState<{ path: string; label: string } | null>(null)
  const [adjusting, setAdjusting] = useState<BackgroundPhoto | null>(null)
  const [samples, setSamples] = useState<{ matches: number; events: number; honors: number; photos: number } | null>(null)
  const [pendingSampleClear, setPendingSampleClear] = useState(false)
  const [pendingSampleReseed, setPendingSampleReseed] = useState(false)
  const [pendingDataDir, setPendingDataDir] = useState<(DataDirInspection & { reset?: boolean }) | null>(null)
  const [movedTo, setMovedTo] = useState<{ dataDir: string; adopted: boolean; reset: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [newOption, setNewOption] = useState<Record<OptionKind, string>>({ position: '', eventResult: '', honorName: '' })

  React.useEffect(() => {
    void sampleStatus().then(setSamples, () => setSamples(null))
  }, [sampleStatus])

  const photosById = useMemo(() => photos, [photos])
  const activeIndex = photos.findIndex((p) => p.id === settings.activeBackgroundId)

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key)
    try {
      await fn()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const intervalMinutes = Math.max(1, Math.round(settings.rotationIntervalMs / MINUTE))

  return (
    <>
      <PageHead title="设置" sub="所有设置修改后立即保存，并写入数据目录的 settings.json" />

      <Panel
        title="外观皮肤"
        desc="换皮肤只改配色与装饰，不改变页面布局、字号与数据"
        testId="settings-theme"
      >
        <div className="theme-grid" data-testid="theme-grid">
          {THEMES.map((t) => {
            const active = settings.theme === t.id
            return (
              <button
                key={t.id}
                type="button"
                className={`theme-card${active ? ' is-active' : ''}`}
                data-testid={`theme-${t.id}`}
                aria-pressed={active}
                onClick={() =>
                  void run(`theme-${t.id}`, async () => {
                    await updateSettings({ theme: t.id })
                  })
                }
              >
                <span className="theme-card__swatch" style={{ background: t.swatch.bg }}>
                  <span className="theme-card__dot" style={{ background: t.swatch.panel }} />
                  <span className="theme-card__dot" style={{ background: t.swatch.accent }} />
                  <span className="theme-card__dot" style={{ background: t.swatch.panel }} />
                </span>
                <span className="theme-card__name">
                  {t.name}
                  {active ? (
                    <span className="badge badge--official" data-testid={`theme-active-${t.id}`}>
                      使用中
                    </span>
                  ) : null}
                </span>
                <span className="theme-card__desc">{t.desc}</span>
              </button>
            )
          })}
        </div>
        <div className="section-note" style={{ marginTop: 12 }}>
          背景照片与皮肤相互独立：皮肤决定底色与描边，照片仍是半透明背景层。
          当前皮肤下的透明度、模糊等设置可在下面的「背景照片」里调整。
        </div>
      </Panel>

      <Panel
        title="背景照片"
        desc="照片会复制到数据目录保存，原文件移动或删除后仍可使用；点「调整」可以单独改每张照片的位置、大小、透明度"
        actions={
          <>
            <Button
              icon="image"
              data-testid="bg-add"
              disabled={busy === 'add'}
              onClick={() =>
                void run('add', async () => {
                  const { added, skipped } = await addPhotos()
                  if (added > 0) toast(`已添加 ${added} 张背景照片`, 'success')
                  if (skipped.length > 0) {
                    const first = skipped[0]
                    const more = skipped.length > 1 ? `（另有 ${skipped.length - 1} 个文件同样被跳过）` : ''
                    toast(`${skipped.length} 个文件没能导入：${first.name} —— ${first.reason}${more}`, 'error')
                  } else if (added === 0) {
                    toast('没有导入任何照片', 'info')
                  }
                })
              }
            >
              批量添加照片
            </Button>
            <Button
              data-testid="bg-cycle"
              disabled={photos.length < 2}
              onClick={() => void run('cycle', () => cyclePhoto(1))}
            >
              切换下一张
            </Button>
            <Button
              variant="danger"
              data-testid="bg-clear"
              disabled={photos.length === 0}
              onClick={() =>
                void run('clear', async () => {
                  await removeAllPhotos()
                  toast('已清空全部背景照片', 'success')
                })
              }
            >
              清空全部
            </Button>
          </>
        }
        testId="settings-background"
      >
        {photosById.length === 0 ? (
          <EmptyState
            text="还没有背景照片。支持 JPG / PNG / WebP / GIF / BMP / AVIF / SVG / ICO / TIFF / HEIC，添加后照片会作为背景显示，不影响页面布局。"
            action={
              <Button icon="image" size="sm" onClick={() => void run('add', () => addPhotos().then(() => undefined))}>
                添加照片
              </Button>
            }
          />
        ) : (
          <>
            <div className="bg-cards" data-testid="bg-cards">
              {photosById.map((p) => (
                <div className={`bg-card${settings.activeBackgroundId === p.id ? ' is-active' : ''}`} key={p.id} data-testid={`bg-card-${p.id}`}>
                  <img className="bg-card__thumb" src={p.url} alt={p.originalName || p.fileName} draggable={false} />
                  <div className="bg-card__meta">
                    <span className="bg-card__name" title={p.originalName}>
                      {p.originalName || p.fileName}
                    </span>
                    <span>
                      {p.width && p.height ? `${p.width}×${p.height} · ` : ''}
                      {formatBytes(p.sizeBytes)}
                    </span>
                    <span>{settings.activeBackgroundId === p.id ? '当前背景' : `第 ${photosById.indexOf(p) + 1} 张`}</span>
                    {hasCustomAdjust(p) ? (
                      <span className="badge badge--official" data-testid={`bg-adjusted-${p.id}`}>
                        已调整
                      </span>
                    ) : null}
                  </div>
                  <div className="bg-card__acts">
                    <Button
                      size="sm"
                      disabled={settings.activeBackgroundId === p.id}
                      onClick={() => void run(`active-${p.id}`, () => setActivePhoto(p.id))}
                      data-testid={`bg-set-active-${p.id}`}
                    >
                      设为当前
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setAdjusting(p)}
                      data-testid={`bg-adjust-${p.id}`}
                    >
                      调整
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void run(`del-${p.id}`, async () => {
                        await removePhoto(p.id)
                        toast('背景照片已删除', 'success')
                      })}
                      data-testid={`bg-delete-${p.id}`}
                    >
                      删除
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={photosById.indexOf(p) === 0}
                      onClick={() => {
                        const ids = photosById.map((x) => x.id)
                        const i = ids.indexOf(p.id)
                        ;[ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]
                        void run(`up-${p.id}`, () => reorderPhotos(ids))
                      }}
                      data-testid={`bg-up-${p.id}`}
                    >
                      前移
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="divider" style={{ margin: '16px 0' }} />

            <div className="cols-2">
              <div className="stack--sm stack">
                <Checkbox
                  checked={settings.backgroundEnabled}
                  onChange={(v) => void run('enabled', () => updateSettings({ backgroundEnabled: v }).then(() => undefined))}
                  label="显示背景照片"
                  testId="bg-enabled"
                />
                <Checkbox
                  checked={settings.backgroundCover}
                  onChange={(v) => void run('cover', () => updateSettings({ backgroundCover: v }).then(() => undefined))}
                  label="铺满窗口（关闭则完整显示，可能留白）"
                  testId="bg-cover"
                />
                <Checkbox
                  checked={settings.rotationEnabled}
                  onChange={(v) => void run('rot', () => updateSettings({ rotationEnabled: v }).then(() => undefined))}
                  label={`自动轮播（每 ${formatInterval(settings.rotationIntervalMs)}切换）`}
                  testId="bg-rotation"
                />
                <Field label={`不透明度：${Math.round(settings.backgroundOpacity * 100)}%`} hint="数值越低，照片越淡，文字越清楚">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(settings.backgroundOpacity * 100)}
                    data-testid="bg-opacity"
                    onChange={(e) =>
                      void run('opacity', () =>
                        updateSettings({ backgroundOpacity: Number(e.target.value) / 100 }).then(() => undefined)
                      )
                    }
                  />
                </Field>
                <Field label={`背景模糊：${settings.backgroundBlur} px`} hint="轻微模糊可让面板上的文字更清楚">
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={1}
                    value={settings.backgroundBlur}
                    data-testid="bg-blur"
                    onChange={(e) =>
                      void run('blur', () => updateSettings({ backgroundBlur: Number(e.target.value) }).then(() => undefined))
                    }
                  />
                </Field>
              </div>

              <div className="stack">
                <Field label="轮播间隔（分钟）" hint="默认 5 分钟；可调范围 10 秒 ~ 24 小时">
                  <div className="row">
                    <TextInput
                      type="number"
                      min={1}
                      max={1440}
                      step={1}
                      value={intervalMinutes}
                      style={{ width: 110 }}
                      testId="bg-interval"
                      onChange={(e) => {
                        const minutes = Math.max(1, Math.min(1440, Number(e.target.value) || 1))
                        void run('interval', () => updateSettings({ rotationIntervalMs: minutes * MINUTE }).then(() => undefined))
                      }}
                    />
                    {[1, 5, 10, 30].map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={intervalMinutes === m ? 'primary' : 'default'}
                        onClick={() => void run('interval', () => updateSettings({ rotationIntervalMs: m * MINUTE }).then(() => undefined))}
                        data-testid={`bg-interval-${m}`}
                      >
                        {m} 分钟
                      </Button>
                    ))}
                  </div>
                </Field>
                <Field label={`内容面板底色强度：${Math.round(settings.panelOpacity * 100)}%`} hint="越高文字越清楚，越低背景照片越明显">
                  <input
                    type="range"
                    min={40}
                    max={100}
                    step={1}
                    value={Math.round(settings.panelOpacity * 100)}
                    data-testid="panel-opacity"
                    onChange={(e) =>
                      void run('panel', () => updateSettings({ panelOpacity: Number(e.target.value) / 100 }).then(() => undefined))
                    }
                  />
                </Field>
                <div className="section-note">
                  当前第 {activeIndex >= 0 ? activeIndex + 1 : '—'} / {photosById.length} 张。
                  {settings.rotationEnabled ? '轮播进行中。' : '轮播已暂停，可用「切换下一张」手动切换。'}
                  设置会记住，重启后保持。
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="可扩展选项"
        desc="辩位、赛事成绩、荣誉名称：可选、可手动输入，新增项会被记住并出现在下拉里"
        testId="settings-options"
      >
        <div className="option-groups">
          {OPTION_KINDS.map((kind) => {
            const list = options.filter((o) => o.kind === kind)
            return (
              <div key={kind} className="stack--sm stack" data-testid={`options-${kind}`}>
                <div className="field__label">{OPTION_KIND_LABELS[kind]}</div>
                <div className="option-tags">
                  {list.length === 0 ? <span className="muted small">暂无选项</span> : null}
                  {list.map((o) => (
                    <span className="tag" key={o.id}>
                      {o.value}
                      <button
                        type="button"
                        className="tag__x"
                        title="删除该选项（已用该值的记录不受影响）"
                        data-testid={`option-remove-${o.id}`}
                        onClick={() => void run(`opt-${o.id}`, () => removeOption(o.id))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="combo-custom">
                  <TextInput
                    value={newOption[kind]}
                    placeholder="新增选项"
                    testId={`option-input-${kind}`}
                    onChange={(e) => setNewOption((prev) => ({ ...prev, [kind]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const value = newOption[kind].trim()
                        if (!value) return
                        void run(`add-${kind}`, async () => {
                          await addOption(kind, value)
                          setNewOption((prev) => ({ ...prev, [kind]: '' }))
                          toast(`已新增${OPTION_KIND_LABELS[kind]}「${value}」`, 'success')
                        })
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    data-testid={`option-add-${kind}`}
                    onClick={() => {
                      const value = newOption[kind].trim()
                      if (!value) return
                      void run(`add-${kind}`, async () => {
                        await addOption(kind, value)
                        setNewOption((prev) => ({ ...prev, [kind]: '' }))
                        toast(`已新增${OPTION_KIND_LABELS[kind]}「${value}」`, 'success')
                      })
                    }}
                  >
                    添加
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="section-note" style={{ marginTop: 12 }}>
          比赛胜负状态、正赛／模拟赛、正反方属于固定口径，不在此处修改，保证统计准确。
        </div>
      </Panel>

      <Panel
        title="备份与恢复"
        desc="每天首次启动且已有数据时自动备份一份，保留最近若干份"
        actions={
          <>
            <Button
              data-testid="backup-now"
              disabled={busy === 'backup'}
              onClick={() =>
                void run('backup', async () => {
                  const entry = await createBackupNow()
                  toast(`已创建备份：${entry.fileName}`, 'success')
                })
              }
            >
              立即备份
            </Button>
            <Button
              icon="download"
              data-testid="backup-export"
              disabled={busy === 'export'}
              onClick={() =>
                void run('export', async () => {
                  const result = await exportBackup()
                  if (result.ok) toast(`导出成功：${result.path}`, 'success')
                  else if (result.error) toast(result.error, 'error')
                })
              }
            >
              导出完整备份
            </Button>
            <Button
              icon="upload"
              data-testid="backup-restore-file"
              disabled={busy === 'restore'}
              onClick={() =>
                void run('restore', async () => {
                  const result = await restoreFromFile()
                  if (result.ok && result.restored) {
                    toast(
                      `恢复完成：${result.restored.matches} 场比赛 / ${result.restored.events} 个赛事 / ${result.restored.honors} 条荣誉 / ${result.restored.backgrounds} 张照片`,
                      'success'
                    )
                  } else if (result.error && result.error !== '已取消') {
                    toast(result.error, 'error')
                  }
                })
              }
            >
              从文件恢复
            </Button>
          </>
        }
        testId="settings-backup"
      >
        <div className="cols-2" style={{ marginBottom: 14 }}>
          <div className="stack--sm stack">
            <Checkbox
              checked={settings.autoBackupEnabled}
              onChange={(v) => void run('autobak', () => updateSettings({ autoBackupEnabled: v }).then(() => undefined))}
              label="每天首次启动时自动备份"
              testId="backup-auto"
            />
            <Field label={`保留自动备份份数：${settings.autoBackupKeep}`} hint="超出份数后自动删除最旧的自动备份">
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={settings.autoBackupKeep}
                data-testid="backup-keep"
                onChange={(e) =>
                  void run('keep', () => updateSettings({ autoBackupKeep: Number(e.target.value) }).then(() => undefined))
                }
              />
            </Field>
            <div className="section-note">
              上次自动备份日期：{settings.lastAutoBackupDate ?? '（尚未备份）'}
              <br />
              恢复前会先给当前数据做一份「恢复前」安全备份，校验不通过的备份文件不会改动任何现有数据。
            </div>
          </div>
          <div className="section-note">
            备份内容包括：比赛、赛事、荣誉、可扩展选项、全部背景照片、设置。
            <br />
            备份是单个 zip 文件，可用资源管理器直接打开查看。
          </div>
        </div>

        {backups.length === 0 ? (
          <EmptyState text="还没有备份文件" />
        ) : (
          <div className="stack--sm stack" data-testid="backup-list">
            {backups.map((b) => (
              <div className="backup-row" key={b.fileName} data-testid={`backup-row-${b.fileName}`}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span
                      className={`badge ${
                        b.kind === 'auto' ? 'badge--plain' : b.kind === 'prerestore' ? 'badge--outline' : 'badge--official'
                      }`}
                    >
                      {b.kind === 'auto' ? '自动' : b.kind === 'prerestore' ? '恢复前' : '手动'}
                    </span>
                    <span className="bg-card__name" style={{ maxWidth: 420 }} title={b.fileName}>
                      {b.fileName}
                    </span>
                  </div>
                  <div className="small muted">
                    {formatDateTime(b.createdAt)} · {formatBytes(b.sizeBytes)}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Button
                    size="sm"
                    onClick={() => setPendingRestore({ path: b.fullPath, label: b.fileName })}
                    data-testid={`backup-restore-${b.fileName}`}
                  >
                    恢复
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void window.api.invoke('app:openPath', b.fullPath)}
                    data-testid={`backup-open-${b.fileName}`}
                  >
                    打开位置
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void run(`rm-${b.fileName}`, () => removeBackup(b.fileName))}
                    data-testid={`backup-remove-${b.fileName}`}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="示例数据"
        desc="首次启动且数据目录为空时会写入一批示例，方便先看到五个页面的完整效果"
        testId="settings-samples"
        actions={
          <>
            <Button data-testid="samples-reseed" onClick={() => setPendingSampleReseed(true)}>
              重新写入示例数据
            </Button>
            <Button
              variant="danger"
              data-testid="samples-clear"
              disabled={!samples || samples.matches + samples.events + samples.honors === 0}
              onClick={() => setPendingSampleClear(true)}
            >
              删除全部示例数据
            </Button>
          </>
        }
      >
        {samples && samples.matches + samples.events + samples.honors > 0 ? (
          <div className="section-note" data-testid="samples-summary">
            当前共有示例：{samples.matches} 场比赛、{samples.events} 个赛事、{samples.honors} 条荣誉。
            带「示例」标记的记录都是一次性写入的示范内容，删掉它们不会影响你自己录入的比赛；
            背景照片不在此列，需要的话请到上面的「背景照片」里单独删除。
            删掉之后想再看到示范效果，点「重新写入示例数据」即可补回（已存在的不会重复写入，日期按当天重新计算）。
          </div>
        ) : (
          <EmptyState text="没有示例数据。点「重新写入示例数据」可以按当前日期再生成一份示范内容；你自己录入的记录都会正常保留。" />
        )}
      </Panel>

      <Panel title="数据与关于" testId="settings-about">
        <div className="cols-2">
          <div className="kv">
            <span className="kv__k">数据目录</span>
            <span className="kv__v">
              {info?.dataDir ?? '…'}
              {info?.dataDirIsCustom ? (
                <span className="badge badge--outline" style={{ marginLeft: 8 }} data-testid="data-dir-custom-badge">
                  自定义位置
                </span>
              ) : null}
            </span>
            <span className="kv__k">数据库文件</span>
            <span className="kv__v">{info?.databaseFile ?? '…'}</span>
            <span className="kv__k">照片目录</span>
            <span className="kv__v">{info?.photosDir ?? '…'}</span>
            <span className="kv__k">备份目录</span>
            <span className="kv__v">{info?.backupsDir ?? '…'}</span>
          </div>
          <div className="kv">
            <span className="kv__k">程序版本</span>
            <span className="kv__v">{info?.version ?? '…'}</span>
            <span className="kv__k">Electron</span>
            <span className="kv__v">{info?.electronVersion ?? '…'}</span>
            <span className="kv__k">Chromium</span>
            <span className="kv__v">{info?.chromeVersion ?? '…'}</span>
            <span className="kv__k">Node</span>
            <span className="kv__v">{info?.nodeVersion ?? '…'}</span>
            <span className="kv__k">SQLite 驱动</span>
            <span className="kv__v">{info?.sqliteDriver ?? '…'}</span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Button onClick={() => void window.api.invoke('app:openDataDir')} data-testid="open-data-dir">
            打开数据目录
          </Button>
          <Button
            variant="ghost"
            onClick={() => void window.api.invoke('app:openPath', info?.backupsDir ?? '')}
            data-testid="open-backups-dir"
          >
            打开备份目录
          </Button>
          <Button
            variant="ghost"
            data-testid="data-dir-change"
            disabled={busy !== null}
            onClick={() =>
              void run('data-dir', async () => {
                const picked = await chooseDataDir()
                if (picked.canceled || !picked.path) return
                const target = await inspectDataDir(picked.path)
                setPendingDataDir(target)
              })
            }
          >
            更改数据目录…
          </Button>
          {info?.dataDirIsCustom ? (
            <Button
              variant="ghost"
              data-testid="data-dir-reset"
              disabled={busy !== null}
              onClick={() =>
                setPendingDataDir({
                  path: info?.defaultDataDir ?? '',
                  exists: true,
                  hasDatabase: false,
                  hasOtherFiles: false,
                  matchesInTarget: 0,
                  photosInTarget: 0,
                  reset: true
                })
              }
            >
              恢复默认位置
            </Button>
          ) : null}
        </div>
        <div className="section-note" style={{ marginTop: 12 }}>
          数据目录可以放到别的盘（比如 D 盘）：点「更改数据目录…」选一个文件夹，程序会把比赛记录、照片、备份与设置整套复制过去，
          下次启动就用新位置；原位置会保留一份，确认没问题后你可以自己删掉。
        </div>
        <div className="section-note" style={{ marginTop: 8 }}>
          本程序完全离线：不需要登录，不连接云端，也没有手机端入口。所有数据只在你本机的数据目录里。
        </div>
      </Panel>

      {pendingRestore ? (
        <ConfirmDialog
          title="确认恢复备份"
          message={`将用「${pendingRestore.label}」覆盖当前数据（比赛、赛事、荣誉、照片与设置）。`}
          detail="恢复前会自动为当前数据创建一份安全备份；若该备份文件损坏或校验不通过，则不会改动现有数据。"
          confirmLabel="确认恢复"
          danger
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => {
            const target = pendingRestore
            setPendingRestore(null)
            void run('restore', async () => {
              const result = await restoreBackup(target.path)
              if (result.ok && result.restored) {
                toast(
                  `恢复完成：${result.restored.matches} 场比赛 / ${result.restored.events} 个赛事 / ${result.restored.honors} 条荣誉 / ${result.restored.backgrounds} 张照片`,
                  'success'
                )
              } else {
                toast(result.error ?? '恢复失败', 'error')
              }
            })
          }}
        />
      ) : null}

      {pendingSampleClear ? (
        <ConfirmDialog
          title="删除全部示例数据"
          message="将删除带「示例」标记的比赛、赛事与荣誉。"
          detail="你自己录入的记录不受影响；背景照片也不会被删除（需要的话请到「背景照片」里单独处理）。"
          confirmLabel="确认删除"
          danger
          onCancel={() => setPendingSampleClear(false)}
          onConfirm={() => {
            setPendingSampleClear(false)
            void run('samples', async () => {
              const removed = await removeSamples()
              setSamples(await sampleStatus())
              toast(
                `已删除示例数据：${removed.matches} 场比赛 / ${removed.events} 个赛事 / ${removed.honors} 条荣誉`,
                'success'
              )
            })
          }}
        />
      ) : null}

      {pendingSampleReseed ? (
        <ConfirmDialog
          title="重新写入示例数据"
          message="按当前日期补回示例：10 场比赛、3 个赛事、2 条荣誉。"
          detail="只补缺少的部分，已经存在的示例不会重复写入；你自己录入的比赛、赛事、荣誉和照片都不会被动。"
          confirmLabel="写入示例"
          onCancel={() => setPendingSampleReseed(false)}
          onConfirm={() => {
            setPendingSampleReseed(false)
            void run('samples', async () => {
              const { added, photos } = await reseedSamples()
              setSamples(await sampleStatus())
              const total = added.matches + added.events + added.honors
              const photoNote = photos > 0 ? `，另有 ${photos} 张示例照片补进照片库` : ''
              toast(
                total + photos > 0
                  ? `已补回示例：${added.matches} 场比赛 / ${added.events} 个赛事 / ${added.honors} 条荣誉${photoNote}`
                  : '示例数据本来就是齐的，没有需要补的内容',
                total + photos > 0 ? 'success' : 'info'
              )
            })
          }}
        />
      ) : null}

      {pendingDataDir ? (
        <ConfirmDialog
          title={pendingDataDir.reset ? '恢复默认数据目录' : '更改数据目录'}
          message={
            pendingDataDir.reset
              ? `将把数据搬回默认位置：${pendingDataDir.path}`
              : `将把数据目录切换到：${pendingDataDir.path}`
          }
          detail={
            pendingDataDir.error
              ? pendingDataDir.error
              : pendingDataDir.hasDatabase
                ? `这个文件夹里已经有辩论手记的数据（${pendingDataDir.matchesInTarget} 场比赛、${pendingDataDir.photosInTarget} 张照片），程序会直接改用它，不会覆盖。当前位置的数据原样保留。`
                : '程序会把比赛记录、赛事、荣誉、照片、备份与设置整套复制过去，原位置保留一份（确认没问题后你可以自己删掉）。复制完成后需要重启程序生效。'
          }
          confirmLabel={pendingDataDir.error ? '知道了' : '确认切换'}
          danger={Boolean(pendingDataDir.error)}
          onCancel={() => setPendingDataDir(null)}
          onConfirm={() => {
            const target = pendingDataDir
            setPendingDataDir(null)
            if (target.error) return
            void run('data-dir', async () => {
              const result = target.reset ? await resetDataDir() : await relocateDataDir(target.path)
              if (!result.ok) {
                toast(result.error ?? '切换失败', 'error')
                return
              }
              setMovedTo({ dataDir: result.dataDir, adopted: result.adopted, reset: Boolean(target.reset) })
            })
          }}
        />
      ) : null}

      {movedTo ? (
        <ConfirmDialog
          title="数据目录已切换"
          message={`新的数据目录：${movedTo.dataDir}`}
          detail={
            movedTo.adopted
              ? '程序将使用该文件夹里已有的数据。需要重启程序才会生效。'
              : '数据已经复制过去，原位置保留了一份；重启程序后开始使用新位置。'
          }
          confirmLabel="立即重启"
          cancelLabel="稍后手动重启"
          testId="data-dir-done"
          onCancel={() => {
            setMovedTo(null)
            toast('数据目录已切换，重启程序后生效', 'info')
          }}
          onConfirm={() => {
            setMovedTo(null)
            void relaunchApp()
          }}
        />
      ) : null}

      {adjusting ? <PhotoAdjustModal photo={adjusting} onClose={() => setAdjusting(null)} /> : null}
    </>
  )
}
