import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { OFDViewer, type OFDViewerHandle } from '@ofdrw/ofdrw-viewer-ui/react'
import { OFDDocument, type FontInput, type RenderTask } from '@ofdrw/ofdrw-viewer-engine'
import '@ofdrw/ofdrw-viewer-ui/style.css'
import './poc.css'

type EngineSession = { document: Awaited<ReturnType<typeof OFDDocument.open>>; pageCount: number }

function EngineProbe({ file, supplementaryFont }: { file: File | null; supplementaryFont: FontInput | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<EngineSession | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [sessionVersion, setSessionVersion] = useState(0)
  const [page, setPage] = useState(0)
  const [scale, setScale] = useState(1)
  const [message, setMessage] = useState('选择 OFD 后测试 engine Canvas 绘制。')
  const openedAtRef = useRef(0)
  const firstRenderRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel?: () => void } | undefined
    const open = async () => {
      const previous = sessionRef.current
      sessionRef.current = null
      await previous?.document.close()
      setPageCount(0)
      setPage(0)
      setSessionVersion(value => value + 1)
      if (!file) return
      openedAtRef.current = performance.now()
      firstRenderRef.current = true
      try {
        const document = await OFDDocument.open({
          source: { kind: 'blob', blob: file },
          ...(supplementaryFont ? { supplementaryFonts: [supplementaryFont] } : {}),
          onWarning: warning => {
            if (!cancelled) setMessage(`engine 警告 ${warning.code}: ${warning.message}`)
          },
        })
        if (cancelled) { await document.close(); return }
        sessionRef.current = { document, pageCount: document.pageCount }
        setPageCount(document.pageCount)
        setSessionVersion(value => value + 1)
        setMessage(`engine 已解析：${document.pageCount} 页，${(performance.now() - openedAtRef.current).toFixed(0)} ms`)
      } catch (error) {
        if (!cancelled) setMessage(`engine 打开失败：${String(error)}`)
      }
    }
    void open()
    return () => {
      cancelled = true
      renderTask?.cancel?.()
      const session = sessionRef.current
      sessionRef.current = null
      void session?.document.close()
    }
  }, [file, supplementaryFont])

  useEffect(() => {
    let cancelled = false
    let renderTask: RenderTask | undefined
    const render = async () => {
      const session = sessionRef.current
      const canvas = canvasRef.current
      if (!session || !canvas) return
      const renderStartedAt = performance.now()
      try {
        const ofdPage = await session.document.getPage(page)
        const viewport = ofdPage.getViewport({ dpi: 96 * scale })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const width = Math.ceil(viewport.width * pixelRatio)
        const height = Math.ceil(viewport.height * pixelRatio)
        if (width * height > 24_000_000) throw new Error(`画布超出 POC 预算：${width}×${height}`)
        canvas.width = width
        canvas.height = height
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建 Canvas 2D 上下文。')
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
        renderTask = ofdPage.render({ canvasContext: context, viewport })
        await renderTask.promise
        if (!cancelled) {
          const timing = firstRenderRef.current
            ? `首屏耗时 ${(performance.now() - openedAtRef.current).toFixed(0)} ms`
            : `本次绘制 ${(performance.now() - renderStartedAt).toFixed(0)} ms`
          firstRenderRef.current = false
          setMessage(`engine 已绘制：第 ${page + 1}/${session.pageCount} 页，${Math.round(viewport.width)}×${Math.round(viewport.height)} CSS px；${timing}`)
        }
      } catch (error) {
        if (!cancelled) setMessage(`engine 绘制失败：${String(error)}`)
      }
    }
    void render()
    return () => { cancelled = true; renderTask?.cancel() }
  }, [file, page, scale, sessionVersion])

  return <section className="probe-pane">
    <h2>Engine · Canvas 自绘</h2>
    <div className="probe-controls">
      <button disabled={page <= 0} onClick={() => setPage(value => Math.max(0, value - 1))}>上一页</button>
      <span>{pageCount ? `${page + 1} / ${pageCount}` : '— / —'}</span>
      <button disabled={!pageCount || page >= pageCount - 1} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))}>下一页</button>
      <button disabled={scale <= 0.5} onClick={() => setScale(value => Math.max(0.5, value - 0.1))}>缩小</button>
      <span>{Math.round(scale * 100)}%</span>
      <button disabled={scale >= 2} onClick={() => setScale(value => Math.min(2, value + 0.1))}>放大</button>
    </div>
    <div className="canvas-scroll"><canvas ref={canvasRef} aria-label="engine 渲染画布" /></div>
    <output>{message}</output>
  </section>
}

