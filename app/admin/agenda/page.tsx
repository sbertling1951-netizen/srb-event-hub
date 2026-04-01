'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type AgendaItem = {
  id: string
  title: string
  description: string | null
  location: string | null
  category: string | null
  start_time: string
  end_time: string | null
  sort_order: number
  is_published: boolean
}

export default function AdminAgendaPage() {
  const [eventId, setEventId] = useState<string>('')
  const [items, setItems] = useState<AgendaItem[]>([])
  const [status, setStatus] = useState('Loading...')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

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

    setEventId(activeEvent.id)

    const { data, error } = await supabase
      .from('agenda_items')
      .select('id,title,description,location,category,start_time,end_time,sort_order,is_published')
      .eq('event_id', activeEvent.id)
      .order('start_time', { ascending: true })
      .order('sort_order', { ascending: true })

    if (error) {
      setStatus(`Could not load agenda items: ${error.message}`)
      return
    }

    setItems((data || []) as AgendaItem[])
    setStatus(`Loaded ${(data || []).length} items.`)
  }

  async function addItem() {
    if (!eventId || !title.trim() || !startTime) {
      setStatus('Title and start time are required.')
      return
    }

    const { error } = await supabase
      .from('agenda_items')
      .insert({
        event_id: eventId,
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        category: category.trim() || null,
        start_time: new Date(startTime).toISOString(),
        end_time: endTime ? new Date(endTime).toISOString() : null,
        is_published: true,
      })

    if (error) {
      setStatus(`Could not add agenda item: ${error.message}`)
      return
    }

    setTitle('')
    setDescription('')
    setLocation('')
    setCategory('')
    setStartTime('')
    setEndTime('')

    setStatus('Agenda item added.')
    await loadPage()
  }

  async function deleteItem(id: string) {
    const { error } = await supabase
      .from('agenda_items')
      .delete()
      .eq('id', id)

    if (error) {
      setStatus(`Could not delete agenda item: ${error.message}`)
      return
    }

    setStatus('Agenda item deleted.')
    await loadPage()
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin Agenda</h1>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          padding: 16,
          display: 'grid',
          gap: 10,
          marginBottom: 20,
          maxWidth: 700,
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ padding: 8 }} />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" style={{ padding: 8 }} />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" style={{ padding: 8 }} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" style={{ padding: 8, minHeight: 90 }} />
        <label>
          Start Time
          <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ padding: 8, display: 'block', width: '100%' }} />
        </label>
        <label>
          End Time
          <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ padding: 8, display: 'block', width: '100%' }} />
        </label>

        <button onClick={() => void addItem()}>Add Agenda Item</button>

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
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 12,
              padding: 14,
              borderTop: '1px solid #eee',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: '#555' }}>
                {new Date(item.start_time).toLocaleString()}
              </div>
              {item.location && <div style={{ fontSize: 13 }}>{item.location}</div>}
            </div>

            <button onClick={() => void deleteItem(item.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}
