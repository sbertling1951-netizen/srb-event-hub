'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type BannerAnnouncement = {
  id: string
  title: string
  body: string | null
  is_important: boolean | null
  is_pinned: boolean | null
  published_at: string | null
  starts_at: string | null
  ends_at: string | null
}

function isActiveNow(startsAt: string | null, endsAt: string | null) {
  const now = Date.now()
  const startsOk = !startsAt || new Date(startsAt).getTime() <= now
  const endsOk = !endsAt || new Date(endsAt).getTime() >= now
  return startsOk && endsOk
}

function isRecent(value: string | null) {
  if (!value) return false
  return Date.now() - new Date(value).getTime() <= 24 * 60 * 60 * 1000
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<BannerAnnouncement | null>(null)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [showPopup, setShowPopup] = useState(false)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function init() {
      const { data: activeEvent } = await supabase
        .from('events')
        .select('id')
        .eq('is_active', true)
        .single()

      if (!isMounted) return
      const eventId = activeEvent?.id || null
      setActiveEventId(eventId)

      if (eventId) {
        await loadBanner(eventId)
      }
    }

    void init()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!activeEventId) return

    const channel = supabase
      .channel('announcements-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements',
        },
        async () => {
          await loadBanner(activeEventId)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [activeEventId])

  useEffect(() => {
    if (!announcement) return
    if (!announcement.is_important) return

    const popupKey = `announcement-popup-seen-${announcement.id}`
    const alreadySeen =
      typeof window !== 'undefined' && localStorage.getItem(popupKey) === 'true'

    if (!alreadySeen) {
      setShowPopup(true)

      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(50)
      }

      localStorage.setItem(popupKey, 'true')
    }
  }, [announcement])

  async function loadBanner(eventId: string) {
    const { data } = await supabase
      .from('announcements')
      .select('id,title,body,is_important,is_pinned,published_at,starts_at,ends_at')
      .eq('event_id', eventId)
      .eq('is_published', true)
      .order('is_important', { ascending: false })
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false })

    const active = (data || []).find((item) =>
      isActiveNow(item.starts_at, item.ends_at)
    ) as BannerAnnouncement | undefined

    if (active) {
      setAnnouncement(active)
    } else {
      setAnnouncement(null)
      setShowPopup(false)
    }
  }

  const hidden = useMemo(() => {
    if (!announcement) return true
    return dismissedIds.includes(announcement.id)
  }, [announcement, dismissedIds])

  if (!announcement) return null

  const recent = isRecent(announcement.published_at)
  const canDismissPopup = !(announcement.is_important && announcement.is_pinned)

  return (
    <>
      {!hidden && (
        <div
          style={{
            background: announcement.is_important ? '#fff4d6' : '#eef5ff',
            borderBottom: '1px solid #d6d6d6',
            padding: '10px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>
                {announcement.is_important ? '⚠️ Alert' : '📢 Announcement'}
              </span>

              {announcement.is_pinned && (
                <span
                  style={{
                    background: '#111827',
                    color: 'white',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  PINNED
                </span>
              )}

              {recent && (
                <span
                  style={{
                    background: '#dc2626',
                    color: 'white',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  NEW
                </span>
              )}

              <span>{announcement.title}</span>

              <Link
                href="/announcements"
                style={{
                  color: '#0b5cff',
                  textDecoration: 'underline',
                  fontWeight: 600,
                }}
              >
                View
              </Link>
            </div>

            <button
              type="button"
              onClick={() => setDismissedIds((prev) => [...prev, announcement.id])}
              style={{
                border: '1px solid #bbb',
                background: 'white',
                borderRadius: 6,
                padding: '4px 8px',
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showPopup && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 5000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(560px, 100%)',
              background: 'white',
              borderRadius: 14,
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: announcement.is_important ? '#fff4d6' : '#eef5ff',
                padding: '14px 16px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {announcement.is_important ? '⚠️ Important Announcement' : '📢 Announcement'}
              </div>

              {announcement.is_pinned && (
                <span
                  style={{
                    background: '#111827',
                    color: 'white',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  PINNED
                </span>
              )}

              {recent && (
                <span
                  style={{
                    background: '#dc2626',
                    color: 'white',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  NEW
                </span>
              )}
            </div>

            <div style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 10 }}>
                {announcement.title}
              </div>

              {announcement.published_at && (
                <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                  {new Date(announcement.published_at).toLocaleString()}
                </div>
              )}

              <div style={{ whiteSpace: 'pre-wrap', color: '#333', marginBottom: 16 }}>
                {announcement.body || ''}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link
                  href="/announcements"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: '#0b5cff',
                    color: 'white',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                  onClick={() => setShowPopup(false)}
                >
                  View All Announcements
                </Link>

                {canDismissPopup && (
                  <button
                    type="button"
                    onClick={() => setShowPopup(false)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #ccc',
                      background: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss
                  </button>
                )}
              </div>

              {!canDismissPopup && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
                  This alert is pinned and cannot be dismissed.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
