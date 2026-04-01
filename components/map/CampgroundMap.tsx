'use client'

import React from 'react'

type SiteMarker = {
  id: string
  site_number: string | null
  display_label: string | null
  map_x: number | null
  map_y: number | null
  assigned_attendee_id?: string | null
  popupText?: string | null
}

type CampgroundMapProps = {
  mapRef?: React.RefObject<HTMLDivElement | null>
  mapImageUrl: string
  height?: number
  sites?: SiteMarker[]
  pendingX?: number | null
  pendingY?: number | null
  onMapClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMarkerClick?: (site: SiteMarker) => void
  selectedSiteId?: string | null
}

function markerColor(site: SiteMarker, isSelected: boolean) {
  if (isSelected) return '#f4b400'
  if (site.assigned_attendee_id) return '#0a63ff'
  return '#1f9d55'
}

function CampgroundMapInner({
  mapRef,
  mapImageUrl,
  height = 700,
  sites = [],
  pendingX = null,
  pendingY = null,
  onMapClick,
  onMarkerClick,
  selectedSiteId = null,
}: CampgroundMapProps) {
  const selectedSite = sites.find((s) => s.id === selectedSiteId) || null

  return (
    <div
      ref={mapRef}
      onClick={onMapClick}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 1000,
        height,
        border: '1px solid #ccc',
        overflow: 'hidden',
        marginBottom: 20,
        backgroundColor: '#f2f2f2',
        cursor: onMapClick ? 'crosshair' : 'default',
      }}
    >
      <img
        src={mapImageUrl}
        alt="Campground map"
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />

      {sites.map((site) => {
        const isSelected = selectedSiteId === site.id

        return (
          <button
            key={site.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onMarkerClick?.(site)
            }}
            title={`Site ${site.site_number || ''}`}
            style={{
              position: 'absolute',
              left: `${site.map_x}%`,
              top: `${site.map_y}%`,
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              minWidth: 14,
              minHeight: 14,
              padding: 0,
              borderRadius: '50%',
              background: markerColor(site, isSelected),
              border: isSelected ? '2px solid white' : '1px solid rgba(255,255,255,0.85)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
              zIndex: 2,
              cursor: 'pointer',
              transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.7)'
              e.currentTarget.style.zIndex = '5'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.45)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)'
              e.currentTarget.style.zIndex = '2'
              e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)'
            }}
            onFocus={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.7)'
              e.currentTarget.style.zIndex = '5'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.45)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)'
              e.currentTarget.style.zIndex = '2'
              e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)'
            }}
          />
        )
      })}

      {pendingX !== null && pendingY !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${pendingX}%`,
            top: `${pendingY}%`,
            transform: 'translate(-50%, -50%)',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#f4b400',
            border: '2px solid white',
            boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
            zIndex: 3,
          }}
        />
      )}

      {selectedSite && (
        <div
          style={{
            position: 'absolute',
            left: `${selectedSite.map_x}%`,
            top: `${selectedSite.map_y}%`,
            transform: 'translate(-50%, calc(-100% - 16px))',
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: 10,
            padding: '10px 12px',
            minWidth: 180,
            maxWidth: 260,
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            zIndex: 4,
          }}
        >
          <div style={{ fontWeight: 700 }}>
            Site {selectedSite.site_number || '(no number)'}
          </div>

          {selectedSite.display_label &&
            selectedSite.display_label !== selectedSite.site_number && (
              <div style={{ fontSize: 13 }}>
                {selectedSite.display_label}
              </div>
            )}

          {selectedSite.popupText && (
            <div style={{ fontSize: 13, color: '#444' }}>
              {selectedSite.popupText}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #ddd',
          borderRadius: 10,
          padding: '10px 12px',
          fontSize: 12,
          zIndex: 4,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#1f9d55',
              display: 'inline-block',
            }}
          />
          Empty
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#0a63ff',
              display: 'inline-block',
            }}
          />
          Occupied
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#f4b400',
              display: 'inline-block',
            }}
          />
          Selected / New
        </div>
      </div>
    </div>
  )
}

export default React.memo(CampgroundMapInner)
