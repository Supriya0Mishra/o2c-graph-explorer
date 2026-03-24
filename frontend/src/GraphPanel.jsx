import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const TYPE_LABELS = {
  billing_document:    'Invoice',
  billing_document_item:'Invoice Item',
  sales_order:         'Sales Order',
  sales_order_item:    'SO Item',
  delivery:            'Delivery',
  delivery_item:       'Delivery Item',
  customer:            'Customer',
  product:             'Product',
  plant:               'Plant',
  journal_entry_item:  'Journal Entry',
  payment:             'Payment',
}

const TYPE_COLORS = {
  billing_document:    '#6366f1',
  billing_document_item:'#8b5cf6',
  sales_order:         '#0ea5e9',
  sales_order_item:    '#38bdf8',
  delivery:            '#10b981',
  delivery_item:       '#34d399',
  customer:            '#f59e0b',
  product:             '#ef4444',
  plant:               '#84cc16',
  journal_entry_item:  '#ec4899',
  payment:             '#14b8a6',
}

export default function GraphPanel({ apiBase, selectedNode, onSelectNode }) {
  const fgRef = useRef()
  const containerRef = useRef()
  const [graphData, setGraphData] = useState({ nodes:[], links:[] })
  const [loading, setLoading] = useState(true)
  const [dims, setDims] = useState({ w:800, h:600 })
  const [filter, setFilter] = useState('all')
  const [nodeTypes, setNodeTypes] = useState([])
  const [nodeDetail, setNodeDetail] = useState(null)
  const [hlNodes, setHlNodes] = useState(new Set())
  const [hlLinks, setHlLinks] = useState(new Set())
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch(`${apiBase}/api/graph`).then(r=>r.json()).then(data => {
      setNodeTypes([...new Set(data.nodes.map(n=>n.type))])
      setGraphData({
        nodes: data.nodes,
        links: data.edges.map(e => ({ source:e.source, target:e.target, relation:e.relation }))
      })
      setLoading(false)
    }).catch(()=>setLoading(false))
  }, [apiBase])

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries)
        setDims({ w: e.contentRect.width, h: e.contentRect.height })
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Highlight from external selection (chat panel)
  useEffect(() => {
    if (!selectedNode) { setHlNodes(new Set()); setHlLinks(new Set()); setNodeDetail(null); return }
    highlight(selectedNode)
    setNodeDetail(selectedNode)
    const n = graphData.nodes.find(n=>n.id===selectedNode.id)
    if (n?.x != null && fgRef.current) {
      setTimeout(() => { fgRef.current?.centerAt(n.x, n.y, 600); fgRef.current?.zoom(5, 600) }, 100)
    }
  }, [selectedNode])

  function highlight(node) {
    const hn = new Set([node.id])
    const hl = new Set()
    graphData.links.forEach(l => {
      const sid = typeof l.source==='object' ? l.source.id : l.source
      const tid = typeof l.target==='object' ? l.target.id : l.target
      if (sid===node.id || tid===node.id) { hl.add(l); hn.add(sid); hn.add(tid) }
    })
    setHlNodes(hn); setHlLinks(hl)
  }

  const visData = useMemo(() => {
    let nodes = graphData.nodes
    // Type filter
    if (filter !== 'all') {
      const ids = new Set(nodes.filter(n=>n.type===filter).map(n=>n.id))
      const linkedIds = new Set()
      graphData.links.forEach(l => {
        const sid = typeof l.source==='object'?l.source.id:l.source
        const tid = typeof l.target==='object'?l.target.id:l.target
        if (ids.has(sid)||ids.has(tid)) { linkedIds.add(sid); linkedIds.add(tid) }
      })
      nodes = nodes.filter(n=>linkedIds.has(n.id))
    }
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      const matched = new Set(nodes.filter(n=>
        n.label.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        Object.values(n.meta||{}).some(v=>String(v).toLowerCase().includes(q))
      ).map(n=>n.id))
      nodes = nodes.filter(n=>matched.has(n.id))
    }
    const nodeIds = new Set(nodes.map(n=>n.id))
    return {
      nodes,
      links: graphData.links.filter(l => {
        const sid = typeof l.source==='object'?l.source.id:l.source
        const tid = typeof l.target==='object'?l.target.id:l.target
        return nodeIds.has(sid)&&nodeIds.has(tid)
      })
    }
  }, [graphData, filter, search])

  const handleNodeClick = useCallback(node => {
    setNodeDetail(node); onSelectNode(node); highlight(node)
  }, [graphData, onSelectNode])

  const handleBgClick = useCallback(() => {
    setHlNodes(new Set()); setHlLinks(new Set()); setNodeDetail(null); onSelectNode(null)
  }, [onSelectNode])

  const drawNode = useCallback((node, ctx, scale) => {
    const isHl = hlNodes.size===0 || hlNodes.has(node.id)
    const r = hlNodes.has(node.id) ? 9 : 5
    const alpha = isHl ? 1 : 0.15
    ctx.globalAlpha = alpha

    // Glow for highlighted
    if (hlNodes.has(node.id) && hlNodes.size > 0) {
      ctx.shadowColor = node.color
      ctx.shadowBlur = 20
    }
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, 2*Math.PI)
    ctx.fillStyle = node.color || '#6366f1'
    ctx.fill()
    ctx.shadowBlur = 0

    // Ring for selected node (single)
    if (nodeDetail?.id === node.id) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r+3, 0, 2*Math.PI)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5/scale
      ctx.stroke()
    }

    // Label
    if (scale > 2.5 && isHl) {
      const label = node.label.length > 20 ? node.label.slice(0,18)+'…' : node.label
      const fs = Math.max(2.5, 11/scale)
      ctx.font = `500 ${fs}px Inter`
      ctx.fillStyle = '#e2e8f0'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(label, node.x, node.y+r+2)
    }
    ctx.globalAlpha = 1
  }, [hlNodes, nodeDetail])

  return (
    <div ref={containerRef} style={{ position:'relative', width:'100%', height:'100%', overflow:'hidden' }}>

      {/* Controls bar */}
      <div style={{
        position:'absolute', top:12, left:12, right:12, zIndex:5,
        display:'flex', gap:8, alignItems:'center', flexWrap:'wrap',
      }}>
        {/* Search */}
        <div style={{ position:'relative', flexShrink:0 }}>
          <span style={{
            position:'absolute', left:9, top:'50%', transform:'translateY(-50%)',
            fontSize:12, color:'var(--text-muted)',
          }}>🔍</span>
          <input
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search nodes…"
            style={{
              background:'rgba(15,20,33,0.92)', border:'1px solid var(--border)',
              borderRadius:8, padding:'5px 10px 5px 28px',
              color:'var(--text)', fontSize:12, outline:'none', width:160,
            }}
          />
        </div>

        {/* Type filters */}
        <Chip label="All" active={filter==='all'} onClick={()=>setFilter('all')} color="var(--accent)" />
        {nodeTypes.map(t => (
          <Chip key={t} label={TYPE_LABELS[t]||t} active={filter===t}
            onClick={()=>setFilter(t===filter?'all':t)}
            color={TYPE_COLORS[t]}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{
        position:'absolute', bottom:16, left:16, zIndex:5,
        background:'rgba(10,14,24,0.88)', borderRadius:10,
        border:'1px solid var(--border)', padding:'10px 14px',
        backdropFilter:'blur(8px)',
      }}>
        <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', marginBottom:7, textTransform:'uppercase', letterSpacing:'0.08em' }}>
          Entity Types
        </div>
        {nodeTypes.map(t => (
          <div key={t} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:4 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:TYPE_COLORS[t]||'#94a3b8', flexShrink:0, boxShadow:`0 0 6px ${TYPE_COLORS[t]||'#94a3b8'}88` }}/>
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{TYPE_LABELS[t]||t}</span>
          </div>
        ))}
      </div>

      {/* Graph stats */}
      <div style={{
        position:'absolute', bottom:16, right:nodeDetail?320:16, zIndex:5,
        background:'rgba(10,14,24,0.88)', borderRadius:10,
        border:'1px solid var(--border)', padding:'8px 14px',
        backdropFilter:'blur(8px)', fontSize:11, color:'var(--text-muted)',
        transition:'right 0.25s',
      }}>
        <span style={{ color:'var(--text)', fontWeight:600 }}>{visData.nodes.length}</span> nodes &nbsp;·&nbsp;
        <span style={{ color:'var(--text)', fontWeight:600 }}>{visData.links.length}</span> edges
        {hlNodes.size>0 && <span style={{ marginLeft:8, color:'var(--accent2)' }}>· {hlNodes.size} highlighted</span>}
      </div>

      {loading && (
        <div style={{
          position:'absolute', inset:0, display:'flex', alignItems:'center',
          justifyContent:'center', background:'rgba(8,11,20,0.85)', zIndex:10,
          flexDirection:'column', gap:14,
        }}>
          <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
          <span style={{ color:'var(--text-muted)', fontSize:13 }}>Building knowledge graph…</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      <ForceGraph2D
        ref={fgRef}
        graphData={visData}
        width={dims.w} height={dims.h}
        backgroundColor="#080b14"
        nodeRelSize={5}
        nodeLabel={n=>`${n.label}<br/><span style='color:#8892a4'>${TYPE_LABELS[n.type]||n.type}</span>`}
        nodeCanvasObject={drawNode}
        nodeCanvasObjectMode={()=>'replace'}
        linkColor={l => hlLinks.has(l) ? '#f59e0b' : 'rgba(45,60,94,0.5)'}
        linkWidth={l => hlLinks.has(l) ? 2 : 0.8}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={l => hlLinks.has(l) ? '#f59e0b' : 'rgba(45,60,94,0.6)'}
        linkCurvature={0.2}
        linkLabel={l=>l.relation}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBgClick}
        onNodeHover={n=>{document.body.style.cursor=n?'pointer':'default'}}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {/* Node detail panel */}
      {nodeDetail && (
        <NodeDetail node={nodeDetail} onClose={handleBgClick} />
      )}
    </div>
  )
}

