'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type EventRow = {
  id: string
  name: string
  location: string | null
  map_image_url: string | null
  coach_map_open_scale: number | null
}

type SiteRow = {
  id: string
  event_id: string
  site_number: string
  display_label: string | null
  map_x: number | null
  map_y: number | null
  assigned_attendee_id: string | null
}

type AttendeeRow = {
  id: string
  event_id: string
  pilot_first: string | null
  pilot_last: string | null
  coach_make: string | null
  coach_model: string | null
  arrival_status: string | null
}

type PinchState = {
  startDistance: number
  startZoom: number
  contentX: number
  contentY: number
}

export default function PublicCoachMapPage() {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(0.6)
  const pinchRef = useRef<PinchState | null>(null)

  const [event, setEvent] = useState<EventRow | null>(null)
  const [sites, setSites] = useState<SiteRow[]>([])
  const [attendees, setAttendees] = useState<AttendeeRow[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Loading map...')
  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 })
	const [defaultZoom, setDefaultZoom] = useState(0.75)
	const [zoom, setZoom] = useState(0.75)
  const [isNarrow, setIsNarrow] = useState(false)

  function clampZoom(next: number) {
    return Math.min(Math.max(next, 0.25), 3)
  }

  function getTouchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  function getTouchMidpoint(touches: TouchList) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    }
  }

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < 900)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const el = mapRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) return

      const rect = el.getBoundingClientRect()
      const midpoint = getTouchMidpoint(e.touches)
      const startZoom = zoomRef.current

      const viewportX = midpoint.x - rect.left
      const viewportY = midpoint.y - rect.top

      const contentX = (el.scrollLeft + viewportX) / startZoom
      const contentY = (el.scrollTop + viewportY) / startZoom

      pinchRef.current = {
        startDistance: getTouchDistance(e.touches),
        startZoom,
        contentX,
        contentY,
      }

      e.preventDefault()
    }

    function onTouchMove(e: TouchEvent) {
      const pinch = pinchRef.current
      if (e.touches.length !== 2 || !pinch) return

      const rect = el.getBoundingClientRect()
      const midpoint = getTouchMidpoint(e.touches)
      const currentDistance = getTouchDistance(e.touches)

      const nextZoom = clampZoom(
        pinch.startZoom * (currentDistance / pinch.startDistance)
      )

      const viewportX = midpoint.x - rect.left
      const viewportY = midpoint.y - rect.top

      setZoom(nextZoom)
      zoomRef.current = nextZoom

      const nextLeft = pinch.contentX * nextZoom - viewportX
      const nextTop = pinch.contentY * nextZoom - viewportY

      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, nextLeft)
        el.scrollTop = Math.max(0, nextTop)
      })

      e.preventDefault()
    }

    function onTouchEnd() {
      pinchRef.current = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    el.addEventListener('touchcancel', onTouchEnd, { passive: false })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  useEffect(() => {
    void loadPage()
  }, [])

  useEffect(() => {
    if (!event?.id) return

    const parkingChannel = supabase
      .channel(`public-map-sites-${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'parking_sites' },
        async () => {
          await loadSitesAndAttendees(event.id)
        }
      )
      .subscribe()

    const attendeesChannel = supabase
      .channel(`public-map-attendees-${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendees' },
        async () => {
          await loadSitesAndAttendees(event.id)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(parkingChannel)
      void supabase.removeChannel(attendeesChannel)
    }
  }, [event?.id])

  async function loadPage() {
    setStatus('Loading map...')

    const { data: activeEvent, error: eventError } = await supabase
      .from('events')
      .select('id,name,location,map_image_url,coach_map_open_scale')
      .eq('is_active', true)
      .single()

    if (eventError || !activeEvent) {
      setStatus(`Could not load active event: ${eventError?.message || 'No active event found.'}`)
      return
    }

    const typedEvent = activeEvent as EventRow
    setEvent(typedEvent)

    const openingScale = Number(typedEvent.coach_map_open_scale ?? 0.6)
    const safeOpeningScale = Number.isNaN(openingScale) ? 0.6 : clampZoom(openingScale)
    setDefaultZoom(safeOpeningScale)
    setZoom(safeOpeningScale)

    await loadSitesAndAttendees(typedEvent.id)
  }

  async function loadSitesAndAttendees(eventId: string) {
    const { data: siteData, error: siteError } = await supabase
      .from('parking_sites')
      .select('id,event_id,site_number,display_label,map_x,map_y,assigned_attendee_id')
      .eq('event_id', eventId)

    if (siteError) {
      setStatus(`Could not load sites: ${siteError.message}`)
      return
    }

    const { data: attendeeData, error: attendeeError } = await supabase
      .from('attendees')
      .select('id,event_id,pilot_first,pilot_last,coach_make,coach_model,arrival_status')
      .eq('event_id', eventId)

    if (attendeeError) {
      setStatus(`Could not load attendees: ${attendeeError.message}`)
      return
    }

    setSites((siteData || []) as SiteRow[])
    setAttendees((attendeeData || []) as AttendeeRow[])
    setStatus(`Live · ${(siteData || []).length} sites`)
  }

  const attendeeById = useMemo(() => {
    const map = new Map<string, AttendeeRow>()
    for (const attendee of attendees) {
      map.set(attendee.id, attendee)
    }
    return map
  }, [attendees])

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sites

    return sites.filter((site) => {
      const occupant = site.assigned_attendee_id
        ? attendeeById.get(site.assigned_attendee_id)
        : null

      const siteText = `${site.site_number} ${site.display_label || ''}`.toLowerCase()
      const nameText = occupant
        ? `${occupant.pilot_first || ''} ${occupant.pilot_last || ''}`.toLowerCase()
        : ''
      const coachText = occupant
        ? `${occupant.coach_make || ''} ${occupant.coach_model || ''}`.toLowerCase()
        : ''

      return siteText.includes(q) || nameText.includes(q) || coachText.includes(q)
    })
  }, [sites, attendeeById, search])

  const highlightedSiteIds = useMemo(() => {
    return new Set(filteredSites.map((site) => site.id))
  }, [filteredSites])

  const selectedSite = sites.find((s) => s.id === selectedSiteId) || null
  const selectedOccupant = selectedSite?.assigned_attendee_id
    ? attendeeById.get(selectedSite.assigned_attendee_id) || null
    : null

  function getSiteColor(site: SiteRow) {
    if (site.id === selectedSiteId) return 'gold'
    if (!site.assigned_attendee_id) return 'green'

    const attendee = attendeeById.get(site.assigned_attendee_id)
    const arrivalStatus = attendee?.arrival_status || 'not_arrived'

    if (arrivalStatus === 'parked') return 'red'
    if (arrivalStatus === 'arrived') return 'orange'
    return '#0b5cff'
  }

  function focusSite(site: SiteRow) {
    if (!mapRef.current || site.map_x === null || site.map_y === null) return

    const container = mapRef.current
    const scaledWidth = naturalSize.width * zoomRef.current
    const scaledHeight = naturalSize.height * zoomRef.current

    const x = (site.map_x / 100) * scaledWidth
    const y = (site.map_y / 100) * scaledHeight

    requestAnimationFrame(() => {
      container.scrollTo({
        left: Math.max(0, x - container.clientWidth / 2),
        top: Math.max(0, y - container.clientHeight / 2),
        behavior: 'smooth',
      })
    })
  }

  function handleSiteClick(site: SiteRow) {
    setSelectedSiteId(site.id)
    focusSite(site)
  }

  return (
    <div
      style={{
        paddingTop: isNarrow ? 12 : 24,
        paddingLeft: isNarrow ? 12 : 24,
        paddingRight: isNarrow ? 12 : 24,
        paddingBottom: selectedSite ? 140 : isNarrow ? 12 : 24,
      }}
    >
      <h1 style={{ marginTop: 0 }}>Coach Map</h1>

      <div style={{ color: '#555', marginBottom: 12 }}>
        {event?.name || ''} {event?.location ? `· ${event.location}` : ''}
      </div>

      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        {status}
      </div>

      <input
        type="text"
        placeholder="Search by site, name, or coach"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%',
          padding: 10,
          marginBottom: 10,
          borderRadius: 8,
          border: '1px solid #ddd',
        }}
      />

      <div style={{ fontSize: 12, marginBottom: 10, color: '#444' }}>
        🟢 Open · 🔵 Assigned · 🟠 Arrived · 🔴 Parked
      </div>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          padding: 12,
        }}
      >
        <div
          ref={mapRef}
          style={{
            overflow: 'auto',
            maxHeight: isNarrow ? '62vh' : '78vh',
            border: '1px solid #ddd',
            background: '#f2f2f2',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-x pan-y',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: naturalSize.width * zoom,
              height: naturalSize.height * zoom,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: naturalSize.width,
                height: naturalSize.height,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              {event?.map_image_url && (
                <img
                  src={event.map_image_url}
                  alt="Coach map"
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    setNaturalSize({
                      width: img.naturalWidth || 1200,
                      height: img.naturalHeight || 800,
                    })
                  }}
                  style={{
                    width: naturalSize.width,
                    height: naturalSize.height,
                    display: 'block',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {sites.map((site) => {
                if (site.map_x === null || site.map_y === null) return null

                const highlighted = search.trim() === '' || highlightedSiteIds.has(site.id)

                return (
                  <div
                    key={site.id}
                    style={{
                      position: 'absolute',
                      left: `${site.map_x}%`,
                      top: `${site.map_y}%`,
                      transform: 'translate(-50%, -50%)',
                      opacity: highlighted ? 1 : 0.22,
                      pointerEvents: 'none',
                    }}
                  >
<button
  type="button"
  onClick={() => handleSiteClick(site)}
  style={{
	width: isNarrow ? 46 : 32,
	height: isNarrow ? 46 : 32,
    borderRadius: '50%',
    background: getSiteColor(site),
    border: isNarrow ? '4px solid white' : '3px solid white',
    boxShadow:
      site.id === selectedSiteId
        ? '0 0 0 6px rgba(255,215,0,0.35), 0 2px 6px rgba(0,0,0,0.45)'
        : '0 2px 6px rgba(0,0,0,0.45)',
    cursor: 'pointer',
    padding: 0,
    display: 'block',
    margin: '0 auto',
    pointerEvents: 'auto',
  }}
/>
<div
  style={{
    marginTop: 4,
    marginLeft: 'auto',
    marginRight: 'auto',
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(0,0,0,0.25)',
    borderRadius: 4,
    fontSize: isNarrow ? 12 : 11,
    fontWeight: 700,
    padding: '2px 6px',
    color: '#111',
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    display: 'table',
    pointerEvents: 'none',
  }}
>
  {site.display_label || site.site_number}
</div>                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" onClick={() => setZoom((z) => clampZoom(z - 0.1))}>
            −
          </button>
          <button type="button" onClick={() => setZoom((z) => clampZoom(z + 0.1))}>
            +
          </button>
          <button type="button" onClick={() => setZoom(defaultZoom)}>
            Reset Zoom
          </button>
        </div>
      </div>

      {selectedSite && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 3000,
            background: 'rgba(255,255,255,0.98)',
            backdropFilter: 'blur(6px)',
            borderTop: '1px solid #d6d6d6',
            boxShadow: '0 -6px 16px rgba(0,0,0,0.12)',
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>
              Site {selectedSite.display_label || selectedSite.site_number}
            </div>

            <button
              type="button"
              onClick={() => setSelectedSiteId('')}
              style={{
                border: '1px solid #ccc',
                background: 'white',
                borderRadius: 6,
                padding: '4px 8px',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>

          {selectedOccupant ? (
            <>
              <div style={{ fontWeight: 600, marginTop: 8 }}>
                {selectedOccupant.pilot_first} {selectedOccupant.pilot_last}
              </div>
              <div style={{ color: '#555', marginTop: 4 }}>
                {selectedOccupant.coach_make || ''} {selectedOccupant.coach_model || ''}
              </div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
                Status: {selectedOccupant.arrival_status || 'not_arrived'}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
              Open
            </div>
          )}
        </div>
      )}
    </div>
  )
}
