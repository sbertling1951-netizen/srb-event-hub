'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Announcement = {
  id: string
  title: string
  body: string | null
  is_important: boolean | null
  is_pinned: boolean | null
  is_published: boolean | null
  published_at: string | null
  starts_at: string | null
  ends_at: string | null
}

type ActiveEvent = {
  id: string
  name: string
  location: string | null
}

function isActiveNow(startsAt: string | null, endsAt: string | null) {
  const now = Date.now()
  const startsOk = !startsAt || new Date(startsAt).getTime() <= now
  const endsOk = !endsAt || new Date(endsAt).getTime() >= now
  return startsOk && endsOk
}

export default function AnnouncementsPage() {
  const [event, setEvent] = useState<ActiveEvent | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [status, setStatus] = useState('Loading announcements...')
  const [showImportantOnly, setShowImportantOnly] = useState(false)

  useEffect(() => {
    void loadAnnouncements()
  }, [])

  async function loadAnnouncements() {
    setStatus('Loading announcements...')

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
      .from('announcements')
      .select('id,title,body,is_important,is_pinned,is_published,published_at,starts_at,ends_at')
      .eq('event_id', activeEvent.id)
      .eq('is_published', true)
      .order('is_important', { ascending: false })
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false })

    if (error) {
      setStatus(`Could not load announcements: ${error.message}`)
      return
    }

    setAnnouncements((data || []) as Announcement[])
    setStatus(`Loaded ${(data || []).length} announcements.`)
  }

  function isRecent(value: string | null) {
    if (!value) return false
    return Date.now() - new Date(value).getTime() <= 24 * 60 * 60 * 1000
  }

  const visibleAnnouncements = useMemo(() => {
    let list = announcements.filter((a) => isActiveNow(a.starts_at, a.ends_at))
    if (showImportantOnly) {
      list = list.filter((a) => a.is_important)
    }
    return list
  }, [announcements, showImportantOnly])

  return (
    <div style={{ padding: 24 }}>
      <h1>Announcements</h1>

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
          marginBottom: 16,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={showImportantOnly}
            onChange={(e) => setShowImportantOnly(e.target.checked)}
          />
          Important only
        </label>
      </div>

      {visibleAnnouncements.length === 0 && (
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 10,
            background: 'white',
            padding: 18,
          }}
        >
          No announcements found.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {visibleAnnouncements.map((item) => {
          const recent = isRecent(item.published_at)

          return (
            <div
              key={item.id}
              style={{
                border: item.is_important ? '2px solid #f59e0b' : '1px solid #ddd',
                borderRadius: 10,
                background: 'white',
                padding: 16,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 18 }}>{item.title}</div>

                {item.is_important && (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: '#f59e0b',
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Important
                  </span>
                )}

                {item.is_pinned && (
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
                    Pinned
                  </span>
                )}

                {recent && (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: '#dc2626',
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    NEW
                  </span>
                )}
              </div>

              {item.published_at && (
                <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                  {new Date(item.published_at).toLocaleString()}
                </div>
              )}

              <div style={{ color: '#333', whiteSpace: 'pre-wrap' }}>
                {item.body || ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
