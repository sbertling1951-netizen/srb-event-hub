'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type AgendaItem = {
  id: string
  title: string
  description: string | null
  location: string | null
  category: string | null
  start_time: string
  end_time: string | null
  sort_order: number | null
  is_published: boolean
}

type ActiveEvent = {
  id: string
  name: string
  location: string | null
}

function categoryColor(category?: string | null) {
  const c = (category || '').toLowerCase()
  if (c.includes('meal')) return '#dc2626'
  if (c.includes('seminar')) return '#2563eb'
  if (c.includes('social')) return '#16a34a'
  if (c.includes('tour')) return '#9333ea'
  return '#6b7280'
}

function formatTime(value: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export default function AgendaPage() {
  const router = useRouter()

  const [event, setEvent] = useState<ActiveEvent | null>(null)
  const [items, setItems] = useState<AgendaItem[]>([])
  const [status, setStatus] = useState('Loading agenda...')
  const [nowTime, setNowTime] = useState(new Date())
  const [todayOnly, setTodayOnly] = useState(false)

  useEffect(() => {
    void loadAgenda()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date())
    }, 30000)

    return () => clearInterval(timer)
  }, [])

  async function loadAgenda() {
    setStatus('Loading agenda...')

    const { data: activeEvent, error: eventError } = await supabase
      .from('events')
      .select('id,name,location')
      .eq('is_active', true)
      .single()

    if (eventError || !activeEvent) {
      setStatus(`Could not load active event: ${eventError?.message || 'No active event found.'}`)
      return
    }

    setEvent(activeEvent)

    const { data, error } = await supabase
      .from('agenda_items')
      .select('id,title,description,location,category,start_time,end_time,sort_order,is_published')
      .eq('event_id', activeEvent.id)
      .eq('is_published', true)
      .order('start_time', { ascending: true })
      .order('sort_order', { ascending: true })

    if (error) {
      setStatus(`Could not load agenda items: ${error.message}`)
      return
    }

    setItems((data || []) as AgendaItem[])
    setStatus(`Loaded ${(data || []).length} agenda items.`)
  }

  const nowItem = useMemo(() => {
    const nowMs = nowTime.getTime()

    return (
      items.find((item) => {
        const startMs = new Date(item.start_time).getTime()
        const endMs = item.end_time
          ? new Date(item.end_time).getTime()
          : startMs + 60 * 60 * 1000

        return nowMs >= startMs && nowMs <= endMs
      }) || null
    )
  }, [items, nowTime])

  const nextItem = useMemo(() => {
    const nowMs = nowTime.getTime()

    return (
      items.find((item) => {
        const startMs = new Date(item.start_time).getTime()
        return startMs > nowMs
      }) || null
    )
  }, [items, nowTime])

  const visibleItems = useMemo(() => {
    if (!todayOnly) return items
    return items.filter((item) => isSameDay(new Date(item.start_time), nowTime))
  }, [items, todayOnly, nowTime])

  const grouped = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()

    for (const item of visibleItems) {
      const dayKey = new Date(item.start_time).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })

      if (!map.has(dayKey)) map.set(dayKey, [])
      map.get(dayKey)!.push(item)
    }

    return Array.from(map.entries())
  }, [visibleItems])

  function openMapForLocation(location: string | null) {
    if (!location) return
    router.push(`/nearby?location=${encodeURIComponent(location)}`)
  }

  function AgendaCard({
    item,
    label,
  }: {
    item: AgendaItem
    label?: string
  }) {
    return (
      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          padding: 16,
        }}
      >
        {label && (
          <div
            style={{
              display: 'inline-block',
              marginBottom: 8,
              padding: '4px 8px',
              borderRadius: 999,
              background: '#111827',
              color: 'white',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {label}
          </div>
        )}

        <div style={{ fontWeight: 700, fontSize: 18 }}>{item.title}</div>

        <div style={{ fontSize: 14, color: '#555', marginTop: 4 }}>
          {formatTime(item.start_time)}
          {item.end_time ? ` – ${formatTime(item.end_time)}` : ''}
        </div>

        {item.category && (
          <div style={{ marginTop: 8 }}>
            <span
              style={{
                display: 'inline-block',
                padding: '3px 8px',
                borderRadius: 999,
                background: categoryColor(item.category),
                color: 'white',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {item.category}
            </span>
          </div>
        )}

        {item.location && (
          <div style={{ fontSize: 13, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => openMapForLocation(item.location)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#0b5cff',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              📍 {item.location}
            </button>
          </div>
        )}

        {item.description && (
          <div style={{ marginTop: 10, color: '#333' }}>
            {item.description}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Agenda</h1>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: '#f8f9fb',
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700 }}>{event?.name || 'No active event'}</div>
        <div style={{ color: '#555' }}>{event?.location || ''}</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>{status}</div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => setTodayOnly(e.target.checked)}
          />
          Today only
        </label>

        {todayOnly && (
          <button type="button" onClick={() => setTodayOnly(false)}>
            Show all days
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {nowItem ? (
          <AgendaCard item={nowItem} label="NOW" />
        ) : (
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 10,
              background: 'white',
              padding: 16,
            }}
          >
            <div
              style={{
                display: 'inline-block',
                marginBottom: 8,
                padding: '4px 8px',
                borderRadius: 999,
                background: '#111827',
                color: 'white',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              NOW
            </div>
            <div style={{ color: '#555' }}>No session is in progress right now.</div>
          </div>
        )}

        {nextItem ? (
          <AgendaCard item={nextItem} label="NEXT" />
        ) : (
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 10,
              background: 'white',
              padding: 16,
            }}
          >
            <div
              style={{
                display: 'inline-block',
                marginBottom: 8,
                padding: '4px 8px',
                borderRadius: 999,
                background: '#111827',
                color: 'white',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              NEXT
            </div>
            <div style={{ color: '#555' }}>No upcoming sessions are scheduled.</div>
          </div>
        )}
      </div>

      {grouped.length === 0 && (
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 10,
            background: 'white',
            padding: 18,
          }}
        >
          {todayOnly ? 'No agenda items scheduled for today.' : 'No agenda items published yet.'}
        </div>
      )}

      {grouped.map(([day, dayItems]) => {
        const today = isSameDay(new Date(dayItems[0].start_time), nowTime)

        return (
          <div key={day} style={{ marginBottom: 24 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                marginBottom: 10,
              }}
            >
              <h2 style={{ margin: 0 }}>{day}</h2>
              {today && (
                <span
                  style={{
                    display: 'inline-block',
                    padding: '4px 8px',
                    borderRadius: 999,
                    background: '#0b5cff',
                    color: 'white',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Today
                </span>
              )}
            </div>

            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 10,
                background: 'white',
                overflow: 'hidden',
              }}
            >
              {dayItems.map((item, index) => {
                const isNow = nowItem?.id === item.id

                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '150px 1fr',
                      gap: 16,
                      padding: 16,
                      borderTop: index === 0 ? 'none' : '1px solid #eee',
                      background: isNow ? '#fff7d6' : 'white',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {formatTime(item.start_time)}
                      {item.end_time ? ` – ${formatTime(item.end_time)}` : ''}
                    </div>

                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{item.title}</div>

                        {isNow && (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: 999,
                              background: '#111827',
                              color: 'white',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            Now
                          </span>
                        )}

                        {item.category && (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: 999,
                              background: categoryColor(item.category),
                              color: 'white',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {item.category}
                          </span>
                        )}
                      </div>

                      {item.location && (
                        <div style={{ fontSize: 13, marginTop: 6 }}>
                          <button
                            type="button"
                            onClick={() => openMapForLocation(item.location)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: '#0b5cff',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              fontSize: 13,
                            }}
                          >
                            📍 {item.location}
                          </button>
                        </div>
                      )}

                      {item.description && (
                        <div style={{ marginTop: 8, color: '#333' }}>
                          {item.description}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
