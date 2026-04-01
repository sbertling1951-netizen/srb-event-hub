  	'use client'

import { supabase } from '@/lib/supabase'

export default function ExportPage() {
  async function exportAttendees() {
    const { data: event } = await supabase
      .from('events')
      .select('id')
      .eq('is_active', true)
      .single()

    const { data } = await supabase
      .from('attendees')
      .select('*')
      .eq('event_id', event.id)

    const csv = [
      Object.keys(data[0]).join(','),
      ...data.map((r) => Object.values(r).join(',')),
    ].join('\n')

    const blob = new Blob([csv])
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = 'attendees.csv'
    a.click()
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Export</h1>
      <button onClick={exportAttendees}>Export Attendees</button>
    </div>
  )
}
