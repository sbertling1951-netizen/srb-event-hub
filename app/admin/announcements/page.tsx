'use client'

import { useEffect, useState } from 'react'
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
}

function toLocalInputValue(value: string | null) {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

export default function AdminAnnouncementsPage() {
  const [event, setEvent] = useState<ActiveEvent | null>(null)
  const [items, setItems] = useState<Announcement[]>([])
  const [status, setStatus] = useState('Loading...')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isImportant, setIsImportant] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [isPublished, setIsPublished] = useState(true)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')

  useEffect(() => {
    void loadPage()
  }, [])

  async function loadPage() {
    setStatus('Loading...')

    const { data: activeEvent, error: eventError } = await supabase
      .from('events')
      .select('id,name')
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
      .order('is_important', { ascending: false })
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false })

    if (error) {
      setStatus(`Could not load announcements: ${error.message}`)
      return
    }

    setItems((data || []) as Announcement[])
    setStatus(`Loaded ${(data || []).length} announcements.`)
  }

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setBody('')
    setIsImportant(false)
    setIsPinned(false)
    setIsPublished(true)
    setStartsAt('')
    setEndsAt('')
  }

  function loadIntoForm(item: Announcement) {
    setEditingId(item.id)
    setTitle(item.title)
    setBody(item.body || '')
    setIsImportant(!!item.is_important)
    setIsPinned(!!item.is_pinned)
    setIsPublished(item.is_published !== false)
    setStartsAt(toLocalInputValue(item.starts_at))
    setEndsAt(toLocalInputValue(item.ends_at))
  }

  async function saveAnnouncement() {
    if (!event?.id || !title.trim()) {
      setStatus('Title is required.')
      return
    }

    const payload = {
      event_id: event.id,
      title: title.trim(),
      body: body.trim() || null,
      is_important: isImportant,
      is_pinned: isPinned,
      is_published: isPublished,
      published_at: new Date().toISOString(),
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    }

    if (editingId) {
      const { error } = await supabase
        .from('announcements')
        .update(payload)
        .eq('id', editingId)

      if (error) {
        setStatus(`Could not update announcement: ${error.message}`)
        return
      }

      setStatus('Announcement updated.')
    } else {
      const { error } = await supabase
        .from('announcements')
        .insert(payload)

      if (error) {
        setStatus(`Could not add announcement: ${error.message}`)
        return
      }

      setStatus('Announcement added.')
    }

    resetForm()
    await loadPage()
  }

  async function deleteAnnouncement(id: string) {
    const ok = window.confirm('Delete this announcement?')
    if (!ok) return

    const { error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', id)

    if (error) {
      setStatus(`Could not delete announcement: ${error.message}`)
      return
    }

    setStatus('Announcement deleted.')
    if (editingId === id) resetForm()
    await loadPage()
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin Announcements</h1>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          padding: 16,
          display: 'grid',
          gap: 10,
          marginBottom: 20,
          maxWidth: 760,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {event?.name || 'No active event'}
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Announcement title"
          style={{ padding: 8 }}
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Announcement details"
          style={{ padding: 8, minHeight: 120 }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={isImportant}
            onChange={(e) => setIsImportant(e.target.checked)}
          />
          Important
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
          />
          Pinned
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
          />
          Published
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span>Show starting at</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            style={{ padding: 8 }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span>Hide after</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            style={{ padding: 8 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => void saveAnnouncement()}>
            {editingId ? 'Update Announcement' : 'Add Announcement'}
          </button>
          <button onClick={resetForm} type="button">
            Clear Form
          </button>
        </div>

        <div style={{ fontSize: 13, color: '#666' }}>{status}</div>
      </div>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          overflow: 'hidden',
        }}
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: 12,
              padding: 14,
              borderTop: index === 0 ? 'none' : '1px solid #eee',
            }}
          >
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700 }}>{item.title}</div>

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

                {item.is_published === false && (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: '#6b7280',
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Unpublished
                  </span>
                )}
              </div>

              {item.published_at && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  {new Date(item.published_at).toLocaleString()}
                </div>
              )}

              {item.body && (
                <div style={{ fontSize: 13, color: '#333', marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {item.body}
                </div>
              )}
            </div>

            <button onClick={() => loadIntoForm(item)}>Edit</button>
            <button onClick={() => void deleteAnnouncement(item.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}
