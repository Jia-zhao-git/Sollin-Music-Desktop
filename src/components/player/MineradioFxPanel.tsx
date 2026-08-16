import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { MineradioEngine, MineradioEngineState, MineradioFxState } from '@/vendor/mineradio/engine'

type SliderSpec = {
  key: string
  label: string
  min: number
  max: number
  step: number
  format?: (value: number) => string
}

const MAIN_SLIDERS: SliderSpec[] = [
  { key: 'intensity', label: '律动强度', min: 0.2, max: 1.6, step: 0.01 },
  { key: 'depth', label: '立体感', min: 0.2, max: 1.8, step: 0.01 },
  { key: 'coverResolution', label: '封面清晰度', min: 0.75, max: 1.55, step: 0.01 },
  { key: 'cinemaShake', label: '镜头晃动', min: 0, max: 1.8, step: 0.01 },
  { key: 'lyricGlowStrength', label: '歌词溢光', min: 0, max: 0.85, step: 0.01 },
]

const BACKGROUND_SLIDERS: SliderSpec[] = [
  { key: 'backgroundOpacity', label: '背景透明度', min: 0, max: 1, step: 0.01 },
  { key: 'controlGlassChromaticOffset', label: '控制台玻璃色差', min: 0, max: 140, step: 1, format: (v) => String(Math.round(v)) },
]

const LYRIC_TYPO_SLIDERS: SliderSpec[] = [
  { key: 'lyricLetterSpacing', label: '字间距', min: -0.04, max: 0.18, step: 0.005, format: (v) => v.toFixed(3) },
  { key: 'lyricLineHeight', label: '行距', min: 0.86, max: 1.35, step: 0.01 },
  { key: 'lyricWeight', label: '字重', min: 500, max: 900, step: 50, format: (v) => String(Math.round(v)) },
]

const LYRIC_LAYOUT_SLIDERS: SliderSpec[] = [
  { key: 'lyricScale', label: '歌词大小', min: 0.35, max: 1.65, step: 0.01 },
  { key: 'lyricOffsetX', label: '水平位置', min: -2.0, max: 2.0, step: 0.01 },
  { key: 'lyricOffsetY', label: '垂直位置', min: -1.2, max: 1.35, step: 0.01 },
  { key: 'lyricOffsetZ', label: '景深位置', min: -1.6, max: 1.6, step: 0.01 },
  { key: 'lyricTiltX', label: '上下角度', min: -42, max: 42, step: 1, format: (v) => String(Math.round(v)) },
  { key: 'lyricTiltY', label: '左右角度', min: -42, max: 42, step: 1, format: (v) => String(Math.round(v)) },
]

const ADVANCED_SLIDERS: SliderSpec[] = [
  { key: 'point', label: '粒子尺寸', min: 0.5, max: 2.2, step: 0.01 },
  { key: 'speed', label: '流速', min: 0.2, max: 2.5, step: 0.01 },
  { key: 'twist', label: '扭曲', min: 0, max: 0.6, step: 0.01 },
  { key: 'color', label: '色彩张力', min: 0.5, max: 2.0, step: 0.01 },
  { key: 'bloomStrength', label: '溢光强度', min: 0, max: 1.6, step: 0.01 },
  { key: 'scatter', label: '离散感', min: 0, max: 0.5, step: 0.01 },
  { key: 'bgFade', label: '背景压缩', min: 0, max: 1.2, step: 0.01 },
]

const OVERLAY_TOGGLES: Array<{ key: keyof MineradioFxState & string, label: string, title?: string }> = [
  { key: 'floatLayer', label: '浮空粒子层' },
  { key: 'cinema', label: '电影镜头' },
  { key: 'lyricGlow', label: '歌词溢光' },
  { key: 'lyricGlowBeat', label: '鼓点溢光' },
  { key: 'lyricGlowParticles', label: '歌词光粒' },
  { key: 'lyricCameraLock', label: '歌词镜头绑定' },
  { key: 'bloom', label: '粒子溢光' },
  { key: 'edge', label: '轮廓高亮' },
]

const LYRIC_FONTS: Array<[string, string]> = [
  ['sans', '默认'], ['hei', '黑体'], ['song', '宋体'], ['bold-song', '粗宋'],
  ['stone-song', '石印宋'], ['kai-song', '楷宋'], ['serif-en', 'Serif'], ['gothic', 'Gothic'],
  ['editorial', 'Editorial'], ['humanist', 'Humanist'], ['mono', '等宽'], ['display', '标题'],
]

