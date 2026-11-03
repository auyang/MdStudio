import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/classic.css'
import { imageTitleAndWidth, markdownImageDestinations, remapMarkdownImageDestinations, titleWithImageWidth } from '../../features/documents/markdownImages'
import { isImageCandidate, supportedImage, suggestedImageAlt } from '../../features/documents/pendingImages'

interface MilkdownEditorProps {
  documentId: string
  filePath: string | null
  initialContent: string
  imageUrlReplacements: Readonly<Record<string, string>>
  onImageUpload: (file: File) => Promise<string>
  onImageError: (message: string) => void
  onChange: (content: string) => void
}

export function MilkdownEditor({ documentId, filePath, initialContent, imageUrlReplacements, onImageUpload, onImageError, onChange }: MilkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const callbackRef = useRef(onChange)
  const uploadRef = useRef(onImageUpload)
  const errorRef = useRef(onImageError)
  const aliasesRef = useRef(imageUrlReplacements)
  const viewRef = useRef<EditorView | null>(null)
  const replacementPositionRef = useRef<number | null>(null)
  const [selectedImage, setSelectedImage] = useState<{ position: number; width: number } | null>(null)
  callbackRef.current = onChange
  uploadRef.current = onImageUpload
  errorRef.current = onImageError
  aliasesRef.current = imageUrlReplacements

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let mounted = true
    let ready = false
    let lastMarkdown = initialContent
    let editor: Crepe | null = null
    let view: EditorView | null = null
    let observer: MutationObserver | null = null

    const decorateImageSizes = () => {
      root.querySelectorAll<HTMLImageElement>('.ProseMirror img').forEach((image) => {
        const { title, width } = imageTitleAndWidth(image.title)
        if (width) {
          image.style.width = `${width}px`
          image.style.height = 'auto'
          image.style.maxWidth = '100%'
          image.title = title
        }
      })
    }

    const positionOf = (image: HTMLImageElement) => {
      if (!view) return null
      try {
        const position = view.posAtDOM(image, 0)
        const node = view.state.doc.nodeAt(position) ?? view.state.doc.nodeAt(position - 1)
        return node?.type.name === 'image' ? (view.state.doc.nodeAt(position) ? position : position - 1) : null
      } catch {
        return null
      }
    }

    const insertImage = async (file: File, coords?: { x: number; y: number }, replacePosition?: number) => {
      const descriptor = supportedImage(file)
      if (!descriptor) {
        errorRef.current('图片格式不支持或文件超过 20 MiB。支持 PNG、JPEG、GIF、WebP 和 AVIF。')
        return
      }
      if (!view) return
      try {
        const source = await uploadRef.current(file)
        if (!mounted || !view) return
        const imageType = view.state.schema.nodes.image
        if (!imageType) throw new Error('当前编辑器未提供 Markdown 图片节点。')
        const transaction = view.state.tr
        if (replacePosition !== undefined) {
          const node = transaction.doc.nodeAt(replacePosition)
          if (!node || node.type !== imageType) throw new Error('图片位置已变化，请重新选择图片。')
          transaction.setNodeMarkup(replacePosition, undefined, { ...node.attrs, src: source })
        } else {
          if (coords) {
            const hit = view.posAtCoords({ left: coords.x, top: coords.y })
            if (hit) transaction.setSelection(TextSelection.near(transaction.doc.resolve(hit.pos)))
          }
          const image = imageType.create({ src: source, alt: suggestedImageAlt(file.name), title: '' })
          transaction.replaceSelectionWith(image)
        }
        view.dispatch(transaction.scrollIntoView())
        view.focus()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errorRef.current(`图片没有插入：${message}`)
      }
    }

    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null && isImageCandidate(file))
      if (files.length === 0) return
      if (files.some((file) => !supportedImage(file))) {
        errorRef.current('剪贴板图片格式不支持或文件超过 20 MiB；原剪贴板内容未被拦截。')
        return
      }
      event.preventDefault()
      void (async () => {
        for (const file of files) await insertImage(file)
      })()
    }

    const onDragOver = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.some((file) => supportedImage(file))) event.preventDefault()
    }

    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageCandidate)
      if (files.length === 0) return
      if (files.some((file) => !supportedImage(file))) {
        errorRef.current('拖入的图片格式不支持或超过 20 MiB；文件操作未被拦截。')
        return
      }
      event.preventDefault()
      void (async () => {
        for (const file of files) await insertImage(file, { x: event.clientX, y: event.clientY })
      })()
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLImageElement) || !root.contains(target)) {
        setSelectedImage(null)
        return
      }
      const position = positionOf(target)
      if (position === null) return
      const { width } = imageTitleAndWidth(target.title)
      setSelectedImage({ position, width: width ?? Math.round(target.getBoundingClientRect().width || 420) })
    }

    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLImageElement) || !root.contains(target)) return
      const position = positionOf(target)
      if (position === null) return
      replacementPositionRef.current = position
      fileInputRef.current?.click()
    }

    root.addEventListener('paste', onPaste, true)
    root.addEventListener('dragover', onDragOver)
    root.addEventListener('drop', onDrop)
    root.addEventListener('click', onClick)
    root.addEventListener('dblclick', onDoubleClick)

    const createEditor = async () => {
      const sourceByDataUrl = new Map<string, string>()
      if (filePath && isTauri()) {
        const results = await Promise.all(markdownImageDestinations(initialContent).map(async (destination) => {
          try {
            const dataUrl = await invoke<string>('resolve_local_asset', { filePath, relativePath: destination })
            return [destination, dataUrl] as const
          } catch {
            return null
          }
        }))
        for (const result of results) if (result) sourceByDataUrl.set(result[1], result[0])
      }
      if (!mounted) return

      const dataUrlBySource = new Map([...sourceByDataUrl].map(([dataUrl, destination]) => [destination, dataUrl]))
      const toSourceMarkdown = (markdown: string) => {
        const blobReplacements = new Map(Object.entries(aliasesRef.current))
        return remapMarkdownImageDestinations(
          remapMarkdownImageDestinations(markdown, blobReplacements),
          sourceByDataUrl,
        )
      }
      const instance = new Crepe({
        root,
        defaultValue: remapMarkdownImageDestinations(initialContent, dataUrlBySource),
        features: {
          [Crepe.Feature.TopBar]: true,
          [Crepe.Feature.ImageBlock]: false,
          [Crepe.Feature.BlockEdit]: true,
          [Crepe.Feature.Toolbar]: true,
          [Crepe.Feature.Table]: true,
          [Crepe.Feature.Latex]: true,
          [Crepe.Feature.CodeMirror]: true,
        },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: { text: '从这里开始写作…', mode: 'block' },
        },
      })
      editor = instance
      instance.on((listener) => {
        listener.markdownUpdated((_context, markdown) => {
          const sourceMarkdown = toSourceMarkdown(markdown)
          queueMicrotask(decorateImageSizes)
          if (!mounted || !ready || sourceMarkdown === lastMarkdown) return
          lastMarkdown = sourceMarkdown
          callbackRef.current(sourceMarkdown)
        })
      })

      await instance.create()
      if (!mounted) {
        void instance.destroy()
        return
      }
      view = instance.editor.action((ctx) => ctx.get(editorViewCtx))
      viewRef.current = view
      observer = new MutationObserver(decorateImageSizes)
      observer.observe(root, { childList: true, subtree: true })
      decorateImageSizes()
      // 创建阶段可能规范化视图节点；只从此刻之后接受用户编辑产生的 Markdown。
      lastMarkdown = toSourceMarkdown(instance.getMarkdown())
      ready = true
    }

    void createEditor().catch((error: unknown) => {
      console.error('Milkdown 初始化失败', error)
      errorRef.current('所见即所得编辑器加载失败，请切换到源码模式。')
    })

    return () => {
      mounted = false
      observer?.disconnect()
      root.removeEventListener('paste', onPaste, true)
      root.removeEventListener('dragover', onDragOver)
      root.removeEventListener('drop', onDrop)
      root.removeEventListener('click', onClick)
      root.removeEventListener('dblclick', onDoubleClick)
      if (viewRef.current === view) viewRef.current = null
      if (editor) void editor.destroy()
    }
  }, [documentId, filePath])

  const setSelectedWidth = (width: number) => {
    const view = viewRef.current
    if (!view || !selectedImage) return
    const node = view.state.doc.nodeAt(selectedImage.position)
    if (!node || node.type.name !== 'image') return
    view.dispatch(view.state.tr.setNodeMarkup(selectedImage.position, undefined, {
      ...node.attrs,
      title: titleWithImageWidth(String(node.attrs.title ?? ''), width),
    }))
    setSelectedImage({ position: selectedImage.position, width })
  }

  return (
    <div className="milkdown-editor-shell">
      <div className="milkdown-host" ref={rootRef} aria-label="所见即所得编辑器" />
      {selectedImage && (
        <div className="image-size-controls" role="group" aria-label="图片尺寸">
          <span>图片宽度</span>
          <input aria-label="图片宽度" type="range" min="80" max="1200" step="10" value={Math.min(1200, selectedImage.width)} onChange={(event) => setSelectedWidth(Number(event.target.value))} />
          <output>{selectedImage.width}px</output>
          <button type="button" onClick={() => { replacementPositionRef.current = selectedImage.position; fileInputRef.current?.click() }}>替换图片</button>
        </div>
      )}
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        onChange={(event) => {
          const file = event.target.files?.[0]
          const position = replacementPositionRef.current
          replacementPositionRef.current = null
          event.currentTarget.value = ''
          if (file) void insertFileFromInput(file, position)
        }}
      />
    </div>
  )

  async function insertFileFromInput(file: File, position: number | null) {
    const descriptor = supportedImage(file)
    if (!descriptor) {
      errorRef.current('图片格式不支持或文件超过 20 MiB。')
      return
    }
    const view = viewRef.current
    if (!view) return
    try {
      const source = await uploadRef.current(file)
      const node = position === null ? null : view.state.doc.nodeAt(position)
      const imageType = view.state.schema.nodes.image
      if (!imageType) throw new Error('当前编辑器未提供 Markdown 图片节点。')
      if (node && node.type === imageType) {
        view.dispatch(view.state.tr.setNodeMarkup(position!, undefined, { ...node.attrs, src: source }).scrollIntoView())
      } else {
        view.dispatch(view.state.tr.replaceSelectionWith(imageType.create({ src: source, alt: suggestedImageAlt(file.name), title: '' })).scrollIntoView())
      }
      view.focus()
    } catch (error) {
      errorRef.current(`图片没有插入：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
