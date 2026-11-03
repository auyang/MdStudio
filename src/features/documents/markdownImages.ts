const imagePattern = /(!\[[^\]]*\]\()(<[^>]+>|[^\s)]+)((?:\s+[^)]*)?\))/g

export function markdownImageDestinations(markdown: string): string[] {
  const destinations: string[] = []
  const pattern = /!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g

  for (const match of markdown.matchAll(pattern)) {
    const destination = match[1] ?? match[2]
    if (destination && !/^(?:https?:|data:|blob:)/i.test(destination) && !destination.startsWith('#')) {
      destinations.push(destination)
    }
  }

  return [...new Set(destinations)]
}

const widthSuffix = /(?:\s*·\s*mdstudio-width=(\d{2,4})px)$/

export function imageTitleAndWidth(title?: string | null): { title: string; width: number | null } {
  const value = title ?? ''
  const match = value.match(widthSuffix)
  if (!match) return { title: value, width: null }
  const width = Number(match[1])
  return { title: value.slice(0, match.index).trimEnd(), width: width >= 80 && width <= 2000 ? width : null }
}

export function titleWithImageWidth(title: string, width: number): string {
  const cleanTitle = imageTitleAndWidth(title).title
  const boundedWidth = Math.max(80, Math.min(2000, Math.round(width)))
  return `${cleanTitle}${cleanTitle ? ' · ' : ''}mdstudio-width=${boundedWidth}px`
}

export function remapMarkdownImageDestinations(
  markdown: string,
  replacements: ReadonlyMap<string, string>,
): string {
  return markdown.replace(imagePattern, (match, opening: string, token: string, suffix: string) => {
    const destination = token.startsWith('<') && token.endsWith('>') ? token.slice(1, -1) : token
    const replacement = replacements.get(destination)
    return replacement ? `${opening}${replacement}${suffix}` : match
  })
}
