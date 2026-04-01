'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getActiveEvent } from '@/lib/getActiveEvent'

type Attendee = {
  id: string
  pilot_first: string | null
  pilot_last: string | null
  copilot_first: string | null
  copilot_last: string | null
  email: string | null
  phone: string | null
  coach_make: string | null
  coach_model: string | null
  coach_length: string | null
  first_time: boolean | null
  volunteer: boolean | null
  handicap_parking: boolean | null
  assigned_site: string | null
}

type ActiveEventRow = {
  id: string
  name: string
  location: string | null
  start_date: string | null
  end_date: string | null
  map_image_url: string | null
  master_map_id: string | null
}

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed attendee'
}

function yesNo(value?: boolean | null) {
  return value ? 'Yes' : 'No'
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return ''
  if (startDate && endDate) return `${startDate} – ${endDate}`
  return startDate || endDate || ''
}

export default function AttendeesPage() {
  const [event, setEvent] = useState<ActiveEventRow | null>(null)
  const [eventId, setEventId] = useState<string | null>(null)
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Loading attendees...')

  async function loadActiveEventData() {
    const activeEvent = await getActiveEvent()

    if (!activeEvent) {
      setEvent(null)
      setEventId(null)
      setAttendees([])
      setStatus('No active event found.')
      return
    }

    setEvent(activeEvent)
    setEventId(activeEvent.id)
  }

  async function loadAttendees(activeEventId: string) {
    const { data, error } = await supabase
      .from('attendees')
      .select(
        'id,pilot_first,pilot_last,copilot_first,copilot_last,email,phone,coach_make,coach_model,coach_length,first_time,volunteer,handicap_parking,assigned_site'
      )
      .eq('event_id', activeEventId)
      .order('pilot_last', { ascending: true })

    if (error) {
      setStatus(`Could not load attendees: ${error.message}`)
      return
    }

    setAttendees((data || []) as Attendee[])
    setStatus(`Loaded ${(data || []).length} attendees.`)
  }

  useEffect(() => {
    async function init() {
      setStatus('Loading active event...')
      await loadActiveEventData()
    }

    void init()

    function handleStorage(e: StorageEvent) {
      if (e.key === 'fcoc-active-event-changed') {
        void loadActiveEventData()
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    if (eventId) {
      void loadAttendees(eventId)
    }
  }, [eventId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return attendees

    return attendees.filter((a) => {
      const pilot = fullName(a.pilot_first, a.pilot_last).toLowerCase()
      const copilot = fullName(a.copilot_first, a.copilot_last).toLowerCase()
      const coach = [a.coach_make, a.coach_model].filter(Boolean).join(' ').toLowerCase()
      const site = (a.assigned_site || '').toLowerCase()

      return (
        pilot.includes(q) ||
        copilot.includes(q) ||
        coach.includes(q) ||
        site.includes(q)
      )
    })
  }, [attendees, search])

  const dateRange = formatDateRange(event?.start_date || null, event?.end_date || null)

  return (
    <div style={{ padding: 24 }}>
      <h1>Attendee Locator</h1>
      <p>Search the active event attendee list by name, coach, or site.</p>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: '#f8f9fb',
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Current event: {event?.name || 'No active event'}
        </div>

        {event?.location && (
          <div style={{ marginBottom: 4, color: '#555' }}>
            {event.location}
          </div>
        )}

        {dateRange && (
          <div style={{ marginBottom: 4, fontSize: 13, color: '#666' }}>
            {dateRange}
          </div>
        )}

        <div style={{ fontSize: 13, color: '#555' }}>
          Status: {status}
        </div>
      </div>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          padding: 12,
          marginBottom: 16,
          maxWidth: 420,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Search</div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, coach, or site"
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: '#555' }}>
        Showing {filtered.length} attendee{filtered.length === 1 ? '' : 's'}.
      </div>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.3fr 1.3fr 1fr 0.9fr 0.8fr 0.8fr 0.8fr',
            gap: 12,
            padding: 12,
            fontWeight: 700,
            borderBottom: '1px solid #eee',
          }}
        >
          <div>Pilot</div>
          <div>Co-Pilot</div>
          <div>Coach</div>
          <div>Site</div>
          <div>1st Time</div>
          <div>Volunteer</div>
          <div>Handicap</div>
        </div>

        {filtered.map((a) => (
          <div
            key={a.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.3fr 1.3fr 1fr 0.9fr 0.8fr 0.8fr 0.8fr',
              gap: 12,
              padding: 12,
              borderBottom: '1px solid #eee',
              alignItems: 'start',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {fullName(a.pilot_first, a.pilot_last)}
              </div>
              {a.email && <div style={{ fontSize: 12, color: '#666' }}>{a.email}</div>}
              {a.phone && <div style={{ fontSize: 12, color: '#666' }}>{a.phone}</div>}
            </div>

            <div>
              <div>{fullName(a.copilot_first, a.copilot_last)}</div>
            </div>

            <div>
              {[a.coach_make, a.coach_model].filter(Boolean).join(' ') || '—'}
              {a.coach_length && (
                <div style={{ fontSize: 12, color: '#666' }}>{a.coach_length} ft</div>
              )}
            </div>

            <div>{a.assigned_site || '—'}</div>
            <div>{yesNo(a.first_time)}</div>
            <div>{yesNo(a.volunteer)}</div>
            <div>{yesNo(a.handicap_parking)}</div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: 14, color: '#666' }}>
            No attendees found.
          </div>
        )}
      </div>
    </div>
  )
}
