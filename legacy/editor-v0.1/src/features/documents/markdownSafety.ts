export interface CompatibilityRisk {
  id: 'front-matter' | 'mermaid' | 'html' | 'directive' | 'mdx' | 'custom-code'
  label: string
}

const patterns: Array<{ id: CompatibilityRisk['id']; label: string; pattern: RegExp }> = [
  {
    id: 'front-matter',
    label: 'YAML Front Matter',
    pattern: /^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,
  },
  // Milkdown 用 <br /> 表示标准硬换行；其他 HTML 仍保守留在源码模式。
  { id: 'html', label: '原生 HTML', pattern: /<\/?(?!br\b)[a-z][a-z0-9-]*(?:\s[^>]*|\s*\/?)>/i },
  { id: 'directive', label: '自定义扩展块', pattern: /^\s*:::/m },
  { id: 'mdx', label: 'MDX 扩展语法', pattern: /^\s*(?:import|export)\s+.+\s+from\s+/m },
]

function removeCode(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const visible: string[] = []
  let fence: { character: '`' | '~'; length: number } | null = null

  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (!fence && marker) {
      fence = { character: marker[1][0] as '`' | '~', length: marker[1].length }
      visible.push('')
      continue
    }
    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/)?.[1]
      if (closing && closing[0] === fence.character && closing.length >= fence.length) fence = null
      visible.push('')
      continue
    }
    visible.push(line)
  }

  return visible.join('\n').replace(/(`+)(.*?)\1/g, '')
}

export function findCompatibilityRisks(markdown: string): CompatibilityRisk[] {
  const markdownWithoutCode = removeCode(markdown)
  const risks = patterns
    .filter(({ id, pattern }) => pattern.test(id === 'html' ? markdownWithoutCode : markdown))
    .map(({ id, label }) => ({ id, label }))

  const standardLanguages = new Set([
    'bash', 'c', 'cpp', 'cs', 'css', 'diff', 'go', 'html', 'java', 'javascript', 'js',
    'json', 'jsx', 'kotlin', 'lua', 'makefile', 'markdown', 'md', 'php', 'powershell',
    'py', 'python', 'ruby', 'rust', 'rs', 'sh', 'shell', 'sql', 'swift', 'toml', 'ts',
    'tsx', 'typescript', 'txt', 'text', 'xml', 'yaml', 'yml', 'zsh',
  ])
  const fencePattern = /^ {0,3}(?:`{3,}|~{3,})([^\s`~]*)(.*)$/gm
  for (const match of markdown.matchAll(fencePattern)) {
    const language = match[1].toLowerCase()
    if (language === 'mermaid') {
      if (!risks.some((risk) => risk.id === 'mermaid')) {
        risks.push({ id: 'mermaid', label: 'Mermaid 图表' })
      }
    } else if ((match[2].trim().length > 0 || (language.length > 0 && !standardLanguages.has(language)))
      && !risks.some((risk) => risk.id === 'custom-code')) {
      risks.push({ id: 'custom-code', label: '自定义代码块' })
    }
  }

  return risks
}

export function extractHeadings(markdown: string): Array<{ level: number; text: string; index: number }> {
  const headings: Array<{ level: number; text: string; index: number }> = []
  const expression = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm
  for (const match of markdown.matchAll(expression)) {
    const rawText = match[2]
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~]/g, '')
      .trim()
    if (rawText) headings.push({ level: match[1].length, text: rawText, index: match.index ?? 0 })
  }
  return headings
}
