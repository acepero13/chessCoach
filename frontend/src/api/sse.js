const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Stream an SSE endpoint that emits:
 *   data: {"text": "…"}\n\n
 *   data: [DONE]\n\n
 *
 * @param {string} path - API path (e.g. '/selfanalysis/session/1/explain-stream')
 * @param {object} body - JSON body for POST (omit or null for GET)
 * @param {function} onChunk - called with each text chunk string
 * @param {AbortSignal} [signal] - optional AbortSignal to cancel mid-stream
 * @returns {Promise<string>} - resolves with the full accumulated text when done
 */
export async function streamPost(path, body, onChunk, signal) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  })

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(err)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? '' // keep incomplete trailing line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return full
      try {
        const { text } = JSON.parse(data)
        if (text) {
          full += text
          onChunk(text)
        }
      } catch {
        // ignore malformed lines
      }
    }
  }
  return full
}
