import { describe, expect, it } from 'vitest'
import { acceptRemoteVersion, createSession, markExternalChange, markSessionSaved, updateSessionContent } from './session'
import { findCompatibilityRisks } from './markdownSafety'
import { imageTitleAndWidth, markdownImageDestinations, remapMarkdownImageDestinations, titleWithImageWidth } from './markdownImages'
import { isImageCandidate, supportedImage } from './pendingImages'

describe('DocumentSession', () => {
  it('does not change or dirty a document when content is unchanged', () => {
    const session = createSession({
      filePath: '/docs/原文.md',
      content: '# 标题\n',
      diskVersionHash: 'hash-1',
      bom: false,
      lineEnding: 'lf',
    })
    expect(updateSessionContent(session, session.currentContent)).toBe(session)
    expect(session.isDirty).toBe(false)
  })

  it('tracks revisions and clears dirty state only after a successful save result', () => {
    const opened = createSession({
      filePath: '/docs/note.md',
      content: '原文',
      diskVersionHash: 'hash-1',
      bom: false,
      lineEnding: 'lf',
    })
    const edited = updateSessionContent(opened, '新内容')
    expect(edited.isDirty).toBe(true)
    expect(edited.revision).toBe(1)
    const saved = markSessionSaved(edited, '/docs/note.md', 'hash-2')
    expect(saved.isDirty).toBe(false)
    expect(saved.originalContent).toBe('新内容')
    expect(saved.diskVersionHash).toBe('hash-2')
  })

  it('keeps changes typed while an earlier revision is being saved', () => {
    const opened = createSession({ filePath: '/docs/note.md', content: '旧内容', diskVersionHash: 'h1', bom: false, lineEnding: 'lf' })
    const snapshot = updateSessionContent(opened, '保存中的内容')
    const later = updateSessionContent(snapshot, '保存期间的新内容')
    const saved = markSessionSaved(later, '/docs/note.md', 'h2', snapshot.currentContent, snapshot.revision)
    expect(saved.originalContent).toBe('保存中的内容')
    expect(saved.currentContent).toBe('保存期间的新内容')
    expect(saved.isDirty).toBe(true)
  })

  it('restores clean state when the user undoes back to the saved text', () => {
    const opened = createSession({
      filePath: '/docs/note.md',
      content: 'saved',
      diskVersionHash: 'hash-1',
      bom: false,
      lineEnding: 'lf',
    })
    const edited = updateSessionContent(opened, 'changed')
    expect(updateSessionContent(edited, 'saved').isDirty).toBe(false)
  })

  it('keeps Base and Local drafts when a new Remote version arrives', () => {
    const base = createSession({ filePath: '/docs/note.md', content: 'base', diskVersionHash: 'h1', bom: false, lineEnding: 'lf' })
    const local = updateSessionContent(base, 'local')
    const conflicted = markExternalChange(local, { operation: 'modified', content: 'remote', hash: 'h2' })

    expect(conflicted.currentContent).toBe('local')
    expect(conflicted.externalChange).toMatchObject({
      state: 'merge_available',
      baseContent: 'base',
      remoteContent: 'remote',
      remoteHash: 'h2',
    })
    expect(conflicted.diskConflict).toBe(true)
  })

  it('only accepts the Remote version after an explicit call', () => {
    const base = createSession({ filePath: '/docs/note.md', content: 'base', diskVersionHash: 'h1', bom: false, lineEnding: 'lf' })
    const local = updateSessionContent(base, 'local')
    const accepted = acceptRemoteVersion(local, {
      filePath: '/docs/note.md', content: 'remote', diskVersionHash: 'h2', bom: false, lineEnding: 'lf',
    })
    expect(accepted.currentContent).toBe('remote')
    expect(accepted.isDirty).toBe(false)
    expect(accepted.externalChange).toBeNull()
  })
})

describe('Markdown compatibility boundary', () => {
  it('flags syntax that the visual editor must preserve in source mode', () => {
    const markdown = [
      '---', 'title: note', '---', '',
      '~~~mermaid', 'graph TD', '~~~', '',
      '<div>native html</div>',
    ].join('\n')
    const risks = findCompatibilityRisks(markdown)
    expect(new Set(risks.map((risk) => risk.id))).toEqual(new Set(['front-matter', 'mermaid', 'html']))
  })

  it('protects custom code block metadata', () => {
    expect(findCompatibilityRisks('```js {title="example.js"}\nconsole.log(1)\n```').map((risk) => risk.id))
      .toContain('custom-code')
    expect(findCompatibilityRisks('```javascript\nconsole.log(1)\n```')).toEqual([])
  })

  it('allows Milkdown hard breaks and HTML examples inside code', () => {
    expect(findCompatibilityRisks('第一行\n<br />\n第二行')).toEqual([])
    expect(findCompatibilityRisks('`<div>代码示例</div>`\n\n```html\n<div>示例</div>\n```')).toEqual([])
    expect(findCompatibilityRisks('<div>原生 HTML</div>').map((risk) => risk.id)).toContain('html')
  })
})

describe('Markdown image paths', () => {
  it('shows resolved local images without changing the Markdown destination', () => {
    const destination = 'src-tauri/icons/icon.png'
    const dataUrl = 'data:image/png;base64,AA=='
    const source = `![icon](${destination} "icon")\n![remote](https://example.com/icon.png)`
    const display = remapMarkdownImageDestinations(source, new Map([[destination, dataUrl]]))
    const restored = remapMarkdownImageDestinations(display, new Map([[dataUrl, destination]]))

    expect(markdownImageDestinations(source)).toEqual([destination])
    expect(display).toContain(`![icon](${dataUrl} "icon")`)
    expect(restored).toBe(source)
  })

  it('remaps pending clipboard images without embedding image bytes', () => {
    const source = '说明\n\n![剪贴板图片](blob:mdstudio-image-1)\n'
    const saved = remapMarkdownImageDestinations(source, new Map([['blob:mdstudio-image-1', 'notes_assets/1.png']]))
    expect(saved).toContain('![剪贴板图片](notes_assets/1.png)')
    expect(saved).not.toContain('base64')
    expect(markdownImageDestinations(source)).toEqual([])
  })

  it('keeps image alt text and title while storing an optional Markdown width marker', () => {
    const title = titleWithImageWidth('架构图', 360)
    expect(title).toBe('架构图 · mdstudio-width=360px')
    expect(imageTitleAndWidth(title)).toEqual({ title: '架构图', width: 360 })
    expect(imageTitleAndWidth('原始标题')).toEqual({ title: '原始标题', width: null })
  })

  it('accepts dropped images with an empty MIME type by file extension', () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], '示例.png', { type: '' })
    expect(isImageCandidate(png)).toBe(true)
    expect(supportedImage(png)?.extension).toBe('png')
    expect(isImageCandidate(new File(['text'], 'readme.md', { type: '' }))).toBe(false)
  })
})
