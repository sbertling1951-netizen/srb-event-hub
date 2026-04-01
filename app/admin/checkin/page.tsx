'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function CheckInPage() {
  const [stats, setStats] = useState({
    totalSites: 0,
    occupiedSites: 0,
    openSites: 0,
    totalAttendees: 0,
    arrived: 0,
    parked: 0,
    notArrived: 0,
  })
  const [eventName, setEventName] = useState('')

  useEffect(() => {
    void loadDashboard()
    const timer = setInterval(() => {
      void loadDashboard()
    }, 15000)

    return () => clearInterval(timer)
  }, [])

  async function loadDashboard() {
    const { data: activeEvent } = await supabase
      .from('events')
      .select('id,name')
      .eq('is_active', true)
      .single()

    if (!activeEvent) return

    setEventName(activeEvent.name)

    const { data: sites } = await supabase
      .from('parking_sites')
      .select('id,assigned_attendee_id')
      .eq('event_id', activeEvent.id)

    const { data: attendees } = await supabase
      .from('attendees')
      .select('id,arrival_status')
      .eq('event_id', activeEvent.id)

    const totalSites = (sites || []).length
    const occupiedSites = (sites || []).filter((s) => !!s.assigned_attendee_id).length
    const openSites = totalSites - occupiedSites

    const totalAttendees = (attendees || []).length
    const arrived = (attendees || []).filter((a) => a.arrival_status === 'arrived').length
    const parked = (attendees || []).filter((a) => a.arrival_status === 'parked').length
    const notArrived = totalAttendees - arrived - parked

    setStats({
      totalSites,
      occupiedSites,
      openSites,
      totalAttendees,
      arrived,
      parked,
      notArrived,
    })
  }

  function Card({ title, value }: { title: string; value: number }) {
    return (
      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          padding: 20,
          background: 'white',
        }}
      >
        <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 32, fontWeight: 700 }}>{value}</div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Live Parking Dashboard</h1>
      <div style={{ color: '#555', marginBottom: 20 }}>{eventName}</div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))',
          gap: 16,
        }}
      >
        <Card title="Total Sites" value={stats.totalSites} />
        <Card title="Occupied Sites" value={stats.occupiedSites} />
        <Card title="Open Sites" value={stats.openSites} />
        <Card title="Total Attendees" value={stats.totalAttendees} />
        <Card title="Arrived" value={stats.arrived} />
        <Card title="Parked" value={stats.parked} />
      </div>

      <div style={{ marginTop: 16, maxWidth: 260 }}>
        <Card title="Not Arrived" value={stats.notArrived} />
      </div>
    </div>
  )
}
