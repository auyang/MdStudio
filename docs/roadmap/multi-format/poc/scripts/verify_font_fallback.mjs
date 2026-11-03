import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { OFDDocument } from '@ofdrw/ofdrw-viewer-engine'

const samplePath = new URL('../public/samples/ofdrw-invoice.ofd', import.meta.url)
const fontPath = process.env.OFD_FONT_PATH ?? '/System/Library/Fonts/STHeiti Medium.ttc'
const sample = await readFile(samplePath)
const fontBytes = new Uint8Array(await readFile(fontPath))

async function readText(label, supplementaryFonts = []) {
  const warnings = []
  const document = await OFDDocument.open({
    source: { kind: 'blob', blob: new Blob([sample]) },
    supplementaryFonts,
    onWarning: warning => warnings.push(warning),
  })
  try {
    const page = await document.getPage(0)
    const content = await page.getTextContent()
    return {
      label,
      pageCount: document.pageCount,
      itemCount: content.itemCount,
      charCount: content.charCount,
      text: content.items.map(item => item.text).join(''),
      missingFontWarnings: warnings.filter(warning => warning.code === 'W_FONT_MISSING').length,
    }
  } finally {
    await document.close()
  }
}

const withoutFallback = await readText('without-fallback')
const withFallback = await readText('with-system-fallback', [{ data: fontBytes, family: 'STHeiti Medium.ttc' }])

assert.equal(withoutFallback.pageCount, 1)
assert.equal(withoutFallback.charCount, 0, '基线应复现缺失字体导致文字层为空')
assert.ok(withoutFallback.missingFontWarnings > 0, '基线应产生 W_FONT_MISSING')
assert.equal(withFallback.pageCount, 1)
assert.ok(withFallback.charCount > 0, '补充字体后应生成可检索文字')
assert.ok(withFallback.text.includes('050001700111'), '补充字体后应提取发票代码')
assert.equal(withFallback.missingFontWarnings, 0, '补充字体后不应再报告缺失字体')

console.log(JSON.stringify({ withoutFallback, withFallback: { ...withFallback, text: undefined } }, null, 2))
console.log('字体回退验证通过：无字体时文字层为空；补充本机字体后发票代码可提取。')
