'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

type Attendee = {
  id: string
  membership_number: string | null
  pilot_first: string | null
  pilot_last: string | null
  copilot_first: string | null
  copilot_last: string | null
  email: string | null
  phone: string | null
  coach_make: string | null
  coach_model: string | null
  coach_length: string | null
  assigned_site: string | null
  actual_site: string | null
  first_time: boolean | null
  volunteer: boolean | null
  handicap_parking: boolean | null
}

function fullName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(' ').trim()
}

export default function AttendeeProfilePage() {
  const params = useParams()
  const attendeeId = params?.id as string

  const [attendee, setAttendee] = useState<Attendee | null>(null)
  const [status, setStatus] = useState('Loading attendee...')

  useEffect(() => {
    async function loadAttendee() {
      const { data, error } = await supabase
        .from('attendees')
        .select(`
          id,
          membership_number,
          pilot_first,
          pilot_last,
          copilot_first,
          copilot_last,
          email,
          phone,
          coach_make,
          coach_model,
          coach_length,
          assigned_site,
          actual_site,
          first_time,
          volunteer,
          handicap_parking
        `)
        .eq('id', attendeeId)
        .single()

      if (error) {
        setStatus(`Could not load attendee: ${error.message}`)
        return
      }

      setAttendee(data)
      setStatus('Loaded')
    }

    if (attendeeId) {
      void loadAttendee()
    }
  }, [attendeeId])

  if (!attendee) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Attendee Profile</h1>
        <p>{status}</p>
      </div>
    )
  }

  const pilotName = fullName(attendee.pilot_first, attendee.pilot_last)
  const copilotName = fullName(attendee.copilot_first, attendee.copilot_last)
  const displayedSite = attendee.actual_site || attendee.assigned_site || 'Not provided'

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ marginTop: 0 }}>{pilotName || 'Attendee Profile'}</h1>

      <div
        style={{
          border: '1px solid var(--fcoc-border)',
          borderRadius: 10,
          padding: 18,
          background: 'white',
        }}
      >
        {copilotName && (
          <p>
            <strong>Co-Pilot:</strong> {copilotName}
          </p>
        )}

        {attendee.membership_number && (
          <p>
            <strong>Member #:</strong> {attendee.membership_number}
          </p>
        )}

        <p>
          <strong>Site:</strong> {displayedSite}
        </p>

        {(attendee.coach_make || attendee.coach_model || attendee.coach_length) && (
          <p>
            <strong>Coach:</strong>{' '}
            {[attendee.coach_make, attendee.coach_model, attendee.coach_length]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}

        {attendee.email && (
          <p>
            <strong>Email:</strong> {attendee.email}
          </p>
        )}

        {attendee.phone && (
          <p>
            <strong>Phone:</strong> {attendee.phone}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {attendee.first_time ? (
            <span
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                background: '#eef6ff',
              }}
            >
              First Timer
            </span>
          ) : null}

          {attendee.volunteer ? (
            <span
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                background: '#eefaf0',
              }}
            >
              Volunteer
            </span>
          ) : null}

          {attendee.handicap_parking ? (
            <span
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                background: '#fff6e8',
              }}
            >
              Handicap Parking
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
