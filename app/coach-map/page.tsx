'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ActiveEvent = {
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
  assigned_site: string | null
  arrival_status: string | null
}

export default function CoachMapPage() {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastDistanceRef = useRef<number | null>(null)

  const [event, setEvent] = useState<ActiveEvent | null>(null)
  const [sites, setSites] = useState<SiteRow[]>([])
  const [attendees, setAttendees] = useState<AttendeeRow[]>([])
  const [selectedSite, setSelectedSite] = useState<SiteRow | null>(null)
  const [search, setSearch] = useState('')
  const [defaultZoom, setDefaultZoom] = useState(0.6)
  const [zoom, setZoom] = useState(0.6)
  const [status, setStatus] = useState('Loading map...')
  const [isNarrow, setIsNarrow] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 })
  const [lastTap, setLastTap] = useState<{ siteId: string; time: number } | null>(null)

  function clampZoom(next: number) {
    return Math.min(Math.max(next, 0.25), 3)
  }

  function getTouchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < 900)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        lastDistanceRef.current = getTouchDistance(e.touches)
        e.preventDefault()
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2) {
        const distance = getTouchDistance(e.touches)

        if (lastDistanceRef.current) {
          const factor = distance / lastDistanceRef.current
          setZoom((z) => clampZoom(z * factor))
        }

        lastDistanceRef.current = distance
        e.preventDefault()
      }
    }

    function onTouchEnd() {
      lastDistanceRef.current = null
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

    const typedEvent = activeEvent as ActiveEvent
    setEvent(typedEvent)

    const openingScale = Number(typedEvent.coach_map_open_scale ?? 0.6)
    const safeOpeningScale = Number.isNaN(openingScale) ? 0.6 : clampZoom(openingScale)
    setDefaultZoom(safeOpeningScale)
    setZoom(safeOpeningScale)

    const { data: siteData, error: siteError } = await supabase
      .from('parking_sites')
      .select('id,event_id,site_number,display_label,map_x,map_y,assigned_attendee_id')
      .eq('event_id', typedEvent.id)

    if (siteError) {
      setStatus(`Could not load sites: ${siteError.message}`)
      return
    }

    const { data: attendeeData, error: attendeeError } = await supabase
      .from('attendees')
      .select('id,event_id,pilot_first,pilot_last,coach_make,coach_model,assigned_site,arrival_status')
      .eq('event_id', typedEvent.id)

    if (attendeeError) {
      setStatus(`Could not load attendees: ${attendeeError.message}`)
      return
    }

    setSites((siteData || []) as SiteRow[])
    setAttendees((attendeeData || []) as AttendeeRow[])
    setStatus(`Loaded ${(siteData || []).length} sites.`)
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

  const selectedOccupant = selectedSite?.assigned_attendee_id
    ? attendeeById.get(selectedSite.assigned_attendee_id) || null
    : null

  function getMarkerColor(site: SiteRow) {
    if (selectedSite?.id === site.id) return 'gold'
    if (!site.assigned_attendee_id) return 'green'

    const occupant = attendeeById.get(site.assigned_attendee_id)
    const arrivalStatus = occupant?.arrival_status || 'not_arrived'

    if (arrivalStatus === 'parked') return 'red'
    if (arrivalStatus === 'arrived') return 'orange'
    return '#0b5cff'
  }

  function focusSite(site: SiteRow, targetZoom = zoom) {
    if (!scrollRef.current || site.map_x === null || site.map_y === null) return

    const container = scrollRef.current
    const scaledWidth = naturalSize.width * targetZoom
    const scaledHeight = naturalSize.height * targetZoom

    const x = (site.map_x / 100) * scaledWidth
    const y = (site.map_y / 100) * scaledHeight

    container.scrollTo({
      left: Math.max(0, x - container.clientWidth / 2),
      top: Math.max(0, y - container.clientHeight / 2),
      behavior: 'smooth',
    })
  }

  function zoomToSite(site: SiteRow) {
    const nextZoom = Math.min(zoom + 0.6, 3)
    setZoom(nextZoom)

    window.setTimeout(() => {
      focusSite(site, nextZoom)
    }, 40)
  }

  return (
    <div style={{ padding: isNarrow ? 12 : 24 }}>
      <h1 style={{ marginTop: 0 }}>Coach Map</h1>

      <div style={{ color: '#555', marginBottom: 12 }}>
        {event?.name || ''} {event?.location ? `· ${event.location}` : ''}
      </div>

      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        {status}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <input
          type="text"
          placeholder="Search by site, name, or coach"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: 8,
	minWidth: isNarrow ? '100%' : 280,
          }}
        />

        <button type="button" onClick={() => setZoom((z) => clampZoom(z - 0.1))}>
          -
        </button>
        <button type="button" onClick={() => setZoom((z) => clampZoom(z + 0.1))}>
          +
        </button>
        <button type="button" onClick={() => setZoom(defaultZoom)}>
          Reset Zoom
        </button>
      </div>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          padding: 12,
          overflow: 'hidden',
        }}
      >
        <div
          ref={scrollRef}
          style={{
            overflow: 'auto',
            maxHeight: isNarrow ? '65vh' : '78vh',
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

                const occupied = !!site.assigned_attendee_id
                const highlighted = search.trim() === '' || highlightedSiteIds.has(site.id)
                const selected = selectedSite?.id === site.id

                return (
                  <div
                    key={site.id}
                    onClick={() => {
                      const now = Date.now()
                      const isDoubleTap =
                        lastTap &&
                        lastTap.siteId === site.id &&
                        now - lastTap.time < 300

                      setSelectedSite(site)

                      if (isDoubleTap) {
                        zoomToSite(site)
                        setLastTap(null)
                      } else {
                        focusSite(site)
                        setLastTap({ siteId: site.id, time: now })
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: `${site.map_x}%`,
                      top: `${site.map_y}%`,
                      transform: 'translate(-50%, -50%)',
                      cursor: 'pointer',
                      opacity: highlighted ? 1 : 0.25,
                      zIndex: selected ? 3 : 2,
                    }}
                  >
                    <div
                      style={{
			width: isNarrow ? 48 : 36,
			height: isNarrow ? 48 : 36,
                        borderRadius: '50%',
                        background: getMarkerColor(site),
			border: isNarrow ? '5px solid white' : '4px solid white',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                      }}
                      title={
                        occupied
                          ? `${site.display_label || site.site_number} occupied`
                          : `${site.display_label || site.site_number} open`
                      }
                    />

                    <div
                      style={{
                        marginTop: 4,
                        background: 'rgba(255,255,255,0.92)',
                        border: '1px solid rgba(0,0,0,0.2)',
                        borderRadius: 4,
                        fontSize: isNarrow ? 11 : 10,
                        fontWeight: 700,
                        padding: '1px 4px',
                        color: '#111',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        textAlign: 'center',
                      }}
                    >
                      {site.display_label || site.site_number}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {!isNarrow && selectedSite && (
        <div
          style={{
            marginTop: 16,
            border: '1px solid #ddd',
            borderRadius: 10,
            background: 'white',
            padding: 14,
            maxWidth: 500,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            Site {selectedSite.display_label || selectedSite.site_number}
          </div>

          {selectedOccupant ? (
            <>
              <div style={{ marginTop: 8, fontWeight: 600 }}>
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
            <div style={{ marginTop: 8, color: '#666' }}>Unoccupied</div>
          )}
        </div>
      )}

      {isNarrow && selectedSite && (
        <div
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 72px)',
            right: '12px',
            zIndex: 2500,
            width: 'min(320px, calc(100vw - 24px))',
            border: '1px solid #d6d6d6',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 6px 16px rgba(0,0,0,0.22)',
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>
              Site {selectedSite.display_label || selectedSite.site_number}
            </div>

            <button
              type="button"
              onClick={() => setSelectedSite(null)}
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
              Unoccupied
            </div>
          )}
        </div>
      )}
    </div>
  )
}
