'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type EventRow = {
  id: string
  name: string
  location: string | null
  start_date: string | null
  end_date: string | null
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return ''
  if (startDate && endDate) return `${startDate} – ${endDate}`
  return startDate || endDate || ''
}

export default function EventBanner() {
  const [event, setEvent] = useState<EventRow | null>(null)

  async function loadActiveEvent() {
    const { data, error } = await supabase
      .from('events')
      .select('id,name,location,start_date,end_date')
      .eq('is_active', true)
      .eq('is_master_map', false)
      .order('start_date', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('Could not load active event:', error.message)
      return
    }

    setEvent(data || null)
  }

  useEffect(() => {
    void loadActiveEvent()

    const intervalId = window.setInterval(() => {
      void loadActiveEvent()
    }, 3000)

    function handleFocus() {
      void loadActiveEvent()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void loadActiveEvent()
      }
    }

    function handleStorage(e: StorageEvent) {
      if (e.key === 'fcoc-active-event-changed') {
        void loadActiveEvent()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  if (!event) return null

  const dateRange = formatDateRange(event.start_date, event.end_date)

  return (
    <div
      style={{
        padding: '14px 24px',
        borderBottom: '1px solid #ddd',
        background: '#fafafa',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 18 }}>
        {event.name}
      </div>

      {event.location && (
        <div style={{ fontSize: 14, color: '#666' }}>
          {event.location}
        </div>
      )}

      {dateRange && (
        <div style={{ fontSize: 13, color: '#888' }}>
          {dateRange}
        </div>
      )}
    </div>
  )
}
