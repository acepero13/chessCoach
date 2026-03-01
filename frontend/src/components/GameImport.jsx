import { useState } from 'react'
import { Upload, Globe, ChevronDown, ChevronUp } from 'lucide-react'
import { importLichess, importChessCom, importPgn } from '../api/client'

export default function GameImport({ userId, username, onImported }) {
  const [tab, setTab] = useState('lichess')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Lichess
  const [lichessUser, setLichessUser] = useState(username || '')
  const [lichessMax, setLichessMax] = useState(40)
  const [lichessPerf, setLichessPerf] = useState('')

  // Chess.com
  const [ccUser, setCcUser] = useState(username || '')
  const [ccMax, setCcMax] = useState(40)

  // PGN
  const [pgnFile, setPgnFile] = useState(null)

  const handleLichessImport = async () => {
    setLoading(true); setError(null); setSuccess(null)
    try {
      const res = await importLichess(lichessUser, lichessMax, lichessPerf || undefined)
      setSuccess(`Imported ${res.data.imported} games from Lichess`)
      onImported?.(res.data.user_id, lichessUser)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCcImport = async () => {
    setLoading(true); setError(null); setSuccess(null)
    try {
      const res = await importChessCom(ccUser, ccMax)
      setSuccess(`Imported ${res.data.imported} games from Chess.com`)
      onImported?.(res.data.user_id, ccUser)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePgnImport = async () => {
    if (!pgnFile) return
    setLoading(true); setError(null); setSuccess(null)
    try {
      const pgnUsername = username || 'player'
      const res = await importPgn(pgnUsername, pgnFile)
      setSuccess(`Imported ${res.data.imported} games from PGN`)
      onImported?.(res.data.user_id, pgnUsername)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-chess-panel rounded-xl p-5 max-w-lg">
      <h2 className="text-lg font-semibold text-chess-gold mb-4">Import Games</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-chess-dark rounded-lg p-1">
        {['lichess', 'chessdotcom', 'pgn'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-chess-accent text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {t === 'lichess' ? 'Lichess' : t === 'chessdotcom' ? 'Chess.com' : 'PGN'}
          </button>
        ))}
      </div>

      {/* Lichess */}
      {tab === 'lichess' && (
        <div className="space-y-3">
          <input
            value={lichessUser}
            onChange={e => setLichessUser(e.target.value)}
            placeholder="Lichess username"
            className="w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold"
          />
          <div className="flex gap-2">
            <input
              type="number" value={lichessMax} min={1} max={200}
              onChange={e => setLichessMax(Number(e.target.value))}
              className="w-24 bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-chess-gold"
            />
            <select
              value={lichessPerf}
              onChange={e => setLichessPerf(e.target.value)}
              className="flex-1 bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-chess-gold"
            >
              <option value="">All time controls</option>
              <option value="bullet">Bullet</option>
              <option value="blitz">Blitz</option>
              <option value="rapid">Rapid</option>
              <option value="classical">Classical</option>
            </select>
          </div>
          <button
            onClick={handleLichessImport}
            disabled={loading || !lichessUser}
            className="w-full bg-chess-gold text-chess-dark font-semibold py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Importing…' : 'Import from Lichess'}
          </button>
        </div>
      )}

      {/* Chess.com */}
      {tab === 'chessdotcom' && (
        <div className="space-y-3">
          <input
            value={ccUser}
            onChange={e => setCcUser(e.target.value)}
            placeholder="Chess.com username"
            className="w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold"
          />
          <input
            type="number" value={ccMax} min={1} max={200}
            onChange={e => setCcMax(Number(e.target.value))}
            placeholder="Max games"
            className="w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-chess-gold"
          />
          <button
            onClick={handleCcImport}
            disabled={loading || !ccUser}
            className="w-full bg-chess-gold text-chess-dark font-semibold py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Importing…' : 'Import from Chess.com'}
          </button>
        </div>
      )}

      {/* PGN */}
      {tab === 'pgn' && (
        <div className="space-y-3">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-600 rounded-xl p-6 cursor-pointer hover:border-chess-gold transition-colors">
            <Upload size={28} className="text-slate-400 mb-2" />
            <span className="text-sm text-slate-400">
              {pgnFile ? pgnFile.name : 'Click to upload .pgn file'}
            </span>
            <input
              type="file" accept=".pgn" className="hidden"
              onChange={e => setPgnFile(e.target.files[0])}
            />
          </label>
          <button
            onClick={handlePgnImport}
            disabled={loading || !pgnFile}
            className="w-full bg-chess-gold text-chess-dark font-semibold py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Importing…' : 'Import PGN'}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 p-3 bg-green-900/40 border border-green-700 rounded-lg text-green-300 text-sm">
          {success}
        </div>
      )}
    </div>
  )
}
