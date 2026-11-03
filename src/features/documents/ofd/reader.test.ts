import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createOfdAdapter } from './reader'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invokeMock = vi.mocked(invoke)
const info = {
  canonicalPath: '/tmp/电子票据.ofd',
  displayName: '电子票据.ofd',
  byteSize: 4,
  modifiedUnixMicros: 100,
  pageCount: 1,
  hasSignatures: true,
  resourceWarnings: [],
  fontResources: [],
}

describe('OFD 文档适配器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('ofd-request-1')
  })

  it('通过二进制 IPC 打开，暴露签章元数据并在关闭时清理文档字节', async () => {
    const sourceBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    invokeMock.mockImplementation(async command => {
      if (command === 'inspect_ofd_document') return info as never
      if (command === 'read_ofd_document') return sourceBytes.slice().buffer as never
      return undefined as never
    })

    const session = await createOfdAdapter().open('/tmp/电子票据.ofd')
    expect(session.descriptor).toMatchObject({ documentType: 'ofd', canonicalPath: info.canonicalPath })
    expect(session.payload.bytes).toEqual(sourceBytes)
    expect(session.payload.hasSignatures).toBe(true)
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['inspect_ofd_document', 'read_ofd_document'])
    expect(invokeMock.mock.calls[1][1]).toMatchObject({
      filePath: info.canonicalPath,
      expectedByteSize: info.byteSize,
      expectedModifiedUnixMicros: info.modifiedUnixMicros,
    })

    await session.close()
    expect(session.payload.bytes).toEqual(new Uint8Array(4))
    await session.close()
    expect(session.payload.bytes).toEqual(new Uint8Array(4))
  })

  it('打开前收到取消信号时不调用本地读取命令', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(createOfdAdapter().open('/tmp/电子票据.ofd', { signal: controller.signal }))
      .rejects.toThrow('OFD 打开已取消')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('将受保护文件和不支持的加密状态转成明确提示', async () => {
    invokeMock.mockRejectedValue(new Error('OFD 文件包含加密内容；当前版本不支持加密 OFD'))
    await expect(createOfdAdapter().open('/tmp/电子票据.ofd'))
      .rejects.toThrow('暂不支持加密 OFD')
  })
})
