/**
 * Minimal markdown renderer for LLM output.
 * Supports: ## h2, ### h3, **bold**, *italic*, - / * unordered lists, 1. ordered lists.
 */

function inlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))   return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

export default function Md({ text, className = '' }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let listItems = []
  let listType = null

  const flush = () => {
    if (!listItems.length) return
    const Tag = listType === 'ol' ? 'ol' : 'ul'
    const cls = listType === 'ol'
      ? 'list-decimal list-inside space-y-1 my-1'
      : 'list-disc list-inside space-y-1 my-1'
    elements.push(
      <Tag key={elements.length} className={cls}>
        {listItems.map((it, i) => <li key={i}>{inlineMarkdown(it)}</li>)}
      </Tag>
    )
    listItems = []
    listType = null
  }

  lines.forEach((line, idx) => {
    const h2 = line.match(/^##\s+(.+)/)
    const h3 = line.match(/^###\s+(.+)/)
    const ul = line.match(/^[-*]\s+(.+)/)
    const ol = line.match(/^\d+\.\s+(.+)/)

    if (h2) {
      flush()
      elements.push(<h2 key={elements.length} className="text-sm font-bold text-chess-gold mt-4 mb-1">{h2[1]}</h2>)
    } else if (h3) {
      flush()
      elements.push(<h3 key={elements.length} className="text-xs font-semibold text-slate-300 mt-3 mb-0.5 uppercase tracking-wide">{h3[1]}</h3>)
    } else if (ul) {
      if (listType === 'ol') flush()
      listType = 'ul'
      listItems.push(ul[1])
    } else if (ol) {
      if (listType === 'ul') flush()
      listType = 'ol'
      listItems.push(ol[1])
    } else {
      flush()
      if (line.trim() === '') {
        if (idx > 0) elements.push(<br key={elements.length} />)
      } else {
        elements.push(<span key={elements.length} className="block">{inlineMarkdown(line)}</span>)
      }
    }
  })
  flush()

  return <div className={className}>{elements}</div>
}
