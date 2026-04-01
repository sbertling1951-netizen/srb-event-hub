'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ActiveEvent = {
  id: string
  name: string
  location: string | null
  map_image_url: string | null
  locations_map_open_scale: number | null
}

type EventLocation = {
  id: string
  event_id: string
  name: string
  category: string | null
  description: string | null
  map_x: number | null
  map_y: number | null
  priority: number | null
}

type PinchState = {
  startDistance: number
  startZoom: number
  contentX: number
  contentY: number
}

type DragState = {
  startX: number
  startY: number
  startLeft: number
  startTop: number
}

export default function LocationsAdminPage() {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(0.6)
  const pinchRef = useRef<PinchState | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const [event, setEvent] = useState<ActiveEvent | null>(null)
  const [locations, setLocations] = useState<EventLocation[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Loading...')
  const [isNarrow, setIsNarrow] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 })
  const [defaultZoom, setDefaultZoom] = useState(0.6)
  const [zoom, setZoom] = useState(0.6)

  const [isPlacing, setIsPlacing] = useState(false)
  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPriority, setFormPriority] = useState('100')
  const [formX, setFormX] = useState('')
  const [formY, setFormY] = useState('')

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
    const el = mapRef.current
    if (!el) return

    function onWheel(e: WheelEvent) {
      if (isNarrow) return

      e.preventDefault()

      const rect = el.getBoundingClientRect()
      const viewportX = e.clientX - rect.left
      const viewportY = e.clientY - rect.top

      const currentZoom = zoomRef.current
      const nextZoom = clampZoom(currentZoom * (e.deltaY > 0 ? 0.92 : 1.08))

      const contentX = (el.scrollLeft + viewportX) / currentZoom
      const contentY = (el.scrollTop + viewportY) / currentZoom

      setZoom(nextZoom)
      zoomRef.current = nextZoom

      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, contentX * nextZoom - viewportX)
        el.scrollTop = Math.max(0, contentY * nextZoom - viewportY)
      })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [isNarrow])

  useEffect(() => {
    const el = mapRef.current
    if (!el) return

    function onMouseDown(e: MouseEvent) {
      if (isNarrow) return
      if (e.button !== 0) return

      const target = e.target as HTMLElement
      if (target.closest('button')) return

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: el.scrollLeft,
        startTop: el.scrollTop,
      }

      el.style.cursor = 'grabbing'
      e.preventDefault()
    }

    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return

      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY

      el.scrollLeft = drag.startLeft - dx
      el.scrollTop = drag.startTop - dy
    }

    function onMouseUp() {
      dragRef.current = null
      el.style.cursor = isNarrow ? 'auto' : 'grab'
    }

    el.style.cursor = isNarrow ? 'auto' : 'grab'
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isNarrow])

  useEffect(() => {
    void loadPage()
  }, [])

  async function loadPage() {
    setStatus('Loading...')

    const { data: activeEvent, error: eventError } = await supabase
      .from('events')
      .select('id,name,location,map_image_url,locations_map_open_scale')
      .eq('is_active', true)
      .single()

    if (eventError || !activeEvent) {
      setStatus(`Could not load active event: ${eventError?.message || 'No active event found.'}`)
      return
    }

    const typedEvent = activeEvent as ActiveEvent
    setEvent(typedEvent)

    const openingScale = Number(typedEvent.locations_map_open_scale ?? 0.6)
    const safeOpeningScale = Number.isNaN(openingScale) ? 0.6 : clampZoom(openingScale)
    setDefaultZoom(safeOpeningScale)
    setZoom(safeOpeningScale)

    const { data: locationData, error: locationError } = await supabase
      .from('event_locations')
      .select('id,event_id,name,category,description,map_x,map_y,priority')
      .eq('event_id', typedEvent.id)
      .order('priority', { ascending: true })
      .order('name', { ascending: true })

    if (locationError) {
      setStatus(`Could not load event locations: ${locationError.message}`)
      return
    }

    setLocations((locationData || []) as EventLocation[])
    setStatus(`Loaded ${(locationData || []).length} locations.`)
  }

  const filteredLocations = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return locations

    return locations.filter((loc) => {
      const text = [loc.name || '', loc.category || '', loc.description || '']
        .join(' ')
        .toLowerCase()

      return text.includes(q)
    })
  }, [locations, search])

  const selectedLocation =
    locations.find((loc) => loc.id === selectedLocationId) || null

  function focusLocation(location: EventLocation, targetZoom = zoomRef.current) {
    if (!mapRef.current || location.map_x === null || location.map_y === null) return

    const container = mapRef.current
    const scaledWidth = naturalSize.width * targetZoom
    const scaledHeight = naturalSize.height * targetZoom

    const x = (location.map_x / 100) * scaledWidth
    const y = (location.map_y / 100) * scaledHeight

    requestAnimationFrame(() => {
      container.scrollTo({
        left: Math.max(0, x - container.clientWidth / 2),
        top: Math.max(0, y - container.clientHeight / 2),
        behavior: 'smooth',
      })
    })
  }

  function handleLocationClick(location: EventLocation) {
    setSelectedLocationId(location.id)
    setIsPlacing(false)
    focusLocation(location)
    setStatus(`Focused map on ${location.name}.`)
  }

  function getMarkerColor(location: EventLocation) {
    if (location.id === selectedLocationId) return 'gold'

    switch ((location.category || '').toLowerCase()) {
      case 'trash':
      case 'dumpster':
        return '#dc2626'
      case 'building':
      case 'office':
        return '#2563eb'
      case 'restroom':
      case 'bathroom':
        return '#16a34a'
      case 'registration':
        return '#d97706'
      default:
        return '#7c3aed'
    }
  }

  function getMarkerSize(location: EventLocation) {
    if (location.id === selectedLocationId) return isNarrow ? 44 : 36
    return isNarrow ? 22 : 16
  }

  function resetForm() {
    setFormId('')
    setFormName('')
    setFormCategory('')
    setFormDescription('')
    setFormPriority('100')
    setFormX('')
    setFormY('')
    setIsPlacing(false)
  }

  function loadLocationIntoForm(location: EventLocation) {
    setFormId(location.id)
    setFormName(location.name || '')
    setFormCategory(location.category || '')
    setFormDescription(location.description || '')
    setFormPriority(String(location.priority ?? 100))
    setFormX(location.map_x != null ? String(location.map_x) : '')
    setFormY(location.map_y != null ? String(location.map_y) : '')
    setSelectedLocationId(location.id)
    setIsPlacing(false)
  }

  function handleMapClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!isPlacing || !mapRef.current) return

    const container = mapRef.current
    const rect = container.getBoundingClientRect()

    const viewportX = e.clientX - rect.left
    const viewportY = e.clientY - rect.top

    const contentX = (container.scrollLeft + viewportX) / zoomRef.current
    const contentY = (container.scrollTop + viewportY) / zoomRef.current

    const xPercent = (contentX / naturalSize.width) * 100
    const yPercent = (contentY / naturalSize.height) * 100

    const safeX = Math.max(0, Math.min(100, Number(xPercent.toFixed(2))))
    const safeY = Math.max(0, Math.min(100, Number(yPercent.toFixed(2))))

    setFormX(String(safeX))
    setFormY(String(safeY))
    setStatus(`Placed marker at X ${safeX}, Y ${safeY}. Save to keep it.`)
  }

  async function saveLocation() {
    if (!event?.id) {
      setStatus('No active event.')
      return
    }

    if (!formName.trim()) {
      setStatus('Enter a location name.')
      return
    }

    if (formX === '' || formY === '') {
      setStatus('Click Place on Map, then click the map to choose a position.')
      return
    }

    const payload = {
      event_id: event.id,
      name: formName.trim(),
      category: formCategory.trim() || null,
      description: formDescription.trim() || null,
      priority: Number(formPriority || 100),
      map_x: Number(formX),
      map_y: Number(formY),
    }

    if (
      Number.isNaN(payload.priority) ||
      Number.isNaN(payload.map_x) ||
      Number.isNaN(payload.map_y)
    ) {
      setStatus('Priority or map coordinates are invalid.')
      return
    }

    if (formId) {
      const { error } = await supabase
        .from('event_locations')
        .update(payload)
        .eq('id', formId)

      if (error) {
        setStatus(`Could not update location: ${error.message}`)
        return
      }

      setStatus(`Updated ${payload.name}.`)
    } else {
      const { error } = await supabase
        .from('event_locations')
        .insert(payload)

      if (error) {
        setStatus(`Could not create location: ${error.message}`)
        return
      }

      setStatus(`Created ${payload.name}.`)
    }

    await loadPage()
    resetForm()
  }

  async function deleteLocation() {
    if (!formId) {
      setStatus('No location selected to delete.')
      return
    }

    const confirmed = window.confirm(`Delete "${formName}"?`)
    if (!confirmed) return

    const { error } = await supabase
      .from('event_locations')
      .delete()
      .eq('id', formId)

    if (error) {
      setStatus(`Could not delete location: ${error.message}`)
      return
    }

    setStatus(`Deleted ${formName}.`)
    if (selectedLocationId === formId) {
      setSelectedLocationId('')
    }
    await loadPage()
    resetForm()
  }

  return (
    <div style={{ padding: isNarrow ? 12 : 24 }}>
      <h1 style={{ marginTop: 0 }}>Map Locations</h1>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: '#f8f9fb',
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700 }}>{event?.name || 'No active event'}</div>
        <div style={{ color: '#555' }}>{event?.location || ''}</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Status: {status}</div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isNarrow ? '1fr' : '360px minmax(0, 1fr)',
          gridTemplateAreas: isNarrow ? "'map' 'list'" : "'list map'",
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            gridArea: 'list',
            border: '1px solid #ddd',
            borderRadius: 10,
            background: 'white',
            padding: 14,
            display: 'grid',
            gap: 12,
            maxHeight: isNarrow ? 'none' : '82vh',
            overflow: isNarrow ? 'visible' : 'auto',
          }}
        >
          <div style={{ fontWeight: 700 }}>Locations</div>

          <input
            type="text"
            placeholder="Search locations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 8 }}
          />

          <div style={{ fontSize: 13, color: '#666' }}>
            Showing {filteredLocations.length} of {locations.length}
          </div>

          <div
            style={{
              border: '1px solid #eee',
              borderRadius: 8,
              padding: 10,
              background: '#fafafa',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {formId ? 'Edit Location' : 'New Location'}
            </div>

            <input
              type="text"
              placeholder="Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={{ padding: 8 }}
            />

            <input
              type="text"
              placeholder="Category"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value)}
              style={{ padding: 8 }}
            />

            <textarea
              placeholder="Description"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              style={{ padding: 8, minHeight: 80, resize: 'vertical' }}
            />

            <select
              value={formPriority}
              onChange={(e) => setFormPriority(e.target.value)}
              style={{ padding: 8 }}
            >
              <option value="1">1 - Highest Priority</option>
              <option value="2">2 - Very High</option>
              <option value="3">3 - High</option>
              <option value="5">5 - Important</option>
              <option value="10">10 - Useful</option>
              <option value="100">100 - Normal</option>
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                type="number"
                step="0.01"
                placeholder="Map X"
                value={formX}
                onChange={(e) => setFormX(e.target.value)}
                style={{ padding: 8 }}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Map Y"
                value={formY}
                onChange={(e) => setFormY(e.target.value)}
                style={{ padding: 8 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setIsPlacing((v) => !v)}
                style={{
                  border: '1px solid #ccc',
                  background: isPlacing ? '#fff7d6' : 'white',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                {isPlacing ? 'Cancel Place Mode' : 'Place on Map'}
              </button>

              <button
                type="button"
                onClick={() => void saveLocation()}
                style={{
                  border: '1px solid #ccc',
                  background: 'white',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                {formId ? 'Update Location' : 'Save Location'}
              </button>

              {formId && (
                <button
                  type="button"
                  onClick={() => void deleteLocation()}
                  style={{
                    border: '1px solid #ccc',
                    background: 'white',
                    borderRadius: 6,
                    padding: '6px 10px',
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              )}

              <button
                type="button"
                onClick={resetForm}
                style={{
                  border: '1px solid #ccc',
                  background: 'white',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                Clear Form
              </button>
            </div>

            <div style={{ fontSize: 12, color: '#666' }}>
              {isPlacing
                ? 'Place mode is on. Click the map to capture X/Y.'
                : 'Tip: choose Place on Map, then click the map to set the marker position.'}
            </div>
          </div>

          {filteredLocations.map((loc) => {
            const selected = loc.id === selectedLocationId

            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => {
                  handleLocationClick(loc)
                  loadLocationIntoForm(loc)
                }}
                style={{
                  textAlign: 'left',
                  width: '100%',
                  padding: 12,
                  borderRadius: 8,
                  border: selected ? '1px solid #f0c36d' : '1px solid #eee',
                  background: selected ? '#fff7d6' : 'white',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700 }}>{loc.name}</div>

                {loc.category && (
                  <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                    {loc.category}
                  </div>
                )}

                {loc.description && (
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    {loc.description}
                  </div>
                )}

                <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
                  Priority {loc.priority ?? 100} · Tap to center map and load into form
                </div>
              </button>
            )
          })}

          {selectedLocation && (
            <div
              style={{
                border: '1px solid #eee',
                borderRadius: 8,
                padding: 10,
                background: '#fafafa',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Selected Location
              </div>

              <div>{selectedLocation.name}</div>

              {selectedLocation.category && (
                <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                  {selectedLocation.category}
                </div>
              )}

              {selectedLocation.description && (
                <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                  {selectedLocation.description}
                </div>
              )}

              <div style={{ fontSize: 12, color: '#777', marginTop: 6 }}>
                Priority: {selectedLocation.priority ?? 100}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            gridArea: 'map',
            border: '1px solid #ddd',
            borderRadius: 10,
            background: 'white',
            padding: 12,
          }}
        >
          <div
            ref={mapRef}
            onClick={handleMapClick}
            style={{
              overflow: 'auto',
              maxHeight: isNarrow ? '72vh' : '82vh',
              border: '1px solid #ddd',
              background: isPlacing ? '#eef7ff' : '#f2f2f2',
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
                    alt="Event map"
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

                {locations.map((loc) => {
                  if (loc.map_x === null || loc.map_y === null) return null

                  const markerSize = getMarkerSize(loc)

                  return (
                    <div
                      key={loc.id}
                      style={{
                        position: 'absolute',
                        left: `${loc.map_x}%`,
                        top: `${loc.map_y}%`,
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                        zIndex: loc.id === selectedLocationId ? 4 : 2,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          handleLocationClick(loc)
                          loadLocationIntoForm(loc)
                        }}
                        title={loc.name}
                        style={{
                          width: markerSize,
                          height: markerSize,
                          borderRadius: '50%',
                          background: getMarkerColor(loc),
                          border: isNarrow ? '3px solid white' : '2px solid white',
                          boxShadow:
                            loc.id === selectedLocationId
                              ? '0 0 0 4px rgba(255,215,0,0.35), 0 1px 4px rgba(0,0,0,0.35)'
                              : '0 1px 4px rgba(0,0,0,0.35)',
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
                          background: 'rgba(255,255,255,0.92)',
                          border: '1px solid rgba(0,0,0,0.2)',
                          borderRadius: 4,
                          fontSize: loc.id === selectedLocationId ? 12 : 10,
                          fontWeight: 700,
                          padding: loc.id === selectedLocationId ? '2px 6px' : '1px 4px',
                          color: '#111',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                          display: 'table',
                          pointerEvents: 'none',
                        }}
                      >
                        {loc.name}
                      </div>
                    </div>
                  )
                })}

                {isPlacing && formX !== '' && formY !== '' && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${formX}%`,
                      top: `${formY}%`,
                      transform: 'translate(-50%, -50%)',
                      pointerEvents: 'none',
                      zIndex: 5,
                    }}
                  >
                    <div
                      style={{
                        width: isNarrow ? 30 : 24,
                        height: isNarrow ? 30 : 24,
                        borderRadius: '50%',
                        background: 'rgba(0,123,255,0.9)',
                        border: '3px solid white',
                        boxShadow: '0 0 0 4px rgba(0,123,255,0.2), 0 1px 4px rgba(0,0,0,0.35)',
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" onClick={() => setZoom((z) => clampZoom(z - 0.2))}>
              −
            </button>
            <button type="button" onClick={() => setZoom((z) => clampZoom(z + 0.2))}>
              +
            </button>
            <button type="button" onClick={() => setZoom(defaultZoom)}>
              Reset Zoom
            </button>
            {selectedLocation && (
              <button
                type="button"
                onClick={() => focusLocation(selectedLocation)}
              >
                Recenter Selected
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
