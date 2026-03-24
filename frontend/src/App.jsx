import { useState, useEffect } from 'react'
import GraphPanel from './GraphPanel.jsx'
import ChatPanel from './ChatPanel.jsx'

const API = import.meta.env.VITE_API_URL || ''

const TYPE_META = {
  sales_order:         { color: '#0ea5e9', label: 'Sales Orders' },
  delivery:            { color: '#10b981', label: 'Deliveries' },
  billing_document:    { color: '#6366f1', label: 'Invoices' },
  journal_entry_item:  { color: '#ec4899', label: 'Journal Entries' },
  customer:            { color: '#f59e0b', label: 'Customers' },
  product:             { color: '#ef4444', label: 'Products' },
  plant:               { color: '#84cc16', label: 'Plants' },
  sales_order_item:    { color: '#38bdf8', label: 'SO Items' },
}

export default function App() {
  const [stats, setStats] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [activeTab, setActiveTab] = useState('graph') // graph | chat

  useEffect(() => {
    fetch(`${API}/api/stats`).then(r => r.json()).then(setStats).catch(() => {})
  }, [])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'var(--bg)' }}>

      {/* ── Top bar ── */}
      <header style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
        zIndex: 20,
      }}>
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginRight:8 }}>
          <div style={{
            width:30, height:30, borderRadius:8,
            background:'linear-gradient(135deg,#6366f1,#ec4899)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:13, fontWeight:800, color:'#fff', letterSpacing:'-0.5px',
            boxShadow:'0 0 20px rgba(99,102,241,0.4)',
          }}>O2C</div>
          <div>
            <div style={{ fontWeight:700, fontSize:13, letterSpacing:'-0.3px' }}>SAP Order-to-Cash</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>Graph Intelligence Platform</div>
          </div>
        </div>

        {/* Stats pills */}
        {stats && (
          <div style={{ display:'flex', gap:6, flex:1, flexWrap:'nowrap', overflowX:'auto' }}>
            {Object.entries(stats.by_type || {})
              .filter(([t]) => TYPE_META[t])
              .map(([t, c]) => (
                <StatPill key={t} label={TYPE_META[t]?.label || t} value={c} color={TYPE_META[t]?.color} />
              ))}
          </div>
        )}

        {/* Tab switcher (mobile) */}
        <div style={{
          display:'flex', gap:2, background:'var(--surface2)',
          borderRadius:8, padding:3, marginLeft:'auto',
          border:'1px solid var(--border)',
        }}>
          {['graph','chat'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding:'4px 14px', borderRadius:6, border:'none',
              background: activeTab===tab ? 'var(--accent)' : 'transparent',
              color: activeTab===tab ? '#fff' : 'var(--text-muted)',
              fontWeight:500, fontSize:12, transition:'all 0.15s',
              textTransform:'capitalize',
            }}>{tab}</button>
          ))}
        </div>
      </header>

      {/* ── Main ── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <div style={{
          flex:1, display: activeTab==='graph' ? 'block' : 'none',
          position:'relative',
        }}>
          <GraphPanel apiBase={API} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
        </div>
        <div style={{
          flex:1, display: activeTab==='chat' ? 'flex' : 'none',
          flexDirection:'column',
        }}>
          <ChatPanel apiBase={API} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
        </div>

        {/* Side-by-side on wide screens */}
        <style>{`
          @media (min-width: 900px) {
            .graph-wrap { display: block !important; }
            .chat-wrap  { display: flex !important; }
            .tab-switcher { display: none !important; }
          }
        `}</style>
      </div>
    </div>
  )
}

function StatPill({ label, value, color }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:6,
      background:'var(--surface2)', border:'1px solid var(--border)',
      borderRadius:20, padding:'3px 10px', whiteSpace:'nowrap',
      fontSize:11,
    }}>
      {color && <div style={{ width:6, height:6, borderRadius:'50%', background:color, flexShrink:0 }}/>}
      <span style={{ fontWeight:700, color:'var(--text)' }}>{value}</span>
      <span style={{ color:'var(--text-muted)' }}>{label}</span>
    </div>
  )
}