function ViewerProbe({ file, locale, showToolbar, supplementaryFont, fontRevision }: { file: File | null; locale: string; showToolbar: boolean; supplementaryFont: FontInput | null; fontRevision: number }) {
  const ref = useRef<OFDViewerHandle>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState('选择 OFD 后测试 viewer-ui React 封装。')
  const [query, setQuery] = useState('')
  const openedAtRef = useRef(0)
  const [documentSummary, setDocumentSummary] = useState('')

  useEffect(() => {
    setPageCount(0)
    setPage(1)
    openedAtRef.current = performance.now()
    setDocumentSummary('')
    setMessage(file ? 'viewer-ui 正在加载…' : '选择 OFD 后测试 viewer-ui React 封装。')
  }, [file])

  return <section className="probe-pane viewer-pane">
    <h2>Viewer UI · React ref / 隐藏内置工具栏</h2>
    <div className="probe-controls">
      <button disabled={page <= 1} onClick={() => ref.current?.goToPage(page - 1)}>上一页</button>
      <span>{pageCount ? `${page} / ${pageCount}` : '— / —'}</span>
      <button disabled={!pageCount || page >= pageCount} onClick={() => ref.current?.goToPage(page + 1)}>下一页</button>
      <button onClick={() => ref.current?.setZoomMode('page-width')}>适应宽度</button>
      <button onClick={() => ref.current?.getInstance()?.zoomIn()}>放大</button>
      <button onClick={() => ref.current?.getInstance()?.zoomOut()}>缩小</button>
      <input aria-label="OFD 搜索文本" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文本" />
      <button disabled={!query.trim()} onClick={() => void ref.current?.find(query).catch(error => setMessage(`查找失败：${String(error)}`))}>查找</button>
      <button onClick={() => {
        const sampleQuery = '050001700111'
        setQuery(sampleQuery)
        void ref.current?.find(sampleQuery).catch(error => setMessage(`查找失败：${String(error)}`))
      }}>测发票号</button>
    </div>
    <div className="ofd-host" data-testid="ofd-host">
      {file && <OFDViewer
        key={`${file.name}${file.size}${file.lastModified}${fontRevision}`}
        ref={ref}
        source={file}
        locale={locale}
        fonts={supplementaryFont ? { supplementary: [supplementaryFont] } : undefined}
        features={{ toolbar: showToolbar, print: false, export: false }}
        onReady={() => setMessage('viewer-ui 已就绪。')}
        onPageChange={({ pageNumber }) => setPage(pageNumber)}
        onDocumentOpen={({ pageCount }) => {
          setPageCount(pageCount)
          setDocumentSummary(`viewer-ui 已打开：${pageCount} 页，耗时 ${(performance.now() - openedAtRef.current).toFixed(0)} ms`)
        }}
        onFindMatches={({ total, current }) => setMessage(`查找：${total} 项，当前 ${current}`)}
        onWarning={warning => setMessage(`警告 ${warning.code}: ${warning.message}`)}
        onError={error => setMessage(`错误 ${error.code}: ${error.message}`)}
      />}
    </div>
    <output>{message}{documentSummary && ` · ${documentSummary}`}</output>
  </section>
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [supplementaryFont, setSupplementaryFont] = useState<FontInput | null>(null)
  const [fontRevision, setFontRevision] = useState(0)
  const [locale, setLocale] = useState('zh-CN')
  const [showToolbar, setShowToolbar] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)
  const loadSample = async (path: string, fileName: string) => {
    try {
      const response = await fetch(path)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      setFile(new File([blob], fileName, { type: 'application/ofd' }))
    } catch (error) { window.alert(`样本未能载入：${String(error)}`) }
  }
  return <main className="poc-shell">
    <header><strong>MdStudio OFD POC</strong><span>隔离实验，不代表正式格式支持</span>
      <button onClick={() => inputRef.current?.click()}>选择 OFD</button>
      <label>开源测试样本 <select aria-label="选择开源 OFD 测试样本" defaultValue="" onChange={event => {
        const samples: Record<string, [string, string]> = {
          invoice: ['/samples/ofdrw-invoice.ofd', 'ofdrw-invoice.ofd'],
          seal: ['/samples/upstream-ofdrw/ofdrw-seal-sample.ofd', '发票监制章-数科.ofd'],
          text: ['/samples/upstream-ofdrw/ofdrw-text-layout.ofd', '文字横向-数科.ofd'],
          jpeg: ['/samples/upstream-ofdrw/ofdrw-jpeg-sample.ofd', 'containsJPEG.ofd'],
          brokenImage: ['/samples/upstream-ofdrw/ofdrw-missing-image.ofd', 'testImageNotFound.ofd'],
          signScale: ['/samples/upstream-ofdrw/ofdrw-sign-scale-error.ofd', 'SignScaleError.ofd'],
        }
        const sample = samples[event.target.value]
        if (sample) void loadSample(sample[0], sample[1])
        event.target.value = ''
      }}>
        <option value="">选择样本…</option>
        <option value="invoice">发票示例（原始缺字体问题）</option>
        <option value="seal">发票监制章样本</option>
        <option value="text">中文文字排版（含嵌入字体）</option>
        <option value="jpeg">JPEG 图像及两页样本</option>
        <option value="brokenImage">图片资源异常样本</option>
        <option value="signScale">签章缩放异常样本</option>
      </select></label>
      <button onClick={() => fontInputRef.current?.click()}>加载本机字体回退</button>
      <input ref={fontInputRef} type="file" accept=".ttf,.otf,.ttc,application/x-font-ttf,application/vnd.ms-opentype" hidden onChange={async event => {
        const selected = event.target.files?.[0]
        event.target.value = ''
        if (!selected) return
        if (selected.size === 0 || selected.size > 32 * 1024 * 1024) {
          window.alert('字体文件为空或超过 32 MiB，本次不会加载。')
          return
        }
        try {
          const data = new Uint8Array(await selected.arrayBuffer())
          setSupplementaryFont({ data, family: selected.name })
          setFontRevision(value => value + 1)
        } catch (error) { window.alert(`字体读取失败：${String(error)}`) }
      }} />
      {supplementaryFont && <><span className="file-name">回退字体：{supplementaryFont.family}</span><button onClick={() => { setSupplementaryFont(null); setFontRevision(value => value + 1) }}>清除回退</button></>}
      <label>UI 语言 <select value={locale} onChange={event => setLocale(event.target.value)}><option value="zh-CN">简体中文</option><option value="en-US">English</option><option value="ja-JP">日本語</option></select></label>
      <button onClick={() => setShowToolbar(value => !value)}>{showToolbar ? '隐藏内置工具栏' : '显示内置工具栏'}</button>
      <input ref={inputRef} type="file" accept=".ofd,application/ofd" hidden onChange={event => setFile(event.target.files?.[0] ?? null)} />
      <span className="file-name">{file ? `${file.name} · ${file.size.toLocaleString()} B` : '未选择文件'}</span>
    </header>
    <div className="probe-grid"><ViewerProbe file={file} locale={locale} showToolbar={showToolbar} supplementaryFont={supplementaryFont} fontRevision={fontRevision} /><EngineProbe file={file} supplementaryFont={supplementaryFont} /></div>
  </main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
