'use client'

import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { getActiveEvent } from '@/lib/getActiveEvent'

type CsvRow = Record<string, string | undefined>

type ActiveEventRow = {
  id: string
  name: string
  location: string | null
  start_date: string | null
  end_date: string | null
  map_image_url: string | null
  master_map_id: string | null
}

function yesNoToBool(value?: string) {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === 'yes' || v === 'y' || v === 'true' || v === '1'
}

function shareFieldToBool(value?: string) {
  if (!value) return false
  const v = value.trim().toLowerCase()
  if (v.includes('yes')) return true
  if (v.includes('share')) return true
  if (v.includes("don't share")) return false
  if (v.includes('do not share')) return false
  if (v.includes('no')) return false
  return false
}

function getField(row: CsvRow, names: string[]) {
  for (const name of names) {
    const value = row[name]
    if (value !== undefined) return value
  }
  return undefined
}

export default function ImportsPage() {
  const [status, setStatus] = useState('No file selected')
  const [busy, setBusy] = useState(false)
  const [activeEvent, setActiveEvent] = useState<ActiveEventRow | null>(null)

  async function loadActiveEventData() {
    const event = await getActiveEvent()
    setActiveEvent(event)
  }

  useEffect(() => {
    void loadActiveEventData()

    function handleStorage(e: StorageEvent) {
      if (e.key === 'fcoc-active-event-changed') {
        void loadActiveEventData()
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  async function handleFile(file: File) {
    if (!activeEvent) {
      setStatus('No active event found. Activate an event first in Admin Events.')
      return
    }

    setBusy(true)
    setStatus(`Reading file for active event: ${activeEvent.name}`)

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
      complete: async (results) => {
        try {
          const rows = results.data || []
          setStatus(`Parsed ${rows.length} rows for ${activeEvent.name}`)

          if (rows.length === 0) {
            setStatus('No rows found in file.')
            setBusy(false)
            return
          }

          const seenEntryIds = new Set<string>()
          let processed = 0

          for (const row of rows) {
            const entryId =
              getField(row, ['Entry Id', 'Entry ID', 'Entry id'])?.trim()

            if (!entryId) continue

            seenEntryIds.add(entryId)

            const attendeePayload = {
              event_id: activeEvent.id,
              entry_id: entryId,
              membership_number: getField(row, ['FCOC Membership Number'])?.trim() || null,
              pilot_first: getField(row, ['Pilot Name (First)'])?.trim() || null,
              pilot_last: getField(row, ['Pilot Name (Last)'])?.trim() || null,
              copilot_first: getField(row, ['Co-Pilot Name (First)'])?.trim() || null,
              copilot_last: getField(row, ['Co-Pilot Name (Last)'])?.trim() || null,
              email: getField(row, ['Email Address'])?.trim() || null,
              phone:
                getField(row, ['Cell Phone #'])?.trim() ||
                getField(row, ['Primary Phone #'])?.trim() ||
                null,
              coach_make: getField(row, ['Coach Manufacturer'])?.trim() || null,
              coach_model: getField(row, ['Coach Model'])?.trim() || null,
              coach_length: getField(row, ['Coach Length'])?.trim() || null,
              assigned_site: null,
              first_time: yesNoToBool(getField(row, ['First time at an FCOC event?'])),
              volunteer: yesNoToBool(getField(row, ['Would you like to volunteer to help with the event?'])),
              handicap_parking: yesNoToBool(getField(row, ['Handicap Parking?'])),
              share_with_attendees: shareFieldToBool(
                getField(row, ['Ok to share your email with other attendees?'])
              ),
            }

            const { error } = await supabase
              .from('attendees')
              .upsert(attendeePayload, {
                onConflict: 'event_id,entry_id',
              })

            if (error) {
              throw new Error(`Import failed for Entry Id ${entryId}: ${error.message}`)
            }

            processed += 1
            setStatus(`Syncing ${processed} of ${rows.length} rows into ${activeEvent.name}...`)
          }

          const { data: existingAttendees, error: existingError } = await supabase
            .from('attendees')
            .select('id,entry_id')
            .eq('event_id', activeEvent.id)

          if (existingError) {
            throw new Error(`Could not load existing attendees: ${existingError.message}`)
          }

          const missingIds =
            (existingAttendees || [])
              .filter((a) => a.entry_id && !seenEntryIds.has(a.entry_id))
              .map((a) => a.id)

          if (missingIds.length > 0) {
            const { error: clearAssignmentsError } = await supabase
              .from('parking_sites')
              .update({ assigned_attendee_id: null })
              .in('assigned_attendee_id', missingIds)

            if (clearAssignmentsError) {
              throw new Error(`Could not clear old parking assignments: ${clearAssignmentsError.message}`)
            }

            const { error: deleteMissingError } = await supabase
              .from('attendees')
              .delete()
              .in('id', missingIds)

            if (deleteMissingError) {
              throw new Error(`Could not remove missing attendees: ${deleteMissingError.message}`)
            }
          }

          setStatus(
            `Import sync complete for ${activeEvent.name}. ${processed} rows synced. ${missingIds.length} removed.`
          )
        } catch (err: any) {
          console.error(err)
          setStatus(`Import failed: ${err.message}`)
        } finally {
          setBusy(false)
        }
      },
      error: (error) => {
        console.error(error)
        setBusy(false)
        setStatus(`Parse failed: ${error.message}`)
      },
    })
  }

  return (
    <div style={{ padding: 30 }}>
      <h1>CSV Import</h1>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: '#f8f9fb',
          padding: 14,
          marginBottom: 16,
          maxWidth: 700,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Active event: {activeEvent?.name || 'No active event'}
        </div>

        {activeEvent?.location && (
          <div style={{ color: '#555', marginBottom: 4 }}>
            {activeEvent.location}
          </div>
        )}

        <div style={{ fontSize: 13, color: '#666' }}>
          Imports will sync attendees into the current active live event only.
        </div>
      </div>

      <p>
        Upload the event export. This importer syncs attendees using the Entry Id column.
      </p>

      <input
        type="file"
        accept=".csv,.txt,.tsv"
        disabled={busy || !activeEvent}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />

      <div style={{ marginTop: 20 }}>
        <strong>Status:</strong> {status}
      </div>
    </div>
  )
}
