import { useState, useRef, useEffect, useCallback } from 'react'

const EXAMPLES = [
  { icon:'📊', text:'Which products appear in the most billing documents?' },
  { icon:'🔍', text:'Trace the full flow of billing document 90504219' },
  { icon:'⚠️', text:'Find sales orders that were delivered but never billed' },
  { icon:'💰', text:'What is the total invoice value per customer?' },
  { icon:'🏭', text:'Which plants handle the most deliveries?' },
  { icon:'📦', text:'List all sales orders with their delivery and invoice status' },
  { icon:'❌', text:'Which invoices have been cancelled?' },
  { icon:'📈', text:'Show the top 5 products by net billing amount' },
]

export default function ChatPanel({ apiBase, selectedNode, onSelectNode }) {
  const [messages, setMessages] = useState([{
    role:'assistant',
    content:'Hello! I can answer questions about your SAP Order-to-Cash data. I have access to sales orders, deliveries, invoices, journal entries, customers, products, and plants.\n\nTry one of the example queries below, or ask anything about the dataset.',
    sql:null, rows:null, blocked:false,
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSql, setShowSql] = useState({})
  const [showTable, setShowTable] = useState({})
  const bottomRef = useRef()
  const inputRef = useRef()
  const firstMsg = messages.length <= 1

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, loading])

  // Auto-fill when node selected from graph
  useEffect(() => {
    if (selectedNode) {
      setInput(`Tell me everything about ${selectedNode.label}`)
    }
  }, [selectedNode])

  const send = useCallback(async (q) => {
    const question = (q || input).trim()
    if (!question || loading) return
    setInput('')
    setMessages(prev => [...prev, { role:'user', content:question }])
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        role:'assistant',
        content: data.answer,
        sql: data.sql,
        rows: data.rows,
        blocked: data.blocked,
        error: data.error,
      }])
    } catch(e) {
      setMessages(prev => [...prev, { role:'assistant', content:`Connection error: ${e.message}`, error:true }])
    }
    setLoading(false)
    inputRef.current?.focus()
  }, [input, loading, apiBase])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--surface)', width:'100%' }}>

      {/* Header */}
      <div style={{
        padding:'12px 18px', borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', gap:10, flexShrink:0,
      }}>
        <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 10px var(--green)' }}/>
        <span style={{ fontWeight:600, fontSize:13 }}>Query Assistant</span>
        <div style={{
          marginLeft:'auto', fontSize:10, color:'var(--text-muted)',
          background:'var(--surface2)', border:'1px solid var(--border)',
          padding:'3px 9px', borderRadius:10,
        }}>Gemini 1.5 Flash · NL→SQL</div>
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:14 }}>
        {messages.map((msg, i) => (
          <Message
            key={i} msg={msg} idx={i}
            showSql={showSql[i]} showTable={showTable[i]}
            onToggleSql={()=>setShowSql(s=>({...s,[i]:!s[i]}))}
            onToggleTable={()=>setShowTable(s=>({...s,[i]:!s[i]}))}
          />
        ))}

        {/* Loading dots */}
        {loading && (
          <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
            <Avatar/>
            <div style={{
              background:'var(--surface2)', border:'1px solid var(--border)',
              borderRadius:'2px 10px 10px 10px', padding:'12px 16px',
              display:'flex', gap:5, alignItems:'center',
            }}>
              {[0,1,2].map(j=>(
                <div key={j} style={{
                  width:7, height:7, borderRadius:'50%', background:'var(--accent)',
                  animation:`bounce 0.7s ${j*0.15}s infinite alternate ease-in-out`,
                }}/>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Example queries */}
      {firstMsg && (
        <div style={{ padding:'0 16px 12px', flexShrink:0 }}>
          <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Example Queries</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
            {EXAMPLES.slice(0,6).map((ex,i)=>(
              <button key={i} onClick={()=>send(ex.text)} style={{
                background:'var(--surface2)', border:'1px solid var(--border)',
                borderRadius:8, padding:'7px 10px', textAlign:'left',
                color:'var(--text-muted)', fontSize:11, display:'flex', gap:6,
                alignItems:'flex-start', lineHeight:1.4, transition:'all 0.15s',
              }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--text)'}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text-muted)'}}>
                <span style={{ flexShrink:0 }}>{ex.icon}</span>
                <span>{ex.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()} }}
            placeholder="Ask about orders, deliveries, invoices…   (Enter to send)"
            rows={2}
            style={{
              flex:1, background:'var(--surface2)',
              border:'1px solid var(--border)',
              borderRadius:9, padding:'9px 13px',
              color:'var(--text)', fontSize:12,
              resize:'none', outline:'none', fontFamily:'inherit', lineHeight:1.5,
              transition:'border-color 0.15s',
            }}
            onFocus={e=>e.target.style.borderColor='var(--accent)'}
            onBlur={e=>e.target.style.borderColor='var(--border)'}
          />
          <button onClick={()=>send()} disabled={loading||!input.trim()} style={{
            width:38, height:38, borderRadius:9, flexShrink:0,
            background: loading||!input.trim() ? 'var(--surface3)' : 'var(--accent)',
            border:'none', color:'#fff', fontSize:16,
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'all 0.15s', boxShadow: !loading&&input.trim() ? '0 0 16px rgba(99,102,241,0.4)' : 'none',
          }}>↑</button>
        </div>
        <div style={{ fontSize:10, color:'var(--text-dim)', marginTop:6, textAlign:'center' }}>
          Powered by Gemini 1.5 Flash · Queries run against live SQLite database
        </div>
      </div>

      <style>{`@keyframes bounce{from{transform:translateY(0)}to{transform:translateY(-6px)}}`}</style>
    </div>
  )
}

function Avatar() {
  return (
    <div style={{
      width:28, height:28, borderRadius:'50%',
      background:'linear-gradient(135deg,#6366f1,#ec4899)',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:11, fontWeight:800, color:'#fff', flexShrink:0,
    }}>G</div>
  )
}

function Message({ msg, idx, showSql, showTable, onToggleSql, onToggleTable }) {
  const isUser = msg.role==='user'
  return (
    <div style={{ display:'flex', gap:10, flexDirection: isUser?'row-reverse':'row', alignItems:'flex-start' }}>
      {!isUser && <Avatar/>}
      <div style={{ maxWidth:'88%', display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{
          background: isUser ? 'var(--accent)' : msg.blocked ? 'rgba(239,68,68,0.08)' : 'var(--surface2)',
          border: msg.blocked ? '1px solid rgba(239,68,68,0.3)' : isUser ? 'none' : '1px solid var(--border)',
          borderRadius: isUser ? '10px 10px 2px 10px' : '2px 10px 10px 10px',
          padding:'10px 14px', fontSize:12.5, lineHeight:1.65,
          color: msg.error||msg.blocked ? '#fca5a5' : 'var(--text)',
          whiteSpace:'pre-wrap',
        }}>
          {msg.content}
        </div>

        {/* SQL / Table toggles */}
        {!isUser && msg.sql && (
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
            <ToggleBtn label={showSql?'Hide SQL':'View SQL'} onClick={onToggleSql} icon="⚡"/>
            {msg.rows?.length>0 && (
              <ToggleBtn label={showTable?'Hide table':`${msg.rows.length} rows`} onClick={onToggleTable} icon="📋"/>
            )}
          </div>
        )}

        {showSql && msg.sql && (
          <div style={{
            background:'#050810', border:'1px solid var(--border)',
            borderRadius:8, padding:'10px 14px', fontSize:11,
            color:'#a5b4fc', overflowX:'auto', lineHeight:1.6,
            fontFamily:'\'Fira Code\',\'Cascadia Code\',monospace',
            whiteSpace:'pre-wrap', wordBreak:'break-all',
          }}>{msg.sql}</div>
        )}

        {showTable && msg.rows?.length>0 && <ResultTable rows={msg.rows}/>}
      </div>
    </div>
  )
}

function ToggleBtn({ label, onClick, icon }) {
  return (
    <button onClick={onClick} style={{
      background:'var(--surface3)', border:'1px solid var(--border)',
      borderRadius:6, padding:'3px 9px', fontSize:11,
      color:'var(--text-muted)', display:'flex', gap:4, alignItems:'center',
      transition:'all 0.15s',
    }}
    onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
    onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
      {icon && <span>{icon}</span>}{label}
    </button>
  )
}

function ResultTable({ rows }) {
  if (!rows?.length) return null
  const cols = Object.keys(rows[0]).slice(0,8)
  return (
    <div style={{ overflowX:'auto', borderRadius:8, border:'1px solid var(--border)', fontSize:11 }}>
      <table style={{ borderCollapse:'collapse', minWidth:'100%' }}>
        <thead>
          <tr style={{ background:'var(--surface3)' }}>
            {cols.map(c=>(
              <th key={c} style={{
                padding:'6px 12px', textAlign:'left',
                color:'var(--text-muted)', fontWeight:600,
                borderBottom:'1px solid var(--border)', whiteSpace:'nowrap',
                letterSpacing:'0.03em', fontSize:10, textTransform:'uppercase',
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0,20).map((row,i)=>(
            <tr key={i} style={{
              borderBottom:'1px solid var(--border)',
              background: i%2===0?'transparent':'rgba(255,255,255,0.015)',
            }}>
              {cols.map(c=>(
                <td key={c} style={{
                  padding:'6px 12px', color:'var(--text)',
                  maxWidth:140, overflow:'hidden',
                  whiteSpace:'nowrap', textOverflow:'ellipsis',
                }}>{row[c]==null?'—':String(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length>20 && (
        <div style={{ padding:'5px 12px', color:'var(--text-muted)', fontSize:11, borderTop:'1px solid var(--border)' }}>
          + {rows.length-20} more rows
        </div>
      )}
    </div>
  )
}
