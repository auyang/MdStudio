import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'

export interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children: TreeNode[]
}

interface FileTreeProps {
  nodes: TreeNode[]
  activePath: string | null
  onOpen: (path: string) => void
}

export function FileTree({ nodes, activePath, onOpen }: FileTreeProps) {
  return (
    <div className="tree-list" role="tree" aria-label="工作区文件">
      {nodes.map((node) => <TreeItem key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpen} />)}
    </div>
  )
}

function TreeItem({ node, depth, activePath, onOpen }: {
  node: TreeNode
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0 && node.isDirectory)
  const isActive = !node.isDirectory && node.path === activePath
  const paddingLeft = 10 + depth * 14

  if (node.isDirectory) {
    return (
      <div role="treeitem" aria-expanded={expanded}>
        <button className="tree-row folder-row" style={{ paddingLeft }} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span>{node.name}</span>
        </button>
        {expanded && node.children.length > 0 && (
          <div role="group">
            {node.children.map((child) => (
              <TreeItem key={child.path} node={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div role="treeitem" aria-selected={isActive}>
      <button className={`tree-row file-row ${isActive ? 'is-active' : ''}`} style={{ paddingLeft: paddingLeft + 18 }} onClick={() => onOpen(node.path)}>
        <FileText size={14} />
        <span>{node.name}</span>
      </button>
    </div>
  )
}