function FxSlider({ spec, fx, engine }: { spec: SliderSpec, fx: MineradioFxState, engine: MineradioEngine }) {
  const value = Number(fx[spec.key] ?? 0)
  return (
    <div className="fx-slider">
      <label>{spec.label}</label>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={isFinite(value) ? value : 0}
        onChange={(e) => engine.setFxValue(spec.key, parseFloat(e.target.value))}
      />
      <output>{spec.format ? spec.format(value) : value.toFixed(2)}</output>
    </div>
  )
}

function ColorRow({ label, value, hint, onPick, actions }: {
  label: string
  value: string
  hint: string
  onPick: (color: string) => void
  actions?: Array<{ label: string, onClick: () => void, active?: boolean }>
}) {
  return (
    <div className="lyric-color-row">
      <input
        className="lyric-color-picker"
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
        onChange={(e) => onPick(e.target.value)}
        title={label}
      />
      <div className="fx-color-row-label">{label}<small>{hint}</small></div>
      {actions?.map((action) => (
        <button
          key={action.label}
          className={`fx-mini-btn ghost${action.active ? ' active' : ''}`}
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

export default function MineradioFxPanel({ engine, state, visible }: {
  engine: MineradioEngine
  state: MineradioEngineState
  visible: boolean
}) {
  const fx = state.fx
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const bgMediaInputRef = useRef<HTMLInputElement>(null)
  const [renamingIndex, setRenamingIndex] = useState(-1)
  const [renameDraft, setRenameDraft] = useState('')

  const toggleFold = (key: string) => setOpenFolds((prev) => ({ ...prev, [key]: !prev[key] }))

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      void file.text().then((text) => engine.importUserFxArchiveText(text, file.name))
    }
    e.target.value = ''
  }

  const handleBgMediaFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) engine.readBackgroundMediaFile(file)
    e.target.value = ''
  }

  const commitRename = () => {
    if (renamingIndex >= 0) {
      engine.renameUserFxArchive(renamingIndex, renameDraft)
    }
    setRenamingIndex(-1)
  }

  return (
    <div id="fx-panel" className={visible ? 'show' : ''}>
      <div className="fx-head">
        <div>
          <div className="fx-title">视觉控制台</div>
          <div className="fx-sub">MINERADIO VISUALS · 鼠标移开自动隐藏</div>
        </div>
      </div>

      <div className="fx-section-label">视觉预设</div>
      <div className="preset-grid" id="preset-grid">
        {state.presetDisplayOrder.map((presetIndex) => {
          const meta = state.presetMeta[presetIndex]
          if (!meta) return null
          return (
            <div
              key={presetIndex}
              className={`preset-card${fx.preset === presetIndex ? ' active' : ''}`}
              data-preset={presetIndex}
              onClick={() => engine.setPreset(presetIndex)}
            >
              <div className="pc-icon" dangerouslySetInnerHTML={{ __html: state.presetIcons[presetIndex] || '' }} />
              <div className="pc-name">{meta.name}</div>
              {meta.descHtml
                ? <div className="pc-desc" dangerouslySetInnerHTML={{ __html: meta.descHtml }} />
                : <div className="pc-desc">{meta.desc}</div>}
            </div>
          )
        })}
      </div>

      <div className="fx-section-label">用户存档</div>
      <div className="user-archive-grid" id="user-archive-grid">
        <div className="user-archive-toolbar">
          <div className="user-archive-note">空白新建，保存当前视觉参数；支持导出 JSON 备份后再导入。</div>
          <div className="user-archive-tools">
            <button className="fx-mini-btn ghost" type="button" onClick={() => engine.createUserFxArchive()}>新建</button>
            <button className="fx-mini-btn ghost" type="button" onClick={() => importInputRef.current?.click()}>导入</button>
            <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImportFile} />
          </div>
        </div>
        {state.userFxArchives.map((slot, index) => {
          const hasSave = !!slot.snapshot
          const editing = renamingIndex === index
          return (
            <div key={index} className={`user-archive-slot${hasSave ? ' has-save' : ''}`} data-slot={index}>
              {editing ? (
                <input
                  className="user-archive-input"
                  type="text"
                  maxLength={28}
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingIndex(-1)
                  }}
                />
              ) : (
                <div className="user-archive-name" title={slot.name}>{slot.name}</div>
              )}
              <div className="user-archive-meta">
                {hasSave ? '已保存的视觉快照' : '空白存档，点击保存写入当前视觉'}
              </div>
              <div className="user-archive-actions">
                {editing ? (
                  <>
                    <button type="button" onClick={commitRename}>确定</button>
                    <button type="button" onClick={() => setRenamingIndex(-1)}>取消</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={!hasSave} onClick={() => engine.applyUserFxArchive(index)}>应用</button>
                    <button type="button" onClick={() => engine.saveUserFxArchive(index)}>保存</button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingIndex(index)
                        setRenameDraft(slot.name)
                      }}
                    >
                      命名
                    </button>
                    <button type="button" disabled={!hasSave} onClick={() => engine.exportUserFxArchive(index)}>导出</button>
                    <button type="button" onClick={() => engine.removeUserFxArchive(index)}>删除</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
        <button className="user-archive-slot is-new" type="button" onClick={() => engine.createUserFxArchive()}>
          <strong>＋ 新建空白存档</strong>
          <span className="user-archive-meta">可继续创建，不限制数量</span>
        </button>
      </div>

      <div className="fx-section-label">自定义颜色</div>
      <ColorRow
        label="界面高亮"
        value={fx.uiAccentColor}
        hint={fx.uiAccentColor.toUpperCase()}
        onPick={(c) => engine.setUiAccentColor(c)}
        actions={[{ label: '默认', onClick: () => engine.resetUiAccentColor() }]}
      />
      <ColorRow
        label="视觉主色"
        value={fx.visualTintColor}
        hint={fx.visualTintMode === 'auto' ? '封面取色' : fx.visualTintColor.toUpperCase()}
        onPick={(c) => engine.setVisualTintCustom(c)}
        actions={[
          { label: '封面', onClick: () => engine.setVisualTintAuto(), active: fx.visualTintMode === 'auto' },
          { label: '默认', onClick: () => engine.resetVisualTintColor() },
        ]}
      />
      <ColorRow
        label="背景颜色"
        value={fx.backgroundColor}
        hint={fx.backgroundColorMode === 'custom' ? fx.backgroundColor.toUpperCase() : '封面'}
        onPick={(c) => engine.setCustomBackgroundColor(c)}
        actions={[{ label: '封面', onClick: () => engine.setCustomBackgroundCoverMode(), active: fx.backgroundColorMode !== 'custom' }]}
      />
      <div className="lyric-color-row image-pick-row">
        <button className="fx-mini-btn ghost" type="button" onClick={() => bgMediaInputRef.current?.click()}>选择</button>
        <div className="fx-color-row-label">背景媒体<small>{fx.backgroundImage || fx.backgroundMedia ? '已设置' : '未设置'}</small></div>
        <button className="fx-mini-btn ghost" type="button" onClick={() => engine.clearCustomBackgroundImage()}>清除</button>
        <input
          ref={bgMediaInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          style={{ display: 'none' }}
          onChange={handleBgMediaFile}
        />
      </div>
      {BACKGROUND_SLIDERS.map((spec) => <FxSlider key={spec.key} spec={spec} fx={fx} engine={engine} />)}

      <div className="fx-section-label">主控</div>
      {MAIN_SLIDERS.map((spec) => <FxSlider key={spec.key} spec={spec} fx={fx} engine={engine} />)}

      <div className={`fx-fold${openFolds.lyric ? ' open' : ''}`} id="fx-lyric-fold">
        <div className="fx-fold-head" onClick={() => toggleFold('lyric')}>
          <span className="fx-fold-title"><strong>歌词外观</strong><small>颜色 / 字体 / 位置</small></span><span className="arrow">▶</span>
        </div>
        <div className="fx-fold-body">
          <div className="fx-section-label">歌词颜色</div>
          <div className="lyric-color-grid" id="lyric-color-grid">
            <button
              className={`lyric-swatch auto${fx.lyricColorMode === 'auto' ? ' active' : ''}`}
              type="button"
              data-auto="1"
              title="封面取色"
              onClick={() => engine.setLyricColorAuto()}
            >
              AUTO
            </button>
            {state.lyricColorPresets.map((preset, index) => (
              <button
                key={preset.color}
                type="button"
                className={`lyric-swatch${fx.lyricColorMode !== 'auto' && fx.lyricColor.toLowerCase() === preset.color.toLowerCase() ? ' active' : ''}`}
                data-color={preset.color}
                style={{ ['--swatch' as never]: preset.color }}
                title={preset.name}
                onClick={() => engine.setLyricColorPreset(index)}
              />
            ))}
          </div>
          <ColorRow
            label="歌词颜色"
            value={fx.lyricColor}
            hint={fx.lyricColorMode === 'auto' ? '封面取色' : fx.lyricColor.toUpperCase()}
            onPick={(c) => engine.setLyricColorCustom(c)}
            actions={[{ label: '封面', onClick: () => engine.setLyricColorAuto(), active: fx.lyricColorMode === 'auto' }]}
          />
          <ColorRow
            label="高亮颜色"
            value={fx.lyricHighlightColor}
            hint={fx.lyricHighlightMode === 'auto' ? '跟随歌词' : fx.lyricHighlightColor.toUpperCase()}
            onPick={(c) => engine.setLyricHighlightCustom(c)}
            actions={[{ label: '跟随', onClick: () => engine.setLyricHighlightAuto(), active: fx.lyricHighlightMode === 'auto' }]}
          />
          <ColorRow
            label="溢光颜色"
            value={fx.lyricGlowColor}
            hint={fx.lyricGlowLinked ? '跟随高亮' : fx.lyricGlowColor.toUpperCase()}
            onPick={(c) => engine.setLyricGlowCustom(c)}
            actions={[{ label: '链接', onClick: () => engine.setLyricGlowLinked(!fx.lyricGlowLinked), active: fx.lyricGlowLinked }]}
          />
          <div className="fx-section-label">歌词字体</div>
          <div className="fx-font-grid expanded" id="lyric-font-grid">
            {LYRIC_FONTS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-font={key}
                className={fx.lyricFont === key ? 'active' : ''}
                onClick={() => engine.setLyricFont(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {LYRIC_TYPO_SLIDERS.map((spec) => <FxSlider key={spec.key} spec={spec} fx={fx} engine={engine} />)}
          <div className="fx-section-label">歌词布局</div>
          {LYRIC_LAYOUT_SLIDERS.map((spec) => <FxSlider key={spec.key} spec={spec} fx={fx} engine={engine} />)}
        </div>
      </div>

      <div className={`fx-fold${openFolds.overlay ? ' open' : ''}`} id="fx-overlay-fold">
        <div className="fx-fold-head" onClick={() => toggleFold('overlay')}>
          <span className="fx-fold-title"><strong>叠加效果</strong><small>粒子 / 镜头 / 溢光</small></span><span className="arrow">▶</span>
        </div>
        <div className="fx-fold-body">
          <div className="fx-toggle-grid">
            {OVERLAY_TOGGLES.map((toggle) => (
              <div
                key={toggle.key}
                className={`fx-toggle${fx[toggle.key] ? ' on' : ''}`}
                title={toggle.title}
                onClick={() => engine.toggleFx(toggle.key)}
              >
                <span>{toggle.label}</span><span className="dot" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`fx-advanced${advancedOpen ? ' open' : ''}`} id="fx-advanced">
        <div className="fx-advanced-head" onClick={() => setAdvancedOpen(!advancedOpen)}>
          <span>高级参数</span><span className="arrow">▶</span>
        </div>
        <div className="fx-advanced-body">
          <div className="fx-section-label">直播 / 后台</div>
          <div className="fx-seg" id="performance-background-seg">
            {([['auto', '自动优化'], ['keep', '保持运行'], ['release', '停止释放']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={fx.performanceBackground === mode ? 'active' : ''}
                onClick={() => engine.setPerformanceBackgroundMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="fx-section-label">画质档位</div>
          <div className="fx-seg" id="performance-quality-seg">
            {([['eco', '低'], ['balanced', '中'], ['high', '高'], ['ultra', '超高']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={fx.performanceQuality === mode ? 'active' : ''}
                onClick={() => engine.setPerformanceQualityMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {ADVANCED_SLIDERS.map((spec) => <FxSlider key={spec.key} spec={spec} fx={fx} engine={engine} />)}
        </div>
      </div>

      <div className="fx-actions">
        <button className="fx-mini-btn" type="button" onClick={() => engine.resetFx()}>恢复默认</button>
      </div>
    </div>
  )
}