function Chip({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      padding:'4px 12px', borderRadius:20, fontSize:11, fontWeight:500,
      border:`1px solid ${active?(color||'var(--accent)'):'var(--border)'}`,
      background: active ? (color||'var(--accent)')+'22' : 'rgba(10,14,24,0.9)',
      color: active ? (color||'var(--accent2)') : 'var(--text-muted)',
      transition:'all 0.15s', backdropFilter:'blur(4px)',
    }}>{label}</button>
  )
}

function NodeDetail({ node, onClose }) {
  const color = {
    billing_document:'#6366f1', sales_order:'#0ea5e9', delivery:'#10b981',
    customer:'#f59e0b', product:'#ef4444', plant:'#84cc16',
    journal_entry_item:'#ec4899', sales_order_item:'#38bdf8',
  }[node.type] || '#94a3b8'

  return (
    <div style={{
      position:'absolute', top:56, right:12, bottom:56, zIndex:10,
      width:280, background:'var(--surface)',
      border:'1px solid var(--border)', borderRadius:12,
      boxShadow:'0 8px 40px rgba(0,0,0,0.5)',
      display:'flex', flexDirection:'column', overflow:'hidden',
    }}>
      {/* Header */}
      <div style={{ padding:'14px 16px 12px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{
              fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em',
              color, fontWeight:700, marginBottom:5,
              display:'flex', alignItems:'center', gap:5,
            }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:color, boxShadow:`0 0 8px ${color}` }}/>
              {node.type.replace(/_/g,' ')}
            </div>
            <div style={{ fontWeight:700, fontSize:14, lineHeight:1.3 }}>{node.label}</div>
          </div>
          <button onClick={onClose} style={{
            background:'var(--surface2)', border:'1px solid var(--border)',
            borderRadius:6, color:'var(--text-muted)', width:24, height:24,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:14, flexShrink:0,
          }}>×</button>
        </div>
      </div>

      {/* Meta */}
      <div style={{ padding:'12px 16px', overflowY:'auto', flex:1 }}>
        <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>Properties</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {Object.entries(node.meta||{}).filter(([,v])=>v&&v!=='null').map(([k,v])=>(
            <div key={k}>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:2 }}>{k}</div>
              <div style={{ fontSize:12, color:'var(--text)', wordBreak:'break-all', fontFamily: v.length>20?'monospace':'inherit' }}>{String(v)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ fontSize:10, color:'var(--text-dim)', textAlign:'center' }}>
          Click on any connected node to explore
        </div>
      </div>
    </div>
  )
}
