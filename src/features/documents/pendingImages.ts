export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const supportedTypes: Record<string, { extension: string; mimeType: string }> = {
  'image/png': { extension: 'png', mimeType: 'image/png' },
  'image/jpeg': { extension: 'jpg', mimeType: 'image/jpeg' },
  'image/gif': { extension: 'gif', mimeType: 'image/gif' },
  'image/webp': { extension: 'webp', mimeType: 'image/webp' },
  'image/avif': { extension: 'avif', mimeType: 'image/avif' },
}

const imageExtension = /\.(?:png|jpe?g|gif|webp|avif)$/i

export function isImageCandidate(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/') || imageExtension.test(file.name)
}

export interface PendingImage {
  id: string
  file: File
  previewUrl: string
  extension: string
  mimeType: string
}

export function supportedImage(file: File): Omit<PendingImage, 'id' | 'previewUrl'> | null {
  const byMime = supportedTypes[file.type.toLowerCase()]
  const byExtension = Object.values(supportedTypes).find(({ extension }) =>
    new RegExp(`\\.${extension === 'jpg' ? 'jpe?g' : extension}$`, 'i').test(file.name),
  )
  const format = byMime ?? byExtension
  if (!format || file.size === 0 || file.size > MAX_IMAGE_BYTES) return null
  return { file, ...format }
}

export async function imageAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function suggestedImageAlt(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '').trim()
  return withoutExtension || '图片'
}
